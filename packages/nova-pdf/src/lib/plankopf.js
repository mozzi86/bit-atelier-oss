// 90-01: title block (Plankopf) for plan PDFs — the field register, the plan-number scheme,
// the block geometry and the drawing onto an existing PDF with pdf-lib. Two modes:
//   normal  — project + office (Planverfasser from the office profile) + plan data;
//   neutral — "Anlagen-Plankopf" for tender attachments: the old title block is covered with
//             a white area, and NO office field is drawn (no office name, address, contact,
//             signature). Office data never comes from this file — only from the caller
//             (office profile `briefkopf`), so the public build carries no office names.
//
// In:  PDF bytes (Uint8Array), project { name, client, location }, office profile
//      { office, tagline, address, contact } (normal mode only), user inputs per field.
// Out: plankopfAufPdf → { bytes, bericht } — new PDF bytes plus a report (pages, block rect in
//      mm, cover rect in mm) for the dialog and the tests. Pure apart from pdf-lib; node-testable.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/** 1 mm in PDF points (1 pt = 1/72 inch). */
export const PT_JE_MM = 72 / 25.4;

/** Defaults in mm [ASSUMED — common office title blocks are 170–190 mm wide; margin = DIN 824 fold edge 10 mm]. */
export const PLANKOPF_MASSE = Object.freeze({ breite_mm: 180, rand_mm: 10, zeile_mm: 7, kopf_mm: 9, abdeckH_mm: 70 });

/**
 * Field register in drawing order. `buero: true` = office field, dropped in neutral mode;
 * `nurNeutral: true` = only drawn in neutral mode. Labels are German (they are printed on the
 * plan; the dialog translates them through t()).
 * @type {ReadonlyArray<{key: string, label: string, buero?: boolean, nurNeutral?: boolean, pflicht?: boolean}>}
 */
export const PLANKOPF_FELDER = Object.freeze([
  { key: "projekt", label: "Projekt", pflicht: true },
  { key: "bauort", label: "Bauort" },
  { key: "bauherr", label: "Bauherr" },
  { key: "planverfasser", label: "Planverfasser", buero: true },
  { key: "anlageZu", label: "Anlage zu", nurNeutral: true },
  { key: "planinhalt", label: "Planinhalt", pflicht: true },
  { key: "lph", label: "Leistungsphase" },
  { key: "massstab", label: "Maßstab" },
  { key: "format", label: "Format" },
  { key: "plannummer", label: "Plannummer", pflicht: true },
  { key: "index", label: "Index" },
  { key: "datum", label: "Datum" },
  { key: "gezeichnet", label: "Gezeichnet", buero: true },
  { key: "geprueft", label: "Geprüft", buero: true },
]);

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * Plan number after the neutral scheme `<Projekt>-<LPH>-<Gewerk>-<Nr>-<Index>` [ASSUMED, D-SK-01]:
 * upper case, spaces → nothing, number padded to 3 digits, empty parts skipped.
 * @param {{projektKurz?: string, lph?: string|number, gewerk?: string, nr?: string|number, index?: string}} p
 * @returns {string} e.g. "PRJ-LP5-AR-012-B"
 */
export function plannummer({ projektKurz, lph, gewerk, nr, index } = {}) {
  const teil = (v) => str(v).toUpperCase().replace(/\s+/g, "");
  const n = str(nr);
  const lphTeil = str(lph) ? (/^\d+$/.test(str(lph)) ? `LP${str(lph)}` : teil(lph)) : "";
  return [teil(projektKurz), lphTeil, teil(gewerk), /^\d+$/.test(n) ? n.padStart(3, "0") : teil(n), teil(index)].filter(Boolean).join("-");
}

/**
 * Rows of the title block: defaults from project + office profile, overridden by the user's
 * inputs; neutral mode drops every office field and adds "Anlage zu". Empty rows are kept
 * (a title block shows its empty fields), except `anlageZu` outside neutral mode.
 * @param {{projekt?: any, buero?: any, eingaben?: Record<string, string>, neutral?: boolean}} p
 * @returns {Array<{key: string, label: string, wert: string}>}
 */
