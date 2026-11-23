// Dimension chains of a floor plan sheet, derived from the model (W-1118-21, plan set 1:50).
//
// One truth: the chains measure what planGrafik() draws — the hull walls of the storey, the openings it drew as symbols, the drawn
// walls that meet a facade and the room outlines. Nothing is typed in per project; a chain that the model does not carry is not
// drawn. The geometry of a chain (line, slashes, numbers, outer row) is the one of the screen (masskette.js ketteGeometrie).
//
// Per hull wall up to three rows outside, from the facade outwards: openings and piers, wall positions (inner face of the corner
// walls, faces of the drawn walls that meet the facade), overall length. A row without a subdivision is left out, so a plain facade
// gets the overall length only. Inside: one clear width and one clear depth per room, measured on a line through the room.
//
// Stations are snapped to whole centimetres along the chain before the numbers are written, so the pieces of a row add up to the
// overall length exactly as printed (kettenPruefung proves it for every sheet).
//
// In:  hull walls and drawn walls of one storey, the openings drawn per wall, room outlines (all in m, model x/z).
// Out: planKetten() → chains as measured points; kettenElemente() → sheet primitives on layer "bemassung"; kettenPruefung().
// Pure, no React, no DOM.
import { wandGeometrie } from "@core/lib/bauteil/referenz.js";
import { ketteGeometrie, seiteVon, formatMeter } from "./masskette.js";

/** One screen pixel of masskette.js on paper, mm [ASSUMED: 9 px numbers ≈ 2.5 mm, the text height of the sheet]. */
export const PX_MM = 0.28;
/** Distance of the first row from the outer wall face and the pitch of the rows, mm on paper [ASSUMED office practice]. */
export const REIHE_MM = Object.freeze({ erste: 10, abstand: 8 });
/** Visible length of an extension line, mm on paper [ASSUMED]: short lines at the chain instead of lines across the other rows. */
const HILFSLINIE_MM = 5;
/** Two walls count as neighbours when their end points are closer than this (m). */
const NACHBAR_M = 0.6;
/** A room dimension shorter than this is left out (m) — niches and shafts would only clutter the sheet. */
const RAUM_MIN_M = 0.8;
/** Where the measuring line of a room lies between its two sides (the room stamp sits in the middle). */
const RAUM_LAGE = 0.28;

/** @typedef {{x: number, z: number}} Pkt */
/**
 * @typedef {object} PlanKette
 * @property {Pkt[]} punkte   measured points in m, in order along the chain
 * @property {number} reihe   0 = openings, 1 = wall positions, 2 = overall; -1 = room dimension (inside)
 * @property {string} art     "oeffnungen" | "waende" | "gesamt" | "raum"
 * @property {string} bezug   what is measured: "env:<level>:<edge>" or the room name
 * @property {Pkt} [aussen]   unit normal away from the building (outside rows only)
 */

const runde = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * Stations (m along the chain) snapped to centimetres, sorted, without duplicates.
 * @param {number[]} us @returns {number[]}
 */
function stationen(us) {
  const s = [...new Set(us.filter(Number.isFinite).map(runde))].sort((a, b) => a - b);
  return s;
}

/**
 * Chains of one storey.
 * @param {object} e
 * @param {any[]} e.huellWaende   hull walls of the storey ({a, b, level, edge, …}, wandGeometrie records)
 * @param {Map<string, Array<{mitte_u: number, breite: number}>>} [e.oeffnungen]  openings DRAWN per wall key, m along a → b
 * @param {any[]} [e.waende]      drawn walls of the storey ({a, b, …})
 * @param {Array<{name?: string, points: Pkt[]}>} [e.raeume]  room outlines of the storey
 * @param {Pkt|null} [e.zentrum]  a point inside the building (footprint centroid); default: mean of the hull wall middles
 * @returns {PlanKette[]}
 */
