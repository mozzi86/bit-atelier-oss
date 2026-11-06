// 107-09 — priority-based connections: 2D bands as the analytic reference, CSG solids per layer, slab cut, plan/section outlines,
// IFC items from the bands, data sheet. Every expected value is calculated by hand (comment next to it); a band or solid result is
// never its own reference.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";
import { baender, baenderFlaeche_m2, baenderVolumen_m3, bandVolumen_m3, restVolumen_m3, verschneidungsWaende, modellBaender, umrisse, FANG_TOLERANZ_M } from "@core/lib/bauteil/verschneidung.js";
import { wandSolids, geschossSolids, deckenSolid, wandKerne, planFlaechen, schnittFlaechen, deckenPrioritaet, aktuelleSolids, aktuelleDecken, mitDeckenAbzuegen, deckenKuerzungen } from "@core/lib/bauteil/solidAbleitung.js";
import { fremdeElementeAbgleichen } from "@core/lib/abgleich/modellAbgleich.js";
import { schnittErsetzt } from "@core/lib/bauteil/referenz.js";
import { steckbrief, verschneidungsgruppe } from "@core/lib/bauteil/steckbrief.js";
import { csgLaden, csgWarnungText, quaderKoerper } from "@core/lib/csg/index.js";
import { CSG_CACHE_LEER } from "@core/lib/csg/cache.js";
import { createBuildingModel } from "@core/lib/buildingModel";
import { werkstattWaende, WT_MARKER } from "@core/lib/werkstattBauteile.js";
import { kennungWert } from "@core/lib/zeigen/planStand.js";
import { exportIFC, WARNART_VERSCHNEIDUNG } from "@designer/lib/ifcExport";
import { planGrafik, schnittGrafik } from "@designer/lib/vektorPlan";
import { ifcVerschneidungSzenario } from "./fixtures/ifcVerschneidungModell-10709.js";

const nah = (/** @type {number} */ ist, /** @type {number} */ soll, eps = 1e-6, text = "") =>
  assert.ok(Math.abs(ist - soll) <= eps, `${text} ist ${ist}, soll ${soll} (±${eps})`);
const lies = (/** @type {string} */ rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
/** bounding box of the pieces of a band (m) */
const box = (/** @type {any} */ b) => {
  const p = b.teile.flat();
  return { x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), z0: Math.min(...p.map((q) => q.z)), z1: Math.max(...p.map((q) => q.z)) };
};
const band = (/** @type {any} */ r, /** @type {string} */ k, /** @type {number} */ s) => r.baender.find((/** @type {any} */ b) => b.schluessel === k && b.schicht === s);

// a 0.30 m wall: insulation 0.10 m (proposal 320) outside, concrete core 0.20 m (850) inside
const AUFBAUTEN = { aufbauten: { "p-1": { name: "Dämmung + Beton (Test)", skins: [
  { name: "Dämmung", material: "mw035", thickness: 100 }, { name: "Beton", material: "beton", thickness: 200, funktion: "kern" }] } } };
// corner of 107-14: A x ∈ [0; 4], z ∈ [−0.15; 0.15]; B x ∈ [3.85; 4.15], z ∈ [−0.15; 3.85]; both 2.5 m high; union 5.8875 m³
const A = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-1", level: 0, height: 2.5 };
const B = { a: { x: 4, z: -0.15 }, b: { x: 4, z: 3.85 }, composite: "p-1", level: 0, height: 2.5 };
// T joint: A through x ∈ [0; 8], B from A's axis at x = 4 up to z = 4 (on A's insulation side)
const T1 = { a: { x: 0, z: 0 }, b: { x: 8, z: 0 }, composite: "p-1", level: 0, height: 2.5 };
const T2 = { a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, composite: "p-1", level: 0, height: 2.5 };
// the same branch on A's CORE side (review 107-09): from A's axis at x = 4 down to z = −4; d = (0, −1), n = (1, 0):
// insulation x ∈ [4.05; 4.15], core x ∈ [3.85; 4.05]
const T2K = { a: { x: 4, z: 0 }, b: { x: 4, z: -4 }, composite: "p-1", level: 0, height: 2.5 };
/** area of a ring in m² */
const ringFlaeche = (/** @type {Array<{x: number, z: number}>} */ r) => Math.abs(r.reduce((z, q, i) => { const n = r[(i + 1) % r.length]; return z + q.x * n.z - n.x * q.z; }, 0) / 2);

let kern;
before(async () => { setzeProjektAufbauten(AUFBAUTEN); kern = await csgLaden(); });
after(() => setzeProjektAufbauten(null));

