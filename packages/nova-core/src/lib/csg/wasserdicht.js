// 107-14 (D-BK-08b): watertight check of a triangle mesh before every boolean of the CSG core.
//
// Why: an open (not watertight) input gives the boolean library a result WITHOUT an error message, but a wrong one
// (research 24.10.2026). The core therefore checks both inputs and refuses the operation instead of returning a silent
// wrong solid. Why `warn` and not `fail`: an open input is a finding about the data, not a program error — the caller keeps
// its analytic path (area times thickness) for the quantity and shows the warning on the component; quantities go into
// tendering and billing, so a wrong quantity is a liability question, a missing solid is not.
//
// Method: positions closer than `toleranz_m` are welded (BoxGeometry and ExtrudeGeometry give every face its own
// corners, so they are not welded). Only triangles inside the draw range count, degenerate ones (two equal welded corners)
// are skipped. Per undirected edge the triangles using it are counted with their direction:
//   1 use                       → open edge
//   more than 2 uses            → non-manifold edge
//   2 uses in the same direction → wrongly oriented (one of the two triangles is flipped)
// A negative total volume means the whole solid is inside out. Edges left open only by T-junctions (a corner of one
// triangle on the edge of the next, typical for boolean results) are split and paired again before they count as open.
// Two touching layers count each on its own as closed, never as one body (inner faces twice): the core checks per layer
// solid, never the glued wall body.
//
// In: three.js BufferGeometry (m). Out: report {ok, offeneKanten, nichtMannigfaltig, falschOrientiert, volumen_m3, dreiecke}.

import { dreieckIndizes } from "./dreiecke.js";

/**
 * Default weld tolerance in m (0.01 mm). [ASSUMED] far below any building tolerance, far above the Float32 noise of local
 * coordinates (≈ 1e-7 m at 10 m); measured 26.10.2026: every boolean result of the tests closes with it, a removed face is
 * still found. Way to a proven value: the refusals ("offen") on real projects once 107-09 runs the core on every wall.
 */
export const WASSERDICHT_TOLERANZ_M = 1e-5;

/**
 * @typedef {object} WasserdichtBericht
 * @property {boolean} ok                  closed, manifold, consistently oriented, positive volume
 * @property {number} offeneKanten         edges used by one triangle only
 * @property {number} nichtMannigfaltig    edges used by more than two triangles
 * @property {number} falschOrientiert     edges whose two triangles run the same way
 * @property {boolean} innenNachAussen     total volume negative (inside out)
 * @property {number} volumen_m3           signed volume in m³ (welded positions)
 * @property {number} dreiecke             counted (non-degenerate) triangles
 * @property {number} tVerbindungen        open edges closed by T-junction splitting (boolean results, see below)
 */

/**
 * Watertight check (see file head).
 * @param {import("three").BufferGeometry} geo
 * @param {{toleranz_m?: number}} [opt] toleranz_m: weld tolerance in m
 * @returns {WasserdichtBericht}
 */
