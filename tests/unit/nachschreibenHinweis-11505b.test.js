// 115-05b part 2 (E-5 of the final review, unit test asked for in part 1): a flush of a pending change (BIM studio, sketch in the
// studio, useFachlayer) that is refused ({geschrieben: false}) or fails is told to the person (one note), a written one is not.
// The studio and the layer hook share nachschreibenMitHinweis (@designer/lib/nachschreibenHinweis.js); the last test runs it on the
// real bimModelNachschreiben: the project was left and another writer changed it meanwhile → 409 → refused → one note.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bimServer } from "./bimServerAttrappe.js";

const T0 = "2026-11-19T10:00:00.000Z";

test("E-5: refused or failed flush → one note; written → none", async () => {
  const { nachschreibenMitHinweis } = await import("@designer/lib/nachschreibenHinweis.js");
  let hinweise = 0;
  const melden = () => { hinweise += 1; };
  const still = () => {};
  await nachschreibenMitHinweis(async () => ({ geschrieben: true }), "p", { a: 1 }, melden, still);
  assert.equal(hinweise, 0);
  await nachschreibenMitHinweis(async () => ({ geschrieben: false, grund: "veraltet" }), "p", { a: 1 }, melden, still);
  assert.equal(hinweise, 1);
  await nachschreibenMitHinweis(async () => { throw new Error("offline"); }, "p", { a: 1 }, melden, still);
  assert.equal(hinweise, 2);
});

test("E-5: a flush of the project left, changed meanwhile by another writer → refused (409) → one note, nothing mixed", async () => {
  const srv = bimServer({ BimModel: [
    { id: "bmN1", project_id: "pN1", updated_date: T0, sketch_layer: null, dachform: "flach" },
    { id: "bmN2", project_id: "pN2", updated_date: T0 },
  ] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { nachschreibenMitHinweis } = await import("@designer/lib/nachschreibenHinweis.js");
    await sync.loadBimModel("pN1");
    srv.setze("BimModel", { id: "bmN1", project_id: "pN1", updated_date: "2026-11-19T10:30:00.000Z", dachform: "walm" });
    await sync.loadBimModel("pN2"); // the person opened another project
    let hinweise = 0;
    const r = await nachschreibenMitHinweis(sync.bimModelNachschreiben, "pN1", { dachform: "sattel" }, () => { hinweise += 1; }, () => {});
    assert.equal(r.geschrieben, false);
    assert.equal(hinweise, 1, "the person is told");
    assert.equal(srv.rec("BimModel", "pN1").dachform, "walm", "the other writer's value stays");
  } finally {
    globalThis.fetch = altFetch;
  }
});
