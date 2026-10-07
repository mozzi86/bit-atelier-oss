// Unit-Tests für die manuelle Anordnung in tesseliere (Phase 61-07, Rest aus 42):
// Band-Reihenfolge (anordnung) und verschobene Grenzen (grenzenPositionen).
//
// Referenz: Footprint 30 × 14 m, Typ "mittelflur" (Bandlänge 30 m ≈ Σ Zielbreiten 29,5 m → Einheiten nahe Ziel, Spielraum nach beiden Seiten) (zwei Bänder süd/nord je Geschoss),
// 1 Geschoss, drei Einheiten A (60 m², min 50, max 70), B (80, 70/90), C (40, 35/45).
// Katalogreihenfolge A, B, C → im Band von links: A | B | C.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ordneEinheiten, tesseliere } from "@designer/lib/tesselierung";

const FOOTPRINT = [{ x: -15, z: -7 }, { x: 15, z: -7 }, { x: 15, z: 7 }, { x: -15, z: 7 }];
// Bandtiefe aus einem Eintrag ableiten (Fläche ÷ Fassadenlänge) — kein internes Feld.
const tiefeVon = (w) => w.flaeche_m2 / w.fassadeLaenge_m;
const E = [
  { key: "A", name: "A", flaeche_m2: 60, min_m2: 50, max_m2: 70 },
  { key: "B", name: "B", flaeche_m2: 80, min_m2: 70, max_m2: 90 },
  { key: "C", name: "C", flaeche_m2: 40, min_m2: 35, max_m2: 45 },
];
const base = (extra = {}) => tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: E, ...extra });
const bandOrder = (r, band) => r.weListe.filter((w) => w.level === 0 && w.band === band).sort((a, b) => a._a - b._a).map((w) => w.typKey);
const grenze = (r, id) => r.grenzen.find((g) => g.id === id);

describe("ordneEinheiten", () => {
  it("Permutation: genannte Keys zuerst, Rest in Katalogreihenfolge, Unbekanntes ignoriert, Dubletten einmal", () => {
    assert.deepEqual(ordneEinheiten(E, ["C", "A"]).map((e) => e.key), ["C", "A", "B"]);
    assert.deepEqual(ordneEinheiten(E, ["X", "B", "B"]).map((e) => e.key), ["B", "A", "C"]);
    assert.deepEqual(ordneEinheiten(E, null).map((e) => e.key), ["A", "B", "C"]);
    assert.deepEqual(ordneEinheiten(E, []).map((e) => e.key), ["A", "B", "C"]);
  });
});

describe("tesseliere — anordnung je Band", () => {
  const ohne = base();
  it("Default: beide Bänder in Katalogreihenfolge A, B, C; keine Hinweise", () => {
    assert.deepEqual(bandOrder(ohne, 0), ["A", "B", "C"]);
    assert.deepEqual(bandOrder(ohne, 1), ["A", "B", "C"]);
    assert.deepEqual(ohne.hinweise, []);
  });
  it("Tausch nur im Band L0-B0: dort C, B, A — Band 1 bleibt A, B, C", () => {
    const r = base({ anordnung: { "L0-B0": ["C", "B", "A"] } });
    assert.deepEqual(bandOrder(r, 0), ["C", "B", "A"]);
    assert.deepEqual(bandOrder(r, 1), ["A", "B", "C"]);
    // Breiten folgen der Einheit, nicht der Position: C ist überall gleich breit.
    const cOhne = ohne.weListe.find((w) => w.band === 0 && w.typKey === "C");
    const cMit = r.weListe.find((w) => w.band === 0 && w.typKey === "C");
    assert.equal(Math.round(cMit.fassadeLaenge_m * 1e6), Math.round(cOhne.fassadeLaenge_m * 1e6));
    // Grenzen tragen die neuen Nachbarn (Namen der WEs sind positionsbezogen).
    assert.equal(grenze(r, "L0-B0-G1").we_links, "WE 0-1");
    // Zonen bleiben lückenlos: Summe der Bandbreiten unverändert.
    const summe = (x) => x.weListe.filter((w) => w.band === 0).reduce((s, w) => s + w.fassadeLaenge_m, 0);
    assert.equal(Math.round(summe(r) * 1000), Math.round(summe(ohne) * 1000));
  });
  it("unbekannter Band-Key und unbekannte Einheiten-Keys ändern nichts", () => {
    const r = base({ anordnung: { "L7-B3": ["C"], "L0-B0": ["X", "Y"] } });
    assert.deepEqual(bandOrder(r, 0), ["A", "B", "C"]);
  });
  it("deterministisch", () => {
    const a = base({ anordnung: { "L0-B1": ["B", "C", "A"] } });
    const b = base({ anordnung: { "L0-B1": ["B", "C", "A"] } });
    assert.deepEqual(a.zonen, b.zonen);
  });
});

