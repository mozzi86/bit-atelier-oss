// 115-12 (D-115-47): rooms edited by hand in the apartment planner (WohnungsWerkstatt) — the pure geometry behind
// "click a room, type its size, drag its edges, move it".
//
// Why a solver INPUT and not geometry: the ·WT zones are regenerated from the layer on every load and on every rule
// change (useWerkstattRehydrate) — a point edit in the store would be lost. So a hand edit is stored per room in
// werkstatt_layer.raumHand and re-applied right after the room slicing and the interior-wall offsets (75-12,
// raumGrenzen.js); every later step (escape route, balconies, wall segments, quality checks) sees the hand room.
//
// "Hand locks rule" [ASSUMED — D-115-47 left it open; decision of plan 115-12]: a room with an entry keeps the typed
// SIZE whatever the rules do afterwards; its POSITION is stored relative to the corner where the rule puts the room
// (so the room follows its apartment when the unit mix shifts the apartment along the band). Removing the entry
// ("Auf Regel zurücksetzen") gives the rule room back. Old layers without `raumHand` behave exactly as before.
//
// Frame: every room rectangle has its own frame — origin o = first corner of the RULE room, u = direction of edge
// 0 (corner 0 → 1), v = direction of edge 3 reversed (corner 0 → 3), both unit vectors. A rectangle is
// {a0, a1, c0, c1} in metres along u / v. Offsets and lengths are scalars, so the entry is frame-invariant (rotated
// footprints 86-01 and bars 86-03 compute in a local frame and turn the points afterwards). The corner order is
// kept — door records (`tueren[].wand`) and `fensterwand` are edge indices.
//
// Snapping reuses the edge-drag snap chain of the core (@core/lib/snapKette.js: snapKette, rasterSnap, FANG_M): first
// target = an edge of a neighbouring room or of the apartment outline within the capture distance, second target =
// the octametre grid; Alt bypasses both. Clamps (minimum size, apartment outline) always beat a snap.
//
// Limits (named in the UI): only RECTANGULAR rooms of a unit are editable (the L-shaped hall and rooms widened by a
// slanted facade are polygons); the apartment outline is the bounding box of the unit's rooms in the room frame
// [ASSUMED: exact for rectangular units, generous in the notch of an L-shaped Escher pair]; overlaps with
// neighbouring rooms are allowed and reported as a hint (a fully tiled apartment leaves no free space to move into).
//
// In:  zones (tesseliere / store shape: points [{x,z}] in m, level, we, name, raumart, art, tueren, hand?),
//      the raumHand map. Out: rectangles in frame metres, new zones + hints. No DOM, no React; node-testable.

import { snapKette, rasterSnap, FANG_M } from "@core/lib/snapKette.js";
import { RAUMGRENZE_RASTER_M, RAUMGRENZE_MIN_BREITE_M, istRechteckZone, tuerNachziehen } from "./raumGrenzen.js";

/** @typedef {{x: number, z: number}} Pkt plan metres */
/** @typedef {{o: Pkt, u: Pkt, v: Pkt}} Rahmen origin (rule corner 0, m) and the two unit vectors of the room */
/** @typedef {{a0: number, a1: number, c0: number, c1: number}} Rechteck extent along u (a) and v (c), metres in the room frame */
/** @typedef {{versatzU_m: number, versatzV_m: number, laengeU_m: number, laengeV_m: number}} HandEintrag
 *  werkstatt_layer.raumHand value: offset of corner 0 from the rule corner and the two side lengths, metres */
/** @typedef {{versatzU_m: number, versatzV_m: number, regelU_m: number, regelV_m: number}} HandMarke
 *  marker on a hand-edited zone (`zone.hand`): applied offset and the side lengths the RULE gave, metres */
/** @typedef {{a: -1|0|1, c: -1|0|1}} Seiten which side a handle moves: −1 = the a0 / c0 side, +1 = the a1 / c1 side, 0 = none */
/**
 * @typedef {object} BearbeitenOptionen
 * @property {Rechteck} [grenzen] apartment outline in the room frame (m); missing = unbounded
 * @property {{a: number[], c: number[]}} [linien] snap lines (m): edges of the neighbours and of the outline
 * @property {{u_m: number, v_m: number}} [min] smallest side lengths (m); missing = RAUM_HAND_MIN_M
 * @property {number} [fang_m] capture distance of the edge snap (m), default RAUM_HAND_FANG_M
 * @property {number} [raster_m] grid (m), default RAUM_HAND_RASTER_M
 * @property {boolean} [kantenfang] snap to neighbour / outline edges (default true)
 * @property {boolean} [raster] snap to the grid (default true)
 * @property {boolean} [alt] true = no snapping at all (Alt held, or an exact keyboard step)
 */

