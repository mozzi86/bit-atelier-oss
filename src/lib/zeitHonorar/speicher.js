// Storage of phase 81 (time, fees, controlling): EVERY read and write of 81 data
// goes through here — the three pages, the progress chip in AktivesProjekt.jsx
// (81-05) and the delete guard of Projects.jsx (81-06) alike (E-03).
//
// Cloud lock (E-03, relaxed by E-20 on 28.09.2026): the Supabase `records` table
// has no entity allowlist until phase 74. The office modules may run in the cloud
// as long as the owner is the organisation's only member (BUERO_CLOUD_FREIGABE in
// umgebung.js — the same switch the accounting reads). Without that release this
// module refuses to read and to write BEFORE touching the API.
//
// Writes go through 79's speichere (get → update | create, retry when IndexedDB
// refuses a version upgrade as "blocked", BEFUNDE-79 H-4), so a second tab never
// duplicates a record. 79's Honorarvertrag gets special treatment:
//  - an EXISTING contract receives only the phase-81 fields
//    (HONORARVERTRAG_81_FELDER) and the `beauftragt` flags of `lph[]` — 79's
//    `update` merges the top level only, so `lph` is written whole: the stored
//    array with the new flags, its percentages unchanged;
//  - a NEW contract is created in full (flat 79 fields + 81 fields), but only
//    from an accepted fee offer (`angebot_id`, 81-04) — otherwise a contract
//    would appear past 79's own form.
// HoaiPlan and Ausgangsrechnung are read here, never written.
//
// In:  `api` = bitApi (injected, so node tests pass a fake). Out: plain data or
//      plain-text errors (thrown), never a swallowed failure.

import { BUERO_CLOUD_FREIGABE, DATENQUELLE } from "@core/lib/umgebung.js";
import { speichere } from "@/lib/accounting/speicher.js";
import { HONORARVERTRAG_81_FELDER, ZEIT_HONORAR_ENTITAETEN, ZEIT_HONORAR_LESEND } from "./entitaeten.js";

/** Plain-text refusal in the cloud build without release (E-03). */
export const CLOUD_GESPERRT_ZH = "Zeiten und Honorare bleiben lokal — in der Cloud-Fassung gesperrt bis Phase 74.";

/** Plain-text refusal for a contract that does not come from a fee offer. */
export const VERTRAG_OHNE_ANGEBOT = "Honorarverträge ohne Honorarangebot legt die Buchhaltung an (79).";

/** Data path the lock checks. Only tests change it (setzeDatenquelle). */
let aktiveDatenquelle = DATENQUELLE;
/** Cloud release the lock checks (E-20). Only tests change it. */
let aktiveFreigabe = BUERO_CLOUD_FREIGABE;

/**
 * Replaces the data path and the cloud release the lock checks — unit tests only.
 * @param {string} quelle 'serverlos' | 'express' | 'supabase'
 * @param {boolean} [freigabe] E-20 switch (default: unchanged)
 */
export function setzeDatenquelleZH(quelle, freigabe) {
  aktiveDatenquelle = quelle;
  if (typeof freigabe === "boolean") aktiveFreigabe = freigabe;
}

/**
 * Whether time and fee data may be read and written on a data path: false for
 * 'supabase' unless the cloud release E-20 is on, true otherwise (same rule as
 * 79's accounting, src/lib/accounting/speicher.js).
 * @param {string} datenquelle 'serverlos' | 'express' | 'supabase'
 * @param {boolean} [cloudFreigabe] E-20 switch; defaults to BUERO_CLOUD_FREIGABE
 * @returns {boolean}
 */
export function verfuegbar(datenquelle, cloudFreigabe = BUERO_CLOUD_FREIGABE) {
  return datenquelle !== "supabase" || cloudFreigabe === true;
}

/** @throws {Error} CLOUD_GESPERRT_ZH on a locked path */
function sperreFalls() {
  if (!verfuegbar(aktiveDatenquelle, aktiveFreigabe)) throw new Error(CLOUD_GESPERRT_ZH);
}

/** Every entity this module reads. */
const LESBAR = new Set([...ZEIT_HONORAR_ENTITAETEN, ...ZEIT_HONORAR_LESEND]);

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Entity client of the API (bitApi.entities is typed as {} for tsc).
 * @param {any} api
 * @param {string} entitaet
 * @returns {any}
 */
function client(api, entitaet) {
  const c = api?.entities?.[entitaet];
  if (!c) throw new Error(`Speicher: keine Schnittstelle für „${entitaet}“.`);
  return c;
}

/**
 * Loads the requested collections (all 81 collections plus the read-only 79
 * ones by default). With a filter (equality only, e.g. {project_id}) each list
 * is filtered by the API.
 * @param {any} api bitApi or a fake
 * @param {{entitaeten?: ReadonlyArray<string>, filter?: Record<string, any>|null}} [optionen]
 * @returns {Promise<Record<string, any[]>>} copies of the lists per entity name
 * @throws {Error} plain text: cloud lock, unknown entity, read failure
 */
