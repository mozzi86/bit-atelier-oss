// B-106-10-01 — the generic entity CRUD locks LlmConnection (API keys), KiEinstellung and the HR entities for every
// spelling of the entity name: percent-encoded ("Llm%43onnection", "%4Ditarbeiter") and lower case are refused like
// the plain name, for every method, with the same 403 text. Before the fix the raw-path prefix lock let an encoded
// name through to the decoding routes (GET answered 200 with the plain api_key).
// Also pins down why this lock matters in office mode: the device allow-list of bueroWaechter checks the RAW path
// and lets any /api/entities/<name> through, so entitiesRouter is the only place that stops a paired LAN device.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter, gesperrteEntitaet, GESPERRT_TEXT } from "../../packages/nova-core/server/routes.js";
import { geraetDarf } from "../../server/bueroRouter.js";

const SCHLUESSEL = "sk-test-geheim-0123456789";

describe("B-106-10-01: locked entities hold for every spelling", () => {
  let tmp, server, port, db;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-10610s-"));
    db = createDb(path.join(tmp, "db.json"));
    db.create("LlmConnection", { id: "c1", provider: "openai", api_key: SCHLUESSEL, active: true });
    db.create("Mitarbeiter", { id: "m1", name: "Testperson", gehalt: 1 });
    db.create("KiEinstellung", { id: "k1", nur_lokal: true });
    const app = express();
    app.use(express.json());
    app.use("/api", entitiesRouter(db));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
    port = server.address().port;
  });
  after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  /** node:http sends the path exactly as written (percent signs kept) and no browser headers. */
  const anfrage = (pfad, method, body) => new Promise((resolve, reject) => {
    const daten = body ? JSON.stringify(body) : "";
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${pfad}`, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(daten) } }, (res) => {
      let roh = ""; res.on("data", (c) => { roh += c; }); res.on("end", () => resolve({ status: res.statusCode, roh, json: roh ? JSON.parse(roh) : null }));
    });
    req.on("error", reject); req.end(daten);
  });

  it("gesperrteEntitaet: decoded name, any case", () => {
    assert.equal(gesperrteEntitaet("LlmConnection"), GESPERRT_TEXT.llm);
    assert.equal(gesperrteEntitaet("llmconnection"), GESPERRT_TEXT.llm);
    assert.equal(gesperrteEntitaet("KIEINSTELLUNG"), GESPERRT_TEXT.ki);
    assert.equal(gesperrteEntitaet("mitarbeiter"), GESPERRT_TEXT.personal);
    assert.equal(gesperrteEntitaet("Kostensatz"), GESPERRT_TEXT.personal);
    assert.equal(gesperrteEntitaet("Project"), null);
    assert.equal(gesperrteEntitaet(undefined), null);
  });

  const FAELLE = [
    ["LlmConnection", GESPERRT_TEXT.llm],
    ["Llm%43onnection", GESPERRT_TEXT.llm],
    ["%4ClmConnection", GESPERRT_TEXT.llm],
    ["llmconnection", GESPERRT_TEXT.llm],
    ["KiEinstellung", GESPERRT_TEXT.ki],
    ["Ki%45instellung", GESPERRT_TEXT.ki],
    ["kieinstellung", GESPERRT_TEXT.ki],
    ["Mitarbeiter", GESPERRT_TEXT.personal],
    ["%4Ditarbeiter", GESPERRT_TEXT.personal],
    ["mitarbeiter", GESPERRT_TEXT.personal],
    ["Arbeits%76ertrag", GESPERRT_TEXT.personal],
  ];

  it("every method answers 403 with the same text, nothing of the record leaks", async () => {
    for (const [name, text] of FAELLE) {
      const versuche = [
        [`/entities/${name}`, "GET"],
        [`/entities/${name}/c1`, "GET"],
        [`/entities/${name}`, "POST", { api_key: "x" }],
        [`/entities/${name}/c1`, "PUT", { api_key: "x" }],
        [`/entities/${name}/c1`, "DELETE"],
        [`/entities/${name}/bulk`, "POST", { records: [{ x: 1 }] }],
        [`/entities/${name}/bulk`, "PUT", { records: [{ id: "c1", api_key: "x" }] }],
      ];
      for (const [pfad, method, body] of versuche) {
        const a = await anfrage(pfad, method, body);
        assert.equal(a.status, 403, `${method} ${pfad}`);
        assert.equal(a.json.error, text, `${method} ${pfad}`);
        assert.ok(!a.roh.includes(SCHLUESSEL) && !a.roh.includes("Testperson"), `${method} ${pfad} leaked`);
      }
    }
  });

  it("other entities stay open, and the locked records are unchanged", async () => {
    assert.equal((await anfrage("/entities/Project", "POST", { name: "P" })).status, 201);
    assert.equal((await anfrage("/entities/Proj%65ct", "GET")).status, 200);
    const uebersicht = await anfrage("/entities", "GET");
    assert.ok(!uebersicht.json.entitaeten.some((e) => /llmconnection|mitarbeiter|kieinstellung/i.test(e.name)));
    assert.deepEqual(db.list("LlmConnection").map((c) => [c.id, c.api_key]), [["c1", SCHLUESSEL]]);
    assert.deepEqual(db.list("Mitarbeiter").map((m) => m.id), ["m1"]);
    assert.deepEqual(db.list("llmconnection"), [], "no lower-case twin collection");
  });

  it("office mode: the device allow-list lets an encoded name through, so only this lock stops a paired LAN device", () => {
    assert.equal(geraetDarf("GET", "/api/entities/Llm%43onnection"), true);
    assert.equal(geraetDarf("PUT", "/api/entities/%4Ditarbeiter/m1"), true);
  });
});
