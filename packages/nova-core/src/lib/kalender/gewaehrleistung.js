// gewaehrleistung.js — warranty terms from acceptances (phase 82, 82-03, FRIST-03).
//
// Norms (applied as reminders, never as legal advice — Anwalts-Prüfliste 78-09):
// - VOB/B § 13 Abs. 4 Nr. 1: building 4 years, other works 2 years; Nr. 2:
//   systems requiring maintenance without a maintenance contract 2 years —
//   VOB/B applies ONLY when it was agreed, so the rule set is a mandatory
//   choice of the acceptance and never assumed (a silently assumed VOB/B would
//   remind a year before the BGB period ends).
// - BGB § 634a Abs. 1 Nr. 2: building 5 years; Nr. 1: other works 2 years.
// - BGB § 650s: partial acceptance of the architect's own work at the end of
//   LPH 8 starts the architect's own 5-year period (§ 634a Abs. 1 Nr. 2).
// - VOB/B § 17 Abs. 8 Nr. 2: a security for defects is returned after 2 years.
// - HOAI Anlage 10 LPH 9: inspection "before the limitation periods end" — the
//   lead time is an office value [ASSUMED], flagged as annahme.
// - BGB §§ 187, 188: the period ends on the day with the same number
//   (fristEnde of the calendar core); § 193 BGB is only shown as info and the
//   reminder is NOT moved (D-P82-09: reminding before a weekend is the safe side).
//
// Years come in through `regelWert` (rules fristen.* of 82-01, E-16) — no
// constant in here. Every check is a warning, never a failure: a reminder that
// cannot be computed must not block entering the acceptance (liability choice).
//
// Pure. In: acceptances, rule reader. Out: termineAusAbnahmen.

import { fristEnde } from "./fristen.js";
import { plusMonate, wochentag } from "./datum.js";
import { terminId } from "./termin.js";
import { normalisiereAbnahme } from "./abnahme.js";

/** Plain-text info for a period end on a weekend (German i18n key). */
export const WOCHENENDE_INFO = "Fällt auf ein Wochenende — § 193 BGB ggf. anwendbar (ungeprüft)";

/**
 * Years and norm of the warranty of an acceptance.
 * @param {Record<string, any>} a normalised acceptance
 * @param {(id: string) => any} regelWert
 * @returns {{jahre: number|null, herkunft: string}}
 */
function gewaehrleistungsJahre(a, regelWert) {
  const zahl = (/** @type {string} */ id) => {
    const w = Number(regelWert(id));
    return Number.isFinite(w) && w > 0 ? w : null;
  };
  if (a.regel === "individuell") return { jahre: a.jahre && a.jahre > 0 ? a.jahre : null, herkunft: "Individuell vereinbart" };
  if (a.regel === "vob") {
    if (a.kategorie === "sonstige") return { jahre: zahl("fristen.vob_sonstige_jahre"), herkunft: "VOB/B § 13 Abs. 4 Nr. 1" };
    if (a.kategorie === "wartungsanlage" && !a.wartungsvertrag) return { jahre: zahl("fristen.vob_wartungsanlage_jahre"), herkunft: "VOB/B § 13 Abs. 4 Nr. 2" };
    return { jahre: zahl("fristen.vob_bauwerk_jahre"), herkunft: "VOB/B § 13 Abs. 4 Nr. 1" };
  }
  if (a.kategorie === "sonstige") return { jahre: zahl("fristen.bgb_sonstige_jahre"), herkunft: "BGB § 634a Abs. 1 Nr. 1" };
  return { jahre: zahl("fristen.bgb_bauwerk_jahre"), herkunft: "BGB § 634a Abs. 1 Nr. 2" };
}

/**
 * Weekend info of a day.
 * @param {string} tagIso
 * @returns {string|null}
 */
function wochenendeInfo(tagIso) {
  const w = wochentag(tagIso);
  return w === 0 || w === 6 ? WOCHENENDE_INFO : null;
}

