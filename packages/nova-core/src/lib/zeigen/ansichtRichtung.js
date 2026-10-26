// 106-05: "nach links" must mean left ON THE SCREEN. The grammar (sprachbefehl.js) gets the view as two unit vectors in the plan:
// `rechts` (screen right) and `vorn` (into the screen), both in plan coordinates (m; x east, z plan "down", the same axes as the BIM studio's scene).
// This module derives them from a three.js camera (3D view) and gives the fixed pair of the floor plan.
//
// In:  a THREE.Camera (y up). Out: {rechts: {x, z}, vorn: {x, z}} unit vectors, or null when the camera has no horizontal direction to read.
import * as THREE from "three";

/** @typedef {{rechts: {x: number, z: number}, vorn: {x: number, z: number}}} AnsichtRichtungen */

/**
 * The floor plan: x runs to the right, z runs DOWN the sheet (north is up), so "into the sheet" is -z.
 * @type {AnsichtRichtungen}
 */
export const ANSICHT_GRUNDRISS = Object.freeze({ rechts: { x: 1, z: 0 }, vorn: { x: 0, z: -1 } });

/** Below this horizontal share of the view direction (0..1) the camera looks (almost) straight down and the screen's "up" decides [ASSUMED: ~11 degrees off vertical]. */
const STEIL = 0.2;

/**
 * Screen right / into the screen as horizontal unit vectors, from a camera.
 * @param {THREE.Camera|null|undefined} kamera  Perspective or orthographic camera with an up-to-date world matrix.
 * @returns {AnsichtRichtungen|null}
 */
export function ansichtAusKamera(kamera) {
  if (!kamera) return null;
  kamera.updateMatrixWorld?.();
  const blick = kamera.getWorldDirection(new THREE.Vector3());
  let vx = blick.x, vz = blick.z;
  if (Math.hypot(vx, vz) < STEIL) {
    // straight down: what is up on the screen is "into the screen"
    const oben = new THREE.Vector3(0, 1, 0).applyQuaternion(kamera.quaternion);
    vx = oben.x; vz = oben.z;
  }
  const l = Math.hypot(vx, vz);
  if (!(l > 1e-9)) return null;
  vx /= l; vz /= l;
  // right = forward x up with up = (0, 1, 0): (vx, 0, vz) x (0, 1, 0) = (-vz, 0, vx)
  // "+ 0" turns a -0 into 0 (a clean vector for a sentence in words and for comparisons)
  const r = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6 + 0;
  return { rechts: { x: r(-vz), z: r(vx) }, vorn: { x: r(vx), z: r(vz) } };
}
