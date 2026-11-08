// 112-01 task 3 (foreign review 08.11.2026, point 3): bitApi hardening.
//   - request() merges the caller's headers over the defaults; Content-Type and the client id (106-09) survive.
//   - bitApi.personal.<E>.update(id, data, { stand }) sends ?stand, and PUT /api/personal/:entity/:id refuses an outdated
//     stand with 409 like the entity route (same standVeraltet check, single source in routes.js).
//
// The route test runs a REAL express app on an ephemeral port with throwaway JSON files in a temp dir (pattern of
// personalRouter.test.js) — never the real server/*.json.
//
// In:  bitApi.js with a stubbed global fetch; personalRouter.js on 127.0.0.1:0. Out: assertions only.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { request, bitApi, kopfZeilenMischen } from "@core/api/bitApi.js";
import { CLIENT_KOPF } from "@core/lib/abgleich/clientKennung.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { createBlobStore } from "../../packages/nova-core/server/blobs.js";
import { personalRouter } from "../../packages/nova-core/server/personalRouter.js";
import { STAND_KONFLIKT_TEXT } from "../../packages/nova-core/server/routes.js";

/**
 * Runs fn with a fetch stub that records the calls and answers 200 {}.
 * @param {(aufrufe: Array<{url: string, init: any}>) => Promise<void>} fn
 */
async function mitFetchStub(fn) {
  const original = globalThis.fetch;
  /** @type {Array<{url: string, init: any}>} */
  const aufrufe = [];
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    aufrufe.push({ url: String(url), init });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    await fn(aufrufe);
  } finally {
    globalThis.fetch = original;
  }
}

describe("bitApi.request — headers are merged, not replaced", () => {
  it("own header keeps Content-Type and the client id", async () => {
    await mitFetchStub(async (aufrufe) => {
      await request("/test", { method: "POST", body: "{}", headers: { "X-Eigen": "1" } });
      const h = aufrufe[0].init.headers;
      assert.equal(h["X-Eigen"], "1");
      assert.equal(h["Content-Type"], "application/json");
      assert.ok(typeof h[CLIENT_KOPF] === "string" && h[CLIENT_KOPF].length > 0, "client id missing");
      assert.equal(aufrufe[0].init.method, "POST");
    });
  });

  it("a caller may override a default on purpose", async () => {
    await mitFetchStub(async (aufrufe) => {
      await request("/test", { headers: { "Content-Type": "text/plain" } });
      assert.equal(aufrufe[0].init.headers["Content-Type"], "text/plain");
    });
  });

  it("a Headers instance is merged too (spreading it would yield {})", async () => {
    await mitFetchStub(async (aufrufe) => {
      await request("/test", { headers: new globalThis.Headers({ "X-Eigen": "2" }) });
      const h = aufrufe[0].init.headers;
      assert.equal(h["x-eigen"], "2");
      assert.equal(h["Content-Type"], "application/json");
      assert.ok(h[CLIENT_KOPF], "client id missing");
    });
  });

  it("header names are case-insensitive: a lower-case override replaces the default, no second value", () => {
    const h = kopfZeilenMischen({ "Content-Type": "application/json" }, { "content-type": "text/plain" });
    assert.deepEqual(h, { "content-type": "text/plain" });
    assert.deepEqual(kopfZeilenMischen({ A: "1" }, undefined), { A: "1" });
    assert.deepEqual(kopfZeilenMischen({ A: "1" }, [["B", "2"]]), { A: "1", B: "2" });
  });

  it("rule 8: LlmConnections' api() merges headers through the same helper", () => {
    const text = fs.readFileSync(new URL("../../src/components/ai/LlmConnections.jsx", import.meta.url), "utf8");
    assert.match(text, /kopfZeilenMischen\(\{ "Content-Type": "application\/json" \}, headers\)/);
    assert.doesNotMatch(text, /headers: \{ "Content-Type": "application\/json" \},\s*\.\.\.options/);
  });

  it("personal update sends ?stand like the entity update", async () => {
    await mitFetchStub(async (aufrufe) => {
      await bitApi.personal.Mitarbeiter.update("m1", { name: "x" }, { stand: "2026-11-08T10:00:00.000Z" });
      await bitApi.personal.Mitarbeiter.update("m1", { name: "x" });
      assert.match(aufrufe[0].url, /\/personal\/Mitarbeiter\/m1\?stand=2026-11-08T10%3A00%3A00\.000Z$/);
      assert.match(aufrufe[1].url, /\/personal\/Mitarbeiter\/m1$/);
      assert.equal(aufrufe[0].init.method, "PUT");
    });
  });
});

describe("PUT /api/personal/:entity/:id — strict write with ?stand (409)", () => {
  let tmpDir, server, port, pdb;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-personal-stand-"));
    pdb = createDb(path.join(tmpDir, "personal.json"));
    const app = express();
    app.use(express.json());
    app.use("/api", personalRouter(pdb, createBlobStore(path.join(tmpDir, "personal-blobs")), { lokalGebunden: true }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    port = server.address().port;
  });

  after(() => {
    server.close();
    pdb.flush();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const url = (pfad) => `http://127.0.0.1:${port}/api${pfad}`;
  const put = (pfad, daten) => fetch(url(pfad), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten) });

  it("outdated stand → 409 with the stored record, nothing overwritten; current or missing stand → 200", async () => {
    const angelegt = await (await fetch(url("/personal/Mitarbeiter"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Erste Fassung" }),
    })).json();
    // A stand one second before the stored updated_date = another device wrote in between.
    const alt = new Date(Date.parse(angelegt.updated_date) - 1000).toISOString();
    const r409 = await put(`/personal/Mitarbeiter/${angelegt.id}?stand=${encodeURIComponent(alt)}`, { name: "Überschrieben?" });
    assert.equal(r409.status, 409);
    const body = await r409.json();
    assert.equal(body.error, STAND_KONFLIKT_TEXT);
    assert.equal(body.konflikt, true);
    assert.equal(body.gespeichert.name, "Erste Fassung");
    assert.equal(pdb.get("Mitarbeiter", angelegt.id).name, "Erste Fassung");

    const r200 = await put(`/personal/Mitarbeiter/${angelegt.id}?stand=${encodeURIComponent(angelegt.updated_date)}`, { name: "Zweite Fassung" });
    assert.equal(r200.status, 200);
    assert.equal((await r200.json()).name, "Zweite Fassung");
    // Without ?stand the old behaviour stays (last write wins).
    const ohne = await put(`/personal/Mitarbeiter/${angelegt.id}`, { name: "Dritte Fassung" });
    assert.equal(ohne.status, 200);
    assert.equal(ohne.headers.get("X-Bit-Hinweis"), null, "no updated_date in the body - nothing to say");
    // A body built on an older updated_date: written, but with the hint header of the entity route (93-03).
    const altBody = await put(`/personal/Mitarbeiter/${angelegt.id}`, { name: "Vierte Fassung", updated_date: alt });
    assert.equal(altBody.status, 200);
    assert.equal(altBody.headers.get("X-Bit-Hinweis"), "zwischenzeitlich-geaendert");
  });
});
