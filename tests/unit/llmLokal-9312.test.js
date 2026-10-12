// Unit tests for plan 93-12, server core: "Nur lokale KI" enforced in invokeLLM and the /llm routes, the
// KiEinstellung row (validation, CRUD lock), model discovery with mocked transports, and httpAnfrage
// (node:http with our own timeout) against a tiny local server started by the test on a random port.
// Nothing here talks to a real model server or the internet: every non-loopback fetch is a mock that
// records and fails the test if a refused request was sent anyway.
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invokeLLM, callConnection } from "../../packages/nova-core/server/llm.js";
import {
  nurLokalPruefen, kiEinstellungenLesen, kiEinstellungenSchreiben, modelleAbrufen, httpAnfrage, lokalTimeoutMs, STANDARD_EINSTELLUNGEN,
} from "../../packages/nova-core/server/llmLokal.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { llmRouter, entitiesRouter } from "../../packages/nova-core/server/routes.js";

/** Minimal in-memory db with the createDb surface the module uses. */
function fakeDb() {
  const t = {};
  let n = 0;
  return {
    list: (e) => [...(t[e] || [])],
    get: (e, id) => (t[e] || []).find((r) => r.id === id) || null,
    create: (e, r) => { const rec = { ...r, id: `id${++n}` }; (t[e] ||= []).push(rec); return rec; },
    update: (e, id, p) => { const r = (t[e] || []).find((x) => x.id === id); if (!r) return null; Object.assign(r, p); return r; },
  };
}

