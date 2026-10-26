// 107-03: example model of the THIRD IFC golden (tests/unit/fixtures/ifc-golden-107-aufbau.ifc): the export with the layer details option
// (`steckbrief.schichtdetails`): layer Category/Priority, IfcMaterialLayerSetUsage per wall with a real build-up, material density and
// conductivity, the layer function/priority origin in the data sheet. Walls with every table build-up and core reference line, an element
// override of the layer function and priority, a project build-up with NO stated function (proposal), a thickness-only wall (no usage), a
// workshop wall (class build-up), a slab with a project build-up, a window on a core-line wall. The first two goldens stay untouched.
//
// The project build-ups are literal data and must be registered with setzeProjektAufbauten(AUFBAUTEN_LAYER) before the export (and cleared after).
// Do NOT change this file after the golden was written: a changed input needs a new, consciously reviewed golden.
//
// In: nothing. Out: `{ model, opts, AUFBAUTEN_LAYER }`.
import { createBuildingModel } from "@core/lib/buildingModel";

/** `aufbauten_layer` of the example: "p-1" without any stated function (masonry behind a clinker skin), "p-2" a slab build-up. */
export const AUFBAUTEN_LAYER = Object.freeze({
  aufbauten: Object.freeze({
    "p-1": { name: "Mauerwerk mit Klinker (Projekt)", skins: [
      { name: "Klinker", material: "klinker", thickness: 115 },
      { name: "Dämmung", material: "eps032", thickness: 160 },
      { name: "Hochlochziegel", material: "hlz", thickness: 300 },
      { name: "Innenputz", material: "gipsputz", thickness: 15 },
    ] },
    "p-2": { name: "Decke Stahlbeton + Dämmung (Projekt)", skins: [
      { name: "Stahlbeton", material: "beton", thickness: 200, funktion: "kern", prioritaet: 900 },
      { name: "Trittschalldämmung", material: "mw040", thickness: 30 },
    ] },
  }),
});

/** @returns {{ model: any, opts: Record<string, any>, AUFBAUTEN_LAYER: typeof AUFBAUTEN_LAYER }} */
export function ifcAufbauSzenario() {
  const model = createBuildingModel({
    footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 2, storeyHeight: 3, wallComposite: "cavity",
  });
  const opts = {
    storeyHeight: 3,
    projectName: "GoldenAufbau",
    customWalls: [
      { a: { x: -4, z: -3 }, b: { x: 3, z: -3 }, level: 0, height: 3, composite: "single24", refLine: "center", _idx: 1 },
      { a: { x: -4, z: -2 }, b: { x: 3, z: -2 }, level: 0, height: 3, composite: "cavity", refLine: "coreOutside", _idx: 2 },
      { a: { x: -4, z: -1 }, b: { x: 3, z: -1 }, level: 0, height: 3, composite: "timber", refLine: "coreInside", _idx: 3 },
      // element override: the clinker skin counts as core, the priority of the plaster is stated
      { a: { x: -4, z: 0 }, b: { x: 3, z: 0 }, level: 0, height: 3, composite: "cavity", refLine: "coreCenter", schicht_funktion: { 0: "kern" }, schicht_prioritaet: { 4: 100 }, _idx: 4 },
      // project build-up without a stated function: core proposed (the hlz layer, not the outer clinker)
      { a: { x: -4, z: 1 }, b: { x: 3, z: 1 }, level: 0, height: 3, composite: "p-1", refLine: "coreOutside", _idx: 5 },
      // thickness only: no real build-up, no usage
      { a: { x: -4, z: 2 }, b: { x: 3, z: 2 }, level: 0, height: 3, thickness: 0.24, refLine: "coreOutside", _idx: 6 },
    ],
    customWindows: [{ wallIdx: 2, u: 3, typeId: "double", kind: "window", _idx: 7 }],
    customSlabs: [{ points: [{ x: -4, z: -3 }, { x: 4, z: -3 }, { x: 4, z: 3 }, { x: -4, z: 3 }], level: 1, composite: "p-2", _idx: 8 }],
    werkstatt: {
      waende: [{ a: { x: -3, z: 3 }, b: { x: 3, z: 3 }, dicke_m: 0.115, hoehe_m: 3, level: 0, huelle: false, guid: "0wandGoldenAufbau0001", klasse: "leicht", lichteLaenge_m: 5.885, rohbauLaenge_m: 6, tragend: false, status: null, we: ["A", "A"] }],
      tueren: [], raeume: [], rohbau: [],
    },
    steckbrief: { projektId: "p-golden", schichtdetails: true },
  };
  return { model, opts, AUFBAUTEN_LAYER };
}
