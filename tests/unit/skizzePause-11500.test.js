// Tracing underlays of the sketch tool (user wish 15.11.2026): floor plan per storey and section of the building model as line
// work in sketch coordinates (sketch.x = model.x, sketch.y = −model.z). Checked on the neutral test house (efh-108.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { grafikZuPause, transparenzPausen, planAusDatensatz } from "@designer/lib/skizzePause";
import { EFH_108, efhModellMitKniestock, efhGeschosseMitKniestock } from "./fixtures/efh-108.js";

const plan = () => ({
  model: efhModellMitKniestock(), customWalls: EFH_108.customWalls, envOpenings: EFH_108.envOpenings,
  dachform: EFH_108.dachform, dachneigung: EFH_108.dachneigung, geschosse: efhGeschosseMitKniestock(), storeyHeight: EFH_108.storeyHeight,
});

describe("Skizze: Transparenzpausen aus dem Gebäudemodell", () => {
  it("Linien in Skizzenkoordinaten: y = −z, nur Polylinien mit Strich, Texte und reine Füllungen bleiben weg", () => {
    const r = grafikZuPause({ elemente: [
      { art: "poly", pts: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }], stroke: "#000", fill: null, breite_mm: 0.5 },
      { art: "poly", pts: [{ x: 0, z: 0 }, { x: 1, z: 1 }], stroke: "#000", offen: true, dash: "2 1" },
      { art: "poly", pts: [{ x: 0, z: 0 }, { x: 9, z: 9 }, { x: 0, z: 9 }], stroke: null, fill: "#eee" },
      { art: "text", x: 1, z: 1, text: "Wohnen" },
    ] });
    assert.equal(r.linien.length, 2);
    assert.deepEqual(r.linien[0].pts[2], { x: 4, y: -3 });
    assert.equal(r.linien[0].geschlossen, true);
    assert.equal(r.linien[1].geschlossen, false);
    assert.equal(r.linien[1].dash, "2 1");
    assert.deepEqual(r.bbox, { minX: 0, minY: -3, maxX: 4, maxY: 0 });
    assert.deepEqual(grafikZuPause(null), { linien: [], bbox: null });
  });

  it("Testhaus: ein Grundriss je Geschoss (unten zuerst) und der Schnitt", () => {
    const pausen = transparenzPausen(plan());
    assert.deepEqual(pausen.map((p) => p.id), ["grundriss:-1", "grundriss:0", "grundriss:1", "schnitt", "schnitt-b"]);
    assert.deepEqual(pausen.map((p) => p.geschoss), ["KG", "EG", "DG", "A-A", "B-B"]);
    for (const p of pausen) assert.ok(p.linien.length > 0 && p.bbox, p.id);
  });

  it("Grundriss liegt auf dem Umriss des Hauses, der Schnitt steht aufrecht über ±0,00", () => {
    const pausen = transparenzPausen(plan());
    const eg = pausen.find((p) => p.id === "grundriss:0").bbox;
    // footprint 11.4 m × 10.2 m around the origin; the plan may reach a little beyond it (outer wall face, dimension lines)
    assert.ok(eg.minX <= -5.7 && eg.maxX >= 5.7 && eg.minY <= -5.1 && eg.maxY >= 5.1, JSON.stringify(eg));
    assert.ok(eg.maxX - eg.minX < 11.4 + 6 && eg.maxY - eg.minY < 10.2 + 6, JSON.stringify(eg));
    const s = pausen.find((p) => p.id === "schnitt").bbox;
    // two storeys, knee wall and a 45° roof: clearly higher than the ground floor, and the basement reaches below zero
    assert.ok(s.maxY > 6 && s.minY < 0, JSON.stringify(s));
    // B-B looks along the ridge: the house is 10.2 m deep there instead of 11.4 m long
    const b = pausen.find((p) => p.id === "schnitt-b").bbox;
    assert.ok(b.maxX - b.minX < s.maxX - s.minX && b.maxY > 6, JSON.stringify(b));
  });

  it("ohne Modell oder ohne Umriss: keine Pausen", () => {
    assert.deepEqual(transparenzPausen(null), []);
    assert.deepEqual(transparenzPausen({ model: { storeys: [], walls: [] } }), []);
  });

  it("aus dem gespeicherten Datensatz: Geschosse des Projekts, nicht die Standardwerte", () => {
    const satz = { ...EFH_108, geschosse: efhGeschosseMitKniestock() };
    const pausen = transparenzPausen(planAusDatensatz(satz));
    assert.deepEqual(pausen.map((p) => p.geschoss), ["KG", "EG", "DG", "A-A", "B-B"]);
    assert.equal(planAusDatensatz({ footprintM: [] }), null);
    assert.equal(planAusDatensatz(null), null);
    assert.deepEqual(transparenzPausen(planAusDatensatz(null)), []);
  });
});
