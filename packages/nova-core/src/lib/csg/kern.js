// 107-18 (D-BK-08c): the ONLY file that imports the boolean library: manifold-3d (Apache-2.0, pinned 3.5.4, approved by the
// user on 26.10.2026; it replaces three-bvh-csg + three-mesh-bvh of 107-14 behind the same seam, backend.js). Why this
// library: it refuses a mesh that is not an oriented 2-manifold with an error instead of returning a silent wrong result,
// and its results are edge-conforming (no T-junctions). It is loaded lazily (laden.js, dynamic import): the JS part sits in
// the Vite chunk `csg`, the WebAssembly binary is a separate asset (budget.json `assets.manifold`); neither is on the start
// path.
//
// Loading: kernLaden() instantiates the WebAssembly module once per session. Browser: the binary URL comes from Vite
// (manifoldWasm.js, `?url` import — Vite-only, so it is imported dynamically and never in Node). Node (node:test): the
// package reads manifold.wasm next to its own file. The node test is the same one the library uses itself
// (process.versions.node), so the two never disagree about where the binary comes from. The operations are synchronous
// once loaded; before that they throw (callers go through csgLaden(), which awaits kernLaden()).
//
// What happens per operation: each input is welded with the SAME tolerance as the watertight check (wasserdicht.js
// verschweissen; the caller's toleranz_m of boolesch() reaches both), degenerate triangles are dropped, triangles with a
// T-junction corner on an open edge are split there (wasserdicht.js tVerbindungenTeilen — the check pairs such edges up and
// accepts the body, the library needs every edge shared by exactly two triangles, so it gets the same body made
// edge-conforming), the triangles are sorted into one run per material index, and every run gets its own original ID
// (Manifold.reserveIDs). The library's result keeps those IDs per triangle run, so the layer material survives the boolean:
// run original ID → material index → three group; a run with an ID this operation did not reserve is refused ("fehler"),
// never mapped to a default material. The result is copied into a clean non-indexed geometry (flat normals, groups
// ascending, geometrieBereinigen). Every WebAssembly object this file gets hold of is deleted afterwards.
// Mesh.merge() is deliberately NOT called: it would close gaps on its own, i.e. silently repair an input the check refused.
//
// Refusals: an input the library does not accept as a manifold (status NotManifold …) throws CsgAblehnung with
// grund "offen" and the input name; booleschMit() turns that into {ok: false, grund: "offen", eingabe, bericht: null}. A
// result with a status other than NoError throws grund "fehler". Both keep the library's status code in the text.
// Known limit of the library (manifold-3d 3.5.4, manifold.js): its `Manifold` constructor wrapper creates the native object,
// reads a status other than NoError and throws WITHOUT deleting that object, so this file never gets a handle to delete —
// every refused input leaks one small native object for the session. Rare: the own watertight check refuses open inputs
// before the library sees them, and T-junction inputs are split first. Way out: a library version that deletes before it
// throws (to be reported upstream).
//
// In: clean geometries (m, groups per material index). Out: clean result geometries; boolesch() with the safeguards.
// (Releasing: the caller disposes its own inputs and results.)

import * as THREE from "three";
import ManifoldModul from "manifold-3d";
import { dreieckIndizes, dreieckGruppen, geometrieBereinigen } from "./dreiecke.js";
import { istWasserdicht, verschweissen, tVerbindungenTeilen, WASSERDICHT_TOLERANZ_M } from "./wasserdicht.js";
import { volumen_m3 } from "./volumen.js";
import { booleschMit, CsgAblehnung } from "./backend.js";
import { CSG_VERSION } from "./basisHash.js";

/** @typedef {import("manifold-3d").ManifoldToplevel} ManifoldToplevel */
/** @typedef {import("manifold-3d").Manifold} Manifold */

/** @type {ManifoldToplevel|null} the instantiated library (one per session) */
let wasm = null;
/** @type {Promise<ManifoldToplevel>|null} */
let ladeVersprechen = null;

/** @returns {boolean} true under Node (same test as the library's own loader) */
function imNode() {
  return Boolean(/** @type {any} */ (globalThis).process?.versions?.node);
}

