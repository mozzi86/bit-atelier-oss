// Integrationstest gegen den ECHTEN planegcs-WASM-Solver (läuft auch unter
// Node — der Emscripten-Build lädt die .wasm dort über fs). Browser-seitig
// nutzt solver.js denselben Wrapper mit Vite-?url-Pfad.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { Sketch } from "@sketch/lib/sketchModel";
import { runSolve } from "@sketch/lib/solveCore";

let gcs;
before(async () => {
  gcs = await make_gcs_wrapper();
});
after(() => {
  gcs.destroy_gcs_module();
});

const nah = (ist, soll, eps = 1e-6) => assert.ok(Math.abs(ist - soll) < eps, `${ist} ≠ ${soll}`);

/** Rechteck wie gezeichnet: 4 Linien mit eigenen Endpunkten, Ecken per coincident. */
function rechteck() {
  const s = new Sketch();
  const unten = s.addLineByCoords(0.2, -0.1, 3.8, 0.3);
  const rechts = s.addLineByCoords(4.1, 0.2, 3.9, 2.8);
  const oben = s.addLineByCoords(4.2, 3.1, 0.1, 2.9);
  const links = s.addLineByCoords(-0.2, 3.2, 0.1, -0.2);
  s.addConstraint({ type: "coincident", a: unten.b.id, b: rechts.a.id });
  s.addConstraint({ type: "coincident", a: rechts.b.id, b: oben.a.id });
  s.addConstraint({ type: "coincident", a: oben.b.id, b: links.a.id });
  s.addConstraint({ type: "coincident", a: links.b.id, b: unten.a.id });
  s.addConstraint({ type: "horizontal", line: unten.line.id });
  s.addConstraint({ type: "parallel", a: oben.line.id, b: unten.line.id });
  s.addConstraint({ type: "vertical", line: links.line.id });
  s.addConstraint({ type: "parallel", a: rechts.line.id, b: links.line.id });
  s.addConstraint({ type: "distance", a: unten.a.id, b: unten.b.id, value: 4 });
  s.addConstraint({ type: "distance", a: links.a.id, b: links.b.id, value: 3 });
  // erdet den Sketch am Ursprung (lock friert die ANLEGE-Koordinaten ein)
  s.addConstraint({ type: "lock", point: unten.a.id, x: 0, y: 0 });
  return { s, unten, rechts, oben, links };
}

describe("planegcs-Integration (echter WASM-Solver)", () => {
  it("löst ein voll bestimmtes Rechteck auf DOF 0", () => {
    const { s, unten, oben } = rechteck();
    const r = runSolve(gcs, s);
    assert.ok(r.applied, `Status war ${r.statusName}`);
    assert.equal(r.dof, 0, "Rechteck muss voll bestimmt sein");
    assert.deepEqual(r.conflicting, []);
    assert.deepEqual(r.redundant, []);

    nah(s.points.get(unten.b.id).x, 4);
    nah(s.points.get(unten.b.id).y, 0);
    nah(s.points.get(oben.a.id).y, 3, 1e-5);
    nah(Math.abs(s.points.get(oben.b.id).x), 0, 1e-5);
  });

  it("Drag bewegt nur freie Richtungen (Constraints halten)", () => {
    const s = new Sketch();
    const { line, a, b } = s.addLineByCoords(0, 0, 4, 0);
    s.addConstraint({ type: "lock", point: a.id });
    s.addConstraint({ type: "horizontal", line: line.id });

    const r = runSolve(gcs, s, { extraConstraints: [{ type: "drag", point: b.id, x: 7, y: 5 }] });
    assert.ok(r.applied);
    nah(s.points.get(b.id).x, 7, 1e-4);
    nah(s.points.get(b.id).y, 0, 1e-4, "horizontal muss das Drag-Ziel auf y=0 zwingen");
    nah(s.points.get(a.id).x, 0, 1e-4, "gesperrter Punkt bleibt stehen");
  });

  it("meldet widersprüchliche Constraints mit Modell-IDs", () => {
    const s = new Sketch();
    const { a, b } = s.addLineByCoords(0, 0, 4, 0);
    const k1 = s.addConstraint({ type: "distance", a: a.id, b: b.id, value: 5 });
    const k2 = s.addConstraint({ type: "distance", a: a.id, b: b.id, value: 3 });

    const r = runSolve(gcs, s);
    assert.ok(r.conflicting.length >= 1, "Konflikt muss erkannt werden");
    for (const id of r.conflicting) assert.ok([k1.id, k2.id].includes(id), `unerwartete ID ${id}`);
  });

  it("meldet redundante Constraints", () => {
    const s = new Sketch();
    const { line } = s.addLineByCoords(0, 0, 4, 1);
    s.addConstraint({ type: "horizontal", line: line.id });
    const doppelt = s.addConstraint({ type: "horizontal", line: line.id });

    const r = runSolve(gcs, s);
    assert.ok(
      r.redundant.includes(doppelt.id) || r.partiallyRedundant.includes(doppelt.id),
      `Redundanz nicht gemeldet (redundant=${r.redundant}, partiell=${r.partiallyRedundant})`
    );
  });

  it("benannte Parameter steuern Maße (Re-Solve nach Parameteränderung)", () => {
    const s = new Sketch();
    s.setParam("breite", 5);
    const { a, b } = s.addLineByCoords(0, 0, 1, 0);
    s.addConstraint({ type: "lock", point: a.id });
    s.addConstraint({ type: "distance", a: a.id, b: b.id, value: "breite" });

    let r = runSolve(gcs, s);
    assert.ok(r.applied);
    nah(Math.hypot(s.points.get(b.id).x, s.points.get(b.id).y), 5, 1e-5);

    s.setParam("breite", 6.5);
    r = runSolve(gcs, s);
    assert.ok(r.applied);
    nah(Math.hypot(s.points.get(b.id).x, s.points.get(b.id).y), 6.5, 1e-5);
  });

  it("Kreis: Radius-Constraint setzt den Radius", () => {
    const s = new Sketch();
    const c = s.addCircle(s.addPoint(1, 1).id, 2);
    s.addConstraint({ type: "radius", circle: c.id, value: 0.75 });
    const r = runSolve(gcs, s);
    assert.ok(r.applied);
    nah(s.circles.get(c.id).radius, 0.75);
  });
});
