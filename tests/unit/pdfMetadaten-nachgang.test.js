// 105-19 follow-up (review of wave 1, 19.11.2026):
// F1 — fixed (sent) letters, fee offers, order confirmations and fee amendments got no /Lang. A letter that was already
//      fixed must still give the bytes of its stored SHA-256, so the language comes with a version: correspondence
//      letters fixed with LAYOUT_VERSION >= 2 and fee letters of template version >= 3 carry /Lang de-DE and
//      DisplayDocTitle; letters fixed before keep their old metadata (no /Lang), byte for byte (SHA-256 of the
//      unchanged code b46862d3, recorded below).
// F2 — "only fill in" mode (a user's own file) never writes the app name as the title: a file without a title and
//      without a given title stays without one; an explicitly cleared title in the metadata tool stays cleared.
// F3 — jsPDF silently drops a language code it does not know ("de-de", "de-Latn-DE"): the helper normalises it.
// F4 — the pdfTools functions are run and read back with pdf-lib (not only grepped by the guard).
// F5 — exportElementToPdf rasterises translated UI: its /Lang is the UI language, not always de-DE.
//
// In:  @core/lib/pdfMetadaten.js, @core/lib/pdf.js, @core/lib/brief, src/lib/schriftverkehr/aktionen.js, src/lib/honorar,
//      packages/nova-pdf (lib/unveraenderbar.js, components/pdfTools.js). Out: assertions only.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PDFDocument, PDFName, degrees } from "pdf-lib";

const FIX = { erstelltAm: "2026-11-19T09:00:00Z", dateiId: "00112233445566778899aabbccddeeff" };
const sha = (/** @type {Uint8Array} */ b) => crypto.createHash("sha256").update(b).digest("hex");

/**
 * SHA-256 of fixed letters as the UNCHANGED code (commit b46862d3) built them — what a stored proof holds.
 * Recorded with the inputs of the tests below (scratch script, 19.11.2026).
 */
const GOLDEN = Object.freeze({
  briefV1: "dbde5e8655964727c1a691846866e6d64cf5a0b053f3a4042bf5cc16219a7809",
  angebotV2: "6d4b4efefa3b3bf828235439e5da8a6ab44383fffbd76a185b8b821a88ded6ad",
  nachtragV2: "1dd7990b9f48ec99236c23f596e01a7a517a9717d0af1cc3ffdfd47f87d049b5",
});

/** @param {Uint8Array} bytes */
async function meta(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const lang = doc.catalog.lookup(PDFName.of("Lang"));
  return {
    lang: lang ? /** @type {any} */ (lang).decodeText() : null,
    titel: doc.getTitle() ?? null,
    // pdf-lib's own reader: the flag may sit in a compressed object stream, a byte search would miss it.
    anzeigeTitel: doc.catalog.getViewerPreferences()?.getDisplayDocTitle() === true,
  };
}

/**
 * A one-page PDF, optionally with title and /Lang.
 * @param {{titel?: string, sprache?: string, seiten?: number}} [o]
 * @returns {Promise<Uint8Array>}
 */
async function quellPdf({ titel, sprache, seiten = 1 } = {}) {
  const d = await PDFDocument.create();
  for (let i = 0; i < seiten; i++) d.addPage([595, 842]);
  if (titel !== undefined) d.setTitle(titel);
  if (sprache) d.setLanguage(sprache);
  return d.save();
}

