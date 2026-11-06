// Object snap for the drawing surfaces (phase 104-05, user brief 19.10.2026: "Objektfang wie im CAD").
// One pure core for the Massing modeller and the site plan (Lageplan): endpoint, midpoint, intersection,
// perpendicular, nearest, polar tracking, ortho and grid. Own implementation of the common CAD rules.
//
// Coordinates: plan metres with y growing DOWNWARDS (screen convention of both plans). Angles are given the
// drafting way: 0° = east, counter-clockwise, north = up — so a ray at 90° points up on screen (y decreasing).
//
// Rule order (first hit wins):
//   1. Alt / `aus` → the raw point.
//   2. Object snaps within the capture distance, by priority Endpunkt > Schnitt > Mitte > Lot > Nächster >
//      Verlängerung > Hilfsgerade (107-07: the two new kinds are appended, so the 104-05 order stays as it was).
//   3. Ortho (forced to 0/90/180/270° from the base point); else (107-07) the parallel / perpendicular track to a
//      reference edge (`bezug`) within the polar tolerance; else polar tracking (nearest multiple of the polar
//      step when within the polar tolerance).
//   4. Grid: on an axis-parallel ray the free coordinate snaps to the absolute grid (identical to the old
//      modeller rule), on an oblique ray the length is rounded; without a ray both coordinates snap.
//
// 107-07: a reference edge (`bezug`, set by the one-shot commands "par" / "senk" or by resting the pointer on an edge)
// adds the parallel and perpendicular tracks from the base point and the extension of that edge beyond its ends
// (perpendicular foot with t outside 0…1). Without a reference edge nothing of this applies, so the default
// behaviour of 104-05 is unchanged; the one-shot "verl" extends every edge near the pointer. Guide lines of the
// modeller (massing_layer.hilfslinien) are segments with `quelle: "hilfslinie"`; an infinite one carries
// `gerade: true` and is clipped to ±HILFSGERADE_HALB_M. The ray colour follows the axis (strahlAchse).
//
// In:  segments (index built once per geometry change), the raw pointer point, settings, base point.
// Out: {punkt, art, quelle?, winkel_grad?, strahl?} — no DOM, no React; node-testable.

/** @typedef {{x: number, y: number}} Punkt plan metres, y down */
/** @typedef {{a: Punkt, b: Punkt, quelle?: string, gerade?: boolean}} Segment straight piece (a = b is a single point);
 *  gerade (107-07): an infinite guide line, stored clipped to ±HILFSGERADE_HALB_M around its defining point */
/**
 * @typedef {{objektfang: boolean, endpunkt: boolean, mitte: boolean, schnitt: boolean, lot: boolean, naechster: boolean,
 *   polar: boolean, polarSchritt_grad: number, polarToleranz_grad: number, ortho: boolean, raster: boolean, raster_m: number,
 *   parallel: boolean, senkrecht: boolean, verlaengerung: boolean}} FangEinstellungen
 *   parallel / senkrecht / verlaengerung (107-07): tracks to a reference edge; they act only while one is set
 */
/**
 * @typedef {{zelle_m: number, zellen: Map<string, number[]>, lang: number[], segmente: Segment[]}} FangIndex
 */
/**
 * @typedef {{punkt: Punkt, art: FangArt, quelle?: string, winkel_grad?: number, strahl?: {von: Punkt, winkel_grad: number}}} FangErgebnis
 */
/** @typedef {'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'|'polar'|'ortho'|'raster'|'frei'|'verlaengerung'|'hilfsgerade'|'parallel'|'senkrecht'} FangArt
 *  (107-07: the last four are appended — stored or compared values of 104-05 keep their meaning) */
/** @typedef {'endpunkt'|'schnitt'|'mitte'|'lot'|'naechster'|'verlaengerung'|'hilfsgerade'} ObjektFangArt */

/**
 * Default settings. Object snaps endpoint/midpoint/intersection/perpendicular on, nearest off (it would catch
 * almost every click near a line); polar tracking every 90° within 5° (= the old axis lock of the modeller);
 * grid 0.25 m [ASSUMED like BitBimStudio's 0.25 m drawing grid, unchanged from 98-02].
 * 107-07: parallel, perpendicular and extension on — they only act while a reference edge is set (one-shot
 * "par"/"senk" or resting the pointer on an edge), so the 104-05 default result is unchanged [ASSUMED].
 * @type {Readonly<FangEinstellungen>}
 */
