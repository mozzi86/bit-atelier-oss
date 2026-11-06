// Test model of plan 107-12 (view state): a two-storey hull with the cavity build-up, drawn walls (composite, plain, status),
// a column, a zone, placed windows / doors / penetrations on hull and drawn walls. Used for the "before" golden
// (fixtures/plan-10712-vorher.json, written once with the code of HEAD 20350cd6 by .planning/phases/107-bauteil-kern/tmp-e2e/golden-10712.mjs)
// and for the view-state tests. Pure data plus createBuildingModel.
import { createBuildingModel, WALL_COMPOSITES } from "@core/lib/buildingModel";
import { brilleVon } from "@core/lib/plan/brillen.js";

/**
 * @returns {{model: any, args: any, faelle: Record<string, any>}}
 */
export function planModell() {
  const cavity = WALL_COMPOSITES.find((c) => c.id === "cavity");
  const model = createBuildingModel({
    footprintM: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 9 }, { x: 0, z: 9 }],
    storeys: 2, storeyHeight: 3, wallComposite: cavity ? cavity.id : null,
  });
  const customWalls = [
    { _idx: 1, a: { x: 2, z: 2 }, b: { x: 8, z: 2 }, level: 0, composite: "single24" },
    { _idx: 2, a: { x: 2, z: 5 }, b: { x: 8, z: 5 }, level: 0, thickness: 0.115 },
    { _idx: 3, a: { x: 9, z: 2 }, b: { x: 9, z: 7 }, level: 0, thickness: 0.24, status: "abbruch", feuerwiderstand: "F90" },
  ];
  const customColumns = [{ _idx: 4, x: 5, z: 7, level: 0, size: 0.3 }];
  const customWindows = [
    { _idx: 5, wallIdx: 1, u: 0.3, typeId: "w100", kind: "window" },
    { _idx: 6, wallIdx: 2, u: 0.5, typeId: "d90", kind: "door" },
    { _idx: 7, wallIdx: 1, u: 0.8, kind: "oeffnung", width: 0.4, height: 0.4 },
  ];
  const envOpenings = [{ _idx: 8, level: 0, edge: 2, u: 0.5, typeId: "d100", kind: "door" }];
  const customZones = [{ points: [{ x: 2, z: 5 }, { x: 8, z: 5 }, { x: 8, z: 8 }, { x: 2, z: 8 }], level: 0, name: "Wohnen" }];
  const args = { model, level: 0, customWalls, customColumns, customWindows, envOpenings, customZones };
  return {
    model, args,
    faelle: {
      eingabe100: { ...args, brille: brilleVon("eingabe"), massstab: 100 },
      bauantragSw: { ...args, brille: brilleVon("bauantrag"), massstab: 100, sw: true },
      ausfuehrung50: { ...args, brille: brilleVon("ausfuehrung"), massstab: 50 },
      ohneBrille: { ...args },
    },
  };
}
