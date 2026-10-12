// Unit tests for 69-21: without `Worker` (node) ifcLesen falls back to the main-thread functions and
// keeps the result shape; a semantics failure lands in parseFehler instead of rejecting, and the
// caller's buffer is never detached. The worker path itself is proven headless in
// tests/e2e/ifc-worker-69-21.spec.js (main-thread block < 100 ms, with a control).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ifcLesen } from "../../packages/nova-ifc-viewer/src/lib/ifcLesen.js";

describe("69-21 ifcLesen (fallback path)", () => {
  it("no Worker in node: reads on the main thread, parse error is reported, not thrown", async () => {
    assert.equal(typeof globalThis.Worker, "undefined");
    const buffer = new TextEncoder().encode("kein IFC").buffer;
    const meldungen = [];
    const r = await ifcLesen(buffer, { parse: true }, (t) => meldungen.push(t));
    assert.equal(r.imWorker, false);
    assert.equal(r.parsed, null);
    assert.equal(r.geo, null);
    assert.equal(typeof r.parseFehler, "string");
    assert.ok(r.parseFehler.length > 0);
    assert.equal(buffer.byteLength, 8, "the caller's buffer stays usable");
  });

  it("nothing requested: empty result without touching web-ifc", async () => {
    const r = await ifcLesen(new ArrayBuffer(4), {});
    assert.deepEqual(r, { parsed: null, parseFehler: null, geo: null, imWorker: false });
  });
});