export const FANG_STANDARD = Object.freeze({
  objektfang: true,
  endpunkt: true, mitte: true, schnitt: true, lot: true, naechster: false,
  polar: true, polarSchritt_grad: 90, polarToleranz_grad: 5,
  ortho: false,
  raster: true, raster_m: 0.25,
  parallel: true, senkrecht: true, verlaengerung: true,
});

/** Object snap kinds in priority order (first one with a hit wins); 107-07 appended Verlängerung and Hilfsgerade.
 *  "hilfsgerade" has no switch of its own: guide lines exist to be snapped to, it follows `objektfang`.
 *  @type {ReadonlyArray<ObjektFangArt>} */
export const FANG_ARTEN = Object.freeze(["endpunkt", "schnitt", "mitte", "lot", "naechster", "verlaengerung", "hilfsgerade"]);

/** Snap source id of the guide lines and guide points (107-07, massing_layer.hilfslinien). */
export const QUELLE_HILFSLINIE = "hilfslinie";
/** Snap source id of the origin point (107-07). */
export const QUELLE_URSPRUNG = "ursprung";
/** Half length of an infinite guide line in the snap index, metres [ASSUMED: far beyond any site, ±1 km]. */
export const HILFSGERADE_HALB_M = 1000;
/** Longest extension of an edge beyond its end that still snaps, metres [ASSUMED: about one site width]. */
export const VERLAENGERUNG_MAX_M = 50;

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
  for (const k of ["objektfang", "endpunkt", "mitte", "schnitt", "lot", "naechster", "polar", "ortho", "raster", "parallel", "senkrecht", "verlaengerung"]) {
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
 * @param {ObjektFangArt} art
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
    // 107-07: the far ends of a clipped infinite guide line are no real points
    for (const s of segs) { if (s.gerade) continue; nimm(s.a, s.quelle); nimm(s.b, s.quelle); }
  } else if (art === "mitte") {
    for (const s of segs) if (!s.gerade && abstand(s.a, s.b) > EPS) nimm({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, s.quelle);
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
  } else if (art === "hilfsgerade") {
    // 107-07: a point on a guide line; an infinite one has no t limit (perpendicular foot on the line)
    for (const s of segs) {
      if (s.quelle !== QUELLE_HILFSLINIE || abstand(s.a, s.b) < EPS) continue;
      const f = s.gerade ? lotFuss(roh, s.a, s.b) : naechsterAufSegment(roh, s.a, s.b);
      if (f) nimm(f.punkt, s.quelle);
    }
  }
  return best;
}

/**
 * 107-07: extension of an edge beyond one of its ends — the perpendicular foot of the pointer on the edge's line with
 * t outside 0…1, within the capture distance and at most VERLAENGERUNG_MAX_M beyond the end. With a grid the distance
 * beyond the end is rounded to the grid (the polar-track rule for oblique rays).
 * @param {Segment[]} segs edges to extend (the reference edge, or every edge of the index for the one-shot "verl")
 * @param {Punkt} roh pointer, plan metres
 * @param {number} tol capture distance, metres
 * @param {number} [raster_m] grid in metres, 0 = none
 * @returns {{punkt: Punkt, quelle?: string, strahl: {von: Punkt, winkel_grad: number}}|null}
 */
export function verlaengerungPunkt(segs, roh, tol, raster_m = 0) {
  /** @type {{punkt: Punkt, quelle?: string, strahl: {von: Punkt, winkel_grad: number}}|null} */
  let best = null;
  let bestD = tol;
  if (!endlich(roh)) return null;
  for (const s of segs || []) {
    if (!s || s.gerade || !endlich(s.a) || !endlich(s.b)) continue;
    const L = abstand(s.a, s.b);
    if (L < EPS) continue;
    const f = lotFuss(roh, s.a, s.b);
    if (!f || (f.t >= -EPS && f.t <= 1 + EPS)) continue;
    const vorn = f.t > 1; // beyond b, else beyond a
    const ende = vorn ? s.b : s.a;
    const ux = (vorn ? s.b.x - s.a.x : s.a.x - s.b.x) / L, uy = (vorn ? s.b.y - s.a.y : s.a.y - s.b.y) / L;
    let jenseits = (vorn ? f.t - 1 : -f.t) * L;
    if (jenseits > VERLAENGERUNG_MAX_M) continue;
    const d = abstand(f.punkt, roh);
    if (d > bestD || (best && d >= bestD)) continue;
    if (raster_m > 0) jenseits = Math.round(jenseits / raster_m) * raster_m;
    best = {
      punkt: { x: ende.x + ux * jenseits, y: ende.y + uy * jenseits },
      ...(s.quelle != null ? { quelle: s.quelle } : {}),
      strahl: { von: { x: ende.x, y: ende.y }, winkel_grad: zeichenWinkel(ux, uy) },
    };
    bestD = d;
  }
  return best;
}

