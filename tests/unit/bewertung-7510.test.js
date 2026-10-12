// 75-10: variant evaluation — generic composite score (normalisation, directions, knock-outs,
// missing values, weights) and the building dimensions after D-P75-10-A…D (hard rules only,
// equal office weights, grey energy [ASSUMED] at weight 0, no soft criteria).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compositeScore, gewichteNormieren } from "@core/lib/compositeScore";
import {
  DIMENSIONEN, BUERO_STANDARD, GRAUE_ENERGIE, bewertungsWerte, bewerteVarianten, wirksameGewichte,
} from "@designer/lib/variantenBewertung";
import { erzeugeVorschlaege, kartenDaten } from "@designer/lib/bebauungsvorschlaege";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { FOOTPRINTS } from "../e2e/fixtures/footprints.js";

const DIMS = [{ key: "a", richtung: "hoch" }, { key: "b", richtung: "niedrig" }];

describe("75-10 — compositeScore (@core)", () => {
  it("min–max je Dimension, Richtung beachtet, gewichtetes Mittel, Rang", () => {
    const r = compositeScore([
      { id: "x", werte: { a: 10, b: 5 } },
      { id: "y", werte: { a: 20, b: 1 } },
      { id: "z", werte: { a: 15, b: 3 } },
    ], DIMS, { a: 1, b: 1 });
    const y = r.ergebnisse.find((e) => e.id === "y");
    assert.deepEqual(r.reihenfolge, ["y", "z", "x"]);
    assert.equal(y.score, 1);
    assert.equal(y.rang, 1);
    assert.deepEqual(r.ergebnisse.find((e) => e.id === "z").normiert, { a: 0.5, b: 0.5 });
    assert.ok(Math.abs(r.ergebnisse.find((e) => e.id === "z").beitraege.a - 0.25) < 1e-9);
  });

  it("K.-o. wird ausgeschlossen (kein Score, kein Rang, ans Ende), fehlender Wert = 0 + benannt", () => {
    const r = compositeScore([
      { id: "a", werte: { a: 100, b: 0 }, ko: ["Planungsfehler"] },
      { id: "b", werte: { a: 1, b: null } },
      { id: "c", werte: { a: 2, b: 4 } },
    ], DIMS, { a: 1, b: 1 });
    const a = r.ergebnisse.find((e) => e.id === "a"), b = r.ergebnisse.find((e) => e.id === "b");
    assert.equal(a.score, null);
    assert.equal(a.rang, null);
    assert.equal(r.reihenfolge[r.reihenfolge.length - 1], "a");
    assert.deepEqual(b.fehlend, ["b"]);
    assert.equal(b.normiert.b, 0);
    // The knocked-out a=100 does not stretch the scale: c has the best a among the valid ones.
    assert.equal(r.ergebnisse.find((e) => e.id === "c").normiert.a, 1);
  });

  it("Gleichstand → nach Id; alle gleich → 1; Gewichte 0 → kein Score; Gewichte normiert", () => {
    const r = compositeScore([{ id: "b", werte: { a: 1, b: 1 } }, { id: "a", werte: { a: 1, b: 1 } }], DIMS, { a: 2, b: 2 });
    assert.deepEqual(r.reihenfolge, ["a", "b"]);
    assert.equal(r.ergebnisse[0].score, 1);
    assert.equal(compositeScore([{ id: "a", werte: { a: 1, b: 1 } }], DIMS, { a: 0, b: 0 }).ergebnisse[0].score, null);
    assert.deepEqual(gewichteNormieren(DIMS, { a: 3, b: 1, c: 9 }), { a: 0.75, b: 0.25 });
    assert.deepEqual(gewichteNormieren(DIMS, { a: -1, b: "x" }), { a: 0, b: 0 });
  });
});

