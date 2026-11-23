// 115-05a (A-2): the studio values of a stored record exactly as the studio's load sets them - the same function for the
// load and for taking a foreign state over as a whole, so a clean tab's stored image ("abbild") and its state match.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { studioWerteAusDatensatz } from "@designer/lib/studioLaden.js";
import { dachMigrieren, DECKEN_STANDARD } from "@core/lib/bauteil/hoehen.js";
import { ENTRANCE_START } from "@designer/lib/autoOpenings";

const BISHER = Object.freeze({
  envComposite: "c-1", envThickness: 0.42, parapet: { enabled: false, height: 0.5 }, dachform: "walm", dachneigung: 25,
  entranceCfg: { width: 1, height: 2, uRel: 0.3, edge: 1 },
});
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen"];

test("roofs are migrated like the load does (only `pitch` → split fields)", () => {
  const alt = { _idx: 4, level: 1, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }], pitch: 2.5 };
  const w = studioWerteAusDatensatz({ customRoofs: [alt] }, BISHER);
  assert.deepEqual(w.customRoofs, [dachMigrieren(alt)]);
  assert.notDeepEqual(w.customRoofs[0], alt, "the old roof got its split fields");
});

test("single values the load sets only when the record has them come from `bisher`", () => {
  const w = studioWerteAusDatensatz({}, BISHER);
  for (const k of ["envComposite", "envThickness", "parapet", "dachform", "dachneigung", "entranceCfg"]) {
    assert.deepEqual(/** @type {any} */ (w)[k], /** @type {any} */ (BISHER)[k], k);
  }
  const mit = studioWerteAusDatensatz({ envComposite: null, envThickness: 0.3, parapet: { enabled: true, height: 1 }, dachform: "sattel", dachneigung: 0,
    entranceCfg: { width: 1.5 } }, BISHER);
  assert.equal(mit.envComposite, null, "a stored null is taken (the load checks !== undefined)");
  assert.equal(mit.envThickness, 0.3);
  assert.equal(mit.dachform, "sattel");
  assert.equal(mit.dachneigung, 0, "0 is a value (the load checks != null)");
  assert.deepEqual(mit.entranceCfg, { ...ENTRANCE_START, width: 1.5 });
});

test("missing lists become [], normalised values like the load", () => {
  const w = studioWerteAusDatensatz({ customWalls: [{ _idx: 1 }], huelle_bezug: "quer", huelle_decke_dicke_m: "x", huelle_erscheinung: "" }, BISHER);
  for (const k of LISTEN) assert.ok(Array.isArray(/** @type {any} */ (w)[k]), k);
  assert.deepEqual(w.customWalls, [{ _idx: 1 }]);
  assert.deepEqual(w.gauben, []);
  assert.equal(w.huelle_bezug, "center");
  assert.equal(w.huelle_decke_dicke_m, DECKEN_STANDARD.huelle.dicke_m);
  assert.equal(w.huelle_decke_bezug, DECKEN_STANDARD.huelle.bezug);
  assert.equal(w.huelle_erscheinung, null);
  assert.equal(w.verschneidung, false);
  assert.equal(w.dachform_ifc, false);
  const an = studioWerteAusDatensatz({ huelle_bezug: "inside", huelle_decke_dicke_m: 0.3, huelle_decke_bezug: "oben", verschneidung: true, dachform_ifc: true, huelle_erscheinung: "ziegel" }, BISHER);
  assert.deepEqual([an.huelle_bezug, an.huelle_decke_dicke_m, an.huelle_decke_bezug, an.verschneidung, an.dachform_ifc, an.huelle_erscheinung],
    ["inside", 0.3, "oben", true, true, "ziegel"]);
});
