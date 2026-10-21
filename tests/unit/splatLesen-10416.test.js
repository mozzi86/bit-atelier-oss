// 104-16a: gaussian-splat reader — .splat (32 bytes per splat) and 3DGS .ply (log scale, logit opacity, SH colour).
import { test } from "node:test";
import assert from "node:assert/strict";
import { splatLesen, plyLesen, plyKopf, splatsLesen, splatHuelle, SH_C0 } from "@designer/lib/splats/splatLesen.js";

/** Two splats in the .splat layout. */
function splatDatei() {
  const buf = new ArrayBuffer(64);
  const f = new Float32Array(buf), u = new Uint8Array(buf);
  f.set([1, 2, 3, 0.5, 0.25, 0.1], 0);
  u.set([255, 0, 0, 128], 24);
  u.set([255, 128, 128, 128], 28); // w = 127/128, x = y = z = 0
  f.set([-1, 0, 4, 1, 1, 1], 8);
  u.set([0, 255, 0, 255], 56);
  u.set([128, 255, 128, 128], 60); // x only
  return buf;
}

/** One splat as a 3DGS PLY (with an extra unused property to test offsets). */
function plyDatei() {
  const props = ["x", "y", "z", "nx", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const kopf = `ply\nformat binary_little_endian 1.0\nelement vertex 1\n${props.map((p) => `property float ${p}`).join("\n")}\nend_header\n`;
  const k = new TextEncoder().encode(kopf);
  const buf = new ArrayBuffer(k.length + props.length * 4);
  new Uint8Array(buf).set(k, 0);
  const dv = new DataView(buf, k.length);
  const werte = { x: 5, y: 6, z: 7, nx: 99, f_dc_0: 0, f_dc_1: 0.5 / SH_C0, f_dc_2: -0.5 / SH_C0, opacity: 0, scale_0: Math.log(2), scale_1: 0, scale_2: Math.log(0.5), rot_0: 2, rot_1: 0, rot_2: 0, rot_3: 0 };
  props.forEach((p, i) => dv.setFloat32(i * 4, werte[p], true));
  return buf;
}

test(".splat: Position, Maßstab, Farbe, Quaternion normiert", () => {
  const s = splatLesen(splatDatei());
  assert.equal(s.anzahl, 2);
  assert.deepEqual([...s.position.slice(0, 3)], [1, 2, 3]);
  assert.ok(Math.abs(s.skalierung[1] - 0.25) < 1e-6);
  assert.deepEqual([...s.farbe.slice(0, 4)], [255, 0, 0, 128]);
  assert.ok(Math.abs(s.rotation[0] - 1) < 1e-6, "w normalised to 1");
  assert.ok(Math.abs(s.rotation[5] - 1) < 1e-6, "second splat: x = 1");
  assert.throws(() => splatLesen(new ArrayBuffer(33)), /Vielfaches von 32/);
  assert.throws(() => splatLesen(splatDatei(), { max: 1 }), /Zu viele Splats/);
});

test(".ply 3DGS: exp-Skala, Sigmoid-Deckkraft, SH-Farbe, Versatz über fremde Eigenschaften", () => {
  const datei = plyDatei();
  const k = plyKopf(datei);
  assert.equal(k.anzahl, 1);
  assert.equal(k.schritt, 15 * 4);
  const s = plyLesen(datei);
  assert.deepEqual([...s.position], [5, 6, 7]);
  assert.ok(Math.abs(s.skalierung[0] - 2) < 1e-5 && Math.abs(s.skalierung[1] - 1) < 1e-5 && Math.abs(s.skalierung[2] - 0.5) < 1e-5);
  assert.deepEqual([...s.farbe], [128, 255, 0, 128]); // 0.5 / 1.0 / 0.0, opacity sigmoid(0) = 0.5
  assert.deepEqual([...s.rotation], [1, 0, 0, 0]);
  assert.equal(splatsLesen(datei, "scan.ply").anzahl, 1);
  assert.equal(splatsLesen(splatDatei(), "scan.splat").anzahl, 2);
  assert.throws(() => plyLesen(new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 0\nend_header\n").buffer), /nicht unterstützt/);
});

test("Hülle der Splat-Mittelpunkte", () => {
  const h = splatHuelle(splatLesen(splatDatei()));
  assert.deepEqual(h.min, [-1, 0, 3]);
  assert.deepEqual(h.max, [1, 2, 4]);
  assert.deepEqual(h.mitte, [0, 1, 3.5]);
});
