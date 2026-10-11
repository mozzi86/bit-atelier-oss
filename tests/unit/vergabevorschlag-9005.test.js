// Unit tests for plan 90-05 (vergabevorschlag.js + vergabevorschlagPdf.js): ranking of complete offers
// only, cost comparison against the LV estimate or a gross cost calculation, the positions that carry the
// justification, suggested text blocks with open items instead of legal conclusions, warnings, the record
// for the tender, the contract LV, and both PDF drafts (page count, text, "ENTWURF", no signature).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { Buffer } from "node:buffer";

import { vergabeModell, vorschlagDatensatz, auftragsLv, euro, prozent, VERFAHREN } from "@ava/lib/vergabevorschlag";
import { vergabevorschlagPdf, auftragsLvPdf } from "@ava/lib/vergabevorschlagPdf";

const LV = [
  { id: "p1", oz: "01.01.0010", title: "Oberboden abtragen", quantity: 120, unit: "m²", unit_price: 5 },
  { id: "p2", oz: "01.01.0020", title: "Baugrube ausheben", quantity: 850, unit: "m³", unit_price: 14 },
  { id: "p3", oz: "01.01.0030", title: "Verfüllen", quantity: 300, unit: "m³", unit_price: 9 },
]; // estimate 600 + 11 900 + 2 700 = 15 200
const T = { id: "t1", name: "Erdarbeiten", trade: "Erdarbeiten", invited_contact_ids: ["a", "b", "c", "d"] };
const bid = (id, preise, extra = {}) => ({ id, tender_id: "t1", bidder_name: id, ...extra,
  line_items: Object.entries(preise).map(([position_id, unit_price]) => ({ position_id, unit_price })) });
const B = bid("Beta Bau", { p1: 4.5, p2: 12.8, p3: 7.9 });   // 13 790
const C = bid("Gamma Bau", { p1: 5, p2: 13, p3: 8.4 });      // 14 170
const A = bid("Alpha Bau", { p1: 4 });                        // incomplete
const PROJ = { name: "Testhaus", client: "Bauherr Muster", location: { city: "Musterstadt" } };
const JETZT = new Date("2026-10-11T10:00:00Z");

describe("vergabeModell", () => {
  it("ranks only complete offers, incomplete ones listed as not evaluated", () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [A, C, B], projekt: PROJ, jetzt: JETZT });
    assert.deepEqual(m.bieter.map((b) => [b.name, b.rang]), [["Beta Bau", 1], ["Gamma Bau", 2], ["Alpha Bau", null]]);
    assert.equal(m.kopf.gewertet, 2);
    assert.equal(m.kopf.eingeladen, 4);
    assert.equal(m.kopf.eingegangen, 3);
    assert.equal(m.vorschlag?.name, "Beta Bau");
    assert.equal(m.vorschlag?.netto, 13790);
    assert.equal(m.vorschlag?.brutto, 16410.1);
    assert.equal(m.bieter[1].zum_guenstigsten, Math.round((14170 - 13790) / 13790 * 10000) / 10000);
    assert.equal(m.kopf.verfahren, VERFAHREN[1]);
  });

  it("cost comparison: LV estimate by default, a gross cost calculation converts to net", () => {
    const lv = vergabeModell({ tender: T, positionen: LV, bids: [B], jetzt: JETZT });
    assert.equal(lv.anschlag.quelle, "lv");
    assert.equal(lv.anschlag.netto, 15200);
    assert.equal(lv.vorschlag?.diff_anschlag, -1410);
    const kb = vergabeModell({ tender: T, positionen: LV, bids: [B], eingaben: { kostenberechnung_brutto: 17850 }, jetzt: JETZT });
    assert.equal(kb.anschlag.quelle, "kostenberechnung");
    assert.equal(kb.anschlag.netto, 15000);
  });

  it("positions carrying the justification: largest GP difference first, max. 3", () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [B], jetzt: JETZT });
    assert.deepEqual(m.positionsvergleich.map((p) => [p.oz, p.diff_gp]), [["01.01.0020", -1020], ["01.01.0030", -330], ["01.01.0010", -60]]);
  });

  it("text blocks: legal conclusions stay open items, warnings named", () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [A, B, C], jetzt: JETZT });
    const ids = m.bausteine.map((b) => b.id);
    assert.ok(ids.includes("wirtschaftlich") && ids.includes("nicht_gewertet") && ids.includes("empfehlung"));
    assert.match(m.bausteine.find((b) => b.id === "nicht_gewertet")?.text || "", /§ 16a VOB\/A geprüft: ______/);
    assert.match(m.bausteine.find((b) => b.id === "anschlag")?.text || "", /9,3 % unter dem Kostenanschlag/);
    assert.match(m.bausteine.find((b) => b.id === "geprueft")?.text || "", /______/);
    assert.ok(m.warnungen.includes("nicht_geprueft"));
    assert.ok(!m.warnungen.includes("aufklaerung"));
    // Pre-ticked: "geprueft" only with a Prüfvermerk.
    assert.equal(m.bausteine.find((b) => b.id === "geprueft")?.vorgeschlagen, false);
    assert.equal(m.begruendung.length, m.bausteine.filter((b) => b.vorgeschlagen).length);
  });

  it("> 20 % below the estimate asks for clarification without stating a result", () => {
    const billig = bid("Billig Bau", { p1: 3, p2: 8, p3: 5 }); // 8 660 = -43 %
    const m = vergabeModell({ tender: T, positionen: LV, bids: [billig], jetzt: JETZT });
    assert.ok(m.warnungen.includes("aufklaerung") && m.warnungen.includes("einziges_angebot"));
    const t = m.bausteine.find((b) => b.id === "aufklaerung")?.text || "";
    assert.match(t, /Ergebnis: ______/);
    assert.doesNotMatch(t, /liegt nicht vor/);
  });

  it("choosing a non-cheapest bidder adds a block that demands a reason; Prüfvermerk is used", () => {
    const Cg = { ...C, pruefung: { datum: "2026-10-10T09:00:00Z", pruefer: "M. Muster", summe_geprueft: 14170, befunde: 0 } };
    const m = vergabeModell({ tender: T, positionen: LV, bids: [B, Cg], eingaben: { bid_id: Cg.id }, jetzt: JETZT });
    assert.equal(m.vorschlag?.rang, 2);
    assert.ok(m.warnungen.includes("nicht_guenstigstes"));
    assert.match(m.bausteine.find((b) => b.id === "nicht_guenstigstes")?.text || "", /Begründung: ______/);
    assert.match(m.bausteine.find((b) => b.id === "geprueft")?.text || "", /10\.10\.2026 von M\. Muster.*ohne Befund/);
    // An explicit selection replaces the defaults, free text is appended.
    const m2 = vergabeModell({ tender: T, positionen: LV, bids: [B], eingaben: { bausteine: ["empfehlung"], freitext: " Termin halten. " }, jetzt: JETZT });
    assert.equal(m2.begruendung.length, 2);
    assert.equal(m2.begruendung[1], "Termin halten.");
  });

  it("no complete offer → no proposal, no blocks", () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [A], jetzt: JETZT });
    assert.equal(m.vorschlag, null);
    assert.deepEqual(m.bausteine, []);
    assert.ok(m.warnungen.includes("kein_vollstaendiges"));
    assert.equal(vorschlagDatensatz(m), null);
  });

  it("record for the tender and the contract LV", () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [B], jetzt: JETZT });
    const d = vorschlagDatensatz(m, { jetzt: JETZT, bausteine: ["empfehlung"], freitext: "x" });
    assert.equal(d?.bieter, "Beta Bau");
    assert.equal(d?.netto, 13790);
    assert.equal(d?.datum, "2026-10-11T10:00:00.000Z");
    const lv = auftragsLv(LV, B, 0.19);
    assert.equal(lv.netto, 13790);
    assert.equal(lv.mwst, 2620.1);
    assert.deepEqual(lv.zeilen.map((z) => z.gp), [540, 10880, 2370]);
  });

  it("German number formatting", () => {
    assert.equal(euro(13790), "13.790,00 €");
    assert.equal(prozent(-0.0928), "-9,3 %");
    assert.equal(euro(null), "—");
  });
});

