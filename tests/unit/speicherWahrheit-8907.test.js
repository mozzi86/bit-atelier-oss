// 89-07 (D-BW-05): store of truth per edition; hosted edition merges BimModel layers
// last-write-wins on updatedAt; saved patches reach live readers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { wahrheitFuer, layerLww, WAHRHEITEN } from "@core/lib/speicherWahrheit";

test("truth per data path; unknown falls back to the local file, never the cloud", () => {
  assert.equal(wahrheitFuer("express").quelle, "lokale-datei");
  assert.equal(wahrheitFuer("serverlos").quelle, "geraet");
  assert.equal(wahrheitFuer("supabase").sync, "lww-je-layer");
  assert.equal(wahrheitFuer("irgendwas"), WAHRHEITEN.express);
});

test("layerLww: a newer stored layer survives an older incoming write", () => {
  const vorhanden = { footprintM: [1], werkstatt_layer: { typ: "neu", updatedAt: "2026-10-12T10:00:00.000Z" }, netz_layer: { a: 1, updatedAt: "2026-10-12T09:00:00.000Z" } };
  const eingehend = { footprintM: [2], werkstatt_layer: { typ: "alt", updatedAt: "2026-10-12T09:59:00.000Z" }, netz_layer: { a: 2, updatedAt: "2026-10-12T09:30:00.000Z" } };
  const { ergebnis, verworfen } = layerLww(vorhanden, eingehend);
  assert.equal(ergebnis.werkstatt_layer.typ, "neu");
  assert.equal(ergebnis.netz_layer.a, 2);
  assert.deepEqual(ergebnis.footprintM, [2], "non-layer fields merge flat");
  assert.deepEqual(verworfen, ["werkstatt_layer"]);
});

test("layerLww: tie and unstamped stored layer → incoming wins; new layer is added", () => {
  const t = "2026-10-12T10:00:00.000Z";
  assert.equal(layerLww({ statik_layer: { x: 1, updatedAt: t } }, { statik_layer: { x: 2, updatedAt: t } }).ergebnis.statik_layer.x, 2);
  assert.equal(layerLww({ statik_layer: { x: 1 } }, { statik_layer: { x: 2, updatedAt: t } }).ergebnis.statik_layer.x, 2);
  assert.equal(layerLww(null, { statik_layer: { x: 3, updatedAt: t } }).ergebnis.statik_layer.x, 3);
});

test("saveBimModel notifies live readers after the write (usePlanModel no longer stale)", async () => {
  const altFetch = globalThis.fetch;
  /** @type {any[]} */
  const anfragen = [];
  globalThis.fetch = /** @type {any} */ (async (url, opt = {}) => {
    anfragen.push([String(url), opt.method || "GET"]);
    const body = String(url).includes("?") ? [{ id: "bm1", project_id: "p8907" }] : { id: "bm1" };
    return { ok: true, status: 200, json: async () => body };
  });
  try {
    const { saveBimModel, aufBimModelAenderung } = await import("@core/lib/useBimModelSync");
    const gehoert = [];
    const ab = aufBimModelAenderung((pid, patch) => gehoert.push([pid, Object.keys(patch).sort().join(",")]));
    await saveBimModel("p8907", { customWalls: [{ _idx: 0 }] });
    ab();
    await saveBimModel("p8907", { customWalls: [] });
    assert.deepEqual(gehoert, [["p8907", "customWalls,project_id"]], "one notification, none after unsubscribe");
    assert.ok(anfragen.some(([, m]) => m === "PUT"), "the write happened first");
  } finally {
    globalThis.fetch = altFetch;
  }
});
