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
// rettungsweg() itself walks the own apartment open-plan (walls between rooms
// are no obstacles). Since 75-17 tesselierung.js uses it for the OUTER leg only
// (candidates empty) and computes the inner leg with innenwegUeberTueren()
// below — room door → hall → apartment door; open plan stays the flagged
// fallback when no door path exists.
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

// ---------------------------------------------------------------------------
// 75-17: inner leg through DOORS and the hall instead of open plan.
//
// User decision D-P75-13-C (07.10.2026, Sichtprüfung): "mittelflur haus hat auch
// das problem mit luftlinie zimmer und flur" — the walked line from the deepest
// corner of a room must leave the room through its door, cross the hall
// (Diele/Flur) and reach the apartment door, never pass diagonally through walls.
//
// Model: every zone of the unit is a walkable polygon; walls between zones are
// closed except at OPENINGS. A graph over the openings (+ the exit) is searched
// with Dijkstra; an edge between two openings of the same zone is the shortest
// path INSIDE that zone polygon (around re-entrant corners of an L-shaped hall).
// Openings, best source first:
//   "tueren"      door records tueren[] (75-14 rule on): door middle on the wall;
//   "wandstuecke" no door data: a room sharing ≥ minOeffnung_m of wall with a
//                 hall/corridor zone gets an opening at the middle of that wall
//                 (same rule as wohnungsErschliessung ADJAZENZ_MIN_M, 1,185 m);
//   "durchgang"   a room still unreachable is entered through a neighbouring room
//                 (walk-through) — approximation only, never a design proposal
//                 (D-P75-14-C forbids walk-through rooms).
// Hall/corridor zones that share ≥ minOeffnung_m are one space (opening at the
// middle); an open kitchen (no door of its own, ≥ 1,0 m wall with a living room)
// opens into the living room. Everything except "tueren" is flagged naeherung.
// ---------------------------------------------------------------------------

/** [ASSUMED] minimum shared wall for an open kitchen (same as wohnungsErschliessung OFFENE_KUECHE_MIN_M). */
export const OFFENE_KUECHE_MIN_M = 1.0;

const istFlurZoneRw = (z) => !!z && (z.art === "flur" || z.raumart === "flur");
const istKuecheRw = (z) => z?.art === "kueche";
const istWohnraumRw = (z) => z?.art === "aufenthalt" && /wohn|ess/i.test(String(z?.name || ""));

/** Point inside the polygon or on its boundary (walkable-polygon test). */
function innenOderRand(p, poly) {
  for (let i = 0; i < poly.length; i++) if (aufStrecke(p, poly[i], poly[(i + 1) % poly.length])) return true;
  return punktInPolygon(p, poly);
}

/**
 * Does the straight segment a→b stay inside the walkable polygon (boundary
 * allowed)? Same interval method as sichtbar(), inverted: every piece between
 * boundary contacts must have its midpoint inside or on the boundary.
 * @param {{x:number,z:number}} a
 * @param {{x:number,z:number}} b
 * @param {Array<{x:number,z:number}>} poly walkable polygon (metres)
 * @returns {boolean}
 */
export function sichtbarInnen(a, b, poly) {
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) ts.push(...beruehrParameter(a, b, poly[i], poly[(i + 1) % poly.length]));
  ts.sort((p, q) => p - q);
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] < 1e-9) continue;
    const t = (ts[i] + ts[i + 1]) / 2;
    if (!innenOderRand({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, poly)) return false;
  }
  return true;
}

/**
 * Shortest walked line between two points INSIDE one polygon (a room): straight
 * when visible, else Dijkstra over the polygon corners (the path bends only at
 * re-entrant corners — an L-shaped hall).
 * @param {{x:number,z:number}} a metres
 * @param {{x:number,z:number}} b metres
 * @param {Array<{x:number,z:number}>} poly room polygon (metres)
 * @returns {{ laenge_m: number, pfad: Array<{x:number,z:number}> }} Infinity / [] when not connected inside
 */
