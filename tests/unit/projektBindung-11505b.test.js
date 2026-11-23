// 115-05b (E-1, E-6, PUT guard): a save run of useBimModelSync is bound to the project and the record it was planned for.
//   E-1: a save of project A is on its way, another tab changes A, the person opens project B, the PUT of A comes back with 409
//        → the retry goes to A's own record on A's own stored state (never to B's record, never to id null); a field both
//        changed refuses the write (the holder of A is gone), nothing is mixed into B
//   E-6: two saves of A queued, the person opens B meanwhile → the second save of A does not move the one-project cache back
//        to A (B's change stream is still taken in)
//   the API client refuses a PUT / DELETE without an id (before: a request to /entities/BimModel/null)
// Fetch stand-in pattern: useBimModelSync-11505a.test.js (bimServer).
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";

const T0 = "2026-11-19T10:00:00.000Z";

/**
 * A fetch stand-in of the BimModel records of several projects. GET ?project_id= → the records of that project; PUT ?stand= on
 * another stand → 409 with the stored record (like routes.js standVeraltet, inequality since review 115-05b part 2), else a flat merge with a new updated_date.
 * `halten` makes the next PUT wait until `loslassen()` (a slow network), while the server decides only when the PUT arrives.
 * @param {any[]} records
 */
function bimServer(records) {
  const recs = new Map(records.map((r) => [r.id, r]));
  /** @type {Array<{id: string, stand: string|null, body: any, methode: string}>} */ const schreiben = [];
  /** @type {string[]} */ const gets = [];
  let n = 0;
  /** @type {null|{warten: Promise<void>, los: () => void}} */ let tor = null;
  const antwort = (/** @type {number} */ status, /** @type {any} */ json) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => json });
  return {
    schreiben,
    gets,
    setze: (/** @type {any} */ r) => { recs.set(r.id, r); },
    rec: (/** @type {string} */ pid) => [...recs.values()].find((r) => r.project_id === pid),
    halten: () => { let los = () => {}; const warten = new Promise((r) => { los = () => r(undefined); }); tor = { warten, los }; },
    loslassen: () => { const t = tor; tor = null; t?.los(); },
    fetch: async (/** @type {string} */ url, /** @type {any} */ opt = {}) => {
      const u = new URL(String(url), "http://test.local");
      const methode = opt.method || "GET";
      if (methode === "GET") {
        const pid = u.searchParams.get("project_id");
        gets.push(String(pid));
        return antwort(200, [...recs.values()].filter((r) => r.project_id === pid));
      }
      const id = decodeURIComponent(u.pathname.split("/").pop() || "");
      const stand = u.searchParams.get("stand");
      const body = opt.body ? JSON.parse(opt.body) : null;
      schreiben.push({ id, stand, body, methode });
      if (tor) await tor.warten;
      if (methode === "POST") {
        n += 1;
        const neu = { ...body, id: `neu${n}`, updated_date: `2026-11-19T11:${String(n).padStart(2, "0")}:00.000Z` };
        recs.set(neu.id, neu);
        return antwort(201, neu);
      }
      const vorher = recs.get(id);
      if (!vorher) return antwort(404, { error: "Not found" });
      if (stand && stand !== vorher.updated_date) return antwort(409, { error: "veraltet", konflikt: true, gespeichert: vorher });
      n += 1;
      const neu = { ...vorher, ...body, updated_date: `2026-11-19T11:${String(n).padStart(2, "0")}:00.000Z` };
      recs.set(id, neu);
      return antwort(200, neu);
    },
  };
}

/** Waits until the stand-in saw `anzahl` writes (the save run reached its PUT). @param {{schreiben: any[]}} srv @param {number} anzahl */
async function bisGeschrieben(srv, anzahl) {
  for (let i = 0; i < 200 && srv.schreiben.length < anzahl; i += 1) await new Promise((r) => setTimeout(r, 2));
  assert.ok(srv.schreiben.length >= anzahl, `expected ${anzahl} writes, saw ${srv.schreiben.length}`);
}

