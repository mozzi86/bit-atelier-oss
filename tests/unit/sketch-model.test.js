import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Sketch, buildSolverInput, solverIdToModelId, constraintRefs } from "@sketch/lib/sketchModel";

describe("Sketch-Modell", () => {
  it("validiert Geometrie-Referenzen beim Anlegen", () => {
    const s = new Sketch();
    assert.throws(() => s.addLine("fehlt1", "fehlt2"), /Endpunkt fehlt/);
    const { a } = s.addLineByCoords(0, 0, 5, 0);
    assert.throws(() => s.addLine(a.id, a.id), /identische Endpunkte/);
    assert.throws(() => s.addConstraint({ type: "horizontal", line: "gibtsnicht" }), /Referenz .* fehlt/);
    assert.throws(() => s.addConstraint({ type: "quatsch", a: a.id, b: a.id }), /Unbekannter Constraint-Typ/);
  });

  it("Löschen einer Linie räumt Constraints und verwaiste Endpunkte auf — ohne Index-Remapping", () => {
    const s = new Sketch();
    const l1 = s.addLineByCoords(0, 0, 5, 0);
    const l2 = s.addLine(l1.b.id, s.addPoint(5, 5).id); // teilt Punkt b mit l1
    const k = s.addConstraint({ type: "horizontal", line: l1.line.id });
    s.addConstraint({ type: "coincident", a: l1.b.id, b: l2.p1 });

    s.deleteGeometry(l1.line.id);
    assert.equal(s.lines.has(l1.line.id), false);
    assert.equal(s.constraints.has(k.id), false, "Constraint der Linie muss mit weg");
    assert.equal(s.points.has(l1.a.id), false, "verwaister Endpunkt muss weg");
    assert.equal(s.points.has(l1.b.id), true, "geteilter Punkt bleibt (l2 + coincident referenzieren ihn)");
    assert.equal(s.lines.has(l2.id), true, "andere Linie bleibt unter stabiler ID erreichbar");
  });

  it("Löschen eines Punkts zieht referenzierende Geometrie mit (kaskadiert)", () => {
    const s = new Sketch();
    const { line, a } = s.addLineByCoords(0, 0, 3, 3);
    s.deleteGeometry(a.id);
    assert.equal(s.lines.has(line.id), false);
    assert.equal(s.points.size, 0, "auch der zweite Endpunkt ist verwaist");
  });

  it("buildSolverInput: Reihenfolge Params → Punkte → Geometrie → Constraints", () => {
    const s = new Sketch();
    s.setParam("breite", 4);
    const { line, a, b } = s.addLineByCoords(0, 0, 1, 1);
    s.addConstraint({ type: "distance", a: a.id, b: b.id, value: "breite" });
    const prims = buildSolverInput(s);
    const kinds = prims.map((p) => p.type);
    assert.deepEqual(kinds, ["param", "point", "point", "line", "p2p_distance"]);
    assert.equal(prims[4].distance, "breite", "Parametername wird durchgereicht");
    assert.equal(prims[3].p1_id, a.id);
    assert.equal(prims[3].id, line.id);
  });

  it("lock erzeugt zwei Solver-Constraints mit @-Suffix; Rück-Mapping funktioniert", () => {
    const s = new Sketch();
    const p = s.addPoint(2, 3);
    const k = s.addConstraint({ type: "lock", point: p.id });
    const prims = buildSolverInput(s).filter((x) => x.type.startsWith("coordinate_"));
    assert.deepEqual(prims.map((x) => x.id), [`${k.id}@x`, `${k.id}@y`]);
    assert.equal(prims[0].x, 2);
    assert.equal(prims[1].y, 3);
    assert.equal(solverIdToModelId(`${k.id}@x`), k.id);
    assert.equal(solverIdToModelId("k99"), "k99");
  });

  it("drag-Extra-Constraint wird als temporäre Koordinaten-Constraints gemappt", () => {
    const s = new Sketch();
    const p = s.addPoint(0, 0);
    const prims = buildSolverInput(s, [{ type: "drag", point: p.id, x: 7, y: 8 }]);
    const drag = prims.filter((x) => x.temporary === true);
    assert.equal(drag.length, 2);
    assert.deepEqual(drag.map((x) => x.type), ["coordinate_x", "coordinate_y"]);
    assert.equal(drag[0].x, 7);
    assert.equal(drag[1].y, 8);
  });

  it("Parameter-Constraints verlangen definierte Parameter", () => {
    const s = new Sketch();
    const { a, b } = s.addLineByCoords(0, 0, 1, 0);
    assert.throws(
      () => s.addConstraint({ type: "distance", a: a.id, b: b.id, value: "undefiniert" }),
      /Parameter "undefiniert" nicht definiert/
    );
  });

  it("Maß-Constraints verweigern Werte <= 0 (Review-Befund: negativer Radius korrumpiert das Modell)", () => {
    const s = new Sketch();
    const c = s.addCircle(s.addPoint(0, 0).id, 1);
    const { a, b } = s.addLineByCoords(0, 0, 2, 0);
    assert.throws(() => s.addConstraint({ type: "radius", circle: c.id, value: -1 }), /muss > 0/);
    assert.throws(() => s.addConstraint({ type: "radius", circle: c.id, value: 0 }), /muss > 0/);
    assert.throws(() => s.addConstraint({ type: "distance", a: a.id, b: b.id, value: 0 }), /muss > 0/);
    assert.throws(() => s.addConstraint({ type: "distance", a: a.id, b: b.id, value: NaN }), /keine Zahl/);
    // Winkel darf 0 und negativ sein (Richtungswinkel)
    const l2 = s.addLineByCoords(0, 1, 2, 2);
    const l3 = s.addLineByCoords(0, 2, 2, 3);
    s.addConstraint({ type: "angle", a: l2.line.id, b: l3.line.id, value: 0 });
  });

  it("lock friert die Koordinaten beim ANLEGEN ein (kein Anker-Drift über Solves)", () => {
    const s = new Sketch();
    const p = s.addPoint(2, 3);
    const k = s.addConstraint({ type: "lock", point: p.id });
    p.x = 99; // Solver-Writeback simuliert
    p.y = 99;
    const coords = buildSolverInput(s).filter((x) => x.type.startsWith("coordinate_"));
    assert.equal(coords[0].x, 2, "lock muss den Anlege-Zeitpunkt halten, nicht die aktuelle Position");
    assert.equal(coords[1].y, 3);
    assert.equal(k.x, 2);
  });

  it("deserialize überspringt Einträge mit toten Referenzen (korrupter localStorage)", () => {
    const s = Sketch.deserialize({
      points: [{ id: "p1", type: "point", x: 0, y: 0, fixed: false, construction: false }],
      lines: [
        { id: "l1", type: "line", p1: "p1", p2: "FEHLT", construction: false },
      ],
      circles: [{ id: "c1", type: "circle", center: "p1", radius: -2, construction: false }],
      constraints: [
        { id: "k1", type: "horizontal", line: "l1", driving: true },
        { id: "k2", type: "lock", point: "p1", driving: true, x: 0, y: 0 },
        { id: "k3", type: "kaputt", driving: true },
      ],
      params: [],
    });
    assert.equal(s.lines.size, 0, "Linie mit totem Endpunkt muss draußen bleiben");
    assert.equal(s.circles.size, 0, "Kreis mit ungültigem Radius muss draußen bleiben");
    assert.deepEqual([...s.constraints.keys()], ["k2"], "nur der Constraint mit intakten Referenzen überlebt");
  });

  it("Serialisierung ist verlustfrei (Roundtrip)", () => {
    const s = new Sketch();
    s.setParam("h", 3);
    const { line } = s.addLineByCoords(0, 0, 4, 0);
    const c = s.addCircle(s.addPoint(2, 2).id, 1.5, { construction: true });
    s.addConstraint({ type: "horizontal", line: line.id });
    s.addConstraint({ type: "radius", circle: c.id, value: "h", driving: false });

    const kopie = Sketch.deserialize(JSON.parse(JSON.stringify(s.serialize())));
    assert.deepEqual(kopie.serialize(), s.serialize());
    assert.equal(kopie.circles.get(c.id).construction, true);
    assert.equal(kopie.constraints.size, 2);
  });

  it("constraintRefs deckt alle Typen ab", () => {
    for (const [c, refs] of [
      [{ type: "coincident", a: "p1", b: "p2" }, ["p1", "p2"]],
      [{ type: "pointOnLine", point: "p1", line: "l1" }, ["p1", "l1"]],
      [{ type: "radius", circle: "c1" }, ["c1"]],
      [{ type: "lock", point: "p1" }, ["p1"]],
      [{ type: "angle", a: "l1", b: "l2" }, ["l1", "l2"]],
    ]) {
      assert.deepEqual(constraintRefs(c), refs);
    }
  });
});
