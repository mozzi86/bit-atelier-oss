// Calendar settings of the office (phase 82, E-16) as rules of the rule core
// (80-01): federal state, the two Bavarian local holidays, Christmas Eve / New
// Year's Eve, how many people may be absent at once, and the working-day
// pattern of part-time contracts.
//
// One holiday setting for absences, the month view and — from 82-04 on — the
// time tracking (81): kalenderEinstellung(wert) turns the rules into the
// `einst` of the calendar core's feiertage(jahr, einst). The standard values of
// the first three rules ARE KALENDER_STANDARD of the calendar core (imported,
// no second constant). The cost-rate basis zeit_honorar.feiertage (81, 13 days)
// stays the calculation basis (E-16) and is only compared (feiertagsAbgleich),
// never overwritten silently.
//
// In:  the calendar core. Out: KALENDER_STAND, KALENDER_REGELN, KALENDER_REGELWERK,
//      kalenderEinstellung, feiertagsAbgleich.

import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { wochentag } from "@core/lib/kalender/datum.js";

/** Date the values below were set ('YYYY-MM-DD'). */
export const KALENDER_STAND = "2026-01-01";

const A_FEIERTAGE = "Feiertage";
const A_ABWESENHEIT = "Abwesenheiten";

/**
 * @template T
 * @param {T} wert
 * @returns {T}
 */
function tiefGefroren(wert) {
  if (wert && typeof wert === "object" && !Object.isFrozen(wert)) {
    for (const k of Object.keys(wert)) tiefGefroren(/** @type {any} */ (wert)[k]);
    Object.freeze(wert);
  }
  return wert;
}

/**
 * @param {{id: string, label: string, einheit: string, typ: string, wert: any, abschnitt: string, quelle: string,
 *   assumed?: string, optionen?: Array<{wert: string, label: string}>, grenze?: {min?: number, max?: number, modus: 'fail'|'warn', quelle?: string}}} r
 * @returns {import("@core/lib/regelwerk.js").Regel}
 */
function regel({ id, wert, quelle, ...rest }) {
  return /** @type {any} */ ({ ...rest, id: `kalender.${id}`, art: "buero", editierbar: true, werte: [{ ab: KALENDER_STAND, wert, quelle }], stand: KALENDER_STAND, quelle });
}

const QUELLE_BY = "BayFTG Art. 1; Gemeindeliste Bayerisches Landesamt für Statistik — Status Nürnberg prüfen";

/**
 * The rules of the group "Kalender & Abwesenheiten".
 * @type {ReadonlyArray<import("@core/lib/regelwerk.js").Regel>}
 */
