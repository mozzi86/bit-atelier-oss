// 107-08: fixed example model for the golden of typed Massing bodies and instance types (tests/unit/fixtures/ifc-golden-107-instanz.ifc).
// A small hull plus a massing layer v5 with: a wall box typed automatically, a column box typed by hand with status and a
// stored guid, a slab box, an untyped block, and a group of two instances (one mirrored and stretched) for the option
// `instanzTypen` (IfcBuildingElementProxyType + IfcMappedItem). A wall with set fire/sound/U values is drawn in the BIM lists.
// The layer is literal data on purpose (no generator call): the golden then only moves when the EXPORT changes.
// Do NOT change this file after the golden was written: a changed input needs a new, consciously reviewed golden.
//
// In: nothing. Out: `{ model, opts }` — the hull model and the export options.
import { createBuildingModel } from "@core/lib/buildingModel";

/** Rectangular hull 10 m × 8 m in metres (x/z), one storey of 3 m. */
const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];

/** @returns {any} massing_layer v5 */
function massingLayer() {
  return {
    v: 5,
    naechsteId: 8,
    bezug: { x: 20, y: 20 },
    gruppen: {
      "1": { profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], hoehe: 3 },
    },
    koerper: [
      { id: "k1", name: "Wand", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 2.5, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null,
        bauteil_typ: "wand-tragend", bauteil_typ_quelle: "automatisch" },
      { id: "k2", name: "Stütze", profil: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }], hoehe: 3, basis: 0, pos: { x: 18, y: 10 }, drehung: 0, gruppe: null,
        bauteil_typ: "stuetze", bauteil_typ_quelle: "nutzer", status: "bestand", guid: "3Stuetze0Gespeichert00" },
      { id: "k3", name: "Platte", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }], hoehe: 0.25, basis: 3, pos: { x: 10, y: 14 }, drehung: 0, gruppe: null,
        bauteil_typ: "decke", bauteil_typ_quelle: "automatisch" },
      { id: "k4", name: "Block", profil: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }], hoehe: 9, basis: 0, pos: { x: 30, y: 10 }, drehung: 0, gruppe: null },
      { id: "k5", name: "Pavillon", basis: 0, pos: { x: 0, y: 30 }, drehung: 0, gruppe: "1" },
      { id: "k6", name: "Pavillon", basis: 0, pos: { x: 10, y: 30 }, drehung: 90, gruppe: "1", spiegel: true, massstab: { x: 1.5, y: 1, z: 1 } },
    ],
  };
}

/** @returns {{ model: any, opts: Record<string, any> }} */
export function ifcInstanzSzenario() {
  const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
  const customWalls = [{ a: { x: -3, z: 0 }, b: { x: 3, z: 0 }, level: 0, thickness: 0.24, height: 3, composite: "single24", _idx: 1,
    feuerwiderstand: "REI90", schallschutz_rw_db: 58, u_wert: 0.28 }];
  return { model, opts: { storeyHeight: 3, projectName: "Golden 107-08", timestamp: 0, customWalls, steckbrief: { projektId: "p-golden" }, instanzTypen: true, massing: massingLayer() } };
}
