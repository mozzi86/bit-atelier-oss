// DIN 5008 Form B page layout of the shared letter core (phase 79-03, reused by
// phases 81/82 for offers, contracts and correspondence — D-P79-27). Pure
// geometry and line-wrapping in mm; no jsPDF here at all, so this file (and
// its test) never pays for a browser. briefPdf.js only has to place the
// already-computed lines and coordinates this file works out.
//
// Runs every text through winAnsi.ersetzeNichtWinAnsi() first: nothing the
// caller passes in can smuggle a glyph jsPDF's WinAnsi standard font cannot
// draw — the model itself never contains a non-WinAnsi character.
//
// In:  {absender, empfaenger, datum, betreff, absaetze, tabelle} — amounts and
//      dates already formatted as text by the caller (this package cannot
//      import src/lib/accounting/geld.js — the app/package boundary).
// Out: a page model in mm (A4 210×297): the fixed DIN 5008 marks, wrapped body
//      lines, and one or more pages when the text overflows a page.

import { ersetzeNichtWinAnsi } from "./winAnsi.js";

/** A4 portrait, mm. */
export const A4 = Object.freeze({ w: 210, h: 297 });

/**
 * DIN 5008 Form B key positions, mm ("Geschäftsbrief mit Anschriftfeld").
 * `textbeginn_y` and `absenderzeile_y` are the two lines DIN 5008 places
 * relative to the address field, not separately standardised figures.
 */
export const DIN5008 = Object.freeze({
  randLinks: 25,
  randRechts: 20,
  randOben: 10,
  randUnten: 20,
  anschrift: Object.freeze({ x: 20, y: 45, w: 85, h: 45 }),
  falzmarke1_y: 105,
  falzmarke2_y: 210,
  lochmarke_y: 148.5,
  absenderzeile_y: 42,
  textbeginn_y: 98.46,
});

/** Average glyph width at 10pt Helvetica/WinAnsi, mm — [ASSUMED], see 79-03-PLAN.md T2 (no per-glyph metrics without loading the font). */
export const ZEICHENBREITE_10PT_MM = 2.1;

/** Line pitch (10pt + leading), mm — [ASSUMED], same guideline sizing as feuerwehrplanPdf.js. */
export const ZEILENHOEHE_MM = 5;

/** @param {unknown} wert @returns {{text: string, ersetzt: number}} */
function saeubern(wert) {
  return ersetzeNichtWinAnsi(String(wert ?? ""));
}

/**
 * Greedy word wrap at a fixed character budget per line. A single word longer
 * than the budget is not split further (rare in a business letter; it simply
 * overruns that one line rather than being cut mid-word).
 * @param {string} text
 * @param {number} zeichenJeZeile
 * @returns {string[]} at least one line, even for an empty paragraph (a blank line)
 */
function umbrechen(text, zeichenJeZeile) {
  const woerter = text.split(/\s+/).filter(Boolean);
  if (!woerter.length) return [""];
  const zeilen = [];
  let zeile = "";
  for (const wort of woerter) {
    const kandidat = zeile ? `${zeile} ${wort}` : wort;
    if (zeile && kandidat.length > zeichenJeZeile) {
      zeilen.push(zeile);
      zeile = wort;
    } else {
      zeile = kandidat;
    }
  }
  if (zeile) zeilen.push(zeile);
  return zeilen;
}

/**
 * @param {{
 *   absender?: string[], empfaenger?: string[], datum?: string, betreff?: string,
 *   absaetze?: string[], tabelle?: {kopf?: string[], zeilen: string[][]}|null,
 * }} eingabe
 *   absender/empfaenger: address lines, top to bottom;
 *   absaetze: body paragraphs (each wrapped and separated by a blank line);
 *   tabelle: a right-aligned block at the end of the body (e.g. an amount
 *     breakdown) — cell values already formatted as text by the caller.
 * @returns {{
 *   a4: {w: number, h: number}, din5008: typeof DIN5008,
 *   datum: string, betreff: string, absender: string[], empfaenger: string[],
 *   seiten: Array<{nummer: number, zeilen: string[], tabelle: {kopf: string[], zeilen: string[][]}|null}>,
 *   zeichenJeZeile: number, zeilenHoeheMm: number, ersetzt: number,
 * }}
 */
export function briefLayout({ absender = [], empfaenger = [], datum = "", betreff = "", absaetze = [], tabelle = null } = {}) {
  let ersetztGesamt = 0;
  /** @param {unknown} wert */
  const reinigen = (wert) => {
    const r = saeubern(wert);
    ersetztGesamt += r.ersetzt;
    return r.text;
  };

  const breiteText = A4.w - DIN5008.randLinks - DIN5008.randRechts;
  const zeichenJeZeile = Math.max(10, Math.floor(breiteText / ZEICHENBREITE_10PT_MM));

  const absenderZeilen = absender.map(reinigen);
  const empfaengerZeilen = empfaenger.map(reinigen);
  const betreffText = reinigen(betreff);
  const datumText = reinigen(datum);

  const tabelleModell = tabelle ? {
    kopf: (tabelle.kopf || []).map(reinigen),
    zeilen: (tabelle.zeilen || []).map((zeile) => zeile.map(reinigen)),
  } : null;

  // One flat list of body lines with a blank line between paragraphs, so
  // pagination only has to count lines against each page's budget.
  const koerperZeilen = /** @type {string[]} */ ([]);
  absaetze.map(reinigen).forEach((absatz, i) => {
    if (i > 0) koerperZeilen.push("");
    koerperZeilen.push(...umbrechen(absatz, zeichenJeZeile));
  });

  const platzErsteSeite = A4.h - DIN5008.randUnten - DIN5008.textbeginn_y;
  const platzFolgeseite = A4.h - DIN5008.randUnten - DIN5008.randOben;
  const zeilenErsteSeite = Math.max(1, Math.floor(platzErsteSeite / ZEILENHOEHE_MM));
  const zeilenFolgeseite = Math.max(1, Math.floor(platzFolgeseite / ZEILENHOEHE_MM));

  /** @type {Array<{nummer: number, zeilen: string[], tabelle: {kopf: string[], zeilen: string[][]}|null}>} */
  const seiten = [];
  let rest = koerperZeilen;
  do {
    const budget = seiten.length === 0 ? zeilenErsteSeite : zeilenFolgeseite;
    seiten.push({ nummer: seiten.length + 1, zeilen: rest.slice(0, budget), tabelle: null });
    rest = rest.slice(budget);
  } while (rest.length > 0);

  // The amount table stays on the last page if it fits there (it must not be
  // separated from the paragraph introducing it); otherwise it starts a fresh
  // page of its own rather than being cut across a page break.
  if (tabelleModell) {
    const tabellenHoehe = (tabelleModell.kopf.length ? 1 : 0) + tabelleModell.zeilen.length + 1;
    const letzte = seiten[seiten.length - 1];
    const budget = letzte.nummer === 1 ? zeilenErsteSeite : zeilenFolgeseite;
    if (letzte.zeilen.length + tabellenHoehe <= budget) {
      letzte.tabelle = tabelleModell;
    } else {
      seiten.push({ nummer: seiten.length + 1, zeilen: [], tabelle: tabelleModell });
    }
  }

  return {
    a4: A4,
    din5008: DIN5008,
    datum: datumText,
    betreff: betreffText,
    absender: absenderZeilen,
    empfaenger: empfaengerZeilen,
    seiten,
    zeichenJeZeile,
    zeilenHoeheMm: ZEILENHOEHE_MM,
    ersetzt: ersetztGesamt,
  };
}
