// 115-05a (A-2, K1): when is a studio tab "clean" (it takes a foreign state as a whole and reloads), and which way does a
// foreign state go (current / reload / merge). The decision compares id and updated_date for INEQUALITY - an import or a
// seed keeps an older updated_date and is "another state" all the same.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { studioSauber, standEntscheiden } from "@core/lib/abgleich/standWaechter.js";

const ABBILD = { customWalls: [{ _idx: 1, a: { x: 0, z: 0 }, b: { x: 4, z: 0 } }], dachform: "flach", verschneidung: false };
/** A clean tab; `aenderung` overrides single conditions. @param {Record<string, any>} [aenderung] */
const zustand = (aenderung = {}) => ({
  abbild: ABBILD, jetzt: JSON.parse(JSON.stringify(ABBILD)), ausstehend: false, imFlug: false, fehler: false, gesperrt: [], ziehe: false, ...aenderung,
});

test("studioSauber: values equal to the stored image and nothing pending → clean", () => {
  assert.equal(studioSauber(zustand()), true);
  // a key holding undefined counts like a missing key (gleichWert / stabilerText)
  assert.equal(studioSauber(zustand({ jetzt: { ...ABBILD, huelle_erscheinung: undefined } })), true);
});

test("studioSauber: every K1 condition alone makes the tab unclean", () => {
  assert.equal(studioSauber(zustand({ jetzt: { ...ABBILD, dachform: "sattel" } })), false, "a value differs");
  assert.equal(studioSauber(zustand({ jetzt: { ...ABBILD, customWalls: [...ABBILD.customWalls, { _idx: 2 }] } })), false, "an element differs");
  assert.equal(studioSauber(zustand({ ausstehend: true })), false, "a save timer is open");
  assert.equal(studioSauber(zustand({ imFlug: true })), false, "a save is on its way");
  assert.equal(studioSauber(zustand({ fehler: true })), false, "the last save failed (saveState error)");
  assert.equal(studioSauber(zustand({ gesperrt: ["customWalls"] })), false, "a field is held back by an open conflict");
  assert.equal(studioSauber(zustand({ ziehe: true })), false, "a grip drag is open");
  assert.equal(studioSauber(zustand({ abbild: null })), false, "no stored image yet (not loaded)");
});

test("standEntscheiden: equal → aktuell; other + clean → neu-laden; other + own changes → abgleichen", () => {
  const basis = { id: "b1", updated_date: "2026-11-19T10:00:00.000Z" };
  assert.equal(standEntscheiden({ basis, server: { ...basis }, sauber: true }), "aktuell");
  assert.equal(standEntscheiden({ basis, server: { ...basis }, sauber: false }), "aktuell");
  const neuer = { id: "b1", updated_date: "2026-11-19T10:05:00.000Z" };
  assert.equal(standEntscheiden({ basis, server: neuer, sauber: true }), "neu-laden");
  assert.equal(standEntscheiden({ basis, server: neuer, sauber: false }), "abgleichen");
});

test("standEntscheiden: an OLDER updated_date and another record id count as another state; no base → abgleichen", () => {
  const basis = { id: "b1", updated_date: "2026-11-19T10:00:00.000Z" };
  const aelter = { id: "b1", updated_date: "2026-11-18T09:00:00.000Z" };
  assert.equal(standEntscheiden({ basis, server: aelter, sauber: true }), "neu-laden");
  assert.equal(standEntscheiden({ basis, server: aelter, sauber: false }), "abgleichen");
  const andereId = { id: "b2", updated_date: basis.updated_date };
  assert.equal(standEntscheiden({ basis, server: andereId, sauber: true }), "neu-laden");
  assert.equal(standEntscheiden({ basis: null, server: basis, sauber: true }), "abgleichen");
  assert.equal(standEntscheiden({ basis: undefined, server: basis, sauber: true }), "abgleichen");
});
