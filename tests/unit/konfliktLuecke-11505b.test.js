// 115-05b part 2 (review of part 1, low): the card of a model field conflict is built in a lazily loaded module
// (bimModelSonderwege.js). The field is locked at once, the card follows when the module is there. Two gaps:
//   - the person opens project B while the module loads → no card of project A may appear while B is open, and A's field is
//     not left locked (a switch drops A's cards and locks anyway)
//   - the module fails to load → the field is not left locked without a card; the save reports the error to its caller
// The loader is replaced through the test seam `sonderwegeLader` of useBimModelSync.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bimServer } from "./bimServerAttrappe.js";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T10:05:00.000Z";

/** Waits a few event-loop turns until `bed()` holds. @param {() => boolean} bed @param {string} was */
async function bis(bed, was) {
  for (let i = 0; i < 200 && !bed(); i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.ok(bed(), was);
}

/**
 * Project A loaded, another device changed `dachform` (no holder claims it), then this page saves its own different value:
 * a field conflict of useBimModelSync (feldKonfliktMelden).
 * @param {any} sync @param {string} pid
 */
async function konfliktVorbereiten(sync, pid) {
  await sync.loadBimModel(pid);
  await sync.fremdenStandUebernehmen(pid, { id: `bm${pid}`, project_id: pid, updated_date: T1, dachform: "walm" }, { geraet: null });
}

test("switch to B while the card module loads → no card of A, A's field not locked", async () => {
  const srv = bimServer({ BimModel: [
    { id: "bmpL1", project_id: "pL1", updated_date: T0, dachform: "flach" },
    { id: "bmpL2", project_id: "pL2", updated_date: T0, dachform: "pult" },
  ] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  const sync = await import("@core/lib/useBimModelSync");
  const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
  const echt = sync.sonderwegeLader.laden;
  try {
    await konfliktVorbereiten(sync, "pL1");
    /** @type {(v?: any) => void} */ let freigeben = () => {};
    sync.sonderwegeLader.laden = () => new Promise((r) => { freigeben = () => r(echt()); });
    const speichern = sync.saveBimModel("pL1", { dachform: "sattel" });
    await bis(() => sync.feldGesperrt("pL1", "dachform"), "the field is locked at once");
    await sync.loadBimModel("pL2"); // the person opens B
    abgleichStand.leeren("pL2", { ausser: true }); // what the designer does on the switch (useModellAbgleich)
    freigeben();
    await speichern;
    const karten = abgleichStand.stand().konflikte.filter((k) => k.projektId === "pL1");
    assert.deepEqual(karten.map((k) => k.feld), [], "no card of A while B is open");
    assert.equal(sync.feldGesperrt("pL1", "dachform"), false, "A's field is not left locked");
  } finally {
    sync.sonderwegeLader.laden = echt;
    globalThis.fetch = altFetch;
  }
});

test("the card module fails to load → the field is not locked, the save reports the error", async () => {
  const srv = bimServer({ BimModel: [{ id: "bmpL3", project_id: "pL3", updated_date: T0, dachform: "flach" }] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  const sync = await import("@core/lib/useBimModelSync");
  const { abgleichStand } = await import("@core/lib/abgleich/abgleichStand");
  const echt = sync.sonderwegeLader.laden;
  try {
    await konfliktVorbereiten(sync, "pL3");
    sync.sonderwegeLader.laden = () => Promise.reject(new Error("Failed to fetch dynamically imported module"));
    await assert.rejects(sync.saveBimModel("pL3", { dachform: "sattel" }), /dynamically imported module/);
    assert.equal(sync.feldGesperrt("pL3", "dachform"), false, "no lock without a card");
    assert.deepEqual(abgleichStand.stand().konflikte.filter((k) => k.projektId === "pL3"), []);
    // the module is back: the next save of the same value gets its card (the field is compared again)
    sync.sonderwegeLader.laden = echt;
    await sync.saveBimModel("pL3", { dachform: "sattel" });
    assert.equal(sync.feldGesperrt("pL3", "dachform"), true);
    assert.deepEqual(abgleichStand.stand().konflikte.filter((k) => k.projektId === "pL3").map((k) => k.feld), ["dachform"]);
  } finally {
    sync.sonderwegeLader.laden = echt;
    globalThis.fetch = altFetch;
  }
});
