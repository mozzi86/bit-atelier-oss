// 107-11 (spec II.6 a–d, BK-52…55; decisions D-BK-13, D-BK-14): rooms of the BIM studio — the ONE room detection from walls,
// the measuring rule and net area of a room, the DIN 277 areas per storey and the room boundaries for the IFC export.
// Pure 2D geometry on formGeometrie.js (convex half-plane primitives), no CSG, no React, no I/O.
//
// Two directions, never mixed:
//  - Wall → room (this file): the zone tool of the BIM studio used to find the enclosed room around a click with its own ray
//    function `detectRoom` (BitBimStudio.jsx until 107-11). It moved here unchanged as raumErkennen() — the click still calls only
//    this function — and is extended by raeumeAusWaenden(): ALL rooms of one storey as PROPOSALS (planar graph of the wall
//    reference lines, minimal cycles, inner faces from the wall bodies of referenz.js). The user takes a proposal over as a
//    `customZones` record; nothing is written silently (D-BW-03, leitplanke 5). There is no second, parallel room detection.
//  - Room → wall (the workshop, werkstattBauteile.js, D-BW-02): zones are the truth, walls are derived. Untouched here.
//
// Measuring rule (`messregel` of a zone, optional): "innenkante" (default, fits D-BW-02: the zone polygon IS the clear room)
// or "referenzlinie" (the polygon was drawn on the wall reference lines; the wall bodies inside it are not floor area).
// Net area (`flaeche_netto_m2`): the zone polygon minus the column squares (`customColumns`, size² m²) and minus overlapping
// stair/lift zones (raumart "treppenraum"/"aufzug") of the same storey, with "referenzlinie" also minus the wall bodies. The
// stored polygon and its area `flaeche_m2` stay unchanged (goldens; the vector plan keeps the shoelace of the drawn polygon).
//
// DIN 277 (din277Flaechen): per storey BGF, KGF, NGF, NUF, VF, TF with BGF = KGF + NGF and NGF = NUF + VF + TF (3 decimals).
// Basements (D-BK-20, 107-13 assigns their area to this plan): every level of ebenenListe(model) is a row of its own, the sums
// are reported above ground, below ground and in total. Readers: the DIN 277 table of the BIM studio (ebenenListe(model), walls,
// columns, drawn zones) and the massing NUF (kennzahlen.js nufFuerKennzahlen, per storey: zones → DIN 277, no zones → 80 %).
// programMetrics.ngf (useBuildingProgram.js) stays the flat 80 % above ground for every other planner.
//
// Coordinates: plan points {x, z} in m (the BIM studio frame), areas in m², levels are integers (negative = basement).
// In:  wall records ({a, b, level, thickness | composite, refLine, raumbegrenzend}) or entries {schluessel, wand}, zones
//      ({points, level, raumart, use, din277_gruppe, messregel}), columns ({x, z, level, size}), the footprint, the storey levels.
// Out: polygons, areas, wall keys and messages (codes with data; the UI words them through i18n, meldungText()).

import { flaeche, flaecheSigniert, inKonvex, ohneKonvex, zerlegeInDreiecke } from "../formGeometrie.js";
import { wandGeometrie, eckfueller } from "./referenz.js";
// verschneidung.js (the layer bands of 107-09) is NOT imported here: it stays lazily loaded (107-09 E2E guard: nothing of the
// intersection is requested while the switch is off). din277Flaechen takes its `baender` function as an optional parameter.

/**
 * DIN 277 usage groups → usage types of the room programme (USES in spaceProgram.js). Moved here from
 * designer/lib/bestandsProgramm.js in 107-11 (@core may not import @designer); bestandsProgramm.js re-exports it, every old import stays valid.
 *
 * IMPORTANT for group 1: it is called "Wohnen und Aufenthalt" by the standard and also covers pure common rooms (break, waiting,
 * social rooms). Mapping it to `wohnen` made every office building look like a housing project (finding of the user on 26.08.);
 * it is mapped to `gemeinschaft` and labelled "Aufenthalt (NUF 01)" in the UI.
 * @type {Record<string, {use: string, label: string}>}
 */
export const DIN277_ZU_NUTZUNG = {
  "01": { use: "gemeinschaft", label: "Aufenthalt (NUF 01)" },
  "02": { use: "buero", label: "Büroarbeit (NUF 02)" },
  "03": { use: "gewerbe", label: "Produktion / Werkstatt (NUF 03)" },
  "04": { use: "handel", label: "Lagern / Verkaufen (NUF 04)" },
  "05": { use: "gemeinschaft", label: "Bildung / Kultur (NUF 05)" },
  "06": { use: "gemeinschaft", label: "Heilen / Pflegen (NUF 06)" },
  "07": { use: "gemeinschaft", label: "Sonstige Nutzung (NUF 07)" },
  "08": { use: "technik", label: "Technikfläche (TF 08)" },
  "09": { use: "technik", label: "Verkehrsfläche (VF 09)" },
};

/** Measuring rules of a room (`messregel`); the first one is the default. */
export const MESSREGELN = Object.freeze(["innenkante", "referenzlinie"]);

/** Default measuring rule: the zone polygon is the clear room (D-BW-02). */
export const STANDARD_MESSREGEL = "innenkante";

/**
 * Smallest room area in m² a detection reports. [ASSUMED] 0.5 m² = the threshold of the old click detection (BitBimStudio.jsx
 * `polyAreaXZ(poly) > 0.5` until 107-11); smaller closed cells are wall junctions, not rooms. Way to a proven value: misses on real plans.
 */
export const MIN_RAUMFLAECHE_M2 = 0.5;

/**
 * Distance in m under which two wall end points count as one node of the room graph, and the margin an end may lie outside a
 * wall body and still join it. [ASSUMED] 2 cm: the drawing tools round to mm and snap ends onto end points, axes and faces, so a
 * real joint lies far closer; a larger value would close gaps the user left on purpose. Way to a proven value: misses on real plans.
 */
export const KNOTEN_TOLERANZ_M = 0.02;

/**
 * Largest distance in m between two open chain ends that is reported as a GAP ("Spalt") between them instead of two separate open
 * ends. [ASSUMED] 2.0 m (a door gap left open in the wall line is narrower); only the wording of the message depends on it.
 */
export const SPALT_MAX_M = 2.0;

/**
 * Match tolerance of vorschlagVorhanden(): a zone counts as the taken-over proposal when its polygon area differs from the proposal's
 * inner or reference-line area by at most max(VORSCHLAG_TOL_M2, VORSCHLAG_TOL_ANTEIL × area). [ASSUMED] 0.05 m² / 1 %: the takeover
 * copies the polygon to the mm, so a real match differs by rounding only; a zone redrawn by hand around the same room differs more and
 * is then not marked (the user sees the proposal again). Way to a proven value: misses on real plans.
 */
export const VORSCHLAG_TOL_M2 = 0.05;
/** [ASSUMED] relative part of the match tolerance, unit 1 (see VORSCHLAG_TOL_M2). */
export const VORSCHLAG_TOL_ANTEIL = 0.01;

/**
 * Room boundary (grenzWaende): largest sine of the angle between a room edge and a wall axis that still counts as parallel, unit 1.
 * [ASSUMED] 0.02 (about 1.1°): drawn points are rounded to the mm, so a wall of 1 m drawn "parallel" deviates far less; a room edge at a
 * real angle to the wall must not bound it. Way to a proven value: IFC viewer check on real plans.
 */
