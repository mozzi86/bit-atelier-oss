// 89-04 (D-BW-03): no status default; unknown stays unknown ("ohne Status"); the viewer hides
// elements by status through degenerate triangles without moving index offsets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifiedElements, statusZaehler, STATUS_OHNE_LABEL } from "@core/lib/bimClassification";
import { sichtbarkeitAnwenden, expressIdAtFaceIndex } from "@ifc/lib/ifcGeometry";

const W = (extra) => ({ _idx: 0, a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, height: 3, ...extra });
const modell = (walls) => ({ footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }], storeys: 2, customWalls: walls });

test("drawn element without status → null, hull → null (no neubau default)", () => {
  const els = classifiedElements(modell([W({})]));
  assert.equal(els.find((e) => e.id === "wall-0").status, null);
  assert.ok(els.filter((e) => e.id.startsWith("hull-")).every((e) => e.status === null));
});

test("raw spellings run through the one normalisation; garbage stays null", () => {
  const els = classifiedElements(modell([W({ status: "Bestand" }), W({ _idx: 1, status: "DEMOLISH" }), W({ _idx: 2, status: "irgendwas" }), W({ _idx: 3, status: "unbekannt" })]));
  const s = (id) => els.find((e) => e.id === id).status;
  assert.deepEqual([s("wall-0"), s("wall-1"), s("wall-2"), s("wall-3")], ["bestand", "abbruch", null, null]);
});

test("statusZaehler counts null as ohne, never as neubau", () => {
  assert.deepEqual(statusZaehler([{ status: "neubau" }, { status: null }, {}, { status: "bestand" }, { status: "x" }]), { abbruch: 0, neubau: 1, bestand: 1, ohne: 3 });
  assert.equal(STATUS_OHNE_LABEL, "ohne Status");
});

test("sichtbarkeitAnwenden collapses hidden ranges, keeps offsets and the source index", () => {
  const merged = { index: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]), ranges: [{ eid: 10, start: 0, count: 3 }, { eid: 20, start: 3, count: 6 }] };
  const ziel = merged.index.slice();
  const n = sichtbarkeitAnwenden(merged, ziel, (eid) => eid !== 20);
  assert.equal(n, 1);
  assert.deepEqual([...ziel], [0, 1, 2, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual([...merged.index], [0, 1, 2, 3, 4, 5, 6, 7, 8], "source untouched");
  assert.equal(expressIdAtFaceIndex(merged.ranges, 1), 20, "face lookup still valid");
  sichtbarkeitAnwenden(merged, ziel, () => true);
  assert.deepEqual([...ziel], [...merged.index], "showing again restores");
});
