// Comparison of the office calendar with the calculation basis of the cost
// rates (phase 82, E-16): how many public holidays the calendar has in a year
// versus zeit_honorar.feiertage (81, 13 days). A difference is a hint only —
// the basis is never overwritten silently.
//
// Moved here from ./kalenderRegeln.js in wave 1 (B-81-04): kalenderRegeln.js is
// part of the entry chunk (rule registry), this function needs the holiday
// tables of all 16 states, and only the lazily loaded holiday and cost-rate
// tabs call it.
//
// In:  the calendar core. Out: feiertagsAbgleich.

import { feiertage } from "@core/lib/kalender/feiertage.js";
import { wochentag } from "@core/lib/kalender/datum.js";

/**
 * Compares the calendar with the calculation basis zeit_honorar.feiertage (81).
 * A difference is a hint (warn) — the basis is never overwritten.
 * @param {number} jahr year
 * @param {{bundesland: string, mariae_himmelfahrt: boolean, augsburger_friedensfest: boolean}} einst office calendar setting (kalenderEinstellung)
 * @param {number} kalkulationTage value of zeit_honorar.feiertage (days per year)
 * @returns {{kalender: number, anWochentagen: number, kalkulation: number, abweichend: boolean}} counts in days
 */
export function feiertagsAbgleich(jahr, einst, kalkulationTage) {
  const liste = feiertage(jahr, einst);
  const anWochentagen = liste.filter((f) => {
    const w = wochentag(f.datum);
    return typeof w === "number" && w >= 1 && w <= 5;
  }).length;
  return { kalender: liste.length, anWochentagen, kalkulation: Number(kalkulationTage) || 0, abweichend: liste.length !== Number(kalkulationTage) };
}
