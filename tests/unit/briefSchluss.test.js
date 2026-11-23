// User finding 15.11.2026 (fee offer PDF, phase 115): the amount table stood after the WHOLE letter text — below "Mit
// freundlichen Grüßen" and the draft note. The letter core now has a place for text after the table (`schluss`), and the
// templates with an amount table got a new version that uses it: salutation → introduction → table → closing text →
// greeting → draft note. This test fixes three things:
// 1. the order of the blocks in the laid-out letter and in the PDF (table above the greeting), page breaks included;
// 2. a letter WITHOUT `schluss` — every letter created before — gives exactly the page model and the PDF bytes of the
//    core before the change (frozen copy fixtures/briefKernVorSchluss.js);
// 3. template versioning: version 1 of the fee builders is still there word for word, a record that left the draft
//    state keeps its version, a draft gets the current one.
//
// In:  @core/lib/brief (briefLayout, briefPdf, vorlagen, schreiben), src/lib/honorar (offer, amendment),
//      src/lib/accounting (dunning letter), src/lib/schriftverkehr/bezugLaden.js. Out: assertions only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { briefLayout } from "@core/lib/brief/briefLayout.js";
import { erzeugeBriefPdf } from "@core/lib/brief/briefPdf.js";
import { BETRAGS_SPALTEN, BRIEFARTEN, HONORAR_BRIEFE, honorarBriefBauer, honorarBriefVersion } from "@core/lib/brief/vorlagen.js";
import { HONORAR_BRIEF_VERSION } from "@core/lib/brief/vorlagenVersion.js";
import { briefModell, fehlendIn, umschreiben } from "@core/lib/brief/schreiben.js";
import { angebotBriefEingabe, angebotPdf } from "@/lib/honorar/angebotPdf.js";
import { neueFassung, versenden } from "@/lib/honorar/angebot.js";
import { nachtragStatusWechsel } from "@/lib/honorar/honorarNachtrag.js";
import { nachtragEingabe } from "@/lib/honorar/vertragPdf.js";
import { mahnTextFelder } from "@/lib/accounting/mahnwesen.js";
import { mahnBrief } from "@/lib/accounting/mahnPdf.js";
import { neuerEntwurf } from "@/lib/schriftverkehr/bezugLaden.js";
import { schreibenPdf } from "@/lib/schriftverkehr/aktionen.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar, SEED_ANGEBOT_OFFEN } from "@/lib/zeitHonorar/beispielDaten.js";
import { briefLayout as briefLayoutAlt, erzeugeBriefPdf as erzeugeBriefPdfAlt } from "./fixtures/briefKernVorSchluss.js";

const FIX = { erstelltAm: "2026-11-15T09:00:00Z", dateiId: "00112233445566778899aabbccddeeff" };
const GRUSS = "Mit freundlichen Grüßen";
/** Line budgets of briefLayout (mm → lines of 5 mm): first page below the subject, following pages. */
const BUDGET_SEITE_1 = Math.floor((297 - 20 - 98.46) / 5);
const BUDGET_FOLGESEITE = Math.floor((297 - 20 - 10) / 5);

const tabelle = (/** @type {number} */ n) => ({
  kopf: ["Leistung", "Anteil", "Betrag"],
  zeilen: [...Array.from({ length: n }, (_, i) => [`LPH ${i + 1} Musterleistung`, "10 %", `${i + 1}.000,00 €`]), ["Honorar brutto", "", "99.000,00 €"]],
  spalten: BETRAGS_SPALTEN,
});
const BASIS = { absender: ["Musterbüro"], empfaenger: ["Bauherr Mustermann", "Musterweg 1", "00000 Musterstadt"], datum: "15.11.2026", betreff: "Honorarangebot HA-2026-001" };
const VOR = ["Sehr geehrte Damen und Herren,", "für das Projekt „Musterhaus“ bieten wir Ihnen die Leistungen wie folgt an."];
const NACH = ["Dieses Honorarangebot gilt bis 15.12.2026.", GRUSS, "Entwurf — vor Versand gegenlesen."];

/** Lines a page carries, counted the way briefPdf.js draws them (blank line before a table and before the closing block). @param {any} seite */
function belegteZeilen(seite) {
  const t = seite.tabelle ? 1 + (seite.tabelle.kopf.length ? 1 : 0) + seite.tabelle.zeilen.length : 0;
  const nach = seite.zeilenNach?.length ? seite.zeilenNach.length + (seite.zeilen.length || seite.tabelle ? 1 : 0) : 0;
  return seite.zeilen.length + t + nach;
}

