// 107-01: reference line of walls — the ONE derivation (@core/lib/bauteil/referenz.js) for 3D, plan, PDF plan
// and IFC. Covers: offset per position, hand-calculated core values, the old copies versus the new function
// (same numbers), thickness / build-up change keeps a, b and the reference face, the IFC placement text of an
// offset wall (hand-calculated), the second golden, export without refLine unchanged, parapet thickness,
// hull reference (huelleBezug) and the corner fillers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createBuildingModel, compositeById, compositeTotalM } from "@core/lib/buildingModel";
import { refVersatz_m, wandGeometrie, wandDicke_m, eckfueller, kernFehlt, REF_LINIEN, KERN_REF_LINIEN } from "@core/lib/bauteil/referenz.js";
import { exportIFC } from "@designer/lib/ifcExport";
import { layerHardened } from "@designer/lib/tragwerkPlan";
import { planGrafik } from "@designer/lib/vektorPlan";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";
import { ifcReflinieSzenario } from "./fixtures/ifcReflinieModell-10701.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

// ---- the three OLD copies, kept here as the reference they were (BimPlan2D, vektorPlan, BitBimStudio) ----
const altDicke = (w) => { const c = compositeById(w.composite); return c ? c.skins.reduce((s, k) => s + k.thickness, 0) / 1000 : (w.thickness || 0.3); };
const altVersatz = (ref, t) => (ref === "outside" ? t / 2 : ref === "inside" ? -t / 2 : 0);
function altPolygon(w) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
  const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len, nx = -dz, nz = dx;
  const t = altDicke(w), o = altVersatz(w.refLine, t), h = t / 2;
  return [
    { x: w.a.x + nx * (o + h), z: w.a.z + nz * (o + h) }, { x: w.b.x + nx * (o + h), z: w.b.z + nz * (o + h) },
    { x: w.b.x + nx * (o - h), z: w.b.z + nz * (o - h) }, { x: w.a.x + nx * (o - h), z: w.a.z + nz * (o - h) },
  ];
}
/** old cornerFillers of BitBimStudio (position = mean of the LINE end points) */
function altEckfueller(walls) {
  const tol = 0.3, pts = [];
  walls.forEach((w) => { pts.push({ x: w.a.x, z: w.a.z, w }); pts.push({ x: w.b.x, z: w.b.z, w }); });
  const used = new Array(pts.length).fill(false), out = [];
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const group = [i]; used[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < tol && pts[i].w.level === pts[j].w.level) { group.push(j); used[j] = true; }
    }
    if ([...new Set(group.map((g) => pts[g].w._idx))].length >= 2) {
      out.push({ x: group.reduce((s, g) => s + pts[g].x, 0) / group.length, z: group.reduce((s, g) => s + pts[g].z, 0) / group.length,
        dicke_m: Math.max(...group.map((g) => wandDicke_m(pts[g].w))), hoehe_m: Math.max(...group.map((g) => pts[g].w.height || 3)), level: pts[group[0]].w.level });
    }
  }
  return out;
}

const BEISPIELWAENDE = [
  { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.24 },
  { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.24, refLine: "outside" },
  { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.24, refLine: "inside" },
  { a: { x: -3.2, z: 1.1 }, b: { x: 2.7, z: 5.9 }, composite: "cavity", refLine: "outside" },
  { a: { x: -3.2, z: 1.1 }, b: { x: 2.7, z: 5.9 }, composite: "timber", refLine: "inside" },
  { a: { x: 7, z: 7 }, b: { x: 7, z: -2 }, composite: "single24", refLine: "center" },
  { a: { x: 1, z: 1 }, b: { x: 1, z: 1 }, thickness: 0.3, refLine: "outside" }, // zero length stays finite
  { a: { x: 0, z: 0 }, b: { x: 3, z: 4 } }, // no thickness at all -> 0.30 m
];

