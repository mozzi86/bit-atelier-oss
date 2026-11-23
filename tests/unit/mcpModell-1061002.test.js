// mcpModell-1061002.test.js — B-106-10-02: an agent must not change the model (BimModel, IfcAenderung) past the change log.
//  - The generic MCP write tools (create_record / update_record / delete_record / wiederherstellen) refuse the model entities in
//    any spelling, before anything is sent: model changes of an agent go through the proposal tools (eigenschaft_setzen,
//    transformieren, teilen), which a person confirms in the viewer - the same path as the app's own AI steps, so they land in the
//    change log (AenderungsSchritt) and in the change stream.
//  - The list in tools/mcp-server.mjs equals STROM_ENTITAETEN of server/aenderungsStrom.js.
//  - The change stream compares the DECODED entity name: a write on "/entities/Bim%4Dodel/<id>" (Express decodes it and writes
//    BimModel) is streamed like the plain spelling - before, it changed the model without any event (lesson of B-106-10-01).
// Neutral test data only; temp folders; never server/db.json.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter } from "../../packages/nova-core/server/routes.js";
import { inPapierkorb, papierkorbRouter, papierkorbSperre } from "../../packages/nova-core/server/papierkorbRouter.js";
import { aenderungsStrom, aenderungenMelden, STROM_ENTITAETEN } from "../../server/aenderungsStrom.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKRIPT = path.join(WURZEL, "tools", "mcp-server.mjs");
const QUELLE = fs.readFileSync(SKRIPT, "utf8");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-modell-1061002-"));

let db, server, port, kind, strom;
/** @type {any[]} */
const ereignisse = [];
/** @type {string[]} */
const anfragen = [];
const warter = new Map();
let n = 1;

before(async () => {
  db = createDb(path.join(TMP, "db.json"));
  strom = aenderungsStrom();
  const melden = strom.melden;
  strom.melden = (e) => { ereignisse.push(e); return melden(e); };
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => { anfragen.push(`${req.method} ${req.originalUrl}`); next(); });
  app.get("/api/system/datenordner", (_req, res) => res.json({ ordner: TMP }));
  app.get("/api/auth/me", (_req, res) => res.json({ id: "u1", full_name: "Testperson" }));
  app.use("/api", aenderungenMelden(strom, db));
  app.use("/api", papierkorbSperre());
  app.use("/api", entitiesRouter(db));
  app.use("/api", papierkorbRouter(db));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", () => r(undefined)); });
  port = server.address().port;
  kind = spawn(process.execPath, [SKRIPT, "--schreiben"], { env: { ...process.env, BIT_API_URL: `http://127.0.0.1:${port}/api`, BIT_DATA_DIR: TMP }, stdio: ["pipe", "pipe", "pipe"] });
  let rest = "";
  kind.stdout.setEncoding("utf8");
  kind.stdout.on("data", (s) => {
    rest += s;
    let i;
    while ((i = rest.indexOf("\n")) >= 0) { const m = JSON.parse(rest.slice(0, i)); rest = rest.slice(i + 1); warter.get(m.id)?.(m); }
  });
});
after(async () => {
  await new Promise((r) => { kind.on("exit", r); kind.stdin.end(); });
  await new Promise((r) => server.close(r));
  db.flush();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder */ }
});

/** @param {string} name @param {Record<string, any>} args @returns {Promise<{isError: boolean, text: string}>} */
async function werkzeug(name, args) {
  const id = n++;
  const p = new Promise((r) => warter.set(id, r));
  kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
  const m = /** @type {any} */ (await p);
  return { isError: m.result?.isError === true, text: m.result?.content?.[0]?.text ?? JSON.stringify(m.error) };
}

/** node:http sends the path exactly as written (percent signs kept). */
const anfrage = (pfad, method, body) => new Promise((resolve, reject) => {
  const daten = body ? JSON.stringify(body) : "";
  const req = http.request({ hostname: "127.0.0.1", port, path: `/api${pfad}`, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(daten) } }, (res) => {
    let roh = ""; res.on("data", (c) => { roh += c; }); res.on("end", () => resolve({ status: res.statusCode, json: roh ? JSON.parse(roh) : null }));
  });
  req.on("error", reject); req.end(daten);
});

