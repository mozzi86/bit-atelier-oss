// Escape-route length as a WALKED line (Plan 75-13 Task 1, MS-07 / HANDOFF §12).
//
// MBO §35 Abs. 2 Satz 2 / BayBO Art. 33 Abs. 2 Satz 2 [CITED]: from every point of
// a habitable room at most 35 m to the exit into a necessary stair enclosure or
// into the open — measured as the actual walking line around walls, not as the
// crow flies and not Manhattan (which 75-07 used: `|dx| + |dz|` to the CORE
// CENTRE, see tesselierung.js history). This module gives the geometry:
//
//   lauflaenge(start, ziel, hindernisse)  shortest path around obstacle polygons
//   tiefsterPunkt(kandidaten, tuer, …)    the candidate corner farthest (walked)
//   rettungsweg({ kandidaten, tuer, ziele, hindernisse })
//                                         deepest corner → apartment door → nearest
//                                         stair door; length + path
//
// Method: visibility graph over the obstacle corners (each corner pushed
// KNOTEN_VERSATZ_M outward so the path never runs ON a wall), an edge between two
// nodes when the straight segment crosses no obstacle interior, Dijkstra from
// the door (multi-target: every stair door is a sink). Obstacles are closed
// polygons [{x,z}] in metres (other dwelling units, stair core, lift shaft).
// Touching an obstacle boundary is allowed (shared walls ARE boundaries).
//
// [ASSUMED] Inside the own apartment the walls between rooms are NOT obstacles
// (open-plan approximation — the rooms open onto the hall, the corridor leg
// dominates the length). Provable path: feed the room polygons minus door
// openings as obstacles once door positions exist for every typology.
//
// Pure module: no imports, no React, node-testable. Coordinates: zone metres.

/** Corner offset in metres so graph nodes sit beside, not on, the wall [ASSUMED 5 cm]. */
export const KNOTEN_VERSATZ_M = 0.05;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const EPS = 1e-9;

/**
 * Point strictly inside a polygon (ray casting; boundary counts as OUTSIDE so a
 * node standing on a shared wall is never "inside" the neighbour).
 * @param {{x:number,z:number}} p
 * @param {Array<{x:number,z:number}>} poly
 * @returns {boolean}
 */
export function punktInPolygon(p, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    // On the edge → outside by definition (see JSDoc).
    if (aufStrecke(p, a, b)) return false;
    const schneidet = (a.z > p.z) !== (b.z > p.z)
      && p.x < ((b.x - a.x) * (p.z - a.z)) / ((b.z - a.z) || EPS) + a.x;
    if (schneidet) inside = !inside;
  }
  return inside;
}

/** Point on segment a→b (within 1e-7 m). */
function aufStrecke(p, a, b) {
  const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z);
  if (dot < -1e-7) return false;
  const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
  return dot <= len2 + 1e-7;
}

/**
 * Parameters t ∈ [0,1] along a→b where the segment touches the edge c→d (one
 * value for a point contact, two for a collinear overlap, none otherwise).
 * @returns {number[]}
 */
function beruehrParameter(a, b, c, d) {
  const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
  const denom = rx * sz - rz * sx;
  const qx = c.x - a.x, qz = c.z - a.z;
  const r2 = rx * rx + rz * rz;
  if (Math.abs(denom) < 1e-12) {
    // Parallel: only a collinear overlap matters (walking ALONG a wall).
    if (Math.abs(qx * rz - qz * rx) > 1e-9 || r2 < EPS) return [];
    const t0 = (qx * rx + qz * rz) / r2, t1 = ((d.x - a.x) * rx + (d.z - a.z) * rz) / r2;
    return [t0, t1].filter((t) => t > 0 && t < 1);
  }
  const t = (qx * sz - qz * sx) / denom, u = (qx * rz - qz * rx) / denom;
  const tol = 1e-9;
  return t >= -tol && t <= 1 + tol && u >= -tol && u <= 1 + tol ? [Math.min(1, Math.max(0, t))] : [];
}

/**
 * Is the straight segment a→b free of obstacle interiors?
 * Exact interval test per obstacle: every parameter where the segment touches an
 * obstacle edge splits it into pieces; the segment is blocked when the midpoint
 * of ANY piece lies strictly inside the obstacle. This also blocks a segment that
 * enters through a CORNER (no proper edge crossing) and a segment running from
 * corner to corner through a rectangle, while touching a boundary or walking
 * along a wall stays allowed (boundary counts as outside).
 * @param {{x:number,z:number}} a
 * @param {{x:number,z:number}} b
 * @param {Array<Array<{x:number,z:number}>>} hindernisse obstacle polygons (metres)
 * @returns {boolean}
 */
