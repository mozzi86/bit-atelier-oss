// 115-13 (D-115-49, W-1118-03): the two-flight stair with intermediate landing and stairwell eye ("zweiläufig mit Zwischenpodest",
// U stair) — the second stair type next to the straight flight of treppe.js. Pure mathematics, no three.js, no React: the studio (3D,
// inspector), the plan symbol (plan/treppeUSymbol.js), the PDF/DXF plan, the IFC export (IfcStair → 2 × IfcStairFlight + IfcSlab
// LANDING), the quantities (bimClassification) and the derived slab opening (treppe.js mitTreppenLoechern) read the SAME result.
//
// Record (`customStairs[]`, lengths in m) — the straight record plus optional fields, nothing renamed (old records load unchanged):
//   {_idx, level, art: "podest_u", start: {x, z}, richtung_grad, breite_m, steigungen?, auftritt_m?, guid?,
//    steigungen_lauf1?, auge_m?, podest_tiefe_m?, wende?: "links"|"rechts"}
//   `start` = middle of the first riser of flight 1 (Antritt), `richtung_grad` = direction of ascent of flight 1 (0 = +x, 90 = +z);
//   flight 2 runs back parallel on the side `wende`, separated by the stairwell eye `auge_m`. `steigungen` overrides the total,
//   `steigungen_lauf1` the split.
//
// Handedness — defined ONCE here, in the planner's terms (DIN 18064 "Linkstreppe" / "Rechtstreppe"): `wende: "links"` (default) = a
// person walking UP flight 1 turns to their LEFT at the landing, the turn is counter-clockwise seen from above; "rechts" = to the right,
// clockwise. Every view shows plan (x, z) as a top view in which +z lies to the RIGHT of a walker facing +x: the screen plan draws z
// downwards (BimPlan2D, no mirror), the DXF/PDF writes (x, −z) with y up, three.js (right-handed, y up) puts world z = plan z. So the
// left of an ascent (dx, dz) is (dz, −dx) — walking +x (screen right), the left hand points to −z (screen up). 115-13 review 20.11.:
// the first version used (−dz, dx) and drew a right-turning stair for "links"; no U stair had been stored, so no migration.
// The IFC export writes plan (x, z) as IFC (X, Y) with Z up for EVERY element, i.e. the whole IFC model is mirrored against plan and
// 3D (pre-existing, see 115-13-SUMMARY "Nachgang Review 20.11."): there the U stair shows the opposite hand like everything else.
//
// Geometry (d = distance along the ascent of flight 1 from the antritt, q = distance across towards flight 2; all m):
//   n = round(h / 0.175) risers (treppeRegeln.SOLL_STEIGUNG_M), s = h / n, a = 0.63 − 2 s — the same rule as the straight flight.
//   n1 = ceil(n / 2), n2 = n − n1 [ASSUMED split: an odd total gives the LOWER flight the extra riser, so flight 2 ends one going
//   before the antritt line and the stair stays as long as flight 1 — the plan outline does not grow; way to a decided value: the
//   office standard or the planner's override `steigungen_lauf1`].
//   Flight 1: risers k = 1…n1 at d = (k − 1) a, q ∈ [−b/2, b/2]; its last riser (k = n1, d = L1 = (n1 − 1) a) climbs onto the landing.
//   Landing: d ∈ [L1, L1 + P], q ∈ [−b/2, b + auge + b/2], top at h1 = n1 · s.
//   Flight 2: risers j = 1…n2 at d = L1 − (j − 1) a, q ∈ [b + auge ± b/2]; its last riser (d = dE = L1 − L2, L2 = (n2 − 1) a) climbs
//   onto the floor above (austritt).
//   Walking line: the middle of each flight, joined across the landing by a half circle around the middle of the eye (radius
//   (b + auge) / 2; flattened to a half ellipse when the landing is too shallow for it, see treppeUBerechnen). [ASSUMED] middle of the
//   usable width — DIN 18065 §3 lets the walking line lie in the middle third for widths up to 1.10 m; the straight flight draws it in
//   the middle as well.
//
// Rules (treppeRegeln.js; every deviation is a WARNING, never a block or a silent correction — the liability stays with the planner,
// who may plan an exception, D-EFH-08):
//  - riser 14–20 cm, going 23–37 cm, usable width ≥ 0.80 m: DIN 18065 Tab. 1, dwellings with up to two flats [ASSUMED values]
//  - step rule 2 s + a = 59…65 cm: DIN 18065 §6 [ASSUMED clause]
//  - landing depth ≥ usable flight width: DIN 18065 §6.4 "Podesttiefe" [ASSUMED clause; way to a sourced value: norm text]
//  - at most 18 risers per flight: DIN 18065 §6.3 (a landing after 18 risers at the latest) [ASSUMED clause, same way]
//  - headroom ≥ 2.00 m over the walking line: DIN 18065 §6.5 [ASSUMED clause] — checked by the slab opening (treppeULoch)
//
// In:  stair record, storey height (hoehen.geschosshoehe of `level`), slab underside above the stair.
// Out: treppeUBerechnen, treppeULoch (opening polygon), treppeUKoerper (bodies for 3D and IFC), treppeUMengen, treppeUText.

