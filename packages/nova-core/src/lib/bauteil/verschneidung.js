// 107-09 (spec II.3 priority-based connections, III.1 intersection group; D-BK-07, D-BK-15): the cleaned layer bands of the walls of
// one storey — a pure 2D function and the ANALYTIC REFERENCE of the 3D solids (solidAbleitung.js, D-BK-08b volume comparison).
//
// Two-state rule (spec VI.3): the store keeps only the base geometry of a wall (a, b, composite / thickness, height, refLine and
// the optional fields verschneidungsgruppe / schicht_prioritaet); the bands are derived on every call and NEVER stored or written
// back. The reference line keeps its position (referenz.js, 107-01): the bands are the layer strips of the body wandGeometrie()
// places, only their ends change.
//
// Rule (documented, fixed):
//  1. Who takes part: walls with a real build-up (aufbauVon quelle "composite" or "klasse") of the given storey. A wall with only a
//     thickness (the standard hull: createBuildingModel wallComposite = null) never takes part and keeps its rectangle.
//  2. Groups (D-BK-15): `verschneidungsgruppe` (integer, default 1). Group 0 never intersects; two walls intersect only when they
//     carry the SAME group ≥ 1. Walls that may not intersect but overlap in plan are reported ("keine Verschneidung trotz
//     Überlappung"), never silently cleaned.
//  3. Joints: an end of a wall that lies within FANG_TOLERANZ_M of an end of another wall (L joint) or of the axis of another wall
//     (T joint) joins that wall; of several candidates the most perpendicular one wins (equal: the earlier one). A collinear
//     neighbour at the end (|sin| < PARALLEL_SIN) makes the end a plain butt end. An acute joint (|sin| < SPITZ_SIN) is computed and
//     reported, never hidden.
//  4. Rank of a layer: priority (0-999, aufbauVon: stated, element override or proposal of 107-03) descending; on equal priority the
//     wall drawn first (index in the input list) wins; inside one wall the layer order. Layers are processed in rank order.
//  5. At a joined end every layer grows into the joint zone (the thickness of the joined wall Y) and stops at the first layer of Y it
//     actually MEETS there that ranks higher: a higher priority stops it in front of that layer ("the higher priority runs through,
//     the lower one abuts", plan 107-09 truth 2); an equal priority is a connection — the layer of the wall drawn first takes the
//     common cell and stops behind it, the other stops in front of it. A layer of Y with a lower priority is passed and cut. Nothing
//     is jumped over: a layer never continues behind a layer that stopped it (review 107-09: the first fix extended every layer to
//     the far face and let the higher rank keep the overlap — at a T joint on the core side the branch's core jumped over the
//     through core and left a concrete island in its insulation, and at a cavity corner the core crossed the insulation to the
//     outside).
//     "Actually meets" is decided cell by cell: the joint zone is a grid of cells (layer i of X × layer j of Y). At an L joint both
//     walls grow into the same square, so a layer of Y is present in a row of X only if Y's layer reached it; the grid is walked row by
//     row from the side of Y's body (cell (i, j) after (i, j−1) and (i−1, j)), and at a cell both layers reach the higher-ranked one
//     takes it. Every cell gets exactly one owner (a layer only stops at a cell another layer takes, and the one that took a cell
//     blocks only cells behind it, which the stopped layers of the other wall then reach), so the union of the walls is covered
//     without gap or double area, and every layer stays ONE piece connected to its wall. With equal build-ups the layers wrap around
//     an outer corner (insulation continuous, the cores meet inside). At a T joint the through wall Y is continuous, so all its
//     layers are present in every row. An L joint whose partner end does not join back (rare: the partner joined a more
//     perpendicular wall) keeps the plain rule: extend to the far face, the higher rank keeps the overlap.
//  6. Geometry: every band and every placed region is convex; the cuts are the convex half-plane primitives of formGeometrie.js
//     (inKonvex, ohneKonvex), so a band may come out as several convex pieces (`teile`). No boolean library in 2D.
//
// Volume (the hand rule the solid is compared against): restVolumen_m3() splits a band into cells by every region that removes
// material over a height interval (the higher-ranked layers it was cut by, with their own lower/upper edges, and the openings of its
// wall with their sill and head), so walls of different heights and openings are exact, not approximated.
//
// In: wall records or {schluessel, wand, unterkante_m, hoehe_m, oeffnungen} entries (m). Out: bands (polygons in m, areas in m²),
// volumes in m³, messages. Pure, no I/O, node-testable.

import { aufbauVon as aufbauVonStandard } from "./aufbauten.js";
import { wandGeometrie } from "./referenz.js";
import { wandHoehe, unterkante } from "./hoehen.js";
import { lochImWand } from "./oeffnungen.js";
import { verschneidungsgruppe, STANDARD_VERSCHNEIDUNGSGRUPPE } from "./steckbrief.js";
import { flaeche, flaecheSigniert, inKonvex, ohneKonvex } from "../formGeometrie.js";
import { vereinigePolygone } from "../polygonVereinigung.js";

