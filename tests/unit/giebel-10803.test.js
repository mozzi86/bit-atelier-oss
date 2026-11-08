// 108-03 (D-EFH-02): hull walls of the top storey up to the roof contour. Test house: tests/unit/fixtures/efh-108.js with knee wall 1.00 m,
// gable roof 45°, ridge along x. Hand calculation: eaves 4.15 m (108-02), ridge 4.15 + 5.10 = 9.25 m, DG floor 2.90 → gable profile from
// 1.25 m at both ends to 6.35 m in the middle (x = 5.10 of 10.20); area 10.20 · 1.25 + ½ · 10.20 · 5.10 = 12.75 + 26.01 = 38.76 m²;
// the two eaves walls (along x) stay knee walls (no profile). A window 1.00 × 1.20 on a 0.90 m sill fits in the middle (5.85 m there) and
// is refused 1.00 m from the end (profile 1.25 … 2.25 over its span → lowest 1.75 m < 2.10 m).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { huellProfile, mitGiebelProfilen, profilHoehe, profilHoeheBereich, giebelZuschlag_m2, huellSchluessel } from "@core/lib/bauteil/giebel.js";
import { globalesDach } from "@core/lib/bauteil/dachGeometrie.js";
import { oeffnungPasst, lochImWand, wirtVon } from "@core/lib/bauteil/oeffnungen.js";
import { synthHull } from "@core/lib/bimClassification";
import { exportIFC } from "@designer/lib/ifcExport";
import { EFH_108, efhModell, efhModellMitKniestock, efhGeschosseMitKniestock } from "./fixtures/efh-108.js";

