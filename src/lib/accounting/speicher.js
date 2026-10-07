// Storage of the accounting module per data path (phase 79): one loader for all
// 13 collections plus the office Setting, one writer that never duplicates a
// record, the GoBD guard, the cloud lock and the demo seed.
//
// Cloud lock (E-03): the Supabase `records` table has no entity allowlist until
// phase 74 — every member of an organisation would see drawings, profit shares
// and bank data. So in the Supabase build this module refuses to read and to
// write; the page shows a notice instead of the tabs. Demo, client (IndexedDB)
// and Express work in full.
//
// Why get → update | create: a `create` with an existing id adds a DUPLICATE on
// every path (demoDb pushes, Express appends). `get` answers null (demoDb) or
// throws 404 (Express, bitApi's demo wrapper) — both mean "not there".
//
// In:  `api` = bitApi (injected, so node tests pass a fake). Out: plain data or
//      plain-text errors (thrown), never a swallowed failure.

import { BUERO_CLOUD_FREIGABE, DATENQUELLE } from "@core/lib/umgebung.js";
import { BEISPIEL_EINSTELLUNG_SCHLUESSEL, beispielDatensaetze } from "./beispielDaten.js";
import { BUCHHALTUNG_ENTITAETEN, ENTITAET, SETTING_KEY } from "./datenmodell.js";
import { schreibschutzVerletzt } from "./grundlagen.js";

/** Plain-text refusal in the cloud build (E-03). */
export const CLOUD_GESPERRT = "Die Buchhaltung ist in der Cloud-Version gesperrt, bis die Zugriffsrechte je Organisation fertig sind (Phase 74). Nutzen Sie die lokale Version oder die Demo.";

/** Data path the lock checks. Only tests change it (setzeDatenquelle). */
let aktiveDatenquelle = DATENQUELLE;

/**
 * Replaces the data path the cloud lock checks — for unit tests only;
 * production code never calls this.
 * @param {string} quelle 'serverlos' | 'express' | 'supabase'
 */
export function setzeDatenquelle(quelle) {
  aktiveDatenquelle = quelle;
}

/** Cloud release the lock checks (E-20). Only tests change it (setzeCloudFreigabe). */
let aktiveFreigabe = BUERO_CLOUD_FREIGABE;

/**
 * Replaces the E-20 switch the cloud lock checks — for unit tests only.
 * @param {boolean} freigabe
 */
export function setzeCloudFreigabe(freigabe) {
  aktiveFreigabe = freigabe;
}

/**
 * Whether the accounting module may read and write on a data path. False for
 * 'supabase' (records without allowlist, phase 74 missing) unless the cloud
 * release E-20 is on (sole organisation member, umgebung.js), true otherwise.
 * @param {string} datenquelle 'serverlos' | 'express' | 'supabase'
 * @param {boolean} [cloudFreigabe] E-20 switch; defaults to BUERO_CLOUD_FREIGABE
 * @returns {boolean}
 */
export function verfuegbar(datenquelle, cloudFreigabe = BUERO_CLOUD_FREIGABE) {
  return datenquelle !== "supabase" || cloudFreigabe === true;
}

/** @throws {Error} CLOUD_GESPERRT on the cloud path */
function sperreFalls() {
  if (!verfuegbar(aktiveDatenquelle, aktiveFreigabe)) throw new Error(CLOUD_GESPERRT);
}

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
 * @param {unknown} fehler
 * @returns {boolean} true for "record not found" (Express/bitApi 404)
 */
const istNichtGefunden = (fehler) => /** @type {any} */ (fehler)?.status === 404 || /\b404\b/.test(String(/** @type {any} */ (fehler)?.message ?? ""));

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Runs a write again when the demo storage refused a version upgrade as
 * "blocked". demoIdb rejects an upgrade as soon as an older connection is not
 * fully closed yet — also this tab's own one while a short read transaction
 * (e.g. the storage status reading its meta value) still runs on it. The failed
 * open is reset (69-13), so a retry a moment later succeeds; the seed creates up
 * to 14 new stores in a row and would otherwise stop half-way. Other errors are
 * thrown at once; Express never produces this message.
 * @template T
 * @param {() => Promise<T>} arbeit
 * @returns {Promise<T>}
 */
async function mitWiederholung(arbeit) {
  for (let versuch = 1; ; versuch++) {
    try {
      return await arbeit();
    } catch (fehler) {
      if (versuch >= 6 || !/IndexedDB blockiert/.test(text(fehler))) throw fehler;
      await new Promise((ok) => setTimeout(ok, 150 * versuch));
    }
  }
}

/**
 * Stored record by id, or null when it does not exist (null or 404).
 * @param {any} api
 * @param {string} entitaet
 * @param {string} id
 * @returns {Promise<Record<string, any>|null>}
 */
