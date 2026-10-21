// gelaendeStudie.js — pure terrain study maths for the 3D terrain view (phase 103).
//
// Why a module of its own: TerrainView3D used to stretch every terrain to a fixed relief,
// showed it from below and north–south mirrored (row 0 of the DEM is SOUTH, the plane put it
// north). Everything that decides "where is what and how high" now lives here, without
// three.js, React or the DOM, so node:test can prove it (tests/unit/gelaendeStudie-103.test.js).
// Not to be confused with @core massing/gelaende.js (the sandbox raster of the massing studio).
//
// Axes (same as isoKamera.js): x = east, z = SOUTH, y = up, 1 unit = 1 m. Origin = project
// location = canvas point (600, 400) of the site canvas (maplibreStyles CANVAS_CENTER_X/Y).
// Heights are metres above sea level as delivered by the elevation API (Copernicus DEM
// GLO-90, EGM2008 geoid — shown as "m ü. NHN (näherungsweise)", DHHN2016 differs by
// a few decimetres).
//
// In:  elevation grid (rows south → north, columns west → east, metres), complexData
//      (canvas px records), camera angles (degrees), water level (m a.s.l.).
// Out: plain numbers / {x, z} / {x, y, z} objects in metres; no side effects.

import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from "@designer/lib/maplibreStyles";
import { kameraPosition } from "@designer/lib/isoKamera";

/** Metres per canvas unit when a record carries no own scale (maplibreStyles M_PER_UNIT). */
export const STANDARD_M_JE_PX = 1.25;
/** Lowest camera pitch above the horizon, degrees — flatter views hide the plot behind the terrain [ASSUMED]. */
export const PITCH_MIN = 12;
/** Highest camera pitch, degrees — 90° would make the yaw undefined (gimbal) [ASSUMED]. */
export const PITCH_MAX = 85;
/** Start yaw, degrees clockwise from north: looking slightly north-east, camera stands south [ASSUMED]. */
export const START_YAW = 15;
/** Start pitch, degrees above the horizon: oblique view from the south and above [ASSUMED]. */
export const START_PITCH = 35;
/** Minimum clearance of the orbit camera above the terrain surface, metres (scene units) [ASSUMED]. */
export const FREI_M = 5;
/** Eye height for the walk mode, metres (common value for an adult standing). */
export const AUGENHOEHE_M = 1.7;
/** [ASSUMED] plinth: ground floor finished level above the highest terrain point under the body, metres. */
export const SOCKEL_M = 0.3;
/** Smallest and largest vertical exaggeration offered by the slider (unitless factor). */
export const UEBERHOEHUNG_MIN = 1;
export const UEBERHOEHUNG_MAX = 10;

const RAD = Math.PI / 180;

/**
 * @typedef {{ n: number, zelleM: number, halbM: number, h: number[], minNHN: number, maxNHN: number }} DemRaster
 *   n×n heights (m a.s.l.), row-major h[i*n+j]; row i = 0 is SOUTH, column j = 0 is WEST;
 *   zelleM = grid spacing (m), halbM = half the covered edge (m).
 */

/**
 * Wrap the elevation grid of useElevationGrid as a raster with metric geometry.
 * @param {number[][]} grid rows south → north, columns west → east, metres a.s.l.
 * @param {number} spanM covered edge length, metres (e.g. 300 or 1000)
 * @returns {DemRaster|null} null for an empty or non-square grid
 */
export function demRaster(grid, spanM) {
  if (!Array.isArray(grid) || grid.length < 2) return null;
  const n = grid.length;
  if (!grid.every((row) => Array.isArray(row) && row.length === n)) return null;
  const h = [];
  let minNHN = Infinity, maxNHN = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Number(grid[i][j]);
      const w = Number.isFinite(v) ? v : 0;
      h.push(w);
      if (w < minNHN) minNHN = w;
      if (w > maxNHN) maxNHN = w;
    }
  }
  const s = Number(spanM) > 0 ? Number(spanM) : 1000;
  return { n, zelleM: s / (n - 1), halbM: s / 2, h, minNHN, maxNHN };
}