/**
 * Terms of the acceptances: end of warranty, inspection before it, return of
 * the security (VOB/B § 17 Abs. 8 Nr. 2), and for the own work (§ 650s) the end
 * of the architect's liability instead of a warranty end.
 * @param {ReadonlyArray<Record<string, any>>} abnahmen raw Abnahme records
 * @param {(id: string) => any} regelWert reader of the rules fristen.*
 * @returns {{termine: import("./termin.js").Termin[], warnungen: Array<{abnahme_id: string, grund: string}>}}
 *   grund = German i18n key ('Regel fehlt', 'Datum fehlt', 'Frist fehlt')
 */
export function termineAusAbnahmen(abnahmen, regelWert) {
  /** @type {import("./termin.js").Termin[]} */
  const termine = [];
  /** @type {Array<{abnahme_id: string, grund: string}>} */
  const warnungen = [];
  for (const roh of abnahmen || []) {
    const a = normalisiereAbnahme(roh);
    if (!a.id) continue;
    if (!a.gueltig) {
      warnungen.push({ abnahme_id: a.id, grund: /** @type {string} */ (a.grund) });
      continue;
    }
    const basis = { quelle: "abnahme", project_id: a.project_id || null, modul: "fristen", objekt: String(a.gewerk || ""), ziel: "/Deadlines?tab=warranty" };

    if (a.eigene_leistung) {
      // § 650s BGB: the own work's period runs from the partial acceptance.
      const jahre = Number(regelWert("fristen.architektenhaftung_jahre"));
      const ende = Number.isFinite(jahre) && jahre > 0 ? fristEnde(a.datum, { jahre }) : null;
      if (!ende) { warnungen.push({ abnahme_id: a.id, grund: "Frist fehlt" }); continue; }
      termine.push({ ...basis, id: terminId("abnahme", a.id, "haftung"), art: "architektenhaftung_ende", klasse: "hinweis", datum: ende,
        herkunft: "BGB § 650s, § 634a Abs. 1 Nr. 2", ...(wochenendeInfo(ende) ? { info: wochenendeInfo(ende) } : {}) });
      continue;
    }

    const { jahre, herkunft } = gewaehrleistungsJahre(a, regelWert);
    const ende = jahre ? fristEnde(a.datum, { jahre }) : null;
    if (!ende) { warnungen.push({ abnahme_id: a.id, grund: "Frist fehlt" }); continue; }
    termine.push({ ...basis, id: terminId("abnahme", a.id, "gewaehrleistung_ende"), art: "gewaehrleistung_ende", klasse: "frist", datum: ende, herkunft,
      ...(wochenendeInfo(ende) ? { info: wochenendeInfo(ende) } : {}) });

    const vorlauf = Number(regelWert("fristen.begehung_vorlauf_monate"));
    const begehung = Number.isFinite(vorlauf) && vorlauf >= 0 ? plusMonate(ende, -vorlauf) : null;
    if (begehung) {
      termine.push({ ...basis, id: terminId("abnahme", a.id, "begehung"), art: "begehung_vor_ablauf", klasse: "frist", datum: begehung,
        herkunft: "HOAI Anlage 10 LPH 9", annahme: true });
    }

    if (a.sicherheit_art !== "keine") {
      const rueck = Number(regelWert("fristen.sicherheit_rueckgabe_jahre"));
      const datum = Number.isFinite(rueck) && rueck > 0 ? fristEnde(a.datum, { jahre: rueck }) : null;
      if (datum) {
        termine.push({ ...basis, id: terminId("abnahme", a.id, "sicherheit"), art: "sicherheit_rueckgabe", klasse: "frist", datum,
          herkunft: "VOB/B § 17 Abs. 8 Nr. 2", erledigt: Boolean(a.sicherheit_rueckgabe_am) });
      }
    }
  }
  return { termine, warnungen };
}