test("E-1: 409 of A after the switch to B → retry on A's own record, B untouched, A's foreign change kept", async () => {
  const a = { id: "bmA", project_id: "pA11505b", updated_date: T0, customWalls: [{ _idx: 1 }], dachform: "flach" };
  const b = { id: "bmB", project_id: "pB11505b", updated_date: T0, customWalls: [{ _idx: 7 }], dachform: "pult" };
  const srv = bimServer([a, b]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA11505b");
    srv.halten();
    const speichern = sync.saveBimModel("pA11505b", { dachform: "sattel" });
    await bisGeschrieben(srv, 1);
    // another tab changed A meanwhile (its walls), then the person opens project B
    srv.setze({ ...a, updated_date: "2026-11-19T10:30:00.000Z", customWalls: [{ _idx: 1 }, { _idx: 5 }] });
    await sync.loadBimModel("pB11505b");
    srv.loslassen();
    await speichern;
    const nachA = srv.schreiben.filter((s) => s.id !== "bmA");
    assert.deepEqual(nachA, [], `a write left A's record: ${JSON.stringify(nachA)}`);
    assert.deepEqual(srv.rec("pB11505b"), b, "B's record is unchanged");
    assert.equal(srv.rec("pA11505b").dachform, "sattel", "the own change reached A on its own record");
    assert.deepEqual(srv.rec("pA11505b").customWalls, [{ _idx: 1 }, { _idx: 5 }], "the other tab's walls stay in A");
    assert.equal(srv.schreiben[1]?.stand, "2026-11-19T10:30:00.000Z", "the retry builds on A's stored stand from the 409");
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("E-1: B has no model → the retry never goes to id null; a field both changed refuses the write, nothing mixed", async () => {
  const a = { id: "bmA2", project_id: "pA211505b", updated_date: T0, customWalls: [{ _idx: 1 }] };
  const srv = bimServer([a]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA211505b");
    srv.halten();
    const speichern = sync.saveBimModel("pA211505b", { customWalls: [{ _idx: 1 }, { _idx: 2 }] });
    await bisGeschrieben(srv, 1);
    srv.setze({ ...a, updated_date: "2026-11-19T10:30:00.000Z", customWalls: [{ _idx: 1 }, { _idx: 5 }] });
    await sync.loadBimModel("pB211505b"); // project B without a BimModel
    srv.loslassen();
    /** @type {any} */ let fehler = null;
    try { await speichern; } catch (err) { fehler = err; }
    assert.ok(fehler, "the save of A is refused (reported to its caller), not redirected");
    assert.equal(fehler.code, "nicht_geschrieben");
    const fremd = srv.schreiben.filter((s) => s.id !== "bmA2");
    assert.deepEqual(fremd, [], `a write went elsewhere: ${JSON.stringify(fremd)}`);
    assert.equal(srv.schreiben.length, 1, "no retry with a mix of old and new");
    assert.deepEqual(srv.rec("pA211505b").customWalls, [{ _idx: 1 }, { _idx: 5 }], "the other tab's state of A stays");
    assert.equal(srv.rec("pB211505b"), undefined, "no record was created for B");
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("E-6: two saves of A queued, switch to B → the cache stays on B (A is not loaded again, B's stream is taken in)", async () => {
  const a = { id: "bmA3", project_id: "pA311505b", updated_date: T0, dachform: "flach", storeys: 2 };
  const b = { id: "bmB3", project_id: "pB311505b", updated_date: T0, customWalls: [] };
  const srv = bimServer([a, b]);
  const altFetch = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  try {
    const sync = await import("@core/lib/useBimModelSync");
    await sync.loadBimModel("pA311505b");
    srv.halten();
    const eins = sync.saveBimModel("pA311505b", { dachform: "sattel" });
    const zwei = sync.saveBimModel("pA311505b", { storeys: 3 });
    await bisGeschrieben(srv, 1);
    await sync.loadBimModel("pB311505b");
    srv.loslassen();
    await eins;
    await zwei;
    assert.equal(srv.rec("pA311505b").dachform, "sattel");
    assert.equal(srv.rec("pA311505b").storeys, 3, "the second save of A reached A");
    assert.equal(srv.gets.filter((p) => p === "pA311505b").length, 1, "A was not loaded again after the switch");
    const neuB = { ...srv.rec("pB311505b"), updated_date: "2026-11-19T12:00:00.000Z", customWalls: [{ _idx: 9 }] };
    srv.setze(neuB);
    assert.deepEqual(await sync.fremdenStandUebernehmen("pB311505b", neuB, { geraet: null }), ["customWalls"], "B's stream still reaches the cache");
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("API client: PUT and DELETE without an id are refused before any request", async () => {
  /** @type {string[]} */ const urls = [];
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => { urls.push(String(url)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; });
  try {
    const { bitApi } = await import("@core/api/bitApi");
    for (const id of [null, undefined, "", "null", "undefined"]) {
      await assert.rejects(() => bitApi.entities.BimModel.update(/** @type {any} */ (id), { project_id: "p" }), /ohne Datensatz-Id|without a record id/i, `update(${JSON.stringify(id)})`);
      await assert.rejects(() => bitApi.entities.BimModel.delete(/** @type {any} */ (id)), /ohne Datensatz-Id|without a record id/i, `delete(${JSON.stringify(id)})`);
    }
    assert.deepEqual(urls, [], "no request went out");
  } finally {
    globalThis.fetch = altFetch;
  }
});
