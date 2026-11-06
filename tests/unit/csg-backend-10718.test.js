// 107-18 — comparison of the CSG backends (D-BK-08c): manifold-3d against the former three-bvh-csg backend on the cases of
// csg-10714 (core), verschneidung-10709 (layer intersections) and seo-10710 (wall under roof, body against body, basement with
// terrain subtraction): 20 cases, 42 solids. The former backend is no longer installed; its values per solid (source, layer
// groups, total and per-group volume) were measured with both backends side by side (commit 9454cdd5, re-recorded 01.11.2026
// with the former pair installed temporarily, identical result) and are kept in ALT_WERTE. Per case and per solid this test
// checks against them: same solids, same source (solid/analytic; one documented difference in kind, ABWEICHUNG_ART), same
// layer groups, total and per-group volume within the comparison threshold of 107-14 (ABWEICHUNG_SCHWELLE_REL, floor
// ABWEICHUNG_BODEN_M3), watertight per layer group. Where the case has a hand value, the sum is checked against it as well
// (the library is never its own reference).
// Plus: the library refuses a non-manifold input on its own (second line behind the watertight check), materials survive
// through the run original IDs, the WebAssembly binary loads once under node:test.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  csgLaden, booleschMit, istWasserdicht, volumen_m3, volumenJeGruppe, quaderKoerper, wandSolid, platteSolid, geometrieBereinigen, geometrieJeGruppe,
  ABWEICHUNG_SCHWELLE_REL, ABWEICHUNG_BODEN_M3, CSG_VERSION,
} from "@core/lib/csg/index.js";
import { CsgAblehnung } from "@core/lib/csg/backend.js";
import { tVerbindungenTeilen } from "@core/lib/csg/wasserdicht.js";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";
import { baender, verschneidungsWaende, modellBaender } from "@core/lib/bauteil/verschneidung.js";
import { wandSolids, deckenSolid, wandKerne } from "@core/lib/bauteil/solidAbleitung.js";
import { dachBerechnen } from "@core/lib/bauteil/dachGeometrie.js";
import { wandUnterDach, koerperOperation } from "@core/lib/bauteil/seo.js";
import { untergeschossMitGelaende } from "@core/lib/bauteil/gelaendeSolid.js";
import { createBuildingModel } from "@core/lib/buildingModel.js";
import { ifcVerschneidungSzenario } from "./fixtures/ifcVerschneidungModell-10709.js";
import { assetPruefen } from "../../scripts/csg-chunk-budget.mjs";

const nah = (/** @type {number} */ ist, /** @type {number} */ soll, eps = 1e-6, text = "") =>
  assert.ok(Math.abs(ist - soll) <= eps, `${text} ist ${ist}, soll ${soll} (±${eps})`);
/** the 107-14 comparison rule: |a − b| within the relative threshold of b, at least the absolute floor (m³) */
const gleich_m3 = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) <= Math.max(ABWEICHUNG_SCHWELLE_REL * Math.abs(b), ABWEICHUNG_BODEN_M3);
const box = (/** @type {number[]} */ [x0, x1, y0, y1, z0, z1], mi = 0) => quaderKoerper({ x0_m: x0, x1_m: x1, y0_m: y0, y1_m: y1, z0_m: z0, z1_m: z1, materialIndex: mi });
const rechteck = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// build-ups of the cases: three layers 0.115 / 0.16 / 0.025 m (107-14) and insulation 0.10 + concrete 0.20 m (107-09)
const AUFBAUTEN = { aufbauten: {
  "p-r3": { name: "Test drei Schichten", skins: [{ name: "A", material: "beton", thickness: 115 }, { name: "B", material: "mw035", thickness: 160 }, { name: "C", material: "gipsputz", thickness: 25 }] },
  "p-1": { name: "Dämmung + Beton (Test)", skins: [{ name: "Dämmung", material: "mw035", thickness: 100 }, { name: "Beton", material: "beton", thickness: 200, funktion: "kern" }] },
} };
const A = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-1", level: 0, height: 2.5 };
const B = { a: { x: 4, z: -0.15 }, b: { x: 4, z: 3.85 }, composite: "p-1", level: 0, height: 2.5 };
const T2K = { a: { x: 4, z: 0 }, b: { x: 4, z: -4 }, composite: "p-1", level: 0, height: 2.5 };
const dachGiebel = dachBerechnen(rechteck(0, 0, 6, 10), { form: "sattel", firsthoehe_m: 3 }, { traufhoehe_m: 2.5 });
const dach45 = dachBerechnen(rechteck(0, 0, 6, 10), { form: "sattel", neigung_grad: 45 }, { traufhoehe_m: 2.5 });
const giebelwand = { _idx: 1, a: { x: 0, z: 0.15 }, b: { x: 6, z: 0.15 }, thickness: 0.3, height: 6, level: 0 };
const traufwand = { _idx: 2, a: { x: 0.15, z: 1 }, b: { x: 0.15, z: 9 }, thickness: 0.3, height: 3, level: 0 };
const raster = (/** @type {(x: number, y: number) => number} */ f) => {
  const nx = 21, ny = 17, x0 = -5, y0 = -4, h = [];
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) h.push(f(x0 + i, y0 + j));
  return { nx, ny, zelle: 1, x0, y0, h };
};
const ugProfil = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];

