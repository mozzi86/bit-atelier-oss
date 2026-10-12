// termin.js — the term data contract of phase 82 (Fristen & Termine, FRIST-01).
//
// Model "aggregate instead of table" (D-P82-04): deadlines and appointments of
// the office live where they belong — the project's completion date in the
// Project, the tax dates in the books (79), the HR deadlines in the personnel
// class (80), contract milestones at the contract (81) … The agenda collects
// them on the fly into ONE shape, the Termin below. Only manual terms (Termin)
// and the acknowledgement of a computed term (Terminquittung) are stored.
//
// A term's id is stable per source, record and period (terminId), so an
// acknowledgement keeps working when the agenda is computed again tomorrow.
//
// Pure, no imports beyond the calendar core; no UI sentence in here — `objekt`
// is a data name, the title is built when rendering (labels below are German
// i18n source keys).
//
// In:  term lists of the sources. Out: TERMIN_ARTEN, AGENDA_GRUPPEN, terminId,
//      wiederholungen, sammleTermine.

import { parseTag, plusMonate, plusTage, tageZwischen } from "./datum.js";

/**
 * One entry of the agenda.
 * @typedef {{
 *   id: string, quelle: string, art: string, klasse: 'frist'|'termin'|'hinweis',
 *   datum: string, bis?: string|null, zeit?: string|null, dauer_min?: number|null,
 *   project_id: string|null, modul: string, objekt: string, ziel: string,
 *   herkunft?: string, annahme?: boolean, erledigt?: boolean, info?: string, schluessel?: string, datensatz_id?: string,
 * }} Termin
 *   datum/bis 'YYYY-MM-DD' (bis = last day of a multi-day term); zeit 'HH:MM' local;
 *   dauer_min in minutes; modul = rights module of rechte.js; ziel = in-app link;
 *   herkunft = rule or norm the date comes from; annahme = [ASSUMED] date; info = plain-text hint
 *   (German key); schluessel = acknowledgement key of the source (HR deadlines of 80);
 *   datensatz_id = stored record behind an occurrence (manual terms)
 */

/**
 * Kinds of terms with their German label (i18n key) and class. Only a 'frist'
 * can be overdue; a 'termin' is an appointment, a 'hinweis' a reminder.
 * @type {Readonly<Record<string, Readonly<{label: string, klasse: 'frist'|'termin'|'hinweis'}>>>}
 */
export const TERMIN_ARTEN = Object.freeze({
  projekt_fertigstellung: Object.freeze({ label: "Fertigstellung", klasse: "termin" }),
  termin_manuell: Object.freeze({ label: "Termin", klasse: "termin" }),
  frist_manuell: Object.freeze({ label: "Frist", klasse: "frist" }),
  baugenehmigung: Object.freeze({ label: "Baugenehmigung", klasse: "frist" }),
  jour_fixe: Object.freeze({ label: "Jour fixe", klasse: "termin" }),
  // A deadline, not a notice: the inspection must happen BEFORE the warranty ends (82-03).
  begehung_vor_ablauf: Object.freeze({ label: "Begehung vor Gewährleistungsende", klasse: "frist" }),
  gewaehrleistung_ende: Object.freeze({ label: "Gewährleistungsende", klasse: "frist" }),
  sicherheit_rueckgabe: Object.freeze({ label: "Rückgabe der Sicherheit", klasse: "frist" }),
  architektenhaftung_ende: Object.freeze({ label: "Ende der Architektenhaftung", klasse: "hinweis" }),
  ust_voranmeldung: Object.freeze({ label: "USt-Voranmeldung", klasse: "frist" }),
  steuer_vorauszahlung: Object.freeze({ label: "Steuervorauszahlung", klasse: "frist" }),
  personal_frist: Object.freeze({ label: "Personalfrist", klasse: "frist" }),
  vertrag_meilenstein: Object.freeze({ label: "Vertragsmeilenstein", klasse: "termin" }),
  vertrag_frist: Object.freeze({ label: "Vertragsfrist", klasse: "frist" }),
  vertrag_rate: Object.freeze({ label: "Abschlagsrate", klasse: "hinweis" }),
  honorarangebot_ablauf: Object.freeze({ label: "Angebot läuft ab", klasse: "frist" }),
  bauzeitenplan: Object.freeze({ label: "Bauzeitenplan", klasse: "termin" }),
  submission: Object.freeze({ label: "Submission", klasse: "frist" }),
  modelllieferung: Object.freeze({ label: "Modelllieferung", klasse: "frist" }),
  foerderfrist: Object.freeze({ label: "Förderfrist", klasse: "frist" }),
  postbuch_antwort: Object.freeze({ label: "Antwort fällig", klasse: "frist" }),
  abwesenheit: Object.freeze({ label: "Abwesenheit", klasse: "hinweis" }),
  // 88-04: statutory deadlines of permit procedures (guide values) and of conditions.
  genehmigung_frist: Object.freeze({ label: "Genehmigungsfrist", klasse: "frist" }),
  auflage_frist: Object.freeze({ label: "Auflagenfrist", klasse: "frist" }),
});

/**
 * Agenda groups in display order (German i18n keys).
 * @type {ReadonlyArray<Readonly<{key: 'ueberfaellig'|'heute'|'diese_woche'|'naechste_woche'|'spaeter', label: string}>>}
 */
