// 108-03 follow-up: the hull slabs end at the insulation of the envelope build-up (deckenRand.js) — one polygon for 3D, IFC and quantities.
// Build-up "cavity" (aufbauten.js): Klinker 115 + Luft 40 + Dämmung 120 + KS 175 + Putz 15 → insulation 0.12 m. Footprint 11.40 × 10.20 →
// slab 11.16 × 9.96 = 111.15 m² instead of 116.28 m²; the base slab keeps the footprint.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daemmstaerke_m, polygonEinruecken, deckenUmriss } from "@core/lib/bauteil/deckenRand.js";
import { compositeById, createBuildingModel } from "@core/lib/buildingModel";
import { synthHull } from "@core/lib/bimClassification";
import { EFH_108, efhModell } from "./fixtures/efh-108.js";

const nah = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≈ ${b}`);

describe("108-03 deckenRand", () => {
  it("insulation of the cavity build-up is 0.12 m; concrete wall 0; no build-up 0", () => {
    nah(daemmstaerke_m(compositeById("cavity")), 0.12, "cavity");
    nah(daemmstaerke_m(compositeById("single24")), 0, "single24");
    nah(daemmstaerke_m(null), 0, "none");
  });
  it("polygonEinruecken: rectangle inset by 0.12 on every side, winding independent; d ≤ 0 returns the same array", () => {
    const fp = EFH_108.footprintM.map((p) => ({ ...p }));
    const inn = polygonEinruecken(fp, 0.12);
    assert.deepEqual(inn, [{ x: -5.58, z: -4.98 }, { x: 5.58, z: -4.98 }, { x: 5.58, z: 4.98 }, { x: -5.58, z: 4.98 }]);
    const rev = polygonEinruecken([...fp].reverse(), 0.12);
    assert.deepEqual(rev[0], { x: -5.58, z: 4.98 });
    assert.equal(polygonEinruecken(fp, 0), fp);
  });
  it("createBuildingModel with the cavity envelope: storey slabs inset, base slab on the footprint; without build-up unchanged", () => {
    const m = efhModell({ wallComposite: "cavity" });
    const decke = m.slabs.find((s) => s.level === 0 && s.id === undefined);
    assert.deepEqual(decke.polygon[0], { x: -5.58, z: -4.98 });
    const boden = m.slabs.find((s) => s.id === "-1");
    assert.deepEqual(boden.polygon, EFH_108.footprintM);
    const ohne = efhModell();
    for (const s of ohne.slabs) assert.deepEqual(s.polygon, EFH_108.footprintM);
    assert.deepEqual(deckenUmriss(EFH_108.footprintM, compositeById("single24")), { polygon: EFH_108.footprintM, einzug_m: 0 });
  });
  it("synthHull: hull-slab area follows the inset polygon (3 ceilings × 111.15 m²), base slab the footprint", () => {
    const h = synthHull({ footprintM: EFH_108.footprintM, storeys: 2, storeyHeight: 2.9, untergeschosse: 1, geschosse: EFH_108.geschosse, envComposite: "cavity" });
    nah(h.find((x) => x.id === "hull-slab").mengen.area, 3 * 11.16 * 9.96, "ceilings");
    nah(h.find((x) => x.id === "hull-floor").mengen.area, 116.28, "base slab");
    const alt = synthHull({ footprintM: EFH_108.footprintM, storeys: 2, storeyHeight: 2.9, untergeschosse: 1, geschosse: EFH_108.geschosse });
    nah(alt.find((x) => x.id === "hull-slab").mengen.area, 3 * 116.28, "no build-up: footprint");
    void createBuildingModel;
  });
});
