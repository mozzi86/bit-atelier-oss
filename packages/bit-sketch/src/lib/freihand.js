// Freehand strokes of the sketcher (72-05, variant a: a real sketch tool, the constraint
// solver becomes one mode of it).
//
// A stroke is ink, not geometry: it never enters the solver (buildSolverInput ignores it),
// it has no constraints and no degrees of freedom. It lives in the same Sketch document
// (`sketch.strokes`) so it is saved, shown in the plan overlay and erased like the rest.
//
// Units: world metres (same as the constraint geometry, +y up). Pen widths are world widths
// too, so ink scales with the drawing like ink on paper: at plan scale 1:100, 1 m = 10 mm,
// i.e. the widths 0.02 / 0.05 / 0.12 m are 0.2 / 0.5 / 1.2 mm on the sheet — the usual
// fine / medium / broad pens (DIN EN ISO 128-20 line widths 0.25 / 0.5 / 1.0 mm as orientation).
//
// Smoothing and the pressure-dependent outline follow the principle of `perfect-freehand`
// (S. Ruiz, MIT): stream-line the input, then offset a variable radius to both sides and close
// the outline with round caps. Own implementation — no code taken over, no new dependency.
//
// In:  pointer samples {x, y, p} (m, m, pressure 0…1). Out: stored stroke points, the outline
//      polygon to fill, simplification, eraser hit test.
// Pure, no DOM.

/** Pen widths in world metres (see head: 0.2 / 0.5 / 1.2 mm at 1:100). */
export const STIFTBREITEN = Object.freeze({ fein: 0.02, mittel: 0.05, breit: 0.12 });

/** Ink colours (pencil grey, red-line correction, blue, green) — readable on white and on plans. */
export const STIFTFARBEN = Object.freeze(["#1e293b", "#dc2626", "#2563eb", "#16a34a"]);

/**
 * Pressure a device reports without a pressure sensor: Pointer Events spec, `pressure` is
 * 0.5 while a button is pressed (mouse, most touch screens). Treated as "no information".
 */
export const DRUCK_OHNE_SENSOR = 0.5;

/** Width change by pressure: 0 = constant width, 1 = from 0 to double width. [ASSUMED] 0.6 as in common pen apps. */
export const DRUCK_EINFLUSS = 0.6;

/**
 * Stream-line the raw samples (exponential moving average) and drop samples closer than
 * `minAbstand_m` — the hand tremor and the sensor noise of a pen at high sample rates.
 * @param {Array<{x: number, y: number, p?: number}>} roh pointer samples in metres
 * @param {{ glaettung?: number, minAbstand_m?: number }} [o] glaettung 0 (raw) … 0.9 (very smooth)
 * @returns {Array<{x: number, y: number, p: number}>}
 */
