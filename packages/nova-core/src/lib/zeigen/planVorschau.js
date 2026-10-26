// 106-03 (review fix): the preview of a proposal in the 2D PLAN (Grundriss) - where the drawing is the main view
// ("Zeichnung zuerst"). Pure function: from an open proposal and the model to the outlines the plan draws as overlay,
// all in m (plan x east, z "down"). The 3D preview (ghost, outline, cut marker) stays with the studio; this is its
// plan counterpart so that a change by command is visible where the person looks.
//
// What is drawn per kind (the same facts the 3D preview shows):
//  - eigenschaft:     the outline of the element (the property itself has no shape),
//  - transformieren:  the outline AFTER the move/rotation/scale (the ghost),
//  - teilen:          the cut line across the wall (or along the given line for a slab).
// Not drawn: IFC elements (no drawn geometry), the section view (Schnitt), hull and workshop components.
//
// In:  model record, proposal {art, ziel, params}, options {projektId, level}.
// Out: shapes [{typ: "flaeche"|"linie", punkte: [{x, z}] in m, level}] - a closed outline or an open line.
import { wandDicke_m, wandGeometrie } from "../bauteil/referenz.js";
import { bauteilImModell, elementArt, transformieren } from "./aenderungen.js";

/** Cut line half length beyond the wall faces in m [ASSUMED: 0.3 m, like the 3D cut marker]. */
const SCHNITT_UEBERSTAND_M = 0.3;

/**
 * Thickness of a drawn wall in m: its composite build-up, else `thickness`, else the standard thickness.
 * Since 107-01 the one rule of bauteil/referenz.js (this file kept its own copy before).
 * @param {any} el  Drawn wall. @returns {number}  Thickness in m.
 */
export function wandDicke(el) {
  return wandDicke_m(el);
}

/**
 * Footprint of a drawn element as a closed outline in m.
 * Wall: the body outline from its reference line, thickness and offset (bauteil/referenz.js, the same derivation as
 * plan, 3D and IFC; 107-01), column: its square, polygon elements: their points.
 * @param {any} el  Drawn wall, column or polygon element.
 * @returns {Array<{x: number, z: number}>}  Corner points in m; empty for other kinds.
 */
export function umrissVon(el) {
  const art = elementArt(el);
  if (art === "wand") {
    return wandGeometrie(el).polygon;
  }
  if (art === "stuetze") {
    const h = (Number(el.size) || 0.4) / 2;
    return [{ x: el.x - h, z: el.z - h }, { x: el.x + h, z: el.z - h }, { x: el.x + h, z: el.z + h }, { x: el.x - h, z: el.z + h }];
  }
  if (art === "flaeche") return el.points.map((/** @type {{x: number, z: number}} */ q) => ({ x: q.x, z: q.z }));
  return [];
}

/**
 * The shapes the plan draws for one open proposal.
 * @param {any} modell  Current model record (customWalls ...).
 * @param {{art: string, ziel: {guid: string, quelle?: string}, params: any}} vorschlag  Open proposal.
 * @param {{projektId?: string|number|null, geschosshoehe_m?: number}} [opt]  geschosshoehe_m: storey height in m for a vertical move.
 * @returns {Array<{typ: "flaeche"|"linie", punkte: Array<{x: number, z: number}>, level: number}>}  Empty when there is nothing to draw
 *   (IFC element, vanished target, a change that does not work).
 */
export function planFormen(modell, vorschlag, opt = {}) {
  if (!modell || !vorschlag || vorschlag.ziel?.quelle === "ifc") return [];
  const fund = bauteilImModell(modell, vorschlag.ziel.guid, { projektId: opt.projektId ?? null });
  if (!fund) return [];
  const el = fund.element;
  const level = el.level || 0;
  const p = vorschlag.params || {};
  try {
    if (vorschlag.art === "eigenschaft") return [{ typ: /** @type {"flaeche"} */ ("flaeche"), punkte: umrissVon(el), level }].filter((f) => f.punkte.length);
    if (vorschlag.art === "transformieren") {
      const neu = transformieren(el, p, { geschosshoehe_m: opt.geschosshoehe_m });
      return [{ typ: /** @type {"flaeche"} */ ("flaeche"), punkte: umrissVon(neu), level: neu.level || 0 }].filter((f) => f.punkte.length);
    }
    if (vorschlag.art === "teilen" && fund.art === "wand" && p.punkt_m) {
      const dx = el.b.x - el.a.x, dz = el.b.z - el.a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.punkt_m.x - el.a.x) * dx + (p.punkt_m.z - el.a.z) * dz) / l2));
      const c = { x: el.a.x + dx * t, z: el.a.z + dz * t };
      // the cut crosses the wall BODY: both ends lie beyond its faces, the body centre is shifted by the reference line offset
      const g = wandGeometrie(el);
      const h = g.dicke_m / 2 + SCHNITT_UEBERSTAND_M, o = g.versatz_m;
      const punktBei = (/** @type {number} */ q) => ({ x: c.x + g.normale.x * q, z: c.z + g.normale.z * q });
      return [{ typ: /** @type {"linie"} */ ("linie"), punkte: [punktBei(o + h), punktBei(o - h)], level }];
    }
    if (vorschlag.art === "teilen" && p.linie) return [{ typ: /** @type {"linie"} */ ("linie"), punkte: [{ x: p.linie.a.x, z: p.linie.a.z }, { x: p.linie.b.x, z: p.linie.b.z }], level }];
  } catch {
    return []; // an impossible change has no picture; the card says why
  }
  return [];
}
