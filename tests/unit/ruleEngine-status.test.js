// ruleEngine-status.test.js — B-87-08, status axis (87-06 follow-up).
//
// The rule editor writes the PIPELINE spelling of the StatusKonvention ("Neubau", "?"),
// the classified elements of the AVA carry the INTERNAL spelling ("neubau", null).
// Before this fix the engine compared the raw strings, so every status rule written
// in the editor silently hit 0. Both the bucket pre-index (kandidaten) and the
// selector predicate must meet in one spelling.
//
// Run: node --import ./tests/alias-register.mjs --test tests/unit/ruleEngine-status.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, matchSelektor, mengeVonRegel } from "@core/lib/rules/ruleEngine.js";
import { statusNorm } from "@core/lib/rules/elementIndex.js";

// Elements as the AVA passes them: ifc_klasse + internal status, null = unknown.
const wand = (status, guid, qty = 10) => ({
  guid, ifc_klasse: "IfcWall", status, name: `Wand ${guid}`, qty: { NetSideArea: qty },
});
const elemente = [wand("neubau", "a"), wand("neubau", "b"), wand("bestand", "c"), wand(null, "d")];

const regel = (status) => ({
  art: "modell", op: "add",
  selektor: { was: { ifc_klasse: ["IfcWall"] }, zustand: { status }, muster: {}, bereich: { qty: [] } },
  mengenbasis: "NetSideArea", faktor: 1,
});

test("statusNorm: pipeline and internal spelling meet, unknown is '?', foreign stays foreign", () => {
  assert.equal(statusNorm("Neubau"), "neubau");
  assert.equal(statusNorm("neubau"), "neubau");
  assert.equal(statusNorm("NEW"), "neubau"); // IFC enum alias of the convention
  assert.equal(statusNorm(null), "?");
  assert.equal(statusNorm(""), "?");
  assert.equal(statusNorm("?"), "?");
  assert.equal(statusNorm("Sonderfall"), "Sonderfall"); // never folded into unknown
});

test("matchSelektor: editor spelling 'Neubau' hits elements with internal 'neubau'", () => {
  const trifft = matchSelektor(regel(["Neubau"]).selektor);
  assert.deepEqual(elemente.filter(trifft).map((e) => e.guid), ["a", "b"]);
  // the other way round too — a rule written in internal spelling
  const trifftKlein = matchSelektor(regel(["neubau"]).selektor);
  assert.deepEqual(elemente.filter(trifftKlein).map((e) => e.guid), ["a", "b"]);
});

test("matchSelektor: '?' addresses the elements without status; wildcard takes all", () => {
  assert.deepEqual(elemente.filter(matchSelektor(regel(["?"]).selektor)).map((e) => e.guid), ["d"]);
  assert.equal(elemente.filter(matchSelektor(regel(["*"]).selektor)).length, 4);
  assert.equal(elemente.filter(matchSelektor(regel([]).selektor)).length, 4);
});

test("mengeVonRegel over the bucket pre-index: status rule finds its bucket (was 0 before)", () => {
  const index = buildIndex(elemente);
  const neubau = mengeVonRegel(regel(["Neubau"]), index);
  assert.equal(neubau.treffer, 2);
  assert.equal(neubau.menge, 20);
  const unbekannt = mengeVonRegel(regel(["?"]), index);
  assert.equal(unbekannt.treffer, 1);
  const abbruch = mengeVonRegel(regel(["Abbruch"]), index);
  assert.equal(abbruch.treffer, 0);
  // several statuses (OR) bypass the single-value bucket path and still match
  const beide = mengeVonRegel(regel(["Neubau", "Bestand"]), elemente);
  assert.equal(beide.treffer, 3);
});

test("buildIndex: one bucket per normalised status, whatever the elements' spelling", () => {
  const gemischt = [wand("neubau", "a"), wand("Neubau", "b"), wand("NEW", "c")];
  const index = buildIndex(gemischt);
  assert.deepEqual([...index.status], ["neubau"]);
  assert.equal(index.kandidaten("IfcWall", "Neubau").length, 3);
  assert.equal(index.kandidaten(null, "neubau").length, 3);
});
