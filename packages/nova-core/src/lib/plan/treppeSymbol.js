// 108-07: the stair symbol of the floor plan from ONE helper — the screen plan (BimPlan2D), the PDF plan (vektorPlan.planGrafik) and the
// DXF draw the same lines. Drawing rule (.claude/skills/bit-zeichnung/reference/bemassung-symbole.md): step edges, walking line with
// a circle at the antritt and an arrow at the austritt (upwards), a break line across the flight at the section height, steps above
// the section plane dashed, label "n Stg s/a".
//
// Two views of the same flight:
//  - "unten": the storey the flight starts on — all step edges, those above the section height dashed, break line, walking line, label
//  - "oben":  the storey above — only the part above the break line (seen from above through the opening) plus the opening outline
//
// In:  treppeBerechnen result, section height above the floor (m), view.
// Out: primitive list [{art: "linie"|"poly"|"kreis"|"pfeil"|"text", pts, strich: "voll"|"gestrichelt", gewicht: "duenn"|"ansicht"}], m.

import { treppenText } from "../bauteil/treppe.js";

/** Section height of the plan above the finished floor in m when the view has none. [ASSUMED] 1.00 m (usual plan section). */
export const TREPPEN_SCHNITT_M = 1.0;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {{art: "linie"|"poly"|"kreis"|"pfeil"|"text", pts: PktXZ[], strich?: "voll"|"gestrichelt", gewicht?: "duenn"|"ansicht", text?: string, radius_m?: number, winkel_grad?: number}} SymbolTeil
 */

/**
 * Stair symbol of a flight.
 * @param {import("../bauteil/treppe.js").TreppenErgebnis} erg treppeBerechnen
 * @param {{schnitt_m?: number, ansicht?: "unten"|"oben", loch?: PktXZ[]|null}} [opt] schnitt_m: section height above the floor (m);
 *   ansicht: which storey; loch: the slab opening (treppenLoch().points) for the "oben" view
 * @returns {SymbolTeil[]}
 */
export function treppeSymbol(erg, opt = {}) {
  const schnitt = Number(opt?.schnitt_m) > 0 ? Number(opt.schnitt_m) : TREPPEN_SCHNITT_M;
  const oben = opt?.ansicht === "oben";
  /** @type {SymbolTeil[]} */
  const out = [];
  const dir = erg.richtung, quer = erg.quer;
  const b = Math.hypot(erg.umriss[3].x - erg.umriss[0].x, erg.umriss[3].z - erg.umriss[0].z);
  const start = erg.lauflinie[0];
  const at = (/** @type {number} */ d, /** @type {number} */ q) => ({ x: start.x + dir.x * d + quer.x * q, z: start.z + dir.z * d + quer.z * q });
  // the step at which the section plane cuts the flight: first riser whose top is above the section height
  const schnittIdx = erg.stufen.findIndex((s) => s.hoehe_m > schnitt + 1e-9);
  const dSchnitt = schnittIdx < 0 ? erg.laufLaenge_m : erg.stufen[schnittIdx].abstand_m + erg.a_m / 2;
  if (!oben) {
    out.push({ art: "poly", pts: erg.umriss, strich: "voll", gewicht: "ansicht" });
    for (const s of erg.stufen) out.push({ art: "linie", pts: s.vorne, strich: s.hoehe_m > schnitt + 1e-9 ? "gestrichelt" : "voll", gewicht: "duenn" });
    // break line across the flight: two short diagonals (zigzag) at the section position, [ASSUMED] 0.3 m offset
    if (schnittIdx >= 0 && schnittIdx < erg.n - 1) {
      const v = Math.min(0.3, erg.a_m);
      out.push({ art: "linie", pts: [at(dSchnitt - v, -b / 2), at(dSchnitt, 0)], strich: "voll", gewicht: "duenn" });
      out.push({ art: "linie", pts: [at(dSchnitt, 0), at(dSchnitt + v, b / 2)], strich: "voll", gewicht: "duenn" });
    }
    out.push({ art: "kreis", pts: [start], radius_m: Math.min(0.12, b / 6), gewicht: "duenn" });
    out.push({ art: "pfeil", pts: [start, erg.lauflinie[1]], strich: "voll", gewicht: "duenn" });
    const mitte = at(erg.laufLaenge_m / 2, 0);
    out.push({ art: "text", pts: [mitte], text: treppenText(erg), winkel_grad: (Math.atan2(dir.z, dir.x) * 180) / Math.PI });
  } else {
    // seen from the storey above: the part of the flight above the break line and the slab opening
    const d0 = Math.min(dSchnitt, erg.laufLaenge_m);
    out.push({ art: "poly", pts: [at(d0, -b / 2), at(erg.laufLaenge_m, -b / 2), at(erg.laufLaenge_m, b / 2), at(d0, b / 2)], strich: "voll", gewicht: "duenn" });
    for (const s of erg.stufen) if (s.abstand_m >= d0 - 1e-9) out.push({ art: "linie", pts: s.vorne, strich: "voll", gewicht: "duenn" });
    out.push({ art: "pfeil", pts: [at(d0, 0), erg.lauflinie[1]], strich: "voll", gewicht: "duenn" });
    if (Array.isArray(opt?.loch) && opt.loch.length >= 3) out.push({ art: "poly", pts: opt.loch, strich: "gestrichelt", gewicht: "ansicht" });
  }
  return out;
}
