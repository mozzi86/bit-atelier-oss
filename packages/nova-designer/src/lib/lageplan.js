// Generic site-plan core (Phase 37 — the "Lageplan-Kern" other phases extend, e.g. Phase 63 for
// swales/infiltration trenches). Knows nothing about plants or drainage: it converts the parcel into
// plan metres, computes the plan extent and manages a layer of catalogue-typed POINT elements and
// AREA polygons.
//
// In:  complexData.site_parcel (canvas px around 600/400, 1.25 m/px or parcel.m_per_px, y south),
//      footprint in metres, a layer { elemente: [{id, typ, x, z}], flaechen: [{id, art, points}] }.
// Out: pure functions — coordinates in metres (x east, z south, like BimPlan2D/OSM), areas in m².

import { metersPerPixel } from "@core/lib/geo";
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from "@designer/lib/maplibreStyles";
import { punktImPolygon } from "@designer/lib/moebel";

/** Empty layer — one BimModel top-level field per tab (KD-17), e.g. aussenanlagen_layer. */
export const LAGEPLAN_DEFAULT = { elemente: [], flaechen: [] };
/** Margin around the footprint when no drawn parcel bounds the plan ([ASSUMED] 30 m shows the near surroundings). */
export const LAGEPLAN_RAND_M = 30;
/** Smallest area polygon accepted ([ASSUMED] 1 m² — below that it is a mis-click). */
export const FLAECHE_MIN_M2 = 1;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const isPt = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z));
const rnd = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;
const naechsteId = (prefix, liste) => {
  let max = 0;
  for (const it of liste) { const m = new RegExp(`^${prefix}_(\\d+)$`).exec(String(it.id || "")); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}_${max + 1}`;
};

/**
 * Harden a stored layer: arrays exist, points numeric, ids present.
 * @param {object} layer
 * @returns {{ elemente: Array<{id:string, typ:string, x:number, z:number}>, flaechen: Array<{id:string, art:string, points:Array<{x:number,z:number}>}> }}
 */
export function layerHardened(layer) {
  const l = layer && typeof layer === "object" ? layer : {};
  const elemente = (Array.isArray(l.elemente) ? l.elemente : [])
    .filter((e) => e && isPt(e) && e.typ)
    .map((e, i) => ({ ...e, id: e.id || `el_${i + 1}`, typ: String(e.typ), x: rnd(e.x), z: rnd(e.z) }));
  const flaechen = (Array.isArray(l.flaechen) ? l.flaechen : [])
    .filter((f) => f && Array.isArray(f.points) && f.points.filter(isPt).length >= 3)
    .map((f, i) => ({ ...f, id: f.id || `fl_${i + 1}`, art: String(f.art || "gruen"), points: f.points.filter(isPt).map((p) => ({ x: rnd(p.x), z: rnd(p.z) })) }));
  return { ...l, elemente, flaechen };
}

/**
 * Parcel polygon in plan metres. The parcel is stored in canvas px around (600, 400) with y pointing
 * south — the same axes as the plan (x east, z south), so only the origin shift and the scale apply.
 * @param {{ points?: Array<{x:number,y:number}>, assumed?: boolean, m_per_px?: number }|null|undefined} parcel complexData.site_parcel
 * @returns {Array<{x:number,z:number}>|null} null for a missing or generic (assumed) parcel — the 1 km
 *   default square is not a site boundary and would dwarf the plan
 */
export function parzelleInMetern(parcel) {
  if (!parcel || parcel.assumed !== false || !Array.isArray(parcel.points) || parcel.points.length < 3) return null;
  const mpp = metersPerPixel(parcel);
  return parcel.points.map((p) => ({ x: rnd((num(p.x) - CANVAS_CENTER_X) * mpp), z: rnd((num(p.y) - CANVAS_CENTER_Y) * mpp) }));
}

/**
 * Points that must be inside the plan's bounding box (BimPlan2D `overlayBounds`): the parcel when it is
 * drawn, otherwise the footprint bbox grown by `rand` metres.
 * @param {Array<{x:number,z:number}>} footprint metres
 * @param {Array<{x:number,z:number}>|null} parzelleM from parzelleInMetern
 * @param {number} [rand] metres
 */
export function lageplanExtent(footprint, parzelleM, rand = LAGEPLAN_RAND_M) {
  if (Array.isArray(parzelleM) && parzelleM.length >= 3) return parzelleM;
  const fp = (Array.isArray(footprint) ? footprint : []).filter(isPt);
  if (!fp.length) return [{ x: -rand, z: -rand }, { x: rand, z: rand }];
  const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
  return [{ x: Math.min(...xs) - rand, z: Math.min(...zs) - rand }, { x: Math.max(...xs) + rand, z: Math.max(...zs) + rand }];
}

/**
 * Point-in-polygon in plan metres (ray casting via moebel.punktImPolygon).
 * @param {Array<{x:number,z:number}>} points
 * @param {{x:number,z:number}} p
 */
export function punktInPolygon(points, p) {
  if (!Array.isArray(points) || points.length < 3 || !isPt(p)) return false;
  return punktImPolygon(p.x, p.z, points);
}

/**
 * Polygon area in m² (shoelace) for points in metres.
 * @param {Array<{x:number,z:number}>} points
 * @returns {number} m², one decimal
 */
export function polygonFlaecheM2(points) {
  const pts = (Array.isArray(points) ? points : []).filter(isPt);
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.z - b.x * a.z; }
  return Math.round(Math.abs(s) / 2 * 10) / 10;
}

/**
 * Add a catalogue-typed point element at (x, z) metres.
 * @param {object} layer
 * @param {{ typ: string, x: number, z: number }} p
 * @returns {{ layer: object, element: object|null }}
 */
export function neuesElement(layer, { typ, x, z }) {
  const base = layerHardened(layer);
  if (!typ || !isPt({ x, z })) return { layer: base, element: null };
  const element = { id: naechsteId("el", base.elemente), typ: String(typ), x: rnd(x), z: rnd(z) };
  return { layer: { ...base, elemente: [...base.elemente, element] }, element };
}

/** Move an element to p (metres). */
export function verschiebeElement(layer, id, p) {
  const base = layerHardened(layer);
  if (!isPt(p)) return base;
  return { ...base, elemente: base.elemente.map((e) => (e.id === id ? { ...e, x: rnd(p.x), z: rnd(p.z) } : e)) };
}

/** Remove an element. */
export function loescheElement(layer, id) {
  const base = layerHardened(layer);
  return { ...base, elemente: base.elemente.filter((e) => e.id !== id) };
}

/**
 * Add an area polygon (≥ 3 points, ≥ FLAECHE_MIN_M2).
 * @param {object} layer
 * @param {{ art: string, points: Array<{x:number,z:number}> }} p
 * @returns {{ layer: object, flaeche: object|null }}
 */
export function neueFlaeche(layer, { art, points }) {
  const base = layerHardened(layer);
  const pts = (Array.isArray(points) ? points : []).filter(isPt).map((q) => ({ x: rnd(q.x), z: rnd(q.z) }));
  if (pts.length < 3 || polygonFlaecheM2(pts) < FLAECHE_MIN_M2) return { layer: base, flaeche: null };
  const flaeche = { id: naechsteId("fl", base.flaechen), art: String(art || "gruen"), points: pts };
  return { layer: { ...base, flaechen: [...base.flaechen, flaeche] }, flaeche };
}

/** Move vertex idx of an area to p (metres). */
export function verschiebeFlaechenPunkt(layer, id, idx, p) {
  const base = layerHardened(layer);
  if (!isPt(p)) return base;
  return { ...base, flaechen: base.flaechen.map((f) => (f.id === id ? { ...f, points: f.points.map((q, i) => (i === idx ? { x: rnd(p.x), z: rnd(p.z) } : q)) } : f)) };
}

/** Change an area's kind (art). */
export function aendereFlaeche(layer, id, patch) {
  const base = layerHardened(layer);
  return { ...base, flaechen: base.flaechen.map((f) => (f.id === id ? { ...f, ...(patch || {}), id: f.id, points: f.points } : f)) };
}

/** Remove an area. */
export function loescheFlaeche(layer, id) {
  const base = layerHardened(layer);
  return { ...base, flaechen: base.flaechen.filter((f) => f.id !== id) };
}

/**
 * Area totals per kind.
 * @param {object} layer
 * @returns {Record<string, number>} m² per art (one decimal)
 */
export function flaechenSummen(layer) {
  const base = layerHardened(layer);
  const out = {};
  for (const f of base.flaechen) out[f.art] = Math.round(((out[f.art] || 0) + polygonFlaecheM2(f.points)) * 10) / 10;
  return out;
}
