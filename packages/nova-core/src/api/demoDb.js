// In-browser database of the serverless build (lokal: PWA and Tauri shell).
// Mirrors the semantics of server/db.js EXACTLY (create adds id/created_date/
// updated_date, update merges flat + updated_date, filter = strict equality,
// sort "-field"/"field") and starts EMPTY. The file name is historical (it began
// as the store of the online demo, removed in 83-02); renaming it would touch
// every import of the shared serverless layer for no behavioural gain.
// Every device keeps its OWN database — there is no server.
//
// Storage (Phase 65-02): the records live in IndexedDB, one object store per
// entity, one row per record — see demoIdb.js for the why. Before that the whole
// database was a single localStorage JSON blob that was rewritten on every
// write and silently failed at the ~5 MB cap. An existing blob is migrated once
// on first start, so nobody loses the state they already had.
//
// In:  entity name + record data, exactly as the Express API takes it.
// Out: the same records the server would return.
// Side effects: writes to IndexedDB and fires two window events —
//   "demo:gespeichert"    { zeit }   after every successful write
//   "demo:speicher-fehler" { fehler } when a write failed (quota, locked DB)
// A failed write is ALSO re-thrown. The old code swallowed it, which is how the
// UI ended up claiming "saved" while nothing was stored.

import { demoIdb, speicherDauerhaft } from './demoIdb.js';
// 80-02 Task 1: id/sort/filter extracted to sammlungKern.js so the "personal"
// storage class's own module reuses them instead of growing a second copy.
import { neueId as id, sortiereDatensaetze as sortRecords, passtFilter } from './sammlungKern.js';

const STORE_KEY = 'bit-atelier-demo-db-v1'; // legacy localStorage blob, read only to migrate it

/** @type {Record<string, object[]>|null} */
let cache = null;
/** @type {Promise<Record<string, object[]>>|null} */
let ladeVorgang = null;
let adapter = demoIdb;
// A client installation starts empty (70-01): someone's own office must not find
// invented building projects in their list. The sample seed of the online demo
// went with the demo in 83-02. An empty object is safe here: demoIdb creates
// object stores on demand. Unit tests inject their own seed via setzeSpeicher.
/** @type {() => Promise<Record<string, object[]>>} */
let seedLader = async () => ({});
let persistAngefragt = false;

/**
 * Replaces storage and seed — for unit tests, which run without a browser.
 * Production code never calls this. Tests that exercise the snapshot ring
 * (69-13) inject the same adapter there too via
 * schnappschuesse.setzeSchnappschussSpeicher — a forwarding import here would
 * create a static cycle (demoDb → schnappschuesse → projektDatei → demoDb).
 * @param {typeof demoIdb} neuerAdapter
 * @param {() => Promise<Record<string, object[]>>} [neuerSeedLader]
 */
export function setzeSpeicher(neuerAdapter, neuerSeedLader) {
  adapter = neuerAdapter;
  if (neuerSeedLader) seedLader = neuerSeedLader;
  cache = null;
  ladeVorgang = null;
  persistAngefragt = false;
}

/**
 * Fires a window event. No-op outside a browser (unit tests, SSR).
 * @param {string} name
 * @param {object} detail
 */
