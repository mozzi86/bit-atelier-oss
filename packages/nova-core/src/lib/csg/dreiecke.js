// 107-14: triangle access and clean-up for the CSG core. Every reader of a solid (watertight check, volume, plane cut,
// cache) goes through these helpers, so the draw range and an index with unused rest entries are honoured in ONE place.
//
// Why a clean-up exists at all: the result of the boolean library uses a `drawRange` and may carry unused index entries
// behind it. A reader that walks the whole index (or the whole position buffer) counts those rests as triangles and gets a
// wrong volume without any error (research 24.10.2026, D-BK-08b). geometrieBereinigen() copies only the triangles inside the
// draw range into a fresh, non-indexed BufferGeometry with flat normals and groups per material index.
//
// In: three.js BufferGeometry (positions in m). Out: triangle vertex indices, triangle counts, a fresh clean geometry.
// No boolean library here — this module only needs three and stays testable when the library is missing.

import * as THREE from "three";

/**
 * Vertex indices (into the position attribute) of every triangle inside the draw range, three per triangle.
 * Indexed geometry: the range is in index units; non-indexed: in vertex units. Rests after the range are ignored.
 * @param {THREE.BufferGeometry} geo
 * @returns {Uint32Array} length = 3 · triangles
 */
export function dreieckIndizes(geo) {
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const gesamt = index ? index.count : pos ? pos.count : 0;
  const start = Math.max(0, geo.drawRange?.start ?? 0);
  const ende = Math.min(gesamt, start + (Number.isFinite(geo.drawRange?.count) ? geo.drawRange.count : gesamt));
  const n = Math.max(0, Math.floor((ende - start) / 3)) * 3;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = index ? index.getX(start + i) : start + i;
  return out;
}

/**
 * Number of triangles inside the draw range.
 * @param {THREE.BufferGeometry} geo
 * @returns {number}
 */
export function dreieckAnzahl(geo) {
  return dreieckIndizes(geo).length / 3;
}

/**
 * Material index of every triangle inside the draw range (from `geo.groups`; a triangle outside every group gets
 * `standard`). Position i belongs to triangle i of dreieckIndizes().
 * @param {THREE.BufferGeometry} geo
 * @param {number} [standard] material index for triangles without a group
 * @returns {Int32Array}
 */
export function dreieckGruppen(geo, standard = 0) {
  const index = geo.getIndex();
  const pos = geo.getAttribute("position");
  const gesamt = index ? index.count : pos ? pos.count : 0;
  const start = Math.max(0, geo.drawRange?.start ?? 0);
  const ende = Math.min(gesamt, start + (Number.isFinite(geo.drawRange?.count) ? geo.drawRange.count : gesamt));
  const n = Math.max(0, Math.floor((ende - start) / 3));
  const out = new Int32Array(n).fill(standard);
  for (const g of geo.groups || []) {
    const g0 = Math.max(start, g.start), g1 = Math.min(ende, g.start + (Number.isFinite(g.count) ? g.count : gesamt));
    // a triangle belongs to the group when its first corner lies inside the group's range
    for (let t = Math.max(0, Math.ceil((g0 - start) / 3)); t < n && start + t * 3 < g1; t += 1) out[t] = g.materialIndex ?? standard;
  }
  return out;
}

/**
 * Fresh, non-indexed copy of a geometry: only the triangles inside the draw range, sorted into one group per material
 * index (ascending), flat normals. Degenerate triangles (zero area) are kept: removing them is the watertight check's job.
 * @param {THREE.BufferGeometry} geo source (not changed, not disposed)
 * @param {{materialAbbildung?: (gruppenIndex: number) => number}} [opt]
 *   materialAbbildung: maps the source group's materialIndex to the material index of the result (the boolean
 *   library numbers its result materials itself; the backend passes the way back to the layer index)
 * @returns {THREE.BufferGeometry} positions in m, groups {start, count, materialIndex}, drawRange covering everything
 */
