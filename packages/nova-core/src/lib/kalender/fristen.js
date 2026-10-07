// fristen.js — Fristenlehre auf dem 79-Kalender-Kern (Plan 80-04). Es gibt KEIN
// zweites Datums-Modul: die Tagesarithmetik (plusTage, plusMonate mit
// Monatsende-Klemme, tag, tageImMonat, parseTag) kommt unverändert aus
// @core/lib/kalender/datum.js (79-01). Neu ist hier nur die Fristenlehre der
// §§ 187, 188 BGB, weil Phase 82 (Fristen & Termine) genau diese Datei und
// genau die Signatur `fristEnde(ereignisIso, dauer)` erwartet (82-01-PLAN.md,
// "Neue Verträge"); 82-01 ergänzt dort additiv nur `faelligkeit`.
//
// Rein, keine Imports außer dem Kalender-Kern. Keine JS-Date-Serialisierung
// (NB-11) — nur die UTC-Arithmetik des Kalender-Kerns.
//
// In:  Datumsstrings 'YYYY-MM-DD' und Fristdauern {jahre?, monate?, wochen?, tage?}.
// Out: fristEnde, fristEndeBeginn, monatsende, naechster15OderMonatsende,
//      volleJahre, volleMonate. null bei ungültiger Eingabe.

import { parseTag, plusMonate, plusTage, tag, tageImMonat } from "./datum.js";

/**
 * Dauer einer Frist in Kalendereinheiten. Alle Felder optional, fehlende
 * zählen als 0. Jahre werden intern zu Monaten (× 12), Wochen zu Tagen (× 7).
 * @typedef {{jahre?: number, monate?: number, wochen?: number, tage?: number}} Fristdauer
 */

/**
 * Ereignisfrist (§ 187 Abs. 1 BGB): der Tag des Ereignisses selbst zählt
 * nicht mit, die Frist beginnt am folgenden Tag. Sie endet nach § 188 Abs. 2
 * Alt. 1 mit dem Ablauf desjenigen Tages der letzten Woche oder des letzten
 * Monats, der durch seine Zahl dem Ereignistag entspricht — rechnerisch also
 * exakt `ereignisIso + dauer`, angewandt auf den Ereignistag selbst (nicht auf
 * den Tag danach: der Tag "gleicher Zahl" N Monate später IST bereits der
 * gesuchte Endtag). Fehlt der Tag im Zielmonat, klemmt § 188 Abs. 3 auf den
 * Monatsletzten — das leistet `plusMonate` bereits eingebaut.
 *
 * Anwendungsfälle: Kündigungszugang (Frist beginnt mit Zugang), § 6 Abs. 4
 * SGB VI (Befreiungsantrag). Entspricht wörtlich der 82-01-Vertragssignatur
 * `fristEnde(ereignisIso, dauer)`.
 * @param {string} ereignisIso 'YYYY-MM-DD' — Tag des fristauslösenden Ereignisses
 * @param {Fristdauer} [dauer]
 * @returns {string|null} 'YYYY-MM-DD', null bei ungültiger Eingabe
 */
export function fristEnde(ereignisIso, dauer = {}) {
  const start = parseTag(ereignisIso);
  if (!start) return null;
  const monate = (Number(dauer.jahre) || 0) * 12 + (Number(dauer.monate) || 0);
  const tage = (Number(dauer.wochen) || 0) * 7 + (Number(dauer.tage) || 0);
  let ergebnis = start;
  if (monate) {
    ergebnis = plusMonate(ergebnis, monate);
    if (!ergebnis) return null;
  }
  if (tage) {
    ergebnis = plusTage(ergebnis, tage);
    if (!ergebnis) return null;
  }
  return ergebnis;
}

/**
 * Beginnfrist (§ 187 Abs. 2 BGB): der Anfangstag selbst zählt bereits mit
 * (z. B. der erste Arbeitstag). Sie endet nach § 188 Abs. 2 Alt. 2 mit dem
 * Ablauf des Tages, der dem "Tag gleicher Zahl" N Monate später VORAUSGEHT.
 * Fehlt dieser Tag gleicher Zahl im Zielmonat (§ 188 Abs. 3), endet die Frist
 * abweichend direkt mit dem Monatsletzten — OHNE die zusätzliche
 * Vortag-Verschiebung, weil es den "Tag gleicher Zahl" dort gar nicht gibt
 * (Beispiel: Beginn 31.08., 6 Monate → Zielmonat Februar hat keinen 31., die
 * Frist endet mit dem 28./29.02., nicht dem 27./28.02.). Das ist die
 * Probezeitberechnung.
 * @param {string} beginnIso 'YYYY-MM-DD' — erster Tag, ab dem die Frist läuft
 * @param {Fristdauer} [dauer] üblich nur `monate` (Probezeit); `jahre` additiv unterstützt
 * @returns {string|null} 'YYYY-MM-DD', null bei ungültiger Eingabe
 */
