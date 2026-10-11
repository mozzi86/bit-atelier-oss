// Unit tests for plan 90-04 (angebotPruefung.js + @core/lib/pruefvermerk.js): every bid of the Preisspiegel
// is checked deterministically — quantity × EP recomputed with the LV quantities, missing price ≠ 0,
// written 0,00 €, bidder line total and quantity, bidder total vs. recomputed total, outlier unit prices
// against the other bidders (else the cost estimate), the cheapest offer far below the next one; the
// Prüfvermerk snapshot goes outdated when prices change; the stamp lands top-right on the chosen pages.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { angebotPruefen, bidSumme, pruefvermerk, pruefStatus, pruefProtokoll, AUFGREIFSCHWELLE } from "@ava/lib/angebotPruefung";
import { angebotAlsBid, angebotZuordnen } from "@ava/lib/angebotImport";
import { pruefvermerkAufPdf, stempelRechteck } from "@core/lib/pruefvermerk";

const LV = [
  { id: "p1", oz: "01.01.0010", title: "Oberboden abtragen", quantity: 120, unit: "m²", unit_price: 5 },
  { id: "p2", oz: "01.01.0020", title: "Baugrube ausheben", quantity: 850, unit: "m³", unit_price: 12 },
  { id: "p3", oz: "01.01.0030", title: "Verfüllen", quantity: 300, unit: "m³", unit_price: 8 },
];
const bid = (id, preise, extra = {}) => ({
  id, bidder_name: id, ...extra,
  line_items: Object.entries(preise).map(([position_id, v]) => (typeof v === "object" ? { position_id, ...v } : { position_id, unit_price: v })),
});

describe("angebotPruefen", () => {
  it("clean offer: recomputed total with LV quantities, no findings", () => {
    const b = bid("A", { p1: 4.5, p2: 12.8, p3: 7.9 });
    const r = angebotPruefen({ bid: b, positionen: LV });
    assert.equal(r.summe, 120 * 4.5 + 850 * 12.8 + 300 * 7.9);
    assert.equal(r.vollstaendig, true);
    assert.equal(r.befunde, 0);
    assert.equal(r.hinweise, 0);
    assert.equal(r.ergebnis, "ohne_befund");
    assert.deepEqual(r.zeilen.map((z) => z.gp), [540, 10880, 2370]);
  });

  it("missing price is a finding and is NOT counted as 0; a written 0,00 € is a finding of its own", () => {
    const r = angebotPruefen({ bid: bid("A", { p1: 4.5, p3: 0 }), positionen: LV });
    assert.deepEqual(r.zeilen.map((z) => z.codes), [[], ["ohne_preis"], ["nullpreis"]]);
    assert.equal(r.zeilen[1].ep, null);
    assert.equal(r.zeilen[1].gp, null);
    assert.equal(r.vollstaendig, false);
    assert.equal(r.summe, 540);
    assert.equal(r.zaehler.ohne_preis, 1);
    assert.equal(r.zaehler.nullpreis, 1);
    assert.equal(r.ergebnis, "mit_befund");
  });

  it("bidder line total ≠ his quantity × EP and a changed quantity are separate findings", () => {
    const b = bid("A", {
      p1: { unit_price: 4.5, total_price: 540 },              // right
      p2: { unit_price: 12.8, total_price: 10088 },            // digit swap 10880 → 10088
      p3: { unit_price: 7.9, quantity: 280, total_price: 2212 }, // quantity changed, his own arithmetic right
    });
    const r = angebotPruefen({ bid: b, positionen: LV });
    assert.deepEqual(r.zeilen.map((z) => z.codes), [[], ["rechenfehler"], ["menge"]]);
    // The Preisspiegel total always uses the LV quantity.
    assert.equal(r.zeilen[2].gp, 2370);
    assert.equal(r.befunde, 2);
  });

  it("bidder's stated total is compared with the recomputed one (tolerance 0,02 €)", () => {
    const ok = angebotPruefen({ bid: bid("A", { p1: 4.5, p2: 12.8, p3: 7.9 }, { angebotssumme_bieter: 13790.01 }), positionen: LV });
    assert.deepEqual(ok.gesamtCodes, []);
    const falsch = angebotPruefen({ bid: bid("A", { p1: 4.5, p2: 12.8, p3: 7.9 }, { angebotssumme_bieter: 13970 }), positionen: LV });
    assert.deepEqual(falsch.gesamtCodes, ["summe"]);
    assert.equal(falsch.summe_differenz, 180);
  });

  it("outlier: median of ≥ 2 other bidders, else the cost estimate; a hint, not a finding", () => {
    const andere = [bid("B", { p1: 5, p2: 12, p3: 8 }), bid("C", { p1: 5.2, p2: 13, p3: 8.4 })];
    const a = bid("A", { p1: 1.5, p2: 12.5, p3: 8 }); // p1 far below
    const r = angebotPruefen({ bid: a, positionen: LV, andere: [a, ...andere] });
    assert.deepEqual(r.zeilen[0].codes, ["ausreisser"]);
    assert.equal(r.zeilen[0].referenz_quelle, "bieter");
    assert.equal(r.zeilen[0].referenz, 5.1);
    assert.equal(r.befunde, 0);
    assert.equal(r.ergebnis, "ohne_befund");
    // Alone: the cost-estimate EP is the reference.
    const allein = angebotPruefen({ bid: bid("A", { p1: 4.5, p2: 30, p3: 8 }), positionen: LV });
    assert.deepEqual(allein.zeilen[1].codes, ["ausreisser"]);
    assert.equal(allein.zeilen[1].referenz_quelle, "anschlag");
  });

  it("cheapest complete offer far below the next one gets the clarification hint", () => {
    const billig = bid("A", { p1: 3, p2: 8, p3: 5 });   // 8 660
    const mittel = bid("B", { p1: 5, p2: 12, p3: 8 });  // 13 200
    const r = angebotPruefen({ bid: billig, positionen: LV, andere: [billig, mittel] });
    assert.ok(r.abstand > AUFGREIFSCHWELLE);
    assert.deepEqual(r.gesamtCodes, ["niedrig"]);
    assert.equal(r.naechstes, 13200);
    // The more expensive one gets no such hint, and an incomplete offer never counts as "next".
    assert.deepEqual(angebotPruefen({ bid: mittel, positionen: LV, andere: [billig, mittel] }).gesamtCodes, []);
    const unvollst = bid("C", { p1: 5 });
    assert.equal(angebotPruefen({ bid: billig, positionen: LV, andere: [unvollst] }).naechstes, null);
  });

  it("bidSumme skips missing prices and says so", () => {
    assert.deepEqual(bidSumme(bid("A", { p1: 4.5 }), LV), { summe: 540, vollstaendig: false, ohnePreis: 2 });
  });
});

