// Calendar core, part 1: dates as 'YYYY-MM-DD' strings computed in UTC
// (shared by phase 79 accounting and phases 81/82, which add ISO weeks and
// state holidays here). `new Date('YYYY-MM-DD')` combined with local getters
// shifts days across time zones (finding NB-11), so every function below uses
// only Date.UTC and getUTC* — except heuteLokal(), the one place that asks the
// device clock what day it is for the user.
//
// In:  date strings (the first 10 characters count) and numbers.
// Out: date strings, numbers; null for invalid input. Import-free.

const TAG_MS = 86400000;

/**
 * @param {number} ms UTC timestamp in milliseconds
 * @returns {string} 'YYYY-MM-DD'
 */
function ausMs(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const t = String(d.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${m}-${t}`;
}

/**
 * @param {string} tagIso valid 'YYYY-MM-DD'
 * @returns {number} UTC timestamp of midnight
 */
function alsMs(tagIso) {
  return Date.UTC(Number(tagIso.slice(0, 4)), Number(tagIso.slice(5, 7)) - 1, Number(tagIso.slice(8, 10)));
}

/**
 * Strict date parser: takes the first 10 characters ('2026-03-10T23:30:00Z' →
 * '2026-03-10') and accepts only real calendar dates.
 * @param {unknown} wert
 * @returns {string|null} 'YYYY-MM-DD' or null (no string, wrong shape, 2026-02-29 …)
 */
export function parseTag(wert) {
  if (typeof wert !== "string") return null;
  const s = wert.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > tageImMonat(y, m)) return null;
  return s;
}

/**
 * Date from year, month, day. Overflow normalises like Date.UTC (month 13 →
 * January of the next year, day 0 → last day of the previous month).
 * @param {number} y year
 * @param {number} m month 1–12
 * @param {number} d day of month
 * @returns {string} 'YYYY-MM-DD'
 */
export function tag(y, m, d) {
  return ausMs(Date.UTC(y, m - 1, d));
}

/**
 * @param {number} y year
 * @returns {boolean} true for a Gregorian leap year
 */
export function istSchaltjahr(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * @param {number} y year
 * @param {number} m month 1–12
 * @returns {number} number of days in that month
 */
export function tageImMonat(y, m) {
  return [31, istSchaltjahr(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

/**
 * @param {string} tagIso 'YYYY-MM-DD'
 * @param {number} n days, may be negative
 * @returns {string|null} shifted date, null for an invalid date
 */
export function plusTage(tagIso, n) {
  const s = parseTag(tagIso);
  if (!s || !Number.isFinite(n)) return null;
  return ausMs(alsMs(s) + Math.trunc(n) * TAG_MS);
}

/**
 * Adds months, capping the day at the end of the target month
 * (2026-01-31 + 1 → 2026-02-28, 2028-01-31 + 1 → 2028-02-29).
 * @param {string} tagIso 'YYYY-MM-DD'
 * @param {number} n months, may be negative
 * @returns {string|null}
 */
export function plusMonate(tagIso, n) {
  const s = parseTag(tagIso);
  if (!s || !Number.isFinite(n)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const index = y * 12 + (m - 1) + Math.trunc(n);
  const zy = Math.floor(index / 12);
  const zm = (index % 12) + 1;
  return tag(zy, zm, Math.min(d, tageImMonat(zy, zm)));
}

/**
 * Days from `von` to `bis` (positive when bis is later).
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {number|null} whole days, null for an invalid date
 */
export function tageZwischen(von, bis) {
  const a = parseTag(von);
  const b = parseTag(bis);
  if (!a || !b) return null;
  return Math.round((alsMs(b) - alsMs(a)) / TAG_MS);
}

/**
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {number|null} month 1–12
 */
export function monatVon(tagIso) {
  const s = parseTag(tagIso);
  return s ? Number(s.slice(5, 7)) : null;
}

/**
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {number|null} quarter 1–4
 */
export function quartalVon(tagIso) {
  const m = monatVon(tagIso);
  return m ? Math.ceil(m / 3) : null;
}

/**
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {number|null} year
 */
export function jahrVon(tagIso) {
  const s = parseTag(tagIso);
  return s ? Number(s.slice(0, 4)) : null;
}

/**
 * Day of the week like getUTCDay: 0 = Sunday … 6 = Saturday.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {number|null}
 */
export function wochentag(tagIso) {
  const s = parseTag(tagIso);
  return s ? new Date(alsMs(s)).getUTCDay() : null;
}

/**
 * Excel serial date (1900 system, days since 1899-12-30): 2026-09-27 → 46292.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @returns {number|null}
 */
export function excelSerie(tagIso) {
  const s = parseTag(tagIso);
  return s ? Math.round((alsMs(s) - Date.UTC(1899, 11, 30)) / TAG_MS) : null;
}

/**
 * Today on the device, as 'YYYY-MM-DD'. The ONLY function here that uses local
 * getters: "today" is the user's calendar day (a late-evening booking in Munich
 * belongs to that day, not to the UTC day). Everything downstream is UTC.
 * @param {Date} [jetzt] injectable clock (tests)
 * @returns {string}
 */
export function heuteLokal(jetzt = new Date()) {
  const y = jetzt.getFullYear();
  const m = String(jetzt.getMonth() + 1).padStart(2, "0");
  const d = String(jetzt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
