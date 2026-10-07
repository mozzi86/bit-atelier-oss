// Feuerwehrplan (DIN 14095) as a concept sheet — Phase 38, BSP-05.
//
// In:  the plan SVG of the Brandschutz-Plan-Editor (rasterised here), project/storey/date,
//      legend rows [{ farbe, label, anzahl?, art: "flaeche"|"linie"|"punkt"|"symbol" }], hints.
// Out: one A4 landscape PDF via jsPDF: frame, title block, plan field (aspect kept, centred),
//      legend column, liability line. The layout maths is pure (feuerwehrplanLayout) and
//      unit-tested; rasterising and jsPDF need a browser (svgZuPng, feuerwehrplanPdf).
// Pattern: BitBimStudio plan export (SVG → canvas → jsPDF) + title block; extended by legend
// and the honesty line — this is a CONCEPT plan, never a checked Feuerwehrplan.

/** A4 landscape in mm. */
export const A4_QUER = { w: 297, h: 210 };
/** Sheet margins and block heights in mm. [ASSUMED] DIN 14095 prescribes content, not this layout. */
export const BLATT = { rand: 10, titelH: 22, hinweisH: 10, legendeB: 72, luecke: 4 };

/**
 * Sheet layout in mm — frame, title block, plan field (image fitted, aspect kept, centred),
 * legend column (right), liability/hint line (bottom).
 * @param {{ pageW?: number, pageH?: number, imgW: number, imgH: number, legendeZeilen?: number }} p imgW/imgH in px
 * @returns {{ rahmen: object, titel: object, plan: object, planFeld: object, legende: object, hinweis: object, zeilenHoehe: number }} all in mm
 */
export function feuerwehrplanLayout({ pageW = A4_QUER.w, pageH = A4_QUER.h, imgW, imgH, legendeZeilen = 0 }) {
  const { rand, titelH, hinweisH, legendeB, luecke } = BLATT;
  const rahmen = { x: rand, y: rand, w: pageW - 2 * rand, h: pageH - 2 * rand };
  const titel = { x: rahmen.x, y: rahmen.y, w: rahmen.w, h: titelH };
  const hinweis = { x: rahmen.x, y: rahmen.y + rahmen.h - hinweisH, w: rahmen.w, h: hinweisH };
  const innenY = titel.y + titel.h + luecke;
  const innenH = hinweis.y - luecke - innenY;
  const legende = { x: rahmen.x + rahmen.w - legendeB, y: innenY, w: legendeB, h: innenH };
  const planFeld = { x: rahmen.x + luecke, y: innenY, w: legende.x - luecke - (rahmen.x + luecke), h: innenH };
  // fit the image into the plan field, keep aspect, centre
  const ar = imgW > 0 && imgH > 0 ? imgW / imgH : 4 / 3;
  let w = planFeld.w, h = w / ar;
  if (h > planFeld.h) { h = planFeld.h; w = h * ar; }
  const plan = { x: planFeld.x + (planFeld.w - w) / 2, y: planFeld.y + (planFeld.h - h) / 2, w, h };
  // legend rows: 6 mm each, shrink when many rows must fit
  const zeilenHoehe = legendeZeilen > 0 ? Math.min(6, Math.max(3.5, (legende.h - 14) / legendeZeilen)) : 6;
  return { rahmen, titel, plan, planFeld, legende, hinweis, zeilenHoehe };
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
 * @param {{ png: {dataUrl:string, w:number, h:number}, projekt: string, geschoss: string, datum: string,
 *   legende: Array<{farbe:string,label:string,anzahl?:number,art?:string}>, hinweise?: string[], dateiname?: string }} p
 * @returns {Promise<{ seiten: number, dateiname: string }>}
 */
export async function feuerwehrplanPdf({ png, projekt, geschoss, datum, legende = [], hinweise = [], dateiname }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const L = feuerwehrplanLayout({ imgW: png.w, imgH: png.h, legendeZeilen: legende.length + hinweise.length });

  // frame + title block
  pdf.setDrawColor(30); pdf.setLineWidth(0.5); pdf.rect(L.rahmen.x, L.rahmen.y, L.rahmen.w, L.rahmen.h);
  pdf.setLineWidth(0.3); pdf.rect(L.titel.x, L.titel.y, L.titel.w, L.titel.h);
  pdf.setFontSize(15); pdf.setTextColor(20); pdf.text(`Feuerwehrplan (Konzept) — ${geschoss}`, L.titel.x + 4, L.titel.y + 8);
  pdf.setFontSize(9); pdf.setTextColor(70);
  pdf.text(`${projekt} · Stand ${datum} · Geschossplan nach DIN 14095 — Konzeptstufe, nicht geprüft`, L.titel.x + 4, L.titel.y + 14);
  pdf.text("Maßstab: nicht maßstäblich — Maßstabsbalken und Nordpfeil im Plan · Quelle: BIT-Atelier Gebäudemodell", L.titel.x + 4, L.titel.y + 19);

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

  // liability line
  pdf.setDrawColor(200, 30, 30); pdf.setLineWidth(0.4); pdf.rect(L.hinweis.x, L.hinweis.y, L.hinweis.w, L.hinweis.h);
  pdf.setFontSize(8); pdf.setTextColor(160, 20, 20);
  pdf.text(pdf.splitTextToSize(HAFTUNGSZEILE, L.hinweis.w - 6), L.hinweis.x + 3, L.hinweis.y + 4);

  const name = dateiname || `Feuerwehrplan_${String(projekt || "BIT-Atelier").replace(/[^\w-]+/g, "_")}_${String(geschoss).replace(/[^\w-]+/g, "_")}.pdf`;
  pdf.save(name);
  return { seiten: pdf.getNumberOfPages(), dateiname: name };
}
