// 107-01 review fixes: the hull words "outside"/"inside" mean the same for both windings of the footprint, the section follows the
// hull reference line, the neighbourhood check and the plan preview of 106 use the one derivation, the data sheet calls a core
// reference line without a core "abgeleitet", corner fillers of mixed thicknesses and references. Pure functions, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBuildingModel, compositeTotalM } from "@core/lib/buildingModel";
import { wandGeometrie, wandDicke_m, eckfueller, huellSchnittWaende } from "@core/lib/bauteil/referenz.js";
import { steckbrief, bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { planFormen, umrissVon, wandDicke } from "@core/lib/zeigen/planVorschau.js";
import { pruefeAenderung } from "@core/lib/zeigen/pruefung.js";
import { exportIFC } from "@designer/lib/ifcExport";
import { schnittGrafik } from "@designer/lib/vektorPlan";
import { EN } from "@core/lib/i18nTeile/bauteilkern-107.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
/** Rectangle 20 × 12 m around the origin: winding with a positive shoelace sum in x/z (the editor default) and the reverse. */
const FP = [{ x: -10, z: -6 }, { x: 10, z: -6 }, { x: 10, z: 6 }, { x: -10, z: 6 }];
const FP_UMGEKEHRT = [...FP].reverse();
const BOX = { x0: -10, x1: 10, z0: -6, z1: 6 };
const imKasten = (/** @type {{x: number, z: number}[]} */ pts) => pts.every((p) => p.x >= BOX.x0 - 1e-9 && p.x <= BOX.x1 + 1e-9 && p.z >= BOX.z0 - 1e-9 && p.z <= BOX.z1 + 1e-9);
const ausserhalb = (/** @type {{x: number, z: number}[]} */ pts) => pts.every((p) => p.x <= BOX.x0 + 1e-9 || p.x >= BOX.x1 - 1e-9 || p.z <= BOX.z0 + 1e-9 || p.z >= BOX.z1 - 1e-9);

describe("107-01 Review: Hüllbezug unabhängig vom Umlaufsinn des Footprints", () => {
  for (const [name, fp] of [["Standard-Umlauf", FP], ["umgekehrter Umlauf", FP_UMGEKEHRT]]) {
    it(`${name}: outside = Wandkörper im Footprint (Linie = Außenfläche), inside = Wandkörper außerhalb, center = mittig`, () => {
      const m = (/** @type {any} */ b) => createBuildingModel({ footprintM: fp, storeys: 1, wallThickness: 0.3, huelleBezug: b });
      for (const w of m("outside").walls) assert.ok(imKasten(wandGeometrie(w).polygon), `outside ${JSON.stringify(w.a)}`);
      for (const w of m("inside").walls) assert.ok(ausserhalb(wandGeometrie(w).polygon), `inside ${JSON.stringify(w.a)}`);
      for (const w of m("center").walls) nah(Math.abs(wandGeometrie(w).versatz_m), 0);
      for (const p of m("outside").parapets) assert.ok(imKasten(wandGeometrie(p).polygon), "die Attika folgt der Hülle");
    });
  }
  it("beide Umläufe geben dieselben Wandkörper (nur die Reihenfolge der Kanten ist anders)", () => {
    const key = (/** @type {any} */ b, fp) => createBuildingModel({ footprintM: fp, storeys: 1, wallThickness: 0.3, huelleBezug: b }).walls
      .map((w) => { const p = wandGeometrie(w).polygon; return [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x)), Math.min(...p.map((q) => q.z)), Math.max(...p.map((q) => q.z))].map((v) => Math.round(v * 1e6)).join(","); }).sort();
    for (const b of ["outside", "inside"]) assert.deepEqual(key(b, FP), key(b, FP_UMGEKEHRT), b);
  });
  it("center und fehlendes Feld bleiben unberührt (keine refLine), Footprint/Decken/Räume nie versetzt", () => {
    assert.ok(createBuildingModel({ footprintM: FP_UMGEKEHRT, storeys: 1 }).walls.every((w) => !("refLine" in w)));
    const a = createBuildingModel({ footprintM: FP_UMGEKEHRT, storeys: 1 }), b = createBuildingModel({ footprintM: FP_UMGEKEHRT, storeys: 1, huelleBezug: "outside" });
    assert.deepEqual(b.footprint, a.footprint); assert.deepEqual(b.slabs, a.slabs); assert.deepEqual(b.spaces, a.spaces);
  });
});

