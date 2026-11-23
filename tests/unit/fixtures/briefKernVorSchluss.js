// Frozen copy of packages/nova-core/src/lib/brief/briefLayout.js and briefPdf.js as of commit 34d78c7f — the letter core
// BEFORE the closing block `schluss` (text after the amount table, user finding 15.11.2026). The reference
// tests/unit/briefSchluss.test.js compares the current core against: a letter without `schluss` must give exactly the same
// page model and the same PDF bytes as this copy. Only the import path differs and the file-head comments are dropped.
// Do not edit.

import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";
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

/** Free space kept between a wrapped cell and the next column, in mm. */
const ZELLEN_ABSTAND_MM = 3;

/**
 * Splits one table row into several when a cell of a LEFT-aligned column is longer than its column (width in mm at the
 * 10 pt character budget ZEICHENBREITE_10PT_MM, minus ZELLEN_ABSTAND_MM). Right-aligned cells (amounts, shares) stay on the
 * first line. A single word longer than the column is not cut (as in the body text).
 * @param {string[]} zeile cells of one row (already cleaned)
 * @param {BriefSpalte[]} spalten column widths and alignment
 * @returns {string[][]} the row itself when everything fits, else one row per text line
 */
function zeileUmbrechen(zeile, spalten) {
  const teile = zeile.map((zelle, k) => {
    const sp = spalten[k];
    if (!sp || sp.ausrichtung !== "links" || !(sp.breite_mm > 0)) return [zelle];
    const zeichen = Math.max(8, Math.floor((sp.breite_mm - ZELLEN_ABSTAND_MM) / ZEICHENBREITE_10PT_MM));
    return zelle.length > zeichen ? umbrechen(zelle, zeichen) : [zelle];
  });
  const hoehe = Math.max(1, ...teile.map((t) => t.length));
  if (hoehe === 1) return [zeile];
  return Array.from({ length: hoehe }, (_, i) => teile.map((t) => t[i] ?? ""));
}

/**
 * Column of a table (phase 81-03): width in mm and alignment of its cells.
 * @typedef {{breite_mm: number, ausrichtung?: 'links'|'rechts'}} BriefSpalte
 */

/**
 * @param {{
 *   absender?: string[], empfaenger?: string[], datum?: string, betreff?: string,
 *   absaetze?: string[], tabelle?: {kopf?: string[], zeilen: string[][], spalten?: BriefSpalte[]}|null,
 *   seitenzahlen?: boolean, variante?: 'verteiler'|null, verteiler?: string[], fusszeileLinks?: string,
 * }} eingabe
 *   absender/empfaenger: address lines, top to bottom;
 *   absaetze: body paragraphs (each wrapped and separated by a blank line);
 *   tabelle: a right-aligned block at the end of the body (e.g. an amount
 *     breakdown) — cell values already formatted as text by the caller;
 *     `spalten` (81-03) draws it in columns;
 *   seitenzahlen (81-03): "Seite n von m" on every page;
 *   variante/verteiler (82-05): protocol letter with distribution list, no address field;
 *   fusszeileLinks (82-05): office line bottom left on every page.
 * @returns {{
 *   a4: {w: number, h: number}, din5008: typeof DIN5008,
 *   datum: string, betreff: string, absender: string[], empfaenger: string[],
 *   seiten: Array<{nummer: number, zeilen: string[], tabelle: {kopf: string[], zeilen: string[][], spalten?: BriefSpalte[]}|null, fusszeile?: string, fussLinks?: string}>,
 *   zeichenJeZeile: number, zeilenHoeheMm: number, ersetzt: number, variante?: 'verteiler', verteiler?: string[],
 * }}
 */
