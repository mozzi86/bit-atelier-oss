// maplibre 6 stage of .planning/UPDATE-PLAN-2026-10-13.md: null-safe numeric comparisons in
// remote style filters (OpenFreeMap Liberty highway shields) — same result, no console warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nullSichererFilter } from "@designer/lib/maplibreStyles.js";

const SCHILD = ["all", ["<=", ["get", "ref_length"], 6], ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false]];

test("wraps a comparison of a property in a number check that falls back to false", () => {
  const neu = nullSichererFilter(SCHILD);
  assert.deepEqual(neu[1], ["case", ["==", ["typeof", ["get", "ref_length"]], "number"], ["<=", ["get", "ref_length"], 6], false]);
  assert.deepEqual(neu[2], SCHILD[2], "match stays as it is");
  assert.deepEqual(SCHILD[1], ["<=", ["get", "ref_length"], 6], "input not mutated");
});

test("property on the right-hand side and nested any/all are handled", () => {
  const neu = nullSichererFilter(["any", ["all", [">", 3, ["get", "rank"]]]]);
  assert.deepEqual(neu[1][1], ["case", ["==", ["typeof", ["get", "rank"]], "number"], [">", 3, ["get", "rank"]], false]);
});

test("filters without a property comparison keep their reference; non-arrays pass through", () => {
  const f = ["==", ["get", "class"], "motorway"];
  assert.equal(nullSichererFilter(f), f);
  assert.equal(nullSichererFilter(["<", ["zoom"], 5])[0], "<");
  assert.equal(nullSichererFilter(undefined), undefined);
  assert.equal(nullSichererFilter("x"), "x");
});
