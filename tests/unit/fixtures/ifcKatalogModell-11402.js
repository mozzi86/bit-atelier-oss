// 114-02: example model with catalogue-typed elements (neutral data, no real project). A rectangular ring of four external walls of
// "KS + WDVS 42 cm" drawn so that the plan normal n = (−dz, dx) of every wall points AWAY from the building (outside), one with each
// reference line (outside / inside / center, the fourth by the exact reference `@1`), a gypsum stud partition, a reinforced-concrete slab,
// a timber slab whose catalogue build-up holds a 0 m membrane, and a screed/parquet floor covering. Hull walls, slabs and spaces of the
// building model are removed, so EVERY element of the export is catalogue-typed (the harness check counts elements without a type).
//
// Used by tests/unit/ifcExport-typen-11402.test.js and by ifcKatalogExport-11402.mjs (writes the file the harness reads with ifcopenshell,
// harness/tests/test_app_ifc_export.py). Do not change the walls without adjusting both tests.
//
// In: nothing. Out: `{ model, opts }` for exportIFC / exportIFCMitKatalog (lengths in m).
import { createBuildingModel } from "@core/lib/buildingModel";

/** @returns {{ model: any, opts: Record<string, any> }} */
export function ifcKatalogSzenario() {
  const roh = createBuildingModel({ footprintM: [{ x: 0, z: -5 }, { x: 6, z: -5 }, { x: 6, z: 0 }, { x: 0, z: 0 }], storeys: 1, storeyHeight: 3 });
  // only the storey structure of the building model: its hull walls, slabs and spaces carry no catalogue type
  const model = { ...roh, walls: [], slabs: [], spaces: [] };
  const flaeche = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: -5 }, { x: 0, z: -5 }];
  const opts = {
    storeyHeight: 3,
    projectName: "Katalogprobe",
    customWalls: [
      // ring (0,0) → (6,0) → (6,−5) → (0,−5) → (0,0): the interior lies at z < 0 and x in (0, 6), n points outside on every edge
      { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, height: 3, katalog_typ: "ks-wdvs-42-cm", refLine: "outside", _idx: 1 },
      { a: { x: 6, z: 0 }, b: { x: 6, z: -5 }, level: 0, height: 3, katalog_typ: "ks-wdvs-42-cm", refLine: "inside", _idx: 2 },
      { a: { x: 6, z: -5 }, b: { x: 0, z: -5 }, level: 0, height: 3, katalog_typ: "ks-wdvs-42-cm", refLine: "center", _idx: 3 },
      { a: { x: 0, z: -5 }, b: { x: 0, z: 0 }, level: 0, height: 3, katalog_typ: "ks-wdvs-42-cm@1", _idx: 4 },
      { a: { x: 3, z: -1 }, b: { x: 3, z: -4 }, level: 0, height: 3, katalog_typ: "gk-2-lagen-12-5-cm", _idx: 5 },
    ],
    customSlabs: [
      { points: flaeche, level: 0, katalog_typ: "rohdecke-stb-20-cm", dicke_m: 0.2, _idx: 6 },
      { points: flaeche, level: 0, katalog_typ: "holzrahmen-abgehangt-35-5-cm", dicke_m: 0.3545, bezug: "unten", _idx: 7 },
      { points: flaeche, level: 0, katalog_typ: "estrich-parkett-15-cm", dicke_m: 0.15, bezug: "unten", _idx: 8 },
    ],
    steckbrief: { projektId: "katalogprobe", schichtdetails: true },
  };
  return { model, opts };
}