/**
 * @typedef {{name: string, geo: THREE.BufferGeometry|null, quelle: string, wert_m3?: number|null}} Teil one derived solid of a case
 *   (wert_m3: a quantity without a kept geometry, compared by volume only)
 * @typedef {{name: string, hand_m3?: number, rechnen: (kern: any) => Promise<Teil[]>}} Fall
 */
/** @type {Fall[]} the cases (hand values from the source tests, comment there) */
const FAELLE = [
  { name: "roh: Wand minus Öffnung", hand_m3: 2.64, rechnen: async (k) => [roh(k.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15]), box([1.5, 2.5, 0.9, 2.1, -0.17, 0.17]), "subtract"))] },
  { name: "roh: Wandecke Vereinigung", hand_m3: 5.8875, rechnen: async (k) => [roh(k.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15]), box([3.85, 4.15, 0, 2.5, -0.15, 3.85]), "union"))] },
  { name: "roh: Wandecke Schnitt", hand_m3: 0.1125, rechnen: async (k) => [roh(k.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15]), box([3.85, 4.15, 0, 2.5, -0.15, 3.85]), "intersect"))] },
  { name: "107-14 Wand mit Öffnung", hand_m3: 2.64, rechnen: async (k) => [solid("wand", await wandSolid({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 }, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern: k }))] },
  { name: "107-14 Wand drei Schichten, drei Öffnungen", rechnen: async (k) => [solid("wand", await wandSolid({ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, composite: "p-r3", height: 2.5, level: 0 }, [1, 3, 5].map((u) => ({ u, width: 1.0, height: 1.2, sill: 0.9 })), { kern: k }))] },
  { name: "107-14 Platte mit Stützenloch", hand_m3: 7.46, rechnen: async (k) => [solid("platte", await platteSolid(rechteck(0, 0, 6, 5), 0.25, [rechteck(2.8, 2.3, 3.2, 2.7)], { kern: k }))] },
  { name: "107-09 Ecke A/B", hand_m3: 5.8875, rechnen: async (k) => eintraege(await wandSolids(baender([A, B], 0).baender, null, { csg: k })) },
  { name: "107-09 T-Stoß Kernseite", rechnen: async (k) => eintraege(await wandSolids(baender([A, T2K], 0).baender, null, { csg: k })) },
  { name: "107-09 Hülle cavity", hand_m3: 49.68, rechnen: async (k) => {
    const model = createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 1, storeyHeight: 3, wallComposite: "cavity" });
    return eintraege(await wandSolids(baender(verschneidungsWaende(model, []), 0).baender, null, { csg: k }));
  } },
  { name: "107-09 Golden-Szenario mit Fenstern und Decke", rechnen: async (k) => {
    const { model, opts } = ifcVerschneidungSzenario();
    const oeff = new Map([["cw:1", [{ u: 1.5, width: 1.2, height: 1.4, sill: 0.9 }]], ["env:0:0", [{ u: 2, width: 1.4, height: 1.4, sill: 0.9 }, { u: 6, width: 1.4, height: 1.4, sill: 0.9 }]]]);
    const mb = modellBaender(verschneidungsWaende(model, opts.customWalls, { geschosse: 3, oeffnungen: oeff }), { geschosse: 3 });
    const alle = [...mb.jeSchluessel.values()].flat();
    const w = eintraege(await wandSolids(alle, null, { csg: k }));
    const d = /** @type {any} */ (await deckenSolid({ ...opts.customSlabs[0], level: 0 }, wandKerne(alle), { csg: k, geschosse: 3 }));
    return [...w, { name: "decke", geo: d.geometrie, quelle: d.quelle }];
  } },
  { name: "107-10 Giebelwand unter Dach", hand_m3: 7.2, rechnen: async (k) => [seo("giebel", await wandUnterDach(giebelwand, [], [dachGiebel], { kern: k }))] },
  { name: "107-10 Giebelwand cavity", rechnen: async (k) => [seo("giebel", await wandUnterDach({ ...giebelwand, composite: "cavity" }, [], [dachGiebel], { kern: k }))] },
  { name: "107-10 Traufwand 45°", hand_m3: 6.36, rechnen: async (k) => [seo("trauf", await wandUnterDach(traufwand, [], [dach45], { kern: k }))] },
  { name: "107-10 Giebelwand mit Fenster", hand_m3: 6.84, rechnen: async (k) => [seo("giebel", await wandUnterDach(giebelwand, [{ u: 3, width: 1, height: 1.2, sill: 1 }], [dachGiebel], { kern: k }))] },
  ...(/** @type {Array<["abzug"|"schnitt"|"vereinigung", number]>} */ ([["abzug", 462], ["schnitt", 18], ["vereinigung", 486]])).map(([op, hand]) => ({
    name: `107-10 Körper gegen Körper ${op}`, hand_m3: hand,
    rechnen: async (/** @type {any} */ k) => [seo(op, await koerperOperation({ profil: rechteck(0, 0, 10, 8), y0_m: 0, y1_m: 6 }, { profil: rechteck(2, -1, 4, 3), y0_m: 1, y1_m: 4 }, op, { kern: k }))],
  })),
  { name: "107-10 Baugrube ebenes Gelände", hand_m3: 240, rechnen: async (k) => gelaende(await untergeschossMitGelaende({ gelaende: raster(() => 0), profil: ugProfil, fusshoehe_m: -3 }, { kern: k })) },
  { name: "107-10 Baugrube Hang", hand_m3: 280, rechnen: async (k) => gelaende(await untergeschossMitGelaende({ gelaende: raster((x) => 0.1 * x), profil: ugProfil, fusshoehe_m: -3 }, { kern: k })) },
  { name: "107-10 erdberührte UG-Wände", rechnen: async (k) => {
    const m = createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 2, storeyHeight: 3, untergeschosse: 1 });
    const r = await untergeschossMitGelaende({ gelaende: raster(() => 0), profil: ugProfil, fusshoehe_m: m.fusshoehe_m, waende: m.walls.filter((w) => /** @type {any} */ (w).unterirdisch), bezug: { x: 5, y: 4 } }, { kern: k });
    // the earth-contact part is a quantity only (no geometry is kept): compared by its volume
    return r.erdberuehrt.map((/** @type {any} */ e) => ({ name: e.schluessel, geo: null, wert_m3: e.solid_m3, quelle: e.quelle }));
  } },
];

