// Unit tests for 73-07 (BEST-08): drawn elements may carry status and Erfassungsgrad as optional attributes;
// legacy models without attributes produce byte-identical elements (new-build AVA quantities change by 0);
// a set status is respected (regression of normalizeElement). Since 89-04 (D-BW-03, 12.10.2026) there is
// NO status default: legacy elements and the synthetic hull carry null ("ohne Status"), not "neubau".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifiedElements, synthHull } from "@core/lib/bimClassification";

const WALL = { _idx: 0, level: 0, a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, height: 3, thickness: 0.24 };
const modell = (walls) => ({ footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }], storeys: 2, storeyHeight: 3, customWalls: walls });

describe("73-07 Zustand am gezeichneten Bauteil", () => {
  it("legacy elements: no erfassung key, status null (D-BW-03, no default)", () => {
    const els = classifiedElements(modell([WALL]));
    const w = els.find((e) => e.id === "wall-0");
    assert.ok(w);
    assert.equal(w.status, null);
    assert.equal("erfassung" in w, false);
  });

  it("set status and Erfassungsgrad are carried; raw spellings normalised, garbage stays null", () => {
    const els = classifiedElements(modell([{ ...WALL, status: "abbruch", erfassung: "Aufmaß" }, { ...WALL, _idx: 1, status: "bestand", erfassung: "quatsch" }]));
    const w0 = els.find((e) => e.id === "wall-0"), w1 = els.find((e) => e.id === "wall-1");
    assert.equal(w0.status, "abbruch"); assert.equal(w0.erfassung, "gemessen");
    assert.equal(w1.status, "bestand"); assert.equal(w1.erfassung, null);
  });

  it("quantities of a new-build model are identical with and without the new attribute path", () => {
    const vorher = classifiedElements(modell([WALL])).map((e) => JSON.stringify(e.mengen)).join("|");
    const nachher = classifiedElements(modell([{ ...WALL, erfassung: null }])).map((e) => JSON.stringify(e.mengen)).join("|");
    assert.equal(nachher, vorher);
    assert.ok(synthHull(modell([])).every((e) => e.status === null));
  });
});
