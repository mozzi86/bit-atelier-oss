// 105-19: every PDF the app writes carries a document language (/Lang) and a meaningful title (/Title).
// 1. Guard: enumerates every source file that imports jspdf or pdf-lib; each one that writes a PDF must call
//    the shared helper (@core/lib/pdfMetadaten.js) or stand in AUSNAHMEN with a reason — a new generator
//    cannot forget it.
// 2. Behaviour: real generators (node-runnable ones) are run and their output read back with pdf-lib.
// 3. Helper: language from the UI, title from a file name, "only fill in" mode for a user's own file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";

// fileURLToPath, not URL.pathname: on Windows the pathname is "/C:/…" with %20 for blanks and never resolves
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Files that import a PDF library but write no PDF of their own, with the reason (repo-relative path → reason). */
const AUSNAHMEN = Object.freeze({
  // reads the keywords of an uploaded plan, writes nothing
  "packages/nova-core/src/lib/zeigen/planStandLaden.js": "liest nur",
  // only a JSDoc type import (PDFRef); the incremental update is written by pdfAnmerkungen.js
  "packages/nova-pdf/src/lib/inkrementell.js": "nur Typ-Import",
  // appends ONE incremental update with annotations to the user's own file; the original bytes stay untouched
  // by design (proof of the received file), so neither its catalog (/Lang) nor its info (/Title) is rewritten
  "packages/nova-pdf/src/lib/pdfAnmerkungen.js": "inkrementelle Anmerkungen, Original bleibt unberührt",
});

/** @param {string} dir @returns {string[]} */
function quellen(dir) {
  /** @type {string[]} */
  const aus = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) aus.push(...quellen(p));
    else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) aus.push(p);
  }
  return aus;
}

