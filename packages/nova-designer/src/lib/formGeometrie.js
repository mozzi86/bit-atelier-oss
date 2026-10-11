// Geometry kernel for footprint-true tessellation (plan 86-01). Own code, no dependency.
//
// Why: the workshop tessellated the AXIS-PARALLEL bounding box of the footprint — a rotated
// or non-rectangular footprint got 34–41 % of its rooms outside the building (86-01 probe).
// This module finds a rigid frame (rotation about a point) that aligns the footprint with one
// of its own edge directions and, in that frame, the largest inscribed axis-parallel
// rectangle — the existing rectangle solver then runs unchanged inside it.
//
// In:  polygons as [{x, z}] in metres (simple, any orientation, may be concave).
// Out: area/orientation helpers, point-in-polygon, frames (world ↔ local), candidate main
//      directions, cross-sections, strip intervals, largest inscribed rectangle, half-plane
//      clipping (Sutherland–Hodgman) for the remainder pieces.

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const EPS = 1e-9;

/**
 * Signed area (shoelace), m². Positive when the points run counter-clockwise in the
 * x→z sense (x to the right, z down the screen = clockwise on screen).
 * @param {Array<{x:number, z:number}>} pts
 * @returns {number}
 */
export function flaecheSigniert(pts) {
  const p = Array.isArray(pts) ? pts : [];
  let s = 0;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += num(a.x) * num(b.z) - num(b.x) * num(a.z);
  }
  return s / 2;
}

/** @param {Array<{x:number, z:number}>} pts @returns {number} area, m² */
export const flaeche = (pts) => Math.abs(flaecheSigniert(pts));

/**
 * Drop repeated points and points on a straight line between their neighbours
 * (tolerance 1 mm) — the shape tests below count real corners.
 * @param {Array<{x:number, z:number}>} pts
 * @returns {Array<{x:number, z:number}>}
 */
export function bereinigen(pts) {
  let p = (Array.isArray(pts) ? pts : []).map((q) => ({ x: num(q.x), z: num(q.z) }));
  p = p.filter((q, i) => { const n = p[(i + 1) % p.length]; return Math.hypot(n.x - q.x, n.z - q.z) > 1e-3; });
  let geaendert = true;
  while (geaendert && p.length > 3) {
    geaendert = false;
    for (let i = 0; i < p.length; i += 1) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const kreuz = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      const l = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      if (Math.abs(kreuz) / l < 1e-3) { p.splice(i, 1); geaendert = true; break; }
    }
  }
  return p;
}

/**
 * Point in polygon (ray casting; points exactly on the boundary are not guaranteed).
 * @param {Array<{x:number, z:number}>} pts
 * @param {number} x m
 * @param {number} z m
 * @returns {boolean}
 */
export function punktImPolygon(pts, x, z) {
  let drin = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) drin = !drin;
  }
  return drin;
}

/**
 * Is the polygon a rectangle (any rotation)? Four corners, every corner 90° (±0,05°).
 * @param {Array<{x:number, z:number}>} pts
 * @returns {boolean}
 */
export function istRechteck(pts) {
  const p = bereinigen(pts);
  if (p.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) {
    const a = p[(i + 3) % 4], b = p[i], c = p[(i + 1) % 4];
    const u = { x: a.x - b.x, z: a.z - b.z }, v = { x: c.x - b.x, z: c.z - b.z };
    const cos = (u.x * v.x + u.z * v.z) / ((Math.hypot(u.x, u.z) * Math.hypot(v.x, v.z)) || 1);
    if (Math.abs(cos) > Math.sin((0.05 * Math.PI) / 180)) return false;
  }
  return true;
}

/**
 * Is the polygon an AXIS-PARALLEL rectangle? (Then the tessellation stays exactly as before.)
 * @param {Array<{x:number, z:number}>} pts
 * @returns {boolean}
 */
export function istAchsRechteck(pts) {
  const p = bereinigen(pts);
  if (p.length !== 4) return false;
  return p.every((q, i) => { const n = p[(i + 1) % 4]; return Math.abs(n.x - q.x) < 1e-6 || Math.abs(n.z - q.z) < 1e-6; });
}