/** The blocks of a laid-out letter in reading order, one entry per line: "text:…", "tabelle:…", "nach:…". @param {ReturnType<typeof briefLayout>} layout */
function lesefolge(layout) {
  return layout.seiten.flatMap((s) => [
    ...s.zeilen.map((z) => `text:${z}`),
    ...(s.tabelle ? s.tabelle.zeilen.map((z) => `tabelle:${z[0]}`) : []),
    ...(s.zeilenNach || []).map((z) => `nach:${z}`),
  ]);
}

/**
 * Text items of a PDF with page and position (mm from the top edge), in page order.
 * @param {Uint8Array} bytes
 * @returns {Promise<Array<{text: string, seite: number, y: number}>>}
 */
async function texte(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  const aus = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const inhalt = await (await doc.getPage(n)).getTextContent();
    for (const i of /** @type {any[]} */ (inhalt.items)) if (i.str) aus.push({ text: i.str, seite: n, y: 297 - (i.transform[5] * 25.4) / 72 });
  }
  return aus;
}

/** Position of the first text item that contains `teil`, as one sortable number (page first, then mm from the top). */
const ort = (/** @type {Array<{text: string, seite: number, y: number}>} */ t, /** @type {string} */ teil) => {
  const treffer = t.find((x) => x.text.includes(teil));
  assert.ok(treffer, `fehlt im PDF: ${teil}`);
  return treffer.seite * 1000 + treffer.y;
};

