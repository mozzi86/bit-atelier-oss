// 91-04: sustainability concept sheet as PDF (A4 portrait, one page in the normal case). Draws the model of
// nachhaltigkeitskonzept.js — four sections with figures, status and notes, plus the open gaps — and marks
// estimates with "ca." and a footnote. ENTWURF watermark: the sheet summarises planning figures, it is no
// certificate (no DGNB/QNG/BNB assessment).
// jspdf is imported dynamically (existing dependency); the watermark is drawn first on every page so it
// never covers figures.
//
// In:  model (nachhaltigkeitsModell), project ({ name, client }), { jetzt }.
// Out: { bytes: Uint8Array, dateiname } — the caller downloads; tests read the uncompressed text.
import { wertText, STATUS_TEXT } from "@designer/lib/nachhaltigkeitskonzept";

/** A4 portrait in mm [ASSUMED 20 mm left for filing, 15 mm elsewhere]. */
export const HOCH = Object.freeze({ w: 210, h: 297, links: 20, rechts: 15, oben: 16, unten: 16 });
export const WARNUNG_TEXT = "Entwurf aus dem Planungsstand — keine Zertifizierung (DGNB/QNG/BNB) und kein Nachweis gegenüber Behörden.";

const safeName = (s) => String(s || "").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
const FARBE = { umgesetzt: [22, 128, 61], teilweise: [180, 110, 0], offen: [120, 120, 120] };

/**
 * @param {ReturnType<typeof import("./nachhaltigkeitskonzept.js").nachhaltigkeitsModell>} modell
 * @param {{name?: string, client?: string}|null} projekt
 * @param {{jetzt?: Date}} [o]
 * @returns {Promise<{bytes: Uint8Array, dateiname: string, seiten: number}>}
 */
export async function nachhaltigkeitPdf(modell, projekt, { jetzt = new Date() } = {}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const breite = HOCH.w - HOCH.links - HOCH.rechts;
  const stand = jetzt.toLocaleDateString("de-DE");
  let y = HOCH.oben;
  let schaetzung = false;

  const wasserzeichen = () => {
    pdf.saveGraphicsState?.();
    pdf.setTextColor(235); pdf.setFont("helvetica", "bold"); pdf.setFontSize(70);
    pdf.text("ENTWURF", HOCH.w / 2, HOCH.h / 2, { align: "center", angle: 45 });
    pdf.restoreGraphicsState?.();
    pdf.setTextColor(0); pdf.setFont("helvetica", "normal");
  };
  const neueSeite = () => { pdf.addPage("a4", "portrait"); wasserzeichen(); y = HOCH.oben; };
  const platz = (h) => { if (y + h > HOCH.h - HOCH.unten - 8) neueSeite(); };

  wasserzeichen();
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.text("Nachhaltigkeitskonzept", HOCH.links, y + 6);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  pdf.text([projekt?.name ? `Projekt: ${projekt.name}` : "", projekt?.client ? `Bauherr: ${projekt.client}` : "", `Stand: ${stand}`].filter(Boolean).join("   ·   "), HOCH.links, y + 12);
  pdf.setFontSize(8); pdf.setTextColor(150, 60, 0);
  pdf.text(pdf.splitTextToSize(WARNUNG_TEXT, breite), HOCH.links, y + 17);
  pdf.setTextColor(0);
  y += 23;

  for (const a of modell.abschnitte) {
    platz(16);
    pdf.setFillColor(238, 242, 240); pdf.rect(HOCH.links, y, breite, 7, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10.5); pdf.text(a.titel, HOCH.links + 2, y + 5);
    const [r, g, b] = FARBE[a.status] || FARBE.offen;
    pdf.setTextColor(r, g, b); pdf.setFontSize(8.5);
    pdf.text(STATUS_TEXT[a.status] || a.status, HOCH.links + breite - 2, y + 5, { align: "right" });
    pdf.setTextColor(0); pdf.setFont("helvetica", "normal");
    y += 9;
    pdf.setFontSize(9);
    for (const z of a.zeilen) {
      platz(5);
      if (z.geschaetzt) schaetzung = true;
      pdf.text(z.label, HOCH.links + 2, y + 3.5);
      pdf.text(`${z.geschaetzt ? "ca. " : ""}${wertText(z)}`, HOCH.links + 110, y + 3.5, { align: "right" });
      y += 5;
    }
    pdf.setFontSize(8); pdf.setTextColor(70);
    for (const h of a.hinweise) {
      const zeilen = pdf.splitTextToSize(`– ${h}`, breite - 4);
      platz(zeilen.length * 3.6 + 1);
      pdf.text(zeilen, HOCH.links + 2, y + 3.2);
      y += zeilen.length * 3.6 + 0.6;
    }
    pdf.setTextColor(0);
    y += 4;
  }

  if (modell.luecken.length) {
    platz(12);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.text("Offene Angaben", HOCH.links, y + 4);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); y += 7;
    for (const l of modell.luecken) {
      const zeilen = pdf.splitTextToSize(`[ ] ${l}`, breite - 2);
      platz(zeilen.length * 3.8 + 1);
      pdf.text(zeilen, HOCH.links + 1, y + 3.3);
      y += zeilen.length * 3.8 + 0.6;
    }
  }

  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    pdf.setPage(i); pdf.setFontSize(7); pdf.setTextColor(120);
    const fuss = `Nachhaltigkeitskonzept · Stand ${stand} · Seite ${i} / ${n}${schaetzung ? " · ca. = Schätzung aus Faustwerten" : ""}`;
    pdf.text(fuss, HOCH.links, HOCH.h - 8);
    pdf.setTextColor(0);
  }
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `Nachhaltigkeitskonzept_${safeName(projekt?.name) || "Projekt"}_${jetzt.toISOString().slice(0, 10)}.pdf`, seiten: n };
}
