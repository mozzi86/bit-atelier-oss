// befundkartePdf.js — A3 landscape PDF of the finding maps, one page per storey (66-08).
//
// In:  map models from befundkarte.kartenModell() and a header (model file,
//      check time, project, count of IDS findings without position).
// Out: triggers the browser download of "<name>_befundkarte.pdf".
//
// Drawn as vectors with jspdf primitives (existing dependency) instead of a
// raster image, so the sheet stays sharp when printed at A3. jspdf is imported
// dynamically — the check page does not pay for it until the button is pressed.
// Pure layout helpers are exported for tests; drawing needs a browser.

import { stilVon, massstabsbalkenM, BEFUND_STIL, LAGE_HINWEIS, umrissHinweis } from "./befundkarte.js";

/** A3 landscape in mm. */
export const A3 = { w: 420, h: 297 };
/** Page layout, mm [ASSUMED] office sheet: 10 mm margin, header 22 mm, legend column 70 mm. */
export const LAYOUT = { rand: 10, kopf: 22, legende: 70 };

/**
 * Plan field on the sheet and the scale (mm per metre) that fits the drawing box.
 * @param {{breite: number, tiefe: number}} box drawing size, metres
 * @returns {{x: number, y: number, w: number, h: number, mmJeM: number, massstab: number}}
 *   massstab = 1 : n (rounded display value)
 */
export function planFeld(box) {
  const fx = LAYOUT.rand, fy = LAYOUT.rand + LAYOUT.kopf;
  const fw = A3.w - 2 * LAYOUT.rand - LAYOUT.legende - 6;
  const fh = A3.h - fy - LAYOUT.rand;
  const mmJeM = Math.min(fw / box.breite, fh / box.tiefe);
  const w = box.breite * mmJeM, h = box.tiefe * mmJeM;
  return { x: fx + (fw - w) / 2, y: fy + (fh - h) / 2, w, h, mmJeM, massstab: Math.round(1000 / mmJeM) };
}

const hexZuRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Draws all maps into one PDF and downloads it.
 * @param {Array<ReturnType<import("./befundkarte.js").kartenModell>>} karten
 * @param {{modell?: string, projekt?: string, zeit?: Date, idsOhneLage?: number, dateiname?: string}} meta
 * @returns {Promise<string>} file name
 */
