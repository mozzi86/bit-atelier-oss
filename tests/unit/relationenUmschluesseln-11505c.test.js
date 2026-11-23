// 115-05c (K8 fallback, 115-05-PLAN §6.4 point 8): when the live merge renumbers an own new element, an own solid relation that
// points at it by its derived GUID follows it - it must never end up on the other writer's element that keeps the old number.
// Relations of a stored layer (base / other writer) stay as they are.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { relationenUmschluesseln } from "@designer/lib/bimHistorie.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

const PID = "projekt-test-11505c";
const g = (/** @type {string} */ feld, /** @type {number} */ i) => bauteilGuid(PID, feld, { _idx: i });

test("an own relation follows the renumbered wall (target and operator)", () => {
  const dach = g("customRoofs", 1);
  const layer = { v: 1, relationen: [
    { id: "r1", ziel_guid: g("customWalls", 3), operator_guid: dach, operation: "abzug_nach_oben", aktiv: true },
    { id: "r2", ziel_guid: g("customWalls", 1), operator_guid: g("customWalls", 3), operation: "abzug", aktiv: true },
  ] };
  const neu = relationenUmschluesseln(layer, { customWalls: [[3, 7]] }, PID, []);
  assert.notEqual(neu, layer);
  assert.equal(neu.relationen[0].ziel_guid, g("customWalls", 7));
  assert.equal(neu.relationen[0].operator_guid, dach);
  assert.equal(neu.relationen[1].ziel_guid, g("customWalls", 1));
  assert.equal(neu.relationen[1].operator_guid, g("customWalls", 7));
  assert.equal(neu.v, 1);
  assert.equal(layer.relationen[0].ziel_guid, g("customWalls", 3), "input not mutated");
});

test("a relation of a stored layer stays (it is not this page's)", () => {
  const fremd = { id: "r1", ziel_guid: g("customWalls", 3), operator_guid: g("customRoofs", 1), operation: "abzug_nach_oben", aktiv: true };
  const layer = { relationen: [fremd] };
  assert.equal(relationenUmschluesseln(layer, { customWalls: [[3, 7]] }, PID, [null, { relationen: [{ ...fremd }] }]), layer);
});

test("nothing renumbered, nothing pointing at it, or no project → the same layer", () => {
  const layer = { relationen: [{ id: "r1", ziel_guid: g("customWalls", 1), operator_guid: g("customRoofs", 1), operation: "abzug", aktiv: true }] };
  assert.equal(relationenUmschluesseln(layer, {}, PID), layer);
  assert.equal(relationenUmschluesseln(layer, { customWalls: [[3, 7]] }, PID), layer);
  assert.equal(relationenUmschluesseln(layer, { customWalls: [[1, 7]] }, null), layer);
  assert.equal(relationenUmschluesseln(null, { customWalls: [[1, 7]] }, PID), null);
});

test("a pinned GUID of its own (not derived) is not touched", () => {
  const eigen = "Eigene22stelligeGUIDxy";
  const layer = { relationen: [{ id: "r1", ziel_guid: eigen, operator_guid: g("customRoofs", 1), operation: "abzug", aktiv: true }] };
  assert.equal(relationenUmschluesseln(layer, { customWalls: [[3, 7]] }, PID), layer);
});
