// Feuerwehrplan (DIN 14095) as a concept sheet — Phase 38, BSP-05.
//
// In:  the plan SVG of the Brandschutz-Plan-Editor (rasterised here), project/storey/date,
//      legend rows [{ farbe, label, anzahl?, art: "flaeche"|"linie"|"punkt"|"symbol" }], hints.
// Out: one A4 landscape PDF via jsPDF: frame, title block, plan field (aspect kept, centred),
//      legend column, liability line. The layout maths is pure (feuerwehrplanLayout) and
//      unit-tested; rasterising and jsPDF need a browser (svgZuPng, feuerwehrplanPdf).
// Pattern: BitBimStudio plan export (SVG → canvas → jsPDF) + title block; extended by legend
// and the honesty line — this is a CONCEPT plan, never a checked Feuerwehrplan.
// 106-11 review: the sheet draws the walls of the BIM model, so it carries the model state like the
// vector plans: a title block line "Modellstand", the machine-readable state line in the PDF keywords,
// and - while AI changes are unreleased or the state is unknown (null) - the dashed note box
// "Enthält ungeprüfte KI-Änderungen" above the liability line (@core/lib/zeigen/planStand.js). The
// raster plan carries no marks, so the note says "0 von n Bauteilen auf diesem Blatt markiert".
import { VERMERK_DRUCK, modellstandMetadaten, modellstandText, vermerkZeilen } from "@core/lib/zeigen/planStand.js";
import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";

/** A4 landscape in mm. */
export const A4_QUER = { w: 297, h: 210 };
/**
 * Sheet margins and block heights in mm. [ASSUMED] DIN 14095 prescribes content, not this layout.
 * 106-11 review: title block 22 -> 27 mm for the line "Modellstand"; vermerkKopfH / vermerkZeileH: height of the note box
 * = head + lines × line height.
 */
export const BLATT = { rand: 10, titelH: 27, hinweisH: 10, legendeB: 72, luecke: 4, vermerkKopfH: 10, vermerkZeileH: 4 };

/**
 * Sheet layout in mm — frame, title block, plan field (image fitted, aspect kept, centred),
 * legend column (right), note box of unreleased AI changes (106-11, below the plan field, only
 * with note lines), liability/hint line (bottom).
 * @param {{ pageW?: number, pageH?: number, imgW: number, imgH: number, legendeZeilen?: number, vermerkZeilen?: number }} p
 *   imgW/imgH in px; vermerkZeilen: lines of the note (0 = no note box)
 * @returns {{ rahmen: any, titel: any, plan: any, planFeld: any, legende: any, hinweis: any, vermerk: any, zeilenHoehe: number }}
 *   all in mm; vermerk null without note lines
 */
export function feuerwehrplanLayout({ pageW = A4_QUER.w, pageH = A4_QUER.h, imgW, imgH, legendeZeilen = 0, vermerkZeilen = 0 }) {
  const { rand, titelH, hinweisH, legendeB, luecke, vermerkKopfH, vermerkZeileH } = BLATT;
  const rahmen = { x: rand, y: rand, w: pageW - 2 * rand, h: pageH - 2 * rand };
  const titel = { x: rahmen.x, y: rahmen.y, w: rahmen.w, h: titelH };
  const hinweis = { x: rahmen.x, y: rahmen.y + rahmen.h - hinweisH, w: rahmen.w, h: hinweisH };
  const innenY = titel.y + titel.h + luecke;
  const innenH = hinweis.y - luecke - innenY;
  const legende = { x: rahmen.x + rahmen.w - legendeB, y: innenY, w: legendeB, h: innenH };
  const feldB = legende.x - luecke - (rahmen.x + luecke);
  const vh = vermerkZeilen > 0 ? vermerkKopfH + vermerkZeilen * vermerkZeileH : 0;
  const vermerk = vh ? { x: rahmen.x + luecke, y: hinweis.y - luecke - vh, w: feldB, h: vh } : null;
  const planFeld = { x: rahmen.x + luecke, y: innenY, w: feldB, h: innenH - (vh ? vh + luecke : 0) };
  // fit the image into the plan field, keep aspect, centre
  const ar = imgW > 0 && imgH > 0 ? imgW / imgH : 4 / 3;
  let w = planFeld.w, h = w / ar;
  if (h > planFeld.h) { h = planFeld.h; w = h * ar; }
  const plan = { x: planFeld.x + (planFeld.w - w) / 2, y: planFeld.y + (planFeld.h - h) / 2, w, h };
  // legend rows: 6 mm each, shrink when many rows must fit
  const zeilenHoehe = legendeZeilen > 0 ? Math.min(6, Math.max(3.5, (legende.h - 14) / legendeZeilen)) : 6;
  return { rahmen, titel, plan, planFeld, legende, hinweis, vermerk, zeilenHoehe };
}