describe("107-09 Task 1 — Bänder (analytische Referenz)", () => {
  it("Ecke gleiche Priorität: der Kern der zuerst gezeichneten Wand läuft durch, die Dämmung stößt an den Kern", () => {
    const r = baender([A, B], 0);
    // n of A = (0, 1): layer 1 (insulation) at z ∈ [0.05; 0.15], core z ∈ [−0.15; 0.05]; n of B = (−1, 0): insulation x ∈ [3.85; 3.95], core [3.95; 4.15]
    assert.deepEqual(r.stoesse.map((s) => `${s.schluessel}${s.ende}-${s.art}`), ["w0b-L", "w1a-L"]);
    const aKern = box(band(r, "w0", 1)), bKern = box(band(r, "w1", 1)), aD = box(band(r, "w0", 0)), bD = box(band(r, "w1", 0));
    nah(aKern.x1, 4.15); nah(aKern.x0, 0); // A core through to the far face of B
    nah(bKern.z0, 0.05); nah(bKern.z1, 3.85); // B core abuts A's core
    nah(aD.x1, 3.95); // A insulation stops at B's core
    nah(bD.z0, 0.15); // B insulation starts behind A's insulation
    // areas: A core 4.15 · 0.2 = 0.83, B core 3.8 · 0.2 = 0.76, A insulation 3.95 · 0.1 = 0.395, B insulation 3.7 · 0.1 = 0.37
    nah(band(r, "w0", 1).flaeche_m2, 0.83); nah(band(r, "w1", 1).flaeche_m2, 0.76); nah(band(r, "w0", 0).flaeche_m2, 0.395); nah(band(r, "w1", 0).flaeche_m2, 0.37);
    nah(baenderFlaeche_m2(r.baender), 2.355); // 1.2 + 1.2 − overlap 0.045 = union
    nah(baenderVolumen_m3(r.baender), 5.8875); // 2.355 · 2.5, as the union of 107-14
    nah(baenderVolumen_m3(r.baender, 2.5), 5.8875); // the plain rule of the plan text gives the same
  });

  it("gleiche Priorität: die Zeichenreihenfolge entscheidet (B zuerst → B-Kern läuft durch)", () => {
    const r = baender([B, A], 0);
    nah(box(band(r, "w0", 1)).z0, -0.15); // B (now w0) core down to A's far face z = −0.15
    nah(box(band(r, "w1", 1)).x1, 3.95); // A core abuts B's core at x = 3.95
    nah(baenderFlaeche_m2(r.baender), 2.355);
  });

  it("T-Stoß: Kern der Abzweigung durchstößt die Dämmung bis zum Kern der durchgehenden Wand", () => {
    const r = baender([T1, T2], 0);
    assert.deepEqual(r.stoesse.map((s) => `${s.schluessel}${s.ende}-${s.art}`), ["w1a-T"]);
    const ad = band(r, "w0", 0);
    assert.equal(ad.teile.length, 2); // A insulation split by B's core: x ∈ [0; 3.95] and [4.15; 8]
    nah(ad.flaeche_m2, 0.78); // (3.95 + 3.85) · 0.1
    nah(box(band(r, "w1", 1)).z0, 0.05); // B core ends at A core's inner face (A drawn first)
    nah(box(band(r, "w1", 0)).z0, 0.15); // B insulation abuts A's insulation
    nah(baenderFlaeche_m2(r.baender), 3.555); // 8 · 0.3 + 3.85 · 0.3
  });

  it("T-Stoß auf der Kernseite (Review 107-09): der Kern der Abzweigung hält am gleichrangigen Kern, keine Insel in der Dämmung", () => {
    const r = baender([T1, T2K], 0);
    assert.deepEqual(r.stoesse.map((s) => `${s.schluessel}${s.ende}-${s.art}`), ["w1a-T"]);
    // every layer is ONE piece connected to its wall (before the fix: B's core 2 pieces, the island (3.85 … 4.05) × (0.05 … 0.15) in A's insulation)
    for (const b of r.baender) assert.equal(b.teile.length, 1, `${b.schluessel}/${b.schicht}`);
    nah(band(r, "w0", 0).flaeche_m2, 0.8); // A insulation continuous: 8 · 0.1
    nah(box(band(r, "w1", 1)).z1, -0.15); // B core stops in front of A's core (equal priority, A drawn first)
    nah(box(band(r, "w1", 0)).z1, -0.15); // B insulation stops there too (A's core ranks higher)
    nah(band(r, "w1", 1).flaeche_m2, 0.77); // 3.85 · 0.2
    nah(baenderFlaeche_m2(r.baender), 3.555); // 8 · 0.3 + 3.85 · 0.3, no gap, no double area
    assert.ok(r.baender.every((b) => b.abzuege.length === 0), "nothing overlaps, nothing is cut");
  });

  it("Kern niedriger als Dämmung: die Dämmung (Priorität 900) läuft durch, der Kern stößt an", () => {
    const hoch = { schicht_prioritaet: { 0: 900 } };
    const r = baender([{ ...T1, ...hoch }, { ...T2, ...hoch }], 0);
    const ad = band(r, "w0", 0);
    assert.equal(ad.teile.length, 1); // A insulation continuous
    nah(ad.flaeche_m2, 0.8); // 8 · 0.1
    nah(box(band(r, "w1", 1)).z0, 0.15); // B core stops at A's face (the higher insulation is an obstacle, not jumped over)
    nah(baenderFlaeche_m2(r.baender), 3.555); // the union does not change
  });

  it("Gruppe 0 und ungleiche Gruppen: keine Verschneidung, Meldung „keine Verschneidung trotz Überlappung“", () => {
    for (const [ga, gb] of [[1, 0], [1, 2]]) {
      const r = baender([{ ...A, verschneidungsgruppe: ga }, { ...B, verschneidungsgruppe: gb }], 0);
      assert.equal(r.stoesse.length, 0);
      assert.ok(r.baender.every((b) => b.abzuege.length === 0));
      nah(baenderFlaeche_m2(r.baender), 2.4); // two plain walls 4 · 0.3, the overlap counted twice
      assert.deepEqual(r.meldungen.map((m) => m.code), ["gruppen-ueberlappung"]);
      assert.deepEqual(r.meldungen[0].gruppen, [ga, gb]);
    }
  });

  it("cavity-Ecke (Review 107-09): jede Schicht läuft als geschlossener Ring um, der Kern erreicht die Außenfläche nicht (beide Umlaufrichtungen)", () => {
    const fp = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
    for (const footprintM of [fp, [...fp].reverse()]) {
      const m = createBuildingModel({ footprintM, storeys: 1, storeyHeight: 3, wallComposite: "cavity" });
      const r = baender(verschneidungsWaende(m, []), 0);
      for (const b of r.baender) assert.equal(b.teile.length, 1, `${b.schluessel}/${b.name}`); // no island, no split layer
      nah(baenderFlaeche_m2(r.baender), 16.56, 1e-6);
      const alle = r.baender.flatMap((b) => b.teile.flat());
      const X0 = Math.min(...alle.map((p) => p.x)), X1 = Math.max(...alle.map((p) => p.x)), Z0 = Math.min(...alle.map((p) => p.z)), Z1 = Math.max(...alle.map((p) => p.z));
      const amRand = (/** @type {{x: number, z: number}} */ p) => [p.x - X0, X1 - p.x, p.z - Z0, Z1 - p.z].some((d) => Math.abs(d) < 1e-9);
      for (const name of ["Luftschicht", "Dämmung", "Kalksandstein"]) {
        const bs = r.baender.filter((b) => b.name === name);
        assert.equal(bs.length, 4);
        assert.ok(!bs.some((b) => b.teile.flat().some(amRand)), `${name} reaches the outer face`);
        // the four pieces of a layer join to ONE closed ring around the building: an outer and an inner outline
        assert.equal(umrisse(bs.map((b) => b.teile[0])).length, 2, `${name} is not continuous around the corners`);
      }
    }
  });

  it("Hülle mit gewähltem Aufbau verschneidet an allen Ecken; die Standard-Hülle ohne Aufbau nimmt nicht teil", () => {
    const fp = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
    const mit = createBuildingModel({ footprintM: fp, storeys: 1, storeyHeight: 3, wallComposite: "cavity" });
    const r = baender(verschneidungsWaende(mit, []), 0);
    assert.equal(r.stoesse.length, 8); // 4 corners, both ends each
    // centred on the footprint line, D = 0.46 m: outer 10.46 · 8.46 − inner 9.54 · 7.54 = 16.56 m² (= perimeter · D)
    nah(baenderFlaeche_m2(r.baender), 16.56, 1e-6);
    const ohne = createBuildingModel({ footprintM: fp, storeys: 1, storeyHeight: 3 });
    assert.equal(baender(verschneidungsWaende(ohne, []), 0).baender.length, 0);
  });

  it("spitzer Winkel wird gerechnet und gemeldet, Fang wie die Objektfang-Toleranz", () => {
    assert.equal(FANG_TOLERANZ_M, 0.4);
    const C = { a: { x: 4, z: 0 }, b: { x: 0, z: 1.2 }, composite: "p-1", level: 0, height: 2.5 }; // ≈ 16.7° to A
    const r = baender([A, C], 0);
    assert.ok(r.meldungen.some((m) => m.code === "spitzer-winkel"));
  });

  it("restVolumen_m3: Zellen mit eigenen Höhen sind exakt (Wand 4 × 0,3, Abzug 1 × 0,3 nur von 1,0 bis 2,0 m, Öffnung)", () => {
    const wand = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 0.3 }, { x: 0, z: 0.3 }];
    const abzug = { polygon: [{ x: 3, z: -1 }, { x: 4, z: -1 }, { x: 4, z: 1 }, { x: 3, z: 1 }], unten_m: 1, oben_m: 2 };
    // 4 · 0.3 · 2.5 = 3.0 minus 1 · 0.3 · 1.0 = 0.3
    nah(restVolumen_m3([wand], 0, 2.5, [abzug]), 2.7);
    // an overlapping second region over 1.5 … 2.5 removes only 0.5 m more in the same cell: 3.0 − 0.3 · 1.5
    nah(restVolumen_m3([wand], 0, 2.5, [abzug, { ...abzug, unten_m: 1.5, oben_m: 2.5 }]), 2.55);
  });
});