export function istWasserdicht(geo, { toleranz_m = WASSERDICHT_TOLERANZ_M } = {}) {
  const pos = geo.getAttribute("position");
  const idx = dreieckIndizes(geo);
  const { geschweisst, lage } = verschweissen(pos, toleranz_m);
  const M = lage.length;
  /** @type {Map<number, number>} undirected edge (min · M + max) → uses: forward + ZURUECK · backward */
  const kanten = new Map();
  let dreiecke = 0;
  let vol = 0;
  // reference point = first vertex: the signed volume does not depend on it for a closed mesh, but the sum is better
  // conditioned when the mesh lies far from the origin
  const rx = pos && pos.count ? pos.getX(0) : 0, ry = pos && pos.count ? pos.getY(0) : 0, rz = pos && pos.count ? pos.getZ(0) : 0;
  for (let t = 0; t < idx.length; t += 3) {
    const v0 = geschweisst[idx[t]], v1 = geschweisst[idx[t + 1]], v2 = geschweisst[idx[t + 2]];
    if (v0 === v1 || v1 === v2 || v0 === v2) continue; // degenerate
    dreiecke += 1;
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos.getX(a) - rx, ay = pos.getY(a) - ry, az = pos.getZ(a) - rz;
    const bx = pos.getX(b) - rx, by = pos.getY(b) - ry, bz = pos.getZ(b) - rz;
    const cx = pos.getX(c) - rx, cy = pos.getY(c) - ry, cz = pos.getZ(c) - rz;
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    kanteZaehlen(kanten, M, v0, v1);
    kanteZaehlen(kanten, M, v1, v2);
    kanteZaehlen(kanten, M, v2, v0);
  }
  let nichtMannigfaltig = 0, falschOrientiert = 0;
  /** @type {Array<[number, number]>} directed open edges [from, to] */
  const offen = [];
  for (const [key, wert] of kanten) {
    const vor = wert % ZURUECK, rueck = Math.floor(wert / ZURUECK);
    const n = vor + rueck;
    const u = Math.floor(key / M), w = key % M;
    if (n === 1) offen.push(vor ? [u, w] : [w, u]);
    else if (n > 2) nichtMannigfaltig += 1;
    else if (vor !== rueck) falschOrientiert += 1;
  }
  const { offeneKanten, tVerbindungen } = tVerbindungenAufloesen(offen, lage, toleranz_m);
  const innenNachAussen = vol < 0;
  return {
    ok: dreiecke > 0 && offeneKanten === 0 && nichtMannigfaltig === 0 && falschOrientiert === 0 && !innenNachAussen,
    offeneKanten, nichtMannigfaltig, falschOrientiert, innenNachAussen, volumen_m3: vol, dreiecke, tVerbindungen,
  };
}

/** Factor that packs the backward count above the forward count in one number (no edge has 1e6 uses). */
const ZURUECK = 1e6;

/**
 * Counts one directed edge u→w in the undirected edge map.
 * @param {Map<number, number>} kanten
 * @param {number} M number of welded ids
 * @param {number} u
 * @param {number} w
 * @returns {void}
 */
function kanteZaehlen(kanten, M, u, w) {
  const key = u < w ? u * M + w : w * M + u;
  kanten.set(key, (kanten.get(key) || 0) + (u < w ? 1 : ZURUECK));
}

/**
 * Welds positions closer than the tolerance (per axis) into one id. A grid of cell size = tolerance with a search over the
 * neighbour cells within one tolerance — plain rounding would split two corners 1e-8 m apart that straddle a cell border (found 26.10.2026:
 * after three openings a wall layer showed 2 "open" edges that were such a pair).
 * @param {any} pos position attribute
 * @param {number} toleranz_m
 * @returns {{geschweisst: number[], lage: number[][]}} welded id per position index; position (m) per welded id
 */
export function verschweissen(pos, toleranz_m) {
  const n = pos ? pos.count : 0;
  /** @type {number[]} */
  const geschweisst = new Array(n);
  /** @type {number[][]} */
  const lage = [];
  /** @type {Map<number, number[]>} hashed cell → welded ids (collisions are harmless, positions are compared) */
  const zellen = new Map();
  const c = toleranz_m * 4; // cell size: a point needs a neighbour cell only within one tolerance of the cell border
  const zelle = (/** @type {number} */ ix, /** @type {number} */ iy, /** @type {number} */ iz) => (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) | 0;
  for (let i = 0; i < n; i += 1) {
    const x = pos.getX(i), y = pos.getY(i), w = pos.getZ(i);
    const x0 = Math.floor((x - toleranz_m) / c), x1 = Math.floor((x + toleranz_m) / c);
    const y0 = Math.floor((y - toleranz_m) / c), y1 = Math.floor((y + toleranz_m) / c);
    const z0 = Math.floor((w - toleranz_m) / c), z1 = Math.floor((w + toleranz_m) / c);
    let id = -1;
    for (let ix = x0; ix <= x1 && id < 0; ix += 1) for (let iy = y0; iy <= y1 && id < 0; iy += 1) for (let iz = z0; iz <= z1 && id < 0; iz += 1) {
      for (const k of zellen.get(zelle(ix, iy, iz)) || []) {
        const p = lage[k];
        if (Math.abs(p[0] - x) <= toleranz_m && Math.abs(p[1] - y) <= toleranz_m && Math.abs(p[2] - w) <= toleranz_m) { id = k; break; }
      }
    }
    if (id < 0) {
      id = lage.length;
      lage.push([x, y, w]);
      const key = zelle(Math.floor(x / c), Math.floor(y / c), Math.floor(w / c));
      const liste = zellen.get(key);
      if (liste) liste.push(id); else zellen.set(key, [id]);
    }
    geschweisst[i] = id;
  }
  return { geschweisst, lage };
}