/**
 * Capture distance of a joint in m. [ASSUMED] 0.4 m = the default capture distance of the object snap (objektfang.js `toleranz_m`):
 * an end the user snapped onto another wall lies far closer. Way to a proven value: misses on real plans.
 */
export const FANG_TOLERANZ_M = 0.4;
/** |sin| of the angle below which two walls count as collinear (no joint). [ASSUMED] 0.1 ≈ 5.7°, the value of eckfueller(). */
export const PARALLEL_SIN = 0.1;
/** |sin| below which a joint is reported as acute. [ASSUMED] 0.5 = 30°: below it the mitre of a layer grows past twice its thickness. */
export const SPITZ_SIN = 0.5;
/** Overhang of an opening footprint beyond each wall face in m — the same 2 cm as the CSG opening body (csg/koerper.js). */
export const OEFFNUNG_UEBERSTAND_M = 0.02;
/** Pieces below this area are dropped as numerical rests (m²). [ASSUMED] 1e-9 m² = 0.001 mm²; far below any drawing tolerance. */
const MIN_FLAECHE_M2 = 1e-9;
/** Default group of a wall without the field (D-BK-15), the one value of steckbrief.js. */
export const STANDARD_GRUPPE = STANDARD_VERSCHNEIDUNGSGRUPPE;
/** [ASSUMED] length in m a layer may at most be extended beyond its axis end before the clip by the joined wall (10 m covers 1.2 m walls down to ~7°). */
const VERLAENGERUNG_MAX_M = 10;

/**
 * @typedef {{x: number, z: number}} P
 * @typedef {{nx: number, nz: number, c: number}} Halbebene  n·p ≤ c
 * @typedef {object} Region  a convex region that removes material over a height interval
 * @property {P[]} polygon   convex polygon in m (world x/z)
 * @property {number} unten_m lower edge in m (world height)
 * @property {number} oben_m  upper edge in m
 * @property {string} [schluessel] wall the region belongs to
 * @property {number} [schicht]    layer index of that wall
 * @typedef {object} Band  one layer of one wall after the intersection
 * @property {string} schluessel     wall key ("env:<level>:<edge>", "cw:<_idx>" or "w<i>")
 * @property {number} wandIndex      index of the wall in the input (draw order)
 * @property {number} schicht        layer index (outside → inside)
 * @property {string} name
 * @property {string|null} material
 * @property {"kern"|"bekleidung"|"sonstig"} funktion
 * @property {number} prioritaet     0-999
 * @property {number} gruppe         intersection group (0 = never)
 * @property {boolean} verschnitten  false for a wall of group 0 (plain layer rectangle)
 * @property {P[][]} max             the layer after extension and stop, before the higher-ranked layers are cut away (convex pieces)
 * @property {P[][]} teile           the cleaned layer (convex pieces, disjoint from every other band of the same group)
 * @property {P[][]} umrisse         the same area as outlines: adjacent pieces merged (no seams in the plan, one IFC item per ring)
 * @property {number} flaeche_m2     area of `teile`
 * @property {number} unterkante_m   lower edge (world height, m)
 * @property {number} oberkante_m    upper edge (m)
 * @property {Region[]} abzuege      higher-ranked regions of other walls that overlap `max` (the solid subtracts exactly these)
 * @property {Region[]} oeffnungen   opening footprints of the wall with sill and head (world heights)
 * @typedef {object} Meldung
 * @property {"gruppen-ueberlappung"|"spitzer-winkel"} code
 * @property {string} [a]  first wall key
 * @property {string} [b]  second wall key
 * @property {number[]} [gruppen]
 * @property {string} [schluessel]
 * @property {"a"|"b"} [ende]
 * @property {number} [winkel_grad]
 * @typedef {object} VerschneidungsWand  normalised input entry
 * @property {string} schluessel
 * @property {any} wand                 the wall record
 * @property {number} unterkante_m
 * @property {number} hoehe_m
 * @property {string} [guid]
 * @property {Array<{u?: number|null, width: number, height: number, sill: number}>} [oeffnungen]  resolved sizes in m (oeffnungsMasse)
 */

/** @param {P} a @param {P} b @returns {number} */
const punkt = (a, b) => a.x * b.x + a.z * b.z;
/** @param {P} a @param {P} b @returns {number} */
const abstand = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Half-planes of a convex polygon (any orientation): the inside is n·p ≤ c for every edge.
 * @param {P[]} poly convex polygon in m
 * @returns {Halbebene[]}
 */
