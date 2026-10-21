// Object snap for the drawing surfaces (phase 104-05, user brief 19.10.2026: "Objektfang wie im CAD").
// One pure core for the Massing modeller and the site plan (Lageplan): endpoint, midpoint, intersection,
// perpendicular, nearest, polar tracking, ortho and grid. Own implementation of the common CAD rules.
//
// Coordinates: plan metres with y growing DOWNWARDS (screen convention of both plans). Angles are given the
// drafting way: 0° = east, counter-clockwise, north = up — so a ray at 90° points up on screen (y decreasing).
//
// Rule order (first hit wins):
//   1. Alt / `aus` → the raw point.
//   2. Object snaps within the capture distance, by priority Endpunkt > Schnitt > Mitte > Lot > Nächster.
//   3. Ortho (forced to 0/90/180/270° from the base point) or polar tracking (nearest multiple of the polar
//      step when within the polar tolerance).
//   4. Grid: on an axis-parallel ray the free coordinate snaps to the absolute grid (identical to the old
//      modeller rule), on an oblique ray the length is rounded; without a ray both coordinates snap.
//
// In:  segments (index built once per geometry change), the raw pointer point, settings, base point.
// Out: {punkt, art, quelle?, winkel_grad?, strahl?} — no DOM, no React; node-testable.

/** @typedef {{x: number, y: number}} Punkt plan metres, y down */
/** @typedef {{a: Punkt, b: Punkt, quelle?: string}} Segment straight piece (a = b is a single point) */
/**
 * @typedef {{objektfang: boolean, endpunkt: boolean, mitte: boolean, schnitt: boolean, lot: boolean, naechster: boolean,
 *   polar: boolean, polarSchritt_grad: number, polarToleranz_grad: number, ortho: boolean, raster: boolean, raster_m: number}} FangEinstellungen
 */
/**
 * @typedef {{zelle_m: number, zellen: Map<string, number[]>, lang: number[], segmente: Segment[]}} FangIndex
 */
/**
 * @typedef {{punkt: Punkt, art: FangArt, quelle?: string, winkel_grad?: number, strahl?: {von: Punkt, winkel_grad: number}}} FangErgebnis
 */
/** @typedef {'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'|'polar'|'ortho'|'raster'|'frei'} FangArt */

/**
 * Default settings. Object snaps endpoint/midpoint/intersection/perpendicular on, nearest off (it would catch
 * almost every click near a line); polar tracking every 90° within 5° (= the old axis lock of the modeller);
 * grid 0.25 m [ASSUMED like BitBimStudio's 0.25 m drawing grid, unchanged from 98-02].
 * @type {Readonly<FangEinstellungen>}
 */
export const FANG_STANDARD = Object.freeze({
  objektfang: true,
  endpunkt: true, mitte: true, schnitt: true, lot: true, naechster: false,
  polar: true, polarSchritt_grad: 90, polarToleranz_grad: 5,
  ortho: false,
  raster: true, raster_m: 0.25,
});

/** Object snap kinds in priority order (first one with a hit wins). @type {ReadonlyArray<'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'>} */
export const FANG_ARTEN = Object.freeze(["endpunkt", "schnitt", "mitte", "lot", "naechster"]);

/** Segments whose bbox covers more grid cells than this go into the always-checked list (cells, [ASSUMED]). */
const MAX_ZELLEN = 64;
const EPS = 1e-9;