/**
 * Terrain height at a plan point, bilinear between the four grid nodes, clamped at the edge.
 * Row index i = (halbM − z)/zelleM because row 0 lies at z = +halbM (south).
 * @param {DemRaster} r raster
 * @param {number} xOst metres east of the origin
 * @param {number} zSued metres south of the origin
 * @returns {number} metres a.s.l.
 */
export function hoeheAn(r, xOst, zSued) {
  const n = r.n;
  const gi = Math.max(0, Math.min(n - 1, (r.halbM - zSued) / r.zelleM));
  const gj = Math.max(0, Math.min(n - 1, (xOst + r.halbM) / r.zelleM));
  const i0 = Math.floor(gi), j0 = Math.floor(gj);
  const i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
  const fi = gi - i0, fj = gj - j0;
  const a = r.h[i0 * n + j0], b = r.h[i0 * n + j1], c = r.h[i1 * n + j0], d = r.h[i1 * n + j1];
  const unten = a + (b - a) * fj;
  const oben = c + (d - c) * fj;
  return unten + (oben - unten) * fi;
}

/**
 * Plan position of a grid node (inverse of the indexing in hoeheAn).
 * @param {DemRaster} r raster
 * @param {number} i row (0 = south)
 * @param {number} j column (0 = west)
 * @returns {{ x: number, z: number }} metres
 */
export function knotenM(r, i, j) {
  return { x: -r.halbM + j * r.zelleM, z: r.halbM - i * r.zelleM };
}

/**
 * Metres per canvas unit of a complexData record (site_parcel.m_per_px or 1.25 m), the same
 * rule as SiteDesigner/mapDraw (95-02).
 * @param {any} complexData
 * @returns {number} m per canvas unit
 */
export function mJePx(complexData) {
  const m = Number(complexData?.site_parcel?.m_per_px);
  return Number.isFinite(m) && m > 0 ? m : STANDARD_M_JE_PX;
}

/**
 * Canvas point (site canvas, px, y down) → plan metres. Same sign as canvasPointToLngLat:
 * canvas y down = south = +z.
 * @param {{ x: number, y: number }} p canvas px
 * @param {number} mpp metres per canvas unit
 * @returns {{ x: number, z: number }} metres
 */
export function canvasZuPlanM(p, mpp) {
  const m = Number(mpp) > 0 ? Number(mpp) : STANDARD_M_JE_PX;
  return { x: ((Number(p?.x) || 0) - CANVAS_CENTER_X) * m, z: ((Number(p?.y) || 0) - CANVAS_CENTER_Y) * m };
}

/**
 * Corners of a stored building rectangle ({x,y,width,height,drehung_grad} in canvas px) in plan
 * metres — the same corner order and rotation as mapDraw.buildingsToGeoJson.
 * @param {{ x: number, y: number, width: number, height: number, drehung_grad?: number }} b canvas px / degrees
 * @param {number} mpp metres per canvas unit
 * @returns {Array<{x:number,z:number}>|null} four corners, metres; null for an empty box
 */
