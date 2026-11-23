// 115-05a (A-1, A-3): the save path of useBimModelSync with a fetch stand-in (pattern aenderungsStrom-10609 /
// abgleichReview-10609 bimServer):
//   - a holder of local state gets the FULL old base of a foreign state (f.basis), not only the changed fields (f.vorher)
//   - bimModelNachschreiben (flush of a project that is no longer open): written on the strict base of THAT project, and
//     the one-project cache stays on the project open now (its stream events are still taken in)
//   - a flush on an outdated base (409) is refused, never merged; a field held back by an open conflict refuses the flush
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";

const T0 = "2026-11-19T10:00:00.000Z";

/**
 * A fetch stand-in of the BimModel records of several projects. GET ?project_id= → that record; PUT ?stand= on another
 * stand → 409 with the stored record (like routes.js standVeraltet, inequality since review 115-05b part 2), else a flat merge with a new updated_date.
 * @param {any[]} records
 * @returns {{puts: Array<{id: string, stand: string|null, body: any}>, fetch: any, setze: (r: any) => void, rec: (pid: string) => any}}
 */
function bimServer(records) {
  const recs = new Map(records.map((r) => [r.id, r]));
  /** @type {Array<{id: string, stand: string|null, body: any}>} */ const puts = [];
  let n = 0;
  const antwort = (/** @type {number} */ status, /** @type {any} */ json) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => json });
  return {
    puts,
    setze: (r) => { recs.set(r.id, r); },
    rec: (pid) => [...recs.values()].find((r) => r.project_id === pid),
    fetch: async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
      const u = new URL(String(url), "http://test.local");
      if ((opt.method || "GET") === "GET") {
        const pid = u.searchParams.get("project_id");
        return antwort(200, [...recs.values()].filter((r) => r.project_id === pid));
      }
      const id = decodeURIComponent(u.pathname.split("/").pop() || "");
      const stand = u.searchParams.get("stand");
      const body = JSON.parse(opt.body);
      puts.push({ id, stand, body });
      const vorher = recs.get(id);
      if (stand && vorher && stand !== vorher.updated_date) return antwort(409, { error: "veraltet", konflikt: true, gespeichert: vorher });
      n += 1;
      const neu = { ...vorher, ...body, updated_date: `2026-11-19T11:${String(n).padStart(2, "0")}:00.000Z` };
      recs.set(id, neu);
      return antwort(200, neu);
    },
  };
}

