// Architectural dimension chains — pure geometry (Phase 75-15, MS-09, MSB-23).
//
// A chain measures consecutive points along one straight line the way a plan
// drawing does (DIN 406 / office practice): one continuous dimension line at a
// fixed distance from the measured edge, an extension line from every point
// that reaches a little past the dimension line, a 45° slash at every point and
// the number centred ABOVE the line and PARALLEL to it. Numbers never stand
// upside down: the text angle is normalised to [-90, 90) degrees, so a vertical
// chain reads bottom-to-top (-90°). Numbers that do not fit between two slashes
// are lifted into an outer row with a short leader (`aussen: true`).
//
// All paper sizes (slash length, overshoot, text gap) are SCREEN pixels; `pxJeM`
// converts them to metres so the result scales with the zoom like the rest of
// the plan (75-09 px pattern).
//
// In:  measured points (m, model x/z), offset (m), side (±1), screen px per m,
//      font height (px), number format.
// Out: dimension line, extension lines, slashes, text anchors with angle — all
//      in metres (model x/z); callers map them with X()/Z(). No React, no DOM.

/** Extension lines overshoot the dimension line by this much (screen px, ≈ 2 mm). */
export const UEBERSTAND_PX = 6;
/** Half length of the 45° slash (screen px, ≈ 1,5 mm). */
export const STRICH_HALB_PX = 4;
/** Gap between dimension line and text baseline (screen px, ≈ 1 mm). */
export const TEXT_ABSTAND_PX = 3;
/** Horizontal padding a number needs on each side to count as "fits" (screen px). */
const TEXT_RAND_PX = 2;
/** Approximate glyph width per character as a fraction of the font height (tabular digits). */
const ZEICHEN_BREITE = 0.55;
/** Points closer than this along the chain collapse into one (m). */
const PUNKT_TOLERANZ_M = 0.01;

/**
 * Default number format: metres, two decimals, de-DE comma, NO unit — the unit
 * is written once next to the scale chip, not on every number (user 04.10.2026).
 * @param {number} m length in metres
 * @returns {string} e.g. "3,14"
 */