export function planKetten({ huellWaende, oeffnungen = new Map(), waende = [], raeume = [], zentrum = null }) {
  const hw = (Array.isArray(huellWaende) ? huellWaende : []).filter((w) => w?.a && w?.b);
  if (!hw.length) return [];
  const geo = hw.map((w) => ({ w, g: wandGeometrie(w) }));
  const mitte = zentrum || geo.reduce((s, x) => ({ x: s.x + x.g.mitte.x / geo.length, z: s.z + x.g.mitte.z / geo.length }), { x: 0, z: 0 });
  /** @type {PlanKette[]} */
  const ketten = [];
  for (const { w, g } of geo) {
    if (!(g.laenge_m > 0)) continue;
    const d = g.richtung;
    // outward normal: the side of the wall body that faces away from the inside point
    const s = (g.koerperMitte.x - mitte.x) * g.normale.x + (g.koerperMitte.z - mitte.z) * g.normale.z >= 0 ? 1 : -1;
    const n = { x: g.normale.x * s, z: g.normale.z * s };
    // a point of the outer face: reference point a moved across the wall to the outer side
    const q0 = s * g.versatz_m + g.dicke_m / 2; // outward distance of the outer face from the reference line
    const o = { x: w.a.x + n.x * q0, z: w.a.z + n.z * q0 };
    const U = (/** @type {Pkt} */ p) => (p.x - o.x) * d.x + (p.z - o.z) * d.z;
    const Q = (/** @type {Pkt} */ p) => (p.x - o.x) * n.x + (p.z - o.z) * n.z; // > 0 = outside the outer face
    const P = (/** @type {number} */ u) => ({ x: o.x + d.x * u, z: o.z + d.z * u });
    // overall extent: the own outer face, widened to the drawn corners of the neighbouring hull walls
    let u0 = Math.min(...g.polygon.map(U)), u1 = Math.max(...g.polygon.map(U));
    /** @type {number[]} */
    const innen = []; // inner faces of the corner walls
    for (const nb of geo) {
      if (nb.w === w) continue;
      const nah = [nb.w.a, nb.w.b].some((p) => [w.a, w.b].some((e2) => Math.hypot(p.x - e2.x, p.z - e2.z) <= NACHBAR_M));
      if (!nah) continue;
      // a wall running across at a convex corner (its far end lies inside): the corner as drawn ends at ITS outer face, wherever the
      // reference lines sit in the walls; any other neighbour widens the extent only with corners lying on this outer face
      const quer = Math.abs(nb.g.richtung.x * d.x + nb.g.richtung.z * d.z) < 0.26;
      const fern = [nb.w.a, nb.w.b].reduce((f, p) => (Math.min(...[w.a, w.b].map((e2) => Math.hypot(p.x - e2.x, p.z - e2.z))) > Math.min(...[w.a, w.b].map((e2) => Math.hypot(f.x - e2.x, f.z - e2.z))) ? p : f));
      const ecke = quer && Q(fern) < 0 ? nb.g.polygon : nb.g.polygon.filter((p) => Math.abs(Q(p)) <= 0.011);
      for (const p of ecke) { u0 = Math.min(u0, U(p)); u1 = Math.max(u1, U(p)); }
      // a corner wall running across: its face towards this wall's inside is a station of the wall row
      if (quer) {
        const us = nb.g.polygon.map(U);
        innen.push(Math.min(...us), Math.max(...us));
      }
    }
    const k = `env:${w.level}:${w.edge}`;
    const innerhalb = (/** @type {number} */ u) => u > u0 + 0.011 && u < u1 - 0.011;
    // row 0: openings as drawn (jambs along the facade)
    const offen = (oeffnungen.get(k) || []).flatMap((x) => { const m = U({ x: w.a.x + d.x * x.mitte_u, z: w.a.z + d.z * x.mitte_u }); return [m - x.breite / 2, m + x.breite / 2]; });
    // row 1: faces of the drawn walls that end at this facade and run across it
    /** @type {number[]} */
    const quer = [...innen];
    for (const cw of Array.isArray(waende) ? waende : []) {
      if (!cw?.a || !cw?.b) continue;
      const cg = wandGeometrie(cw);
      if (Math.abs(cg.richtung.x * d.x + cg.richtung.z * d.z) >= 0.26) continue;
      const amFassade = [cw.a, cw.b].some((p) => Q(p) <= 0.05 && Q(p) >= -(g.dicke_m + 0.15));
      if (!amFassade) continue;
      const us = cg.polygon.map(U);
      quer.push(Math.min(...us), Math.max(...us));
    }
    const gesamt = stationen([u0, u1]);
    if (gesamt.length < 2) continue;
    const reihen = [
      { art: "oeffnungen", us: stationen([u0, ...offen.filter(innerhalb), u1]) },
      { art: "waende", us: stationen([u0, ...quer.filter(innerhalb), u1]) },
    ].filter((r) => r.us.length > 2);
    // two rows with the same stations say the same thing twice
    if (reihen.length === 2 && reihen[0].us.join() === reihen[1].us.join()) reihen.pop();
    reihen.forEach((r, i) => ketten.push({ punkte: r.us.map(P), reihe: i, art: r.art, bezug: k, aussen: n }));
    ketten.push({ punkte: gesamt.map(P), reihe: reihen.length, art: "gesamt", bezug: k, aussen: n });
  }
  // rooms: clear width along the longest hull wall and clear depth across it, on a line through the room
  const haupt = geo.reduce((a, b) => (b.g.laenge_m > a.g.laenge_m ? b : a)).g.richtung;
  const quer = { x: -haupt.z, z: haupt.x };
  for (const r of Array.isArray(raeume) ? raeume : []) {
    const pts = Array.isArray(r?.points) ? r.points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z)) : [];
    if (pts.length < 3) continue;
    for (const [d, n] of /** @type {Array<[Pkt, Pkt]>} */ ([[haupt, quer], [quer, haupt]])) {
      const vs = pts.map((p) => p.x * n.x + p.z * n.z);
      const v = Math.min(...vs) + (Math.max(...vs) - Math.min(...vs)) * RAUM_LAGE;
      // crossings of the measuring line with the room outline
      /** @type {number[]} */
      const us = [];
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const va = a.x * n.x + a.z * n.z - v, vb = b.x * n.x + b.z * n.z - v;
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        us.push((a.x + (b.x - a.x) * t) * d.x + (a.z + (b.z - a.z) * t) * d.z);
      }
      if (us.length < 2) continue;
      const ua = runde(Math.min(...us)), ub = runde(Math.max(...us));
      if (ub - ua < RAUM_MIN_M) continue;
      const P = (/** @type {number} */ u) => ({ x: d.x * u + n.x * v, z: d.z * u + n.z * v });
      ketten.push({ punkte: [P(ua), P(ub)], reihe: -1, art: "raum", bezug: String(r.name || "Raum") });
    }
  }
  return ketten;
}

