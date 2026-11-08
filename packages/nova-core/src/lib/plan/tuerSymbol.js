// 108-05 (finding 7, 108-RESEARCH §7): the door symbol of the floor plan from ONE helper — screen (BimPlan2D), PDF/DXF (vektorPlan) and
// every later reader draw the same leaf and swing. Drawing rule DIN 1356-1 (Bauzeichnungen): the leaf is drawn opened 90° as a line
// from the hinge, the swing as a quarter circle with the radius of the leaf width from the leaf tip to the opposite jamb; the hinge sits
// on the wall FACE of the swing side (the door turns on the face it opens to), not on the wall axis.
//
// Everything in WALL coordinates: u along the wall (0 = opening middle, +u towards the wall end b), q across the wall (+q = the +normal
// side n = (−dz, dx) of the wall direction). The caller maps (u, q) to the plan with its own P(u, q) — so no SVG arc flags are needed
// and a mirrored axis (plan z down) cannot flip the swing.
//
// Hinge rules ([ASSUMED] until the norm check — DIN EN 12519 names the hinge side from the side the door opens TO):
//  - `aufschlag` "innen" = the leaf swings to the inside of the wall (q sign of `innenSeite`), "aussen" = to the other side
//  - `anschlag` "links"/"rechts": "links" = hinge at the wall-start jamb (−u) for a swing to +q, mirrored (+u) for a swing to −q; "rechts"
//    the other jamb. [ASSUMED] This keeps the picture every plan drew before 108-05 (hinge at −u, swing to +n) as the default and reads as
//    DIN EN 12519 "links" when the viewer stands on the swing side with +u to the right — to be checked against the norm text.
//  - two leaves (`fluegel: 2`): hinges at both jambs, each leaf half the width, both swing to the same side.
//  - a sliding door (`schiebend`) has no swing: only the leaf as a line in the wall (the caller decides from the type).
//
// In:  opening width (m), wall thickness (m, the visible strip), hinge/swing choice, inside side.
// Out: tuerSymbol() → {fluegel: [{drehpunkt, blattEnde, bogen[9], gegenleibung}], leibungen: [u0, u1], seite: ±1}, points in (u, q) m.

/** Number of polyline points of the quarter-circle swing (8 segments). [ASSUMED] 9 — the PDF symbol used 8 segments since 107-12. */
export const BOGEN_PUNKTE = 9;

/**
 * @typedef {{u: number, q: number}} PktUQ
 * @typedef {object} TuerFluegel
 * @property {PktUQ} drehpunkt   hinge on the wall face of the swing side
 * @property {PktUQ} blattEnde   tip of the opened leaf (90°)
 * @property {PktUQ[]} bogen     quarter circle from the leaf tip to the opposite jamb (BOGEN_PUNKTE points)
 * @property {PktUQ} gegenleibung  the jamb the swing ends at
 * @typedef {object} TuerSymbol
 * @property {TuerFluegel[]} fluegel
 * @property {[number, number]} leibungen  u of both jambs (−hw, +hw)
 * @property {1|-1} seite          q sign of the swing side
 * @property {number} breite_m
 */

/**
 * Door symbol in wall coordinates (see file head).
 * @param {{breite_m: number, dicke_m: number, anschlag?: "links"|"rechts", aufschlag?: "innen"|"aussen", innenSeite?: 1|-1, fluegel?: 1|2}} t
 *   breite_m: clear opening width; dicke_m: wall thickness (the hinge sits at ±dicke/2); innenSeite: which q sign is "inside" (default +1,
 *   the +normal side — for the hull of a positively wound footprint the normal points into the building, buildingModel.js)
 * @returns {TuerSymbol}
 */
export function tuerSymbol({ breite_m, dicke_m, anschlag = "links", aufschlag = "innen", innenSeite = 1, fluegel = 1 }) {
  const b = Math.max(0.1, Number(breite_m) || 0.885);
  const hw = b / 2;
  const hq = Math.max(0, Number(dicke_m) || 0) / 2;
  const innen = innenSeite < 0 ? -1 : 1;
  /** @type {1|-1} */
  const seite = aufschlag === "aussen" ? /** @type {1|-1} */ (-innen) : /** @type {1|-1} */ (innen);
  const n = fluegel === 2 ? 2 : 1;
  const r = n === 2 ? hw : b;
  // hinge jamb(s): see the derivation in the file head; two leaves hinge at both jambs
  const linksHinge = seite > 0 ? -hw : hw;
  const hinges = n === 2 ? [-hw, hw] : [anschlag === "rechts" ? -linksHinge : linksHinge];
  /** @type {TuerFluegel[]} */
  const teile = hinges.map((hu) => {
    const drehpunkt = { u: hu, q: seite * hq };
    const gegenU = hu < 0 ? hu + r : hu - r; // the jamb (or the middle for two leaves) the leaf closes to
    const blattEnde = { u: hu, q: seite * (hq + r) };
    const bogen = Array.from({ length: BOGEN_PUNKTE }, (_, i) => {
      const a = (i / (BOGEN_PUNKTE - 1)) * (Math.PI / 2); // 0 = leaf tip (along +q), 90° = closed position (along the wall)
      const richtung = gegenU > hu ? 1 : -1;
      return { u: hu + richtung * r * Math.sin(a), q: seite * (hq + r * Math.cos(a)) };
    });
    return { drehpunkt, blattEnde, bogen, gegenleibung: { u: gegenU, q: seite * hq } };
  });
  return { fluegel: teile, leibungen: [-hw, hw], seite, breite_m: b };
}

/**
 * Hinge/swing fields of an opening record with defaults — ONE place for the defaults (record fields are additive, 108-05).
 * @param {{anschlag?: string, aufschlag?: string}|null|undefined} o
 * @returns {{anschlag: "links"|"rechts", aufschlag: "innen"|"aussen"}}
 */
export function tuerFelder(o) {
  return { anschlag: o?.anschlag === "rechts" ? "rechts" : "links", aufschlag: o?.aufschlag === "aussen" ? "aussen" : "innen" };
}
