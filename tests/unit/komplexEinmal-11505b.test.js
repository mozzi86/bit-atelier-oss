// 115-05b (E-3): one design record (BuildingComplex) per project. Two tabs of a project without one both created one before
// (two records, the next load picked one by chance). Now:
//   - server: a second POST for a project that already has a record answers 409 with the stored record (the newest one when old
//     data already holds duplicates) - the same answer as an outdated PUT, so the client's three-way merge takes it over; nothing
//     is created, nothing deleted; other entities unchanged (the bulk paths: bulkEinmal-11505b.test.js, part 2)
//   - client: komplexDatensatzWaehlen picks the newest of several records and says how many there are (reported, never deleted)
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
import * as komplexAbgleich from "@core/lib/abgleich/komplexAbgleich.js";

describe("E-3: one BuildingComplex per project (server)", () => {
  /** @type {string} */ let tmp;
  /** @type {any} */ let server;
  /** @type {number} */ let port;
  /** @type {any} */ let db;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-11505b-"));
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

  it("the second create of the same project answers 409 with the stored record and creates nothing", async () => {
    const eins = await anfrage("/entities/BuildingComplex", "POST", { project_id: "pK1", name: "Erster Tab" });
    assert.equal(eins.status, 201);
    const zwei = await anfrage("/entities/BuildingComplex", "POST", { project_id: "pK1", name: "Zweiter Tab" });
    assert.equal(zwei.status, 409, JSON.stringify(zwei.json));
    assert.equal(zwei.json?.gespeichert?.id, eins.json.id, "the answer carries the stored record");
    assert.equal(zwei.json?.vorhanden, true);
    assert.deepEqual(db.filter("BuildingComplex", { project_id: "pK1" }).map((/** @type {any} */ r) => r.name), ["Erster Tab"]);
  });

  it("existing duplicates: the newest record is answered, none is deleted; other projects and entities create as before", async () => {
    db.create("BuildingComplex", { id: "alt", project_id: "pK2", name: "alt", updated_date: "2026-01-01T00:00:00.000Z" }, { kennungUebernehmen: true, zeitUebernehmen: true });
    db.create("BuildingComplex", { id: "neu", project_id: "pK2", name: "neu" }, { kennungUebernehmen: true });
    const r = await anfrage("/entities/BuildingComplex", "POST", { project_id: "pK2", name: "dritter" });
    assert.equal(r.status, 409);
    assert.equal(r.json.gespeichert.id, "neu");
    assert.equal(db.filter("BuildingComplex", { project_id: "pK2" }).length, 2, "nothing deleted, nothing added");
    assert.equal((await anfrage("/entities/BuildingComplex", "POST", { project_id: "pK3" })).status, 201);
    assert.equal((await anfrage("/entities/Project", "POST", { name: "P" })).status, 201);
    assert.equal((await anfrage("/entities/Project", "POST", { name: "P" })).status, 201, "other entities: no rule");
  });
});

describe("E-3: komplexDatensatzWaehlen (client)", () => {
  it("picks the newest record and counts the rest; one or none as before", () => {
    const w = komplexAbgleich.komplexDatensatzWaehlen;
    assert.equal(typeof w, "function");
    assert.deepEqual(w([]), { datensatz: null, anzahl: 0 });
    assert.deepEqual(w(null), { datensatz: null, anzahl: 0 });
    const a = { id: "a", updated_date: "2026-11-19T10:00:00.000Z" };
    const b = { id: "b", updated_date: "2026-11-19T11:00:00.000Z" };
    assert.deepEqual(w([a]), { datensatz: a, anzahl: 1 });
    assert.deepEqual(w([a, b]), { datensatz: b, anzahl: 2 });
    assert.deepEqual(w([b, a]), { datensatz: b, anzahl: 2 });
  });
});