/** Grid of a hand edit and of an arrow-key step (m): octametre 12.5 cm, DIN 4172 — the grid the workshop walls sit on (75-12). */
export const RAUM_HAND_RASTER_M = RAUMGRENZE_RASTER_M;
/**
 * Smallest side a hand edit may leave (m) [ASSUMED 1.20 m = apartment corridor minimum, same value as the interior-wall
 * move 75-12; a storage room the RULE made narrower may stay as narrow, it just cannot get narrower]. A side also never
 * gets shorter than the widest door on it.
 */
export const RAUM_HAND_MIN_M = RAUMGRENZE_MIN_BREITE_M;
/** Capture distance of the edge snap (m) [ASSUMED 0.30 m = FANG_M of the core snap chain; the UI lowers it when zoomed in]. */
export const RAUM_HAND_FANG_M = FANG_M;
/** Overlap below this area is not reported (m²) [ASSUMED 0.01 m² = rounding noise of shared edges]. */
export const RAUM_HAND_UEBERLAPPUNG_MIN_M2 = 0.01;

const EPS = 1e-6;
const num = (/** @type {any} */ v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r6 = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
const pkt = (/** @type {any} */ p) => ({ x: num(p?.x), z: num(p?.z) });
const f2 = (/** @type {number} */ v) => (Math.round(num(v) * 100) / 100).toFixed(2).replace(".", ",");
const raumKurz = (/** @type {string} */ s) => String(s).replace(/ ·WT$/, "");

/**
 * Key of a room in werkstatt_layer.raumHand: "<level>|<zone name>". Zone names do not depend on the cut
 * ("Schlafen (WE 0-1) ·WT"), so the key survives every regeneration.
 * @param {number} level storey index
 * @param {string} name zone name
 * @returns {string}
 */
export function raumHandSchluessel(level, name) {
  return `${Math.round(num(level))}|${String(name)}`;
}

/**
 * May this zone be edited by hand? A room of a unit, rectangular, no balcony (outside the envelope, owned by the
 * balcony rule 75-13) and no house stair (owned by the stair geometry).
 * @param {any} z zone
 * @returns {boolean}
 */
export function istBearbeitbar(z) {
  return !!z && !!z.we && z.raumart !== "balkon" && z.art !== "treppe" && istRechteckZone(z);
}

/**
 * Frame, current rectangle and rule size of a rectangular room. A zone that already carries the hand marker is read
 * back to its RULE frame (origin = where the rule put corner 0), so editing it again starts from the same origin.
 * @param {any} zone zone with 4 right-angled points (m)
 * @returns {{rahmen: Rahmen, rechteck: Rechteck, regel: {u_m: number, v_m: number}, hand: boolean}|null} null when
 *   the zone is not a rectangle; rechteck / regel in metres
 */
export function raumGeometrie(zone) {
  if (!istRechteckZone(zone)) return null;
  const p0 = pkt(zone.points[0]), p1 = pkt(zone.points[1]), p3 = pkt(zone.points[3]);
  const lu = Math.hypot(p1.x - p0.x, p1.z - p0.z), lv = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  const u = { x: (p1.x - p0.x) / lu, z: (p1.z - p0.z) / lu }, v = { x: (p3.x - p0.x) / lv, z: (p3.z - p0.z) / lv };
  const h = zone.hand && typeof zone.hand === "object" ? zone.hand : null;
  const a0 = h ? num(h.versatzU_m) : 0, c0 = h ? num(h.versatzV_m) : 0;
  return {
    rahmen: { o: { x: p0.x - u.x * a0 - v.x * c0, z: p0.z - u.z * a0 - v.z * c0 }, u, v },
    rechteck: { a0, a1: a0 + lu, c0, c1: c0 + lv },
    regel: { u_m: h && num(h.regelU_m) > 0 ? num(h.regelU_m) : lu, v_m: h && num(h.regelV_m) > 0 ? num(h.regelV_m) : lv },
    hand: !!h,
  };
}

/**
 * A plan point in room-frame coordinates.
 * @param {Pkt} p plan metres
 * @param {Rahmen} rahmen
 * @returns {{a: number, c: number}} metres along u / v from the origin
 */
export function inRahmen(p, rahmen) {
  const dx = num(p.x) - rahmen.o.x, dz = num(p.z) - rahmen.o.z;
  return { a: dx * rahmen.u.x + dz * rahmen.u.z, c: dx * rahmen.v.x + dz * rahmen.v.z };
}

/**
 * The four corners of a frame rectangle in plan metres, in the zone's corner order (0 → 1 along u, 0 → 3 along v).
 * @param {Rahmen} rahmen
 * @param {Rechteck} r metres in the room frame
 * @returns {Pkt[]}
 */
export function punkteAus(rahmen, r) {
  const p = (/** @type {number} */ a, /** @type {number} */ c) => ({ x: rahmen.o.x + rahmen.u.x * a + rahmen.v.x * c, z: rahmen.o.z + rahmen.u.z * a + rahmen.v.z * c });
  return [p(r.a0, r.c0), p(r.a1, r.c0), p(r.a1, r.c1), p(r.a0, r.c1)];
}

/**
 * Width × depth of a rectangular room as the plan shows it: "Breite" runs along the room side that lies more
 * horizontally on the sheet, "Tiefe" along the other one.
 * @param {any} zone
 * @returns {{breite_m: number, tiefe_m: number, flaeche_m2: number, breiteAchse: "u"|"v", regelBreite_m: number, regelTiefe_m: number}|null}
 *   null for a zone that is not a rectangle; lengths in m, area in m²
 */
export function raumMasse(zone) {
  const g = raumGeometrie(zone);
  if (!g) return null;
  const lu = g.rechteck.a1 - g.rechteck.a0, lv = g.rechteck.c1 - g.rechteck.c0;
  const breiteAchse = Math.abs(g.rahmen.u.x) >= Math.abs(g.rahmen.u.z) ? "u" : "v";
  return breiteAchse === "u"
    ? { breite_m: lu, tiefe_m: lv, flaeche_m2: lu * lv, breiteAchse, regelBreite_m: g.regel.u_m, regelTiefe_m: g.regel.v_m }
    : { breite_m: lv, tiefe_m: lu, flaeche_m2: lu * lv, breiteAchse, regelBreite_m: g.regel.v_m, regelTiefe_m: g.regel.u_m };
}

/**
 * Smallest side lengths a hand edit of this room may leave (m): RAUM_HAND_MIN_M or the widest door on a wall along
 * that side, whichever is larger — but never more than the side is long now (a room the rule made narrower stays).
 * @param {any} zone rectangular zone (door records { wand, breite_m })
 * @returns {{u_m: number, v_m: number}}
 */
export function minMasse(zone) {
  const g = raumGeometrie(zone);
  let u = RAUM_HAND_MIN_M, v = RAUM_HAND_MIN_M;
  for (const t of Array.isArray(zone?.tueren) ? zone.tueren : []) {
    const i = Math.round(num(t?.wand, -1));
    // edges 0 and 2 run along u, edges 1 and 3 along v
    if (i === 0 || i === 2) u = Math.max(u, num(t.breite_m));
    else if (i === 1 || i === 3) v = Math.max(v, num(t.breite_m));
  }
  if (!g) return { u_m: u, v_m: v };
  return { u_m: Math.min(u, g.rechteck.a1 - g.rechteck.a0), v_m: Math.min(v, g.rechteck.c1 - g.rechteck.c0) };
}

/**
 * What surrounds a room: the apartment outline (bounding box of the unit's rooms of that storey in the room frame,
 * balconies excluded) and the snap lines (every corner coordinate of the other rooms plus the outline).
 * A neighbour that was itself moved by hand still counts with its RULE rectangle for the outline, so the outline
 * does not shrink when a room leaves the apartment edge.
 * @param {Array<any>} zonen zones of any storeys / units (rule state or with hand rooms)
 * @param {any} zone the room (rectangular)
 * @returns {{grenzen: Rechteck, linien: {a: number[], c: number[]}}|null} metres in the room frame; null when the
 *   room is not a rectangle
 */
export function raumUmgebung(zonen, zone) {
  const g = raumGeometrie(zone);
  if (!g) return null;
  const lvl = Math.round(num(zone.level));
  const grenzen = { a0: 0, a1: g.regel.u_m, c0: 0, c1: g.regel.v_m }; // the room's own rule rectangle
  /** @type {number[]} */
  const la = [];
  /** @type {number[]} */
  const lc = [];
  const merke = (/** @type {number[]} */ liste, /** @type {number} */ w) => { if (!liste.some((x) => Math.abs(x - w) < EPS)) liste.push(w); };
  const weite = (/** @type {{a: number, c: number}} */ q) => {
    grenzen.a0 = Math.min(grenzen.a0, q.a); grenzen.a1 = Math.max(grenzen.a1, q.a);
    grenzen.c0 = Math.min(grenzen.c0, q.c); grenzen.c1 = Math.max(grenzen.c1, q.c);
  };
  for (const z of Array.isArray(zonen) ? zonen : []) {
    if (!z || z === zone || !Array.isArray(z.points) || z.raumart === "balkon") continue;
    if (String(z.we ?? "") !== String(zone.we ?? "") || Math.round(num(z.level)) !== lvl) continue;
    if (String(z.name) === String(zone.name)) continue;
    for (const p of z.points) { const q = inRahmen(p, g.rahmen); weite(q); merke(la, q.a); merke(lc, q.c); }
    const gn = z.hand ? raumGeometrie(z) : null;
    if (gn) for (const p of punkteAus(gn.rahmen, { a0: 0, a1: gn.regel.u_m, c0: 0, c1: gn.regel.v_m })) weite(inRahmen(p, g.rahmen));
  }
  for (const w of [grenzen.a0, grenzen.a1]) merke(la, w);
  for (const w of [grenzen.c0, grenzen.c1]) merke(lc, w);
  return { grenzen, linien: { a: la.sort((x, y) => x - y), c: lc.sort((x, y) => x - y) } };
}

/** @param {BearbeitenOptionen} o @returns {{grenzen: Rechteck, la: number[], lc: number[], minU: number, minV: number, fang_m: number, raster_m: number, kantenfang: boolean, raster: boolean, alt: boolean}} */
function einstellungen(o) {
  const g = o?.grenzen;
  return {
    grenzen: { a0: num(g?.a0, -Infinity), a1: num(g?.a1, Infinity), c0: num(g?.c0, -Infinity), c1: num(g?.c1, Infinity) },
    la: Array.isArray(o?.linien?.a) ? o.linien.a : [], lc: Array.isArray(o?.linien?.c) ? o.linien.c : [],
    minU: num(o?.min?.u_m, RAUM_HAND_MIN_M), minV: num(o?.min?.v_m, RAUM_HAND_MIN_M),
    fang_m: num(o?.fang_m, RAUM_HAND_FANG_M) > 0 ? num(o?.fang_m, RAUM_HAND_FANG_M) : RAUM_HAND_FANG_M,
    raster_m: num(o?.raster_m, RAUM_HAND_RASTER_M) > 0 ? num(o?.raster_m, RAUM_HAND_RASTER_M) : RAUM_HAND_RASTER_M,
    kantenfang: o?.kantenfang !== false, raster: o?.raster !== false, alt: o?.alt === true,
  };
}

/**
 * Snap the displacement of one or two parallel edges through the core snap chain: edge of a neighbour / of the
 * outline first, then the grid (the displacement is rounded, so the edge stays on the grid relative to where it was).
 * @param {number[]} kanten current positions of the moving edges (m) — one for a resize, both for a move
 * @param {number} d wished displacement (m)
 * @param {number[]} linien snap lines (m)
 * @param {ReturnType<typeof einstellungen>} e
 * @returns {{d: number, linie: number|null}} snapped displacement (m) and the line that caught an edge (m) or null
 */
function fangen(kanten, d, linien, e) {
  /** @type {number|null} */
  let linie = null;
  /** @type {Array<((d: number) => number|null) & {zielName?: string}>} */
  const ziele = [];
  if (e.kantenfang && linien.length) {
    ziele.push(Object.assign((/** @type {number} */ dd) => {
      /** @type {number|null} */
      let best = null;
      let bestAbstand = e.fang_m;
      for (const l of linien) {
        for (const k of kanten) {
          const abstand = Math.abs(l - (k + dd));
          if (abstand <= bestAbstand) { bestAbstand = abstand; best = l - k; linie = l; }
        }
      }
      return best;
    }, { zielName: "kante" }));
  }
  if (e.raster) ziele.push(Object.assign((/** @type {number} */ dd) => rasterSnap(dd, e.raster_m), { zielName: "raster" }));
  const s = snapKette(num(d), ziele, { alt: e.alt });
  return { d: s.d, linie: s.ziel === "kante" ? linie : null };
}

/**
 * Drag a handle: move one side (edge handle) or two sides (corner handle) of the rectangle. The opposite sides stay.
 * Snap: neighbour / outline edge, then grid; clamps: the room keeps its minimum size and stays inside the outline.
 * @param {Rechteck} r rectangle at the START of the drag (m)
 * @param {Seiten} seiten which sides the handle moves
 * @param {{da: number, dc: number}} delta pointer displacement since the start, metres along u / v
 * @param {BearbeitenOptionen} [o]
 * @returns {{rechteck: Rechteck, fang: {a: number|null, c: number|null}}} new rectangle (m) and the snap lines that
 *   hold an edge (m, for the display) — null when the grid, a clamp or nothing decided
 */
export function groesseAendern(r, seiten, delta, o = {}) {
  const e = einstellungen(o);
  /**
   * @param {number} lo @param {number} hi @param {-1|0|1} seite @param {number} d @param {number[]} linien
   * @param {number} gLo @param {number} gHi @param {number} min
   * @returns {{lo: number, hi: number, fang: number|null}}
   */
  const achse = (lo, hi, seite, d, linien, gLo, gHi, min) => {
    if (seite < 0) {
      const s = fangen([lo], d, linien, e);
      const wunsch = lo + s.d;
      const neu = Math.min(Math.max(wunsch, gLo), hi - min);
      return { lo: neu, hi, fang: s.linie !== null && Math.abs(neu - wunsch) < EPS ? s.linie : null };
    }
    if (seite > 0) {
      const s = fangen([hi], d, linien, e);
      const wunsch = hi + s.d;
      const neu = Math.max(Math.min(wunsch, gHi), lo + min);
      return { lo, hi: neu, fang: s.linie !== null && Math.abs(neu - wunsch) < EPS ? s.linie : null };
    }
    return { lo, hi, fang: null };
  };
  const a = achse(r.a0, r.a1, seiten?.a ?? 0, num(delta?.da), e.la, e.grenzen.a0, e.grenzen.a1, e.minU);
  const c = achse(r.c0, r.c1, seiten?.c ?? 0, num(delta?.dc), e.lc, e.grenzen.c0, e.grenzen.c1, e.minV);
  return { rechteck: { a0: a.lo, a1: a.hi, c0: c.lo, c1: c.hi }, fang: { a: a.fang, c: c.fang } };
}

/**
 * Move the whole room: the size stays, either parallel edge may catch a snap line (the nearer catch wins), else the
 * displacement snaps to the grid; the room stays inside the apartment outline.
 * @param {Rechteck} r rectangle at the START of the move (m)
 * @param {{da: number, dc: number}} delta displacement, metres along u / v
 * @param {BearbeitenOptionen} [o] `alt: true` = exact displacement (arrow keys step by the grid themselves)
 * @returns {{rechteck: Rechteck, fang: {a: number|null, c: number|null}}}
 */
export function verschieben(r, delta, o = {}) {
  const e = einstellungen(o);
  /**
   * @param {number} lo @param {number} hi @param {number} d @param {number[]} linien @param {number} gLo @param {number} gHi
   * @returns {{lo: number, hi: number, fang: number|null}}
   */
  const achse = (lo, hi, d, linien, gLo, gHi) => {
    const len = hi - lo;
    if (Math.abs(d) < EPS) return { lo, hi, fang: null };
    const s = fangen([lo, hi], d, linien, e);
    const wunsch = lo + s.d;
    // a room longer than the outline (cannot happen through the editor) sits at the outline start
    const neu = Math.max(gLo, Math.min(wunsch, gHi - len));
    return { lo: neu, hi: neu + len, fang: s.linie !== null && Math.abs(neu - wunsch) < EPS ? s.linie : null };
  };
  const a = achse(r.a0, r.a1, num(delta?.da), e.la, e.grenzen.a0, e.grenzen.a1);
  const c = achse(r.c0, r.c1, num(delta?.dc), e.lc, e.grenzen.c0, e.grenzen.c1);
  return { rechteck: { a0: a.lo, a1: a.hi, c0: c.lo, c1: c.hi }, fang: { a: a.fang, c: c.fang } };
}

/**
 * Typed sizes: set one or both side lengths. Corner 0 stays where it is; when the room would leave the apartment
 * outline it is pushed back inside, and a length beyond the outline or below the minimum is clamped (reported).
 * No snapping — a typed value is exact.
 * @param {Rechteck} r current rectangle (m)
 * @param {{u_m?: number, v_m?: number}} masse wished side lengths (m); a missing / invalid one keeps its side
 * @param {BearbeitenOptionen} [o]
 * @returns {{rechteck: Rechteck, geklemmt: {u: boolean, v: boolean}}} geklemmt = the typed value could not be kept
 */
export function masseSetzen(r, masse, o = {}) {
  const e = einstellungen(o);
  /**
   * @param {number} lo @param {number} hi @param {any} wunsch @param {number} gLo @param {number} gHi @param {number} min
   * @returns {{lo: number, hi: number, geklemmt: boolean}}
   */
  const achse = (lo, hi, wunsch, gLo, gHi, min) => {
    if (wunsch === undefined || wunsch === null || !Number.isFinite(Number(wunsch))) return { lo, hi, geklemmt: false };
    const w = Number(wunsch);
    const len = Math.max(min, Math.min(w, gHi - gLo));
    const neu = Math.max(gLo, Math.min(lo, gHi - len));
    return { lo: neu, hi: neu + len, geklemmt: Math.abs(len - w) > EPS };
  };
  const a = achse(r.a0, r.a1, masse?.u_m, e.grenzen.a0, e.grenzen.a1, e.minU);
  const c = achse(r.c0, r.c1, masse?.v_m, e.grenzen.c0, e.grenzen.c1, e.minV);
  return { rechteck: { a0: a.lo, a1: a.hi, c0: c.lo, c1: c.hi }, geklemmt: { u: a.geklemmt, v: c.geklemmt } };
}

/**
 * One keyboard step in a sheet direction, expressed in the room frame: the step runs along the frame axis that lies
 * closest to the wished direction (a rotated room moves along its own walls, not across them).
 * @param {Rahmen} rahmen
 * @param {Pkt} richtung sheet direction, e.g. {x: 1, z: 0} = right, {x: 0, z: -1} = up (z grows downwards on the sheet)
 * @param {number} [schritt] step in m, default RAUM_HAND_RASTER_M
 * @returns {{da: number, dc: number}} metres along u / v
 */
export function rahmenSchritt(rahmen, richtung, schritt = RAUM_HAND_RASTER_M) {
  const s = num(schritt, RAUM_HAND_RASTER_M);
  const pu = num(richtung?.x) * rahmen.u.x + num(richtung?.z) * rahmen.u.z;
  const pv = num(richtung?.x) * rahmen.v.x + num(richtung?.z) * rahmen.v.z;
  if (Math.abs(pu) < EPS && Math.abs(pv) < EPS) return { da: 0, dc: 0 };
  return Math.abs(pu) >= Math.abs(pv) ? { da: Math.sign(pu) * s, dc: 0 } : { da: 0, dc: Math.sign(pv) * s };
}

/**
 * The layer entry of a rectangle — or null when it is the rule rectangle again (the room is then no hand room).
 * @param {Rechteck} r rectangle in the room frame (m)
 * @param {{u_m: number, v_m: number}} regel side lengths the rule gave (m)
 * @returns {HandEintrag|null} values rounded to 1 µm (keeps a snapped edge on its neighbour's edge)
 */
export function eintragAus(r, regel) {
  const lu = r.a1 - r.a0, lv = r.c1 - r.c0;
  if (Math.abs(r.a0) < 1e-4 && Math.abs(r.c0) < 1e-4 && Math.abs(lu - num(regel?.u_m)) < 1e-4 && Math.abs(lv - num(regel?.v_m)) < 1e-4) return null;
  return { versatzU_m: r6(r.a0), versatzV_m: r6(r.c0), laengeU_m: r6(lu), laengeV_m: r6(lv) };
}

/**
 * The raumHand map with one entry set or removed (a new object, the input is not mutated).
 * @param {Record<string, HandEintrag>|null|undefined} karte werkstatt_layer.raumHand
 * @param {string} key raumHandSchluessel
 * @param {HandEintrag|null} eintrag null removes the entry ("Auf Regel zurücksetzen")
 * @returns {Record<string, HandEintrag>}
 */
export function raumHandSetzen(karte, key, eintrag) {
  /** @type {Record<string, HandEintrag>} */
  const neu = { ...(karte && typeof karte === "object" ? karte : {}) };
  if (eintrag) neu[key] = eintrag; else delete neu[key];
  return neu;
}

/** @param {any} e @returns {e is HandEintrag} a usable entry (finite offsets, positive lengths) */
function gueltig(e) {
  return !!e && typeof e === "object" && Number.isFinite(Number(e.versatzU_m)) && Number.isFinite(Number(e.versatzV_m))
    && Number(e.laengeU_m) > 0 && Number(e.laengeV_m) > 0;
}

/** Shoelace area (m²). @param {Pkt[]} pts */
function flaeche(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.z - b.x * a.z; }
  return Math.abs(s) / 2;
}

