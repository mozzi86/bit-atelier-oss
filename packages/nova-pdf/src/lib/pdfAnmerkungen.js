// 104-09: PDF-studio annotations (pin, freehand, text) as real PDF annotations, written as an
// incremental update (inkrementell.js) — the original bytes stay untouched.
//
// The studio keeps its annotations as records (entity PdfAnnotation, normalised 0…1 coordinates of
// the rendered page, origin top left). "Im PDF speichern" brings the PDF in line with those records:
//   - every studio annotation in the PDF carries /NM "bit-atelier:<record id>#<fingerprint>";
//   - a record without a matching /NM → new annotation object + its page's /Annots extended;
//   - same id, other fingerprint (moved pin number, changed text) → the SAME object number rewritten;
//   - a /NM in the PDF whose record is gone → removed from the page's /Annots (the object stays
//     behind unreferenced; readers ignore it — freeing numbers would gain nothing here).
// The comparison makes saving idempotent: a save that crashed after writing the PDF but before the
// records were marked does not duplicate anything the next time.
// ansichtOhneStudio() uses the same path with an empty target list: an in-memory copy without the
// studio's own annotations, so the studio overlay can keep drawing them without doubling.
//
// Appearance streams (/AP) are generated here (circle + number, ink path, Helvetica text) so every
// viewer shows the same picture, including pdf.js which draws only appearance streams on a canvas.
//
// In:  PDF bytes, studio annotation records. Out: { bytes|null, objekte, bericht }.

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFString, PDFRef, StandardFonts } from "pdf-lib";
import { anhangSchreiben, anhangPruefen, beginntMit, nummernAbSize } from "./inkrementell.js";
import { NM_PRAEFIX, pinNummern, anmerkungFingerabdruck } from "./studioStand.js";

// Re-exported so callers that save also get the numbering/fingerprint rules from one module.
export { NM_PRAEFIX, pinNummern, anmerkungFingerabdruck };

/** Pin circle radius, PDF points [ASSUMED: matches the 11 px overlay pin at 100 % zoom closely enough]. */
export const PIN_RADIUS_PT = 9;
/** Freehand line width, PDF points [ASSUMED: overlay draws 2.5 px at 100 % zoom]. */
export const INK_BREITE_PT = 2;
/** Text size as share of the visible page width (same rule as the studio export: w × 0.016). */
export const TEXT_ANTEIL_BREITE = 0.016;

/** @typedef {import("./studioStand.js").StudioAnmerkung} StudioAnmerkung */

/**
 * Normalised studio coordinates (0…1 of the page as displayed, origin top left) → PDF user space.
 * pdf.js displays the visible box rotated clockwise by /Rotate; this is the inverse of that.
 * @param {number} u 0…1 from the left of the displayed page
 * @param {number} v 0…1 from the top of the displayed page
 * @param {{x: number, y: number, width: number, height: number}} box visible page box, PDF points
 * @param {number} rotation /Rotate in degrees (any multiple of 90, also negative)
 * @returns {[number, number]} [X, Y] in PDF points
 */
export function normZuPdf(u, v, box, rotation) {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const { x: x0, y: y0, width: w, height: h } = box;
  const x1 = x0 + w;
  const y1 = y0 + h;
  if (r === 90) return [x0 + v * w, y0 + u * h];
  if (r === 180) return [x1 - u * w, y0 + v * h];
  if (r === 270) return [x1 - v * w, y1 - u * h];
  return [x0 + u * w, y1 - v * h];
}

/** "#rrggbb" → [r, g, b] 0…1; unreadable → red of the studio palette. */
function farbe(/** @type {string|undefined} */ hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  const n = m ? parseInt(m[1], 16) : 0xe11d48;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => Math.round(c * 1000) / 1000);
}

const f2 = (/** @type {number} */ v) => (Math.round(v * 100) / 100).toString();