export const KALENDER_REGELN = tiefGefroren([
  regel({ id: "bundesland", label: "Bundesland der Feiertage", einheit: "Land", typ: "auswahl", wert: KALENDER_STANDARD.bundesland, abschnitt: A_FEIERTAGE,
    quelle: QUELLE_BY, optionen: [{ wert: "BY", label: "Bayern" }],
    assumed: "Bayern als Bürositz; andere Länder kennt der Kalender-Kern noch nicht" }),
  regel({ id: "mariae_himmelfahrt", label: "Mariä Himmelfahrt (15.08.) ist Feiertag", einheit: "ja/nein", typ: "ja_nein", wert: KALENDER_STANDARD.mariae_himmelfahrt, abschnitt: A_FEIERTAGE,
    quelle: QUELLE_BY, assumed: "Nur in Gemeinden mit überwiegend katholischer Bevölkerung — für den Bürositz prüfen" }),
  regel({ id: "augsburger_friedensfest", label: "Augsburger Friedensfest (08.08.) ist Feiertag", einheit: "ja/nein", typ: "ja_nein", wert: KALENDER_STANDARD.augsburger_friedensfest, abschnitt: A_FEIERTAGE,
    quelle: QUELLE_BY }),
  regel({ id: "heiligabend_silvester", label: "Heiligabend und Silvester", einheit: "Regel", typ: "auswahl", wert: "arbeitstag", abschnitt: A_FEIERTAGE,
    quelle: "Annahme Phase 82 (kein gesetzlicher Feiertag)",
    optionen: [{ wert: "arbeitstag", label: "Arbeitstag" }, { wert: "halb", label: "halber Tag" }, { wert: "frei", label: "frei" }],
    assumed: "Gesetzlich Arbeitstage; viele Büros geben sie ganz oder halb frei — vom Büro festzulegen" }),
  regel({ id: "max_gleichzeitig_abwesend", label: "Höchstens gleichzeitig abwesend", einheit: "Personen", typ: "zahl", wert: 2, abschnitt: A_ABWESENHEIT,
    quelle: "Annahme Phase 82 (Bürostandard)", assumed: "Hinweis ab drei gleichzeitig Abwesenden — vom Büro festzulegen",
    grenze: { min: 1, max: 50, modus: "warn" } }),
  regel({ id: "arbeitstage_muster", label: "Arbeitstage bei Teilzeit", einheit: "Muster", typ: "auswahl", wert: "erste_n", abschnitt: A_ABWESENHEIT,
    quelle: "Annahme Phase 82", optionen: [{ wert: "erste_n", label: "die ersten n Wochentage ab Montag" }],
    assumed: "Phase 80 speichert nur die Anzahl der Arbeitstage — die Tage selbst sind angenommen (Befund an 80)" }),
]);

/** The group in the rule book (80 RegelGruppe form). */
export const KALENDER_REGELWERK = Object.freeze({
  gruppe: "kalender",
  titel: "Kalender & Abwesenheiten",
  regeln: /** @type {any} */ (KALENDER_REGELN),
  speicher: Object.freeze({ art: /** @type {const} */ ("zeilen") }),
  sichtbar: (/** @type {any} */ k) => k?.datenquelle !== "supabase" || k?.buchhaltungCloud === true,
});

/**
 * The one holiday setting of the office for feiertage(jahr, einst).
 * @param {(id: string) => any} wert rule reader of useRegelWerte(REGELWERKE)
 * @returns {{bundesland: string, mariae_himmelfahrt: boolean, augsburger_friedensfest: boolean}}
 */
export function kalenderEinstellung(wert) {
  const lies = (/** @type {string} */ id, /** @type {any} */ standard) => {
    const w = typeof wert === "function" ? wert(id) : undefined;
    return w === undefined || w === null ? standard : w;
  };
  return {
    bundesland: lies("kalender.bundesland", KALENDER_STANDARD.bundesland),
    mariae_himmelfahrt: lies("kalender.mariae_himmelfahrt", KALENDER_STANDARD.mariae_himmelfahrt) === true,
    augsburger_friedensfest: lies("kalender.augsburger_friedensfest", KALENDER_STANDARD.augsburger_friedensfest) === true,
  };
}

/**
 * Compares the calendar with the calculation basis zeit_honorar.feiertage (81).
 * A difference is a hint (warn) — the basis is never overwritten.
 * @param {number} jahr
 * @param {{bundesland: string, mariae_himmelfahrt: boolean, augsburger_friedensfest: boolean}} einst
 * @param {number} kalkulationTage value of zeit_honorar.feiertage (days per year)
 * @returns {{kalender: number, anWochentagen: number, kalkulation: number, abweichend: boolean}} days
 */
export function feiertagsAbgleich(jahr, einst, kalkulationTage) {
  const liste = feiertage(jahr, einst);
  const anWochentagen = liste.filter((f) => {
    const w = wochentag(f.datum);
    return typeof w === "number" && w >= 1 && w <= 5;
  }).length;
  return { kalender: liste.length, anWochentagen, kalkulation: Number(kalkulationTage) || 0, abweichend: liste.length !== Number(kalkulationTage) };
}
