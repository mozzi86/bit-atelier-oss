// 104-16b: splat covariance Σ = R·S·Sᵀ·Rᵀ and the back-to-front depth order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kovarianzen, tiefenOrdnung } from "@designer/lib/splats/splatMathe.js";

const nah = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

test("Kovarianz: ohne Drehung diag(s²); 90° um z tauscht x und y", () => {
  const s = { anzahl: 2, skalierung: new Float32Array([2, 1, 0.5, 2, 1, 0.5]), rotation: new Float32Array([1, 0, 0, 0, Math.SQRT1_2, 0, 0, Math.SQRT1_2]) };
  const k = kovarianzen(s);
  assert.ok(nah(k[0], 4) && nah(k[3], 1) && nah(k[5], 0.25) && nah(k[1], 0) && nah(k[2], 0) && nah(k[4], 0));
  assert.ok(nah(k[6], 1) && nah(k[9], 4) && nah(k[11], 0.25) && nah(k[7], 0), `${[...k.slice(6)]}`);
});

test("Kovarianz bleibt symmetrisch positiv (45° um x)", () => {
  const h = Math.sin(Math.PI / 8), c = Math.cos(Math.PI / 8);
  const k = kovarianzen({ anzahl: 1, skalierung: new Float32Array([1, 2, 3]), rotation: new Float32Array([c, h, 0, 0]) });
  assert.ok(nah(k[0], 1));
  assert.ok(nah(k[3], (4 + 9) / 2) && nah(k[5], (4 + 9) / 2));
  assert.ok(nah(Math.abs(k[4]), (9 - 4) / 2));
});

test("Tiefenordnung: fernster zuerst (Kamera blickt nach −z)", () => {
  const position = new Float32Array([0, 0, -5, 0, 0, -1, 0, 0, -10, 0, 0, -3]);
  const identitaet = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual([...tiefenOrdnung(position, 4, identitaet)], [2, 0, 3, 1]);
  // camera moved: translation +20 in z changes nothing in the order
  const verschoben = [...identitaet]; verschoben[14] = 20;
  assert.deepEqual([...tiefenOrdnung(position, 4, verschoben)], [2, 0, 3, 1]);
  assert.deepEqual([...tiefenOrdnung(new Float32Array(3), 1, identitaet)], [0]);
});
