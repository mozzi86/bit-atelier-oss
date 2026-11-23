// dbKennung-1110201.test.js — B-111-02-01: db.create no longer takes over an `id`, `created_date` or `updated_date` a caller
// sends along. The store sets them itself; only the explicit internal path ({kennungUebernehmen: true}, over HTTP the query
// `?kennung=uebernehmen`) keeps a client-chosen id - and only while that id is still free (otherwise 409 / KennungBelegtFehler,
// nothing written). The dates of the explicit path come from the store as well, except for the server-internal restore
// ({zeitUebernehmen: true}, papierkorbRouter.js), which puts back a record as it was.
// Real createDb() stores in a temp folder and real Express routers on an ephemeral port; never server/db.json.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createDb, KennungBelegtFehler } from "../../packages/nova-core/server/db.js";
import { entitiesRouter } from "../../packages/nova-core/server/routes.js";
import { personalRouter } from "../../packages/nova-core/server/personalRouter.js";
import { createBlobStore } from "../../packages/nova-core/server/blobs.js";
import { ausPapierkorb, inPapierkorb } from "../../packages/nova-core/server/papierkorbRouter.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "db-kennung-1110201-"));
let n = 0;
const stores = [];
/** A fresh store in its own temp file. */
const neueDb = () => { const db = createDb(path.join(TMP, `db-${n += 1}.json`)); stores.push(db); return db; };
// the debounced write must land before the temp folder goes
after(() => { stores.forEach((db) => db.flush()); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder */ } });

const ALT = "2001-01-01T00:00:00.000Z";

describe("B-111-02-01 db.create — the store sets id and dates", () => {
  it("ignores a sent id, created_date and updated_date", () => {
    const db = neueDb();
    const a = db.create("Contact", { name: "Kontakt A" });
    const b = db.create("Contact", { id: a.id, created_date: ALT, updated_date: ALT, name: "Kontakt B" });
    assert.notEqual(b.id, a.id, "an occupied id must never be created a second time");
    assert.notEqual(b.created_date, ALT);
    assert.notEqual(b.updated_date, ALT);
    assert.equal(db.list("Contact").filter((r) => r.id === a.id).length, 1);
    assert.equal(db.get("Contact", a.id).name, "Kontakt A");
  });

  it("explicit path: keeps a free id, refuses an occupied one without writing", () => {
    const db = neueDb();
    const r = db.create("Contact", { id: "frei-1", created_date: ALT, name: "x" }, { kennungUebernehmen: true });
    assert.equal(r.id, "frei-1");
    assert.notEqual(r.created_date, ALT, "the explicit id path does not take over dates");
    assert.throws(() => db.create("Contact", { id: "frei-1", name: "y" }, { kennungUebernehmen: true }),
      (e) => e instanceof KennungBelegtFehler && e.status === 409 && /frei-1/.test(e.message));
    assert.equal(db.list("Contact").length, 1);
  });

  it("explicit restore path keeps the stored dates", () => {
    const db = neueDb();
    const r = db.create("Contact", { id: "k-1", created_date: ALT, updated_date: ALT, name: "x" }, { kennungUebernehmen: true, zeitUebernehmen: true });
    assert.deepEqual([r.id, r.created_date, r.updated_date], ["k-1", ALT, ALT]);
  });

  it("bulkCreate: ignores sent ids by default; the explicit path refuses the whole batch on an occupied or repeated id", () => {
    const db = neueDb();
    const a = db.create("Los", { name: "a" });
    const angelegt = db.bulkCreate("Los", [{ id: a.id, name: "b" }, { id: a.id, name: "c" }]);
    assert.equal(new Set(db.list("Los").map((r) => r.id)).size, 3);
    assert.ok(angelegt.every((r) => r.id !== a.id));
    const vorher = db.list("Los").length;
    assert.throws(() => db.bulkCreate("Los", [{ id: "neu-1" }, { id: a.id }], { kennungUebernehmen: true }), KennungBelegtFehler);
    assert.throws(() => db.bulkCreate("Los", [{ id: "neu-2" }, { id: "neu-2" }], { kennungUebernehmen: true }), KennungBelegtFehler);
    assert.equal(db.list("Los").length, vorher, "nothing of a refused batch is written");
    const ok = db.bulkCreate("Los", [{ id: "neu-3", name: "d" }, { name: "e" }], { kennungUebernehmen: true });
    assert.equal(ok[0].id, "neu-3");
    assert.ok(ok[1].id);
  });

  it("bulkUpsert: a new record keeps its id only when id is the key", () => {
    const db = neueDb();
    const a = db.create("Los", { name: "a", nr: "1" });
    const r1 = db.bulkUpsert("Los", [{ id: a.id, nr: "2", created_date: ALT }], "nr");
    assert.notEqual(r1.created[0].id, a.id, "key nr: a sent id must not duplicate an existing one");
    assert.notEqual(r1.created[0].created_date, ALT);
    const r2 = db.bulkUpsert("Los", [{ id: "upsert-1", nr: "3" }], "id");
    assert.equal(r2.created[0].id, "upsert-1");
  });

  it("the restore of the recycle bin still brings the record back with its id and dates", () => {
    const db = neueDb();
    const k = db.create("Contact", { name: "Kontakt Muster" });
    const { eintrag } = /** @type {any} */ (inPapierkorb(db, "Contact", k.id, { herkunft: "mcp" }));
    const r = /** @type {any} */ (ausPapierkorb(db, eintrag.id));
    assert.equal(r.ok, true);
    assert.equal(r.datensatz.id, k.id);
    assert.equal(r.datensatz.created_date, k.created_date);
  });
});

