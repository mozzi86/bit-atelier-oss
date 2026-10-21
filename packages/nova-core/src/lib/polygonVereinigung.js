// Union of simple polygons that TOUCH along shared edges — own implementation for the parcel
// import (ROADMAP 101-03: several neighbouring cadastral parcels → ONE plot boundary). Not a
// general boolean library: it handles exactly the cadastral case and says plainly when the
// input is something else (gap, overlap, corner-only contact, enclosed hole) instead of guessing.
//
// Method (edge cancellation):
//  1. clean each ring (closing duplicate, repeated points), orient all counter-clockwise;
//  2. snap vertices of different polygons that lie within `toleranz` to one point;
//  3. split edges at vertices of other polygons lying on them (T-junctions);
//  4. reject proper edge crossings (= overlap);
//  5. directed edges: an edge shared by two polygons appears once in each direction and
//     cancels; the same edge twice in the same direction = overlap;
//  6. chain the remaining edges into rings: one ring = the union; several outer rings = the
//     parcels do not hang together (gap); an inner ring = a hole enclosed by the parcels;
//     a vertex with two outgoing edges = parcels touch only at a corner;
//  7. area check: union area must equal the sum of the parts (else one lies inside another);
//  8. collinear vertices (left over from the shared edges) removed.
//
// In:  polygons as [{x, y}] in any consistent unit (canvas px, metres), tolerance in the same unit.
// Out: {ok: true, polygon, flaeche, summe} or {ok: false, grund, …details}. Never throws.
// Pure module, node-testable.

/**
 * @typedef {{x: number, y: number}} VPunkt
 * @typedef {{ok: true, polygon: VPunkt[], flaeche: number, summe: number}
 *   | {ok: false, grund: 'leer'|'ungueltig'|'ueberlappung'|'luecke'|'punktberuehrung'|'loch',
 *      index?: number, flaeche?: number, summe?: number, abstand?: number|null, teile?: number}} VErgebnis
 *   flaeche/summe in squared input units; abstand = smallest distance between the separate
 *   parts (input units) for grund 'luecke'; index = offending input polygon for 'ungueltig'
 */

/** Signed area (Shoelace), positive = counter-clockwise in a y-up system. */
function vorzeichenFlaeche(/** @type {VPunkt[]} */ p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

/** Distance of point p to segment a–b and the segment parameter of the foot point. */
function lotAbstand(/** @type {VPunkt} */ p, /** @type {VPunkt} */ a, /** @type {VPunkt} */ b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const u = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  const k = Math.max(0, Math.min(1, u));
  return { d: Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy)), u };
}

/** Do segments a–b and c–d cross in their interiors (not at or near an endpoint)? */
function echterSchnitt(/** @type {VPunkt} */ a, /** @type {VPunkt} */ b, /** @type {VPunkt} */ c, /** @type {VPunkt} */ d, /** @type {number} */ tol) {
  const kreuz = (/** @type {VPunkt} */ o, /** @type {VPunkt} */ p, /** @type {VPunkt} */ q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = kreuz(c, d, a), d2 = kreuz(c, d, b), d3 = kreuz(a, b, c), d4 = kreuz(a, b, d);
  if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) || !((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return false;
  // Crossing point near an endpoint = touching within tolerance, handled by snapping/splitting.
  for (const [p, s, e] of [[a, c, d], [b, c, d], [c, a, b], [d, a, b]]) if (lotAbstand(p, s, e).d <= tol) return false;
  return true;
}

/** Point in polygon (ray casting); points on the edge may go either way — callers check the edge distance. */
function punktIn(/** @type {VPunkt[]} */ poly, /** @type {VPunkt} */ p) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) innen = !innen;
  }
  return innen;
}

