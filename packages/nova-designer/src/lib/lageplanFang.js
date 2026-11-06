// Object snap geometry of the site plan (Lageplan, phase 104-05): every drawn outline of the plan as snap segments
// in SITE METRES, so the site plan uses the same snap core (@core/lib/objektfang.js) as the Massing modeller.
//
// The site plan stores its drawings in canvas units (site_parcel.m_per_px = metres per unit); snapping works in
// metres (grid 0.25 m, capture distance in metres), the caller converts back (÷ mSite) and, on the map, to lng/lat.
//
// In:  parcel, areas, buildings, bars (all canvas units), the running draft, mSite (m per canvas unit).
// Out: segments with a `quelle` id ("grundstueck", area id, building id, bar id, "__entwurf__") — the id lets a
//      corner drag ignore its own outline (`ausser`).
// 107-07: the origin of the site plan is a snap point too (single point, quelle "ursprung"). Review 107-07: that origin is the
//      project location = canvas point (CANVAS_CENTER_X, CANVAS_CENTER_Y) = the 0;0 of the DXF export (dxfPlaene.js) and of the
//      map — NOT 0;0 site metres, which is the top-left corner of the drawing canvas (lageplanUrsprungM).
import { segmenteAusRingen, QUELLE_URSPRUNG } from "@core/lib/objektfang.js";
import { alsBlock, ecken } from "@core/lib/massing/bloecke";
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from "@designer/lib/maplibreStyles";

/** Capture distance of the site plan in SCREEN pixels [ASSUMED: 10 px, the usual CAD aperture]. */
export const LAGEPLAN_FANG_PX = 10;

/**
 * Review 107-07: the origin of the site plan in SITE METRES (canvas units × mSite, origin top-left) — the project location, i.e.
 * the canvas centre every geo conversion and the DXF export use as 0;0. Without a location it is still the DXF origin.
 * @param {number} mSite metres per canvas unit
 * @returns {{x: number, y: number}} site metres
 */
export function lageplanUrsprungM(mSite) {
  const m = Number(mSite) > 0 ? Number(mSite) : 1;
  return { x: CANVAS_CENTER_X * m, y: CANVAS_CENTER_Y * m };
}

/** Snap source id of the plot boundary. */
export const QUELLE_GRUNDSTUECK = "grundstueck";
/** Snap source id of the polygon / bar being drawn. */
export const QUELLE_ENTWURF = "__entwurf__";

/**
 * Snap segments of the site plan in site metres.
 * @param {{parcel?: {points?: Array<{x:number,y:number}>}|null, parcelGeschaetzt?: boolean,
 *   areas?: Array<{id: string, points?: Array<{x:number,y:number}>}>,
 *   buildings?: Array<{id: string, x: number, y: number, width: number, height: number, drehung_grad?: number}>,
 *   riegel?: Array<{id: string, punkte?: Array<{x:number,y:number}>, geschlossen?: boolean}>,
 *   entwurf?: Array<{x:number,y:number}>, mSite: number, ursprung?: {x:number,y:number}|null}} d
 *   all points in canvas units; parcelGeschaetzt = the estimated start square (not drawn, not snapped to);
 *   entwurf = points already set of the running draft (open polyline); mSite = metres per canvas unit;
 *   ursprung (107-07) = origin point in SITE METRES (not canvas units), null = none
 * @returns {Array<{a: {x:number,y:number}, b: {x:number,y:number}, quelle?: string}>} segments in metres
 */
export function lageplanFangSegmente({ parcel = null, parcelGeschaetzt = false, areas = [], buildings = [], riegel = [], entwurf = [], mSite, ursprung = null }) {
  const m = Number(mSite) > 0 ? Number(mSite) : 1;
  const zuM = (/** @type {Array<{x:number,y:number}>} */ pts) => pts.map((q) => ({ x: q.x * m, y: q.y * m }));
  /** @type {Array<{punkte: Array<{x:number,y:number}>, quelle: string, geschlossen?: boolean}>} */
  const ringe = [];
  if (!parcelGeschaetzt && Array.isArray(parcel?.points) && parcel.points.length >= 3) ringe.push({ punkte: zuM(parcel.points), quelle: QUELLE_GRUNDSTUECK });
  for (const a of Array.isArray(areas) ? areas : []) if (Array.isArray(a?.points) && a.points.length >= 2) ringe.push({ punkte: zuM(a.points), quelle: a.id });
  for (const b of Array.isArray(buildings) ? buildings : []) {
    if (!(b?.width > 0 && b?.height > 0)) continue;
    ringe.push({ punkte: ecken(alsBlock(b, m)), quelle: b.id });
  }
  for (const r of Array.isArray(riegel) ? riegel : []) {
    if (Array.isArray(r?.punkte) && r.punkte.length >= 1) ringe.push({ punkte: zuM(r.punkte), quelle: r.id, geschlossen: !!r.geschlossen });
  }
  if (Array.isArray(entwurf) && entwurf.length) ringe.push({ punkte: zuM(entwurf), quelle: QUELLE_ENTWURF, geschlossen: false });
  if (ursprung && Number.isFinite(ursprung.x) && Number.isFinite(ursprung.y)) ringe.push({ punkte: [{ x: ursprung.x, y: ursprung.y }], quelle: QUELLE_URSPRUNG });
  return segmenteAusRingen(ringe);
}