/**
 * Rigid frame: rotation by `winkel` (radians, x→z sense) about `ursprung`. Local = world
 * rotated by −winkel; inWelt(inLokal(p)) = p.
 * @param {number} winkel radians
 * @param {{x:number, z:number}} [ursprung] centre of rotation, m
 * @returns {{winkel:number, cos:number, sin:number, ox:number, oz:number}}
 */
export function rahmen(winkel, ursprung = { x: 0, z: 0 }) {
  return { winkel: num(winkel), cos: Math.cos(num(winkel)), sin: Math.sin(num(winkel)), ox: num(ursprung.x), oz: num(ursprung.z) };
}

/** World → local point. @param {{x:number,z:number}} p @param {ReturnType<typeof rahmen>} r */
export function inLokal(p, r) {
  const dx = num(p.x) - r.ox, dz = num(p.z) - r.oz;
  return { x: r.cos * dx + r.sin * dz, z: -r.sin * dx + r.cos * dz };
}

/** Local → world point. @param {{x:number,z:number}} p @param {ReturnType<typeof rahmen>} r */
export function inWelt(p, r) {
  const x = num(p.x), z = num(p.z);
  return { x: r.ox + r.cos * x - r.sin * z, z: r.oz + r.sin * x + r.cos * z };
}

/**
 * Centroid of the polygon area (falls back to the vertex mean for degenerate input), m.
 * @param {Array<{x:number, z:number}>} pts
 * @returns {{x:number, z:number}}
 */
export function schwerpunkt(pts) {
  const a = flaecheSigniert(pts);
  if (Math.abs(a) < EPS) {
    const n = Math.max(1, pts.length);
    return { x: pts.reduce((s, p) => s + num(p.x), 0) / n, z: pts.reduce((s, p) => s + num(p.z), 0) / n };
  }
  let cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const k = num(p.x) * num(q.z) - num(q.x) * num(p.z);
    cx += (num(p.x) + num(q.x)) * k; cz += (num(p.z) + num(q.z)) * k;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

/**
 * Candidate main directions of a footprint: the edge directions modulo 90° (a rectangle may
 * lie along an edge or square to it), merged within 0,5°, weighted by the edge length that
 * points that way, heaviest first. Deterministic.
 * @param {Array<{x:number, z:number}>} pts
 * @param {number} [max] number of candidates, default 6
 * @returns {Array<{winkel:number, gewicht:number}>} winkel in radians [0, π/2)
 */
export function kandidatenRichtungen(pts, max = 6) {
  const p = bereinigen(pts);
  const halbPi = Math.PI / 2;
  /** @type {Array<{winkel:number, gewicht:number}>} */
  const liste = [];
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i], b = p[(i + 1) % p.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-6) continue;
    let w = Math.atan2(b.z - a.z, b.x - a.x) % halbPi;
    if (w < 0) w += halbPi;
    if (halbPi - w < 1e-9) w = 0;
    const tol = (0.5 * Math.PI) / 180;
    const vorh = liste.find((k) => Math.min(Math.abs(k.winkel - w), halbPi - Math.abs(k.winkel - w)) < tol);
    if (vorh) vorh.gewicht += l; else liste.push({ winkel: w, gewicht: l });
  }
  liste.sort((a, b) => b.gewicht - a.gewicht || a.winkel - b.winkel);
  return liste.slice(0, Math.max(1, max));
}

/**
 * Horizontal cross-section: the x-intervals of the polygon interior at height z (half-open
 * crossing rule, so a vertex exactly at z is counted once).
 * @param {Array<{x:number, z:number}>} pts
 * @param {number} z m
 * @returns {Array<[number, number]>} sorted, disjoint
 */
export function querschnitt(pts, z) {
  const xs = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
  }
  xs.sort((u, v) => u - v);
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > EPS) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Intersection of two sorted interval lists. */
function schnittIntervalle(a, b) {
  /** @type {Array<[number, number]>} */
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
    if (hi - lo > EPS) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i += 1; else j += 1;
  }
  return out;
}