describe("75-10 — variantenBewertung", () => {
  const karte = (o = {}) => ({
    id: "k", riegelUmrisse: [], rechteckUmriss: null, hatFails: false,
    kennzahlen: { bgf_m2: { wert: 4480 }, wohnflaeche_m2: { wert: 3500 }, fassade_je_we_m: { wert: 7.5 }, effizienz: { wert: 0.78 }, fails: { wert: 0 }, rettungsweg_max_m: { wert: null }, ...o },
  });
  const RECHTECK = [{ x: 0, z: 0 }, { x: 70, z: 0 }, { x: 70, z: 16 }, { x: 0, z: 16 }];

  it("Bürostandard: vier Dimensionen gleich, graue Energie 0 (D-P75-10-B/C); keine weichen Kriterien", () => {
    assert.deepEqual(BUERO_STANDARD, { av: 1, versiegelung: 1, belichtung: 1, effizienz: 1, graueEnergie: 0 });
    assert.equal(DIMENSIONEN.length, 5);
    assert.ok(DIMENSIONEN.every((d) => d.quelle && d.einheit));
    assert.deepEqual(wirksameGewichte({ av: 3, unbekannt: 5, belichtung: -1 }), { ...BUERO_STANDARD, av: 3 });
  });

  it("Werte: A/V, Versiegelung, Belichtung, Effizienz, graue Energie mit nachvollziehbarer Rechnung", () => {
    const { werte, ko } = bewertungsWerte(karte(), { footprintM: RECHTECK, storeys: 4, storeyHeight_m: 3 });
    // belegt 1120 m², H 12 m, Umfang 172 m → A = 172·12 + 2·1120 = 4304 m², V = 13 440 m³.
    assert.equal(werte.av, Math.round((4304 / 13440) * 1e4) / 1e4);
    assert.equal(werte.versiegelung, Math.round((1120 / 3500) * 1e4) / 1e4);
    assert.equal(werte.belichtung, 7.5);
    assert.equal(werte.effizienz, 0.78);
    const g = (4480 * GRAUE_ENERGIE.bgf_kg_m2 + 2064 * GRAUE_ENERGIE.aussenwand_kg_m2 + 1120 * GRAUE_ENERGIE.dach_kg_m2) / 3500;
    assert.equal(werte.graueEnergie, Math.round(g * 10) / 10);
    assert.deepEqual(ko, []);
  });

  it("K.-o. nur aus harten Regeln: Fails, Rettungsweg > 35 m; Warnungen schließen nicht aus", () => {
    assert.match(bewertungsWerte(karte({ fails: { wert: 2 } }), {}).ko[0], /Planungsfehler \(2 fail\)/);
    assert.match(bewertungsWerte(karte({ rettungsweg_max_m: { wert: 41.2 } }), {}).ko[0], /Rettungsweg 41,2 m > 35 m/);
    assert.deepEqual(bewertungsWerte(karte({ warns: { wert: 30 } }), {}).ko, []);
  });

  it("echte Vorschläge (L): deterministische Rangfolge; ein anderer Regler sortiert um, ohne Werte zu ändern", () => {
    const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
    const karten = erzeugeVorschlaege(FOOTPRINTS.L.footprintM, { storeys: 4, einheiten: STD, raumzonen: true, regeln: {}, nordwinkel: 0, okf_m: 9 }).map(kartenDaten);
    const ctx = { footprintM: FOOTPRINTS.L.footprintM, storeys: 4, storeyHeight_m: 3 };
    const a = bewerteVarianten(karten, ctx, null);
    assert.deepEqual(a, bewerteVarianten(karten, ctx, null));
    assert.ok(a.ergebnisse.every((e) => e.ko.length || (e.score !== null && e.rang !== null)));
    const nurAV = bewerteVarianten(karten, ctx, { av: 1, versiegelung: 0, belichtung: 0, effizienz: 0 });
    const nurEff = bewerteVarianten(karten, ctx, { av: 0, versiegelung: 0, belichtung: 0, effizienz: 1 });
    assert.notDeepEqual(nurAV.reihenfolge, nurEff.reihenfolge);
    assert.deepEqual(nurAV.ergebnisse.map((e) => e.werte), nurEff.ergebnisse.map((e) => e.werte));
  });
});
