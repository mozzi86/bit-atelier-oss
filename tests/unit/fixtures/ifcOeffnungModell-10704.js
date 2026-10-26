// 107-04: example model of the FOURTH IFC golden (tests/unit/fixtures/ifc-golden-107-oeffnung.ifc): the opening chain. Openings with own sizes,
// an opening without a filling in a drawn wall and in a hull wall, a sill measured from the finished floor (OKFF) above a drawn slab, a slab with
// a hole, and the penetrations of the openings planning in every state (requested box, executed box in a drawn wall, executed core drilling in a
// hull wall, rejected, one without a host). The first three goldens stay untouched.
//
// The element lists are literal data (the GUIDs of the hosts are derived with the app's own bauteilGuid). Do NOT change this file after the golden
// was written: a changed input needs a new, consciously reviewed golden.
//
// In: nothing. Out: `{ model, opts }` — export options with the data sheet option.
import { createBuildingModel } from "@core/lib/buildingModel";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
export const PROJEKT = "p-golden";

/** @returns {{ model: any, opts: Record<string, any> }} */
export function ifcOeffnungSzenario() {
  const model = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });
  const wand1 = bauteilGuid(PROJEKT, "customWalls", { _idx: 1 });
  const huelle00 = bauteilGuid(PROJEKT, "huelle", { id: "0:0" });
  const opts = {
    storeyHeight: 3,
    projectName: "GoldenOeffnung",
    customWalls: [
      // drawn wall on the ground floor, 24 cm, 6 m long
      { a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24, _idx: 1 },
      // drawn wall on storey 1: its floor is the drawn slab of level 0 (below)
      { a: { x: -4, z: 2 }, b: { x: 2, z: 2 }, level: 1, height: 3, thickness: 0.24, _idx: 2 },
    ],
    customWindows: [
      // own sizes override the type, field by field (width/height stated, sill from the type)
      { wallIdx: 1, u: 1.5, typeId: "double", kind: "window", width: 1.5, height: 1.2, sill: 0.8, _idx: 3 },
      // opening without a filling: IfcOpeningElement + IfcRelVoidsElement only
      { wallIdx: 1, u: 4.5, typeId: "oeffnung", kind: "oeffnung", width: 0.9, height: 2.0, sill: 0, wirt_guid: wand1, _idx: 4 },
      // sill 0.9 above the FINISHED floor of storey 1 (slab 0.25 m, lower edge on the storey plane → top 3.25): 3.25 − 3.0 + 0.9 above the wall bottom
      { wallIdx: 2, u: 2, typeId: "single", kind: "window", bruestung_bezug: "okff", sill: 0.9, _idx: 5 },
    ],
    envOpenings: [
      // opening without a filling in a hull wall
      { level: 0, edge: 2, u: 5, typeId: "oeffnung", kind: "oeffnung", width: 1.2, height: 1.0, sill: 1.0, _idx: 6 },
    ],
    customSlabs: [
      // floor of storey 1 (bezug "unten": lower edge on the plane of storey 1, 0.25 thick) with a rectangular hole
      { points: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], level: 0, dicke_m: 0.25, bezug: "unten", oeffnungen: [{ points: [{ x: 2, z: 1 }, { x: 3.2, z: 1 }, { x: 3.2, z: 2.5 }, { x: 2, z: 2.5 }] }], _idx: 7 },
    ],
    durchbrueche: [
      // requested box in the drawn wall 1: provision for void
      { nr: "D-001", id: "d1", art: "durchbruch", form: "rechteck", x: 0.5, y: -1, z: 2.0, b: 0.2, h: 0.2, bauteil_guid: wand1, status: "beantragt", feuerwiderstand: "ohne" },
      // executed box in the drawn wall 1: a real void (middle at u = 2.0, sill 1.3)
      { nr: "D-002", id: "d2", art: "durchbruch", form: "rechteck", x: -2, y: -1, z: 1.5, b: 0.3, h: 0.4, bauteil_guid: wand1, status: "ausgefuehrt", feuerwiderstand: "ohne" },
      // executed core drilling in the hull wall 0:0 (axis z = −4): a cylinder through the wall
      { nr: "D-003", id: "d3", art: "kernbohrung", form: "rund", x: -2, y: -4, z: 1.2, d: 0.15, bauteil_guid: huelle00, status: "ausgefuehrt", feuerwiderstand: "ohne" },
      // rejected: not written
      { nr: "D-004", id: "d4", art: "durchbruch", form: "rechteck", x: 1, y: -1, z: 1, b: 0.1, h: 0.1, bauteil_guid: wand1, status: "abgelehnt" },
      // no host: proxy in the open, reported
      { nr: "D-005", id: "d5", art: "durchbruch", form: "rechteck", x: 8, y: 8, z: 1, b: 0.2, h: 0.3, status: "beantragt" },
    ],
    steckbrief: { projektId: PROJEKT },
  };
  return { model, opts };
}