/** PDF date "D:YYYYMMDDHHmmSSZ" (UTC). */
function pdfDatum(/** @type {string|undefined} */ iso) {
  const d = iso ? new Date(iso) : new Date();
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const z = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `D:${t.getUTCFullYear()}${z(t.getUTCMonth() + 1)}${z(t.getUTCDate())}${z(t.getUTCHours())}${z(t.getUTCMinutes())}${z(t.getUTCSeconds())}Z`;
}

/** Visible page box like pdf.js: CropBox (falls back to MediaBox) clipped to the MediaBox. */
function sichtbox(/** @type {any} */ seite) {
  const c = seite.getCropBox();
  const m = seite.getMediaBox();
  const x = Math.max(c.x, m.x);
  const y = Math.max(c.y, m.y);
  const x1 = Math.min(c.x + c.width, m.x + m.width);
  const y1 = Math.min(c.y + c.height, m.y + m.height);
  return x1 > x && y1 > y ? { x, y, width: x1 - x, height: y1 - y } : m;
}

/**
 * Text that the standard font Helvetica (WinAnsi) can show; other characters become "?".
 * @param {any} schrift pdf-lib PDFFont (standard font)
 * @param {string} text
 * @returns {string}
 */
function darstellbar(schrift, text) {
  const satz = new Set(schrift.getCharacterSet());
  return Array.from(String(text || "")).map((z) => (satz.has(z.codePointAt(0)) ? z : "?")).join("");
}

/**
 * Builds the annotation dictionary + appearance stream of one studio annotation.
 * @param {any} ctx pdf-lib PDFContext
 * @param {StudioAnmerkung} a
 * @param {{seite: any, seitenRef: PDFRef, nr: number, fp: string, schrift: any, fett: any}} o
 * @returns {{dict: any, ap: any}}
 */
