// VOB/B § 2 Abs. 3 rating against the contracted quantity (plan 96-02).
//
// In:  packages/nova-ausschreibung/src/lib/vobMengen.js and its hook in
//      regelLauf.js. Out: assertions only.
// Covers the band edges exactly at 90 % / 110 %, just above/below, the
// separately reported excess (Spitzenmenge), the "not rated" states, unsafe
// input, the freeze at award and the per-position rating in a quantity run.

import test from "node:test";
import assert from "node:assert/strict";
import {
  VOB_STATUS, VOB_TOLERANZ, hatVertragsmenge, vertragsmengenEinfrieren, vobMengenBewertung,
} from "@ava/lib/vobMengen.js";
import { laufErzeugen } from "@ava/lib/regelLauf.js";

const bewerte = (vertragsmenge, istmenge, einheitspreis) =>
  vobMengenBewertung({ vertragsmenge, istmenge, einheitspreis });

test("tolerance band is ±10 %", () => {
  assert.equal(VOB_TOLERANZ, 0.1);
});

test("exactly 110 % and exactly 90 % stay inside the band (Nr. 1)", () => {
  const oben = bewerte(100, 110, 50);
  assert.equal(oben.status, VOB_STATUS.IM_TOLERANZBEREICH);
  assert.equal(oben.spitzenmenge, 0);
  assert.equal(oben.abweichungProzent, 10);
  assert.equal(oben.schwere, null);
  const unten = bewerte(100, 90, 50);
  assert.equal(unten.status, VOB_STATUS.IM_TOLERANZBEREICH);
  assert.equal(unten.mindermenge, 0);
  assert.equal(unten.abweichungProzent, -10);
  // Floating-point edge: 33 × 1.1 = 36.300000000000004, 36.3 must still count as 110 %.
  assert.equal(bewerte(33, 36.3).status, VOB_STATUS.IM_TOLERANZBEREICH);
  assert.equal(bewerte(33, 29.7).status, VOB_STATUS.IM_TOLERANZBEREICH);
  assert.equal(bewerte(100, 100).abweichungProzent, 0);
});

test("just above 110 % is Mehrmenge with the excess reported separately (Nr. 2)", () => {
  const r = bewerte(100, 110.01, 40);
  assert.equal(r.status, VOB_STATUS.MEHRMENGE);
  assert.equal(r.spitzenmenge, 0.01);
  assert.equal(r.schwere, "warn");
  assert.equal(r.norm, "§ 2 Abs. 3 Nr. 2 VOB/B");
});

test("Spitzenmenge = ist − 1.1 × vertragsmenge, money value at the contract unit price", () => {
  const r = bewerte(200, 250, 12.5);
  assert.equal(r.status, VOB_STATUS.MEHRMENGE);
  assert.equal(r.spitzenmenge, 30); // 250 − 220
  assert.equal(r.mindermenge, 0);
  assert.equal(r.abweichungProzent, 25);
  assert.equal(r.geldwert, 375); // 30 × 12.50 €
});

test("just below 90 % is Mindermenge (Nr. 3), not '< −90 %'", () => {
  const r = bewerte(100, 89.99, 10);
  assert.equal(r.status, VOB_STATUS.MINDERMENGE);
  assert.equal(r.mindermenge, 10.01);
  assert.equal(r.spitzenmenge, 0);
  assert.equal(r.schwere, "warn");
  assert.equal(r.geldwert, 100.1);
  // An 85 % quantity is a shortfall of 15 % — a rating of "< −90 %" would miss it.
  const r85 = bewerte(100, 85);
  assert.equal(r85.status, VOB_STATUS.MINDERMENGE);
  assert.equal(r85.abweichungProzent, -15);
  assert.equal(r85.geldwert, null); // no unit price, no money value
  // Position dropped completely: 100 % shortfall.
  assert.equal(bewerte(100, 0).abweichungProzent, -100);
});

test("without contracted quantity there is no rating", () => {
  for (const v of [undefined, null, "", 0, -5, NaN, "abc"]) {
    const r = bewerte(v, 120, 10);
    assert.equal(r.status, VOB_STATUS.OHNE_VERTRAGSMENGE, `vertragsmenge ${String(v)}`);
    assert.equal(r.abweichungProzent, null);
    assert.equal(r.spitzenmenge, 0);
    assert.equal(r.mindermenge, 0);
    assert.equal(r.schwere, null);
  }
  assert.equal(vobMengenBewertung().status, VOB_STATUS.OHNE_VERTRAGSMENGE);
});

