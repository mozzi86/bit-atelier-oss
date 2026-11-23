// Mesh of one terrain layer for the building studio (108-10): the raster of gelaendeEbenen.js (model metres, heights relative to
// ±0,00) as an indexed surface, 1 unit = 1 m, y up, model z = scene z. Two layers can lie on top of each other (existing and new
// ground): the materials below keep them apart without z-fighting — the existing ground turns translucent under a new one and the
// new ground is pushed forward in the depth buffer.
//
// In: raster (gelaendeEbenen.js). Out: THREE.BufferGeometry / material. No side effects; the caller disposes.
import * as THREE from "three";

/** Opacity of the existing ground while a new ground lies above/below it (0..1) [ASSUMED: readable through, still visible]. */
export const BESTAND_DECKKRAFT_UNTER_NEU = 0.35;

/**
 * Indexed surface of a terrain raster, faces up.
 * @param {import("@core/lib/massing/gelaende.js").Gelaende} g raster in model metres, heights in m relative to ±0,00
 * @returns {THREE.BufferGeometry} positions (x, height, z) in m
 */
export function rasterGeometrie(g) {
  const pos = new Float32Array(g.nx * g.ny * 3);
  for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
    const k = (j * g.nx + i) * 3;
    pos[k] = g.x0 + i * g.zelle; pos[k + 1] = g.h[j * g.nx + i]; pos[k + 2] = g.y0 + j * g.zelle;
  }
  /** @type {number[]} */
  const idx = [];
  for (let j = 0; j < g.ny - 1; j += 1) for (let i = 0; i < g.nx - 1; i += 1) {
    const a = j * g.nx + i, b = a + 1, c = a + g.nx, d = c + 1;
    idx.push(a, c, b, b, c, d); // counter-clockwise seen from above (+y)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Material of a terrain layer.
 * @param {{ebene: "bestand"|"neu", beide: boolean, render: boolean}} o beide = both layers exist (the existing one turns translucent);
 *   render = render mode (bright meadow green; the dark editor green looks black under a bright sky)
 * @returns {THREE.Material}
 */
export function gelaendeMaterial({ ebene, beide, render }) {
  const farbe = render ? 0x86a05c : 0x223524;
  const param = { color: farbe, side: THREE.DoubleSide };
  const mat = render ? new THREE.MeshStandardMaterial({ ...param, roughness: 0.95 }) : new THREE.MeshLambertMaterial(param);
  if (ebene === "bestand" && beide) { mat.transparent = true; mat.opacity = BESTAND_DECKKRAFT_UNTER_NEU; mat.depthWrite = false; }
  if (ebene === "neu") { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1; }
  return mat;
}