import { SOLL_STEIGUNG_M, SCHRITTMASS_M, KOPFHOEHE_MIN_M, STANDARD_BREITE_M, LAUFPLATTE_M, r3, regelWarnungen, treppenTextAus, kopfLochBeginn } from "./treppeRegeln.js";

/** Value of `art` of the two-flight stair with intermediate landing. Stored as is — never rename (records keep it). */
export const TREPPE_U = "podest_u";
/** Default width of the stairwell eye between the flights in m. [ASSUMED] 0.30 m — the user's design value (D-115-49); DIN 18065 has no minimum. */
export const STANDARD_AUGE_M = 0.30;
/** Most risers of one flight before a landing (DIN 18065 §6.3). [ASSUMED] 18 until the clause is checked against the norm text. */
export const MAX_STEIGUNGEN_LAUF = 18;
/** Number of chords of the half circle of the walking line across the landing. Drawing resolution, no norm value. */
const BOGEN_TEILE = 8;

/**
 * Is the record a two-flight stair with intermediate landing? (Any other `art`, or none, is the straight flight of treppe.js.)
 * @param {any} t stair record
 * @returns {boolean}
 */
export function istUTreppe(t) {
  return t?.art === TREPPE_U;
}

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {import("./treppeRegeln.js").TreppenWarnung} TreppenWarnung
 * @typedef {object} TreppeU
 * @property {number} [_idx]
 * @property {number} level             storey flight 1 starts on
 * @property {"podest_u"} art
 * @property {PktXZ} start              middle of the first riser of flight 1, m
 * @property {number} richtung_grad     direction of ascent of flight 1 in plan, degrees (0 = +x, 90 = +z)
 * @property {number} breite_m          usable width of each flight, m
 * @property {number} [steigungen]      override: total number of risers
 * @property {number} [auftritt_m]      override: going, m
 * @property {number} [steigungen_lauf1] override: risers of flight 1 (the rest is flight 2)
 * @property {number} [auge_m]          width of the stairwell eye, m (default STANDARD_AUGE_M)
 * @property {number} [podest_tiefe_m]  landing depth along the ascent, m (default = breite_m)
 * @property {"links"|"rechts"} [wende] turn of a person walking up: "links" = flight 2 on their left, counter-clockwise from above (default)
 * @property {string} [guid]
 * @typedef {object} TreppeULauf
 * @property {number} n                 risers of this flight
 * @property {number} laenge_m          horizontal length (n − 1) · a, m
 * @property {number} basis_m           height of its antritt above the storey floor, m
 * @property {PktXZ} richtung           unit vector of ascent of this flight
 * @property {PktXZ[]} umriss           four corners, m
 * @property {Array<{vorne: [PktXZ, PktXZ], abstand_m: number, hoehe_m: number}>} stufen  one per riser: front line, distance from the
 *   flight's antritt (m), top height above the STOREY floor (m)
 * @typedef {object} TreppeUErgebnis
 * @property {"podest_u"} art
 * @property {number} n                 total risers
 * @property {number} n1                risers of flight 1
 * @property {number} n2                risers of flight 2
 * @property {number} s_m               riser height, m
 * @property {number} a_m               going, m
 * @property {number} schrittmass_m     2 s + a, m
 * @property {number} hoehe_m           storey height climbed, m
 * @property {number} breite_m          flight width, m
 * @property {number} auge_m            stairwell eye, m
 * @property {number} podest_tiefe_m    landing depth, m
 * @property {number} laufLaenge_m      L1 + L2, horizontal length of both flights, m
 * @property {number} lauflinieLaenge_m length of the walking line in plan (flights + half circle or half ellipse), m
 * @property {PktXZ} richtung           unit vector of ascent of flight 1
 * @property {PktXZ} quer               unit vector from flight 1 towards flight 2
 * @property {[TreppeULauf, TreppeULauf]} laeufe
 * @property {{umriss: PktXZ[], hoehe_m: number, tiefe_m: number, breite_m: number, flaeche_m2: number}} podest  landing (top height above the storey floor)
 * @property {PktXZ[]} umriss           outer outline of the whole stair (eye included where both flights lie side by side)
 * @property {PktXZ[]} lauflinie        walking line as a polyline from the antritt to the austritt
 * @property {(d: number, q: number) => PktXZ} punkt  plan point at distance d along flight 1 and q towards flight 2, m
 * @property {TreppenWarnung[]} warnungen
 */

