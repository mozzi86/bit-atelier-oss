// Gaussian-splat renderer for three.js (phase 104-16, own implementation, no splat library).
//
// How it draws: every splat is one instanced quad. Centre and 3D covariance live in a float data texture,
// colour + opacity in a byte texture; the only per-view upload is the draw order (one float per splat),
// sorted far → near in a web worker. The vertex shader projects the 3D covariance into the image plane
// (EWA splatting, Zwicker et al. 2001: Σ' = J·W·Σ·Wᵀ·Jᵀ with W = model-view rotation/scale and J the Jacobian
// of the perspective projection at the splat centre), adds a 0.3 px² low-pass so tiny splats stay visible,
// and spans the quad along the eigenvectors of Σ' out to 3 σ. The fragment shader evaluates the gaussian
// and blends premultiplied. Splats are transparent: drawn after opaque meshes (terrain, buildings), depth
// test on, depth write off — buildings hide splats behind them, splats never punch holes into buildings.
//
// In:  splats from splatLesen.js. Use: `const w = new SplatWolke(splats); scene.add(w.mesh);` and once per frame
//      before rendering `w.aktualisieren(kamera, renderer)`; `w.entsorgen()` when removed.

/* global Worker */
import * as THREE from "three";
import { kovarianzen, tiefenOrdnung } from "./splatMathe.js";

/** Splats per texture row (3 float texels each → texture width 3072). */
const JE_ZEILE = 1024;