describe("107-01 Review: Schnitt der Hülle folgt dem Bezug", () => {
  const modell = (/** @type {any} */ b, fp = FP, extra = {}) => createBuildingModel({ footprintM: fp, storeys: 2, wallThickness: 0.3, huelleBezug: b, ...extra });
  const rund = (/** @type {any[]} */ l) => l.map((s) => [s.von_m, s.bis_m, s.dicke_m].map((v) => Math.round(v * 1e6) / 1e6));
  it("center: der Schnitt folgt der Linie wie Plan und 3D (Nutzerentscheid 25.10.: alte Schnitte verschieben sich um die halbe Dicke)", () => {
    // before 107-03 this section drew [-10, -9.7] / [9.7, 10] (inside the footprint box) while plan, 3D and IFC centred the wall on the line
    assert.deepEqual(rund(huellSchnittWaende(modell("center"))), [[-10.15, -9.85, 0.3], [9.85, 10.15, 0.3]]);
    assert.deepEqual(rund(huellSchnittWaende(modell(undefined))), [[-10.15, -9.85, 0.3], [9.85, 10.15, 0.3]]);
  });
  it("outside: Körper im Footprint, inside: Körper außerhalb — für beide Umläufe gleich", () => {
    for (const fp of [FP, FP_UMGEKEHRT]) {
      assert.deepEqual(rund(huellSchnittWaende(modell("outside", fp))), [[-10, -9.7, 0.3], [9.7, 10, 0.3]]);
      assert.deepEqual(rund(huellSchnittWaende(modell("inside", fp))), [[-10.3, -10, 0.3], [10, 10.3, 0.3]]);
    }
  });
  it("der Schnitt zeichnet dieselben Kanten wie der Grundriss-Wandkörper (PDF-Schnitt und Wandgeometrie)", () => {
    for (const b of ["outside", "inside"]) {
      const g = schnittGrafik({ model: modell(b), storeyHeight: 3 });
      const waende = g.elemente.filter((e) => e.ebene === "wand");
      const xs = waende.map((e) => [Math.min(...e.pts.map((p) => p.x)), Math.max(...e.pts.map((p) => p.x))].map((v) => Math.round(v * 1e6) / 1e6));
      assert.deepEqual(xs, b === "outside" ? [[-10, -9.7], [9.7, 10]] : [[-10.3, -10], [10, 10.3]], b);
      const dach = g.elemente.filter((e) => e.ebene === "dach");
      assert.equal(dach.length, 2, "Attika folgt der Wand");
      assert.deepEqual(dach.map((e) => [Math.min(...e.pts.map((p) => p.x)), Math.max(...e.pts.map((p) => p.x))].map((v) => Math.round(v * 1e6) / 1e6)), xs);
    }
  });
  it("Aufbau als Dicke: die Wandkörper des Schnitts sind so dick wie der Aufbau", () => {
    const d = /** @type {number} */ (compositeTotalM("cavity"));
    const [l, r] = huellSchnittWaende(modell("inside", FP, { wallComposite: "cavity" }));
    nah(l.dicke_m, d, 1e-9); nah(r.dicke_m, d, 1e-9);
    nah(l.bis_m, -10, 1e-9); nah(r.von_m, 10, 1e-9);
  });
  it("ohne Footprint keine Schnittwände, nie NaN", () => {
    assert.deepEqual(huellSchnittWaende({}), []);
    assert.deepEqual(huellSchnittWaende({ footprint: [] }), []);
  });
});