describe("B-111-02-01 HTTP — POST /entities and /personal", () => {
  let server, port, db, pdb;
  before(async () => {
    db = neueDb();
    pdb = neueDb();
    const app = express();
    app.use(express.json());
    app.use("/api", entitiesRouter(db));
    app.use("/api", personalRouter(pdb, createBlobStore(path.join(TMP, "personal-blobs")), { lokalGebunden: true }));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", () => r(undefined)); });
    port = server.address().port;
  });
  after(() => { server?.close(); db.flush(); pdb.flush(); });
  const senden = async (pfad, method, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${pfad}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  it("a plain POST gets a store id and store dates, whatever the body says", async () => {
    const a = await senden("/entities/Contact", "POST", { name: "erst" });
    const b = await senden("/entities/Contact", "POST", { id: a.json.id, created_date: ALT, updated_date: ALT, name: "zweit" });
    assert.equal(b.status, 201);
    assert.notEqual(b.json.id, a.json.id);
    assert.notEqual(b.json.created_date, ALT);
    assert.notEqual(b.json.updated_date, ALT);
  });

  it("?kennung=uebernehmen keeps a free id (dates still from the store), 409 on an occupied one", async () => {
    const r = await senden("/entities/Contact?kennung=uebernehmen", "POST", { id: "wa-1", created_date: ALT, name: "x" });
    assert.equal(r.status, 201);
    assert.equal(r.json.id, "wa-1");
    assert.notEqual(r.json.created_date, ALT);
    const zweit = await senden("/entities/Contact?kennung=uebernehmen", "POST", { id: "wa-1", name: "y" });
    assert.equal(zweit.status, 409);
    assert.match(zweit.json.error, /wa-1/);
    assert.equal(db.get("Contact", "wa-1").name, "x");
  });

  it("bulk: ids ignored by default, kept on the explicit path, 409 for an occupied one with nothing written", async () => {
    const a = await senden("/entities/AvaFilter/bulk", "POST", { records: [{ id: "f-1" }] });
    assert.equal(a.status, 201);
    assert.notEqual(a.json.ids[0], "f-1");
    const b = await senden("/entities/AvaFilter/bulk?kennung=uebernehmen", "POST", { records: [{ id: "f-1" }, { id: "f-2" }] });
    assert.deepEqual(b.json.ids, ["f-1", "f-2"]);
    const vorher = db.list("AvaFilter").length;
    const c = await senden("/entities/AvaFilter/bulk?kennung=uebernehmen", "POST", { records: [{ id: "f-3" }, { id: "f-1" }] });
    assert.equal(c.status, 409);
    assert.equal(db.list("AvaFilter").length, vorher);
  });

  it("personal route: same rule (the deletion run re-creates its tombstone with the same id over the explicit path)", async () => {
    const a = await senden("/personal/Abwesenheit", "POST", { id: "abw-1", art: "urlaub" });
    assert.equal(a.status, 201);
    assert.notEqual(a.json.id, "abw-1");
    const b = await senden("/personal/Abwesenheit?kennung=uebernehmen", "POST", { id: "abw-1", art: "urlaub" });
    assert.equal(b.json.id, "abw-1");
    const c = await senden("/personal/Abwesenheit?kennung=uebernehmen", "POST", { id: "abw-1", art: "urlaub" });
    assert.equal(c.status, 409);
  });
});