export function wegImRaum(a, b, poly) {
  if (sichtbarInnen(a, b, poly)) return { laenge_m: Math.hypot(b.x - a.x, b.z - a.z), pfad: [a, b] };
  const knoten = [a, b, ...poly];
  const n = knoten.length;
  const dist = new Array(n).fill(Infinity), vor = new Array(n).fill(-1), fertig = new Array(n).fill(false);
  dist[0] = 0;
  for (let r = 0; r < n; r++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!fertig[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    fertig[u] = true;
    for (let v = 0; v < n; v++) {
      if (fertig[v]) continue;
      const d = Math.hypot(knoten[v].x - knoten[u].x, knoten[v].z - knoten[u].z);
      if (dist[u] + d >= dist[v] || !sichtbarInnen(knoten[u], knoten[v], poly)) continue;
      dist[v] = dist[u] + d; vor[v] = u;
    }
  }
  if (dist[1] === Infinity) return { laenge_m: Infinity, pfad: [] };
  return { laenge_m: dist[1], pfad: pfadZu(knoten, vor, 1) };
}

/**
 * Longest collinear wall piece two polygons share (tolerance 2 cm, float noise only).
 * @param {Array<{x:number,z:number}>} pa polygon A (metres)
 * @param {Array<{x:number,z:number}>} pb polygon B (metres)
 * @param {number} [tol] metres
 * @returns {{a:{x:number,z:number}, b:{x:number,z:number}, laenge:number}|null}
 */
export function gemeinsamesWandstueck(pa, pb, tol = 0.02) {
  let best = null;
  for (let i = 0; i < pa.length; i++) {
    const a0 = pa[i], a1 = pa[(i + 1) % pa.length];
    const la = Math.hypot(a1.x - a0.x, a1.z - a0.z);
    if (la < EPS) continue;
    const dx = (a1.x - a0.x) / la, dz = (a1.z - a0.z) / la;
    for (let j = 0; j < pb.length; j++) {
      const b0 = pb[j], b1 = pb[(j + 1) % pb.length];
      const abst = (p) => Math.abs((p.x - a0.x) * dz - (p.z - a0.z) * dx);
      if (abst(b0) >= tol || abst(b1) >= tol) continue;
      const u = (p) => (p.x - a0.x) * dx + (p.z - a0.z) * dz;
      const u0 = Math.max(0, Math.min(u(b0), u(b1))), u1 = Math.min(la, Math.max(u(b0), u(b1)));
      if (u1 - u0 <= tol) continue;
      if (!best || u1 - u0 > best.laenge) best = { a: { x: a0.x + dx * u0, z: a0.z + dz * u0 }, b: { x: a0.x + dx * u1, z: a0.z + dz * u1 }, laenge: u1 - u0 };
    }
  }
  return best;
}

/** Nearest point on the polygon boundary and its distance (metres). */
function naechsterRandpunkt(p, poly) {
  let best = { punkt: poly[0], d: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l2));
    const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best.d) best = { punkt: q, d };
  }
  return best;
}

/**
 * Inner leg of ONE unit through its doors (75-17): deepest candidate corner →
 * room door → hall/corridor → apartment door.
 *
 * @param {object} opts
 * @param {Array<object>} opts.zonen zones of ONE unit on ONE storey ({ name, art, raumart, points:[{x,z}], tueren?, fensterpflicht? }, metres); balconies are skipped
 * @param {{x:number,z:number}} opts.ausgang apartment door point (metres) — the outer leg starts there
 * @param {number} [opts.minOeffnung_m] minimum shared wall for a synthesized opening (default 1,185 m = room door 0,885 + 2 × 0,15 jamb)
 * @returns {null | { laenge_m: number, pfad: Array<{x:number,z:number}>, start: {x:number,z:number}, tuerpunkte: Array<{x:number,z:number}>, art: "tueren"|"wandstuecke"|"durchgang", naeherung: boolean }}
 *   lengths in metres; tuerpunkte = openings passed, room door first, apartment door last;
 *   null when no candidate reaches the exit (caller falls back to the open-plan line, flagged)
 */