export function baukoerperEckenM(b, mpp) {
  const w = Number(b?.width) || 0;
  const hh = Number(b?.height) || 0;
  if (w <= 0 || hh <= 0) return null;
  const rad = ((Number(b?.drehung_grad) || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const mx = (Number(b.x) || 0) + w / 2, my = (Number(b.y) || 0) + hh / 2;
  return [[-w / 2, -hh / 2], [w / 2, -hh / 2], [w / 2, hh / 2], [-w / 2, hh / 2]]
    .map(([x, y]) => canvasZuPlanM({ x: mx + x * c - y * s, y: my + x * s + y * c }, mpp));
}

/**
 * The plot outline in plan metres: site_parcel.points. An estimated parcel (assumed: true, the
 * generic start square) is no boundary — returned with geschaetzt = true so the view can say so.
 * @param {any} complexData
 * @returns {{ poly: Array<{x:number,z:number}>, geschaetzt: boolean }|null} null without parcel
 */
export function grundstueckM(complexData) {
  const p = complexData?.site_parcel;
  const pts = Array.isArray(p?.points) ? p.points.filter((q) => Number.isFinite(Number(q?.x)) && Number.isFinite(Number(q?.y))) : [];
  if (pts.length < 3) return null;
  const mpp = mJePx(complexData);
  return { poly: pts.map((q) => canvasZuPlanM(q, mpp)), geschaetzt: p.assumed === true };
}

/**
 * Building bodies of the site plan (complexData.buildings) with their corners in plan metres.
 * Bars/perimeter blocks (complexData.riegel) are not included yet (open point of 103-01).
 * @param {any} complexData
 * @param {{ storeyHeight?: number }} [opt] storey height, metres (default 3)
 * @returns {Array<{ id: string, name: string, ecken: Array<{x:number,z:number}>, geschosse: number, geschossHoeheM: number }>}
 */
export function baukoerperListe(complexData, { storeyHeight = 3 } = {}) {
  const mpp = mJePx(complexData);
  const gh = Number(storeyHeight) > 0 ? Number(storeyHeight) : 3;
  const liste = [];
  (Array.isArray(complexData?.buildings) ? complexData.buildings : []).forEach((b, k) => {
    const ecken = baukoerperEckenM(b, mpp);
    if (!ecken) return;
    liste.push({
      id: String(b?.id ?? `b${k + 1}`),
      name: String(b?.name || `Baukörper ${k + 1}`),
      ecken,
      geschosse: Math.max(1, Math.round(Number(b?.floors) || 1)),
      geschossHoeheM: gh,
    });
  });
  return liste;
}

/**
 * Sensible start value of the vertical exaggeration: the relief should take about 6 % of the
 * shown extent [ASSUMED readability rule], rounded to a whole factor in 1…10. A 1-km cut-out
 * with 20 m of relief starts at 3×, a flat 3-m plot at 10×, a hill with 100 m at 1×.
 * @param {number} spanneM height range of the shown terrain, metres
 * @param {number} ausdehnungM shown edge length, metres
 * @returns {number} integer factor 1…10
 */
export function startUeberhoehung(spanneM, ausdehnungM) {
  const s = Number(spanneM), a = Number(ausdehnungM);
  if (!(s > 0) || !(a > 0)) return UEBERHOEHUNG_MIN;
  const f = Math.round((0.06 * a) / s);
  return Math.max(UEBERHOEHUNG_MIN, Math.min(UEBERHOEHUNG_MAX, f));
}

/**
 * Clamp a pitch to [PITCH_MIN, PITCH_MAX].
 * @param {number} pitchGrad degrees
 * @returns {number} degrees
 */
export function pitchKlemmen(pitchGrad) {
  const p = Number(pitchGrad);
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Number.isFinite(p) ? p : START_PITCH));
}

/**
 * Orbit camera position around a target, never below the terrain: kameraPosition (isoKamera
 * convention: yaw clockwise from north, pitch above the horizon) plus the target height; when
 * the terrain under the camera is within freiM of it, the camera is lifted (angehoben = true).
 * @param {{ yaw: number, pitch: number, abstand: number }} kamera degrees / scene metres
 * @param {{ x: number, y: number, z: number }} ziel target in scene metres (y already exaggerated)
 * @param {(x: number, z: number) => number} hoeheSzeneAn terrain height in scene units at a plan point
 * @param {number} [freiM] minimum clearance, scene metres
 * @returns {{ x: number, y: number, z: number, angehoben: boolean }} scene metres
 */
export function kameraPose(kamera, ziel, hoeheSzeneAn, freiM = FREI_M) {
  const p = kameraPosition({ yaw: kamera.yaw, pitch: pitchKlemmen(kamera.pitch), abstand: kamera.abstand }, { x: ziel.x, z: ziel.z });
  let y = p.y + (Number(ziel.y) || 0);
  const boden = hoeheSzeneAn(p.x, p.z) + freiM;
  let angehoben = false;
  if (!(y >= boden)) { y = boden; angehoben = true; }
  return { x: p.x, y, z: p.z, angehoben };
}

/**
 * Densify a closed ring so no edge piece is longer than schrittM (for a line that follows the
 * terrain instead of cutting through it).
 * @param {Array<{x:number,z:number}>} poly closed ring (first point not repeated), metres
 * @param {number} schrittM maximum piece length, metres
 * @returns {Array<{x:number,z:number}>} closed ring incl. the first point again at the end
 */
