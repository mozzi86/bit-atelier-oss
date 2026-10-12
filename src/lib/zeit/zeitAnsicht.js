// Week view of the time tracking (phase 81-02): the grid of one person and one
// ISO week (rows = project/stage/kind of work or office category, columns =
// Monday … Sunday, cells in MINUTES), target against actual per day, the week's
// status, the order of bookable rows and the rows of the previous week.
// Pure — the page hands in bookings, persons and projects; target minutes come
// from the 79 calendar core plus 81-01's sollMinuten (Bavarian holidays).
//
// In:  Zeitbuchung records (src/lib/zeit/zeitbuchung.js), Mitarbeiter (80 shape,
//      through the adapter), Project records. Out: plain objects; minutes are whole
//      numbers, dates 'YYYY-MM-DD'.

import { plusTage, wochenTage } from "@core/lib/kalender/datum.js";
import { sollMinuten } from "@core/lib/kalender/arbeitstage.js";
import { zuordnungenFuer } from "./personalQuelle.js";

/**
 * Key of a grid row: what a booking is booked ON (not when).
 * @param {{project_id?: string|null, lph?: number|null, leistung?: string|null, kategorie_intern?: string|null, honorarnachtrag_id?: string|null}} b
 * @returns {string}
 */
export function zeilenSchluessel(b) {
  return [b.project_id || "", b.lph ?? "", b.leistung || "", b.kategorie_intern || "", b.honorarnachtrag_id || ""].join("|");
}

/**
 * The row descriptor of a key (inverse of zeilenSchluessel).
 * @param {string} schluessel
 * @returns {{project_id: string|null, lph: number|null, leistung: string|null, kategorie_intern: string|null, honorarnachtrag_id: string|null}}
 */
export function zeileAusSchluessel(schluessel) {
  const [p, l, le, k, n] = String(schluessel).split("|");
  return { project_id: p || null, lph: l ? Number(l) : null, leistung: le || null, kategorie_intern: k || null, honorarnachtrag_id: n || null };
}

/**
 * @typedef {{
 *   schluessel: string, project_id: string|null, lph: number|null, leistung: string|null,
 *   kategorie_intern: string|null, honorarnachtrag_id: string|null,
 *   tage: number[], buchungen: Array<Array<Record<string, any>>>,
 * }} WochenZeile tage: minutes per weekday (Mo … So); buchungen: the records per day
 */

/**
 * Grid of one person and one ISO week. Office time (project_id null) gets rows
 * of its own and never lands in a project row; rejected bookings stay visible in
 * their cell (to be corrected) but do not count in the sums.
 * @param {ReadonlyArray<Record<string, any>>} buchungen all bookings (any person, any week)
 * @param {{mitarbeiterId: string, jahr: number, woche: number}} auswahl ISO week
 * @returns {{tage: string[], zeilen: WochenZeile[], tagesSummen: number[], summe: number}}
 */
export function wochenMatrix(buchungen, { mitarbeiterId, jahr, woche }) {
  const tage = wochenTage(jahr, woche);
  /** @type {Map<string, WochenZeile>} */
  const zeilen = new Map();
  const tagesSummen = [0, 0, 0, 0, 0, 0, 0];
  for (const b of Array.isArray(buchungen) ? buchungen : []) {
    if (!b || b.mitarbeiter_id !== mitarbeiterId) continue;
    const i = tage.indexOf(b.datum);
    if (i < 0) continue;
    const schluessel = zeilenSchluessel(b);
    if (!zeilen.has(schluessel)) {
      zeilen.set(schluessel, { schluessel, ...zeileAusSchluessel(schluessel), tage: [0, 0, 0, 0, 0, 0, 0], buchungen: [[], [], [], [], [], [], []] });
    }
    const z = /** @type {WochenZeile} */ (zeilen.get(schluessel));
    z.buchungen[i].push(b);
    if (b.status === "abgelehnt") continue;
    const m = Number(b.minuten) || 0;
    z.tage[i] += m;
    tagesSummen[i] += m;
  }
  // Projects first (by project and stage), office time last.
  const liste = [...zeilen.values()].sort((a, b) => {
    if (!a.project_id !== !b.project_id) return a.project_id ? -1 : 1;
    return a.schluessel.localeCompare(b.schluessel);
  });
  return { tage, zeilen: liste, tagesSummen, summe: tagesSummen.reduce((x, y) => x + y, 0) };
}

/**
 * Target against actual per day of one ISO week.
 * Target with an active contract (80, wochenstunden/arbeitstage_woche) on the
 * contract days, otherwise the daily target zeit_honorar.tagessoll on Mo–Fr
 * (E-16/E-17); holidays 0. 82-04: APPROVED absences of the person (any kind)
 * set the day's target to 0 (a half day at start/end to half) and mark the day
 * `abwesend` — the key appears only when absences are passed (81 callers unchanged).
 * @param {{jahr: number, woche: number}} kw ISO week
 * @param {{vertrag?: Record<string, any>|null, feiertage?: ReadonlyArray<{datum: string}>, tagessollMinuten?: number|null,
 *   istMinuten?: ReadonlyArray<number>, abwesenheiten?: ReadonlyArray<any>}} optionen istMinuten: actual minutes Mo … So
 * @returns {{tage: Array<{datum: string, soll: number, ist: number, diff: number, feiertag: boolean, abwesend?: boolean}>, soll: number, ist: number, diff: number, sollQuelle: 'vertrag'|'tagessoll'}}
 */
