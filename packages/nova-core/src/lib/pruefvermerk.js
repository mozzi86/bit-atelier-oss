// 90-04: Prüfvermerk stamp on an existing PDF (the bidder's offer) — a framed block in the upper right
// corner of a page, like the rubber stamp "rechnerisch geprüft" an office puts on a checked offer.
// Same drawing approach as the 90-01 title block (`@pdf/lib/plankopf.js`: pdf-lib, Helvetica, WinAnsi-safe
// text), but here in @core because the AVA module may only import @core and itself (package boundary,
// CLAUDE.md "Paket-Landkarte"); the PDF studio can use it from here as well.
//
// In:  PDF bytes (Uint8Array), the stamp title and its rows (label/value, already formatted by the caller —
//      this file knows nothing about offers), the page choice.
// Out: pruefvermerkAufPdf → { bytes, bericht } — new PDF bytes plus a report (stamped pages, stamp rect in
//      mm). The original content is not covered or changed except by the stamp box itself (white fill so
//      the text stays readable on a printed page). Pure apart from pdf-lib; node-testable.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/** 1 mm in PDF points. */
const PT_JE_MM = 72 / 25.4;

/** Stamp geometry in mm [ASSUMED — a common office stamp is about 70 × 30 mm; margin 10 mm like the title block]. */
export const STEMPEL_MASSE = Object.freeze({ breite_mm: 72, rand_mm: 10, kopf_mm: 7, zeile_mm: 4.6 });

/** Replace characters the standard Helvetica (WinAnsi) cannot encode instead of throwing. */
function sicher(font, text) {
  let out = "";
  for (const ch of String(text)) {
    try { font.encodeText(ch); out += ch; } catch { out += ch === "≥" ? ">=" : ch === "≤" ? "<=" : ch === "≠" ? "!=" : "?"; }
  }
  return out;
}

/** Shorten `text` with "…" until it fits `maxW` points at `size`. */
function passend(font, text, size, maxW) {
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + "…";
  return t;
}

/**
 * Stamp rectangle on a page, in PDF points, anchored top-right inside the margin.
 * @param {{width: number, height: number}} seite page size, pt
 * @param {number} zeilen number of rows below the title
 * @returns {{x: number, y: number, w: number, h: number, kopfH: number, zeileH: number}} pt
 */
export function stempelRechteck(seite, zeilen) {
  const rand = STEMPEL_MASSE.rand_mm * PT_JE_MM;
  const w = Math.min(STEMPEL_MASSE.breite_mm * PT_JE_MM, Math.max(0, seite.width - 2 * rand));
  const kopfH = STEMPEL_MASSE.kopf_mm * PT_JE_MM, zeileH = STEMPEL_MASSE.zeile_mm * PT_JE_MM;
  const h = Math.min(kopfH + zeilen * zeileH + 2, Math.max(0, seite.height - 2 * rand));
  return { x: seite.width - rand - w, y: seite.height - rand - h, w, h, kopfH, zeileH };
}

/**
 * Draw the Prüfvermerk onto the pages of a PDF.
 * @param {Uint8Array} bytes source PDF
 * @param {{titel: string, zeilen: Array<{label: string, wert: string}>, seiten?: "erste"|"letzte"|"alle", warnung?: boolean}} o
 *   warnung = draw the frame in red instead of blue (check with findings)
 * @returns {Promise<{bytes: Uint8Array, bericht: {seiten: number[], rechteck_mm: {x: number, y: number, w: number, h: number}}}>}
 */
export async function pruefvermerkAufPdf(bytes, o) {
  if (!o || !o.titel || !Array.isArray(o.zeilen)) throw new Error("Prüfvermerk: Titel und Zeilen fehlen.");
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) {
    throw new Error(/encrypt/i.test(String(e?.message)) ? "PDF ist geschützt und kann nicht gestempelt werden" : `PDF konnte nicht gelesen werden: ${e?.message || e}`);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  if (!pages.length) throw new Error("Prüfvermerk: das PDF hat keine Seite.");
  const wahl = o.seiten || "erste";
  const idx = wahl === "alle" ? pages.map((_, i) => i) : wahl === "letzte" ? [pages.length - 1] : [0];
  // Stamp ink: blue for "checked", red when the check found something [ASSUMED office convention].
  const farbe = o.warnung ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.2, 0.6);
  let r = null;
  for (const i of idx) {
    const page = pages[i];
    r = stempelRechteck(page.getSize(), o.zeilen.length);
    page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(1, 1, 1), opacity: 0.92, borderColor: farbe, borderWidth: 1.4 });
    const kopfY = r.y + r.h - r.kopfH;
    page.drawLine({ start: { x: r.x, y: kopfY }, end: { x: r.x + r.w, y: kopfY }, thickness: 0.8, color: farbe });
    page.drawText(passend(fett, sicher(fett, o.titel.toUpperCase()), 9, r.w - 8), { x: r.x + 4, y: kopfY + r.kopfH / 2 - 3, size: 9, font: fett, color: farbe });
    const labelW = r.w * 0.38;
    o.zeilen.forEach((z, k) => {
      const y = kopfY - (k + 1) * r.zeileH + 3;
      if (y < r.y) return; // page too small: drop rows beyond the stamp
      page.drawText(passend(font, sicher(font, z.label), 6.5, labelW - 6), { x: r.x + 4, y, size: 6.5, font, color: farbe });
      page.drawText(passend(fett, sicher(fett, z.wert), 7, r.w - labelW - 6), { x: r.x + labelW, y, size: 7, font: fett, color: farbe });
    });
  }
  const out = await doc.save();
  const mm = (v) => Math.round((v / PT_JE_MM) * 10) / 10;
  const rr = /** @type {NonNullable<typeof r>} */ (r);
  return { bytes: out, bericht: { seiten: idx, rechteck_mm: { x: mm(rr.x), y: mm(rr.y), w: mm(rr.w), h: mm(rr.h) } } };
}
