// 106-06: an image of the view as context for a model. With a FAKE provider (no network): the image goes only to a model that reads images,
// never to a target outside this computer with "Nur lokale KI", never for an NDA project, and outside this computer only after the person's
// consent for the project (D-IM-02). Covers:
//  - bildKontext.js: PNG size from the header, limits (1280 px edge, bytes, count), the decision order of bildFreigabe,
//  - modellKatalog.bildFaehig: catalog first, then the model-id patterns; unknown = no; the harness keeps the same pattern list,
//  - llm.js invokeLLM: image blocks per dialect (Messages, Chat Completions, /api/chat), every refusal BEFORE any request, text-only unchanged,
//  - routes.js: GET /llm/bild-freigabe, POST /llm/bild-zustimmung only from the browser, NDA refuses consent, a generic write can neither
//    give consent nor clear the NDA marker; invoke-llm reads project and switches from the store,
//  - sprachAgent.modellFragen "mit Bild": NDA, model without images, missing consent -> question, cloud question names the image, image sent,
//  - ansicht-bild of the viewers: NDA refused, the answer names the project; ansichtAlsPng keeps the longest edge within the limit.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  BILD_KANTE_MAX, BILD_ANZAHL_MAX, BILD_GRUENDE, pngMasse, bilderPruefen, bildFreigabe, bildZielText, zugestimmt,
} from "@core/lib/zeigen/bildKontext.js";
import { BILD_MODELL_MUSTER, bildFaehig, katalogPruefen } from "@core/lib/modellKatalog.js";
import { modellFragen, agentAuftrag } from "@core/lib/zeigen/sprachAgent.js";
import { antwortSatz } from "@core/lib/zeigen/sprechAblauf.js";
import { auswahlBefehleRegistrieren, NDA_BILD_TEXT } from "@core/lib/zeigen/auswahlBefehle.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { ansichtAlsPng } from "@core/lib/zeigen/ansichtBild.js";
import { invokeLLM, benutzerNachricht } from "../../packages/nova-core/server/llm.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { llmRouter, entitiesRouter, projektFelderSchuetzen, personImBrowser, FELD_GESCHUETZT_KOPF } from "../../packages/nova-core/server/routes.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KATALOG = katalogPruefen(JSON.parse(fs.readFileSync(path.join(WURZEL, "packages/nova-core/src/lib/lokaleModelle.json"), "utf8"))).katalog;

/** A real PNG of w x h px (grey), base64 without prefix. */
function png(w = 4, h = 3) {
  const crcTab = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (typ, daten) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ, "ascii"), daten]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const roh = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w, 0x80)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(roh)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const BILD = png(8, 6);