/** Recording fetch that answers like an OpenAI-compatible server. */
function aufzeichnen() {
  const aufrufe = [];
  const fetchFn = async (url, init) => {
    aufrufe.push(String(url));
    const body = String(url).endsWith("/models") ? { data: [{ id: "m1" }] } : { choices: [{ message: { content: "OK" } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { aufrufe, fetchFn };
}

describe("93-12 Nur lokale KI — invokeLLM", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("refuses a cloud connection BEFORE any request, with a plain German sentence and status 403", async () => {
    const { aufrufe, fetchFn } = aufzeichnen();
    globalThis.fetch = fetchFn;
    await assert.rejects(
      invokeLLM({ prompt: "x" }, { provider: "openai", base_url: "https://api.openai.com/v1", model: "gpt", api_key: "sk-test-123456" }, { nurLokal: true }),
      (err) => err.status === 403 && /Nur lokale KI ist eingeschaltet: Anfragen an api\.openai\.com/.test(err.message),
    );
    assert.deepEqual(aufrufe, [], "no request may leave");
  });

  it("refuses the env-key fallbacks / offline mock when no connection is active", async () => {
    await assert.rejects(invokeLLM({ prompt: "x" }, null, { nurLokal: true }), /keine?.*lokale Verbindung|Cloud-Anbieter/);
  });

  it("an anthropic-type connection pointed at a loopback proxy is allowed", async () => {
    const aufrufe = [];
    const anfrageFn = async (url) => { aufrufe.push(url); return { ok: true, status: 200, text: async () => "", json: async () => ({ content: [{ text: "OK" }] }) }; };
    const r = await invokeLLM({ prompt: "x" }, { provider: "anthropic", base_url: "http://127.0.0.1:9999", model: "m" }, { nurLokal: true, deps: { anfrageFn } });
    assert.equal(r, "OK");
    assert.deepEqual(aufrufe, ["http://127.0.0.1:9999/v1/messages"]);
  });

  it("allows LM Studio, Ollama, ::1 and localhost — through node:http (anfrageFn), never fetch", async () => {
    globalThis.fetch = async () => { throw new Error("fetch must not be used for loopback"); };
    const anfrageFn = async (url) => ({ ok: true, status: 200, text: async () => "", json: async () => (String(url).includes("/api/chat") ? { message: { content: "OK" } } : { choices: [{ message: { content: "OK" } }] }) });
    for (const conn of [
      { provider: "openai", base_url: "http://127.0.0.1:1234/v1", model: "m" },
      { provider: "ollama", base_url: "http://127.0.0.1:11434", model: "m" },
      { provider: "custom", base_url: "http://[::1]:8080/v1", model: "m" },
      { provider: "openai", base_url: "http://localhost:1234/v1", model: "m" },
    ]) {
      assert.equal(await invokeLLM({ prompt: "x" }, conn, { nurLokal: true, deps: { anfrageFn } }), "OK", conn.base_url);
    }
  });

  it("switch off → cloud allowed as before", async () => {
    const { aufrufe, fetchFn } = aufzeichnen();
    globalThis.fetch = fetchFn;
    assert.equal(await invokeLLM({ prompt: "x" }, { provider: "openai", base_url: "https://api.openai.com/v1", model: "g", api_key: "k" }, { nurLokal: false }), "OK");
    assert.equal(aufrufe.length, 1);
  });

  it("nurLokalPruefen: '' and remote refused, loopback passes, off passes", () => {
    assert.throws(() => nurLokalPruefen("", true), /Cloud-Anbieter/);
    assert.throws(() => nurLokalPruefen("http://192.168.1.5:1234/v1", true), /192\.168\.1\.5/);
    nurLokalPruefen("http://127.0.0.1:1234/v1", true);
    nurLokalPruefen("https://api.openai.com", false);
  });

  it("a local server that is not running → plain sentence instead of 'fetch failed'", async () => {
    const anfrageFn = async () => { throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1234"), { code: "ECONNREFUSED" }); };
    await assert.rejects(callConnection({ provider: "openai", base_url: "http://127.0.0.1:1234/v1", model: "m" }, { prompt: "x" }, { deps: { anfrageFn } }), /^Error: LM Studio antwortet nicht unter 127\.0\.0\.1:1234/);
  });
});

describe("93-12 KiEinstellung", () => {
  it("defaults, booleans only, loopback-only server URLs", () => {
    const db = fakeDb();
    assert.deepEqual(kiEinstellungenLesen(db), { ...STANDARD_EINSTELLUNGEN });
    assert.equal(kiEinstellungenLesen(null).nur_lokal, false);
    assert.equal(kiEinstellungenSchreiben(db, { nur_lokal: true }).nur_lokal, true);
    assert.equal(kiEinstellungenSchreiben(db, { harness_autostart: true }).nur_lokal, true, "patch keeps other fields");
    assert.equal(db.list("KiEinstellung").length, 1, "one row");
    assert.throws(() => kiEinstellungenSchreiben(db, { nur_lokal: "ja" }), (e) => e.status === 400);
    assert.throws(() => kiEinstellungenSchreiben(db, { ollama_url: "http://192.168.1.2:11434" }), /nur Adressen auf diesem Rechner/);
    assert.equal(kiEinstellungenSchreiben(db, { ollama_url: "http://localhost:11500/" }).ollama_url, "http://localhost:11500");
  });
  it("timeout for local models: 15 min default, BIT_LOKAL_TIMEOUT_S within 30…7200 s", () => {
    assert.equal(lokalTimeoutMs({}), 900_000);
    assert.equal(lokalTimeoutMs({ BIT_LOKAL_TIMEOUT_S: "120" }), 120_000);
    assert.equal(lokalTimeoutMs({ BIT_LOKAL_TIMEOUT_S: "5" }), 900_000);
  });
});

describe("93-12 model discovery (mocked transports)", () => {
  it("cloud list through fetch with the key; local list through node:http", async () => {
    const seen = [];
    const fetchFn = async (url, init) => { seen.push([String(url), init.headers.authorization]); return new Response(JSON.stringify({ data: [{ id: "gpt-x" }] }), { status: 200 }); };
    const r = await modelleAbrufen({ provider: "openai", base_url: "https://api.example.com/v1", api_key: "sk-1" }, { fetchFn });
    assert.deepEqual(r.modelle, ["gpt-x"]);
    assert.deepEqual(seen, [["https://api.example.com/v1/models", "Bearer sk-1"]]);
    const anfrageFn = async (url) => ({ ok: true, status: 200, text: async () => "", json: async () => ({ models: [{ name: "qwen3.5:4b" }] }) });
    const o = await modelleAbrufen({ provider: "ollama", base_url: "http://127.0.0.1:11434" }, { anfrageFn });
    assert.equal(o.url, "http://127.0.0.1:11434/api/tags");
    assert.deepEqual(o.modelle, ["qwen3.5:4b"]);
    assert.equal(o.lokal, true);
  });
  it("running server without a loaded model, not running, HTTP error, no JSON", async () => {
    const leer = await modelleAbrufen({ provider: "openai", base_url: "http://127.0.0.1:1234/v1" }, { anfrageFn: async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({ data: [] }) }) });
    assert.equal(leer.ok, true);
    assert.match(leer.fehler, /kein Modell geladen/);
    const aus = await modelleAbrufen({ provider: "openai", base_url: "http://127.0.0.1:1234/v1" }, { anfrageFn: async () => { throw Object.assign(new Error("x"), { code: "ECONNREFUSED" }); } });
    assert.equal(aus.ok, false);
    assert.match(aus.fehler, /LM Studio antwortet nicht/);
    const http500 = await modelleAbrufen({ provider: "openai", base_url: "http://127.0.0.1:1234/v1" }, { anfrageFn: async () => ({ ok: false, status: 500, text: async () => "kaputt", json: async () => ({}) }) });
    assert.match(http500.fehler, /HTTP 500/);
    const html = await modelleAbrufen({ provider: "openai", base_url: "http://127.0.0.1:1234/v1" }, { anfrageFn: async () => ({ ok: true, status: 200, text: async () => "<html>", json: async () => { throw new SyntaxError("x"); } }) });
    assert.match(html.fehler, /kein JSON/);
  });
  it("Nur lokale KI refuses a cloud model list before any request", async () => {
    let gerufen = false;
    await assert.rejects(modelleAbrufen({ provider: "openai", base_url: "https://api.openai.com/v1" }, { nurLokal: true, fetchFn: async () => { gerufen = true; return new Response("{}"); } }), /Nur lokale KI/);
    assert.equal(gerufen, false);
  });
  it("Anthropic has no list here (plain hint)", async () => {
    const r = await modelleAbrufen({ provider: "anthropic", base_url: "https://api.anthropic.com" });
    assert.equal(r.ok, false);
    assert.match(r.fehler, /von Hand/);
  });
});

describe("93-12 httpAnfrage against a local stub", () => {
  let server, basis;
  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/langsam") { setTimeout(() => res.end("spät"), 2000); return; }
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ methode: req.method, body })); });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    basis = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.closeAllConnections?.(); server.close(); });

  it("POST with body, fetch-like response", async () => {
    const r = await httpAnfrage(`${basis}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":"ä"}', timeoutMs: 2000 });
    assert.equal(r.ok, true);
    assert.deepEqual(await r.json(), { methode: "POST", body: '{"a":"ä"}' });
  });
  it("own timeout → AbortError (not undici's 300 s)", async () => {
    await assert.rejects(httpAnfrage(`${basis}/langsam`, { timeoutMs: 150 }), (e) => e.name === "AbortError");
  });
  it("abort signal", async () => {
    const c = new AbortController();
    const p = httpAnfrage(`${basis}/langsam`, { timeoutMs: 5000, signal: c.signal });
    c.abort();
    await assert.rejects(p, (e) => e.name === "AbortError");
  });
  it("connection refused keeps its code", async () => {
    const tot = http.createServer();
    await new Promise((r) => tot.listen(0, "127.0.0.1", r));
    const port = tot.address().port;
    await new Promise((r) => tot.close(r));
    await assert.rejects(httpAnfrage(`http://127.0.0.1:${port}/`, { timeoutMs: 2000 }), (e) => e.code === "ECONNREFUSED");
  });
});