export async function befundkartePdf(karten, meta = {}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const zeit = (meta.zeit || new Date()).toLocaleString("de-DE");
  const arten = Object.keys(BEFUND_STIL);

  karten.forEach((k, seite) => {
    if (seite > 0) pdf.addPage("a3", "landscape");
    const R = LAYOUT.rand;
    // frame + header
    pdf.setDrawColor(30); pdf.setLineWidth(0.4); pdf.rect(R, R, A3.w - 2 * R, A3.h - 2 * R);
    pdf.setFontSize(16); pdf.setTextColor(20);
    pdf.text(`Befundkarte — ${k.geschoss}`, R + 4, R + 9);
    pdf.setFontSize(9); pdf.setTextColor(80);
    pdf.text(`${meta.projekt ? meta.projekt + " · " : ""}${meta.modell || ""} · Prüfung ${zeit} · ${k.marken.length} Befunde auf diesem Geschoss`
      + (meta.idsOhneLage ? ` · ${meta.idsOhneLage} IDS-Befunde ohne Lage (nicht auf der Karte)` : ""), R + 4, R + 15);
    // Only the finding list resolves every number: the printed report stops at 60 and
    // BCF topics carry no number (titles are kind + types, no <Index>).
    pdf.text(`Nummer = laufende Nummer in der Befundliste · ${umrissHinweis(k.umrissQuelle)}`, R + 4, R + 19.5);

    const F = planFeld(k.box);
    const X = (x) => F.x + (x - k.box.minX) * F.mmJeM;
    const Y = (z) => F.y + (z - k.box.minZ) * F.mmJeM;

    if (k.umriss && k.umriss.length >= 3) {
      pdf.setFillColor(241, 245, 249); pdf.setDrawColor(51, 65, 85); pdf.setLineWidth(0.35);
      const p0 = k.umriss[0];
      const segmente = k.umriss.slice(1).concat([p0]).map((p, i, arr) => {
        const vor = i === 0 ? p0 : arr[i - 1];
        return [(p.x - vor.x) * F.mmJeM, (p.z - vor.z) * F.mmJeM];
      });
      pdf.lines(segmente, X(p0.x), Y(p0.z), [1, 1], "FD", true);
    }

    const r = 2.6; // marker radius, mm
    for (const m of k.marken) {
      const st = stilVon(m.kind);
      const [cr, cg, cb] = hexZuRgb(st.farbe);
      const cx = X(m.x), cy = Y(m.z);
      pdf.setFillColor(cr, cg, cb); pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.3);
      if (st.form === "quadrat") pdf.rect(cx - r, cy - r, 2 * r, 2 * r, "FD");
      else if (st.form === "dreieck") pdf.triangle(cx, cy - r * 1.15, cx + r, cy + r * 0.75, cx - r, cy + r * 0.75, "FD");
      else if (st.form === "raute") pdf.lines([[r * 1.2, r * 1.2], [-r * 1.2, r * 1.2], [-r * 1.2, -r * 1.2]], cx, cy - r * 1.2, [1, 1], "FD", true);
      else pdf.circle(cx, cy, r, "FD");
      pdf.setFontSize(7); pdf.setTextColor(255, 255, 255);
      pdf.text(String(m.nr), cx, cy + 0.9, { align: "center" });
    }

    // north arrow + scale bar
    // Drawn arrow: the standard PDF font (WinAnsi) has no "↑" glyph.
    pdf.setTextColor(20); pdf.setFontSize(10); pdf.setFillColor(20, 20, 20);
    pdf.triangle(F.x + F.w - 6, F.y + 2, F.x + F.w - 4, F.y + 7, F.x + F.w - 8, F.y + 7, "F");
    pdf.text("N", F.x + F.w - 6, F.y + 11, { align: "center" });
    const balkenM = massstabsbalkenM(k.box.breite);
    const bl = balkenM * F.mmJeM;
    pdf.setDrawColor(20); pdf.setLineWidth(0.6);
    pdf.line(F.x + 2, F.y + F.h - 3, F.x + 2 + bl, F.y + F.h - 3);
    pdf.setFontSize(8);
    pdf.text(`${balkenM} m · ca. 1:${F.massstab}`, F.x + 2, F.y + F.h - 5);

    // legend
    const lx = A3.w - R - LAYOUT.legende, ly = R + LAYOUT.kopf;
    pdf.setDrawColor(30); pdf.setLineWidth(0.3); pdf.rect(lx, ly, LAYOUT.legende - 4, 8 + arten.length * 7);
    pdf.setFontSize(10); pdf.setTextColor(20); pdf.text("Legende", lx + 3, ly + 6);
    pdf.setFontSize(8);
    arten.forEach((a, i) => {
      const st = stilVon(a);
      const [cr, cg, cb] = hexZuRgb(st.farbe);
      const yy = ly + 12 + i * 7;
      pdf.setFillColor(cr, cg, cb);
      if (st.form === "quadrat") pdf.rect(lx + 3, yy - 3, 4, 4, "F");
      else if (st.form === "dreieck") pdf.triangle(lx + 5, yy - 3.3, lx + 7, yy + 0.8, lx + 3, yy + 0.8, "F");
      else if (st.form === "raute") pdf.lines([[2, 2], [-2, 2], [-2, -2]], lx + 5, yy - 3, [1, 1], "F", true);
      else pdf.circle(lx + 5, yy - 1, 2, "F");
      pdf.setTextColor(40); pdf.text(st.label, lx + 10, yy);
    });
    // How positions are derived (see befundkarte.lageVon) — below the legend box.
    pdf.setFontSize(7.5); pdf.setTextColor(80);
    pdf.text(pdf.splitTextToSize(LAGE_HINWEIS, LAYOUT.legende - 6), lx, ly + 14 + arten.length * 7);
  });

  const name = meta.dateiname || "befundkarte.pdf";
  pdf.save(name);
  return name;
}