describe("Brief: Betragstabelle vor Schlussformel und Gruß (Layout)", () => {
  it("Reihenfolge: Absätze → Tabelle → Schluss mit Gruß; alles auf Seite 1, wenn es passt", () => {
    const l = briefLayout({ ...BASIS, absaetze: VOR, tabelle: tabelle(8), schluss: NACH, seitenzahlen: true });
    assert.equal(l.seiten.length, 1);
    const s = l.seiten[0];
    assert.ok(!s.zeilen.includes(GRUSS), "der Gruß steht nicht mehr über der Tabelle");
    assert.equal(s.tabelle?.zeilen.length, 9);
    assert.deepEqual(s.zeilenNach, ["Dieses Honorarangebot gilt bis 15.12.2026.", "", GRUSS, "", "Entwurf — vor Versand gegenlesen."]);
    const folge = lesefolge(l);
    assert.ok(folge.indexOf("tabelle:Honorar brutto") < folge.indexOf(`nach:${GRUSS}`), "Tabelle vor dem Gruß");
    assert.ok(folge.indexOf("text:Sehr geehrte Damen und Herren,") < folge.indexOf("tabelle:LPH 1 Musterleistung"), "Anrede vor der Tabelle");
    assert.ok(folge.indexOf(`nach:${GRUSS}`) < folge.indexOf("nach:Entwurf — vor Versand gegenlesen."), "Entwurfshinweis nach dem Gruß");
    assert.ok(belegteZeilen(s) <= BUDGET_SEITE_1);
  });

  it("im PDF steht die Tabelle über dem Gruß, der Schluss eine Leerzeile unter der Tabelle", async () => {
    const t = await texte(await erzeugeBriefPdf(briefLayout({ ...BASIS, absaetze: VOR, tabelle: tabelle(8), schluss: NACH, seitenzahlen: true }), { fixiert: FIX }));
    assert.ok(ort(t, "Sehr geehrte") < ort(t, "LPH 1 Musterleistung"));
    assert.ok(ort(t, "Honorar brutto") < ort(t, "Dieses Honorarangebot gilt"));
    assert.ok(ort(t, "Dieses Honorarangebot gilt") < ort(t, GRUSS));
    assert.ok(ort(t, GRUSS) < ort(t, "Entwurf — vor Versand"));
    // One blank line (5 mm) between the last table row and the first closing line: 10 mm from baseline to baseline.
    assert.ok(Math.abs(ort(t, "Dieses Honorarangebot gilt") - ort(t, "Honorar brutto") - 10) < 0.2);
  });

  it("Schluss ohne Tabelle folgt den Absätzen mit einer Leerzeile", () => {
    const l = briefLayout({ ...BASIS, absaetze: ["Text."], schluss: [GRUSS] });
    assert.deepEqual(l.seiten.map((s) => [s.zeilen, s.tabelle, s.zeilenNach]), [[["Text."], null, [GRUSS]]]);
  });

  it("Seitenumbruch: eine lange Tabelle läuft über mehrere Seiten, der Schluss folgt nach dem letzten Teil", () => {
    const l = briefLayout({ ...BASIS, absaetze: VOR, tabelle: tabelle(120), schluss: NACH, seitenzahlen: true });
    assert.ok(l.seiten.length >= 3, "mehrere Seiten");
    for (const s of l.seiten) assert.ok(belegteZeilen(s) <= (s.nummer === 1 ? BUDGET_SEITE_1 : BUDGET_FOLGESEITE), `Seite ${s.nummer} über dem Zeilenbudget`);
    // Nothing lost, nothing doubled, order kept across the page breaks.
    const folge = lesefolge(l);
    assert.equal(folge.filter((z) => z.startsWith("tabelle:")).length, 121);
    assert.deepEqual(folge.filter((z) => z.startsWith("nach:")).map((z) => z.slice(5)).filter(Boolean), NACH);
    assert.ok(folge.lastIndexOf("tabelle:Honorar brutto") < folge.indexOf(`nach:${NACH[0]}`));
    // The head row is repeated on every table page (81-03), the closing block sits on the page where the table ends.
    const mitTabelle = l.seiten.filter((s) => s.tabelle);
    assert.ok(mitTabelle.every((s) => s.tabelle?.kopf.length === 3));
    const letzteTabellenSeite = mitTabelle[mitTabelle.length - 1];
    assert.deepEqual(l.seiten.filter((s) => s.zeilenNach).map((s) => s.nummer), [letzteTabellenSeite.nummer]);
    assert.equal(l.seiten[l.seiten.length - 1].fusszeile, `Seite ${l.seiten.length} von ${l.seiten.length}`);
  });

  it("Seitenumbruch: passt der Schluss nicht mehr unter die Tabelle, wandert er GANZ auf die nächste Seite (Gruß nie allein)", () => {
    // 2 body lines + blank + head + 28 rows = 32 of 35 lines on page 1: two lines are free, the closing block needs five.
    const l = briefLayout({ ...BASIS, absaetze: ["Anrede,", "Einleitung."], tabelle: tabelle(27), schluss: NACH, seitenzahlen: true });
    assert.equal(l.seiten.length, 2);
    assert.equal(l.seiten[0].tabelle?.zeilen.length, 28);
    assert.equal(l.seiten[0].zeilenNach, undefined, "kein angerissener Schluss auf Seite 1");
    assert.deepEqual(l.seiten[1], { nummer: 2, zeilen: [], tabelle: null, zeilenNach: ["Dieses Honorarangebot gilt bis 15.12.2026.", "", GRUSS, "", "Entwurf — vor Versand gegenlesen."], fusszeile: "Seite 2 von 2" });
  });

  it("ein Schluss, der länger als eine Seite ist, läuft zeilenweise weiter und beginnt keine Seite mit einer Leerzeile", () => {
    const lang = Array.from({ length: 40 }, (_, i) => `Schlussabsatz ${i + 1}.`);
    const l = briefLayout({ ...BASIS, absaetze: ["Text."], tabelle: tabelle(3), schluss: [...lang, GRUSS] });
    for (const s of l.seiten) assert.ok(belegteZeilen(s) <= (s.nummer === 1 ? BUDGET_SEITE_1 : BUDGET_FOLGESEITE));
    for (const s of l.seiten.slice(1)) assert.notEqual(s.zeilenNach?.[0], "");
    assert.deepEqual(lesefolge(l).filter((z) => z.startsWith("nach:")).map((z) => z.slice(5)).filter(Boolean), [...lang, GRUSS]);
  });
});