const gs = efhGeschosseMitKniestock(1);
const m = efhModellMitKniestock(1);
const dach = globalesDach(m, "sattel", 45, gs);
const nah = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≈ ${b}`);

describe("108-03 huellProfile", () => {
  it("two gable walls (edges 1 and 3) with a 1.25 → 6.35 → 1.25 profile, 38.76 m² each; eaves walls without a profile", () => {
    const p = huellProfile(m, dach);
    assert.deepEqual([...p.keys()].sort(), ["1:1", "1:3"]);
    const g = p.get("1:1");
    nah(g.hoehe_max_m, 6.35, "ridge above the DG floor");
    nah(g.flaeche_m2, 38.76, "area");
    assert.equal(g.laenge_m, 10.2);
    assert.deepEqual(g.oben.map((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]), [[0, 1.25], [5.1, 6.35], [10.2, 1.25]]);
    assert.equal(g.quer_geneigt, false);
  });
  it("flat roof or no roof: no profile, mitGiebelProfilen returns the same model object", () => {
    assert.equal(huellProfile(m, null).size, 0);
    assert.equal(huellProfile(efhModell(), globalesDach(efhModell(), "flach", 0, EFH_108.geschosse)).size, 0);
    assert.equal(mitGiebelProfilen(m, null).model, m);
  });
  it("profilHoehe is piecewise linear, profilHoeheBereich the lowest over a span", () => {
    const g = huellProfile(m, dach).get("1:3");
    nah(profilHoehe(g, 5.1), 6.35, "middle");
    nah(profilHoehe(g, 2.55), 3.8, "quarter");
    nah(profilHoeheBereich(g, 0.5, 1.5), 1.75, "span near the end");
    nah(profilHoeheBereich(g, 4, 6), 5.25, "span over the ridge: the lower end counts");
  });
  it("giebelZuschlag_m2 = the two triangles above the knee wall", () => {
    nah(giebelZuschlag_m2(huellProfile(m, dach), m), 52.02, "2 × 26.01");
  });
});

describe("108-03 openings against the profile", () => {
  const { model } = mitGiebelProfilen(m, dach);
  const wall = model.walls.find((w) => huellSchluessel(w) === "1:3");
  const wirt = wirtVon({ level: 1, edge: 3, u: 5.1 }, { customWalls: [], huelle: model.walls, geschosse: gs });
  it("the hull host carries the profile and the profile height", () => {
    assert.ok(wall.profil);
    nah(wirt.wand.hoehe_m, 6.35, "host height");
    assert.ok(wirt.wand.profil);
  });
  it("window 1.00 × 1.20, sill 0.90: ok in the middle, refused 1.00 m from the end with the height at that position", () => {
    const ok = oeffnungPasst({ w: 1, h: 1.2, sill: 0.9 }, 10.2, 6.35, { profil: wall.profil, u: 5.1 });
    assert.equal(ok.ok, true);
    nah(ok.daten.hoehe_an_stelle, 5.85, "height over the window span in the middle");
    const nein = oeffnungPasst({ w: 1, h: 1.2, sill: 0.9 }, 10.2, 6.35, { profil: wall.profil, u: 1.0 });
    assert.equal(nein.ok, false);
    assert.match(nein.text, /ragt über die Dachkontur: an dieser Stelle nur 1\.75 m Wandhöhe/);
    // without the option the plain height counts (old behaviour)
    assert.equal(oeffnungPasst({ w: 1, h: 1.2, sill: 0.9 }, 10.2, 1.25).ok, false);
    assert.equal(oeffnungPasst({ w: 1, h: 1.2, sill: 0.9 }, 10.2, 6.35).ok, true);
  });
  it("lochImWand clamps the hole to the profile height minus 2 cm", () => {
    const l = lochImWand({ w: 1, h: 1.2, sill: 0.9 }, 1.0, 10.2, 6.35, { profil: wall.profil });
    nah(l.y1, 1.73, "clamped top");
    const frei = lochImWand({ w: 1, h: 1.2, sill: 0.9 }, 5.1, 10.2, 6.35, { profil: wall.profil });
    nah(frei.y1, 2.1, "free in the middle");
  });
});

describe("108-03 quantities and IFC", () => {
  it("synthHull adds the gable triangles to the hull wall area", () => {
    const ohne = synthHull({ footprintM: EFH_108.footprintM, storeys: 2, storeyHeight: 2.9, untergeschosse: 1, geschosse: EFH_108.geschosse, dachform: "flach" });
    const mit = synthHull({ footprintM: EFH_108.footprintM, storeys: 2, storeyHeight: 2.9, untergeschosse: 1, geschosse: gs, dachform: "sattel", dachneigung: 45 });
    const w = (h) => h.find((x) => x.id === "hull-wall").mengen.area;
    nah(w(mit), 43.2 * 6.9 + 52.02, "knee-wall hull + gables");
    assert.ok(w(ohne) > w(mit) - 52.02, "the flat-roof figure is the full storeys");
  });
  it("IFC with dachGlobal: the gable walls are profile bodies with Pset_BIT_Giebel; a window in the gable is exported", () => {
    const n = (s, re) => (s.match(re) || []).length;
    const basis = { storeyHeight: 2.9, geschosse: gs, steckbrief: { projektId: "p-10803" } };
    const ohneDach = exportIFC(m, basis);
    const mitDach = exportIFC(m, { ...basis, dachGlobal: { form: "sattel", neigung_grad: 45 } });
    assert.equal(n(ohneDach, /Pset_BIT_Giebel/g), 0);
    assert.equal(n(mitDach, /Pset_BIT_Giebel/g), 2);
    // the roof plates of dachGlobal are arbitrary profiles too, so count the rectangles that disappear: the two gable walls
    assert.equal(n(ohneDach, /=IFCRECTANGLEPROFILEDEF\(/g) - n(mitDach, /=IFCRECTANGLEPROFILEDEF\(/g), 2, "two profile walls instead of rectangles");
    const fenster = [{ level: 1, edge: 3, kind: "window", typeId: "single", u: 5.1, width: 1.0, height: 1.2, sill: 0.9, _idx: 9 }];
    const warnungen = [];
    const mitFenster = exportIFC(m, { ...basis, envOpenings: fenster, dachGlobal: { form: "sattel", neigung_grad: 45 }, onWarn: (t) => warnungen.push(t) });
    assert.equal(n(mitFenster, /=IFCWINDOW\(/g), 1, "the gable window is in the file");
    assert.ok(!warnungen.some((t) => /nicht exportiert/.test(t)), warnungen.join(" | "));
    const zuHoch = [];
    exportIFC(m, { ...basis, envOpenings: [{ ...fenster[0], u: 1.0 }], dachGlobal: { form: "sattel", neigung_grad: 45 }, onWarn: (t) => zuHoch.push(t) });
    assert.ok(zuHoch.some((t) => /ragt über die Dachkontur/.test(t)), zuHoch.join(" | "));
  });
});
