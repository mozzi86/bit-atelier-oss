// 94-04 (B-ABN-08): Leistungsstand written from the contract account into the
// SAME HoaiPlan record the designer uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fortschrittMit, speichereLeistungsstand } from "@/lib/honorar/leistungsstandSpeichern.js";

test("nur geänderte LPH ersetzen, Rest bleibt; Grenzen 0–100; null löscht", () => {
  assert.deepEqual(fortschrittMit([100, 50, null], { 2: 80, 3: 140, 5: -3 }), [100, 80, 100, null, 0, null, null, null, null]);
  assert.deepEqual(fortschrittMit(null, { 1: null, 9: 12.6 }), [null, null, null, null, null, null, null, null, 13]);
  assert.deepEqual(fortschrittMit([10], { 0: 50, 10: 50 }), [10, null, null, null, null, null, null, null, null]);
});

test("schreibt den vorhandenen HoaiPlan (update) mit Verlauf, sonst create", async () => {
  /** @type {any[]} */
  const aufrufe = [];
  const api = (zeilen) => ({ entities: { HoaiPlan: {
    filter: async () => zeilen,
    update: async (id, d) => { aufrufe.push(["update", id, d]); return { id, ...d }; },
    create: async (d) => { aufrufe.push(["create", d]); return { id: "neu", ...d }; },
  } } });
  await speichereLeistungsstand(api([{ id: "h1", progress: [100, 40], verlauf: [] }]), "p1", { 2: 60 }, "2026-10-16");
  assert.equal(aufrufe[0][0], "update");
  assert.equal(aufrufe[0][1], "h1");
  assert.deepEqual(aufrufe[0][2].progress.slice(0, 3), [100, 60, null]);
  assert.ok(Array.isArray(aufrufe[0][2].verlauf) && aufrufe[0][2].verlauf.length === 1);
  await speichereLeistungsstand(api([]), "p1", { 1: 100 }, "2026-10-16");
  assert.equal(aufrufe[1][0], "create");
  assert.equal(aufrufe[1][1].project_id, "p1");
  await assert.rejects(() => speichereLeistungsstand(api([]), "", { 1: 1 }, "2026-10-16"), /Kein Projekt/);
});