export function halbebenenVon(poly) {
  const s = flaecheSigniert(poly) >= 0 ? 1 : -1;
  /** @type {Halbebene[]} */
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ez = q.z - p.z;
    const l = Math.hypot(ex, ez);
    if (l < 1e-12) continue;
    // positive shoelace sum in x/z: the inside lies left of an edge, (−ez, ex); outward normal (ez, −ex)
    const nx = (s * ez) / l, nz = (-s * ex) / l;
    out.push({ nx, nz, c: nx * p.x + nz * p.z });
  }
  return out;
}

/**
 * Area of the common part of two convex polygons in m².
 * @param {P[]} a
 * @param {P[]} b
 * @returns {number}
 */
export function schnittFlaeche_m2(a, b) {
  if (!bboxUeberlappt(a, b)) return 0;
  return inKonvex(a, halbebenenVon(b)).reduce((s, t) => s + flaeche(t), 0);
}

/** @param {P[]} a @param {P[]} b @returns {boolean} */
function bboxUeberlappt(a, b) {
  const ax0 = Math.min(...a.map((p) => p.x)), ax1 = Math.max(...a.map((p) => p.x));
  const az0 = Math.min(...a.map((p) => p.z)), az1 = Math.max(...a.map((p) => p.z));
  const bx0 = Math.min(...b.map((p) => p.x)), bx1 = Math.max(...b.map((p) => p.x));
  const bz0 = Math.min(...b.map((p) => p.z)), bz1 = Math.max(...b.map((p) => p.z));
  return ax0 < bx1 - 1e-9 && bx0 < ax1 - 1e-9 && az0 < bz1 - 1e-9 && bz0 < az1 - 1e-9;
}

/**
 * Polygons minus one convex region (pieces, each convex when the inputs are).
 * @param {P[][]} polys
 * @param {P[]} region convex
 * @returns {P[][]}
 */
function ohne(polys, region) {
  const hp = halbebenenVon(region);
  return polys.flatMap((p) => (bboxUeberlappt(p, region) ? ohneKonvex(p, hp, MIN_FLAECHE_M2) : [p]));
}

/** @param {P[][]} polys @returns {number} */
const summeFlaeche = (polys) => polys.reduce((s, p) => s + flaeche(p), 0);

/**
 * Normalises the input: a wall record or an entry {schluessel, wand, …}.
 * @param {any} e
 * @param {number} i index
 * @param {{geschosse?: import("./hoehen.js").Geschosse}} opt
 * @returns {VerschneidungsWand}
 */
function eintragVon(e, i, opt) {
  const istEintrag = e && e.wand && typeof e.wand === "object";
  const w = istEintrag ? e.wand : e;
  return {
    schluessel: istEintrag && e.schluessel ? String(e.schluessel) : `w${i}`,
    wand: w,
    unterkante_m: istEintrag && Number.isFinite(e.unterkante_m) ? e.unterkante_m : Number.isFinite(w?.elevation) ? w.elevation : unterkante(w, opt.geschosse),
    hoehe_m: istEintrag && Number.isFinite(e.hoehe_m) ? e.hoehe_m : wandHoehe(w, opt.geschosse),
    guid: istEintrag ? e.guid : undefined,
    oeffnungen: istEintrag && Array.isArray(e.oeffnungen) ? e.oeffnungen : [],
  };
}

/** Intersection group of an element (D-BK-15) — steckbrief.js verschneidungsgruppe(), the one rule. */
export const gruppeVon = verschneidungsgruppe;

/**
 * Prepared data of one wall (frame, layers, group).
 * @param {VerschneidungsWand} e
 * @param {number} index
 * @param {(el: any) => ReturnType<typeof aufbauVonStandard>} aufbauVonFn
 */
function wandDaten(e, index, aufbauVonFn) {
  const w = e.wand;
  const auf = aufbauVonFn(w);
  const teilnahme = (auf.quelle === "composite" || auf.quelle === "klasse") && auf.schichten.length > 0;
  const D = auf.schichten.reduce((s, x) => s + x.dicke_m, 0);
  const g = wandGeometrie(w, { dicke_m: D > 0 ? D : undefined });
  let oben = g.versatz_m + g.dicke_m / 2;
  const schichten = auf.schichten.map((s, k) => {
    const hi = oben, lo = oben - s.dicke_m;
    oben = lo;
    return { k, name: s.name, material: s.material, funktion: s.funktion, prioritaet: s.prioritaet, lo, hi };
  });
  return {
    e, index, w, teilnahme, schichten, gruppe: gruppeVon(w), level: Number(w?.level) || 0,
    a: { x: w.a.x, z: w.a.z }, b: { x: w.b.x, z: w.b.z }, d: g.richtung, n: g.normale, L: g.laenge_m, D: g.dicke_m, versatz: g.versatz_m,
    polygon: g.polygon, unten: e.unterkante_m, oben: e.unterkante_m + e.hoehe_m,
  };
}

/** @typedef {ReturnType<typeof wandDaten>} WD */

