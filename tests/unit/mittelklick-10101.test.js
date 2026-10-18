// 101-01: two/three clicks on the mouse wheel within the window = zoom extents; other buttons and
// slow clicks do not count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mittelklickZaehler } from "@core/lib/mittelklick.js";

test("Doppel- und Dreifachklick auf das Mausrad, nicht bei langsamen Klicks oder anderen Tasten", () => {
  const z = mittelklickZaehler(450);
  assert.equal(z({ button: 1, timeStamp: 0 }), false);
  assert.equal(z({ button: 1, timeStamp: 300 }), true);
  assert.equal(z({ button: 1, timeStamp: 600 }), true);
  assert.equal(z({ button: 1, timeStamp: 2000 }), false);
  assert.equal(z({ button: 0, timeStamp: 2100 }), false);
  assert.equal(z({ button: 1, timeStamp: 3000 }), false);
});
