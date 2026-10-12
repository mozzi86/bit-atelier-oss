// abnahme.js — data contract of an acceptance (Abnahme) for the warranty
// calendar (phase 82, 82-01 contract; the period rules live in 82-03).
//
// The rule set (VOB/B, BGB or individual) is mandatory and has NO default: the
// warranty period differs by years, and a silently assumed VOB/B would remind a
// year too early (BGB 5 years vs. VOB/B 4 years for a building). An acceptance
// without a rule is stored but marked invalid ("Regel fehlt").
//
// Pure. In: raw acceptance records. Out: ABNAHME_REGELN, ABNAHME_KATEGORIEN,
// SICHERHEIT_ARTEN (German labels = i18n keys), normalisiereAbnahme.

/** Rule sets of the warranty. */
export const ABNAHME_REGELN = Object.freeze({
  vob: Object.freeze({ label: "VOB/B" }),
  bgb: Object.freeze({ label: "BGB" }),
  individuell: Object.freeze({ label: "Individuell vereinbart" }),
});

/** Kinds of work (decide the period). */
export const ABNAHME_KATEGORIEN = Object.freeze({
  bauwerk: Object.freeze({ label: "Bauwerk" }),
  sonstige: Object.freeze({ label: "Andere Werke" }),
  wartungsanlage: Object.freeze({ label: "Wartungsrelevante Anlage" }),
});

/** Kinds of security for defects. */
export const SICHERHEIT_ARTEN = Object.freeze({
  keine: Object.freeze({ label: "Keine Sicherheit" }),
  buergschaft: Object.freeze({ label: "Bürgschaft" }),
  einbehalt: Object.freeze({ label: "Einbehalt" }),
});

/**
 * Cleans an acceptance record: known values only, years as a number or null.
 * @param {Record<string, any>} roh
 * @returns {Record<string, any> & {regel: string|null, gueltig: boolean, grund: string|null}}
 *   grund = German reason key when invalid ('Regel fehlt', 'Datum fehlt')
 */
export function normalisiereAbnahme(roh) {
  const a = roh || {};
  const regel = Object.prototype.hasOwnProperty.call(ABNAHME_REGELN, a.regel) ? a.regel : null;
  const kategorie = Object.prototype.hasOwnProperty.call(ABNAHME_KATEGORIEN, a.kategorie) ? a.kategorie : "bauwerk";
  const sicherheit = Object.prototype.hasOwnProperty.call(SICHERHEIT_ARTEN, a.sicherheit_art) ? a.sicherheit_art : "keine";
  const jahre = Number.isFinite(Number(a.jahre)) && a.jahre !== null && a.jahre !== "" ? Number(a.jahre) : null;
  const datumOk = typeof a.datum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.datum);
  const grund = !regel ? "Regel fehlt" : !datumOk ? "Datum fehlt" : null;
  return {
    ...a,
    regel,
    kategorie,
    sicherheit_art: sicherheit,
    jahre,
    wartungsvertrag: a.wartungsvertrag === true,
    teilabnahme: a.teilabnahme === true,
    eigene_leistung: a.eigene_leistung === true,
    gueltig: grund === null,
    grund,
  };
}