export function innenwegUeberTueren(opts) {
  const o = /** @type {any} */ (opts || {});
  const minOeff = num(o.minOeffnung_m, 1.185);
  const zonen = (Array.isArray(o.zonen) ? o.zonen : [])
    .filter((z) => z && z.raumart !== "balkon" && Array.isArray(z.points) && z.points.length >= 3)
    .map((z) => ({ ...z, name: String(z.name), poly: z.points.map((p) => ({ x: num(p.x), z: num(p.z) })) }));
  if (!zonen.length) return null;
  const byName = new Map(zonen.map((z) => [z.name, z]));
  const ausgang = { x: num(o.ausgang?.x), z: num(o.ausgang?.z) };
  const mitte = (s) => ({ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 });

  /** @type {Array<{p:{x:number,z:number}, zonen:string[], tuer:boolean}>} */
  const basis = [];
  let exitZone = null, exitPunkt = null;
  const mitTueren = zonen.some((z) => Array.isArray(z.tueren));
  if (mitTueren) {
    for (const z of zonen) {
      for (const t of Array.isArray(z.tueren) ? z.tueren : []) {
        const n = z.poly.length, w = Math.round(num(t?.wand, -1));
        if (w < 0 || w >= n) continue;
        const a = z.poly[w], b = z.poly[(w + 1) % n];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < EPS) continue;
        // Door middle: same clamping as wohnungsErschliessung.tuerGeometrie.
        const br = Math.min(len, Math.max(0.1, num(t.breite_m, 0.885)));
        const u = Math.max(0, Math.min(len - br, num(t.u_m))) + br / 2;
        const p = { x: a.x + ((b.x - a.x) / len) * u, z: a.z + ((b.z - a.z) / len) * u };
        if (t.nach === null || t.nach === undefined) { exitZone = z.name; exitPunkt = p; continue; }
        if (byName.has(String(t.nach))) basis.push({ p, zonen: [z.name, String(t.nach)], tuer: true });
      }
    }
  } else {
    for (const z of zonen) {
      if (istFlurZoneRw(z)) continue;
      for (const f of zonen) {
        if (!istFlurZoneRw(f)) continue;
        const s = gemeinsamesWandstueck(z.poly, f.poly);
        if (s && s.laenge >= minOeff) basis.push({ p: mitte(s), zonen: [z.name, f.name], tuer: true });
      }
    }
  }
  // Hall + corridor strip touching = one space; open kitchen into the living room.
  for (let i = 0; i < zonen.length; i++) for (let j = i + 1; j < zonen.length; j++) {
    const a = zonen[i], b = zonen[j];
    if (!(istFlurZoneRw(a) && istFlurZoneRw(b))) continue;
    const s = gemeinsamesWandstueck(a.poly, b.poly);
    if (s && s.laenge >= minOeff) basis.push({ p: mitte(s), zonen: [a.name, b.name], tuer: false });
  }
  for (const k of zonen) {
    if (!istKuecheRw(k) || basis.some((q) => q.tuer && q.zonen.includes(k.name))) continue;
    for (const w of zonen) {
      if (!istWohnraumRw(w)) continue;
      const s = gemeinsamesWandstueck(k.poly, w.poly);
      if (s && s.laenge >= OFFENE_KUECHE_MIN_M) { basis.push({ p: mitte(s), zonen: [k.name, w.name], tuer: false }); break; }
    }
  }
  if (!exitZone) {
    // No entrance door record: the exit belongs to the zone whose wall is nearest
    // to the apartment door point (corridor edge of the unit); ties prefer the hall.
    let best = null;
    for (const z of zonen) {
      const r = naechsterRandpunkt(ausgang, z.poly);
      if (!best || r.d < best.d - 1e-9 || (Math.abs(r.d - best.d) < 1e-9 && istFlurZoneRw(z) && !istFlurZoneRw(best.z))) best = { z, ...r };
    }
    exitZone = best.z.name; exitPunkt = best.punkt;
  }

  const quellen = zonen.filter((z) => z.fensterpflicht === true);
  const startZonen = quellen.length ? quellen : zonen.filter((z) => !istFlurZoneRw(z));
  if (!startZonen.length) return null;

  const loese = (oeffnungen) => {
    // Node 0 = exit (in the exit zone); nodes 1.. = openings (in both zones).
    const knoten = [{ p: exitPunkt, zonen: [exitZone] }, ...oeffnungen];
    const n = knoten.length;
    const dist = new Array(n).fill(Infinity), vor = new Array(n).fill(-1), seg = new Array(n).fill(null), fertig = new Array(n).fill(false);
    dist[0] = 0;
    for (let r = 0; r < n; r++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!fertig[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      fertig[u] = true;
      for (let v = 0; v < n; v++) {
        if (fertig[v]) continue;
        for (const zn of knoten[u].zonen) {
          if (!knoten[v].zonen.includes(zn)) continue;
          const w = wegImRaum(knoten[u].p, knoten[v].p, byName.get(zn).poly);
          if (dist[u] + w.laenge_m < dist[v]) { dist[v] = dist[u] + w.laenge_m; vor[v] = u; seg[v] = w.pfad; }
        }
      }
    }
    // Deepest candidate corner: max over candidates of (min over the room's openings).
    /** @type {{d:number, i:number, pfad:Array<{x:number,z:number}>, start:{x:number,z:number}}|null} */
    let best = null;
    for (const z of startZonen) {
      const cx = z.poly.reduce((s, p) => s + p.x, 0) / z.poly.length, cz = z.poly.reduce((s, p) => s + p.z, 0) / z.poly.length;
      for (const p of z.poly) {
        const dx = cx - p.x, dz = cz - p.z, l = Math.hypot(dx, dz) || 1;
        const c = { x: p.x + (dx / l) * 0.05, z: p.z + (dz / l) * 0.05 };
        /** @type {{d:number, i:number, pfad:Array<{x:number,z:number}>}|null} */
        let bestC = null;
        for (let i = 0; i < knoten.length; i++) {
          if (dist[i] === Infinity || !knoten[i].zonen.includes(z.name)) continue;
          const w = wegImRaum(c, knoten[i].p, z.poly);
          if (w.laenge_m === Infinity) continue;
          const d = w.laenge_m + dist[i];
          if (!bestC || d < bestC.d) bestC = { d, i, pfad: w.pfad };
        }
        if (!bestC) return { fehlt: z.name };
        if (!best || bestC.d > best.d) best = { ...bestC, start: c };
      }
    }
    if (!best) return null;
    // Path: candidate → room opening → … → exit point → apartment door point.
    const pfad = [...best.pfad];
    const tuerpunkte = [];
    for (let i = best.i; i > 0; i = vor[i]) {
      tuerpunkte.push(knoten[i].p);
      const s = seg[i]; // seg[i] runs from vor[i] to i — append it backwards
      for (let k = s.length - 2; k >= 0; k--) pfad.push(s[k]);
    }
    tuerpunkte.push(exitPunkt);
    pfad.push(ausgang);
    const schluss = Math.hypot(ausgang.x - exitPunkt.x, ausgang.z - exitPunkt.z);
    const sauber = pfad.filter((p, i) => i === 0 || Math.hypot(p.x - pfad[i - 1].x, p.z - pfad[i - 1].z) > 1e-6);
    return { laenge_m: best.d + schluss, pfad: sauber, start: best.start, tuerpunkte };
  };

  let art = mitTueren ? "tueren" : "wandstuecke";
  let r = loese(basis);
  if (r && "fehlt" in r) {
    // A windowed room has no opening to the circulation: walk-through approximation.
    const extra = [];
    for (let i = 0; i < zonen.length; i++) for (let j = i + 1; j < zonen.length; j++) {
      const a = zonen[i], b = zonen[j];
      if (basis.some((q) => q.zonen.includes(a.name) && q.zonen.includes(b.name))) continue;
      const s = gemeinsamesWandstueck(a.poly, b.poly);
      if (s && s.laenge >= minOeff) extra.push({ p: mitte(s), zonen: [a.name, b.name], tuer: true });
    }
    art = "durchgang";
    r = loese([...basis, ...extra]);
  }
  if (!r || "fehlt" in r) return null;
  return { ...r, art: /** @type {"tueren"|"wandstuecke"|"durchgang"} */ (art), naeherung: art !== "tueren" };
}