/**
 * Removes repeated and collinear corners of a closed polygon (the outline and the opening collapse to a rectangle when the flights
 * end level with each other). Tolerance 1 mm.
 * @param {PktXZ[]} pts
 * @returns {PktXZ[]}
 */
function ecken(pts) {
  const ohneDoppel = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p.x - q.x, p.z - q.z) > 1e-3; });
  return ohneDoppel.filter((p, i, a) => {
    const v = a[(i + a.length - 1) % a.length], n = a[(i + 1) % a.length];
    return Math.abs((p.x - v.x) * (n.z - v.z) - (p.z - v.z) * (n.x - v.x)) > 1e-6;
  });
}

/**
 * Plan area of a polygon (shoelace), m².
 * @param {PktXZ[]} pts
 * @returns {number}
 */
function flaeche(pts) {
  return Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.z - q.x * p.z; }, 0)) / 2;
}

/**
 * Geometry and rule checks of a two-flight stair (see file head).
 * @param {TreppeU|any} t stair record (art "podest_u")
 * @param {number} hoehe_m storey height the stair climbs, m (hoehen.geschosshoehe of t.level)
 * @returns {TreppeUErgebnis}
 */
export function treppeUBerechnen(t, hoehe_m) {
  const h = Math.max(0.1, Number(hoehe_m) || 0);
  const b = Math.max(0.1, Number(t?.breite_m) || STANDARD_BREITE_M);
  const nOverride = Math.round(Number(t?.steigungen));
  // two flights need at least one riser each
  const n = Math.max(2, Number.isFinite(nOverride) && nOverride > 0 ? nOverride : Math.round(h / SOLL_STEIGUNG_M));
  const s = h / n;
  const aOverride = Number(t?.auftritt_m);
  const a = Math.max(0.15, Number.isFinite(aOverride) && aOverride > 0 ? aOverride : SCHRITTMASS_M - 2 * s);
  const n1Override = Math.round(Number(t?.steigungen_lauf1));
  const n1 = Math.min(n - 1, Math.max(1, Number.isFinite(n1Override) && n1Override > 0 ? n1Override : Math.ceil(n / 2)));
  const n2 = n - n1;
  // a negative eye is no geometry (the flights would overlap) — input sanitising, not a rule
  const auge = Number.isFinite(Number(t?.auge_m)) && t?.auge_m !== null && t?.auge_m !== "" ? Math.max(0, Number(t.auge_m)) : STANDARD_AUGE_M;
  const P = Number(t?.podest_tiefe_m) > 0 ? Number(t.podest_tiefe_m) : b;
  const L1 = (n1 - 1) * a, L2 = (n2 - 1) * a, dE = L1 - L2, h1 = n1 * s;
  const c2 = b + auge; // q of the middle of flight 2
  const ang = ((Number(t?.richtung_grad) || 0) * Math.PI) / 180;
  const dir = { x: Math.cos(ang), z: Math.sin(ang) };
  const seite = t?.wende === "rechts" ? -1 : 1;
  // left of the ascent in the top view is (dir.z, −dir.x) (see file head "Handedness"); flight 2 lies there ("links") or on the
  // other side ("rechts")
  const quer = { x: dir.z * seite, z: -dir.x * seite };
  const x0 = Number(t?.start?.x) || 0, z0 = Number(t?.start?.z) || 0;
  // `+ 0` turns a rounded −0 (e.g. −cos 90° · q) into 0, so plan, IFC and tests never see "-0"
  const punkt = (/** @type {number} */ d, /** @type {number} */ q) => ({ x: r3(x0 + dir.x * d + quer.x * q) + 0, z: r3(z0 + dir.z * d + quer.z * q) + 0 });
  const hb = b / 2;

  /** @type {TreppeULauf["stufen"]} */
  const stufen1 = [];
  for (let k = 1; k <= n1; k += 1) stufen1.push({ vorne: [punkt((k - 1) * a, -hb), punkt((k - 1) * a, hb)], abstand_m: (k - 1) * a, hoehe_m: k * s });
  /** @type {TreppeULauf["stufen"]} */
  const stufen2 = [];
  for (let j = 1; j <= n2; j += 1) stufen2.push({ vorne: [punkt(L1 - (j - 1) * a, c2 - hb), punkt(L1 - (j - 1) * a, c2 + hb)], abstand_m: (j - 1) * a, hoehe_m: h1 + j * s });
  /** @type {[TreppeULauf, TreppeULauf]} */
  const laeufe = [
    { n: n1, laenge_m: L1, basis_m: 0, richtung: dir, umriss: [punkt(0, -hb), punkt(L1, -hb), punkt(L1, hb), punkt(0, hb)], stufen: stufen1 },
    { n: n2, laenge_m: L2, basis_m: h1, richtung: { x: -dir.x, z: -dir.z }, umriss: [punkt(L1, c2 - hb), punkt(dE, c2 - hb), punkt(dE, c2 + hb), punkt(L1, c2 + hb)], stufen: stufen2 },
  ];
  const qMax = c2 + hb;
  const podestUmriss = [punkt(L1, -hb), punkt(L1 + P, -hb), punkt(L1 + P, qMax), punkt(L1, qMax)];
  // outer outline: the eye counts as part of the stair where both flights lie side by side (d ≥ max(0, dE)); see file head
  const umriss = ecken(dE >= 0
    ? [punkt(0, -hb), punkt(L1 + P, -hb), punkt(L1 + P, qMax), punkt(dE, qMax), punkt(dE, hb), punkt(0, hb)]
    : [punkt(0, -hb), punkt(L1 + P, -hb), punkt(L1 + P, qMax), punkt(dE, qMax), punkt(dE, c2 - hb), punkt(0, c2 - hb)]);
  // walking line: middle of flight 1, half circle around the middle of the eye (centre d = L1, q = c2 / 2), middle of flight 2.
  // 115-13 review 20.11. (finding 8): with an eye wider than the flights the circle (radius (b + eye) / 2) could reach beyond the landing
  // (e.g. b 1.0, eye 1.2, landing 1.0: apex 1.10 m deep). Its reach along the ascent is therefore capped so that at least a quarter of the
  // flight width stays between the line and the landing edge — the half circle becomes a half ellipse; at least half the landing depth.
  // [ASSUMED] drawing choice (b / 4 clearance), no norm value. The default stairs (eye ≤ width) keep the circle unchanged.
  const r = c2 / 2;
  const rd = Math.min(r, Math.max(P / 2, P - b / 4));
  /** @type {PktXZ[]} */
  const lauflinie = [punkt(0, 0), punkt(L1, 0)];
  for (let i = 1; i < BOGEN_TEILE; i += 1) { const w = -Math.PI / 2 + (Math.PI * i) / BOGEN_TEILE; lauflinie.push(punkt(L1 + rd * Math.cos(w), r + r * Math.sin(w))); }
  lauflinie.push(punkt(L1, c2), punkt(dE, c2));
  // length of the turn: half the perimeter of the ellipse with the semi-axes rd and r (Ramanujan; exactly π r for the circle)
  const hRam = ((rd - r) / (rd + r || 1)) ** 2;
  const bogenLaenge = (Math.PI * (rd + r) * (1 + (3 * hRam) / (10 + Math.sqrt(4 - 3 * hRam)))) / 2;

  /** @type {TreppenWarnung[]} */
  const warnungen = regelWarnungen(s, a, b);
  // `warn`, never `fail` (see file head): DIN 18065 §6.4 [ASSUMED clause] — the landing must be at least as deep as the flight is wide
  if (P < b - 1e-9) warnungen.push({ code: "podest_kurz", text: "Podesttiefe kleiner als die Laufbreite (DIN 18065)", wert: r3(P), grenze: r3(b) });
  // `warn`, never `fail`: DIN 18065 §6.3 [ASSUMED clause] — more than 18 risers in one flight need a landing in between
  const nMax = Math.max(n1, n2);
  if (nMax > MAX_STEIGUNGEN_LAUF) warnungen.push({ code: "lauf_lang", text: "Mehr als 18 Steigungen in einem Lauf (DIN 18065)", wert: nMax, grenze: MAX_STEIGUNGEN_LAUF });

  return {
    art: TREPPE_U, n, n1, n2, s_m: s, a_m: a, schrittmass_m: 2 * s + a, hoehe_m: h, breite_m: b, auge_m: auge, podest_tiefe_m: P,
    laufLaenge_m: L1 + L2, lauflinieLaenge_m: L1 + bogenLaenge + L2, richtung: dir, quer, laeufe,
    podest: { umriss: podestUmriss, hoehe_m: h1, tiefe_m: P, breite_m: qMax + hb, flaeche_m2: P * (qMax + hb) },
    umriss, lauflinie, punkt: (d, q) => punkt(d, q), warnungen,
  };
}

