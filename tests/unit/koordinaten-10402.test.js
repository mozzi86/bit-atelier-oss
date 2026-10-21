// 104-02: CAD coordinate input — length in pointer direction, @relative, @polar, #absolute (German decimals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { koordinateLesen, zielPunkt, meterLesen } from "@core/lib/massing/koordinaten.js";

test("Lesen: Länge, relativ, polar, absolut, Einheiten, Unsinn", () => {
  assert.deepEqual(koordinateLesen("5,40"), { art: "laenge", wert: 5.4 });
  assert.deepEqual(koordinateLesen("@3;4"), { art: "relativ", dx: 3, dy: 4 });
  assert.deepEqual(koordinateLesen("@ 250cm ; -1,5"), { art: "relativ", dx: 2.5, dy: -1.5 });
  assert.deepEqual(koordinateLesen("@10<30"), { art: "polar", abstand: 10, winkel: 30 });
  assert.deepEqual(koordinateLesen("#12;8"), { art: "absolut", x: 12, y: 8 });
  assert.equal(meterLesen("450mm"), 0.45);
  for (const unsinn of ["", "@3", "@3,4", "#5", "@10<", "abc", "@x<30"]) assert.equal(koordinateLesen(unsinn), null, unsinn);
});

test("Zielpunkt: Norden ist oben (y im Plan nach unten), Winkel gegen den Uhrzeigersinn", () => {
  const letzter = { x: 10, y: 10 };
  assert.deepEqual(zielPunkt(koordinateLesen("@3;4"), { letzter }).punkt, { x: 13, y: 6 });
  assert.deepEqual(zielPunkt(koordinateLesen("@5<90"), { letzter }).punkt, { x: 10, y: 5 });
  assert.deepEqual(zielPunkt(koordinateLesen("@5<0"), { letzter }).punkt, { x: 15, y: 10 });
  assert.deepEqual(zielPunkt(koordinateLesen("#2;3"), {}).punkt, { x: 2, y: -3 });
  assert.deepEqual(zielPunkt(koordinateLesen("5"), { letzter, cursor: { x: 10, y: 30 } }).punkt, { x: 10, y: 15 });
  assert.match(zielPunkt(koordinateLesen("@1;1"), {}).fehler, /Startpunkt/);
  assert.match(zielPunkt(koordinateLesen("5"), { letzter }).fehler, /Richtung/);
});
