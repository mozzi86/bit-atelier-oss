// 72-05 (variant a): freehand ink in the sketch document — smoothing, pressure outline,
// simplification, eraser, serialisation; the solver never sees ink.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  glaetten, vereinfachen, strichUmriss, radiusBeiDruck, kompakt, punkteVon, radiereTreffer,
  STIFTBREITEN, DRUCK_OHNE_SENSOR,
} from "@sketch/lib/freihand.js";
import { Sketch, buildSolverInput } from "@sketch/lib/sketchModel.js";
import { LAYER_VERSION, migrateLayer } from "@core/lib/fachlayerSchema";

const linie = (n, p = 0.5) => Array.from({ length: n }, (_, i) => ({ x: i * 0.1, y: 0, p }));

test("glaetten: drops samples closer than minAbstand, keeps the true end point, missing pressure = 0.5", () => {
  const roh = [{ x: 0, y: 0 }, { x: 0.001, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }];
  const g = glaetten(roh, { glaettung: 0.5, minAbstand_m: 0.01 });
  assert.equal(g[0].p, DRUCK_OHNE_SENSOR);
  assert.ok(g.length < roh.length + 1);
  assert.deepEqual([g.at(-1).x, g.at(-1).y], [1, 0]);
  assert.deepEqual(glaetten([{ x: NaN, y: 1 }]), []);
});

test("vereinfachen: a straight line collapses to its ends, a corner stays", () => {
  assert.equal(vereinfachen(linie(20), 0.001).length, 2);
  const ecke = [...linie(10), ...Array.from({ length: 10 }, (_, i) => ({ x: 0.9, y: (i + 1) * 0.1, p: 0.5 }))];
  const v = vereinfachen(ecke, 0.001);
  assert.equal(v.length, 3);
  assert.deepEqual([v[1].x, v[1].y], [0.9, 0]);
});

test("pressure: sensorless device draws exactly the pen width, pen pressure widens and thins", () => {
  const b = STIFTBREITEN.mittel;
  assert.equal(radiusBeiDruck(b, 0.5), b / 2);
  assert.ok(radiusBeiDruck(b, 1) > b / 2);
  assert.ok(radiusBeiDruck(b, 0) < b / 2 && radiusBeiDruck(b, 0) > 0);
});

test("strichUmriss: closed polygon around the centre line with round caps", () => {
  const um = strichUmriss(linie(5), 0.1);
  const ys = um.map(([, y]) => y);
  assert.ok(Math.max(...ys) <= 0.05 + 1e-9 && Math.min(...ys) >= -0.05 - 1e-9);
  const xs = um.map(([x]) => x);
  assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 0.4, "caps reach beyond the ends");
  assert.equal(strichUmriss([{ x: 0, y: 0, p: 0.5 }], 0.1).length, 12, "a dot is a circle");
  // No self-crossing at the caps: the outline area is the swept area (length × width + round caps).
  const flaeche = Math.abs(um.reduce((a, [x, y], i) => { const [x2, y2] = um[(i + 1) % um.length]; return a + x * y2 - x2 * y; }, 0)) / 2;
  const soll = 0.4 * 0.1 + Math.PI * 0.05 ** 2;
  assert.ok(Math.abs(flaeche - soll) / soll < 0.08, `area ${flaeche} vs ${soll}`);
  assert.deepEqual(strichUmriss([], 0.1), []);
});

test("Sketch: strokes serialise, survive a round trip, are deletable and never reach the solver", () => {
  const s = new Sketch();
  s.addLineByCoords(0, 0, 1, 0);
  const st = s.addStroke(kompakt(linie(4)), { breite: 0.05, farbe: "#dc2626" });
  const json = JSON.parse(JSON.stringify(s.serialize()));
  assert.equal(json.strokes.length, 1);
  const s2 = Sketch.deserialize(json);
  assert.equal(s2.strokes.get(st.id).farbe, "#dc2626");
  assert.equal(punkteVon(s2.strokes.get(st.id)).length, 4);
  const eingabe = JSON.stringify(buildSolverInput(s2));
  assert.ok(!eingabe.includes(st.id), "ink is not solver input");
  assert.deepEqual(s2.deleteGeometry(st.id), [st.id]);
  assert.equal(s2.strokes.size, 0);
  // Old sketches without strokes and broken entries load cleanly.
  assert.equal(Sketch.deserialize({ points: [] }).strokes.size, 0);
  assert.equal(Sketch.deserialize({ strokes: [{ id: "s1", punkte: [], breite: 0.05 }] }).strokes.size, 0);
});

test("radiereTreffer: hits strokes within eraser radius + half width only", () => {
  const striche = [
    { id: "a", punkte: kompakt(linie(5)), breite: 0.04 },
    { id: "b", punkte: kompakt(linie(5).map((q) => ({ ...q, y: 1 }))), breite: 0.04 },
  ];
  assert.deepEqual(radiereTreffer(striche, { x: 0.2, y: 0.03 }, 0.02), ["a"]);
  assert.deepEqual(radiereTreffer(striche, { x: 0.2, y: 0.5 }, 0.05), []);
});

test("sketch_layer v2: a v1 blob migrates unchanged (strokes optional)", () => {
  assert.equal(LAYER_VERSION.sketch_layer, 2);
  const r = migrateLayer("sketch_layer", { v: 1, points: [{ id: "p1" }] });
  assert.equal(r.wert.v, 2);
  assert.deepEqual(r.wert.points, [{ id: "p1" }]);
});