/**
 * Area two rooms share (m²): the subject polygon (any simple polygon, e.g. the L-shaped hall) clipped against a
 * CONVEX polygon (the hand rectangle) — Sutherland–Hodgman; a concave subject may leave degenerate edges, the
 * shoelace area is still exact.
 * @param {Pkt[]} subjekt polygon (m)
 * @param {Pkt[]} konvex convex clip polygon (m), any orientation
 * @returns {number} m²
 */
export function ueberlappung(subjekt, konvex) {
  let aus = (Array.isArray(subjekt) ? subjekt : []).map(pkt);
  const cl = (Array.isArray(konvex) ? konvex : []).map(pkt);
  if (aus.length < 3 || cl.length < 3) return 0;
  let orient = 0;
  for (let i = 0; i < cl.length; i++) { const a = cl[i], b = cl[(i + 1) % cl.length]; orient += a.x * b.z - b.x * a.z; }
  const vz = orient >= 0 ? 1 : -1;
  for (let i = 0; i < cl.length && aus.length; i++) {
    const a = cl[i], b = cl[(i + 1) % cl.length];
    const seite = (/** @type {Pkt} */ p) => vz * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
    const ein = aus;
    aus = [];
    for (let j = 0; j < ein.length; j++) {
      const p = ein[j], q = ein[(j + 1) % ein.length];
      const sp = seite(p), sq = seite(q);
      if (sp >= 0) aus.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); aus.push({ x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) }); }
    }
  }
  return aus.length >= 3 ? flaeche(aus) : 0;
}