/**
 * 107-07: a track through the base point at the drafting angle w (or w + 180°) when the pointer direction is within
 * `toleranz_grad` of it — the parallel (w = edge angle) and perpendicular (w = edge angle + 90°) tracks.
 * @param {Punkt} basis plan metres
 * @param {Punkt} roh plan metres
 * @param {number} w drafting angle of the track, degrees
 * @param {number} toleranz_grad capture angle, degrees
 * @returns {{punkt: Punkt, winkel_grad: number}|null} winkel_grad = the direction the pointer lies in (w or w + 180°)
 */
export function spurPunkt(basis, roh, w, toleranz_grad) {
  if (!endlich(basis) || !endlich(roh) || abstand(basis, roh) < EPS || !Number.isFinite(w)) return null;
  const zw = zeichenWinkel(roh.x - basis.x, roh.y - basis.y);
  for (const k of [w, w + 180]) {
    const z = ((k % 360) + 360) % 360;
    const diff = Math.abs(((zw - z + 540) % 360) - 180);
    if (diff < toleranz_grad) return { punkt: aufStrahl(basis, roh, z), winkel_grad: z };
  }
  return null;
}

/** Tolerance for "the ray lies on an axis", degrees [ASSUMED: polar/ortho rays are exact multiples]. */
const ACHS_TOL_GRAD = 0.01;

/**
 * 107-07: axis of a tracking ray for its colour and label — 0°/180° = x axis (token "fehler", red), 90°/270° = y axis
 * (token "erfolg", green), any other angle = no axis (token "hinweis"). Colour is never the only cue: the glyph adds
 * the axis letter and its own dash pattern (FangGlyphe, skill bit-farbsehen).
 * @param {number} winkel_grad drafting angle, degrees
 * @returns {{achse: 'x'|'y'|null, token: 'fehler'|'erfolg'|'hinweis'}}
 */
export function strahlAchse(winkel_grad) {
  const w = ((Number(winkel_grad) % 360) + 360) % 360;
  if (!Number.isFinite(w)) return { achse: null, token: "hinweis" };
  const bei = (/** @type {number} */ z) => Math.abs(w - z) < ACHS_TOL_GRAD;
  if (bei(0) || bei(180) || bei(360)) return { achse: "x", token: "fehler" };
  if (bei(90) || bei(270)) return { achse: "y", token: "erfolg" };
  return { achse: null, token: "hinweis" };
}

/**
 * The snapped point for a raw pointer position.
 * @param {Punkt} roh raw pointer point, plan metres (y down)
 * @param {FangIndex|null} index snap geometry (fangIndex), may be null (then only tracking / grid)
 * @param {{toleranz_m?: number, modi?: Partial<FangEinstellungen>, basis?: Punkt|null,
 *   ausser?: ((s: Segment) => boolean)|string[]|null, aus?: boolean,
 *   einmal?: ObjektFangArt|'parallel'|'senkrecht'|null, bezug?: Segment|null,
 *   sperre?: {winkel_grad: number|null, art?: string}|null}} [opt]
 *   toleranz_m: capture distance in metres (default 0.4 m, the old corner snap of the modeller);
 *   modi: settings (missing keys from FANG_STANDARD); basis: last point (polar / ortho / perpendicular / tracks);
 *   ausser: segments to ignore (predicate or list of `quelle` ids, e.g. the body whose corner is dragged);
 *   aus: true = no snapping at all (Alt held); einmal: one-shot snap (only this kind, even if switched off);
 *   bezug (107-07): reference edge for the parallel / perpendicular tracks and the extension;
 *   sperre (review 107-07): Shift axis lock — the ray direction frozen at the press (degrees, screen counter-clockwise as
 *   strahl.winkel_grad); the point runs on that line through the base point (either way) instead of ortho/polar/tracks;
 *   `art` = the kind that found the direction (shown again), else "ortho" on an axis and "polar" off it
 * @returns {FangErgebnis|null} null for an invalid raw point (NaN)
 */