describe("F1: fixed letters of the new version carry /Lang; letters fixed before keep their bytes", () => {
  const BRIEF = {
    id: "sc-test", vorlage_key: "frei", vorlage_version: 1, status: "entwurf", datum: "2026-11-19", betreff: "Testbetreff",
    empfaenger: { firma: "Empfänger", strasse: "Musterweg 1", plz: "00000", ort: "Musterstadt" }, text: "Sehr geehrte Damen und Herren,\n\nText.",
  };

  it("correspondence: a draft fixed now gets /Lang de-DE and DisplayDocTitle", async () => {
    const { schreibenPdf } = await import("@/lib/schriftverkehr/aktionen.js");
    const { LAYOUT_VERSION, layoutVersionVon } = await import("@core/lib/brief/schreiben.js");
    assert.equal(LAYOUT_VERSION, 2);
    assert.equal(layoutVersionVon(BRIEF), 2, "a draft is stamped with the current version");
    const m = await meta((await schreibenPdf(BRIEF, { briefkopf: {}, fixiert: FIX })).bytes);
    assert.deepEqual(m, { lang: "de-DE", titel: "Testbetreff", anzeigeTitel: true });
  });

  it("correspondence: a letter fixed with layout version 1 (or without stamp) is rebuilt with its stored SHA-256", async () => {
    const { schreibenPdf } = await import("@/lib/schriftverkehr/aktionen.js");
    for (const fest of [{ ...BRIEF, status: "festgeschrieben", layout_version: 1 }, { ...BRIEF, status: "versendet" }]) {
      const neu = (await schreibenPdf(fest, { briefkopf: {}, fixiert: FIX })).bytes;
      assert.equal(sha(neu), GOLDEN.briefV1, fest.status);
      assert.equal((await meta(neu)).lang, null, fest.status);
    }
    const v2 = (await schreibenPdf({ ...BRIEF, status: "versendet", layout_version: 2 }, { briefkopf: {}, fixiert: FIX })).bytes;
    assert.equal((await meta(v2)).lang, "de-DE", "fixed with version 2 → rebuilt with /Lang");
    const nochmal = (await schreibenPdf({ ...BRIEF, status: "versendet", layout_version: 2 }, { briefkopf: {}, fixiert: FIX })).bytes;
    assert.equal(sha(nochmal), sha(v2), "version 2 is reproducible too");
  });

  it("fee letters: template version 3; offer draft, order confirmation and amendment get /Lang, version-2 letters keep their SHA-256", async () => {
    const { HONORAR_BRIEF_VERSION, HONORAR_BRIEF_VERSION_MIT_SPRACHE } = await import("@core/lib/brief/vorlagenVersion.js");
    assert.deepEqual({ ...HONORAR_BRIEF_VERSION }, { honorarangebot: 3, auftragsbestaetigung: 3, honorarnachtrag: 3 });
    assert.equal(HONORAR_BRIEF_VERSION_MIT_SPRACHE, 3);
    const { angebotPdf } = await import("@/lib/honorar/angebotPdf.js");
    const { auftragsbestaetigungPdf, honorarnachtragPdf } = await import("@/lib/honorar/vertragPdf.js");
    const { beispielDatensaetze } = await import("@/lib/accounting/beispielDaten.js");
    const { beispielDatensaetzeZeitHonorar, SEED_ANGEBOT_OFFEN } = await import("@/lib/zeitHonorar/beispielDaten.js");
    const { lphFuerLeistungsbild } = await import("@core/lib/hoai/honorar.js");
    const HEUTE = "2026-09-28";
    const saat = beispielDatensaetzeZeitHonorar(HEUTE, { buchhaltung: beispielDatensaetze(HEUTE) });
    const angebot = /** @type {Record<string, any>} */ (saat.Honorarangebot.find((a) => a.id === SEED_ANGEBOT_OFFEN.id));
    const KONTEXT = { projekt: { name: "Testhaus" }, briefkopf: { office: "Testbuero" }, heuteIso: HEUTE };

    const entwurf = await meta((await angebotPdf({ ...angebot, status: "entwurf" }, { ...KONTEXT, fixiert: FIX })).bytes);
    assert.deepEqual([entwurf.lang, entwurf.anzeigeTitel], ["de-DE", true], "offer draft");
    const v3 = await meta((await angebotPdf({ ...angebot, status: "versendet", vorlage_version: 3 }, { ...KONTEXT, fixiert: FIX })).bytes);
    assert.equal(v3.lang, "de-DE", "offer sent with version 3");
    const v2bytes = (await angebotPdf({ ...angebot, status: "versendet", vorlage_version: 2 }, { ...KONTEXT, fixiert: FIX })).bytes;
    assert.equal(sha(v2bytes), GOLDEN.angebotV2, "offer sent with version 2: stored SHA-256");
    assert.deepEqual([(await meta(v2bytes)).lang, (await meta(v2bytes)).anzeigeTitel], [null, false]);

    const VERTRAG = {
      id: "hv-t", nummer: "AV-0000-001", status: "beauftragt", vertragsdatum: HEUTE, leistungsbild: "innenraeume", bauherr_name: "Bauherrschaft", bauherr_anschrift: "Musterweg 1, 00000 Musterstadt",
      bauherr_art: "unternehmer", zahlungsziel_tage: 14, kg300_euro: 100000, kg400_euro: 0, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0,
      lph: lphFuerLeistungsbild("innenraeume").map((l) => ({ ...l, beauftragt: true })), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null, stufen: [], termine: [],
    };
    const ab = await meta((await auftragsbestaetigungPdf(VERTRAG, { ...KONTEXT, angebot: { nummer: "HA-0000-001" }, fixiert: FIX })).bytes);
    assert.deepEqual([ab.lang, ab.anzeigeTitel], ["de-DE", true], "order confirmation");
    const nachtrag = { id: "n1", nr: 1, titel: "Testleistung", grund: "besondere_leistung", lph: 5, berechnung: { art: "pauschal", betrag_euro: 1000 }, betrag_euro: 1000, status: "entwurf" };
    const V = { id: "hv-t", nummer: "AV-0000-001", bauherr_name: "Bauherrschaft", bauherr_anschrift: "Musterweg 1, 00000 Musterstadt", nebenkosten_prozent: 5 };
    assert.equal((await meta((await honorarnachtragPdf(nachtrag, V, { ...KONTEXT, fixiert: FIX })).bytes)).lang, "de-DE", "amendment draft");
    const alt = (await honorarnachtragPdf({ ...nachtrag, status: "angeboten", vorlage_version: 2 }, V, { ...KONTEXT, fixiert: FIX })).bytes;
    assert.equal(sha(alt), GOLDEN.nachtragV2, "amendment offered with version 2: stored SHA-256");
    assert.equal((await meta(alt)).lang, null);
  });
});