/**
 * The slab opening above a two-flight stair. The slab may reach over flight 1 as long as it keeps 2.00 m above the line of the step
 * nosings (treppeRegeln.kopfLochBeginn, as treppe.js treppenLoch; 115-13 review 20.11.: before, measured over the tread): up to
 * d_v = a · ((UK − 2.00) / s − 1). The landing and flight 2 lie higher, so the opening reaches over flight 1 from d_v, over the whole
 * landing, the eye and flight 2 down to its austritt (where the floor above continues). Polygon (d, q): (d_v, −b/2) → (L1+P, −b/2) →
 * (L1+P, qMax) → (dE, qMax) → (dE, b/2) → (d_v, b/2) — an L-shaped hexagon, a rectangle when both ends are level. When even the landing
 * keeps the headroom (UK − h1 ≥ 2.00, very high storeys) only flight 2 is opened from where its nosing line lacks it.
 * @param {TreppeU|any} t
 * @param {TreppeUErgebnis} erg treppeUBerechnen
 * @param {number} uk_m underside of the slab above, m above the floor the stair starts on
 * @param {{kopfhoehe_m?: number}} [opt]
 * @returns {{points: PktXZ[], laenge_m: number, breite_m: number, flaeche_m2: number, kopfhoehe_m: number, warnung: TreppenWarnung|null}|null}
 *   laenge_m / breite_m = bounding box along / across flight 1; null without a slab above or when no opening is needed
 */