/**
 * T-junctions: the boolean library splits the triangles along the cut but not their neighbours, so a corner of one triangle
 * lies on the edge of the next (measured 26.10.2026: a wall minus one opening has 74 such single-used edges, its volume is
 * exact). Such a mesh is closed in space, only not edge-conforming. An open edge u→w is therefore split at every open-edge
 * corner that lies on it (distance ≤ tolerance, strictly between u and w); the pieces must then pair up with pieces of the
 * opposite direction. What stays single afterwards is a real gap (a removed face never pairs up).
 * Only corners of open edges are candidates: at a T-junction both the long edge and the two short ones are open.
 * A corner counts as "on the edge" within 2 × toleranz_m of it. [ASSUMED] factor 2: the corner and the edge end points are
 * each welded within one tolerance, so their distance may add up to two; a larger factor would pair real gaps.
 * @param {Array<[number, number]>} offen directed open edges (welded ids)
 * @param {number[][]} lage position in m per welded id
 * @param {number} toleranz_m
 * @returns {{offeneKanten: number, tVerbindungen: number}} remaining open edge pieces; edges closed by splitting
 */
function tVerbindungenAufloesen(offen, lage, toleranz_m) {
  if (!offen.length) return { offeneKanten: 0, tVerbindungen: 0 };
  const ketten = tVerbindungsKetten(offen, lage, toleranz_m);
  /** @type {Map<string, {vor: number, rueck: number}>} */
  const stuecke = new Map();
  let geteilt = 0;
  for (const kette of ketten) {
    if (kette.length > 2) geteilt += 1;
    for (let i = 0; i + 1 < kette.length; i += 1) {
      const p = kette[i], q = kette[i + 1];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      let k = stuecke.get(key);
      if (!k) { k = { vor: 0, rueck: 0 }; stuecke.set(key, k); }
      if (p < q) k.vor += 1; else k.rueck += 1;
    }
  }
  let rest = 0;
  for (const k of stuecke.values()) rest += Math.abs(k.vor - k.rueck) + (k.vor && k.rueck && k.vor + k.rueck > 2 ? k.vor + k.rueck - 2 : 0);
  return { offeneKanten: rest, tVerbindungen: rest === 0 ? geteilt : 0 };
}

/**
 * The chain of every directed open edge u→w: [u, …open-edge corners on the edge ordered from u…, w] (see
 * tVerbindungenAufloesen for the rule "on the edge"). An edge without such a corner gives [u, w].
 * @param {Array<[number, number]>} offen directed open edges (welded ids)
 * @param {number[][]} lage position in m per welded id
 * @param {number} toleranz_m
 * @returns {number[][]} one chain per open edge, same order as `offen`
 */
function tVerbindungsKetten(offen, lage, toleranz_m) {
  // candidates sorted by x: an edge only looks at corners inside its x range (binary search)
  const kandidaten = [...new Set(offen.flat())].sort((p, q) => lage[p][0] - lage[q][0]);
  const xs = kandidaten.map((k) => lage[k][0]);
  const ab = (/** @type {number} */ x) => {
    let lo = 0, hi = xs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; }
    return lo;
  };
  return offen.map(([u, w]) => {
    const a = lage[u], b = lage[w];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    /** @type {Array<[number, number]>} [t, id] */
    const auf = [];
    const xmax = Math.max(a[0], b[0]) + toleranz_m * 2;
    for (let j = ab(Math.min(a[0], b[0]) - toleranz_m * 2); j < kandidaten.length && xs[j] <= xmax; j += 1) {
      const s = kandidaten[j];
      if (s === u || s === w) continue;
      const p = lage[s];
      const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2;
      if (t <= 0 || t >= 1) continue;
      const abstand = Math.hypot(a[0] + d[0] * t - p[0], a[1] + d[1] * t - p[1], a[2] + d[2] * t - p[2]);
      if (abstand <= toleranz_m * 2) auf.push([t, s]);
    }
    auf.sort((x, y) => x[0] - y[0]);
    return [u, ...auf.map((x) => x[1]), w];
  });
}