/** Text of an uncompressed jsPDF output (text operators are plain in the stream). */
const pdfText = (bytes) => Buffer.from(bytes).toString("latin1");

describe("PDF drafts", () => {
  it("award proposal: draft mark, ranking, proposal, open items, no signature image", async () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [A, B, C], projekt: PROJ, jetzt: JETZT });
    const { bytes, dateiname } = await vergabevorschlagPdf(m);
    assert.match(dateiname, /^Vergabevorschlag_Erdarbeiten_Beta_Bau_Entwurf\.pdf$/);
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1);
    const txt = pdfText(bytes);
    for (const s of ["Vergabevorschlag", "ENTWURF", "Beta Bau", "Gamma Bau", "nicht gewertet", "13.790,00", "Offene Punkte", "Bauherr Muster"]) assert.ok(txt.includes(s), `fehlt: ${s}`);
    assert.ok(!/\/Subtype\s*\/Image/.test(txt), "keine Bilder (keine Unterschrift/Stempel)");
  });

  it("contract LV: every position, net/VAT/gross; long LV breaks pages", async () => {
    const m = vergabeModell({ tender: T, positionen: LV, bids: [B], projekt: PROJ, jetzt: JETZT });
    const { bytes } = await auftragsLvPdf(m, auftragsLv(LV, B, 0.19));
    const txt = pdfText(bytes);
    for (const s of ["Auftrags-Leistungsverzeichnis", "01.01.0020", "10.880,00", "Summe netto", "2.620,10", "16.410,10"]) assert.ok(txt.includes(s), `fehlt: ${s}`);
    const viele = Array.from({ length: 120 }, (_, i) => ({ id: `q${i}`, oz: `01.${String(i).padStart(4, "0")}`, title: `Position ${i}`, quantity: 1, unit: "St", unit_price: 10 }));
    const bv = bid("Viel Bau", Object.fromEntries(viele.map((p) => [p.id, 9])));
    const mv = vergabeModell({ tender: T, positionen: viele, bids: [bv], jetzt: JETZT });
    const gross = await auftragsLvPdf(mv, auftragsLv(viele, bv, 0.19));
    assert.ok((await PDFDocument.load(gross.bytes)).getPageCount() >= 3);
  });
});
