// kuendigung.js — gesetzliche Kündigungsfrist nach § 622 BGB (Plan 80-06, Task
// 2). Rein (keine API-, keine React-Imports), nur der 79-Kalender-Kern über
// fristen.js für die Tagesarithmetik.
//
// D-P80-17 (warn statt sperren): der Rechner liefert IMMER auch die drei
// festen Warnhinweise (Sonderkündigungsschutz, KSchG-Anwendbarkeit,
// Schriftform) — er ersetzt keine Rechtsberatung, das steht wörtlich im
// Vertragsformular (80-06 Task 4).
//
// In:  {eintritt, zugang, seite: 'ag'|'an', probezeitEnde, vertraglich?}, ein
//      regelWert-Leser (personal.kuendigung_staffel).
// Out: kuendigungsfristGesetzlich.

import { fristEnde, monatsende, naechster15OderMonatsende, volleJahre } from "@core/lib/kalender/fristen.js";

/**
 * Staffel-Rückfall (§ 622 Abs. 2 BGB), falls das Regelwerk (noch) keinen Wert
 * liefert — identisch zu `personal.kuendigung_staffel` in hrRegeln.js.
 * @type {ReadonlyArray<[jahre: number, monate: number]>}
 */
const STAFFEL_RUECKFALL = Object.freeze([[2, 1], [5, 2], [8, 3], [10, 4], [12, 5], [15, 6], [20, 7]]);

/**
 * Die drei Hinweise, die JEDE Antwort trägt (D-P80-17) — der Rechner prüft
 * weder Sonderkündigungsschutz noch KSchG-Anwendbarkeit noch Schriftform,
 * das bleibt Aufgabe des Büros.
 * @type {ReadonlyArray<{schwere: 'warn', text: string, norm: string}>}
 */
const WARNUNGEN_FEST = Object.freeze([
  { schwere: "warn", text: "Sonderkündigungsschutz prüfen.", norm: "MuSchG § 17, BEEG § 18, SGB IX § 168" },
  { schwere: "warn", text: "Ist das Kündigungsschutzgesetz anwendbar? Siehe Kopfzahl.", norm: "§ 23 KSchG" },
  { schwere: "warn", text: "Schriftform erforderlich — eine E-Mail genügt nicht.", norm: "§ 623 BGB" },
]);

/**
 * Monate der Arbeitgeber-Staffel für eine Betriebszugehörigkeit: die Zeile mit
 * der größten Jahresschwelle ≤ `jahre`, oder null unterhalb der ersten Stufe.
 * @param {ReadonlyArray<[number, number]>} tabelle [Jahre, Monate][]
 * @param {number} jahre volle Jahre Betriebszugehörigkeit
 * @returns {number|null}
 */
function monateAusStaffel(tabelle, jahre) {
  /** @type {[number, number]|null} */
  let treffer = null;
  for (const zeile of tabelle) {
    const [j, m] = zeile;
    if (j <= jahre && (!treffer || j > treffer[0])) treffer = [j, m];
  }
  return treffer ? treffer[1] : null;
}

/**
 * @typedef {{
 *   letzterTag: string|null, regel: 'probezeit'|'grundfrist'|'staffel',
 *   norm: string, jahre: number|null,
 *   warnungen: ReadonlyArray<{schwere: 'warn', text: string, norm: string}>,
 * }} Kuendigungsfrist
 */

/**
 * Gesetzliche Kündigungsfrist nach § 622 BGB, ausgehend vom Tag des
 * ZUGANGS der Kündigung (nicht vom Erklärungsdatum).
 * - Zugang bis einschließlich Probezeitende: 2 Wochen ab Zugang, Ereignisfrist
 *   (§ 622 Abs. 3 BGB — die Kündigung muss IN der Probezeit zugehen, nicht nur
 *   erklärt werden).
 * - Sonst Grundfrist: 4 Wochen zum 15. oder zum Monatsende (§ 622 Abs. 1 BGB).
 * - Für `seite:'ag'` (Arbeitgeberkündigung) gilt ab 2 Jahren Betriebs-
 *   zugehörigkeit (volle Jahre, gemessen am Zugang) zusätzlich die Staffel aus
 *   `personal.kuendigung_staffel`, zum Monatsende (§ 622 Abs. 2 BGB). Die
 *   frühere Regel „Zeiten vor dem 25. Lebensjahr zählen nicht" (§ 622 Abs. 2
 *   S. 2 a. F.) wird bewusst NICHT abgebildet — der EuGH hat sie für
 *   unanwendbar erklärt (Rs. C-555/07, Kücükdeveci, 2010).
 * - Für `seite:'an'` (Arbeitnehmerkündigung) gilt immer nur die Grundfrist,
 *   die Staffel des Abs. 2 gilt ausdrücklich nur "dem Arbeitgeber gegenüber".
 * - `vertraglich` (optional): eine vertraglich vereinbarte, ABWEICHENDE
 *   Arbeitnehmerfrist (nur bei `seite:'an'` sinnvoll) darf nach § 622 Abs. 6
 *   BGB nie länger sein als die des Arbeitgebers — sonst eine zusätzliche
 *   Warnung.
 * @param {{eintritt?: string, zugang: string, seite: 'ag'|'an', probezeitEnde?: string|null, vertraglich?: string|null}} eingabe
 * @param {((id: string) => any)|undefined} [regelWert] liest personal.kuendigung_staffel
 * @returns {Kuendigungsfrist}
 */
export function kuendigungsfristGesetzlich({ eintritt, zugang, seite, probezeitEnde, vertraglich } = /** @type {any} */ ({}), regelWert) {
  const warnungen = [...WARNUNGEN_FEST];

  if (typeof probezeitEnde === "string" && probezeitEnde && typeof zugang === "string" && zugang <= probezeitEnde) {
    return { letzterTag: fristEnde(zugang, { wochen: 2 }), regel: "probezeit", norm: "§ 622 Abs. 3 BGB", jahre: null, warnungen };
  }

  const grundfristTag = naechster15OderMonatsende(fristEnde(zugang, { wochen: 4 }));
  const jahre = typeof eintritt === "string" ? volleJahre(eintritt, zugang) : null;

  if (seite === "ag" && typeof jahre === "number" && jahre >= 2) {
    const roh = typeof regelWert === "function" ? regelWert("personal.kuendigung_staffel") : null;
    const tabelle = Array.isArray(roh) ? roh : STAFFEL_RUECKFALL;
    const monate = monateAusStaffel(tabelle, jahre);
    if (typeof monate === "number") {
      const letzterTag = monatsende(fristEnde(zugang, { monate }));
      return { letzterTag, regel: "staffel", norm: "§ 622 Abs. 2 BGB", jahre, warnungen };
    }
  }

  // § 622 Abs. 6 BGB: eine vertragliche Arbeitnehmerfrist darf nie länger sein
  // als die (hier: gesetzliche) Arbeitgeberfrist zum selben Zugangstag.
  if (seite === "an" && typeof vertraglich === "string" && vertraglich > grundfristTag) {
    warnungen.push({
      schwere: "warn",
      text: "Die vereinbarte Arbeitnehmerfrist ist länger als die gesetzliche Arbeitgeberfrist — unwirksam, es gilt die kürzere Frist.",
      norm: "§ 622 Abs. 6 BGB",
    });
  }

  return { letzterTag: grundfristTag, regel: "grundfrist", norm: "§ 622 Abs. 1 BGB", jahre, warnungen };
}