export function glaetten(roh, { glaettung = 0.5, minAbstand_m = 0.005 } = {}) {
  const k = 1 - Math.min(0.9, Math.max(0, glaettung));
  const out = [];
  for (const s of roh || []) {
    const x = Number(s?.x), y = Number(s?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = Number.isFinite(Number(s?.p)) ? Math.min(1, Math.max(0, Number(s.p))) : DRUCK_OHNE_SENSOR;
    if (!out.length) { out.push({ x, y, p }); continue; }
    const v = out[out.length - 1];
    const n = { x: v.x + (x - v.x) * k, y: v.y + (y - v.y) * k, p: v.p + (p - v.p) * k };
    if (Math.hypot(n.x - v.x, n.y - v.y) >= minAbstand_m) out.push(n);
  }
  // Keep the true end point: the stream-lined last sample lags behind the pen.
  const letzter = (roh || [])[roh.length - 1];
  if (out.length && letzter && Number.isFinite(Number(letzter.x))) {
    const v = out[out.length - 1];
    if (Math.hypot(letzter.x - v.x, letzter.y - v.y) >= minAbstand_m) out.push({ x: letzter.x, y: letzter.y, p: v.p });
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker simplification (keeps the shape within `toleranz_m`, pressure rides along).
 * Keeps the stored sketch small — the sketch layer is a database field (< 256 KB rule, speicherOrt.js).
 * @param {Array<{x: number, y: number, p: number}>} pkt
 * @param {number} toleranz_m maximum deviation in metres
 * @returns {Array<{x: number, y: number, p: number}>}
 */
export function vereinfachen(pkt, toleranz_m) {
  if (!Array.isArray(pkt) || pkt.length < 3 || !(toleranz_m > 0)) return pkt ? [...pkt] : [];
  const behalten = new Uint8Array(pkt.length);
  behalten[0] = 1; behalten[pkt.length - 1] = 1;
  const stapel = [[0, pkt.length - 1]];
  while (stapel.length) {
    const [a, b] = stapel.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = abstandPunktStrecke(pkt[i], pkt[a], pkt[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > toleranz_m) {
      behalten[idx] = 1;
      stapel.push([a, idx], [idx, b]);
    }
  }
  return pkt.filter((_, i) => behalten[i]);
}

/**
 * Radius (m) of the ink at a sample: half the pen width, scaled by pressure. A device without
 * sensor (p = 0.5) draws exactly the pen width.
 * @param {number} breite_m pen width in metres
 * @param {number} p pressure 0…1
 * @returns {number}
 */
export function radiusBeiDruck(breite_m, p) {
  const f = 1 + DRUCK_EINFLUSS * (2 * (Number.isFinite(p) ? p : DRUCK_OHNE_SENSOR) - 1);
  return Math.max(breite_m * 0.15, (breite_m / 2) * f);
}

/**
 * Outline polygon of a stroke: offset left/right by the pressure radius along the local
 * direction, round caps at both ends. Fill it (nonzero) to draw the ink.
 * @param {Array<{x: number, y: number, p: number}>} pkt smoothed stroke points (m)
 * @param {number} breite_m pen width (m)
 * @param {{ kappenSegmente?: number }} [o] points per round cap
 * @returns {Array<[number, number]>} closed polygon in metres (first point not repeated)
 */
export function strichUmriss(pkt, breite_m, { kappenSegmente = 6 } = {}) {
  const n = (pkt || []).length;
  if (!n) return [];
  if (n === 1) {
    const r = radiusBeiDruck(breite_m, pkt[0].p);
    return Array.from({ length: 12 }, (_, i) => /** @type {[number, number]} */ ([pkt[0].x + r * Math.cos((i / 12) * 2 * Math.PI), pkt[0].y + r * Math.sin((i / 12) * 2 * Math.PI)]));
  }
  /** @type {Array<[number, number]>} */
  const links = [];
  /** @type {Array<[number, number]>} */
  const rechts = [];
  /** @param {number} i @returns {[number, number]} unit direction at sample i */
  const richtung = (i) => {
    const a = pkt[Math.max(0, i - 1)], b = pkt[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  for (let i = 0; i < n; i++) {
    const [ux, uy] = richtung(i);
    const r = radiusBeiDruck(breite_m, pkt[i].p);
    links.push([pkt[i].x - uy * r, pkt[i].y + ux * r]);
    rechts.push([pkt[i].x + uy * r, pkt[i].y - ux * r]);
  }
  /**
   * Round cap, clockwise: at the end from the left side over the tip to the right side, at the
   * start from the right side over the back to the left side — the order the outline runs in.
   * @param {{x: number, y: number}} zentrum @param {[number, number]} u direction @param {number} r @param {boolean} vorne
   * @returns {Array<[number, number]>}
   */
  const kappe = (zentrum, [ux, uy], r, vorne) => {
    const theta = Math.atan2(uy, ux);
    const basis = vorne ? theta + Math.PI / 2 : theta - Math.PI / 2;
    /** @type {Array<[number, number]>} */
    const out = [];
    for (let s = 1; s < kappenSegmente; s++) {
      const w = basis - (s / kappenSegmente) * Math.PI;
      out.push([zentrum.x + r * Math.cos(w), zentrum.y + r * Math.sin(w)]);
    }
    return out;
  };
  const ende = kappe(pkt[n - 1], richtung(n - 1), radiusBeiDruck(breite_m, pkt[n - 1].p), true);
  const start = kappe(pkt[0], richtung(0), radiusBeiDruck(breite_m, pkt[0].p), false);
  return [...links, ...ende, ...rechts.reverse(), ...start];
}

/**
 * Stored form of a stroke: compact arrays [x, y, p] rounded to millimetres and 1/100 pressure.
 * @param {Array<{x: number, y: number, p: number}>} pkt
 * @returns {Array<[number, number, number]>}
 */
export function kompakt(pkt) {
  return (pkt || []).map((q) => [Math.round(q.x * 1000) / 1000, Math.round(q.y * 1000) / 1000, Math.round(q.p * 100) / 100]);
}

/**
 * Points of a stored stroke as objects.
 * @param {{punkte?: Array<[number, number, number]>}} strich
 * @returns {Array<{x: number, y: number, p: number}>}
 */
export function punkteVon(strich) {
  return (strich?.punkte || []).map(([x, y, p]) => ({ x, y, p: Number.isFinite(p) ? p : DRUCK_OHNE_SENSOR }));
}

/**
 * Stroke eraser: ids of the strokes the eraser circle touches (distance to the stroke
 * centre line ≤ eraser radius + half pen width). Whole strokes are erased — like the stroke
 * eraser of pen apps; a partial eraser would split strokes and is not needed for sketches.
 * @param {Iterable<{id: string, punkte: Array<[number, number, number]>, breite: number}>} striche
 * @param {{x: number, y: number}} punkt eraser centre (m)
 * @param {number} radius_m eraser radius (m)
 * @returns {string[]}
 */
export function radiereTreffer(striche, punkt, radius_m) {
  const ids = [];
  for (const s of striche || []) {
    const pkt = punkteVon(s);
    const grenze = radius_m + (Number(s.breite) || 0) / 2;
    let trifft = pkt.length === 1 && Math.hypot(pkt[0].x - punkt.x, pkt[0].y - punkt.y) <= grenze;
    for (let i = 1; i < pkt.length && !trifft; i++) trifft = abstandPunktStrecke(punkt, pkt[i - 1], pkt[i]) <= grenze;
    if (trifft) ids.push(s.id);
  }
  return ids;
}

/**
 * Distance of a point to a segment (m).
 * @param {{x: number, y: number}} p @param {{x: number, y: number}} a @param {{x: number, y: number}} b
 * @returns {number}
 */
function abstandPunktStrecke(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}