/**
 * World point of wall coordinates (t along a→b, s along the normal), m.
 * @param {WD} W @param {number} t @param {number} s @returns {P}
 */
const wp = (W, t, s) => ({ x: W.a.x + W.d.x * t + W.n.x * s, z: W.a.z + W.d.z * t + W.n.z * s });

/**
 * Half-plane on the side of the line {p: (p − Y.a)·Y.n = s} that a point moving along `aus` from P reaches FIRST (the X side).
 * @param {WD} Y @param {number} s @param {P} aus outward direction of the end of X
 * @returns {Halbebene}
 */
function xSeite(Y, s, aus) {
  const k = punkt(aus, Y.n) >= 0 ? 1 : -1;
  return { nx: k * Y.n.x, nz: k * Y.n.z, c: k * (s + punkt(Y.n, Y.a)) };
}

/**
 * Joint of one end of a wall (rule 3 of the file head), or null for a free / butt end.
 * @param {WD} X @param {"a"|"b"} ende @param {WD[]} alle @param {number} tol
 * @returns {{Y: WD, art: "L"|"T", sin: number, aus: P, P: P, nah: Halbebene, fern: Halbebene, nahS: number, fernS: number}|null}
 */
function stossSuchen(X, ende, alle, tol) {
  const P = ende === "a" ? X.a : X.b;
  const aus = ende === "a" ? { x: -X.d.x, z: -X.d.z } : X.d;
  /** @type {{Y: WD, art: "L"|"T", sin: number}|null} */
  let best = null;
  let fortsetzung = false;
  for (const Y of alle) {
    if (Y === X || Y.level !== X.level || !Y.teilnahme || Y.gruppe === 0 || Y.gruppe !== X.gruppe || Y.L < 1e-6) continue;
    const sin = Math.abs(X.d.x * Y.d.z - X.d.z * Y.d.x);
    /** @type {"L"|"T"|null} */
    let art = null;
    if (Math.min(abstand(P, Y.a), abstand(P, Y.b)) <= tol) art = "L";
    else {
      const t = (P.x - Y.a.x) * Y.d.x + (P.z - Y.a.z) * Y.d.z;
      const s = (P.x - Y.a.x) * Y.n.x + (P.z - Y.a.z) * Y.n.z;
      if (t > tol && t < Y.L - tol && Math.abs(s - Y.versatz) <= Y.D / 2 + tol) art = "T";
    }
    if (!art) continue;
    if (sin < PARALLEL_SIN) {
      if (art === "L") fortsetzung = true;
      continue;
    }
    if (!best || sin > best.sin + 1e-9) best = { Y, art, sin };
  }
  if (fortsetzung || !best) return null;
  const Y = best.Y;
  const k = punkt(aus, Y.n);
  const tau = (/** @type {number} */ s) => (s - ((P.x - Y.a.x) * Y.n.x + (P.z - Y.a.z) * Y.n.z)) / k;
  const s1 = Y.versatz - Y.D / 2, s2 = Y.versatz + Y.D / 2;
  const [nahS, fernS] = tau(s1) <= tau(s2) ? [s1, s2] : [s2, s1];
  return { ...best, aus, P, nah: xSeite(Y, nahS, aus), fern: xSeite(Y, fernS, aus), nahS, fernS };
}

/** @typedef {NonNullable<ReturnType<typeof stossSuchen>>} Stoss */

/**
 * Rank of rule 4: true when layer S1 of wall W1 ranks above layer S2 of wall W2 (priority, then draw order, then layer order).
 * @param {WD} W1 @param {{k: number, prioritaet: number}} S1 @param {WD} W2 @param {{k: number, prioritaet: number}} S2
 * @returns {boolean}
 */
function hoeher(W1, S1, W2, S2) {
  if (S1.prioritaet !== S2.prioritaet) return S1.prioritaet > S2.prioritaet;
  if (W1.index !== W2.index) return W1.index < W2.index;
  return S1.k < S2.k;
}

/**
 * The layers of the joined wall Y in the order the end of X crosses them (nearest first), with their near and far offset in Y's frame.
 * @param {Stoss} j joint of an end of X
 * @returns {Array<{S: WD["schichten"][number], nahS: number, fernS: number}>}
 */
function schichtFolge(j) {
  const Y = j.Y;
  const k = punkt(j.aus, Y.n); // never 0: a collinear neighbour is no joint (PARALLEL_SIN)
  const sP = (j.P.x - Y.a.x) * Y.n.x + (j.P.z - Y.a.z) * Y.n.z;
  const tau = (/** @type {number} */ s) => (s - sP) / k;
  return Y.schichten
    .map((S) => (tau(S.lo) <= tau(S.hi) ? { S, nahS: S.lo, fernS: S.hi, t: tau(S.lo) } : { S, nahS: S.hi, fernS: S.lo, t: tau(S.hi) }))
    .sort((p, q) => p.t - q.t)
    .map(({ S, nahS, fernS }) => ({ S, nahS, fernS }));
}

