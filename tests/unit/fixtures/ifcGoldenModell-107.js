// 107-01: the ONE fixed example model of the IFC golden (tests/unit/fixtures/ifc-golden-107*.ifc).
// Every element kind the export knows appears once: hull walls, a drawn wall (reference line
// "center", explicit and implicit), column, hull slab, drawn slab, roof, windows and doors in a hull,
// a drawn and a workshop wall, zone, workshop room, massing body with group, beam, MEP network.
//
// The element lists are literal data; the hull model (createBuildingModel) and the massing layer
// (koerperAnlegen, kopieren, gruppeBilden) come from the app's own generators, so the golden checks
// model generation plus export together: it also moves when one of those generators changes its output
// (107-01 itself changed createBuildingModel for the parapet thickness without moving it). Do NOT change
// this file after the golden was written: a changed input needs a new, consciously reviewed golden.
//
// In: nothing. Out: `{ model, ohne, mit }` — export options without / with the data sheet option.
import { createBuildingModel } from "@core/lib/buildingModel";
import { leererLayer, koerperAnlegen, kopieren, gruppeBilden } from "@core/lib/massing/massingModell.js";

/** Rectangular hull 10 m × 8 m in metres (x/z), two storeys of 3 m. */
const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];

/** @returns {import("@core/lib/massing/massingModell.js").MassingLayer} massing layer with a 3-instance group and one free body */
function massingLayer() {
  const a = koerperAnlegen(leererLayer(), [{ x: 10, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 13 }, { x: 10, y: 13 }], 9);
  const k = kopieren(a.layer, [a.id], { x: 6, y: 0 }, { anzahl: 2 });
  const g = gruppeBilden(k.layer, [a.id, ...k.neu]);
  const frei = koerperAnlegen(g.layer, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], 3);
  return { ...frei.layer, bezug: { x: 12, y: 11.5 } };
}

/** @returns {{ model: any, ohne: Record<string, any>, mit: Record<string, any> }} */
export function ifcGoldenSzenario() {
  const model = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });
  const ohne = {
    storeyHeight: 3,
    projectName: "Golden",
    customWalls: [
      // single-layer drawn wall, reference line left out (old projects)
      { a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24, _idx: 1 },
      // multi-layer drawn wall, reference line "center" set explicitly
      { a: { x: -4, z: 1 }, b: { x: 3, z: 1 }, level: 0, height: 3, composite: "cavity", refLine: "center", _idx: 2 },
      // thin partition on the first upper storey
      { a: { x: -2, z: 2 }, b: { x: 2, z: 2 }, level: 1, thickness: 0.115, status: "abbruch", _idx: 3 },
    ],
    customColumns: [{ x: 3, z: 3, level: 0, size: 0.4, _idx: 4 }],
    customWindows: [
      { wallIdx: 1, u: 3, typeId: "double", kind: "window", _idx: 5 },
      { wallIdx: 2, u: 2, typeId: "single", kind: "door", _idx: 6 },
    ],
    envOpenings: [{ level: 0, edge: 0, u: 5, typeId: "entrance", kind: "door", _idx: 7 }],
    autoOpenings: [{ level: 0, edge: 1, u: 4, kind: "window", width: 1.2, height: 1.4, sill: 0.9 }],
    customZones: [{ points: [{ x: -4, z: -3 }, { x: 0, z: -3 }, { x: 0, z: -1.5 }, { x: -4, z: -1.5 }], level: 0, name: "Wohnen", _idx: 8 }],
    customSlabs: [{ points: [{ x: -4, z: -3 }, { x: 4, z: -3 }, { x: 4, z: 3 }, { x: -4, z: 3 }], level: 1, _idx: 9 }],
    customRoofs: [{ points: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], level: 1, pitch: 2.5, _idx: 10 }],
    werkstatt: {
      waende: [{ a: { x: -3, z: 0 }, b: { x: 3, z: 0 }, dicke_m: 0.115, hoehe_m: 3, level: 0, huelle: false, guid: "0wandGoldenWerkstatt01", klasse: "leicht", lichteLaenge_m: 5.885, rohbauLaenge_m: 6, tragend: false, status: null, we: ["A", "A"] }],
      tueren: [{ a: { x: 0, z: 0 }, b: { x: 0.9, z: 0 }, level: 0, zone: "Bad", breite_m: 0.9, guid: "0tuerGoldenWerkstatt01", art: "innen", nach: null, huelle: false, status: null }],
      raeume: [{ points: [{ x: -3, z: 0.1 }, { x: 3, z: 0.1 }, { x: 3, z: 3 }, { x: -3, z: 3 }], level: 0, guid: "0raumGoldenWerkstatt01", name: "Bad ·WT", status: null, we: "A", raumart: "Bad", flaeche_m2: 17.4 }],
      rohbau: [],
    },
    massing: massingLayer(),
    netz: {
      version: 1,
      knoten: [{ id: "n_1", gewerk: "heizung", art: "erzeuger", level: 0, x: 0, z: 0 }, { id: "n_2", gewerk: "lueftung", art: "auslass", level: 0, x: 3, z: 0 }],
      kanten: [{ id: "k_1", gewerk: "abwasser", level: 0, dn: 100, von: null, nach: null, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }],
    },
    tragwerk: { traeger: [{ id: "tr_1", level: 0, a: { x: -4, z: 0 }, b: { x: 4, z: 0 } }] },
  };
  const mit = { ...ohne, steckbrief: { projektId: "p-golden" } };
  return { model, ohne, mit };
}