describe("Brief ohne `schluss`: Modell und PDF-Bytes wie vor der Änderung", () => {
  const ALT = [
    { ...BASIS, absaetze: [...VOR, ...NACH] },
    { betreff: "Mahnung", absaetze: ["Ein kurzer Text.", GRUSS], tabelle: { zeilen: [["Offener Betrag", "100,00 €"], ["Summe", "100,00 €"]] } },
    { ...BASIS, absaetze: [...VOR, ...NACH], tabelle: tabelle(8), seitenzahlen: true },
    { ...BASIS, absaetze: [...VOR, ...NACH], tabelle: tabelle(27), seitenzahlen: true },
    { ...BASIS, absaetze: [...VOR, ...NACH], tabelle: tabelle(120), seitenzahlen: true },
    { ...BASIS, absaetze: [Array.from({ length: 700 }, (_, i) => `Wort${i}`).join(" "), GRUSS], tabelle: tabelle(8), seitenzahlen: true, fusszeileLinks: "Musterbüro · Musterweg 2, 00000 Musterstadt" },
    { ...BASIS, variante: /** @type {const} */ ("verteiler"), verteiler: ["Bauherr Mustermann", "Tragwerksplanung Beispiel"], absaetze: ["Projekt: Musterhaus"], seitenzahlen: true,
      tabelle: { kopf: ["TOP", "Thema", "Verantwortlich", "Termin"], zeilen: [["1", "Musterthema", "Bauleitung", "15.11.2026"]], spalten: [{ breite_mm: 15, ausrichtung: "links" }, { breite_mm: 85, ausrichtung: "links" }, { breite_mm: 40, ausrichtung: "links" }, { breite_mm: 25, ausrichtung: "rechts" }] } },
  ];

  it("Seitenmodell identisch (auch mit leerem `schluss`)", () => {
    for (const e of ALT) {
      assert.deepEqual(briefLayout(/** @type {any} */ (e)), briefLayoutAlt(/** @type {any} */ (e)), e.betreff);
      assert.deepEqual(briefLayout(/** @type {any} */ ({ ...e, schluss: [] })), briefLayoutAlt(/** @type {any} */ (e)), e.betreff);
    }
  });

  it("PDF byte-identisch", async () => {
    for (const e of ALT) {
      const neu = await erzeugeBriefPdf(briefLayout(/** @type {any} */ (e)), { fixiert: FIX });
      const alt = await erzeugeBriefPdfAlt(briefLayoutAlt(/** @type {any} */ (e)), { fixiert: FIX });
      assert.ok(neu.length > 1000);
      assert.equal(Buffer.compare(Buffer.from(neu), Buffer.from(alt)), 0, `${e.betreff}: Bytes weichen ab`);
    }
  });
});

