// Unit-Tests für packages/nova-designer/src/lib/useWerkstattRehydrate.js
// (75-06 Task 0, MSB-9): nur das reine Prädikat brauchtRehydrat — der Hook
// selbst ist Effekt-Logik und wird in der Headless-Spec (Task 7,
// massing-75-06.spec.js) über einen echten page.reload() bewiesen.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { brauchtRehydrat } from "@designer/lib/useWerkstattRehydrate";

// Minimaler Footprint: 20 × 14 m Rechteck, zentriert (Konvention
// useBuildingProgram.rectFootprint — {x, z} in Metern).
const FOOTPRINT = [
  { x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 },
];

// Eine BIM-Studio-Zone (kein ·WT-Marker) und eine Werkstatt-Zone (·WT-Suffix,
// tesselierung.js WT_MARKER = " ·WT" — striktes Ende, kein includes()).
const BIM_ZONE = { name: "Wohnen 1", level: 0, points: FOOTPRINT };
const WT_ZONE = { name: "Schlafen (WE 0-1) ·WT", level: 0, points: FOOTPRINT };

describe("brauchtRehydrat (MSB-9)", () => {
  it("angewendet + keine ·WT-Zonen + Footprint → true (der MSB-9-Zustand)", () => {
    assert.equal(brauchtRehydrat({ angewendet: true }, [BIM_ZONE], FOOTPRINT), true);
    assert.equal(brauchtRehydrat({ angewendet: true }, [], FOOTPRINT), true);
  });

  it("·WT-Zone vorhanden → false (Schreiber war schon da)", () => {
    assert.equal(brauchtRehydrat({ angewendet: true }, [BIM_ZONE, WT_ZONE], FOOTPRINT), false);
  });

  it("angewendet false → false (nichts anzuwenden)", () => {
    assert.equal(brauchtRehydrat({ angewendet: false }, [], FOOTPRINT), false);
  });

  it("footprintM null → false (ohne Footprint keine Tessellierung)", () => {
    assert.equal(brauchtRehydrat({ angewendet: true }, [], null), false);
    // Auch < 3 Punkte ist kein nutzbares Polygon.
    assert.equal(brauchtRehydrat({ angewendet: true }, [], [{ x: 0, z: 0 }]), false);
  });

  it("Layer noch nicht geladen (null) → false", () => {
    assert.equal(brauchtRehydrat(null, [], FOOTPRINT), false);
    assert.equal(brauchtRehydrat(undefined, [], FOOTPRINT), false);
    // angewendet !== true zählt ebenfalls als nicht geladen/nicht angewendet.
    assert.equal(brauchtRehydrat({}, [], FOOTPRINT), false);
  });
});