describe("107-09 Task 2 — Solids je Schicht über den CSG-Kern", () => {
  it("Summe der Solid-Volumen an der Ecke = Handrechnung 5,8875 m³, je Schicht nach Priorität verteilt", async () => {
    const r = baender([A, B], 0);
    const s = await wandSolids(r.baender, null, { csg: kern });
    const a = /** @type {any} */ (s.get("w0")), b = /** @type {any} */ (s.get("w1"));
    assert.equal(a.quelle, "solid"); assert.equal(b.quelle, "solid");
    nah(a.volumen.solid_m3 + b.volumen.solid_m3, 5.8875, 1e-4);
    // per layer by hand: A core 0.83 · 2.5 = 2.075, A insulation 0.395 · 2.5 = 0.9875, B core 0.76 · 2.5 = 1.9, B insulation 0.37 · 2.5 = 0.925
    nah(a.volumen.jeSchicht[1].solid_m3, 2.075, 1e-4); nah(a.volumen.jeSchicht[0].solid_m3, 0.9875, 1e-4);
    nah(b.volumen.jeSchicht[1].solid_m3, 1.9, 1e-4); nah(b.volumen.jeSchicht[0].solid_m3, 0.925, 1e-4);
    // solid against baenderVolumen_m3 within the threshold of 107-14 (0.2 %)
    for (const e of [a, b]) assert.ok(Math.abs(e.volumen.solid_m3 - e.volumen.analytisch_m3) <= 0.002 * e.volumen.analytisch_m3);
    assert.equal(a.menge_m3, a.volumen.solid_m3);
  });

  it("Gruppe 0 / ungleiche Gruppen auch auf Solid-Ebene: boolesch wird nicht aufgerufen, Volumen = Summe der Einzelvolumen", async () => {
    for (const gb of [0, 2]) {
      let aufrufe = 0;
      const spion = { ...kern, boolesch: (/** @type {any[]} */ ...x) => { aufrufe += 1; return kern.boolesch(...x); } };
      const s = await geschossSolids([A, { ...B, verschneidungsgruppe: gb }], 0, { csg: spion });
      assert.equal(aufrufe, 0);
      nah([...s.values()].reduce((x, e) => x + /** @type {number} */ (e.volumen.solid_m3), 0), 6.0, 1e-4); // 3.0 + 3.0
    }
  });

  it("absichtlich verfälschtes Solid (Cache) → Warnung am Bauteil, Menge analytisch, keine Geometrie", async () => {
    const r = baender([A, B], 0);
    const falsch = quaderKoerper({ x0_m: -2, x1_m: 2, y0_m: 0, y1_m: 2.5, z0_m: -0.15, z1_m: 0.14, materialIndex: 1 }); // 1 cm too thin
    const s = await wandSolids(r.baender, null, { csg: kern, cache: { lesen: async () => falsch.clone() } });
    const a = /** @type {any} */ (s.get("w0"));
    assert.equal(a.quelle, "analytisch");
    assert.equal(a.geometrie, null);
    assert.equal(a.warnung.code, "csg-abweichung");
    nah(a.menge_m3, a.volumen.analytisch_m3);
    assert.match(csgWarnungText(a.warnung), /Menge aus der Handrechnung/);
  });

  it("offene Eingabe → Rückfall auf die Bänder in Menge und Plan", async () => {
    // T joint on A's insulation side: B's core (850) passes A's insulation (320) and cuts it → A's insulation solid needs a boolean
    const r = baender([T1, T2], 0);
    const offen = { ...kern, boolesch: () => ({ ok: false, grund: "offen", eingabe: "a", bericht: null }) };
    const s = await wandSolids(r.baender, null, { csg: offen });
    const a = /** @type {any} */ (s.get("w0"));
    assert.equal(a.quelle, "analytisch");
    assert.equal(a.warnung.code, "csg-offen");
    const pf = planFlaechen(r.baender, s, 1.1);
    assert.equal(pf.get("w0")?.quelle, "baender");
    nah(pf.get("w0")?.schichten.reduce((x, y) => x + y.ringe.reduce((q, ring) => q + ringFlaeche(ring), 0), 0) ?? 0, 2.38); // core 8 · 0.2 + insulation 0.78
  });

  it("T-Stoß auf der Kernseite auch im Solid: alle Schichten aus dem Körper, Summe = 3,555 m² · 2,5 m", async () => {
    const s = await wandSolids(baender([T1, T2K], 0).baender, null, { csg: kern });
    assert.deepEqual([...s.values()].map((e) => e.quelle), ["solid", "solid"]);
    nah([...s.values()].reduce((x, e) => x + /** @type {number} */ (e.volumen.solid_m3), 0), 3.555 * 2.5, 1e-4);
  });

  it("veraltete Solids (Review 107-09): nach einer Änderung gelten nur Einträge der heutigen Bänder, auch eine reine Verschiebung zählt", async () => {
    const r = baender([A, B], 0);
    const s = await wandSolids(r.baender, null, { csg: kern });
    assert.deepEqual([...aktuelleSolids(r.baender, s).keys()], ["w0", "w1"]); // same bands → both stay
    // B moved by 5 cm: B changed, and A changed through its joint → both fall back to the bands
    const r2 = baender([A, { ...B, a: { x: 4.05, z: -0.15 }, b: { x: 4.05, z: 3.85 } }], 0);
    assert.equal(aktuelleSolids(r2.baender, s).size, 0);
    // both walls moved by 1 m: the cache hash is the same (translation-free), the input signature is not
    const um = (/** @type {any} */ w) => ({ ...w, a: { x: w.a.x + 1, z: w.a.z }, b: { x: w.b.x + 1, z: w.b.z } });
    const r3 = baender([um(A), um(B)], 0);
    const s3 = await wandSolids(r3.baender, null, { csg: kern });
    assert.equal(s3.get("w0")?.cache.hash, s.get("w0")?.cache.hash);
    assert.equal(aktuelleSolids(r3.baender, s).size, 0);
    // the plan with today's bands and the stale result draws the bands, never the old solid at the old place
    const pf = planFlaechen(r3.baender, aktuelleSolids(r3.baender, s), 1.1);
    assert.deepEqual([...pf.values()].map((v) => v.quelle), ["baender", "baender"]);
  });

  it("Cache: ein gültiger Eintrag wird geschrieben und beim zweiten Lauf gelesen; ein geänderter Nachbar ändert den Hash", async () => {
    const r = baender([A, B], 0);
    /** @type {Map<string, any>} */
    const ablage = new Map();
    const cache = { lesen: async (/** @type {string} */ k, /** @type {string} */ h) => (ablage.get(k)?.h === h ? ablage.get(k).g.clone() : null), schreiben: async (/** @type {string} */ k, /** @type {string} */ h, /** @type {any} */ g) => { ablage.set(k, { h, g: g.clone() }); return true; } };
    const guids = new Map([["w0", "GUID-A"], ["w1", "GUID-B"]]);
    const s1 = await wandSolids(r.baender, guids, { csg: kern, cache });
    await new Promise((res) => setTimeout(res, 0));
    assert.deepEqual([...ablage.keys()].sort(), ["GUID-A|pbc", "GUID-B|pbc"]);
    const s2 = await wandSolids(r.baender, guids, { csg: kern, cache });
    assert.equal(s2.get("w0")?.ausCache, true);
    nah(/** @type {number} */ (s2.get("w0")?.volumen.solid_m3), /** @type {number} */ (s1.get("w0")?.volumen.solid_m3), 1e-9);
    // B moved by 5 cm: A's solid depends on its neighbour at the joint → another hash
    const r2 = baender([A, { ...B, a: { x: 4.05, z: -0.15 }, b: { x: 4.05, z: 3.85 } }], 0);
    const s3 = await wandSolids(r2.baender, guids, { csg: kern, cache: { lesen: async () => null } });
    assert.notEqual(s3.get("w0")?.cache.hash, s1.get("w0")?.cache.hash);
  });
});

