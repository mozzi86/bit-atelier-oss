import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Document, DocumentObject } from "@sketch/lib/document";
import { SketchObject } from "@sketch/lib/sketchModel";

// Testobjekt: deklariert Abhängigkeiten über deps (= Link-Property light)
// und protokolliert execute()-Aufrufe im gemeinsamen Log.
class Obj extends DocumentObject {
  constructor(id, deps = [], log = [], fail = false) {
    super(id, "test");
    this.deps = deps;
    this.log = log;
    this.fail = fail;
  }
  getOutList() {
    return this.deps;
  }
  execute() {
    if (this.fail) throw new Error(`${this.id} kaputt`);
    this.log.push(this.id);
  }
}

describe("Document (FreeCAD touch/recompute)", () => {
  it("führt Abhängigkeiten vor Abhängigen aus (Toposort)", () => {
    const doc = new Document();
    const log = [];
    doc.add(new Obj("b", ["a"], log));
    doc.add(new Obj("a", [], log));
    doc.add(new Obj("c", ["b"], log));
    const { errors } = doc.recompute();
    assert.equal(errors.size, 0);
    assert.deepEqual(log, ["a", "b", "c"]);
  });

  it("berechnet nur touched Objekte + deren Abhängige neu", () => {
    const doc = new Document();
    const log = [];
    const a = doc.add(new Obj("a", [], log));
    doc.add(new Obj("b", ["a"], log));
    const unabhaengig = doc.add(new Obj("x", [], log));
    doc.recompute();
    log.length = 0;

    a.touch();
    doc.recompute();
    assert.deepEqual(log, ["a", "b"], "x darf nicht neu laufen");
    assert.equal(unabhaengig.touched, false);
  });

  it("überspringt Abhängige eines fehlgeschlagenen Objekts mit Fehlerstatus", () => {
    const doc = new Document();
    const log = [];
    doc.add(new Obj("a", [], log, true));
    doc.add(new Obj("b", ["a"], log));
    const { errors } = doc.recompute();
    assert.equal(errors.get("a"), "a kaputt");
    assert.match(errors.get("b"), /übersprungen/);
    assert.deepEqual(log, [], "b darf nicht mit veralteter Eingabe rechnen");
    assert.equal(doc.get("a").error, "a kaputt");
  });

  it("verweigert Zyklen schon beim add()", () => {
    const doc = new Document();
    doc.add(new Obj("a", ["b"]));
    assert.throws(() => doc.add(new Obj("b", ["a"])), /Zyklus/);
    assert.equal(doc.get("b"), null, "zyklisches Objekt darf nicht im Dokument bleiben");
  });

  it("SketchObject.execute meldet Konflikte als Recompute-Fehler", () => {
    const doc = new Document();
    const sk = doc.add(new SketchObject("sk1"));
    sk.solverRun = () => ({ status: 2, statusName: "failed", dof: 0, conflicting: ["k1"], redundant: [], partiallyRedundant: [], applied: false });
    const { errors } = doc.recompute();
    assert.match(errors.get("sk1"), /überbestimmt.*k1/);
  });
});
