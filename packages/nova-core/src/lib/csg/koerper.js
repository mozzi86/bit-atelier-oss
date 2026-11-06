// 107-14: input bodies of the CSG core as plain three.js geometries — box (one wall layer), extruded profile (slab, column,
// hole prism) and the opening body. No boolean library here: the bodies are the same for every backend (manifold-3d since
// 107-18, three-bvh-csg before, behind the same seam, see backend.js), and they are watertight by construction (checked in the tests).
//
// Every body is built in LOCAL coordinates (origin at the wall start / the element's own frame) — Float32 positions of
// several hundred metres cost accuracy on 0.3 m thick parts; the caller places the result afterwards (platzierung).
// Each body carries exactly ONE group with its material index (BoxGeometry and ExtrudeGeometry bring several groups per
// face kind; those are replaced), so the layer material survives every boolean.
//
// In: sizes in m, a material index. Out: three.js BufferGeometry (m) or null when nothing remains of an opening.

import * as THREE from "three";
import { lochImWand } from "../bauteil/oeffnungen.js";

/** Overhang of an opening body beyond each wall face in m (2 cm), like the IFC void `th + 0.04` of ifcExport.js addOpening. */
export const OEFFNUNG_UEBERSTAND_M = 0.02;

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} materialIndex
 * @returns {THREE.BufferGeometry} the same geometry with one group
 */
function eineGruppe(geo, materialIndex) {
  geo.clearGroups();
  const n = geo.getIndex() ? /** @type {THREE.BufferAttribute} */ (geo.getIndex()).count : geo.getAttribute("position").count;
  geo.addGroup(0, n, materialIndex);
  return geo;
}

/**
 * Axis-aligned box in local coordinates.
 * @param {{x0_m: number, x1_m: number, y0_m: number, y1_m: number, z0_m: number, z1_m: number, materialIndex?: number}} q corners in m
 * @returns {THREE.BufferGeometry} 12 triangles, outward normals
 */
export function quaderKoerper({ x0_m, x1_m, y0_m, y1_m, z0_m, z1_m, materialIndex = 0 }) {
  const g = new THREE.BoxGeometry(x1_m - x0_m, y1_m - y0_m, z1_m - z0_m);
  g.translate((x0_m + x1_m) / 2, (y0_m + y1_m) / 2, (z0_m + z1_m) / 2);
  return eineGruppe(g, materialIndex);
}

/**
 * Extruded polygon (ground plan x/z, height along +y), the same construction as the BIM studio's extrudeFootprint
 * (shape in (x, −z), then rotated into the x/z plane). ExtrudeGeometry orients outer ring and holes itself, so any
 * orientation of the input rings is accepted.
 * @param {{ring: Array<{x: number, z: number}>, loecher?: Array<Array<{x: number, z: number}>>, y0_m: number, y1_m: number, materialIndex?: number}} p
 *   ring and inner rings in m, bottom and top in m
 * @returns {THREE.BufferGeometry}
 */
export function profilKoerper({ ring, loecher = [], y0_m, y1_m, materialIndex = 0 }) {
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const l of loecher) shape.holes.push(new THREE.Path(l.map((p) => new THREE.Vector2(p.x, -p.z))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1_m - y0_m, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // into the x/z plane, height along +y
  g.translate(0, y0_m, 0);
  return eineGruppe(g, materialIndex);
}

/**
 * Body of a wall opening in the wall's local frame (x along the wall from a, y up from the wall bottom, z across): the hole of
 * lochImWand (the ONE clamping rule of 3D profile and analytic volume: 5 cm to the wall ends, 2 cm to bottom and top)
 * through the whole thickness plus OEFFNUNG_UEBERSTAND_M on each side, so no face of the opening is coplanar with a wall face.
 * @param {{u?: number|null, width: number, height: number, sill: number}} o stored middle u and sizes in m (oeffnungsMasse)
 * @param {{laenge_m: number, hoehe_m: number, z0_m: number, z1_m: number, materialIndex?: number}} wand wall length/height and the
 *   thickness range in m; materialIndex: group of the reveal faces the opening leaves in the solid (the layer it is cut from)
 * @returns {THREE.BufferGeometry|null} null when nothing of the hole remains in the wall
 */
export function oeffnungKoerper(o, { laenge_m, hoehe_m, z0_m, z1_m, materialIndex = 0 }) {
  const loch = lochImWand({ w: o.width, h: o.height, sill: o.sill }, o.u, laenge_m, hoehe_m);
  if (!loch) return null;
  return quaderKoerper({ x0_m: loch.x0, x1_m: loch.x1, y0_m: loch.y0, y1_m: loch.y1, z0_m: z0_m - OEFFNUNG_UEBERSTAND_M, z1_m: z1_m + OEFFNUNG_UEBERSTAND_M, materialIndex });
}