describe("107-01 refVersatz_m — Versatz je Lage", () => {
  it("center 0, outside +d/2, inside −d/2; unbekannt und fehlend wie center", () => {
    nah(refVersatz_m("center", 0.24), 0);
    nah(refVersatz_m("outside", 0.24), 0.12);
    nah(refVersatz_m("inside", 0.24), -0.12);
    for (const v of [undefined, null, "", "mitte", "OUTSIDE"]) assert.equal(refVersatz_m(/** @type {any} */ (v), 0.24), 0);
    assert.equal(refVersatz_m("outside", NaN), 0);
  });

  it("Kernwerte ohne Kern oder mit unbrauchbarem Kern verhalten sich wie center und werden als fehlend gemeldet", () => {
    for (const v of KERN_REF_LINIEN) {
      assert.equal(refVersatz_m(v, 0.39), 0);
      assert.equal(refVersatz_m(v, 0.39, null), 0);
      assert.equal(refVersatz_m(v, 0.39, { aussen_m: 0.1, kern_m: 0 }), 0, "Kerndicke 0 = kein Kern");
      assert.equal(refVersatz_m(v, 0.39, { aussen_m: -0.1, kern_m: 0.2 }), 0);
      assert.equal(refVersatz_m(v, 0.39, { aussen_m: 0.3, kern_m: 0.3 }), 0, "Kern passt nicht in die Dicke");
      assert.equal(refVersatz_m(v, 0.39, /** @type {any} */ ({ aussen_m: "x", kern_m: 0.2 })), 0);
      assert.equal(kernFehlt(v, 0.39, null), true);
    }
    assert.equal(kernFehlt("center", 0.39, null), false);
    assert.equal(kernFehlt("coreOutside", 0.39, { aussen_m: 0.1, kern_m: 0.2 }), false);
    assert.deepEqual([...REF_LINIEN], ["center", "outside", "inside", "coreOutside", "coreInside", "coreCenter"]);
  });

  it("Kernwerte mit Kern nach Handrechnung (Linie auf Kernaußenfläche, Kerninnenfläche, Kernmitte)", () => {
    // single layer 0,24 m, the whole thickness is the core: outer face at +n → body centre −0,12; inner face → +0,12
    const k24 = { aussen_m: 0, kern_m: 0.24 };
    nah(refVersatz_m("coreOutside", 0.24, k24), -0.12);
    nah(refVersatz_m("coreInside", 0.24, k24), 0.12);
    nah(refVersatz_m("coreCenter", 0.24, k24), 0);
    // 0,27 m outside the core, core 0,175 m, rest 0,015 m inside: d = 0,46 m
    const kc = { aussen_m: 0.27, kern_m: 0.175 };
    nah(refVersatz_m("coreOutside", 0.46, kc), 0.27 - 0.23);          // line 0,04 m inside the outer face … body centre +0,04
    nah(refVersatz_m("coreInside", 0.46, kc), 0.27 + 0.175 - 0.23);   // 0,215
    nah(refVersatz_m("coreCenter", 0.46, kc), 0.27 + 0.0875 - 0.23);  // 0,1275
    // plain values ignore a core
    nah(refVersatz_m("outside", 0.46, kc), 0.23);
  });

  it("die Linie liegt bei jedem Kernwert wirklich auf der behaupteten Fläche (Gegenprobe über das Polygon)", () => {
    const kc = { aussen_m: 0.27, kern_m: 0.175 }, d = 0.46;
    // stack runs from +n (outer face, position +d/2 of the body) to −n; the line is at body position −versatz
    const w = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: d };
    const lage = { coreOutside: d / 2 - 0.27, coreInside: d / 2 - 0.27 - 0.175, coreCenter: d / 2 - 0.27 - 0.0875 };
    for (const [v, pos] of Object.entries(lage)) {
      const g = wandGeometrie({ ...w, refLine: v }, { kern: kc });
      // polygon z-range is [versatz − d/2, versatz + d/2]; the line z = 0 must sit at body position `pos` from the centre
      const mitteZ = (g.polygon[0].z + g.polygon[3].z) / 2;
      nah(0 - mitteZ, pos);
    }
  });
});

