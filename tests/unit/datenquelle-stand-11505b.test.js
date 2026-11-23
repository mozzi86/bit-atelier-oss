// 115-05b part 2 (A-5/A-7, plan §5 "Cloud und Demo"): the serverless store (demoDb) and the cloud store (supabaseDb) refuse a
// strict write on another stored state the same way the express route does - `{status: 409, data: {gespeichert}}` - so the
// three-way paths of useBimModelSync and ComplexDesigner work on every data path (the anecdote of D-115-50 happened online).
//   demo:  opts.stand unequal to the stored updated_date → 409 with the stored record, nothing written; equal → written
//   cloud: the same check on the row it reads; the race (another writer between that read and the update) is closed with
//          `.eq('updated_date', stand)` - the 0-row answer of `.single()` becomes the same 409 after the row is read again
//   cloud: one BuildingComplex per project (E-3) - a second create answers 409 with the stored record, nothing inserted
// The cloud client is a stand-in of the few PostgREST builder calls supabaseDb.js makes (supabaseClientSetzen).
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T10:05:00.000Z";

/**
 * In-memory adapter of demoDb (shape of demoIdb) with a start state.
 * @param {Record<string, object[]>} daten
 */
function speicherAttrappe(daten) {
  /** @type {Array<{entity: string, rec: any}>} */ const geschrieben = [];
  return {
    geschrieben,
    async entities() { return Object.keys(daten); },
    async alle(/** @type {string} */ entity) { return structuredClone(daten[entity] || []); },
    async schreiben(/** @type {string} */ entity, /** @type {any} */ rec) { geschrieben.push({ entity, rec: structuredClone(rec) }); },
    async schreibeViele() { /* not used here */ },
    async loeschen() { /* not used here */ },
    async leeren() { /* not used here */ },
    async meta() { return null; },
  };
}

test("demo: update with an unequal stand → 409 {gespeichert}, nothing written; equal stand → written", async () => {
  const { demoDb, setzeSpeicher } = await import("@core/api/demoDb");
  const speicher = speicherAttrappe({ BimModel: [{ id: "bm1", project_id: "pDemo", updated_date: T1, customWalls: [{ _idx: 3 }] }] });
  setzeSpeicher(/** @type {any} */ (speicher));
  // older stand (the classic stale tab) and a NEWER one (a restore put an older record back): both are another state
  for (const stand of [T0, "2026-11-19T11:00:00.000Z"]) {
    await assert.rejects(demoDb.update("BimModel", "bm1", { customWalls: [{ _idx: 1 }] }, { stand }),
      (/** @type {any} */ e) => e.status === 409 && e.data?.gespeichert?.updated_date === T1 && e.data.gespeichert.customWalls[0]._idx === 3,
      `stand ${stand} must be refused with the stored record`);
  }
  assert.equal(speicher.geschrieben.length, 0, "nothing written on a refused stand");
  const neu = await demoDb.update("BimModel", "bm1", { customWalls: [{ _idx: 4 }] }, { stand: T1 });
  assert.deepEqual(neu.customWalls, [{ _idx: 4 }]);
  assert.notEqual(neu.updated_date, T1);
  // without stand: last write wins as before
  const ohne = await demoDb.update("BimModel", "bm1", { dachform: "flach" });
  assert.equal(ohne.dachform, "flach");
});

/**
 * Stand-in of the supabase client: `records` rows in memory, `org_members` with one org. Implements the builder calls of
 * supabaseDb.js (select / eq / filter / order / maybeSingle / single / insert / update / then). `vorUpdate` runs once right
 * before the next update is applied (another writer in between).
 * @param {any[]} zeilen rows {id, entity, org_id, data, created_date, updated_date}
 */
