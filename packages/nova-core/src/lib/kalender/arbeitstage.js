// Calendar core, part 3: working days. A tax due on a Saturday, Sunday or
// public holiday moves to the next working day (§ 108 Abs. 3 AO). v1 uses the
// nation-wide holidays only (./feiertage.js).
//
// In:  'YYYY-MM-DD'. Out: boolean / 'YYYY-MM-DD'. UTC only.
//
// Phase 81 (81-01) adds functions that take the holiday list as a PARAMETER
// (the office's state holidays from feiertage(jahr, einst)): istArbeitstag,
// naechsterArbeitstag, zaehleTage and sollMinuten (target working time of the
// time tracking). istWerktag/naechsterWerktag above stay unchanged — they keep
// the nation-wide list and their cache, as phase 79 built them.

import { jahrVon, parseTag, plusTage, tageZwischen, wochentag } from "./datum.js";
import { feiertage as feiertageLand, feiertageBund, KALENDER_STANDARD } from "./feiertage.js";

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

// --- Phase 81 (81-01): working days with the office's holiday list ----------

/**
 * Holiday dates as a Set: the given list, or — without one — the office
 * standard (Bavaria, KALENDER_STANDARD) for every year between von and bis.
 * @param {ReadonlyArray<{datum: string}>|null|undefined} liste
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {Set<string>}
 */
function feiertagMenge(liste, von, bis) {
  if (Array.isArray(liste)) return new Set(liste.map((f) => f?.datum).filter(Boolean));
  const menge = new Set();
  const a = /** @type {number} */ (jahrVon(von));
  const b = /** @type {number} */ (jahrVon(bis));
  for (let j = a; j <= b; j++) for (const f of feiertageLand(j, KALENDER_STANDARD)) menge.add(f.datum);
  return menge;
}

/**
 * True for Monday–Friday that is not in the holiday list.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @param {ReadonlyArray<{datum: string}>} [liste] holidays (feiertage()); default: office standard (Bavaria)
 * @returns {boolean} false for invalid dates
 */
export function istArbeitstag(tagIso, liste) {
  const s = parseTag(tagIso);
  if (!s) return false;
  const wt = /** @type {number} */ (wochentag(s));
  if (wt === 0 || wt === 6) return false;
  return !feiertagMenge(liste, s, s).has(s);
}

/**
 * The day itself when it is a working day, otherwise the next one — like
 * naechsterWerktag (§ 108 Abs. 3 AO), but with the given holiday list
 * (state holidays): 2025-08-15 (Assumption Day, Friday) → 2025-08-18 in
 * Bavaria, where naechsterWerktag keeps 2025-08-15.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @param {ReadonlyArray<{datum: string}>} [liste] holidays; default: office standard
 * @returns {string|null} null for an invalid date
 */
export function naechsterArbeitstag(tagIso, liste) {
  let s = parseTag(tagIso);
  if (!s) return null;
  const menge = feiertagMenge(liste, s, /** @type {string} */ (plusTage(s, 14)));
  const frei = (/** @type {string} */ t) => { const wt = wochentag(t); return wt === 0 || wt === 6 || menge.has(t); };
  for (let i = 0; i < 14 && frei(s); i++) s = /** @type {string} */ (plusTage(s, 1));
  return s;
}

/**
 * Number of days between von and bis, both included.
 * 'arbeitstage': Monday–Friday without holidays; 'werktage': Monday–Saturday
 * without holidays (the "Werktage" of § 3 Abs. 2 BUrlG).
 * zaehleTage('2026-01-01', '2026-12-31', {zaehlart:'arbeitstage'}) = 252 in Bavaria.
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @param {{zaehlart?: 'arbeitstage'|'werktage', feiertage?: ReadonlyArray<{datum: string}>}} [optionen]
 * @returns {number} days; 0 when bis < von or a date is invalid
 */
export function zaehleTage(von, bis, { zaehlart = "arbeitstage", feiertage } = {}) {
  const a = parseTag(von);
  const b = parseTag(bis);
  if (!a || !b || b < a) return 0;
  const menge = feiertagMenge(feiertage, a, b);
  const letzter = zaehlart === "werktage" ? 6 : 5;
  let n = 0;
  const tage = /** @type {number} */ (tageZwischen(a, b));
  for (let i = 0; i <= tage; i++) {
    const t = /** @type {string} */ (plusTage(a, i));
    const wt = /** @type {number} */ (wochentag(t));
    if (wt >= 1 && wt <= letzter && !menge.has(t)) n++;
  }
  return n;
}

/**
 * Target working time between von and bis (both included) in MINUTES.
 * With a contract (wochenstunden and arbeitstageWoche given): wochenstunden ×
 * 60 / arbeitstageWoche on the first `arbeitstageWoche` weekdays Monday …
 * [ASSUMED] — phase 80 stores only the NUMBER of working days per week, not
 * which days; Monday–Wednesday for a three-day contract is the plausible
 * default until 80 stores the days. Without a contract (owner, E-17):
 * tagessollMinuten on Monday–Friday (zeit_honorar.tagessoll, E-16).
 * Holidays count 0 in both cases. Sum rounded to whole minutes.
 * KW 40/2026 at 40 h / 5 days = 2400; KW 22/2026 (Whit Monday) = 1920.
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @param {{wochenstunden?: number|null, arbeitstageWoche?: number|null, tagessollMinuten?: number|null, feiertage?: ReadonlyArray<{datum: string}>}} [optionen]
 *   wochenstunden in hours/week, arbeitstageWoche in days/week (1–6), tagessollMinuten in minutes/day
 * @returns {number} minutes
 */
export function sollMinuten(von, bis, { wochenstunden, arbeitstageWoche, tagessollMinuten, feiertage } = {}) {
  const a = parseTag(von);
  const b = parseTag(bis);
  if (!a || !b || b < a) return 0;
  const menge = feiertagMenge(feiertage, a, b);
  const mitVertrag = Number(wochenstunden) > 0 && Number(arbeitstageWoche) > 0;
  const tageWoche = mitVertrag ? Math.min(6, Math.round(Number(arbeitstageWoche))) : 5;
  const proTag = mitVertrag ? (Number(wochenstunden) * 60) / Number(arbeitstageWoche) : Math.max(0, Number(tagessollMinuten) || 0);
  let summe = 0;
  const tage = /** @type {number} */ (tageZwischen(a, b));
  for (let i = 0; i <= tage; i++) {
    const t = /** @type {string} */ (plusTage(a, i));
    const wt = /** @type {number} */ (wochentag(t)); // 0 = Sunday (79)
    if (wt >= 1 && wt <= tageWoche && !menge.has(t)) summe += proTag;
  }
  return Math.round(summe);
}