async function holeOderNull(api, entitaet, id) {
  try {
    return (await client(api, entitaet).get(id)) || null;
  } catch (fehler) {
    if (istNichtGefunden(fehler)) return null;
    throw new Error(`${entitaet} ${id} konnte nicht gelesen werden: ${text(fehler)}`);
  }
}

/**
 * Loads all 13 accounting collections in parallel plus Setting{key:"buchhaltung"}.
 * @param {any} api bitApi or a fake with the same shape
 * @returns {Promise<{daten: Record<string, any[]>, setting: Record<string, any>|null}>}
 */
export async function ladeAlles(api) {
  sperreFalls();
  const [listen, settings] = await Promise.all([
    Promise.all(BUCHHALTUNG_ENTITAETEN.map((e) => client(api, e).list())),
    client(api, "Setting").filter({ key: SETTING_KEY }),
  ]);
  // Copies: demoDb.list() without a sort order returns its live cache array —
  // handing that to React would let later writes mutate state behind its back.
  /** @type {Record<string, any[]>} */
  const daten = {};
  BUCHHALTUNG_ENTITAETEN.forEach((e, i) => { daten[e] = Array.isArray(listen[i]) ? [...listen[i]] : []; });
  return { daten, setting: Array.isArray(settings) && settings[0] ? settings[0] : null };
}

/**
 * Saves one record: update when a record with its id exists, create otherwise.
 * Refuses writes that break the GoBD write protection.
 * @param {any} api
 * @param {string} entitaet entity name
 * @param {Record<string, any>} obj record (with or without id)
 * @returns {Promise<Record<string, any>>} the stored record
 * @throws {Error} plain text (GoBD refusal, cloud lock, storage failure)
 */
export async function speichere(api, entitaet, obj) {
  sperreFalls();
  // The id is fixed before the first attempt and a retry repeats the get: after a
  // refused create the demo cache already holds the record, so the second attempt
  // updates it instead of adding a duplicate under a new id.
  const mitId = obj?.id ? obj : { ...obj, id: neueId() };
  return mitWiederholung(() => speichereEinmal(api, entitaet, mitId));
}

/** @returns {string} a new record id (same shape as demoDb's generated ids) */
function neueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * One attempt of speichere().
 * @param {any} api
 * @param {string} entitaet
 * @param {Record<string, any>} obj
 * @returns {Promise<Record<string, any>>}
 */
async function speichereEinmal(api, entitaet, obj) {
  const c = client(api, entitaet);
  const alt = obj?.id ? await holeOderNull(api, entitaet, obj.id) : null;
  try {
    if (alt) {
      if (schreibschutzVerletzt(entitaet, alt, { ...alt, ...obj })) {
        throw Object.assign(new Error("Gestellte Rechnungen sind schreibgeschützt — erlaubt sind nur Zahlungen, Mahnungen und Storno."), { gobd: true });
      }
      const { id, ...rest } = obj;
      return await c.update(id, rest);
    }
    return await c.create(obj);
  } catch (fehler) {
    if (/** @type {any} */ (fehler)?.gobd) throw fehler;
    throw new Error(`${entitaet} konnte nicht gespeichert werden: ${text(fehler)}`);
  }
}

/**
 * Saves several records one after the other (order matters for linked records).
 * @param {any} api
 * @param {Array<{entitaet: string, obj: Record<string, any>}>} liste
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function speichereViele(api, liste) {
  const ergebnisse = [];
  for (const { entitaet, obj } of liste || []) ergebnisse.push(await speichere(api, entitaet, obj));
  return ergebnisse;
}

/**
 * Deletes a record. Issued or cancelled outgoing invoices are refused (GoBD:
 * a document is cancelled, never deleted).
 * @param {any} api
 * @param {string} entitaet
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function loesche(api, entitaet, id) {
  sperreFalls();
  if (entitaet === ENTITAET.AUSGANGSRECHNUNG) {
    const alt = await holeOderNull(api, entitaet, id);
    if (alt && (alt.status === "gestellt" || alt.status === "storniert")) {
      throw new Error("Gestellte Rechnungen können nicht gelöscht werden — bitte stornieren.");
    }
  }
  try {
    await client(api, entitaet).delete(id);
  } catch (fehler) {
    if (istNichtGefunden(fehler)) return;
    throw new Error(`${entitaet} ${id} konnte nicht gelöscht werden: ${text(fehler)}`);
  }
}

/**
 * The office Setting record, or null when none exists yet.
 * @param {any} api
 * @returns {Promise<{id: string, key: string, value: Record<string, any>}|null>}
 */
export async function einstellungLesen(api) {
  sperreFalls();
  const zeilen = await client(api, "Setting").filter({ key: SETTING_KEY });
  return Array.isArray(zeilen) && zeilen[0] ? zeilen[0] : null;
}

