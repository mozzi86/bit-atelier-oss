// 90-02: "PDF unveränderbar" — make an editable PDF non-editable while keeping layout and content.
// Domain logic from the office skill "PDF unveränderbar" (form PDF with AcroForm fields, editable text,
// annotations → non-editable image PDF), rebuilt office-neutral. Two modes:
//   abflachen — form fields are burned into the page content (pdf-lib form.flatten) and the remaining
//               annotations (comments, stamps, highlights, links) are removed from the pages. Text stays
//               searchable; small file. Pure, pdf-lib only → node-testable (this file).
//   rastern   — every page becomes an image (pdfjs render incl. annotation appearances → JPEG), nothing
//               can be edited or extracted any more. Browser only: lives in pdfTools.compressPdf.
//
// In:  PDF bytes (Uint8Array). Out: pdfAnalyse → counts (pages, form fields, annotations by type);
//      formularAbflachen → { bytes, bericht } with what was flattened / removed.
import { PDFDocument, PDFName, PDFArray, PDFDict } from "pdf-lib";

/** Load with a plain-text error for encrypted or broken files (same wording as pdfTools). */
async function laden(bytes) {
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    if (/encrypt/i.test(String(e?.message))) throw new Error("PDF ist geschützt und kann nicht bearbeitet werden");
    throw new Error(`PDF konnte nicht gelesen werden: ${e?.message || e}`);
  }
}

/** Annotation dicts of a page (resolved), empty when the page has none. */
function annotationen(doc, page) {
  const roh = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!roh) return [];
  const out = [];
  for (let i = 0; i < roh.size(); i += 1) {
    const a = doc.context.lookup(roh.get(i));
    if (a instanceof PDFDict) out.push(a);
  }
  return out;
}

/** Subtype name of an annotation ("Widget", "Text", "Link", "Highlight" …). */
function art(a) {
  const st = a.get(PDFName.of("Subtype"));
  return st ? String(st).replace(/^\//, "") : "?";
}

/**
 * What makes this PDF editable: pages, form fields, annotations by subtype (widgets are the visible
 * parts of form fields and are counted under `felder`, not again under annotations).
 * @param {Uint8Array} bytes
 * @returns {Promise<{seiten: number, felder: number, annotationen: number, arten: Record<string, number>}>}
 */
export async function pdfAnalyse(bytes) {
  const doc = await laden(bytes);
  let felder = 0;
  try { felder = doc.getForm().getFields().length; } catch { felder = 0; }
  /** @type {Record<string, number>} */
  const arten = {};
  let n = 0;
  for (const page of doc.getPages()) {
    for (const a of annotationen(doc, page)) {
      const t = art(a);
      if (t === "Widget") continue;
      arten[t] = (arten[t] || 0) + 1;
      n += 1;
    }
  }
  return { seiten: doc.getPageCount(), felder, annotationen: n, arten };
}

/**
 * Mode "abflachen": burn form fields into the page content and remove every remaining annotation
 * (a comment or stamp could otherwise still be moved or deleted). Field values stay visible — pdf-lib
 * regenerates the appearance streams before flattening (updateFieldAppearances), so a filled-in
 * field without its own appearance is not lost.
 * @param {Uint8Array} bytes
 * @returns {Promise<{bytes: Uint8Array, bericht: {felder: number, annotationenEntfernt: number, arten: Record<string, number>, seiten: number}}>}
 */
export async function formularAbflachen(bytes) {
  const doc = await laden(bytes);
  let felder = 0;
  try {
    const form = doc.getForm();
    felder = form.getFields().length;
    if (felder > 0) form.flatten({ updateFieldAppearances: true });
  } catch (e) {
    throw new Error(`Formular konnte nicht abgeflacht werden: ${e?.message || e}`);
  }
  /** @type {Record<string, number>} */
  const arten = {};
  let entfernt = 0;
  for (const page of doc.getPages()) {
    const liste = annotationen(doc, page);
    if (!liste.length) continue;
    for (const a of liste) { const t = art(a); arten[t] = (arten[t] || 0) + 1; entfernt += 1; }
    page.node.delete(PDFName.of("Annots"));
  }
  // An empty AcroForm entry would still make viewers offer "fill in" — drop it.
  doc.catalog.delete(PDFName.of("AcroForm"));
  return { bytes: await doc.save(), bericht: { felder, annotationenEntfernt: entfernt, arten, seiten: doc.getPageCount() } };
}
