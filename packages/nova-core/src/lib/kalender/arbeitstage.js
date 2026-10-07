// Calendar core, part 3: working days. A tax due on a Saturday, Sunday or
// public holiday moves to the next working day (§ 108 Abs. 3 AO). v1 uses the
// nation-wide holidays only (./feiertage.js).
//
// In:  'YYYY-MM-DD'. Out: boolean / 'YYYY-MM-DD'. UTC only.

import { jahrVon, parseTag, plusTage, wochentag } from "./datum.js";
import { feiertageBund } from "./feiertage.js";

/** Holidays per year, computed once. @type {Map<number, Set<string>>} */
const feiertagCache = new Map();

/**
 * @param {number} jahr
 * @returns {Set<string>} holiday dates of that year
 */
function feiertageVon(jahr) {
  if (!feiertagCache.has(jahr)) feiertagCache.set(jahr, new Set(feiertageBund(jahr).map((f) => f.datum)));
  return /** @type {Set<string>} */ (feiertagCache.get(jahr));
}

/**
 * True for Monday–Friday that is not a nation-wide public holiday.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {boolean} false for invalid dates
 */
export function istWerktag(tagIso) {
  const s = parseTag(tagIso);
  if (!s) return false;
  const wt = /** @type {number} */ (wochentag(s));
  if (wt === 0 || wt === 6) return false;
  return !feiertageVon(/** @type {number} */ (jahrVon(s))).has(s);
}

/**
 * The date itself when it is a working day, otherwise the next working day
 * (§ 108 Abs. 3 AO): 2026-04-03 (Good Friday) → 2026-04-07.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {string|null} null for an invalid date
 */
export function naechsterWerktag(tagIso) {
  let s = parseTag(tagIso);
  if (!s) return null;
  // At most a long weekend plus holidays; 10 steps is a safe bound.
  for (let i = 0; i < 10 && !istWerktag(s); i++) s = /** @type {string} */ (plusTage(s, 1));
  return s;
}