/** @returns {Teil} */
function roh(/** @type {any} */ r) { return { name: "roh", geo: r.ok ? r.geometrie : null, quelle: r.ok ? "solid" : `abgelehnt:${r.grund}` }; }
/** @returns {Teil} */
function solid(/** @type {string} */ name, /** @type {any} */ r) { return { name, geo: r.geometrie, quelle: r.quelle }; }
/** @returns {Teil} */
function seo(/** @type {string} */ name, /** @type {any} */ r) { return { name, geo: r.geometrie, quelle: `${r.status}/${r.quelle}` }; }
/** @returns {Teil[]} */
function eintraege(/** @type {Map<string, any>} */ m) { return [...m.entries()].map(([k, e]) => ({ name: k, geo: e.geometrie, quelle: e.quelle })); }
/** @returns {Teil[]} */
function gelaende(/** @type {any} */ r) {
  return [{ name: "aushub", geo: r.aushub.geometrie, quelle: r.aushub.quelle }, { name: "gelaendeNach", geo: r.gelaendeNach.geometrie, quelle: r.dicht ? "dicht" : "undicht" }];
}

/**
 * Summary of one solid: total and per-group volume (m³), watertight, triangles. A layered solid is several closed solids side
 * by side (107-14 convention), so "watertight" is checked per layer group, never on the glued body.
 */