export const GRENZE_PARALLEL_SIN = 0.02;
/**
 * Room boundary: smallest length in m a room edge must run along a wall body before the wall bounds the room. [ASSUMED] 0.05 m (the
 * corner overlap of two walls meeting at a room corner is up to half a wall thickness, a real boundary is longer than a few cm).
 * Way to a proven value: IFC viewer check on real plans.
 */
export const GRENZE_MIN_LAENGE_M = 0.05;

/** raumart values of a shaft that is cut out of the room it overlaps (stair, lift). */
export const SCHACHT_RAUMARTEN = Object.freeze(["treppenraum", "aufzug"]);

/**
 * raumart values that count as circulation area (VF, DIN 277 group 09). [ASSUMED] corridor, stair and lift — the circulation zones
 * of the workshop (tesselierung: Flur, Treppenraum, Aufzug); DIN 277:2016 also lists ramps and escalators, which the app has no
 * raumart for. Way to a proven value: a room catalogue with DIN 277 groups per raumart.
 */
export const VF_RAUMARTEN = Object.freeze(["flur", "treppenraum", "aufzug"]);

/** Old wording of the click detection (BitBimStudio.jsx until 107-11), kept as the message of raumBeiKlick(). */
export const MELDUNG_KEIN_RAUM = "Kein geschlossener Raum erkannt — in eine von Wänden umschlossene Fläche klicken.";

const EPS = 1e-9;

/**
 * Half-planes of a convex polygon (any orientation): the inside is n·p ≤ c for every edge. Same rule as verschneidung.js
 * halbebenenVon (kept here so this module does not pull the lazily loaded intersection module onto the studio's path).
 * @param {Array<{x: number, z: number}>} poly convex polygon, m
 * @returns {Array<{nx: number, nz: number, c: number}>}
 */
function halbebenenVon(poly) {
  const sg = flaecheSigniert(poly) >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ez = q.z - p.z;
    const l = Math.hypot(ex, ez);
    if (l < 1e-12) continue;
    const nx = (sg * ez) / l, nz = (-sg * ex) / l;
    out.push({ nx, nz, c: nx * p.x + nz * p.z });
  }
  return out;
}
/** @param {number} v @returns {number} m / m², 3 decimals */
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
/** @param {unknown} v @param {number} [d] @returns {number} */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * @typedef {{x: number, z: number}} P
 * @typedef {{nx: number, nz: number, c: number}} Halbebene  n·p ≤ c
 * @typedef {object} RaumMeldung
 * @property {"kette-offen"|"spalt"|"raum-zu-klein"|"zonen-ueber-ngf"|"insel"} code
 * @property {P} [punkt]          open chain end (m)
 * @property {P[]} [punkte]       the two ends of a gap (m)
 * @property {number} [breite_m]  width of a gap in m
 * @property {string} [schluessel] wall key of the open end
 * @property {number} [level]
 * @property {number} [flaeche_m2]
 * @typedef {object} RaumVorschlag
 * @property {number} level
 * @property {P[]} punkte                    inner faces of the walls (messregel "innenkante"), m
 * @property {P[]} punkte_referenzlinie      the cycle on the wall reference lines, m
 * @property {number} flaeche_m2             area of `punkte`, m²
 * @property {number} flaeche_referenzlinie_m2 area of `punkte_referenzlinie`, m²
 * @property {string[]} waende               keys of the walls that bound the room
 * @property {"abgeleitet"} quelle           derived, never stored without the user (D-BW-03)
 * @property {boolean} [insel]               a free-standing group of walls lies inside the room and is NOT cut out of it
 * @typedef {object} Din277Zeile  DIN 277 areas in m² (3 decimals)
 * @property {number} bgf  Brutto-Grundfläche
 * @property {number} kgf  Konstruktions-Grundfläche
 * @property {number} ngf  Netto-Raumfläche (NRF in DIN 277:2016; NGF in the app's wording)
 * @property {number} nuf  Nutzungsfläche
 * @property {number} vf   Verkehrsfläche
 * @property {number} tf   Technikfläche
 */

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Click detection (moved unchanged from BitBimStudio.jsx detectRoom / raySegT / polyAreaXZ)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Ray o + t·d against segment a–b: the smallest t > 0, or Infinity.
 * @param {P} o ray origin, m
 * @param {P} d ray direction (unit vector)
 * @param {P} a segment start, m
 * @param {P} b segment end, m
 * @returns {number} distance in m along d (Infinity without a hit)
 */
export function raySegT(o, d, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z;
  const det = ex * d.z - d.x * ez;
  if (Math.abs(det) < 1e-9) return Infinity;
  const wx = a.x - o.x, wz = a.z - o.z;
  const t = (-wx * ez + ex * wz) / det;
  const s = (d.x * wz - d.z * wx) / det;
  return (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) ? t : Infinity;
}

/**
 * Area of a plan polygon (shoelace), m².
 * @param {P[]} pts
 * @returns {number} m²
 */
export function polyAreaXZ(pts) {
  return Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
}

/**
 * Room around a point from wall segments (the click of the zone tool): 120 rays all round, each to the nearest segment, pulled
 * slightly into the wall (min(0.12 m, 4 % of the distance)), then collinear and too close points dropped and the corners rounded to
 * 5 cm. More than 12 % of the rays without a hit within `maxR` = not closed. Unchanged from BitBimStudio.jsx detectRoom (until 107-11);
 * the axis-based pull is why raeumeAusWaenden() measures on the wall bodies instead.
 * @param {P} p click point, m
 * @param {Array<[P, P]>} segments wall axes [a, b], m
 * @param {number} [maxR] search radius in m (default 80)
 * @returns {P[]|null} room polygon in m, or null when the room is not closed
 */
export function raumErkennen(p, segments, maxR = 80) {
  const N = 120, raw = []; let openHits = 0;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const d = { x: Math.cos(ang), z: Math.sin(ang) };
    let best = maxR;
    for (const [a, b] of segments) { const t = raySegT(p, d, a, b); if (t < best) best = t; }
    if (best >= maxR - 1e-3) openHits++;
    const pull = Math.min(0.12, best * 0.04); // slightly inwards (into the wall)
    raw.push({ x: p.x + d.x * (best - pull), z: p.z + d.z * (best - pull) });
  }
  if (openHits > N * 0.12) return null; // not closed
  // drop collinear / too close points → clean corners
  let pts = raw.filter((q, i) => { const r = raw[(i + 1) % raw.length]; return Math.hypot(q.x - r.x, q.z - r.z) > 0.08; });
  const keep = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 0.05) keep.push({ x: Math.round(b.x / 0.05) * 0.05, z: Math.round(b.z / 0.05) * 0.05 });
  }
  return keep.length >= 3 ? keep : null;
}

/**
 * The click of the zone tool as one call: the detected polygon when it encloses more than MIN_RAUMFLAECHE_M2, else the old message.
 * @param {P} p click point, m
 * @param {Array<[P, P]>} segments wall axes of the storey, m
 * @returns {{punkte: P[]|null, meldung: string|null}}
 */
