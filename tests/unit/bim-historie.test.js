// Undo/redo of the building model: one step per completed change, one step per drag.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leereHistorie, vorAenderung, zieheStart, zieheEnde, schrittZurueck, schrittVor } from "@designer/lib/bimHistorie";

const A = { walls: ["a"] };
const B = { walls: ["a", "b"] };
const C = { walls: ["a", "b", "c"] };

describe("bimHistorie", () => {
  it("zwei abgeschlossene Änderungen sind zwei Schritte, Strg+Z und Strg+Y holen sie zurück", () => {
    let h = leereHistorie();
    h = vorAenderung(h, A);
    h = vorAenderung(h, B);
    assert.equal(h.stack.past.length, 2);
    const u1 = schrittZurueck(h, C);
    assert.deepEqual(u1.snapshot, B);
    const u2 = schrittZurueck(u1.historie, B);
    assert.deepEqual(u2.snapshot, A);
    const w = schrittVor(u2.historie, A);
    assert.deepEqual(w.snapshot, B);
    assert.equal(schrittZurueck(leereHistorie(), A), null);
  });

  it("ein Ziehen ist ein Schritt, auch wenn die Maus mehrmals schreibt", () => {
    let h = vorAenderung(leereHistorie(), A);
    h = zieheStart(h);
    h = vorAenderung(h, B);
    h = vorAenderung(h, { walls: ["moved-1"] });
    h = vorAenderung(h, { walls: ["moved-2"] });
    assert.equal(h.stack.past.length, 2, "der Stand vor dem Ziehen plus der eine Zug");
    h = zieheEnde(h);
    h = vorAenderung(h, { walls: ["moved-2"] });
    assert.equal(h.stack.past.length, 3);
    const u = schrittZurueck(h, { walls: ["danach"] });
    assert.deepEqual(u.snapshot, { walls: ["moved-2"] });
  });

  it("Laden und der Änderungsschritt schreiben keine Historie", () => {
    const h = vorAenderung(vorAenderung(leereHistorie(), A), B, { still: true });
    assert.equal(h.stack.past.length, 1);
    assert.deepEqual(h.stack.past[0], A);
  });

  it("ein Ziehen ohne Bewegung erzeugt keinen Schritt", () => {
    const h = zieheEnde(zieheStart(leereHistorie()));
    assert.equal(h.stack.past.length, 0);
    assert.equal(h.ziehe, false);
  });
});
