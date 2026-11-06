// 107-05: fixed example model for the golden of the massing inner rings (tests/unit/fixtures/ifc-golden-107-loecher.ifc).
// A small hull plus a massing layer with: a body with a courtyard (inner ring), a closed Follow-me ring, a group with a
// courtyard in its definition and two instances, a body drawn the "wrong" way round (stored clockwise in the IFC plane, the
// export writes it normalised) and an invalid bow-tie body (left out, reported through onWarn).
// The layer is literal data on purpose (no generator call): the golden then only moves when the EXPORT changes.
// Do NOT change this file after the golden was written: a changed input needs a new, consciously reviewed golden.
//
// In: nothing. Out: `{ model, opts }` — the hull model and the export options.
import { createBuildingModel } from "@core/lib/buildingModel";

/** Rectangular hull 10 m × 8 m in metres (x/z), one storey of 3 m. */
const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];

/** @returns {any} massing_layer v2 (with `loecher`) */
function massingLayer() {
  return {
    v: 2,
    naechsteId: 7,
    bezug: { x: 20, y: 20 },
    gruppen: {
      "1": { profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }], hoehe: 6, loecher: [[{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }]] },
    },
    koerper: [
      { id: "k1", name: "Hof", profil: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], loecher: [[{ x: 3, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 7 }, { x: 3, y: 7 }]], hoehe: 9, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null },
      { id: "k2", name: "Ring", profil: [{ x: 29.85, y: -0.15 }, { x: 40.15, y: -0.15 }, { x: 40.15, y: 10.15 }, { x: 29.85, y: 10.15 }], loecher: [[{ x: 30.15, y: 9.85 }, { x: 39.85, y: 9.85 }, { x: 39.85, y: 0.15 }, { x: 30.15, y: 0.15 }]], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null },
      { id: "k3", name: "Pavillon", basis: 0, pos: { x: 0, y: 30 }, drehung: 0, gruppe: "1" },
      { id: "k4", name: "Pavillon", basis: 0, pos: { x: 10, y: 30 }, drehung: 90, gruppe: "1" },
      { id: "k5", name: "Andersrum", profil: [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 0 }], hoehe: 4, basis: 0, pos: { x: -10, y: 0 }, drehung: 0, gruppe: null },
      { id: "k6", name: "Schleife", profil: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: -20, y: 0 }, drehung: 0, gruppe: null },
    ],
  };
}

/** @returns {{ model: any, opts: Record<string, any> }} */
export function ifcLoecherSzenario() {
  const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
  return { model, opts: { storeyHeight: 3, projectName: "Golden 107-05", timestamp: 0, massing: massingLayer() } };
}
