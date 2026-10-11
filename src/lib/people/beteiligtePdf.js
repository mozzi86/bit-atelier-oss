// 90-07: project participant list as PDF, A4 landscape (the usual format of the office list: wide
// columns for company, contact person, phone and e-mail). Drawn with jspdf (existing dependency, imported
// dynamically); grouped by role group (Bauherr / Planung / Sachverständige und Behörden / Ausführung).
// No office stamp or office data — the header carries only project, client and date.
//
// In:  rows of beteiligte.zeilen(...) and the project ({ name, client, location }).
// Out: { bytes: Uint8Array, dateiname } — the caller downloads; tests read the uncompressed text.

/** A4 landscape in mm and layout [ASSUMED 15 mm margins, 20 mm left for filing]. */
export const QUER = Object.freeze({ w: 297, h: 210, links: 20, rechts: 12, oben: 14, unten: 14 });

/** Columns (mm). The address column only appears when at least one row has an address. */
const SPALTEN = [
  { key: "rolleLabel", t: "Rolle", w: 46 },
  { key: "firma", t: "Firma / Behörde", w: 52 },
  { key: "name", t: "Ansprechpartner", w: 40 },
  { key: "funktion", t: "Funktion", w: 30 },
  { key: "telefon", t: "Telefon", w: 30 },
  { key: "email", t: "E-Mail", w: 46 },
  { key: "bemerkung", t: "Bemerkung", w: 21 },
];

const safeName = (s) => String(s || "").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);

/**
 * @param {ReturnType<typeof import("./beteiligte.js").zeilen>} rows
 * @param {{name?: string, client?: string, location?: {city?: string}}|null} projekt
 * @param {{jetzt?: Date}} [o]
 * @returns {Promise<{bytes: Uint8Array, dateiname: string}>}
 */
export async function beteiligtePdf(rows, projekt, { jetzt = new Date() } = {}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const mitAdresse = rows.some((r) => r.adresse);
  // With addresses the remark column gives its width to an address column.
  const spalten = mitAdresse
    ? [...SPALTEN.slice(0, 4), { key: "adresse", t: "Adresse", w: 51 }, ...SPALTEN.slice(4, 6)].map((s) => (s.key === "funktion" ? { ...s, w: 0 } : s)).filter((s) => s.w)
    : SPALTEN;
  const breite = QUER.w - QUER.links - QUER.rechts;
  const stand = jetzt.toLocaleDateString("de-DE");
  let y = QUER.oben;

  const kopf = (erste) => {
    if (erste) {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text("Projektbeteiligtenliste", QUER.links, y + 6);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
      pdf.text([projekt?.name ? `Projekt: ${projekt.name}` : "", projekt?.client ? `Bauherr: ${projekt.client}` : "", projekt?.location?.city ? `Ort: ${projekt.location.city}` : "", `Stand: ${stand}`].filter(Boolean).join("   ·   "), QUER.links, y + 12);
      y += 17;
    }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
    let x = QUER.links;
    for (const s of spalten) { pdf.text(s.t, x + 1, y + 4); x += s.w; }
    pdf.setDrawColor(60); pdf.setLineWidth(0.3); pdf.line(QUER.links, y + 5.5, QUER.links + breite, y + 5.5);
    y += 7; pdf.setFont("helvetica", "normal");
  };
  const neueSeite = () => { pdf.addPage("a4", "landscape"); y = QUER.oben; kopf(false); };

  kopf(true);
  let gruppe = null;
  for (const r of rows) {
    if (r.gruppe !== gruppe) {
      if (y + 12 > QUER.h - QUER.unten) neueSeite();
      gruppe = r.gruppe;
      pdf.setFillColor(238, 242, 240); pdf.rect(QUER.links, y, breite, 5.5, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(8.5); pdf.text(gruppe, QUER.links + 1, y + 4); pdf.setFont("helvetica", "normal");
      y += 6.5;
    }
    // Row height follows the longest wrapped cell (max. 3 lines).
    pdf.setFontSize(8);
    const zellen = spalten.map((s) => pdf.splitTextToSize(String(r[s.key] ?? ""), s.w - 2).slice(0, 3));
    const h = Math.max(1, ...zellen.map((z) => z.length)) * 3.6 + 1.6;
    if (y + h > QUER.h - QUER.unten) neueSeite();
    let x = QUER.links;
    zellen.forEach((z, k) => { if (z.length) pdf.text(z, x + 1, y + 3.4); x += spalten[k].w; });
    pdf.setDrawColor(210); pdf.setLineWidth(0.1); pdf.line(QUER.links, y + h, QUER.links + breite, y + h);
    y += h;
  }
  if (!rows.length) { pdf.setFontSize(9); pdf.text("Noch keine Beteiligten eingetragen.", QUER.links, y + 5); }

  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    pdf.setPage(i); pdf.setFontSize(7); pdf.setTextColor(120);
    pdf.text(`Projektbeteiligtenliste · Stand ${stand} · Seite ${i} / ${n}`, QUER.links, QUER.h - 7);
    pdf.setTextColor(0);
  }
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `Projektbeteiligte_${safeName(projekt?.name) || "Projekt"}_${jetzt.toISOString().slice(0, 10)}.pdf` };
}