export function briefLayout({ absender = [], empfaenger = [], datum = "", betreff = "", absaetze = [], tabelle = null, seitenzahlen = false, variante = null, verteiler = [], fusszeileLinks = "" } = {}) {
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
  const istVerteiler = variante === "verteiler";
  // 82-05: a protocol letter has no address field.
  const empfaengerZeilen = istVerteiler ? [] : empfaenger.map(reinigen);
  const verteilerZeilen = istVerteiler ? (verteiler || []).map(reinigen).filter(Boolean) : [];
  const betreffText = reinigen(betreff);
  const datumText = reinigen(datum);

  /** @type {{kopf: string[], zeilen: string[][], spalten?: BriefSpalte[]}|null} */
  const tabelleModell = tabelle ? {
    kopf: (tabelle.kopf || []).map(reinigen),
    zeilen: (tabelle.zeilen || []).map((zeile) => zeile.map(reinigen)),
  } : null;
  // 81-03: the key appears only when columns were asked for (79's model stays identical).
  if (tabelleModell && Array.isArray(tabelle?.spalten)) tabelleModell.spalten = tabelle.spalten.map((sp) => ({ breite_mm: Number(sp.breite_mm) || 0, ausrichtung: sp.ausrichtung === "links" ? "links" : "rechts" }));

  // User finding 15.11.2026 (fee offer): a long first cell ("Besondere Leistung: …") ran across the amount column. A cell of a
  // left-aligned column is wrapped to its column width; the continuation lines are rows of their own with the other cells
  // empty, so the pagination below counts them and the PDF writer needs no change. Rows that fit stay exactly as they were.
  if (tabelleModell?.spalten) {
    const spalten = tabelleModell.spalten;
    tabelleModell.zeilen = tabelleModell.zeilen.flatMap((zeile) => zeileUmbrechen(zeile, spalten));
  }

  // One flat list of body lines with a blank line between paragraphs, so
  // pagination only has to count lines against each page's budget.
  const koerperZeilen = /** @type {string[]} */ ([]);
  if (istVerteiler) koerperZeilen.push("Verteiler:", ...verteilerZeilen.map((z) => `- ${z}`), "");
  absaetze.map(reinigen).forEach((absatz, i) => {
    if (i > 0) koerperZeilen.push("");
    koerperZeilen.push(...umbrechen(absatz, zeichenJeZeile));
  });

  const platzErsteSeite = A4.h - DIN5008.randUnten - DIN5008.textbeginn_y;
  const platzFolgeseite = A4.h - DIN5008.randUnten - DIN5008.randOben;
  const zeilenErsteSeite = Math.max(1, Math.floor(platzErsteSeite / ZEILENHOEHE_MM));
  const zeilenFolgeseite = Math.max(1, Math.floor(platzFolgeseite / ZEILENHOEHE_MM));

  /** @type {Array<{nummer: number, zeilen: string[], tabelle: {kopf: string[], zeilen: string[][], spalten?: BriefSpalte[]}|null, fusszeile?: string, fussLinks?: string}>} */
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
    const kopfZeilen = tabelleModell.kopf.length ? 1 : 0;
    const tabellenHoehe = kopfZeilen + tabelleModell.zeilen.length + 1;
    const letzte = seiten[seiten.length - 1];
    const budget = letzte.nummer === 1 ? zeilenErsteSeite : zeilenFolgeseite;
    if (letzte.zeilen.length + tabellenHoehe <= budget) {
      letzte.tabelle = tabelleModell;
    } else if (tabellenHoehe <= zeilenFolgeseite) {
      seiten.push({ nummer: seiten.length + 1, zeilen: [], tabelle: tabelleModell });
    } else {
      // 81-03: longer than a whole page — split it, the head row repeated on every
      // part (79 placed it whole and it ran over the page edge).
      const teil = (/** @type {string[][]} */ zeilen) => ({ ...tabelleModell, zeilen });
      let restZeilen = tabelleModell.zeilen;
      const platzLetzte = budget - letzte.zeilen.length - 1 - kopfZeilen;
      if (platzLetzte >= 2) {
        letzte.tabelle = teil(restZeilen.slice(0, platzLetzte));
        restZeilen = restZeilen.slice(platzLetzte);
      }
      const jeSeite = Math.max(1, zeilenFolgeseite - 1 - kopfZeilen);
      while (restZeilen.length) {
        seiten.push({ nummer: seiten.length + 1, zeilen: [], tabelle: teil(restZeilen.slice(0, jeSeite)) });
        restZeilen = restZeilen.slice(jeSeite);
      }
    }
  }

  // 81-03: page numbers only on request.
  if (seitenzahlen) for (const seite of seiten) seite.fusszeile = `Seite ${seite.nummer} von ${seiten.length}`;
  // 82-05: office line only on request.
  const fussLinks = fusszeileLinks ? reinigen(fusszeileLinks) : "";
  if (fussLinks) for (const seite of seiten) seite.fussLinks = fussLinks;

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
    ...(istVerteiler ? { variante: /** @type {'verteiler'} */ ("verteiler"), verteiler: verteilerZeilen } : {}),
  };
}