export function raumBeiKlick(p, segments) {
  const poly = raumErkennen(p, segments);
  return poly && polyAreaXZ(poly) > MIN_RAUMFLAECHE_M2 ? { punkte: poly, meldung: null } : { punkte: null, meldung: MELDUNG_KEIN_RAUM };
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2. Room proposals of a storey (planar graph of the reference lines, minimal cycles)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} GraphWand  one wall of the room graph
 * @property {string} schluessel
 * @property {P} a                reference line start (after snapping), m
 * @property {P} b                reference line end, m
 * @property {P} d                unit direction a→b of the ORIGINAL wall
 * @property {P} n                unit normal (−dz, dx) of the original wall
 * @property {number} lo          body from the reference line along n: lower bound, m (≤ 0)
 * @property {number} hi          upper bound, m (≥ 0)
 * @property {number} L           length of the original reference line, m
 * @property {P} a0               original start, m
 */

/**
 * Normalises a wall input: a record or an entry {schluessel, wand}.
 * @param {any} e
 * @param {number} i index
 * @returns {{schluessel: string, wand: any}}
 */
function wandEintrag(e, i) {
  return e && e.wand && typeof e.wand === "object" ? { schluessel: e.schluessel ? String(e.schluessel) : `w${i}`, wand: e.wand } : { schluessel: `w${i}`, wand: e };
}

/** @param {P} a @param {P} b @returns {number} */
const abstand = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Walls of one storey that bound rooms (`raumbegrenzend` !== false), with their body extent across the reference line.
 * @param {any[]} waende
 * @param {number} level
 * @returns {GraphWand[]}
 */
function graphWaende(waende, level) {
  /** @type {GraphWand[]} */
  const out = [];
  (Array.isArray(waende) ? waende : []).forEach((e, i) => {
    const { schluessel, wand: w } = wandEintrag(e, i);
    if (!w?.a || !w?.b || Math.round(num(w.level)) !== level || w.raumbegrenzend === false) return;
    const L = abstand(w.a, w.b);
    if (L < 1e-6) return;
    const g = wandGeometrie(w);
    const h = g.dicke_m / 2;
    out.push({ schluessel, a: { x: w.a.x, z: w.a.z }, b: { x: w.b.x, z: w.b.z }, d: g.richtung, n: g.normale, lo: g.versatz_m - h, hi: g.versatz_m + h, L, a0: { x: w.a.x, z: w.a.z } });
  });
  return out;
}

/**
 * Moves an end point onto the wall it joins: onto an end point of another wall within KNOTEN_TOLERANZ_M, else onto the reference
 * line of another wall whose body (plus the tolerance) contains it — a wall drawn up to the FACE of a wall is joined to its line.
 * @param {P} p end point, m
 * @param {GraphWand} selbst
 * @param {GraphWand[]} alle
 * @returns {P} m
 */
function endeAnschliessen(p, selbst, alle) {
  for (const W of alle) {
    if (W === selbst) continue;
    for (const q of [W.a, W.b]) if (abstand(p, q) <= KNOTEN_TOLERANZ_M) return { x: q.x, z: q.z };
  }
  let best = null, bestD = Infinity;
  for (const W of alle) {
    if (W === selbst) continue;
    const vx = p.x - W.a0.x, vz = p.z - W.a0.z;
    const t = vx * W.d.x + vz * W.d.z;
    const s = vx * W.n.x + vz * W.n.z;
    if (t < -KNOTEN_TOLERANZ_M || t > W.L + KNOTEN_TOLERANZ_M) continue;
    if (s < W.lo - KNOTEN_TOLERANZ_M || s > W.hi + KNOTEN_TOLERANZ_M) continue;
    if (Math.abs(s) < bestD) {
      bestD = Math.abs(s);
      const tk = Math.max(0, Math.min(W.L, t));
      best = { x: W.a0.x + W.d.x * tk, z: W.a0.z + W.d.z * tk };
    }
  }
  return best || p;
}

/**
 * Parameters (0 … 1) along segment a–b where the other segments cross or touch it (end points of the others included).
 * @param {P} a @param {P} b @param {Array<{a: P, b: P}>} andere
 * @returns {number[]}
 */
function schnittParameter(a, b, andere) {
  const ex = b.x - a.x, ez = b.z - a.z;
  const L2 = ex * ex + ez * ez;
  /** @type {number[]} */
  const ts = [0, 1];
  for (const o of andere) {
    const fx = o.b.x - o.a.x, fz = o.b.z - o.a.z;
    const det = ex * fz - ez * fx;
    if (Math.abs(det) < 1e-12) {
      // collinear overlap: the end points of the other segment that lie on this one
      for (const q of [o.a, o.b]) {
        const t = ((q.x - a.x) * ex + (q.z - a.z) * ez) / L2;
        const px = a.x + ex * t - q.x, pz = a.z + ez * t - q.z;
        if (t > 1e-9 && t < 1 - 1e-9 && Math.hypot(px, pz) < 1e-6) ts.push(t);
      }
      continue;
    }
    const wx = o.a.x - a.x, wz = o.a.z - a.z;
    const t = (wx * fz - wz * fx) / det;
    const s = (wx * ez - wz * ex) / det;
    if (t > 1e-9 && t < 1 - 1e-9 && s > -1e-9 && s < 1 + 1e-9) ts.push(t);
  }
  return [...new Set(ts.map((t) => Math.round(t * 1e9) / 1e9))].sort((p, q) => p - q);
}

/**
 * Intersection of two lines p + s·u and q + t·v, m (null when parallel).
 * @param {P} p @param {P} u @param {P} q @param {P} v
 * @returns {P|null}
 */
function linienSchnitt(p, u, q, v) {
  const det = u.x * v.z - u.z * v.x;
  if (Math.abs(det) < 1e-12) return null;
  const s = ((q.x - p.x) * v.z - (q.z - p.z) * v.x) / det;
  return { x: p.x + u.x * s, z: p.z + u.z * s };
}

/** @param {P} p @returns {P} rounded to 1 mm */
const mm = (p) => ({ x: Math.round(p.x * 1000) / 1000 + 0, z: Math.round(p.z * 1000) / 1000 + 0 });

/**
 * All room PROPOSALS of one storey from its walls (D-BK-13, BK-52): a planar graph of the wall reference lines (ends joined within
 * KNOTEN_TOLERANZ_M or onto the body of the wall they meet, crossings split), dangling chains removed, the bounded faces of the graph
 * (the minimal cycles) as candidates. Each candidate is given twice: on the reference lines and on the inner faces of the wall bodies
 * (offset from referenz.js wandGeometrie: thickness from the build-up, reference line side), the latter being the zone polygon of the
 * default measuring rule "innenkante". Walls with `raumbegrenzend: false` are left out (a free-standing partition does not split a
 * room). Open chains and gaps are named, never closed silently. Basements: `level` may be negative (a basement wall belongs to its
 * own storey, never to level 0). A face with a wall that ends inside it (a stub) is still found: the stub is a dangling chain.
 * Limits (named): an island (a group of walls not connected to the walls around it) is not cut out of the room it lies in — the
 * proposal carries `insel: true` and a message "insel" names it (a zone record has no holes); a face that runs twice through one node
 * (a bridge) is skipped.
 * @param {any[]} waende wall records or entries {schluessel, wand} (hull walls `env:<level>:<edge>`, drawn walls `cw:<_idx>`)
 * @param {number} level storey level (integer, negative = basement)
 * @returns {{raeume: RaumVorschlag[], meldungen: RaumMeldung[]}}
 */