function annotationBauen(ctx, a, { seite, seitenRef, nr, fp, schrift, fett }) {
  const box = sichtbox(seite);
  const rot = seite.getRotation().angle || 0;
  const r = ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
  const [cr, cg, cb] = farbe(a.color);
  const zuPdf = (/** @type {number} */ u, /** @type {number} */ v) => normZuPdf(u, v, box, r);
  // Upright text on the displayed page: the page is shown rotated clockwise by r, so the text is
  // drawn rotated counter-clockwise by r in user space.
  const rad = (r * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const sichtBreite = r === 90 || r === 270 ? box.height : box.width;

  let subtype;
  let rect;
  let inhalt;
  /** @type {Record<string, any>} */
  const extra = {};
  /** @type {Record<string, any>} */
  let ressourcen = {};

  if (a.type === "ink") {
    const punkte = (a.points || []).map((p) => zuPdf(p.x, p.y));
    if (punkte.length < 2) throw new Error("Freihand-Anmerkung ohne Punkte.");
    const xs = punkte.map((p) => p[0]);
    const ys = punkte.map((p) => p[1]);
    const rand = INK_BREITE_PT;
    rect = [Math.min(...xs) - rand, Math.min(...ys) - rand, Math.max(...xs) + rand, Math.max(...ys) + rand];
    subtype = "Ink";
    extra.InkList = [punkte.flatMap(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])];
    extra.BS = { Type: "Border", W: INK_BREITE_PT, S: "S" };
    inhalt = `q ${cr} ${cg} ${cb} RG ${INK_BREITE_PT} w 1 J 1 j\n`
      + punkte.map(([x, y], i) => `${f2(x)} ${f2(y)} ${i === 0 ? "m" : "l"}`).join("\n") + "\nS Q";
  } else if (a.type === "text") {
    const groesse = Math.max(6, sichtBreite * TEXT_ANTEIL_BREITE);
    const text = darstellbar(schrift, a.text || "");
    const breite = schrift.widthOfTextAtSize(text, groesse);
    const [X, Y] = zuPdf(a.x, a.y);
    // Corners of the text box (baseline origin, descender 0.25 em) rotated like the text.
    const ecken = [[0, -0.25 * groesse], [breite, -0.25 * groesse], [breite, groesse], [0, groesse]]
      .map(([px, py]) => [X + px * cos - py * sin, Y + px * sin + py * cos]);
    rect = [Math.min(...ecken.map((e) => e[0])) - 1, Math.min(...ecken.map((e) => e[1])) - 1,
      Math.max(...ecken.map((e) => e[0])) + 1, Math.max(...ecken.map((e) => e[1])) + 1];
    subtype = "FreeText";
    extra.DA = PDFString.of(`/Helv ${f2(groesse)} Tf ${cr} ${cg} ${cb} rg`);
    extra.BS = { Type: "Border", W: 0 };
    ressourcen = { Font: { Helv: { Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" } } };
    inhalt = `q ${cos} ${sin} ${-sin} ${cos} ${f2(X)} ${f2(Y)} cm BT /Helv ${f2(groesse)} Tf ${cr} ${cg} ${cb} rg 0 0 Td ${schrift.encodeText(text).toString()} Tj ET Q`;
  } else {
    const [X, Y] = zuPdf(a.x, a.y);
    const R = PIN_RADIUS_PT;
    const k = 0.5523 * R; // Bezier circle constant 4/3·(√2−1)
    rect = [X - R - 1, Y - R - 1, X + R + 1, Y + R + 1];
    subtype = "Text";
    extra.Name = "Comment";
    extra.Open = false;
    const ziffern = String(nr || "");
    const fs = R * 1.1;
    const tw = fett.widthOfTextAtSize(ziffern, fs);
    ressourcen = { Font: { HeBo: { Type: "Font", Subtype: "Type1", BaseFont: "Helvetica-Bold", Encoding: "WinAnsiEncoding" } } };
    inhalt = `q ${cr} ${cg} ${cb} rg 1 1 1 RG 1.5 w\n`
      + `${f2(X + R)} ${f2(Y)} m ${f2(X + R)} ${f2(Y + k)} ${f2(X + k)} ${f2(Y + R)} ${f2(X)} ${f2(Y + R)} c\n`
      + `${f2(X - k)} ${f2(Y + R)} ${f2(X - R)} ${f2(Y + k)} ${f2(X - R)} ${f2(Y)} c\n`
      + `${f2(X - R)} ${f2(Y - k)} ${f2(X - k)} ${f2(Y - R)} ${f2(X)} ${f2(Y - R)} c\n`
      + `${f2(X + k)} ${f2(Y - R)} ${f2(X + R)} ${f2(Y - k)} ${f2(X + R)} ${f2(Y)} c h B\n`
      + (ziffern ? `q ${cos} ${sin} ${-sin} ${cos} ${f2(X)} ${f2(Y)} cm BT /HeBo ${f2(fs)} Tf 1 1 1 rg ${f2(-tw / 2)} ${f2(-0.36 * fs)} Td (${ziffern}) Tj ET Q\n` : "")
      + "Q";
  }
  rect = rect.map((v) => Math.round(v * 100) / 100);

  const ap = ctx.stream(inhalt, { Type: "XObject", Subtype: "Form", BBox: rect, Resources: ressourcen });
  const dict = ctx.obj({
    Type: "Annot",
    Subtype: subtype,
    Rect: rect,
    P: seitenRef,
    NM: PDFHexString.fromText(`${NM_PRAEFIX}${a.id}#${fp}`),
    M: PDFString.of(pdfDatum(undefined)),
    CreationDate: PDFString.of(pdfDatum(a.created_date)),
    C: [cr, cg, cb],
    F: 4, // Print
    ...extra,
  });
  if (a.text) dict.set(PDFName.of("Contents"), PDFHexString.fromText(String(a.text)));
  dict.set(PDFName.of("T"), PDFHexString.fromText(String(a.author || "")));
  return { dict, ap };
}

/** Text of a PDF string object (literal or hex), "" for anything else. */
function textVon(/** @type {any} */ o) {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : "";
}

/**
 * Studio annotations already in the PDF, found through their /NM.
 * @param {any} doc pdf-lib PDFDocument
 * @returns {Map<string, {ref: PDFRef, seite: number, fp: string, apRef: PDFRef|null}>} record id → place
 */
function studioImPdf(doc) {
  const out = new Map();
  doc.getPages().forEach((/** @type {any} */ seite, /** @type {number} */ i) => {
    const annots = seite.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k += 1) {
      const ref = annots.get(k);
      if (!(ref instanceof PDFRef)) continue;
      const d = doc.context.lookup(ref);
      if (!(d instanceof PDFDict)) continue;
      const nm = textVon(d.get(PDFName.of("NM")));
      if (!nm.startsWith(NM_PRAEFIX)) continue;
      const [id, fp = ""] = nm.slice(NM_PRAEFIX.length).split("#");
      const ap = d.lookupMaybe(PDFName.of("AP"), PDFDict);
      const n = ap ? ap.get(PDFName.of("N")) : null;
      out.set(id, { ref, seite: i, fp, apRef: n instanceof PDFRef ? n : null });
    }
  });
  return out;
}

/**
 * Report of one alignment run.
 * @typedef {object} AbgleichBericht
 * @property {number} neu annotations added
 * @property {number} geaendert annotations rewritten under their existing object number
 * @property {number} entfernt annotations taken out of their page's /Annots
 * @property {number} unveraendert studio annotations already in the PDF as they are
 * @property {number} angehaengt bytes appended (0 = nothing written)
 * @property {number} originalBytes length of the input, bytes (the untouched prefix of the output)
 */

/**
 * Brings the PDF in line with the studio records and appends the difference as ONE incremental
 * update. Nothing to do → bytes null (the caller only updates its records).
 * @param {Uint8Array} original current file (stays untouched; the result starts with exactly these bytes)
 * @param {StudioAnmerkung[]} soll studio annotations that shall be in the PDF (deleted ones left out)
 * @returns {Promise<{bytes: Uint8Array|null, objekte: Record<string, {obj: number, gen: number, fp: string}>, bericht: AbgleichBericht}>}
 *   objekte = where each record of `soll` now lives in the PDF (object number, generation, fingerprint)
 * @throws {Error} plain text for encrypted/damaged files or when the appended section fails anhangPruefen
 */
export async function anmerkungenAbgleichen(original, soll) {
  let doc;
  try {
    doc = await PDFDocument.load(original, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(/** @type {any} */ (e)?.message))) throw new Error("PDF ist geschützt — Anmerkungen können nicht hineingeschrieben werden.");
    throw new Error(`PDF konnte nicht gelesen werden: ${/** @type {any} */ (e)?.message || e}`);
  }
  if (doc.isEncrypted) throw new Error("PDF ist geschützt — Anmerkungen können nicht hineingeschrieben werden.");
  const ctx = doc.context;
  nummernAbSize(ctx, original);
  const seiten = doc.getPages();
  // Fonts only for measuring and WinAnsi encoding; they live in a throw-away document so no object
  // number of the real file is used up.
  const mess = await PDFDocument.create();
  const schrift = await mess.embedFont(StandardFonts.Helvetica);
  const fett = await mess.embedFont(StandardFonts.HelveticaBold);

  const vorhanden = studioImPdf(doc);
  const nummern = pinNummern(soll);
  /** @type {Set<string>} */
  const sollIds = new Set(soll.map((a) => a.id));
  /** @type {Map<string, any>} */
  const geschrieben = new Map(); // "num gen" → object, for the update
  const merke = (/** @type {PDFRef} */ ref, /** @type {any} */ obj) => geschrieben.set(`${ref.objectNumber} ${ref.generationNumber}`, { ref, objekt: obj });
  /** @type {Map<number, {neu: PDFRef[], weg: Set<string>}>} */
  const seitenAenderung = new Map();
  const aenderungFuer = (/** @type {number} */ i) => {
    if (!seitenAenderung.has(i)) seitenAenderung.set(i, { neu: [], weg: new Set() });
    return /** @type {{neu: PDFRef[], weg: Set<string>}} */ (seitenAenderung.get(i));
  };
  /** @type {Record<string, {obj: number, gen: number, fp: string}>} */
  const objekte = {};
  const bericht = { neu: 0, geaendert: 0, entfernt: 0, unveraendert: 0, angehaengt: 0, originalBytes: original.length };

  for (const a of soll) {
    const idx = Math.round(a.page) - 1;
    const seite = seiten[idx];
    if (!seite) throw new Error(`Anmerkung auf Seite ${a.page}, das PDF hat nur ${seiten.length} Seiten.`);
    if (String(a.id).includes("#")) throw new Error(`Ungültige Anmerkungs-ID „${a.id}“.`);
    const nr = nummern.get(a.id) || 0;
    const fp = anmerkungFingerabdruck(a, nr);
    const da = vorhanden.get(a.id);
    if (da && da.seite === idx && da.fp === fp) {
      objekte[a.id] = { obj: da.ref.objectNumber, gen: da.ref.generationNumber, fp };
      bericht.unveraendert += 1;
      continue;
    }
    const { dict, ap } = annotationBauen(ctx, a, { seite, seitenRef: seite.ref, nr, fp, schrift, fett });
    if (da && da.seite === idx) {
      // Changed: same annotation object number, appearance under its old number when it had one.
      const apRef = da.apRef || ctx.nextRef();
      dict.set(PDFName.of("AP"), ctx.obj({ N: apRef }));
      merke(apRef, ap);
      merke(da.ref, dict);
      objekte[a.id] = { obj: da.ref.objectNumber, gen: da.ref.generationNumber, fp };
      bericht.geaendert += 1;
    } else {
      if (da) { aenderungFuer(da.seite).weg.add(da.ref.toString()); bericht.entfernt += 1; }
      const apRef = ctx.nextRef();
      const ref = ctx.nextRef();
      dict.set(PDFName.of("AP"), ctx.obj({ N: apRef }));
      merke(apRef, ap);
      merke(ref, dict);
      aenderungFuer(idx).neu.push(ref);
      objekte[a.id] = { obj: ref.objectNumber, gen: ref.generationNumber, fp };
      bericht.neu += 1;
    }
  }
  for (const [id, da] of vorhanden) {
    if (!sollIds.has(id)) { aenderungFuer(da.seite).weg.add(da.ref.toString()); bericht.entfernt += 1; }
  }

  // Page /Annots: a direct array lives in the page dictionary (→ page rewritten), an indirect one is
  // its own object (→ only that array rewritten).
  for (const [i, { neu, weg }] of seitenAenderung) {
    const seite = seiten[i];
    const roh = seite.node.get(PDFName.of("Annots"));
    const alt = roh instanceof PDFRef ? ctx.lookup(roh) : roh;
    const eintraege = alt instanceof PDFArray ? alt.asArray().filter((e) => !(e instanceof PDFRef && weg.has(e.toString()))) : [];
    const liste = ctx.obj([...eintraege, ...neu]);
    if (roh instanceof PDFRef) merke(roh, liste);
    else { seite.node.set(PDFName.of("Annots"), liste); merke(seite.ref, seite.node); }
  }

  const erg = anhangSchreiben(original, ctx, [...geschrieben.values()]);
  if (!erg) return { bytes: null, objekte, bericht };
  if (!beginntMit(erg.bytes, original)) throw new Error("Interner Fehler: Originalbytes wurden verändert — nicht gespeichert.");
  const pruefung = anhangPruefen(erg.bytes);
  if (!pruefung.ok) throw new Error(`Angehängter Abschnitt fehlerhaft — nicht gespeichert: ${pruefung.fehler.join("; ")}`);
  bericht.angehaengt = erg.angehaengt;
  return { bytes: erg.bytes, objekte, bericht };
}

/**
 * Display copy without the studio's own annotations: the studio overlay draws those itself (numbers,
 * selection, deletion before the next save), pdf.js shows everything else of the file. Only for the
 * screen — never stored. Unchanged input when the file has none of them.
 * @param {Uint8Array} bytes saved PDF
 * @returns {Promise<Uint8Array>}
 */
export async function ansichtOhneStudio(bytes) {
  const { bytes: ohne } = await anmerkungenAbgleichen(bytes, []);
  return ohne || bytes;
}
