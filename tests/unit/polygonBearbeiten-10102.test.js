// 101-02b: plot boundary editing — move/insert/delete a corner, move an edge parallel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eckeVerschieben, eckeEinfuegen, eckeLoeschen, kanteVerschieben, kantenMitten } from "@core/lib/polygonBearbeiten.js";

const Q = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

test("Ecke verschieben, einfügen (Mitte oder Position), löschen mit Minimum 3", () => {
  assert.deepEqual(eckeVerschieben(Q, 1, { x: 12, y: -1 })[1], { x: 12, y: -1 });
  assert.equal(Q[1].x, 10, "input unchanged");
  const e = eckeEinfuegen(Q, 0);
  assert.equal(e.length, 5);
  assert.deepEqual(e[1], { x: 5, y: 0 });
  assert.deepEqual(eckeEinfuegen(Q, 3, { x: 0, y: 4 })[4], { x: 0, y: 4 });
  assert.equal(eckeLoeschen(Q, 2).length, 3);
  assert.equal(eckeLoeschen(eckeLoeschen(Q, 2), 0).length, 3, "never below three corners");
});

test("Kante parallel verschieben: nur der Anteil senkrecht zur Kante zählt", () => {
  const k = kanteVerschieben(Q, 0, { x: 7, y: -3 }); // top edge, moved 3 up; the 7 along the edge is ignored
  assert.deepEqual([k[0], k[1]], [{ x: 0, y: -3 }, { x: 10, y: -3 }]);
  assert.deepEqual([k[2], k[3]], [Q[2], Q[3]]);
  assert.deepEqual(kantenMitten(Q)[1], { x: 10, y: 5 });
});