const endlich = (/** @type {any} */ p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const abstand = (/** @type {Punkt} */ p, /** @type {Punkt} */ q) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * Clean settings: unknown or broken values fall back to FANG_STANDARD (stored settings may be old or edited).
 * @param {any} e partial or stored settings
 * @returns {FangEinstellungen}
 */
export function fangEinstellungenNormalisieren(e) {
  /** @type {any} */
  const aus = { ...FANG_STANDARD };
  if (!e || typeof e !== "object") return aus;
  for (const k of ["objektfang", "endpunkt", "mitte", "schnitt", "lot", "naechster", "polar", "ortho", "raster"]) {
    if (typeof e[k] === "boolean") aus[k] = e[k];
  }
  const zahl = (/** @type {any} */ v, /** @type {number} */ min, /** @type {number} */ max) => (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
  aus.polarSchritt_grad = zahl(e.polarSchritt_grad, 1, 180) ?? FANG_STANDARD.polarSchritt_grad;
  aus.polarToleranz_grad = zahl(e.polarToleranz_grad, 0.1, 45) ?? FANG_STANDARD.polarToleranz_grad;
  aus.raster_m = zahl(e.raster_m, 0.001, 100) ?? FANG_STANDARD.raster_m;
  return aus;
}

/**
 * Rings / polylines → segments.
 * @param {Array<Punkt[] | {punkte: Punkt[], quelle?: string, geschlossen?: boolean}>} ringe point lists in plan metres;
 *   closed by default (outline of a body or plot); a single point gives a zero-length segment (snaps as an endpoint)
 * @returns {Segment[]}
 */
export function segmenteAusRingen(ringe) {
  /** @type {Segment[]} */
  const aus = [];
  for (const r of Array.isArray(ringe) ? ringe : []) {
    const punkte = Array.isArray(r) ? r : r?.punkte;
    if (!Array.isArray(punkte)) continue;
    const quelle = Array.isArray(r) ? undefined : r?.quelle;
    const geschlossen = Array.isArray(r) ? true : r?.geschlossen !== false;
    const pts = punkte.filter(endlich);
    if (pts.length === 1) { aus.push({ a: pts[0], b: pts[0], quelle }); continue; }
    for (let i = 0; i + 1 < pts.length; i++) aus.push({ a: pts[i], b: pts[i + 1], quelle });
    if (geschlossen && pts.length >= 3) aus.push({ a: pts[pts.length - 1], b: pts[0], quelle });
  }
  return aus;
}

/**
 * Spatial index: a uniform grid hash over the segments' bounding boxes, so a pointer move only looks at the
 * segments near the pointer (site plans with hundreds of edges). Segments spanning more than 64 cells are
 * kept in an extra list that every query checks.
 * @param {Segment[]} segmente plan metres; invalid (NaN) segments are dropped
 * @param {{zelle_m?: number}} [opt] cell size in metres (default 5 m [ASSUMED]: a few building edges per cell)
 * @returns {FangIndex}
 */
export function fangIndex(segmente, { zelle_m = 5 } = {}) {
  const z = zelle_m > 0 ? zelle_m : 5;
  /** @type {Map<string, number[]>} */
  const zellen = new Map();
  /** @type {number[]} */
  const lang = [];
  /** @type {Segment[]} */
  const liste = [];
  for (const s of Array.isArray(segmente) ? segmente : []) {
    if (!s || !endlich(s.a) || !endlich(s.b)) continue;
    const idx = liste.push(s) - 1;
    const i0 = Math.floor(Math.min(s.a.x, s.b.x) / z), i1 = Math.floor(Math.max(s.a.x, s.b.x) / z);
    const j0 = Math.floor(Math.min(s.a.y, s.b.y) / z), j1 = Math.floor(Math.max(s.a.y, s.b.y) / z);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_ZELLEN) { lang.push(idx); continue; }
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = `${i},${j}`;
        const l = zellen.get(k);
        if (l) l.push(idx); else zellen.set(k, [idx]);
      }
    }
  }
  return { zelle_m: z, zellen, lang, segmente: liste };
}

/**
 * Point on segment a–b nearest to p, with its parameter t (0 = a, 1 = b).
 * @param {Punkt} p @param {Punkt} a @param {Punkt} b
 * @returns {{punkt: Punkt, t: number}}
 */
