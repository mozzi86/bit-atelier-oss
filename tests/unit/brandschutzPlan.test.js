// Unit-Tests für packages/nova-designer/src/lib/brandschutzPlan.js (Phase 38, BSP-02…04).
// Kulisse: Default-Footprint 20 × 14 m = 280 m²; Melder 40 m² → s = 6,32 m → Raster 3 × 2 = 6 Punkte
// (melderAnzahl(280, 40) = 7 — Rasterrundung ±, im Band). Brandabschnitt 50 × 40 m = 2.000 m² > 1.600.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { melderAnzahl } from "@designer/lib/fire";
import {
  SYMBOLE_DIN14034, SYMBOL_KEYS, SYMBOL_KATALOG, BRANDABSCHNITT_MAX_M2, LAYER_DEFAULT, PLAN_FARBEN,
  layerHardened, neuerAbschnitt, neuesSymbol, verschiebeSymbol, loescheElement, setzeMelder,
  brandabschnittFlaeche, melderRaster, symbolLegende, brandschutzPlanChecks,
} from "@designer/lib/brandschutzPlan";

const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const FOOT = rect(-10, -7, 10, 7); // 280 m²
const erlaubt = (items) => items.every((i) => ["pass", "warn", "offen"].includes(i.status));

describe("brandschutzPlan — Katalog", () => {
  it("sieben Symboltypen mit Farbe, Kürzel, Form, Norm-Hinweis [ASSUMED]; KatalogPanel-Form", () => {
    assert.deepEqual(SYMBOL_KEYS, ["bmz", "rauchmelder", "feuerloescher", "wandhydrant", "steigleitung", "sammelstelle", "feuerwehrzugang"]);
    for (const s of Object.values(SYMBOLE_DIN14034)) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(s.farbe) && s.kurz && ["quadrat", "kreis", "pfeil"].includes(s.form) && s.groesseM > 0);
      assert.match(s.norm, /ASSUMED/);
    }
    assert.equal(SYMBOLE_DIN14034.sammelstelle.farbe, "#16a34a", "Rettungszeichen grün");
    assert.equal(SYMBOL_KATALOG.length, 1);
    assert.equal(SYMBOL_KATALOG[0].typen.length, 7);
    assert.equal(SYMBOL_KATALOG[0].typen[2].name, "Feuerlöscher");
    assert.equal(BRANDABSCHNITT_MAX_M2, 1600);
    assert.ok(PLAN_FARBEN.brandabschnitt && PLAN_FARBEN.melder);
  });
});

