// urlaub.js — gesetzlicher Mindesturlaub und Urlaubsanspruch nach §§ 3–5 BUrlG
// (Plan 80-06, Task 2). Rein (keine API-, keine React-Imports), nur der 79-
// Kalender-Kern (@core/lib/kalender/datum.js über fristen.js) für die
// Tagesarithmetik.
//
// In:  Arbeitstage/Woche, ein Eintritts-/Austrittsdatum 'YYYY-MM-DD', ein
//      Kalenderjahr, ein optionaler regelWert-Leser (personal.urlaub_mindest_werktage).
// Out: urlaubMindest, urlaubsanspruch.

import { fristEndeBeginn, volleMonate } from "@core/lib/kalender/fristen.js";
import { plusTage } from "@core/lib/kalender/datum.js";

/** Gesetzlicher Mindesturlaub in Werktagen (§ 3 Abs. 1 BUrlG), Rückfall ohne Regelwerk. */
const WERKTAGE_MINDEST_RUECKFALL = 24;

/**
 * Gesetzlicher Mindesturlaub in Arbeitstagen/Jahr (§ 3 Abs. 1 BUrlG: 24
 * Werktage bei einer 6-Tage-Woche, umgerechnet auf die tatsächliche
 * Arbeitstage/Woche). `regelWert` ist optional — ohne ihn (z. B. reine
 * Rechenwege in Tests) gilt der gesetzliche Rückfallwert 24 Werktage; der
 * Regelwert selbst ist `art:'gesetz'` und deshalb ohnehin nicht überschreibbar.
 * @param {number} arbeitstage Arbeitstage/Woche (1…6)
 * @param {((id: string) => any)|undefined} [regelWert] liest personal.urlaub_mindest_werktage
 * @returns {number} Mindesturlaub in Arbeitstagen/Jahr
 */
export function urlaubMindest(arbeitstage, regelWert) {
  const roh = typeof regelWert === "function" ? regelWert("personal.urlaub_mindest_werktage") : null;
  const werktage = typeof roh === "number" && Number.isFinite(roh) ? roh : WERKTAGE_MINDEST_RUECKFALL;
  return (werktage * (Number(arbeitstage) || 0)) / 6;
}

/**
 * `berechnung` ist der bereits gefüllte deutsche Rechenweg (Komfort für
 * deutschsprachige Aufrufer/Tests); eine übersetzende Oberfläche zeigt
 * stattdessen `fuellen(t(schluessel), werte)`.
 * @typedef {{tage: number, berechnung: string, schluessel: string, werte: Record<string, string|number>}} Urlaubsanspruch
 */

/**
 * Urlaubsanspruch einer Person in einem Kalenderjahr (§§ 3–5 BUrlG).
 * - Wartezeit (§ 4 BUrlG, 6 Monate ab Eintritt als Beginnfrist — derselbe
 *   Rechenweg wie die Probezeit, `fristEndeBeginn`): ist sie NICHT im
 *   Kalenderjahr erfüllt, gibt es nur Teilurlaub. Ist sie erfüllt UND besteht
 *   das Arbeitsverhältnis bis zum Jahresende fort, gilt der VOLLE
 *   Jahresanspruch (kein Herunterrechnen mehr, sobald die Wartezeit einmal
 *   erfüllt ist).
 * - Scheidet die Person IM Kalenderjahr aus (`austritt` fällt in `jahr`),
 *   gibt es — unabhängig vom Wartezeit-Status — nur Teilurlaub für die
 *   beschäftigten Monate (§ 5 Abs. 1 BUrlG). `[ASSUMED]` vereinfacht: das
 *   Gesetz unterscheidet im Detail noch, ob das Ausscheiden vor oder nach der
 *   Jahresmitte liegt (§ 5 Abs. 1 Buchst. c) — hier zählt einheitlich jeder
 *   volle Beschäftigungsmonat des Jahres, was für die geprüften Fälle exakt
 *   übereinstimmt, im Einzelfall aber mit dem Lohnbüro abzugleichen ist.
 * - Teilurlaub: 1/12 je vollem Beschäftigungsmonat (§ 5 Abs. 1 Buchst. a–c).
 *   "Voller Monat" wird tagesgenau gezählt (derselbe Rechenweg wie
 *   Betriebszugehörigkeit, `volleMonate`), vom Monatsersten des Eintritts
 *   (oder Jahresanfang, falls früher) bis zum Tag NACH dem letzten
 *   Beschäftigungstag (Austritt oder Jahresende).
 * - Bruchteile ≥ 0,5 werden aufgerundet (§ 5 Abs. 2 BUrlG). Bruchteile < 0,5
 *   bleiben stehen — **kein** Abrunden (BAG, Urteil vom 23.01.1990 – 9 AZR
 *   339/88: Bruchteile von Urlaubstagen, die keinen halben Tag erreichen,
 *   dürfen nicht auf null abgerundet werden).
 * @param {{urlaub_tage_jahr: number, eintritt: string, austritt?: string|null, jahr: number|string}} vertrag
 * @returns {Urlaubsanspruch}
 */
