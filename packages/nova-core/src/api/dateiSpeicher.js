// File storage adapter of the serverless build (Phase 70-03): the same seven
// adapter methods demoIdb.js offers (entities, alle, schreiben, schreibeViele,
// loeschen, leeren, meta) — plus stelleStoresSicher for the personal storage class (80-02) and a
// small blob store — but against real files in a folder of the user's choice
// instead of the browser's IndexedDB. demoDb.js never learns which one it talks
// to (setzeSpeicher), so the whole app writes to disk without a single change
// in a module.
//
// Folder layout (relative to `wurzel`):
//
//   daten/<Entity>.json         one file per project collection (array of records)
//   personal/<Entity>.json      HR collections (stores "personal.<Entity>", 80-02)
//   personal/dateien/<id>.json  HR file payloads, one file per record
//   schnappschuesse/<id>.json   snapshot ring (69-13), one file per snapshot
//   blobs/<id>.json             big JSON payloads (bitApi.blobs, speicherOrt > 1 MB)
//   meta.json                   schema version, migration notes, last backup
//   logs/                       reserved for the shell
//
// Why one file per collection and not one per record: a project has a few
// hundred to a few thousand small records; one file each would mean thousands
// of tiny files on a synced drive. The two stores whose records are LARGE
// (whole-project snapshots, HR file payloads) and the blobs get one file per
// record instead — writing a snapshot must not rewrite the four others.
//
// Atomic writes: every file is written as `<file>.tmp` and then renamed over
// the target. A crash between the two steps leaves the previous version intact
// (the stale .tmp is ignored and overwritten next time).
//
// A damaged JSON file is REPORTED (Error naming the file), never read as an
// empty collection — otherwise the user would see an empty project instead of
// an error, and the next write would replace the damaged file for good.
//
// In:  `wurzel` (prefix of every path, "" = the root the file interface itself
//      is bound to) and the file interface `fs` (DateiSchnittstelle below). No
//      Tauri import here: the module stays testable under node with a fake fs;
//      the client injects its shell commands (src/client/ablage.js).
// Out: the adapter object.

import { SCHNAPP_STORE } from './demoIdb.js';
import { istPersonalStore, PERSONAL_STORE_PRAEFIX, PERSONAL_DATEIEN_STORE } from './personalEntitaeten.js';

/**
 * The file interface the adapter needs. All paths use "/" and are relative to
 * whatever root the implementation is bound to.
 * @typedef {object} DateiSchnittstelle
 * @property {(pfad: string) => Promise<string|null>} lesen text of a file, null when it does not exist
 * @property {(pfad: string, text: string) => Promise<void>} schreiben writes (creates/overwrites) a file, NOT atomic
 * @property {(von: string, nach: string) => Promise<void>} umbenennen moves a file, replacing the target
 * @property {(pfad: string) => Promise<void>} loeschen deletes a file; a missing file is not an error
 * @property {(ordner: string) => Promise<string[]>} liste file names (no folders) in a folder; missing folder → []
 * @property {(ordner: string) => Promise<void>} ordnerAnlegen creates a folder with all parents
 */

/** Schema version written to meta.json on first use. */
export const DATEI_SCHEMA = 1;

/** Sub-folders created on first use (see the layout above). */
export const ORDNER = Object.freeze(['daten', 'personal', 'personal/dateien', 'schnappschuesse', 'blobs', 'logs']);

/** Store names and record ids must be safe file names: no separators, no "..", no leading dot. */
const SICHERER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/**
 * Throws when a name cannot be used as a file name.
 * @param {string} name
 * @param {string} art what it is, for the message ("Sammlung", "Datensatz-ID")
 */
function pruefeName(name, art) {
  if (typeof name !== 'string' || !SICHERER_NAME.test(name) || name.includes('..')) {
    throw new Error(`${art} „${name}“ ist als Dateiname nicht zulässig.`);
  }
}

/**
 * Where a store lives: one file for a collection, or a folder with one file
 * per record (`einzeln`).
 * @param {string} store store name as the data layer uses it (project, personal.*, snapshot ring)
 * @returns {{art: 'sammlung', datei: string} | {art: 'einzeln', ordner: string}}
 */
export function ortFuer(store) {
  if (store === SCHNAPP_STORE) return { art: 'einzeln', ordner: 'schnappschuesse' };
  if (store === PERSONAL_DATEIEN_STORE) return { art: 'einzeln', ordner: 'personal/dateien' };
  if (istPersonalStore(store)) {
    const name = store.slice(PERSONAL_STORE_PRAEFIX.length);
    pruefeName(name, 'Sammlung');
    return { art: 'sammlung', datei: `personal/${name}.json` };
  }
  pruefeName(store, 'Sammlung');
  return { art: 'sammlung', datei: `daten/${store}.json` };
}

