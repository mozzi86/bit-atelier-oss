// Draws a briefLayout() model as a PDF — the shared letter core's browser-only
// half (phase 79-03, reused by phases 81/82 — D-P79-27).
//
// jsPDF is loaded dynamically (`await import("jspdf")`), so the letter preview
// and the layout test never pay for it. The letter text is written as a plain
// JS string, NOT re-encoded to CP1252 bytes first: briefLayout() already ran
// every field through winAnsi.ersetzeNichtWinAnsi(), and jsPDF's standard 14
// fonts (Helvetica) already map a Unicode JS string to WinAnsi internally for
// `pdf.text()` — pre-encoding here would run that mapping twice and turn a
// correct byte back into the wrong glyph. The DIN 5008 fold and punch marks
// have no glyph at all and are drawn as vector lines ("Symbole als Pfade",
// same technique as befundkartePdf.js's finding markers).
//
// In:  a briefLayout() model. Out: PDF bytes (Uint8Array).
//
// Phase 81 (81-03) adds, as options that change nothing without them:
// - `fixiert: {erstelltAm, dateiId}` → creation date and file id are fixed, so
//   the same letter gives the same bytes and the same SHA-256 (the stored proof
//   of a sent fee offer); title from the subject, creator "BIT-Atelier";
// - a page `fusszeile` ("Seite n von m") is drawn bottom right;
// - a table with `spalten` is drawn in columns (head bold) instead of one joined
//   right-aligned line. jsPDF also runs under node (its node build), so the
//   unit tests hash and read real PDFs.
// Phase 82 (82-05): a page `fussLinks` (office line) is drawn bottom left; the
// protocol variant needs nothing here (briefLayout puts the distribution list
// into the body lines and leaves the address field empty).
// Phase 115 (user finding 15.11.2026): a page's `zeilenNach` — the closing block of a
// letter with an amount table — is drawn below the table; pages without it are drawn as before.

/**
 * Content language of every letter (German text), BCP 47. Same value as PDF_SPRACHE_STANDARD in ../pdfMetadaten.js, kept
 * here because that helper is only imported dynamically (W0-F6: a static import put its chunk into the entry's preload
 * map); tests/unit/pdfMetadaten-nachgang.test.js checks that both stay equal.
 */
const BRIEF_SPRACHE = "de-DE";

/**
 * The `fixiert` option of a letter in a given layout/template version (105-19 follow-up): letters of a version that
 * carries the document language get `sprache` (German content → BRIEF_SPRACHE, "de-DE"); older versions keep `fixiert`
 * as it was, so a letter fixed before is rebuilt byte for byte.
 * @param {{erstelltAm: string, dateiId: string}|null|undefined} fixiert erstelltAm: ISO timestamp; dateiId: 32 hex
 * @param {boolean} mitSprache true when the letter's version is at least the first one with /Lang
 * @returns {{erstelltAm: string, dateiId: string, sprache?: string}|null}
 */
export function fixiertFuerVersion(fixiert, mitSprache) {
  if (!fixiert) return null;
  return mitSprache ? { ...fixiert, sprache: BRIEF_SPRACHE } : fixiert;
}

/**
 * @param {ReturnType<import("./briefLayout.js").briefLayout>} layout
 * @param {{fixiert?: {erstelltAm: string, dateiId: string, sprache?: string}|null}} [optionen]
 *   fixiert.erstelltAm: ISO timestamp; fixiert.dateiId: 32 hex characters; fixiert.sprache: BCP 47 tag written as
 *   /Lang (with DisplayDocTitle) — only for letters fixed with a version that carries it, see above
 * @returns {Promise<Uint8Array>}
 */
export async function erzeugeBriefPdf(layout, { fixiert = null } = {}) {
  // W0-F6: the metadata helper is imported dynamically, so the entry's preload map does not name its chunk.
  const [{ jsPDF }, { jsPdfMetadaten }] = await Promise.all([import("jspdf"), import("../pdfMetadaten.js")]);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const D = layout.din5008;
  const rechtsX = layout.a4.w - D.randRechts;
  if (fixiert) {
    pdf.setCreationDate(new Date(fixiert.erstelltAm));
    pdf.setFileId(String(fixiert.dateiId).toUpperCase());
    // 105-19: a fixed letter is re-rendered and must give the bytes of its stored SHA-256. So /Lang and DisplayDocTitle
    // come with a version: the caller passes `fixiert.sprache` only for letters fixed with a version that has them
    // (correspondence LAYOUT_VERSION >= 2, fee letters template version >= 3); without it the metadata stay exactly
    // as before (title + creator, no /Lang) — tests/unit/briefSchluss.test.js "PDF byte-identisch".
    if (fixiert.sprache) jsPdfMetadaten(pdf, { titel: layout.betreff, sprache: fixiert.sprache });
    else pdf.setDocumentProperties({ title: layout.betreff, creator: "BIT-Atelier" });
  } else {
    // 105-19: /Lang and /Title for every letter that is not fixed.
    jsPdfMetadaten(pdf, { titel: layout.betreff });
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
    if (seite.zeilenNach?.length) {
      // 115: the closing block (closing text, greeting, draft note) below the table, one blank line apart from what
      // this page already carries — briefLayout counted exactly this blank line into the page budget.
      if (seite.zeilen.length || seite.tabelle) y += layout.zeilenHoeheMm;
      for (const zeile of seite.zeilenNach) {
        pdf.text(zeile, D.randLinks, y);
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
