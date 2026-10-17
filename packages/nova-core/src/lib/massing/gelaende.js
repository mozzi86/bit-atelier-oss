// Sandbox terrain for the Massing Studio (phase 98-06, user brief 17.10.2026: "mesh … sandbox
// tools", like SketchUp's Sandbox). A regular height grid in site metres; tools raise/lower with a
// soft (cosine) falloff, smooth, and stamp a body footprint flat to its base level — every edit
// reports the earth volumes it moved (cut/fill in m³), the number a planner needs for costs.
//
// Grid: nx × ny nodes, spacing `zelle` m, origin (x0, y0) = site metres of node (0,0), heights
// `h` row-major in m (relative to ±0). Values are rounded to cm when saved.
//
// In: grid objects, points/radii in m. Out: NEW grid objects, volumes. Pure, no DOM.

/** @typedef {{nx: number, ny: number, zelle: number, x0: number, y0: number, h: number[]}} Gelaende */

const cm = (v) => Math.round(v * 100) / 100;
/** Upper limit of nodes [ASSUMED] — keeps the layer well below the 256 KB record rule (speicherOrt). */
export const MAX_KNOTEN = 20000;

/**
 * Flat terrain covering `breite` × `tiefe` m from (x0, y0).
 * @param {number} breite m
 * @param {number} tiefe m
 * @param {{zelle?: number, x0?: number, y0?: number, hoehe?: number}} [opt] zelle default 1 m
 * @returns {Gelaende}
 */
export function leeresGelaende(breite, tiefe, { zelle = 1, x0 = 0, y0 = 0, hoehe = 0 } = {}) {
  if (!(breite > 0 && tiefe > 0 && zelle > 0)) throw new Error("Gelände braucht Breite, Tiefe und Zellgröße > 0");
  const nx = Math.floor(breite / zelle) + 1, ny = Math.floor(tiefe / zelle) + 1;
  if (nx * ny > MAX_KNOTEN) throw new Error(`Gelände zu fein: ${nx * ny} Punkte (höchstens ${MAX_KNOTEN}) — größere Zellen wählen`);
  return { nx, ny, zelle, x0, y0, h: new Array(nx * ny).fill(hoehe) };
}

/** Height at a site point (bilinear; outside the grid = nearest edge). */
export function hoeheAn(g, p) {
  const fx = Math.max(0, Math.min(g.nx - 1, (p.x - g.x0) / g.zelle)), fy = Math.max(0, Math.min(g.ny - 1, (p.y - g.y0) / g.zelle));
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fy));
  const u = fx - i, v = fy - j, H = (a, b) => g.h[b * g.nx + a];
  if (g.nx < 2 || g.ny < 2) return g.h[0] || 0;
  return (1 - u) * (1 - v) * H(i, j) + u * (1 - v) * H(i + 1, j) + (1 - u) * v * H(i, j + 1) + u * v * H(i + 1, j + 1);
}

/** Node coordinates of index k. */
const knoten = (g, k) => ({ x: g.x0 + (k % g.nx) * g.zelle, y: g.y0 + Math.floor(k / g.nx) * g.zelle });

/**
 * Earth volumes between two states of the same grid (m³): each node stands for one cell area
 * (zelle²) [ASSUMED node-area method, accurate enough for massing studies].
 * @returns {{abtrag: number, auftrag: number}} cut (terrain lowered) and fill (raised)
 */
export function erdmassen(vorher, nachher) {
  let abtrag = 0, auftrag = 0;
  const a = vorher.zelle * vorher.zelle;
  for (let k = 0; k < vorher.h.length; k++) {
    const d = (nachher.h[k] ?? 0) - (vorher.h[k] ?? 0);
    if (d > 0) auftrag += d * a; else abtrag -= d * a;
  }
  return { abtrag: Math.round(abtrag * 100) / 100, auftrag: Math.round(auftrag * 100) / 100 };
}

/** Soft falloff 1 → 0 from the centre to the radius (cosine). */
const abfall = (d, r) => (d >= r ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / r)));

/**
 * Raise (delta > 0) or lower (delta < 0) around a point with a soft edge.
 * @param {Gelaende} g
 * @param {{x: number, y: number}} p
 * @param {number} radius m
 * @param {number} delta m at the centre
 * @returns {Gelaende}
 */
export function formen(g, p, radius, delta) {
  return { ...g, h: g.h.map((h, k) => { const q = knoten(g, k); return cm(h + delta * abfall(Math.hypot(q.x - p.x, q.y - p.y), radius)); }) };
}

/**
 * Smooth around a point: each node moves towards the mean of its neighbours, weighted by the
 * falloff and `staerke` (0..1).
 */
export function glaetten(g, p, radius, staerke = 0.5) {
  const s = Math.max(0, Math.min(1, staerke));
  return {
    ...g,
    h: g.h.map((h, k) => {
      const q = knoten(g, k), w = abfall(Math.hypot(q.x - p.x, q.y - p.y), radius) * s;
      if (!w) return h;
      const i = k % g.nx, j = Math.floor(k / g.nx), nb = [];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < g.nx && b < g.ny) nb.push(g.h[b * g.nx + a]); }
      const mittel = nb.reduce((x, y) => x + y, 0) / nb.length;
      return cm(h + (mittel - h) * w);
    }),
  };
}

/** Point in polygon (even-odd). */
function innen(poly, p) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

/**
 * Stamp a footprint: nodes inside the polygon are set to `hoehe` (the body's base) — the
 * building pad; returns the new grid and the volumes moved.
 * @param {Gelaende} g
 * @param {Array<{x: number, y: number}>} profil
 * @param {number} hoehe m
 * @returns {{gelaende: Gelaende, abtrag: number, auftrag: number}}
 */
export function stempeln(g, profil, hoehe) {
  const neu = { ...g, h: g.h.map((h, k) => (innen(profil, knoten(g, k)) ? cm(hoehe) : h)) };
  return { gelaende: neu, ...erdmassen(g, neu) };
}
