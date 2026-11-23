// Tiny JSON-file database. No external deps — atomic-ish writes to db.json.
// Swap this module for a Supabase/Postgres adapter later without touching routes.
//
// Phase 31: Factory statt __dirname-Singleton — die Kompositionswurzel übergibt
// den Pfad (Monorepo: server/db.json; Shells: eigenes server/db.json).
//
// 96-01: optional `codec` ({encode, decode, aktiv}, ruheVerschluesselung.js) —
// the personnel store passes an AES-256-GCM codec, every other store keeps the
// plain default. A file the codec cannot decrypt (key missing or wrong) makes
// the store `gesperrt`: it serves nothing and NEVER writes, so the ciphertext
// on disk is not replaced by an empty database. Plain files from before
// encryption are read and re-written encrypted once (migration, incl. .bak).
import fs from 'fs';
import path from 'path';
import { KLARTEXT_CODEC, istVerschluesselt } from './ruheVerschluesselung.js';
import { ersetzeAtomar } from './atomarErsetzen.js';

/**
 * B-111-02-01: fields the store sets itself. A caller's value for them is ignored by create / bulkCreate / the create branch
 * of bulkUpsert, unless the caller names the explicit internal path (`kennungUebernehmen` / `zeitUebernehmen`, see create()).
 */
export const VERWALTUNGSFELDER = Object.freeze(['id', 'created_date', 'updated_date']);

/**
 * B-111-02-01: thrown by the explicit id path when the requested id is already taken in the collection (or repeated within one
 * batch). Nothing is written. `status` is the HTTP status the routes answer with (409), `kennung` the refused id.
 */
export class KennungBelegtFehler extends Error {
  /** @param {string} entity collection @param {string} kennung the refused id */
  constructor(entity, kennung) {
    super(`nicht übernommen: die id ${kennung} ist in ${entity} schon vergeben — nichts wurde angelegt`);
    this.name = 'KennungBelegtFehler';
    /** HTTP status of the refusal */
    this.status = 409;
    /** the refused id */
    this.kennung = kennung;
  }
}

/**
 * 124-36: thrown when a collection of the loaded file is no list (object, text, number). The store does not guess and does
 * not repair: nothing is read from that collection and nothing is written to it. `status` 500 = the data file needs a look,
 * the request itself was fine.
 */
export class SammlungFormFehler extends Error {
  /** @param {string} entity collection @param {string} form JS type found instead of a list */
  constructor(entity, form) {
    super(`Sammlung ${entity} ist keine Liste (gefunden: ${form}) — die Datendatei ist beschädigt, nichts wurde gelesen oder geschrieben`);
    this.name = 'SammlungFormFehler';
    /** HTTP status of the refusal */
    this.status = 500;
    /** the collection concerned */
    this.sammlung = entity;
  }
}

/**
 * Options of create / bulkCreate (B-111-02-01).
 * @typedef {object} AnlageOptionen
 * @property {boolean} [kennungUebernehmen]  keep a non-empty string `id` of the data when it is still free in the collection
 *   (else KennungBelegtFehler); for callers whose references hang on their own ids (import bundle, client-chosen idempotent ids,
 *   recycle-bin restore). Default false: the store generates the id.
 * @property {boolean} [zeitUebernehmen]  keep string `created_date` / `updated_date` of the data (restoring a record as it was);
 *   server-internal only, never reachable from an HTTP query. Default false: both are "now".
 */

/**
 * @param {string} dbPath JSON file of the store
 * @param {{codec?: {encode: (t: string) => string, decode: (t: string) => string, aktiv: boolean}}} [optionen]
 *   codec: at-rest encoding (default: plain JSON)
 */