export function fangPunkt(roh, index, opt = {}) {
  if (!endlich(roh)) return null;
  const { toleranz_m = 0.4, modi = undefined, basis = null, ausser = null, aus = false, einmal = null, bezug = null, sperre = null } = opt;
  if (aus) return { punkt: { x: roh.x, y: roh.y }, art: "frei" };
  const m = { ...FANG_STANDARD, ...(modi || {}) };
  const spurEinmal = einmal === "parallel" || einmal === "senkrecht";
  /** @type {ObjektFangArt[]} */
  const arten = spurEinmal ? [] : einmal ? [/** @type {ObjektFangArt} */ (einmal)]
    : m.objektfang ? FANG_ARTEN.filter((a) => a === "hilfsgerade" || /** @type {any} */ (m)[a]) : [];
  const b = endlich(basis) ? /** @type {Punkt} */ (basis) : null;
  const bz = bezug && endlich(bezug.a) && endlich(bezug.b) && abstand(bezug.a, bezug.b) > EPS ? bezug : null;
  const rasterM = m.raster && m.raster_m > 0 ? m.raster_m : 0;
  if (arten.length && toleranz_m > 0) {
    const weg = Array.isArray(ausser) ? new Set(ausser) : null;
    const frei = (/** @type {Segment} */ s) => !(typeof ausser === "function" ? ausser(s) : weg?.has(/** @type {string} */ (s.quelle)));
    const segs = index ? segmenteNahe(index, roh, toleranz_m).filter(frei) : [];
    for (const art of arten) {
      if (art === "verlaengerung") {
        // the reference edge only; the one-shot "verl" extends every edge of the index (up to VERLAENGERUNG_MAX_M)
        const kandidaten = einmal === "verlaengerung" ? (index ? index.segmente.filter(frei) : []) : bz ? [bz] : [];
        const v = verlaengerungPunkt(kandidaten, roh, toleranz_m, rasterM);
        if (v) return { punkt: v.punkt, art, ...(v.quelle != null ? { quelle: v.quelle } : {}), winkel_grad: v.strahl.winkel_grad, strahl: v.strahl };
        continue;
      }
      if (!segs.length) continue;
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
    /** @type {{punkt: Punkt, winkel_grad: number}|null} */
    let r = null;
    /** @type {FangArt} */
    let rArt = "frei";
    const sw = sperre && Number.isFinite(sperre.winkel_grad) ? ((/** @type {number} */ (sperre.winkel_grad) % 360) + 360) % 360 : null;
    if (sw != null) {
      // review 107-07: frozen direction — the ray keeps its line while Shift is held, the pointer may cross 45° freely
      const zw = zeichenWinkel(roh.x - b.x, roh.y - b.y);
      const w = Math.abs(((zw - sw + 540) % 360) - 180) <= 90 ? sw : (sw + 180) % 360;
      r = { punkt: aufStrahl(b, roh, w), winkel_grad: w };
      rArt = /** @type {FangArt} */ (sperre?.art && ["ortho", "polar", "parallel", "senkrecht"].includes(sperre.art) ? sperre.art : (Math.abs(sw % 90) < ACHS_TOL_GRAD || Math.abs((sw % 90) - 90) < ACHS_TOL_GRAD ? "ortho" : "polar"));
    } else if (m.ortho && !spurEinmal) { r = orthoPunkt(b, roh); rArt = "ortho"; }
    else {
      // 107-07: tracks to the reference edge come before polar tracking (they are the more specific inference)
      const kw = bz ? zeichenWinkel(bz.b.x - bz.a.x, bz.b.y - bz.a.y) : NaN;
      if (bz && (einmal === "parallel" || (!spurEinmal && m.parallel))) { r = spurPunkt(b, roh, kw, m.polarToleranz_grad); rArt = "parallel"; }
      if (!r && bz && (einmal === "senkrecht" || (!spurEinmal && m.senkrecht))) { r = spurPunkt(b, roh, kw + 90, m.polarToleranz_grad); rArt = "senkrecht"; }
      // review 107-07: a one-shot track without a reference edge yet keeps polar tracking as the fallback (the pointer was free)
      if (!r && (!spurEinmal || !bz) && m.polar) { r = polarPunkt(b, roh, m.polarSchritt_grad, m.polarToleranz_grad); rArt = "polar"; }
    }
    if (r) { p = r.punkt; strahl = { von: { x: b.x, y: b.y }, winkel_grad: r.winkel_grad }; art = rArt; }
  }
  if (rasterM > 0) {
    const g = rasterM;
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