const bbox = (/** @type {VPunkt[]} */ p) => p.reduce((r, q) => ({ x0: Math.min(r.x0, q.x), y0: Math.min(r.y0, q.y), x1: Math.max(r.x1, q.x), y1: Math.max(r.y1, q.y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const bboxBeruehrt = (/** @type {any} */ a, /** @type {any} */ b, /** @type {number} */ t) => a.x0 <= b.x1 + t && b.x0 <= a.x1 + t && a.y0 <= b.y1 + t && b.y0 <= a.y1 + t;

/**
 * Cleaned ring: finite points, closing duplicate and repeated points removed.
 * @param {any} poly raw polygon
 * @param {number} tol point identity, input units
 * @returns {VPunkt[]|null} null when fewer than 3 distinct points or zero area
 */
function bereinigen(poly, tol) {
  if (!Array.isArray(poly)) return null;
  /** @type {VPunkt[]} */
  const p = [];
  for (const q of poly) {
    const x = Number(q?.x), y = Number(q?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!p.length || Math.hypot(p[p.length - 1].x - x, p[p.length - 1].y - y) > tol) p.push({ x, y });
  }
  if (p.length > 2 && Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) <= tol) p.pop();
  if (p.length < 3 || Math.abs(vorzeichenFlaeche(p)) <= tol * tol) return null;
  return p;
}

/**
 * Removes vertices lying on the straight line between their neighbours (within tol).
 * @param {VPunkt[]} ring
 * @param {number} tol input units
 * @returns {VPunkt[]}
 */
function kollinearEntfernen(ring, tol) {
  let r = ring.slice();
  let geaendert = true;
  while (geaendert && r.length > 3) {
    geaendert = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const { d, u } = lotAbstand(b, a, c);
      if (d <= tol && u > 0 && u < 1) { r.splice(i, 1); geaendert = true; i--; }
    }
  }
  return r;
}

/**
 * Union of touching simple polygons into one outline.
 * A single valid polygon is returned unchanged (cleaned) — no rounding, no reordering.
 * @param {Array<Array<{x: number, y: number}>>} polygone polygons, any orientation, open or closed rings
 * @param {{toleranz?: number}} [opt] toleranz = distance under which two points are the same /
 *   a point lies on an edge, in input units (default 1e-6)
 * @returns {VErgebnis}
 */
export function vereinigePolygone(polygone, { toleranz = 1e-6 } = {}) {
  const tol = Math.max(Number(toleranz) || 0, 1e-12);
  const liste = Array.isArray(polygone) ? polygone : [];
  if (!liste.length) return { ok: false, grund: "leer" };
  /** @type {VPunkt[][]} */
  const ringe = [];
  for (let i = 0; i < liste.length; i++) {
    const r = bereinigen(liste[i], tol);
    if (!r) return { ok: false, grund: "ungueltig", index: i };
    ringe.push(r);
  }
  const summe = ringe.reduce((s, r) => s + Math.abs(vorzeichenFlaeche(r)), 0);
  if (ringe.length === 1) return { ok: true, polygon: ringe[0], flaeche: summe, summe };

  // 1. counter-clockwise (y-up sense) for every ring.
  const ccw = ringe.map((r) => (vorzeichenFlaeche(r) < 0 ? r.slice().reverse() : r));

  // 2. snap: a common representative per point cluster (grid hash, cell = 2·tol).
  /** @type {VPunkt[]} */
  const vertices = [];
  /** @type {Map<string, number[]>} */
  const gitter = new Map();
  const zelle = 2 * tol;
  const schluessel = (/** @type {number} */ gx, /** @type {number} */ gy) => `${gx},${gy}`;
  const finde = (/** @type {VPunkt} */ p) => {
    const gx = Math.floor(p.x / zelle), gy = Math.floor(p.y / zelle);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of gitter.get(schluessel(gx + dx, gy + dy)) || []) {
        if (Math.hypot(vertices[id].x - p.x, vertices[id].y - p.y) <= tol) return id;
      }
    }
    const id = vertices.length;
    vertices.push({ x: p.x, y: p.y });
    const k = schluessel(gx, gy);
    if (!gitter.has(k)) gitter.set(k, []);
    /** @type {number[]} */ (gitter.get(k)).push(id);
    return id;
  };
  /** @type {number[][]} */
  let idRinge = ccw.map((r) => {
    /** @type {number[]} */
    const ids = [];
    for (const p of r) { const id = finde(p); if (ids[ids.length - 1] !== id) ids.push(id); }
    if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    return ids;
  });
  for (let i = 0; i < idRinge.length; i++) if (idRinge[i].length < 3) return { ok: false, grund: "ungueltig", index: i };
  const boxen = idRinge.map((ids) => bbox(ids.map((id) => vertices[id])));

  // 3. T-junctions: insert vertices of other rings that lie on an edge.
  idRinge = idRinge.map((ids, ri) => {
    const fremd = new Set();
    idRinge.forEach((andere, rj) => { if (rj !== ri && bboxBeruehrt(boxen[ri], boxen[rj], tol)) andere.forEach((id) => fremd.add(id)); });
    /** @type {number[]} */
    const neu = [];
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k], b = ids[(k + 1) % ids.length];
      neu.push(a);
      /** @type {Array<{id: number, u: number}>} */
      const auf = [];
      for (const id of fremd) {
        if (id === a || id === b) continue;
        const { d, u } = lotAbstand(vertices[id], vertices[a], vertices[b]);
        if (d <= tol && u > 0 && u < 1) auf.push({ id, u });
      }
      auf.sort((p, q) => p.u - q.u).forEach((x) => neu.push(x.id));
    }
    return neu;
  });

  // 4. proper crossings between edges of different rings = overlap.
  for (let i = 0; i < idRinge.length; i++) for (let j = i + 1; j < idRinge.length; j++) {
    if (!bboxBeruehrt(boxen[i], boxen[j], tol)) continue;
    const ri = idRinge[i], rj = idRinge[j];
    for (let a = 0; a < ri.length; a++) for (let b = 0; b < rj.length; b++) {
      if (echterSchnitt(vertices[ri[a]], vertices[ri[(a + 1) % ri.length]], vertices[rj[b]], vertices[rj[(b + 1) % rj.length]], tol)) {
        return { ok: false, grund: "ueberlappung", summe, flaeche: undefined };
      }
    }
  }

  // 4b. a vertex strictly inside another ring (not on its edge) = overlap, e.g. one parcel
  //     drawn inside another — without crossings this would otherwise look like a gap.
  for (let i = 0; i < idRinge.length; i++) for (let j = 0; j < idRinge.length; j++) {
    if (i === j || !bboxBeruehrt(boxen[i], boxen[j], tol)) continue;
    const huelle = idRinge[j].map((id) => vertices[id]);
    for (const id of idRinge[i]) {
      const p = vertices[id];
      if (!punktIn(huelle, p)) continue;
      let naheKante = false;
      for (let e = 0; e < huelle.length && !naheKante; e++) naheKante = lotAbstand(p, huelle[e], huelle[(e + 1) % huelle.length]).d <= tol;
      if (!naheKante) return { ok: false, grund: "ueberlappung", summe };
    }
  }

  // 5. directed edges, shared edges cancel.
  /** @type {Map<string, number>} */
  const zahl = new Map();
  for (const ids of idRinge) for (let k = 0; k < ids.length; k++) {
    const key = `${ids[k]}>${ids[(k + 1) % ids.length]}`;
    zahl.set(key, (zahl.get(key) || 0) + 1);
  }
  /** @type {Map<number, number[]>} */
  const ausgang = new Map();
  for (const [key, n] of zahl) {
    if (n > 1) return { ok: false, grund: "ueberlappung", summe };
    const [a, b] = key.split(">").map(Number);
    if (zahl.get(`${b}>${a}`)) continue; // shared edge: both directions cancel
    if (!ausgang.has(a)) ausgang.set(a, []);
    /** @type {number[]} */ (ausgang.get(a)).push(b);
  }
  for (const ziele of ausgang.values()) if (ziele.length > 1) return { ok: false, grund: "punktberuehrung", summe };

  // 6. chain into rings.
  /** @type {VPunkt[][]} */
  const ergebnisRinge = [];
  const besucht = new Set();
  for (const start of ausgang.keys()) {
    if (besucht.has(start)) continue;
    /** @type {VPunkt[]} */
    const ring = [];
    let v = start;
    while (!besucht.has(v)) {
      besucht.add(v);
      ring.push(vertices[v]);
      const n = ausgang.get(v);
      if (!n) break;
      v = n[0];
    }
    if (ring.length >= 3) ergebnisRinge.push(ring);
  }
  const aussen = ergebnisRinge.filter((r) => vorzeichenFlaeche(r) > 0);
  const innen = ergebnisRinge.filter((r) => vorzeichenFlaeche(r) <= 0);
  if (aussen.length > 1) {
    // Smallest vertex-to-edge distance between the first part and every other one (input units).
    let abstand = Infinity;
    for (let k = 1; k < aussen.length; k++) {
      for (const p of aussen[0]) for (let e = 0; e < aussen[k].length; e++) abstand = Math.min(abstand, lotAbstand(p, aussen[k][e], aussen[k][(e + 1) % aussen[k].length]).d);
      for (const p of aussen[k]) for (let e = 0; e < aussen[0].length; e++) abstand = Math.min(abstand, lotAbstand(p, aussen[0][e], aussen[0][(e + 1) % aussen[0].length]).d);
    }
    return { ok: false, grund: "luecke", teile: aussen.length, abstand: Number.isFinite(abstand) ? abstand : null, summe };
  }
  if (innen.length) return { ok: false, grund: "loch", summe };
  if (aussen.length !== 1) return { ok: false, grund: "ueberlappung", summe };

  // 7. area check: a ring inside another one cancels nothing but hides area.
  const flaeche = Math.abs(vorzeichenFlaeche(aussen[0]));
  // Snapping moves points by up to tol, which changes areas by at most perimeter × tol.
  const umfang = ringe.reduce((s, r) => s + r.reduce((u, p, i) => u + Math.hypot(r[(i + 1) % r.length].x - p.x, r[(i + 1) % r.length].y - p.y), 0), 0);
  const flaechenTol = Math.max(1e-9 * summe, tol * umfang);
  if (Math.abs(flaeche - summe) > flaechenTol) return { ok: false, grund: "ueberlappung", flaeche, summe };

  // 8. vertices left on straight lines by the shared edges.
  return { ok: true, polygon: kollinearEntfernen(aussen[0], tol), flaeche, summe };
}