function kennwerte(/** @type {THREE.BufferGeometry|null} */ geo, /** @type {number|null|undefined} */ wert_m3 = undefined) {
  if (!geo) return typeof wert_m3 === "number" ? { volumen_m3: wert_m3, jeGruppe: {}, dicht: true, dreiecke: 0 } : null;
  const teile = [...geometrieJeGruppe(geo).values()];
  return { volumen_m3: volumen_m3(geo), jeGruppe: volumenJeGruppe(geo), dicht: teile.length > 0 && teile.every((g) => istWasserdicht(g).ok), dreiecke: geo.getAttribute("position").count / 3 };
}

/**
 * Every solid of every case with the FORMER backend (three-bvh-csg 0.0.18 + three-mesh-bvh 0.9.16): its source, total volume
 * (m³) and volume per layer group (material index → m³). Measured in the live comparison of both backends (commit 9454cdd5,
 * 26.10.2026) and re-recorded 01.11.2026 with the former pair installed temporarily (same 20 cases, 42 solids, largest
 * difference to manifold-3d 5.5e-7 m³ in total and per group; report in 107-18-SUMMARY.md). Kept as the record of that
 * comparison after the library was removed: manifold-3d must reproduce source and groups and stay within the comparison
 * threshold of every value. A solid without a kept geometry (earth-contact quantity) has no groups.
 * @type {Record<string, Record<string, {quelle: string, m3: number, gruppen: Record<string, number>}>>}
 */