/**
 * Rasterise an inline SVG element to a PNG data URL (white background). Browser only.
 * @param {SVGSVGElement} svgEl
 * @param {number} [scale=3] device pixels per SVG unit
 * @returns {Promise<{dataUrl: string, w: number, h: number}>} w/h in px
 */
export async function svgZuPng(svgEl, scale = 3) {
  const xml = new XMLSerializer().serializeToString(svgEl);
  const src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
  const vb = (svgEl.getAttribute("viewBox") || "0 0 800 600").split(/\s+/).map(Number);
  const W = vb[2] || 800, H = vb[3] || 600;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
}

/** Liability line printed on every sheet — the plan is a concept, not a checked Feuerwehrplan. */
export const HAFTUNGSZEILE = "Konzeptplan — kein Feuerwehrplan nach DIN 14095. Erstellung, Abstimmung mit der Feuerwehr und Freigabe durch Fachplaner:in Brandschutz erforderlich. Symbole schematisch nach DIN 14034-6.";

const hexZuRgb = (hex) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ""); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [80, 80, 80]; };

/**
 * Build and save the sheet. Browser only (jsPDF loaded on demand like the BitBimStudio export).
 * 106-11 review: `modellstand` (planStand.js ModellStand; null/undefined = not determined -> the note says so) goes into the
 * title block, the keywords and the note box; there is no option to print without it.
 * @param {{ png: {dataUrl:string, w:number, h:number}, projekt: string, geschoss: string, datum: string,
 *   legende: Array<{farbe:string,label:string,anzahl?:number,art?:string}>, hinweise?: string[], dateiname?: string,
 *   modellstand?: import("@core/lib/zeigen/planStand.js").ModellStand|null, t?: (s: string) => string }} p
 *   t: translator of the note (default German, like the vector plans)
 * @returns {Promise<{ seiten: number, dateiname: string, vermerk: boolean }>}  vermerk: the sheet carries the note
 */
