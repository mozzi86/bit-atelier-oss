// Unit tests for plan 92-05 (tools/update-anwenden.mjs: data backup, health check, rollback, cleanup) in
// temp folders. No real app is started: BIT_UPDATE_KEIN_NEUSTART=1 keeps processes out; the health check
// either runs against a small HTTP server of this test (BIT_UPDATE_PRUEFEN=1 + --port) or is simulated
// (BIT_UPDATE_TEST_GESUNDHEIT=fehler). The "bad" test server rewrites daten/db.json when asked — the way a
// new version migrates data on its first start — so the rollback must bring the old file back.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import express from "express";
import { zipSync, strToU8 } from "fflate";

import { entpacken } from "../../server/selbstUpdate.js";
import { updateRouter } from "../../server/updateRouter.js";

const SKRIPT = path.join(process.cwd(), "tools", "update-anwenden.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bit-upd5-"));

/** An installed app 1.0.1 with data, plus a prepared update 1.1.0 in .update/neu. */
function installation() {
  const root = tmp();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.1" }));
  fs.mkdirSync(path.join(root, "server")); fs.writeFileSync(path.join(root, "server", "index.js"), "// alt");
  fs.writeFileSync(path.join(root, "alt.txt"), "alt");
  fs.mkdirSync(path.join(root, "daten", "blobs"), { recursive: true });
  fs.writeFileSync(path.join(root, "daten", "db.json"), "{\"format\":1}");
  fs.writeFileSync(path.join(root, "daten", "blobs", "a.bin"), "blob");
  fs.writeFileSync(path.join(root, "daten", "update.log"), "frühere Zeile\n");
  fs.writeFileSync(path.join(root, ".env"), "X=1");
  entpacken(zipSync({
    "BIT-Atelier/package.json": strToU8(JSON.stringify({ version: "1.1.0" })),
    "BIT-Atelier/server/index.js": strToU8("// neu"),
    "BIT-Atelier/neu.txt": strToU8("neu"),
  }), path.join(root, ".update", "neu"));
  fs.copyFileSync(SKRIPT, path.join(root, ".update", "update-anwenden.mjs"));
  return root;
}