const ALT_WERTE = {
  "roh: Wand minus Öffnung": { "roh": { quelle: "solid", m3: 2.64, gruppen: { 0: 2.64 } } },
  "roh: Wandecke Vereinigung": { "roh": { quelle: "solid", m3: 5.887502, gruppen: { 0: 5.887502 } } },
  "roh: Wandecke Schnitt": { "roh": { quelle: "solid", m3: 0.1125, gruppen: { 0: 0.1125 } } },
  "107-14 Wand mit Öffnung": { "wand": { quelle: "solid", m3: 2.64, gruppen: { 0: 2.64 } } },
  "107-14 Wand drei Schichten, drei Öffnungen": { "wand": { quelle: "solid", m3: 3.42, gruppen: { 0: 1.311, 1: 1.824, 2: 0.285 } } },
  "107-14 Platte mit Stützenloch": { "platte": { quelle: "solid", m3: 7.46, gruppen: { 0: 7.46 } } },
  "107-09 Ecke A/B": { "w0": { quelle: "solid", m3: 3.0625, gruppen: { 0: 0.9875, 1: 2.075 } }, "w1": { quelle: "solid", m3: 2.825, gruppen: { 0: 0.925, 1: 1.9 } } },
  "107-09 T-Stoß Kernseite": { "w0": { quelle: "solid", m3: 3.0625, gruppen: { 0: 1.0375, 1: 2.025 } }, "w1": { quelle: "solid", m3: 2.9375, gruppen: { 0: 1.0125, 1: 1.925 } } },
  "107-09 Hülle cavity": { "env:0:0": { quelle: "solid", m3: 13.97325, gruppen: { 0: 2.922, 1: 1.476, 2: 3.6288, 3: 5.47575, 4: 0.4707 } }, "env:0:1": { quelle: "solid", m3: 11.04, gruppen: { 0: 2.292, 1: 1.1685, 2: 2.8656, 3: 4.333875, 4: 0.380025 } }, "env:0:2": { quelle: "solid", m3: 13.8, gruppen: { 0: 2.892, 1: 1.4685, 2: 3.5856, 3: 5.383875, 4: 0.470025 } }, "env:0:3": { quelle: "solid", m3: 10.86675, gruppen: { 0: 2.262, 1: 1.161, 2: 2.8224, 3: 4.242, 4: 0.37935 } } },
  "107-09 Golden-Szenario mit Fenstern und Decke": { "env:0:0": { quelle: "solid", m3: 12.17005, gruppen: { 0: 2.53, 1: 1.28, 2: 3.1584, 3: 4.78975, 4: 0.4119 } }, "env:0:1": { quelle: "solid", m3: 11.04, gruppen: { 0: 2.292, 1: 1.1685, 2: 2.8656, 3: 4.333875, 4: 0.380025 } }, "env:0:2": { quelle: "solid", m3: 13.8, gruppen: { 0: 2.892, 1: 1.4685, 2: 3.5856, 3: 5.383875, 4: 0.470025 } }, "env:0:3": { quelle: "solid", m3: 10.86675, gruppen: { 0: 2.262, 1: 1.161, 2: 2.8224, 3: 4.242, 4: 0.37935 } }, "cw:1": { quelle: "solid", m3: 3.2832, gruppen: { 0: 3.2832 } }, "cw:2": { quelle: "solid", m3: 2.7936, gruppen: { 0: 2.7936 } }, "cw:3": { quelle: "solid", m3: 2.592, gruppen: { 0: 0.20736, 1: 0.3456, 2: 1.728, 3: 0.15552, 4: 0.15552 } }, "cw:5": { quelle: "solid", m3: 1.08, gruppen: { 0: 1.08 } }, "env:1:0": { quelle: "solid", m3: 13.97325, gruppen: { 0: 2.922, 1: 1.476, 2: 3.6288, 3: 5.47575, 4: 0.4707 } }, "env:1:1": { quelle: "solid", m3: 11.04, gruppen: { 0: 2.292, 1: 1.1685, 2: 2.8656, 3: 4.333875, 4: 0.380025 } }, "env:1:2": { quelle: "solid", m3: 13.8, gruppen: { 0: 2.892, 1: 1.4685, 2: 3.5856, 3: 5.383875, 4: 0.470025 } }, "env:1:3": { quelle: "solid", m3: 10.86675, gruppen: { 0: 2.262, 1: 1.161, 2: 2.8224, 3: 4.242, 4: 0.37935 } }, "decke": { quelle: "solid", m3: 4.165568, gruppen: { 0: 4.165568 } } },
  "107-10 Giebelwand unter Dach": { "giebel": { quelle: "solid/solid", m3: 7.2, gruppen: { 0: 7.2 } } },
  "107-10 Giebelwand cavity": { "giebel": { quelle: "solid/solid", m3: 11.04, gruppen: { 0: 2.4, 1: 1.2, 2: 2.88, 3: 4.2, 4: 0.36 } } },
  "107-10 Traufwand 45°": { "trauf": { quelle: "solid/solid", m3: 6.36, gruppen: { 0: 6.36 } } },
  "107-10 Giebelwand mit Fenster": { "giebel": { quelle: "solid/solid", m3: 6.84, gruppen: { 0: 6.84 } } },
  "107-10 Körper gegen Körper abzug": { "abzug": { quelle: "solid/solid", m3: 461.999999, gruppen: { 0: 461.999999 } } },
  "107-10 Körper gegen Körper schnitt": { "schnitt": { quelle: "solid/solid", m3: 18, gruppen: { 0: 18 } } },
  "107-10 Körper gegen Körper vereinigung": { "vereinigung": { quelle: "solid/solid", m3: 485.999999, gruppen: { 0: 485.999999 } } },
  "107-10 Baugrube ebenes Gelände": { "aushub": { quelle: "solid", m3: 240, gruppen: { 0: 240 } }, "gelaendeNach": { quelle: "dicht", m3: 1040, gruppen: { 0: 1040 } } },
  "107-10 Baugrube Hang": { "aushub": { quelle: "solid", m3: 280, gruppen: { 0: 280 } }, "gelaendeNach": { quelle: "undicht", m3: 1160, gruppen: { 0: 1160 } } },
  "107-10 erdberührte UG-Wände": { "ug:-1:0": { quelle: "solid", m3: 7.199993, gruppen: {} }, "ug:-1:1": { quelle: "solid", m3: 5.759995, gruppen: {} }, "ug:-1:2": { quelle: "solid", m3: 7.199993, gruppen: {} }, "ug:-1:3": { quelle: "solid", m3: 5.759995, gruppen: {} } },
};

/**
 * The one difference in kind of the live comparison (case | solid → source former / manifold-3d): the terrain after the
 * sloped excavation was not edge-conforming with the former backend (accepted only through the volume balance of
 * gelaendeSolid.js), with manifold-3d it is strictly watertight — an improvement, listed in 107-18-SUMMARY.md.
 * @type {Record<string, {alt: string, neu: string}>}
 */
const ABWEICHUNG_ART = { "107-10 Baugrube Hang|gelaendeNach": { alt: "undicht", neu: "dicht" } };

/** Sources a solid of these cases may have with manifold-3d (anything else is a fallback to the analytic construction). */
const QUELLE_SOLID = /^(solid|solid\/solid|dicht)$/;

/** @type {any} */
let neu;

