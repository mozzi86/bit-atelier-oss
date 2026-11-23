// 115-13: the floor-plan symbol of the two-flight stair with intermediate landing (bauteil/treppeU.js) from ONE helper — the screen
// plan (BimPlan2D) and the PDF/DXF plan (vektorPlan.planGrafik) draw the same primitives, as for the straight flight (treppeSymbol.js).
// Drawing rules (.claude/skills/bit-zeichnung/reference/bemassung-symbole.md, 115-CONTEXT D-115-22/D-115-32): stair lines fine, step
// edges above the section plane dashed, walking line with a circle at the antritt and an arrow at the austritt (upwards), a break
// line across the flight at the section height, label "n Stg s/a". Added for the U stair (D-115-49, W-1118-03): the word "auf" at the
// antritt in the storey the stair starts on, and in the storey above the whole stair dashed with "ab" at the austritt plus the
// slab opening. "auf" / "ab" / "Stg" are German drawing abbreviations of the sheet (plans are drawn in German), not UI strings.
//
// Two views of the same stair:
//  - "unten": the storey the stair starts on — outline, every riser (dashed above the section height), break line, walking line,
//             label (middle of flight 2), "auf"
//  - "oben":  the storey above — outline and every riser dashed (below the floor, seen through the opening), walking line dashed, "ab", opening
//
// In:  treppeUBerechnen result, section height above the floor (m), view, opening polygon. Out: SymbolTeil[] (same primitive kinds
//      as treppeSymbol.js, m), and treppeUPlan: outline + primitives of a record in a built model (computes result and opening).

import { treppeUBerechnen, treppeULoch, treppeUText } from "../bauteil/treppeU.js";
import { deckeUeber } from "../bauteil/treppeRegeln.js";
import { geschosshoehe, elevationOf, deckenLage } from "../bauteil/hoehen.js";
import { TREPPEN_SCHNITT_M } from "./treppeSymbol.js";

/** Offset of the words "auf" / "ab" beyond the antritt / austritt along the walking line, m. [ASSUMED] 0.25 m — clear of the circle and the arrow; drawing choice, no norm value. */
const WORT_ABSTAND_M = 0.25;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {import("./treppeSymbol.js").SymbolTeil} SymbolTeil
 */

/**
 * Stair symbol of a two-flight stair.
 * @param {import("../bauteil/treppeU.js").TreppeUErgebnis} erg treppeUBerechnen
 * @param {{schnitt_m?: number, ansicht?: "unten"|"oben", loch?: PktXZ[]|null}} [opt] schnitt_m: section height above the floor (m);
 *   ansicht: which storey; loch: the slab opening (treppeULoch().points) for the "oben" view
 * @returns {SymbolTeil[]}
 */
