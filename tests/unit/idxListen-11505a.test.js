// 115-05a (A-1): the ten element lists that share the `_idx` counter live in ONE module (idxListen.js); the renumbering of
// the holder and the next free number read them from there, and without the full base nothing is renumbered.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { IDX_LISTEN, naechsteFreieIdx } from "@core/lib/abgleich/idxListen.js";
import { naechsteFreieIdx as ausAenderungen } from "@core/lib/zeigen/aenderungen.js";
import { ELEMENT_FELDER, neueKollisionenUmnummern } from "@core/lib/abgleich/modellAbgleich";

test("IDX_LISTEN: the eleven lists (canopies W-1118-29 last), frozen, the same set as ELEMENT_FELDER", () => {
  assert.deepEqual([...IDX_LISTEN], [
    "customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen", "vordaecher",
  ]);
  assert.ok(Object.isFrozen(IDX_LISTEN));
  assert.deepEqual(new Set(IDX_LISTEN), new Set(Object.keys(ELEMENT_FELDER)));
});

test("naechsteFreieIdx: one function (re-exported by zeigen/aenderungen.js), over all ten lists", () => {
  assert.equal(ausAenderungen, naechsteFreieIdx);
  assert.equal(naechsteFreieIdx({}), 1);
  assert.equal(naechsteFreieIdx({ customWalls: [{ _idx: 3 }], planNotizen: [{ _idx: 9 }], gauben: [{ _idx: "x" }] }), 10);
});

test("without the full base nothing is renumbered (a conflict card instead of a mix)", () => {
  const lokal = { customWalls: [{ _idx: 1 }, { _idx: 2, a: { x: 20, z: 0 } }] };
  const patch = { customColumns: [{ _idx: 2, x: 1, z: 1 }] };
  for (const basis of [undefined, null]) {
    const r = neueKollisionenUmnummern(/** @type {any} */ ({ vorher: { customColumns: [] }, basis, lokal, patch }));
    assert.deepEqual(r.umbenannt, []);
    assert.deepEqual(r.geaendert, []);
    assert.equal(r.lokal.customWalls, lokal.customWalls);
  }
});
