// 115-05a (D-115-50): a tab with an older state never mixes old and new elements. Behaviour tests of the pure merge parts
// of the BIM studio's holder (modellAbgleich.js) - only exports that exist since 106-09, so a red run shows wrong
// behaviour, not a missing import.
//   1. the D-115-50 trace in the form of the review: `vorher` holds only the changed fields (useBimModelSync.js
//      fremdEinarbeiten), the full old base comes as `basis` - the result is exactly the foreign state
//   2. rooms numbered first (zones 1,2 against walls 1,2 of the base) - nothing of the base is revived
//   3. 106-09 stays: a local NEW wall with the number of a foreign new column is renumbered, its window follows
//   4. the lists of stairs, dormers and plan notes count for the renumbering and the next free number
//   5. K12: a duplicate `_idx` counts per list - a locally changed base wall 3 and a foreign new door 3 both stay
//   6. labels of the three new lists and of the envelope appearance
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  neueKollisionenUmnummern, fremdeElementeAbgleichen, ELEMENT_FELDER, STUDIO_WERTE, aenderungsZeilen, elementDiff,
} from "@core/lib/abgleich/modellAbgleich";

/** A drawn wall, 4 m long on z = 0 (metres). @param {number} i @param {number} x @param {Record<string, any>} [extra] */
const wand = (i, x, extra = {}) => ({ _idx: i, a: { x, z: 0 }, b: { x: x + 4, z: 0 }, level: 0, thickness: 0.3, height: 3, ...extra });
/** A door on wall `wallIdx` (u = relative position 0 … 1). @param {number} i @param {number} wallIdx */
const tuer = (i, wallIdx) => ({ _idx: i, wallIdx, u: 0.5, kind: "door", typeId: "single" });
/** A room (square, 4 × 4 m). @param {number} i @param {number} x */
const raum = (i, x) => ({ _idx: i, level: 0, name: `Raum ${i}`, points: [{ x, z: 0 }, { x: x + 4, z: 0 }, { x: x + 4, z: 4 }, { x, z: 4 }] });
/** The ten element lists, empty. */
const LEER = Object.freeze({
  customWalls: [], customColumns: [], customWindows: [], envOpenings: [], customZones: [], customSlabs: [], customRoofs: [],
  customStairs: [], gauben: [], planNotizen: [],
});

/**
 * The holder's merge as the studio runs it: renumber local-new collisions, then three ways per changed field.
 * @param {{basis: Record<string, any>|null, lokal: Record<string, any>, patch: Record<string, any>}} a
 * @returns {{ergebnis: Record<string, any>, kollision: ReturnType<typeof neueKollisionenUmnummern>, abgleich: ReturnType<typeof fremdeElementeAbgleichen>}}
 */
function zusammenfuehren({ basis, lokal, patch }) {
  const felder = Object.keys(patch);
  // useBimModelSync.js fremdEinarbeiten: `vorher` = the base of the CHANGED fields only
  const vorher = Object.fromEntries(felder.map((k) => [k, basis?.[k]]));
  const kollision = neueKollisionenUmnummern(/** @type {any} */ ({ vorher, basis, lokal, patch }));
  const listen = { ...lokal, ...Object.fromEntries(kollision.geaendert.map((k) => [k, kollision.lokal[k]])) };
  const abgleich = fremdeElementeAbgleichen({ patch, vorher, lokal: listen, felder });
  return { ergebnis: { ...listen, ...abgleich.setzen }, kollision, abgleich };
}

test("1. D-115-50: base walls 1,2 + doors 3,4, foreign walls 3,4 + doors 5,6 → exactly the foreign state, no old element", () => {
  const basis = { ...LEER, customWalls: [wand(1, 0), wand(2, 10)], customWindows: [tuer(3, 1), tuer(4, 2)] };
  const patch = { customWalls: [wand(3, 20), wand(4, 30)], customWindows: [tuer(5, 3), tuer(6, 4)] };
  const { ergebnis, kollision, abgleich } = zusammenfuehren({ basis, lokal: { ...basis }, patch });
  assert.deepEqual(ergebnis.customWindows.map((/** @type {any} */ o) => o._idx), [5, 6], "doors after the merge");
  assert.deepEqual(kollision.umbenannt, [], "no element of the stored base is renumbered");
  assert.deepEqual(ergebnis.customWalls, patch.customWalls);
  assert.deepEqual(ergebnis.customWindows, patch.customWindows);
  assert.deepEqual(ergebnis.customWindows.map((/** @type {any} */ o) => o.wallIdx), [3, 4]);
  assert.deepEqual(abgleich.konflikte, {});
});