export function sichtbar(a, b, hindernisse) {
  for (const poly of hindernisse) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const ts = [0, 1];
    for (let i = 0; i < poly.length; i++) ts.push(...beruehrParameter(a, b, poly[i], poly[(i + 1) % poly.length]));
    ts.sort((p, q) => p - q);
    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i + 1] - ts[i] < 1e-9) continue;
      const t = (ts[i] + ts[i + 1]) / 2;
      if (punktInPolygon({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, poly)) return false;
    }
  }
  return true;
}

/**
 * Graph nodes from obstacle corners, each pushed outward along the corner
 * bisector by KNOTEN_VERSATZ_M (away from the polygon interior).
 * @param {Array<Array<{x:number,z:number}>>} hindernisse
 * @returns {Array<{x:number,z:number}>}
 */
export function eckKnoten(hindernisse) {
  const out = [];
  for (const poly of hindernisse) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i], prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
      const d1 = norm({ x: p.x - prev.x, z: p.z - prev.z });
      const d2 = norm({ x: next.x - p.x, z: next.z - p.z });
      // Outward bisector = (d1 − d2) normalised; for a straight run (collinear)
      // use the edge normal pointing away from the interior.
      let bis = norm({ x: d1.x - d2.x, z: d1.z - d2.z });
      if (Math.hypot(bis.x, bis.z) < 0.5) bis = norm({ x: -d1.z, z: d1.x });
      let q = { x: p.x + bis.x * KNOTEN_VERSATZ_M, z: p.z + bis.z * KNOTEN_VERSATZ_M };
      if (punktInPolygon(q, poly)) q = { x: p.x - bis.x * KNOTEN_VERSATZ_M, z: p.z - bis.z * KNOTEN_VERSATZ_M };
      out.push(q);
    }
  }
  return out;
}

function norm(v) {
  const l = Math.hypot(v.x, v.z);
  return l < EPS ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l };
}

/**
 * Dijkstra over the visibility graph from ONE source to every node.
 * @param {Array<{x:number,z:number}>} knoten node list (source included)
 * @param {number} quelle index of the source node
 * @param {Array<Array<{x:number,z:number}>>} hindernisse
 * @returns {{ dist: number[], vor: number[] }} distances in metres (Infinity = unreachable), predecessor indices
 */