describe("107-01 Review: Nachbarschaftsprüfung und Planvorschau (106) benutzen die eine Ableitung", () => {
  const P = "p1";
  const w = (idx, extra = {}) => ({ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.2, height: 3, _idx: idx, ...extra });
  const leer = { customColumns: [], customWindows: [], envOpenings: [], customZones: [], customSlabs: [], customRoofs: [] };
  const guid = (/** @type {any} */ x) => bauteilGuid(P, "customWalls", x);

  it("die Dicke der Planvorschau ist die Regel von wandDicke_m (Aufbau, Dicke, 0,30 m)", () => {
    for (const x of [{ composite: "cavity" }, { thickness: 0.115 }, {}, { composite: "unbekannt", thickness: 0.2 }]) assert.equal(wandDicke(x), wandDicke_m(x));
  });
  it("umrissVon einer Wand = Polygon von wandGeometrie, auch mit outside/inside/center", () => {
    for (const refLine of [undefined, "center", "outside", "inside"]) {
      const x = w(1, { b: { x: 4, z: 3 }, ...(refLine ? { refLine } : {}) });
      assert.deepEqual(umrissVon(x), wandGeometrie(x).polygon, String(refLine));
    }
    // outside: the body lies on the +n side → the −n face is the line (hand calculation: a=(0,0)→b=(6,0), n=(0,1), d=0.2)
    const o = umrissVon(w(1, { refLine: "outside" }));
    nah(Math.min(...o.map((p) => p.z)), 0); nah(Math.max(...o.map((p) => p.z)), 0.2);
  });
  it("planFormen: die Schnittlinie beim Teilen quert den versetzten Wandkörper mittig", () => {
    const m = { ...leer, customWalls: [w(1, { refLine: "outside" })] };
    const [f] = planFormen(m, { art: "teilen", ziel: { guid: guid(m.customWalls[0]) }, params: { punkt_m: { x: 3, z: 0 } } }, { projektId: P });
    assert.equal(f.typ, "linie");
    nah(f.punkte[0].x, 3); nah(f.punkte[1].x, 3);
    // body z ∈ [0, 0.2], 0.3 m overhang beyond each face → [−0.3, 0.5]
    nah(Math.max(...f.punkte.map((p) => p.z)), 0.5); nah(Math.min(...f.punkte.map((p) => p.z)), -0.3);
    // without an offset it is symmetric around the axis as before
    const m0 = { ...leer, customWalls: [w(1)] };
    const [g] = planFormen(m0, { art: "teilen", ziel: { guid: guid(m0.customWalls[0]) }, params: { punkt_m: { x: 3, z: 0 } } }, { projektId: P });
    nah(Math.max(...g.punkte.map((p) => p.z)), 0.4); nah(Math.min(...g.punkte.map((p) => p.z)), -0.4);
  });
  it("pruefeAenderung: ein inside-Nachbar belegt die Seite −n, nicht die Linie (kein Fehlalarm wie bei der Mittellinie)", () => {
    // neighbour B: line z = 0.5, 0.2 thick, refLine inside → body z ∈ [0.3, 0.5]
    const nachbar = w(2, { a: { x: 0, z: 0.5 }, b: { x: 6, z: 0.5 }, refLine: "inside" });
    // wall A centred at z = 0 (box [−0.1, 0.1]) moves to z = 0.65 (box [0.55, 0.75]): clear of the body [0.3, 0.5],
    // but it would overlap the centre-line box [0.4, 0.6] the old code assumed
    const m = { ...leer, customWalls: [w(1), nachbar] };
    const frei = pruefeAenderung(m, { art: "transformieren", ziel: { guid: guid(m.customWalls[0]) }, params: { verschiebung_m: [0, 0, 0.65] } }, { projektId: P });
    assert.equal(frei.stufe, "ok", frei.saetze.join(" | "));
    // moved to z = 0.35 (box [0.25, 0.45]) it overlaps the body by 0.15 m → warning
    const trifft = pruefeAenderung(m, { art: "transformieren", ziel: { guid: guid(m.customWalls[0]) }, params: { verschiebung_m: [0, 0, 0.35] } }, { projektId: P });
    assert.equal(trifft.stufe, "warn");
    assert.match(trifft.saetze.join("|"), /Überschneidet Wand W-2/);
  });
});

