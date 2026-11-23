// Review 115-05b part 2 (finding 2): the strict write of the local server (routes.js standVeraltet) refuses on INEQUALITY of the
// sent stand and the stored updated_date, not only when the stored record is newer. A file import ("ersetzen", dateiOeffnenRouter
// db._reset) keeps the OLDER updated_date of the file; before, a stale tab whose base was a newer state got a 200 and wrote its
// whole element lists over the import (D-115-50). Demo and cloud already compare on inequality since part 2. The delete into the
// recycle bin (papierkorbRouter inPapierkorb) uses the same rule.
//   - unit: standVeraltet newer / equal / older / missing / unreadable
//   - real Express (reviewer repro express-aelter.mjs as a test): record with an older updated_date, PUT ?stand=<newer> → 409 with
//     the stored record, nothing written; PUT ?stand=<equal> → 200
//   - inPapierkorb with a stand other than the stored one → 409, the record stays
//
// In: nothing. Out: assertions only.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter, standVeraltet } from "../../packages/nova-core/server/routes.js";
import { inPapierkorb } from "../../packages/nova-core/server/papierkorbRouter.js";

const T_ALT = "2026-11-18T08:00:00.000Z";
const T_NEU = "2026-11-19T10:00:00.000Z";

test("standVeraltet: a sent stand other than the stored one (newer OR older) is outdated; equal or none is not", () => {
  const rec = { updated_date: T_ALT };
  assert.equal(standVeraltet(rec, T_NEU), true, "the stored record is OLDER than the base (import put an older state back)");
  assert.equal(standVeraltet(rec, "2026-11-17T00:00:00.000Z"), true, "the stored record is newer");
  assert.equal(standVeraltet(rec, T_ALT), false);
  assert.equal(standVeraltet(rec, undefined), false, "without a stand the old behaviour (last write wins)");
  assert.equal(standVeraltet(rec, "gestern"), false);
  assert.equal(standVeraltet({}, T_NEU), false, "a record without updated_date says nothing");
});

describe("real Express: strict PUT after a file import with an older updated_date", () => {
  /** @type {any} */ let db;
  /** @type {import("node:http").Server} */ let srv;
  let base = "";
  let tmp = "";
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-11505b-ungleich-"));
    db = createDb(path.join(tmp, "db.json"));
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use("/api", entitiesRouter(db));
    srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    base = `http://127.0.0.1:${/** @type {any} */ (srv.address()).port}/api/entities`;
  });
  after(() => {
    srv.closeAllConnections?.();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("a stale tab whose base is NEWER than the imported state is refused (409), the import stays", async () => {
    // state after "ersetzen": same id, OLDER updated_date, the imported walls
    db._reset({ BimModel: [{ id: "bmX", project_id: "pX", created_date: T_ALT, updated_date: T_ALT, customWalls: [{ _idx: 50, quelle: "import" }] }] });
    const r = await fetch(`${base}/BimModel/bmX?stand=${encodeURIComponent(T_NEU)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customWalls: [{ _idx: 1, quelle: "alter Tab" }] }),
    });
    assert.equal(r.status, 409);
    const j = await r.json();
    assert.equal(j.konflikt, true);
    assert.equal(j.gespeichert?.updated_date, T_ALT, "the 409 carries the stored record");
    assert.deepEqual(db.get("BimModel", "bmX").customWalls, [{ _idx: 50, quelle: "import" }], "nothing of the stale tab was written");
    // on the stored stand the write goes through
    const ok = await fetch(`${base}/BimModel/bmX?stand=${encodeURIComponent(T_ALT)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dachform: "flach" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(db.get("BimModel", "bmX").dachform, "flach");
  });

  test("recycle bin: a delete prepared on another stand (newer or older) is refused, the record stays", () => {
    db._reset({ Contact: [{ id: "c1", name: "Testkontakt", updated_date: T_ALT }] });
    const r = inPapierkorb(db, "Contact", "c1", { herkunft: "app", person: true, stand: T_NEU });
    assert.equal(r.ok, false);
    assert.equal(/** @type {any} */ (r).status, 409);
    assert.ok(db.get("Contact", "c1"), "the record stays");
    const ok = inPapierkorb(db, "Contact", "c1", { herkunft: "app", person: true, stand: T_ALT });
    assert.equal(ok.ok, true);
  });
});
