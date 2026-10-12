// Phase 81: read access of time tracking and controlling to the personnel
// storage class of phase 80 — and the cost rates (Kostensatz), which are derived
// from salaries and therefore live in that class too (E-14). The ONLY phase-81
// module that names the personnel API: it sits in the folder the 80-02 leak
// guard allows (src/lib/people/**), like the helpers of 80-10. It writes no audit
// log and sends nothing anywhere.
//
// Every call checks personalZugang first: without 'erlaubt' (cloud build →
// 'nur-lokal', a role without access → 'keine-berechtigung') it returns empty
// lists WITHOUT touching the API, so a page never throws because of missing
// access. A failing personnel API is reported in `fehler` (plain text), not
// swallowed and not thrown into the UI.
//
// In:  {datenquelle, rolle} of the signed-in user; optionally an injected api
//      (unit tests). Out: lists of 80 records and cost rates; write helpers for
//      the cost rate tab (81-05). (No sample-data helpers: the browser demo and
//      its seeds were removed in 83-02.)

import { bitApi } from "@core/api/bitApi";
import { personalZugang } from "./zugang.js";

/**
 * Lists the time tracking needs from phase 80.
 * @typedef {{
 *   zugang: 'erlaubt'|'nur-lokal'|'keine-berechtigung',
 *   mitarbeiter: Array<Record<string, any>>,
 *   vertraege: Array<Record<string, any>>,
 *   gehaelter: Array<Record<string, any>>,
 *   kostensaetze: Array<Record<string, any>>,
 *   fehler: string|null,
 * }} PersonalFuerZeit
 */

/**
 * The personnel entity clients (bitApi.personal is typed loosely for tsc).
 * @param {any} [api] injected api (tests); default bitApi
 * @returns {any}
 */
function personal(api) {
  return (api ?? bitApi).personal;
}

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Persons, contracts, salaries and cost rates — or empty lists without access.
 * @param {{datenquelle?: string, rolle?: string|null}} kontext data path and role (personalZugang)
 * @param {{api?: any}} [optionen] api: injectable fake with the shape of bitApi (tests)
 * @returns {Promise<PersonalFuerZeit>}
 */
export async function ladePersonalFuerZeit({ datenquelle, rolle } = {}, { api } = {}) {
  const zugang = personalZugang({ datenquelle, rolle });
  const leer = { zugang, mitarbeiter: [], vertraege: [], gehaelter: [], kostensaetze: [], fehler: null };
  if (zugang !== "erlaubt") return leer;
  try {
    const p = personal(api);
    const [mitarbeiter, vertraege, gehaelter, kostensaetze] = await Promise.all([
      p.Mitarbeiter.list(), p.Arbeitsvertrag.list(), p.Gehaltsaenderung.list(), p.Kostensatz.list(),
    ]);
    // Copies: the local store may hand out its live cache arrays.
    const kopie = (/** @type {any} */ x) => (Array.isArray(x) ? [...x] : []);
    return { zugang, mitarbeiter: kopie(mitarbeiter), vertraege: kopie(vertraege), gehaelter: kopie(gehaelter), kostensaetze: kopie(kostensaetze), fehler: null };
  } catch (fehler) {
    console.error("[Zeit & Honorar] Personaldaten nicht lesbar:", fehler);
    return { ...leer, zugang: "nur-lokal", fehler: `Personaldaten konnten nicht gelesen werden: ${text(fehler)}` };
  }
}

/**
 * Saves one cost rate (get → update | create, never a duplicate).
 * @param {Record<string, any>} obj Kostensatz with or without id
 * @param {{api?: any}} [optionen]
 * @returns {Promise<Record<string, any>>} the stored record
 * @throws {Error} plain text when the personnel storage refuses
 */
export async function speichereKostensatz(obj, { api } = {}) {
  const c = personal(api).Kostensatz;
  let alt = null;
  if (obj?.id) {
    try { alt = await c.get(obj.id); } catch { alt = null; } // 404 / not found
  }
  try {
    if (alt) {
      const { id, ...rest } = obj;
      return await c.update(id, rest);
    }
    return await c.create(obj);
  } catch (fehler) {
    throw new Error(`Kostensatz konnte nicht gespeichert werden: ${text(fehler)}`);
  }
}

/**
 * Deletes one cost rate.
 * @param {string} id
 * @param {{api?: any}} [optionen]
 * @returns {Promise<void>}
 * @throws {Error} plain text
 */
export async function loescheKostensatz(id, { api } = {}) {
  try {
    await personal(api).Kostensatz.delete(id);
  } catch (fehler) {
    throw new Error(`Kostensatz konnte nicht gelöscht werden: ${text(fehler)}`);
  }
}
