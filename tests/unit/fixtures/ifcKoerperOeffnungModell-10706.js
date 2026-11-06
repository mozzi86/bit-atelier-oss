// 107-06: fixed example model for the golden of the massing body openings (tests/unit/fixtures/ifc-golden-107-koerperoeffnung.ifc).
// A small hull plus a massing layer with: a thin wall body with two openings (one fits, one is larger than the wall and is
// left out with a warning), a group whose definition carries an opening (two instances, one rotated) and a plain body without
// openings (written exactly as before). The layer is literal data on purpose (no generator call): the golden then only moves
// when the EXPORT changes. Do NOT change this file after the golden was written: a changed input needs a new, reviewed golden.
//
// In: nothing. Out: `{ model, opts }` — the hull model and the export options.
import { createBuildingModel } from "@core/lib/buildingModel";

/** Rectangular hull 10 m × 8 m in metres (x/z), one storey of 3 m. */
const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];

/** @returns {any} massing_layer v3 (with `oeffnungen`) */
function massingLayer() {
  return {
    v: 3,
    naechsteId: 5,
    bezug: { x: 20, y: 20 },
    gruppen: {
      "1": { profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0.24 }, { x: 0, y: 0.24 }], hoehe: 2.75, oeffnungen: [{ kante: 2, u: 2, width: 1, height: 2.1, sill: 0 }] },
    },
    koerper: [
      { id: "k1", name: "Wand", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 3, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null,
        oeffnungen: [{ kante: 2, u: 2.5, width: 1.2, height: 1.5, sill: 0.8 }, { kante: 2, u: 2.5, width: 6, height: 1, sill: 0.5 }] },
      { id: "k2", name: "Scheibe", basis: 0, pos: { x: 0, y: 30 }, drehung: 0, gruppe: "1" },
      { id: "k3", name: "Scheibe", basis: 0, pos: { x: 10, y: 30 }, drehung: 90, gruppe: "1" },
      { id: "k4", name: "Block", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 6, basis: 0, pos: { x: -10, y: 0 }, drehung: 0, gruppe: null },
    ],
  };
}

/** @returns {{ model: any, opts: Record<string, any> }} */
export function ifcKoerperOeffnungSzenario() {
  const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
  return { model, opts: { storeyHeight: 3, projectName: "Golden 107-06", timestamp: 0, massing: massingLayer() } };
}