before(async () => {
  setzeProjektAufbauten(AUFBAUTEN);
  neu = await csgLaden();
});
after(() => setzeProjektAufbauten(null));

describe("107-18 — Backend manifold-3d", () => {
  it("die WebAssembly-Bibliothek lädt unter node:test einmal; Name und CSG_VERSION nennen manifold-3d", async () => {
    assert.equal(neu.csgBackend.name, "manifold-3d");
    assert.match(CSG_VERSION, /^csg2\|manifold-3d@\d+\.\d+\.\d+$/);
    assert.equal(await csgLaden(), neu, "same module, loaded once");
    const r = neu.boolesch(box([0, 1, 0, 1, 0, 1]), box([0.5, 1.5, 0.5, 1.5, 0.5, 1.5]), "subtract");
    assert.ok(r.geometrie instanceof THREE.BufferGeometry, "result is a geometry of the test's three");
    nah(r.volumen_m3, 1 - 0.125, 1e-6); // 1 m³ minus the overlapping 0.5³ m³
  });

  it("Material bleibt: Laibung der Öffnung trägt den Index der Öffnung, Rest den der Wand (Run-IDs → Gruppen)", () => {
    // wall layer index 2, opening body index 2 as well (107-14 rule) → one group; with a different index (5) the reveal
    // faces form their own group with zero volume share of their own, so only the material sets are compared
    const r = neu.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15], 2), box([1.5, 2.5, 0.9, 2.1, -0.17, 0.17], 5), "subtract");
    assert.equal(r.ok, true);
    assert.deepEqual(r.geometrie.groups.map((/** @type {any} */ g) => g.materialIndex), [2, 5]);
    // the reveal faces: 4 rectangles 1.0 × 0.3 / 1.2 × 0.3 → 8 triangles of index 5
    assert.equal(r.geometrie.groups[1].count / 3, 8);
    const u = neu.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15], 0), box([3.85, 4.15, 0, 2.5, -0.15, 3.85], 1), "union");
    const jg = volumenJeGruppe(u.geometrie);
    assert.deepEqual(Object.keys(jg).map(Number), [0, 1]);
  });

  it("nicht-mannigfaltige Eingabe, die die eigene Prüfung passieren ließe, lehnt die Bibliothek mit Grund ab (nie still falsch)", () => {
    // a spy check that accepts everything: the library is the second line and refuses the open box itself
    const offen = geometrieBereinigen(box([0, 1, 0, 1, 0, 1]));
    const p = /** @type {Float32Array} */ (offen.getAttribute("position").array);
    const ohneDeckel = new THREE.BufferGeometry();
    ohneDeckel.setAttribute("position", new THREE.BufferAttribute(p.slice(0, p.length - 18), 3)); // last two triangles (one face) removed
    const allesDicht = { ...neu.csgBackend, watertight: (/** @type {any} */ g) => ({ ...istWasserdicht(g), ok: true, dreiecke: 1 }) };
    const r = /** @type {any} */ (booleschMit(allesDicht, box([0, 2, 0, 2, 0, 2]), ohneDeckel, "subtract"));
    assert.equal(r.ok, false);
    assert.equal(r.grund, "offen");
    assert.equal(r.eingabe, "b");
    assert.match(r.text, /NotManifold|Not manifold/);
    assert.equal(r.bericht, null, "the own report said ok; it is not passed off as the reason of the library's refusal");
    // the raw backend throws the refusal class with the input name
    assert.throws(() => neu.csgBackend.subtract(ohneDeckel, box([0, 1, 0, 1, 0, 1])), (/** @type {any} */ e) => e instanceof CsgAblehnung && e.grund === "offen" && e.eingabe === "a");
    // the own watertight check still comes first: the same input through boolesch() is refused before the library runs
    const r2 = /** @type {any} */ (neu.boolesch(box([0, 2, 0, 2, 0, 2]), ohneDeckel, "subtract"));
    assert.equal(r2.grund, "offen");
    assert.ok(r2.bericht && r2.bericht.offeneKanten > 0);
  });

  it("Ergebnisse sind kantenkonform: keine T-Verbindungen mehr in der Wasserdichtprüfung", () => {
    const r = neu.boolesch(box([0, 4, 0, 2.5, -0.15, 0.15]), box([1.5, 2.5, 0.9, 2.1, -0.17, 0.17]), "subtract");
    const b = istWasserdicht(r.geometrie);
    assert.equal(b.ok, true);
    assert.equal(b.tVerbindungen, 0); // 107-14 measured 74 single-used edges here with the former backend
  });

  it("Eingabe mit T-Verbindung, die die eigene Prüfung annimmt, rechnet die Bibliothek auch (an der T-Stelle geteilt)", () => {
    // unit cube whose top face (y = 1) has an extra corner m = (0.5, 1, 0) on the front edge; the front face is not split
    // there, so its top edge is used once and the two short top edges once each: a T-junction (review 107-18)
    const g = geometrieBereinigen(box([0, 1, 0, 1, 0, 1]));
    const p = /** @type {Float32Array} */ (g.getAttribute("position").array);
    /** @type {number[]} */
    const rest = [];
    for (let t = 0; t < p.length; t += 9) if (!(p[t + 1] === 1 && p[t + 4] === 1 && p[t + 7] === 1)) rest.push(...p.slice(t, t + 9));
    const m = [0.5, 1, 0];
    const deckel = [[m, [0, 1, 0], [0, 1, 1]], [m, [0, 1, 1], [1, 1, 1]], [m, [1, 1, 1], [1, 1, 0]]].flat(2); // normals +y
    const tWuerfel = new THREE.BufferGeometry();
    tWuerfel.setAttribute("position", new THREE.BufferAttribute(new Float32Array([...rest, ...deckel]), 3));
    const bericht = istWasserdicht(tWuerfel);
    assert.equal(bericht.ok, true);
    assert.equal(bericht.tVerbindungen, 1);
    const r = /** @type {any} */ (neu.boolesch(tWuerfel, box([0.25, 0.75, 0.25, 0.75, -0.1, 0.5]), "subtract"));
    assert.equal(r.ok, true, `refused: ${r.text}`);
    nah(r.volumen_m3, 1 - 0.5 * 0.5 * 0.5, 1e-6);
    assert.equal(istWasserdicht(r.geometrie).ok, true);
    // the raw backend accepts it as well (the split happens in the conversion, not only behind the check)
    const roh = neu.csgBackend.union(tWuerfel, box([2, 3, 0, 1, 0, 1]));
    nah(volumen_m3(roh), 2, 1e-6);
  });

  it("tVerbindungenTeilen lässt eine kantenkonforme Liste unverändert und teilt nur an T-Stellen", () => {
    // a closed tetrahedron (no open edge) comes back as it is
    const lage = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const tet = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    const r = tVerbindungenTeilen(tet, lage);
    assert.equal(r.tri, tet);
    assert.equal(r.tVerbindungen, 0);
    // the same tetrahedron with face 0-1-3 split at the midpoint 4 of edge 0→1: face 0-2-1 gets split into two
    const lage2 = [...lage, [0.5, 0, 0]];
    const tet2 = [0, 2, 1, 0, 4, 3, 4, 1, 3, 0, 3, 2, 1, 2, 3];
    const r2 = tVerbindungenTeilen(tet2, lage2);
    assert.equal(r2.tVerbindungen, 1);
    assert.equal(r2.tri.length / 3, 6);
    assert.deepEqual(r2.herkunft, [0, 0, 1, 2, 3, 4]);
  });

  for (const fall of FAELLE) {
    it(`Fall „${fall.name}“: Solid aus manifold-3d, wasserdicht${fall.hand_m3 != null ? `, Summe = Handwert ${fall.hand_m3} m³` : ""}`, async () => {
      const teile = await fall.rechnen(neu);
      assert.ok(teile.length > 0);
      let summe = 0;
      for (const t of teile) {
        const k = kennwerte(t.geo, t.wert_m3);
        assert.ok(k, `${t.name}: kein Solid (${t.quelle})`);
        assert.match(t.quelle, QUELLE_SOLID, `${t.name}: Quelle ${t.quelle} (Rückfall statt Solid)`);
        assert.equal(k.dicht, true, `${t.name} wasserdicht`);
        if (t.name !== "gelaendeNach") summe += k.volumen_m3;
      }
      if (fall.hand_m3 != null) assert.ok(gleich_m3(summe, fall.hand_m3), `Summe ${summe} gegen Handwert ${fall.hand_m3}`);
    });
  }
});