export function dijkstra(knoten, quelle, hindernisse) {
  const n = knoten.length;
  const dist = new Array(n).fill(Infinity);
  const vor = new Array(n).fill(-1);
  const fertig = new Array(n).fill(false);
  // Lazily evaluated adjacency: visibility is tested when a node is settled
  // (each pair at most once) — O(n²) segment tests, fine for ≤ a few hundred nodes.
  dist[quelle] = 0;
  for (let runde = 0; runde < n; runde++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!fertig[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    fertig[u] = true;
    for (let v = 0; v < n; v++) {
      if (fertig[v]) continue;
      const d = Math.hypot(knoten[v].x - knoten[u].x, knoten[v].z - knoten[u].z);
      if (dist[u] + d >= dist[v]) continue; // cannot improve → skip the costly test
      if (!sichtbar(knoten[u], knoten[v], hindernisse)) continue;
      dist[v] = dist[u] + d;
      vor[v] = u;
    }
  }
  return { dist, vor };
}

function pfadZu(knoten, vor, ziel) {
  const out = [];
  for (let i = ziel; i >= 0; i = vor[i]) out.unshift({ x: knoten[i].x, z: knoten[i].z });
  return out;
}

/**
 * Shortest walked line from start to ziel around the obstacles.
 * @param {{x:number,z:number}} start metres
 * @param {{x:number,z:number}} ziel metres
 * @param {Array<Array<{x:number,z:number}>>} [hindernisse] obstacle polygons (metres)
 * @returns {{ laenge_m: number, pfad: Array<{x:number,z:number}> }} laenge_m Infinity and pfad [] when unreachable
 */
export function lauflaenge(start, ziel, hindernisse = []) {
  const hs = Array.isArray(hindernisse) ? hindernisse : [];
  const s = { x: num(start?.x), z: num(start?.z) }, z = { x: num(ziel?.x), z: num(ziel?.z) };
  if (sichtbar(s, z, hs)) return { laenge_m: Math.hypot(z.x - s.x, z.z - s.z), pfad: [s, z] };
  const knoten = [s, z, ...eckKnoten(hs)];
  const { dist, vor } = dijkstra(knoten, 0, hs);
  if (dist[1] === Infinity) return { laenge_m: Infinity, pfad: [] };
  return { laenge_m: dist[1], pfad: pfadZu(knoten, vor, 1) };
}

/**
 * The candidate corner with the LONGEST walked line to the door — the "deepest
 * point" of a habitable room is a corner, never the room centre.
 * @param {Array<{x:number,z:number}>} kandidaten room corners (metres), e.g. corners of every windowed room
 * @param {{x:number,z:number}} tuer apartment door (metres)
 * @param {Array<Array<{x:number,z:number}>>} [hindernisse]
 * @returns {{ punkt: {x:number,z:number}|null, laenge_m: number, pfad: Array<{x:number,z:number}> }}
 */
export function tiefsterPunkt(kandidaten, tuer, hindernisse = []) {
  let best = { punkt: null, laenge_m: 0, pfad: [] };
  for (const k of Array.isArray(kandidaten) ? kandidaten : []) {
    const r = lauflaenge(k, tuer, hindernisse);
    if (r.laenge_m !== Infinity && r.laenge_m > best.laenge_m) best = { punkt: { x: num(k.x), z: num(k.z) }, laenge_m: r.laenge_m, pfad: r.pfad };
  }
  return best;
}

/**
 * Full escape route of ONE dwelling unit: deepest candidate corner → apartment
 * door → nearest stair door (or corridor end). ONE Dijkstra from the door serves
 * both legs (undirected graph): max over candidates, min over targets.
 *
 * @param {object} opts
 * @param {Array<{x:number,z:number}>} opts.kandidaten corners of the unit's habitable rooms (metres)
 * @param {{x:number,z:number}} opts.tuer apartment door (metres)
 * @param {Array<{x:number,z:number}>} opts.ziele stair doors / corridor ends (metres); empty → length = inner leg only
 * @param {Array<Array<{x:number,z:number}>>} [opts.hindernisse] obstacle polygons: other units, core, shaft (metres)
 * @param {boolean} [opts.tuerImTreppenraum] the apartment door opens directly into the stair enclosure → outer leg 0
 * @returns {{ laenge_m: number, innen_m: number, flur_m: number, pfad: Array<{x:number,z:number}>, start: {x:number,z:number}|null, ziel: {x:number,z:number}|null, erreichbar: boolean }}
 *   lengths in metres; erreichbar false when no target is reachable (then flur_m is the straight-line fallback [ASSUMED] and pfad holds the straight leg)
 */
export function rettungsweg(opts) {
  const o = /** @type {any} */ (opts || {});
  const hs = Array.isArray(o.hindernisse) ? o.hindernisse : [];
  const tuer = { x: num(o.tuer?.x), z: num(o.tuer?.z) };
  const kand = (Array.isArray(o.kandidaten) ? o.kandidaten : []).map((k) => ({ x: num(k?.x), z: num(k?.z) }));
  const ziele = (Array.isArray(o.ziele) ? o.ziele : []).map((k) => ({ x: num(k?.x), z: num(k?.z) }));
  const knoten = [tuer, ...kand, ...ziele, ...eckKnoten(hs)];
  const { dist, vor } = dijkstra(knoten, 0, hs);
  // Inner leg: farthest reachable candidate.
  let start = null, innen = 0, innenIdx = -1;
  kand.forEach((k, i) => {
    const d = dist[1 + i];
    if (d !== Infinity && d > innen) { innen = d; start = k; innenIdx = 1 + i; }
  });
  // Outer leg: nearest reachable target.
  let ziel = null, flur = 0, zielIdx = -1, erreichbar = true;
  if (!o.tuerImTreppenraum && ziele.length) {
    flur = Infinity;
    ziele.forEach((z, i) => {
      const d = dist[1 + kand.length + i];
      if (d < flur) { flur = d; ziel = z; zielIdx = 1 + kand.length + i; }
    });
    if (flur === Infinity) {
      // Nothing reachable (e.g. Spänner quadrant without corridor): straight line
      // to the nearest target as a marked approximation instead of Infinity.
      erreichbar = false;
      ziele.forEach((z) => { const d = Math.hypot(z.x - tuer.x, z.z - tuer.z); if (d < flur) { flur = d; ziel = z; } });
      zielIdx = -1;
    }
  }
  const pfadInnen = innenIdx >= 0 ? pfadZu(knoten, vor, innenIdx).reverse() : [tuer];
  const pfadFlur = zielIdx >= 0 ? pfadZu(knoten, vor, zielIdx).slice(1) : (ziel && !o.tuerImTreppenraum ? [ziel] : []);
  return {
    laenge_m: innen + flur, innen_m: innen, flur_m: flur,
    pfad: [...pfadInnen, ...pfadFlur], start, ziel, erreichbar,
  };
}