const VERTEX = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uDaten;
uniform highp sampler2D uFarbe;
uniform vec2 uViewport;
uniform vec2 uFokus;
in float splatIndex;
out vec4 vFarbe;
out vec2 vPos;
void main() {
  int i = int(splatIndex);
  int sx = i % ${JE_ZEILE};
  int sy = i / ${JE_ZEILE};
  vec4 a = texelFetch(uDaten, ivec2(sx * 3, sy), 0);
  vec4 b = texelFetch(uDaten, ivec2(sx * 3 + 1, sy), 0);
  vec4 c = texelFetch(uDaten, ivec2(sx * 3 + 2, sy), 0);
  vec4 t = modelViewMatrix * vec4(a.xyz, 1.0);
  vec4 clip = projectionMatrix * t;
  float rand = 1.2 * clip.w;
  if (t.z > -0.05 || clip.x < -rand || clip.x > rand || clip.y < -rand || clip.y > rand) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside: dropped by clipping
    return;
  }
  // Σ columns: (xx xy xz) (xy yy yz) (xz yz zz)
  mat3 sigma = mat3(a.w, b.x, b.y, b.x, b.z, b.w, b.y, b.w, c.x);
  float z = t.z;
  // Jacobian of screen px w.r.t. view coords (camera looks down −z), column-major
  mat3 J = mat3(uFokus.x / -z, 0.0, 0.0,
                0.0, uFokus.y / -z, 0.0,
                uFokus.x * t.x / (z * z), uFokus.y * t.y / (z * z), 0.0);
  mat3 T = J * mat3(modelViewMatrix);
  mat3 cov = T * sigma * transpose(T);
  float ca = cov[0][0] + 0.3, cb = cov[0][1], cd = cov[1][1] + 0.3;
  float mitte = 0.5 * (ca + cd);
  float radius = length(vec2(0.5 * (ca - cd), cb));
  float l1 = mitte + radius;
  float l2 = max(mitte - radius, 0.1);
  vec2 e1 = abs(cb) < 1e-8 ? (ca >= cd ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : normalize(vec2(cb, l1 - ca));
  vec2 e2 = vec2(-e1.y, e1.x);
  vec2 v1 = e1 * min(3.0 * sqrt(l1), 1024.0);
  vec2 v2 = e2 * min(3.0 * sqrt(l2), 1024.0);
  vec2 versatz = position.x * v1 + position.y * v2;
  gl_Position = vec4(clip.xy / clip.w + versatz * 2.0 / uViewport, clip.z / clip.w, 1.0);
  vPos = position.xy * 3.0;
  vFarbe = texelFetch(uFarbe, ivec2(sx, sy), 0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
in vec4 vFarbe;
in vec2 vPos;
// GLSL3 in three r186: no gl_FragColor alias — own output
layout(location = 0) out vec4 ausgabe;
void main() {
  float r2 = dot(vPos, vPos);
  if (r2 > 9.0) discard;
  float alpha = vFarbe.a * exp(-0.5 * r2);
  if (alpha < 1.0 / 255.0) discard;
  ausgabe = vec4(vFarbe.rgb * alpha, alpha);
}`;

/** Data textures of a splat set. @param {import("./splatLesen.js").Splats} s */
function texturen(s) {
  const hoehe = Math.max(1, Math.ceil(s.anzahl / JE_ZEILE));
  const daten = new Float32Array(JE_ZEILE * 3 * hoehe * 4);
  const k = kovarianzen(s);
  for (let i = 0; i < s.anzahl; i++) {
    const o = i * 12; // 3 texels × 4 floats, rows are JE_ZEILE splats long so the index maps 1:1
    daten[o] = s.position[i * 3]; daten[o + 1] = s.position[i * 3 + 1]; daten[o + 2] = s.position[i * 3 + 2]; daten[o + 3] = k[i * 6];
    daten[o + 4] = k[i * 6 + 1]; daten[o + 5] = k[i * 6 + 2]; daten[o + 6] = k[i * 6 + 3]; daten[o + 7] = k[i * 6 + 4];
    daten[o + 8] = k[i * 6 + 5];
  }
  const tDaten = new THREE.DataTexture(daten, JE_ZEILE * 3, hoehe, THREE.RGBAFormat, THREE.FloatType);
  const farbe = new Uint8Array(JE_ZEILE * hoehe * 4);
  farbe.set(s.farbe);
  const tFarbe = new THREE.DataTexture(farbe, JE_ZEILE, hoehe, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [tDaten, tFarbe]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
  return { tDaten, tFarbe };
}

export class SplatWolke {
  /**
   * @param {import("./splatLesen.js").Splats} splats
   * @param {{worker?: boolean}} [opt] worker: sort in a web worker (default when available)
   */
  constructor(splats, { worker = typeof Worker !== "undefined" } = {}) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const index = new Float32Array(splats.anzahl);
    for (let i = 0; i < splats.anzahl; i++) index[i] = i;
    const attr = new THREE.InstancedBufferAttribute(index, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("splatIndex", attr);
    geo.instanceCount = splats.anzahl;
    const { tDaten, tFarbe } = texturen(splats);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uDaten: { value: tDaten }, uFarbe: { value: tFarbe }, uViewport: { value: new THREE.Vector2(1, 1) }, uFokus: { value: new THREE.Vector2(1, 1) } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    /** the three.js object to add to the scene (composition: three has no types here, see jsconfig) */
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.anzahl = splats.anzahl;
    this._position = splats.position;
    this._mv = new THREE.Matrix4();
    this._letzteSortierung = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    this._nr = 0;
    this._wartet = false;
    this._worker = null;
    if (worker && splats.anzahl > 0) {
      try {
        this._worker = new Worker(new URL("./splatSortierer.worker.js", import.meta.url), { type: "module" });
        this._worker.postMessage({ art: "daten", position: splats.position.slice(), anzahl: splats.anzahl });
        this._worker.onmessage = (e) => this._ordnungUebernehmen(e.data.ordnung);
      } catch { this._worker = null; } // fallback: sort on the main thread
    }
  }

  /** Copy a sort result into the instanced index attribute. @param {Uint32Array} ordnung */
  _ordnungUebernehmen(ordnung) {
    const attr = /** @type {THREE.InstancedBufferAttribute} */ (this.mesh.geometry.getAttribute("splatIndex"));
    const ziel = /** @type {Float32Array} */ (attr.array);
    for (let i = 0; i < ordnung.length; i++) ziel[i] = ordnung[i];
    attr.needsUpdate = true;
    this._wartet = false;
  }

  /**
   * Once per frame before rendering: viewport/focal uniforms and — when the view changed — a new sort.
   * @param {THREE.PerspectiveCamera} kamera
   * @param {THREE.WebGLRenderer} renderer
   */
  aktualisieren(kamera, renderer) {
    const groesse = renderer.getDrawingBufferSize(new THREE.Vector2());
    const u = /** @type {THREE.ShaderMaterial} */ (this.mesh.material).uniforms;
    u.uViewport.value.copy(groesse);
    u.uFokus.value.set(kamera.projectionMatrix.elements[0] * groesse.x / 2, kamera.projectionMatrix.elements[5] * groesse.y / 2);
    this.mesh.updateMatrixWorld();
    this._mv.multiplyMatrices(kamera.matrixWorldInverse, this.mesh.matrixWorld);
    // re-sort only when the viewing direction changed noticeably (row 3 = depth axis)
    const a = this._mv.elements, b = this._letzteSortierung.elements;
    const geaendert = Math.abs(a[2] - b[2]) + Math.abs(a[6] - b[6]) + Math.abs(a[10] - b[10]) + Math.abs(a[14] - b[14]) * 0.01 > 0.01;
    if (!geaendert || this._wartet || !this.anzahl) return;
    this._letzteSortierung.copy(this._mv);
    if (this._worker) {
      this._wartet = true;
      this._worker.postMessage({ art: "sortiere", mv: Array.from(a), nr: ++this._nr });
    } else {
      this._ordnungUebernehmen(tiefenOrdnung(this._position, this.anzahl, a));
    }
  }

  /** Free GPU memory and the worker. */
  entsorgen() {
    this._worker?.terminate();
    this._worker = null;
    const u = /** @type {THREE.ShaderMaterial} */ (this.mesh.material).uniforms;
    u.uDaten.value.dispose();
    u.uFarbe.value.dispose();
    this.mesh.geometry.dispose();
    /** @type {THREE.ShaderMaterial} */ (this.mesh.material).dispose();
  }
}

/**
 * Synthetic test scene (no scan needed): a sphere of coloured splats over a flat disc — used by the
 * E2E check and as "Beispiel laden" so the viewer can be tried without a drone scan.
 * @param {number} [n] number of splats
 * @returns {import("./splatLesen.js").Splats}
 */
export function beispielSplats(n = 20000) {
  const s = { anzahl: n, position: new Float32Array(n * 3), skalierung: new Float32Array(n * 3), rotation: new Float32Array(n * 4), farbe: new Uint8Array(n * 4) };
  let zufall = 1;
  const rnd = () => { zufall = (zufall * 16807) % 2147483647; return zufall / 2147483647; };
  for (let i = 0; i < n; i++) {
    const kugel = i % 3 !== 0;
    const u = rnd() * 2 * Math.PI, v = Math.acos(2 * rnd() - 1);
    const x = kugel ? 4 * Math.sin(v) * Math.cos(u) : (rnd() - 0.5) * 20;
    const y = kugel ? 4 + 4 * Math.cos(v) : 0;
    const z = kugel ? 4 * Math.sin(v) * Math.sin(u) : (rnd() - 0.5) * 20;
    s.position.set([x, y, z], i * 3);
    s.skalierung.set(kugel ? [0.15, 0.15, 0.05] : [0.3, 0.02, 0.3], i * 3);
    s.rotation.set([1, 0, 0, 0], i * 4);
    s.farbe.set(kugel ? [Math.round(127 + 127 * Math.sin(u)), Math.round(127 + 127 * Math.cos(v)), 200, 230] : [90, 140, 70, 255], i * 4);
  }
  return s;
}