describe("107-18 — Vergleich mit dem früheren Backend (festgehaltene Messwerte, ALT_WERTE)", () => {
  it("jeder Fall der Tabelle wird gerechnet, jede Zeile hat einen Fall; 42 Solids", () => {
    assert.deepEqual(Object.keys(ALT_WERTE).sort(), FAELLE.map((f) => f.name).sort());
    assert.equal(Object.values(ALT_WERTE).reduce((s, f) => s + Object.keys(f).length, 0), 42);
  });
  for (const fall of FAELLE) {
    it(`Fall „${fall.name}“: gleiche Solids, gleiche Quelle, gleiche Schicht-Gruppen, Volumen gesamt und je Gruppe innerhalb der Abgleichschwelle`, async () => {
      const n = await fall.rechnen(neu);
      const soll = ALT_WERTE[fall.name];
      assert.deepEqual(n.map((x) => x.name), Object.keys(soll), "same solids");
      for (const t of n) {
        const s = soll[t.name];
        const art = ABWEICHUNG_ART[`${fall.name}|${t.name}`];
        assert.equal(t.quelle, art && s.quelle === art.alt ? art.neu : s.quelle, `${t.name}: Quelle`);
        const k = kennwerte(t.geo, t.wert_m3);
        assert.ok(k, `${t.name}: kein Solid`);
        assert.ok(gleich_m3(k.volumen_m3, s.m3), `${t.name}: ${k.volumen_m3} gegen ${s.m3}`);
        assert.deepEqual(Object.keys(k.jeGruppe), Object.keys(s.gruppen), `${t.name}: Schicht-Gruppen`);
        for (const [g, v] of Object.entries(s.gruppen)) {
          assert.ok(gleich_m3(k.jeGruppe[g], v), `${t.name} Gruppe ${g}: ${k.jeGruppe[g]} gegen ${v}`);
        }
      }
    });
  }
});