export function urlaubsanspruch({ urlaub_tage_jahr, eintritt, austritt, jahr }) {
  const jahrZahl = String(jahr);
  const jahrStart = `${jahrZahl}-01-01`;
  const jahrEnde = `${jahrZahl}-12-31`;
  const vollTage = Number(urlaub_tage_jahr) || 0;
  const von = typeof eintritt === "string" && eintritt > jahrStart ? eintritt : jahrStart;
  const austrittImJahr = typeof austritt === "string" && austritt >= jahrStart && austritt <= jahrEnde ? austritt : null;

  if (!austrittImJahr) {
    const wartezeitEnde = typeof eintritt === "string" ? fristEndeBeginn(eintritt, { monate: 6 }) : null;
    if (wartezeitEnde && wartezeitEnde <= jahrEnde) {
      const schluessel = "Wartezeit erfüllt am {datum} (§ 4 BUrlG) — voller Jahresanspruch {tage} Tage (§ 3 Abs. 1 BUrlG).";
      const werte = { datum: wartezeitEnde, tage: vollTage };
      return { tage: vollTage, berechnung: fuellen(schluessel, werte), schluessel, werte };
    }
  }

  // Teilurlaub (§ 5 Abs. 1 BUrlG): volle Monate von `von` bis zum Tag nach dem
  // letzten Beschäftigungstag im Jahr (Austritt oder Jahresende).
  const bisLetzterTag = austrittImJahr || jahrEnde;
  const bisExklusiv = plusTage(bisLetzterTag, 1) || jahrEnde;
  const monate = volleMonate(von, bisExklusiv) ?? 0;
  const rohTage = (monate / 12) * vollTage;
  const bruch = rohTage - Math.floor(rohTage);
  // § 5 Abs. 2 BUrlG: nur ab einem halben Tag wird aufgerundet — kleinere
  // Bruchteile bleiben als Dezimalzahl stehen (BAG 9 AZR 339/88).
  const tage = bruch >= 0.5 ? Math.ceil(rohTage) : Math.round(rohTage * 100) / 100;
  const ergebnis = Math.round(rohTage * 100) / 100;
  const schluessel = bruch >= 0.5
    ? "{monate}/12 × {voll} Tage = {ergebnis} Tage (§ 5 Abs. 1 BUrlG), aufgerundet (§ 5 Abs. 2 BUrlG)."
    : "{monate}/12 × {voll} Tage = {ergebnis} Tage (§ 5 Abs. 1 BUrlG).";
  const werte = { monate, voll: vollTage, ergebnis };
  return { tage, berechnung: fuellen(schluessel, werte), schluessel, werte };
}

/**
 * Füllt `{platzhalter}`-Tokens — dieselbe Mini-Vorlagensprache wie
 * `vertrag.js`s `warnung()`/`fristen.js`s `fuellen()`.
 * @param {string} schluessel
 * @param {Record<string, string|number>} werte
 * @returns {string}
 */
function fuellen(schluessel, werte) {
  return schluessel.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}