export function createDb(dbPath, { codec = KLARTEXT_CODEC } = {}) {
  const DB_PATH = dbPath;
  const BAK_PATH = dbPath + '.bak';
  /** @type {string|null} 96-01: why the store refuses to work (undecryptable file), or null */
  let gesperrt = null;
  /** 96-01: a plain (pre-encryption) file was loaded while a codec is active → migrate. */
  let klartextGeladen = false;

  /** @param {string} pfad @returns {any} parsed content; throws on missing/corrupt/undecryptable */
  function lies(pfad) {
    const text = fs.readFileSync(pfad, 'utf-8');
    const json = JSON.parse(codec.decode(text));
    // 124-33: the root must be an object of collections. A list or a primitive is valid JSON but no database — loaded as one,
    // every collection would be missing and the next save would write that list back (new records vanish silently).
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error(`${path.basename(pfad)}: Wurzel ist kein Objekt (keine Datenbank)`);
    }
    if (codec.aktiv && !istVerschluesselt(text)) klartextGeladen = true;
    return json;
  }

  /** 124-33: the main file exists but could not be read, the data came from the backup → the next save must not copy it over the backup. */
  let hauptdateiKaputt = false;

  function readRaw() {
    // Hauptdatei lesen; bei korruptem JSON auf das letzte Backup zurückfallen.
    let fehler = null;
    try {
      return lies(DB_PATH);
    } catch (e) {
      fehler = e;
      try {
        const fromBak = lies(BAK_PATH);
        console.warn('[db] db.json unlesbar — Backup db.json.bak geladen');
        hauptdateiKaputt = fs.existsSync(DB_PATH);
        return fromBak;
      } catch (e2) {
        // 96-01: a decryption failure is not "no data" — lock instead of starting empty.
        const entschluesselung = [fehler, e2].find((x) => /Entschlüsseln|beschädigt/.test(String(x?.message)));
        if (entschluesselung) {
          gesperrt = `${DB_PATH}: ${entschluesselung.message}`;
          console.error(`[db] GESPERRT — ${gesperrt} Es wird nichts geschrieben.`);
        } else if (fs.existsSync(DB_PATH) || fs.existsSync(BAK_PATH)) {
          // 124-33: files are there but neither is a database. That is not a first start: starting empty and saving would
          // overwrite whatever could still be repaired by hand. Lock like an undecryptable file; nothing is written.
          gesperrt = `${DB_PATH}: weder db.json noch db.json.bak ist lesbar (${String(fehler?.message || fehler)})`;
          console.error(`[db] GESPERRT — ${gesperrt} Es wird nichts geschrieben.`);
        }
        return {};
      }
    }
  }

  let cache = readRaw();

  // --- Schreibpfad (Phase 33 / W0, T-33-03) ---------------------------------
  // `persistNow()` ist der alte `persist()`: Backup + atomar ersetzen.
  // `schedulePersist()` bündelt Schreibvorgänge über ein kurzes Debounce-Fenster.
  // Grund: `create()` rief nach JEDEM Datensatz `persist()` mit vollem
  // copyFileSync + writeFileSync — bei ~7.400 Creates ist das O(n²).
  const PERSIST_DEBOUNCE_MS = 120;
  let persistTimer = null;
  let persistPending = false;

  /** 124-40: below this size (bytes) the main file is looked at before it replaces the backup; a real database is larger. */
  const KLEIN_BYTE = 4096;

  /**
   * 124-40: an EMPTY main file (no record in any collection) must not replace a backup that still holds records. That
   * state does not come from normal use (the backup is always the previous save) but from a file emptied outside the app
   * — a sync tool, a failed restore. Before the usual copy the full backup is kept aside as `db.json.bak.vor-leer`
   * (numbered when that name is taken); nothing is deleted. Only stats are read unless the main file is tiny, so the
   * check costs nothing on a normal save. Best effort: an unreadable file means "do not interfere".
   */
  function volleSicherungAufheben() {
    try {
      const haupt = fs.statSync(DB_PATH).size;
      if (haupt > KLEIN_BYTE || fs.statSync(BAK_PATH).size <= haupt) return;
      /** @param {string} pfad @returns {number} records over all collections of that file */
      const saetze = (pfad) => {
        const j = JSON.parse(codec.decode(fs.readFileSync(pfad, 'utf-8')));
        if (j === null || typeof j !== 'object' || Array.isArray(j)) return 0;
        return Object.values(j).reduce((n, c) => n + (Array.isArray(c) ? c.length : 0), 0);
      };
      if (saetze(DB_PATH) > 0 || saetze(BAK_PATH) === 0) return;
      let ziel = BAK_PATH + '.vor-leer';
      for (let i = 2; fs.existsSync(ziel); i += 1) ziel = `${BAK_PATH}.vor-leer-${i}`;
      fs.copyFileSync(BAK_PATH, ziel);
      console.warn(`[db] db.json ist leer, die Sicherung enthält Daten — Sicherung aufgehoben als ${path.basename(ziel)}`);
    } catch { /* best effort — never block a save */ }
  }

  function persistNow() {
    // Robustes Schreiben: erst Backup der intakten Datei, dann atomar ersetzen.
    // Fehler dürfen den Server nicht abwerfen (Daten bleiben im Speicher erhalten).
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistPending = false;
    if (gesperrt) {
      console.error(`[db] Schreiben verweigert (gesperrt): ${gesperrt}`);
      return;
    }
    try {
      try {
        if (hauptdateiKaputt) {
          // 124-33: the main file is the broken one and the backup is the only good copy — never copy broken over good.
          // The broken file is kept beside the database for a manual look instead of being overwritten.
          if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.kaputt');
        } else if (fs.existsSync(DB_PATH)) {
          volleSicherungAufheben();
          fs.copyFileSync(DB_PATH, BAK_PATH);
        }
      } catch { /* Backup best-effort */ }
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, codec.encode(JSON.stringify(cache, null, 2)), 'utf-8');
      ersetzeAtomar(tmp, DB_PATH); // retries short Windows / sync-tool locks
      hauptdateiKaputt = false; // the main file is whole again; from now on it is backed up as usual
    } catch (e) {
      console.error('[db] Persist fehlgeschlagen (Daten bleiben im Speicher):', e?.message || e);
    }
  }

  function schedulePersist() {
    persistPending = true;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (persistPending) persistNow();
    }, PERSIST_DEBOUNCE_MS);
    // Ein ausstehendes Debounce darf den Prozess nicht offen halten.
    if (typeof persistTimer?.unref === 'function') persistTimer.unref();
  }

  // Beim Beenden nichts verlieren.
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('exit', () => {
      if (persistPending) persistNow();
    });
    // 87-02: Ctrl-C / `concurrently --kill-others` send SIGINT/SIGTERM — on Windows
    // that path did not always reach 'exit', and the 120 ms debounce was lost.
    // Flush, step aside, and re-raise the signal when nobody else handles it, so
    // the default termination still happens (a db must not keep a process alive).
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        if (persistPending) persistNow();
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    }
  }

  // 96-01 migration: a plain file under an active codec is re-written encrypted at
  // once, and a plain .bak is replaced by a copy of the encrypted file (otherwise
  // the previous state would stay readable next to it).
  if (codec.aktiv && !gesperrt) {
    if (klartextGeladen && fs.existsSync(DB_PATH)) persistNow();
    try {
      if (fs.existsSync(BAK_PATH) && fs.existsSync(DB_PATH) && !istVerschluesselt(fs.readFileSync(BAK_PATH, 'utf-8'))) {
        fs.copyFileSync(DB_PATH, BAK_PATH);
      }
    } catch (e) {
      console.error('[db] Backup konnte nicht verschlüsselt werden:', e?.message || e);
    }
  }

  // Bestehende Aufrufer erwarten synchrones Verhalten NICHT — sie erwarten nur,
  // dass geschrieben wird. `persist` bleibt daher der Name im Code unten und
  // zeigt jetzt auf den gebündelten Schreibvorgang.
  const persist = schedulePersist;

  function id() {
    // Compact unique id (timestamp + random), good enough for a local app.
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  /**
   * Builds a new record from caller data (B-111-02-01): the managed fields come from the store unless the options say otherwise.
   * @param {Record<string, any>} data @param {string} now ISO time @param {AnlageOptionen} opt @returns {Record<string, any>}
   */
  function neuerSatz(data, now, opt) {
    const { id: gewuenscht, created_date: erstellt, updated_date: geaendert, ...rest } = data && typeof data === 'object' ? data : {};
    const zeit = opt.zeitUebernehmen === true;
    return {
      id: opt.kennungUebernehmen === true && typeof gewuenscht === 'string' && gewuenscht !== '' ? gewuenscht : id(),
      created_date: zeit && typeof erstellt === 'string' ? erstellt : now,
      updated_date: zeit && typeof geaendert === 'string' ? geaendert : now,
      ...rest,
    };
  }

  /**
   * Refuses (throws) when one of the records would take an id that is taken in the collection or repeated in the batch.
   * @param {string} entity @param {Record<string, any>[]} saetze records built by neuerSatz @param {Record<string, any>[]} col
   */
  function kennungenPruefen(entity, saetze, col) {
    const vergeben = new Set(col.map((r) => r?.id));
    for (const s of saetze) {
      if (vergeben.has(s.id)) throw new KennungBelegtFehler(entity, String(s.id));
      vergeben.add(s.id);
    }
  }

  /**
   * The list of records of a collection; a missing one (also `null`) is created empty.
   * 124-36: a collection that exists but is no list (an object, text, a number — only possible through a file edited or
   * damaged outside the app) is refused with a clear error. It is never replaced by an empty list: that would write the
   * loss to disk with the next save.
   * @param {string} name collection (entity) name @returns {Record<string, any>[]}
   */
  function collection(name) {
    if (cache[name] == null) {
      cache[name] = [];
      persist();
    } else if (!Array.isArray(cache[name])) {
      throw new SammlungFormFehler(name, typeof cache[name]);
    }
    return cache[name];
  }

  // Order helper: accepts a bitApi-style sort string like "-created_date" or "name".
  function sortRecords(records, sortStr) {
    if (!sortStr) return records;
    const desc = sortStr.startsWith('-');
    const field = desc ? sortStr.slice(1) : sortStr;
    return [...records].sort((a, b) => {
      const av = a?.[field];
      const bv = b?.[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
      return 0;
    });
  }

  function matchesQuery(record, query) {
    // Tolerant equality, same rule as demoDb.filter (57-02): URL queries via
    // req.query ALWAYS arrive as strings, so strict === found nothing for
    // number/boolean fields (e.g. ?aktiv=true never matched aktiv:true). The
    // strict check stays first so identical JS values short-circuit; the
    // String() fallback makes express, demo and PostgREST (data->>k text
    // comparison) agree — measured by the parity test in abfrage.test.js.
    return Object.entries(query).every(
      ([k, v]) => record?.[k] === v || String(record?.[k]) === String(v)
    );
  }

  return {
    list(entity, sort) {
      return sortRecords(collection(entity), sort);
    },

    filter(entity, query = {}, sort) {
      const filtered = collection(entity).filter((r) => matchesQuery(r, query));
      return sortRecords(filtered, sort);
    },

    get(entity, recordId) {
      return collection(entity).find((r) => r?.id === recordId) || null;
    },

    /**
     * Creates one record. B-111-02-01: `id`, `created_date`, `updated_date` of `data` are ignored - the store sets them - unless
     * `opt` names the explicit path (see AnlageOptionen).
     * @param {string} entity @param {Record<string, any>} data @param {AnlageOptionen} [opt]
     * @returns {Record<string, any>} the stored record
     * @throws {KennungBelegtFehler} explicit id path and the id is taken (nothing written)
     */
    create(entity, data, opt = {}) {
      const now = new Date().toISOString();
      const record = neuerSatz(data, now, opt);
      const col = collection(entity);
      if (opt.kennungUebernehmen === true) kennungenPruefen(entity, [record], col);
      col.push(record);
      persist();
      return record;
    },

    // Viele Datensätze, GENAU EIN Schreibvorgang (G19). API-kompatibel additiv.
    // B-111-02-01: same rule as create(); on the explicit id path the WHOLE batch is checked first and refused as a whole.
    /** @param {string} entity @param {Record<string, any>[]} records @param {AnlageOptionen} [opt] @returns {Record<string, any>[]} */
    bulkCreate(entity, records, opt = {}) {
      const liste = Array.isArray(records) ? records : [];
      const col = collection(entity);
      const now = new Date().toISOString();
      const angelegt = liste.map((data) => neuerSatz(data, now, opt));
      if (opt.kennungUebernehmen === true) kennungenPruefen(entity, angelegt, col);
      col.push(...angelegt);
      // Ein einziger Schreibvorgang am Ende — nicht einer je Datensatz.
      persistNow();
      return angelegt;
    },

    // Vorhandene aktualisieren, neue anlegen — ein Schreibvorgang.
    bulkUpsert(entity, records, key = 'id') {
      const liste = Array.isArray(records) ? records : [];
      const col = collection(entity);
      const now = new Date().toISOString();
      const index = new Map();
      col.forEach((r, i) => {
        if (r?.[key] !== undefined) index.set(r[key], i);
      });
      let updated = 0;
      const created = [];
      for (const data of liste) {
        const k = data?.[key];
        const pos = k !== undefined ? index.get(k) : undefined;
        if (pos !== undefined) {
          col[pos] = { ...col[pos], ...data, id: col[pos].id, updated_date: now };
          updated += 1;
        } else {
          // B-111-02-01: a new record keeps its id only when the id IS the key (upsert by id: it was just looked up and is free);
          // with another key a sent id could duplicate an existing record, so the store generates one. Dates: always now.
          const record = neuerSatz(data, now, { kennungUebernehmen: key === 'id' });
          col.push(record);
          if (k !== undefined) index.set(k, col.length - 1);
          created.push(record);
        }
      }
      persistNow();
      return { updated, created };
    },

    // Erzwingt einen ausstehenden Debounce-Write (Tests, Shutdown).
    flush() {
      if (persistPending) persistNow();
      return true;
    },

    update(entity, recordId, data) {
      const col = collection(entity);
      const idx = col.findIndex((r) => r?.id === recordId);
      if (idx === -1) return null;
      col[idx] = {
        ...col[idx],
        ...data,
        id: recordId,
        updated_date: new Date().toISOString(),
      };
      persist();
      return col[idx];
    },

    remove(entity, recordId) {
      const col = collection(entity);
      const idx = col.findIndex((r) => r?.id === recordId);
      if (idx === -1) return false;
      col.splice(idx, 1);
      persist();
      return true;
    },

    // Replace the whole DB (used by the seeder). Synchron — der Seeder erwartet,
    // dass die Datei nach dem Aufruf auf der Platte steht.
    _reset(data) {
      cache = data;
      persistNow();
    },

    _raw() {
      return cache;
    },

    /** 96-01: reason the store is locked (undecryptable file), or null. @returns {string|null} */
    gesperrt() {
      return gesperrt;
    },
  };
}
