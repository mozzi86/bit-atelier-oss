// 108-01: neutral test house of phase 108 — a generic single-family house 11.40 × 10.20 m with basement, ground floor and attic
// (KG −1 2.75 m, EG 0 2.90 m, DG 1 2.60 m), gable roof 45°, two interior walls and one entrance door in the hull. Invented values,
// no real project behind them. Later plans of phase 108 (knee wall, gable, rule windows, door symbol, stair) reuse it.
//
// In:  nothing. Out: EFH_108 (programme + studio fields as stored in a BimModel record) and efhModell() (the built model).
import { createBuildingModel } from "@core/lib/buildingModel";

/** Footprint in m, centred on the vertex mean like footprintToMeters: 11.40 m along x, 10.20 m along z. */
export const EFH_FOOTPRINT = Object.freeze([{ x: -5.7, z: -5.1 }, { x: 5.7, z: -5.1 }, { x: 5.7, z: 5.1 }, { x: -5.7, z: 5.1 }]);

/** The record fields of the test house (BimModel shape). */
export const EFH_108 = Object.freeze({
  footprintM: EFH_FOOTPRINT,
  storeys: 2,
  storeyHeight: 2.9,
  untergeschosse: 1,
  geschosse: [{ level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.6 }],
  unit: "m",
  dachform: "sattel",
  dachneigung: 45,
  customWalls: [
    { a: { x: -0.5, z: -5.1 }, b: { x: -0.5, z: 5.1 }, level: 0, thickness: 0.115, _idx: 1 },
    { a: { x: -0.5, z: 0.6 }, b: { x: 5.7, z: 0.6 }, level: 0, thickness: 0.115, _idx: 2 },
  ],
  envOpenings: [{ level: 0, edge: 0, kind: "door", u: 2.2, width: 1.01, height: 2.135, sill: 0 }],
});

/**
 * The built model of the test house (createBuildingModel), optionally with other programme values.
 * @param {Record<string, any>} [anders] overrides of the createBuildingModel input
 * @returns {any}
 */
export function efhModell(anders = {}) {
  return createBuildingModel({
    footprintM: EFH_FOOTPRINT.map((p) => ({ ...p })), storeys: EFH_108.storeys, storeyHeight: EFH_108.storeyHeight,
    geschosse: EFH_108.geschosse, untergeschosse: EFH_108.untergeschosse, ...anders,
  });
}

/** 108-02: knee wall of the test house in m (DG row of the storey table). Invented value. */
export const EFH_KNIESTOCK_M = 1;

/**
 * 108-02: storey table of the test house with a knee wall on the DG row (level 1 = storeys − 1).
 * @param {number|null} [kniestock_m] m; null = the table without the field
 * @returns {Array<{level: number, name: string, hoehe_m: number, kniestock_m?: number}>}
 */
export function efhGeschosseMitKniestock(kniestock_m = EFH_KNIESTOCK_M) {
  return EFH_108.geschosse.map((g) => (g.level === 1 && kniestock_m != null ? { ...g, kniestock_m } : { ...g }));
}

/**
 * 108-02: the built test house WITH a knee wall under its gable roof 45° (createBuildingModel with dachform/dachneigung).
 * @param {number|null} [kniestock_m] m
 * @param {Record<string, any>} [anders] further overrides of the createBuildingModel input
 * @returns {any}
 */
export function efhModellMitKniestock(kniestock_m = EFH_KNIESTOCK_M, anders = {}) {
  return efhModell({ geschosse: efhGeschosseMitKniestock(kniestock_m), dachform: EFH_108.dachform, dachneigung: EFH_108.dachneigung, ...anders });
}