/** @param {string} key @param {boolean} da zone exists but is no rectangle any more @returns {string} */
function fehlendHinweis(key, da) {
  const i = String(key).indexOf("|");
  const name = raumKurz(String(key).slice(i + 1)), level = String(key).slice(0, i);
  return da
    ? `Raum von Hand [115-12]: „${name}" (Geschoss ${level}) ist im aktuellen Grundriss kein Rechteck — das Handmaß wirkt nicht (Eintrag bleibt gespeichert; im Wohnungsplaner „Auf Regel zurücksetzen")`
    : `Raum von Hand [115-12]: „${name}" (Geschoss ${level}) gibt es im aktuellen Grundriss nicht mehr — das Handmaß wirkt nicht (Eintrag bleibt gespeichert)`;
}

/**
 * Hints for stored entries that act on nothing in `zonen` (layout changed). Used by the bar path (86-03) after
 * merging all bars — each bar only sees its own rooms (see wendeRaumHandAn opts.fehlendMelden).
 * @param {Array<any>} zonen merged zones (hand rooms carry `hand`)
 * @param {Record<string, any>|null|undefined} raumHand werkstatt_layer.raumHand
 * @returns {string[]}
 */
export function raumHandFehlend(zonen, raumHand) {
  if (!raumHand || typeof raumHand !== "object") return [];
  const keys = Object.keys(raumHand).filter((k) => gueltig(raumHand[k])).sort();
  if (!keys.length) return [];
  /** @type {Map<string, any>} */
  const jeKey = new Map();
  for (const z of Array.isArray(zonen) ? zonen : []) if (z && z.we) jeKey.set(raumHandSchluessel(z.level, z.name), z);
  const out = [];
  for (const k of keys) {
    const z = jeKey.get(k);
    if (!z) out.push(fehlendHinweis(k, false));
    else if (!z.hand && !istBearbeitbar(z)) out.push(fehlendHinweis(k, true));
  }
  return out;
}