/**
 * 107-18: makes a welded triangle list edge-conforming by splitting every triangle at the T-junction corners on its open
 * edges (the same corners the watertight check pairs up, tVerbindungsKetten). An input the check accepted only through
 * T-junction splitting would otherwise reach the boolean library as it is and be refused there as not manifold
 * (manifold-3d needs every edge shared by exactly two triangles). A triangle a, b, c with corners p1 … pk on edge a→b becomes
 * the fan a p1 c, p1 p2 c, …, pk b c (same orientation); its other two edges are split the same way. Without open edges the
 * list comes back unchanged. Real gaps stay open (the library still refuses them).
 * @param {number[]} tri welded corner ids, three per non-degenerate triangle
 * @param {number[][]} lage position in m per welded id
 * @param {number} [toleranz_m] the weld tolerance of the check, m
 * @returns {{tri: number[], herkunft: number[], tVerbindungen: number}} split list, index of the source triangle per new
 *   triangle, number of open edges that were split
 */
export function tVerbindungenTeilen(tri, lage, toleranz_m = WASSERDICHT_TOLERANZ_M) {
  const M = lage.length;
  /** @type {Map<number, number>} */
  const kanten = new Map();
  for (let t = 0; t < tri.length; t += 3) {
    kanteZaehlen(kanten, M, tri[t], tri[t + 1]);
    kanteZaehlen(kanten, M, tri[t + 1], tri[t + 2]);
    kanteZaehlen(kanten, M, tri[t + 2], tri[t]);
  }
  /** @type {Array<[number, number]>} */
  const offen = [];
  for (const [key, wert] of kanten) {
    const vor = wert % ZURUECK, rueck = Math.floor(wert / ZURUECK);
    const u = Math.floor(key / M), w = key % M;
    if (vor + rueck === 1) offen.push(vor ? [u, w] : [w, u]);
  }
  const herkunft0 = Array.from({ length: tri.length / 3 }, (_, i) => i);
  if (!offen.length) return { tri, herkunft: herkunft0, tVerbindungen: 0 };
  /** @type {Map<number, number[]>} directed open edge (u · M + w) → corners strictly between u and w, ordered from u */
  const innen = new Map();
  tVerbindungsKetten(offen, lage, toleranz_m).forEach((kette) => {
    if (kette.length > 2) innen.set(kette[0] * M + kette[kette.length - 1], kette.slice(1, -1));
  });
  if (!innen.size) return { tri, herkunft: herkunft0, tVerbindungen: 0 };
  /** @type {number[]} */
  const neu = [];
  /** @type {number[]} */
  const herkunft = [];
  for (let t = 0; t < tri.length; t += 3) {
    // the pieces a→p1, p1→p2 … of a split edge are never keys of `innen` (all corners of the edge are used at once), so
    // every edge is split at most once and the stack runs empty
    /** @type {Array<[number, number, number]>} */
    const stapel = [[tri[t], tri[t + 1], tri[t + 2]]];
    while (stapel.length) {
      const [a, b, c] = /** @type {[number, number, number]} */ (stapel.pop());
      const r = [[a, b, c], [b, c, a], [c, a, b]].find(([x, y]) => innen.has(x * M + y));
      if (!r) { neu.push(a, b, c); herkunft.push(t / 3); continue; }
      const [x, y, z] = r;
      const kette = [x, .../** @type {number[]} */ (innen.get(x * M + y)), y];
      for (let i = 0; i + 1 < kette.length; i += 1) stapel.push([kette[i], kette[i + 1], z]);
    }
  }
  return { tri: neu, herkunft, tVerbindungen: innen.size };
}
