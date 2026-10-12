// Display names of the public holidays (phase 82): the calendar core returns
// snake_case ids (feiertage.js); the UI shows these German labels through t().
// One table for the holidays tab (82-04) and the month grid of /Deadlines (82-03).
//
// In:  nothing (import-free). Out: FEIERTAG_NAMEN, feiertagLabel.

/** Label per holiday id (German, i18n key). */
export const FEIERTAG_NAMEN = Object.freeze({
  neujahr: "Neujahr",
  heilige_drei_koenige: "Heilige Drei Könige",
  karfreitag: "Karfreitag",
  ostermontag: "Ostermontag",
  tag_der_arbeit: "Tag der Arbeit",
  christi_himmelfahrt: "Christi Himmelfahrt",
  pfingstmontag: "Pfingstmontag",
  fronleichnam: "Fronleichnam",
  augsburger_friedensfest: "Augsburger Friedensfest",
  mariae_himmelfahrt: "Mariä Himmelfahrt",
  tag_der_deutschen_einheit: "Tag der Deutschen Einheit",
  allerheiligen: "Allerheiligen",
  weihnachtstag_1: "1. Weihnachtstag",
  weihnachtstag_2: "2. Weihnachtstag",
});

/**
 * Label of a holiday id (the id itself when unknown).
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function feiertagLabel(name) {
  return /** @type {Record<string, string>} */ (FEIERTAG_NAMEN)[String(name)] || String(name || "");
}