const IMPORT = /(?:from\s+|import\s*\(\s*)["'](jspdf|pdf-lib)["']/;

function generatoren() {
  const dirs = [path.join(ROOT, "src"), ...fs.readdirSync(path.join(ROOT, "packages")).map((p) => path.join(ROOT, "packages", p, "src"))];
  return dirs.filter((d) => fs.existsSync(d)).flatMap(quellen)
    .map((p) => ({ rel: path.relative(ROOT, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") }))
    .filter((f) => IMPORT.test(f.text) || /import\(["']pdf-lib["']\)/.test(f.text));
}

/** @param {Uint8Array|ArrayBuffer} bytes */
async function meta(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const lang = doc.catalog.lookup(PDFName.of("Lang"));
  return { lang: lang ? /** @type {any} */ (lang).decodeText() : null, titel: doc.getTitle() ?? null };
}

describe("105-19 guard: every jsPDF/pdf-lib generator uses the shared metadata helper", () => {
  const alle = generatoren();

  it("finds the generators (sanity: at least the 20 known files)", () => {
    assert.ok(alle.length >= 20, `nur ${alle.length} Dateien gefunden`);
  });

  for (const f of alle) {
    it(f.rel, () => {
      if (Object.prototype.hasOwnProperty.call(AUSNAHMEN, f.rel)) return;
      assert.match(f.text, /\b(jsPdfMetadaten|pdfLibMetadaten)\(/, `${f.rel} schreibt ein PDF ohne jsPdfMetadaten/pdfLibMetadaten (oder fehlt in AUSNAHMEN)`);
    });
  }

  it("every exception still exists and still imports a PDF library (no stale entries)", () => {
    for (const rel of Object.keys(AUSNAHMEN)) {
      assert.ok(alle.some((f) => f.rel === rel), `${rel} veraltet`);
    }
  });
});

describe("105-19 behaviour: generated PDFs carry /Lang de-DE and a title", () => {
  const JETZT = new Date("2026-11-19T10:00:00Z");
  const pruefe = async (/** @type {Uint8Array} */ bytes, /** @type {RegExp} */ titel) => {
    const m = await meta(bytes);
    assert.equal(m.lang, "de-DE");
    assert.match(String(m.titel), titel);
  };

  it("letter core (draft, no fixiert)", async () => {
    const { briefLayout } = await import("@core/lib/brief/briefLayout.js");
    const { erzeugeBriefPdf } = await import("@core/lib/brief/briefPdf.js");
    const bytes = await erzeugeBriefPdf(briefLayout(/** @type {any} */ ({ absender: ["Büro"], empfaenger: ["Empfänger"], datum: "19.11.2026", betreff: "Testbetreff", absaetze: ["Text."] })));
    await pruefe(bytes, /^Testbetreff$/);
  });

  it("prior notice (SiGe)", async () => {
    const { vorankuendigungPdf } = await import("@/lib/werkplanung/sige.js");
    await pruefe((await vorankuendigungPdf({ s: {}, projektName: "Testhaus", jetzt: JETZT })).bytes, /Vorankündigung.*Testhaus/);
  });

  it("minutes", async () => {
    const { protokollPdf } = await import("@/lib/protokoll/protokollPdf.js");
    const r = await protokollPdf({ nummer: 3, titel: "Baubesprechung", datum: "2026-11-19", teilnehmer: [], punkte: [] }, { name: "Testhaus" }, { heute: JETZT });
    await pruefe(r.bytes, /Protokoll.*Baubesprechung/);
  });

  it("participants list, budget request, sampling protocol, Gantt", async () => {
    const { beteiligtePdf } = await import("@/lib/people/beteiligtePdf.js");
    await pruefe((await beteiligtePdf([], { name: "Testhaus" }, { jetzt: JETZT })).bytes, /Projektbeteiligte/);
    const { budgetAntragPdf } = await import("@ava/lib/budgetAntragPdf.js");
    const zeile = { kg: "330", bezeichnung: "Außenwände", budget: 1000, vergabe: 0, prognose: 1200, abweichung: 200 };
    await pruefe((await budgetAntragPdf({ projekt: { name: "Testhaus" }, zeile, budget_neu: 1300, begruendung: "Test", jetzt: JETZT })).bytes, /Budgeterhöhung.*330/);
    const { bemusterungsProtokollPdf } = await import("@/lib/werkplanung/bemusterung.js");
    await pruefe((await bemusterungsProtokollPdf({ projekt: { name: "Testhaus" }, muster: [], jetzt: JETZT })).bytes, /Bemusterungsprotokoll/);
    const { ganttPdf } = await import("@/lib/planung/ganttPdf.js");
    await pruefe((await ganttPdf([], { name: "Testhaus" }, { format: "A3", jetzt: JETZT })).bytes, /Terminplan/);
  });

  it("BIT-Check report", async () => {
    const { schreibeBitCheckPdf } = await import("@ifc/lib/bitCheckBericht.js");
    await pruefe(schreibeBitCheckPdf({ modell: "Testmodell.ifc", datum: "19.11.2026" }), /Prüfbericht.*Testmodell/);
  });

  it("pdf-lib: stamp and title block on a file without metadata get de-DE and a title", async () => {
    const leer = await PDFDocument.create();
    leer.addPage([595, 842]);
    const bytes = await leer.save();
    const { pruefvermerkAufPdf } = await import("@core/lib/pruefvermerk.js");
    await pruefe((await pruefvermerkAufPdf(bytes, { titel: "Geprüft", zeilen: [{ label: "Datum", wert: "19.11.2026" }] })).bytes, /Geprüft/);
    const { plankopfAufPdf } = await import("@pdf/lib/plankopf.js");
    await pruefe((await plankopfAufPdf(bytes, { zeilen: [{ label: "Planinhalt", wert: "Grundriss EG" }] })).bytes, /Grundriss EG/);
    const { formularAbflachen } = await import("@pdf/lib/unveraenderbar.js");
    const r = await formularAbflachen(bytes);
    assert.equal((await meta(r.bytes)).lang, "de-DE");
  });

  it("pdf-lib: a user's own file keeps its language and title", async () => {
    const eigen = await PDFDocument.create();
    eigen.addPage([595, 842]);
    eigen.setTitle("Eigener Titel");
    eigen.catalog.set(PDFName.of("Lang"), PDFString.of("en-US"));
    const bytes = await eigen.save();
    const { pruefvermerkAufPdf } = await import("@core/lib/pruefvermerk.js");
    const m = await meta((await pruefvermerkAufPdf(bytes, { titel: "Geprüft", zeilen: [] })).bytes);
    assert.deepEqual(m, { lang: "en-US", titel: "Eigener Titel" });
  });
});

describe("105-19 helper", () => {
  it("pdfSpracheAusUi: German without DOM, English from <html lang>", async () => {
    const { pdfSpracheAusUi } = await import("@core/lib/pdfMetadaten.js");
    assert.equal(pdfSpracheAusUi(), "de-DE");
    const vorher = /** @type {any} */ (globalThis).document;
    /** @type {any} */ (globalThis).document = { documentElement: { lang: "en" } };
    try {
      assert.equal(pdfSpracheAusUi(), "en-GB");
    } finally {
      /** @type {any} */ (globalThis).document = vorher;
    }
  });

  it("pdfTitelAusDateiname", async () => {
    const { pdfTitelAusDateiname } = await import("@core/lib/pdfMetadaten.js");
    assert.equal(pdfTitelAusDateiname("ordner/Plan_EG_Auszug.pdf"), "Plan EG Auszug");
    assert.equal(pdfTitelAusDateiname(""), "");
  });

  it("jsPdfMetadaten writes /Lang, /Title and DisplayDocTitle", async () => {
    const { jsPdfMetadaten } = await import("@core/lib/pdfMetadaten.js");
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    jsPdfMetadaten(pdf, { titel: "Testbericht", betreff: "Testhaus" });
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    assert.deepEqual(await meta(bytes), { lang: "de-DE", titel: "Testbericht" });
    assert.match(Buffer.from(bytes).toString("latin1"), /\/DisplayDocTitle true/);
  });
});
