// exportSchritte.js — pure decisions behind the export/import dialogs that
// SpeicherStatus (header) and DatenBereich (Settings › Daten & Sicherung, 80-05)
// share (src/demo/speicherDialoge.jsx). Free of React on purpose, so
// `node --test` runs it directly, no browser and no dialog markup involved.
//
// Why this file exists: 79-12 built the export dialog with one checkbox per
// src/lib/exportBereiche.js registry entry; a `separat` entry (Personal, E-14)
// never enters the .bitproj at all — checking it only records the WISH for an
// extra encrypted side file (SEPARAT_SCHRITTE in speicherDialoge.jsx, wired to
// PersonalSicherung.jsx's bitpersSchritt since B-2). Small pure functions sit
// between that registry and the dialog markup: which separate steps to
// actually run (and which are missing — never silently skipped, now also
// including "wired but the passphrase was missing/too short/mistyped" —
// B-2's own guard), and which import-preview line to show per area
// (BEFUNDE-79 N-11: a `separat` area is never "in" a .bitproj, so its row
// would always misleadingly read "not included").
//
// In:  the export/import registry (src/lib/exportBereiche.js shape) plus the
//      options exportOptionen()/importOptionen() already compute from it.
// Out: separatPlan(), vorschauZeilen(), PASSPHRASE_MINDESTLAENGE, passphraseGueltig().

/**
 * @typedef {import("@/lib/exportBereiche.js").ExportBereich} ExportBereich
 */

/**
 * Which SEPARAT_SCHRITTE functions a confirmed export must call, and which
 * are missing. A `separat` area only ever reaches here when its checkbox was
 * ticked — exportOptionen() (src/lib/exportBereiche.js) then puts its AREA KEY
 * (not its `separat` value) into `optionen.separat`; an unticked `separat`
 * area still lands in `ohne`, but never in `optionen.separat`. A missing step
 * is reported, never silently dropped — E-07/E-14, the plan's objective
 * ("kein stilles Überspringen").
 * @param {{separat?: string[]}} optionen result of exportOptionen(): `separat` lists
 *   chosen AREA KEYS, e.g. ["personal"] (src/lib/exportBereiche.js)
 * @param {ReadonlyArray<ExportBereich>} registry
 * @param {Record<string, (...args: any[]) => Promise<any>>} schritte SEPARAT_SCHRITTE
 *   (speicherDialoge.jsx), keyed by the area's `separat` VALUE, e.g. ".bitpers"
 * @returns {{
 *   aufrufe: Array<{key: string, label: string, separat: string}>,
 *   fehlend: Array<{key: string, label: string, separat: string}>,
 * }}
 */
export function separatPlan(optionen, registry, schritte) {
  const gewaehlteBereiche = new Set(optionen?.separat || []);
  const aufrufe = [];
  const fehlend = [];
  for (const bereich of registry) {
    if (!bereich.separat || !gewaehlteBereiche.has(bereich.key)) continue;
    const eintrag = { key: bereich.key, label: bereich.label, separat: bereich.separat };
    if (typeof schritte?.[bereich.separat] === 'function') aufrufe.push(eintrag);
    else fehlend.push(eintrag);
  }
  return { aufrufe, fehlend };
}

/**
 * Minimum passphrase length before a `.bitpers`-style separat step is even
 * attempted — matches PersonalSicherung.jsx's own "Personaldaten sichern"
 * dialog (Plan 80-10, its local `MINDESTLAENGE`). Not imported from there:
 * that file carries JSX, this one stays React-free on purpose (file header)
 * so `node --test` can load it without a JSX transform; the value is the one
 * thing both places must agree on, so it is called out here explicitly.
 * @type {number}
 */
export const PASSPHRASE_MINDESTLAENGE = 12;

/**
 * Whether a separat step's passphrase input is ready to submit: present, at
 * least PASSPHRASE_MINDESTLAENGE characters, and — when a confirm value is
 * given — matching it exactly. Pure, so the export dialog (speicherDialoge.jsx)
 * and this file's own tests share one rule instead of two copies drifting
 * apart (BEFUNDE-80 B-2: a wired separat step must never run on a missing,
 * too short or mistyped passphrase — reported exactly like an unwired step,
 * never silently attempted).
 * @param {string} passphrase
 * @param {string} [bestaetigung] confirm-field value; omitted skips the match check
 * @returns {boolean}
 */
export function passphraseGueltig(passphrase, bestaetigung) {
  if (typeof passphrase !== 'string' || passphrase.length < PASSPHRASE_MINDESTLAENGE) return false;
  return bestaetigung === undefined || passphrase === bestaetigung;
}

/**
 * @param {ReadonlyArray<ExportBereich>} registry
 * @param {{ersetzt: string[]}} importOptionenErgebnis result of importOptionen() (src/lib/exportBereiche.js)
 * @returns {{zeilen: Array<{key: string, label: string, enthalten: boolean}>, separatHinweis: boolean}}
 */
export function vorschauZeilen(registry, importOptionenErgebnis) {
  const ersetzt = new Set(importOptionenErgebnis?.ersetzt || []);
  const zeilen = [];
  let separatHinweis = false;
  for (const bereich of registry) {
    if (bereich.separat) {
      separatHinweis = true;
      continue;
    }
    zeilen.push({ key: bereich.key, label: bereich.label, enthalten: ersetzt.has(bereich.key) });
  }
  return { zeilen, separatHinweis };
}