export function treppeULoch(t, erg, uk_m, opt = {}) {
  const kopf = Number(opt?.kopfhoehe_m) > 0 ? Number(opt.kopfhoehe_m) : KOPFHOEHE_MIN_M;
  const uk = Number(uk_m);
  if (!Number.isFinite(uk) || uk <= 0) return null;
  const { s_m: s, a_m: a, n1, breite_m: b, auge_m: auge, podest_tiefe_m: P } = erg;
  const hb = b / 2, c2 = b + auge, qMax = c2 + hb;
  const L1 = erg.laeufe[0].laenge_m, dE = L1 - erg.laeufe[1].laenge_m, h1 = n1 * s;
  // headroom above the nosing line (treppeRegeln.kopfLochBeginn, DIN 18065 [ASSUMED measuring basis]); flight 1 starts from the floor
  const k1 = kopfLochBeginn(uk, s, a, 0, kopf);
  /** @type {Array<[number, number]>} */
  let dq;
  /** @type {number} */
  let kopfIst;
  if (uk - h1 < kopf - 1e-9) {
    // the slab edge lies over flight 1 (the nosing line reaches the landing top h1 at d = L1, so d_v < L1 here)
    const dv = Math.min(k1.d_m, L1);
    dq = [[dv, -hb], [L1 + P, -hb], [L1 + P, qMax], [dE, qMax], [dE, hb], [dv, hb]];
    kopfIst = k1.kopfhoehe_m;
  } else {
    // headroom over flight 1 and the landing is kept: open flight 2 from where its nosing line (starting from the landing top h1)
    // lacks it — e = distance back from the landing edge d = L1
    const k2 = kopfLochBeginn(uk, s, a, h1, kopf);
    if (k2.d_m >= erg.laeufe[1].laenge_m - 0.005) return null;
    const dv = L1 - k2.d_m;
    dq = [[dE, c2 - hb], [dv, c2 - hb], [dv, qMax], [dE, qMax]];
    kopfIst = k2.kopfhoehe_m;
  }
  const points = ecken(dq.map(([d, q]) => erg.punkt(d, q)));
  const ds = dq.map((p) => p[0]), qs = dq.map((p) => p[1]);
  const warnung = kopfIst < kopf - 1e-6 ? { code: "kopfhoehe", text: "Lichte Kopfhöhe unter 2,00 m über der Lauflinie", wert: r3(kopfIst), grenze: kopf } : null;
  return { points, laenge_m: r3(Math.max(...ds) - Math.min(...ds)), breite_m: r3(Math.max(...qs) - Math.min(...qs)), flaeche_m2: r3(flaeche(points)), kopfhoehe_m: r3(kopfIst), warnung };
}