function melde(name, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Reads the legacy localStorage blob, if one is still there.
 * @returns {Record<string, object[]>|null}
 */
function altstandLesen() {
  try {
    const roh = localStorage.getItem(STORE_KEY);
    return roh ? JSON.parse(roh) : null;
  } catch {
    // Gesperrt (privates Fenster) oder kaputtes JSON — dann gibt es eben keinen
    // Altstand zu retten. Das ist kein Schreibfehler und bleibt still.
    return null;
  }
}

/**
 * Writes every collection of a full database object.
 * @param {Record<string, object[]>} db
 */
async function schreibeAlles(db) {
  for (const [entity, rows] of Object.entries(db)) {
    if (Array.isArray(rows) && rows.length) await adapter.schreibeViele(entity, rows);
  }
}

/**
 * Loads the database into memory: existing IndexedDB content, else a one-time
 * migration of the legacy localStorage blob, else the seed. The order matters —
 * checking the seed first would overwrite a returning visitor's work.
 * @returns {Promise<Record<string, object[]>>}
 */
async function laden() {
  if (cache) return cache;
  if (ladeVorgang) return ladeVorgang;

  ladeVorgang = (async () => {
    const vorhandene = await adapter.entities();
    if (vorhandene.length) {
      /** @type {Record<string, object[]>} */
      const db = {};
      for (const entity of vorhandene) db[entity] = await adapter.alle(entity);
      cache = db;
      return cache;
    }

    const alt = altstandLesen();
    if (alt && typeof alt === 'object') {
      cache = alt;
      await schreibeAlles(cache);
      await adapter.meta('migriert_von', 'localStorage-v1');
      // Erst NACH dem erfolgreichen Schreiben löschen — bricht die Migration ab,
      // ist der Altstand beim nächsten Start noch da.
      try {
        localStorage.removeItem(STORE_KEY);
      } catch {
        /* gesperrt — der Altstand bleibt liegen, schadet aber nicht */
      }
      return cache;
    }

    cache = structuredClone(await seedLader());
    await schreibeAlles(cache);
    await adapter.meta('schema', 1);
    return cache;
  })();

  try {
    return await ladeVorgang;
  } finally {
    ladeVorgang = null;
  }
}

/**
 * Runs one write against the adapter, reports the outcome and re-throws on
 * failure. Every mutating call in this module goes through here so that
 * "saved" in the UI can only ever mean a write that actually landed.
 * @template T
 * @param {() => Promise<T>} arbeit
 * @returns {Promise<T>}
 */
async function schreibe(arbeit) {
  try {
    const ergebnis = await arbeit();
    melde('demo:gespeichert', { zeit: Date.now() });
    if (!persistAngefragt) {
      persistAngefragt = true;
      // Best effort, absichtlich nicht abgewartet: das Ergebnis ändert nichts am
      // Schreibvorgang, und ein "denied" ist kein Fehler.
      speicherDauerhaft().then((ok) => adapter.meta('persist', ok)).catch(() => {});
    }
    return ergebnis;
  } catch (fehler) {
    melde('demo:speicher-fehler', { fehler });
    throw fehler;
  }
}

async function collection(name) {
  const db = await laden();
  if (!db[name]) db[name] = [];
  return db[name];
}

export const demoDb = {
  async list(entity, sort) {
    return sortRecords(await collection(entity), sort);
  },
  async filter(entity, query = {}, sort) {
    // Tolerante Gleichheit: siehe passtFilter (sammlungKern.js) — dieselbe
    // Regel wie matchesQuery in server/db.js und PostgREST data->>k.
    const rows = (await collection(entity)).filter((r) => passtFilter(r, query));
    return sortRecords(rows, sort);
  },
  async get(entity, recordId) {
    return (await collection(entity)).find((r) => r.id === recordId) || null;
  },
  async create(entity, data) {
    const now = new Date().toISOString();
    const record = { id: id(), created_date: now, updated_date: now, ...data };
    const col = await collection(entity);
    col.push(record);
    await schreibe(() => adapter.schreiben(entity, record));
    return record;
  },
  async update(entity, recordId, data) {
    const col = await collection(entity);
    const idx = col.findIndex((r) => r.id === recordId);
    if (idx === -1) return null;
    col[idx] = { ...col[idx], ...data, id: recordId, updated_date: new Date().toISOString() };
    await schreibe(() => adapter.schreiben(entity, col[idx]));
    return col[idx];
  },
  async remove(entity, recordId) {
    const col = await collection(entity);
    const idx = col.findIndex((r) => r.id === recordId);
    if (idx === -1) return false;
    col.splice(idx, 1);
    await schreibe(() => adapter.loeschen(entity, recordId));
    return true;
  },
};

/**
 * Everything currently stored, as one plain object — the source for the project
 * file export (projektDatei.js).
 * @returns {Promise<Record<string, object[]>>}
 */
export async function demoDbAuslesen() {
  return structuredClone(await laden());
}

/**
 * Replaces the whole database (project import, demo reset).
 *
 * 69-13: a destructive step never runs without a way back — the FIRST thing
 * this does is snapshot the current state (own object store, survives the
 * replacement because demoIdb.entities() hides it). `grund: null` skips the
 * snapshot for callers that already took one (schnappschussWiederherstellen).
 * A FAILED snapshot (quota) does NOT abort the replacement — the destructive
 * action the user confirmed still runs — but the failure is returned so the
 * dialog can say so honestly.
 *
 * 79-12 (E-07): `behalte`/`behalteSettingKeys` name collections (resp. Setting
 * rows) to keep from the CURRENT local state when `db` has no key for them —
 * a project file that left an office area unchecked, or an old file from
 * before Phase 79, must not delete that area's local data. Setting is one
 * shared collection across areas (rows told apart by `key`), so it needs the
 * separate row-level merge; a whole collection either is or is not a key of
 * `db` (byte-compatible when both lists are empty, the default).
 * @param {Record<string, object[]>} db
 * @param {string|null} [grund] snapshot reason; null = caller already snapshotted
 * @param {{behalte?: string[], behalteSettingKeys?: string[]}} [optionen]
 * @returns {Promise<{schnappschuss: object|null, schnappschussFehler: string|null}>}
 */
export async function demoDbErsetzen(db, grund = 'vor Import', { behalte = [], behalteSettingKeys = [] } = {}) {
  let schnappschuss = null;
  let schnappschussFehler = null;
  if (grund != null) {
    try {
      // Dynamic import: schnappschuesse.js reads demoDbAuslesen from this
      // module — a static circle would violate the no-import-cycle rule.
      const { schnappschussAnlegen } = await import('./schnappschuesse.js');
      schnappschuss = await schnappschussAnlegen(grund);
    } catch (err) {
      schnappschussFehler = err?.message || String(err);
    }
  }
  let neu = db;
  if (behalte.length || behalteSettingKeys.length) {
    const vorher = await demoDbAuslesen(); // isolated copy, safe to read after the snapshot above
    neu = { ...db };
    for (const entity of behalte) {
      if (!Object.prototype.hasOwnProperty.call(db, entity) && vorher[entity]) neu[entity] = vorher[entity];
    }
    if (behalteSettingKeys.length) {
      const alteZeilen = (vorher.Setting || []).filter((r) => behalteSettingKeys.includes(r?.key));
      if (alteZeilen.length) {
        const neueZeilen = (neu.Setting || []).filter((r) => !behalteSettingKeys.includes(r?.key));
        neu.Setting = [...neueZeilen, ...alteZeilen];
      }
    }
  }
  const bisher = await adapter.entities();
  for (const entity of bisher) await adapter.leeren(entity);
  cache = structuredClone(neu);
  await schreibe(() => schreibeAlles(cache));
  return { schnappschuss, schnappschussFehler };
}

/**
 * Throws the local data away and restores the starting state (empty since
 * 83-02) — after a snapshot of the previous state (69-13, must-have 1).
 * @returns {Promise<{schnappschuss: object|null, schnappschussFehler: string|null}>}
 */
export async function demoDbZuruecksetzen() {
  return demoDbErsetzen(await seedLader(), 'vor Reset');
}

/**
 * Writes meta.letzteSicherung = { zeit, datensaetze } — called by the project
 * file export (projektDatei.exportProjekt) after a successful download. The
 * snapshot ring (69-13) deliberately does NOT set it: only a real file save
 * may claim "saved" (69-07 must-have).
 * @returns {Promise<{zeit: string, datensaetze: number}>} the written value
 */
export async function letzteSicherungSetzen() {
  const daten = await laden();
  let datensaetze = 0;
  for (const rows of Object.values(daten)) if (Array.isArray(rows)) datensaetze += rows.length;
  const wert = { zeit: new Date().toISOString(), datensaetze };
  await adapter.meta('letzteSicherung', wert);
  return wert;
}

/**
 * Reads meta.letzteSicherung.
 * @returns {Promise<{zeit: string, datensaetze: number}|null>}
 */
export async function letzteSicherungLesen() {
  const wert = /** @type {any} */ (await adapter.meta('letzteSicherung'));
  return wert && typeof wert === 'object' && typeof wert.datensaetze === 'number'
    ? /** @type {{zeit: string, datensaetze: number}} */ (wert)
    : null;
}

/** Thresholds for the backup nudge (69-07) — record counts, NOT time. */
export const SICHERUNG_MIN_DATENSAETZE = 20;
export const SICHERUNG_DELTA = 50;

/**
 * Pure rule behind the backup nudge (69-07, P-08):
 * a visitor with meaningful content (>= 20 records) who has never saved a
 * .bitproj, or whose record count grew by >= 50 since the last save, is due.
 * Counts, not time: a demo visit lasts minutes, but the work in it can be an
 * hour — and a week without changes needs no nagging. [ASSUMED thresholds:
 * 20 ≈ the seed alone already passes, so the demo shows the nudge from the
 * first visit; 50 ≈ a visitor who built half a project since the last save.]
 * @param {{zeit: string, datensaetze: number}|null} letzteSicherung meta value or null
 * @param {number} anzahlAktuell current total record count
 * @returns {boolean} true when the nudge bar should show
 */
export function sicherungFaellig(letzteSicherung, anzahlAktuell) {
  const n = Number(anzahlAktuell) || 0;
  if (n < SICHERUNG_MIN_DATENSAETZE) return false;
  if (!letzteSicherung || typeof letzteSicherung.datensaetze !== 'number') return true;
  return n - letzteSicherung.datensaetze >= SICHERUNG_DELTA;
}

/**
 * The one user of a serverless installation — there is no login on the device.
 * The id stays 'demo-user-1' on purpose: records written before 83-02 may carry
 * it as author, and store fields are never renamed (project rule). Name and
 * e-mail are empty since 83-02 (they used to read "Demo-Gast" /
 * demo@bit-atelier.de), so the UI shows its own "Lokaler Nutzer" label.
 * @returns {{id: string, full_name: string, email: string, role: 'admin'}}
 */
export function demoUser() {
  return {
    id: 'demo-user-1',
    full_name: '',
    email: '',
    role: 'admin',
  };
}