describe("107-09 Task 2 — Robustheit auf realistischen Aufbauten (Befund 26.10.: Reihenfolge der Booleschen)", () => {
  it("Hülle cavity: alle vier Wände aus dem Solid, Summe = 16,56 m² · 3 m = 49,68 m³", async () => {
    const model = createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 1, storeyHeight: 3, wallComposite: "cavity" });
    const r = baender(verschneidungsWaende(model, []), 0);
    const s = await wandSolids(r.baender, null, { csg: kern });
    assert.deepEqual([...s.values()].map((e) => e.quelle), ["solid", "solid", "solid", "solid"]);
    nah([...s.values()].reduce((x, e) => x + /** @type {number} */ (e.volumen.solid_m3), 0), 49.68, 1e-3);
  });

  it("Golden-Szenario mit Fenstern in Hülle und Wand, T-Stoß (timber), Gruppe 0: alle Wände aus dem Solid, Decke gekürzt", async () => {
    const { model, opts } = ifcVerschneidungSzenario();
    const oeff = new Map([["cw:1", [{ u: 1.5, width: 1.2, height: 1.4, sill: 0.9 }]], ["env:0:0", [{ u: 2, width: 1.4, height: 1.4, sill: 0.9 }, { u: 6, width: 1.4, height: 1.4, sill: 0.9 }]]]);
    const mb = modellBaender(verschneidungsWaende(model, opts.customWalls, { geschosse: 3, oeffnungen: oeff }), { geschosse: 3 });
    const alle = [...mb.jeSchluessel.values()].flat();
    const s = await wandSolids(alle, null, { csg: kern });
    assert.equal(s.size, 12); // 8 hull walls (2 storeys) + 4 drawn walls with a build-up (the thickness-only wall takes no part)
    assert.deepEqual([...s.entries()].filter(([, e]) => e.quelle !== "solid").map(([k]) => k), []);
    const d = /** @type {any} */ (await deckenSolid({ ...opts.customSlabs[0], level: 0 }, wandKerne(alle), { csg: kern, geschosse: 3 }));
    assert.equal(d.quelle, "solid");
    assert.ok(d.volumen.analytisch_m3 < 20 * 0.22, "the slab lost the wall cores"); // 5 × 4 m slab, 0.22 m
  });
});

