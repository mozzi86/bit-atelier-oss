// Blocks of the site plan (Baufeld-Planung, phase 95-04…06) as objects in METRES.
//
// Storage stays backward compatible: `complexData.buildings[]` keeps its canvas-unit fields
// {id, x, y, width, height, floors} (x/y = top-left of the UNROTATED rectangle) — every existing
// reader (cost, BIM, feasibility, interop) keeps working. Each edit additionally writes a metre
// mirror {mitte_m, breite_m, tiefe_m, drehung_grad}. Rotation exists only in `drehung_grad`
// (degrees, clockwise on screen because y points down); legacy readers see the unrotated box.
//
// Editing works on `Block` objects (centre + size + rotation in site metres = canvas units ×
// m_per_px) and is converted back on commit. Selection (click, frame window/crossing), move,
// copy (×n), rotate (15° snap), snapping to boundary / building envelope / setback depth / other
// blocks, and the planning-law check after each move (via ./baurecht.js, the same functions the
// Massing-Studio uses). Pure module, no DOM.

import { abstandsStreifen, dichte, konvexUeberlappen, polyFlaeche, punktInPoly } from "./baurecht.js";

/**
 * @typedef {{x: number, y: number}} P
 * @typedef {{id: string, cx: number, cy: number, breite: number, tiefe: number, drehung: number, geschosse: number}} Block
 *   centre / size in site metres, rotation in degrees, storeys
 * @typedef {{a: P, b: P, abstaende?: number[], art?: string}} FangSegment
 *   snap target edge in metres; `abstaende` = distances (m) the moved corner may keep from the line
 */

/** Snap capture distance in screen pixels; callers convert with their m-per-screen-px. [ASSUMED] */
export const FANG_PX = 10;
/** Default storey height for setback heights, m. [ASSUMED] the site record has no storey height. */
export const GESCHOSS_HOEHE_M = 3.0;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const zahl = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** @param {number} w degrees @returns {number} degrees in [0, 360) */
const normWinkel = (w) => ((w % 360) + 360) % 360;

/**
 * Stored building (canvas units) → Block in metres.
 * @param {{id: string, x: number, y: number, width: number, height: number, floors?: number, drehung_grad?: number}} b
 * @param {number} mpp metres per canvas unit (site_parcel.m_per_px)
 * @returns {Block}
 */
export function alsBlock(b, mpp) {
  const w = zahl(b.width), h = zahl(b.height);
  return {
    id: b.id,
    cx: (zahl(b.x) + w / 2) * mpp, cy: (zahl(b.y) + h / 2) * mpp,
    breite: w * mpp, tiefe: h * mpp,
    drehung: zahl(b.drehung_grad),
    geschosse: Math.max(1, zahl(b.floors) || 1),
  };
}

/**
 * Block → stored building: canvas fields (2 decimals — integer pixels could not carry a 0.1-m
 * nudge) plus the metre mirror. Unknown fields of `roh` are kept.
 * @param {Block} k
 * @param {number} mpp metres per canvas unit
 * @param {Record<string, any>} [roh] the previous record
 * @returns {Record<string, any>}
 */
export function alsGebaeude(k, mpp, roh = {}) {
  const w = k.breite / mpp, h = k.tiefe / mpp;
  return {
    ...roh, id: k.id,
    x: r2(k.cx / mpp - w / 2), y: r2(k.cy / mpp - h / 2), width: r2(w), height: r2(h), floors: k.geschosse,
    mitte_m: { x: r3(k.cx), y: r3(k.cy) }, breite_m: r3(k.breite), tiefe_m: r3(k.tiefe), drehung_grad: r3(normWinkel(k.drehung)),
  };
}

/**
 * Corners of a block (clockwise on screen), metres.
 * @param {Block} k
 * @returns {P[]}
 */