describe("brandschutzPlan — Härtung und Editor", () => {
  it("layerHardened: Defaults, Punktfilter, unbekannte Symbole weg, Fluchtwege bleiben kompatibel", () => {
    assert.deepEqual(layerHardened(null), LAYER_DEFAULT);
    assert.deepEqual(layerHardened({ fluchtwege: [{ id: "fw_1", level: 0, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }] }).fluchtwege,
      [{ id: "fw_1", level: 0, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }], "Bestand aus Phase 34 unverändert");
    const h = layerHardened({
      fluchtwege: [{ id: "fw_2", level: 1, points: [{ x: 0, z: 0 }] }],                                   // < 2 Punkte
      brandabschnitte: [{ id: "ba_1", level: 0, points: rect(0, 0, 4, 4) }, { level: 0, points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] }],
      symbole: [{ id: "sy_1", level: 0, typ: "feuerloescher", x: 1, z: 1 }, { typ: "einhorn", x: 1, z: 1 }, { typ: "bmz", x: "a", z: 1 }],
      melder: { aktiv: 1, flaecheJeMelder: -3 },
    });
    assert.equal(h.fluchtwege.length, 0);
    assert.equal(h.brandabschnitte.length, 1);
    assert.equal(h.brandabschnitte[0].name, "");
    assert.deepEqual(h.symbole, [{ id: "sy_1", level: 0, typ: "feuerloescher", x: 1, z: 1 }]);
    assert.deepEqual(h.melder, { aktiv: true, flaecheJeMelder: null });
  });

  it("neuerAbschnitt / neuesSymbol vergeben Ids und Namen; ungültige Eingaben ändern nichts", () => {
    const a = neuerAbschnitt(LAYER_DEFAULT, { level: 0, points: rect(0, 0, 10, 8) });
    assert.equal(a.abschnitt.id, "ba_1");
    assert.equal(a.abschnitt.name, "Brandabschnitt 1");
    const b = neuerAbschnitt(a.layer, { level: 1, points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] });
    assert.equal(b.abschnitt, null);
    assert.equal(b.layer.brandabschnitte.length, 1);
    const s = neuesSymbol(a.layer, { level: 0, typ: "bmz", x: 2, z: 3 });
    assert.deepEqual(s.symbol, { id: "sy_1", level: 0, typ: "bmz", x: 2, z: 3 });
    assert.equal(neuesSymbol(s.layer, { level: 0, typ: "gibtsnicht", x: 0, z: 0 }).symbol, null);
    const s2 = neuesSymbol(s.layer, { level: 0, typ: "feuerloescher", x: 4, z: 3 });
    assert.equal(s2.symbol.id, "sy_2");
  });

  it("verschiebeSymbol, loescheElement, setzeMelder", () => {
    const { layer } = neuesSymbol(LAYER_DEFAULT, { level: 0, typ: "bmz", x: 2, z: 3 });
    const v = verschiebeSymbol(layer, "sy_1", { x: 5.25, z: -1 });
    assert.deepEqual([v.symbole[0].x, v.symbole[0].z], [5.25, -1]);
    assert.equal(verschiebeSymbol(layer, "sy_1", null).symbole[0].x, 2, "ungültiger Punkt → unverändert");
    assert.equal(loescheElement(v, "symbol", "sy_1").symbole.length, 0);
    const mitWeg = layerHardened({ ...v, fluchtwege: [{ id: "fw_1", level: 0, points: [{ x: 0, z: 0 }, { x: 3, z: 0 }] }] });
    assert.equal(loescheElement(mitWeg, "fluchtweg", "fw_1").fluchtwege.length, 0);
    assert.equal(loescheElement(mitWeg, "quatsch", "fw_1").fluchtwege.length, 1);
    const m = setzeMelder(LAYER_DEFAULT, { aktiv: true, flaecheJeMelder: 30 });
    assert.deepEqual(m.melder, { aktiv: true, flaecheJeMelder: 30 });
    assert.deepEqual(setzeMelder(m, { flaecheJeMelder: 0 }).melder, { aktiv: true, flaecheJeMelder: null });
  });
});

describe("brandschutzPlan — Flächen und Melder-Raster", () => {
  it("brandabschnittFlaeche: 50 × 40 = 2.000 m²; leer → 0", () => {
    assert.equal(brandabschnittFlaeche(rect(0, 0, 50, 40)), 2000);
    assert.equal(brandabschnittFlaeche([]), 0);
    assert.equal(brandabschnittFlaeche(null), 0);
  });

  it("melderRaster: 20 × 14 m bei 40 m² → 3 × 2 Punkte in Zellenmitten, alle im Footprint, nahe melderAnzahl", () => {
    const pts = melderRaster(FOOT, 40);
    assert.equal(pts.length, 6);
    assert.deepEqual(pts[0], { x: -6.67, z: -3.5 });
    assert.ok(pts.every((p) => p.x > -10 && p.x < 10 && p.z > -7 && p.z < 7));
    const soll = melderAnzahl(280, 40); // 7
    assert.ok(Math.abs(pts.length - soll) / soll <= 0.3, `${pts.length} vs ${soll}`);
  });

  it("melderRaster: L-Footprint lässt den Ausschnitt frei; ungültig → []", () => {
    const L = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 6 }, { x: 8, z: 6 }, { x: 8, z: 14 }, { x: 0, z: 14 }];
    const pts = melderRaster(L, 16); // s = 4 m
    assert.ok(pts.length > 0);
    assert.ok(pts.every((p) => !(p.x > 8 && p.z > 6)), "kein Melder im Ausschnitt");
    assert.deepEqual(melderRaster(FOOT, 0), []);
    assert.deepEqual(melderRaster([{ x: 0, z: 0 }], 40), []);
    assert.deepEqual(melderRaster(null, 40), []);
  });
});

