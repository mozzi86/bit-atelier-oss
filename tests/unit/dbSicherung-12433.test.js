// 124-33: the JSON store and its backup file. A backup whose root is a list was loaded as a database (no collections,
// creates reported success and vanished on save), and the first save copied the broken main file over the backup.
// Now: the root must be an object; a broken main file is never copied over the backup (it is kept as db.json.kaputt);
// two unreadable files lock the store instead of starting empty; a missing pair of files is still a first start.
//
// In: nothing. Out: assertions only (throwaway folders in the OS temp folder, removed afterwards).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "../../packages/nova-core/server/db.js";

/** @type {string[]} */ const ordner = [];
/** @returns {string} path of a db.json in a fresh throwaway folder */
const neu = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-12433-")); ordner.push(d); return path.join(d, "db.json"); };
/** @param {any} db flushes pending writes (the store bundles them) */
const sichern = (db) => { if (typeof db.flush === "function") db.flush(); else if (typeof db.persistNow === "function") db.persistNow(); };
afterEach(() => { while (ordner.length) fs.rmSync(/** @type {string} */ (ordner.pop()), { recursive: true, force: true }); });

describe("124-33: backup file of the JSON store", () => {
  it("a backup with a list as root is no database: the store locks, nothing is written", () => {
    const p = neu();
    fs.writeFileSync(p, '{"Project": [');
    fs.writeFileSync(p + ".bak", '[{"id":"x1","name":"Testprojekt A"}]');
    const db = createDb(p);
    assert.match(String(db.gesperrt()), /lesbar/);
    try { db.create("Project", { name: "Testprojekt B" }); } catch { /* a locked store may refuse */ }
    sichern(db);
    assert.equal(fs.readFileSync(p, "utf8"), '{"Project": [', "main file untouched");
    assert.equal(fs.readFileSync(p + ".bak", "utf8"), '[{"id":"x1","name":"Testprojekt A"}]', "backup untouched");
  });

  it("broken main file + good backup: data comes from the backup, the backup survives the next save, the broken file is kept", () => {
    const p = neu();
    const gut = JSON.stringify({ Project: [{ id: "x1", name: "Testprojekt A" }] });
    fs.writeFileSync(p, '{"Project": [');
    fs.writeFileSync(p + ".bak", gut);
    const db = createDb(p);
    assert.equal(db.gesperrt(), null);
    assert.deepEqual(db.list("Project").map((/** @type {any} */ r) => r.name), ["Testprojekt A"]);
    db.create("Project", { name: "Testprojekt B" });
    sichern(db);
    assert.equal(fs.readFileSync(p + ".bak", "utf8"), gut, "the only good copy is not overwritten by the broken file");
    assert.equal(fs.readFileSync(p + ".kaputt", "utf8"), '{"Project": [', "the broken file is kept for a manual look");
    assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")).Project.map((/** @type {any} */ r) => r.name), ["Testprojekt A", "Testprojekt B"]);
    // from the second save on the (now whole) main file is backed up as usual
    db.create("Project", { name: "Testprojekt C" });
    sichern(db);
    assert.deepEqual(JSON.parse(fs.readFileSync(p + ".bak", "utf8")).Project.map((/** @type {any} */ r) => r.name), ["Testprojekt A", "Testprojekt B"]);
  });

  it("a main file whose root is a list falls back to a good backup", () => {
    const p = neu();
    fs.writeFileSync(p, "[1,2,3]");
    fs.writeFileSync(p + ".bak", JSON.stringify({ Project: [{ id: "x1", name: "Testprojekt A" }] }));
    const db = createDb(p);
    assert.equal(db.gesperrt(), null);
    assert.equal(db.list("Project").length, 1);
  });

  it("no files at all is a first start: empty, not locked, the first save creates the database", () => {
    const p = neu();
    const db = createDb(p);
    assert.equal(db.gesperrt(), null);
    db.create("Project", { name: "Testprojekt A" });
    sichern(db);
    assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).Project.length, 1);
  });
});