describe("107-09 Task 3 — Plan und Schnitt aus dem Solid", () => {
  it("Wand unter der Schnitthöhe (Review 107-09): Rückfall auf die Bänder statt einer leeren Wand, PDF zeichnet sie weiter", async () => {
    const niedrig = { schluessel: "cw:7", wand: { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-1", level: 0, height: 0.8, _idx: 7 }, unterkante_m: 0, hoehe_m: 0.8 };
    const r = baender([niedrig], 0);
    const s = await wandSolids(r.baender, null, { csg: kern });
    assert.equal(s.get("cw:7")?.quelle, "solid");
    const pf = /** @type {any} */ (planFlaechen(r.baender, s, 1.1).get("cw:7"));
    assert.equal(pf.quelle, "baender");
    nah(pf.schichten.reduce((/** @type {number} */ x, /** @type {any} */ y) => x + y.ringe.reduce((/** @type {number} */ q, /** @type {any} */ ring) => q + ringFlaeche(ring), 0), 0), 1.2); // 4 · 0.3
    const model = createBuildingModel({ storeys: 1, storeyHeight: 3 });
    const customWalls = [{ ...niedrig.wand }];
    const mitRingen = planGrafik({ model, level: 0, customWalls, schichtFlaechen: new Map([["cw:7", { baender: pf.schichten }]]) });
    const leer = planGrafik({ model, level: 0, customWalls, schichtFlaechen: new Map([["cw:7", { baender: [{ ringe: [] }] }]]) });
    const ohne = planGrafik({ model, level: 0, customWalls });
    const waende = (/** @type {any} */ g) => g.elemente.filter((/** @type {any} */ e) => e.ebene === "wand" && e.art === "poly").length;
    assert.equal(waende(mitRingen), waende(ohne) + 1); // two layer rings instead of the one rectangle
    assert.equal(waende(leer), waende(ohne)); // an entry without a ring keeps the rectangle
  });

  it("Schnitt mit Untergeschoss (Review 107-09): nur die UG-Wände haben Schichten, die oberirdischen Rechtecke bleiben", () => {
    const fp = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
    const model = createBuildingModel({ footprintM: fp, storeys: 2, storeyHeight: 3, untergeschosse: 1 });
    const mb = modellBaender(verschneidungsWaende(model, []), {});
    assert.ok([...mb.jeSchluessel.keys()].every((k) => k.startsWith("env:-1:")), "only the basement walls (single24) take part");
    const huelle = [...mb.jeSchluessel.values()].flat();
    const sf = schnittFlaechen(huelle, null, { a: { x: -60, z: 0 }, b: { x: 60, z: 0 } });
    assert.ok(sf.length >= 2);
    const g = schnittGrafik({ model, schnittFlaechen: sf });
    const hoehen = g.elemente.filter((e) => e.ebene === "wand").map((e) => { const zs = /** @type {any} */ (e).pts.map((/** @type {any} */ p) => -p.z); return `${Math.min(...zs).toFixed(1)}..${Math.max(...zs).toFixed(1)}`; });
    // both walls above ground stay (0 … 6 m), the basement walls come as layers (−3 … 0 m), no basement rectangle twice
    assert.equal(hoehen.filter((h) => h === "0.0..6.0").length, 2, hoehen.join(" "));
    assert.ok(hoehen.filter((h) => h.endsWith("..0.0")).length >= 2, hoehen.join(" "));
    const ohne = schnittGrafik({ model });
    assert.equal(ohne.elemente.filter((e) => e.ebene === "wand").length, 4); // without the switch: 2 walls above + 2 basement walls
    const links = /** @type {any} */ (sf.find((f) => f.ringe.some((ring) => ring.some((q) => q.x < 0))));
    const xs = links.ringe.flat().map((/** @type {any} */ q) => q.x);
    const wand = { von_m: Math.min(...xs), bis_m: Math.max(...xs) };
    assert.equal(schnittErsetzt(sf, wand, false), false); // an above-ground rectangle on that side is not replaced by basement layers
    assert.equal(schnittErsetzt(sf, wand, true), true);
  });

  it("Grundriss in Schnitthöhe zeigt die Lücke des Fensters; Schnitt durch die Wand kommt aus dem Solid", async () => {
    const mitFenster = { schluessel: "cw:1", wand: { ...T1, _idx: 1 }, unterkante_m: 0, hoehe_m: 2.5, oeffnungen: [{ u: 2, width: 1, height: 1.2, sill: 0.9 }] };
    const r = baender([mitFenster], 0);
    const s = await wandSolids(r.baender, null, { csg: kern });
    assert.equal(s.get("cw:1")?.quelle, "solid");
    // volume: 8 · 2.5 · 0.3 − 1 · 1.2 · 0.3 = 6.0 − 0.36 = 5.64
    nah(/** @type {number} */ (s.get("cw:1")?.volumen.solid_m3), 5.64, 1e-4);
    const pf = planFlaechen(r.baender, s, 1.1);
    assert.equal(pf.get("cw:1")?.quelle, "solid");
    // the cut at 1.1 m crosses the window (0.9 … 2.1): every layer in two pieces left and right of the hole
    for (const x of /** @type {any} */ (pf.get("cw:1")).schichten) assert.equal(x.ringe.length, 2);
    const ohneSchnittFenster = planFlaechen(r.baender, s, 0.5); // below the sill: one piece per layer
    for (const x of /** @type {any} */ (ohneSchnittFenster.get("cw:1")).schichten) assert.equal(x.ringe.length, 1);
    // section across the wall at x = 4 (line along z): layers as rectangles 0 … 2.5 m high (the hole is at x = 1.5 … 2.5, not here)
    const sf = schnittFlaechen(r.baender, s, { a: { x: 4, z: -5 }, b: { x: 4, z: 5 } });
    assert.equal(sf.length, 2);
    assert.ok(sf.every((f) => f.quelle === "solid"));
  });

  it("PDF-Plan und PDF-Schnitt: ohne Schalter unverändert, mit Schalter die Schichtumrisse statt des Wandrechtecks", async () => {
    const model = createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 1, storeyHeight: 3, wallComposite: "cavity" });
    const alt = JSON.stringify(planGrafik({ model, level: 0 }));
    assert.equal(JSON.stringify(planGrafik({ model, level: 0, schichtFlaechen: null })), alt);
    const mb = modellBaender(verschneidungsWaende(model, []), {});
    const r = /** @type {any} */ (mb.jeGeschoss.get(0));
    const pf = planFlaechen(r.baender, null, 1.1);
    const neu = planGrafik({ model, level: 0, schichtFlaechen: new Map([...pf].map(([k, v]) => [k, { baender: v.schichten }])) });
    // the poché of the cleaned layers covers the hull exactly once: 16.56 m² (outer 10.46 · 8.46 − inner 9.54 · 7.54); at the corners some thin
    // layers (air, plaster) are islands where they cross a layer of equal priority of the other wall (rule 5, first drawn keeps the cell)
    const flaecheVon = (/** @type {Array<{x: number, z: number}>} */ r) => Math.abs(r.reduce((z, q, i) => { const n = r[(i + 1) % r.length]; return z + q.x * n.z - n.x * q.z; }, 0) / 2);
    const waende = neu.elemente.filter((e) => e.ebene === "wand" && e.art === "poly");
    assert.ok(waende.length >= 20);
    nah(waende.reduce((x, e) => x + flaecheVon(/** @type {any} */ (e).pts), 0), 16.56, 1e-6);
    const sAlt = JSON.stringify(schnittGrafik({ model }));
    assert.equal(JSON.stringify(schnittGrafik({ model, schnittFlaechen: null })), sAlt);
    const sf = schnittFlaechen(r.baender, null, { a: { x: -60, z: 0 }, b: { x: 60, z: 0 } });
    assert.equal(sf.length, 10); // the two side walls cut by z = 0, 5 layers each (z = 0 is far from the corners)
    const sNeu = schnittGrafik({ model, schnittFlaechen: sf });
    assert.equal(sNeu.elemente.filter((e) => e.ebene === "wand").length, 10);
    // each side wall cut over its full thickness 0.46 m and height 3 m: 2 · 0.46 · 3 = 2.76 m²
    nah(sNeu.elemente.filter((e) => e.ebene === "wand").reduce((x, e) => x + flaecheVon(/** @type {any} */ (e).pts), 0), 2.76, 1e-6);
  });
});