test("2. rooms numbered first: base walls 1,2,3 + rooms 4,5, foreign rooms 1,2 + walls 3',4,5 → the foreign lists", () => {
  const basis = { ...LEER, customWalls: [wand(1, 0), wand(2, 10), wand(3, 20)], customZones: [raum(4, 0), raum(5, 10)] };
  const patch = { customZones: [raum(1, 40), raum(2, 50)], customWalls: [wand(3, 20, { height: 4 }), wand(4, 60), wand(5, 70)] };
  const { ergebnis, kollision, abgleich } = zusammenfuehren({ basis, lokal: { ...basis }, patch });
  assert.deepEqual(ergebnis.customWalls.map((/** @type {any} */ w) => w._idx), [3, 4, 5], "walls after the merge");
  assert.deepEqual(ergebnis.customZones.map((/** @type {any} */ z) => z._idx), [1, 2], "rooms after the merge");
  assert.deepEqual(kollision.umbenannt, []);
  assert.deepEqual(ergebnis.customWalls, patch.customWalls);
  assert.deepEqual(ergebnis.customZones, patch.customZones);
  assert.deepEqual(abgleich.konflikte, {});
});

test("3. 106-09 stays: a local NEW wall 2 against a foreign new column 2 → max + 1, its window follows", () => {
  const basis = { ...LEER, customWalls: [wand(1, 0)] };
  const lokal = { ...basis, customWalls: [wand(1, 0), wand(2, 20)], customWindows: [{ _idx: 3, wallIdx: 2, u: 0.5, kind: "window" }] };
  const patch = { customColumns: [{ _idx: 2, x: 1, z: 1, level: 0, size: 0.4 }] };
  const { ergebnis, kollision } = zusammenfuehren({ basis, lokal, patch });
  assert.deepEqual(kollision.umbenannt, [[2, 4]]);
  assert.deepEqual(ergebnis.customWalls.map((/** @type {any} */ w) => w._idx), [1, 4]);
  assert.equal(ergebnis.customWindows[0].wallIdx, 4, "the opening follows its wall");
  assert.deepEqual(ergebnis.customColumns, patch.customColumns);
  assert.equal(kollision.naechsteIdx, 5);
});

test("4. new lists: a local new stair 7 against a foreign new dormer 7 is renumbered; plan note 20 → next number 21", () => {
  const basis = { ...LEER, customWalls: [wand(1, 0)] };
  const lokal = { ...basis, customStairs: [{ _idx: 7, start: { x: 1, z: 1 }, richtung_grad: 0, breite_m: 1, level: 0 }] };
  const patch = { gauben: [{ _idx: 7, edge: 0, u_von_m: 1, u_bis_m: 3 }] };
  const { ergebnis, kollision } = zusammenfuehren({ basis, lokal, patch });
  assert.deepEqual(kollision.umbenannt, [[7, 8]], "the local new stair gets a free number");
  assert.deepEqual(ergebnis.customStairs.map((/** @type {any} */ s) => s._idx), [8]);
  assert.deepEqual(ergebnis.gauben, patch.gauben);
  const notizen = { ...LEER, customWalls: [wand(1, 0)], planNotizen: [{ _idx: 20, x: 0, z: 0, level: 0, text: "Notiz" }] };
  assert.equal(neueKollisionenUmnummern(/** @type {any} */ ({ vorher: {}, basis: notizen, lokal: notizen, patch: {} })).naechsteIdx, 21);
});

test("5. K12: a locally changed base wall 3 and a foreign new door 3 - no renumbering, both stay", () => {
  const basis = { ...LEER, customWalls: [wand(3, 0)] };
  const lokal = { ...basis, customWalls: [wand(3, 0, { height: 4 })] };
  const patch = { customWindows: [tuer(3, 3)] };
  const { ergebnis, kollision, abgleich } = zusammenfuehren({ basis, lokal, patch });
  assert.deepEqual(kollision.umbenannt, [], "duplicate numbers count per list");
  assert.deepEqual(ergebnis.customWalls, lokal.customWalls, "my changed wall 3 stays as it is");
  assert.deepEqual(ergebnis.customWindows, patch.customWindows, "the foreign door 3 comes in");
  assert.deepEqual(abgleich.konflikte, {});
});

test("6. labels: eleven element lists, the envelope appearance, 'Treppe #7'", () => {
  assert.equal(Object.keys(ELEMENT_FELDER).length, 11); // W-1118-29: canopies
  assert.equal(/** @type {any} */ (STUDIO_WERTE).huelle_erscheinung, "Erscheinung der Hülle");
  const zeilen = aenderungsZeilen(elementDiff("customStairs", [], [{ _idx: 7, level: 0 }]));
  assert.equal(zeilen[0].text, "Treppe #7: neu");
});