export function ecken(k) {
  const w = (k.drehung * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  const hb = k.breite / 2, ht = k.tiefe / 2;
  return [[-hb, -ht], [hb, -ht], [hb, ht], [-hb, ht]].map(([x, y]) => ({ x: k.cx + x * c - y * s, y: k.cy + x * s + y * c }));
}

/**
 * Topmost block under a point (the last drawn wins, like on screen).
 * @param {Block[]} bloecke
 * @param {P} p metres
 * @returns {string|null} id
 */
export function trefferBlock(bloecke, p) {
  for (let i = bloecke.length - 1; i >= 0; i--) if (punktInPoly(p, ecken(bloecke[i]))) return bloecke[i].id;
  return null;
}

/**
 * Frame direction like CAD: dragged left → right = window, right → left = crossing.
 * @param {number} startX screen x at drag start, px
 * @param {number} endX screen x now, px
 * @returns {'fenster'|'kreuzen'}
 */
export function rahmenModus(startX, endX) {
  return endX >= startX ? "fenster" : "kreuzen";
}

/**
 * Blocks selected by a frame. Window = completely inside, crossing = inside or touched.
 * @param {Block[]} bloecke
 * @param {P} a frame corner, metres
 * @param {P} b opposite corner, metres
 * @param {'fenster'|'kreuzen'} modus
 * @returns {string[]} ids
 */
export function rahmenAuswahl(bloecke, a, b, modus) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const rahmen = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return bloecke.filter((k) => {
    const e = ecken(k);
    if (modus === "fenster") return e.every((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
    return konvexUeberlappen(e, rahmen, -1e-9);
  }).map((k) => k.id);
}

/**
 * Click selection: plain click = only this block (or nothing), Shift = toggle.
 * @param {string[]} auswahl current ids
 * @param {string|null} id hit block
 * @param {boolean} umschalt Shift held
 * @returns {string[]}
 */
export function klickAuswahl(auswahl, id, umschalt) {
  if (!umschalt) return id ? [id] : [];
  if (!id) return auswahl;
  return auswahl.includes(id) ? auswahl.filter((x) => x !== id) : [...auswahl, id];
}

/**
 * Move the selected blocks.
 * @param {Block[]} bloecke
 * @param {string[]} ids
 * @param {number} dx metres
 * @param {number} dy metres
 * @returns {Block[]}
 */
export function verschieben(bloecke, ids, dx, dy) {
  const s = new Set(ids);
  return bloecke.map((k) => (s.has(k.id) ? { ...k, cx: k.cx + dx, cy: k.cy + dy } : k));
}

/**
 * Copy the selected blocks, offset by (dx, dy) — `anzahl` copies in a row (SketchUp "*n").
 * @param {Block[]} bloecke
 * @param {string[]} ids
 * @param {number} dx metres
 * @param {number} dy metres
 * @param {() => string} neueId id factory
 * @param {number} [anzahl] number of copies
 * @returns {{bloecke: Block[], neu: string[]}} all blocks and the ids of the LAST copy row
 */
export function kopieren(bloecke, ids, dx, dy, neueId, anzahl = 1) {
  const quelle = bloecke.filter((k) => ids.includes(k.id));
  const out = [...bloecke];
  let neu = [];
  for (let n = 1; n <= Math.max(1, Math.floor(anzahl)); n++) {
    neu = quelle.map((k) => { const c = { ...k, id: neueId(), cx: k.cx + dx * n, cy: k.cy + dy * n }; out.push(c); return c.id; });
  }
  return { bloecke: out, neu };
}

/**
 * Centre of the selection (bounding box of all corners), metres.
 * @param {Block[]} bloecke
 * @param {string[]} ids
 * @returns {P|null}
 */
export function auswahlMitte(bloecke, ids) {
  const e = bloecke.filter((k) => ids.includes(k.id)).flatMap(ecken);
  if (!e.length) return null;
  const xs = e.map((p) => p.x), ys = e.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * Rotate the selected blocks as one group around `um`.
 * @param {Block[]} bloecke
 * @param {string[]} ids
 * @param {number} grad degrees, clockwise on screen
 * @param {P} um pivot, metres
 * @returns {Block[]}
 */
export function drehen(bloecke, ids, grad, um) {
  const s = new Set(ids), w = (grad * Math.PI) / 180, c = Math.cos(w), si = Math.sin(w);
  return bloecke.map((k) => {
    if (!s.has(k.id)) return k;
    const x = k.cx - um.x, y = k.cy - um.y;
    return { ...k, cx: um.x + x * c - y * si, cy: um.y + x * si + y * c, drehung: normWinkel(k.drehung + grad) };
  });
}

/**
 * Angle snap (rotate handle): to the nearest multiple of `schritt` degrees.
 * @param {number} grad degrees
 * @param {number} [schritt] degrees
 * @returns {number}
 */
export function winkelFang(grad, schritt = 15) {
  return Math.round(grad / schritt) * schritt;
}

/**
 * Snap the moved selection: corner → target vertex first (both axes), then corner → target edge
 * (at distance 0 or one of `abstaende`, e.g. the setback depth); a second, non-parallel edge
 * snap slides along the first edge so both hold (corner into a corner).
 * @param {P[]} punkte corners of the moved selection at the requested offset, metres
 * @param {FangSegment[]} ziele target edges, metres
 * @param {number} fang capture distance, metres
 * @returns {{dx: number, dy: number, ziel: string|null}} correction to ADD to the offset
 */
export function fangKorrektur(punkte, ziele, fang) {
  if (!punkte.length || !ziele.length || !(fang > 0)) return { dx: 0, dy: 0, ziel: null };
  // 1. vertex on vertex
  let best = null;
  for (const c of punkte) for (const z of ziele) for (const v of [z.a, z.b]) {
    const d = Math.hypot(v.x - c.x, v.y - c.y);
    if (d <= fang && (!best || d < best.d)) best = { d, dx: v.x - c.x, dy: v.y - c.y, ziel: z.art || "ecke" };
  }
  if (best) return { dx: best.dx, dy: best.dy, ziel: best.ziel };
  // 2. corner on edge (or at a fixed distance from it)
  const kanten = (/** @type {P[]} */ pts, /** @type {{nx: number, ny: number}|null} */ ausser) => {
    let k = null;
    for (const c of pts) for (const z of ziele) {
      const lx = z.b.x - z.a.x, ly = z.b.y - z.a.y, len = Math.hypot(lx, ly);
      if (len < 1e-9) continue;
      const nx = -ly / len, ny = lx / len;
      if (ausser && Math.abs(nx * ausser.nx + ny * ausser.ny) > 0.95) continue; // parallel to the first snap
      const t = ((c.x - z.a.x) * lx + (c.y - z.a.y) * ly) / (len * len);
      if (t < -0.05 || t > 1.05) continue; // beside the segment
      const d = (c.x - z.a.x) * nx + (c.y - z.a.y) * ny; // signed distance
      for (const o of [0, ...(z.abstaende || [])]) {
        const soll = d >= 0 ? o : -o, fehl = soll - d;
        if (Math.abs(fehl) <= fang && (!k || Math.abs(fehl) < Math.abs(k.fehl))) k = { fehl, nx, ny, ziel: o ? "abstand" : z.art || "kante" };
      }
    }
    return k;
  };
  const k1 = kanten(punkte, null);
  if (!k1) return { dx: 0, dy: 0, ziel: null };
  let dx = k1.nx * k1.fehl, dy = k1.ny * k1.fehl;
  const k2 = kanten(punkte.map((p) => ({ x: p.x + dx, y: p.y + dy })), { nx: k1.nx, ny: k1.ny });
  if (k2) {
    // slide along the first edge (tangent t1) so that the second distance is met
    const tx = -k1.ny, ty = k1.nx, dot = tx * k2.nx + ty * k2.ny;
    if (Math.abs(dot) > 0.3) { dx += (tx * k2.fehl) / dot; dy += (ty * k2.fehl) / dot; }
  }
  return { dx, dy, ziel: k2 ? `${k1.ziel}+${k2.ziel}` : k1.ziel };
}

/**
 * Check after each move (95-06): GRZ/GFZ over all blocks, and per block: outside the plot,
 * overlapping another block, setback strip leaving the plot, setback strip on another block or
 * on another block's strip (Abstandsflächen must not overlap, e.g. Art. 6 (3) BayBO).
 * Study, not proof: storey height [ASSUMED] GESCHOSS_HOEHE_M, setback factor/minimum as in the
 * Massing-Studio defaults. Overlapping footprints are NOT subtracted from the GRZ — they are
 * reported as a conflict instead.
 * @param {Block[]} bloecke
 * @param {{grenze?: P[]|null, faktor?: number, min?: number, geschossHoehe?: number}} [opt] grenze = plot polygon in metres
 * @returns {{grundflaeche: number, bgf: number, grundstueck: number, grz: number, gfz: number, grzUeber: boolean, gfzHoch: boolean, je: Record<string, {streifen: Array<{pts: P[], conflict: boolean|null, depth: number}>, ausserhalb: boolean, grenzKonflikt: boolean, ueberlappt: string[], abstandZu: string[]}>, konflikte: number, pruefbar: boolean}}
 */
export function pruefen(bloecke, { grenze = null, faktor = 0.4, min = 3, geschossHoehe = GESCHOSS_HOEHE_M } = {}) {
  const pruefbar = Array.isArray(grenze) && grenze.length >= 3;
  const poly = Object.fromEntries(bloecke.map((k) => [k.id, ecken(k)]));
  const streifen = Object.fromEntries(bloecke.map((k) => [k.id, abstandsStreifen(poly[k.id], k.geschosse * geschossHoehe, { faktor, min, grenze: pruefbar ? grenze : null })]));
  /** @type {Record<string, any>} */
  const je = {};
  let konflikte = 0;
  for (const k of bloecke) {
    const ausserhalb = pruefbar ? poly[k.id].some((p) => !punktInPoly(p, /** @type {P[]} */ (grenze))) : false;
    const grenzKonflikt = streifen[k.id].some((s) => s.conflict === true);
    const ueberlappt = [], abstandZu = [];
    for (const o of bloecke) {
      if (o.id === k.id) continue;
      if (konvexUeberlappen(poly[k.id], poly[o.id])) { ueberlappt.push(o.id); continue; }
      const trifft = streifen[k.id].some((s) => konvexUeberlappen(s.pts, poly[o.id]) || streifen[o.id].some((t) => konvexUeberlappen(s.pts, t.pts)));
      if (trifft) abstandZu.push(o.id);
    }
    if (ausserhalb || grenzKonflikt || ueberlappt.length || abstandZu.length) konflikte++;
    je[k.id] = { streifen: streifen[k.id], ausserhalb, grenzKonflikt, ueberlappt, abstandZu };
  }
  const grundflaeche = bloecke.reduce((s, k) => s + k.breite * k.tiefe, 0);
  const bgf = bloecke.reduce((s, k) => s + k.breite * k.tiefe * k.geschosse, 0);
  const grundstueck = pruefbar ? polyFlaeche(/** @type {P[]} */ (grenze)) : 0;
  return { grundflaeche, bgf, grundstueck, ...dichte(grundflaeche, bgf, grundstueck), je, konflikte, pruefbar };
}