/**
 * Instantiates the WebAssembly module of the library once per session (see file head). A failed load is forgotten, so the
 * next call tries again.
 * @returns {Promise<ManifoldToplevel>}
 */
export function kernLaden() {
  if (wasm) return Promise.resolve(wasm);
  if (!ladeVersprechen) {
    ladeVersprechen = (async () => {
      /** @type {any} */
      let optionen;
      if (!imNode()) {
        const { MANIFOLD_WASM_URL } = await import("./manifoldWasm.js");
        optionen = { locateFile: () => MANIFOLD_WASM_URL };
      }
      const w = await ManifoldModul(optionen);
      w.setup();
      wasm = w;
      return w;
    })().catch((e) => {
      ladeVersprechen = null;
      throw e;
    });
  }
  return ladeVersprechen;
}

/** @returns {ManifoldToplevel} */
function bereit() {
  if (!wasm) throw new Error("CSG library not loaded: call csgLaden() first");
  return wasm;
}

/**
 * A library manifold from a three geometry (see file head). Throws CsgAblehnung("offen") when the library refuses it.
 * Exported for the performance test (conversion measured apart from the operation); the caller deletes the result.
 * @param {THREE.BufferGeometry} geo clean or indexed geometry, m
 * @param {"a"|"b"} [seite] input name for the refusal
 * @param {Map<number, number>} [idZuMaterial] filled: original ID of each run → material index
 * @param {number} [toleranz_m] weld tolerance in m (the one of the watertight check of this operation)
 * @returns {Manifold}
 */
export function manifoldVorbereiten(geo, seite = "a", idZuMaterial = new Map(), toleranz_m = WASSERDICHT_TOLERANZ_M) {
  const { Manifold, Mesh } = bereit();
  const pos = geo.getAttribute("position");
  const idx = dreieckIndizes(geo);
  const grp = dreieckGruppen(geo);
  const { geschweisst, lage } = verschweissen(pos, toleranz_m);
  /** @type {number[]} welded corners of the non-degenerate triangles */
  const roh = [];
  /** @type {number[]} material index per triangle of `roh` */
  const rohMaterial = [];
  for (let t = 0; t < grp.length; t += 1) {
    const v0 = geschweisst[idx[t * 3]], v1 = geschweisst[idx[t * 3 + 1]], v2 = geschweisst[idx[t * 3 + 2]];
    if (v0 === v1 || v1 === v2 || v0 === v2) continue; // degenerate (the watertight check skips them too)
    roh.push(v0, v1, v2);
    rohMaterial.push(grp[t]);
  }
  const { tri, herkunft } = tVerbindungenTeilen(roh, lage, toleranz_m);
  /** @type {Map<number, number[]>} material index → welded corners of its triangles */
  const jeMaterial = new Map();
  for (let t = 0; t < herkunft.length; t += 1) {
    const m = rohMaterial[herkunft[t]];
    let liste = jeMaterial.get(m);
    if (!liste) { liste = []; jeMaterial.set(m, liste); }
    liste.push(tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]);
  }
  const materialien = [...jeMaterial.keys()].sort((x, y) => x - y);
  const n = materialien.reduce((s, m) => s + /** @type {number[]} */ (jeMaterial.get(m)).length, 0);
  const triVerts = new Uint32Array(n);
  const runIndex = new Uint32Array(materialien.length + 1);
  const runOriginalID = new Uint32Array(materialien.length);
  const erste = materialien.length ? Manifold.reserveIDs(materialien.length) : 0;
  let k = 0;
  materialien.forEach((m, i) => {
    runIndex[i] = k;
    runOriginalID[i] = erste + i;
    idZuMaterial.set(erste + i, m);
    for (const v of /** @type {number[]} */ (jeMaterial.get(m))) triVerts[k++] = v;
  });
  runIndex[materialien.length] = k;
  const vertProperties = new Float32Array(lage.length * 3);
  for (let i = 0; i < lage.length; i += 1) vertProperties.set(lage[i], i * 3);
  const mesh = new Mesh({ numProp: 3, vertProperties, triVerts, runIndex, runOriginalID });
  try {
    return new Manifold(mesh);
  } catch (e) {
    const status = /** @type {any} */ (e)?.code || /** @type {any} */ (e)?.message || String(e);
    throw new CsgAblehnung("offen", seite, `library refused input ${seite}: ${status}`);
  }
}