/**
 * Merges a patch into the stored office settings (read-modify-write of the whole
 * `value`, because `update` merges only the top level of the record).
 * @param {any} api
 * @param {Record<string, any>} patch keys of the Setting value
 * @returns {Promise<Record<string, any>>} the stored Setting record
 */
export async function einstellungSpeichern(api, patch) {
  sperreFalls();
  return mitWiederholung(() => einstellungSpeichernEinmal(api, patch));
}

/**
 * One attempt of einstellungSpeichern() (read-modify-write).
 * @param {any} api
 * @param {Record<string, any>} patch
 * @returns {Promise<Record<string, any>>}
 */
async function einstellungSpeichernEinmal(api, patch) {
  const zeile = await einstellungLesen(api);
  const value = { ...(zeile?.value || {}), ...(patch || {}) };
  try {
    if (zeile) return await client(api, "Setting").update(zeile.id, { key: SETTING_KEY, value });
    return await client(api, "Setting").create({ key: SETTING_KEY, value });
  } catch (fehler) {
    throw new Error(`Einstellungen konnten nicht gespeichert werden: ${text(fehler)}`);
  }
}

/** Running seed, shared by concurrent callers (React StrictMode mounts twice). @type {Promise<{gesaet: boolean, anzahl: number}>|null} */
let saat = null;

/**
 * Seeds the sample data once — only in the demo, only when the office Setting
 * does not exist yet (a removed seed leaves the Setting with
 * `beispiel_entfernt: true`, so it is not seeded again). Records keep their
 * fixed "bsp-*" ids and go through speichere(), so a second tab or an aborted
 * run can never duplicate them; the Setting is written last.
 * @param {any} api
 * @param {string} heute 'YYYY-MM-DD'
 * @param {{istDemo?: boolean}} [optionen]
 * @returns {Promise<{gesaet: boolean, anzahl: number}>}
 */
export function saeBeispielDaten(api, heute, { istDemo = false } = {}) {
  if (!istDemo) return Promise.resolve({ gesaet: false, anzahl: 0 });
  if (saat) return saat;
  saat = (async () => {
    sperreFalls();
    if (await einstellungLesen(api)) return { gesaet: false, anzahl: 0 };
    const vorhandeneHoaiPlaene = [];
    for (const projekt of ["proj-1", "proj-2"]) {
      const plaene = await client(api, "HoaiPlan").filter({ project_id: projekt });
      if (Array.isArray(plaene) && plaene.length) vorhandeneHoaiPlaene.push(projekt);
    }
    const saetze = beispielDatensaetze(heute, { vorhandeneHoaiPlaene });
    let anzahl = 0;
    for (const [entitaet, liste] of Object.entries(saetze)) {
      if (entitaet === "Setting") continue;
      for (const obj of liste) { await speichere(api, entitaet, obj); anzahl++; }
    }
    for (const obj of saetze.Setting) { await speichere(api, "Setting", obj); anzahl++; }
    return { gesaet: true, anzahl };
  })().finally(() => { saat = null; });
  return saat;
}

/**
 * Removes every sample record (`beispiel: true`) of the 13 collections and the
 * sample HoaiPlans, drops the keys the seed put into the Setting and sets
 * `beispiel_entfernt: true` so the demo does not seed again. Sample invoices
 * are removed directly (not through loesche): they are demo furniture, not
 * documents of the user.
 * @param {any} api
 * @returns {Promise<{entfernt: number}>}
 */
export async function beispielEntfernen(api) {
  sperreFalls();
  let entfernt = 0;
  for (const entitaet of [...BUCHHALTUNG_ENTITAETEN, "HoaiPlan"]) {
    // A copy: deleting while iterating demoDb's live array would skip every second record.
    const liste = await client(api, entitaet).list();
    for (const obj of Array.isArray(liste) ? [...liste] : []) {
      if (obj?.beispiel !== true) continue;
      try {
        await client(api, entitaet).delete(obj.id);
        entfernt++;
      } catch (fehler) {
        if (!istNichtGefunden(fehler)) throw new Error(`${entitaet} ${obj.id} konnte nicht gelöscht werden: ${text(fehler)}`);
      }
    }
  }
  const zeile = await einstellungLesen(api);
  /** @type {Record<string, any>} */
  const value = { ...(zeile?.value || {}) };
  if (value.beispiel === true) for (const k of BEISPIEL_EINSTELLUNG_SCHLUESSEL) delete value[k];
  value.beispiel_entfernt = true;
  if (zeile) await client(api, "Setting").update(zeile.id, { key: SETTING_KEY, value });
  else await client(api, "Setting").create({ key: SETTING_KEY, value });
  return { entfernt };
}
