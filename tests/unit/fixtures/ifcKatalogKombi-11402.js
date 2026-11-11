// 114-02 (user sample, 08.11.2026): the catalogue types TOGETHER with the roof paths of phase 108 in one export. The test house
// (efh-108.js, neutral data) with a knee wall under its gable roof 45°: hull gable walls up to the roof contour (108-03), a drawn
// attic wall WITH `katalog_typ` that crosses under the roof slope and is cut by it (mitWandProfilen), a stair whose opening is derived
// in the slab above (IfcOpeningElement, 108-06), a dormer on the global roof (IfcRoof, 108-13), catalogue walls on the ground floor
// and a catalogue floor covering. Hull walls, hull slabs and the roof carry no catalogue type — unlike ifcKatalogModell-11402.js this
// model is mixed on purpose (the auto-merge of ifcExport.js on 08.11. touched exactly these paths side by side).
//
// Used by tests/unit/ifcExport-kombi-11402.test.js and by ifcKatalogExport-11402.mjs (variant "kombi": the file the harness validates
// with ifcopenshell, harness/tests/test_app_ifc_export.py).
//
// In: nothing. Out: `{ model, opts, erwartet }` for exportIFC / exportIFCMitKatalog (lengths in m); `erwartet` names what the
// tests count (catalogue keys in use, level of the attic wall).
import { neueTreppe } from "@core/lib/bauteil/treppe.js";
import { neueGaube } from "@core/lib/bauteil/gauben.js";
import { EFH_108, efhModellMitKniestock, efhGeschosseMitKniestock } from "./efh-108.js";

/** `_idx` of the drawn attic wall with a catalogue type (cut by the roof). */
export const KOMBI_DG_WAND_IDX = 13;

/**
 * @returns {{ model: any, opts: Record<string, any>, erwartet: { wandTypen: string[], belagTypen: string[] } }}
 */
export function ifcKombiSzenario() {
  const model = efhModellMitKniestock();
  const fp = EFH_108.footprintM; // 11.4 m (x, ridge direction) × 10.2 m (z)
  const belag = [{ x: 0.5, z: -4.5 }, { x: 5, z: -4.5 }, { x: 5, z: 0 }, { x: 0.5, z: 0 }];
  const opts = {
    storeyHeight: EFH_108.storeyHeight,
    geschosse: efhGeschosseMitKniestock(),
    projectName: "Katalogprobe Dach",
    dachGlobal: { form: EFH_108.dachform, neigung_grad: EFH_108.dachneigung },
    customWalls: [
      // ground floor: a partition and a solid wall of the catalogue
      { a: { x: -0.5, z: -5.1 }, b: { x: -0.5, z: 5.1 }, level: 0, katalog_typ: "gk-2-lagen-12-5-cm", _idx: 11 },
      { a: { x: -0.5, z: 0.6 }, b: { x: 5.7, z: 0.6 }, level: 0, katalog_typ: "ks-wdvs-42-cm", refLine: "center", _idx: 12 },
      // attic: runs across the ridge from eaves side to eaves side → both ends are cut by the roof slope above the 1 m knee wall
      { a: { x: 2, z: -4.6 }, b: { x: 2, z: 4.6 }, level: 1, katalog_typ: "gk-2-lagen-12-5-cm", _idx: KOMBI_DG_WAND_IDX },
    ],
    customSlabs: [
      { points: belag, level: 0, katalog_typ: "estrich-parkett-15-cm", dicke_m: 0.15, bezug: "unten", _idx: 14 },
    ],
    customStairs: [neueTreppe(fp, 0, EFH_108.storeyHeight, 15)],
    gauben: [neueGaube(fp, 0, 16)], // edge 0 runs along x = an eaves edge of the gable roof
    steckbrief: { projektId: "katalogprobe-dach", schichtdetails: true },
  };
  return { model, opts, erwartet: { wandTypen: ["gk-2-lagen-12-5-cm", "ks-wdvs-42-cm"], belagTypen: ["estrich-parkett-15-cm"] } };
}
