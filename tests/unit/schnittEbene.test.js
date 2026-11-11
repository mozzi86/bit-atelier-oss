// Unit tests for schnittEbene.js (quick task 261110-vf3): the clipping plane of a 3D section.
// Style: node:test, German titles, hand calculation in comments. Abstract box, no project data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { schnittEbene, SCHNITT_ARTEN, SCHNITT_AUS } from "@core/lib/zeigen/schnittEbene.js";

/** Box 20 m (x) × 12 m (y) × 10 m (z), lower corner at (−10, 0, −5). */
const BOX = { min: [-10, 0, -5], max: [10, 12, 5] };
/** n·p + c for a plane result. */
const seite = (e, p) => e.normale[0] * p[0] + e.normale[1] * p[1] + e.normale[2] * p[2] + e.konstante;

describe("schnittEbene", () => {
  it("aus oder unbekannt: keine Ebene", () => {
    assert.equal(schnittEbene(SCHNITT_AUS, BOX), null);
    assert.equal(schnittEbene({ art: /** @type {any} */ ("schraeg"), lage: 50, umgekehrt: false }, BOX), null);
    assert.equal(schnittEbene({ art: "h", lage: 50, umgekehrt: false }, /** @type {any} */ (null)), null);
    assert.deepEqual([...SCHNITT_ARTEN], ["aus", "h", "x", "z"]);
  });
  it("waagerecht in der Mitte: Ebene bei y = 6 m, unten bleibt", () => {
    const e = schnittEbene({ art: "h", lage: 50, umgekehrt: false }, BOX);
    assert.deepEqual(e.normale, [0, -1, 0]);
    assert.equal(e.konstante, 6); // −y + 6 ≥ 0  ⇔  y ≤ 6
    assert.deepEqual(e.punkt, [0, 6, 0]);
    assert.ok(seite(e, [3, 2, 1]) > 0, "unter der Ebene bleibt");
    assert.ok(seite(e, [3, 9, 1]) < 0, "über der Ebene fällt weg");
    assert.equal(seite(e, [0, 6, 0]), 0);
  });
  it("Lage in Prozent der Modellhöhe: 25 % von 12 m = 3 m", () => {
    assert.equal(schnittEbene({ art: "h", lage: 25, umgekehrt: false }, BOX).konstante, 3);
    assert.equal(schnittEbene({ art: "h", lage: 0, umgekehrt: false }, BOX).konstante, 0);
    assert.equal(schnittEbene({ art: "h", lage: 100, umgekehrt: false }, BOX).konstante, 12);
    assert.equal(schnittEbene({ art: "h", lage: 250, umgekehrt: false }, BOX).konstante, 12, "über 100 % bleibt am Rand");
  });
  it("senkrecht X bei 75 %: x = −10 + 0,75 · 20 = 5 m, kleinere x bleiben", () => {
    const e = schnittEbene({ art: "x", lage: 75, umgekehrt: false }, BOX);
    assert.deepEqual(e.normale, [-1, 0, 0]);
    assert.equal(e.konstante, 5);
    assert.deepEqual(e.punkt, [5, 6, 0]);
    assert.ok(seite(e, [-3, 1, 1]) > 0);
    assert.ok(seite(e, [8, 1, 1]) < 0);
  });
  it("senkrecht Z bei 50 %: z = 0 m", () => {
    const e = schnittEbene({ art: "z", lage: 50, umgekehrt: false }, BOX);
    assert.deepEqual(e.normale, [0, 0, -1]);
    assert.equal(e.konstante === 0, true); // −0 and 0 both mean "through the origin"
    assert.ok(seite(e, [0, 0, -2]) > 0);
    assert.ok(seite(e, [0, 0, 2]) < 0);
  });
  it("Seite wechseln behält die andere Hälfte, die Ebene liegt gleich", () => {
    const a = schnittEbene({ art: "h", lage: 25, umgekehrt: false }, BOX);
    const b = schnittEbene({ art: "h", lage: 25, umgekehrt: true }, BOX);
    assert.deepEqual(b.normale, [0, 1, 0]);
    assert.equal(b.konstante, -3); // y − 3 ≥ 0
    assert.deepEqual(b.punkt, a.punkt);
    assert.ok(seite(b, [0, 9, 0]) > 0 && seite(a, [0, 9, 0]) < 0);
  });
  it("Box ohne Ausdehnung auf der Achse: keine Ebene", () => {
    assert.equal(schnittEbene({ art: "h", lage: 50, umgekehrt: false }, { min: [0, 4, 0], max: [5, 4, 5] }), null);
    assert.equal(schnittEbene({ art: "x", lage: 50, umgekehrt: false }, { min: [NaN, 0, 0], max: [5, 4, 5] }), null);
  });
});
