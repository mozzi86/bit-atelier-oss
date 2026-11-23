// 124-40: an empty main file next to a backup that holds records (a file emptied outside the app). Before: the first
// save — even one triggered by merely reading a list — copied the empty file over the backup; the data was gone.
// Now: the full backup is kept aside as db.json.bak.vor-leer before the usual copy. Normal saves are unchanged.
//
// In: nothing. Out: assertions only (throwaway folders in the OS temp folder, removed afterwards).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "../../packages/nova-core/server/db.js";

/** @type {string[]} */ const ordner = [];
/** @param {string} haupt content of db.json @param {string|null} bak content of db.json.bak @returns {string} path of db.json */
const mit = (haupt, bak) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-12440-")); ordner.push(d);
  const p = path.join(d, "db.json"); fs.writeFileSync(p, haupt); if (bak !== null) fs.writeFileSync(p + ".bak", bak);
  return p;
};
const VOLL = JSON.stringify({ Project: [{ id: "x1", name: "Testprojekt A" }, { id: "x2", name: "Testprojekt B" }] });
afterEach(() => { while (ordner.length) fs.rmSync(/** @type {string} */ (ordner.pop()), { recursive: true, force: true }); });

describe("124-40: empty main file, backup with data", () => {
  for (const leer of ["{}", '{"Project":[]}', '{"Project":[],"Task":[]}']) {
    it(`main file ${leer}: reading a list and saving keeps the full backup aside`, () => {
      const p = mit(leer, VOLL);
      const db = createDb(p);
      assert.deepEqual(db.list("Project"), []);
      db.create("Note", { text: "x" }); // forces a save in every variant (reading alone saves only when the list is new)
      db.flush();
      assert.equal(fs.readFileSync(p + ".bak.vor-leer", "utf8"), VOLL, "the records are still on disk");
      assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).Note.length, 1, "the save itself went through");
    });
  }

  it("a second emptied start does not overwrite the first kept copy", () => {
    const p = mit("{}", VOLL);
    const eins = createDb(p); eins.list("Project"); eins.flush(); // reading a new list alone triggers the save
    const ZWEI = JSON.stringify({ Project: [{ id: "y1", name: "Testprojekt C" }] });
    fs.writeFileSync(p, "{}"); fs.writeFileSync(p + ".bak", ZWEI);
    const zwei = createDb(p); zwei.list("Project"); zwei.flush();
    assert.equal(fs.readFileSync(p + ".bak.vor-leer", "utf8"), VOLL);
    assert.equal(fs.readFileSync(p + ".bak.vor-leer-2", "utf8"), ZWEI);
  });

  it("normal use is unchanged: no extra file when the main file holds records, or when the backup is empty too", () => {
    const p = mit(VOLL, VOLL);
    const db = createDb(p); db.create("Project", { name: "Testprojekt D" }); db.flush();
    const q = mit("{}", "{}");
    const dq = createDb(q); dq.list("Project"); dq.flush();
    const r = mit("{}", null);
    const dr = createDb(r); dr.list("Project"); dr.flush();
    for (const x of [p, q, r]) assert.deepEqual(fs.readdirSync(path.dirname(x)).filter((f) => f.includes("vor-leer")), []);
    assert.equal(JSON.parse(fs.readFileSync(p + ".bak", "utf8")).Project.length, 2, "the backup is the previous save, as before");
  });
});
