// kopfzahl.js — Kopfzahl-Rechnungen nach § 23 Abs. 1 S. 4 KSchG und § 3 Abs. 1
// S. 6 AAG, dazu die Schwellenwerte, die an der Kopfzahl hängen (Plan 80-04,
// Task 3). Reine Funktionen: Gesellschafter und Inhaber:innen zählen nicht mit
// (sie stehen nicht im Arbeitsrecht) — der Aufrufer (uebersicht.js) übergibt nur
// Personen mit Arbeitsrecht.
//
// Nur Hinweis, keine Rechtsberatung — die Schwellen sind Richtwerte für die
// Planung, keine verbindliche Prüfung der tatsächlichen Rechtslage.
//
// In:  Personen als [{h: Wochenstunden, art?: Personenart-Schlüssel}].
// Out: kopfzahlKSchG, kopfzahlAAG, vzae, schwellenFuer.

/**
 * Gewicht einer Person nach § 23 Abs. 1 S. 4 KSchG: Auszubildende zählen
 * nicht mit; bis 20 Wochenstunden 0,5, bis 30 Stunden 0,75, darüber 1.
 * @param {number} h Wochenstunden
 * @param {string} [art] Personenart-Schlüssel
 * @returns {number}
 */
function kschgGewicht(h, art) {
  if (art === "azubi") return 0;
  if (h <= 20) return 0.5;
  if (h <= 30) return 0.75;
  return 1;
}

/**
 * Gewicht einer Person nach § 3 Abs. 1 S. 6 AAG: wie KSchG, zusätzlich eine
 * Stufe bis 10 Wochenstunden (0,25).
 * @param {number} h Wochenstunden
 * @param {string} [art] Personenart-Schlüssel
 * @returns {number}
 */
function aagGewicht(h, art) {
  if (art === "azubi") return 0;
  if (h <= 10) return 0.25;
  if (h <= 20) return 0.5;
  if (h <= 30) return 0.75;
  return 1;
}

/**
 * Kopfzahl nach § 23 Abs. 1 S. 4 KSchG (Kleinbetriebsklausel: > 10 → KSchG
 * gilt). Gesellschafter/Inhaber:innen gehören nicht in `personen` (kein
 * Arbeitsrecht) — nur Hinweis, keine Rechtsberatung.
 * @param {Array<{h: number, art?: string}>} personen Wochenstunden je Person
 * @returns {number}
 */
export function kopfzahlKSchG(personen) {
  return (Array.isArray(personen) ? personen : []).reduce((summe, p) => summe + kschgGewicht(p?.h ?? 0, p?.art), 0);
}

/**
 * Kopfzahl nach § 3 Abs. 1 S. 6 AAG (U1-Umlage-Pflicht bis 30 Beschäftigte).
 * @param {Array<{h: number, art?: string}>} personen Wochenstunden je Person
 * @returns {number}
 */
export function kopfzahlAAG(personen) {
  return (Array.isArray(personen) ? personen : []).reduce((summe, p) => summe + aagGewicht(p?.h ?? 0, p?.art), 0);
}

/**
 * Vollzeitäquivalent: Summe der Wochenstunden geteilt durch die
 * Bürostandard-Wochenstunden (personal.wochenstunden_standard).
 * @param {Array<{h: number}>} personen Wochenstunden je Person
 * @param {number} standardStunden Bürostandard-Wochenstunden (> 0)
 * @returns {number} 0 wenn standardStunden nicht positiv ist
 */
export function vzae(personen, standardStunden) {
  if (!(standardStunden > 0)) return 0;
  const summe = (Array.isArray(personen) ? personen : []).reduce((s, p) => s + (p?.h ?? 0), 0);
  return summe / standardStunden;
}

/**
 * Eine Größenschwelle, die an der KSchG-Kopfzahl hängt.
 * @typedef {{key: string, gilt: boolean, text: string, norm: string}} Schwelle
 */

/**
 * Schwellenwerte, die an der Kopfzahl hängen — Planungshinweis, keine
 * Rechtsberatung (die tatsächliche Anwendbarkeit hängt von weiteren
 * Voraussetzungen ab, die diese Funktion nicht prüft).
 * @param {number} kopfzahl KSchG-Kopfzahl (kopfzahlKSchG)
 * @returns {Schwelle[]}
 */
export function schwellenFuer(kopfzahl) {
  const k = typeof kopfzahl === "number" && Number.isFinite(kopfzahl) ? kopfzahl : 0;
  return [
    { key: "kschg", gilt: k > 10, text: "Kündigungsschutzgesetz gilt", norm: "§ 23 Abs. 1 S. 4 KSchG" },
    { key: "u1_umlage", gilt: k <= 30, text: "U1-Umlage (Ausgleich Entgeltfortzahlung)", norm: "§ 1 AAG" },
    { key: "betriebsrat", gilt: k >= 5, text: "Betriebsrat wählbar", norm: "§ 1 BetrVG" },
    { key: "ersthelfer", gilt: true, text: "Ersthelfer:innen vorzuhalten", norm: "DGUV Vorschrift 1 § 26" },
    { key: "schwerbehinderte", gilt: k >= 20, text: "Schwerbehinderten-Beschäftigungspflicht", norm: "§ 154 SGB IX" },
    { key: "meldestelle", gilt: k >= 50, text: "Interne Meldestelle (Hinweisgeberschutz)", norm: "§ 12 HinSchG" },
    { key: "agg_aushang", gilt: true, text: "AGG-Aushang", norm: "§ 12 Abs. 5 AGG" },
  ];
}