test("a holder gets the FULL old base of a foreign state (f.basis), f.vorher keeps only the changed fields", async () => {
  const basis = { id: "bmB1", project_id: "pBasis11505", updated_date: T0, customWalls: [{ _idx: 1 }], customWindows: [{ _idx: 2, wallIdx: 1 }], dachform: "flach" };
  const srv = bimServer([basis]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pBasis11505");
    /** @type {any[]} */ const gesehen = [];
    const ab = sync.aufFremdenStand((pid, f) => { if (pid === "pBasis11505") gesehen.push(f); return []; });
    try {
      const fremd = { ...basis, updated_date: "2026-11-19T10:05:00.000Z", customWalls: [{ _idx: 3 }] };
      assert.deepEqual(await sync.fremdenStandUebernehmen("pBasis11505", fremd, { geraet: null }), ["customWalls"]);
      assert.equal(gesehen.length, 1);
      assert.deepEqual(gesehen[0].vorher, { customWalls: [{ _idx: 1 }] });
      assert.deepEqual(gesehen[0].basis, basis, "the full stored record the page knew before");
    } finally { ab(); }
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("bimModelNachschreiben: project A left, cache on B → PUT on A with A's stand, the cache stays on B", async () => {
  const a = { id: "bmA", project_id: "pA11505", updated_date: T0, customWalls: [{ _idx: 1 }], dachform: "flach" };
  const b = { id: "bmB", project_id: "pB11505", updated_date: T0, customWalls: [] };
  const srv = bimServer([a, b]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA11505");
    await sync.loadBimModel("pB11505"); // the person opened project B
    const r = await sync.bimModelNachschreiben("pA11505", { customWalls: [{ _idx: 1 }, { _idx: 2 }], dachform: "flach" });
    assert.deepEqual(r, { geschrieben: true });
    assert.equal(srv.puts.length, 1);
    assert.equal(srv.puts[0].id, "bmA");
    assert.equal(srv.puts[0].stand, T0, "strict write on A's own base");
    assert.deepEqual(srv.puts[0].body.customWalls, [{ _idx: 1 }, { _idx: 2 }]);
    assert.equal("dachform" in srv.puts[0].body, false, "a field equal to the base is not sent");
    // the cache did not move back to A: a change of B saved elsewhere is still taken in
    const neuB = { ...srv.rec("pB11505"), updated_date: "2026-11-19T12:00:00.000Z", customWalls: [{ _idx: 9 }] };
    srv.setze(neuB);
    assert.deepEqual(await sync.fremdenStandUebernehmen("pB11505", neuB, { geraet: null }), ["customWalls"]);
    // a second flush of A builds on the stand of the first one (the map entry moved on)
    const r2 = await sync.bimModelNachschreiben("pA11505", { customWalls: [{ _idx: 1 }, { _idx: 2 }, { _idx: 3 }] });
    assert.deepEqual(r2, { geschrieben: true });
    assert.equal(srv.puts[1].stand, "2026-11-19T11:01:00.000Z", "the stand the first flush's answer carried");
    assert.deepEqual(srv.rec("pA11505").customWalls, [{ _idx: 1 }, { _idx: 2 }, { _idx: 3 }]);
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("bimModelNachschreiben: an outdated base (409) is refused, nothing is merged and nothing written again", async () => {
  const a = { id: "bmA2", project_id: "pA211505", updated_date: T0, customWalls: [{ _idx: 1 }] };
  const b = { id: "bmB2", project_id: "pB211505", updated_date: T0, customWalls: [] };
  const srv = bimServer([a, b]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA211505");
    await sync.loadBimModel("pB211505");
    srv.setze({ ...a, updated_date: "2026-11-19T10:30:00.000Z", customWalls: [{ _idx: 5 }] }); // another device wrote A meanwhile
    const r = await sync.bimModelNachschreiben("pA211505", { customWalls: [{ _idx: 1 }, { _idx: 2 }] });
    assert.deepEqual(r, { geschrieben: false, grund: "veraltet" });
    assert.equal(srv.puts.length, 1, "no second PUT after the 409");
    assert.deepEqual(srv.rec("pA211505").customWalls, [{ _idx: 5 }], "the other device's state stays");
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("bimModelNachschreiben: a field held back by an open conflict refuses the whole flush", async () => {
  const a = { id: "bmA3", project_id: "pA311505", updated_date: T0, customWalls: [{ _idx: 1 }], dachform: "flach" };
  const b = { id: "bmB3", project_id: "pB311505", updated_date: T0 };
  const srv = bimServer([a, b]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA311505");
    await sync.loadBimModel("pB311505");
    sync.feldSperren("pA311505", "customWalls");
    try {
      const r = await sync.bimModelNachschreiben("pA311505", { customWalls: [{ _idx: 1 }, { _idx: 2 }], dachform: "sattel" });
      assert.deepEqual(r, { geschrieben: false, grund: "gesperrt" });
      assert.equal(srv.puts.length, 0, "nothing of the flush went out");
    } finally { sync.feldFreigeben("pA311505", "customWalls"); }
  } finally {
    globalThis.fetch = altFetch;
  }
});

// Review 115-05a (R-11505a-K02): the person switches to B while the own autosave PUT of A is still on its way, and a newer change
// of A waits in the autosave window (it is flushed). The flush must build on the stand THAT save got - before, the save landed
// after the switch, only the cache of the open project followed it, A's map entry kept the old stand and the server answered the
// flush with 409 ("veraltet": the newer change was lost and the toast blamed "another place").
test("bimModelNachschreiben after a switch while A's own save was on its way: built on that save's stand, no false 409", async () => {
  const a = { id: "bmA4", project_id: "pA411505", updated_date: T0, customWalls: [{ _idx: 1 }] };
  const b = { id: "bmB4", project_id: "pB411505", updated_date: T0, customWalls: [] };
  const srv = bimServer([a, b]);
  /** @type {() => void} */ let freigeben = () => {};
  const tor = new Promise((r) => { freigeben = () => r(undefined); });
  let putsGesehen = 0;
  const altFetch = globalThis.fetch;
  globalThis.fetch = async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
    if ((opt.method || "GET") === "PUT" && ++putsGesehen === 1) await tor; // the autosave PUT of A is slow (network, large model)
    return srv.fetch(url, opt);
  };
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA411505");
    const erster = sync.saveBimModel("pA411505", { customWalls: [{ _idx: 1 }, { _idx: 2 }] });
    for (let i = 0; i < 50 && putsGesehen < 1; i += 1) await new Promise((r) => setTimeout(r, 2)); // its PUT is on the wire
    assert.equal(putsGesehen, 1);
    await sync.loadBimModel("pB411505"); // the person opened project B
    const flush = sync.bimModelNachschreiben("pA411505", { customWalls: [{ _idx: 1 }, { _idx: 2 }, { _idx: 3 }] });
    freigeben();
    await erster;
    assert.deepEqual(await flush, { geschrieben: true }, "the newer change of A is written");
    assert.equal(srv.puts.length, 2);
    assert.equal(srv.puts[1].stand, "2026-11-19T11:01:00.000Z", "the flush builds on the stand of the own save's answer");
    assert.deepEqual(srv.rec("pA411505").customWalls, [{ _idx: 1 }, { _idx: 2 }, { _idx: 3 }]);
    assert.deepEqual(srv.rec("pB411505").customWalls, [], "B untouched");
  } finally {
    globalThis.fetch = altFetch;
  }
});