export function formatMeter(m) {
  return (Number(m) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Text angle (degrees, screen y down) normalised so the number never stands on
 * its head: [-90, 90). A vertical chain yields -90 (reads bottom-to-top).
 * @param {number} grad raw angle in degrees
 * @returns {number}
 */
export function normiereWinkel(grad) {
  let w = Number(grad) || 0;
  w = Math.round(w * 1e6) / 1e6; // kill float noise before the boundary checks
  while (w >= 90) w -= 180;
  while (w < -90) w += 180;
  return w === 0 ? 0 : w; // no negative zero
}

/**
 * Side of the measured line that faces AWAY from a centre (outside of the
 * building): +1 = left-hand normal (-dz, dx) of the point order, -1 = the other.
 * @param {Array<{x:number,z:number}>} punkte at least two points (m)
 * @param {{x:number,z:number}} zentrum point the chain must not face (m)
 * @returns {1|-1}
 */
export function seiteVon(punkte, zentrum) {
  const a = punkte[0], b = punkte[punkte.length - 1];
  const dx = b.x - a.x, dz = b.z - a.z;
  const nx = -dz, nz = dx;
  const mx = (a.x + b.x) / 2 - zentrum.x, mz = (a.z + b.z) / 2 - zentrum.z;
  return mx * nx + mz * nz < 0 ? -1 : 1;
}

/**
 * Geometry of ONE dimension chain.
 * @param {object} p
 * @param {Array<{x:number,z:number}>} p.punkte measured points (m); order along the line is
 *   derived by projection, duplicates within 1 cm collapse
 * @param {number} [p.offsetM=0.5] distance of the dimension line from the measured edge (m)
 * @param {1|-1} [p.seite=1] which normal the offset follows (see seiteVon)
 * @param {number} [p.pxJeM=40] screen px per metre (converts the px constants)
 * @param {number} [p.schrift=9] font height in screen px
 * @param {(m:number)=>string} [p.format=formatMeter] number format
 * @returns {{
 *   linie: {a:{x:number,z:number}, b:{x:number,z:number}},
 *   hilfslinien: Array<{a:{x:number,z:number}, b:{x:number,z:number}}>,
 *   striche: Array<{a:{x:number,z:number}, b:{x:number,z:number}}>,
 *   texte: Array<{x:number, z:number, winkel:number, text:string, laengeM:number, aussen:boolean,
 *     hinweis?: {a:{x:number,z:number}, b:{x:number,z:number}}}>,
 *   winkel: number, richtung: {x:number,z:number}, normale: {x:number,z:number},
 *   aussenReihe: boolean, breiteM: number
 * }} all coordinates in metres; `winkel` = normalised text angle (deg); `normale` points
 *   from the measured edge towards the dimension line; `breiteM` = how far the chain
 *   (incl. its text rows) extends beyond the measured edge — the next chain starts there
 */
export function ketteGeometrie({ punkte, offsetM = 0.5, seite = 1, pxJeM = 40, schrift = 9, format = formatMeter }) {
  const leer = { linie: { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } }, hilfslinien: [], striche: [], texte: [], winkel: 0,
    richtung: { x: 1, z: 0 }, normale: { x: 0, z: 1 }, aussenReihe: false, breiteM: 0 };
  const pts = (Array.isArray(punkte) ? punkte : []).filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.z));
  if (pts.length < 2) return leer;
  const s = Math.max(pxJeM, 1e-6);
  const mProPx = 1 / s;

  // Axis from the two most distant points of the input order (first → last),
  // every point projected onto it. Non-collinear inputs (room edges at slightly
  // different depths) still get ONE straight dimension line.
  const p0 = pts[0], pN = pts[pts.length - 1];
  let dx = pN.x - p0.x, dz = pN.z - p0.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-9) {
    // first and last coincide — pick the farthest point instead
    let best = 0;
    for (const q of pts) { const l = Math.hypot(q.x - p0.x, q.z - p0.z); if (l > best) { best = l; dx = q.x - p0.x; dz = q.z - p0.z; } }
    len = best;
    if (len < 1e-9) return leer;
  }
  dx /= len; dz /= len;
  const sg = seite < 0 ? -1 : 1;
  const nx = -dz * sg, nz = dx * sg; // normal towards the dimension line

  // Sorted, de-duplicated stations along the axis; keep the original point for the extension line.
  const stationen = pts
    .map((q) => ({ u: (q.x - p0.x) * dx + (q.z - p0.z) * dz, q }))
    .sort((a, b) => a.u - b.u)
    .filter((st, i, arr) => i === 0 || st.u - arr[i - 1].u > PUNKT_TOLERANZ_M);
  if (stationen.length < 2) return leer;

  const auf = (u, abstand) => ({ x: p0.x + dx * u + nx * abstand, z: p0.z + dz * u + nz * abstand });
  const u0 = stationen[0].u, uN = stationen[stationen.length - 1].u;
  const linie = { a: auf(u0, offsetM), b: auf(uN, offsetM) };

  const ueberstandM = UEBERSTAND_PX * mProPx;
  const hilfslinien = stationen.map((st) => ({ a: { x: st.q.x, z: st.q.z }, b: auf(st.u, offsetM + ueberstandM) }));

  // 45° slash: direction (d + n)/√2, i.e. rising to the right when the line is
  // horizontal and the offset goes down — the classic plan tick.
  const h = STRICH_HALB_PX * mProPx;
  const sx = (dx + nx) / Math.SQRT2, sz = (dz + nz) / Math.SQRT2;
  const striche = stationen.map((st) => {
    const c = auf(st.u, offsetM);
    return { a: { x: c.x - sx * h, z: c.z - sz * h }, b: { x: c.x + sx * h, z: c.z + sz * h } };
  });

  // Text direction: the normalised angle decides the reading direction; "above"
  // is the reading direction turned 90° towards screen-up (y down ⇒ (x,y)→(y,−x)).
  // It is independent of `seite`, so a right-hand vertical chain reads
  // bottom-to-top with its numbers on the left of the line, as in a plan.
  const winkel = normiereWinkel(Math.atan2(dz, dx) * 180 / Math.PI);
  const rad = winkel * Math.PI / 180;
  const obenX = Math.sin(rad), obenZ = -Math.cos(rad);
  const textAbstandM = TEXT_ABSTAND_PX * mProPx;
  const reiheM = (schrift + TEXT_ABSTAND_PX + 2) * mProPx; // one text row incl. gap
  // Numbers that do not fit go one row further out along the NORMAL (away from
  // the building), with a short leader down to their piece.
  const texte = [];
  let aussenReihe = false;
  let letztesAussenEnde = -Infinity; // u (m) where the previous outer-row text ends
  for (let i = 1; i < stationen.length; i += 1) {
    const ua = stationen[i - 1].u, ub = stationen[i].u;
    const laengeM = ub - ua;
    const text = format(laengeM);
    const breitePx = text.length * ZEICHEN_BREITE * schrift + 2 * TEXT_RAND_PX;
    const breiteM = breitePx * mProPx;
    const passt = breiteM <= laengeM;
    let mu = (ua + ub) / 2;
    if (passt) {
      const c = auf(mu, offsetM);
      texte.push({ x: c.x + obenX * textAbstandM, z: c.z + obenZ * textAbstandM, winkel, text, laengeM, aussen: false });
      continue;
    }
    // Outer row: centred over the piece, pushed along the chain if the previous
    // outer text is still in the way (greedy, left to right).
    aussenReihe = true;
    const start = Math.max(mu - breiteM / 2, letztesAussenEnde + TEXT_RAND_PX * mProPx);
    mu = start + breiteM / 2;
    letztesAussenEnde = start + breiteM;
    const anker = auf(mu, offsetM + reiheM);
    const fuss = auf((ua + ub) / 2, offsetM);
    texte.push({
      x: anker.x + obenX * textAbstandM, z: anker.z + obenZ * textAbstandM, winkel, text, laengeM, aussen: true,
      hinweis: { a: fuss, b: anker },
    });
  }

  const breiteM = offsetM + ueberstandM + (aussenReihe ? 2 : 1) * reiheM;
  return { linie, hilfslinien, striche, texte, winkel, richtung: { x: dx, z: dz }, normale: { x: nx, z: nz }, aussenReihe, breiteM };
}

/**
 * Part chain plus the overall dimension as a second chain OUTSIDE of it
 * (first and last point only), the way plans stack chains.
 * @param {Parameters<typeof ketteGeometrie>[0] & {gesamt?: boolean}} p same as ketteGeometrie;
 *   `gesamt` false → only the part chain
 * @returns {{teil: ReturnType<typeof ketteGeometrie>, gesamt: ReturnType<typeof ketteGeometrie>|null}}
 */
export function kettenPaar({ gesamt = true, ...p }) {
  const teil = ketteGeometrie(p);
  if (!gesamt || teil.texte.length < 2) return { teil, gesamt: null };
  const pts = (p.punkte || []).filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.z));
  // Reuse the part chain's axis: the overall chain spans its first/last station.
  const enden = [teil.hilfslinien[0].a, teil.hilfslinien[teil.hilfslinien.length - 1].a];
  const g = ketteGeometrie({ ...p, punkte: pts.length >= 2 ? enden : pts, offsetM: teil.breiteM });
  return { teil, gesamt: g };
}
