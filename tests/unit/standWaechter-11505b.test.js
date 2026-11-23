// 115-05b part 2 (A-5): the focus check of a tab without the change stream. On focus / visible again / a stream reconnect the page
// reads the BimModel and the BuildingComplex once and compares them with the base it knows on INEQUALITY (id or updated_date),
// never "newer": a bulk write and the file import are not streamed, and an import keeps an older updated_date.
//   - another updated_date, same id → taken in through the holders (fremdenStandUebernehmen {auchAelter: true}); the next strict
//     save builds on the new stand (no 409)
//   - an OLDER updated_date counts as another state too (the stream path keeps ignoring it)
//   - another record id (replaced by import / seed / restore) → "ersetzt": nothing merged, every save of the project refuses
//     (`code: "modell_ersetzt"`) until the page loads the project again
//   - the design record: another state → handed to the designer's three-way path, queued behind its writes
//   - triggers: window focus, document visibilitychange to "visible" (not "hidden")
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bimServer } from "./bimServerAttrappe.js";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T10:05:00.000Z";
const TALT = "2026-11-18T08:00:00.000Z";

test("BimModel: another updated_date (newer or OLDER) is taken in; equal → aktuell; another id → ersetzt, saves refused", async () => {
  const srv = bimServer({ BimModel: [{ id: "bmW1", project_id: "pW1", updated_date: T0, customWalls: [{ _idx: 1 }], dachform: "flach" }] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { standPruefen } = await import("@core/lib/abgleich/standWaechter.js");
    await sync.loadBimModel("pW1");
    /** @type {any[]} */ const gesehen = [];
    const ab = sync.aufFremdenStand((pid, f) => { if (pid === "pW1") gesehen.push(f); return ["customWalls"]; });
    try {
      assert.equal((await standPruefen("pW1")).bim, "aktuell");
      assert.equal(gesehen.length, 0);

      // another writer (bulk / not streamed) saved walls 3
      srv.setze("BimModel", { id: "bmW1", project_id: "pW1", updated_date: T1, customWalls: [{ _idx: 3 }], dachform: "flach" });
      assert.equal((await standPruefen("pW1")).bim, "uebernommen");
      assert.deepEqual(gesehen.at(-1)?.patch, { customWalls: [{ _idx: 3 }] }, "the holder got the foreign walls");
      assert.equal(gesehen.at(-1)?.stand?.updated_date, T1);
      // the next strict save builds on T1 (no 409)
      await sync.saveBimModel("pW1", { dachform: "sattel" });
      assert.equal(srv.schreiben.at(-1)?.stand, T1);
      const nachSpeichern = /** @type {string} */ (srv.rec("BimModel", "pW1").updated_date);

      // a file import put an OLDER state back (same id, older updated_date): another state all the same
      srv.setze("BimModel", { id: "bmW1", project_id: "pW1", updated_date: TALT, customWalls: [{ _idx: 5 }], dachform: "flach" });
      assert.deepEqual(await sync.fremdenStandUebernehmen("pW1", srv.rec("BimModel", "pW1"), { geraet: null }), [],
        "the stream path still ignores an older event");
      assert.equal((await standPruefen("pW1")).bim, "uebernommen");
      assert.deepEqual(gesehen.at(-1)?.patch?.customWalls, [{ _idx: 5 }]);
      assert.notEqual(nachSpeichern, TALT);

      // replaced by another record (other id): not merged, saves rest
      const vorher = gesehen.length;
      srv.entfernen("BimModel", "bmW1");
      srv.setze("BimModel", { id: "bmW1neu", project_id: "pW1", updated_date: T1, customWalls: [{ _idx: 9 }] });
      assert.equal((await standPruefen("pW1")).bim, "ersetzt");
      assert.equal(gesehen.length, vorher, "nothing of the other record is merged");
      const schreibenVorher = srv.schreiben.length;
      await assert.rejects(sync.saveBimModel("pW1", { dachform: "pult" }), (/** @type {any} */ e) => e.code === "modell_ersetzt");
      assert.equal(srv.schreiben.length, schreibenVorher, "no write while the model is replaced");
      assert.equal(sync.bimModelErsetzt("pW1"), true);
    } finally {
      ab();
    }
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("BuildingComplex: another id or updated_date → handed to the designer's path (queued); equal → nothing", async () => {
  const srv = bimServer({ BuildingComplex: [{ id: "k1", project_id: "pK1", updated_date: T1, name: "Testprojekt A", energy_systems: ["b"] }] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const { komplexStandPruefen } = await import("@core/lib/abgleich/standWaechter.js");
    /** @type {any[]} */ const genommen = [];
    /** @type {string[]} */ const reihe = [];
    let basis = { id: "k1", updated_date: T0 };
    const komplex = {
      pid: "pK1",
      basis: () => basis,
      nehmen: (/** @type {any} */ rec) => { genommen.push(rec); basis = { id: rec.id, updated_date: rec.updated_date }; },
      einreihen: (/** @type {() => Promise<any>} */ f) => { reihe.push("ein"); return f(); },
    };
    assert.equal(await komplexStandPruefen(komplex), "uebernommen");
    assert.deepEqual(genommen.map((r) => r.energy_systems), [["b"]]);
    assert.deepEqual(reihe, ["ein"], "queued behind the designer's writes");
    assert.equal(await komplexStandPruefen(komplex), "aktuell");
    assert.equal(genommen.length, 1);
    // no record known yet, another tab created one
    basis = /** @type {any} */ ({ id: null, updated_date: null });
    assert.equal(await komplexStandPruefen(komplex), "uebernommen");
    assert.equal(genommen.at(-1).id, "k1");
  } finally {
    globalThis.fetch = altFetch;
  }
});

// Review 115-05b part 2 (finding 1): a check whose page was left (unmount / project switch) while its GET was on the wire must not
// move a base under a write queued behind it (the flush on leaving). Before: the BimModel check merged the foreign stand (holders
// told, base moved) and the flush went out on that new stand; the design-record check handed it to the designer's path.
test("inactive check (page left while reading): BimModel base not moved, the queued flush keeps its stand; design record not taken", async () => {
  const srv = bimServer({
    BimModel: [{ id: "bmW2", project_id: "pW2", updated_date: T0, dachform: "flach" }],
    BuildingComplex: [{ id: "k2", project_id: "pW2", updated_date: T1, name: "Testprojekt B", energy_systems: ["fremd"] }],
  });
  const altFetch = globalThis.fetch;
  /** @type {() => void} */ let freigeben = () => {};
  let halten = false;
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
    if (halten && (opt.method || "GET") === "GET" && /BimModel\?/.test(String(url))) {
      halten = false;
      await new Promise((r) => { freigeben = () => r(undefined); });
    }
    return srv.fetch(url, opt);
  });
  try {
    const sync = await import("@core/lib/useBimModelSync");
    const { standPruefen } = await import("@core/lib/abgleich/standWaechter.js");
    await sync.loadBimModel("pW2");
    /** @type {any[]} */ const gesehen = [];
    const ab = sync.aufFremdenStand((pid, f) => { if (pid === "pW2") gesehen.push(f); return Object.keys(f.patch); });
    try {
      // another writer (not streamed) changes the model
      srv.setze("BimModel", { id: "bmW2", project_id: "pW2", updated_date: T1, dachform: "walm" });
      let aktiv = true;
      /** @type {any[]} */ const genommen = [];
      const komplex = {
        pid: "pW2",
        basis: () => ({ id: "k2", updated_date: T0 }),
        nehmen: (/** @type {any} */ rec) => { genommen.push(rec); },
        einreihen: (/** @type {() => Promise<any>} */ f) => f(),
      };
      halten = true;
      const pruefung = standPruefen("pW2", { komplex, aktiv: () => aktiv });
      await new Promise((r) => setTimeout(r, 10)); // the check's GET is on the wire
      // the person leaves: the page is inactive, its pending write is flushed (queued behind the check)
      aktiv = false;
      const flush = sync.saveBimModel("pW2", { dachform: "sattel" }, { streng: true }).catch((/** @type {any} */ e) => e);
      freigeben();
      const r = await pruefung;
      assert.equal(r.bim, "ohne", "the BimModel check of a page left takes nothing");
      assert.equal(r.komplex, "ohne", "the design-record check of a page left takes nothing");
      assert.equal(genommen.length, 0, "no foreign design record handed to the designer");
      await flush;
      const puts = srv.schreiben.filter((w) => w.entity === "BimModel" && w.methode === "PUT");
      assert.ok(puts.length >= 1, "the flush went out");
      assert.equal(puts[0].stand, T0, "the flush built on the base it was planned on, not on the stand the check read");
    } finally {
      ab();
    }
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("triggers: focus and visibilitychange to visible run the check, hidden does not", async () => {
  const { fokusAusloeser } = await import("@core/lib/abgleich/standWaechter.js");
  const fenster = new globalThis.EventTarget();
  const dokument = Object.assign(new globalThis.EventTarget(), { visibilityState: "visible" });
  let n = 0;
  const ab = fokusAusloeser({ fenster, dokument, pruefen: () => { n += 1; } });
  fenster.dispatchEvent(new Event("focus"));
  assert.equal(n, 1);
  dokument.visibilityState = "hidden";
  dokument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(n, 1);
  dokument.visibilityState = "visible";
  dokument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(n, 2);
  ab();
  fenster.dispatchEvent(new Event("focus"));
  assert.equal(n, 2, "unsubscribed");
});
