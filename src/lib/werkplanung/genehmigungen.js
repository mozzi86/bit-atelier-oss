// genehmigungen.js — permit procedures, their conditions and deviation/exemption
// requests of a project (88-04, RE-08/09/10). Pure: kinds, status flow, the
// statutory deadlines (Bavarian building code BayBO, BauGB) and the hints.
//
// The deadlines are GUIDE VALUES ("Richtwert – prüfen"): every term carries its
// legal source in `herkunft` and `annahme: true`. The app decides nothing — the
// authority's letters are what counts; the office checks against the current text
// of the law (other federal states differ). [ASSUMED] BayBO as of 2026.
//
// Data contracts (schemaless, new):
//   Genehmigung {project_id, art, aktenzeichen, behoerde, eingereicht_am, vollstaendig_am,
//                nachforderung_am, nachforderung_frist, bescheid_am, baubeginn_am, status,
//                begruendung, notiz}
//   Auflage     {project_id, genehmigung_id, nr, text, phase, frist, status, nachweis_ref, erledigt_am}
//   all dates 'YYYY-MM-DD'.
//
// In:  records. Out: ARTEN, STATUS, AUFLAGE_PHASEN, AUFLAGE_STATUS, naechsteStatus,
//      normalisiereGenehmigung, normalisiereAuflage, fristenVon, auflagenFristen, hinweise.

import { fristEnde } from "@core/lib/kalender/fristen.js";

/**
 * Kinds of procedure with their legal basis (German label = i18n key).
 * `begruendungNoetig`: a deviation/exemption has to be justified (Art. 63 Abs. 2 BayBO,
 * § 31 Abs. 2 BauGB).
 * @type {ReadonlyArray<Readonly<{key: string, label: string, norm: string, begruendungNoetig?: boolean}>>}
 */
export const ARTEN = Object.freeze([
  Object.freeze({ key: "bauantrag", label: "Baugenehmigungsverfahren", norm: "Art. 60 BayBO" }),
  Object.freeze({ key: "vereinfacht", label: "Vereinfachtes Verfahren", norm: "Art. 59 BayBO" }),
  Object.freeze({ key: "freistellung", label: "Genehmigungsfreistellung", norm: "Art. 58 BayBO" }),
  Object.freeze({ key: "teilbaugenehmigung", label: "Teilbaugenehmigung", norm: "Art. 70 BayBO" }),
  Object.freeze({ key: "vorbescheid", label: "Vorbescheid", norm: "Art. 71 BayBO" }),
  Object.freeze({ key: "abweichung", label: "Abweichung", norm: "Art. 63 BayBO", begruendungNoetig: true }),
  Object.freeze({ key: "befreiung", label: "Befreiung", norm: "§ 31 Abs. 2 BauGB", begruendungNoetig: true }),
]);

/** Status of a procedure (German label = i18n key); `fertig` ends the procedure. */
export const STATUS = Object.freeze([
  Object.freeze({ key: "vorbereitung", label: "In Vorbereitung" }),
  Object.freeze({ key: "eingereicht", label: "Eingereicht" }),
  Object.freeze({ key: "nachforderung", label: "Nachforderung" }),
  Object.freeze({ key: "genehmigt", label: "Genehmigt", fertig: true }),
  Object.freeze({ key: "abgelehnt", label: "Abgelehnt", fertig: true }),
  Object.freeze({ key: "zurueckgezogen", label: "Zurückgezogen", fertig: true }),
]);

/** Allowed next status — forward only; a requested addition goes back to "eingereicht" once delivered. */
const UEBERGAENGE = Object.freeze({
  vorbereitung: ["eingereicht", "zurueckgezogen"],
  eingereicht: ["nachforderung", "genehmigt", "abgelehnt", "zurueckgezogen"],
  nachforderung: ["eingereicht", "genehmigt", "abgelehnt", "zurueckgezogen"],
  genehmigt: [], abgelehnt: [], zurueckgezogen: [],
});

/** Phases of a condition (German label = i18n key). */
export const AUFLAGE_PHASEN = Object.freeze([
  Object.freeze({ key: "vor_baubeginn", label: "Vor Baubeginn" }),
  Object.freeze({ key: "rohbau", label: "Rohbau" }),
  Object.freeze({ key: "vor_nutzung", label: "Vor Nutzungsaufnahme" }),
  Object.freeze({ key: "laufend", label: "Laufend" }),
]);

