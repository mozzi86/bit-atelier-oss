// 115-05c (§6.2, D-115-12 "Ungespeichertes bleibt lokal"): the local storage of an unsaved draft of the building model.
//
// Key: bit-modell-entwurf:<benutzerId>:<projektId> - a draft belongs to one person on one project. A draft of person X is never
// offered to person Y on the same browser: the key differs, and an entry whose content names another person or project is
// refused ("fremd"). Signing out deletes the drafts of the person signing out (entwurfeDesBenutzersLoeschen, AuthContext).
// Format v1 (modellEntwurf.js): an unreadable entry ("kaputt") or another version ("version") is reported, never thrown and
// never misread - the designer must open the stored model in any case.
// Storage: browserJournal (below 256 KB localStorage, above IndexedDB); a refusal of both rejects (the caller reports it).
// [ASSUMED] drafts older than 30 days are dropped (the PDF journal's period): an older draft rests on a stored state long gone.
//
// In:  a JournalSpeicher (browser or a test Map), drafts. Out: stored text, read drafts with their reading result.

import { browserJournal } from "../browserJournal.js";
import { ENTWURF_VERSION, entwurfSauber } from "./modellEntwurf.js";

/** Key prefix of the drafts in localStorage / IndexedDB. */
export const ENTWURF_PRAEFIX = "bit-modell-entwurf:";
/** IndexedDB database of large drafts (own database: the PDF journal keeps its own). */
export const ENTWURF_IDB = "bit-atelier-modellentwurf";
/** Delay of the local write after the last change, milliseconds (the PDF journal's AUTOSAVE_MS). */
export const ENTWURF_SICHERN_MS = 800;
/** Drafts older than this are dropped, days [ASSUMED, see the file head]. */
export const ENTWURF_MAX_TAGE = 30;

/** @typedef {import("../browserJournal.js").JournalSpeicher} JournalSpeicher */
/** @typedef {import("./modellEntwurf.js").ModellEntwurf} ModellEntwurf */

/** @param {any} s @returns {string} one key part (a ":" inside an id must not shift the parts) */
const teil = (s) => encodeURIComponent(String(s ?? ""));

/**
 * Storage key of a draft.
 * @param {string} benutzer user id @param {string} projekt project id @returns {string}
 */
export function entwurfSchluessel(benutzer, projekt) {
  return `${ENTWURF_PRAEFIX}${teil(benutzer)}:${teil(projekt)}`;
}

/**
 * Parses a stored draft for a person and a project.
 * @param {string|null|undefined} text stored text
 * @param {{benutzer: string, projekt: string}} fuer whose draft is asked for
 * @returns {{entwurf: ModellEntwurf|null, fehler: null|"kaputt"|"version"|"fremd"}} fehler null with entwurf null = nothing stored
 */
export function entwurfLesen(text, { benutzer, projekt }) {
  if (text == null || text === "") return { entwurf: null, fehler: null };
  let e;
  try { e = JSON.parse(text); } catch { return { entwurf: null, fehler: "kaputt" }; }
  if (!e || typeof e !== "object" || Array.isArray(e)) return { entwurf: null, fehler: "kaputt" };
  if (e.v !== ENTWURF_VERSION) return { entwurf: null, fehler: "version" };
  if (String(e.benutzer) !== String(benutzer) || String(e.projekt) !== String(projekt)) return { entwurf: null, fehler: "fremd" };
  if (!e.aenderungen || typeof e.aenderungen !== "object" || !e.basis || typeof e.basis !== "object") return { entwurf: null, fehler: "kaputt" };
  return {
    entwurf: { ...e, aenderungen: { bim: e.aenderungen.bim || {}, komplex: e.aenderungen.komplex || {} },
      basis: { bim: e.basis.bim || null, komplex: e.basis.komplex || null }, schritte: Array.isArray(e.schritte) ? e.schritte : [] },
    fehler: null,
  };
}

/**
 * Stores a draft, or removes its entry when nothing would be lost (clean). Rejects when the browser store refuses.
 * @param {JournalSpeicher} speicher @param {ModellEntwurf} e @returns {Promise<void>}
 */
export async function entwurfSpeichern(speicher, e) {
  const key = entwurfSchluessel(e.benutzer, e.projekt);
  if (entwurfSauber(e)) { await speicher.loeschen(key); return; }
  await speicher.schreiben(key, JSON.stringify(e));
}

/**
 * Loads the draft of a person on a project.
 * @param {JournalSpeicher} speicher @param {string} benutzer @param {string} projekt
 * @returns {Promise<{entwurf: ModellEntwurf|null, fehler: null|"kaputt"|"version"|"fremd"}>}
 */
export async function entwurfLaden(speicher, benutzer, projekt) {
  return entwurfLesen(await speicher.lesen(entwurfSchluessel(benutzer, projekt)), { benutzer, projekt });
}

/**
 * Removes the draft of a person on a project ("Verwerfen", after a full save).
 * @param {JournalSpeicher} speicher @param {string} benutzer @param {string} projekt @returns {Promise<void>}
 */
export async function entwurfLoeschen(speicher, benutzer, projekt) {
  await speicher.loeschen(entwurfSchluessel(benutzer, projekt));
}

/**
 * Signing out: every draft of this person goes (other people's drafts stay).
 * @param {JournalSpeicher} speicher @param {string} benutzer @returns {Promise<number>} entries removed
 */
export async function entwurfeDesBenutzersLoeschen(speicher, benutzer) {
  const vor = `${ENTWURF_PRAEFIX}${teil(benutzer)}:`;
  let n = 0;
  for (const k of await speicher.schluessel()) {
    if (!k.startsWith(vor)) continue;
    await speicher.loeschen(k);
    n += 1;
  }
  return n;
}

/**
 * Removes drafts older than `maxTage` and unreadable entries.
 * @param {JournalSpeicher} speicher @param {{maxTage?: number, jetzt?: Date}} [o] maxTage in days
 * @returns {Promise<number>} entries removed
 */
export async function entwurfeAufraeumen(speicher, { maxTage = ENTWURF_MAX_TAGE, jetzt = new Date() } = {}) {
  let n = 0;
  for (const k of await speicher.schluessel()) {
    if (!k.startsWith(ENTWURF_PRAEFIX)) continue;
    let alter = Infinity;
    try { const e = JSON.parse(String(await speicher.lesen(k))); alter = (jetzt.getTime() - Date.parse(e?.zeit)) / 86400000; } catch { /* unreadable */ }
    if (!(alter <= maxTage)) { await speicher.loeschen(k); n += 1; }
  }
  return n;
}

/** @type {JournalSpeicher|null} */
let browser = null;
/**
 * The browser storage of the drafts (one adapter per page).
 * @returns {JournalSpeicher}
 */
export function entwurfBrowserSpeicher() {
  browser ||= browserJournal({ idbName: ENTWURF_IDB, idbStore: "entwurf", praefix: ENTWURF_PRAEFIX });
  return browser;
}