describe("F2: a user's own file never gets the app name as its title", () => {
  it("pdfLibMetadaten nurErgaenzen without a title: /Lang added, no title written", async () => {
    const { pdfLibMetadaten } = await import("@core/lib/pdfMetadaten.js");
    const doc = await PDFDocument.load(await quellPdf());
    pdfLibMetadaten(doc, { titel: "", sprache: "de-DE", nurErgaenzen: true });
    assert.deepEqual(await meta(await doc.save()), { lang: "de-DE", titel: null, anzeigeTitel: false });
  });

  it("formularAbflachen without a title on a file without one", async () => {
    const { formularAbflachen } = await import("@pdf/lib/unveraenderbar.js");
    const m = await meta((await formularAbflachen(await quellPdf())).bytes);
    assert.equal(m.lang, "de-DE");
    assert.equal(m.titel, null);
  });

  it("metadata tool: a title the user cleared stays cleared, a given one is written", async () => {
    const { setPdfMetadata } = await import("@pdf/components/pdfTools.js");
    const leer = await meta(await setPdfMetadata(await quellPdf({ titel: "Alter Titel" }), { title: "", author: "", subject: "", keywords: "" }));
    assert.equal(leer.lang, "de-DE");
    assert.ok(!leer.titel, `title must stay empty, got ${JSON.stringify(leer.titel)}`);
    const ohne = await meta(await setPdfMetadata(await quellPdf(), { title: "" }));
    assert.ok(!ohne.titel, `no title must be invented, got ${JSON.stringify(ohne.titel)}`);
    const gesetzt = await meta(await setPdfMetadata(await quellPdf(), { title: "Eigener Titel" }));
    assert.equal(gesetzt.titel, "Eigener Titel");
  });
});

describe("F3: jsPDF gets a language code it accepts", () => {
  it("pdfSpracheNormalisieren and jsPdfSprachKandidaten", async () => {
    const { pdfSpracheNormalisieren, jsPdfSprachKandidaten } = await import("@core/lib/pdfMetadaten.js");
    assert.equal(pdfSpracheNormalisieren("de-de"), "de-DE");
    assert.equal(pdfSpracheNormalisieren(" DE_de "), "de-DE");
    assert.equal(pdfSpracheNormalisieren("zh-hant-tw"), "zh-Hant-TW");
    assert.equal(pdfSpracheNormalisieren("es-419"), "es-419");
    assert.equal(pdfSpracheNormalisieren(""), "");
    assert.equal(pdfSpracheNormalisieren("1x"), "");
    assert.deepEqual(jsPdfSprachKandidaten("de-latn-de"), ["de-Latn-DE", "de-DE", "de"]);
    assert.deepEqual(jsPdfSprachKandidaten("EN"), ["en"]);
    assert.deepEqual(jsPdfSprachKandidaten(null), []);
  });

  it("jsPdfMetadaten writes /Lang for lower-case, underscore and script tags; an unknown language falls back", async () => {
    const { jsPDF } = await import("jspdf");
    const { jsPdfMetadaten } = await import("@core/lib/pdfMetadaten.js");
    const lies = async (/** @type {string} */ sprache) => {
      const pdf = new jsPDF();
      jsPdfMetadaten(pdf, { titel: "T", sprache });
      return (await meta(new Uint8Array(pdf.output("arraybuffer")))).lang;
    };
    assert.equal(await lies("de-de"), "de-DE");
    assert.equal(await lies("en_gb"), "en-GB");
    assert.equal(await lies("de-Latn-DE"), "de-DE");
    assert.equal(await lies("fr-fr"), "fr-FR");
    assert.equal(await lies("gsw-CH"), "de-DE", "unknown to jsPDF → UI language (no DOM under node → German)");
    assert.equal(await lies("de-DE"), "de-DE");
  });
});

