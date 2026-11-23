// 115-05b part 2 (A-7): a writer without a holder of the model (AVA's classification) writes from its OWN copy of the record. It
// names the updated_date of that copy (`opt.basisStand`); a strict save refuses with `nicht_geschrieben` when the stored base this
// page knows is another state - nothing is written, the stale copy never resets what was stored since.
//   - open project, copy older than the cached base → refused, no request; equal → written
//   - the project is not the open one (nichtOffenSchreiben) → the same check against that project's own base
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bimServer } from "./bimServerAttrappe.js";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T10:05:00.000Z";

test("basisStand: the copy is older than the cached base → nicht_geschrieben, nothing written; equal → written", async () => {
  const srv = bimServer({ BimModel: [{ id: "bmS1", project_id: "pS1", updated_date: T1, customWalls: [{ _idx: 3 }, { _idx: 4 }] }] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pS1");
    // the copy AVA loaded before another tab saved walls 3,4 (its updated_date T0)
    await assert.rejects(sync.saveBimModel("pS1", { customWalls: [{ _idx: 1, kg: "330" }] }, { streng: true, basisStand: T0 }),
      (/** @type {any} */ e) => e.code === "nicht_geschrieben" && Array.isArray(e.felder) && e.felder.includes("customWalls"));
    assert.equal(srv.schreiben.length, 0, `no write on a stale copy: ${JSON.stringify(srv.schreiben)}`);
    assert.deepEqual(srv.rec("BimModel", "pS1").customWalls, [{ _idx: 3 }, { _idx: 4 }], "the newer walls stay");
    // the copy is the stored state: written
    await sync.saveBimModel("pS1", { customWalls: [{ _idx: 3, kg: "330" }, { _idx: 4 }] }, { streng: true, basisStand: T1 });
    assert.equal(srv.schreiben.length, 1);
    assert.equal(srv.rec("BimModel", "pS1").customWalls[0].kg, "330");
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("basisStand: a project that is not the open one is checked against its own base", async () => {
  const srv = bimServer({ BimModel: [
    { id: "bmS2", project_id: "pS2", updated_date: T1, dachform: "walm" },
    { id: "bmS3", project_id: "pS3", updated_date: T0, dachform: "flach" },
  ] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pS3"); // another project is open
    await assert.rejects(sync.saveBimModel("pS2", { dachform: "sattel" }, { streng: true, basisStand: T0 }),
      (/** @type {any} */ e) => e.code === "nicht_geschrieben");
    assert.equal(srv.schreiben.length, 0, `no write: ${JSON.stringify(srv.schreiben)}`);
    assert.equal(srv.rec("BimModel", "pS2").dachform, "walm");
    await sync.saveBimModel("pS2", { dachform: "sattel" }, { streng: true, basisStand: T1 });
    assert.equal(srv.rec("BimModel", "pS2").dachform, "sattel");
  } finally {
    globalThis.fetch = altFetch;
  }
});