/**
 * Stops of the layers of X at a T joint (rule 5): the through wall Y is present in every row.
 * @param {WD} X @param {Stoss} j
 * @returns {Halbebene[]} one half-plane per layer index of X
 */
function stoppT(X, j) {
  const folge = schichtFolge(j);
  return X.schichten.map((S) => {
    for (const c of folge) {
      if (!hoeher(X, S, j.Y, c.S)) return xSeite(j.Y, c.nahS, j.aus); // stops in front of a higher-ranked layer
      if (S.prioritaet === c.S.prioritaet) return xSeite(j.Y, c.fernS, j.aus); // connection: takes the cell, stops behind it
    }
    return j.fern;
  });
}

/**
 * Stops of the layers of both walls at an L joint whose ends join each other (rule 5, cell grid).
 * @param {WD} X @param {Stoss} jX joint of the end of X (joined wall Y)
 * @param {WD} Y @param {Stoss} jY joint of the end of Y (joined wall X)
 * @returns {[Halbebene[], Halbebene[]]} per layer index of X, per layer index of Y
 */
function stoppL(X, jX, Y, jY) {
  const spalten = schichtFolge(jX); // layers of Y along the end of X
  const zeilen = schichtFolge(jY); // layers of X along the end of Y
  /** @type {Array<Halbebene|null>} */
  const stopX = X.schichten.map(() => null);
  /** @type {Array<Halbebene|null>} */
  const stopY = Y.schichten.map(() => null);
  for (const r of zeilen) {
    for (const c of spalten) {
      const S = r.S, T = c.S;
      if (stopX[S.k] || stopY[T.k]) continue; // only one of them reaches the cell: it passes
      if (hoeher(X, S, Y, T)) {
        stopY[T.k] = xSeite(X, r.nahS, jY.aus);
        if (S.prioritaet === T.prioritaet) stopX[S.k] = xSeite(Y, c.fernS, jX.aus);
      } else {
        stopX[S.k] = xSeite(Y, c.nahS, jX.aus);
        if (S.prioritaet === T.prioritaet) stopY[T.k] = xSeite(X, r.fernS, jY.aus);
      }
    }
  }
  return [X.schichten.map((S) => stopX[S.k] || jX.fern), Y.schichten.map((T) => stopY[T.k] || jY.fern)];
}

/**
 * Cleaned layer bands of one storey (see file head).
 * @param {any[]} waende wall records or VerschneidungsWand entries; their ORDER is the draw order (tie of rule 4)
 * @param {number} geschoss storey level; walls of other levels are ignored
 * @param {(el: any) => ReturnType<typeof aufbauVonStandard>} [aufbauVonFn] build-up of a wall (default aufbauVon of 107-03)
 * @param {{geschosse?: import("./hoehen.js").Geschosse, toleranz_m?: number}} [opt]
 * @returns {{baender: Band[], meldungen: Meldung[], stoesse: Array<{schluessel: string, ende: "a"|"b", mit: string, art: "L"|"T", winkel_grad: number}>}}
 */