export const AGENDA_GRUPPEN = Object.freeze([
  Object.freeze({ key: "ueberfaellig", label: "Überfällig" }),
  Object.freeze({ key: "heute", label: "Heute" }),
  Object.freeze({ key: "diese_woche", label: "Diese Woche" }),
  Object.freeze({ key: "naechste_woche", label: "Nächste Woche" }),
  Object.freeze({ key: "spaeter", label: "Später" }),
]);

/** Upper bound of occurrences of one recurring term (T-82-06: a far end date must not hang the page). */
export const WIEDERHOLUNG_MAX = 400;

/**
 * Stable id of a term: source, record and part (e.g. the period or the date of
 * an occurrence) — the key an acknowledgement (Terminquittung) refers to.
 * @param {string} quelle source key ('projekt', 'manuell', …)
 * @param {string} datensatzId id of the record the term comes from
 * @param {string} [teil] distinguishes several terms of one record
 * @returns {string} 'quelle:datensatz[:teil]'
 */
export function terminId(quelle, datensatzId, teil) {
  return teil === undefined || teil === null || teil === "" ? `${quelle}:${datensatzId}` : `${quelle}:${datensatzId}:${teil}`;
}

/** Step of a rhythm: either days or months. */
const SCHRITT = Object.freeze({
  taeglich: { tage: 1 },
  woechentlich: { tage: 7 },
  zweiwoechentlich: { tage: 14 },
  monatlich: { monate: 1 },
  jaehrlich: { monate: 12 },
});

/**
 * Occurrences of a (possibly recurring) term inside [vonIso, bisIso]. Monthly
 * steps are counted from the start date, so 31 January gives 28 February and
 * 31 March (month-end clamp of plusMonate), never a drift to the 28th.
 * Every occurrence gets the id terminId(quelle, id, datum).
 * @param {{id: string, datum: string, quelle?: string, wiederholung?: {rhythmus: string, bis?: string|null}|null} & Record<string, any>} termin
 * @param {string} vonIso 'YYYY-MM-DD' window start
 * @param {string} bisIso 'YYYY-MM-DD' window end (inclusive)
 * @returns {Array<Record<string, any>>} copies with id and datum of each occurrence
 */
export function wiederholungen(termin, vonIso, bisIso) {
  const start = parseTag(termin?.datum);
  if (!start || !parseTag(vonIso) || !parseTag(bisIso)) return [];
  const quelle = termin.quelle || "manuell";
  const regel = termin.wiederholung && SCHRITT[termin.wiederholung.rhythmus];
  const ende = regel ? (parseTag(termin.wiederholung?.bis) || bisIso) : start;
  const grenze = ende < bisIso ? ende : bisIso;
  const aus = [];
  for (let k = 0; k < WIEDERHOLUNG_MAX; k++) {
    const datum = !regel ? start : regel.tage ? plusTage(start, k * regel.tage) : plusMonate(start, k * /** @type {number} */ (regel.monate));
    if (!datum || datum > grenze) break;
    if (datum >= vonIso) aus.push({ ...termin, id: terminId(quelle, termin.id, datum), datum });
    if (!regel) break;
  }
  return aus;
}

/** Sort rank of the classes: deadlines first. */
const KLASSE_RANG = Object.freeze({ frist: 0, termin: 1, hinweis: 2 });

/** Overdue deadlines older than this many days before the window drop out. */
const UEBERFAELLIG_FENSTER_TAGE = 365;

/**
 * Collects the term lists of all sources: one entry per id (the first wins),
 * acknowledged ids marked erledigt, only terms touching [von, bis] — plus open
 * deadlines up to 365 days before `von`, so an overdue deadline stays visible.
 * Sorted by date, then frist < termin < hinweis, then time (all-day first), then id.
 * @param {ReadonlyArray<ReadonlyArray<Termin>|null|undefined>} listen
 * @param {{von: string, bis: string, quittungen?: Iterable<string|{termin_id: string}>|null}} fenster 'YYYY-MM-DD'
 * @returns {Termin[]}
 */
export function sammleTermine(listen, { von, bis, quittungen = null }) {
  const quittiert = new Set();
  for (const q of quittungen || []) quittiert.add(typeof q === "string" ? q : q?.termin_id);
  /** @type {Map<string, Termin>} */
  const jeId = new Map();
  for (const liste of listen || []) {
    for (const t of liste || []) {
      if (!t || !t.id || jeId.has(t.id) || !parseTag(t.datum)) continue;
      jeId.set(t.id, quittiert.has(t.id) ? { ...t, erledigt: true } : t);
    }
  }
  const aus = [...jeId.values()].filter((t) => {
    const letzter = parseTag(t.bis) || t.datum;
    if (t.datum <= bis && letzter >= von) return true;
    // Open deadline before the window: still due, keep it for a year.
    const alter = tageZwischen(t.datum, von);
    return t.klasse === "frist" && !t.erledigt && t.datum < von && alter !== null && alter <= UEBERFAELLIG_FENSTER_TAGE;
  });
  return aus.sort((a, b) => a.datum.localeCompare(b.datum)
    || (KLASSE_RANG[a.klasse] ?? 3) - (KLASSE_RANG[b.klasse] ?? 3)
    || String(a.zeit || "").localeCompare(String(b.zeit || ""))
    || a.id.localeCompare(b.id));
}
