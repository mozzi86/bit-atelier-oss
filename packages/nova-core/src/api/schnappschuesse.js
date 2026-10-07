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
// Import hygiene: static imports only from modules that never import this one
// (demoIdb, projektDatei). demoDb is imported dynamically inside the
// functions — demoDb hooks schnappschussAnlegen into its destructive calls,
// and a static circle would violate the repo's no-import-cycle rule.
//
// Adapter injectable like demoDb's — unit tests run without a browser.

import { demoIdb, SCHNAPP_STORE } from './demoIdb.js';
import { serialisiereProjekt } from './projektDatei.js';

/** How many snapshots the ring keeps (plan 69-13 must-have: the last five). */
export const RING_GROESSE = 5;

/** Re-export so callers (SpeicherStatus) can name the store without a second import site. */
export { SCHNAPP_STORE };

/** @type {typeof demoIdb} */
let adapter = demoIdb;

// Date.now() has millisecond resolution — two snapshots in the same tick
// would tie and make the newest-first sort ambiguous (which one the ring
// drops becomes luck). Keep the timestamp strictly monotonic per session.
let letzteZeit = 0;
/** @returns {number} timestamp strictly greater than the previous one */
function zeitStempel() {
  const jetzt = Date.now();
  letzteZeit = jetzt > letzteZeit ? jetzt : letzteZeit + 1;
  return letzteZeit;
}

/**
 * Replaces the storage adapter — for unit tests (no browser). Production code
 * never calls this.
 * @param {typeof demoIdb} neuerAdapter
 */
export function setzeSchnappschussSpeicher(neuerAdapter) {
  adapter = neuerAdapter;
}

/**
 * @typedef {{id: string, zeit: number, grund: string, datensaetze: number, projekt: object}} Schnappschuss
 * One ring entry. `projekt` is a serialisiereProjekt() object (schema 1).
 */

/**
 * All snapshots, newest first.
 * @returns {Promise<Schnappschuss[]>}
 */
export async function schnappschuesseListe() {
  const alle = (await adapter.alle(SCHNAPP_STORE)) || [];
  return alle.sort((a, b) => b.zeit - a.zeit);
}

/** Total record count across all collections (for the entry's `datensaetze`). */
function zaehleDatensaetze(daten) {
  let n = 0;
  for (const rows of Object.values(daten || {})) if (Array.isArray(rows)) n += rows.length;
  return n;
}

/**
 * Takes a snapshot of the CURRENT state and trims the ring to the five
 * newest entries. On a full quota the oldest snapshot is sacrificed first
 * (least valuable) and the write retried once; if it still fails the error is
 * thrown IN PLAIN TEXT — a snapshot that silently did not happen would be
 * worse than none (65-02 lesson).
 * @param {string} grund why the snapshot was taken, e.g. "vor Reset" — shown in the list
 * @returns {Promise<{id: string, zeit: number, grund: string, datensaetze: number}>} the new entry's head (without `projekt`)
 */
export async function schnappschussAnlegen(grund) {
  const { demoDbAuslesen } = await import('./demoDb.js');
  const daten = await demoDbAuslesen();
  const eintrag = {
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    zeit: zeitStempel(),
    grund: String(grund || 'Schnappschuss'),
    datensaetze: zaehleDatensaetze(daten),
    projekt: serialisiereProjekt(daten, `Schnappschuss ${String(grund || '')}`.trim()),
  };

  try {
    await adapter.schreiben(SCHNAPP_STORE, eintrag);
  } catch (err) {
    if (err?.name !== 'SpeicherVollError') throw err;
    // Quota: sacrifice the oldest snapshot and retry once. If even that
    // fails, say so in plain text — the caller decides how to continue.
    const liste = await schnappschuesseListe();
    const aelteste = liste[liste.length - 1];
    if (aelteste) await adapter.loeschen(SCHNAPP_STORE, aelteste.id);
    try {
      await adapter.schreiben(SCHNAPP_STORE, eintrag);
    } catch (err2) {
      if (err2?.name === 'SpeicherVollError') {
        throw new Error(
          'Speicher voll — der Schnappschuss konnte nicht angelegt werden. ' +
          'Bitte Daten als Datei exportieren oder ältere Schnappschüsse löschen.',
        );
      }
      throw err2;
    }
  }

  // Ring: drop everything beyond the five newest (after the successful write,
  // so a failure never deletes history it did not replace).
  const liste = await schnappschuesseListe();
  for (const alt of liste.slice(RING_GROESSE)) {
    await adapter.loeschen(SCHNAPP_STORE, alt.id);
  }

  const { projekt: _projekt, ...kopf } = eintrag;
  return kopf;
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
  const { demoDbErsetzen } = await import('./demoDb.js');
  await demoDbErsetzen(ziel.projekt?.daten || {}, null);

  const { projekt: _projekt, ...kopf } = ziel;
  return { wiederhergestellt: kopf, sicherungsId: sicherung.id };
}
