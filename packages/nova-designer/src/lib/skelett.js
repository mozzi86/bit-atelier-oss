// 86-06: veins ("Adern") from the skeleton of a free footprint — the biomorphic part of the
// "Adern-Modell" (86-RESEARCH §3/§5): the medial axis of the shape gives the corridors, like the
// main and side veins of a leaf. Own code, no dependency (D-P86-03: own geometry core).
//
// Method (raster distance field, 86-RESEARCH §78 risk "the skeleton jumps" → raster rounding,
// minimum length, confirmed main vein as a constraint):
//   1. raster the footprint (cell RASTER, ≤ ~60 000 cells), distance of every inside cell centre to
//      the outline (exact point-to-segment distance);
//   2. ridge cells = cells that are a local maximum of the distance along at least one of the four
//      grid directions (a discrete medial axis), kept only where a band of the typology depth fits
//      (depth filter: distance ≥ T/2 − cell);
//   3. main vein = the longest shortest path through the ridge cells (graph diameter, Dijkstra,
//      8-neighbourhood, diagonal √2); every ridge cell within T/2 of a placed vein is "covered";
//      the remaining ridge cells give side veins the same way, as long as they are ≥ minLaenge —
//      a drawn axis (86-07) enters first as the main vein (constraint);
//   4. polylines simplified (Douglas–Peucker, tolerance 1 m) and snapped to 0,5 m;
//   5. Strahler order on the vein tree (side vein → the vein it was cut from; leaves 1, a parent
//      with two children of the highest order goes up by one) and corridor widths after the pipe
//      model / Murray's law r_parent³ = r_own³ + Σ r_child³ (leaf 1,20 m = apartment corridor
//      minimum, capped at 2,00 m [ASSUMED]) — reported, the solver keeps the typology corridor.
// Deterministic: fixed scan order, ties by cell index.
//
// In:  footprint polygon [{x,z}] in metres, options. Out: veins [{ punkte, laenge_m, ordnung,
//      breite_m, eltern }] (m), raster used. Pure, node-testable.

import { punktImPolygon } from "./formGeometrie.js";

/** Defaults [ASSUMED]: raster 0,5 m, DP tolerance 1 m, snap 0,5 m, at most 8 veins, Murray leaf 1,20 m, cap 2,00 m. */
export const SKELETT = { raster_m: 0.5, maxZellen: 60000, dpToleranz_m: 1, fang_m: 0.5, maxAdern: 8, breiteBlatt_m: 1.2, breiteMax_m: 2 };

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Distance of point (x, z) to the polygon outline (m). */
function randAbstand(pts, x, z) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    m = Math.min(m, Math.hypot(a.x + t * dx - x, a.z + t * dz - z));
  }
  return m;
}

/** Douglas–Peucker simplification of a polyline (m). */
function vereinfachen(p, tol) {
  if (p.length <= 2) return p.slice();
  const a = p[0], b = p[p.length - 1];
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1e-12;
  let best = -1, bestD = -1;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((p[i].x - a.x) * dz - (p[i].z - a.z) * dx) / l;
    if (d > bestD + 1e-12) { bestD = d; best = i; }
  }
  if (bestD <= tol) return [a, b];
  const links = vereinfachen(p.slice(0, best + 1), tol), rechts = vereinfachen(p.slice(best), tol);
  return [...links.slice(0, -1), ...rechts];
}

/**
 * Close the skeleton's corner diagonals: an inner segment shorter than `t` between two longer
 * ones (the medial axis cuts the inner corner of an L at 45°) is replaced by the intersection of
 * the two neighbours extended — the corridors then meet in a real corner, which the bar solver
 * handles with its corner solution. Only when the intersection lies within `t` of the short
 * segment (no far-away crossings of nearly parallel lines).
 * @param {Array<{x:number,z:number}>} p polyline, m
 * @param {number} t length limit, m
 * @returns {Array<{x:number,z:number}>}
 */
function eckenSchliessen(p, t) {
  let out = p.slice();
  for (let k = 1; k + 2 < out.length; ) {
    const a = out[k - 1], b = out[k], c = out[k + 1], d = out[k + 2];
    const kurz = Math.hypot(c.x - b.x, c.z - b.z);
    if (kurz >= t || kurz >= Math.hypot(b.x - a.x, b.z - a.z) || kurz >= Math.hypot(d.x - c.x, d.z - c.z)) { k++; continue; }
    // Intersection of line a→b with line d→c.
    const rx = b.x - a.x, rz = b.z - a.z, sx = c.x - d.x, sz = c.z - d.z;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) { k++; continue; }
    const u = ((d.x - a.x) * sz - (d.z - a.z) * sx) / den;
    const q = { x: a.x + u * rx, z: a.z + u * rz };
    const m = { x: (b.x + c.x) / 2, z: (b.z + c.z) / 2 };
    if (u < 1 - 1e-9 || Math.hypot(q.x - m.x, q.z - m.z) > t) { k++; continue; }
    out = [...out.slice(0, k), { x: Math.round(q.x * 2) / 2, z: Math.round(q.z * 2) / 2 }, ...out.slice(k + 2)];
  }
  return out;
}