export function verdichten(poly, schrittM) {
  const pts = Array.isArray(poly) ? poly : [];
  if (pts.length < 2) return pts.slice();
  const s = Number(schrittM) > 0 ? Number(schrittM) : 1;
  const aus = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const teile = Math.max(1, Math.ceil(len / s));
    for (let t = 0; t < teile; t++) aus.push({ x: a.x + ((b.x - a.x) * t) / teile, z: a.z + ((b.z - a.z) * t) / teile });
  }
  aus.push({ x: pts[0].x, z: pts[0].z });
  return aus;
}

/**
 * Point in polygon (ray casting) in plan metres.
 * @param {number} x metres
 * @param {number} z metres
 * @param {Array<{x:number,z:number}>} poly ring
 * @returns {boolean}
 */
export function punktImPolygon(x, z, poly) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) innen = !innen;
  }
  return innen;
}

/**
 * Lowest and highest terrain point inside a polygon. Exact for the bilinear surface: inside a
 * cell the bilinear function has no interior extremum (at most a saddle), so the extremes lie on
 * the polygon boundary (sampled every ≤ 0.5 m) or on grid nodes inside the polygon.
 * @param {DemRaster} r raster
 * @param {Array<{x:number,z:number}>} poly ring, metres
 * @returns {{ tief: {x:number,z:number,h:number}, hoch: {x:number,z:number,h:number} }|null} metres / m a.s.l.
 */
export function extremeInPolygon(r, poly) {
  if (!r || !Array.isArray(poly) || poly.length < 3) return null;
  let tief = null, hoch = null;
  const pruefe = (x, z) => {
    const h = hoeheAn(r, x, z);
    if (!tief || h < tief.h) tief = { x, z, h };
    if (!hoch || h > hoch.h) hoch = { x, z, h };
  };
  for (const p of verdichten(poly, 0.5)) pruefe(p.x, p.z);
  for (let i = 0; i < r.n; i++) {
    for (let j = 0; j < r.n; j++) {
      const k = knotenM(r, i, j);
      if (punktImPolygon(k.x, k.z, poly)) pruefe(k.x, k.z);
    }
  }
  return tief && hoch ? { tief, hoch } : null;
}

/**
 * Lowest terrain height inside a polygon (see extremeInPolygon).
 * @param {DemRaster} r raster
 * @param {Array<{x:number,z:number}>} poly ring, metres
 * @returns {number|null} m a.s.l.
 */
export function minHoeheInPolygon(r, poly) {
  const e = extremeInPolygon(r, poly);
  return e ? e.tief.h : null;
}

/**
 * Highest terrain height inside a polygon (see extremeInPolygon).
 * @param {DemRaster} r raster
 * @param {Array<{x:number,z:number}>} poly ring, metres
 * @returns {number|null} m a.s.l.
 */
export function maxHoeheInPolygon(r, poly) {
  const e = extremeInPolygon(r, poly);
  return e ? e.hoch.h : null;
}

/**
 * Area centroid of a polygon (shoelace); falls back to the vertex mean for a degenerate ring.
 * @param {Array<{x:number,z:number}>} poly ring, metres
 * @returns {{ x: number, z: number }} metres
 */