/** Status of a condition (German label = i18n key). */
export const AUFLAGE_STATUS = Object.freeze([
  Object.freeze({ key: "offen", label: "Offen" }),
  Object.freeze({ key: "erfuellt", label: "Erfüllt" }),
  Object.freeze({ key: "entfallen", label: "Entfallen" }),
]);

/**
 * Statutory deadlines — [ASSUMED] BayBO 2026, guide values to be checked.
 * dauer in calendar units of fristEnde (§§ 187, 188 BGB event deadline).
 */
export const FRISTEN = Object.freeze({
  /** Completeness check within 3 weeks after receipt (Art. 65 Abs. 2 BayBO). */
  vollstaendigkeit: Object.freeze({ dauer: { wochen: 3 }, herkunft: "Art. 65 Abs. 2 BayBO" }),
  /** Deemed permit in the simplified procedure 3 months after completeness (Art. 68 Abs. 2 BayBO). */
  fiktion: Object.freeze({ dauer: { monate: 3 }, herkunft: "Art. 68 Abs. 2 BayBO" }),
  /** Exemption: building may start 1 month after submission (Art. 58 Abs. 3 BayBO). */
  wartefrist: Object.freeze({ dauer: { monate: 1 }, herkunft: "Art. 58 Abs. 3 BayBO" }),
  /** Permit lapses 4 years after notice unless construction started (Art. 69 Abs. 1 BayBO). */
  geltung: Object.freeze({ dauer: { jahre: 4 }, herkunft: "Art. 69 Abs. 1 BayBO" }),
  /** Preliminary decision is valid 3 years (Art. 71 Satz 2 BayBO). */
  geltungVorbescheid: Object.freeze({ dauer: { jahre: 3 }, herkunft: "Art. 71 Satz 2 BayBO" }),
});

/** @param {string} key */
const art = (key) => ARTEN.find((a) => a.key === key) || null;
/** @param {string} key */
const fertig = (key) => !!STATUS.find((s) => s.key === key && /** @type {any} */ (s).fertig);
/** @param {unknown} v @returns {string|null} */
const tagOderNull = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/**
 * Next status a procedure may move to (forward only).
 * @param {string} status
 * @returns {string[]}
 */
export function naechsteStatus(status) {
  return [.../** @type {Record<string, string[]>} */ (UEBERGAENGE)[status] || []];
}

/**
 * Cleans a procedure: known kind/status, dates as days or null.
 * @param {Record<string, any>} roh
 * @returns {Record<string, any>}
 */
export function normalisiereGenehmigung(roh) {
  /** @type {Record<string, any>} */
  const g = { ...roh, art: art(roh?.art) ? roh.art : "bauantrag", status: STATUS.some((s) => s.key === roh?.status) ? roh.status : "vorbereitung" };
  for (const f of ["eingereicht_am", "vollstaendig_am", "nachforderung_am", "nachforderung_frist", "bescheid_am", "baubeginn_am"]) g[f] = tagOderNull(roh?.[f]);
  for (const f of ["aktenzeichen", "behoerde", "begruendung", "notiz"]) g[f] = String(roh?.[f] || "").trim();
  return g;
}

/**
 * Cleans a condition.
 * @param {Record<string, any>} roh
 * @returns {Record<string, any>}
 */
export function normalisiereAuflage(roh) {
  return {
    ...roh,
    nr: String(roh?.nr || "").trim(), text: String(roh?.text || "").trim(),
    phase: AUFLAGE_PHASEN.some((p) => p.key === roh?.phase) ? roh.phase : "laufend",
    status: AUFLAGE_STATUS.some((s) => s.key === roh?.status) ? roh.status : "offen",
    frist: tagOderNull(roh?.frist), erledigt_am: tagOderNull(roh?.erledigt_am), nachweis_ref: String(roh?.nachweis_ref || "").trim(),
  };
}

/**
 * One deadline of a procedure.
 * @typedef {{schluessel: 'vollstaendigkeit'|'fiktion'|'wartefrist'|'geltung'|'nachforderung', label: string, datum: string, herkunft: string, erledigt: boolean}} GenehmigungsFrist
 *   label: German i18n key
 */

/**
 * The deadlines of a procedure, derived from its dates. A deadline is done when the
 * step it waits for happened (completeness confirmed, notice received, construction
 * started, addition delivered) or the procedure ended otherwise.
 * @param {Record<string, any>} roh Genehmigung
 * @returns {GenehmigungsFrist[]} sorted by date
 */
