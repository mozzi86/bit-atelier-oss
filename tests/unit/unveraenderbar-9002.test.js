// Unit tests for plan 90-02 (packages/nova-pdf/src/lib/unveraenderbar.js): a PDF with a filled-in
// text field, a checkbox and a comment annotation is analysed, then flattened — afterwards no form
// field, no annotation and no AcroForm remain, the page count is unchanged and the field VALUE is
// still in the page content (burned in, not lost).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { Buffer } from "node:buffer";

import { pdfAnalyse, formularAbflachen } from "@pdf/lib/unveraenderbar";

async function formularPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const form = doc.getForm();
  const feld = form.createTextField("bieter.name");
  feld.setText("Musterbau GmbH");
  feld.addToPage(page, { x: 50, y: 700, width: 300, height: 24, font });
  const haken = form.createCheckBox("angebot.geprueft");
  haken.check();
  haken.addToPage(page, { x: 50, y: 650, width: 16, height: 16 });
  // A free comment annotation (subtype Text), as left by a reviewer.
  const komm = doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [400, 700, 420, 720], Contents: PDFName.of("Pruefen") });
  const ref = doc.context.register(komm);
  const annots = page.node.Annots();
  if (annots) annots.push(ref); else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
  return doc.save({ useObjectStreams: false });
}

describe("90-02 — PDF unveränderbar (abflachen)", () => {
  it("Analyse: 2 Seiten, 2 Formularfelder, 1 Kommentar (Widgets zählen als Felder, nicht doppelt)", async () => {
    const a = await pdfAnalyse(await formularPdf());
    assert.equal(a.seiten, 2);
    assert.equal(a.felder, 2);
    assert.equal(a.annotationen, 1);
    assert.deepEqual(a.arten, { Text: 1 });
  });

  it("Abflachen: keine Felder, keine Annotationen, kein AcroForm mehr; Seitenzahl gleich; Bericht stimmt", async () => {
    const { bytes, bericht } = await formularAbflachen(await formularPdf());
    assert.equal(bericht.felder, 2);
    assert.equal(bericht.seiten, 2);
    assert.ok(bericht.annotationenEntfernt >= 1, "Kommentar entfernt");
    const neu = await PDFDocument.load(bytes);
    assert.equal(neu.getPageCount(), 2);
    // AcroForm first: getForm() would create an empty one on access.
    assert.equal(neu.catalog.get(PDFName.of("AcroForm")), undefined, "kein AcroForm");
    assert.equal(neu.getForm().getFields().length, 0, "keine Formularfelder");
    const nachher = await pdfAnalyse(bytes);
    assert.equal(nachher.annotationen, 0);
    assert.equal(nachher.felder, 0);
  });

  it("der Feldwert bleibt sichtbar: er steht nach dem Abflachen im Seiteninhalt (Form-XObject)", async () => {
    const { bytes } = await formularAbflachen(await formularPdf());
    const neu = await PDFDocument.load(bytes);
    // Decode every stream of the file and look for the value as a PDF string.
    let gefunden = false;
    for (const [, obj] of neu.context.enumerateIndirectObjects()) {
      const roh = obj?.getContents?.() ?? obj?.contents;
      if (!roh) continue;
      let text = "";
      try {
        const { decodePDFRawStream } = await import("pdf-lib");
        text = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
      } catch { text = new TextDecoder("latin1").decode(roh); }
      // pdf-lib writes field text as a hex string (<4D75…>) in the appearance stream.
      const hex = Buffer.from("Musterbau GmbH", "latin1").toString("hex").toUpperCase();
      if (text.includes("Musterbau GmbH") || text.toUpperCase().includes(hex)) { gefunden = true; break; }
    }
    assert.ok(gefunden, "Wert „Musterbau GmbH“ im abgeflachten PDF");
  });

  it("PDF ohne Formular und Annotationen: unverändert lesbar, Bericht 0; Unsinn → Fehler im Klartext", async () => {
    const d = await PDFDocument.create(); d.addPage();
    const { bytes, bericht } = await formularAbflachen(await d.save());
    assert.deepEqual({ felder: bericht.felder, entfernt: bericht.annotationenEntfernt }, { felder: 0, entfernt: 0 });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    await assert.rejects(formularAbflachen(new Uint8Array([1, 2, 3])), /nicht gelesen/);
  });
});