export function baender(waende, geschoss, aufbauVonFn = aufbauVonStandard, opt = {}) {
  const tol = opt.toleranz_m ?? FANG_TOLERANZ_M;
  const alle = (Array.isArray(waende) ? waende : [])
    .map((e, i) => ({ e: eintragVon(e, i, opt), i }))
    .filter(({ e }) => e.wand?.a && e.wand?.b && (Number(e.wand.level) || 0) === geschoss)
    .map(({ e, i }) => wandDaten(e, i, aufbauVonFn));
  const teil = alle.filter((W) => W.teilnahme && W.L > 1e-6);
  /** @type {Meldung[]} */
  const meldungen = [];
  /** @type {Array<{schluessel: string, ende: "a"|"b", mit: string, art: "L"|"T", winkel_grad: number}>} */
  const stoesse = [];
  // joints per end (group 0 never joins)
  const stossVon = new Map();
  for (const W of teil) {
    /** @type {Record<string, any>} */
    const s = { a: null, b: null };
    if (W.gruppe !== 0) {
      for (const ende of /** @type {Array<"a"|"b">} */ (["a", "b"])) {
        const j = stossSuchen(W, ende, teil, tol);
        s[ende] = j;
        if (!j) continue;
        const winkel = Math.round((Math.asin(Math.min(1, j.sin)) * 180) / Math.PI * 10) / 10;
        stoesse.push({ schluessel: W.e.schluessel, ende, mit: j.Y.e.schluessel, art: j.art, winkel_grad: winkel });
        if (j.sin < SPITZ_SIN) meldungen.push({ code: "spitzer-winkel", schluessel: W.e.schluessel, ende, winkel_grad: winkel });
      }
    }
    stossVon.set(W, s);
  }
  // overlapping walls that may not intersect (group 0 or different groups) are reported, never cleaned
  for (let i = 0; i < teil.length; i += 1) {
    for (let j = i + 1; j < teil.length; j += 1) {
      const A = teil[i], B = teil[j];
      if (A.gruppe === B.gruppe && A.gruppe !== 0) continue;
      if (schnittFlaeche_m2(A.polygon, B.polygon) > 1e-6) meldungen.push({ code: "gruppen-ueberlappung", a: A.e.schluessel, b: B.e.schluessel, gruppen: [A.gruppe, B.gruppe] });
    }
  }
  // stop of every layer at every joined end (rule 5); an L joint fills both walls at once
  /** @type {Map<WD, Record<"a"|"b", Halbebene[]|null>>} */
  const stopps = new Map(teil.map((W) => [W, { a: null, b: null }]));
  for (const W of teil) {
    for (const ende of /** @type {Array<"a"|"b">} */ (["a", "b"])) {
      const j = stossVon.get(W)[ende];
      const sW = /** @type {Record<"a"|"b", Halbebene[]|null>} */ (stopps.get(W));
      if (!j || sW[ende]) continue;
      if (j.art === "T") { sW[ende] = stoppT(W, j); continue; }
      // the end of the partner that joins W back at this corner (the nearest one)
      const Y = j.Y;
      /** @type {"a"|"b"|null} */
      let eY = null;
      for (const e of /** @type {Array<"a"|"b">} */ (["a", "b"])) {
        const jy = stossVon.get(Y)?.[e];
        if (jy && jy.Y === W && jy.art === "L" && (!eY || abstand(jy.P, j.P) < abstand(stossVon.get(Y)[eY].P, j.P))) eY = e;
      }
      if (!eY) { sW[ende] = W.schichten.map(() => j.fern); continue; }
      const [a, b] = stoppL(W, j, Y, stossVon.get(Y)[eY]);
      sW[ende] = a;
      /** @type {Record<"a"|"b", Halbebene[]|null>} */ (stopps.get(Y))[eY] = b;
    }
  }
  // rank (rule 4)
  const reihe = teil.flatMap((W) => W.schichten.map((S) => ({ W, S })))
    .sort((p, q) => q.S.prioritaet - p.S.prioritaet || p.W.index - q.W.index || p.S.k - q.S.k);
  /** @type {Array<{W: WD, S: any, poly: P[]}>} */
  const platziert = [];
  /** @type {Band[]} */
  const out = [];
  for (const { W, S } of reihe) {
    const st = stopps.get(W);
    // strip of the layer, long enough for every joint, then the two ends
    /** @type {Halbebene[]} */
    const enden = [];
    for (const ende of /** @type {Array<"a"|"b">} */ (["a", "b"])) {
      const halt = st?.[ende]?.[S.k];
      if (halt) enden.push(halt);
      else enden.push(ende === "a" ? { nx: -W.d.x, nz: -W.d.z, c: -punkt(W.d, W.a) } : { nx: W.d.x, nz: W.d.z, c: punkt(W.d, W.a) + W.L });
    }
    const roh = [wp(W, -VERLAENGERUNG_MAX_M, S.lo), wp(W, W.L + VERLAENGERUNG_MAX_M, S.lo), wp(W, W.L + VERLAENGERUNG_MAX_M, S.hi), wp(W, -VERLAENGERUNG_MAX_M, S.hi)];
    /** @type {P[][]} */
    // the layer extended into its joints (rule 5): one convex quadrilateral
    const max = inKonvex(roh, enden).filter((t) => flaeche(t) > MIN_FLAECHE_M2);
    // everything ranked higher in the same group is cut away (rule 5); group 0 cuts nothing
    /** @type {Region[]} */
    const abzuege = [];
    let teile = max;
    if (W.gruppe !== 0) {
      for (const x of platziert) {
        if (x.W === W || x.W.gruppe !== W.gruppe) continue;
        if (!max.some((t) => schnittFlaeche_m2(t, x.poly) > MIN_FLAECHE_M2)) continue;
        abzuege.push({ polygon: x.poly, unten_m: x.W.unten, oben_m: x.W.oben, schluessel: x.W.e.schluessel, schicht: x.S.k });
        teile = ohne(teile, x.poly);
      }
    }
    for (const poly of max) platziert.push({ W, S, poly });
    out.push({
      schluessel: W.e.schluessel, wandIndex: W.index, schicht: S.k, name: S.name, material: S.material ?? null, funktion: S.funktion,
      prioritaet: S.prioritaet, gruppe: W.gruppe, verschnitten: W.gruppe !== 0, max, teile, umrisse: umrisse(teile), flaeche_m2: summeFlaeche(teile),
      unterkante_m: W.unten, oberkante_m: W.oben, abzuege, oeffnungen: oeffnungsRegionen(W),
    });
  }
  out.sort((p, q) => p.wandIndex - q.wandIndex || p.schicht - q.schicht);
  return { baender: out, meldungen, stoesse };
}