export function treppeUSymbol(erg, opt = {}) {
  const schnitt = Number(opt?.schnitt_m) > 0 ? Number(opt.schnitt_m) : TREPPEN_SCHNITT_M;
  const oben = opt?.ansicht === "oben";
  /** @type {SymbolTeil[]} */
  const out = [];
  const { a_m: a, breite_m: b, auge_m: auge } = erg;
  const L1 = erg.laeufe[0].laenge_m, dE = L1 - erg.laeufe[1].laenge_m, c2 = b + auge;
  const at = erg.punkt;
  const winkel = (Math.atan2(erg.richtung.z, erg.richtung.x) * 180) / Math.PI;
  const strichOben = oben ? "gestrichelt" : "voll";
  out.push({ art: "poly", pts: erg.umriss, strich: strichOben, gewicht: oben ? "duenn" : "ansicht" });
  // the edges of the stairwell eye are no part of the outline or a riser: inner edge of flight 1, inner edge of flight 2, landing edge
  // across the eye (dashed where they lie above the section plane: flight 2 and the landing start at the landing height)
  const ueber = (/** @type {number} */ h) => (oben || h > schnitt + 1e-9 ? "gestrichelt" : "voll");
  out.push({ art: "linie", pts: [at(0, b / 2), at(L1, b / 2)], strich: strichOben, gewicht: "duenn" });
  out.push({ art: "linie", pts: [at(dE, c2 - b / 2), at(L1, c2 - b / 2)], strich: ueber(erg.podest.hoehe_m), gewicht: "duenn" });
  if (auge > 1e-3) out.push({ art: "linie", pts: [at(L1, b / 2), at(L1, c2 - b / 2)], strich: ueber(erg.podest.hoehe_m), gewicht: "duenn" });
  for (const lauf of erg.laeufe) {
    for (const s of lauf.stufen) out.push({ art: "linie", pts: s.vorne, strich: ueber(s.hoehe_m), gewicht: "duenn" });
  }
  if (!oben) {
    // break line across the flight the section plane cuts (zigzag at the first riser above the section height, [ASSUMED] 0.3 m offset as treppeSymbol.js)
    const v = Math.min(0.3, a);
    const i1 = erg.laeufe[0].stufen.findIndex((s) => s.hoehe_m > schnitt + 1e-9);
    const i2 = erg.laeufe[1].stufen.findIndex((s) => s.hoehe_m > schnitt + 1e-9);
    if (i1 >= 0 && i1 < erg.n1 - 1) {
      const d = erg.laeufe[0].stufen[i1].abstand_m + a / 2;
      out.push({ art: "linie", pts: [at(d - v, -b / 2), at(d, 0)], strich: "voll", gewicht: "duenn" });
      out.push({ art: "linie", pts: [at(d, 0), at(d + v, b / 2)], strich: "voll", gewicht: "duenn" });
    } else if (i1 < 0 && i2 >= 0 && i2 < erg.n2 - 1) {
      // the section lies above the landing: cut flight 2 (it runs back towards the antritt line)
      const d = L1 - (erg.laeufe[1].stufen[i2].abstand_m + a / 2);
      out.push({ art: "linie", pts: [at(d + v, c2 - b / 2), at(d, c2)], strich: "voll", gewicht: "duenn" });
      out.push({ art: "linie", pts: [at(d, c2), at(d - v, c2 + b / 2)], strich: "voll", gewicht: "duenn" });
    }
    out.push({ art: "kreis", pts: [erg.lauflinie[0]], radius_m: Math.min(0.12, b / 6), gewicht: "duenn" });
  }
  // walking line: chords up to the last flight, the last segment as the arrow at the austritt
  const ll = erg.lauflinie;
  for (let i = 0; i < ll.length - 2; i += 1) out.push({ art: "linie", pts: [ll[i], ll[i + 1]], strich: strichOben, gewicht: "duenn" });
  out.push({ art: "pfeil", pts: [ll[ll.length - 2], ll[ll.length - 1]], strich: strichOben, gewicht: "duenn" });
  if (!oben) {
    // 115-13 review 20.11. (finding 6): the label sits in the middle of flight 2 on its walking line, not on flight 1 — centred on
    // flight 1 a label longer than that flight (2.5 mm text at 1:100 is ~2.4 m long, the screen text keeps its pixel size) ran over
    // the antritt circle and "auf". Across, flight 2 lies b + eye ≥ b from them, so the boxes stay apart for any text up to that height.
    out.push({ art: "text", pts: [at((L1 + dE) / 2, c2)], text: treppeUText(erg), winkel_grad: winkel });
    out.push({ art: "text", pts: [at(-WORT_ABSTAND_M, 0)], text: "auf", winkel_grad: winkel });
  } else {
    out.push({ art: "text", pts: [at(dE - WORT_ABSTAND_M, c2)], text: "ab", winkel_grad: winkel });
    if (Array.isArray(opt?.loch) && opt.loch.length >= 3) out.push({ art: "poly", pts: opt.loch, strich: "gestrichelt", gewicht: "ansicht" });
  }
  return out;
}

/**
 * Outline and symbol of a two-flight stair record for a plan of storey `level` — the one call of the screen plan and the PDF/DXF plan.
 * The stair's own storey shows the "unten" view, the storey above the "oben" view with the derived slab opening; other storeys nothing.
 * @param {any} t stair record (art "podest_u")
 * @param {any} model built model (createBuildingModel; for the slab above)
 * @param {number} level storey of the plan
 * @param {import("../bauteil/hoehen.js").Geschosse} [gs] storey table
 * @returns {{umriss: PktXZ[], teile: SymbolTeil[]}|null}
 */
export function treppeUPlan(t, model, level, gs) {
  const lvl = Math.round(Number(t?.level) || 0);
  if (lvl !== level && lvl !== level - 1) return null;
  const erg = treppeUBerechnen(t, geschosshoehe(lvl, gs));
  if (lvl === level) return { umriss: erg.umriss, teile: treppeUSymbol(erg, { ansicht: "unten" }) };
  const decke = deckeUeber(model, lvl, gs);
  const loch = decke ? treppeULoch(t, erg, deckenLage(decke, gs, "huelle").unterkante_m - elevationOf(lvl, gs)) : null;
  return { umriss: erg.umriss, teile: treppeUSymbol(erg, { ansicht: "oben", loch: loch?.points || null }) };
}
