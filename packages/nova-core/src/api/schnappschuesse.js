// schnappschuesse.js — snapshot ring for the serverless builds (Phase 69-13).
//
// Why: three destructive actions (demo reset, project import, restore) had no
// way back — the only undo lived in two designers. Whoever spent an hour on a
// demo project clicks carefully afterwards, and careful visitors try little
// (finding ID-09). Now every destructive step automatically takes a snapshot
// of the previous state first; the five most recent survive (a ring).
//
// One format for export AND snapshot: entries carry `projekt` exactly as
// serialisiereProjekt() builds it (projektDatei.js, schema 1), so a snapshot
// is a .bitproj file waiting to happen and parseProjektDatei() accepts it —
// proven by the round-trip test.
//
// Storage: the snapshots live in their own object store (SCHNAPP_STORE) of
// the SAME IndexedDB. demoIdb.entities() excludes that store like `_meta`, so
// snapshots never enter the project cache/export (a snapshot contains the
// whole project — exporting it inside the project would nest recursively) and
// reset/import never empty it. The store is created on demand by demoIdb's
// transaction helper (additive schema bump, no migration).
//
// meta.letzteSicherung is NOT touched here (plan 69-13 context): only the
// real file export (69-07) may claim "saved to a file".
//
// Import hygiene (112-01): the ring itself (store, list, writing an entry) lives in schnappschussRing.js, which never imports
// demoDb — so demoDb can import it statically. This module adds the two calls that need the current database
// (schnappschussAnlegen reads it, schnappschussWiederherstellen replaces it) and imports demoDb statically; nothing imports
// this module from demoDb any more, so there is no cycle and no dynamic import left between the two.
//
// In:  the current demo database (demoDb). Out: the public snapshot API (same names as before 112-01).

import { demoDbAuslesen, demoDbErsetzen } from './demoDb.js';
import { schnappschussAusDaten, schnappschuesseListe } from './schnappschussRing.js';

export { RING_GROESSE, SCHNAPP_STORE, setzeSchnappschussSpeicher, schnappschuesseListe } from './schnappschussRing.js';

/**
 * Takes a snapshot of the CURRENT state and trims the ring to the five newest entries (schnappschussAusDaten: on a full
 * quota the oldest snapshot is sacrificed and the write retried once, else a plain-text error).
 * @param {string} grund why the snapshot was taken, e.g. "vor Reset" — shown in the list
 * @returns {Promise<{id: string, zeit: number, grund: string, datensaetze: number}>} the new entry's head (without `projekt`)
 */
export async function schnappschussAnlegen(grund) {
  return schnappschussAusDaten(grund, await demoDbAuslesen());
}

/**
 * Restores one snapshot: FIRST snapshots the current state ("vor
 * Wiederherstellung" — the restore itself is destructive, plan must-have 2),
 * THEN replaces the database with the snapshot's records (without a second
 * snapshot — `grund: null` tells demoDbErsetzen this call is already covered).
 * @param {string} id snapshot id
 * @returns {Promise<{wiederhergestellt: {id: string, zeit: number, grund: string, datensaetze: number}, sicherungsId: string}>}
 * @throws {Error} plain text when the id is unknown
 */
export async function schnappschussWiederherstellen(id) {
  const liste = await schnappschuesseListe();
  const ziel = liste.find((s) => s.id === id);
  if (!ziel) throw new Error(`Schnappschuss „${id}" nicht gefunden — vielleicht vom Ring verdrängt.`);

  const sicherung = await schnappschussAnlegen('vor Wiederherstellung');
  await demoDbErsetzen(ziel.projekt?.daten || {}, null);

  const { projekt: _projekt, ...kopf } = ziel;
  return { wiederhergestellt: kopf, sicherungsId: sicherung.id };
}