export async function feuerwehrplanPdf({ png, projekt, geschoss, datum, legende = [], hinweise = [], dateiname, modellstand = null, t = (s) => s }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  // the raster plan carries no marks: "0 von n Bauteilen auf diesem Blatt markiert"
  const vz = vermerkZeilen(modellstand, t, { markiert: 0 });
  const L = feuerwehrplanLayout({ imgW: png.w, imgH: png.h, legendeZeilen: legende.length + hinweise.length, vermerkZeilen: vz ? vz.zeilen.length : 0 });
  pdf.setProperties({ keywords: modellstandMetadaten(modellstand) });
  // element names come from people and agents: characters outside WinAnsi become "?" (jsPDF's standard fonts)
  const druck = (/** @type {string} */ s) => ersetzeNichtWinAnsi(String(s)).text;

  // frame + title block
  pdf.setDrawColor(30); pdf.setLineWidth(0.5); pdf.rect(L.rahmen.x, L.rahmen.y, L.rahmen.w, L.rahmen.h);
  pdf.setLineWidth(0.3); pdf.rect(L.titel.x, L.titel.y, L.titel.w, L.titel.h);
  pdf.setFontSize(15); pdf.setTextColor(20); pdf.text(`Feuerwehrplan (Konzept) — ${geschoss}`, L.titel.x + 4, L.titel.y + 8);
  pdf.setFontSize(9); pdf.setTextColor(70);
  pdf.text(`${projekt} · Stand ${datum} · Geschossplan nach DIN 14095 — Konzeptstufe, nicht geprüft`, L.titel.x + 4, L.titel.y + 14);
  pdf.text("Maßstab: nicht maßstäblich — Maßstabsbalken und Nordpfeil im Plan · Quelle: BIT-Atelier Gebäudemodell", L.titel.x + 4, L.titel.y + 19);
  pdf.text(druck(`Modellstand: ${modellstandText(modellstand, t)}`), L.titel.x + 4, L.titel.y + 24);

  // plan
  pdf.addImage(png.dataUrl, "PNG", L.plan.x, L.plan.y, L.plan.w, L.plan.h);
  pdf.setDrawColor(120); pdf.rect(L.planFeld.x, L.planFeld.y, L.planFeld.w, L.planFeld.h);

  // legend
  pdf.setDrawColor(30); pdf.rect(L.legende.x, L.legende.y, L.legende.w, L.legende.h);
  pdf.setFontSize(10); pdf.setTextColor(20); pdf.text("Legende", L.legende.x + 3, L.legende.y + 6);
  let y = L.legende.y + 12;
  pdf.setFontSize(8);
  legende.forEach((z) => {
    const [r, g, b] = hexZuRgb(z.farbe);
    pdf.setFillColor(r, g, b); pdf.setDrawColor(r, g, b);
    if (z.art === "linie") { pdf.setLineWidth(0.8); pdf.line(L.legende.x + 3, y - 1.2, L.legende.x + 9, y - 1.2); }
    else if (z.art === "punkt") pdf.circle(L.legende.x + 6, y - 1.2, 1.4, "F");
    else pdf.rect(L.legende.x + 3, y - 3.2, 6, 4, z.art === "flaeche" ? "S" : "F");
    pdf.setTextColor(30);
    pdf.text(`${z.label}${z.anzahl != null ? ` (${z.anzahl})` : ""}`, L.legende.x + 11, y);
    y += L.zeilenHoehe;
  });
  if (hinweise.length) {
    y += 2; pdf.setTextColor(150, 60, 0); pdf.text("Hinweise (Checks):", L.legende.x + 3, y); y += L.zeilenHoehe;
    hinweise.forEach((h) => { pdf.text(pdf.splitTextToSize(`• ${h}`, L.legende.w - 6), L.legende.x + 3, y); y += L.zeilenHoehe; });
  }

  // 106-11: note box - dashed border, "?" in a dashed square, title and lines (light warning tokens, VERMERK_DRUCK)
  if (vz && L.vermerk) {
    const V = L.vermerk;
    const [lr, lg, lb] = hexZuRgb(VERMERK_DRUCK.linie), [fr, fg, fb] = hexZuRgb(VERMERK_DRUCK.flaeche);
    pdf.setLineDashPattern(VERMERK_DRUCK.strich.split(/\s+/).map((n) => Number(n) * 1.5), 0);
    pdf.setDrawColor(lr, lg, lb); pdf.setFillColor(fr, fg, fb); pdf.setLineWidth(0.6);
    pdf.rect(V.x, V.y, V.w, V.h, "FD");
    pdf.setLineWidth(0.4); pdf.rect(V.x + 2, V.y + 2, 6, 6, "S");
    pdf.setLineDashPattern([], 0);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(lr, lg, lb);
    pdf.text(VERMERK_DRUCK.zeichen, V.x + 3.6, V.y + 6.8);
    pdf.text(druck(vz.titel), V.x + 11, V.y + 6.5);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(20);
    vz.zeilen.forEach((z, i) => {
      const zeile = pdf.splitTextToSize(druck(z), V.w - 14)[0] ?? "";
      pdf.text(zeile, V.x + 11, V.y + BLATT.vermerkKopfH + 1.5 + i * BLATT.vermerkZeileH);
    });
  }

  // liability line
  pdf.setDrawColor(200, 30, 30); pdf.setLineWidth(0.4); pdf.rect(L.hinweis.x, L.hinweis.y, L.hinweis.w, L.hinweis.h);
  pdf.setFontSize(8); pdf.setTextColor(160, 20, 20);
  pdf.text(pdf.splitTextToSize(HAFTUNGSZEILE, L.hinweis.w - 6), L.hinweis.x + 3, L.hinweis.y + 4);

  const name = dateiname || `Feuerwehrplan_${String(projekt || "BIT-Atelier").replace(/[^\w-]+/g, "_")}_${String(geschoss).replace(/[^\w-]+/g, "_")}.pdf`;
  pdf.save(name);
  return { seiten: pdf.getNumberOfPages(), dateiname: name, vermerk: !!vz };
}
