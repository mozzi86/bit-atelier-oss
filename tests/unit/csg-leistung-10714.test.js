// 107-14 task 6 — performance budget of the CSG core (runs on its own: node --test --import ./tests/alias-register.mjs
// tests/unit/csg-leistung-10714.test.js). Inputs by hand:
//   BoxGeometry(4, 2.5, 0.3, 16, 10, 3): quads 2·(16·10) + 2·(16·3) + 2·(10·3) = 320 + 96 + 60 = 476 → 952 triangles
//   BoxGeometry(4, 2.5, 0.3, 60, 40, 3): quads 2·2400 + 2·180 + 2·120 = 5 400 → 10 800 triangles
// Each value is the median of 5 runs after one warm-up run; the test fails only at CSG_BUDGET_FAKTOR × budget (machines
// spread) and prints the measurements (they go into 107-14-SUMMARY.md and the comment of CSG_BUDGET_MS).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  csgLaden, istWasserdicht, volumen_m3, horizontalschnitt, meshKodieren, meshDekodieren, dreieckAnzahl, wandSolid, quaderKoerper,
  CSG_BUDGET_MS, CSG_BUDGET_FAKTOR,
} from "@core/lib/csg/index.js";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";

const kern = await csgLaden();

/** median duration of fn in ms (one warm-up run, then n runs) */
function ms(/** @type {() => any} */ fn, n = 5) {
  fn();
  const t = [];
  for (let i = 0; i < n; i += 1) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(n / 2)];
}
const wand = (/** @type {number} */ sx, /** @type {number} */ sy) => {
  const g = new THREE.BoxGeometry(4, 2.5, 0.3, sx, sy, 3);
  g.translate(2, 1.25, 0);
  return g;
};
const oeffnung = () => quaderKoerper({ x0_m: 1.5, x1_m: 2.5, y0_m: 0.9, y1_m: 2.1, z0_m: -0.17, z1_m: 0.17 });
/** @type {string[]} */
const zeilen = [];
const melden = (/** @type {string} */ name, /** @type {number} */ wert, /** @type {number|null} */ budget) => {
  zeilen.push(`${name}: ${wert.toFixed(2)} ms${budget != null ? ` (Budget ${budget} ms, Abbruch ab ${budget * CSG_BUDGET_FAKTOR} ms)` : ""}`);
  if (budget != null) assert.ok(wert <= budget * CSG_BUDGET_FAKTOR, `${name} ${wert.toFixed(1)} ms > ${CSG_BUDGET_FAKTOR} × ${budget} ms`);
};

describe("107-14 — Leistungsbudget des CSG-Kerns", () => {
  it("rund 1 000 Dreiecke (952)", () => {
    const g = wand(16, 10);
    assert.equal(dreieckAnzahl(g), 952);
    const r = /** @type {any} */ (kern.boolesch(g, oeffnung(), "subtract"));
    assert.ok(r.ok && Math.abs(r.volumen_m3 - 2.64) < 1e-5, "same hand value as the coarse wall");
    melden("1k Subtraktion Öffnung", ms(() => kern.boolesch(g, oeffnung(), "subtract")), CSG_BUDGET_MS.boolesch_1k);
    const b = wand(16, 10);
    b.rotateY(Math.PI / 2);
    b.translate(2, 0, 2);
    melden("1k Vereinigung Wandecke", ms(() => kern.boolesch(g, b, "union")), CSG_BUDGET_MS.boolesch_1k);
    melden("1k Wasserdichtprüfung", ms(() => istWasserdicht(g)), null);
  });
  it("rund 10 000 Dreiecke (10 800), Umwandlung in die Bibliothek getrennt gemessen", () => {
    const g = wand(60, 40);
    assert.equal(dreieckAnzahl(g), 10800);
    // 107-18: conversion three → library manifold (weld, runs per material, manifold check of the library)
    melden("10k Umwandlung je Körper (manifoldVorbereiten)", ms(() => kern.manifoldVorbereiten(g).delete()), null);
    melden("10k Subtraktion Öffnung (inkl. Umwandlung beider Körper)", ms(() => kern.boolesch(g, oeffnung(), "subtract"), 3), CSG_BUDGET_MS.boolesch_10k);
    const b = wand(60, 40);
    b.rotateY(Math.PI / 2);
    b.translate(2, 0, 2);
    melden("10k Vereinigung Wandecke", ms(() => kern.boolesch(g, b, "union"), 3), CSG_BUDGET_MS.boolesch_10k);
    melden("10k Wasserdichtprüfung", ms(() => istWasserdicht(g)), CSG_BUDGET_MS.wasserdicht_10k);
    // a boolean result (107-14 measured T-junctions here; manifold-3d results are edge-conforming): the opening cut out of the fine wall
    const ergebnis = /** @type {any} */ (kern.boolesch(g, oeffnung(), "subtract")).geometrie;
    melden(`10k Wasserdichtprüfung eines Ergebnisses (${dreieckAnzahl(ergebnis)} Dreiecke)`, ms(() => istWasserdicht(ergebnis)), null);
    melden("10k Volumen", ms(() => volumen_m3(g)), CSG_BUDGET_MS.volumen_10k);
    melden("10k Horizontalschnitt", ms(() => horizontalschnitt(g, 1.0)), null);
    const p = meshKodieren(g);
    melden("10k Cache kodieren", ms(() => meshKodieren(g)), null);
    melden("10k Cache dekodieren", ms(() => meshDekodieren(p)), CSG_BUDGET_MS.dekodieren_10k);
  });
  it("typische Wand: drei Schichten, fünf Öffnungen (Befund ab 100 ms)", async () => {
    setzeProjektAufbauten({ aufbauten: { "p-t3": { name: "Test drei Schichten", skins: [
      { name: "A", material: "beton", thickness: 115 }, { name: "B", material: "mw035", thickness: 160 }, { name: "C", material: "gipsputz", thickness: 25 },
    ] } } });
    const w = { a: { x: 0, z: 0 }, b: { x: 8, z: 0 }, height: 2.75, level: 0, composite: "p-t3" };
    const oe = [0.9, 2.4, 3.9, 5.4, 6.9].map((u) => ({ u, width: 0.8, height: 1.2, sill: 0.9 }));
    const r = await wandSolid(w, oe, { kern });
    assert.equal(r.ok, true, JSON.stringify(r.warnung));
    const t = [];
    for (let i = 0; i < 5; i += 1) {
      const s = performance.now();
      await wandSolid(w, oe, { kern });
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    const dreiecke = dreieckAnzahl(/** @type {any} */ (r.geometrie));
    setzeProjektAufbauten(null);
    melden(`Wand 3 Schichten, 5 Öffnungen, ${dreiecke} Dreiecke im Ergebnis`, t[2], null);
    console.log(t[2] > 100 ? "[107-14 Befund] typische Wand über 100 ms — Hauptthread blockiert" : "[107-14] typische Wand unter 100 ms");
  });
  it("Messwerte ausgeben", () => {
    console.log(`[107-14 Messung] ${process.platform} node ${process.version}\n  ${zeilen.join("\n  ")}`);
  });
});
