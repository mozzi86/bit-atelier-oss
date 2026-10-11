// Unit tests for plan 90-10 (kostenJeKg.js + budgetAntragPdf.js): rows per DIN 276 KG (budget = LV
// estimate, award from the awarded bid, prognosis = award + estimate of the open positions, billed from
// measurements), positions without KG stay "ohne KG", the Excel export models (sum row, percent values,
// change orders as their own total), a valid XLSX, the suggested budget request and its PDF draft.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { PDFDocument } from "pdf-lib";

import { kostenJeKg, exportModelle, antragVorschlag } from "@ava/lib/kostenJeKg";
import { budgetAntragPdf } from "@ava/lib/budgetAntragPdf";
import { tabellenAlsXlsx } from "@core/lib/tabellenExport";

const POS = [
  { id: "p1", din276: "330", quantity: 100, unit_price: 50 },  // 5 000, awarded at 60 → 6 000
  { id: "p2", din276: "330", quantity: 10, unit_price: 100 },  // 1 000, open
  { id: "p3", din276: "420", quantity: 1, unit_price: 20000 }, // 20 000, awarded at 18 000
  { id: "p4", quantity: 2, unit_price: 10 },                   // no KG
];
const TENDERS = [
  { id: "t1", status: "awarded", awarded_bid_id: "b1", position_ids: ["p1"] },
  { id: "t2", status: "awarded", awarded_bid_id: "b2", position_ids: ["p3"] },
  { id: "t3", status: "published", position_ids: ["p2"] },
];
const BIDS = [{ id: "b1", line_items: [{ position_id: "p1", unit_price: 60 }] }, { id: "b2", line_items: [{ position_id: "p3", unit_price: 18000 }] }];
const MESS = [{ position_id: "p1", quantity: 40 }];

describe("kostenJeKg", () => {
  it("budget, award, prognosis, deviation and billed per KG; no KG is not guessed", () => {
    const z = kostenJeKg({ positions: POS, tenders: TENDERS, bids: BIDS, measurements: MESS });
    assert.deepEqual(z.map((r) => r.kg), ["330", "420", "ohne KG"]);
    const kg330 = z[0];
    assert.equal(kg330.budget, 6000);
    assert.equal(kg330.vergabe, 6000);
    assert.equal(kg330.offen_anschlag, 1000);
    assert.equal(kg330.prognose, 7000);
    assert.equal(kg330.abweichung, 1000);
    assert.equal(kg330.abweichung_anteil, 0.1667);
    assert.equal(kg330.abgerechnet, 2400);
    assert.equal(kg330.vergeben_anteil, 0.8333);
    assert.equal(z[1].abweichung, -2000);
    assert.equal(z[2].bezeichnung, "Positionen ohne Kostengruppe");
  });

  it("export models: sum row, percent as percent, change orders as their own total; XLSX is a zip", () => {
    const z = kostenJeKg({ positions: POS, tenders: TENDERS, bids: BIDS, measurements: MESS });
    const m = exportModelle(z, [{ title: "NT 1 Mehrmengen", cost_impact: 1500, submission_date: "2026-09-01T00:00:00Z" }]);
    const summe = m[0].zeilen.at(-1);
    assert.equal(summe.bezeichnung, "Summe");
    assert.equal(summe.budget, 26020);
    assert.equal(summe.prognose, 25020);
    assert.equal(m[0].zeilen[0].abweichung_prozent, 16.67);
    assert.equal(m[1].zeilen.at(-1).cost_impact, 1500);
    assert.equal(m[1].zeilen[0].submission_date, "2026-09-01");
    const bytes = tabellenAlsXlsx(m);
    assert.equal(Buffer.from(bytes.slice(0, 2)).toString("latin1"), "PK");
  });

  it("budget request: next 1 000 € above the prognosis, justification names the overrun with an open cause", () => {
    const [kg330] = kostenJeKg({ positions: POS, tenders: TENDERS, bids: BIDS, measurements: MESS });
    const v = antragVorschlag(kg330);
    assert.equal(v.budget_neu, 7000);
    assert.equal(v.erhoehung, 1000);
    assert.match(v.begruendung, /um 1\.000,00 € \(16,7 %\) über dem Budget/);
    assert.match(v.begruendung, /Ursache: ______/);
  });

  it("budget request PDF draft", async () => {
    const [kg330] = kostenJeKg({ positions: POS, tenders: TENDERS, bids: BIDS, measurements: MESS });
    const { bytes, dateiname } = await budgetAntragPdf({ projekt: { name: "Testhaus" }, zeile: kg330, budget_neu: 7000, begruendung: "Mehrmengen", deckung: "Reserve", jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(dateiname, "Budgeterhoehung_KG330_Testhaus_Entwurf.pdf");
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    const txt = Buffer.from(bytes).toString("latin1");
    for (const s of ["Antrag auf Budgeterh", "ENTWURF", "7.000,00", "1.000,00", "Mehrmengen", "Reserve"]) assert.ok(txt.includes(s), `fehlt: ${s}`);
  });
});
