// 107-01 Task 7: example model of the SECOND IFC golden (tests/unit/fixtures/ifc-golden-107-reflinie.ifc): walls
// with reference line "outside" and "inside" (hull and drawn), an opening and a door on an offset wall, and a
// beam with a reference line. The first golden (ifcGoldenModell-107.js) has none of them and stays untouched.
//
// In: nothing. Out: `{ model, opts }` for exportIFC (no data sheet option; `mitSteckbrief` adds it and the beam).
import { createBuildingModel } from "@core/lib/buildingModel";

/** @returns {{ model: any, opts: Record<string, any>, mitSteckbrief: Record<string, any> }} */
export function ifcReflinieSzenario() {
  const model = createBuildingModel({
    footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 2, storeyHeight: 3, huelleBezug: "outside",
  });
  const opts = {
    storeyHeight: 3,
    projectName: "GoldenRef",
    customWalls: [
      { a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24, refLine: "outside", _idx: 1 },
      { a: { x: 3, z: -3 }, b: { x: 3, z: 3 }, level: 0, height: 3, composite: "cavity", refLine: "inside", _idx: 2 },
      { a: { x: -4, z: 2 }, b: { x: 1, z: 2.5 }, level: 1, height: 3, thickness: 0.115, refLine: "outside", _idx: 3 },
      { a: { x: -4, z: 3 }, b: { x: 0, z: 3 }, level: 0, height: 3, thickness: 0.24, refLine: "center", _idx: 4 },
    ],
    customWindows: [
      { wallIdx: 1, u: 3, typeId: "double", kind: "window", _idx: 5 },
      { wallIdx: 2, u: 2, typeId: "single", kind: "door", _idx: 6 },
    ],
    envOpenings: [{ level: 0, edge: 0, u: 5, typeId: "entrance", kind: "door", _idx: 7 }],
    autoOpenings: [{ level: 0, edge: 1, u: 4, kind: "window", width: 1.2, height: 1.4, sill: 0.9 }],
    tragwerk: { traeger: [{ id: "tr_1", level: 0, a: { x: -4, z: 0 }, b: { x: 4, z: 0 }, breite_m: 0.3, refLine: "outside" }] },
  };
  return { model, opts, mitSteckbrief: { ...opts, steckbrief: { projektId: "p-golden" } } };
}