function wolkeAttrappe(zeilen) {
  let n = 0;
  /** @type {Array<{art: string, filter: Array<[string, any]>, werte?: any}>} */ const schreiben = [];
  /** @type {null|(() => void)} */ let vorUpdate = null;
  let nurLesen = false;
  const client = {
    schreiben,
    zeilen,
    vorUpdateSetzen: (/** @type {() => void} */ f) => { vorUpdate = f; },
    /** RLS lets the caller read but not write (no owner/planner, siegel_id set, no can_edit_model): an update matches 0 rows */
    nurLesenSetzen: (/** @type {boolean} */ an) => { nurLesen = an; },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
      getUser: async () => ({ data: { user: { id: "u1" } } }),
    },
    from(/** @type {string} */ tabelle) {
      /** @type {Array<[string, any]>} */ const filter = [];
      /** @type {{art: string, werte?: any}} */ let op = { art: "select" };
      const passt = (/** @type {any} */ z) => filter.every(([k, v]) => {
        if (k.startsWith("data->>")) return String(z.data?.[k.slice(7)]) === String(v);
        return String(z[k]) === String(v);
      });
      const ausfuehren = () => {
        if (tabelle === "org_members") return [{ org_id: "o1", user_id: "u1" }];
        if (op.art === "insert") {
          n += 1;
          const z = { ...op.werte, id: `neu${n}`, created_date: T1, updated_date: T1 };
          zeilen.push(z);
          schreiben.push({ art: "insert", filter: [], werte: op.werte });
          return [z];
        }
        if (op.art === "update") {
          if (vorUpdate) { const f = vorUpdate; vorUpdate = null; f(); }
          const treffer = nurLesen ? [] : zeilen.filter(passt);
          schreiben.push({ art: "update", filter: [...filter], werte: op.werte });
          n += 1;
          for (const z of treffer) Object.assign(z, op.werte, { updated_date: `2026-11-19T12:0${n}:00.000Z` });
          return treffer;
        }
        return zeilen.filter(passt);
      };
      const b = {
        select: () => b,
        eq: (/** @type {string} */ k, /** @type {any} */ v) => { filter.push([k, v]); return b; },
        filter: (/** @type {string} */ k, /** @type {string} */ _op, /** @type {any} */ v) => { filter.push([k, v]); return b; },
        order: () => b,
        limit: () => b,
        insert: (/** @type {any} */ w) => { op = { art: "insert", werte: w }; return b; },
        update: (/** @type {any} */ w) => { op = { art: "update", werte: w }; return b; },
        delete: () => { op = { art: "delete" }; return b; },
        maybeSingle: async () => {
          const r = ausfuehren();
          return { data: r[0] ?? null, error: null };
        },
        single: async () => {
          const r = ausfuehren();
          if (r.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", status: 406 } };
          return { data: r[0], error: null };
        },
        then: (/** @type {any} */ ok, /** @type {any} */ fehl) => Promise.resolve({ data: ausfuehren(), error: null }).then(ok, fehl),
      };
      return b;
    },
  };
  return client;
}

test("cloud: update with an unequal stand → 409 {gespeichert}, no update sent; equal stand → update bound to that stand", async () => {
  const { supabaseClientSetzen } = await import("@core/api/supabaseClient.js");
  const { entityClientSupabase } = await import("@core/api/supabaseDb.js");
  const wolke = wolkeAttrappe([{ id: "r1", entity: "BimModel", org_id: "o1", data: { project_id: "pW", customWalls: [{ _idx: 3 }] }, created_date: T0, updated_date: T1 }]);
  supabaseClientSetzen(/** @type {any} */ (wolke));
  const bim = entityClientSupabase("BimModel");
  await assert.rejects(bim.update("r1", { customWalls: [{ _idx: 1 }] }, { stand: T0 }),
    (/** @type {any} */ e) => e.status === 409 && e.data?.gespeichert?.updated_date === T1 && e.data.gespeichert.customWalls[0]._idx === 3);
  assert.equal(wolke.schreiben.length, 0, "a refused stand sends no update");
  const neu = await bim.update("r1", { customWalls: [{ _idx: 4 }] }, { stand: T1 });
  assert.deepEqual(neu.customWalls, [{ _idx: 4 }]);
  assert.deepEqual(wolke.schreiben[0].filter.find(([k]) => k === "updated_date"), ["updated_date", T1], "the update is bound to the stand (race closed)");
});