describe("B-106-10-02 — agents write the model only through confirmed proposals", () => {
  it("create/update/delete_record on BimModel and IfcAenderung (any spelling): refused, nothing sent", async () => {
    const modell = db.create("BimModel", { project_id: "p-1", storeys: 2 });
    const vorher = anfragen.length;
    for (const entity of ["BimModel", "bimmodel", "IfcAenderung", "IFCAENDERUNG"]) {
      for (const [name, args] of [
        ["create_record", { entity, data: { project_id: "p-1", storeys: 3 }, ausfuehren: true }],
        ["update_record", { entity, id: modell.id, data: { storeys: 3 }, ausfuehren: true }],
        ["delete_record", { entity, id: modell.id, ausfuehren: true }],
      ]) {
        const r = await werkzeug(name, args);
        assert.equal(r.isError, true, `${name} ${entity}: ${r.text}`);
        assert.match(r.text, /eigenschaft_setzen/, `${name} ${entity} names the proposal tools`);
      }
    }
    assert.deepEqual(anfragen.slice(vorher).filter((a) => !a.startsWith("GET /api/auth") && !a.startsWith("GET /api/system")), [], "nothing reached the model");
    assert.equal(db.get("BimModel", modell.id).storeys, 2);
  });

  it("wiederherstellen of a model record from the bin: refused", async () => {
    const m = db.create("BimModel", { project_id: "p-2", storeys: 1 });
    const { eintrag } = /** @type {any} */ (inPapierkorb(db, "BimModel", m.id, { herkunft: "app", person: true }));
    const r = await werkzeug("wiederherstellen", { id: eintrag.id, ausfuehren: true });
    assert.equal(r.isError, true, r.text);
    assert.equal(db.get("BimModel", m.id), null);
  });

  it("the mirrored list equals STROM_ENTITAETEN", () => {
    const m = QUELLE.match(/const MODELL_ENTITAETEN = Object\.freeze\(\[([^\]]*)\]\)/);
    assert.ok(m, "MODELL_ENTITAETEN found in tools/mcp-server.mjs");
    assert.deepEqual(m[1].split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean), [...STROM_ENTITAETEN]);
  });

  it("the change stream reports a write on a percent-encoded model name", async () => {
    const m = db.create("BimModel", { project_id: "p-3", storeys: 1 });
    const vorher = ereignisse.length;
    const r = await anfrage(`/entities/Bim%4Dodel/${m.id}`, "PUT", { storeys: 5 });
    assert.equal(r.status, 200);
    assert.equal(db.get("BimModel", m.id).storeys, 5, "Express decoded the name and wrote the model");
    await new Promise((res) => setTimeout(res, 20));
    const neu = ereignisse.slice(vorher);
    assert.equal(neu.length, 1, "exactly one event for the write");
    assert.deepEqual([neu[0].entitaet, neu[0].id, neu[0].art, neu[0].projekt], ["BimModel", m.id, "geaendert", "p-3"]);
  });

  // B-106-10-02 (rule completed in welle 1): EVERY server write path on a streamed entity emits the event - the bulk routes too
  // (before, POST/PUT /entities/BimModel/bulk changed the model without any event).
  it("POST /entities/BimModel/bulk reports one 'angelegt' event per created record", async () => {
    const vorher = ereignisse.length;
    const r = await anfrage("/entities/BimModel/bulk", "POST", { records: [{ project_id: "p-4", storeys: 1 }, { project_id: "p-5", storeys: 2 }] });
    assert.equal(r.status, 201);
    await new Promise((res) => setTimeout(res, 20));
    const neu = ereignisse.slice(vorher);
    assert.deepEqual(neu.map((e) => [e.entitaet, e.id, e.art, e.projekt]), [
      ["BimModel", r.json.ids[0], "angelegt", "p-4"], ["BimModel", r.json.ids[1], "angelegt", "p-5"],
    ]);
  });

  it("PUT /entities/IfcAenderung/bulk (upsert) reports 'geaendert' for updated and 'angelegt' for created records", async () => {
    const alt = db.create("IfcAenderung", { project_id: "p-6", schluessel: "k-1", wert: 1 });
    const vorher = ereignisse.length;
    const r = await anfrage("/entities/Ifc%41enderung/bulk", "PUT", { key: "schluessel", records: [
      { schluessel: "k-1", wert: 2 }, { schluessel: "k-2", project_id: "p-6", wert: 3 },
    ] });
    assert.equal(r.status, 200);
    assert.equal(db.get("IfcAenderung", alt.id).wert, 2);
    await new Promise((res) => setTimeout(res, 20));
    const neu = ereignisse.slice(vorher);
    assert.deepEqual(neu.map((e) => [e.entitaet, e.id, e.art, e.projekt]), [
      ["IfcAenderung", alt.id, "geaendert", "p-6"], ["IfcAenderung", r.json.ids[0], "angelegt", "p-6"],
    ]);
    assert.deepEqual(neu[0].felder, ["schluessel", "wert"], "the updated fields as sent");
  });

  it("a refused bulk write (409) reports nothing", async () => {
    const m = db.create("BimModel", { project_id: "p-7", storeys: 1 });
    const vorher = ereignisse.length;
    const r = await anfrage("/entities/BimModel/bulk?kennung=uebernehmen", "POST", { records: [{ id: m.id, project_id: "p-7" }] });
    assert.equal(r.status, 409);
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(ereignisse.length, vorher);
  });
});
