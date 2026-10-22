// Plan export prints what the plan shows (22.10.2026): hidden layers stay out of the vector PDF/DXF
// and the workshop walls with a decided status are drawn like on screen (BimPlan2D).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planGrafik } from "@designer/lib/vektorPlan";
import { brilleVon } from "@core/lib/plan/brillen.js";

const basis = {
  model: { walls: [{ level: 0, a: { x: 0, z: 0 }, b: { x: 10, z: 0 }, thickness: 0.3 }] },
  level: 0, massstab: 100,
  customWalls: [{ level: 0, a: { x: 0, z: 5 }, b: { x: 5, z: 5 }, thickness: 0.2 }],
  customColumns: [{ level: 0, x: 2, z: 2, size: 0.4 }],
  customSlabs: [{ level: 0, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }] }],
  customZones: [{ level: 0, name: "Wohnen", points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }] }],
};
const zaehle = (g, ebene) => g.elemente.filter((e) => e.ebene === ebene).length;

describe("planGrafik — Ebenen wie am Bildschirm", () => {
  it("ohne layerVis alles wie bisher", () => {
    const g = planGrafik(basis);
    assert.equal(zaehle(g, "wand"), 2);
    assert.equal(zaehle(g, "stuetze"), 1);
    assert.equal(zaehle(g, "decke"), 1);
    assert.equal(zaehle(g, "raum_text"), 1);
  });

  it("ausgeblendete Ebenen fehlen im Export", () => {
    const g = planGrafik({ ...basis, layerVis: { walls: false, columns: false, zones: false, shell: false } });
    assert.equal(zaehle(g, "wand"), 0, "Hülle (shell) und gezeichnete Wände (walls) aus");
    assert.equal(zaehle(g, "stuetze"), 0);
    assert.equal(zaehle(g, "decke"), 0);
    assert.equal(zaehle(g, "raum_text"), 0);
  });

  it("nur Wände aus: Hüllwand bleibt, gezeichnete Wand fehlt", () => {
    const g = planGrafik({ ...basis, layerVis: { walls: false } });
    assert.equal(zaehle(g, "wand"), 1);
  });

  it("Werkstatt-Wände: mit Status gezeichnet, ohne Status oder als Hülle nicht", () => {
    const brille = brilleVon("bestand") || brilleVon("eingabe");
    const ww = [
      { level: 0, a: { x: 1, z: 6 }, b: { x: 4, z: 6 }, dicke_m: 0.115, status: "bestand", huelle: false },
      { level: 0, a: { x: 1, z: 7 }, b: { x: 4, z: 7 }, dicke_m: 0.115, status: null, huelle: false },
      { level: 0, a: { x: 0, z: 0 }, b: { x: 0, z: 8 }, dicke_m: 0.3, status: "bestand", huelle: true },
      { level: 1, a: { x: 1, z: 6 }, b: { x: 4, z: 6 }, dicke_m: 0.115, status: "bestand", huelle: false },
    ];
    const ohne = planGrafik({ ...basis, brille });
    const mit = planGrafik({ ...basis, brille, werkstattWaende: ww });
    assert.equal(zaehle(mit, "wand") - zaehle(ohne, "wand"), 1, "genau die Innenwand mit Status auf diesem Geschoss");
    const mitAus = planGrafik({ ...basis, brille, werkstattWaende: ww, layerVis: { walls: false } });
    assert.equal(zaehle(mitAus, "wand"), zaehle(planGrafik({ ...basis, brille, layerVis: { walls: false } }), "wand"), "Ebene Wände aus = auch Werkstatt-Wände aus");
  });
});
