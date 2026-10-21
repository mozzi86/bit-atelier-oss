// Unit tests for plan 104-09 (packages/nova-pdf/src/lib/inkrementell.js + pdfAnmerkungen.js):
// studio annotations are written as an incremental update — the output starts with exactly the input
// bytes, the appended cross-reference section points at the right objects (checked strictly AND by
// pdf.js, which follows the xref chain), and pdf-lib reads the result back. Both cross-reference kinds
// are covered: a classic table (useObjectStreams: false) and a cross-reference stream (pdf-lib default).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFHexString, PDFString, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";

/** pdf.js needs the standard font files to build FreeText appearances in Node. */
const SCHRIFTEN = fileURLToPath(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)).split("\\").join("/");

import { letzteStartxref, xrefAbschnitt, anhangPruefen, beginntMit } from "@pdf/lib/inkrementell";
import { anmerkungenAbgleichen, ansichtOhneStudio, normZuPdf, pinNummern, anmerkungFingerabdruck, NM_PRAEFIX } from "@pdf/lib/pdfAnmerkungen";

/** Small test PDF; `fremd` adds a foreign comment annotation like a reviewer's. */
async function testPdf({ objektStreams = false, fremd = false, seiten = 2, drehung = 0 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < seiten; i += 1) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Seite ${i + 1}`, { x: 60, y: 760, size: 24, font });
    if (drehung) p.setRotation(degrees(drehung));
  }
  if (fremd) {
    const page = doc.getPage(0);
    const ref = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [400, 700, 420, 720], Contents: PDFString.of("Fremd") }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
  }
  return doc.save({ useObjectStreams: objektStreams });
}

const ANN = [
  { id: "a1", type: "pin", page: 1, x: 0.2, y: 0.1, text: "Prüfen: Maß", color: "#2563eb", author: "Planer A", created_date: "2026-10-21T10:00:00Z" },
  { id: "a2", type: "ink", page: 1, x: 0.3, y: 0.3, points: [{ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.35 }, { x: 0.6, y: 0.5 }], color: "#e11d48", author: "Planer A", created_date: "2026-10-21T10:01:00Z" },
  { id: "a3", type: "text", page: 2, x: 0.1, y: 0.5, text: "Änderung €", color: "#16a34a", author: "Planer B", created_date: "2026-10-21T10:02:00Z" },
];

/** Studio annotations of a pdf-lib document: [{nm, subtype, ref, contents}] per page index. */
async function studioAnnots(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => {
    const arr = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!arr) return [];
    return arr.asArray().map((r) => {
      const d = doc.context.lookup(r);
      const nm = d instanceof PDFDict ? d.get(PDFName.of("NM")) : null;
      const c = d instanceof PDFDict ? d.get(PDFName.of("Contents")) : null;
      return {
        nm: nm instanceof PDFHexString || nm instanceof PDFString ? nm.decodeText() : "",
        subtype: d instanceof PDFDict ? String(d.get(PDFName.of("Subtype"))) : "",
        ref: r instanceof PDFRef ? r.objectNumber : -1,
        contents: c instanceof PDFHexString || c instanceof PDFString ? c.decodeText() : "",
      };
    });
  });
}

/** pdf.js (follows startxref → /Prev chain) — annotations per page + warnings it printed. */
async function mitPdfjs(bytes) {
  const warnungen = [];
  const alt = [console.log, console.warn];
  console.log = console.warn = (...a) => { warnungen.push(a.join(" ")); }; // pdf.js 6 warns via console.warn
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 1, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: SCHRIFTEN }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      out.push((await page.getAnnotations()).map((a) => ({ subtype: a.subtype, nm: a.annotationName || "", hasAp: !!a.hasAppearance })));
    }
    await doc.loadingTask.destroy();
    return { seiten: out, warnungen };
  } finally {
    [console.log, console.warn] = alt;
  }
}

describe("104-09 incremental writer", () => {
  it("classic xref table: original bytes untouched, section valid, readable by pdf-lib and pdf.js", async () => {
    const original = await testPdf();
    const vorher = original.slice();
    const prevAlt = letzteStartxref(original);
    assert.equal(xrefAbschnitt(original, prevAlt).art, "tabelle");

    const { bytes, objekte, bericht } = await anmerkungenAbgleichen(original, ANN);
    assert.ok(bytes, "something was written");
    assert.deepEqual(original, vorher, "input array not mutated");
    assert.ok(beginntMit(bytes, original), "first N bytes = original");
    assert.equal(bericht.neu, 3);
    assert.equal(bericht.originalBytes, original.length);
    assert.equal(bericht.angehaengt, bytes.length - original.length);

    const pr = anhangPruefen(bytes);
    assert.deepEqual(pr.fehler, []);
    assert.equal(pr.art, "tabelle");
    assert.equal(pr.prev, prevAlt, "/Prev points at the original xref");
    assert.ok(pr.eintraege >= 3 + 3 + 2, "annotations, appearances and both pages listed");
    assert.ok(letzteStartxref(bytes) > original.length);

    const seiten = await studioAnnots(bytes);
    assert.equal(seiten[0].length, 2);
    assert.equal(seiten[1].length, 1);
    assert.deepEqual(seiten[0].map((a) => a.subtype).sort(), ["/Ink", "/Text"]);
    assert.equal(seiten[1][0].subtype, "/FreeText");
    assert.equal(seiten[1][0].contents, "Änderung €");
    assert.ok(seiten[0].every((a) => a.nm.startsWith(NM_PRAEFIX)));
    assert.equal(objekte.a1.obj, seiten[0].find((a) => a.subtype === "/Text").ref);

    const js = await mitPdfjs(bytes);
    assert.deepEqual(js.seiten.map((s) => s.map((a) => a.subtype).sort()), [["Ink", "Text"], ["FreeText"]]);
    assert.ok(js.seiten.flat().every((a) => a.hasAp), "every annotation has an appearance stream");
    assert.deepEqual(js.warnungen.filter((w) => /xref|Indexing|Invalid|repair/i.test(w)), [], "pdf.js did not have to repair the file");
  });

  it("cross-reference stream: update uses a stream too, numbers start behind /Size", async () => {
    const original = await testPdf({ objektStreams: true });
    const { art, groesse } = xrefAbschnitt(original, letzteStartxref(original));
    assert.equal(art, "stream");
    const { bytes, objekte } = await anmerkungenAbgleichen(original, ANN);
    assert.ok(beginntMit(bytes, original));
    const pr = anhangPruefen(bytes);
    assert.deepEqual(pr.fehler, []);
    assert.equal(pr.art, "stream");
    for (const o of Object.values(objekte)) assert.ok(o.obj >= groesse, `object ${o.obj} must not reuse a number below /Size ${groesse}`);
    const js = await mitPdfjs(bytes);
    assert.equal(js.seiten.flat().length, 3);
    assert.deepEqual(js.warnungen.filter((w) => /xref|Indexing|Invalid|repair/i.test(w)), []);
  });

  it("second save on top: changes and removals appended again, earlier file stays the prefix", async () => {
    const original = await testPdf({ fremd: true });
    const erst = await anmerkungenAbgleichen(original, ANN);
    // Same target again → nothing to write (idempotent, e.g. after a crash between PDF and records).
    const nochmal = await anmerkungenAbgleichen(erst.bytes, ANN);
    assert.equal(nochmal.bytes, null);
    assert.equal(nochmal.bericht.unveraendert, 3);

    const geaendert = [{ ...ANN[0], text: "Prüfen: Maß 2,50 m" }, ANN[2]]; // pin text changed, ink deleted
    const zweit = await anmerkungenAbgleichen(erst.bytes, geaendert);
    assert.ok(beginntMit(zweit.bytes, erst.bytes), "first save is the prefix of the second");
    assert.ok(beginntMit(zweit.bytes, original), "and the original still the very beginning");
    assert.deepEqual(anhangPruefen(zweit.bytes).fehler, []);
    assert.equal(anhangPruefen(zweit.bytes).prev, letzteStartxref(erst.bytes));
    assert.equal(zweit.bericht.geaendert, 1);
    assert.equal(zweit.bericht.entfernt, 1);
    assert.equal(zweit.objekte.a1.obj, erst.objekte.a1.obj, "changed annotation keeps its object number");

    const seiten = await studioAnnots(zweit.bytes);
    assert.deepEqual(seiten[0].map((a) => a.subtype).sort(), ["/Text", "/Text"], "foreign comment + our pin, ink gone");
    assert.ok(seiten[0].some((a) => a.contents === "Fremd"), "foreign annotation untouched");
    assert.ok(seiten[0].some((a) => a.contents === "Prüfen: Maß 2,50 m"));
    const js = await mitPdfjs(zweit.bytes);
    assert.equal(js.seiten[0].length, 2);
    assert.deepEqual(js.warnungen.filter((w) => /xref|Indexing|Invalid|repair/i.test(w)), []);
  });

  it("display copy drops only the studio's own annotations", async () => {
    const original = await testPdf({ fremd: true });
    const { bytes } = await anmerkungenAbgleichen(original, ANN);
    const ansicht = await ansichtOhneStudio(bytes);
    const seiten = await studioAnnots(ansicht);
    assert.deepEqual(seiten.map((s) => s.length), [1, 0]);
    assert.equal(seiten[0][0].contents, "Fremd");
    assert.equal(await ansichtOhneStudio(original), original, "file without studio annotations is passed through");
  });

  it("file without trailing newline after %%EOF and an indirect /Annots array", async () => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([400, 400]);
    const fremd = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Square", Rect: [10, 10, 50, 50] }));
    p.node.set(PDFName.of("Annots"), doc.context.register(doc.context.obj([fremd])));
    let roh = await doc.save({ useObjectStreams: false });
    while (roh[roh.length - 1] === 0x0a || roh[roh.length - 1] === 0x0d) roh = roh.slice(0, -1);
    const { bytes } = await anmerkungenAbgleichen(roh, [ANN[0]]);
    assert.ok(beginntMit(bytes, roh));
    assert.deepEqual(anhangPruefen(bytes).fehler, []);
    const seiten = await studioAnnots(bytes);
    assert.equal(seiten[0].length, 2);
  });

  it("rejects an annotation on a page the PDF does not have", async () => {
    const original = await testPdf({ seiten: 1 });
    await assert.rejects(() => anmerkungenAbgleichen(original, [ANN[2]]), /Seite 2/);
  });

  it("anhangPruefen catches a wrong offset", async () => {
    const original = await testPdf();
    const { bytes } = await anmerkungenAbgleichen(original, [ANN[0]]);
    const text = new TextDecoder("latin1").decode(bytes);
    const x = text.lastIndexOf("\nxref\n") + 1; // not the "xref" inside "startxref"
    const zeile = /\n(\d{10}) 00000 n\r\n/.exec(text.slice(x));
    const kaputt = bytes.slice();
    const pos = x + zeile.index + 1;
    const falsch = String(Number(zeile[1]) + 3).padStart(10, "0");
    for (let i = 0; i < 10; i += 1) kaputt[pos + i] = falsch.charCodeAt(i);
    const pr = anhangPruefen(kaputt);
    assert.equal(pr.ok, false);
    assert.match(pr.fehler.join(" "), /zeigt nicht auf/);
    // Guard for the guard: pdf.js really complains about such a file, so the "no repair warning"
    // checks above are meaningful.
    const js = await mitPdfjs(kaputt);
    assert.ok(js.warnungen.some((w) => /Indexing all PDF objects/.test(w)), `pdf.js warnings: ${js.warnungen.join(" | ")}`);
  });
});

describe("104-09 coordinates and numbering", () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  it("normZuPdf maps the displayed top-left corner for every rotation", () => {
    assert.deepEqual(normZuPdf(0, 0, box, 0), [0, 800]);
    assert.deepEqual(normZuPdf(1, 1, box, 0), [600, 0]);
    assert.deepEqual(normZuPdf(0, 0, box, 90), [0, 0]);
    assert.deepEqual(normZuPdf(1, 0, box, 90), [0, 800]);
    assert.deepEqual(normZuPdf(0, 0, box, 180), [600, 0]);
    assert.deepEqual(normZuPdf(0, 0, box, 270), [600, 800]);
    assert.deepEqual(normZuPdf(0, 0, box, -90), [600, 800], "-90 = 270");
    assert.deepEqual(normZuPdf(0.5, 0.5, { x: 10, y: 20, width: 100, height: 200 }, 0), [60, 120], "box offset honoured");
  });

  it("rotated page: annotation lands inside the page box and pdf.js reads it", async () => {
    const original = await testPdf({ seiten: 1, drehung: 90 });
    const { bytes } = await anmerkungenAbgleichen(original, [ANN[0], { ...ANN[2], page: 1 }]);
    assert.deepEqual(anhangPruefen(bytes).fehler, []);
    const js = await mitPdfjs(bytes);
    assert.equal(js.seiten[0].length, 2);
  });

  it("pin numbers per page by creation time; fingerprint follows content and number", () => {
    const n = pinNummern([
      { id: "p2", type: "pin", page: 1, x: 0, y: 0, created_date: "2026-01-02" },
      { id: "p1", type: "pin", page: 1, x: 0, y: 0, created_date: "2026-01-01" },
      { id: "q1", type: "pin", page: 2, x: 0, y: 0, created_date: "2026-01-03" },
      { id: "i1", type: "ink", page: 1, x: 0, y: 0, created_date: "2026-01-00" },
    ]);
    assert.deepEqual([n.get("p1"), n.get("p2"), n.get("q1"), n.get("i1")], [1, 2, 1, undefined]);
    const a = ANN[0];
    assert.equal(anmerkungFingerabdruck(a, 1), anmerkungFingerabdruck({ ...a }, 1));
    assert.notEqual(anmerkungFingerabdruck(a, 1), anmerkungFingerabdruck(a, 2));
    assert.notEqual(anmerkungFingerabdruck(a, 1), anmerkungFingerabdruck({ ...a, text: "x" }, 1));
  });
});
