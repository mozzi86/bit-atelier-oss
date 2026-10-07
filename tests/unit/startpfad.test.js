// Visibility rule of the project start path (72-02 Task 5).
//
// The cards themselves are markup; the decision "is this project still empty?"
// is the part that can be wrong in both directions — showing beginner cards over
// a running project, or hiding the only next step a new user gets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { zeigeStartpfad } from "../../src/components/projects/startpfadRegel.js";

const PROJEKT = { id: "p1", name: "Testhaus" };

test("frisches Projekt ohne Modell zeigt den Startpfad", () => {
  assert.equal(zeigeStartpfad(PROJEKT, null), true);
  assert.equal(zeigeStartpfad(PROJEKT, {}), true);
  assert.equal(zeigeStartpfad(PROJEKT, { buildings: [], elements: [] }), true);
});

test("gezeichnete Geometrie blendet den Startpfad aus", () => {
  assert.equal(zeigeStartpfad(PROJEKT, { site_parcel: { kanteM: 40 } }), false);
  assert.equal(zeigeStartpfad(PROJEKT, { buildings: [{ id: "b1" }] }), false);
});

test("importiertes Modell blendet den Startpfad aus", () => {
  assert.equal(zeigeStartpfad(PROJEKT, { elements: [{ id: "e1" }] }), false);
});

test("ohne Projekt kein Startpfad", () => {
  assert.equal(zeigeStartpfad(null, null), false);
  assert.equal(zeigeStartpfad(undefined, { elements: [] }), false);
  assert.equal(zeigeStartpfad({}, null), false, "Projekt ohne id zählt nicht");
});

// 72-09 (N-04): the rule now decides the project overview for EVERY visit, not
// only right after creating a project — so the full sample project must not
// count as empty, and a project with work in it must not get beginner cards.

// The BimModel shape the designer stores: an outline (footprintM, points in
// metres) plus storeys, but neither site_parcel nor buildings nor elements.
// Inlined in 83-02 from the former demo seed (proj-1), which went with the demo.
const SEED_PROJ_1 = {
  project_id: "proj-1",
  footprintM: [
    { x: -32.1, z: 1.85 }, { x: -23.5, z: -10.65 }, { x: -15.2, z: -11.95 }, { x: -8.8, z: -10.05 },
    { x: 0, z: 11.45 }, { x: 32.1, z: 1.85 }, { x: 32.1, z: 11.95 }, { x: -32.1, z: 11.95 },
  ],
  storeys: 4,
};

test("Seed-Form proj-1 (Umriss aus dem Designer) zählt als Geometrie", () => {
  assert.ok(SEED_PROJ_1, "Seed enthält ein BimModel für proj-1");
  assert.equal(SEED_PROJ_1.footprintM.length, 8, "Seed-Umriss hat 8 Punkte");
  assert.equal(SEED_PROJ_1.site_parcel, undefined);
  assert.equal(SEED_PROJ_1.buildings, undefined);
  assert.equal(zeigeStartpfad({ id: "proj-1" }, SEED_PROJ_1), false);
});

test("Umriss mit weniger als drei Punkten ist noch keine Geometrie", () => {
  assert.equal(zeigeStartpfad(PROJEKT, { footprintM: [] }), true);
  assert.equal(zeigeStartpfad(PROJEKT, { footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }] }), true);
  assert.equal(zeigeStartpfad(PROJEKT, { footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }] }), false);
  assert.equal(zeigeStartpfad(PROJEKT, { footprintM: "keine Liste" }), true, "nur ein Array zählt");
});

test("leeres Projekt ohne Inhalt zeigt den Startpfad", () => {
  assert.equal(zeigeStartpfad(PROJEKT, null, { tickets: 0, lvPositionen: 0 }), true);
  assert.equal(zeigeStartpfad(PROJEKT, {}, {}), true);
  assert.equal(zeigeStartpfad(PROJEKT, null, null), true);
});

test("vorhandene Tickets oder LV-Positionen blenden den Startpfad aus", () => {
  assert.equal(zeigeStartpfad(PROJEKT, null, { tickets: 1, lvPositionen: 0 }), false);
  assert.equal(zeigeStartpfad(PROJEKT, null, { tickets: 0, lvPositionen: 13 }), false);
  assert.equal(zeigeStartpfad(PROJEKT, {}, { lvPositionen: 2 }), false);
});

test("Inhalt ändert nichts ohne Projekt", () => {
  assert.equal(zeigeStartpfad(null, null, { tickets: 0, lvPositionen: 0 }), false);
});
