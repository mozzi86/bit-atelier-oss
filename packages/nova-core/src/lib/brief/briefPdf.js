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

/**
 * @param {ReturnType<import("./briefLayout.js").briefLayout>} layout
 * @returns {Promise<Uint8Array>}
 */
export async function erzeugeBriefPdf(layout) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const D = layout.din5008;
  const rechtsX = layout.a4.w - D.randRechts;

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
    if (seite.tabelle) {
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
  });

  return new Uint8Array(pdf.output("arraybuffer"));
}
