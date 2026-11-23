// 115-05b (E-2): an element that gets a new number in an undo snapshot (or in the live merge) drops a GUID that was only derived
// from its OLD number (bauteilGuid(pid, list, {_idx: old})). Otherwise, after Strg+Z, the own room and the other writer's room
// with the old number share one GUID: furniture keyed by the room GUID is ambiguous and the IFC carries one GlobalId twice.
// A GUID of its own (not derived from the old number) stays.
//
// In: nothing. Out: assertions only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leereHistorie, vorAenderung, schrittZurueck } from "@designer/lib/bimHistorie";
import * as bimHistorie from "@designer/lib/bimHistorie";
import * as modellAbgleich from "@core/lib/abgleich/modellAbgleich";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

const PID = "pGuid11505b";
const FELDER = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen", "entranceCfg", "huelle_erscheinung"];
/** A rectangular room (m). @param {number} i @param {number} x @param {Record<string, any>} [extra] */
const raum = (i, x, extra = {}) => ({ _idx: i, level: 0, name: `R${i}`, points: [{ x, z: 0 }, { x: x + 4, z: 0 }, { x: x + 4, z: 4 }, { x, z: 4 }], ...extra });
/** The GUID the studio pins for a room with this number (guidsAnheften). @param {number} i */
const abgeleitet = (i) => bauteilGuid(PID, "customZones", { _idx: i });
/** Every room's IFC GlobalId as the export derives it. @param {any[]} liste */
const globalIds = (liste) => liste.map((z) => bauteilGuid(PID, "customZones", z));

describe("E-2: renumbering drops a GUID derived from the old number", () => {
  const s0 = { customZones: [raum(1, 0, { guid: abgeleitet(1) })] };
  const fremd = { customZones: [...s0.customZones, raum(5, 40)] }; // the other writer's room 5 (its GUID derives from 5)

  it("rule K03 (own room only in a snapshot): Strg+Z brings it back with a free number and without the old GUID", () => {
    let h = leereHistorie();
    h = vorAenderung(h, s0);
    // own room 5 drawn, saved (GUID pinned from number 5), deleted again: stored = s0, the snapshot keeps room 5 with its GUID
    h = vorAenderung(h, { customZones: [...s0.customZones, raum(5, 20, { guid: abgeleitet(5) })] });
    const h2 = bimHistorie.historieElementeUmbasieren(h, { basis: s0, fremd, umbenanntJeListe: {}, felder: FELDER, naechsteIdx: 6, projektId: PID });
    const r = schrittZurueck(h2, fremd);
    const zonen = r.snapshot.customZones;
    assert.equal(zonen.length, 3, JSON.stringify(zonen));
    const ids = globalIds(zonen);
    assert.equal(new Set(ids).size, ids.length, `a GlobalId twice: ${JSON.stringify(zonen)}`);
    const eigen = zonen.find((/** @type {any} */ z) => z.points[0].x === 20);
    assert.notEqual(eigen._idx, 5);
    assert.equal(eigen.guid, undefined, "the GUID derived from number 5 is dropped");
  });

  it("renumbering of the merge (umbenanntJeListe) drops it as well; a GUID of its own stays", () => {
    const eigenGuid = "EigeneGuid11505bxxxxxx";
    const s = { customZones: [...s0.customZones, raum(5, 20, { guid: abgeleitet(5) }), raum(6, 30, { guid: eigenGuid })] };
    const h = { stack: { past: [s], future: [] }, ziehe: false, gemerkt: false };
    const r = bimHistorie.historieElementeUmbasieren(h, { basis: s0, fremd, umbenanntJeListe: { customZones: [[5, 7], [6, 8]] }, felder: FELDER, projektId: PID });
    const zonen = r.stack.past[0].customZones;
    const ids = globalIds(zonen);
    assert.equal(new Set(ids).size, ids.length, `a GlobalId twice: ${JSON.stringify(zonen)}`);
    assert.equal(zonen.find((/** @type {any} */ z) => z._idx === 7)?.guid, undefined);
    assert.equal(zonen.find((/** @type {any} */ z) => z._idx === 8)?.guid, eigenGuid, "a GUID not derived from the old number stays");
  });

  it("live merge (neueKollisionenUmnummern + altGuidsVerwerfen) drops the derived GUID of the renumbered own element", () => {
    const lokal = { customZones: [...s0.customZones, raum(5, 20, { guid: abgeleitet(5) })] };
    const k = modellAbgleich.neueKollisionenUmnummern({ vorher: { customZones: s0.customZones }, basis: s0, lokal, patch: { customZones: fremd.customZones } });
    // the studio drops the derived GUIDs right after the merge renumbered (BitBimStudio, aufFremdenStand)
    assert.equal(typeof bimHistorie.altGuidsVerwerfen, "function");
    const r = bimHistorie.altGuidsVerwerfen(k.lokal, k.umbenanntJeListe, PID);
    const zonen = [...r.lokal.customZones, raum(5, 40)];
    const eigen = zonen.find((/** @type {any} */ z) => z.points[0].x === 20);
    assert.notEqual(eigen._idx, 5);
    assert.equal(eigen.guid, undefined);
    const ids = globalIds(zonen);
    assert.equal(new Set(ids).size, ids.length, "no GlobalId twice after the merge");
    assert.deepEqual(r.geaendert, ["customZones"]);
  });
});