export function schwerpunkt(poly) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    a += f; cx += (poly[j].x + poly[i].x) * f; cz += (poly[j].z + poly[i].z) * f;
  }
  if (Math.abs(a) < 1e-9) {
    return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/**
 * Spot heights for the overlay: lowest and highest point (inside the plot when there is one,
 * else over the whole raster) and the plot centre (else the origin).
 * @param {DemRaster} r raster
 * @param {Array<{x:number,z:number}>|null} plot plot ring, metres
 * @returns {{ tief: {x:number,z:number,h:number}, hoch: {x:number,z:number,h:number}, mitte: {x:number,z:number,h:number} }}
 */
export function hoehenKoten(r, plot) {
  if (Array.isArray(plot) && plot.length >= 3) {
    const e = extremeInPolygon(r, plot);
    const m = schwerpunkt(plot);
    if (e) return { tief: e.tief, hoch: e.hoch, mitte: { ...m, h: hoeheAn(r, m.x, m.z) } };
  }
  let tief = null, hoch = null;
  for (let i = 0; i < r.n; i++) {
    for (let j = 0; j < r.n; j++) {
      const k = knotenM(r, i, j);
      const h = r.h[i * r.n + j];
      if (!tief || h < tief.h) tief = { ...k, h };
      if (!hoch || h > hoch.h) hoch = { ...k, h };
    }
  }
  return { tief, hoch, mitte: { x: 0, z: 0, h: hoeheAn(r, 0, 0) } };
}

/**
 * Scale bar length on a 1-2-5 ladder that fits into maxPx.
 * @param {number} mProPx metres per screen pixel at the image centre
 * @param {number} [maxPx] longest bar, CSS px
 * @returns {{ m: number, px: number }|null} bar length in metres and CSS px; null for invalid input
 */
export function massstabsLeiste(mProPx, maxPx = 120) {
  const mp = Number(mProPx);
  if (!(mp > 0) || !Number.isFinite(mp)) return null;
  const maxM = mp * maxPx;
  const p10 = 10 ** Math.floor(Math.log10(maxM));
  let m = p10;
  for (const f of [5, 2, 1]) { if (f * p10 <= maxM) { m = f * p10; break; } }
  return { m, px: m / mp };
}

/**
 * Flood curve of a polygon: the terrain heights at n×n sample points of its bounding box that
 * fall inside, sorted ascending, plus the area each sample stands for.
 * @param {DemRaster} r raster
 * @param {Array<{x:number,z:number}>} poly ring, metres
 * @param {number} [n] samples per bbox edge
 * @returns {{ hoehen: number[], flaecheJeProbeM2: number, flaecheM2: number }|null} m a.s.l. / m²
 */
export function flutKurve(r, poly, n = 64) {
  if (!r || !Array.isArray(poly) || poly.length < 3) return null;
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sx = (maxX - minX) / n, sz = (maxZ - minZ) / n;
  if (!(sx > 0) || !(sz > 0)) return null;
  const hoehen = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const x = minX + (a + 0.5) * sx, z = minZ + (b + 0.5) * sz;
      if (punktImPolygon(x, z, poly)) hoehen.push(hoeheAn(r, x, z));
    }
  }
  hoehen.sort((p, q) => p - q);
  return { hoehen, flaecheJeProbeM2: sx * sz, flaecheM2: hoehen.length * sx * sz };
}

/**
 * Flooded area of a polygon at a water level ("bathtub": every point below the level counts,
 * no flow paths, dykes or drainage).
 * @param {{ hoehen: number[], flaecheJeProbeM2: number }|null} kurve from flutKurve
 * @param {number} pegelNHN water level, m a.s.l.
 * @returns {{ m2: number, anteil: number }} m², share 0…1
 */
export function ueberfluteteFlaeche(kurve, pegelNHN) {
  if (!kurve || !kurve.hoehen.length) return { m2: 0, anteil: 0 };
  const h = kurve.hoehen;
  let lo = 0, hi = h.length; // first index with h >= pegel
  while (lo < hi) { const mid = (lo + hi) >> 1; if (h[mid] < pegelNHN) lo = mid + 1; else hi = mid; }
  return { m2: lo * kurve.flaecheJeProbeM2, anteil: lo / h.length };
}

/**
 * Ground floor finished level (OKFF) of a body: an explicit override wins, else the highest
 * terrain point under the footprint plus the plinth [ASSUMED SOCKEL_M = 0.30 m — a common
 * minimum against splash water; the real value comes from the design].
 * @param {DemRaster} r raster
 * @param {Array<{x:number,z:number}>} ecken footprint, metres
 * @param {{ sockelM?: number, overrideNHN?: number|null }} [opt] metres / m a.s.l.
 * @returns {number|null} m a.s.l.
 */
export function okffNHN(r, ecken, { sockelM = SOCKEL_M, overrideNHN = null } = {}) {
  const o = Number(overrideNHN);
  if (overrideNHN != null && Number.isFinite(o)) return o;
  const hoch = maxHoeheInPolygon(r, ecken);
  return hoch == null ? null : hoch + (Number(sockelM) || 0);
}

/**
 * "What floods first": the water level at which the plot, each body (water touches its lowest
 * terrain point) and each ground floor (OKFF) gets wet, ascending.
 * @param {DemRaster} r raster
 * @param {{ grundstueck?: Array<{x:number,z:number}>|null, baukoerper?: Array<{id:string,name:string,ecken:Array<{x:number,z:number}>}>, sockelM?: number }} q
 * @returns {Array<{ art: "grundstueck"|"baukoerper"|"eg", id: string, name: string, pegelNHN: number }>} ascending by pegelNHN
 */