describe("F4: pdfTools — results read back with pdf-lib", () => {
  /** @type {Record<string, any>} */
  let T;
  const laden = async () => (T ??= await import("@pdf/components/pdfTools.js"));
  after(() => { delete globalThis.document; });

  it("merge: title and /Lang of the first source; missing ones from the fallback title and the UI language", async () => {
    const { mergePdfs } = await laden();
    const a = await meta(await mergePdfs([await quellPdf({ titel: "Quelle A", sprache: "en-GB" }), await quellPdf()], { titel: "Datei" }));
    assert.deepEqual(a, { lang: "en-GB", titel: "Quelle A", anzeigeTitel: true });
    const b = await meta(await mergePdfs([await quellPdf(), await quellPdf()], { titel: "Datei" }));
    assert.deepEqual([b.lang, b.titel], ["de-DE", "Datei"]);
    const c = await meta(await mergePdfs([await quellPdf(), await quellPdf()]));
    assert.deepEqual([c.lang, c.titel], ["de-DE", null], "no title given, none invented");
  });

  it("split: every part keeps the source's language, its title gets the page range", async () => {
    const { splitPdf } = await laden();
    const teile = await splitPdf(await quellPdf({ titel: "Plan", sprache: "fr-FR", seiten: 3 }), "1, 2-3");
    assert.equal(teile.length, 2);
    const m = await Promise.all(teile.map((/** @type {any} */ t) => meta(t.bytes)));
    assert.deepEqual(m.map((x) => x.lang), ["fr-FR", "fr-FR"]);
    assert.ok(m.every((x) => x.titel?.startsWith("Plan ")), JSON.stringify(m));
  });

  it("extract / remove: a new document inherits title and language", async () => {
    const { extractPages, removePages } = await laden();
    const quelle = await quellPdf({ titel: "Bericht", sprache: "en-GB", seiten: 3 });
    for (const bytes of [await extractPages(quelle, [0]), await removePages(quelle, [1])]) {
      assert.deepEqual(await meta(bytes), { lang: "en-GB", titel: "Bericht", anzeigeTitel: true });
    }
  });

  it("rotate / page numbers / watermark: the user's own title and language stay; only a missing /Lang is added", async () => {
    const { rotatePages, addPageNumbers, addWatermark } = await laden();
    const eigene = await quellPdf({ titel: "Mein Titel", sprache: "it-IT", seiten: 2 });
    const ohne = await quellPdf({ seiten: 2 });
    const r = await rotatePages(eigene, [0], 90);
    assert.deepEqual([(await meta(r)).lang, (await meta(r)).titel], ["it-IT", "Mein Titel"]);
    assert.equal((await PDFDocument.load(r)).getPage(0).getRotation().angle, degrees(90).angle);
    for (const bytes of [await addPageNumbers(eigene), await addWatermark(eigene, { text: "ENTWURF" })]) {
      assert.deepEqual([(await meta(bytes)).lang, (await meta(bytes)).titel], ["it-IT", "Mein Titel"]);
    }
    for (const bytes of [await rotatePages(ohne, [0], 90), await addPageNumbers(ohne), await addWatermark(ohne, { text: "ENTWURF" })]) {
      assert.deepEqual([(await meta(bytes)).lang, (await meta(bytes)).titel], ["de-DE", null]);
    }
  });

  it("missing /Lang follows the UI language (<html lang>)", async () => {
    const { rotatePages } = await laden();
    globalThis.document = /** @type {any} */ ({ documentElement: { lang: "en" } });
    try {
      assert.equal((await meta(await rotatePages(await quellPdf(), [0], 90))).lang, "en-GB");
    } finally {
      delete globalThis.document;
    }
  });

  it("images → PDF: a new document with the given title and the UI language", async () => {
    const { imagesToPdf } = await laden();
    const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    assert.deepEqual(await meta(await imagesToPdf([png1x1], { titel: "Foto" })), { lang: "de-DE", titel: "Foto", anzeigeTitel: true });
    assert.equal((await meta(await imagesToPdf([png1x1]))).titel, null, "no title given, none invented");
  });

  it("getPdfMetadata reads back what setPdfMetadata wrote", async () => {
    const { setPdfMetadata, getPdfMetadata } = await laden();
    const bytes = await setPdfMetadata(await quellPdf(), { title: "Titel", author: "Autor", subject: "Betreff", keywords: "a, b" });
    const m = await getPdfMetadata(bytes);
    assert.equal(m.title, "Titel");
    assert.equal(m.author, "Autor");
    assert.equal(m.subject, "Betreff");
  });
});