export function raeumeAusWaenden(waende, level) {
  const lvl = Math.round(num(level));
  const roh = graphWaende(waende, lvl);
  // 1. ends onto the walls they join
  const segs = roh.map((W) => ({ W, a: endeAnschliessen(W.a, W, roh), b: endeAnschliessen(W.b, W, roh) }))
    .filter((s) => abstand(s.a, s.b) > 1e-6);
  // 2. split at every crossing / touching point
  /** @type {P[]} */
  const knoten = [];
  const knotenVon = (/** @type {P} */ p) => {
    const i = knoten.findIndex((k) => abstand(k, p) <= 1e-5);
    if (i >= 0) return i;
    knoten.push(p);
    return knoten.length - 1;
  };
  /** @type {Map<string, {u: number, v: number, W: GraphWand}>} */
  const kanten = new Map();
  for (const s of segs) {
    const ts = schnittParameter(s.a, s.b, segs.filter((o) => o !== s));
    for (let i = 0; i + 1 < ts.length; i += 1) {
      const p = { x: s.a.x + (s.b.x - s.a.x) * ts[i], z: s.a.z + (s.b.z - s.a.z) * ts[i] };
      const q = { x: s.a.x + (s.b.x - s.a.x) * ts[i + 1], z: s.a.z + (s.b.z - s.a.z) * ts[i + 1] };
      const u = knotenVon(p), v = knotenVon(q);
      if (u === v) continue;
      const k = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (!kanten.has(k)) kanten.set(k, { u, v, W: s.W }); // a doubled collinear wall keeps the first one
    }
  }
  // 3. neighbours; dangling chains removed (their tips are the open ends)
  /** @type {Map<number, Set<number>>} */
  const nach = new Map();
  for (const { u, v } of kanten.values()) {
    if (!nach.has(u)) nach.set(u, new Set());
    if (!nach.has(v)) nach.set(v, new Set());
    /** @type {Set<number>} */ (nach.get(u)).add(v);
    /** @type {Set<number>} */ (nach.get(v)).add(u);
  }
  /** @type {number[]} */
  const offeneEnden = [...nach.entries()].filter(([, s]) => s.size === 1).map(([k]) => k);
  // the full graph before pruning (copy): the gap check below needs the way between two open ends
  /** @type {Map<number, Set<number>>} */
  const nachVoll = new Map([...nach].map(([k, s]) => [k, new Set(s)]));
  let geaendert = true;
  while (geaendert) {
    geaendert = false;
    for (const [k, s] of nach) {
      if (s.size > 1) continue;
      for (const m of s) /** @type {Set<number>} */ (nach.get(m)).delete(k);
      nach.delete(k);
      geaendert = true;
    }
  }
  /** @type {RaumMeldung[]} */
  const meldungen = [];
  const kanteVon = (/** @type {number} */ u, /** @type {number} */ v) => kanten.get(u < v ? `${u}|${v}` : `${v}|${u}`);
  const wandAnEnde = (/** @type {number} */ k) => {
    for (const kn of kanten.values()) if (kn.u === k || kn.v === k) return kn.W.schluessel;
    return undefined;
  };
  // gaps: two open ends close to each other are ONE gap; the others are open chain ends. Two ends joined by walls only count as a gap
  // when closing them would enclose a room (the way between them plus the gap has more than MIN_RAUMFLAECHE_M2): the two ends of one
  // free-standing wall (or of a flat chain) are open ends, not a gap between them.
  const schliesstRaum = (/** @type {number} */ i, /** @type {number} */ j) => {
    /** @type {Map<number, number>} */
    const vor = new Map([[i, i]]);
    const schlange = [i];
    while (schlange.length && !vor.has(j)) {
      const k = /** @type {number} */ (schlange.shift());
      for (const m of /** @type {Set<number>} */ (nachVoll.get(k))) if (!vor.has(m)) { vor.set(m, k); schlange.push(m); }
    }
    if (!vor.has(j)) return true; // two separate wall groups: the gap lies between them
    /** @type {P[]} */
    const weg = [];
    for (let k = j; k !== i; k = /** @type {number} */ (vor.get(k))) weg.push(knoten[k]);
    weg.push(knoten[i]);
    return flaeche(weg) > MIN_RAUMFLAECHE_M2;
  };
  const genutzt = new Set();
  for (const i of offeneEnden) {
    if (genutzt.has(i)) continue;
    let best = -1, bestD = Infinity;
    for (const j of offeneEnden) {
      if (j === i || genutzt.has(j)) continue;
      const dd = abstand(knoten[i], knoten[j]);
      if (dd < bestD && dd <= SPALT_MAX_M && schliesstRaum(i, j)) { bestD = dd; best = j; }
    }
    if (best >= 0 && bestD <= SPALT_MAX_M) {
      genutzt.add(i); genutzt.add(best);
      meldungen.push({ code: "spalt", level: lvl, punkte: [mm(knoten[i]), mm(knoten[best])], breite_m: r3(bestD) });
    }
  }
  for (const i of offeneEnden) if (!genutzt.has(i)) meldungen.push({ code: "kette-offen", level: lvl, punkt: mm(knoten[i]), schluessel: wandAnEnde(i) });
  // connected components of the remaining graph (for the island note)
  /** @type {Map<number, number>} */
  const komponente = new Map();
  for (const start of nach.keys()) {
    if (komponente.has(start)) continue;
    const stapel = [start];
    komponente.set(start, start);
    while (stapel.length) {
      const k = /** @type {number} */ (stapel.pop());
      for (const m of /** @type {Set<number>} */ (nach.get(k))) if (!komponente.has(m)) { komponente.set(m, start); stapel.push(m); }
    }
  }
  // 4. faces: walk every directed edge, keep the face on the left (next = the neighbour clockwise after the way back)
  /** @type {Map<number, number[]>} */
  const sortiert = new Map();
  for (const [k, s] of nach) {
    sortiert.set(k, [...s].sort((p, q) => Math.atan2(knoten[p].z - knoten[k].z, knoten[p].x - knoten[k].x) - Math.atan2(knoten[q].z - knoten[k].z, knoten[q].x - knoten[k].x)));
  }
  const besucht = new Set();
  /** @type {RaumVorschlag[]} */
  const raeume = [];
  for (const [u0, s] of nach) {
    for (const v0 of s) {
      if (besucht.has(`${u0}>${v0}`)) continue;
      /** @type {number[]} */
      const zyklus = [];
      let u = u0, v = v0, schutz = kanten.size * 2 + 2;
      while (!besucht.has(`${u}>${v}`) && schutz-- > 0) {
        besucht.add(`${u}>${v}`);
        zyklus.push(u);
        const liste = /** @type {number[]} */ (sortiert.get(v));
        const i = liste.indexOf(u);
        const w = liste[(i - 1 + liste.length) % liste.length];
        u = v; v = w;
      }
      if (zyklus.length < 3 || new Set(zyklus).size !== zyklus.length) continue; // bridge or degenerate face: skipped (file head)
      const ref = zyklus.map((k) => knoten[k]);
      if (flaecheSigniert(ref) <= EPS) continue; // the outer face of a component
      const innen = innenPolygon(zyklus, knoten, kanteVon);
      const fl = innen ? flaeche(innen) : 0;
      if (!innen || flaecheSigniert(innen) <= EPS || fl <= MIN_RAUMFLAECHE_M2) {
        meldungen.push({ code: "raum-zu-klein", level: lvl, punkt: mm(ref[0]), flaeche_m2: r3(fl) });
        continue;
      }
      const eigene = komponente.get(zyklus[0]);
      const insel = [...komponente.entries()].some(([k, c]) => c !== eigene && punktIn(ref, knoten[k]));
      if (insel) meldungen.push({ code: "insel", level: lvl, punkt: mm(mittelpunkt(ref)) });
      const wKeys = [];
      for (let i = 0; i < zyklus.length; i += 1) {
        const kn = kanteVon(zyklus[i], zyklus[(i + 1) % zyklus.length]);
        if (kn && !wKeys.includes(kn.W.schluessel)) wKeys.push(kn.W.schluessel);
      }
      raeume.push({ level: lvl, punkte: innen.map(mm), punkte_referenzlinie: ref.map(mm), flaeche_m2: r3(fl), flaeche_referenzlinie_m2: r3(flaeche(ref)), waende: wKeys, quelle: "abgeleitet", ...(insel ? { insel: true } : {}) });
    }
  }
  // stable order: largest room first, then by position (the order of the graph walk depends on the drawing order)
  raeume.sort((p, q) => q.flaeche_m2 - p.flaeche_m2 || p.punkte_referenzlinie[0].x - q.punkte_referenzlinie[0].x || p.punkte_referenzlinie[0].z - q.punkte_referenzlinie[0].z);
  return { raeume, meldungen };
}

