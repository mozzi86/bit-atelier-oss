// 19.10.2026: atomic replace survives short Windows locks (EPERM/EBUSY/EACCES) and fails fast otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ersetzeAtomar, schreibeAtomar, WARTEZEITEN_MS } from "../../packages/nova-core/server/atomarErsetzen.js";

const fehler = (code) => Object.assign(new Error(code), { code });

test("Sperre zweimal, dann frei: drei Versuche, kein Fehler", () => {
  let n = 0;
  const pausen = [];
  const versuche = ersetzeAtomar("a.tmp", "a", {
    fsImpl: { renameSync: () => { n += 1; if (n < 3) throw fehler(n === 1 ? "EPERM" : "EBUSY"); } },
    warte: (ms) => pausen.push(ms),
  });
  assert.equal(versuche, 3);
  assert.deepEqual(pausen, WARTEZEITEN_MS.slice(0, 2));
});

test("dauerhaft gesperrt: nach allen Pausen der letzte Fehler; anderer Fehler sofort", () => {
  let n = 0;
  assert.throws(() => ersetzeAtomar("a.tmp", "a", { fsImpl: { renameSync: () => { n += 1; throw fehler("EACCES"); } }, warte: () => {} }), /EACCES/);
  assert.equal(n, WARTEZEITEN_MS.length + 1);
  n = 0;
  assert.throws(() => ersetzeAtomar("a.tmp", "a", { fsImpl: { renameSync: () => { n += 1; throw fehler("ENOENT"); } }, warte: () => {} }), /ENOENT/);
  assert.equal(n, 1);
});

test("schreibeAtomar schreibt die Datei und lässt keine .tmp liegen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomar-"));
  const ziel = path.join(dir, "x.json");
  schreibeAtomar(ziel, JSON.stringify({ a: 1 }), "utf-8");
  assert.deepEqual(JSON.parse(fs.readFileSync(ziel, "utf-8")), { a: 1 });
  assert.equal(fs.existsSync(`${ziel}.tmp`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