/**
 * Apply the stored hand rooms to a zone list (right after the room slicing and the interior-wall offsets).
 * - No (valid) entry → the SAME array is returned (byte-identical tessellation; old layers have no `raumHand`).
 * - An entry replaces the rule rectangle of its room: side lengths as stored (hand locks rule), corner 0 at the
 *   stored offset from the rule corner; the result is pushed back into the apartment outline when the apartment
 *   changed (hint). A length is never forced below what the editor allows (RAUM_HAND_MIN_M, or the rule length
 *   when the rule room is narrower).
 * - Hand rooms: new points (corner order kept), `flaeche_m2` recomputed (m²), doors kept at their world position
 *   where the wall still passes there, and the additive marker `hand` ({ versatzU_m, versatzV_m, regelU_m, regelV_m }).
 *   All other zones are the SAME objects.
 * - Overlaps with other rooms of the unit are a HINT (warn, not fail, and never corrected): the architect placed the
 *   room on purpose, and in a fully tiled apartment every move overlaps a neighbour until that one is resized too.
 * - An entry whose room no longer exists (or is no rectangle any more) stays in the layer and is reported once.
 * @param {Array<any>} zonen zones after room slicing / interior-wall offsets (local or world frame)
 * @param {Record<string, any>|null|undefined} raumHand werkstatt_layer.raumHand ({ "<level>|<name>": HandEintrag }, m)
 * @param {{fehlendMelden?: boolean}} [opts] fehlendMelden = false: stay silent about entries without a room (the bar
 *   path 86-03 runs the solver per bar and reports the globally missing ones once via raumHandFehlend)
 * @returns {{zonen: Array<any>, hinweise: string[], angewendet: Record<string, HandEintrag>}} angewendet = key →
 *   the rectangle actually applied (m)
 */
