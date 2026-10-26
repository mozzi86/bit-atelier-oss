// 106-03: the ghost of a proposed change at the model - what the preview draws in the 3D view BEFORE a human confirms.
//  - transformieren: a translucent clone of the element's meshes at the target pose (one matrix, the same maths as
//    transformieren() in aenderungen.js, so the ghost sits exactly where the change will put the element),
//  - teilen: a thin marker line across the wall / slab at the cut,
//  - eigenschaft: no ghost (the viewer shows the 'warnung' outline of the pointing states on the element).
// Form, not only colour (guard rail 5): the ghost is drawn with the dashed 'warnung' outline of zustaende.js (an outline
// on every ghost mesh) AND is translucent, the cut marker is dashed.
//
// Scene coordinates: x east, y up, z = plan z (down in the sheet), metres - the BIM studio's world frame.
//
// In:  meshes of the element, the change parameters, wall/slab geometry. Out: THREE objects the caller adds to a group
//      of its own (never to the group it rebuilds) and disposes with geisterEntsorgen().
import * as THREE from "three";
import { umrissLinie } from "./hervorheben.js";

/** Opacity of the ghost fill [ASSUMED]: clearly a preview, the original stays readable behind it. */
export const GEISTER_DECKKRAFT = 0.35;

/**
 * Matrix that carries a world point of a drawn element to its position after the change:
 * p' = c + R(S(p - c)) + d (same order as transformieren(): scale, rotate counter-clockwise as seen in the plan, move).
 * The vertical shift is applied as given. The scale acts on the WORLD plan axes x and z (height stays), so for a wall that
 * does not run along x or z it also scales the thickness direction: the ghost of a scaling is an approximation, while
 * transformieren() keeps thickness and height and only changes the length (the plan overlay, planVorschau.js, is exact).
 * @param {{zentrum: {x: number, z: number}, verschiebung_m?: number[]|null, drehung_grad?: number|null, faktor?: number|null}} p
 *   zentrum: centre in m (plan x, z); verschiebung_m: [dx, dy, dz] in m; drehung_grad: degrees; faktor: unitless scale > 0.
 * @returns {THREE.Matrix4}
 */
export function geisterMatrix(p) {
  const [dx, dy, dz] = (p.verschiebung_m || [0, 0, 0]).map(Number);
  const rad = (Number(p.drehung_grad) || 0) * Math.PI / 180;
  const f = p.faktor != null && Number(p.faktor) > 0 ? Number(p.faktor) : 1;
  const { x: cx, z: cz } = p.zentrum;
  // rotateY(theta): x' = x cos + z sin, z' = -x sin + z cos - the plan rotation of transformieren() (z down), unchanged
  return new THREE.Matrix4()
    .makeTranslation(cx + dx, dy, cz + dz)
    .multiply(new THREE.Matrix4().makeRotationY(rad))
    .multiply(new THREE.Matrix4().makeScale(f, 1, f))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));
}

/**
 * Ghost of an element: translucent clones of its meshes moved by `matrix`, each with the dashed 'warnung' outline.
 * Geometry is shared with the originals (not copied); the clones own their material.
 * @param {THREE.Mesh[]} meshes  Meshes of ONE element (a composite wall has one per skin).
 * @param {THREE.Matrix4} matrix  World transformation from geisterMatrix().
 * @param {string} id  Proposal id, stored in userData.vorschlagId so the viewer can remove exactly this ghost.
 * @returns {THREE.Group}  Group with `userData.geisterId`; never pickable.
 */
export function geisterKlon(meshes, matrix, id) {
  const g = new THREE.Group();
  g.userData.geisterId = id;
  g.userData.zeigeHilfe = true;
  for (const m of meshes) {
    if (!m?.isMesh) continue;
    m.updateWorldMatrix(true, false);
    const klon = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({
      color: 0x8aa4b8, transparent: true, opacity: GEISTER_DECKKRAFT, depthWrite: false, side: THREE.DoubleSide,
    }));
    klon.matrixAutoUpdate = false;
    klon.matrix.copy(matrix).multiply(m.matrixWorld);
    klon.matrixWorldNeedsUpdate = true;
    klon.raycast = () => {};
    klon.userData.zeigeHilfe = true;
    klon.add(umrissLinie(new THREE.EdgesGeometry(m.geometry, 30), "warnung"));
    g.add(klon);
  }
  return g;
}

/**
 * Marker of a cut: the outline of the cutting plane (dashed rectangle) between two plan points and two heights, so the
 * cut is seen across the whole wall or just above a slab.
 * @param {{x: number, z: number}} a  One end of the cut in m (plan).
 * @param {{x: number, z: number}} b  Other end of the cut in m (plan).
 * @param {number} y0  Lower edge in m above the model's zero.
 * @param {number} y1  Upper edge in m above the model's zero.
 * @param {string} id  Proposal id (userData.geisterId).
 * @param {'warnung'|'fehler'} [zustand]  Look of the outline (default the dashed 'warnung').
 * @returns {THREE.LineSegments}
 */
export function schnittMarke(a, b, y0, y1, id, zustand = "warnung") {
  const p = (/** @type {{x: number, z: number}} */ q, /** @type {number} */ y) => new THREE.Vector3(q.x, y, q.z);
  const geo = new THREE.BufferGeometry().setFromPoints([p(a, y0), p(b, y0), p(b, y0), p(b, y1), p(b, y1), p(a, y1), p(a, y1), p(a, y0)]);
  const linie = umrissLinie(geo, zustand, { strichEinheit: 0.1 });
  linie.userData.geisterId = id;
  /** @type {any} */ (linie.material).depthTest = false;
  return linie;
}

/**
 * Removes one ghost (or marker) from its parent and frees what it owns (clone materials, outline geometry);
 * the geometry of a ghost clone is shared with the original and is NOT disposed.
 * @param {THREE.Object3D} objekt  Group from geisterKlon() or line from schnittMarke().
 * @returns {void}
 */
export function geisterEntsorgen(objekt) {
  objekt.parent?.remove(objekt);
  objekt.traverse((o) => {
    const m = /** @type {any} */ (o);
    if (o.userData.zeigeHilfe && m.isLineSegments) m.geometry?.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
}
