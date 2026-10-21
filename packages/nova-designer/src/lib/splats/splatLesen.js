// Gaussian-splat file reader (phase 104-16, own implementation from the public format descriptions).
//
// A gaussian splat scene (3D Gaussian Splatting, Kerbl et al. 2023) is a point cloud where every point is a
// small 3D gaussian: centre, scale along its three axes, rotation (quaternion), colour and opacity. Drone or
// phone scans of a plot are published as
//   .ply   — binary_little_endian PLY with the 3DGS vertex properties: x y z, f_dc_0..2 (colour as degree-0
//            spherical-harmonics coefficient), opacity (logit), scale_0..2 (log), rot_0..3 (quaternion w x y z,
//            not normalised), plus normals / higher SH terms that are skipped here;
//   .splat — the compact web format: 32 bytes per splat = position 3×float32, scale 3×float32 (linear),
//            colour RGBA 4×uint8 (A = opacity), rotation 4×uint8 (w x y z, value = (byte − 128) / 128).
// Both are turned into the same flat arrays (typed arrays, no objects per splat — scans have millions).
//
// In:  ArrayBuffer of the file, optional limit. Out: { anzahl, position, skalierung, rotation, farbe }.

/** Colour factor of the degree-0 SH basis function (1 / (2·√π)). */
export const SH_C0 = 0.28209479177387814;
/** Max. splats read [ASSUMED]: ~3 M ≈ 100 MB in memory; larger scans need thinning first. */
export const MAX_SPLATS = 3_000_000;

const TYP_BYTES = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

/**
 * @typedef {{anzahl: number, position: Float32Array, skalierung: Float32Array, rotation: Float32Array, farbe: Uint8Array}} Splats
 *   position / skalierung: 3 floats per splat (scene units, linear scale = standard deviation);
 *   rotation: 4 floats per splat (unit quaternion w x y z); farbe: 4 bytes per splat (RGBA, A = opacity)
 */

