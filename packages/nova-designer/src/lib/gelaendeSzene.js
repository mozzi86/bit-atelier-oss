// gelaendeSzene.js — three.js builders of the 3D terrain study (phase 103).
//
// Builds the objects TerrainView3D puts into its height group (the group whose scale.y is the
// vertical exaggeration): terrain surface, skirt, water plane, plot outline, building bodies.
// Every object is in REAL metres relative to the reference height `bezug` (m a.s.l.):
// y = h − bezug. Axes as gelaendeStudie.js: x = east, z = south, y = up.
//
// Why own geometry instead of PlaneGeometry: the old view laid a PlaneGeometry flat with
// rotation.x = −π/2, which put DEM row 0 (south) to the north and showed the map mirrored from
// above; DoubleSide hid that the camera looked at the underside. Here every triangle is
// counter-clockwise seen from +y (normal up, FrontSide) and row 0 sits at z = +halbM (south).
//
// In:  DemRaster (gelaendeStudie.demRaster), reference height, polygons in plan metres.
// Out: THREE.BufferGeometry / THREE.Object3D; the caller adds, removes and disposes them.

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { knotenM, hoeheAn, verdichten } from "@designer/lib/gelaendeStudie";

/** Depth of the skirt below the reference height, metres — closes the terrain block at the sides. */
export const SCHUERZE_M = 5;
/** Height of the plot line above the terrain, metres — keeps it out of z-fighting. */
export const LINIE_UEBER_GELAENDE_M = 0.3;
/** Densification step of the plot line, metres. */
export const LINIE_SCHRITT_M = 2;
/** Strength of the flood tint on flooded terrain (0…1 mix towards the water colour) [ASSUMED]. */
export const FLUT_TOENUNG = 0.55;

/**
 * Colour ramp for a normalised height 0…1: green → ochre → rock → snow (unchanged from the old view).
 * @param {number} t 0…1
 * @returns {[number, number, number]} linear RGB 0…1
 */
export function hoehenFarbe(t) {
  /** @type {Array<[number, [number, number, number]]>} */
  const stops = [
    [0.0, [34, 102, 51]],
    [0.4, [120, 130, 60]],
    [0.7, [150, 120, 90]],
    [0.9, [130, 130, 135]],
    [1.0, [240, 240, 245]],
  ];
  const x = Math.max(0, Math.min(1, Number(t) || 0));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (x - t0) / (t1 - t0 || 1);
      return /** @type {[number, number, number]} */ (c0.map((c, k) => (c + (c1[k] - c) * f) / 255));
    }
  }
  return [1, 1, 1];
}

/**
 * Terrain surface as an indexed BufferGeometry: vertex (i, j) at (x east, h − bezug, z south),
 * two triangles per cell, counter-clockwise seen from +y — so computeVertexNormals points up
 * (regression "terrain seen from below").
 * @param {import("@designer/lib/gelaendeStudie").DemRaster} r raster
 * @param {number} bezug reference height, m a.s.l.
 * @returns {THREE.BufferGeometry} positions in metres, vertex colours, normals
 */
