// 106-02: where must the camera stand to see a box completely? Pure maths for "Ansicht auf Auswahl"
// in the IFC viewer (the BIM studio already has its own orbit zoom). The viewing direction is kept:
// only the target and the distance change, so the view does not jump to another side.
//
// In:  box {min:[x,y,z], max:[x,y,z]} in m, current offset camera - target, field of view, aspect.
// Out: {ziel:[x,y,z], position:[x,y,z], abstand} in m.

/** Smallest radius (m) a box is treated as having: a point-like element must not put the camera inside it [ASSUMED]. */
export const MIN_RADIUS_M = 0.5;
/** Margin factor around the box so it does not touch the screen edge [ASSUMED]. */
export const RAND_FAKTOR = 1.3;

/**
 * @param {{min: number[], max: number[]}} box  Axis-aligned box in m.
 * @param {{richtung?: number[], fovGrad?: number, aspekt?: number, rand?: number}} [opt]
 *   richtung: vector from the target to the camera (any length, default diagonal); fovGrad: vertical
 *   field of view in degrees (default 50); aspekt: width / height (default 1); rand: margin factor.
 * @returns {{ziel: [number, number, number], position: [number, number, number], abstand: number}}
 * @throws {Error} on a box without finite corners.
 */
export function ansichtAufBox(box, opt = {}) {
  const min = box?.min, max = box?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3 || ![...min, ...max].every(Number.isFinite)) {
    throw new Error("Box ohne gültige Ecken");
  }
  const ziel = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => (min[i] + max[i]) / 2));
  const radius = Math.max(MIN_RADIUS_M, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const fov = (Number.isFinite(opt.fovGrad) && /** @type {number} */ (opt.fovGrad) > 0 ? /** @type {number} */ (opt.fovGrad) : 50) * Math.PI / 180;
  const aspekt = opt.aspekt && opt.aspekt > 0 ? opt.aspekt : 1;
  // the narrower of the two half angles decides: the box must fit both ways
  const halb = Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspekt));
  const abstand = (radius / Math.sin(halb)) * (opt.rand && opt.rand > 0 ? opt.rand : RAND_FAKTOR);
  let r = Array.isArray(opt.richtung) && opt.richtung.length >= 3 ? opt.richtung.map(Number) : [1, 0.8, 1];
  let len = Math.hypot(r[0], r[1], r[2]);
  if (!Number.isFinite(len) || len < 1e-9) { r = [1, 0.8, 1]; len = Math.hypot(1, 0.8, 1); }
  const position = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => ziel[i] + (r[i] / len) * abstand));
  return { ziel, position, abstand };
}