export function plankopfZeilen({ projekt = null, buero = null, eingaben = {}, neutral = false } = {}) {
  const pr = projekt && typeof projekt === "object" ? projekt : {};
  const bk = buero && typeof buero === "object" ? buero : {};
  const ort = [str(pr.location?.address), str(pr.location?.city)].filter(Boolean).join(", ");
  /** @type {Record<string, string>} */
  const vorgabe = {
    projekt: str(pr.name), bauort: ort, bauherr: str(pr.client),
    planverfasser: [str(bk.office), str(bk.address)].filter(Boolean).join(" · "),
    datum: new Date().toLocaleDateString("de-DE"),
  };
  const e = eingaben && typeof eingaben === "object" ? eingaben : {};
  return PLANKOPF_FELDER
    .filter((f) => (neutral ? !f.buero : !f.nurNeutral))
    .map((f) => ({ key: f.key, label: f.label, wert: e[f.key] !== undefined && e[f.key] !== null ? str(e[f.key]) : (vorgabe[f.key] ?? "") }));
}

/**
 * Block rectangle on a page, in PDF points, anchored bottom-right inside the margin. The width
 * shrinks to fit narrow pages; the height follows the row count (two columns of rows below a
 * header line).
 * @param {{width: number, height: number}} seite page size, pt
 * @param {{breite_mm?: number, rand_mm?: number, zeilen?: number}} [o] zeilen = number of rows
 * @returns {{x: number, y: number, w: number, h: number, zeileH: number, kopfH: number}} pt
 */
export function plankopfRechteck(seite, { breite_mm = PLANKOPF_MASSE.breite_mm, rand_mm = PLANKOPF_MASSE.rand_mm, zeilen = PLANKOPF_FELDER.length } = {}) {
  const rand = rand_mm * PT_JE_MM;
  const w = Math.min(breite_mm * PT_JE_MM, Math.max(0, seite.width - 2 * rand));
  const zeileH = PLANKOPF_MASSE.zeile_mm * PT_JE_MM;
  const kopfH = PLANKOPF_MASSE.kopf_mm * PT_JE_MM;
  const h = Math.min(kopfH + Math.ceil(zeilen / 2) * zeileH, Math.max(0, seite.height - 2 * rand));
  return { x: seite.width - rand - w, y: rand, w, h, zeileH, kopfH };
}