describe("107-09 Task 4 — Decke um die Wandkerne gekürzt", () => {
  it("Rohdecke 850 an Wandkern 850 (single24): Abzug im Solid = Handrechnung; Gruppe 0 kürzt nicht", async () => {
    const w1 = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, composite: "single24", level: 0, height: 3 };
    const w2 = { a: { x: 6, z: 0 }, b: { x: 6, z: 4 }, composite: "single24", level: 0, height: 3 };
    const r = baender([w1, w2], 0);
    const kerne = wandKerne(r.baender);
    // a drawn slab of level 0 lies with its top on the ceiling of that storey (deckenLage "decke": 2.78 … 3.0 m)
    const decke = { _idx: 9, points: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 0, z: 4 }], level: 0, composite: "single24" };
    assert.equal(deckenPrioritaet(decke), 850);
    const d = /** @type {any} */ (await deckenSolid(decke, kerne, { csg: kern, geschosse: 3 }));
    // slab 2.78 … 3.0 m (0.22 m); the walls reach up to 3.0 → overlap 0.22 m.
    // core inside the slab outline: w1 strip z ∈ [0; 0.12] over x ∈ [0; 6] = 0.72 m², w2 strip x ∈ [5.88; 6] over z ∈ [0.12; 4] = 0.4656 m²
    // (w1 runs through to x = 6.12 and w2 abuts at z = 0.12, both cut to the slab) → (24 − 1.1856) · 0.22 = 5.019168 m³
    nah(d.volumen.analytisch_m3, (24 - 1.1856) * 0.22, 1e-6);
    assert.equal(d.quelle, "solid");
    nah(d.volumen.solid_m3, d.volumen.analytisch_m3, 1e-4);
    const ohne = /** @type {any} */ (await deckenSolid({ ...decke, verschneidungsgruppe: 0 }, kerne, { csg: kern, geschosse: 3 }));
    nah(ohne.volumen.analytisch_m3, 24 * 0.22, 1e-6);
    assert.equal(await deckenSolid({ ...decke, composite: undefined }, kerne, { csg: kern }), null); // no build-up: today's slab stays
  });

  it("Gegenfall (Review 107-09): Mauerwerkskern 650 unter Betondecke 850 — die Wand verliert die Decke, keine doppelte Menge", async () => {
    const mw = { schicht_prioritaet: { 0: 650 } }; // single24 with a masonry priority (element override of 107-03)
    const w1 = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, composite: "single24", level: 0, height: 3, ...mw };
    const w2 = { a: { x: 6, z: 0 }, b: { x: 6, z: 4 }, composite: "single24", level: 0, height: 3, ...mw };
    const decke = { _idx: 9, points: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 0, z: 4 }], level: 0, composite: "single24" };
    const roh = baender([w1, w2], 0).baender;
    const kerne = wandKerne(roh);
    const d = /** @type {any} */ (await deckenSolid(decke, kerne, { csg: kern, geschosse: 3 }));
    nah(d.volumen.analytisch_m3, 24 * 0.22, 1e-9); // the slab ranks higher: it keeps the overlap (no core of ≥ 850)
    const mitD = mitDeckenAbzuegen(roh, [decke], { geschosse: 3 });
    const s = await wandSolids(mitD, null, { csg: kern });
    // by hand: w1 runs through to x = 6.12 (drawn first), 6.12 · 0.24 · 3 = 4.4064, loses x ∈ [0; 6] × z ∈ [0; 0.12] over 0.22 m = 0.1584;
    // w2 from z = 0.12, 3.88 · 0.24 · 3 = 2.7936, loses x ∈ [5.88; 6] × z ∈ [0.12; 4] over 0.22 m = 0.102432
    nah(/** @type {number} */ (s.get("w0")?.volumen.analytisch_m3), 4.4064 - 0.1584, 1e-9);
    nah(/** @type {number} */ (s.get("w1")?.volumen.analytisch_m3), 2.7936 - 0.102432, 1e-9);
    assert.deepEqual([...s.values()].map((e) => e.quelle), ["solid", "solid"]);
    for (const e of s.values()) nah(/** @type {number} */ (e.volumen.solid_m3), e.volumen.analytisch_m3, 1e-4);
    // walls + slab = union: 7.2 + 5.28 − overlap (0.72 + 0.4656) · 0.22 = 12.219168 m³
    nah([...s.values()].reduce((x, e) => x + e.menge_m3, 0) + d.menge_m3, 7.2 + 5.28 - 1.1856 * 0.22, 1e-4);
    assert.deepEqual([...deckenKuerzungen(mitD, [decke], { geschosse: 3 }).entries()], [[9, { kerne: false, waende: ["w0", "w1"] }]]);
    // concrete core 850 (default): the slab is cut, the walls are not
    const r850 = baender([{ ...w1, schicht_prioritaet: undefined }, { ...w2, schicht_prioritaet: undefined }], 0).baender;
    assert.deepEqual([...deckenKuerzungen(mitDeckenAbzuegen(r850, [decke], { geschosse: 3 }), [decke], { geschosse: 3 }).entries()], [[9, { kerne: true, waende: [] }]]);
  });

  it("Decken-Cache (Review 107-09): gelesen vor dem Rechnen, Schreibfehler gemeldet statt verschluckt; veraltete Decke fällt heraus", async () => {
    const w1 = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, composite: "single24", level: 0, height: 3 };
    const decke = { _idx: 9, points: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 0, z: 4 }], level: 0, composite: "single24" };
    const kerne = wandKerne(baender([w1], 0).baender);
    /** @type {Map<string, any>} */
    const ablage = new Map();
    /** @type {string[]} */
    const warnungen = [];
    const altWarn = console.warn;
    console.warn = (/** @type {any[]} */ ...x) => { warnungen.push(x.join(" ")); };
    try {
      const cache = { lesen: async (/** @type {string} */ k, /** @type {string} */ h) => (ablage.get(k)?.h === h ? ablage.get(k).g.clone() : null), schreiben: async (/** @type {string} */ k, /** @type {string} */ h, /** @type {any} */ g) => { ablage.set(k, { h, g: g.clone() }); return true; } };
      const d1 = /** @type {any} */ (await deckenSolid(decke, kerne, { csg: kern, geschosse: 3, cache }));
      await new Promise((res) => setTimeout(res, 0));
      assert.equal(d1.ausCache, false);
      const d2 = /** @type {any} */ (await deckenSolid(decke, kerne, { csg: kern, geschosse: 3, cache }));
      assert.equal(d2.ausCache, true);
      assert.equal(d2.quelle, "solid");
      nah(d2.volumen.solid_m3, d1.volumen.solid_m3, 1e-9);
      await deckenSolid(decke, kerne, { csg: kern, geschosse: 3, cache: { schreiben: async () => { throw new Error("voll"); } } });
      await new Promise((res) => setTimeout(res, 0));
      assert.ok(warnungen.some((w) => /decke-pbc not written \(voll\)/.test(w)), warnungen.join(" | "));
      // freshness: the same slab stays, a moved slab drops out
      assert.equal(aktuelleDecken([decke], kerne, new Map([[d1.schluessel, d1]]), { geschosse: 3 }).size, 1);
      const verschoben = { ...decke, points: decke.points.map((p) => ({ x: p.x + 0.5, z: p.z })) };
      assert.equal(aktuelleDecken([verschoben], kerne, new Map([[d1.schluessel, d1]]), { geschosse: 3 }).size, 0);
    } finally {
      console.warn = altWarn;
    }
  });
});