export function fristenVon(roh) {
  const g = normalisiereGenehmigung(roh);
  const ende = fertig(g.status);
  /** @type {GenehmigungsFrist[]} */
  const aus = [];
  const add = (/** @type {GenehmigungsFrist['schluessel']} */ schluessel, /** @type {string} */ label, /** @type {string|null} */ datum, /** @type {string} */ herkunft, /** @type {boolean} */ erledigt) => {
    if (datum) aus.push({ schluessel, label, datum, herkunft, erledigt });
  };
  if (g.eingereicht_am && g.art !== "freistellung") {
    add("vollstaendigkeit", "Vollständigkeitsprüfung der Behörde", fristEnde(g.eingereicht_am, FRISTEN.vollstaendigkeit.dauer), FRISTEN.vollstaendigkeit.herkunft,
      !!g.vollstaendig_am || g.status === "nachforderung" || ende);
  }
  if (g.art === "vereinfacht" && g.vollstaendig_am) {
    add("fiktion", "Genehmigungsfiktion", fristEnde(g.vollstaendig_am, FRISTEN.fiktion.dauer), FRISTEN.fiktion.herkunft, !!g.bescheid_am || ende);
  }
  if (g.art === "freistellung" && g.eingereicht_am) {
    add("wartefrist", "Baubeginn frühestens", fristEnde(g.eingereicht_am, FRISTEN.wartefrist.dauer), FRISTEN.wartefrist.herkunft, !!g.baubeginn_am || (ende && g.status !== "genehmigt"));
  }
  if (g.status === "nachforderung" && g.nachforderung_frist) {
    add("nachforderung", "Nachforderung einreichen", g.nachforderung_frist, "Schreiben der Behörde", false);
  }
  if (g.status === "genehmigt" && g.bescheid_am && ["bauantrag", "vereinfacht", "teilbaugenehmigung", "vorbescheid"].includes(g.art)) {
    const regel = g.art === "vorbescheid" ? FRISTEN.geltungVorbescheid : FRISTEN.geltung;
    add("geltung", g.art === "vorbescheid" ? "Vorbescheid gilt bis" : "Genehmigung erlischt ohne Baubeginn", fristEnde(g.bescheid_am, regel.dauer), regel.herkunft,
      g.art !== "vorbescheid" && !!g.baubeginn_am);
  }
  return aus.sort((a, b) => a.datum.localeCompare(b.datum));
}

/**
 * The deadlines of the conditions of a project: one per condition with a date.
 * @param {ReadonlyArray<Record<string, any>>} auflagen
 * @returns {Array<{auflage: Record<string, any>, datum: string, erledigt: boolean}>}
 */
export function auflagenFristen(auflagen) {
  return (auflagen || []).map(normalisiereAuflage).filter((a) => a.frist).map((a) => ({ auflage: a, datum: /** @type {string} */ (a.frist), erledigt: a.status !== "offen" }));
}

/**
 * Hints of a procedure (warn only — the office decides; a missing justification or
 * an open pre-start condition is a liability risk to see, not a block):
 *   'begruendung_fehlt'      deviation/exemption without justification;
 *   'auflage_vor_baubeginn'  a condition "before start" still open although a start date is entered;
 *   'baubeginn_vor_freigabe' start date before the permit/waiting period.
 * @param {Record<string, any>} roh Genehmigung
 * @param {ReadonlyArray<Record<string, any>>} [auflagen] all conditions (filtered to this procedure)
 * @returns {Array<{art: string, werte: Record<string, any>}>}
 */
export function hinweise(roh, auflagen = []) {
  const g = normalisiereGenehmigung(roh);
  /** @type {Array<{art: string, werte: Record<string, any>}>} */
  const aus = [];
  if (art(g.art)?.begruendungNoetig && !g.begruendung) aus.push({ art: "begruendung_fehlt", werte: { norm: art(g.art)?.norm } });
  if (g.baubeginn_am) {
    const offen = (auflagen || []).map(normalisiereAuflage).filter((a) => a.genehmigung_id === g.id && a.phase === "vor_baubeginn" && a.status === "offen");
    if (offen.length) aus.push({ art: "auflage_vor_baubeginn", werte: { anzahl: offen.length } });
    const wartefrist = g.art === "freistellung" && g.eingereicht_am ? fristEnde(g.eingereicht_am, FRISTEN.wartefrist.dauer) : null;
    const frei = g.art === "freistellung" ? wartefrist : g.bescheid_am;
    if (["bauantrag", "vereinfacht", "freistellung", "teilbaugenehmigung"].includes(g.art) && (!frei || g.baubeginn_am < frei)) aus.push({ art: "baubeginn_vor_freigabe", werte: { frei } });
  }
  return aus;
}