/**
 * Outlines of convex pieces: pieces that share an edge are merged into one ring (edge cancellation of polygonVereinigung.js, the parcel
 * union of 101-03); pieces that only touch at a corner or not at all stay rings of their own. Only for drawing and the IFC profile —
 * areas and volumes use the convex pieces.
 * @param {P[][]} teile convex pieces in m
 * @returns {P[][]} rings in m
 */
export function umrisse(teile) {
  let ringe = teile.filter((t) => t.length >= 3);
  for (let weiter = true; weiter && ringe.length > 1;) {
    weiter = false;
    suche: for (let i = 0; i < ringe.length; i += 1) {
      for (let j = i + 1; j < ringe.length; j += 1) {
        const r = vereinigePolygone([ringe[i], ringe[j]].map((ring) => ring.map((p) => ({ x: p.x, y: p.z }))), { toleranz: 1e-6 });
        if (!r.ok) continue;
        ringe = [...ringe.slice(0, i), r.polygon.map((p) => ({ x: p.x, z: p.y })), ...ringe.slice(i + 1, j), ...ringe.slice(j + 1)];
        weiter = true;
        break suche;
      }
    }
  }
  return ringe;
}

/**
 * Opening footprints of a wall as regions: the hole of lochImWand (the one clamping rule of 3D, IFC and the CSG core) through the
 * whole thickness plus OEFFNUNG_UEBERSTAND_M, between sill and head (world heights).
 * @param {WD} W
 * @returns {Region[]}
 */
function oeffnungsRegionen(W) {
  const H = W.oben - W.unten;
  /** @type {Region[]} */
  const out = [];
  for (const o of W.e.oeffnungen || []) {
    const loch = lochImWand({ w: o.width, h: o.height, sill: o.sill }, o.u, W.L, H);
    if (!loch || !(loch.x1 > loch.x0) || !(loch.y1 > loch.y0)) continue;
    const s0 = W.versatz - W.D / 2 - OEFFNUNG_UEBERSTAND_M, s1 = W.versatz + W.D / 2 + OEFFNUNG_UEBERSTAND_M;
    out.push({ polygon: [wp(W, loch.x0, s0), wp(W, loch.x1, s0), wp(W, loch.x1, s1), wp(W, loch.x0, s1)], unten_m: W.unten + loch.y0, oben_m: W.unten + loch.y1, schluessel: W.e.schluessel });
  }
  return out;
}

/**
 * Exact volume of prisms over plan polygons between two heights, minus convex regions that remove material over their own height
 * interval (see file head). Every polygon is split into cells by every region; a cell loses the union of the intervals of the regions
 * covering it.
 * @param {P[][]} polys plan polygons in m (simple; may be concave)
 * @param {number} unten_m lower edge in m
 * @param {number} oben_m upper edge in m
 * @param {Region[]} [regionen] convex regions with height intervals
 * @returns {number} m³
 */
export function restVolumen_m3(polys, unten_m, oben_m, regionen = []) {
  const H = oben_m - unten_m;
  if (!(H > 0)) return 0;
  /** @type {Array<{poly: P[], iv: Array<[number, number]>}>} */
  let zellen = polys.filter((p) => p.length >= 3).map((poly) => ({ poly, iv: [] }));
  for (const r of regionen) {
    const a = Math.max(unten_m, r.unten_m), b = Math.min(oben_m, r.oben_m);
    if (!(b > a)) continue;
    const hp = halbebenenVon(r.polygon);
    /** @type {typeof zellen} */
    const neu = [];
    for (const z of zellen) {
      if (!bboxUeberlappt(z.poly, r.polygon)) { neu.push(z); continue; }
      const innen = inKonvex(z.poly, hp).filter((t) => flaeche(t) > MIN_FLAECHE_M2);
      if (!innen.length) { neu.push(z); continue; }
      for (const t of innen) neu.push({ poly: t, iv: [...z.iv, [a, b]] });
      for (const t of ohneKonvex(z.poly, hp, MIN_FLAECHE_M2)) neu.push({ poly: t, iv: z.iv });
    }
    zellen = neu;
  }
  let v = 0;
  for (const z of zellen) v += flaeche(z.poly) * (H - intervallLaenge(z.iv));
  return v;
}

/** Length of the union of intervals, m. @param {Array<[number, number]>} iv @returns {number} */
function intervallLaenge(iv) {
  const s = [...iv].sort((p, q) => p[0] - q[0]);
  let l = 0, bis = -Infinity;
  for (const [a, b] of s) {
    if (b <= bis) continue;
    l += b - Math.max(a, bis);
    bis = b;
  }
  return l;
}

