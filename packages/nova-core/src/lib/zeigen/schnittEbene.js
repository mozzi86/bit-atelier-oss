// Section plane of a 3D view — the calculation only (quick task 261110-vf3, step D of the one-viewer paper).
//
// A 3D section cuts the model with one plane: horizontal (like the floor plan's cut height) or vertical along X or Z.
// The position is a share of the model's extent on that axis, so the slider works for any model size. This module
// turns {kind, position, side} and the model box into the plane a renderer clips with; the viewer owns the plane
// object and the slider.
//
// Conventions: right-handed world, +Y up, metres. The plane is given as three.js does: a unit normal n and a constant c;
// a point p is KEPT where n·p + c ≥ 0.
//
// In:  plain numbers and arrays. Out: plain numbers and arrays. No three, no DOM.

/** Kinds of section: none, horizontal, vertical across the X axis, vertical across the Z axis. */
export const SCHNITT_ARTEN = Object.freeze(["aus", "h", "x", "z"]);

/**
 * State of the section as the viewer keeps it.
 * @typedef {{art: "aus"|"h"|"x"|"z", lage: number, umgekehrt: boolean}} SchnittZustand
 *   lage: position along the axis, 0…100 % of the model box; umgekehrt: keep the other side
 */

/** The section a view starts with: off, plane in the middle. */
export const SCHNITT_AUS = Object.freeze({ art: "aus", lage: 50, umgekehrt: false });

/**
 * The clipping plane of a section.
 * Horizontal keeps what lies BELOW the plane (you look into the storey, as into a floor plan); vertical keeps the side
 * of the smaller coordinate. `umgekehrt` keeps the other side.
 * @param {SchnittZustand} zustand
 * @param {{min: number[], max: number[]}} box model box, m
 * @returns {{normale: [number, number, number], konstante: number, punkt: [number, number, number]}|null}
 *   null = no section (kind "aus" or unknown, or a box without finite extent on that axis);
 *   punkt: a point of the plane on the box's middle axis, m
 */
export function schnittEbene(zustand, box) {
  const achse = zustand?.art === "h" ? 1 : zustand?.art === "x" ? 0 : zustand?.art === "z" ? 2 : -1;
  if (achse < 0 || !box) return null;
  const lo = Number(box.min?.[achse]), hi = Number(box.max?.[achse]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const t = Math.min(100, Math.max(0, Number(zustand.lage) || 0)) / 100;
  const wert = lo + (hi - lo) * t; // coordinate of the plane on its axis, m
  const vz = zustand.umgekehrt ? 1 : -1; // −axis keeps the lower side: −p + wert ≥ 0  ⇔  p ≤ wert
  const normale = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => (i === achse ? vz : 0)));
  const punkt = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => (i === achse ? wert : (Number(box.min[i]) + Number(box.max[i])) / 2)));
  return { normale, konstante: -vz * wert, punkt };
}
