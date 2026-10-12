// Unit tests 72-21: window arithmetic and data filter of the windowed lists
// (@core/lib/fenster.js). The hook itself is exercised by the E2E spec
// tests/e2e/listen-fenster-72-21.spec.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fensterBereich, passtFilter, FENSTER_ZEILENHOEHE } from "@core/lib/fenster.js";

test("top of the list: visible rows plus overhang below, no spacer above", () => {
  const b = fensterBereich({ scrollTop: 0, hoehe: 320, anzahl: 1000, zeilenHoehe: 32, ueberhang: 8 });
  assert.deepEqual(b, { start: 0, ende: 18, vorher: 0, nachher: (1000 - 18) * 32 });
});

test("middle: overhang on both sides, spacers add up to the full height", () => {
  const b = fensterBereich({ scrollTop: 3200, hoehe: 320, anzahl: 1000, zeilenHoehe: 32, ueberhang: 8 });
  assert.equal(b.start, 92);
  assert.equal(b.ende, 118);
  assert.equal(b.vorher + (b.ende - b.start) * 32 + b.nachher, 1000 * 32);
});

test("end of the list: last row drawn, no spacer below", () => {
  const b = fensterBereich({ scrollTop: 1000 * 32, hoehe: 320, anzahl: 1000, zeilenHoehe: 32, ueberhang: 8 });
  assert.equal(b.ende, 1000);
  assert.equal(b.nachher, 0);
});

test("filter shrinks the list while scrolled far down: window is clamped, not empty", () => {
  const b = fensterBereich({ scrollTop: 30000, hoehe: 320, anzahl: 20, zeilenHoehe: 32, ueberhang: 4 });
  assert.equal(b.ende, 20);
  assert.ok(b.ende - b.start >= 10, "a full screen of rows stays drawn");
});

test("empty list and bad inputs", () => {
  assert.deepEqual(fensterBereich({ anzahl: 0 }), { start: 0, ende: 0, vorher: 0, nachher: 0 });
  const b = fensterBereich({ scrollTop: -5, hoehe: NaN, anzahl: 5, zeilenHoehe: 0 });
  assert.equal(b.start, 0);
  assert.equal(b.ende, 5);
  assert.equal(b.vorher, 0);
  assert.ok(FENSTER_ZEILENHOEHE > 0);
});

test("passtFilter: every word must occur, case-insensitive, empty query matches", () => {
  assert.equal(passtFilter("", ["a"]), true);
  assert.equal(passtFilter("  ", []), true);
  assert.equal(passtFilter("wall dupl", ["IfcWall", "Doppelung / duplicate"]), true);
  assert.equal(passtFilter("wall slab", ["IfcWall", "IfcBeam"]), false);
  assert.equal(passtFilter("3bx", [null, undefined, "0aB3BxQ"]), true);
  assert.equal(passtFilter("12.03", [12.03, "m"]), true);
});