describe("tesseliere — grenzenPositionen (Grenze ziehen, Knautschzonen respektierend)", () => {
  const ohne = base();
  const g1 = grenze(ohne, "L0-B0-G1"); // zwischen A und B
  it("Wunsch innerhalb der Knautschzone landet exakt dort; Nachbar rechts endet wie zuvor", () => {
    const wunsch = g1.pos_m + 0.5;
    const r = base({ grenzenPositionen: { "L0-B0-G1": wunsch } });
    const g = grenze(r, "L0-B0-G1");
    assert.equal(Math.round(g.pos_m * 1000), Math.round(wunsch * 1000));
    assert.equal(g.verschoben, true); assert.equal(g.gesperrt, true); assert.equal(g.delta_m, 0);
    assert.equal(g.pos_wunsch_m, wunsch);
    // A wurde 0,5 m breiter, B 0,5 m schmaler, C unverändert.
    const w = (x, k) => x.weListe.find((e) => e.band === 0 && e.typKey === k).fassadeLaenge_m;
    assert.equal(Math.round((w(r, "A") - w(ohne, "A")) * 1000), 500);
    assert.equal(Math.round((w(ohne, "B") - w(r, "B")) * 1000), 500);
    assert.equal(Math.round(w(r, "C") * 1000), Math.round(w(ohne, "C") * 1000));
    assert.deepEqual(r.hinweise, []);
  });
  it("Wunsch weit jenseits der Knautschzone wird auf das Maximum des linken bzw. Minimum des rechten Nachbarn geklemmt", () => {
    const r = base({ grenzenPositionen: { "L0-B0-G1": g1.pos_m + 50 } });
    const g = grenze(r, "L0-B0-G1");
    const a = r.weListe.find((e) => e.band === 0 && e.typKey === "A");
    const b = r.weListe.find((e) => e.band === 0 && e.typKey === "B");
    const tiefe = tiefeVon(a);
    // Geklemmt: entweder A am max (70 m²) oder B am min (70 m²) — je nachdem, was zuerst greift.
    const aMax = 70 / tiefe, bMin = 70 / tiefe;
    const aAmMax = Math.abs(a.fassadeLaenge_m - aMax) < 1e-6;
    const bAmMin = Math.abs(b.fassadeLaenge_m - bMin) < 1e-6;
    assert.ok(aAmMax || bAmMin, `A ${a.fassadeLaenge_m} (max ${aMax}), B ${b.fassadeLaenge_m} (min ${bMin})`);
    assert.ok(g.pos_m < g1.pos_m + 50);
    assert.equal(g.verschoben, true);
  });
  it("Wunsch in die andere Richtung: A wird schmaler bis min, nie darunter", () => {
    const r = base({ grenzenPositionen: { "L0-B0-G1": g1.pos_m - 50 } });
    const a = r.weListe.find((e) => e.band === 0 && e.typKey === "A");
    assert.ok(a.fassadeLaenge_m + 1e-6 >= 50 / tiefeVon(a), "A unter min");
  });
  it("Sperre und Verschiebung zusammen: gesperrte G2 bleibt auf Pass-1-Position, G1 folgt dem Wunsch", () => {
    const g2 = grenze(ohne, "L0-B0-G2");
    const r = base({ gesperrteGrenzen: ["L0-B0-G2"], grenzenPositionen: { "L0-B0-G1": g1.pos_m + 0.3 } });
    assert.equal(Math.round(grenze(r, "L0-B0-G2").pos_m * 1000), Math.round(g2.pos_m * 1000));
    assert.equal(Math.round(grenze(r, "L0-B0-G1").pos_m * 1000), Math.round((g1.pos_m + 0.3) * 1000));
  });
  it("Ungültiger Wunsch (kein Zahlwert) wird ignoriert", () => {
    const r = base({ grenzenPositionen: { "L0-B0-G1": "abc" } });
    assert.equal(grenze(r, "L0-B0-G1").verschoben, false);
    assert.equal(Math.round(grenze(r, "L0-B0-G1").pos_m * 1000), Math.round(g1.pos_m * 1000));
  });
});