export function geometrieBereinigen(geo, opt = {}) {
  const idx = dreieckIndizes(geo);
  const grp = dreieckGruppen(geo);
  const abb = opt.materialAbbildung || ((/** @type {number} */ m) => m);
  const pos = geo.getAttribute("position");
  /** @type {Map<number, number[]>} material index → triangle numbers */
  const jeMaterial = new Map();
  for (let t = 0; t < grp.length; t += 1) {
    const m = abb(grp[t]);
    if (!jeMaterial.has(m)) jeMaterial.set(m, []);
    /** @type {number[]} */ (jeMaterial.get(m)).push(t);
  }
  const reihenfolge = [...jeMaterial.keys()].sort((a, b) => a - b);
  const p = new Float32Array(idx.length * 3);
  const neu = new THREE.BufferGeometry();
  let k = 0;
  for (const m of reihenfolge) {
    const start = k / 3;
    for (const t of /** @type {number[]} */ (jeMaterial.get(m))) {
      for (let e = 0; e < 3; e += 1) {
        const v = idx[t * 3 + e];
        p[k++] = pos.getX(v); p[k++] = pos.getY(v); p[k++] = pos.getZ(v);
      }
    }
    neu.addGroup(start, k / 3 - start, m);
  }
  neu.setAttribute("position", new THREE.BufferAttribute(p, 3));
  neu.computeVertexNormals(); // non-indexed → one normal per triangle (flat)
  return neu;
}

/**
 * Several clean geometries in one (layers of a wall side by side): positions concatenated, groups shifted. The parts
 * are NOT united — two layers that touch stay two closed solids (inner faces twice), which is what the per-layer volume
 * and the per-layer watertight check need.
 * @param {THREE.BufferGeometry[]} teile non-indexed geometries (geometrieBereinigen)
 * @returns {THREE.BufferGeometry}
 */
export function geometrienZusammenfuegen(teile) {
  const sauber = teile.map((g) => (g.getIndex() ? geometrieBereinigen(g) : g));
  const laenge = sauber.reduce((s, g) => s + g.getAttribute("position").count * 3, 0);
  const p = new Float32Array(laenge);
  const neu = new THREE.BufferGeometry();
  let off = 0;
  for (const g of sauber) {
    const src = /** @type {Float32Array} */ (g.getAttribute("position").array);
    p.set(src.subarray(0, g.getAttribute("position").count * 3), off);
    const basis = off / 3;
    const gruppen = g.groups.length ? g.groups : [{ start: 0, count: g.getAttribute("position").count, materialIndex: 0 }];
    for (const gr of gruppen) neu.addGroup(basis + gr.start, gr.count, gr.materialIndex ?? 0);
    off += g.getAttribute("position").count * 3;
  }
  neu.setAttribute("position", new THREE.BufferAttribute(p, 3));
  neu.computeVertexNormals();
  return neu;
}

/**
 * Splits a geometry into one fresh geometry per material index (review 107-14). A layered wall from wandSolid is several
 * closed solids side by side whose inner faces touch: as one body it is not watertight and every further boolean on it is
 * refused. 107-09/10 therefore run a further boolean per layer: split, cut each layer solid, glue the results again with
 * geometrienZusammenfuegen.
 * @param {THREE.BufferGeometry} geo source (not changed, not disposed)
 * @returns {Map<number, THREE.BufferGeometry>} material index → non-indexed geometry with one group (that index), ascending
 */
export function geometrieJeGruppe(geo) {
  const sauber = geometrieBereinigen(geo);
  const pos = /** @type {Float32Array} */ (sauber.getAttribute("position").array);
  /** @type {Map<number, THREE.BufferGeometry>} */
  const out = new Map();
  for (const g of sauber.groups) {
    if (!g.count) continue;
    const teil = new THREE.BufferGeometry();
    teil.setAttribute("position", new THREE.BufferAttribute(pos.slice(g.start * 3, (g.start + g.count) * 3), 3));
    teil.addGroup(0, g.count, g.materialIndex ?? 0);
    teil.computeVertexNormals();
    out.set(g.materialIndex ?? 0, teil);
  }
  sauber.dispose();
  return out;
}
