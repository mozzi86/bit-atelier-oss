// Unit-Tests für packages/nova-designer/src/lib/lageplan.js (Phase 37, generischer Lageplan-Kern).
// Kulisse: Footprint 20 × 14 m um (0,0); gezeichnete Parzelle als 80-px-Quadrat um (600,400) mit
// 1,25 m/px → ±50 m in Metern.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LAGEPLAN_DEFAULT, LAGEPLAN_RAND_M, FLAECHE_MIN_M2,
  layerHardened, parzelleInMetern, lageplanExtent, punktInPolygon, polygonFlaecheM2,
  neuesElement, verschiebeElement, loescheElement, neueFlaeche, verschiebeFlaechenPunkt, aendereFlaeche, loescheFlaeche, flaechenSummen,
} from "@designer/lib/lageplan";

const FP = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
const PARZELLE = { assumed: false, m_per_px: 1.25, points: [{ x: 560, y: 360 }, { x: 640, y: 360 }, { x: 640, y: 440 }, { x: 560, y: 440 }] };
const QUADRAT = (s) => [{ x: 0, z: 0 }, { x: s, z: 0 }, { x: s, z: s }, { x: 0, z: s }];

describe("lageplan: Parzelle und Extent", () => {
  it("parzelleInMetern: Canvas-Px um 600/400 → Meter, generische Parzelle → null", () => {
    const m = parzelleInMetern(PARZELLE);
    assert.deepEqual(m[0], { x: -50, z: -50 });
    assert.deepEqual(m[2], { x: 50, z: 50 });
    assert.equal(parzelleInMetern({ ...PARZELLE, assumed: true }), null);
    assert.equal(parzelleInMetern(null), null);
  });
  it("lageplanExtent: Parzelle hat Vorrang, sonst Footprint + Rand", () => {
    assert.equal(lageplanExtent(FP, parzelleInMetern(PARZELLE)).length, 4);
    const e = lageplanExtent(FP, null);
    assert.deepEqual(e[0], { x: -10 - LAGEPLAN_RAND_M, z: -7 - LAGEPLAN_RAND_M });
    assert.deepEqual(e[1], { x: 10 + LAGEPLAN_RAND_M, z: 7 + LAGEPLAN_RAND_M });
  });
  it("polygonFlaecheM2 20 × 14 = 280; punktInPolygon", () => {
    assert.equal(polygonFlaecheM2(FP), 280);
    assert.equal(punktInPolygon(FP, { x: 0, z: 0 }), true);
    assert.equal(punktInPolygon(FP, { x: 30, z: 0 }), false);
    assert.equal(polygonFlaecheM2([{ x: 0, z: 0 }, { x: 1, z: 1 }]), 0);
  });
});

describe("lageplan: Elemente", () => {
  it("anlegen (Ids el_1, el_2), verschieben, löschen; ohne Typ nichts", () => {
    let r = neuesElement(LAGEPLAN_DEFAULT, { typ: "feldahorn", x: 12, z: 3 });
    assert.equal(r.element.id, "el_1");
    r = neuesElement(r.layer, { typ: "lavendel", x: 13.333, z: 4 });
    assert.equal(r.element.id, "el_2");
    assert.equal(r.element.x, 13.33);
    assert.equal(neuesElement(r.layer, { x: 1, z: 1 }).element, null);
    const l2 = verschiebeElement(r.layer, "el_1", { x: 20, z: 5 });
    assert.deepEqual(l2.elemente[0], { id: "el_1", typ: "feldahorn", x: 20, z: 5 });
    assert.equal(loescheElement(l2, "el_1").elemente.length, 1);
  });
  it("layerHardened: Müll wird zu leeren Arrays, fehlende Ids ergänzt", () => {
    const h = layerHardened({ elemente: [{ typ: "x", x: 1, z: 2 }, { x: "a" }, null], flaechen: "nein" });
    assert.equal(h.elemente.length, 1);
    assert.equal(h.elemente[0].id, "el_1");
    assert.deepEqual(h.flaechen, []);
    assert.deepEqual(layerHardened(undefined), { elemente: [], flaechen: [] });
  });
});

describe("lageplan: Flächen", () => {
  it("neueFlaeche: < 3 Punkte oder < 1 m² abgelehnt, 10 × 10 → 100 m²", () => {
    assert.equal(neueFlaeche(LAGEPLAN_DEFAULT, { art: "gruen", points: QUADRAT(10).slice(0, 2) }).flaeche, null);
    assert.equal(neueFlaeche(LAGEPLAN_DEFAULT, { art: "gruen", points: QUADRAT(0.5) }).flaeche, null);
    assert.ok(FLAECHE_MIN_M2 >= 0.5);
    const r = neueFlaeche(LAGEPLAN_DEFAULT, { art: "gruen", points: QUADRAT(10) });
    assert.equal(r.flaeche.id, "fl_1");
    assert.equal(polygonFlaecheM2(r.flaeche.points), 100);
  });
  it("Punkt verschieben, Art ändern, löschen, Summen je Art", () => {
    let l = neueFlaeche(LAGEPLAN_DEFAULT, { art: "gruen", points: QUADRAT(10) }).layer;
    l = neueFlaeche(l, { art: "befestigt", points: QUADRAT(10).map((p) => ({ x: p.x + 20, z: p.z })) }).layer;
    l = verschiebeFlaechenPunkt(l, "fl_2", 2, { x: 25, z: 10 }); // shrink the second square
    assert.deepEqual(flaechenSummen(l), { gruen: 100, befestigt: 75 });
    l = aendereFlaeche(l, "fl_2", { art: "beet", id: "hack", points: [] });
    assert.equal(l.flaechen[1].art, "beet");
    assert.equal(l.flaechen[1].id, "fl_2");
    assert.equal(l.flaechen[1].points.length, 4);
    assert.equal(loescheFlaeche(l, "fl_1").flaechen.length, 1);
  });
});