/** Empty arrays for n splats. @param {number} n @returns {Splats} */
function leer(n) {
  return { anzahl: n, position: new Float32Array(n * 3), skalierung: new Float32Array(n * 3), rotation: new Float32Array(n * 4), farbe: new Uint8Array(n * 4) };
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Normalise quaternion i in place (falls back to identity). @param {Float32Array} r @param {number} i */
function normiere(r, i) {
  const o = i * 4;
  const l = Math.hypot(r[o], r[o + 1], r[o + 2], r[o + 3]);
  if (l < 1e-12) { r[o] = 1; r[o + 1] = 0; r[o + 2] = 0; r[o + 3] = 0; return; }
  r[o] /= l; r[o + 1] /= l; r[o + 2] /= l; r[o + 3] /= l;
}

/**
 * Read a .splat file (32 bytes per splat).
 * @param {ArrayBuffer} puffer
 * @param {{max?: number}} [opt]
 * @returns {Splats}
 */
export function splatLesen(puffer, { max = MAX_SPLATS } = {}) {
  if (puffer.byteLength % 32 !== 0) throw new Error("Keine .splat-Datei: Länge ist kein Vielfaches von 32 Byte");
  const gesamt = puffer.byteLength / 32;
  if (gesamt > max) throw new Error(`Zu viele Splats (${gesamt.toLocaleString("de-DE")}, höchstens ${max.toLocaleString("de-DE")}) — Scan vorher ausdünnen`);
  const f = new Float32Array(puffer);
  const u = new Uint8Array(puffer);
  const s = leer(gesamt);
  for (let i = 0; i < gesamt; i++) {
    const fo = i * 8, bo = i * 32;
    s.position[i * 3] = f[fo]; s.position[i * 3 + 1] = f[fo + 1]; s.position[i * 3 + 2] = f[fo + 2];
    s.skalierung[i * 3] = f[fo + 3]; s.skalierung[i * 3 + 1] = f[fo + 4]; s.skalierung[i * 3 + 2] = f[fo + 5];
    for (let k = 0; k < 4; k++) s.farbe[i * 4 + k] = u[bo + 24 + k];
    for (let k = 0; k < 4; k++) s.rotation[i * 4 + k] = (u[bo + 28 + k] - 128) / 128;
    normiere(s.rotation, i);
  }
  return s;
}

/**
 * Parse the ASCII header of a PLY file.
 * @param {ArrayBuffer} puffer
 * @returns {{format: string, anzahl: number, eigenschaften: Array<{name: string, typ: string, versatz: number}>, schritt: number, datenBeginn: number}}
 */
export function plyKopf(puffer) {
  const kopfBytes = new Uint8Array(puffer, 0, Math.min(puffer.byteLength, 64 * 1024));
  const text = new TextDecoder("latin1").decode(kopfBytes);
  const ende = text.indexOf("end_header");
  if (!text.startsWith("ply") || ende < 0) throw new Error("Keine PLY-Datei (Kopf fehlt)");
  const zeilenEnde = text.indexOf("\n", ende);
  const datenBeginn = zeilenEnde + 1;
  let format = "", anzahl = 0, imVertex = false, schritt = 0;
  /** @type {Array<{name: string, typ: string, versatz: number}>} */
  const eigenschaften = [];
  for (const roh of text.slice(0, ende).split(/\r?\n/)) {
    const z = roh.trim().split(/\s+/);
    if (z[0] === "format") format = z[1];
    else if (z[0] === "element") { imVertex = z[1] === "vertex"; if (imVertex) anzahl = Number(z[2]); }
    else if (z[0] === "property" && imVertex) {
      if (z[1] === "list") throw new Error("PLY mit Listen-Eigenschaften im vertex-Element wird nicht unterstützt");
      const groesse = TYP_BYTES[z[1]];
      if (!groesse) throw new Error(`Unbekannter PLY-Typ „${z[1]}“`);
      eigenschaften.push({ name: z[2], typ: z[1], versatz: schritt });
      schritt += groesse;
    }
  }
  return { format, anzahl, eigenschaften, schritt, datenBeginn };
}

/**
 * Read a 3DGS .ply file (binary little endian).
 * @param {ArrayBuffer} puffer
 * @param {{max?: number}} [opt]
 * @returns {Splats}
 */
export function plyLesen(puffer, { max = MAX_SPLATS } = {}) {
  const k = plyKopf(puffer);
  if (k.format !== "binary_little_endian") throw new Error(`PLY-Format „${k.format}“ nicht unterstützt (nur binary_little_endian)`);
  if (k.anzahl > max) throw new Error(`Zu viele Splats (${k.anzahl.toLocaleString("de-DE")}, höchstens ${max.toLocaleString("de-DE")}) — Scan vorher ausdünnen`);
  const fehlt = ["x", "y", "z"].filter((n) => !k.eigenschaften.some((e) => e.name === n));
  if (fehlt.length) throw new Error(`PLY ohne Koordinaten (${fehlt.join(", ")})`);
  if (k.datenBeginn + k.anzahl * k.schritt > puffer.byteLength) throw new Error("PLY-Datei ist abgeschnitten");
  const dv = new DataView(puffer, k.datenBeginn);
  const lese = {
    char: (o) => dv.getInt8(o), int8: (o) => dv.getInt8(o), uchar: (o) => dv.getUint8(o), uint8: (o) => dv.getUint8(o),
    short: (o) => dv.getInt16(o, true), int16: (o) => dv.getInt16(o, true), ushort: (o) => dv.getUint16(o, true), uint16: (o) => dv.getUint16(o, true),
    int: (o) => dv.getInt32(o, true), int32: (o) => dv.getInt32(o, true), uint: (o) => dv.getUint32(o, true), uint32: (o) => dv.getUint32(o, true),
    float: (o) => dv.getFloat32(o, true), float32: (o) => dv.getFloat32(o, true), double: (o) => dv.getFloat64(o, true), float64: (o) => dv.getFloat64(o, true),
  };
  /** @type {Record<string, ((zeile: number) => number)|null>} */
  const feld = {};
  for (const name of ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "red", "green", "blue", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]) {
    const e = k.eigenschaften.find((x) => x.name === name);
    feld[name] = e ? ((zeile) => lese[e.typ](zeile * k.schritt + e.versatz)) : null;
  }
  const s = leer(k.anzahl);
  const sig = (v) => 1 / (1 + Math.exp(-v));
  for (let i = 0; i < k.anzahl; i++) {
    s.position[i * 3] = feld.x(i); s.position[i * 3 + 1] = feld.y(i); s.position[i * 3 + 2] = feld.z(i);
    // scale is stored as log(σ); a plain point cloud without scale gets a small fixed size [ASSUMED 5 cm]
    for (let a = 0; a < 3; a++) s.skalierung[i * 3 + a] = feld[`scale_${a}`] ? Math.exp(feld[`scale_${a}`](i)) : 0.05;
    if (feld.f_dc_0) {
      s.farbe[i * 4] = byte(0.5 + SH_C0 * feld.f_dc_0(i));
      s.farbe[i * 4 + 1] = byte(0.5 + SH_C0 * feld.f_dc_1(i));
      s.farbe[i * 4 + 2] = byte(0.5 + SH_C0 * feld.f_dc_2(i));
    } else if (feld.red) {
      s.farbe[i * 4] = feld.red(i); s.farbe[i * 4 + 1] = feld.green(i); s.farbe[i * 4 + 2] = feld.blue(i);
    } else {
      s.farbe[i * 4] = s.farbe[i * 4 + 1] = s.farbe[i * 4 + 2] = 200;
    }
    // opacity is stored as logit (sigmoid → 0…1)
    s.farbe[i * 4 + 3] = feld.opacity ? byte(sig(feld.opacity(i))) : 255;
    if (feld.rot_0) {
      s.rotation[i * 4] = feld.rot_0(i); s.rotation[i * 4 + 1] = feld.rot_1(i); s.rotation[i * 4 + 2] = feld.rot_2(i); s.rotation[i * 4 + 3] = feld.rot_3(i);
    } else s.rotation[i * 4] = 1;
    normiere(s.rotation, i);
  }
  return s;
}

/**
 * Read either format by file name / content.
 * @param {ArrayBuffer} puffer
 * @param {string} [dateiname]
 * @param {{max?: number}} [opt]
 * @returns {Splats}
 */
export function splatsLesen(puffer, dateiname = "", opt = {}) {
  const kopf = new TextDecoder("latin1").decode(new Uint8Array(puffer, 0, Math.min(3, puffer.byteLength)));
  if (kopf === "ply") return plyLesen(puffer, opt);
  if (/\.splat$/i.test(dateiname) || puffer.byteLength % 32 === 0) return splatLesen(puffer, opt);
  throw new Error("Unbekanntes Format — erwartet .ply (3D Gaussian Splatting) oder .splat");
}

/**
 * Bounding box of the splat centres (scene units).
 * @param {Splats} s
 * @returns {{min: [number, number, number], max: [number, number, number], mitte: [number, number, number]}}
 */
export function splatHuelle(s) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.anzahl; i++) for (let a = 0; a < 3; a++) {
    const v = s.position[i * 3 + a];
    if (v < min[a]) min[a] = v;
    if (v > max[a]) max[a] = v;
  }
  return { min: /** @type {any} */ (min), max: /** @type {any} */ (max), mitte: /** @type {any} */ (min.map((v, a) => (v + max[a]) / 2)) };
}