describe("Prüfvermerk", () => {
  it("snapshot is current until the prices change", () => {
    const b = bid("A", { p1: 4.5, p2: 12.8, p3: 7.9 });
    const r = angebotPruefen({ bid: b, positionen: LV });
    assert.equal(pruefStatus(b, r), "keine");
    const v = pruefvermerk({ ergebnis: r, pruefer: " M. Muster ", jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(v.pruefer, "M. Muster");
    assert.equal(v.summe_geprueft, r.summe);
    assert.equal(v.datum, "2026-10-11T10:00:00.000Z");
    const gespeichert = { ...b, pruefung: v };
    assert.equal(pruefStatus(gespeichert, r), "aktuell");
    const geaendert = { ...gespeichert, line_items: [...b.line_items.slice(0, 2), { position_id: "p3", unit_price: 9 }] };
    assert.equal(pruefStatus(geaendert, angebotPruefen({ bid: geaendert, positionen: LV })), "veraltet");
  });

  it("protocol has one row per position plus the total, codes as labels", () => {
    const r = angebotPruefen({ bid: bid("A", { p1: 4.5, p3: 0 }), positionen: LV });
    const { header, rows } = pruefProtokoll(r, (c) => c.toUpperCase());
    assert.equal(header.length, rows[0].length);
    assert.equal(rows.length, LV.length + 1);
    assert.equal(rows[1][9], "OHNE_PREIS");
    assert.equal(rows[1][4], "");
  });
});

describe("GAEB import keeps the bidder's line total and quantity (90-03 → 90-04)", () => {
  it("line items carry total_price/quantity when the offer has them, nothing invented otherwise", () => {
    const z = angebotZuordnen([
      { oz: "01010010", quantity: 120, unit_price: 4.5, total_price: 540 },
      { oz: "01010020", quantity: null, unit_price: 12.8, total_price: null },
    ], LV);
    const b = angebotAlsBid({ tender: { id: "t1" }, zuordnung: z, contact_id: "c1", bieterName: "X", datei: "a.x84" });
    assert.deepEqual(b.line_items, [
      { position_id: "p1", unit_price: 4.5, total_price: 540, quantity: 120 },
      { position_id: "p2", unit_price: 12.8 },
    ]);
  });
});

describe("pruefvermerkAufPdf", () => {
  it("stamps the chosen pages top-right and keeps the page count", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]); doc.addPage([595.28, 841.89]); doc.addPage([841.89, 595.28]);
    const src = await doc.save();
    const zeilen = [{ label: "Bieter", wert: "Musterbau GmbH" }, { label: "Summe nachgerechnet", wert: "13.790,00 € netto" }, { label: "Befunde", wert: "0 / 1 ≠" }];
    const erste = await pruefvermerkAufPdf(src, { titel: "Rechnerisch geprüft", zeilen });
    assert.deepEqual(erste.bericht.seiten, [0]);
    assert.ok(erste.bytes.length > src.length);
    const alle = await pruefvermerkAufPdf(src, { titel: "Geprüft – mit Befund", zeilen, seiten: "alle", warnung: true });
    assert.deepEqual(alle.bericht.seiten, [0, 1, 2]);
    const letzte = await pruefvermerkAufPdf(src, { titel: "x", zeilen, seiten: "letzte" });
    assert.deepEqual(letzte.bericht.seiten, [2]);
    // Landscape A4: stamp 72 mm wide, 10 mm from the right and top edge.
    assert.equal(letzte.bericht.rechteck_mm.w, 72);
    assert.equal(Math.round(letzte.bericht.rechteck_mm.x + 72), 287);
    const neu = await PDFDocument.load(alle.bytes);
    assert.equal(neu.getPageCount(), 3);
  });

  it("stamp rect sits inside the margin, and garbage input fails with a clear message", async () => {
    const r = stempelRechteck({ width: 595.28, height: 841.89 }, 6);
    assert.ok(r.x > 0 && r.y > 0 && r.x + r.w < 595.28 && r.y + r.h < 841.89);
    await assert.rejects(() => pruefvermerkAufPdf(new Uint8Array([1, 2, 3]), { titel: "x", zeilen: [] }), /PDF konnte nicht gelesen werden/);
    await assert.rejects(() => pruefvermerkAufPdf(new Uint8Array(), /** @type {any} */ ({})), /Titel und Zeilen/);
  });
});
