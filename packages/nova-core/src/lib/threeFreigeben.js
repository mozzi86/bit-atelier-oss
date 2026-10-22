// Releasing three.js GPU resources (LO-02, REVIEW-PANELS). `o.material.dispose()` alone fails silently for
// multi-material meshes (material is an array) and never releases the textures a material holds
// (map, normalMap …) — GPU memory grew with every switch between the building model and other tabs.
//
// In:  a three.js object (mesh, line, group child) or material. Out: nothing; disposes in place.
// No three.js import: works on any object with the duck-typed dispose() methods (node-testable).

/** Texture slots of the standard three.js materials. */
const TEXTUR_FELDER = Object.freeze([
  "map", "lightMap", "aoMap", "emissiveMap", "bumpMap", "normalMap", "displacementMap",
  "roughnessMap", "metalnessMap", "alphaMap", "envMap", "specularMap", "gradientMap", "matcap",
]);

/**
 * Disposes one material or an array of materials together with their textures.
 * @param {any} material three.js Material, Material[] or null
 * @returns {void}
 */
export function materialFreigeben(material) {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (!m) continue;
    for (const feld of TEXTUR_FELDER) m[feld]?.dispose?.();
    m.dispose?.();
  }
}

/**
 * Disposes geometry and material(s) of one object (not its children — call it per traversed object).
 * @param {any} objekt three.js Object3D with optional geometry / material
 * @returns {void}
 */
export function objektFreigeben(objekt) {
  objekt?.geometry?.dispose?.();
  if (objekt?.material) materialFreigeben(objekt.material);
}
