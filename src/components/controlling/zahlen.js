// Number formatting of the controlling tabs (phase 81-05): Euro, percent and
// hours in the UI language, a dash for "no value" (null = not computable, never
// shown as 0).
//
// In:  values and the UI language ('de'|'en'). Out: display strings.

import { formatEuro } from "@/lib/accounting/geld.js";

/**
 * @param {number|null|undefined} euro amount in Euro
 * @param {string} lang 'de'|'en'
 * @returns {string} "12.345,67 €" or "—"
 */
export function euroText(euro, lang) {
  return typeof euro === "number" && Number.isFinite(euro) ? formatEuro(Math.round(euro * 100), lang) : "—";
}

/**
 * @param {number|null|undefined} prozent value in percent (0–100)
 * @param {string} lang
 * @param {number} [stellen] decimals
 * @returns {string} "67,5 %" or "—"
 */
export function prozentText(prozent, lang, stellen = 1) {
  if (typeof prozent !== "number" || !Number.isFinite(prozent)) return "—";
  return `${prozent.toLocaleString(lang === "en" ? "en-GB" : "de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} %`;
}

/**
 * @param {number|null|undefined} minuten duration in minutes
 * @param {string} lang
 * @returns {string} hours with two decimals, e.g. "12,25 h", or "—"
 */
export function stundenText(minuten, lang) {
  if (typeof minuten !== "number" || !Number.isFinite(minuten)) return "—";
  return `${(minuten / 60).toLocaleString(lang === "en" ? "en-GB" : "de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

/**
 * @param {number|null|undefined} stunden hours
 * @param {string} lang
 * @returns {string} hours with one decimal or "—"
 */
export function reststundenText(stunden, lang) {
  if (typeof stunden !== "number" || !Number.isFinite(stunden)) return "—";
  return `${stunden.toLocaleString(lang === "en" ? "en-GB" : "de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
}