describe("Vorlagenversionen der Honorarbriefe", () => {
  const ANGEBOT_KONTEXT = {
    nummer: "HA-2026-001", fassung: 1, datum: "15.11.2026", gueltigBis: "15.12.2026", projektName: "Musterhaus",
    leistungsbild: "Gebäude", lphParagraf: 34, fassungHoai: "HOAI 2021",
    zeilen: [{ bezeichnung: "LPH 1 Grundlagenermittlung", prozent: "2 %", betrag: "1.000,00 €" }],
    netto: "1.000,00 €", ust: "190,00 €", brutto: "1.190,00 €", ustProzent: 19, zahlungszielTage: 14, zahlungszielVertraglich: true,
    vorbemerkung: "Grundlage ist das Gespräch vom 01.11.2026.", annahmen: "Bestandspläne liegen vor.", ausschluesse: "Vermessung.",
    umbauOhneTextform: true, gegenlesen: true,
  };

  it("alle drei Bauer stehen auf Version 3 (Wortlaut von 2, PDF mit /Lang) und behalten Version 1 und 2", () => {
    for (const key of /** @type {const} */ (["honorarangebot", "auftragsbestaetigung", "honorarnachtrag"])) {
      assert.equal(HONORAR_BRIEFE[key].version, 3, key);
      assert.deepEqual(Object.keys(HONORAR_BRIEFE[key].versionen), ["1", "2", "3"], key);
      assert.equal(HONORAR_BRIEFE[key].version, HONORAR_BRIEF_VERSION[key], key);
      assert.equal(HONORAR_BRIEFE[key].bauen, HONORAR_BRIEFE[key].versionen[3], key);
      assert.equal(HONORAR_BRIEFE[key].versionen[3], HONORAR_BRIEFE[key].versionen[2], `${key}: version 3 keeps the wording of 2`);
      assert.equal(honorarBriefBauer(key, 1), HONORAR_BRIEFE[key].versionen[1], key);
    }
    assert.throws(() => honorarBriefBauer("honorarangebot", 4), /Version 4 kennt dieser App-Stand nicht/);
    assert.equal(BRIEFARTEN.mahnung.version, 2);
  });

  it("Version 1 des Honorarangebots: Wortlaut und Reihenfolge wie bisher, kein `schluss`", () => {
    const b = honorarBriefBauer("honorarangebot", 1)(ANGEBOT_KONTEXT);
    assert.deepEqual(Object.keys(b), ["betreff", "absaetze", "tabelle"]);
    assert.deepEqual(b.absaetze, [
      "Sehr geehrte Damen und Herren,",
      "für das Projekt „Musterhaus“ bieten wir Ihnen die Leistungen des Leistungsbilds Gebäude nach § 34 HOAI 2021 wie folgt an.",
      "Grundlage ist das Gespräch vom 01.11.2026.",
      "Annahmen: Bestandspläne liegen vor.",
      "Nicht enthalten: Vermessung.",
      "Das Honorar beträgt 1.000,00 € netto zuzüglich 19 % Umsatzsteuer (190,00 €), zusammen 1.190,00 €.",
      "Zahlungsziel 14 Tage nach Rechnungseingang (vertraglich vereinbart).",
      "Der Umbauzuschlag von 20 % gilt nach § 6 Abs. 2 HOAI, solange kein anderer Zuschlag in Textform vereinbart ist.",
      "Das Honorar wird mit dem Architektenvertrag in Textform vereinbart (§ 7 Abs. 1 HOAI).",
      "Dieses Honorarangebot gilt bis 15.12.2026.",
      "Entwurf — Richtwerte nach HOAI 2021, vor Versand gegenlesen.",
      GRUSS,
    ]);
  });

  it("Version 2: dieselben Sätze, die Tabelle steht vor Schlusstext und Gruß, der Entwurfshinweis nach dem Gruß", () => {
    const v1 = honorarBriefBauer("honorarangebot", 1)(ANGEBOT_KONTEXT);
    const v2 = HONORAR_BRIEFE.honorarangebot.bauen(ANGEBOT_KONTEXT);
    assert.equal(v2.betreff, v1.betreff);
    assert.deepEqual(v2.tabelle, v1.tabelle);
    assert.deepEqual(v2.absaetze, v1.absaetze.slice(0, 5), "Anrede, Einleitung, Vorbemerkung, Annahmen, Ausschlüsse vor der Tabelle");
    assert.deepEqual(v2.schluss?.slice(-2), [GRUSS, "Entwurf — Richtwerte nach HOAI 2021, vor Versand gegenlesen."]);
    assert.deepEqual([...v2.absaetze, ...(v2.schluss || [])].sort(), [...v1.absaetze].sort(), "kein Satz dazu, keiner weg");
    for (const key of /** @type {const} */ (["auftragsbestaetigung", "honorarnachtrag"])) {
      const k = { nummer: "AV-2026-001", angebotNummer: "HA-2026-001", projektName: "Musterhaus", vertragsdatum: "15.11.2026", leistungsbild: "Gebäude", lphParagraf: 34, fassungHoai: "HOAI 2021",
        stufen: ["Stufe 1: LPH 1"], zeilen: ANGEBOT_KONTEXT.zeilen, netto: "1.000,00 €", ust: "190,00 €", brutto: "1.190,00 €", ustProzent: 19, zahlungszielTage: 14, zahlungszielQuelle: "laut Architektenvertrag",
        zahlungszielVertraglich: true, termine: ["LPH 1 bis 30.11.2026"], haftung: ["Berufshaftpflicht bei Beispiel Versicherung AG"], verbraucher: true, gegenlesen: true,
        nr: 1, titel: "Variantenuntersuchung", vertragNummer: "AV-2026-001", grund: "Besondere Leistung", grundQuelle: "§ 3 Abs. 2 HOAI", lph: "LPH 5", berechnung: "pauschal", betrag: "8.000,00 €", nebenkostenProzent: 5 };
      const alt = honorarBriefBauer(key, 1)(k);
      const neu = honorarBriefBauer(key, 2)(k);
      assert.equal(alt.schluss, undefined, key);
      assert.equal(alt.absaetze[alt.absaetze.length - 1], GRUSS, key);
      assert.ok(!neu.absaetze.includes(GRUSS), key);
      assert.equal(neu.schluss?.[neu.schluss.length - 2], GRUSS, key);
      assert.deepEqual([...neu.absaetze, ...(neu.schluss || [])].sort(), [...alt.absaetze].sort(), key);
      assert.deepEqual(neu.tabelle, alt.tabelle, key);
    }
  });

  it("honorarBriefVersion: Entwurf → aktuell; eingefroren ohne Stempel → 1; mit Stempel → der Stempel", () => {
    assert.equal(honorarBriefVersion("honorarangebot", { status: "entwurf" }), 3);
    assert.equal(honorarBriefVersion("honorarangebot", {}), 3);
    assert.equal(honorarBriefVersion("honorarangebot", { status: "entwurf", vorlage_version: 1 }), 3, "ein Entwurf ist nicht eingefroren");
    assert.equal(honorarBriefVersion("honorarangebot", { status: "versendet" }), 1);
    assert.equal(honorarBriefVersion("honorarangebot", { status: "angenommen", vorlage_version: 2 }), 2);
    assert.equal(honorarBriefVersion("honorarnachtrag", { status: "angeboten" }), 1);
    assert.equal(honorarBriefVersion("honorarnachtrag", { status: "beauftragt", vorlage_version: 2 }), 2);
  });
});