/** Replace characters the standard Helvetica (WinAnsi) cannot encode instead of throwing. */
function sicher(font, text) {
  let out = "";
  for (const ch of String(text)) {
    try { font.encodeText(ch); out += ch; } catch { out += ch === "≥" ? ">=" : ch === "≤" ? "<=" : "?"; }
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
 * Draw the title block onto the pages of a PDF.
 * @param {Uint8Array} bytes source PDF
 * @param {{zeilen: Array<{label: string, wert: string}>, titel?: string, seiten?: number[]|null, neutral?: boolean,
 *   abdecken?: {w_mm: number, h_mm: number}|null, breite_mm?: number, rand_mm?: number}} o
 *   seiten = 0-based page indices (null = all); abdecken = white cover over the OLD block, measured from the
 *   bottom-right page corner (default in neutral mode: block width + margin × PLANKOPF_MASSE.abdeckH_mm)
 * @returns {Promise<{bytes: Uint8Array, bericht: {seiten: number[], rechteck_mm: {x: number, y: number, w: number, h: number}, abdeckung_mm: {w: number, h: number}|null}}>}
 */
export async function plankopfAufPdf(bytes, o) {
  if (!o || !Array.isArray(o.zeilen) || !o.zeilen.length) throw new Error("Plankopf: keine Felder übergeben.");
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) {
    throw new Error(/encrypt/i.test(String(e?.message)) ? "PDF ist geschützt und kann nicht bearbeitet werden" : `PDF konnte nicht gelesen werden: ${e?.message || e}`);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const idx = Array.isArray(o.seiten) && o.seiten.length ? o.seiten.filter((i) => i >= 0 && i < pages.length) : pages.map((_, i) => i);
  if (!idx.length) throw new Error("Plankopf: keine gültige Seite gewählt.");
  const breite_mm = o.breite_mm ?? PLANKOPF_MASSE.breite_mm, rand_mm = o.rand_mm ?? PLANKOPF_MASSE.rand_mm;
  const abdeckung = o.abdecken !== undefined ? o.abdecken : o.neutral ? { w_mm: breite_mm + rand_mm, h_mm: PLANKOPF_MASSE.abdeckH_mm } : null;
  const schwarz = rgb(0, 0, 0), grau = rgb(0.4, 0.4, 0.4), weiss = rgb(1, 1, 1);
  let rechteck = null;
  for (const i of idx) {
    const page = pages[i];
    const seite = page.getSize();
    if (abdeckung) {
      const aw = Math.min(abdeckung.w_mm * PT_JE_MM, seite.width), ah = Math.min(abdeckung.h_mm * PT_JE_MM, seite.height);
      page.drawRectangle({ x: seite.width - aw, y: 0, width: aw, height: ah, color: weiss });
    }
    const r = plankopfRechteck(seite, { breite_mm, rand_mm, zeilen: o.zeilen.length });
    rechteck = r;
    page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: weiss, borderColor: schwarz, borderWidth: 0.8 });
    // Header line: the plan title (planinhalt) or the given title, bold.
    const titel = sicher(fett, o.titel ?? o.zeilen.find((z) => z.label === "Planinhalt")?.wert ?? "");
    const kopfY = r.y + r.h - r.kopfH;
    page.drawLine({ start: { x: r.x, y: kopfY }, end: { x: r.x + r.w, y: kopfY }, thickness: 0.8, color: schwarz });
    page.drawText(passend(fett, titel, 10, r.w - 8), { x: r.x + 4, y: kopfY + r.kopfH / 2 - 3.5, size: 10, font: fett, color: schwarz });
    // Rows in two columns below the header.
    const spaltenW = r.w / 2;
    const proSpalte = Math.ceil(o.zeilen.length / 2);
    page.drawLine({ start: { x: r.x + spaltenW, y: r.y }, end: { x: r.x + spaltenW, y: kopfY }, thickness: 0.4, color: grau });
    o.zeilen.forEach((z, k) => {
      const spalte = k < proSpalte ? 0 : 1, reihe = k % proSpalte;
      const x0 = r.x + spalte * spaltenW, yOben = kopfY - reihe * r.zeileH;
      if (yOben - r.zeileH < r.y - 0.5) return; // page too small: drop rows beyond the block
      page.drawLine({ start: { x: x0, y: yOben - r.zeileH }, end: { x: x0 + spaltenW, y: yOben - r.zeileH }, thickness: 0.3, color: grau });
      page.drawText(sicher(font, z.label), { x: x0 + 3, y: yOben - 7, size: 5.5, font, color: grau });
      page.drawText(passend(font, sicher(font, z.wert), 7.5, spaltenW - 6), { x: x0 + 3, y: yOben - r.zeileH + 3, size: 7.5, font, color: schwarz });
    });
  }
  const out = await doc.save();
  const mm = (v) => Math.round((v / PT_JE_MM) * 10) / 10;
  return {
    bytes: out,
    bericht: {
      seiten: idx,
      rechteck_mm: rechteck ? { x: mm(rechteck.x), y: mm(rechteck.y), w: mm(rechteck.w), h: mm(rechteck.h) } : { x: 0, y: 0, w: 0, h: 0 },
      abdeckung_mm: abdeckung ? { w: abdeckung.w_mm, h: abdeckung.h_mm } : null,
    },
  };
}
