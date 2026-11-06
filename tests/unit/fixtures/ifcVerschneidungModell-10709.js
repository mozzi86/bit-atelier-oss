// 107-09: example model of the IFC golden WITH the switch "Wände verschneiden" (tests/unit/fixtures/ifc-golden-107-verschneidung.ifc):
// a hull with a chosen build-up (cavity), an L corner of two drawn walls (single24), a T joint of a timber wall into one of them, a window
// on a cleaned wall, a wall of group 0 overlapping another one, a wall with only a thickness (stays rectSolid) and a slab with a build-up
// (onWarn: the shortening by the wall cores exists only in the solid). The 107-01 goldens stay untouched (export without the option).
//
// Do NOT change this file after the golden was written: a changed input needs a new, consciously reviewed golden.
//
// In: nothing. Out: `{ model, opts }` — the caller adds `verschneidung: { jeSchluessel }` from modellBaender().
import { createBuildingModel } from "@core/lib/buildingModel";

/** @returns {{ model: any, opts: Record<string, any> }} */
export function ifcVerschneidungSzenario() {
  const model = createBuildingModel({
    footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 2, storeyHeight: 3, wallComposite: "cavity",
  });
  const opts = {
    storeyHeight: 3,
    projectName: "GoldenVerschneidung",
    customWalls: [
      { a: { x: -3, z: -2 }, b: { x: 2, z: -2 }, level: 0, height: 3, composite: "single24", _idx: 1 },
      { a: { x: 2, z: -2 }, b: { x: 2, z: 2 }, level: 0, height: 3, composite: "single24", _idx: 2 },
      { a: { x: -1, z: -2 }, b: { x: -1, z: 1 }, level: 0, height: 3, composite: "timber", _idx: 3 },
      { a: { x: 2, z: 1 }, b: { x: 3.5, z: 1 }, level: 0, height: 3, composite: "single24", verschneidungsgruppe: 0, _idx: 5 },
      { a: { x: -3, z: 2 }, b: { x: 0, z: 2 }, level: 0, height: 3, thickness: 0.2, _idx: 6 },
    ],
    customWindows: [{ wallIdx: 1, u: 1.5, typeId: "double", kind: "window", _idx: 10 }],
    customSlabs: [{ points: [{ x: -3, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -3, z: 2 }], level: 1, composite: "single24", _idx: 20 }],
    steckbrief: { projektId: "p-golden", schichtdetails: true },
  };
  return { model, opts };
}