export function sollIst({ jahr, woche }, { vertrag = null, feiertage = undefined, tagessollMinuten = 480, istMinuten = [], abwesenheiten = [] } = {}) {
  const tage = wochenTage(jahr, woche);
  const genehmigt = (abwesenheiten || []).filter((a) => a && a.status === "genehmigt" && a.von);
  /** @param {string} datum @returns {number} 1 = present, 0.5 half day, 0 absent */
  const anwesend = (datum) => {
    const a = genehmigt.find((x) => x.von <= datum && (x.bis || x.von) >= datum);
    if (!a) return 1;
    return (datum === a.von && a.halbtag_von) || (datum === (a.bis || a.von) && a.halbtag_bis) ? 0.5 : 0;
  };
  const mitVertrag = Number(vertrag?.wochenstunden) > 0;
  const parameter = mitVertrag
    ? { wochenstunden: Number(vertrag?.wochenstunden), arbeitstageWoche: Number(vertrag?.arbeitstage_woche) || 5, feiertage }
    : { tagessollMinuten: Number(tagessollMinuten) || 0, feiertage };
  const feiertagSet = new Set((feiertage || []).map((f) => f.datum));
  const zeilen = tage.map((datum, i) => {
    const faktor = genehmigt.length ? anwesend(datum) : 1;
    const soll = sollMinuten(datum, datum, parameter) * faktor;
    const ist = Number(istMinuten[i]) || 0;
    return { datum, soll, ist, diff: ist - soll, feiertag: feiertagSet.has(datum), ...(genehmigt.length ? { abwesend: faktor < 1 } : {}) };
  });
  const soll = zeilen.reduce((s, z) => s + z.soll, 0);
  const ist = zeilen.reduce((s, z) => s + z.ist, 0);
  return { tage: zeilen, soll, ist, diff: ist - soll, sollQuelle: mitVertrag ? "vertrag" : "tagessoll" };
}

/**
 * Status of a set of bookings (one week of one person).
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @returns {'leer'|'entwurf'|'eingereicht'|'freigegeben'|'abgelehnt'|'gemischt'}
 */
export function wochenStatus(buchungen) {
  const status = new Set((Array.isArray(buchungen) ? buchungen : []).map((b) => b?.status || "entwurf"));
  if (!status.size) return "leer";
  if (status.size > 1) return "gemischt";
  return /** @type {any} */ ([...status][0]);
}

/**
 * Bookable projects for a person, in the order the grid offers them: projects
 * the person is assigned to on the key date (80 projekt_zuordnungen) first, then
 * projects the person booked on recently, then all others alphabetically.
 * `nichtZugeordnet` marks the others — only when the person has assignments at
 * all (a person without assignments, e.g. the virtual owner, may book every
 * project, E-17). Archived projects (archiviert_am, 81-06) are left out.
 * @param {ReadonlyArray<Record<string, any>>} projekte Project records
 * @param {ReadonlyArray<Record<string, any>>} mitarbeiter persons (the virtual owner may be missing here)
 * @param {ReadonlyArray<Record<string, any>>} buchungen bookings (for "recently used")
 * @param {{mitarbeiterId: string, stichtagIso: string}} auswahl
 * @returns {Array<{projekt: Record<string, any>, zugeordnet: boolean, zuletzt: boolean, nichtZugeordnet: boolean}>}
 */
export function buchbareZeilen(projekte, mitarbeiter, buchungen, { mitarbeiterId, stichtagIso }) {
  const person = (Array.isArray(mitarbeiter) ? mitarbeiter : []).find((m) => m?.id === mitarbeiterId) || { id: mitarbeiterId };
  const { alle, zuordnungen } = zuordnungenFuer(person, { stichtagIso });
  const zugeordnet = new Set(zuordnungen.map((z) => z.project_id));
  const seit = /** @type {string} */ (plusTage(stichtagIso, -56));
  const zuletzt = new Set((Array.isArray(buchungen) ? buchungen : [])
    .filter((b) => b?.mitarbeiter_id === mitarbeiterId && b.project_id && b.datum >= seit)
    .map((b) => b.project_id));
  const rang = (p) => (zugeordnet.has(p.id) ? 0 : zuletzt.has(p.id) ? 1 : 2);
  return (Array.isArray(projekte) ? projekte : [])
    .filter((p) => p && !p.archiviert_am)
    .map((p) => ({ projekt: p, zugeordnet: zugeordnet.has(p.id), zuletzt: zuletzt.has(p.id), nichtZugeordnet: !alle && !zugeordnet.has(p.id) }))
    .sort((a, b) => rang(a.projekt) - rang(b.projekt) || String(a.projekt.name || "").localeCompare(String(b.projekt.name || ""), "de"));
}

/**
 * The rows of the previous week (keys and descriptors, without minutes) —
 * "Wie Vorwoche" offers them as empty rows of the current week.
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @param {{mitarbeiterId: string, jahr: number, woche: number}} auswahl the CURRENT week
 * @returns {Array<{schluessel: string, project_id: string|null, lph: number|null, leistung: string|null, kategorie_intern: string|null, honorarnachtrag_id: string|null}>}
 */
export function uebernimmVorwoche(buchungen, { mitarbeiterId, jahr, woche }) {
  const montag = wochenTage(jahr, woche)[0];
  if (!montag) return [];
  const vorMontag = /** @type {string} */ (plusTage(montag, -7));
  const vorTage = new Set(Array.from({ length: 7 }, (_, i) => /** @type {string} */ (plusTage(vorMontag, i))));
  const schluessel = new Set();
  for (const b of Array.isArray(buchungen) ? buchungen : []) {
    if (b?.mitarbeiter_id === mitarbeiterId && vorTage.has(b.datum) && b.status !== "abgelehnt") schluessel.add(zeilenSchluessel(b));
  }
  return [...schluessel].sort().map((s) => ({ schluessel: s, ...zeileAusSchluessel(s) }));
}