/**
 * Proof that the pieces of every row add up to the overall length of its facade AS PRINTED (two decimals).
 * @param {PlanKette[]} ketten
 * @returns {Array<{bezug: string, art: string, summe_m: number, gesamt_m: number, ok: boolean}>} one entry per subdivided row
 */
export function kettenPruefung(ketten) {
  const laenge = (/** @type {Pkt} */ a, /** @type {Pkt} */ b) => runde(Math.hypot(b.x - a.x, b.z - a.z));
  /** @type {Map<string, number>} */
  const gesamt = new Map();
  for (const k of ketten) if (k.art === "gesamt") gesamt.set(k.bezug, laenge(k.punkte[0], k.punkte[k.punkte.length - 1]));
  return ketten.filter((k) => k.art === "oeffnungen" || k.art === "waende").map((k) => {
    let summe = 0;
    for (let i = 1; i < k.punkte.length; i += 1) summe += laenge(k.punkte[i - 1], k.punkte[i]);
    const g = gesamt.get(k.bezug) ?? NaN;
    return { bezug: k.bezug, art: k.art, summe_m: runde(summe), gesamt_m: g, ok: runde(summe) === g };
  });
}

/**
 * Sheet primitives of the chains (layer "bemassung"), in the frame the points are given in.
 * @param {PlanKette[]} ketten
 * @param {object} o
 * @param {number} o.massstab                denominator of the sheet scale
 * @param {{duenn: number, ansicht: number}} o.linien  line widths in mm on paper (linienGruppe)
 * @param {(p: Pkt) => Pkt} [o.abbild]       maps model points into the sheet frame (turned sheet); default identity
 * @param {Pkt} o.zentrum                    a point inside the building, model frame
 * @returns {{elemente: any[], ausdehnung: Pkt[]}} elemente: polys and texts like planGrafik; ausdehnung: points the sheet must
 *   keep free for the numbers (text height above the outermost line), for the bounding box
 */
export function kettenElemente(ketten, { massstab, linien, abbild = (p) => p, zentrum }) {
  const k = massstab / 1000; // metres per mm on paper
  const pxJeM = 1 / (PX_MM * k);
  const schrift = 9, groesse_mm = schrift * PX_MM;
  /** @type {any[]} */
  const el = [];
  /** @type {Pkt[]} */
  const ausdehnung = [];
  const z = abbild(zentrum);
  const linie = (/** @type {Pkt} */ a, /** @type {Pkt} */ b, /** @type {number} */ breite_mm) => el.push({ art: "poly", pts: [a, b], fill: null, stroke: "#18181b", breite_mm, offen: true, ebene: "bemassung" });
  for (const kette of ketten) {
    const punkte = kette.punkte.map(abbild);
    const innen = kette.reihe < 0;
    const g = ketteGeometrie({
      punkte, pxJeM, schrift, format: formatMeter,
      offsetM: innen ? 0 : (REIHE_MM.erste + kette.reihe * REIHE_MM.abstand) * k,
      seite: innen ? 1 : seiteVon(punkte, z),
    });
    if (g.hilfslinien.length < 2) continue;
    linie(g.linie.a, g.linie.b, linien.duenn);
    for (const h of g.hilfslinien) linie({ x: h.b.x - g.normale.x * HILFSLINIE_MM * k, z: h.b.z - g.normale.z * HILFSLINIE_MM * k }, h.b, linien.duenn);
    for (const s of g.striche) linie(s.a, s.b, linien.ansicht);
    for (const t of g.texte) {
      if (t.hinweis) linie(t.hinweis.a, t.hinweis.b, linien.duenn);
      // masskette.js anchors the baseline, the sheet text its optical middle (a third of the height above the baseline)
      const rad = (t.winkel * Math.PI) / 180, ox = Math.sin(rad), oz = -Math.cos(rad), h = groesse_mm * k;
      /** @type {any} */
      const txt = { art: "text", x: t.x + ox * (h / 3), z: t.z + oz * (h / 3), text: t.text, groesse_mm, ebene: "bemassung", mass_m: runde(t.laengeM), bezug: kette.bezug, kette: kette.art };
      if (t.winkel) txt.drehung_grad = t.winkel;
      el.push(txt);
      ausdehnung.push({ x: t.x + ox * h, z: t.z + oz * h });
    }
  }
  return { elemente: el, ausdehnung };
}