test("unsafe current quantity or unit price never throws or invents a result", () => {
  assert.equal(bewerte(100, NaN).status, VOB_STATUS.OHNE_ISTMENGE);
  assert.equal(bewerte(100, null).status, VOB_STATUS.OHNE_ISTMENGE);
  assert.equal(bewerte(100, -3).status, VOB_STATUS.OHNE_ISTMENGE);
  assert.equal(bewerte(100, 150, NaN).geldwert, null);
  assert.equal(bewerte(100, 150, -1).geldwert, null);
  // Numeric strings (JSON records) are accepted.
  assert.equal(bewerte("100", "120", "2").geldwert, 20);
});

test("hatVertragsmenge only accepts a positive finite number", () => {
  assert.equal(hatVertragsmenge({ vertragsmenge: 12 }), true);
  assert.equal(hatVertragsmenge({ vertragsmenge: 0 }), false);
  assert.equal(hatVertragsmenge({}), false);
  assert.equal(hatVertragsmenge(null), false);
});

test("freeze at award: only tender positions, never overwrite, skip without quantity", () => {
  const tender = { position_ids: ["a", "b", "c", "d"] };
  const positionen = [
    { id: "a", quantity: 120 },
    { id: "b", quantity: 50, vertragsmenge: 40, vertragsmenge_am: "2026-01-01" },
    { id: "c", quantity: null },
    { id: "d", quantity: "7.5" },
    { id: "x", quantity: 99 },
  ];
  const patches = vertragsmengenEinfrieren(tender, positionen, "2026-10-16");
  assert.deepEqual(patches, [
    { id: "a", patch: { vertragsmenge: 120, vertragsmenge_am: "2026-10-16" } },
    { id: "d", patch: { vertragsmenge: 7.5, vertragsmenge_am: "2026-10-16" } },
  ]);
  assert.deepEqual(vertragsmengenEinfrieren(null, positionen, "2026-10-16"), []);
  assert.deepEqual(vertragsmengenEinfrieren({}, null, "2026-10-16"), []);
});

// --- run integration -------------------------------------------------------

const wand = () => ({
  guid: `G${Math.random().toString(36).slice(2, 12)}`,
  klasse: "IfcWall",
  status: "Neubau",
  typ: null,
  name: "Neu__TB__15.0cm",
  geschoss: "EG",
  qty: { NetSideArea: 10 },
});
const regel = {
  art: "modell",
  op: "add",
  selektor: {
    was: { kg: [], gewerk: [], schicht: [], ifc_klasse: ["IfcWall"] },
    zustand: { status: ["Neubau"] },
    muster: {},
    bereich: { qty: [] },
  },
  mengenbasis: "NetSideArea",
  faktor: 1,
};

test("each run row carries the VOB/B rating when a contracted quantity exists", () => {
  const elemente = [wand(), wand(), wand()]; // model quantity 30 m²
  const res = laufErzeugen(
    [
      { id: "mehr", oz: "01.01", quantity: 25, vertragsmenge: 25, unit_price: 80, regeln: [regel] },
      { id: "minder", oz: "01.02", quantity: 40, vertragsmenge: 40, unit_price: 80, regeln: [regel] },
      { id: "ok", oz: "01.03", quantity: 30, vertragsmenge: 28, regeln: [regel] },
      { id: "ohne", oz: "01.04", quantity: 25, unit_price: 80, regeln: [regel] },
    ],
    elemente,
    { snapshot_id: "snap-96" },
  );
  assert.equal(res.ok, true);
  const zeile = (id) => res.lauf.je_position.find((z) => z.position_id === id);

  const mehr = zeile("mehr");
  assert.equal(mehr.menge_neu, 30);
  assert.equal(mehr.vob_mengen.status, VOB_STATUS.MEHRMENGE);
  assert.equal(mehr.vob_mengen.spitzenmenge, 2.5); // 30 − 1.1 × 25
  assert.equal(mehr.vob_mengen.geldwert, 200); // 2.5 m² × 80 €
  assert.equal(mehr.vob_mengen.abweichungProzent, 20);

  const minder = zeile("minder");
  assert.equal(minder.vob_mengen.status, VOB_STATUS.MINDERMENGE);
  assert.equal(minder.vob_mengen.mindermenge, 10);

  assert.equal(zeile("ok").vob_mengen.status, VOB_STATUS.IM_TOLERANZBEREICH);

  // Positions without a contract keep the old row shape: no new key at all.
  assert.equal("vob_mengen" in zeile("ohne"), false);
  // Existing outputs unchanged.
  assert.equal(mehr.menge_alt, 25);
  assert.equal(mehr.differenz, 5);
  assert.equal(mehr.geldwert, 400);
});