/**
 * Bodies of a two-flight stair for 3D and IFC, each a vertical prism over a plan ring: one per tread of each flight (massive flight
 * like treppe.js treppeKoerper: top at the tread, bottom LAUFPLATTE_M under the sloped flight plate [ASSUMED], flight 1 at least down
 * to the floor, flight 2 at least down to the underside of the landing) and the landing plate (top h1, LAUFPLATTE_M thick [ASSUMED
 * same plate as the flights]). Heights in m above the floor of the storey the stair starts on, rings in absolute plan m.
 * @param {TreppeUErgebnis} erg
 * @returns {Array<{teil: "lauf1"|"lauf2"|"podest", ring: PktXZ[], unten_m: number, oben_m: number}>}
 */
export function treppeUKoerper(erg) {
  const { s_m: s, a_m: a, n1, n2, breite_m: b, auge_m: auge } = erg;
  const hb = b / 2, c2 = b + auge, L1 = erg.laeufe[0].laenge_m, h1 = n1 * s;
  const platte = LAUFPLATTE_M / (a / Math.hypot(a, s) || 1);
  /** @type {ReturnType<typeof treppeUKoerper>} */
  const out = [];
  for (let k = 1; k <= n1 - 1; k += 1) {
    const oben = k * s;
    out.push({ teil: "lauf1", ring: [erg.punkt((k - 1) * a, -hb), erg.punkt(k * a, -hb), erg.punkt(k * a, hb), erg.punkt((k - 1) * a, hb)], unten_m: Math.max(0, oben - s - platte), oben_m: oben });
  }
  for (let j = 1; j <= n2 - 1; j += 1) {
    const oben = h1 + j * s, d0 = L1 - j * a, d1 = L1 - (j - 1) * a;
    out.push({ teil: "lauf2", ring: [erg.punkt(d0, c2 - hb), erg.punkt(d1, c2 - hb), erg.punkt(d1, c2 + hb), erg.punkt(d0, c2 + hb)], unten_m: Math.max(h1 - LAUFPLATTE_M, oben - s - platte), oben_m: oben });
  }
  out.push({ teil: "podest", ring: erg.podest.umriss, unten_m: Math.max(0, h1 - LAUFPLATTE_M), oben_m: h1 });
  return out;
}

/**
 * Quantities of a two-flight stair: treads (going surfaces of both flights), plan area and length of the flights (width × horizontal
 * length, the reading of the straight flight in bimClassification), landing plan area and plate volume.
 * @param {TreppeUErgebnis} erg
 * @returns {{steigungen: number, auftritte: number, laufFlaeche_m2: number, laufLaenge_m: number, podestFlaeche_m2: number, podestVolumen_m3: number}}
 */
export function treppeUMengen(erg) {
  return {
    steigungen: erg.n,
    auftritte: erg.n1 - 1 + (erg.n2 - 1),
    laufFlaeche_m2: erg.laufLaenge_m * erg.breite_m,
    laufLaenge_m: erg.laufLaenge_m,
    podestFlaeche_m2: erg.podest.flaeche_m2,
    podestVolumen_m3: erg.podest.flaeche_m2 * LAUFPLATTE_M,
  };
}

/**
 * Plan label of the whole stair, "16 Stg 17,5/28,0" (total risers, riser / going in cm) — the same spelling as the straight flight.
 * @param {TreppeUErgebnis} erg
 * @returns {string}
 */
export function treppeUText(erg) {
  return treppenTextAus(erg.n, erg.s_m, erg.a_m);
}
