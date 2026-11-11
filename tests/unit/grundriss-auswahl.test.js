// Grundriss-Bedienung Teil 1, Punkt 4: ⌘A / Ctrl+A selects all drawn elements of the active storey, Shift + frame adds to the
// selection (zeichnenModell.js). Neutral test geometry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alleWaehlenKuerzel, alleImGeschoss, auswahlErgaenzen } from "@designer/lib/zeichnenModell.js";

const taste = (/** @type {any} */ p) => ({ key: "a", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: { tagName: "DIV", closest: () => null }, ...p });

const MODELL = {
  customWalls: [{ _idx: 1, level: 0, a: { x: 0, z: 0 }, b: { x: 4, z: 0 } }, { _idx: 2, level: 1, a: { x: 0, z: 0 }, b: { x: 4, z: 0 } }],
  customColumns: [{ _idx: 3, level: 0, x: 1, z: 1 }],
  customWindows: [{ _idx: 4, wallIdx: 1, u: 2 }, { _idx: 5, wallIdx: 2, u: 2 }],
  customZones: [{ _idx: 6, level: 0, points: [] }],
  customSlabs: [{ _idx: 7, level: 1, points: [] }],
  customRoofs: [],
};

describe("Auswahl im Grundriss", () => {
  it("⌘A und Strg+A, aber nicht im Eingabefeld und nicht mit Alt/Umschalt", () => {
    assert.equal(alleWaehlenKuerzel(taste({})), true);
    assert.equal(alleWaehlenKuerzel(taste({ metaKey: false, ctrlKey: true, key: "A" })), true);
    assert.equal(alleWaehlenKuerzel(taste({ target: { tagName: "INPUT", closest: () => null } })), false);
    assert.equal(alleWaehlenKuerzel(taste({ target: { tagName: "SPAN", closest: () => ({}) } })), false);
    assert.equal(alleWaehlenKuerzel(taste({ shiftKey: true })), false);
    assert.equal(alleWaehlenKuerzel(taste({ altKey: true })), false);
    assert.equal(alleWaehlenKuerzel(taste({ metaKey: false })), false);
  });

  it("alle Bauteile des aktiven Geschosses, Öffnungen über ihre Wand", () => {
    assert.deepEqual(alleImGeschoss(MODELL, 0), [
      { type: "wall", index: 1 }, { type: "column", index: 3 }, { type: "opening", index: 4, scope: "custom" }, { type: "zone", index: 6 },
    ]);
    assert.deepEqual(alleImGeschoss(MODELL, 1).map((m) => m.index), [2, 5, 7]);
  });

  it("ausgeblendete oder gesperrte Ebenen bleiben draußen", () => {
    assert.deepEqual(alleImGeschoss(MODELL, 0, (id) => id !== "walls").map((m) => m.type), ["column", "opening", "zone"]);
  });

  it("Umschalt+Rahmen ergänzt, doppelte Einträge bleiben einmal", () => {
    const alt = [{ type: "wall", index: 1 }];
    assert.deepEqual(auswahlErgaenzen(alt, [{ type: "wall", index: 1 }, { type: "column", index: 3 }, { type: "column", index: 3 }]),
      [{ type: "wall", index: 1 }, { type: "column", index: 3 }]);
    assert.deepEqual(auswahlErgaenzen([], [{ type: "opening", index: 4, scope: "custom" }]), [{ type: "opening", index: 4, scope: "custom" }]);
  });
});