export function wendeRaumHandAn(zonen, raumHand, opts = {}) {
  const eintraege = raumHand && typeof raumHand === "object"
    ? Object.entries(raumHand).filter(([, v]) => gueltig(v)).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))
    : [];
  if (!eintraege.length || !Array.isArray(zonen)) return { zonen, hinweise: [], angewendet: {} };
  const liste = zonen.slice();
  /** @type {string[]} */
  const hinweise = [];
  /** @type {Record<string, HandEintrag>} */
  const angewendet = {};
  /** @type {number[]} */
  const handIdx = [];
  for (const [key, e] of eintraege) {
    const i = zonen.findIndex((z) => z && z.we && raumHandSchluessel(z.level, z.name) === key);
    const z = i >= 0 ? zonen[i] : null;
    const g = z && istBearbeitbar(z) ? raumGeometrie(z) : null;
    const um = g ? raumUmgebung(zonen, z) : null;
    if (!z || !g || !um) {
      if (opts.fehlendMelden !== false) hinweise.push(fehlendHinweis(key, !!z));
      continue;
    }
    const gr = um.grenzen;
    const minU = Math.min(RAUM_HAND_MIN_M, g.regel.u_m), minV = Math.min(RAUM_HAND_MIN_M, g.regel.v_m);
    const lu = Math.max(minU, Math.min(Number(e.laengeU_m), gr.a1 - gr.a0)), lv = Math.max(minV, Math.min(Number(e.laengeV_m), gr.c1 - gr.c0));
    const a0 = Math.max(gr.a0, Math.min(Number(e.versatzU_m), gr.a1 - lu)), c0 = Math.max(gr.c0, Math.min(Number(e.versatzV_m), gr.c1 - lv));
    const r = { a0, a1: a0 + lu, c0, c1: c0 + lv };
    if (Math.abs(lu - Number(e.laengeU_m)) > 1e-3 || Math.abs(lv - Number(e.laengeV_m)) > 1e-3 || Math.abs(a0 - Number(e.versatzU_m)) > 1e-3 || Math.abs(c0 - Number(e.versatzV_m)) > 1e-3) {
      hinweise.push(`Raum von Hand [115-12]: „${raumKurz(z.name)}" passt mit dem Handmaß nicht mehr in die Wohnung — angepasst auf ${f2(lu)} × ${f2(lv)} m (Wohnungsumriss geändert)`);
    }
    if (!eintragAus(r, g.regel)) continue; // back on the rule rectangle: no hand room
    const alt = z.points.map(pkt);
    const neu = punkteAus(g.rahmen, r);
    /** @type {any} */
    const zone = { ...z, points: neu, flaeche_m2: flaeche(neu), hand: { versatzU_m: r6(a0), versatzV_m: r6(c0), regelU_m: r6(g.regel.u_m), regelV_m: r6(g.regel.v_m) } };
    if (Array.isArray(z.tueren)) zone.tueren = z.tueren.map((/** @type {any} */ t) => tuerNachziehen(t, alt, neu));
    liste[i] = zone;
    handIdx.push(i);
    angewendet[key] = { versatzU_m: r6(a0), versatzV_m: r6(c0), laengeU_m: r6(lu), laengeV_m: r6(lv) };
  }
  if (!handIdx.length) return { zonen, hinweise, angewendet };
  // Overlaps: one hint per hand room, each pair once (two hand rooms: reported at the first one).
  const istHand = new Set(handIdx);
  for (const i of handIdx) {
    const h = liste[i];
    const teile = [];
    liste.forEach((z, j) => {
      if (j === i || !z || !Array.isArray(z.points) || z.points.length < 3 || z.raumart === "balkon") return;
      if (String(z.we ?? "") !== String(h.we) || Math.round(num(z.level)) !== Math.round(num(h.level))) return;
      if (istHand.has(j) && j < i) return;
      const m2 = ueberlappung(z.points, h.points);
      if (m2 > RAUM_HAND_UEBERLAPPUNG_MIN_M2) teile.push(`${raumKurz(z.name).replace(/ \([^)]*\)$/, "")} (${f2(m2)} m²)`);
    });
    if (teile.length) hinweise.push(`Raum von Hand [115-12]: „${raumKurz(h.name)}" überlappt ${teile.join(", ")} — bewusst von Hand gesetzt; die überlappte Fläche zählt in beiden Räumen (Nachbarraum anpassen)`);
  }
  return { zonen: liste, hinweise, angewendet };
}
