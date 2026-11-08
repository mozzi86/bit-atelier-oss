// schnappschussRing.js — storage side of the snapshot ring (Phase 69-13), split out of schnappschuesse.js in 112-01.
//
// Why the split: demoDb takes a snapshot before every destructive call, and schnappschuesse reads/replaces demoDb. The two
// imported each other DYNAMICALLY to dodge the no-import-cycle rule — but every caller pulls both into the same chunk, so the
// dynamic imports did nothing and Vite warned "dynamic import will not move module into another chunk" (foreign review
// 08.11.2026, point 2). This module holds everything that needs no demoDb: the store, the ring, the list and writing an entry
// from GIVEN data. demoDb imports it statically; schnappschuesse.js (the public API, unchanged) imports both statically.
//
// One format for export AND snapshot: entries carry `projekt` exactly as serialisiereProjekt() builds it
// (projektDateiFormat.js, schema 1), so a snapshot is a .bitproj file waiting to happen.
// Storage: own object store (SCHNAPP_STORE) of the SAME IndexedDB; demoIdb.entities() excludes it like `_meta`.
//
// Import hygiene: static imports only from modules that never import demoDb (demoIdb, projektDateiFormat).
// Adapter injectable like demoDb's — unit tests run without a browser.
//
// In:  database state (collection → records) from the caller. Out: ring entries in IndexedDB, list, entry heads.

import { demoIdb, SCHNAPP_STORE } from './demoIdb.js';
import { serialisiereProjekt } from './projektDateiFormat.js';

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
 * Stores a snapshot of the given database state and trims the ring to the five
 * newest entries. On a full quota the oldest snapshot is sacrificed first
 * (least valuable) and the write retried once; if it still fails the error is
 * thrown IN PLAIN TEXT — a snapshot that silently did not happen would be
 * worse than none (65-02 lesson).
 * @param {string} grund why the snapshot was taken, e.g. "vor Reset" — shown in the list
 * @param {Record<string, unknown[]>} daten the database state to keep (collection name → records), as demoDbAuslesen() returns it
 * @returns {Promise<{id: string, zeit: number, grund: string, datensaetze: number}>} the new entry's head (without `projekt`)
 */
export async function schnappschussAusDaten(grund, daten) {
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