/**
 * Inner polygon of a counter-clockwise cycle: every edge moved to the face of its wall body that looks into the room (the room lies
 * left of the edge), consecutive lines intersected; collinear edges with different offsets get a step.
 * @param {number[]} zyklus node indices, counter-clockwise
 * @param {P[]} knoten
 * @param {(u: number, v: number) => ({W: GraphWand}|undefined)} kanteVon
 * @returns {P[]|null}
 */
function innenPolygon(zyklus, knoten, kanteVon) {
  const n = zyklus.length;
  /** @type {Array<{p: P, d: P, nl: P, off: number}>} */
  const linien = [];
  for (let i = 0; i < n; i += 1) {
    const p = knoten[zyklus[i]], q = knoten[zyklus[(i + 1) % n]];
    const kn = kanteVon(zyklus[i], zyklus[(i + 1) % n]);
    if (!kn) return null;
    const L = abstand(p, q);
    const d = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
    const nl = { x: -d.z, z: d.x }; // left normal = into the room
    const gleich = d.x * kn.W.d.x + d.z * kn.W.d.z > 0;
    const off = Math.max(0, gleich ? kn.W.hi : -kn.W.lo);
    linien.push({ p: { x: p.x + nl.x * off, z: p.z + nl.z * off }, d, nl, off });
  }
  /** @type {P[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const A = linien[(i - 1 + n) % n], B = linien[i];
    const s = linienSchnitt(A.p, A.d, B.p, B.d);
    if (s) { out.push(s); continue; }
    // collinear: same offset → no corner; different offsets → a step at the node
    if (Math.abs(A.off - B.off) < 1e-9) continue;
    const k = knoten[zyklus[i]];
    out.push({ x: k.x + A.nl.x * A.off, z: k.z + A.nl.z * A.off }, { x: k.x + B.nl.x * B.off, z: k.z + B.nl.z * B.off });
  }
  return out.length >= 3 ? out : null;
}

/**
 * A proposal as a `customZones` record (the user takes it over; the caller adds `_idx` and the name).
 * @param {RaumVorschlag} v
 * @param {{messregel?: string}} [opt] measuring rule of the new zone (default "innenkante", the inner polygon)
 * @returns {{points: P[], level: number, messregel?: string}}
 */
export function zoneAusVorschlag(v, opt = {}) {
  const regel = opt.messregel === "referenzlinie" ? "referenzlinie" : STANDARD_MESSREGEL;
  return regel === "referenzlinie" ? { points: v.punkte_referenzlinie.map((p) => ({ ...p })), level: v.level, messregel: regel } : { points: v.punkte.map((p) => ({ ...p })), level: v.level };
}

/**
 * Does a proposal match an existing zone of its storey (the centroid inside the zone and the zone area equal to the proposal's inner
 * area OR its reference-line area within VORSCHLAG_TOL_M2 / VORSCHLAG_TOL_ANTEIL)? Used to mark proposals that are already taken over
 * — with either measuring rule (zoneAusVorschlag stores the reference-line polygon for "referenzlinie").
 * @param {RaumVorschlag} v
 * @param {Array<{points?: P[], level?: number}>} zonen
 * @returns {boolean}
 */
export function vorschlagVorhanden(v, zonen) {
  const c = mittelpunkt(v.punkte);
  const passt = (/** @type {number} */ a, /** @type {number} */ soll) => Math.abs(a - soll) <= Math.max(VORSCHLAG_TOL_M2, VORSCHLAG_TOL_ANTEIL * soll);
  return (Array.isArray(zonen) ? zonen : []).some((z) => {
    if (!Array.isArray(z?.points) || z.points.length < 3 || Math.round(num(z.level)) !== v.level || !punktIn(z.points, c)) return false;
    const a = flaeche(z.points);
    return passt(a, v.flaeche_m2) || (Number.isFinite(v.flaeche_referenzlinie_m2) && passt(a, v.flaeche_referenzlinie_m2));
  });
}

/** @param {P[]} pts @returns {P} centroid of the polygon area, m */
function mittelpunkt(pts) {
  const A = flaecheSigniert(pts);
  if (Math.abs(A) < EPS) return pts[0];
  let cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const k = a.x * b.z - b.x * a.z;
    cx += (a.x + b.x) * k; cz += (a.z + b.z) * k;
  }
  return { x: cx / (6 * A), z: cz / (6 * A) };
}

/** @param {P[]} pts @param {P} p @returns {boolean} ray casting */
function punktIn(pts, p) {
  let drin = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) drin = !drin;
  }
  return drin;
}

/**
 * Message of the room detection in words (German key = text, through the caller's i18n `t`).
 * @param {RaumMeldung} m
 * @param {(k: string) => string} [t] i18n lookup (default: the German key)
 * @returns {string}
 */