export function terrainGeometrie(r, bezug) {
  const n = r.n;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const spanne = (r.maxNHN - r.minNHN) || 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const p = knotenM(r, i, j);
      const h = r.h[k];
      pos[k * 3] = p.x; pos[k * 3 + 1] = h - bezug; pos[k * 3 + 2] = p.z;
      const [cr, cg, cb] = hoehenFarbe((h - r.minNHN) / spanne);
      col[k * 3] = cr; col[k * 3 + 1] = cg; col[k * 3 + 2] = cb;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = i * n + j + 1, c = (i + 1) * n + j, d = (i + 1) * n + j + 1;
      // a south-west, b south-east, c north-west, d north-east: (a, b, c) and (b, d, c) are CCW from +y.
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Skirt around the terrain: vertical walls from the terrain edge down to bezug − SCHUERZE_M,
 * so the block reads as a cut-out and not as a floating sheet. Walls face outwards.
 * @param {import("@designer/lib/gelaendeStudie").DemRaster} r raster
 * @param {number} bezug reference height, m a.s.l.
 * @returns {THREE.BufferGeometry} non-indexed triangles, metres
 */
export function schuerzeGeometrie(r, bezug) {
  const n = r.n;
  const unten = -SCHUERZE_M;
  /** @type {Array<[number, number]>} edge walk counter-clockwise seen from above: south → east → north → west */
  const rand = [];
  for (let j = 0; j < n; j++) rand.push([0, j]);
  for (let i = 1; i < n; i++) rand.push([i, n - 1]);
  for (let j = n - 2; j >= 0; j--) rand.push([n - 1, j]);
  for (let i = n - 2; i >= 0; i--) rand.push([i, 0]);
  const pos = [];
  for (let k = 0; k < rand.length - 1; k++) {
    const [i0, j0] = rand[k], [i1, j1] = rand[k + 1];
    const p0 = knotenM(r, i0, j0), p1 = knotenM(r, i1, j1);
    const y0 = r.h[i0 * n + j0] - bezug, y1 = r.h[i1 * n + j1] - bezug;
    // Quad p0-top, p0-bottom, p1-bottom, p1-top. The walk runs CCW seen from +y (x east, z south
    // means "CCW from above" = south edge west → east), so (top0, bottom0, bottom1) faces outwards.
    pos.push(p0.x, y0, p0.z, p0.x, unten, p0.z, p1.x, unten, p1.z);
    pos.push(p0.x, y0, p0.z, p1.x, unten, p1.z, p1.x, y1, p1.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Terrain material with the flood tint: Lambert with vertex colours plus a shader patch
 * (onBeforeCompile) — fragments whose real height lies below the water level are tinted, a thin
 * shore line marks the level (fwidth, WebGL2). Uniforms live in material.userData.u:
 * uPegel (m a.s.l.), uBezug (m a.s.l.), uWasserAn (0/1).
 * @returns {THREE.MeshLambertMaterial}
 */
export function terrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  const u = { uPegel: { value: -1e6 }, uBezug: { value: 0 }, uWasserAn: { value: 0 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (/** @type {any} */ shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uBezug;\nvarying float vHoeheM;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHoeheM = transformed.y + uBezug;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uPegel;\nuniform float uWasserAn;\nvarying float vHoeheM;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "if (uWasserAn > 0.5) {",
          "  float tiefe = uPegel - vHoeheM;",
          "  float breite = max(fwidth(vHoeheM) * 1.5, 0.02);",
          `  if (tiefe > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.42, 0.78), ${FLUT_TOENUNG.toFixed(2)});`,
          "  if (abs(tiefe) < breite) diffuseColor.rgb = vec3(0.04, 0.2, 0.45);",
          "}",
        ].join("\n"),
      );
  };
  mat.customProgramCacheKey = () => "gelaende-103-flut";
  return mat;
}

/**
 * Water plane over the whole cut-out at the water level (caller sets position.y = pegel − bezug).
 * @param {number} spanM edge length, metres
 * @returns {THREE.Mesh} horizontal plane, transparent, drawn after the terrain
 */
export function wasserEbene(spanM) {
  const geo = new THREE.PlaneGeometry(spanM, spanM);
  geo.rotateX(-Math.PI / 2); // face up (+y)
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a6fc4, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Plot outline that follows the terrain: densified every LINIE_SCHRITT_M, LINIE_UEBER_GELAENDE_M
 * above the surface, as a fat line (Line2 — width in screen px; caller keeps
 * material.resolution at the canvas size).
 * @param {import("@designer/lib/gelaendeStudie").DemRaster} r raster
 * @param {Array<{x:number,z:number}>} poly plot ring, metres
 * @param {number} bezug reference height, m a.s.l.
 * @param {{ farbe?: number, breitePx?: number, gestrichelt?: boolean }} [opt]
 * @returns {Line2}
 */
export function grundstuecksLinie(r, poly, bezug, { farbe = 0xffffff, breitePx = 3, gestrichelt = false } = {}) {
  const pts = verdichten(poly, LINIE_SCHRITT_M);
  const flach = [];
  for (const p of pts) flach.push(p.x, hoeheAn(r, p.x, p.z) - bezug + LINIE_UEBER_GELAENDE_M, p.z);
  const geo = new LineGeometry();
  geo.setPositions(flach);
  const mat = new LineMaterial({ color: farbe, linewidth: breitePx, dashed: gestrichelt, dashSize: 4, gapSize: 3, depthTest: true });
  const linie = new Line2(geo, mat);
  if (gestrichelt) linie.computeLineDistances();
  linie.renderOrder = 3;
  return linie;
}

/**
 * Building body as an extruded footprint: base at basisNHN (lowest terrain point − 0.5 m, so it
 * never floats), top at okff + storeys × storey height.
 * @param {Array<{x:number,z:number}>} ecken footprint, metres
 * @param {number} basisNHN base, m a.s.l.
 * @param {number} obenNHN top, m a.s.l.
 * @param {number} bezug reference height, m a.s.l.
 * @returns {THREE.Mesh}
 */
export function baukoerperMesh(ecken, basisNHN, obenNHN, bezug) {
  // Shape lives in XY; after rotateX(−π/2) shape (sx, sy) lands at (sx, ·, −sy), so sy = −z.
  const shape = new THREE.Shape(ecken.map((p) => new THREE.Vector2(p.x, -p.z)));
  const hoehe = Math.max(0.5, obenNHN - basisNHN);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: hoehe, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0xf2efe8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = basisNHN - bezug;
  const kanten = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0x3a3a3a }));
  mesh.add(kanten);
  return mesh;
}

/**
 * Empty a group and dispose geometries/materials of its direct children (and their children).
 * @param {THREE.Object3D} gruppe
 */
export function gruppeLeeren(gruppe) {
  while (gruppe.children.length) {
    const c = gruppe.children.pop();
    c.traverse((/** @type {any} */ o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}