export async function ladeZeitHonorar(api, { entitaeten = [...ZEIT_HONORAR_ENTITAETEN, ...ZEIT_HONORAR_LESEND], filter = null } = {}) {
  sperreFalls();
  for (const e of entitaeten) if (!LESBAR.has(e)) throw new Error(`„${e}“ gehört nicht zu Zeit & Honorar.`);
  try {
    const listen = await Promise.all(entitaeten.map((e) => (filter ? client(api, e).filter(filter) : client(api, e).list())));
    /** @type {Record<string, any[]>} */
    const daten = {};
    // Copies: demoDb.list() hands out its live cache array.
    entitaeten.forEach((e, i) => { daten[e] = Array.isArray(listen[i]) ? [...listen[i]] : []; });
    return daten;
  } catch (fehler) {
    throw new Error(`Zeiten und Honorare konnten nicht geladen werden: ${text(fehler)}`);
  }
}

/**
 * Stored record by id, or null (null or 404 both mean "not there").
 * @param {any} api
 * @param {string} entitaet
 * @param {string} id
 * @returns {Promise<Record<string, any>|null>}
 */
async function holeOderNull(api, entitaet, id) {
  try {
    return (await client(api, entitaet).get(id)) || null;
  } catch (fehler) {
    const f = /** @type {any} */ (fehler);
    if (f?.status === 404 || /\b404\b/.test(String(f?.message ?? ""))) return null;
    throw new Error(`${entitaet} ${id} konnte nicht gelesen werden: ${text(fehler)}`);
  }
}

/**
 * Patch of an existing contract: the phase-81 fields of `obj` and the
 * `beauftragt` flags of its `lph` laid over the stored `lph` (percentages stay).
 * @param {Record<string, any>} alt stored Honorarvertrag
 * @param {Record<string, any>} obj incoming record
 * @returns {Record<string, any>} {id, …81 fields, lph?}
 */
export function vertragsPatch81(alt, obj) {
  /** @type {Record<string, any>} */
  const patch = { id: alt.id };
  for (const feld of HONORARVERTRAG_81_FELDER) if (feld in obj) patch[feld] = obj[feld];
  if (Array.isArray(obj.lph) && Array.isArray(alt.lph)) {
    patch.lph = alt.lph.map((l, i) => {
      const neu = obj.lph[i];
      return { ...l, beauftragt: typeof neu?.beauftragt === "boolean" ? neu.beauftragt : l?.beauftragt === true };
    });
  }
  return patch;
}

/**
 * Saves one record of phase 81.
 * - Zeitbuchung, Arbeitszeit, Honorarangebot, Honorarnachtrag: get → update | create.
 * - Honorarvertrag: patch of the 81 fields (existing) or full create from an offer (new).
 * - anything else (HoaiPlan, Ausgangsrechnung, …): refused, read-only here.
 * @param {any} api
 * @param {string} entitaet
 * @param {Record<string, any>} obj
 * @returns {Promise<Record<string, any>>} the stored record
 * @throws {Error} plain text
 */
export async function speichereZH(api, entitaet, obj) {
  sperreFalls();
  if (entitaet === "Honorarvertrag") {
    const alt = obj?.id ? await holeOderNull(api, entitaet, obj.id) : null;
    if (alt) return speichere(api, entitaet, vertragsPatch81(alt, obj));
    if (!obj?.angebot_id) throw new Error(VERTRAG_OHNE_ANGEBOT);
    return speichere(api, entitaet, obj);
  }
  if (!ZEIT_HONORAR_ENTITAETEN.includes(/** @type {any} */ (entitaet))) {
    throw new Error(`„${entitaet}“ wird von Zeit & Honorar nur gelesen, nicht geschrieben.`);
  }
  return speichere(api, entitaet, obj);
}

/**
 * Deletes one record of the four phase-81 collections.
 * @param {any} api
 * @param {string} entitaet
 * @param {string} id
 * @returns {Promise<void>}
 * @throws {Error} plain text (lock, foreign entity, failure)
 */
export async function loescheZH(api, entitaet, id) {
  sperreFalls();
  if (!ZEIT_HONORAR_ENTITAETEN.includes(/** @type {any} */ (entitaet))) {
    throw new Error(`„${entitaet}“ wird von Zeit & Honorar nicht gelöscht.`);
  }
  try {
    await client(api, entitaet).delete(id);
  } catch (fehler) {
    const f = /** @type {any} */ (fehler);
    if (f?.status === 404 || /\b404\b/.test(String(f?.message ?? ""))) return;
    throw new Error(`${entitaet} ${id} konnte nicht gelöscht werden: ${text(fehler)}`);
  }
}