/**
 * @param {ReturnType<briefLayout>} layout
 * @param {{fixiert?: {erstelltAm: string, dateiId: string}|null}} [optionen]
 *   fixiert.erstelltAm: ISO timestamp; fixiert.dateiId: 32 hex characters
 * @returns {Promise<Uint8Array>}
 */
export async function erzeugeBriefPdf(layout, { fixiert = null } = {}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const D = layout.din5008;
  const rechtsX = layout.a4.w - D.randRechts;
  if (fixiert) {
    pdf.setCreationDate(new Date(fixiert.erstelltAm));
    pdf.setFileId(String(fixiert.dateiId).toUpperCase());
    pdf.setDocumentProperties({ title: layout.betreff, creator: "BIT-Atelier" });
  }

  layout.seiten.forEach((seite, i) => {
    if (i > 0) pdf.addPage("a4", "portrait");

    // Fold and punch marks: short vector ticks at the left edge, every page —
    // the sheet is printed and folded the same way throughout.
    pdf.setDrawColor(120);
    pdf.setLineWidth(0.2);
    pdf.line(0, D.falzmarke1_y, 5, D.falzmarke1_y);
    pdf.line(0, D.falzmarke2_y, 5, D.falzmarke2_y);
    pdf.line(0, D.lochmarke_y, 4, D.lochmarke_y);
    pdf.setTextColor(20);

    let y = D.randOben + layout.zeilenHoeheMm;
    if (i === 0) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      if (layout.absender.length) pdf.text(layout.absender.join(" · "), D.anschrift.x, D.absenderzeile_y);
      pdf.setFontSize(11);
      layout.empfaenger.forEach((zeile, j) => pdf.text(zeile, D.anschrift.x, D.anschrift.y + j * 5));
      pdf.setFontSize(10);
      if (layout.datum) pdf.text(layout.datum, rechtsX, D.anschrift.y, { align: "right" });
      pdf.setFont("helvetica", "bold");
      pdf.text(layout.betreff, D.randLinks, D.textbeginn_y - layout.zeilenHoeheMm);
      pdf.setFont("helvetica", "normal");
      y = D.textbeginn_y;
    }

    pdf.setFontSize(10);
    for (const zeile of seite.zeilen) {
      pdf.text(zeile, D.randLinks, y);
      y += layout.zeilenHoeheMm;
    }
    if (seite.tabelle?.spalten) {
      // 81-03: columns from the left margin, each cell aligned in its own width.
      const spalten = seite.tabelle.spalten;
      const zeichneZeile = (/** @type {string[]} */ zellen) => {
        let x = D.randLinks;
        zellen.forEach((zelle, k) => {
          const sp = spalten[k] || { breite_mm: 30, ausrichtung: "rechts" };
          if (sp.ausrichtung === "links") pdf.text(zelle, x, y);
          else pdf.text(zelle, x + sp.breite_mm, y, { align: "right" });
          x += sp.breite_mm;
        });
        y += layout.zeilenHoeheMm;
      };
      y += layout.zeilenHoeheMm;
      if (seite.tabelle.kopf.length) {
        pdf.setFont("helvetica", "bold");
        zeichneZeile(seite.tabelle.kopf);
        pdf.setFont("helvetica", "normal");
      }
      for (const zeile of seite.tabelle.zeilen) zeichneZeile(zeile);
    } else if (seite.tabelle) {
      y += layout.zeilenHoeheMm;
      if (seite.tabelle.kopf.length) {
        pdf.text(seite.tabelle.kopf.join("   "), rechtsX, y, { align: "right" });
        y += layout.zeilenHoeheMm;
      }
      for (const zeile of seite.tabelle.zeilen) {
        pdf.text(zeile.join("   "), rechtsX, y, { align: "right" });
        y += layout.zeilenHoeheMm;
      }
    }
    if (seite.fussLinks) {
      // 82-05: office line bottom left (the text was cleaned by briefLayout).
      pdf.setFontSize(8);
      pdf.text(seite.fussLinks, D.randLinks, layout.a4.h - D.randUnten / 2);
      pdf.setFontSize(10);
    }
    if (seite.fusszeile) {
      pdf.setFontSize(8);
      pdf.text(seite.fusszeile, rechtsX, layout.a4.h - D.randUnten / 2, { align: "right" });
      pdf.setFontSize(10);
    }
  });

  return new Uint8Array(pdf.output("arraybuffer"));
}
