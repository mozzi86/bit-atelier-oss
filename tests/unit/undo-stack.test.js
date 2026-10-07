// Unit tests for the undo/redo stack (quick task 260921, MSB-11).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leererStack, merke, zurueck, vor, UNDO_MAX } from "@core/lib/undoStack";

describe("undoStack", () => {
  it("merke / zurueck / vor in Reihenfolge", () => {
    let s = leererStack();
    s = merke(s, "A"); s = merke(s, "B");
    const u1 = zurueck(s, "C"); assert.equal(u1.snapshot, "B");
    const u2 = zurueck(u1.stack, "B"); assert.equal(u2.snapshot, "A");
    assert.equal(zurueck(u2.stack, "A"), null);
    const r = vor(u2.stack, "A"); assert.equal(r.snapshot, "B");
    const r2 = vor(r.stack, "B"); assert.equal(r2.snapshot, "C");
    assert.equal(vor(r2.stack, "C"), null);
  });
  it("neue Aenderung loescht den Redo-Zweig, Dubletten werden nicht gemerkt, Maximum haelt", () => {
    let s = merke(leererStack(), { x: 1 });
    s = zurueck(merke(s, { x: 2 }), { x: 3 }).stack;
    assert.equal(s.future.length, 1);
    s = merke(s, { x: 9 }); assert.equal(s.future.length, 0);
    s = merke(s, { x: 9 }); assert.equal(s.past.length, 2);
    for (let i = 0; i < 80; i += 1) s = merke(s, i);
    assert.equal(s.past.length, UNDO_MAX);
  });
});