describe("107-01 Review: Steckbrief nennt Kernwerte ohne Kern abgeleitet", () => {
  const wand = (extra = {}) => ({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, thickness: 0.24, height: 3, _idx: 1, ...extra });
  for (const v of ["coreOutside", "coreInside", "coreCenter"]) {
    it(`${v} ohne Kern: Quelle refLine = abgeleitet, Annahmetext, englische Fassung vorhanden`, () => {
      const s = steckbrief(wand({ refLine: v }), "wand-tragend");
      assert.equal(s.quelle.refLine, "abgeleitet");
      assert.equal(s.annahmen.length, 1);
      assert.match(s.annahmen[0], /ohne Kern-Schicht wie Mitte behandelt/);
      assert.ok(EN[s.annahmen[0]], `EN-Text fehlt für: ${s.annahmen[0]}`);
      assert.ok(!s.offen.includes("refLine"), "abgeleitet ist nicht offen");
    });
  }
  it("mit Kern oder bei center/outside/inside/fehlend bleibt der Steckbrief unverändert (kein refLine-Feld)", () => {
    for (const refLine of [undefined, "center", "outside", "inside"]) {
      const s = steckbrief(wand(refLine ? { refLine } : {}), "wand-tragend");
      assert.ok(!("refLine" in s.quelle), String(refLine));
      assert.deepEqual(s.annahmen, []);
    }
    const mitKern = steckbrief(wand({ refLine: "coreOutside" }), "wand-tragend", { kern: { aussen_m: 0.05, kern_m: 0.15 } });
    assert.ok(!("refLine" in mitKern.quelle));
  });
  it("auch Nicht-Wände bekommen das Feld nicht (Stütze mit zufälligem refLine)", () => {
    assert.ok(!("refLine" in steckbrief({ x: 0, z: 0, size: 0.4, refLine: "coreOutside" }, "stuetze").quelle));
  });
  it("das IFC-Datenblatt (Herkunft) nennt die Kernlage abgeleitet; ohne Kernwert steht nichts davon im Text", () => {
    const leeresModell = { ...createBuildingModel({ footprintM: null, storeys: 1 }), walls: [], parapets: [] };
    const ifc = (/** @type {any} */ refLine) => exportIFC(leeresModell, { customWalls: [wand(refLine ? { refLine } : {})], storeyHeight: 3, steckbrief: { projektId: "p1" } });
    assert.match(ifc("coreInside"), /refLine:abgeleitet/);
    assert.ok(!/refLine:/.test(ifc("outside")));
    assert.ok(!/refLine:/.test(ifc(undefined)));
  });
});

describe("107-01 Review: Eckfüller bei gemischten Dicken und Bezügen", () => {
  const ecke = (/** @type {any} */ a, /** @type {any} */ b) => eckfueller([
    { a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, height: 3, _idx: 1, ...a },
    { a: { x: 5, z: 0 }, b: { x: 5, z: 5 }, level: 0, height: 3, _idx: 2, ...b },
  ]);
  it("verschiedene Dicken, outside + inside: Kreuzung der Körpermittellinien, Seitenlänge der dicksten Wand (Handrechnung)", () => {
    // A: z-body [0, 0.36], centre line z = 0.18; B: n = (−1, 0), inside → body x ∈ [5, 5.24], centre line x = 5.12
    const [f] = ecke({ thickness: 0.36, refLine: "outside" }, { thickness: 0.24, refLine: "inside" });
    nah(f.x, 5.12); nah(f.z, 0.18); nah(f.dicke_m, 0.36);
  });
  it("gemischte Bezüge, gleiche Dicke: center + outside", () => {
    // A centred on z = 0; B outside → body x ∈ [4.76, 5], centre line x = 4.88
    const [f] = ecke({ thickness: 0.24 }, { thickness: 0.24, refLine: "outside" });
    nah(f.x, 4.88); nah(f.z, 0);
  });
  it("Aufbau (cavity) gegen Einzeldicke, beide inside", () => {
    const d = /** @type {number} */ (compositeTotalM("cavity"));
    const [f] = ecke({ composite: "cavity", refLine: "inside" }, { thickness: 0.24, refLine: "inside" });
    // A: body z ∈ [−d, 0], centre line z = −d/2; B: body x ∈ [5, 5.24], centre line x = 5.12
    nah(f.x, 5.12, 1e-9); nah(f.z, -d / 2, 1e-9); nah(f.dicke_m, Math.max(d, 0.24));
  });
  it("Höhe 3 m, wenn keine Wand der Ecke eine nennt (alter Wert), sonst die größte", () => {
    const [a] = eckfueller([{ a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, _idx: 1 }, { a: { x: 5, z: 0 }, b: { x: 5, z: 5 }, level: 0, _idx: 2 }]);
    assert.equal(a.hoehe_m, 3);
    const [b] = ecke({ height: 2.5 }, { height: 3.2 });
    assert.equal(b.hoehe_m, 3.2);
  });
});
