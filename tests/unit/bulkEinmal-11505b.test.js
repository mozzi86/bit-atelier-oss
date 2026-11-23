// 115-05b part 2 (review of part 1, low): "one BuildingComplex per project" also on the bulk paths of the server. Before, only the
// single POST refused a second design record; POST /entities/BuildingComplex/bulk and PUT …/bulk (upsert) still created one.
//   - bulk create: a record for a project that has one already, or two records of one project in the batch → 409, nothing created
//   - bulk upsert: a record that would be CREATED for such a project → 409, nothing written; an update of the existing record (by
//     id or by project_id as key) works as before
//   - other entities: no rule
//
// In: nothing. Out: assertions only (a throwaway JSON db in the OS temp folder).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter } from "../../packages/nova-core/server/routes.js";

describe("one BuildingComplex per project on the bulk paths", () => {
  /** @type {string} */ let tmp;
  /** @type {any} */ let server;
  /** @type {number} */ let port;
  /** @type {any} */ let db;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-11505b-bulk-"));
    db = createDb(path.join(tmp, "db.json"));
    const app = express();
    app.use(express.json());
    app.use("/api", entitiesRouter(db));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", () => r(undefined)); });
    port = server.address().port;
  });
  after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  /** @param {string} pfad @param {string} method @param {any} [body] @returns {Promise<{status: number, json: any}>} */
  const anfrage = (pfad, method, body) => new Promise((resolve, reject) => {
    const daten = body ? JSON.stringify(body) : "";
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${pfad}`, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(daten) } }, (res) => {
      let roh = ""; res.on("data", (c) => { roh += c; }); res.on("end", () => resolve({ status: res.statusCode || 0, json: roh ? JSON.parse(roh) : null }));
    });
    req.on("error", reject); req.end(daten);
  });
  /** @param {string} pid */
  const anzahl = (pid) => db.filter("BuildingComplex", { project_id: pid }).length;

  it("bulk create: a project with a record, or two of one project in the batch → 409, nothing created", async () => {
    const eins = await anfrage("/entities/BuildingComplex", "POST", { project_id: "pB1", name: "Testprojekt A" });
    assert.equal(eins.status, 201);
    const r = await anfrage("/entities/BuildingComplex/bulk", "POST", { records: [{ project_id: "pB2", name: "B" }, { project_id: "pB1", name: "A zwei" }] });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json?.vorhanden, true);
    assert.deepEqual(r.json?.projekte, ["pB1"]);
    assert.equal(r.json?.gespeichert?.id, eins.json.id, "the stored record of the first refused project");
    assert.equal(anzahl("pB1"), 1);
    assert.equal(anzahl("pB2"), 0, "all or nothing");
    const doppelt = await anfrage("/entities/BuildingComplex/bulk", "POST", { records: [{ project_id: "pB3" }, { project_id: "pB3" }] });
    assert.equal(doppelt.status, 409);
    assert.equal(anzahl("pB3"), 0);
    const gut = await anfrage("/entities/BuildingComplex/bulk", "POST", { records: [{ project_id: "pB3" }, { project_id: "pB4" }] });
    assert.equal(gut.status, 201);
    assert.equal(anzahl("pB3") + anzahl("pB4"), 2);
  });

  it("bulk upsert: a create for a project with a record → 409; updates by id or project_id work as before", async () => {
    const vorhanden = db.filter("BuildingComplex", { project_id: "pB1" })[0];
    const r = await anfrage("/entities/BuildingComplex/bulk", "PUT", { records: [{ project_id: "pB1", name: "neu angelegt" }] });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(anzahl("pB1"), 1);
    const perId = await anfrage("/entities/BuildingComplex/bulk", "PUT", { records: [{ id: vorhanden.id, project_id: "pB1", name: "per id" }] });
    assert.equal(perId.status, 200, JSON.stringify(perId.json));
    assert.equal(perId.json.updated, 1);
    const perProjekt = await anfrage("/entities/BuildingComplex/bulk", "PUT", { key: "project_id", records: [{ project_id: "pB1", name: "per Projekt" }, { project_id: "pB5", name: "neu" }] });
    assert.equal(perProjekt.status, 200, JSON.stringify(perProjekt.json));
    assert.equal(db.filter("BuildingComplex", { project_id: "pB1" })[0].name, "per Projekt");
    assert.equal(anzahl("pB1"), 1);
    assert.equal(anzahl("pB5"), 1);
    const andere = await anfrage("/entities/Project/bulk", "POST", { records: [{ name: "P" }, { name: "P" }] });
    assert.equal(andere.status, 201, "other entities: no rule");
  });
});