/**
 * Strip intervals: the x-ranges in which the WHOLE strip z0 ≤ z ≤ z1 lies inside the polygon,
 * i.e. every axis-parallel rectangle [a, b] × [z0, z1] with [a, b] inside one interval is
 * inside the polygon. Between two vertex heights the interval ends move linearly, so the
 * intersection of the cross-sections at the strip ends and just above/below every vertex
 * height inside the strip is exact (up to 1e-7 m).
 * @param {Array<{x:number, z:number}>} pts
 * @param {number} z0 m
 * @param {number} z1 m (> z0)
 * @returns {Array<[number, number]>}
 */
export function streifenIntervalle(pts, z0, z1) {
  const e = 1e-7;
  const hoehen = [z0 + e, z1 - e];
  for (const p of pts) if (p.z > z0 + e && p.z < z1 - e) hoehen.push(p.z - e, p.z + e);
  let iv = null;
  for (const h of hoehen) {
    const q = querschnitt(pts, h);
    iv = iv === null ? q : schnittIntervalle(iv, q);
    if (!iv.length) return [];
  }
  return iv || [];
}

/**
 * Subtract the x-ranges of exclusion rectangles whose z-range overlaps the open strip
 * (z0, z1) from sorted strip intervals (86-03). Rectangles that only touch the strip stay
 * out of it — two bars may abut.
 * @param {Array<[number, number]>} iv sorted, disjoint
 * @param {Array<{x0:number, x1:number, z0:number, z1:number}>} ausschluss
 * @param {number} z0 m
 * @param {number} z1 m
 * @returns {Array<[number, number]>}
 */
function ohneAusschluss(iv, ausschluss, z0, z1) {
  let out = iv;
  for (const e of ausschluss) {
    if (!(e.z0 < z1 - 1e-6 && e.z1 > z0 + 1e-6)) continue;
    /** @type {Array<[number, number]>} */
    const neu = [];
    for (const [a, b] of out) {
      if (e.x1 <= a + 1e-6 || e.x0 >= b - 1e-6) { neu.push([a, b]); continue; }
      if (e.x0 - a > EPS) neu.push([a, e.x0]);
      if (b - e.x1 > EPS) neu.push([e.x1, b]);
    }
    out = neu;
    if (!out.length) break;
  }
  return out;
}

/**
 * Largest axis-parallel rectangle inside the polygon whose depth (z-extent) lies in
 * [tiefeMin, tiefeMax]. Scans the strip bottom over every vertex height and a grid, and the
 * depth over a grid plus tiefeMax. The best area wins; ties → the deeper, then the lower z0.
 * 86-03: `ausschluss` = rectangles (same frame) the result must not overlap — already grown by
 * whatever spacing the caller wants per axis; strips may also end right below such a
 * rectangle. `laengerAlsTief` = only rectangles at least as long (x) as deep (z), so the
 * caller knows which sides are the long facades.
 * @param {Array<{x:number, z:number}>} pts polygon in the frame the rectangle is axis-parallel to
 * @param {{tiefeMin?: number, tiefeMax?: number, schritt?: number, laengeMin?: number,
 *   ausschluss?: Array<{x0:number, x1:number, z0:number, z1:number}>, laengerAlsTief?: boolean}} [o]
 *   depths in m (default 4 … ∞), grid step in m (default 0,25), minimum length in m
 * @returns {{x0:number, x1:number, z0:number, z1:number, flaeche:number}|null}
 */