export function meldungText(m, t = (k) => k) {
  const z = (/** @type {number} */ v) => v.toFixed(2);
  if (m.code === "kette-offen" && m.punkt) return t("Kette nicht geschlossen bei ({{x}}; {{z}})").replace("{{x}}", z(m.punkt.x)).replace("{{z}}", z(m.punkt.z));
  if (m.code === "spalt" && m.punkte) return t("Spalt {{b}} m zwischen ({{x1}}; {{z1}}) und ({{x2}}; {{z2}})").replace("{{b}}", z(num(m.breite_m)))
    .replace("{{x1}}", z(m.punkte[0].x)).replace("{{z1}}", z(m.punkte[0].z)).replace("{{x2}}", z(m.punkte[1].x)).replace("{{z2}}", z(m.punkte[1].z));
  if (m.code === "raum-zu-klein" && m.punkt) return t("Geschlossene Fläche bei ({{x}}; {{z}}) zu klein für einen Raum").replace("{{x}}", z(m.punkt.x)).replace("{{z}}", z(m.punkt.z));
  if (m.code === "insel" && m.punkt) return t("Raum um ({{x}}; {{z}}) enthält freistehende Wände — nicht ausgeschnitten").replace("{{x}}", z(m.punkt.x)).replace("{{z}}", z(m.punkt.z));
  if (m.code === "zonen-ueber-ngf") return t("Geschoss {{level}}: Verkehrs- und Technikflächen größer als die Netto-Raumfläche — Zonen überlappen Wände").replace("{{level}}", String(m.level));
  return m.code;
}

// ---------------------------------------------------------------------------------------------------------------------------
// 3. Measuring rule and net area
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Measuring rule of a zone (missing or unknown = "innenkante").
 * @param {{messregel?: string}|null|undefined} z
 * @returns {"innenkante"|"referenzlinie"}
 */
export function messregelVon(z) {
  return z?.messregel === "referenzlinie" ? "referenzlinie" : "innenkante";
}

/** Default edge length of a column in m when the record has none (BitBimStudio places columns with size 0.4). */
const STUETZE_STANDARD_M = 0.4;

/**
 * Square of a column in plan (axis-parallel, centred on x/z), m.
 * @param {{x: number, z: number, size?: number}} c
 * @returns {P[]}
 */
export function stuetzenQuadrat(c) {
  const h = num(c?.size, STUETZE_STANDARD_M) / 2 || STUETZE_STANDARD_M / 2;
  return [{ x: c.x - h, z: c.z - h }, { x: c.x + h, z: c.z - h }, { x: c.x + h, z: c.z + h }, { x: c.x - h, z: c.z + h }];
}

/** @param {P[]} p @returns {{x0: number, x1: number, z0: number, z1: number}} */
function bbox(p) {
  return { x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), z0: Math.min(...p.map((q) => q.z)), z1: Math.max(...p.map((q) => q.z)) };
}
/** @param {P[]} a @param {P[]} b @returns {boolean} */
function bboxUeberlappt(a, b) {
  const A = bbox(a), B = bbox(b);
  return A.x0 < B.x1 - EPS && B.x0 < A.x1 - EPS && A.z0 < B.z1 - EPS && B.z0 < A.z1 - EPS;
}

/**
 * Pieces of polygons minus convex regions (each region cut with ohneKonvex from formGeometrie.js), m.
 * @param {P[][]} teile
 * @param {P[][]} regionen convex polygons
 * @returns {P[][]}
 */
function ohneRegionen(teile, regionen) {
  let out = teile;
  for (const r of regionen) {
    if (r.length < 3 || flaeche(r) < EPS) continue;
    const hp = halbebenenVon(r);
    out = out.flatMap((t) => (bboxUeberlappt(t, r) ? ohneKonvex(t, hp, 1e-9) : [t]));
  }
  return out;
}

/** @param {P[][]} teile @returns {number} m² */
const summe = (teile) => teile.reduce((s, t) => s + flaeche(t), 0);

/**
 * Net area of a room (BK-53), m² with 3 decimals: the zone polygon minus the column squares of its storey, minus overlapping stair and
 * lift zones of its storey (a shaft zone itself is not cut by other shafts), and — with messregel "referenzlinie" — minus the wall
 * bodies of its storey. Overlapping deductions are counted once (the pieces are cut one after the other, exact). Concave shaft zones
 * are cut as triangles (zerlegeInDreiecke). The stored polygon is not changed.
 * @param {{points?: P[], level?: number, raumart?: string|null, messregel?: string}} zone
 * @param {{stuetzen?: Array<{x: number, z: number, level?: number, size?: number}>, zonen?: Array<any>, waende?: any[]}} [opt]
 *   stuetzen: customColumns (size in m); zonen: all zones (the shafts are taken from them); waende: wall records or entries (only for
 *   messregel "referenzlinie")
 * @returns {number} m²
 */
export function nettoFlaeche_m2(zone, opt = {}) {
  const pts = Array.isArray(zone?.points) ? zone.points : [];
  if (pts.length < 3) return 0;
  const lvl = Math.round(num(zone?.level));
  /** @type {P[][]} */
  const regionen = [];
  for (const c of opt.stuetzen || []) if (Math.round(num(c?.level)) === lvl && Number.isFinite(c?.x) && Number.isFinite(c?.z)) regionen.push(stuetzenQuadrat(c));
  if (!SCHACHT_RAUMARTEN.includes(String(zone?.raumart))) {
    for (const s of opt.zonen || []) {
      if (s === zone || !Array.isArray(s?.points) || s.points.length < 3 || Math.round(num(s.level)) !== lvl) continue;
      if (!SCHACHT_RAUMARTEN.includes(String(s.raumart))) continue;
      if (s.points === pts) continue;
      regionen.push(...zerlegeInDreiecke(s.points));
    }
  }
  if (messregelVon(zone) === "referenzlinie") {
    (opt.waende || []).forEach((e, i) => {
      const { wand: w } = wandEintrag(e, i);
      if (w?.a && w?.b && Math.round(num(w.level)) === lvl && abstand(w.a, w.b) > 1e-6) regionen.push(wandGeometrie(w).polygon);
    });
  }
  return r3(summe(ohneRegionen([pts.map((p) => ({ x: num(p.x), z: num(p.z) }))], regionen)));
}

/**
 * Rooms of the workshop (werkstattBauteile.werkstattRaeume) with their net area `flaeche_netto_m2` (m²). Lives here and not in
 * werkstattRaeume itself because that module is on the start path of the app (entry chunk, size budget): werkstattRaeume stays
 * byte-identical, the readers that show or export the net area (inspector, figures, IFC) call this.
 * @template {{points: P[], level: number, raumart?: string|null}} R
 * @param {R[]} raeume
 * @param {{stuetzen?: any[], zonen?: any[]}} [opt] the zones of the store (shafts), drawn columns
 * @returns {Array<R & {flaeche_netto_m2: number}>}
 */
