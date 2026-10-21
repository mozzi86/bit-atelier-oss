// Gaussian-splat maths on the CPU (phase 104-16, own derivation): 3D covariance per splat and the
// back-to-front depth order. Pure functions on typed arrays — the sort also runs inside a web worker.
//
// Covariance: a splat is a gaussian with standard deviations s = (sx, sy, sz) along the axes of its rotation R
// (unit quaternion w x y z). Its covariance is Σ = R·S·Sᵀ·Rᵀ with S = diag(s); symmetric, so 6 numbers
// (xx, xy, xz, yy, yz, zz) are stored.
//
// Order: splats are alpha-blended, so they must be drawn far → near. Depth = dot(view row 3, centre); a
// 16-bit counting sort over the depth range is O(n) and exact enough for blending (65 536 buckets).

/**
 * 3D covariances of all splats.
 * @param {{anzahl: number, skalierung: Float32Array, rotation: Float32Array}} s
 * @returns {Float32Array} 6 floats per splat: xx xy xz yy yz zz (scene units²)
 */
export function kovarianzen(s) {
  const out = new Float32Array(s.anzahl * 6);
  for (let i = 0; i < s.anzahl; i++) {
    const w = s.rotation[i * 4], x = s.rotation[i * 4 + 1], y = s.rotation[i * 4 + 2], z = s.rotation[i * 4 + 3];
    // rotation matrix of the unit quaternion (row-major)
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
    const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
    const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
    const sx = s.skalierung[i * 3], sy = s.skalierung[i * 3 + 1], sz = s.skalierung[i * 3 + 2];
    // M = R·S (columns of R scaled), Σ = M·Mᵀ
    const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz;
    const m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz;
    const m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz;
    const o = i * 6;
    out[o] = m00 * m00 + m01 * m01 + m02 * m02;
    out[o + 1] = m00 * m10 + m01 * m11 + m02 * m12;
    out[o + 2] = m00 * m20 + m01 * m21 + m02 * m22;
    out[o + 3] = m10 * m10 + m11 * m11 + m12 * m12;
    out[o + 4] = m10 * m20 + m11 * m21 + m12 * m22;
    out[o + 5] = m20 * m20 + m21 * m21 + m22 * m22;
  }
  return out;
}

/**
 * Back-to-front order of the splats for one view.
 * @param {Float32Array} position 3 floats per splat
 * @param {number} anzahl
 * @param {ArrayLike<number>} mv column-major 4×4 model-view matrix (three.js `elements`)
 * @param {Uint32Array} [ziel] output buffer (anzahl entries) to reuse
 * @returns {Uint32Array} splat indices, farthest first
 */
export function tiefenOrdnung(position, anzahl, mv, ziel = new Uint32Array(anzahl)) {
  // view-space z = row 3 of the model-view matrix · centre; the camera looks down −z, so the
  // farthest splat has the smallest z.
  const a = mv[2], b = mv[6], c = mv[10], d = mv[14];
  const tiefe = new Float32Array(anzahl);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < anzahl; i++) {
    const z = a * position[i * 3] + b * position[i * 3 + 1] + c * position[i * 3 + 2] + d;
    tiefe[i] = z;
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const FAECHER = 65536;
  const faktor = max > min ? (FAECHER - 1) / (max - min) : 0;
  const zaehler = new Uint32Array(FAECHER);
  const fach = new Uint16Array(anzahl);
  for (let i = 0; i < anzahl; i++) { const f = ((tiefe[i] - min) * faktor) | 0; fach[i] = f; zaehler[f]++; }
  // prefix sums: smallest z (farthest) first
  for (let f = 1; f < FAECHER; f++) zaehler[f] += zaehler[f - 1];
  for (let i = anzahl - 1; i >= 0; i--) ziel[--zaehler[fach[i]]] = i;
  return ziel;
}
