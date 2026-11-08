// bauherrModell3d.js — the building model of the BIM studio as a 3D file for the
// client portal (Phase 110-05, 08.11.2026).
//
// One truth (BIM rule of 10.10.2026, HANDOFF-BIM-WAHRHEIT-2026-10-10.md): the
// client sees the SAME scene the BIM studio builds — hull walls with their
// openings and glazing, knee wall, roof, drawn walls, windows and doors — not a
// second, simplified rendering. BitBimStudio.jsx hands its scene groups
// (buildingGroup, customGroup) to bauherrSzene(); only the layers a client
// should see go out (BAUHERR_EBENEN): rooms/zones, columns, terrain, context,
// dimensions, labels and planning penetrations stay inside the office.
// No component properties go out: the file holds geometry and materials only
// (the projection BauherrModell carries title and date).
//
// In:  three.js groups of the studio scene (metres, y up). Out: a THREE.Group
//      of clones or a GLB Blob. Side effects: none on the studio scene (meshes
//      are cloned; geometries are shared and NOT disposed here).

import * as THREE from "three";

/** Studio layers (userData.layer, BitBimStudio DEFAULT_LAYERS) that go to the client. */
export const BAUHERR_EBENEN = Object.freeze(["shell", "attika", "walls", "openings"]);

/** Kinds (userData.kind) that never go out even on an exported layer: planned penetrations are office planning. */
const NIE_ARTEN = new Set(["durchbruch"]);

/** Largest texture edge in the GLB, in pixels [ASSUMED: enough for a facade at portal size, keeps the file small]. */
const TEXTUR_MAX_PX = 1024;

/**
 * Layer of an object: its own userData.layer or the nearest ancestor's (glazing groups tag their meshes, wall groups their root).
 * @param {THREE.Object3D} o
 * @returns {string|undefined}
 */
function ebeneVon(o) {
  for (let p = /** @type {THREE.Object3D|null} */ (o); p; p = p.parent) if (p.userData?.layer) return p.userData.layer;
  return undefined;
}

/**
 * A material for the client: a clone without the studio's selection glow (emissive of the pick highlight).
 * @param {THREE.Material} m
 * @returns {THREE.Material}
 */
function materialKopie(m) {
  const k = m.clone();
  const e = /** @type {any} */ (k).emissive;
  if (e?.isColor) e.setHex(0x000000);
  return k;
}

/**
 * The client scene: clones of every mesh on a client layer, in world coordinates of the studio scene.
 * Layer visibility of the studio is ignored on purpose — a layer the planner switched off for drawing still goes out.
 * @param {Array<THREE.Object3D|null|undefined>} gruppen studio groups (buildingGroup, customGroup)
 * @returns {THREE.Group} group named "gebaeude"; its materials are clones (dispose with bauherrSzeneFreigeben)
 */
export function bauherrSzene(gruppen) {
  const aus = new THREE.Group();
  aus.name = "gebaeude";
  for (const g of gruppen) {
    if (!g) continue;
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const mesh = /** @type {THREE.Mesh} */ (o);
      if (!mesh.isMesh || o.userData?.zeigeHilfe) return;
      if (!BAUHERR_EBENEN.includes(ebeneVon(o) || "") || NIE_ARTEN.has(o.userData?.kind)) return;
      const material = Array.isArray(mesh.material) ? mesh.material.map(materialKopie) : materialKopie(mesh.material);
      const k = new THREE.Mesh(mesh.geometry, material);
      o.matrixWorld.decompose(k.position, k.quaternion, k.scale);
      aus.add(k);
    });
  }
  return aus;
}

/**
 * Frees what bauherrSzene created (material clones and their texture references stay with the studio).
 * @param {THREE.Group} szene
 */
export function bauherrSzeneFreigeben(szene) {
  szene.traverse((o) => {
    const m = /** @type {any} */ (o).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) x.dispose();
  });
}

/**
 * Removes every texture from the clones (fallback when a texture cannot be written, e.g. an image without pixels yet).
 * @param {THREE.Group} szene
 */
function ohneTexturen(szene) {
  szene.traverse((o) => {
    const m = /** @type {any} */ (o).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) {
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap", "emissiveMap", "alphaMap"]) if (x[k]) x[k] = null;
      x.needsUpdate = true;
    }
  });
}

/**
 * The studio scene as a binary glTF (GLB) for the client (bucket `freigaben` in the cloud, blob store locally).
 * @param {Array<THREE.Object3D|null|undefined>} gruppen studio groups (buildingGroup, customGroup)
 * @returns {Promise<Blob>} GLB, MIME model/gltf-binary
 * @throws {Error} plain text when the scene holds nothing for the client
 */
export async function szeneAlsGlb(gruppen) {
  const szene = bauherrSzene(gruppen);
  try {
    if (szene.children.length === 0) throw new Error("Im Gebäudemodell ist noch nichts gebaut — nichts für die 3D-Ansicht.");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const optionen = { binary: true, onlyVisible: false, maxTextureSize: TEXTUR_MAX_PX };
    let daten;
    try {
      daten = await new GLTFExporter().parseAsync(szene, optionen);
    } catch {
      // A texture that cannot be read back (no image data yet) must not stop the client file: colours only.
      ohneTexturen(szene);
      daten = await new GLTFExporter().parseAsync(szene, optionen);
    }
    return new Blob([/** @type {ArrayBuffer} */ (daten)], { type: "model/gltf-binary" });
  } finally {
    bauherrSzeneFreigeben(szene);
  }
}