/**
 * Builds the file adapter.
 * @param {string} wurzel path prefix of every file ("" = root of the file interface)
 * @param {DateiSchnittstelle} fs
 * @returns {{
 *   entities: () => Promise<string[]>,
 *   alle: (store: string) => Promise<object[]>,
 *   schreiben: (store: string, datensatz: object) => Promise<void>,
 *   schreibeViele: (store: string, datensaetze: object[]) => Promise<void>,
 *   loeschen: (store: string, id: string) => Promise<void>,
 *   leeren: (store: string) => Promise<void>,
 *   meta: (key: string, wert?: unknown) => Promise<unknown>,
 *   stelleStoresSicher: (namen: string[]) => Promise<void>,
 *   blobs: {put: (id: string, json: unknown) => Promise<{id: string}>, get: (id: string) => Promise<unknown>, delete: (id: string) => Promise<void>},
 *   vorbereiten: () => Promise<void>,
 * }}
 */
export function dateiSpeicher(wurzel, fs) {
  const basis = wurzel ? `${String(wurzel).replace(/[\\/]+$/, '')}/` : '';
  const p = (/** @type {string} */ rel) => basis + rel;

  /** Loaded collections: store → (id → record). Filled on first access. */
  /** @type {Map<string, Map<string, any>>} */
  const sammlungen = new Map();
  /** Loads in progress: store → promise of its map. */
  /** @type {Map<string, Promise<Map<string, any>>>} */
  const ladend = new Map();
  /** @type {Record<string, unknown>|null} */
  let metaCache = null;
  /** Per-file write chain: two writes to one file never interleave their tmp/rename steps. */
  /** @type {Map<string, Promise<void>>} */
  const ketten = new Map();
  /** @type {Promise<void>|null} */
  let bereit = null;

  /**
   * Reads and parses a JSON file. Missing → null; damaged → Error naming the file.
   * @param {string} rel
   * @returns {Promise<any>}
   */
  async function jsonLesen(rel) {
    const text = await fs.lesen(p(rel));
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Datei beschädigt: ${rel} – ${e instanceof Error ? e.message : String(e)}. Bitte aus einer Sicherung wiederherstellen.`);
    }
  }

  /**
   * Writes a JSON file atomically (tmp + rename), serialised per file.
   * @param {string} rel
   * @param {unknown} wert
   * @returns {Promise<void>}
   */
  function jsonSchreiben(rel, wert) {
    const vorher = ketten.get(rel) || Promise.resolve();
    const lauf = vorher.catch(() => {}).then(async () => {
      const text = JSON.stringify(wert);
      await fs.schreiben(p(`${rel}.tmp`), text);
      await fs.umbenennen(p(`${rel}.tmp`), p(rel));
    });
    ketten.set(rel, lauf);
    return lauf;
  }

  /** Creates the folders and meta.json once. */
  function vorbereiten() {
    if (!bereit) {
      bereit = (async () => {
        for (const o of ORDNER) await fs.ordnerAnlegen(p(o));
        const meta = await jsonLesen('meta.json');
        metaCache = meta && typeof meta === 'object' ? meta : {};
        if (metaCache.dateiSchema == null) {
          metaCache.dateiSchema = DATEI_SCHEMA;
          await jsonSchreiben('meta.json', metaCache);
        }
      })();
      // A failed start must not stay cached (same rule as demoIdb's failed open).
      bereit.catch(() => { bereit = null; });
    }
    return bereit;
  }

  /**
   * The loaded collection of a `sammlung` store.
   * @param {string} store
   * @param {string} datei
   * @returns {Promise<Map<string, any>>}
   */
  async function sammlung(store, datei) {
    await vorbereiten();
    const fertig = sammlungen.get(store);
    if (fertig) return fertig;
    // Concurrent first accesses share ONE load — two separate loads would each
    // build their own map and the later write would drop the earlier record.
    let laden = ladend.get(store);
    if (!laden) {
      laden = (async () => {
        const roh = await jsonLesen(datei);
        if (roh != null && !Array.isArray(roh)) throw new Error(`Datei beschädigt: ${datei} – erwartet wird eine Liste von Datensätzen.`);
        const karte = new Map((roh || []).map((r) => [String(r.id), r]));
        sammlungen.set(store, karte);
        return karte;
      })();
      ladend.set(store, laden);
      laden.then(() => ladend.delete(store), () => ladend.delete(store));
    }
    return laden;
  }

  /**
   * Writes a whole collection file from its map.
   * @param {string} datei
   * @param {Map<string, any>} karte
   */
  function sammlungSchreiben(datei, karte) {
    return jsonSchreiben(datei, [...karte.values()]);
  }

  /**
   * Record id as a file name for `einzeln` stores.
   * @param {any} datensatz
   * @returns {string}
   */
  function idVon(datensatz) {
    const id = String(datensatz?.id ?? '');
    pruefeName(id, 'Datensatz-ID');
    return id;
  }

  /** Lists the record files of an `einzeln` folder (ignores leftovers of an interrupted write). */
  async function einzelDateien(ordner) {
    await vorbereiten();
    return (await fs.liste(p(ordner))).filter((n) => n.endsWith('.json'));
  }

  return {
    vorbereiten,

    /**
     * Names of the project collections (files in daten/). HR stores, the
     * snapshot ring and meta are not project data and live elsewhere — the
     * same rule demoIdb.entities() applies.
     */
    async entities() {
      await vorbereiten();
      return (await fs.liste(p('daten')))
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.slice(0, -'.json'.length))
        .filter((n) => SICHERER_NAME.test(n));
    },

    async alle(store) {
      const ort = ortFuer(store);
      if (ort.art === 'sammlung') return structuredClone([...(await sammlung(store, ort.datei)).values()]);
      const liste = [];
      for (const n of await einzelDateien(ort.ordner)) {
        const wert = await jsonLesen(`${ort.ordner}/${n}`);
        if (wert != null) liste.push(wert);
      }
      return liste;
    },

    async schreiben(store, datensatz) {
      const ort = ortFuer(store);
      if (ort.art === 'einzeln') {
        await vorbereiten();
        await jsonSchreiben(`${ort.ordner}/${idVon(datensatz)}.json`, datensatz);
        return;
      }
      const karte = await sammlung(store, ort.datei);
      const id = String(/** @type {any} */ (datensatz).id);
      const vorher = karte.get(id);
      karte.set(id, structuredClone(datensatz));
      try {
        await sammlungSchreiben(ort.datei, karte);
      } catch (e) {
        // Keep memory and disk in step: the record the disk refused is not "there".
        if (vorher === undefined) karte.delete(id);
        else karte.set(id, vorher);
        throw e;
      }
    },

    async schreibeViele(store, datensaetze) {
      const ort = ortFuer(store);
      if (ort.art === 'einzeln') {
        await vorbereiten();
        for (const d of datensaetze) await jsonSchreiben(`${ort.ordner}/${idVon(d)}.json`, d);
        return;
      }
      const karte = await sammlung(store, ort.datei);
      const vorher = new Map(karte);
      for (const d of datensaetze) karte.set(String(/** @type {any} */ (d).id), structuredClone(d));
      try {
        await sammlungSchreiben(ort.datei, karte);
      } catch (e) {
        sammlungen.set(store, vorher);
        throw e;
      }
    },

    async loeschen(store, id) {
      const ort = ortFuer(store);
      if (ort.art === 'einzeln') {
        await vorbereiten();
        await fs.loeschen(p(`${ort.ordner}/${idVon({ id })}.json`));
        return;
      }
      const karte = await sammlung(store, ort.datei);
      const vorher = karte.get(String(id));
      if (vorher === undefined) return;
      karte.delete(String(id));
      try {
        await sammlungSchreiben(ort.datei, karte);
      } catch (e) {
        karte.set(String(id), vorher);
        throw e;
      }
    },

    async leeren(store) {
      const ort = ortFuer(store);
      await vorbereiten();
      if (ort.art === 'einzeln') {
        for (const n of await einzelDateien(ort.ordner)) await fs.loeschen(p(`${ort.ordner}/${n}`));
        return;
      }
      // The file goes away (like an emptied collection that is no longer listed);
      // the next write creates it again.
      await (ketten.get(ort.datei) || Promise.resolve()).catch(() => {});
      await fs.loeschen(p(ort.datei));
      sammlungen.set(store, new Map());
    },

    /**
     * Reads (one argument) or writes (two arguments) a value in meta.json.
     * @param {string} key
     * @param {unknown} [wert]
     */
    async meta(key, wert) {
      await vorbereiten();
      const m = /** @type {Record<string, unknown>} */ (metaCache);
      if (arguments.length === 1) return structuredClone(m[key]);
      // The cache is updated BEFORE the write is queued: two meta writes in
      // flight (e.g. demoDb's 'persist' next to the takeover note) must each
      // build on the other's key, otherwise the later file write drops the
      // earlier key (lost update, found by the 70-03 headless run).
      const hatte = Object.prototype.hasOwnProperty.call(m, key);
      const alt = m[key];
      metaCache = { ...m, [key]: wert };
      try {
        await jsonSchreiben('meta.json', metaCache);
      } catch (e) {
        // Refused by the disk: this key is not stored — unless a later write
        // already replaced it, in which case that value stands.
        const jetzt = /** @type {Record<string, unknown>} */ (metaCache);
        if (jetzt[key] === wert) {
          const zurueck = { ...jetzt };
          if (hatte) zurueck[key] = alt;
          else delete zurueck[key];
          metaCache = zurueck;
        }
        throw e;
      }
      return wert;
    },

    /** Files are created on demand — nothing to prepare per store (the personal storage class calls this). */
    async stelleStoresSicher() {
      await vorbereiten();
    },

    /** Big JSON payloads (bitApi.blobs in the client): one file per id. */
    blobs: {
      async put(id, json) {
        await vorbereiten();
        await jsonSchreiben(`blobs/${idVon({ id })}.json`, json);
        return { id };
      },
      async get(id) {
        await vorbereiten();
        return jsonLesen(`blobs/${idVon({ id })}.json`);
      },
      async delete(id) {
        await vorbereiten();
        await fs.loeschen(p(`blobs/${idVon({ id })}.json`));
      },
    },
  };
}