describe("F5: exportElementToPdf — the rasterised UI's language", () => {
  it("elementPdfMetadaten: UI language by default, the caller's language when given", async () => {
    const { elementPdfMetadaten } = await import("@core/lib/pdf.js");
    globalThis.document = /** @type {any} */ ({ documentElement: { lang: "en" } });
    try {
      assert.deepEqual(await elementPdfMetadaten("Bericht_2026-11-19.pdf"), { titel: "Bericht 2026-11-19", sprache: "en-GB" });
      assert.deepEqual(await elementPdfMetadaten("x.pdf", { titel: "Titel", sprache: "de-DE" }), { titel: "Titel", sprache: "de-DE" });
      document.documentElement.lang = "de";
      assert.equal((await elementPdfMetadaten("x.pdf")).sprache, "de-DE");
    } finally {
      delete globalThis.document;
    }
  });

  it("exportElementToPdf passes elementPdfMetadaten to the helper (no fixed de-DE)", async () => {
    const fs = await import("node:fs");
    const quelle = fs.readFileSync(new URL("../../packages/nova-core/src/lib/pdf.js", import.meta.url), "utf8");
    const rumpf = quelle.slice(quelle.indexOf("export async function exportElementToPdf"));
    assert.match(rumpf, /jsPdfMetadaten\(pdf, await elementPdfMetadaten\(filename, \{ titel, sprache \}\)\)/);
  });
});

// W0-F6 (second review): a static import of the helper made Rollup list its lazy chunk in the entry's preload map
// (16 route preload lists, +63 B gzip on the entry). Every client module therefore loads it with `await import(…)`;
// a dynamically imported module is never preloaded with its importer's route, so the entry stays as on main.
describe("W0-F6: the helper is only imported dynamically (entry preload map unchanged)", () => {
  /** Files outside the client build (node-only) that may keep a static import, with the reason. */
  const NUR_NODE = Object.freeze({
    // bit-check CLI report (bitCheck.js uses node:fs/path); no client module imports it
    "packages/nova-ifc-viewer/src/lib/bitCheckBericht.js": "nur node (bit-check CLI)",
  });
  const STATISCH = /(?:^|\n)\s*import\s+[^;]*?from\s+["'][^"']*pdfMetadaten(?:\.js)?["']/;

  it("no client source imports pdfMetadaten statically", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // fileURLToPath, not URL.pathname: on Windows the pathname is "/C:/…" with %20 for blanks and never resolves
    const { fileURLToPath } = await import("node:url");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    /** @param {string} dir @returns {string[]} */
    const quellen = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === "node_modules" || e.name.startsWith(".")) return [];
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return quellen(p);
      return /\.(js|jsx|mjs|ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
    const dirs = [path.join(root, "src"), ...fs.readdirSync(path.join(root, "packages")).map((p) => path.join(root, "packages", p, "src"))];
    const treffer = dirs.filter((d) => fs.existsSync(d)).flatMap(quellen)
      .map((p) => path.relative(root, p).split(path.sep).join("/"))
      .filter((rel) => !rel.endsWith("lib/pdfMetadaten.js") && !Object.prototype.hasOwnProperty.call(NUR_NODE, rel))
      .filter((rel) => STATISCH.test(fs.readFileSync(path.join(root, rel), "utf8")));
    assert.deepEqual(treffer, [], `statischer Import von pdfMetadaten: ${treffer.join(", ")}`);
  });

  it("the letter core's own language constant equals PDF_SPRACHE_STANDARD", async () => {
    const { PDF_SPRACHE_STANDARD } = await import("@core/lib/pdfMetadaten.js");
    const { fixiertFuerVersion } = await import("@core/lib/brief/briefPdf.js");
    assert.equal(fixiertFuerVersion(FIX, true)?.sprache, PDF_SPRACHE_STANDARD);
    assert.deepEqual(fixiertFuerVersion(FIX, false), FIX);
  });
});