describe("107-09 Task 5 — IFC und Mengen", () => {
  /** volumes of the IfcWall rows of a STEP text (extruded items, arbitrary or rectangle profiles), in the file order */
  function wandVolumen(/** @type {string} */ text) {
    const rows = new Map(text.split("\n").filter((z) => z.startsWith("#")).map((z) => [z.slice(0, z.indexOf("=")), z.slice(z.indexOf("=") + 1)]));
    const refs = (/** @type {string} */ s) => s.match(/#\d+/g) || [];
    const punkt = (/** @type {string} */ id) => /** @type {number[]} */ ((/** @type {string} */ (rows.get(id))).match(/\(\(([^)]*)\)\)/)?.[1].split(",").map(Number));
    const flaeche = (/** @type {string} */ id) => {
      const p = /** @type {string} */ (rows.get(id));
      if (p.startsWith("IFCRECTANGLEPROFILEDEF")) { const n = p.slice(0, -2).split(","); return Number(n[3]) * Number(n[4]); }
      const pts = refs(/** @type {string} */ (rows.get(refs(p)[0]))).map(punkt);
      let a = 0;
      for (let i = 0; i + 1 < pts.length; i += 1) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
      return Math.abs(a) / 2;
    };
    return [...rows.entries()].filter(([, z]) => z.startsWith("IFCWALL(")).map(([, z]) => {
      const pds = /** @type {string} */ (rows.get(refs(z)[1]));
      const sr = /** @type {string} */ (rows.get(refs(pds)[0]));
      return refs(sr).slice(1).reduce((s, item) => {
        const it = /** @type {string} */ (rows.get(item));
        return s + flaeche(refs(it)[0]) * Number(it.slice(0, -2).split(",").pop());
      }, 0);
    });
  }

  it("Summe der IFC-Wandvolumen an der Ecke ≤ geometrisches Gesamtvolumen (5,8875 m³); ohne Schalter überzählt (6,0 m³)", () => {
    const model = createBuildingModel({ storeys: 1, storeyHeight: 2.5 });
    const customWalls = [{ ...A, _idx: 1 }, { ...B, _idx: 2 }];
    const ohne = wandVolumen(exportIFC(model, { customWalls, storeyHeight: 2.5 })).slice(-2);
    nah(ohne[0] + ohne[1], 6.0, 1e-3);
    const mb = modellBaender(verschneidungsWaende(model, customWalls, { geschosse: 2.5 }), { geschosse: 2.5 });
    const text = exportIFC(model, { customWalls, storeyHeight: 2.5, verschneidung: { jeSchluessel: mb.jeSchluessel } });
    const mit = wandVolumen(text).slice(-2);
    assert.ok(mit[0] + mit[1] <= 5.8875 + 1e-3, `IFC ${mit[0] + mit[1]}`);
    nah(mit[0] + mit[1], 5.8875, 1e-3);
    // still one IfcWall per wall, with one body item per band piece (2 layers each)
    assert.equal((text.match(/=IFCWALL\(/g) || []).length, 6);
  });

  it("Wand ohne Aufbau und Standard-Hülle bleiben byte-gleich (rectSolid), auch mit Schalter", () => {
    const model = createBuildingModel({ storeys: 2, storeyHeight: 3 });
    const customWalls = [{ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.24, level: 0, height: 3, _idx: 1 }, { a: { x: 4, z: 0 }, b: { x: 4, z: 3 }, thickness: 0.24, level: 0, height: 3, _idx: 2 }];
    const mb = modellBaender(verschneidungsWaende(model, customWalls, { geschosse: 3 }), { geschosse: 3 });
    assert.equal(mb.jeSchluessel.size, 0);
    assert.equal(exportIFC(model, { customWalls, verschneidung: { jeSchluessel: mb.jeSchluessel } }), exportIFC(model, { customWalls }));
  });

  it("Altexport (Schalter aus) = Golden aus 107-01; der Export lädt keinen CSG-Code", () => {
    // the golden itself is checked by ifcGolden-10701.test.js; here: no static path from the export or the bands to the CSG core
    for (const datei of ["../../packages/nova-designer/src/lib/ifcExport.js", "../../packages/nova-core/src/lib/bauteil/verschneidung.js", "../../packages/nova-designer/src/components/BimPlan2D.jsx", "../../packages/nova-designer/src/lib/vektorPlan.js"]) {
      assert.doesNotMatch(lies(datei), /from\s+["'][^"']*\/csg\//, datei);
    }
    // the studio imports the module of bands and solids only dynamically (switch on); statically only the hook and the small warning text
    const studio = lies("../../packages/nova-designer/src/components/BitBimStudio.jsx");
    assert.doesNotMatch(studio, /from\s+["']@core\/lib\/bauteil\/(solidAbleitung|verschneidung)\.js["']/);
    assert.match(studio, /import\("@core\/lib\/bauteil\/solidAbleitung\.js"\)/);
    assert.doesNotMatch(lies("../../packages/nova-designer/src/lib/useCsgCache.js"), /from\s+["']@core\/lib\/csg\//);
    // the warning text of the data sheet comes from bauteil/csgWarnung.js — no static request below lib/csg/ in the studio or the sheet
    for (const datei of ["../../packages/nova-designer/src/components/SteckbriefFelder.jsx", "../../packages/nova-designer/src/components/BitBimStudio.jsx"]) {
      assert.doesNotMatch(lies(datei), /from\s+["']@core\/lib\/csg\//, datei);
    }
  });

  it("zweites Golden: Ausgabe mit Schalter (Hülle cavity, Ecke, T-Stoß, Fenster, Gruppe 0, Wand ohne Aufbau, Decke mit Aufbau)", () => {
    const { model, opts } = ifcVerschneidungSzenario();
    const mb = modellBaender(verschneidungsWaende(model, opts.customWalls, { geschosse: 3 }), { geschosse: 3 });
    /** @type {any[]} */
    const warn = [];
    const text = exportIFC(model, { ...opts, verschneidung: { jeSchluessel: mb.jeSchluessel }, onWarn: (m, art, d) => warn.push({ art, d }) });
    const pfad = fileURLToPath(new URL("./fixtures/ifc-golden-107-verschneidung.ifc", import.meta.url));
    assert.ok(existsSync(pfad), "Golden fehlt");
    assert.equal(text, readFileSync(pfad, "utf8"));
    assert.deepEqual(warn.filter((w) => w.art === WARNART_VERSCHNEIDUNG).map((w) => w.d.nr), [20]);
    // without the option the same model writes no band items: the text differs and has no slab warning
    assert.notEqual(exportIFC(model, opts), text);
    // review 107-09: with the cut list of the studio only really cut slabs are named — slab 20 (level 1) meets no wall core and no
    // lower wall layer, so no note; the file stays the same
    const mitD = mitDeckenAbzuegen([...mb.jeSchluessel.values()].flat(), opts.customSlabs, { geschosse: 3 });
    /** @type {any[]} */
    const warn2 = [];
    const text2 = exportIFC(model, { ...opts, verschneidung: { jeSchluessel: mb.jeSchluessel, decken: deckenKuerzungen(mitD, opts.customSlabs, { geschosse: 3 }) }, onWarn: (m, art, d) => warn2.push({ art, d }) });
    assert.equal(text2, text);
    assert.deepEqual(warn2.filter((w) => w.art === WARNART_VERSCHNEIDUNG), []);
    // the same slab on level 0 cuts the single24 cores (850 = 850) and itself cuts the timber wall cw:3 (lower priority): both named
    const auf0 = opts.customSlabs.map((/** @type {any} */ x) => ({ ...x, level: 0 }));
    /** @type {any[]} */
    const warn3 = [];
    exportIFC(model, { ...opts, customSlabs: auf0, verschneidung: { jeSchluessel: mb.jeSchluessel, decken: deckenKuerzungen(mitDeckenAbzuegen([...mb.jeSchluessel.values()].flat(), auf0, { geschosse: 3 }), auf0, { geschosse: 3 }) }, onWarn: (m, art, d) => warn3.push({ art, d }) });
    assert.deepEqual(warn3.filter((w) => w.art === WARNART_VERSCHNEIDUNG).map((w) => w.d), [{ nr: 20 }, { nr: 20, waende: ["cw:3"] }]);
  });

  it("Wand ohne Restfläche (Review 107-09): kein leerer IFC-Körper, Rechteck plus Meldung", () => {
    const model = createBuildingModel({ storeys: 1, storeyHeight: 3 });
    const customWalls = [{ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "single24", level: 0, height: 3, _idx: 1 }];
    /** @type {any[]} */
    const warn = [];
    const text = exportIFC(model, { customWalls, verschneidung: { jeSchluessel: new Map([["cw:1", [{ umrisse: [] }]]]) }, onWarn: (m, art, d) => warn.push({ art, d }) });
    assert.doesNotMatch(text, /'SweptSolid',\(\)\)/);
    assert.equal(text, exportIFC(model, { customWalls })); // the whole rectangle, as without the switch
    assert.deepEqual(warn.filter((w) => w.art === WARNART_VERSCHNEIDUNG).map((w) => w.d), [{ schluessel: "cw:1", leer: true }]);
  });

  it("Werkstatt: Pauschale „lichte Länge + 1 × Dicke“ gegen die echte Verschneidung — Abweichung festgehalten, nicht ersetzt", () => {
    // one workshop room 5 × 4 m: four exterior walls (class "aussen", 0.365 m hlz) centred on the room edges
    const zonen = [{ name: `Wohnen${WT_MARKER}`, level: 0, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] }];
    const w = werkstattWaende(zonen, { storeyHeight: 3 });
    assert.equal(w.length, 4);
    const pauschal = w.reduce((s, x) => s + x.rohbauLaenge_m, 0); // Σ (l + d) = 18 + 4 · 0.365 = 19.46 m
    nah(pauschal, 19.46, 1e-9);
    const r = baender(w.map((x) => ({ a: x.a, b: x.b, klasse: x.klasse, level: x.level, height: x.hoehe_m })), 0);
    const echt = baenderFlaeche_m2(r.baender) / 0.365; // centre-line rule: 18 m (the closed loop counts each corner once)
    nah(echt, 18, 1e-6);
    // KD-15: the lump sum counts every corner square twice — 4 · d = 1.46 m length, 4 · d² · h = 1.5987 m³ too much. Reported here and in
    // the 107-09 summary; the workshop keeps its lump sum until the user decides (no silent replacement).
    nah(pauschal - echt, 1.46, 1e-6);
  });
});

describe("107-09 Task 6 — Gruppe im Steckbrief, Store und Fingerabdruck", () => {
  it("verschneidungsgruppe: Standard 1 (offen), gesetzt 0 … n, Unsinn = Standard", () => {
    assert.equal(verschneidungsgruppe({}), 1);
    assert.equal(verschneidungsgruppe({ verschneidungsgruppe: 0 }), 0);
    assert.equal(verschneidungsgruppe({ verschneidungsgruppe: 3 }), 3);
    assert.equal(verschneidungsgruppe({ verschneidungsgruppe: -1 }), 1);
    assert.equal(verschneidungsgruppe({ verschneidungsgruppe: 1.5 }), 1);
    const w = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "cavity", level: 0, height: 3, _idx: 1 };
    assert.deepEqual(steckbrief(w, "wand-aussen").verschneidungsgruppe, { wert: 1, quelle: "offen" });
    assert.deepEqual(steckbrief({ ...w, verschneidungsgruppe: 0 }, "wand-aussen").verschneidungsgruppe, { wert: 0, quelle: "gesetzt" });
    assert.equal(steckbrief(w, "wand-aussen").verschneidung, null);
    const v = { quelle: "analytisch", menge_m3: 1.5, warnung: { code: "csg-offen", eingabe: "a" } };
    assert.deepEqual(steckbrief(w, "wand-aussen", { verschneidung: /** @type {any} */ (v) }).verschneidung, v);
  });

  it("Geräteabgleich (Review 107-09): ungenutzter Schalter (lokal false) gegen fremdes Einschalten ist kein Konflikt", () => {
    const r = fremdeElementeAbgleichen({ patch: { verschneidung: true }, vorher: {}, lokal: { verschneidung: false }, felder: ["verschneidung"] });
    assert.deepEqual(r.setzen, { verschneidung: true });
    assert.deepEqual(r.konflikte, {});
    // false and a missing field are the same: the other device switched it off again, this page never touched it → nothing to do
    const aus = fremdeElementeAbgleichen({ patch: { verschneidung: false }, vorher: {}, lokal: { verschneidung: false }, felder: ["verschneidung"] });
    assert.deepEqual(aus.setzen, {});
    assert.deepEqual(aus.konflikte, {});
    // switched off on the other device (base on, this page unchanged): taken over, the setter reads undefined as off
    const k = fremdeElementeAbgleichen({ patch: { verschneidung: false }, vorher: { verschneidung: true }, lokal: { verschneidung: true }, felder: ["verschneidung"] });
    assert.ok("verschneidung" in k.setzen && k.setzen.verschneidung === undefined);
    assert.deepEqual(k.konflikte, {});
  });

  it("Schalter im Fingerabdruck: aus = Feld fehlt (alte Blätter bleiben gültig), an = Eintrag", () => {
    assert.equal(kennungWert("verschneidung", undefined), null);
    assert.equal(kennungWert("verschneidung", false), null);
    assert.equal(kennungWert("verschneidung", true), true);
  });

  it("der leere Cache-Layer des Hooks entspricht CSG_CACHE_LEER", () => {
    const quelle = lies("../../packages/nova-designer/src/lib/useCsgCache.js");
    assert.match(quelle, /CSG_CACHE_LEER_HOOK = Object\.freeze\(\{ eintraege: Object\.freeze\(\{\}\) \}\)/);
    assert.deepEqual(JSON.parse(JSON.stringify(CSG_CACHE_LEER)), { eintraege: {} });
  });

  it("Solid-Geometrie bleibt three-Instanz des Tests (Gruppen je Schicht)", async () => {
    const s = await geschossSolids([A, B], 0, { csg: kern });
    const g = /** @type {any} */ (s.get("w0")?.geometrie);
    assert.ok(g instanceof THREE.BufferGeometry);
    assert.deepEqual([...new Set(g.groups.map((/** @type {any} */ x) => x.materialIndex))].sort(), [0, 1]);
    nah(bandVolumen_m3(/** @type {any} */ (band(baender([A, B], 0), "w0", 1))), 2.075);
  });
});

describe("107-09 Review-Pflicht aus 107-14 — Konflikt auf csg_cache_layer wird verworfen, nicht als Karte gezeigt", () => {
  it("409: beide Geräte ändern den Cache → gespeicherte Fassung bleibt, keine Konfliktkarte, kein Sperren; ein Fachlayer bleibt ein Konflikt", async () => {
    const altFetch = globalThis.fetch;
    const T0 = "2026-10-26T11:00:00.000Z", T1 = "2026-10-26T11:05:00.000Z", T2 = "2026-10-26T11:06:00.000Z";
    const gespeichert = { id: "bmV", project_id: "pV", updated_date: T0, csg_cache_layer: { eintraege: { a: 1 } }, netz_layer: { a: 1 } };
    const fremd = { ...gespeichert, updated_date: T1, csg_cache_layer: { eintraege: { b: 2 } }, netz_layer: { a: 2 } };
    /** @type {any[]} */ const puts = [];
    globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
      const u = String(url);
      if ((opt.method || "GET") === "GET") return { ok: true, status: 200, headers: { get: () => null }, json: async () => [gespeichert] };
      puts.push({ url: u, body: JSON.parse(opt.body) });
      if (u.includes(`stand=${encodeURIComponent(T0)}`)) return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ konflikt: true, gespeichert: fremd }) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...fremd, ...JSON.parse(opt.body), updated_date: T2 }) };
    });
    try {
      const sync = await import("@core/lib/useBimModelSync");
      const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
      assert.deepEqual([...sync.VERWERFBARE_FELDER], ["csg_cache_layer"]);
      await sync.loadBimModel("pV");
      await sync.saveBimModel("pV", { csg_cache_layer: { eintraege: { c: 3 } }, netz_layer: { a: 3 } });
      const felder = abgleichStand.stand().konflikte.map((k) => k.feld);
      assert.ok(felder.includes("netz_layer"), "a real layer stays a conflict");
      assert.equal(felder.includes("csg_cache_layer"), false, "the cache is discarded, no card");
      assert.equal(sync.feldGesperrt("pV", "csg_cache_layer"), false, "and not held back");
      assert.ok(puts.every((p) => !("csg_cache_layer" in p.body) || p.url.includes(`stand=${encodeURIComponent(T0)}`)), "this page's cache version is not written over the stored one");
    } finally {
      globalThis.fetch = altFetch;
    }
  });
});
