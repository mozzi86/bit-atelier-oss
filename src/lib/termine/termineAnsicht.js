// View rules of the deadline calendar (phase 82, 82-03, FRIST-02/05): agenda
// groups, the month grid, the counter of due terms and the rights filter — ONE
// way of computing them for the page, the dashboard card and the menu counter
// (82-06 imports zaehleFaellige and filterNachZugriff).
//
// Only deadlines are ever overdue: a past appointment (a regular meeting, a bid
// opening) is not a failure, it simply happened — it leaves the agenda; a past
// deadline that nobody ticked off stays under "Überfällig".
//
// Pure, no React. Weeks run Monday to Sunday. In: terms of ladeTermine, today,
// access, holidays. Out: gruppiere, monatsRaster, zaehleFaellige, filterNachZugriff.

import { plusTage, tageZwischen, wochentag } from "@core/lib/kalender/datum.js";
import { darf, darfProjekt } from "@core/lib/rechte.js";

/** Sort rank of the classes inside a group. */
const RANG = Object.freeze({ frist: 0, termin: 1, hinweis: 2 });

/**
 * @param {import("@core/lib/kalender/termin.js").Termin} a
 * @param {import("@core/lib/kalender/termin.js").Termin} b
 * @returns {number}
 */
const vergleiche = (a, b) => a.datum.localeCompare(b.datum) || (RANG[a.klasse] ?? 3) - (RANG[b.klasse] ?? 3)
  || String(a.zeit || "").localeCompare(String(b.zeit || "")) || a.id.localeCompare(b.id);

/**
 * Agenda group of one term, or null when it does not belong in the agenda.
 * A multi-day term that started before today and still runs counts as "today".
 * @param {import("@core/lib/kalender/termin.js").Termin} t
 * @param {string} heute 'YYYY-MM-DD'
 * @param {{agendaTage?: number, zeigeErledigte?: boolean}} [opt] agendaTage: window in days
 * @returns {'ueberfaellig'|'heute'|'diese_woche'|'naechste_woche'|'spaeter'|null}
 */
export function agendaGruppe(t, heute, { agendaTage = 90, zeigeErledigte = false } = {}) {
  if (t.erledigt && !zeigeErledigte) return null;
  const tage = tageZwischen(heute, t.datum);
  if (tage === null) return null;
  if (tage < 0) {
    if (t.bis && t.bis >= heute) return "heute";
    return t.klasse === "frist" && !t.erledigt ? "ueberfaellig" : null;
  }
  if (tage > agendaTage) return null;
  if (tage === 0) return "heute";
  const wt = /** @type {number} */ (wochentag(heute));
  const bisSonntag = wt === 0 ? 0 : 7 - wt;
  if (tage <= bisSonntag) return "diese_woche";
  if (tage <= bisSonntag + 7) return "naechste_woche";
  return "spaeter";
}

/**
 * Groups the terms of the agenda, each group sorted (date, frist < termin < hinweis, time).
 * @param {ReadonlyArray<import("@core/lib/kalender/termin.js").Termin>} termine
 * @param {string} heute 'YYYY-MM-DD'
 * @param {{agendaTage?: number, zeigeErledigte?: boolean}} [opt]
 * @returns {Record<'ueberfaellig'|'heute'|'diese_woche'|'naechste_woche'|'spaeter', import("@core/lib/kalender/termin.js").Termin[]>}
 */
export function gruppiere(termine, heute, opt = {}) {
  /** @type {Record<string, any[]>} */
  const g = { ueberfaellig: [], heute: [], diese_woche: [], naechste_woche: [], spaeter: [] };
  for (const t of termine || []) {
    const k = agendaGruppe(t, heute, opt);
    if (k) g[k].push(t);
  }
  for (const k of Object.keys(g)) g[k].sort(vergleiche);
  return /** @type {any} */ (g);
}

/**
 * Number of due terms: overdue plus today (the counter of menu and dashboard).
 * @param {ReadonlyArray<import("@core/lib/kalender/termin.js").Termin>} termine
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number}
 */
export function zaehleFaellige(termine, heute) {
  const g = gruppiere(termine, heute);
  return g.ueberfaellig.length + g.heute.length;
}

/**
 * Terms the access may see: its module readable and its project in the project view.
 * Terms without project stay when the module is readable.
 * @param {ReadonlyArray<import("@core/lib/kalender/termin.js").Termin>} termine
 * @param {import("@core/lib/rechte.js").Zugriff|null|undefined} zugriff
 * @returns {import("@core/lib/kalender/termin.js").Termin[]}
 */
export function filterNachZugriff(termine, zugriff) {
  if (!zugriff) return [...(termine || [])];
  return (termine || []).filter((t) => darf(zugriff, t.modul, "lesen") && darfProjekt(zugriff, t.project_id));
}

/**
 * One cell of the month grid.
 * @typedef {{datum: string, imMonat: boolean, wochenende: boolean, feiertag: boolean, feiertagName: string|null, termine: import("@core/lib/kalender/termin.js").Termin[]}} RasterTag
 */

/**
 * Month grid, Monday first: from the Monday on or before the 1st to the Sunday
 * on or after the last day; terms sorted per day (multi-day terms on every day).
 * @param {number} jahr
 * @param {number} monat 1–12
 * @param {ReadonlyArray<import("@core/lib/kalender/termin.js").Termin>} termine
 * @param {ReadonlyArray<{datum: string, name: string}>} feiertage holidays of the year(s) shown
 * @returns {RasterTag[][]} weeks of seven days
 */
export function monatsRaster(jahr, monat, termine, feiertage) {
  const erster = `${jahr}-${String(monat).padStart(2, "0")}-01`;
  const wtErster = /** @type {number} */ (wochentag(erster));
  const start = /** @type {string} */ (plusTage(erster, -((wtErster + 6) % 7)));
  const naechsterMonat = monat === 12 ? `${jahr + 1}-01-01` : `${jahr}-${String(monat + 1).padStart(2, "0")}-01`;
  const letzter = /** @type {string} */ (plusTage(naechsterMonat, -1));
  const wtLetzter = /** @type {number} */ (wochentag(letzter));
  const ende = /** @type {string} */ (plusTage(letzter, (7 - wtLetzter) % 7));
  const feiertagNach = new Map((feiertage || []).map((f) => [f.datum, f.name]));
  /** @type {RasterTag[][]} */
  const wochen = [];
  for (let tag = start; tag <= ende; tag = /** @type {string} */ (plusTage(tag, 1))) {
    if (!wochen.length || wochen[wochen.length - 1].length === 7) wochen.push([]);
    const w = /** @type {number} */ (wochentag(tag));
    wochen[wochen.length - 1].push({
      datum: tag,
      imMonat: tag.slice(0, 7) === erster.slice(0, 7),
      wochenende: w === 0 || w === 6,
      feiertag: feiertagNach.has(tag),
      feiertagName: feiertagNach.get(tag) ?? null,
      termine: (termine || []).filter((t) => t.datum <= tag && (t.bis || t.datum) >= tag).sort(vergleiche),
    });
  }
  return wochen;
}
