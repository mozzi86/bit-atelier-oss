// Read and write one Setting key as "one row per key" (80-01, D-P80-B), plus the
// React hook that keeps a component in sync with it.
//
// Every write is an upsert (upsertPlan in ./einstellungen.js): update the newest
// row of the key, create one only when there is none. Duplicates are REPORTED —
// returned as `doppelt` and logged — and never deleted: deleting the wrong one
// loses the user's value, and the count is visible in Einstellungen › System.
// A duplicate appears e.g. when a second tab with an outdated demoDb cache
// creates the same key (BEFUNDE-79 N-17: the cache lives per tab in demoDb.js).
//
// Relation to phase 79: useBuchhaltung reads Setting{key:"buchhaltung"} itself
// (speicher.js, first row of the key). The rule registry reaches that row through
// its own adapter (storage kind "setting" in ./regelwerk.js), not through this file.
//
// In:  a Setting client with filter/create/update/delete (default bitApi's).
// Out: leseEinstellung, setzeEinstellung, loescheEinstellung, useEinstellung.
//      Writes fire EINSTELLUNG_EREIGNIS on window with detail {key}.

import { useCallback, useEffect, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { EINSTELLUNG_EREIGNIS, neuesteZeile, upsertPlan } from "./einstellungen.js";

/**
 * Setting client of the API (bitApi.entities is untyped at runtime).
 * @returns {any}
 */
const standardClient = () => /** @type {any} */ (bitApi.entities).Setting;

/**
 * Fires the change event. No-op outside a browser (unit tests without a window
 * stub, SSR) — same guard as melde() in demoDb.js.
 * @param {string} key
 */
function melde(key) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(EINSTELLUNG_EREIGNIS, { detail: { key } }));
}

/**
 * Running write per key. Two writes of the same key from one tab (StrictMode,
 * a double click) must not both see "no row yet" and create two rows.
 * @type {Map<string, Promise<unknown>>}
 */
const laufend = new Map();

/**
 * Runs `arbeit` after every earlier write of the same key has settled.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} arbeit
 * @returns {Promise<T>}
 */
function nacheinander(key, arbeit) {
  const vorher = laufend.get(key) || Promise.resolve();
  const jetzt = vorher.catch(() => {}).then(arbeit);
  laufend.set(key, jetzt);
  const aufraeumen = () => { if (laufend.get(key) === jetzt) laufend.delete(key); };
  jetzt.then(aufraeumen, aufraeumen);
  return jetzt;
}

/**
 * Rows of one key as the client returns them (a copy, never the live cache array).
 * @param {any} client
 * @param {string} key
 * @returns {Promise<any[]>}
 */
async function zeilenVon(client, key) {
  const rows = await client.filter({ key });
  return Array.isArray(rows) ? rows.filter((r) => r && r.key === key) : [];
}

/**
 * Reads the newest row of a key.
 * @param {string} key Setting key
 * @param {any} [client] Setting client (default bitApi.entities.Setting)
 * @returns {Promise<{zeile: any, wert: any, doppelt: number}>} `wert` = zeile.value or undefined
 * @throws {Error} whatever the data layer throws (not swallowed)
 */
export async function leseEinstellung(key, client = standardClient()) {
  const { zeile, doppelt } = neuesteZeile(await zeilenVon(client, key));
  return { zeile, wert: zeile ? zeile.value : undefined, doppelt };
}

/**
 * Writes the value of a key as an upsert and fires EINSTELLUNG_EREIGNIS.
 * Existing duplicates stay untouched; their number comes back as `doppelt` and a
 * console warning names the key.
 * @param {string} key Setting key
 * @param {any} value the complete value (the data layer merges only the top level
 *   of the record, so a partial object would drop fields)
 * @param {any} [client] Setting client (default bitApi.entities.Setting)
 * @returns {Promise<{zeile: any, doppelt: number}>} the stored row; `doppelt` > 1 when the
 *   key had more than one row before the write
 * @throws {Error} whatever the data layer throws — nothing is reported as saved then
 */
export function setzeEinstellung(key, value, client = standardClient()) {
  return nacheinander(key, async () => {
    const plan = upsertPlan(await zeilenVon(client, key), key);
    const zeile = plan.aktion === "update"
      ? await client.update(plan.id, { key, value })
      : await client.create({ key, value });
    melde(key);
    if (plan.doppelt > 1) {
      console.warn(`Einstellung „${key}“ liegt ${plan.doppelt}-fach vor; die neueste Zeile wurde geschrieben, die übrigen bleiben (Einstellungen › System).`);
    }
    return { zeile, doppelt: plan.doppelt };
  });
}

/**
 * Removes every row of a key ("Zurücksetzen": the default applies again) and fires
 * EINSTELLUNG_EREIGNIS.
 * @param {string} key Setting key
 * @param {any} [client] Setting client (default bitApi.entities.Setting)
 * @returns {Promise<number>} number of rows deleted
 * @throws {Error} whatever the data layer throws
 */
export function loescheEinstellung(key, client = standardClient()) {
  return nacheinander(key, async () => {
    const zeilen = await zeilenVon(client, key);
    for (const z of zeilen) await client.delete(z.id);
    melde(key);
    return zeilen.length;
  });
}

/**
 * One Setting key as React state: loads it, reloads on EINSTELLUNG_EREIGNIS for
 * the same key, and offers a setter that upserts.
 * @param {string} key Setting key
 * @param {any} standard value while nothing is stored (and while loading)
 * @returns {[any, (wert: any) => Promise<{zeile: any, doppelt: number}>, {laden: boolean, doppelt: number, fehler: string|null}]}
 *   value, setter (throws on failure, side effect: write + event), status
 */
export function useEinstellung(key, standard) {
  const [zustand, setZustand] = useState(/** @type {{wert: any, gefunden: boolean, laden: boolean, doppelt: number, fehler: string|null}} */ (
    { wert: undefined, gefunden: false, laden: true, doppelt: 0, fehler: null }
  ));
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    try {
      const { zeile, wert, doppelt } = await leseEinstellung(key);
      if (aktiv.current) setZustand({ wert, gefunden: Boolean(zeile), laden: false, doppelt, fehler: null });
    } catch (fehler) {
      if (aktiv.current) setZustand((z) => ({ ...z, laden: false, fehler: /** @type {any} */ (fehler)?.message || String(fehler) }));
    }
  }, [key]);

  useEffect(() => {
    aktiv.current = true;
    laden();
    /** @param {Event} e */
    const beiAenderung = (e) => { if (/** @type {CustomEvent} */ (e).detail?.key === key) laden(); };
    window.addEventListener(EINSTELLUNG_EREIGNIS, beiAenderung);
    return () => {
      aktiv.current = false;
      window.removeEventListener(EINSTELLUNG_EREIGNIS, beiAenderung);
    };
  }, [key, laden]);

  const setzen = useCallback((wert) => setzeEinstellung(key, wert), [key]);
  const wert = zustand.gefunden ? zustand.wert : standard;
  return [wert, setzen, { laden: zustand.laden, doppelt: zustand.doppelt, fehler: zustand.fehler }];
}
