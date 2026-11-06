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
import { reihenFaktoren, ohneGuid } from "./massingModell.js"; // 107-07: the shared array core of typed "*n" / "/n"; 107-08: copies without stored guid

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
 * Copy the selected blocks, offset by (dx, dy) — `anzahl` copies in a row (typed "*n"); 107-07: `modus` "teilen" divides the
 * offset instead (typed "/n": copies at dx/n, 2·dx/n … dx), through the shared array core reihenFaktoren().
 * @param {Block[]} bloecke
 * @param {string[]} ids
 * @param {number} dx metres
 * @param {number} dy metres
 * @param {() => string} neueId id factory
 * @param {number} [anzahl] number of copies
 * @param {'mal'|'teilen'} [modus] mal = each copy one offset further (default), teilen = the offset divided into anzahl steps
 * @returns {{bloecke: Block[], neu: string[]}} all blocks and the ids of the LAST copy row
 */
export function kopieren(bloecke, ids, dx, dy, neueId, anzahl = 1, modus = "mal") {
  const quelle = bloecke.filter((k) => ids.includes(k.id));
  const out = [...bloecke];
  /** @type {string[]} */
  let neu = [];
  // the old rule floored the count (2.7 → 2); kept so a fractional count behaves as before
  for (const f of reihenFaktoren(Math.max(1, Math.floor(anzahl)), modus)) {
    // 107-08: a copy never takes a stored guid along (ohneGuid) — no two blocks share a GlobalId
    neu = quelle.map((k) => { const c = { ...ohneGuid(k), id: neueId(), cx: k.cx + dx * f, cy: k.cy + dy * f }; out.push(c); return c.id; });
  }
  return { bloecke: out, neu };
}

/**
 * 107-07: rotated copies of the selected blocks about `um` (rotate handle + Ctrl, then typed "*n" / "/n"): copy i is the selection
 * turned by f_i · grad (reihenFaktoren); the originals stay.
 * @param {Block[]} bloecke
 * @param {string[]} ids
 * @param {number} grad degrees, clockwise on screen (as drehen)
 * @param {P} um pivot, metres
 * @param {() => string} neueId id factory
 * @param {number} [anzahl] number of copies
 * @param {'mal'|'teilen'} [modus]
 * @returns {{bloecke: Block[], neu: string[]}} all blocks and the ids of ALL copies
 */
export function drehKopieren(bloecke, ids, grad, um, neueId, anzahl = 1, modus = "mal") {
  const quelle = bloecke.filter((k) => ids.includes(k.id));
  const out = [...bloecke];
  /** @type {string[]} */
  const neu = [];
  // review 107-07: the count is floored like kopieren (2.7 → 2), so both copy functions of this module read a count alike
  for (const f of reihenFaktoren(Math.max(1, Math.floor(anzahl)), modus)) {
    const gedreht = drehen(quelle, ids, grad * f, um);
    for (const k of gedreht) { const c = { ...ohneGuid(k), id: neueId() }; out.push(c); neu.push(c.id); }
  }
  return { bloecke: out, neu };
}

/**
 * 107-07 review: what a copy / row leaves for the next typed "*n" / "/n".
 * @typedef {{ids: string[], kopien: string[], erste: string[]|null, faktor0: number, grad?: number, um?: P}} Kopie
 *   ids = the originals, kopien = ids of ALL copies of the last copy or row (the next row replaces them),
 *   erste = [original id, id of its copy at factor faktor0] (the step of a shifted row is read from this pair),
 *   faktor0 = factor of that first copy (1 for "*n" and a single copy, 1/n for "/n"), grad / um = rotated copy (degrees, pivot in m)
 */

/** German i18n key of the refusal when the last copy or its originals are gone. */
export const KOPIE_FEHLT = "Kopie oder Original gibt es nicht mehr — erst neu kopieren (Strg + Ziehen)";

/**
 * 107-07 review: remember a copy or row made from `vorher` (blocks before it) — kopieren / drehKopieren append the new blocks
 * in the order of the selected originals.
 * @param {Array<{id: string}>} vorher blocks before the copy
 * @param {Array<{id: string}>} nachher blocks after the copy
 * @param {string[]} ids originals
 * @param {number} faktor0 factor of the first copy (dimensionless)
 * @param {{grad?: number, um?: P}} [dreh] rotated copy: angle in degrees and pivot in m
 * @returns {Kopie}
 */