export function raeumeMitNetto(raeume, opt = {}) {
  const zonen = opt.zonen || raeume;
  return (Array.isArray(raeume) ? raeume : []).map((r) => ({ ...r, flaeche_netto_m2: nettoFlaeche_m2(r, { stuetzen: opt.stuetzen, zonen }) }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// 4. DIN 277
// ---------------------------------------------------------------------------------------------------------------------------

/** DIN 277 area kinds of NGF. */
export const DIN277_BEREICHE = Object.freeze(["nuf", "vf", "tf"]);

/**
 * DIN 277 group of a zone: the stated `din277_gruppe` ("01" … "09"), else derived — raumart corridor/stair/lift → "09" (VF), raumart
 * or use "technik" → "08" (TF), else the first group whose usage type is the zone's `use` (DIN277_ZU_NUTZUNG), else "01".
 * [ASSUMED] mapping of raumart/use to the groups (no room catalogue with DIN 277 groups exists yet); "wohnen" and zones without use
 * fall to "01" (Wohnen und Aufenthalt). Way to a proven value: a room catalogue per raumart with the DIN 277 group.
 * @param {{din277_gruppe?: string, raumart?: string|null, use?: string|null}|null|undefined} z
 * @returns {{gruppe: string, quelle: "gesetzt"|"abgeleitet"}}
 */
export function din277Gruppe(z) {
  const g = String(z?.din277_gruppe ?? "");
  if (/^0[1-9]$/.test(g)) return { gruppe: g, quelle: "gesetzt" };
  if (VF_RAUMARTEN.includes(String(z?.raumart))) return { gruppe: "09", quelle: "abgeleitet" };
  if (z?.raumart === "technik" || z?.use === "technik") return { gruppe: "08", quelle: "abgeleitet" };
  const use = z?.use ? String(z.use) : "";
  const treffer = use ? Object.entries(DIN277_ZU_NUTZUNG).find(([k, v]) => v.use === use && k <= "07") : null;
  return { gruppe: treffer ? treffer[0] : "01", quelle: "abgeleitet" };
}

/**
 * Area kind of a DIN 277 group: 01 … 07 NUF, 08 TF, 09 VF.
 * @param {string} gruppe
 * @returns {"nuf"|"vf"|"tf"}
 */
export function din277Bereich(gruppe) {
  return gruppe === "08" ? "tf" : gruppe === "09" ? "vf" : "nuf";
}

/**
 * Area of the union of convex pieces inside the footprint, m² (each piece counted once, exact: piece ∩ footprint minus the pieces
 * before it).
 * @param {P[][]} stuecke convex pieces, m
 * @param {P[]} footprint simple polygon, m (empty = no clipping)
 * @returns {number} m²
 */
function vereinigungImFootprint(stuecke, footprint) {
  let s = 0;
  /** @type {P[][]} */
  const vorher = [];
  for (const q of stuecke) {
    if (q.length < 3 || flaeche(q) < EPS) continue;
    let teile = footprint.length >= 3 ? inKonvex(footprint, halbebenenVon(q)) : [q];
    teile = ohneRegionen(teile, vorher);
    s += summe(teile);
    vorher.push(q);
  }
  return s;
}

/**
 * Construction area of the walls and columns of one storey in plan (KGF part), m²: every wall as its body rectangle (referenz.js
 * wandGeometrie) plus the corner fillers of the drawn walls (referenz.js eckfueller, the same squares plan and 3D draw); with the bands
 * function of 107-09 (`baenderFn` = verschneidung.js `baender`, handed in by a caller that has loaded that module) the walls with a
 * build-up are taken as their cleaned layer bands instead (the same bands as plan, IFC and quantities). Columns as squares. All as a
 * union inside the footprint (each area once; a hull wall centred on the footprint line counts with its inner half, matching
 * BGF = footprint area).
 * @param {any[]} waende wall records or entries {schluessel, wand}
 * @param {any[]} stuetzen columns (customColumns)
 * @param {number} level
 * @param {P[]} footprint
 * @param {((waende: any[], geschoss: number, aufbauVon?: (el: any) => any) => {baender: Array<{schluessel: string, teile: P[][]}>})|null} baenderFn
 * @param {((el: any) => any)|undefined} aufbauVonFn build-up of a wall for the bands
 * @returns {number} m²
 */
function konstruktionImGeschoss(waende, stuetzen, level, footprint, baenderFn, aufbauVonFn) {
  const eintraege = (Array.isArray(waende) ? waende : []).map(wandEintrag).filter(({ wand: w }) => w?.a && w?.b && Math.round(num(w.level)) === level && abstand(w.a, w.b) > 1e-6);
  /** @type {P[][]} */
  const stuecke = [];
  const mitBand = new Set();
  if (eintraege.length && typeof baenderFn === "function") {
    const r = baenderFn(eintraege, level, aufbauVonFn);
    for (const b of r.baender) { mitBand.add(b.schluessel); stuecke.push(...b.teile); }
  }
  for (const { schluessel, wand } of eintraege) if (!mitBand.has(schluessel)) stuecke.push(wandGeometrie(wand).polygon);
  // corner fillers of the drawn walls (hull walls meet on the footprint line, their corners lie outside it)
  const gezeichnet = eintraege.filter(({ schluessel }) => !schluessel.startsWith("env:") && !mitBand.has(schluessel)).map(({ schluessel, wand }) => ({ ...wand, _idx: schluessel }));
  for (const e of eckfueller(gezeichnet)) {
    const h = e.dicke_m / 2;
    stuecke.push([{ x: e.x - h, z: e.z - h }, { x: e.x + h, z: e.z - h }, { x: e.x + h, z: e.z + h }, { x: e.x - h, z: e.z + h }]);
  }
  for (const c of Array.isArray(stuetzen) ? stuetzen : []) if (Math.round(num(c?.level)) === level && Number.isFinite(c?.x) && Number.isFinite(c?.z)) stuecke.push(stuetzenQuadrat(c));
  return vereinigungImFootprint(stuecke, footprint);
}

/** @param {number} v m² @returns {number} integer in 0.001 m² */
const tausendstel = (v) => Math.round(v * 1000);

/**
 * DIN 277 areas per storey and as sums (BK-54, D-BK-20 basements). Per level of `ebenen` (ebenenListe(model) of 107-13; without it the
 * levels 0 … storeys − 1 as before):
 *  - BGF = footprint area (polygonAreaM of the footprint) [ASSUMED: the footprint is the outer line of the building, D-BK-02 "center"
 *    keeps the hull centred on it]. With workshop shell data for the level (`rohbau`, werkstattBauteile.rohbauZuschlag) BGF is the
 *    larger of footprint area and the workshop's gross area `rohbau_m2` [ASSUMED, D-BW-02: zones stay clear and the shell grows by the
 *    wall thickness — otherwise NGF would come out smaller than the clear zones].
 *  - KGF = the drawn and hull walls and the columns of the level inside the footprint (konstruktionImGeschoss: body rectangles and corner
 *    fillers; with `baender` the bands of 107-09 for walls with a build-up) plus the workshop walls `aussenwand_m2 + innenwand_m2` of `rohbau`; never more than BGF.
 *  - NGF = BGF − KGF; VF = net area of the zones of DIN 277 group 09, TF = group 08 (din277Gruppe), NUF = NGF − VF − TF (the rest).
 *    Balconies (raumart "balkon") are outside the envelope and left out. When VF + TF exceed NGF (zones lying over walls) NUF is 0,
 *    NGF = VF + TF, KGF = BGF − NGF, and a message names the storey — the identities hold in every case.
 *  - Basement (level < 0): its own row, BGF = footprint area like every storey [ASSUMED: every basement storey is covered and enclosed
 *    on all sides, so its whole area belongs to the DIN 277 area "a" (regular), the same rule as above ground], KGF from the basement
 *    walls of the model and its zones' columns. The sums are `oberirdisch` (level ≥ 0), `unterirdisch` (level < 0) and `gesamt`.
 * Rounding: every row to 0.001 m² (integer arithmetic, so BGF = KGF + NGF and NGF = NUF + VF + TF hold exactly in the rounded values).
 * @param {{zonen?: any[], waende?: any[], stuetzen?: any[], footprint?: P[], storeys?: number, ebenen?: Array<{level: number, name?: string}>|null,
 *   rohbau?: Array<{level: number, rohbau_m2: number, aussenwand_m2: number, innenwand_m2: number}>|null, aufbauVon?: (el: any) => any,
 *   baender?: ((waende: any[], geschoss: number, aufbauVon?: (el: any) => any) => {baender: Array<{schluessel: string, teile: P[][]}>})|null}} eingabe
 *   zonen: customZones and/or store zones (points m, level, raumart, use, din277_gruppe, messregel); waende: hull walls (model.walls)
 *   and drawn walls (records or entries); stuetzen: customColumns; footprint: building outline m; storeys: number of storeys above
 *   ground (fallback without `ebenen`); rohbau: workshop shell per level (m²); baender: verschneidung.js `baender` (107-09) when the caller
 *   has that lazily loaded module, aufbauVon: its build-up reader (default: the one of the bands module)
 * @returns {{geschosse: Array<Din277Zeile & {level: number, name: string|null, quelle: "zonen"|"ohne-zonen", nuf_zonen: number}>,
 *   oberirdisch: Din277Zeile, unterirdisch: Din277Zeile, gesamt: Din277Zeile, meldungen: RaumMeldung[]}}
 */
export function din277Flaechen(eingabe = {}) {
  const fp = Array.isArray(eingabe.footprint) ? eingabe.footprint.map((p) => ({ x: num(p.x), z: num(p.z) })) : [];
  const fpA = fp.length >= 3 ? flaeche(fp) : 0;
  /** @type {Array<{level: number, name?: string}>} */
  const ebenen = Array.isArray(eingabe.ebenen) && eingabe.ebenen.length
    ? eingabe.ebenen
    : Array.from({ length: Math.max(1, Math.round(num(eingabe.storeys, 1))) }, (_, i) => ({ level: i }));
  const zonen = (Array.isArray(eingabe.zonen) ? eingabe.zonen : []).filter((z) => Array.isArray(z?.points) && z.points.length >= 3 && z.raumart !== "balkon");
  /** @type {RaumMeldung[]} */
  const meldungen = [];
  const geschosse = ebenen.map((e) => {
    const level = Math.round(num(e.level));
    const rb = (eingabe.rohbau || []).find((r) => Math.round(num(r.level)) === level) || null;
    const B = tausendstel(rb ? Math.max(fpA, num(rb.rohbau_m2)) : fpA);
    const kgfRoh = konstruktionImGeschoss(eingabe.waende || [], eingabe.stuetzen || [], level, fp, eingabe.baender || null, eingabe.aufbauVon) + (rb ? num(rb.aussenwand_m2) + num(rb.innenwand_m2) : 0);
    let K = Math.min(B, tausendstel(kgfRoh));
    let N = B - K;
    const imGeschoss = zonen.filter((z) => Math.round(num(z.level)) === level);
    let V = 0, T = 0, U = 0;
    for (const z of imGeschoss) {
      const a = tausendstel(nettoFlaeche_m2(z, { stuetzen: eingabe.stuetzen, zonen, waende: eingabe.waende }));
      const bereich = din277Bereich(din277Gruppe(z).gruppe);
      if (bereich === "vf") V += a; else if (bereich === "tf") T += a; else U += a;
    }
    let NUF = N - V - T;
    if (NUF < 0) {
      meldungen.push({ code: "zonen-ueber-ngf", level });
      NUF = 0; N = V + T; K = B - N;
    }
    const k = (/** @type {number} */ v) => v / 1000;
    return { level, name: typeof e.name === "string" ? e.name : null, quelle: /** @type {"zonen"|"ohne-zonen"} */ (imGeschoss.length ? "zonen" : "ohne-zonen"),
      bgf: k(B), kgf: k(K), ngf: k(N), nuf: k(NUF), vf: k(V), tf: k(T), nuf_zonen: k(U) };
  });
  const summeVon = (/** @type {typeof geschosse} */ zeilen) => {
    /** @type {Record<string, number>} */
    const s = { bgf: 0, kgf: 0, ngf: 0, nuf: 0, vf: 0, tf: 0 };
    for (const z of zeilen) for (const key of Object.keys(s)) s[key] += tausendstel(/** @type {any} */ (z)[key]);
    return /** @type {Din277Zeile} */ ({ bgf: s.bgf / 1000, kgf: s.kgf / 1000, ngf: s.ngf / 1000, nuf: s.nuf / 1000, vf: s.vf / 1000, tf: s.tf / 1000 });
  };
  return {
    geschosse,
    oberirdisch: summeVon(geschosse.filter((g) => g.level >= 0)),
    unterirdisch: summeVon(geschosse.filter((g) => g.level < 0)),
    gesamt: summeVon(geschosse),
    meldungen,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// 5. Room boundaries (IfcRelSpaceBoundary)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Walls that bound a room (BK-55, IFC option `raumGrenzen`): a wall bounds the room when one edge of the room polygon runs parallel to
 * the wall (within ~1°) inside its body or on its face (distance to the body centre line ≤ thickness/2 + `tol`) over at least 5 cm of
 * the wall's length. Pure geometry, so it works for drawn zones, workshop rooms and the storey spaces alike.
 * @param {P[]} punkte room polygon, m
 * @param {Array<{schluessel: string, a: P, b: P, dicke_m: number, versatz_m?: number}>} waende wall axes (reference line a→b), thickness
 *   and offset of the body centre line along the normal (referenz.js), m
 * @param {number} [tol] m (default 0.05 [ASSUMED]: rounding of drawn points and the 0.12 m pull of the old click detection lie inside it
 *   only together with the half thickness; a room drawn a few cm off the face is still bounded)
 * @returns {Array<{schluessel: string, laenge_m: number}>} wall keys with the bounded length in m, in wall order
 */
export function grenzWaende(punkte, waende, tol = 0.05) {
  const pts = Array.isArray(punkte) ? punkte : [];
  /** @type {Array<{schluessel: string, laenge_m: number}>} */
  const out = [];
  for (const w of Array.isArray(waende) ? waende : []) {
    const L = abstand(w.a, w.b);
    if (L < 1e-6) continue;
    const d = { x: (w.b.x - w.a.x) / L, z: (w.b.z - w.a.z) / L };
    const n = { x: -d.z, z: d.x };
    const o = num(w.versatz_m);
    const c0 = { x: w.a.x + n.x * o, z: w.a.z + n.z * o };
    let laenge = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const le = abstand(p, q);
      if (le < 1e-6) continue;
      const sin = Math.abs(((q.x - p.x) * d.z - (q.z - p.z) * d.x) / le);
      if (sin > GRENZE_PARALLEL_SIN) continue;
      const dist = Math.abs((p.x - c0.x) * n.x + (p.z - c0.z) * n.z);
      if (dist > num(w.dicke_m) / 2 + tol) continue;
      const t1 = (p.x - c0.x) * d.x + (p.z - c0.z) * d.z, t2 = (q.x - c0.x) * d.x + (q.z - c0.z) * d.z;
      const ueber = Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
      if (ueber > GRENZE_MIN_LAENGE_M) laenge += ueber;
    }
    if (laenge > 0) out.push({ schluessel: w.schluessel, laenge_m: r3(laenge) });
  }
  return out;
}