const OK_PROJEKT = { id: "P1", nda: false, bild_freigabe: { am: "2026-10-25T10:00:00.000Z", durch: "person" } };

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 bildKontext — limits and the decision", () => {
  it("reads width and height from the PNG header; not a PNG -> null", () => {
    assert.deepEqual(pngMasse(png(640, 360)), { breite: 640, hoehe: 360 });
    assert.equal(pngMasse("R0lGODlhAQABAIAAAP"), null);
    assert.equal(pngMasse(""), null);
  });

  it("bilderPruefen: accepts PNGs within the limits, refuses in words what is not (never cuts silently)", () => {
    assert.deepEqual(bilderPruefen(undefined), []);
    assert.deepEqual(bilderPruefen([{ png_base64: `data:image/png;base64,${BILD}` }]), [{ png_base64: BILD, breite: 8, hoehe: 6 }]);
    assert.throws(() => bilderPruefen("x"), /Liste/);
    assert.throws(() => bilderPruefen([{ png_base64: png(BILD_KANTE_MAX + 1, 10) }]), (e) => /1280 px Kante/.test(e.message) && e.status === 400);
    assert.throws(() => bilderPruefen([{ png_base64: png(10, BILD_KANTE_MAX + 1) }]), /1280/);
    assert.ok(bilderPruefen([{ png_base64: png(BILD_KANTE_MAX, BILD_KANTE_MAX) }]).length === 1, "exactly the limit is allowed");
    assert.throws(() => bilderPruefen(Array(BILD_ANZAHL_MAX + 1).fill({ png_base64: BILD })), /Höchstens/);
    assert.throws(() => bilderPruefen([{ png_base64: "R0lGODlhAQABAIAAAP8AAP" }]), /kein PNG/);
    assert.throws(() => bilderPruefen([{ png_base64: "iVBOR w0" }]), /kein base64/);
  });

  it("bildFreigabe: no project, NDA (every target), Nur lokale KI, office switch, consent - in this order", () => {
    const f = (o) => bildFreigabe({ zielLokal: false, ...o });
    assert.equal(f({ projekt: null }).grund, "ohne-projekt");
    assert.equal(f({ projekt: { nda: true, bild_freigabe: OK_PROJEKT.bild_freigabe } }).grund, "nda");
    assert.equal(bildFreigabe({ projekt: { nda: true }, zielLokal: true }).grund, "nda", "NDA also for a model on this computer");
    assert.equal(f({ projekt: OK_PROJEKT, nurLokal: true }).grund, "nur-lokal");
    assert.equal(f({ projekt: OK_PROJEKT, bilderExtern: false }).grund, "buero");
    const ohne = f({ projekt: { nda: false }, ziel: bildZielText({ lokal: false, anbieter: "cloud", host: "api.example.com" }) });
    assert.equal(ohne.grund, "zustimmung");
    assert.match(ohne.text, /verlässt diesen Rechner \(an „cloud“ — außerhalb dieses Rechners \(api\.example\.com\)\)/);
    assert.deepEqual(f({ projekt: OK_PROJEKT }), { ok: true, grund: null, text: "" });
    // on this computer: no consent needed, the office switch and "Nur lokale KI" do not apply
    assert.equal(bildFreigabe({ projekt: { nda: false }, zielLokal: true, nurLokal: true, bilderExtern: false }).ok, true);
    assert.equal(zugestimmt({ bild_freigabe: { am: "" } }), false);
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 modellKatalog.bildFaehig — vision is mandatory", () => {
  it("catalog first (local tags), then patterns; unknown and empty = no, with a sentence", () => {
    assert.equal(bildFaehig({ modell: "gemma4:12b", katalog: KATALOG }).quelle, "katalog");
    assert.equal(bildFaehig({ modell: "gemma4:12b", katalog: KATALOG }).ja, true);
    const qwen = bildFaehig({ modell: "qwen3.6:27b", katalog: KATALOG });
    assert.equal(qwen.ja, false);
    assert.match(qwen.text, /laut Katalog keine Bilder/);
    assert.equal(bildFaehig({ modell: "llama3", katalog: KATALOG }).ja, false, "the default local model llama3 reads no images");
    assert.equal(bildFaehig({ modell: "claude-sonnet-5-5" }).ja, true);
    assert.equal(bildFaehig({ modell: "openai/gpt-4o-mini" }).ja, true, "the id after the last slash");
    const unbekannt = bildFaehig({ modell: "deepseek-v4-pro" });
    assert.equal(unbekannt.ja, false);
    assert.match(unbekannt.text, /nicht bekannt, dass es Bilder versteht/);
    assert.equal(bildFaehig({ modell: "" }).ja, false);
  });

  it("review fix: the patterns do not take the text-only members of a family (o3-mini, gemma3 1b/270m, claude-2, audio/embedding variants)", () => {
    for (const m of ["o3-mini", "o3-mini-high", "gemma3:1b", "gemma3:270m", "gemma-3-1b-it", "claude-2.1", "claude-instant-1.2", "gpt-4o-audio-preview",
      "gpt-4o-realtime-preview", "gpt-4o-mini-transcribe", "gpt-4o-search-preview", "gemini-embedding-001", "gemini-2.5-flash-preview-tts"]) {
      assert.equal(bildFaehig({ modell: m }).ja, false, m);
    }
    for (const m of ["o3", "o3-pro", "gemma3:4b", "gemma3:27b-it-qat", "gemma-3-12b-it", "gemma3n:e4b", "google/gemma-4-12b", "claude-3-5-sonnet-20241022",
      "claude-haiku-4-5", "claude-opus-4-1", "gpt-4o", "gpt-4o-mini", "gemini-2.5-pro"]) {
      assert.equal(bildFaehig({ modell: m }).ja, true, m);
    }
  });

  it("the harness keeps the same pattern list (harness/harness/bilder.py)", () => {
    const py = fs.readFileSync(path.join(WURZEL, "harness/harness/bilder.py"), "utf8");
    const block = py.slice(py.indexOf("# BILD_MODELL_MUSTER-ANFANG"), py.indexOf("# BILD_MODELL_MUSTER-ENDE"));
    const muster = [...block.matchAll(/^\s*"((?:[^"\\]|\\.)*)",\s*$/gm)].map((m) => m[1].replace(/\\\\/g, "\\"));
    assert.deepEqual(muster, [...BILD_MODELL_MUSTER]);
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 llm.js — image blocks only to a model that reads images, refusals before any request", () => {
  /** A fake provider: records every request, answers like the dialect. */
  const anbieter = () => {
    const anfragen = [];
    const antwort = (url) => ({ ok: true, status: 200, text: async () => "", json: async () => (String(url).includes("/v1/messages") ? { content: [{ text: "Links steht eine Wand." }] }
      : String(url).includes("/api/chat") ? { message: { content: "Links steht eine Wand." } } : { choices: [{ message: { content: "Links steht eine Wand." } }] }) });
    const fetchFn = async (url, init) => { anfragen.push({ url: String(url), body: JSON.parse(init.body) }); return antwort(url); };
    const anfrageFn = async (url, init) => { anfragen.push({ url: String(url), body: JSON.parse(init.body) }); return antwort(url); };
    return { anfragen, deps: { fetchFn, anfrageFn } };
  };
  const CLOUD = { provider: "anthropic", base_url: "https://api.anthropic.com", model: "claude-sonnet-5-5", api_key: "k" };
  const CLOUD_OHNE = { provider: "openai", base_url: "https://api.deepseek.com", model: "deepseek-v4-pro", api_key: "k" };
  const OLLAMA = { provider: "ollama", base_url: "http://127.0.0.1:11434", model: "gemma4:12b" };
  const LMSTUDIO = { provider: "openai", base_url: "http://127.0.0.1:1234/v1", model: "google/gemma-4-12b" };
  const p = { prompt: "Was ist links von der gewählten Wand?", bilder: [{ png_base64: BILD }] };

  it("cloud model that reads images + project with consent: the image goes as a Messages-dialect image block before the text", async () => {
    const a = anbieter();
    assert.equal(await invokeLLM(p, CLOUD, { projekt: OK_PROJEKT, katalog: KATALOG, deps: a.deps }), "Links steht eine Wand.");
    assert.equal(a.anfragen.length, 1);
    const inhalt = a.anfragen[0].body.messages[0].content;
    assert.deepEqual(inhalt[0], { type: "image", source: { type: "base64", media_type: "image/png", data: BILD } });
    assert.equal(inhalt[1].type, "text");
    assert.match(inhalt[1].text, /Was ist links/);
  });

  it("/api/chat and Chat Completions on this computer: `images` / image_url data URL; no consent needed locally", async () => {
    const a = anbieter();
    await invokeLLM(p, OLLAMA, { projekt: { id: "P2", nda: false }, katalog: KATALOG, nurLokal: true, deps: a.deps });
    const ollama = a.anfragen[0].body.messages.at(-1);
    assert.deepEqual(ollama.images, [BILD]);
    await invokeLLM(p, LMSTUDIO, { projekt: { id: "P2", nda: false }, katalog: KATALOG, nurLokal: true, deps: a.deps });
    const teile = a.anfragen[1].body.messages.at(-1).content;
    assert.equal(teile[0].type, "text");
    assert.deepEqual(teile[1], { type: "image_url", image_url: { url: `data:image/png;base64,${BILD}` } });
  });

  it("refusals - nothing is sent: model without images, Nur lokale KI to the cloud, NDA (also locally), no consent, office switch, no project", async () => {
    const faelle = [
      [CLOUD_OHNE, { projekt: OK_PROJEKT }, 422, "vision", /nicht bekannt, dass es Bilder versteht/],
      [{ ...OLLAMA, model: "llama3.2:3b" }, { projekt: OK_PROJEKT }, 422, "vision", /laut Katalog keine Bilder/],
      [CLOUD, { projekt: OK_PROJEKT, nurLokal: true }, 403, undefined, /Nur lokale KI/],
      [OLLAMA, { projekt: { ...OK_PROJEKT, nda: true } }, 403, "nda", /NDA-Projekt/],
      [CLOUD, { projekt: { id: "P3", nda: false } }, 409, "zustimmung", /einmal je Projekt Ihre Zustimmung/],
      [CLOUD, { projekt: OK_PROJEKT, bilderExtern: false }, 403, "buero", /Einstellungen des Büros/],
      [CLOUD, { projekt: null }, 403, "ohne-projekt", /Ohne geöffnetes Projekt/],
      [null, { projekt: OK_PROJEKT, env: {} }, 422, "vision", /Offline-Modus/],
      // review fix: a local chat-completions server without a model id answers with whatever it has loaded - not with the vendor's default
      [{ ...LMSTUDIO, model: "" }, { projekt: OK_PROJEKT }, 422, "vision", /Kein Modell gewählt/],
      [{ provider: "custom", base_url: "http://127.0.0.1:8080/v1" }, { projekt: OK_PROJEKT }, 422, "vision", /Kein Modell gewählt/],
    ];
    for (const [conn, opt, status, grund, text] of faelle) {
      const a = anbieter();
      await assert.rejects(invokeLLM(p, conn, { katalog: KATALOG, ...opt, deps: a.deps }), (e) => {
        assert.equal(e.status, status, e.message);
        if (grund) assert.equal(e.grund, grund);
        assert.match(e.message, text);
        return true;
      });
      assert.equal(a.anfragen.length, 0, `nothing sent: ${e2s(conn)} ${JSON.stringify(opt)}`);
    }
  });

  it("a request without images stays as before (no check, no image field, plain string content)", async () => {
    const a = anbieter();
    await invokeLLM({ prompt: "hallo" }, CLOUD_OHNE, { deps: a.deps });
    const user = a.anfragen[0].body.messages.at(-1);
    assert.equal(typeof user.content, "string");
    assert.ok(!("images" in user));
    assert.deepEqual(benutzerNachricht("anthropic", "x"), { role: "user", content: "x" });
  });
});
const e2s = (c) => (c ? `${c.provider} ${c.model}` : "ohne Verbindung");

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 routes — consent per project, only by the person; the store decides", () => {
  let tmp, server, basis, db;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-10606-"));
    db = createDb(path.join(tmp, "db.json"));
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/api", entitiesRouter(db));
    app.use("/api", llmRouter(db));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
    basis = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  /** What a browser sends for a request of the app's own page (Fetch Metadata + Origin). */
  const BROWSER = { origin: "http://localhost:5183", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" };
  const rufe = (pfad, method = "GET", body, kopf = {}) => fetch(`${basis}${pfad}`, { method, headers: { "content-type": "application/json", ...kopf }, body: body ? JSON.stringify(body) : undefined });
  /**
   * A program on this computer (the harness, a script): node:http sends neither Origin nor Sec-Fetch-*. Node's global fetch (the real MCP
   * server) sends only sec-fetch-mode - see the review-fix case below.
   * @returns {Promise<{status: number, json: () => Promise<any>}>}
   */
  const programm = (pfad, method, body) => new Promise((resolve, reject) => {
    const u = new URL(`${basis}${pfad}`);
    const daten = body ? JSON.stringify(body) : "";
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(daten) } }, (res) => {
      let t = "";
      res.on("data", (c) => { t += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(t) }));
    });
    req.on("error", reject);
    req.end(daten);
  });

  it("GET bild-freigabe -> consent missing; POST from a program refused, from the browser stored; DELETE withdraws", async () => {
    const pr = await (await rufe("/entities/Project", "POST", { name: "Bildprobe" }, BROWSER)).json();
    let f = await (await rufe(`/llm/bild-freigabe?projekt_id=${pr.id}&ziel=extern&anbieter=cloud&host=api.example.com`)).json();
    assert.equal(f.ok, false);
    assert.equal(f.grund, "zustimmung");
    assert.match(f.text, /api\.example\.com/);
    assert.equal((await (await rufe(`/llm/bild-freigabe?projekt_id=${pr.id}&ziel=lokal`)).json()).ok, true, "on this computer no consent is needed");
    const vonProgramm = await programm("/llm/bild-zustimmung", "POST", { projekt_id: pr.id });
    assert.equal(vonProgramm.status, 403, "an agent/program never consents for the person");
    assert.match((await vonProgramm.json()).error, /nur die Person/);
    const person = await rufe("/llm/bild-zustimmung", "POST", { projekt_id: pr.id }, BROWSER);
    assert.equal(person.status, 200);
    f = await (await rufe(`/llm/bild-freigabe?projekt_id=${pr.id}`)).json();
    assert.equal(f.ok, true);
    assert.equal(f.zugestimmt, true);
    assert.ok(typeof f.am === "string" && f.am.length > 0);
    assert.equal((await rufe(`/llm/bild-zustimmung?projekt_id=${pr.id}`, "DELETE")).status, 200);
    assert.equal((await (await rufe(`/llm/bild-freigabe?projekt_id=${pr.id}`)).json()).grund, "zustimmung");
    assert.equal((await rufe("/llm/bild-freigabe?projekt_id=gibtsnicht")).status, 404);
  });

  it("NDA: no consent possible, refusal for every target; a generic write can neither consent nor clear the marker, but may set it", async () => {
    const pr = await (await rufe("/entities/Project", "POST", { name: "Geheim", nda: true }, BROWSER)).json();
    assert.equal(pr.nda, true);
    assert.equal((await rufe("/llm/bild-zustimmung", "POST", { projekt_id: pr.id }, BROWSER)).status, 409);
    assert.equal((await (await rufe(`/llm/bild-freigabe?projekt_id=${pr.id}&ziel=lokal`)).json()).grund, "nda");
    // an agent with write access (MCP update_record): neither clears NDA nor smuggles in a consent
    const nachher = await (await programm(`/entities/Project/${pr.id}`, "PUT", { nda: false, bild_freigabe: { am: "2026-01-01" } })).json();
    assert.equal(nachher.nda, true);
    assert.equal(nachher.bild_freigabe ?? null, null);
    // the person in the app may clear the marker; a consent still only comes through the route
    const offen = await (await rufe(`/entities/Project/${pr.id}`, "PUT", { nda: false, bild_freigabe: { am: "2026-01-01" } }, BROWSER)).json();
    assert.equal(offen.nda, false);
    assert.equal(offen.bild_freigabe ?? null, null);
    // a program may make a project stricter
    const p2 = await (await programm("/entities/Project", "POST", { name: "Auch geheim", nda: true })).json();
    assert.equal(p2.nda, true);
    assert.equal(projektFelderSchuetzen("BimModel", { bild_freigabe: 1 }, false).bild_freigabe, 1, "other entities unchanged");
  });

  it("review fix: Node's own fetch (the real MCP client, sends sec-fetch-mode) is a program - nda stays, no consent, the dropped fields are named", async () => {
    const pr = await (await rufe("/entities/Project", "POST", { name: "Fetch-Probe", nda: true }, BROWSER)).json();
    // plain global fetch without extra headers: exactly what tools/mcp-server.mjs api() sends
    const put = await fetch(`${basis}/entities/Project/${pr.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nda: false, bild_freigabe: { am: "2026-01-01" } }) });
    assert.equal(put.status, 200);
    assert.equal(put.headers.get(FELD_GESCHUETZT_KOPF), "bild_freigabe,nda", "the program learns which fields were not taken");
    const nachher = await put.json();
    assert.equal(nachher.nda, true, "update_record of an agent cannot clear the NDA marker");
    assert.equal(nachher.bild_freigabe ?? null, null);
    const ohneNda = await (await rufe("/entities/Project", "POST", { name: "Offen" }, BROWSER)).json();
    const z = await fetch(`${basis}/llm/bild-zustimmung`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projekt_id: ohneNda.id }) });
    assert.equal(z.status, 403, "no consent from a program's fetch");
    // the person's form echoes the stored record: nothing to report to it
    const form = await rufe(`/entities/Project/${ohneNda.id}`, "PUT", { name: "Offen 2", bild_freigabe: null }, BROWSER);
    assert.equal(form.headers.get(FELD_GESCHUETZT_KOPF), null);
  });

  it("review fix: personImBrowser - same-origin page yes; cross-site, fetch metadata without site, no headers no; LAN over http: Origin = own host", () => {
    assert.equal(personImBrowser({ headers: { "sec-fetch-site": "same-origin", origin: "http://localhost:5183" } }), true);
    assert.equal(personImBrowser({ headers: { "sec-fetch-site": "cross-site", origin: "https://fremd.example" } }), false);
    assert.equal(personImBrowser({ headers: { "sec-fetch-site": "same-site" } }), false);
    assert.equal(personImBrowser({ headers: { "sec-fetch-mode": "cors" } }), false, "Node's fetch");
    assert.equal(personImBrowser({ headers: {} }), false, "curl, node:http");
    assert.equal(personImBrowser({ headers: { origin: "http://192.168.1.20:3001", host: "192.168.1.20:3001" } }), true, "office device over http (no fetch metadata)");
    assert.equal(personImBrowser({ headers: { origin: "http://fremd.example", host: "192.168.1.20:3001" } }), false);
  });

  it("invoke-llm with an image reads project and switches from the store (bild_projekt_id), refuses before any request", async () => {
    const pr = await (await rufe("/entities/Project", "POST", { name: "Invoke", nda: true }, BROWSER)).json();
    const r = await rufe("/integrations/invoke-llm", "POST", { prompt: "x", bilder: [{ png_base64: BILD }], bild_projekt_id: pr.id, nda: false });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.grund, "nda");
    const kaputt = await rufe("/integrations/invoke-llm", "POST", { prompt: "x", bilder: [{ png_base64: "kein-bild" }] });
    assert.equal(kaputt.status, 400);
  });

  it("office switch bilder_extern: default on, validated, readable", async () => {
    assert.equal((await (await rufe("/llm/einstellungen")).json()).bilder_extern, true);
    assert.equal((await rufe("/llm/einstellungen", "PUT", { bilder_extern: "ja" })).status, 400);
    assert.equal((await (await rufe("/llm/einstellungen", "PUT", { bilder_extern: false })).json()).bilder_extern, false);
    const pr = await (await rufe("/entities/Project", "POST", { name: "Buero" }, BROWSER)).json();
    await rufe("/llm/bild-zustimmung", "POST", { projekt_id: pr.id }, BROWSER);
    assert.equal((await (await rufe(`/llm/bild-freigabe?projekt_id=${pr.id}`)).json()).grund, "buero");
    await rufe("/llm/einstellungen", "PUT", { bilder_extern: true });
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 sprachAgent — „mit Bild“ in the speech field", () => {
  const AUSWAHL = { anzahl: 1, bauteile: [{ guid: "GUID-WAND-0000000000001", klasse: "IfcWall", name: "Wand" }] };
  /** Fake service: readiness, the store's answer per project, records what was sent. */
  const dienst = (bereit = {}, freigaben = {}) => {
    const gesendet = [];
    const gefragt = [];
    return {
      gesendet, gefragt,
      stt: async () => ({ text: "" }),
      bereit: async () => ({ harness: true, stt: true, sttBereit: true, hinweis: "", provider: "cloud", providerLokal: false, nurLokalApp: false, nurLokalHarness: false,
        mcp: true, bilder: true, modell: "claude-sonnet-5-5", providerZiel: "api.example.com", ...bereit }),
      agent: async (auftrag, o) => { gesendet.push({ auftrag, o }); return { text: "Links steht eine Tür.", werkzeuge: [], vorschlaege: 0, fehler: null }; },
      bildFreigabe: async (pid, ziel) => { gefragt.push({ pid, ziel }); return freigaben[pid] ?? { ok: true, grund: null, text: "" }; },
    };
  };
  const bild = (o) => ({ png_base64: BILD, breite: o.breite, hoehe: 6 });

  it("NDA project: refused with the NDA sentence, the store is not even asked, nothing is sent", async () => {
    const d = dienst();
    const r = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, bild, projektId: "P1", nda: true, cloudOk: true });
    assert.equal(r.art, "modell-fehler");
    assert.equal(r.text, BILD_GRUENDE.nda);
    assert.deepEqual([d.gefragt.length, d.gesendet.length], [0, 0]);
  });

  it("the harness's model reads no images: a sentence, never a silent send without the image", async () => {
    const d = dienst({ bilder: false, modell: "deepseek-v4-pro" });
    const r = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, bild, projektId: "P1", cloudOk: true });
    assert.equal(r.art, "modell-fehler");
    assert.match(r.text, /deepseek-v4-pro.*keine Bilder/);
    assert.equal(d.gesendet.length, 0);
  });

  it("no consent yet: the question `bild-zustimmung`; with consent: the cloud question names the image; then image + project go to the agent", async () => {
    const d = dienst({}, { P9: { ok: false, grund: "zustimmung", text: "Das Bild der Ansicht verlässt diesen Rechner (an „cloud“) — dafür braucht es einmal je Projekt Ihre Zustimmung" } });
    const frage = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, bild, projektId: "P9" });
    assert.equal(frage.art, "bild-zustimmung");
    assert.match(frage.text, /einmal je Projekt/);
    assert.deepEqual(d.gefragt[0], { pid: "P9", ziel: { lokal: false, anbieter: "cloud", host: "api.example.com" } });
    assert.equal(d.gesendet.length, 0);

    const cloud = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, bild, projektId: "P1" });
    assert.equal(cloud.art, "modell-freigabe");
    assert.match(cloud.text, /ein Bild der Ansicht gehen an „cloud“ — außerhalb dieses Rechners \(api\.example\.com\)/);
    assert.equal(d.gesendet.length, 0);

    const r = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, bild, projektId: "P1", cloudOk: true });
    assert.equal(r.art, "modell");
    assert.equal(r.mitBild, true);
    const { auftrag, o } = d.gesendet[0];
    assert.deepEqual(o.bilder, [{ png_base64: BILD }]);
    assert.equal(o.projektId, "P1");
    assert.deepEqual(o.ziel, ["GUID-WAND-0000000000001"], "the target stays the GUID of the selection");
    assert.match(auftrag, /Bild der aktuellen Ansicht.*nie das Bild/);
  });

  it("without „mit Bild“ nothing changes: no image, no store question; a failing render is a sentence", async () => {
    const d = dienst({ providerLokal: true });
    await modellFragen("was ist links davon", AUSWAHL, { dienst: d, projektId: "P1" });
    assert.equal(d.gefragt.length, 0);
    assert.ok(!("bilder" in d.gesendet[0].o));
    assert.ok(!/Bild der aktuellen Ansicht/.test(agentAuftrag("x", AUSWAHL)));
    const kaputt = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, projektId: "P1", bild: () => { throw new Error("Ein Bild gibt es nur in der 3D-Ansicht"); } });
    assert.equal(kaputt.art, "modell-fehler");
    assert.match(kaputt.text, /nur in der 3D-Ansicht/);
    assert.equal(d.gesendet.length, 1);
  });

  it("review fix: no 3D view -> said BEFORE the consent and cloud questions; sentences with values come as templates for t()", async () => {
    const d = dienst({}, { P9: { ok: false, grund: "zustimmung", text: "Zustimmung fehlt" } });
    const ohne = await modellFragen("was ist links davon", AUSWAHL, { dienst: d, projektId: "P9", bild: () => { throw new Error("Ein Bild gibt es nur in der 3D-Ansicht"); } });
    assert.equal(ohne.art, "modell-fehler", "not the consent question");
    assert.equal(d.gefragt.length, 0, "the store was not asked - nobody consents for an image that cannot be made");
    assert.equal(ohne.vorlage, "Kein Bild der Ansicht: {grund} — nichts gesendet");
    assert.deepEqual(ohne.werte, { grund: "Ein Bild gibt es nur in der 3D-Ansicht" });
    const englisch = (/** @type {string} */ s) => (s === ohne.vorlage ? "No image of the view: {grund} — nothing sent" : s);
    assert.equal(antwortSatz(/** @type {any} */ (ohne), englisch), "No image of the view: Ein Bild gibt es nur in der 3D-Ansicht — nothing sent");
    const vision = await modellFragen("x", AUSWAHL, { dienst: dienst({ bilder: false, modell: "m1" }), bild, projektId: "P1" });
    assert.equal(vision.vorlage?.startsWith("Modell „{modell}“: "), true);
    assert.equal(vision.text.startsWith("Modell „m1“: "), true);
    assert.equal(bildZielText({ lokal: false, anbieter: "cloud", host: "h.example" }, (s) => (s === "{wer} — außerhalb dieses Rechners ({host})" ? "{wer} — outside ({host})" : s)),
      "an „cloud“ — outside (h.example)");
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 viewer — ansicht-bild and the edge limit", () => {
  it("NDA project: ansicht-bild refuses; otherwise the answer names the project", () => {
    const reg = befehlsRegister();
    let projekt = { id: "P1", nda: true };
    auswahlBefehleRegistrieren(reg, () => /** @type {any} */ ({ projekt: () => projekt, ansichtBild: () => ({ png_base64: BILD, breite: 8, hoehe: 6, format: "image/png" }) }));
    const nein = /** @type {any} */ (reg.ausfuehren("ansicht-bild", {}));
    assert.equal(nein.ok, false);
    assert.equal(nein.error, NDA_BILD_TEXT);
    projekt = { id: "P1", nda: false };
    assert.equal(/** @type {any} */ (reg.ausfuehren("ansicht-bild", {})).result.projekt_id, "P1");
  });

  it("ansichtAlsPng with kante: a tall window keeps its height within the limit", () => {
    const quelle = { width: 1000, height: 2000 };
    const three = { renderer: { domElement: quelle, render() {} }, scene: {}, camera: {} };
    const erzeugeCanvas = (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage() {} }), toDataURL: () => `data:image/png;base64,${BILD}` });
    const r = ansichtAlsPng(three, { breite: 1280, kante: 1280, erzeugeCanvas });
    assert.ok(r.hoehe <= 1280 && r.breite <= 1280, `${r.breite} x ${r.hoehe}`);
    assert.equal(r.breite, 640);
    const breit = ansichtAlsPng({ ...three, renderer: { domElement: { width: 3000, height: 1000 }, render() {} } }, { breite: 1280, kante: 1280, erzeugeCanvas });
    assert.deepEqual([breit.breite, breit.hoehe], [1280, 427]);
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------
describe("106-06 harnessClient — image and project go with the task; the store question never throws", () => {
  it("agentFrage sends bilder + projekt_id only when there is an image", async () => {
    const { agentFrage } = await import("../../src/lib/harnessClient.js");
    const alt = globalThis.WebSocket;
    const offen = [];
    globalThis.WebSocket = /** @type {any} */ (class {
      constructor(url) { this.url = url; this.gesendet = []; offen.push(this); }
      send(s) { this.gesendet.push(JSON.parse(s)); }
      close() { this.onclose?.({}); }
    });
    try {
      const p = agentFrage("x", { ziel: ["G1"], bilder: [{ png_base64: BILD }], projektId: "P1" });
      offen[0].onmessage({ data: JSON.stringify({ type: "hello" }) });
      assert.deepEqual(offen[0].gesendet[0], { type: "user", text: "x", ziel: ["G1"], bilder: [{ png_base64: BILD }], projekt_id: "P1" });
      offen[0].onmessage({ data: JSON.stringify({ type: "done", stop_reason: "end_turn" }) });
      await p;
      const q = agentFrage("y", { ziel: [] });
      offen[1].onmessage({ data: JSON.stringify({ type: "hello" }) });
      assert.deepEqual(offen[1].gesendet[0], { type: "user", text: "y", ziel: [] });
      offen[1].onmessage({ data: JSON.stringify({ type: "done", stop_reason: "end_turn" }) });
      await q;
    } finally { globalThis.WebSocket = alt; }
  });

  it("bildFreigabeLesen: app down -> refusal with a sentence; the query names project, target and host", async () => {
    const { bildFreigabeLesen } = await import("../../src/lib/harnessClient.js");
    const alt = globalThis.fetch;
    const urls = [];
    try {
      globalThis.fetch = /** @type {any} */ (async () => { throw new TypeError("Failed to fetch"); });
      const r = await bildFreigabeLesen("P1", { lokal: false, anbieter: "cloud", host: "api.example.com" });
      assert.equal(r.ok, false);
      assert.match(r.text, /ohne Prüfung geht kein Bild/);
      globalThis.fetch = /** @type {any} */ (async (u) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => ({ ok: true, grund: null, text: "" }) }; });
      assert.equal((await bildFreigabeLesen("P1", { lokal: true })).ok, true);
      const q = new URL(urls[0], "http://x").searchParams;
      assert.deepEqual([q.get("projekt_id"), q.get("ziel")], ["P1", "lokal"]);
    } finally { globalThis.fetch = alt; }
  });
});