export function naechsterAufSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return { punkt: { x: a.x, y: a.y }, t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { punkt: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/**
 * Foot of the perpendicular from p onto the LINE through a and b (t outside 0…1 = beyond the segment).
 * @param {Punkt} p @param {Punkt} a @param {Punkt} b
 * @returns {{punkt: Punkt, t: number}|null} null for a zero-length segment
 */
export function lotFuss(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  return { punkt: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/**
 * Intersection of the segments a–b and c–d (both bounded); parallel / collinear / zero-length → null.
 * @param {Punkt} a @param {Punkt} b @param {Punkt} c @param {Punkt} d
 * @returns {Punkt|null}
 */
export function schnittPunkt(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const nenner = rx * sy - ry * sx;
  if (Math.abs(nenner) < EPS) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / nenner, u = (qx * ry - qy * rx) / nenner;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

/**
 * Drafting angle of the vector (dx, dy) in plan metres (y down): 0° = east, counter-clockwise, 0 … < 360.
 * @param {number} dx metres @param {number} dy metres (screen direction, down = positive)
 * @returns {number} degrees
 */
export function zeichenWinkel(dx, dy) {
  const w = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return ((w % 360) + 360) % 360;
}

/**
 * Ortho: the raw point projected onto the nearest of the four axis directions through the base point.
 * @param {Punkt} basis @param {Punkt} roh plan metres
 * @returns {{punkt: Punkt, winkel_grad: number}}
 */
export function orthoPunkt(basis, roh) {
  const w = Math.round(zeichenWinkel(roh.x - basis.x, roh.y - basis.y) / 90) * 90 % 360;
  return { punkt: aufStrahl(basis, roh, w), winkel_grad: w };
}

/**
 * Polar tracking: the nearest multiple of `schritt_grad` when the pointer direction is within `toleranz_grad` of it.
 * @param {Punkt} basis @param {Punkt} roh plan metres
 * @param {number} schritt_grad polar step in degrees (90 = axis lock, 15 / 45 common)
 * @param {number} toleranz_grad capture angle in degrees
 * @returns {{punkt: Punkt, winkel_grad: number}|null} null outside the tolerance or at the base point itself
 */
export function polarPunkt(basis, roh, schritt_grad, toleranz_grad) {
  if (abstand(basis, roh) < EPS) return null;
  const s = schritt_grad > 0 ? schritt_grad : 90;
  const w = zeichenWinkel(roh.x - basis.x, roh.y - basis.y);
  const ziel = Math.round(w / s) * s;
  if (Math.abs(w - ziel) >= toleranz_grad) return null;
  const z = ((ziel % 360) + 360) % 360;
  return { punkt: aufStrahl(basis, roh, z), winkel_grad: z };
}

/** Projection of roh onto the ray from basis at the drafting angle w (degrees). */
function aufStrahl(/** @type {Punkt} */ basis, /** @type {Punkt} */ roh, /** @type {number} */ w) {
  const r = (w * Math.PI) / 180;
  const ux = Math.cos(r), uy = -Math.sin(r);
  const l = (roh.x - basis.x) * ux + (roh.y - basis.y) * uy;
  return { x: basis.x + ux * l, y: basis.y + uy * l };
}

/**
 * Segments of the index whose distance to p is at most r (metres).
 * @param {FangIndex} index @param {Punkt} p @param {number} r metres
 * @returns {Segment[]}
 */
export function segmenteNahe(index, p, r) {
  if (!index || !endlich(p)) return [];
  const z = index.zelle_m;
  /** @type {Set<number>} */
  const ids = new Set(index.lang);
  const i0 = Math.floor((p.x - r) / z), i1 = Math.floor((p.x + r) / z);
  const j0 = Math.floor((p.y - r) / z), j1 = Math.floor((p.y + r) / z);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const k of index.zellen.get(`${i},${j}`) || []) ids.add(k);
  /** @type {Segment[]} */
  const aus = [];
  for (const k of [...ids].sort((x, y) => x - y)) {
    const s = index.segmente[k];
    if (abstand(naechsterAufSegment(p, s.a, s.b).punkt, p) <= r) aus.push(s);
  }
  return aus;
}

/**
 * Best candidate of one object snap kind, or null.
 * @param {'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'} art
 * @param {Segment[]} segs candidates near the pointer
 * @param {Punkt} roh @param {number} tol metres @param {Punkt|null} basis
 * @returns {{punkt: Punkt, quelle?: string}|null}
 */
function bester(art, segs, roh, tol, basis) {
  /** @type {{punkt: Punkt, quelle?: string}|null} */
  let best = null;
  let bestD = tol;
  const nimm = (/** @type {Punkt} */ q, /** @type {string|undefined} */ quelle) => {
    const d = abstand(q, roh);
    if (d <= bestD && (!best || d < bestD)) { best = { punkt: { x: q.x, y: q.y }, quelle }; bestD = d; }
  };
  if (art === "endpunkt") {
    for (const s of segs) { nimm(s.a, s.quelle); nimm(s.b, s.quelle); }
  } else if (art === "mitte") {
    for (const s of segs) if (abstand(s.a, s.b) > EPS) nimm({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, s.quelle);
  } else if (art === "schnitt") {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const q = schnittPunkt(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        if (q) nimm(q, segs[i].quelle);
      }
    }
  } else if (art === "lot") {
    if (!basis) return null;
    for (const s of segs) {
      const f = lotFuss(basis, s.a, s.b);
      if (!f || f.t < -EPS || f.t > 1 + EPS || abstand(f.punkt, basis) < EPS) continue;
      nimm(f.punkt, s.quelle);
    }
  } else if (art === "naechster") {
    for (const s of segs) nimm(naechsterAufSegment(roh, s.a, s.b).punkt, s.quelle);
  }
  return best;
}

/**
 * The snapped point for a raw pointer position.
 * @param {Punkt} roh raw pointer point, plan metres (y down)
 * @param {FangIndex|null} index snap geometry (fangIndex), may be null (then only tracking / grid)
 * @param {{toleranz_m?: number, modi?: Partial<FangEinstellungen>, basis?: Punkt|null,
 *   ausser?: ((s: Segment) => boolean)|string[]|null, aus?: boolean, einmal?: 'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'|null}} [opt]
 *   toleranz_m: capture distance in metres (default 0.4 m, the old corner snap of the modeller);
 *   modi: settings (missing keys from FANG_STANDARD); basis: last point (polar / ortho / perpendicular);
 *   ausser: segments to ignore (predicate or list of `quelle` ids, e.g. the body whose corner is dragged);
 *   aus: true = no snapping at all (Alt held); einmal: one-shot snap (only this kind, even if switched off)
 * @returns {FangErgebnis|null} null for an invalid raw point (NaN)
 */
export function fangPunkt(roh, index, opt = {}) {
  if (!endlich(roh)) return null;
  const { toleranz_m = 0.4, modi = undefined, basis = null, ausser = null, aus = false, einmal = null } = opt;
  if (aus) return { punkt: { x: roh.x, y: roh.y }, art: "frei" };
  const m = { ...FANG_STANDARD, ...(modi || {}) };
  /** @type {Array<'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'>} */
  const arten = einmal ? [einmal] : m.objektfang ? FANG_ARTEN.filter((a) => m[a]) : [];
  const b = endlich(basis) ? /** @type {Punkt} */ (basis) : null;
  if (arten.length && index && toleranz_m > 0) {
    const weg = Array.isArray(ausser) ? new Set(ausser) : null;
    const segs = segmenteNahe(index, roh, toleranz_m)
      .filter((s) => !(typeof ausser === "function" ? ausser(s) : weg?.has(/** @type {string} */ (s.quelle))));
    for (const art of arten) {
      const k = bester(art, segs, roh, toleranz_m, b);
      if (k) return { punkt: k.punkt, art, ...(k.quelle != null ? { quelle: k.quelle } : {}) };
    }
  }
  /** @type {FangArt} */
  let art = "frei";
  let p = { x: roh.x, y: roh.y };
  /** @type {{von: Punkt, winkel_grad: number}|null} */
  let strahl = null;
  if (b && abstand(b, roh) > EPS) {
    const r = m.ortho ? orthoPunkt(b, roh) : m.polar ? polarPunkt(b, roh, m.polarSchritt_grad, m.polarToleranz_grad) : null;
    if (r) { p = r.punkt; strahl = { von: { x: b.x, y: b.y }, winkel_grad: r.winkel_grad }; art = m.ortho ? "ortho" : "polar"; }
  }
  if (m.raster && m.raster_m > 0) {
    const g = m.raster_m;
    const rnd = (/** @type {number} */ v) => Math.round(v / g) * g;
    if (strahl && b) {
      const w = strahl.winkel_grad % 180;
      // axis-parallel ray: the free coordinate on the absolute grid (the 98-02 modeller rule, kept identical)
      if (Math.abs(w) < EPS) p = { x: rnd(roh.x), y: b.y };
      else if (Math.abs(w - 90) < EPS) p = { x: b.x, y: rnd(roh.y) };
      else {
        const rad = (strahl.winkel_grad * Math.PI) / 180;
        const ux = Math.cos(rad), uy = -Math.sin(rad);
        const l = rnd((p.x - b.x) * ux + (p.y - b.y) * uy);
        p = { x: b.x + ux * l, y: b.y + uy * l };
      }
    } else {
      p = { x: rnd(roh.x), y: rnd(roh.y) };
      art = "raster";
    }
  }
  return strahl ? { punkt: p, art, winkel_grad: strahl.winkel_grad, strahl } : { punkt: p, art };
}