export function fristEndeBeginn(beginnIso, dauer = {}) {
  const start = parseTag(beginnIso);
  if (!start) return null;
  const monate = (Number(dauer.jahre) || 0) * 12 + (Number(dauer.monate) || 0);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  const d = Number(start.slice(8, 10));
  const index = y * 12 + (m - 1) + monate;
  const zy = Math.floor(index / 12);
  const zm = (index % 12) + 1;
  const tageImZiel = tageImMonat(zy, zm);
  // § 188 Abs. 3: der für den Ablauf maßgebende Tag fehlt im Zielmonat → die
  // Frist endet direkt mit dessen letztem Tag, kein weiterer Vortag-Schritt.
  if (d > tageImZiel) return tag(zy, zm, tageImZiel);
  return plusTage(tag(zy, zm, d), -1);
}

/**
 * Letzter Tag des Monats, der `datumIso` enthält.
 * @param {string} datumIso 'YYYY-MM-DD'
 * @returns {string|null} 'YYYY-MM-DD', null bei ungültiger Eingabe
 */
export function monatsende(datumIso) {
  const s = parseTag(datumIso);
  if (!s) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return tag(y, m, tageImMonat(y, m));
}

/**
 * Nächster Kündigungstermin nach § 622 Abs. 1 BGB (Grundkündigungsfrist "zum
 * 15. oder zum Ende eines Kalendermonats"): liegt `datumIso` am oder vor dem
 * 15., ist das der 15. desselben Monats, sonst der Monatsletzte.
 * @param {string} datumIso 'YYYY-MM-DD'
 * @returns {string|null} 'YYYY-MM-DD', null bei ungültiger Eingabe
 */
export function naechster15OderMonatsende(datumIso) {
  const s = parseTag(datumIso);
  if (!s) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return d <= 15 ? tag(y, m, 15) : monatsende(s);
}

/**
 * Anzahl voller Kalenderjahre zwischen zwei Tagen (Geburtstags-/
 * Jubiläumslogik: das laufende Jahr zählt erst mit, sobald der Jahrestag
 * erreicht ist). Für Betriebszugehörigkeit (§ 622 Abs. 2 BGB-Staffel) und
 * Altersberechnungen.
 * @param {string} vonIso 'YYYY-MM-DD' Anfangstag
 * @param {string} bisIso 'YYYY-MM-DD' Stichtag
 * @returns {number|null} volle Jahre (≥ 0), null bei ungültiger Eingabe
 */
export function volleJahre(vonIso, bisIso) {
  const von = parseTag(vonIso);
  const bis = parseTag(bisIso);
  if (!von || !bis) return null;
  let jahre = Number(bis.slice(0, 4)) - Number(von.slice(0, 4));
  if (bis.slice(5) < von.slice(5)) jahre -= 1; // Jahrestag (MM-TT) noch nicht erreicht
  return Math.max(0, jahre);
}

/**
 * Anzahl voller Kalendermonate zwischen zwei Tagen (analog volleJahre, nur
 * auf Monatsbasis). Für Probezeit-Fortschritt und monatsweise Fristen.
 * @param {string} vonIso 'YYYY-MM-DD' Anfangstag
 * @param {string} bisIso 'YYYY-MM-DD' Stichtag
 * @returns {number|null} volle Monate (≥ 0), null bei ungültiger Eingabe
 */
export function volleMonate(vonIso, bisIso) {
  const von = parseTag(vonIso);
  const bis = parseTag(bisIso);
  if (!von || !bis) return null;
  const vy = Number(von.slice(0, 4)), vm = Number(von.slice(5, 7)), vd = Number(von.slice(8, 10));
  const by = Number(bis.slice(0, 4)), bm = Number(bis.slice(5, 7)), bd = Number(bis.slice(8, 10));
  let monate = (by - vy) * 12 + (bm - vm);
  if (bd < vd) monate -= 1; // Tag im Zielmonat noch nicht erreicht
  return Math.max(0, monate);
}