/**
 * Clean three geometry from a library result: runs → groups through the original IDs (see file head).
 * @param {Manifold} r
 * @param {Map<number, number>} idZuMaterial
 * @returns {THREE.BufferGeometry}
 */
function geometrieAus(r, idZuMaterial) {
  const m = r.getMesh();
  const roh = new THREE.BufferGeometry();
  roh.setAttribute("position", new THREE.BufferAttribute(m.vertProperties, m.numProp));
  roh.setIndex(new THREE.BufferAttribute(m.triVerts, 1));
  for (let i = 0; i + 1 < m.runIndex.length; i += 1) {
    const anzahl = m.runIndex[i + 1] - m.runIndex[i];
    if (!anzahl) continue;
    const material = idZuMaterial.get(m.runOriginalID[i]);
    if (material === undefined) {
      roh.dispose();
      throw new CsgAblehnung("fehler", null, `library result run with unknown original ID ${m.runOriginalID[i]}`);
    }
    roh.addGroup(m.runIndex[i], anzahl, material);
  }
  try {
    return geometrieBereinigen(roh);
  } finally {
    roh.dispose();
  }
}

/**
 * @param {THREE.BufferGeometry} a
 * @param {THREE.BufferGeometry} b
 * @param {"subtract"|"union"|"intersect"} op
 * @param {{toleranz_m?: number}} [opt] weld tolerance in m (default: the one of the watertight check)
 * @returns {THREE.BufferGeometry} clean result
 */
function ausfuehren(a, b, op, opt = {}) {
  const toleranz_m = opt.toleranz_m ?? WASSERDICHT_TOLERANZ_M;
  /** @type {Map<number, number>} */
  const idZuMaterial = new Map();
  /** @type {Manifold[]} every library object of this operation (deleted in finally) */
  const objekte = [];
  try {
    const ma = manifoldVorbereiten(a, "a", idZuMaterial, toleranz_m);
    objekte.push(ma);
    const mb = manifoldVorbereiten(b, "b", idZuMaterial, toleranz_m);
    objekte.push(mb);
    const r = op === "subtract" ? ma.subtract(mb) : op === "union" ? ma.add(mb) : ma.intersect(mb);
    objekte.push(r);
    const status = r.status();
    if (status !== "NoError") throw new CsgAblehnung("fehler", null, `library result status: ${status}`);
    return geometrieAus(r, idZuMaterial);
  } finally {
    for (const o of objekte) o.delete();
  }
}

/**
 * The raw backend of this library: subtract/union/intersect WITHOUT the watertight check of D-BK-08b. Only for
 * booleschMit() (and tests that replace one operation); every caller uses boolesch() below. The library refuses a
 * non-manifold input on its own as well (second line behind the check).
 * @type {import("./backend.js").CsgBackend}
 */
export const csgBackend = Object.freeze({
  name: "manifold-3d",
  version: CSG_VERSION,
  subtract: (a, b, opt) => ausfuehren(a, b, "subtract", opt),
  union: (a, b, opt) => ausfuehren(a, b, "union", opt),
  intersect: (a, b, opt) => ausfuehren(a, b, "intersect", opt),
  watertight: istWasserdicht,
  volume: volumen_m3,
});

/**
 * Boolean of two bodies with the D-BK-08b safeguards (watertight check of both inputs, clean result), on this backend.
 * @param {THREE.BufferGeometry} a
 * @param {THREE.BufferGeometry} b
 * @param {"subtract"|"union"|"intersect"} op
 * @param {{toleranz_m?: number}} [opt]
 * @returns {import("./backend.js").BooleschOk|import("./backend.js").BooleschNein}
 */
export function boolesch(a, b, op, opt) {
  return booleschMit(csgBackend, a, b, op, opt);
}