describe("Honorarangebot: versendete Angebote bleiben, wie sie waren; neue bekommen die neue Reihenfolge", () => {
  const HEUTE = "2026-09-28";
  const saat = beispielDatensaetzeZeitHonorar(HEUTE, { buchhaltung: beispielDatensaetze(HEUTE) });
  const VERSENDET = /** @type {Record<string, any>} */ (saat.Honorarangebot.find((a) => a.id === SEED_ANGEBOT_OFFEN.id));
  const KONTEXT = { projekt: { id: "proj-3", name: "Gemeinschaftshaus" }, briefkopf: { office: "Architekturbüro Beispiel", address: "Musterweg 2\n00000 Musterstadt", tagline: "", contact: "" }, heuteIso: HEUTE };

  it("ein vor der Änderung versendetes Angebot (ohne Stempel): Eingabe der Version 1, PDF byte-identisch mit dem alten Kern", async () => {
    assert.equal(VERSENDET.status, "versendet");
    assert.equal(VERSENDET.vorlage_version, undefined);
    const eingabe = angebotBriefEingabe(VERSENDET, KONTEXT);
    assert.equal(eingabe.schluss, undefined);
    assert.equal(eingabe.absaetze[eingabe.absaetze.length - 1], GRUSS);
    const neu = await angebotPdf(VERSENDET, { ...KONTEXT, fixiert: FIX });
    // What briefPdfAusEingabe did before the change (the seed has WinAnsi text only, so the transliteration changes nothing).
    const alt = await erzeugeBriefPdfAlt(briefLayoutAlt({ absender: eingabe.absender, empfaenger: eingabe.empfaenger, datum: eingabe.datum, betreff: eingabe.betreff, absaetze: eingabe.absaetze, tabelle: eingabe.tabelle, seitenzahlen: true }), { fixiert: FIX });
    assert.equal(neu.ersetzt, 0);
    assert.equal(Buffer.compare(Buffer.from(neu.bytes), Buffer.from(alt)), 0);
  });

  it("ein Entwurf: Tabelle im PDF über dem Gruß, Entwurfshinweis unter dem Gruß", async () => {
    const entwurf = { ...VERSENDET, status: "entwurf" };
    const eingabe = angebotBriefEingabe(entwurf, KONTEXT);
    assert.ok(!eingabe.absaetze.includes(GRUSS));
    assert.ok(eingabe.schluss?.includes(GRUSS));
    const r = await angebotPdf(entwurf, { ...KONTEXT, fixiert: FIX });
    const folge = lesefolge(r.layout);
    assert.ok(folge.indexOf("tabelle:Honorar brutto") < folge.indexOf(`nach:${GRUSS}`));
    const t = await texte(r.bytes);
    assert.ok(ort(t, "Sehr geehrte") < ort(t, "Honorar netto"));
    assert.ok(ort(t, "Honorar brutto") < ort(t, "Zahlungsziel 14 Tage"));
    assert.ok(ort(t, "Honorar brutto") < ort(t, GRUSS));
    assert.ok(ort(t, GRUSS) < ort(t, "vor Versand gegenlesen"));
  });

  it("versenden stempelt die Vorlagenversion; das versendete Angebot wird danach mit ihr gebaut, eine neue Fassung ist wieder Entwurf", () => {
    const entwurf = { ...VERSENDET, id: "ha-neu", status: "entwurf", fassung: 2 };
    const andererEntwurf = { ...VERSENDET, id: "ha-alt", status: "entwurf", fassung: 3 };
    const r = versenden(entwurf, [VERSENDET, entwurf, andererEntwurf], { heuteIso: HEUTE });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.angebot.vorlage_version, 3);
    // A draft that is replaced was shown with the current template and keeps it; the offer sent earlier keeps version 1.
    assert.deepEqual(r.ersetzte.map((x) => [x.id, x.status, x.vorlage_version]), [[VERSENDET.id, "ersetzt", undefined], ["ha-alt", "ersetzt", 3]]);
    assert.equal(honorarBriefVersion("honorarangebot", r.ersetzte[0]), 1);
    assert.ok(angebotBriefEingabe(r.angebot, KONTEXT).schluss?.includes(GRUSS));
    // Should the template move on to a version 3 one day, the stamp decides — simulated with a stamp of 1 on a sent offer.
    assert.equal(angebotBriefEingabe({ ...r.angebot, vorlage_version: 1 }, KONTEXT).schluss, undefined);
    assert.equal(honorarBriefVersion("honorarangebot", neueFassung(r.angebot, [r.angebot], { heuteIso: HEUTE })), 3);
  });

  it("Honorarnachtrag: angeboten ohne Stempel bleibt Version 1, der Statuswechsel aus dem Entwurf stempelt", () => {
    const vertrag = { id: "hv-1", nummer: "AV-2026-001", bauherr_name: "Bauherrschaft B", bauherr_anschrift: "Musterstraße 1, 00000 Musterstadt", nebenkosten_prozent: 5 };
    const n = { id: "n1", nr: 1, titel: "Variantenuntersuchung Fassade", grund: "besondere_leistung", lph: 5, berechnung: { art: "pauschal", betrag_euro: 8000 }, betrag_euro: 8000 };
    const k = { projekt: { name: "Gemeinschaftshaus" }, briefkopf: { office: "Architekturbüro Beispiel" }, heuteIso: HEUTE };
    const alt = nachtragEingabe({ ...n, status: "angeboten" }, vertrag, k);
    assert.equal(alt.schluss, undefined);
    assert.equal(alt.absaetze[alt.absaetze.length - 1], GRUSS);
    const entwurf = nachtragEingabe({ ...n, status: "entwurf" }, vertrag, { ...k, gegenlesen: true });
    assert.deepEqual(entwurf.schluss, ["Wir bitten um Beauftragung in Textform (§ 7 Abs. 1 HOAI).", GRUSS, "Entwurf — vor Versand gegenlesen."]);
    const w = nachtragStatusWechsel({ ...n, status: "entwurf" }, "angeboten", { heuteIso: HEUTE });
    assert.equal(w.ok && w.nachtrag.vorlage_version, 3);
    const weiter = nachtragStatusWechsel({ ...n, status: "angeboten" }, "beauftragt", { heuteIso: HEUTE });
    assert.equal(weiter.ok && weiter.nachtrag.vorlage_version, undefined, "ein alter Nachtrag bekommt nachträglich keinen Stempel");
  });
});