/** Polyline length (m). */
const laenge = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0);

/**
 * Veins from the skeleton of a footprint (see file head).
 * @param {Array<{x:number,z:number}>} pts footprint polygon, m
 * @param {{tiefe_m?: number, minLaenge_m?: number, zwang?: Array<{x:number,z:number}>|null, raster_m?: number, maxAdern?: number}} [o]
 *   tiefe_m = band depth that must fit (m), minLaenge_m = shortest vein kept (m), zwang = a drawn
 *   axis used as the main vein (86-07)
 * @returns {{adern: Array<{punkte: Array<{x:number,z:number}>, laenge_m: number, ordnung: number, breite_m: number, eltern: number|null, zwang: boolean}>, raster_m: number, zellen: number}}
 */
export function skelettAdern(pts, o = {}) {
  const poly = (Array.isArray(pts) ? pts : []).map((p) => ({ x: num(p.x), z: num(p.z) }));
  const leer = { adern: [], raster_m: 0, zellen: 0 };
  if (poly.length < 3) return leer;
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  let h = num(o.raster_m, SKELETT.raster_m) > 0 ? num(o.raster_m, SKELETT.raster_m) : SKELETT.raster_m;
  while (((maxX - minX) / h) * ((maxZ - minZ) / h) > SKELETT.maxZellen) h *= 1.5;
  const nx = Math.max(1, Math.ceil((maxX - minX) / h)), nz = Math.max(1, Math.ceil((maxZ - minZ) / h));
  const T = Math.max(0, num(o.tiefe_m, 10));
  const minL = Math.max(0, num(o.minLaenge_m, 11.4));
  // 1. distance field (−1 = outside)
  const d = new Float64Array(nx * nz).fill(-1);
  const mitte = (i, j) => ({ x: minX + (i + 0.5) * h, z: minZ + (j + 0.5) * h });
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const c = mitte(i, j);
    if (punktImPolygon(poly, c.x, c.z)) d[j * nx + i] = randAbstand(poly, c.x, c.z);
  }
  const D = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : d[j * nx + i]);
  // 2. ridge cells with the depth filter
  const grat = new Uint8Array(nx * nz);
  const schwelle = T / 2 - h;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = D(i, j);
    if (v < 0 || v < schwelle) continue;
    // A real maximum along the direction: not below either neighbour and above at least one
    // (a plateau along the bar axis is no ridge — otherwise every cell of a long bar counts).
    const max = (a, b) => {
      const p = D(i + a, j + b), q = D(i - a, j - b);
      return v >= p - 1e-9 && v >= q - 1e-9 && (v > p + 1e-9 || v > q + 1e-9);
    };
    if (max(1, 0) || max(0, 1) || max(1, 1) || max(1, -1)) grat[j * nx + i] = 1;
  }
  const zellen = [];
  for (let k = 0; k < grat.length; k++) if (grat[k]) zellen.push(k);
  if (!zellen.length) return { ...leer, raster_m: h };
  const offen = new Uint8Array(nx * nz);
  for (const k of zellen) offen[k] = 1;
  const nachbarn = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  /** Dijkstra over open ridge cells from `start`; returns dist + prev maps (Map keyed by cell). */
  const dijkstra = (start) => {
    const dist = new Map([[start, 0]]), prev = new Map();
    const heap = [[0, start]];
    const push = (e) => { heap.push(e); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] < heap[c][0] || (heap[p][0] === heap[c][0] && heap[p][1] <= heap[c][1])) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; const kl = (a, b) => heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]); if (l < heap.length && kl(l, m)) m = l; if (r < heap.length && kl(r, m)) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    while (heap.length) {
      const [dk, k] = pop();
      if (dk > dist.get(k) + 1e-12) continue;
      const i = k % nx, j = (k - i) / nx;
      for (const [a, b, w] of nachbarn) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const q = jj * nx + ii;
        if (!offen[q]) continue;
        const nd = dk + w * h;
        if (nd < (dist.has(q) ? dist.get(q) : Infinity) - 1e-12) { dist.set(q, nd); prev.set(q, k); push([nd, q]); }
      }
    }
    return { dist, prev };
  };
  const weitester = (dist) => { let best = -1, bd = -1; for (const [k, v] of dist) if (v > bd + 1e-9 || (Math.abs(v - bd) <= 1e-9 && k < best)) { bd = v; best = k; } return { k: best, d: bd }; };
  const pfad = (prev, ziel) => { const out = [ziel]; let c = ziel; while (prev.has(c)) { c = prev.get(c); out.push(c); } return out.reverse(); };
  const abdecken = (punkte) => {
    // Mark every open ridge cell within T/2 (at least 2 cells) of the polyline as covered.
    const r = Math.max(T / 2, 2 * h);
    for (const k of zellen) {
      if (!offen[k]) continue;
      const i = k % nx, j = (k - i) / nx, c = mitte(i, j);
      for (let s = 0; s + 1 < punkte.length; s++) {
        const a = punkte[s], b = punkte[s + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-12;
        const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2));
        if (Math.hypot(a.x + t * dx - c.x, a.z + t * dz - c.z) <= r) { offen[k] = 0; break; }
      }
    }
  };
  const fang = (p) => ({ x: Math.round(p.x / SKELETT.fang_m) * SKELETT.fang_m, z: Math.round(p.z / SKELETT.fang_m) * SKELETT.fang_m });
  /** @type {Array<{punkte: Array<{x:number,z:number}>, laenge_m: number, ordnung: number, breite_m: number, eltern: number|null, zwang: boolean}>} */
  const adern = [];
  const naechsteAder = (punkte) => {
    // Parent = the vein closest to the new vein's nearer end.
    let best = null, bd = Infinity;
    adern.forEach((a, idx) => {
      for (const e of [punkte[0], punkte[punkte.length - 1]]) {
        for (let s = 0; s + 1 < a.punkte.length; s++) {
          const p = a.punkte[s], q = a.punkte[s + 1], dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1e-12;
          const t = Math.max(0, Math.min(1, ((e.x - p.x) * dx + (e.z - p.z) * dz) / l2));
          const dd = Math.hypot(p.x + t * dx - e.x, p.z + t * dz - e.z);
          if (dd < bd - 1e-9) { bd = dd; best = idx; }
        }
      }
    });
    return best;
  };
  if (Array.isArray(o.zwang) && o.zwang.length >= 2) {
    const z = o.zwang.map((p) => ({ x: num(p.x), z: num(p.z) }));
    adern.push({ punkte: z, laenge_m: laenge(z), ordnung: 1, breite_m: SKELETT.breiteBlatt_m, eltern: null, zwang: true });
    abdecken(z);
  }
  const maxAdern = Math.max(1, Math.round(num(o.maxAdern, SKELETT.maxAdern)));
  for (let runde = 0; runde < 4 * maxAdern && adern.length < maxAdern; runde++) {
    const start = zellen.find((k) => offen[k]);
    if (start === undefined) break;
    const u = weitester(dijkstra(start).dist).k;
    const { dist, prev } = dijkstra(u);
    const v = weitester(dist);
    const kette = pfad(prev, v.k);
    const roh = kette.map((k) => { const i = k % nx, j = (k - i) / nx; return mitte(i, j); });
    if (v.d + h < minL) {
      // Too short for a bar: close this component and look at the next one.
      for (const k of dist.keys()) offen[k] = 0;
      continue;
    }
    let punkte = vereinfachen(roh, SKELETT.dpToleranz_m).map(fang);
    // Corner spurs: a short first/last segment (< T/2) is the medial-axis branch into a convex
    // corner, not a corridor — cut it (the bar runs T/2 beyond the segment end anyway).
    while (punkte.length > 2 && Math.hypot(punkte[1].x - punkte[0].x, punkte[1].z - punkte[0].z) < T / 2) punkte = punkte.slice(1);
    while (punkte.length > 2 && Math.hypot(punkte[punkte.length - 1].x - punkte[punkte.length - 2].x, punkte[punkte.length - 1].z - punkte[punkte.length - 2].z) < T / 2) punkte = punkte.slice(0, -1);
    punkte = eckenSchliessen(punkte, T);
    adern.push({ punkte, laenge_m: Math.round(laenge(punkte) * 100) / 100, ordnung: 1, breite_m: SKELETT.breiteBlatt_m, eltern: adern.length ? naechsteAder(punkte) : null, zwang: false });
    abdecken(punkte);
  }
  // 5. Strahler order + Murray widths over the vein tree (children before parents: reverse order).
  const kinder = adern.map(() => /** @type {number[]} */ ([]));
  adern.forEach((a, i) => { if (a.eltern !== null && a.eltern !== undefined) kinder[a.eltern].push(i); });
  const r3 = adern.map(() => SKELETT.breiteBlatt_m ** 3);
  for (let i = adern.length - 1; i >= 0; i--) {
    const ks = kinder[i];
    if (ks.length) {
      const hoch = Math.max(...ks.map((k) => adern[k].ordnung));
      adern[i].ordnung = ks.filter((k) => adern[k].ordnung === hoch).length >= 2 ? hoch + 1 : Math.max(1, hoch);
      r3[i] += ks.reduce((s, k) => s + r3[k], 0);
    }
    adern[i].breite_m = Math.round(Math.min(SKELETT.breiteMax_m, Math.cbrt(r3[i])) * 100) / 100;
  }
  return { adern, raster_m: h, zellen: zellen.length };
}