describe("brandschutzPlan — Legende und Checks", () => {
  const layer = layerHardened({
    fluchtwege: [{ id: "fw_1", level: 0, points: [{ x: -9, z: -6 }, { x: 9, z: -6 }, { x: 9, z: 6 }] }], // 18 + 12 = 30 m
    brandabschnitte: [{ id: "ba_1", level: 0, name: "West", points: rect(-10, -7, 0, 7) }],             // 140 m²
    symbole: [
      { id: "sy_1", level: 0, typ: "feuerloescher", x: 1, z: 1 }, { id: "sy_2", level: 0, typ: "feuerloescher", x: 4, z: 1 },
      { id: "sy_3", level: 0, typ: "bmz", x: -8, z: -6 }, { id: "sy_4", level: 1, typ: "sammelstelle", x: 0, z: 0 },
    ],
    melder: { aktiv: true, flaecheJeMelder: null },
  });

  it("symbolLegende zählt nur verwendete Typen des Geschosses in Katalogreihenfolge", () => {
    assert.deepEqual(symbolLegende(layer, 0).map((l) => [l.typ, l.anzahl]), [["bmz", 1], ["feuerloescher", 2]]);
    assert.deepEqual(symbolLegende(layer, 1).map((l) => l.typ), ["sammelstelle"]);
    assert.deepEqual(symbolLegende(LAYER_DEFAULT, 0), []);
  });

  it("Checks: Beispiel → pass/pass/pass/pass/pass(Sammelstelle)/pass(Melder); nie fail", () => {
    const items = brandschutzPlanChecks(layer, { footprint: FOOT, level: 0, maxFluchtweg: 35, flaecheJeMelder: 40 });
    assert.ok(erlaubt(items));
    const st = Object.fromEntries(items.map((i) => [i.key, i.status]));
    assert.deepEqual(st, { fluchtwege: "pass", abschnitt_groesse: "pass", abschnitt_noetig: "pass", symbole: "pass", sammelstelle: "pass", melder: "pass" });
    assert.match(items.find((i) => i.key === "melder").detail, /7 Melder/);
  });

  it("Checks: zu langer Weg warn, Riesenabschnitt warn, Footprint > 1.600 ohne Abschnitt warn, leer → offen", () => {
    const zuLang = brandschutzPlanChecks(layer, { footprint: FOOT, level: 0, maxFluchtweg: 20 });
    assert.equal(zuLang.find((i) => i.key === "fluchtwege").status, "warn");
    const gross = brandschutzPlanChecks(layerHardened({ brandabschnitte: [{ id: "ba_1", level: 0, points: rect(0, 0, 50, 40) }] }), { footprint: rect(0, 0, 50, 40), level: 0 });
    assert.equal(gross.find((i) => i.key === "abschnitt_groesse").status, "warn");
    assert.equal(gross.find((i) => i.key === "abschnitt_noetig").status, "pass", "geteilt (wenn auch zu groß)");
    const ohne = brandschutzPlanChecks(LAYER_DEFAULT, { footprint: rect(0, 0, 50, 40), level: 0 });
    assert.equal(ohne.find((i) => i.key === "abschnitt_noetig").status, "warn");
    const leer = brandschutzPlanChecks(LAYER_DEFAULT, { footprint: FOOT, level: 0 });
    assert.deepEqual([...new Set(leer.map((i) => i.status))].sort(), ["offen", "pass"], "280 m² braucht keine Teilung → pass, Rest offen");
    assert.ok(!JSON.stringify(leer).includes('"fail"'));
    assert.equal(brandschutzPlanChecks(LAYER_DEFAULT, {}).find((i) => i.key === "abschnitt_noetig").status, "offen", "ohne Footprint offen");
  });
});