/** Run the apply script asynchronously (the test's HTTP server must keep answering meanwhile). */
function anwenden(root, env, port = 0) {
  return new Promise((resolve) => {
    const kind = spawn(process.execPath, [path.join(root, ".update", "update-anwenden.mjs"), "--root", root, "--pid", "0", "--port", String(port)],
      { env: { ...process.env, BIT_UPDATE_KEIN_NEUSTART: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let fehler = "";
    kind.stderr.on("data", (d) => { fehler += d; });
    kind.on("close", (code) => resolve({ code, fehler }));
  });
}

/**
 * A stand-in for the restarted app: answers /api/status with `version`; with `migrieren` the FIRST request
 * rewrites db.json (the new version's first start). Later requests are the old version's check after the
 * rollback and must not touch the data again.
 */
async function statusServer(version, root, migrieren = false) {
  let erster = migrieren;
  const srv = http.createServer((req, res) => {
    if (erster) { erster = false; fs.writeFileSync(path.join(root, "daten", "db.json"), "{\"format\":2}"); }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ name: "bit-atelier", version }));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return srv;
}

const lies = (root, ...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");
const sicherungen = (root) => fs.readdirSync(path.join(root, ".update")).filter((n) => n.startsWith("sicherung-")).sort();

describe("update-anwenden.mjs 92-05", () => {
  it("backs up daten/ (without the update log) before the swap; healthy new version → result ok", async () => {
    const root = installation();
    const srv = await statusServer("1.1.0", root);
    try {
      const r = await anwenden(root, { BIT_UPDATE_PRUEFEN: "1", BIT_UPDATE_WARTEZEIT_MS: "5000" }, /** @type {any} */ (srv.address()).port);
      assert.equal(r.code, 0, r.fehler);
    } finally { srv.close(); }
    assert.equal(JSON.parse(lies(root, "package.json")).version, "1.1.0");
    const [s] = sicherungen(root);
    assert.equal(lies(root, ".update", s, "daten", "db.json"), "{\"format\":1}");
    assert.equal(lies(root, ".update", s, "daten", "blobs", "a.bin"), "blob");
    assert.equal(fs.existsSync(path.join(root, ".update", s, "daten", "update.log")), false, "log not in the backup");
    const ergebnis = JSON.parse(lies(root, "daten", "update-ergebnis.json"));
    assert.equal(ergebnis.ergebnis, "ok");
    assert.equal(ergebnis.nach, "1.1.0");
    assert.match(lies(root, "daten", "update.log"), /frühere Zeile[\s\S]*Daten gesichert \(2 Einträge[\s\S]*Gesundheitsprüfung bestanden: Fassung 1\.1\.0/);
  });

  it("new version answers with the wrong version (and migrated the data) → program AND data rolled back", async () => {
    const root = installation();
    const srv = await statusServer("1.0.1", root, true);
    try {
      const r = await anwenden(root, { BIT_UPDATE_PRUEFEN: "1", BIT_UPDATE_WARTEZEIT_MS: "1500" }, /** @type {any} */ (srv.address()).port);
      assert.equal(r.code, 0, r.fehler);
    } finally { srv.close(); }
    assert.equal(JSON.parse(lies(root, "package.json")).version, "1.0.1", "old program back");
    assert.equal(lies(root, "server", "index.js"), "// alt");
    assert.equal(lies(root, "alt.txt"), "alt");
    assert.equal(fs.existsSync(path.join(root, "neu.txt")), false);
    assert.equal(lies(root, "daten", "db.json"), "{\"format\":1}", "data before the update back");
    assert.equal(lies(root, "daten", "blobs", "a.bin"), "blob");
    assert.equal(lies(root, ".env"), "X=1");
    const log = lies(root, "daten", "update.log");
    assert.match(log, /Gesundheitsprüfung fehlgeschlagen nach 2 s \(antwortet mit Fassung 1\.0\.1 statt 1\.1\.0\)/);
    assert.match(log, /Rücksprung auf 1\.0\.1[\s\S]*Programmdateien der vorigen Fassung zurückgesetzt[\s\S]*Daten aus der Sicherung zurückgeholt/);
    assert.match(log, /frühere Zeile/, "the log survives the data restore");
    const ergebnis = JSON.parse(lies(root, "daten", "update-ergebnis.json"));
    assert.equal(ergebnis.ergebnis, "zurueckgenommen");
    assert.equal(ergebnis.von, "1.0.1");
  });

  it("simulated failing health check (no network) rolls back too", async () => {
    const root = installation();
    const r = await anwenden(root, { BIT_UPDATE_TEST_GESUNDHEIT: "fehler" });
    assert.equal(r.code, 0, r.fehler);
    assert.equal(JSON.parse(lies(root, "package.json")).version, "1.0.1");
    assert.equal(JSON.parse(lies(root, "daten", "update-ergebnis.json")).ergebnis, "zurueckgenommen");
    assert.match(lies(root, "daten", "update.log"), /Gesundheitsprüfung \(Test\): fehlgeschlagen/);
  });

  it("keeps only the newest two backups", async () => {
    const root = installation();
    for (const alt of ["sicherung-2020-01-01T00-00-00-000Z", "sicherung-2021-01-01T00-00-00-000Z", "sicherung-2022-01-01T00-00-00-000Z"]) {
      fs.mkdirSync(path.join(root, ".update", alt, "daten"), { recursive: true });
    }
    const r = await anwenden(root, {});
    assert.equal(r.code, 0, r.fehler);
    const rest = sicherungen(root);
    assert.equal(rest.length, 2);
    assert.equal(rest[0], "sicherung-2022-01-01T00-00-00-000Z");
    assert.ok(rest[1] > rest[0], "the backup of this update stays");
    const log = lies(root, "daten", "update.log");
    assert.match(log, /Alte Sicherung entfernt: sicherung-2020/);
    assert.match(log, /Alte Sicherung entfernt: sicherung-2021/);
  });
});

describe("updateRouter 92-05", () => {
  it("reports the result of the last update (daten/update-ergebnis.json)", async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "daten"));
    fs.writeFileSync(path.join(root, "daten", "update-ergebnis.json"), JSON.stringify({ ergebnis: "zurueckgenommen", von: "1.0.1", nach: "1.1.0", zeit: "2026-10-11T20:00:00Z" }));
    const app = express();
    app.use("/api", updateRouter({ root, port: 1, appModus: true, version: "1.0.1", deaktiviert: true, starteAnwenden: false }));
    const srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    try {
      const info = await (await fetch(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}/api/update`)).json();
      assert.equal(info.letztesUpdate.ergebnis, "zurueckgenommen");
      assert.equal(info.letztesUpdate.nach, "1.1.0");
    } finally { srv.close(); }
  });
});
