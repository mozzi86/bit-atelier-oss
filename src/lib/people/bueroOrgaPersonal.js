// Phase 82: absences, personnel deadlines and project assignments — the ONLY
// phase-82 module that names the personnel API. It sits in the folder the 80-02
// leak guard allows (src/lib/people/**), pattern 81 zeitHonorarPersonal.js. It
// writes no audit log and sends nothing anywhere (no fetch).
//
// Loaded with the device/server role (80: personalZugang({datenquelle, rolle})
// without the 82 access object): the team calendar, the project view and the
// approvals must compute in the "Ansicht als" of another role too — the 82 role
// filters afterwards in the pure functions (rechte.js, abwesenheit/*). Without
// 'erlaubt' every loader returns empty lists WITHOUT touching the API, never a
// throw into the UI; a failing personnel API is reported in `fehler` (plain text).
//
// The assignment projection carries no names and no other personnel fields —
// only what the project view needs.
//
// In:  {datenquelle, rolle} of the signed-in user; optionally an injected api (tests).
// Out: ladeAbwesenheitsDaten, ladeZuordnungsProjektion, ladePersonalFristDaten,
//      speichereAbwesenheit, loescheAbwesenheit, quittierePersonalFrist,
//      saeBeispielAbwesenheiten, entferneBeispielAbwesenheiten, ergaenzeBeispielZuordnungen.

import { bitApi } from "@core/api/bitApi";
import { personalZugang } from "./zugang.js";
import { zuordnungenFuer } from "@/lib/zeit/personalQuelle.js";

/** @param {any} [api] @returns {any} the personnel entity clients */
const personal = (api) => (api ?? bitApi).personal;

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/** @param {any} x @returns {any[]} copy of a list (the local store may hand out live arrays) */
const kopie = (x) => (Array.isArray(x) ? [...x] : []);

/**
 * Absences with what the leave account and the team calendar need.
 * @param {{datenquelle?: string, rolle?: string|null}} kontext
 * @param {{api?: any}} [optionen]
 * @returns {Promise<{zugang: string, abwesenheiten: any[], mitarbeiter: any[], vertraege: any[], fristquittungen: any[], fehler: string|null}>}
 */
export async function ladeAbwesenheitsDaten({ datenquelle, rolle } = {}, { api } = {}) {
  const zugang = personalZugang({ datenquelle, rolle });
  const leer = { zugang, abwesenheiten: [], mitarbeiter: [], vertraege: [], fristquittungen: [], fehler: null };
  if (zugang !== "erlaubt") return leer;
  try {
    const p = personal(api);
    const [abwesenheiten, mitarbeiter, vertraege, fristquittungen] = await Promise.all([p.Abwesenheit.list(), p.Mitarbeiter.list(), p.Arbeitsvertrag.list(), p.Fristquittung.list()]);
    return { zugang, abwesenheiten: kopie(abwesenheiten), mitarbeiter: kopie(mitarbeiter), vertraege: kopie(vertraege), fristquittungen: kopie(fristquittungen), fehler: null };
  } catch (fehler) {
    console.error("[Abwesenheiten] Personaldaten nicht lesbar:", fehler);
    return { ...leer, zugang: "nur-lokal", fehler: `Personaldaten konnten nicht gelesen werden: ${text(fehler)}` };
  }
}

/**
 * Narrow projection of the project assignments: per person only id, `alle`
 * (no assignment → all projects, E-17) and the assignments valid on the key date.
 * @param {{datenquelle?: string, rolle?: string|null, stichtagIso: string}} kontext
 * @param {{api?: any}} [optionen]
 * @returns {Promise<Array<{mitarbeiter_id: string, alle: boolean, zuordnungen: Array<{project_id: string, funktion: string|null, von: string|null, bis: string|null}>}>>}
 */
export async function ladeZuordnungsProjektion({ datenquelle, rolle, stichtagIso } = /** @type {any} */ ({}), { api } = {}) {
  if (personalZugang({ datenquelle, rolle }) !== "erlaubt") return [];
  try {
    const mitarbeiter = kopie(await personal(api).Mitarbeiter.list());
    return mitarbeiter.filter((m) => m?.id).map((m) => {
      const z = zuordnungenFuer(m, { stichtagIso });
      return {
        mitarbeiter_id: m.id,
        alle: z.alle,
        zuordnungen: z.zuordnungen.map((x) => ({ project_id: x.project_id, funktion: x.funktion ?? null, von: x.von ?? null, bis: x.bis ?? null })),
      };
    });
  } catch (fehler) {
    console.error("[Rechte] Projektzuordnungen nicht lesbar:", fehler);
    return [];
  }
}