export function flutReihenfolge(r, { grundstueck = null, baukoerper = [], sockelM = SOCKEL_M } = {}) {
  if (!r) return [];
  const liste = [];
  const g = Array.isArray(grundstueck) && grundstueck.length >= 3 ? minHoeheInPolygon(r, grundstueck) : null;
  if (g != null) liste.push({ art: /** @type {const} */ ("grundstueck"), id: "grundstueck", name: "Grundstück", pegelNHN: g });
  for (const b of baukoerper || []) {
    const tief = minHoeheInPolygon(r, b.ecken);
    if (tief != null) liste.push({ art: /** @type {const} */ ("baukoerper"), id: b.id, name: b.name, pegelNHN: tief });
    const ok = okffNHN(r, b.ecken, { sockelM });
    if (ok != null) liste.push({ art: /** @type {const} */ ("eg"), id: b.id, name: b.name, pegelNHN: ok });
  }
  const rang = { grundstueck: 0, baukoerper: 1, eg: 2 };
  return liste.sort((a, b) => a.pegelNHN - b.pegelNHN || rang[a.art] - rang[b.art]);
}

/**
 * Range of the water level slider: from 1 m below the lowest to 2 m above the highest terrain
 * point, on whole metres [ASSUMED headroom], step 0.05 m.
 * @param {DemRaster} r raster
 * @returns {{ min: number, max: number, schritt: number }} m a.s.l.
 */
export function pegelBereich(r) {
  if (!r) return { min: 0, max: 1, schritt: 0.05 };
  return { min: Math.floor(r.minNHN) - 1, max: Math.ceil(r.maxNHN) + 2, schritt: 0.05 };
}

/**
 * Design flood levels (complexData.hochwasser.hq) as marks on the water level slider: only
 * entries with a finite level, sorted ascending, with their position 0…1 on the slider range.
 * @param {{ hq?: Array<{ id?: string, name?: string, pegelNHN?: number|string, quelle?: string }> }|null|undefined} hochwasser
 * @param {{ min: number, max: number }} bereich slider range, m a.s.l.
 * @returns {Array<{ id: string, name: string, pegelNHN: number, quelle: string, lage: number, testId: string }>}
 */
export function hqMarken(hochwasser, bereich) {
  const hq = Array.isArray(hochwasser?.hq) ? hochwasser.hq : [];
  const spanne = (Number(bereich?.max) - Number(bereich?.min)) || 1;
  return hq
    .map((e, k) => ({ e, k, p: Number(String(e?.pegelNHN ?? "").replace(",", ".")) }))
    .filter(({ p, e }) => e && String(e?.pegelNHN ?? "").trim() !== "" && Number.isFinite(p))
    .map(({ e, k, p }) => {
      const name = String(e.name || `HQ ${k + 1}`).trim();
      return {
        id: String(e.id ?? `hq${k + 1}`),
        name,
        pegelNHN: p,
        quelle: String(e.quelle || ""),
        lage: Math.max(0, Math.min(1, (p - Number(bereich?.min)) / spanne)),
        testId: `gelaende-hq-${name.replace(/[^A-Za-z0-9]+/g, "-")}`,
      };
    })
    .sort((a, b) => a.pegelNHN - b.pegelNHN);
}

/**
 * Metres per screen pixel at the image centre of a perspective camera (vertical field of view).
 * @param {number} abstandM distance camera → target, metres
 * @param {number} fovGrad vertical field of view, degrees
 * @param {number} hoehePx canvas height, CSS px
 * @returns {number} metres per CSS px
 */
export function mJePxBildmitte(abstandM, fovGrad, hoehePx) {
  return (2 * Number(abstandM) * Math.tan((Number(fovGrad) * RAD) / 2)) / (Number(hoehePx) || 1);
}

/**
 * Number format for heights in the overlays: one decimal, German comma.
 * @param {number} h m a.s.l.
 * @returns {string} e.g. "312,4"
 */
export function hoeheText(h) {
  return (Math.round(Number(h) * 10) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