describe("107-01 wandGeometrie — dieselben Zahlen wie die drei alten Kopien", () => {
  it("Polygon, Dicke und Versatz stimmen exakt mit Alt (BimPlan2D, vektorPlan, BitBimStudio) überein", () => {
    for (const w of BEISPIELWAENDE) {
      assert.deepEqual(wandGeometrie(w).polygon, altPolygon(w), JSON.stringify(w));
      assert.equal(wandDicke_m(w), altDicke(w));
      assert.equal(wandGeometrie(w).versatz_m, altVersatz(w.refLine, altDicke(w)));
    }
  });

  it("Normale n = (−dz, dx), Mitte der Linie, Körpermitte = Mitte + n · Versatz", () => {
    const g = wandGeometrie({ a: { x: 0, z: 0 }, b: { x: 0, z: 4 }, thickness: 0.24, refLine: "outside" });
    assert.deepEqual(g.normale, { x: -1, z: 0 });
    assert.deepEqual(g.mitte, { x: 0, z: 2 });
    nah(g.koerperMitte.x, -0.12); nah(g.koerperMitte.z, 2);
    nah(g.laenge_m, 4);
  });

  it("die Dicke eines Aufbaus ist seine Schichtsumme, sonst thickness, sonst 0,30 m", () => {
    nah(wandDicke_m({ composite: "cavity" }), /** @type {number} */ (compositeTotalM("cavity")));
    assert.equal(wandDicke_m({ thickness: 0.115 }), 0.115);
    assert.equal(wandDicke_m({}), 0.3);
    assert.equal(wandDicke_m({ composite: "gibtsnicht", thickness: 0.2 }), 0.2);
  });

  it("der Plan-PDF-Weg (planGrafik) zeichnet die Wand an derselben Stelle wie wandGeometrie", () => {
    const w = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, thickness: 0.24, refLine: "outside" };
    const model = createBuildingModel({ footprintM: null, storeys: 1 });
    const g = planGrafik({ model: { ...model, walls: [] }, level: 0, customWalls: [w] });
    const poly = g.elemente.find((e) => e.art === "poly" && e.ebene === "wand");
    assert.deepEqual(poly.pts, wandGeometrie(w).polygon);
  });
});

describe("107-01 Dicke oder Aufbau ändern lässt a, b und die Bezugsseite stehen", () => {
  it("outside: die Kante auf der Linie a–b bleibt bei jeder Dicke; inside genauso auf der Gegenseite", () => {
    const a = { x: 1.5, z: -2 }, b = { x: 6.5, z: 2 };
    for (const d of [0.115, 0.24, 0.36, 0.5]) {
      const wo = { a, b, thickness: d, refLine: "outside" }, wi = { a, b, thickness: d, refLine: "inside" };
      const po = wandGeometrie(wo).polygon, pi = wandGeometrie(wi).polygon;
      assert.deepEqual([po[3], po[2]], [a, b], `outside d=${d}: − Seite liegt auf a, b`);
      assert.deepEqual([pi[0], pi[1]], [a, b], `inside d=${d}: + Seite liegt auf a, b`);
      assert.deepEqual(wo.a, a); assert.deepEqual(wo.b, b); // nothing was written back
    }
  });

  it("Aufbau wechseln (Einzeldicke → cavity → timber) ändert nur die Dicke, nie a, b oder die Bezugsseite", () => {
    const a = { x: 0, z: 0 }, b = { x: 5, z: 0 };
    const ids = [undefined, "single24", "cavity", "timber"];
    for (const refLine of ["outside", "inside"]) {
      for (const composite of ids) {
        const w = { a: { ...a }, b: { ...b }, thickness: 0.3, composite, refLine };
        const g = wandGeometrie(w);
        const flaeche = refLine === "outside" ? [g.polygon[3], g.polygon[2]] : [g.polygon[0], g.polygon[1]];
        assert.deepEqual(flaeche, [a, b], `${refLine} ${composite}`);
        assert.deepEqual([w.a, w.b], [a, b]);
        nah(g.dicke_m, wandDicke_m({ composite, thickness: 0.3 }));
      }
    }
  });
});