/**
 * Input of 80's personalFristen(daten, heute, regelWert).
 * @param {{datenquelle?: string, rolle?: string|null}} kontext
 * @param {{api?: any}} [optionen]
 * @returns {Promise<Record<string, any[]>>} empty object without access
 */
export async function ladePersonalFristDaten({ datenquelle, rolle } = {}, { api } = {}) {
  if (personalZugang({ datenquelle, rolle }) !== "erlaubt") return {};
  try {
    const p = personal(api);
    const namen = ["Mitarbeiter", "Arbeitsvertrag", "Gehaltsaenderung", "Personalvorgang", "Fristquittung", "Bewerbung", "Stelle"];
    const listen = await Promise.all(namen.map((n) => (p[n] ? p[n].list() : [])));
    return Object.fromEntries(namen.map((n, i) => [n, kopie(listen[i])]));
  } catch (fehler) {
    console.error("[Fristen] Personalfristen nicht lesbar:", fehler);
    return {};
  }
}

/**
 * Saves one absence (get → update | create, never a duplicate).
 * @param {Record<string, any>} obj normalised absence (abwesenheit.js)
 * @param {{api?: any}} [optionen]
 * @returns {Promise<Record<string, any>>}
 * @throws {Error} plain text
 */
export async function speichereAbwesenheit(obj, { api } = {}) {
  const c = personal(api).Abwesenheit;
  let alt = null;
  if (obj?.id) {
    try { alt = await c.get(obj.id); } catch { alt = null; }
  }
  try {
    if (alt) {
      const { id, ...rest } = obj;
      return await c.update(id, rest);
    }
    return await c.create(obj);
  } catch (fehler) {
    throw new Error(`Abwesenheit konnte nicht gespeichert werden: ${text(fehler)}`);
  }
}

/**
 * Deletes one absence.
 * @param {string} id
 * @param {{api?: any}} [optionen]
 * @returns {Promise<void>}
 * @throws {Error} plain text
 */
export async function loescheAbwesenheit(id, { api } = {}) {
  try {
    await personal(api).Abwesenheit.delete(id);
  } catch (fehler) {
    throw new Error(`Abwesenheit konnte nicht gelöscht werden: ${text(fehler)}`);
  }
}

/**
 * Acknowledges a personnel deadline the way 80 does (Fristquittung, 80-06).
 * @param {string} schluessel 'art:bezug_id:faellig_am'
 * @param {{jetzt: string, api?: any}} optionen jetzt 'YYYY-MM-DD'
 * @returns {Promise<Record<string, any>>} the acknowledgement
 * @throws {Error} plain text
 */
export async function quittierePersonalFrist(schluessel, { jetzt, api }) {
  try {
    return await personal(api).Fristquittung.create({ schluessel, quittiert_am: jetzt });
  } catch (fehler) {
    throw new Error(`Frist konnte nicht quittiert werden: ${text(fehler)}`);
  }
}

/**
 * Writes sample absences (only ids that do not exist yet).
 * @param {ReadonlyArray<Record<string, any>>} liste
 * @param {{api?: any}} [optionen]
 * @returns {Promise<number>} records written
 */
export async function saeBeispielAbwesenheiten(liste, { api } = {}) {
  const c = personal(api).Abwesenheit;
  const vorhanden = new Set(kopie(await c.list()).map((a) => a?.id));
  let n = 0;
  for (const a of liste || []) {
    if (vorhanden.has(a.id)) continue;
    await c.create(a);
    n += 1;
  }
  return n;
}

/**
 * Deletes the sample absences (beispiel: true) only.
 * @param {{api?: any}} [optionen]
 * @returns {Promise<number>} records deleted
 */
export async function entferneBeispielAbwesenheiten({ api } = {}) {
  const c = personal(api).Abwesenheit;
  const alle = kopie(await c.list()).filter((a) => a?.beispiel === true);
  for (const a of alle) await c.delete(a.id);
  return alle.length;
}

/**
 * Adds sample project assignments only where a person has none (set ones stay).
 * @param {ReadonlyArray<{mitarbeiter_id: string, projekt_zuordnungen: any[]}>} ergaenzungen
 * @param {{api?: any}} [optionen]
 * @returns {Promise<number>} persons changed
 */
export async function ergaenzeBeispielZuordnungen(ergaenzungen, { api } = {}) {
  const c = personal(api).Mitarbeiter;
  let n = 0;
  for (const e of ergaenzungen || []) {
    let m = null;
    try { m = await c.get(e.mitarbeiter_id); } catch { m = null; }
    if (!m || (Array.isArray(m.projekt_zuordnungen) && m.projekt_zuordnungen.length)) continue;
    await c.update(m.id, { projekt_zuordnungen: e.projekt_zuordnungen });
    n += 1;
  }
  return n;
}