test("cloud: another writer between read and update → 0 rows → the same 409 with the row read again", async () => {
  const { supabaseClientSetzen } = await import("@core/api/supabaseClient.js");
  const { entityClientSupabase } = await import("@core/api/supabaseDb.js");
  const zeile = { id: "r2", entity: "BimModel", org_id: "o1", data: { project_id: "pW2", dachform: "pult" }, created_date: T0, updated_date: T1 };
  const wolke = wolkeAttrappe([zeile]);
  supabaseClientSetzen(/** @type {any} */ (wolke));
  wolke.vorUpdateSetzen(() => { zeile.data = { ...zeile.data, dachform: "walm" }; zeile.updated_date = "2026-11-19T10:06:00.000Z"; });
  await assert.rejects(entityClientSupabase("BimModel").update("r2", { dachform: "flach" }, { stand: T1 }),
    (/** @type {any} */ e) => e.status === 409 && e.data?.gespeichert?.dachform === "walm" && e.data.gespeichert.updated_date === "2026-11-19T10:06:00.000Z");
  assert.equal(zeile.data.dachform, "walm", "the other writer's value stays");
});

// Review 115-05b part 2 (finding 3): an update the row-level rules refuse matches 0 rows too (0011_policies_records.sql: read yes,
// write no). The row read again is in the SAME state as the stand - no other writer: that is no conflict but the missing right,
// reported as the rule's 403 (before: a 409 whose stored record equals the own stand; the three-way merge found nothing, retried
// and ended in "changed elsewhere", the real cause was lost). Stand-in only - not verified against a real cloud.
test("cloud: 0 rows because the rules refuse the write (row unchanged) → 403 of the rule, not a 409", async () => {
  const { supabaseClientSetzen } = await import("@core/api/supabaseClient.js");
  const { entityClientSupabase, REGEL_MELDUNG } = await import("@core/api/supabaseDb.js");
  const zeile = { id: "r3", entity: "BimModel", org_id: "o1", data: { project_id: "pW3", dachform: "pult" }, created_date: T0, updated_date: T1 };
  const wolke = wolkeAttrappe([zeile]);
  supabaseClientSetzen(/** @type {any} */ (wolke));
  wolke.nurLesenSetzen(true);
  await assert.rejects(entityClientSupabase("BimModel").update("r3", { dachform: "flach" }, { stand: T1 }),
    (/** @type {any} */ e) => e.status === 403 && !e.data?.gespeichert && String(e.message).includes(REGEL_MELDUNG));
  assert.equal(zeile.data.dachform, "pult");
});

test("cloud: one BuildingComplex per project — a second create answers 409 with the stored record", async () => {
  const { supabaseClientSetzen } = await import("@core/api/supabaseClient.js");
  const { entityClientSupabase } = await import("@core/api/supabaseDb.js");
  const wolke = wolkeAttrappe([{ id: "k1", entity: "BuildingComplex", org_id: "o1", data: { project_id: "pK", name: "Testprojekt A" }, created_date: T0, updated_date: T1 }]);
  supabaseClientSetzen(/** @type {any} */ (wolke));
  await assert.rejects(entityClientSupabase("BuildingComplex").create({ project_id: "pK", name: "Testprojekt A zwei" }),
    (/** @type {any} */ e) => e.status === 409 && e.data?.vorhanden === true && e.data?.gespeichert?.id === "k1");
  assert.equal(wolke.schreiben.length, 0, "nothing inserted");
  const anderes = await entityClientSupabase("BuildingComplex").create({ project_id: "pK2", name: "Testprojekt B" });
  assert.equal(anderes.project_id, "pK2");
});