/** Rows of the STEP text by id. */
function zeilenMap(/** @type {string} */ ifc) {
  const m = new Map();
  for (const l of ifc.split("\n")) { const r = l.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/); if (r) m.set(`#${r[1]}`, { typ: r[2], args: r[3] }); }
  return m;
}
/** IfcLocalPlacement → [x, y, z] of its IfcCartesianPoint (local coordinates, parent not resolved). */
function platzierungPunkt(/** @type {Map<string, any>} */ rows, /** @type {string} */ ref) {
  const lp = rows.get(ref).args.split(",");              // $,#a2p  or  #parent,#a2p
  const a2p = rows.get(lp[1]).args.split(",")[0];
  return rows.get(a2p).args.match(/^\(([-\d.]+),([-\d.]+),([-\d.]+)\)$/).slice(1, 4).map(Number);
}
/** Placement ref of the n-th IfcWall (index in file order). */
function wandPlatzierung(/** @type {string} */ ifc, /** @type {number} */ nr) {
  const rows = zeilenMap(ifc);
  const waende = [...rows.entries()].filter(([, r]) => r.typ === "IFCWALL");
  const m = waende[nr][1].args.match(/^'[^']*',\$,'[^']*',\$,\$,(#\d+),/);
  return { rows, ref: m[1], punkt: platzierungPunkt(rows, m[1]) };
}
const OHNE_HUELLE = { footprintM: null, storeys: 1 };
const keineHuelle = () => ({ ...createBuildingModel(OHNE_HUELLE), walls: [], parapets: [] });

describe("107-01 IFC schreibt die Lage der Referenzlinie", () => {
  const wand = (extra) => ({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, thickness: 0.24, _idx: 1, ...extra });
  const export1 = (w, extra = {}) => exportIFC(keineHuelle(), { customWalls: [w], storeyHeight: 3, ...extra });

  it("outside: Platzierungspunkt = Mitte + n · d/2 (Handrechnung: (2, 0,12))", () => {
    const p = wandPlatzierung(export1(wand({ refLine: "outside" })), 0).punkt;
    assert.deepEqual(p, [2, 0.12, 0]);
  });
  it("inside: Mitte − n · d/2 → (2, −0,12); center und fehlend → (2, 0)", () => {
    assert.deepEqual(wandPlatzierung(export1(wand({ refLine: "inside" })), 0).punkt, [2, -0.12, 0]);
    assert.deepEqual(wandPlatzierung(export1(wand({ refLine: "center" })), 0).punkt, [2, 0, 0]);
    assert.deepEqual(wandPlatzierung(export1(wand({})), 0).punkt, [2, 0, 0]);
  });
  it("gedrehte Wand a=(0,0) → b=(0,4): n = (−1, 0), outside → x = −0,12, y = 2", () => {
    const p = wandPlatzierung(export1(wand({ b: { x: 0, z: 4 }, refLine: "outside" })), 0).punkt;
    assert.deepEqual(p, [-0.12, 2, 0]);
  });
  it("Aufbau: cavity outside verschiebt um die halbe Gesamtdicke des Aufbaus", () => {
    const d = /** @type {number} */ (compositeTotalM("cavity"));
    const p = wandPlatzierung(export1(wand({ thickness: undefined, composite: "cavity", refLine: "outside" })), 0).punkt;
    nah(p[1], d / 2, 1e-4);
  });
  it("Öffnungen hängen an der verschobenen Wand (Void-Platzierung hat die Wand als Eltern, Y = 0)", () => {
    const ifc = export1(wand({ refLine: "outside" }), { customWindows: [{ wallIdx: 1, u: 1, kind: "window", typeId: "single", _idx: 2 }] });
    const w = wandPlatzierung(ifc, 0);
    const op = [...w.rows.values()].find((r) => r.typ === "IFCOPENINGELEMENT");
    const voidPl = op.args.match(/^'[^']*',\$,'[^']*',\$,\$,(#\d+),/)[1];
    assert.equal(w.rows.get(voidPl).args.split(",")[0], w.ref, "Eltern-Platzierung = Wandplatzierung");
    const lokal = platzierungPunkt(w.rows, voidPl);
    assert.equal(lokal[1], 0, "quer zur Wand mittig im verschobenen Körper");
    nah(lokal[0], 1 - 2); // u − len/2, along the line
  });
  it("Hüllwände mit huelleBezug outside liegen im IFC um d/2 versetzt, Decken und Räume bleiben auf der Linie", () => {
    const fp = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
    const mitte = createBuildingModel({ footprintM: fp, storeys: 1, wallThickness: 0.3 });
    const aussen = createBuildingModel({ footprintM: fp, storeys: 1, wallThickness: 0.3, huelleBezug: "outside" });
    const a = wandPlatzierung(exportIFC(mitte, { storeyHeight: 3 }), 0).punkt, b = wandPlatzierung(exportIFC(aussen, { storeyHeight: 3 }), 0).punkt;
    // first edge runs +x along z = −4, n = (0, 1): shifted by +0,15 in IFC Y
    nah(b[1] - a[1], 0.15); nah(b[0], a[0]);
    assert.deepEqual(aussen.footprint, mitte.footprint);
    assert.deepEqual(aussen.slabs, mitte.slabs);
    assert.deepEqual(aussen.spaces, mitte.spaces);
  });
  it("Träger mit refLine outside: Mitte + n · breite/2; ohne refLine unverändert", () => {
    const { mitSteckbrief } = ifcReflinieSzenario();
    const ohneRef = { ...mitSteckbrief, tragwerk: { traeger: [{ id: "tr_1", level: 0, a: { x: -4, z: 0 }, b: { x: 4, z: 0 }, breite_m: 0.3 }] } };
    const beamPunkt = (ifc) => { const rows = zeilenMap(ifc); const b = [...rows.values()].find((r) => r.typ === "IFCBEAM"); return platzierungPunkt(rows, b.args.match(/^'[^']*',\$,'[^']*',\$,\$,(#\d+),/)[1]); };
    const m = ifcReflinieSzenario().model;
    const mit = beamPunkt(exportIFC(m, mitSteckbrief)), ohne = beamPunkt(exportIFC(m, ohneRef));
    nah(mit[1] - ohne[1], 0.15, 1e-4); nah(mit[0], ohne[0], 1e-4);
    assert.equal(layerHardened({ traeger: [{ a: { x: 0, z: 0 }, b: { x: 3, z: 0 }, refLine: "bogus" }] }).traeger[0].refLine, undefined, "unbekannter Wert wird verworfen");
    assert.equal(layerHardened({ traeger: [{ a: { x: 0, z: 0 }, b: { x: 3, z: 0 }, refLine: "inside" }] }).traeger[0].refLine, "inside");
  });
});

describe("107-01 Export ohne Bezug bleibt byte-gleich, zweiter Golden mit Bezug", () => {
  it("refLine center ausdrücklich, fehlend, unbekannt und Kernwert ohne Kern erzeugen denselben Text", () => {
    const basis = (refLine) => exportIFC(keineHuelle(), { customWalls: [{ a: { x: 0, z: 0 }, b: { x: 4, z: 1 }, level: 0, height: 3, thickness: 0.24, _idx: 1, ...(refLine === undefined ? {} : { refLine }) }], storeyHeight: 3 });
    const soll = basis(undefined);
    for (const v of ["center", "coreOutside", "coreInside", "coreCenter", "irgendwas", null]) assert.equal(basis(v), soll, String(v));
    assert.notEqual(basis("outside"), soll);
  });

  it("Golden aus Task 1: das Beispielmodell erzeugt weiterhin den alten Text (Gegenprobe zu ifcGolden-10701)", () => {
    const { model, ohne } = ifcGoldenSzenario();
    assert.equal(exportIFC(model, ohne), lies("ifc-golden-107.ifc"));
    assert.ok(!/outside|inside/.test(JSON.stringify(ohne.customWalls)), "das erste Beispielmodell hat keine Versatzlage");
  });

  it("zweiter Golden (Hülle und gezeichnete Wände mit outside/inside, Öffnungen) Zeichen für Zeichen gleich", () => {
    const { model, opts } = ifcReflinieSzenario();
    const meldungen = [];
    const ist = exportIFC(model, { ...opts, onWarn: (m) => meldungen.push(m) });
    assert.deepEqual(meldungen, []);
    assert.equal(ist, lies("ifc-golden-107-reflinie.ifc"));
    assert.notEqual(ist, exportIFC(model, { ...opts, customWalls: opts.customWalls.map(({ refLine, ...r }) => r) }), "der Versatz steht wirklich im Text");
  });
});

describe("107-01 Hülle: Attika-Dicke und huelleBezug", () => {
  const fp = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 6 }, { x: 0, z: 6 }];
  it("die Attika nimmt die Dicke der Hülle (Aufbau-Summe), ohne Aufbau wallThickness", () => {
    const m1 = createBuildingModel({ footprintM: fp, storeys: 2, wallComposite: "cavity", wallThickness: 0.3 });
    assert.ok(m1.parapets.length === 4);
    for (const p of m1.parapets) nah(p.thickness, /** @type {number} */ (compositeTotalM("cavity")));
    const m2 = createBuildingModel({ footprintM: fp, storeys: 2, wallThickness: 0.365 });
    for (const p of m2.parapets) assert.equal(p.thickness, 0.365);
  });
  it("huelleBezug: nur walls und parapets bekommen refLine; ohne oder center sind die Objekte wie vorher", () => {
    const alt = createBuildingModel({ footprintM: fp, storeys: 2 });
    assert.deepEqual(createBuildingModel({ footprintM: fp, storeys: 2, huelleBezug: "center" }), alt);
    assert.deepEqual(createBuildingModel({ footprintM: fp, storeys: 2, huelleBezug: /** @type {any} */ ("mitte") }), alt, "unbekannter Wert = center");
    assert.ok(alt.walls.every((w) => !("refLine" in w)) && alt.parapets.every((p) => !("refLine" in p)));
    const innen = createBuildingModel({ footprintM: fp, storeys: 2, huelleBezug: "inside" });
    assert.ok(innen.walls.every((w) => w.refLine === "inside") && innen.parapets.every((p) => p.refLine === "inside"));
    assert.deepEqual(innen.footprint, alt.footprint); assert.deepEqual(innen.slabs, alt.slabs); assert.deepEqual(innen.spaces, alt.spaces);
  });
});

describe("107-01 Eckfüller sitzen auf der Körperecke", () => {
  const L = (refLine) => [
    { a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, thickness: 0.24, height: 3, refLine, _idx: 1 },
    { a: { x: 5, z: 0 }, b: { x: 5, z: 5 }, level: 0, thickness: 0.24, height: 3, refLine, _idx: 2 },
  ];
  it("ohne Versatz exakt wie die alte Funktion (Mittel der Linienenden), auch bei Aufbau und mehreren Wänden", () => {
    const viele = [...L("center"), { a: { x: 5.1, z: 5 }, b: { x: 0, z: 5 }, level: 0, composite: "cavity", height: 2.8, _idx: 3 }, { a: { x: 0, z: 5 }, b: { x: 0, z: 0 }, level: 1, thickness: 0.2, _idx: 4 }];
    // 107-02 added the field unterkante_m (lower edge of the pillar, m) — the old function had none, everything else is the same
    const ohneUK = (/** @type {any[]} */ liste) => liste.map(({ unterkante_m, ...rest }) => rest);
    assert.deepEqual(ohneUK(eckfueller(viele)), altEckfueller(viele));
    assert.deepEqual(ohneUK(eckfueller(L(undefined))), altEckfueller(L(undefined)));
  });
  it("outside/inside: Pfeiler = Überlappung der beiden Wandkörper (Kreuzung der Körpermittellinien)", () => {
    const [fo] = eckfueller(L("outside"));
    nah(fo.x, 5 - 0.12); nah(fo.z, 0.12); nah(fo.dicke_m, 0.24);
    // the pillar [x ± d/2] × [z ± d/2] = [4.76, 5.00] × [0.00, 0.24] lies completely inside both bodies
    const [fi] = eckfueller(L("inside"));
    nah(fi.x, 5 + 0.12); nah(fi.z, -0.12);
    // the old position would have stood half a thickness out of the corner
    assert.ok(Math.hypot(altEckfueller(L("outside"))[0].x - fo.x, altEckfueller(L("outside"))[0].z - fo.z) > 0.1);
  });
  it("gerade Fortsetzung (parallel) fällt auf das Mittel der Körperenden zurück, nie NaN", () => {
    const gerade = [
      { a: { x: 0, z: 0 }, b: { x: 3, z: 0 }, level: 0, thickness: 0.24, refLine: "outside", _idx: 1 },
      { a: { x: 3, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.24, refLine: "outside", _idx: 2 },
    ];
    const [f] = eckfueller(gerade);
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.z));
    nah(f.x, 3); nah(f.z, 0.12);
  });
});