/**
 * Analytic volume of ONE band in m³: its extended layer between its lower and upper edge, minus the higher-ranked layers it was cut by
 * (over their own heights) and minus the openings of its wall — exactly what the solid of solidAbleitung.js subtracts.
 * @param {Band} band
 * @returns {number} m³
 */
export function bandVolumen_m3(band) {
  return restVolumen_m3(band.max, band.unterkante_m, band.oberkante_m, [...band.abzuege, ...band.oeffnungen]);
}

/**
 * Plan area of bands in m² (the cleaned pieces).
 * @param {Band[]} liste
 * @returns {number} m²
 */
export function baenderFlaeche_m2(liste) {
  return (Array.isArray(liste) ? liste : []).reduce((s, b) => s + b.flaeche_m2, 0);
}

/**
 * Analytic reference volume of bands in m³ (D-BK-07: area × height, openings subtracted). Without `hoehe_m` every band uses its own
 * lower/upper edge, the regions it was cut by and its wall's openings (bandVolumen_m3). With `hoehe_m` the cleaned pieces are taken
 * as prisms of that height from 0, minus the given opening regions (heights from 0) — the plain rule of the plan text.
 * @param {Band[]} liste
 * @param {number|null} [hoehe_m] uniform height in m, or null
 * @param {Region[]|null} [oeffnungen] opening regions for the uniform rule
 * @returns {number} m³
 */
export function baenderVolumen_m3(liste, hoehe_m = null, oeffnungen = null) {
  const l = Array.isArray(liste) ? liste : [];
  if (hoehe_m == null) return l.reduce((s, b) => s + bandVolumen_m3(b), 0);
  return l.reduce((s, b) => s + restVolumen_m3(b.teile, 0, hoehe_m, oeffnungen || []), 0);
}

/**
 * Input entries of the BIM studio for baender(): hull walls first (model order: storey, edge — they exist before anything is drawn),
 * then the drawn walls by `_idx` (draw order). Heights from the storey source (hoehen.js), like 3D and IFC.
 * @param {any} model createBuildingModel result
 * @param {any[]} customWalls drawn walls
 * @param {{geschosse?: import("./hoehen.js").Geschosse, oeffnungen?: Map<string, Array<{u?: number|null, width: number, height: number, sill: number}>>, guids?: Map<string, string>}} [opt]
 *   oeffnungen: resolved opening sizes per wall key; guids: element GUID per wall key (cache key of the solids)
 * @returns {VerschneidungsWand[]}
 */
export function verschneidungsWaende(model, customWalls = [], opt = {}) {
  /** @type {VerschneidungsWand[]} */
  const out = [];
  const mit = (/** @type {string} */ k) => ({ oeffnungen: opt.oeffnungen?.get(k) || [], guid: opt.guids?.get(k) });
  for (const w of model?.walls || []) {
    const k = `env:${w.level}:${w.edge}`;
    out.push({ schluessel: k, wand: w, unterkante_m: Number.isFinite(w.elevation) ? w.elevation : unterkante(w, opt.geschosse), hoehe_m: Number.isFinite(w.height) ? w.height : wandHoehe(w, opt.geschosse), ...mit(k) });
  }
  for (const w of [...(customWalls || [])].sort((p, q) => (Number(p._idx) || 0) - (Number(q._idx) || 0))) {
    if (!w?.a || !w?.b) continue;
    const k = `cw:${w._idx}`;
    out.push({ schluessel: k, wand: { ...w, level: Number(w.level) || 0 }, unterkante_m: unterkante(w, opt.geschosse), hoehe_m: wandHoehe(w, opt.geschosse), ...mit(k) });
  }
  return out;
}

/**
 * Bands of every storey of a set of entries.
 * @param {VerschneidungsWand[]} eintraege
 * @param {{geschosse?: import("./hoehen.js").Geschosse, aufbauVon?: (el: any) => any}} [opt]
 * @returns {{jeGeschoss: Map<number, ReturnType<typeof baender>>, jeSchluessel: Map<string, Band[]>, meldungen: Meldung[]}}
 */
export function modellBaender(eintraege, opt = {}) {
  const level = [...new Set((eintraege || []).map((e) => Number(e?.wand?.level) || 0))].sort((p, q) => p - q);
  const jeGeschoss = new Map();
  /** @type {Map<string, Band[]>} */
  const jeSchluessel = new Map();
  /** @type {Meldung[]} */
  const meldungen = [];
  for (const l of level) {
    const r = baender(eintraege, l, opt.aufbauVon || aufbauVonStandard, opt);
    jeGeschoss.set(l, r);
    for (const b of r.baender) {
      if (!jeSchluessel.has(b.schluessel)) jeSchluessel.set(b.schluessel, []);
      /** @type {Band[]} */ (jeSchluessel.get(b.schluessel)).push(b);
    }
    meldungen.push(...r.meldungen);
  }
  return { jeGeschoss, jeSchluessel, meldungen };
}
