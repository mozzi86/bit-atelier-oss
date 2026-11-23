// W-1118-22: the office takes a furniture proposal over — fresh read, only the furniture field, strict stand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moeblierungUebernehmen } from "@/lib/bauherr/moeblierungUebernehmen.js";

const zeile = (id, datum, moeblierung) => ({ id, project_id: "p1", updated_date: datum, name: "Entwurf", moeblierung });

test("writes only the furniture field of the newest record, on the stand of the fresh read", async () => {
  /** @type {any[]} */
  const aufrufe = [];
  const api = {
    filter: async (f) => { aufrufe.push(["filter", f]); return [zeile("alt", "2026-11-01", { r: [] }), zeile("neu", "2026-11-20", { r: [{ id: "s1", typ: "sofa", x: 1, y: 1, rot: 0 }] })]; },
    update: async (id, data, opts) => { aufrufe.push(["update", id, data, opts]); return {}; },
  };
  const r = await moeblierungUebernehmen({ api, projektId: "p1", aenderungen: [["r", "s1", 2, 3, 90], ["r", "weg", 1, 1, 0]] });
  assert.deepEqual(r, { uebernommen: 1, uebersprungen: ["weg"] });
  assert.deepEqual(aufrufe[0], ["filter", { project_id: "p1" }]);
  assert.deepEqual(aufrufe[1], ["update", "neu", { moeblierung: { r: [{ id: "s1", typ: "sofa", x: 2, y: 3, rot: 90 }] } }, { stand: "2026-11-20" }]);
});

test("nothing to take over: no write; no design record: plain error; a 409 is passed on", async () => {
  let geschrieben = 0;
  const api = { filter: async () => [zeile("neu", "2026-11-20", { r: [] })], update: async () => { geschrieben += 1; } };
  assert.deepEqual(await moeblierungUebernehmen({ api, projektId: "p1", aenderungen: [["r", "weg", 1, 1, 0]] }), { uebernommen: 0, uebersprungen: ["weg"] });
  assert.equal(geschrieben, 0);
  await assert.rejects(() => moeblierungUebernehmen({ api: { filter: async () => [], update: async () => {} }, projektId: "p1", aenderungen: [] }), /kein Entwurf gespeichert/);
  const konflikt = Object.assign(new Error("Stand veraltet"), { status: 409 });
  await assert.rejects(() => moeblierungUebernehmen({ api: { filter: async () => [zeile("neu", "x", { r: [{ id: "s1", x: 0, y: 0, rot: 0 }] })], update: async () => { throw konflikt; } },
    projektId: "p1", aenderungen: [["r", "s1", 1, 1, 0]] }), (e) => e.status === 409);
});