describe("93-12 /llm routes on a real express app (temp db)", () => {
  let tmp, server, basis;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-9312-"));
    const db = createDb(path.join(tmp, "db.json"));
    const app = express();
    app.use(express.json());
    app.use("/api", entitiesRouter(db));
    app.use("/api", llmRouter(db));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
    basis = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const json = (pfad, method = "GET", body) => fetch(`${basis}${pfad}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  it("settings: GET defaults, PUT validates, generic CRUD locked", async () => {
    assert.equal((await (await json("/llm/einstellungen")).json()).nur_lokal, false);
    const ok = await json("/llm/einstellungen", "PUT", { nur_lokal: true, benchmark: { gefaelscht: 1 } });
    const e = await ok.json();
    assert.equal(e.nur_lokal, true);
    assert.equal(e.benchmark, null, "benchmark is written by the server only");
    assert.equal((await json("/llm/einstellungen", "PUT", { lmstudio_url: "https://evil.example/v1" })).status, 400);
    assert.equal((await json("/entities/KiEinstellung")).status, 403);
    assert.equal((await json("/entities/KiEinstellung", "POST", { nur_lokal: false })).status, 403);
    assert.equal((await json("/entities/kieinstellung/bulk", "POST", { records: [] })).status, 403);
    const liste = await (await json("/entities")).json();
    assert.ok(liste.gesperrt.includes("KiEinstellung"));
  });
  it("with Nur lokale KI: test, model list and invoke refuse cloud targets in plain text", async () => {
    const t = await (await json("/llm/test", "POST", { provider: "openai", base_url: "https://api.openai.com/v1", model: "g", api_key: "k" })).json();
    assert.equal(t.ok, false);
    assert.equal(t.gesperrt, true);
    assert.match(t.fehler, /api\.openai\.com/);
    const m = await (await json("/llm/modelle", "POST", { provider: "openai", base_url: "https://api.openai.com/v1" })).json();
    assert.equal(m.gesperrt, true);
    const i = await json("/integrations/invoke-llm", "POST", { prompt: "x" });
    assert.equal(i.status, 403);
    assert.match((await i.json()).error, /Nur lokale KI/);
  });
  it("local test against a stopped server → model list step fails fast with a plain sentence", async () => {
    const tot = http.createServer();
    await new Promise((r) => tot.listen(0, "127.0.0.1", r));
    const port = tot.address().port;
    await new Promise((r) => tot.close(r));
    const t = await (await json("/llm/test", "POST", { provider: "openai", base_url: `http://127.0.0.1:${port}/v1`, model: "m" })).json();
    assert.equal(t.ok, false);
    assert.equal(t.lokal, true);
    assert.match(t.fehler, /antwortet nicht unter 127\.0\.0\.1/);
    await json("/llm/einstellungen", "PUT", { nur_lokal: false });
  });
});
