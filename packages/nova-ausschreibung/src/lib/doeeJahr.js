// LO-05 (REVIEW-PANELS): the year of a DÖE monthly package was a free number field — empty became year 0,
// garbage NaN, and those rows never matched a benchmark year. Check before the import is allowed.
//
// In:  the field text, the current year. Out: the year as number or null (invalid).

/** First year with DÖE notice exports [ASSUMED from the review: 2020; the export API starts later, older years simply return no rows]. */
export const DOEE_ERSTES_JAHR = 2020;

/**
 * Valid import year: four digits between DOEE_ERSTES_JAHR and the current year.
 * @param {string|number} text field value
 * @param {number} [aktuellesJahr] current year (tests pass a fixed one)
 * @returns {number|null} year, or null when the import must stay disabled
 */
export function doeeJahr(text, aktuellesJahr = new Date().getFullYear()) {
  const s = String(text ?? "").trim();
  if (!/^\d{4}$/.test(s)) return null;
  const j = Number(s);
  return j >= DOEE_ERSTES_JAHR && j <= aktuellesJahr ? j : null;
}