describe("Mahnung und Schriftverkehr: Forderungstabelle vor Fristsatz und Gruß", () => {
  const T = (/** @type {string} */ s) => s;
  const RECHNUNG = {
    id: "re-t", nummer: "RE-2026-005", rechnungsdatum: "2026-05-17", brutto: 10000, netto: 8403.36, ust: 1596.64, ust_satz: 19, faellig_am: "2026-05-31", zahlungen: [],
    mahnungen: [{ stufe: 1, datum: "2026-06-15", frist: "2026-06-25" }], empfaenger: { name: "Beispiel Immobilien GmbH", anschrift: "Musterstraße 1\n00000 Musterstadt", art: "unternehmer" },
  };
  const CTX = { heute: "2026-09-28", einst: {}, briefkopf: {}, vertrag: null };
  const mahnText = (/** @type {any} */ re, /** @type {number} */ stufe) => {
    const f = mahnTextFelder(re, stufe, CTX, T);
    const b = mahnBrief(f);
    return { betreff: b.betreff || "", absaetze: b.absaetze || [], schluss: b.schluss || [], tabelle: /** @type {any} */ (b.tabelle), offenCent: f.offenCent, zinsenCent: f.zinsenCent, pauschaleCent: f.pauschaleCent, summeCent: f.summeCent };
  };

  it("mahnBrief: Fristsatz und Gruß werden `schluss`, die Tabelle steht im Layout davor — auf jeder Stufe", () => {
    for (const stufe of [1, 2, 3]) {
      const f = mahnTextFelder(RECHNUNG, stufe, CTX, T);
      assert.equal(f.absaetze[f.absaetze.length - 1], GRUSS, "mahnTextFelder.absaetze bleibt vollständig");
      assert.equal(f.schlussAb, f.absaetze.length - 2);
      const b = mahnBrief(f);
      assert.deepEqual(b.absaetze, [f.anrede, ...f.absaetze.slice(0, -2)]);
      assert.deepEqual(b.schluss, f.absaetze.slice(-2));
      assert.match(/** @type {string[]} */ (b.schluss)[0], /bis (zum|spätestens) \d\d\.\d\d\.\d{4}/, "der Fristsatz");
      const folge = lesefolge(briefLayout(b));
      assert.ok(folge.indexOf("tabelle:Summe") < folge.indexOf(`nach:${GRUSS}`), `Stufe ${stufe}`);
      assert.ok(!folge.includes(`text:${GRUSS}`), `Stufe ${stufe}`);
    }
  });

  it("neuer Mahn-Entwurf im Schriftverkehr trägt `schluss` und Vorlagenversion 2; das Modell gibt ihn an das Layout weiter", async () => {
    const { entwurf } = neuerEntwurf(BRIEFARTEN.mahnung, { typ: "rechnung", id: "re-t", stufe: 2 }, { heute: "2026-09-28", rechnungen: [RECHNUNG], mahnText });
    assert.equal(entwurf.vorlage_version, 2);
    assert.ok(!entwurf.text.includes(GRUSS));
    assert.ok(entwurf.schluss.endsWith(GRUSS));
    assert.ok(entwurf.tabelle.zeilen.length >= 2);
    const m = briefModell({ ...entwurf, anlagen: ["Rechnungskopie"] }, { briefkopf: {}, datumText: "28.09.2026" });
    assert.deepEqual(m.schluss.slice(-2), [GRUSS, "Anlagen: Rechnungskopie"]);
    assert.ok(!m.absaetze.some((/** @type {string} */ a) => a.startsWith("Anlagen:")));
    const { bytes, schreiben } = await schreibenPdf({ ...entwurf, id: "sc-neu" }, { briefkopf: {}, fixiert: FIX });
    assert.equal(schreiben.schluss, entwurf.schluss);
    const t = await texte(bytes);
    assert.ok(ort(t, "Summe") < ort(t, GRUSS));
    assert.deepEqual(fehlendIn({ betreff: "ok", text: "ok", schluss: "bis [[fehlt: mahnung.frist]]" }), ["mahnung.frist"]);
  });

  it("ein Brief ohne Tabelle bekommt kein `schluss`; ein vorher angelegter Mahn-Entwurf (Gruß im Text, Tabelle, kein `schluss`) bleibt byte-identisch", async () => {
    const frei = neuerEntwurf(BRIEFARTEN.brief, null, { heute: "2026-09-28" }).entwurf;
    assert.ok(!("schluss" in frei));
    const alt = { id: "sc-alt", vorlage_key: "mahnung", vorlage_version: 1, status: "entwurf", datum: "2026-09-28", betreff: "Mahnung",
      empfaenger: { firma: "Beispiel Immobilien GmbH", strasse: "Musterstraße 1", plz: "00000", ort: "Musterstadt" },
      text: `Sehr geehrte Damen und Herren,\n\nText der Mahnung.\n\n${GRUSS}`, anlagen: ["Rechnungskopie"], tabelle: { kopf: [], zeilen: [["Offener Betrag", "10.000,00 €"], ["Summe", "10.000,00 €"]] } };
    assert.ok(!("schluss" in umschreiben(alt).schreiben));
    const modell = briefModell(alt, { briefkopf: {}, datumText: "28.09.2026" });
    assert.ok(!("schluss" in modell));
    assert.deepEqual(modell.absaetze, ["Sehr geehrte Damen und Herren,", "Text der Mahnung.", GRUSS, "Anlagen: Rechnungskopie"]);
    const vorher = await erzeugeBriefPdfAlt(briefLayoutAlt(/** @type {any} */ (modell)), { fixiert: FIX });
    // 105-19 follow-up: a letter fixed with layout version 1 is rebuilt byte for byte (its stored SHA-256); a draft fixed
    // now is stamped with version 2 and also carries /Lang — the page content stays the same.
    const festV1 = (await schreibenPdf({ ...alt, status: "festgeschrieben", layout_version: 1 }, { briefkopf: {}, fixiert: FIX })).bytes;
    assert.equal(Buffer.compare(Buffer.from(festV1), Buffer.from(vorher)), 0);
    const neu = (await schreibenPdf(alt, { briefkopf: {}, fixiert: FIX })).bytes;
    assert.deepEqual(await texte(neu), await texte(vorher));
  });
});
