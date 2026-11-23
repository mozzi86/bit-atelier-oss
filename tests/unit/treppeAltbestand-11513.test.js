// 115-13: backwards compatibility of stored stairs — a BimModel record with stairs written before 115-13 (straight flight, with and
// without `art`, GUID pinned by an earlier save) goes through the studio's load (studioWerteAusDatensatz) and save (studioPatch) and
// comes out byte for byte the same; the straight stair still computes and draws as in 108-06 (the U branch is not taken). A U stair
// with all its optional fields survives the same round trip unchanged.
// Test data: invented values, no real project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { studioWerteAusDatensatz, studioPatch } from "@designer/lib/studioLaden.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { treppeBerechnen, treppenText } from "@core/lib/bauteil/treppe.js";
import { istUTreppe, TREPPE_U } from "@core/lib/bauteil/treppeU.js";
import { treppeSymbol } from "@core/lib/plan/treppeSymbol.js";

const PID = "projekt-probe";
const HATTE = Object.freeze({ verschneidung: false, dachIfc: false, treppen: true, gauben: false, notizen: false });
/** A stair as a save before 115-13 left it: the GUID pinned (lazy GUID, 107-08). @param {Record<string, any>} t */
const gespeichert = (t) => ({ ...t, guid: bauteilGuid(PID, "customStairs", t) });

test("old straight stairs: load + save leaves customStairs byte-identical", () => {
  const alt = [
    gespeichert({ _idx: 7, level: 0, art: "gerade", start: { x: -4, z: -2 }, richtung_grad: 0, breite_m: 1 }),
    gespeichert({ _idx: 8, level: 1, start: { x: 1.5, z: 0.25 }, richtung_grad: 90, breite_m: 0.9, steigungen: 15, auftritt_m: 0.27, loch_breite_m: 1.1 }),
  ];
  const satz = { customStairs: alt, customWalls: [] };
  const vorher = JSON.stringify(satz.customStairs);
  const werte = studioWerteAusDatensatz(JSON.parse(JSON.stringify(satz)), {});
  const { patch } = studioPatch(werte, PID, HATTE);
  assert.equal(JSON.stringify(patch.customStairs), vorher);
});

test("old straight stairs are no U stairs and compute as in 108-06", () => {
  const t = { _idx: 7, level: 0, art: "gerade", start: { x: -4, z: -2 }, richtung_grad: 0, breite_m: 1 };
  assert.equal(istUTreppe(t), false);
  assert.equal(istUTreppe({ ...t, art: undefined }), false);
  const e = treppeBerechnen(t, 2.9);
  // the 108-06 hand calculation: 17 risers 17.1/28.9, symbol with 17 riser lines (5 solid, 12 dashed at a 1.00 m section)
  assert.equal(treppenText(e), "17 Stg 17,1/28,9");
  const s = treppeSymbol(e, { schnitt_m: 1.0 });
  assert.equal(s.filter((x) => x.art === "linie" && s.indexOf(x) < 18).length, 17);
});

test("a U stair with every optional field survives load + save unchanged", () => {
  const u = gespeichert({ _idx: 9, level: 0, art: TREPPE_U, start: { x: 0, z: 0 }, richtung_grad: 180, breite_m: 1.1, steigungen: 16, steigungen_lauf1: 9,
    auge_m: 0.25, podest_tiefe_m: 1.2, wende: "rechts" });
  const vorher = JSON.stringify([u]);
  const { patch } = studioPatch(studioWerteAusDatensatz({ customStairs: JSON.parse(vorher) }, {}), PID, HATTE);
  assert.equal(JSON.stringify(patch.customStairs), vorher);
});
