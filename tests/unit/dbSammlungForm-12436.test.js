// 124-36: collections of the JSON store that have the wrong shape (only possible through a file edited or damaged outside
// the app). Before: a collection that is an object crashed with "…find is not a function", a `null` entry inside a list
// crashed get/update/delete with "Cannot read properties of null". Now: a non-list collection is refused with a named
// error and left untouched on disk; entries that are no records are skipped by the id lookups; `null` as a collection is
// still treated as "not there yet".
//
// In: nothing. Out: assertions only (throwaway folders in the OS temp folder, removed afterwards).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, SammlungFormFehler } from "../../packages/nova-core/server/db.js";

/** @type {string[]} */ const ordner = [];
/** @param {string} inhalt file content @returns {string} path of a db.json in a fresh throwaway folder */
const mit = (inhalt) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-12436-")); ordner.push(d); const p = path.join(d, "db.json"); fs.writeFileSync(p, inhalt); return p; };
afterEach(() => { while (ordner.length) fs.rmSync(/** @type {string} */ (ordner.pop()), { recursive: true, force: true }); });

describe("124-36: wrongly shaped collections", () => {
  it("a collection that is an object: every access names the problem, the file stays as it is", () => {
    const inhalt = '{"Project": {"x":1}, "Task": []}';
    const p = mit(inhalt);
    const db = createDb(p);
    for (const zugriff of [() => db.list("Project"), () => db.get("Project", "p1"), () => db.filter("Project", { name: "x" }), () => db.create("Project", { name: "Testprojekt B" })]) {
      assert.throws(zugriff, (/** @type {any} */ e) => e instanceof SammlungFormFehler && e.status === 500 && /Project/.test(e.message));
    }
    assert.deepEqual(db.list("Task"), [], "other collections keep working");
    db.flush();
    assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).Project.x, 1, "the odd collection is not replaced by an empty list");
  });

  it("entries that are no records inside a list do not crash the id lookups", () => {
    const p = mit('{"Project": [null, 5, {"id":"p1","name":"Testprojekt A"}]}');
    const db = createDb(p);
    assert.equal(db.get("Project", "p1")?.name, "Testprojekt A");
    assert.equal(db.get("Project", "fehlt"), null);
    assert.equal(db.update("Project", "p1", { name: "Testprojekt A2" })?.name, "Testprojekt A2");
    assert.equal(db.list("Project").length, 3, "nothing is dropped silently");
  });

  it("null as a collection is 'not there yet', as before", () => {
    const db = createDb(mit('{"Project": null}'));
    assert.deepEqual(db.list("Project"), []);
    assert.equal(db.create("Project", { name: "Testprojekt B" }).name, "Testprojekt B");
  });
});
