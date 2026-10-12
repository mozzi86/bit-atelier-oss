// 76-07 (D-P76-03): rules first — positions without cost group either get a rule
// proposal from the already assigned positions of the same LV, or land on the open
// list. Only the open list may go to TypeSafe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { offeneKgListe } from "@ava/lib/kgVerdichtung";

const LV = [
  { id: 1, trade: "Rohbau", short_text: "Mauerwerk KS 24 cm", din276: "331" },
  { id: 2, trade: "Rohbau", short_text: "Mauerwerk KS 17,5 cm", din276: "331" },
  { id: 3, trade: "Rohbau", short_text: "Bauzaun stellen", din276: "391" },
  { id: 4, trade: "Rohbau", short_text: "Bauzaun vorhalten", din276: "391" },
  { id: 5, trade: "Rohbau", short_text: "Mauerwerk KS 11,5 cm", din276: "331" },
];

test("keyword rule hit → rule proposal, never written", () => {
  const r = offeneKgListe([...LV, { id: 10, trade: "Rohbau", short_text: "Bauzaun abbauen", din276: "" }]);
  assert.equal(r.perRegel["10"].kg2018, "391");
  assert.match(r.perRegel["10"].regel, /bauzaun/);
  assert.equal(r.offen.length, 0);
});

test("only the trade fallback would apply → open list (fallback is no statement about the position)", () => {
  const r = offeneKgListe([...LV, { id: 11, trade: "Rohbau", short_text: "Stundenlohn Polier", din276: "" }]);
  assert.equal(r.perRegel["11"], undefined);
  assert.deepEqual(r.offen.map((p) => p.id), [11]);
});

test("unknown trade and empty LV → everything open, no rules invented", () => {
  const r = offeneKgListe([{ id: 20, trade: "Dach", short_text: "Ziegel", din276: "" }]);
  assert.equal(r.regeln.length, 0);
  assert.deepEqual(r.offen.map((p) => p.id), [20]);
  assert.deepEqual(offeneKgListe([]).offen, []);
});

test("2008 assignments are not read as 2018 codes; positions without id are skipped", () => {
  const r = offeneKgListe([
    { id: 30, trade: "X", short_text: "Bauzaun", din276: "391", din276_fassung: "2008" },
    { trade: "X", short_text: "ohne id", din276: "" },
  ]);
  assert.equal(r.regeln.length, 0);
  assert.equal(r.offen.length, 0);
});