describe("107-18 — Lizenz (Apache-2.0 § 4)", () => {
  it("Lizenztext im Build, Eintrag in THIRD-PARTY-LICENSES.md mit installierter Version, keine NOTICE-Datei im Paket", () => {
    const vite = fs.readFileSync("vite.config.js", "utf8");
    assert.ok(vite.includes("['LICENSES/manifold-3d-Apache-2.0.txt', path.resolve(__dirname, 'node_modules/manifold-3d/LICENSE')]"), "licence text in the build");
    assert.match(fs.readFileSync("node_modules/manifold-3d/LICENSE", "utf8"), /Apache License\s+Version 2\.0/);
    const liste = fs.readFileSync("THIRD-PARTY-LICENSES.md", "utf8");
    const version = JSON.parse(fs.readFileSync("package-lock.json", "utf8")).packages["node_modules/manifold-3d"].version;
    assert.ok(liste.includes("## manifold-3d — Apache-2.0") && liste.includes(`**Version:** ${version}`), "entry with the installed version");
    // § 4 d: a NOTICE file of the package would have to travel with the build — today there is none; a later version with one
    // fails here until it is shipped (vite.config.js lizenzdateien) and named in THIRD-PARTY-LICENSES.md
    const notice = fs.readdirSync("node_modules/manifold-3d").filter((f) => /^notice/i.test(f));
    assert.deepEqual(notice, []);
    for (const alt of ["three-bvh-csg", "three-mesh-bvh"]) {
      assert.ok(!vite.includes(`node_modules/${alt}/`), `${alt} no longer in the build`);
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      assert.equal(pkg.devDependencies?.[alt] ?? pkg.dependencies?.[alt], undefined, `${alt} removed from package.json`);
    }
  });
});

describe("107-18 — Größenprüfung der WebAssembly-Datei im csg-Messbuild", () => {
  it("assetPruefen: ok, über, fehlt, ohne Grenze; Grenze in budget.json", () => {
    const d = [{ rel: "assets/manifold-BE4c7gO-.wasm", roh: 541470, gz: null }, { rel: "assets/csg-CIWYZfLi.js", roh: 44361, gz: 14658 }];
    assert.equal(assetPruefen(d, "manifold", 595968).status, "ok");
    assert.equal(assetPruefen(d, "manifold", 500000).status, "ueber");
    assert.equal(assetPruefen(d.slice(1), "manifold", 595968).status, "fehlt");
    assert.equal(assetPruefen(d, "manifold", undefined).status, "ohne_grenze");
    assert.equal(assetPruefen(d, "manifold", 595968).wert, 541470, "raw bytes");
    const budget = JSON.parse(fs.readFileSync("budget.json", "utf8"));
    assert.equal(typeof budget.grenzen.assets.manifold, "number");
  });
});
