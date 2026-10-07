// aggHinweise.js — AGG-Hinweise für Stellentexte (Plan 80-08): eine reine
// Textprüfung, die beim Tippen im Stellentitel/-text auf typische
// Diskriminierungsrisiken hinweist (§§ 1, 7, 11 AGG). Warnt nur — die
// Entscheidung, was in die Anzeige kommt, trifft das Büro.
//
// [ASSUMED] Die Wortliste ist keine Rechtsprüfung, sondern eine Heuristik
// nach dem ADS-Leitfaden (Antidiskriminierungsstelle des Bundes, "Diskrimi-
// nierungsfreie Stellenausschreibungen") — echte Fälle brauchen immer den
// Kontext, deshalb `schwere:'warn'`, nie `fail`.
//
// In:  ein Stellentext (Titel oder Volltext). Out: pruefeStellentext.

/** Zitierte Normen (§§ 1, 7, 11 AGG — Benachteiligungsverbot, Ausschreibungspflicht). */
const NORM = "§§ 1, 7, 11 AGG";

/** Geschlechtsneutrale Kennzeichnung: "(m/w/d)"/"(w/m/d)"/"(all genders)" oder ein Gendersternchen/Doppelpunkt ("Architekt:in", "Architekt*in"). */
const GENDER_KLAMMER = /\((?:m\/w\/d|w\/m\/d|all genders)\)/i;
const GENDER_ZEICHEN = /\w[:*]in\b/i;

/** Altersbezüge: "jung(es Team)", "max. N Jahre", "Berufseinsteiger bis". */
const ALTERSBEZUG = /\bjung(e|es)?\b|\bmax\.?\s*\d+\s*jahre[nr]?\b|\bberufseinsteiger\s*bis\b/i;

/** "Muttersprache" statt eines Sprachniveaus (mittelbare Diskriminierung wegen ethnischer Herkunft). */
const MUTTERSPRACHE = /mutter\s*sprache/i;

/** "belastbar" — nur ein Hinweis, wenn kein Tätigkeitsbezug direkt danebensteht. */
const BELASTBAR = /belastbar/i;
const BELASTBAR_MIT_BEZUG = /belastbar\s+(im|bei|unter|gegenüber)/i;

/**
 * @typedef {{hinweis: string, norm: string, schwere: 'warn'}} AggHinweis
 */

/**
 * Prüft einen Stellentext auf typische AGG-Risiken. Reine Textheuristik ohne
 * Rechtsprüfung — jeder Treffer ist `schwere:'warn'`, das Speichern bleibt in
 * jedem Fall möglich (dieselbe D-P80-17-Haltung wie vertrag.js).
 * @param {string} text Stellentitel oder -volltext
 * @returns {AggHinweis[]} leer, wenn nichts auffällt
 */
export function pruefeStellentext(text) {
  const t = typeof text === "string" ? text : "";
  /** @type {AggHinweis[]} */
  const hinweise = [];

  if (!GENDER_KLAMMER.test(t) && !GENDER_ZEICHEN.test(t)) {
    hinweise.push({ hinweis: "(m/w/d) fehlt — geschlechtsneutrale Fassung nötig", norm: NORM, schwere: "warn" });
  }
  if (ALTERSBEZUG.test(t)) {
    hinweise.push({ hinweis: "Altersbezug gefunden — Diskriminierung wegen des Alters vermeiden", norm: NORM, schwere: "warn" });
  }
  if (MUTTERSPRACHE.test(t)) {
    hinweise.push({ hinweis: "„Muttersprache“ gefunden — Sprachniveau nennen, nicht die Herkunft", norm: NORM, schwere: "warn" });
  }
  if (BELASTBAR.test(t) && !BELASTBAR_MIT_BEZUG.test(t)) {
    hinweise.push({ hinweis: "„belastbar“ ohne Tätigkeitsbezug — konkret auf die Aufgabe beziehen", norm: NORM, schwere: "warn" });
  }
  return hinweise;
}