export function kopieMerken(vorher, nachher, ids, faktor0, dreh = {}) {
  const kopien = nachher.slice(vorher.length).map((k) => k.id);
  const quelle = vorher.filter((k) => ids.includes(k.id));
  /** @type {Kopie} */
  const lk = { ids: [...ids], kopien, erste: quelle.length && kopien.length ? [quelle[0].id, kopien[0]] : null, faktor0 };
  if (dreh.grad != null && dreh.um) { lk.grad = dreh.grad; lk.um = dreh.um; }
  return lk;
}

/**
 * 107-07 review: the row of the last copy on the CURRENT blocks — the copies of the last copy / row go, the new row is made from
 * the originals as they stand now. A shifted copy repeats where its first copy stands now relative to its original (an arrow
 * nudge of the copy counts); a rotated copy repeats its angle about its pivot. Refused when an original or a copy no longer
 * exists (deleted, undone, another record) — never rebuilt from an old snapshot.
 * @param {Array<{id: string, cx: number, cy: number}>} bloecke current blocks, centres in m
 * @param {Kopie} lk
 * @param {number} n number of copies (floored, at least 1)
 * @param {'mal'|'teilen'} art
 * @param {() => string} idFn id factory
 * @returns {{bloecke: any[], neu: string[], kopie: Kopie}|{fehler: string}} fehler = German i18n key
 */
export function reiheAusKopie(bloecke, lk, n, art, idFn) {
  const da = new Set(bloecke.map((k) => k.id));
  const vorhanden = (/** @type {string[]} */ l) => l.length > 0 && l.every((id) => da.has(id));
  if (!lk || !vorhanden(lk.ids) || !vorhanden(lk.kopien)) return { fehler: KOPIE_FEHLT };
  const weg = new Set(lk.kopien);
  const ohne = bloecke.filter((k) => !weg.has(k.id));
  const anzahl = Math.max(1, Math.floor(n));
  const f0 = reihenFaktoren(anzahl, art)[0];
  if (lk.grad != null && lk.um) {
    const r = drehKopieren(/** @type {any} */ (ohne), lk.ids, lk.grad, lk.um, idFn, anzahl, art);
    return { bloecke: r.bloecke, neu: r.neu, kopie: kopieMerken(ohne, r.bloecke, lk.ids, f0, { grad: lk.grad, um: lk.um }) };
  }
  const o = lk.erste ? bloecke.find((k) => k.id === lk.erste?.[0]) : null;
  const c = lk.erste ? bloecke.find((k) => k.id === lk.erste?.[1]) : null;
  if (!o || !c || !(lk.faktor0 > 0)) return { fehler: KOPIE_FEHLT };
  const dx = (c.cx - o.cx) / lk.faktor0, dy = (c.cy - o.cy) / lk.faktor0; // m per step
  const r = kopieren(/** @type {any} */ (ohne), lk.ids, dx, dy, idFn, anzahl, art);
  return { bloecke: r.bloecke, neu: r.bloecke.slice(ohne.length).map((k) => k.id), kopie: kopieMerken(ohne, r.bloecke, lk.ids, f0) };
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
 * @param {{grenze?: P[]|null, faktor?: number, min?: number, geschossHoehe?: number, zusatz?: {grundflaeche?: number, bgf?: number}|null}} [opt]
 *   grenze = plot polygon in metres; zusatz = extra footprint / BGF in m² (bars of the site plan, 101-04)
 * @returns {{grundflaeche: number, bgf: number, grundstueck: number, grz: number, gfz: number, grzUeber: boolean, gfzHoch: boolean, je: Record<string, {streifen: Array<{pts: P[], conflict: boolean|null, depth: number}>, ausserhalb: boolean, grenzKonflikt: boolean, ueberlappt: string[], abstandZu: string[]}>, konflikte: number, pruefbar: boolean}}
 */
export function pruefen(bloecke, { grenze = null, faktor = 0.4, min = 3, geschossHoehe = GESCHOSS_HOEHE_M, zusatz = null } = {}) {
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
  // 101-04: bars / perimeter blocks of the site plan count into GRZ/GFZ (no setback check for them yet).
  const grundflaeche = bloecke.reduce((s, k) => s + k.breite * k.tiefe, 0) + (Number(zusatz?.grundflaeche) || 0);
  const bgf = bloecke.reduce((s, k) => s + k.breite * k.tiefe * k.geschosse, 0) + (Number(zusatz?.bgf) || 0);
  const grundstueck = pruefbar ? polyFlaeche(/** @type {P[]} */ (grenze)) : 0;
  return { grundflaeche, bgf, grundstueck, ...dichte(grundflaeche, bgf, grundstueck), je, konflikte, pruefbar };
}
