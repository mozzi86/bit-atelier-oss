// Calendar settings of the office (phase 82, E-16) as rules of the rule core
// (80-01): federal state (all 16 since wave 1 / B-81-04), the two Bavarian local holidays, Christmas Eve / New
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
// In:  the state codes and the standard setting of the calendar core. Out: KALENDER_STAND, BUNDESLAND_NAMEN,
//      KALENDER_REGELN, KALENDER_REGELWERK, kalenderEinstellung. (feiertagsAbgleich moved to ./feiertagsAbgleich.js in
//      wave 1 / B-81-04 so that the holiday tables stay out of the entry chunk.)

// Codes and standard only, not the holiday tables: this module is part of the
// entry chunk (regelwerke.js); feiertagsAbgleich lives in ./feiertagsAbgleich.js.
import { BUNDESLAENDER, KALENDER_STANDARD } from "@core/lib/kalender/bundeslaender.js";

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

const QUELLE_BY = "BayFTG Art. 1; Gemeindeliste Bayerisches Landesamt für Statistik — Status der Bürogemeinde prüfen";

/** Source of the state choice: the holiday laws of the 16 states (table in @core/lib/kalender/feiertage.js). */
const QUELLE_LAENDER = "Feiertagsgesetze der Länder (Stand 2026; Abgleich mit den Gesetzestexten offen)";

/**
 * German display names of the federal states (i18n keys), codes of BUNDESLAENDER.
 * @type {Readonly<Record<string, string>>}
 */
export const BUNDESLAND_NAMEN = Object.freeze({
  BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg",
  HE: "Hessen", MV: "Mecklenburg-Vorpommern", NI: "Niedersachsen", NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz",
  SL: "Saarland", SN: "Sachsen", ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen",
});

/**
 * The rules of the group "Kalender & Abwesenheiten".
 * @type {ReadonlyArray<import("@core/lib/regelwerk.js").Regel>}
 */
export const KALENDER_REGELN = tiefGefroren([
  regel({ id: "bundesland", label: "Bundesland der Feiertage", einheit: "Land", typ: "auswahl", wert: KALENDER_STANDARD.bundesland, abschnitt: A_FEIERTAGE,
    quelle: QUELLE_LAENDER, optionen: BUNDESLAENDER.map((wert) => ({ wert, label: BUNDESLAND_NAMEN[wert] })),
    assumed: "Bayern als Bürositz; Fronleichnam in einzelnen Gemeinden Sachsens und Thüringens ist nicht enthalten (keine Gemeinde im Kalender)" }),
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
