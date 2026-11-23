// Calendar core, part 2a: the federal-state codes and the office's standard
// calendar setting, WITHOUT the holiday tables.
//
// Why a separate module (wave 1 / B-81-04): the rule registry
// (src/lib/settings/regelwerke.js → src/lib/abwesenheit/kalenderRegeln.js) is
// part of the entry chunk and needs only these two values for the rule
// "kalender.bundesland". Importing them from ./feiertage.js pulled the holiday
// tables of all 16 states into the entry. ./feiertage.js re-exports both, so
// existing imports keep working; entry-side code imports them from here.
//
// In:  nothing. Out: BUNDESLAENDER, KALENDER_STANDARD.

/**
 * The 16 federal states as the official two-letter codes (ISO 3166-2:DE
 * without the "DE-" prefix), in the order of the Federal Statistical Office.
 * ./feiertage.js has one table row per code (unit test kalender-laender-w1).
 * @type {ReadonlyArray<string>}
 */
export const BUNDESLAENDER = Object.freeze(["SH", "HH", "NI", "HB", "NW", "HE", "RP", "BW", "BY", "SL", "BE", "BB", "MV", "SN", "ST", "TH"]);

/**
 * Calendar setting of the office: federal state and the two Bavarian holidays
 * that depend on the municipality. [ASSUMED] Bavaria with Assumption Day
 * (15.8.) as the office standard; whether 15.8. is a holiday at the office
 * depends on its municipality (Art. 1 Abs. 1 Nr. 2 BayFTG: municipalities with
 * a predominantly Catholic population) and is UNVERIFIED for the office
 * address. Way to a confirmed value: the municipality list of the Bavarian
 * State Office for Statistics. The Augsburg Peace Festival (8.8.) applies only
 * in the city of Augsburg (Art. 1 Abs. 2 BayFTG), so it is off. The office
 * changes all three in Settings › Regelwerke (rule group "kalender").
 * @type {Readonly<{bundesland: string, mariae_himmelfahrt: boolean, augsburger_friedensfest: boolean}>}
 */
export const KALENDER_STANDARD = Object.freeze({ bundesland: "BY", mariae_himmelfahrt: true, augsburger_friedensfest: false });