export function groesstesRechteck(pts, o = {}) {
  const p = bereinigen(pts);
  if (p.length < 3) return null;
  const zs = p.map((q) => q.z);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const schritt = num(o.schritt, 0.25) > 0 ? num(o.schritt, 0.25) : 0.25;
  const tMin = Math.max(0.5, num(o.tiefeMin, 4));
  const tMax = Math.min(zMax - zMin, Number.isFinite(Number(o.tiefeMax)) ? Number(o.tiefeMax) : Infinity);
  if (tMax + EPS < tMin) return null;
  const lMin = num(o.laengeMin, 0);
  const ausschluss = Array.isArray(o.ausschluss) ? o.ausschluss : [];
  const laengerAlsTief = !!o.laengerAlsTief;
  const starts = new Set();
  for (const z of zs) starts.add(Math.round(z * 1000) / 1000);
  for (let z = zMin; z <= zMax + EPS; z += schritt) starts.add(Math.round(z * 1000) / 1000);
  // 86-03: a strip may also start right above an exclusion …
  for (const e of ausschluss) if (e.z1 > zMin && e.z1 < zMax) starts.add(e.z1); // exact: a rounded start could overlap it
  const tiefen = [];
  for (let t = tMin; t < tMax - EPS; t += schritt) tiefen.push(t);
  tiefen.push(tMax);
  /** @type {{x0:number, x1:number, z0:number, z1:number, flaeche:number}|null} */
  let best = null;
  const pruefe = (z0, t) => {
    const z1 = z0 + t;
    if (z0 < zMin - 1e-6 || z1 > zMax + 1e-6) return;
    let iv = streifenIntervalle(p, z0, z1);
    if (ausschluss.length) iv = ohneAusschluss(iv, ausschluss, z0, z1);
    for (const [a, b] of iv) {
      if (b - a + EPS < lMin) continue;
      if (laengerAlsTief && b - a + EPS < t) continue;
      const f = (b - a) * t;
      if (!best || f > best.flaeche + 1e-6 || (Math.abs(f - best.flaeche) <= 1e-6 && t > best.z1 - best.z0 + 1e-9)) {
        best = { x0: a, x1: b, z0, z1, flaeche: f };
      }
    }
  };
  for (const z0 of [...starts].sort((a, b) => a - b)) {
    for (const t of tiefen) {
      if (z0 + t > zMax + 1e-6) break;
      pruefe(z0, t);
    }
  }
  // … or end right below one (z1 = its lower edge), for every depth.
  for (const e of ausschluss) {
    if (!(e.z0 > zMin && e.z0 < zMax)) continue;
    for (const t of tiefen) pruefe(e.z0 - t, t);
  }
  return best;
}

/**
 * Clip a polygon against one half-plane n·p ≤ c (Sutherland–Hodgman step). A concave subject
 * may come back with zero-width bridges along the line — its area stays right.
 * @param {Array<{x:number, z:number}>} pts
 * @param {number} nx
 * @param {number} nz
 * @param {number} c
 * @returns {Array<{x:number, z:number}>}
 */
export function schneideHalbebene(pts, nx, nz, c) {
  const out = [];
  const wert = (p) => nx * p.x + nz * p.z - c;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const va = wert(a), vb = wert(b);
    if (va <= EPS) out.push({ x: a.x, z: a.z });
    if ((va < -EPS && vb > EPS) || (va > EPS && vb < -EPS)) {
      const t = va / (va - vb);
      out.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * The polygon minus an axis-parallel rectangle, as up to four pieces (left, right, below,
 * above the rectangle; below/above only within the rectangle's x-range) — the remainder the
 * rectangle solver leaves empty. Pieces under 0,01 m² are dropped.
 * @param {Array<{x:number, z:number}>} pts
 * @param {{x0:number, x1:number, z0:number, z1:number}} r
 * @returns {Array<Array<{x:number, z:number}>>}
 */
export function restOhneRechteck(pts, r) {
  const teile = [
    schneideHalbebene(pts, 1, 0, r.x0),                                       // x ≤ x0
    schneideHalbebene(pts, -1, 0, -r.x1),                                     // x ≥ x1
    schneideHalbebene(schneideHalbebene(schneideHalbebene(pts, -1, 0, -r.x0), 1, 0, r.x1), 0, 1, r.z0), // x0..x1, z ≤ z0
    schneideHalbebene(schneideHalbebene(schneideHalbebene(pts, -1, 0, -r.x0), 1, 0, r.x1), 0, -1, -r.z1), // x0..x1, z ≥ z1
  ];
  return teile.filter((t) => t.length >= 3 && flaeche(t) > 0.01);
}
