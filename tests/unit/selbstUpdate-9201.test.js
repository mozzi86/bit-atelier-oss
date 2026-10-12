// Unit tests for plan 92-01 (server/selbstUpdate.js, server/updateRouter.js, tools/update-anwenden.mjs):
// version compare, latest-release parsing, host allow-list, checksum parsing, unzip with traversal guard,
// the lock on developer checkouts, the HTTP flow with a fake GitHub (wrong checksum → rejected, right one →
// unpacked + "neustart"), the Origin check, and the apply script end to end in a temp folder (files swapped,
// daten/ and .env kept, backup written).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import express from "express";
import { zipSync, strToU8 } from "fflate";

import { versionVergleich, neuesteVersion, hostErlaubt, shaAusDatei, entpacken, updateSperre, zuErsetzen } from "../../server/selbstUpdate.js";
import { updateRouter } from "../../server/updateRouter.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bit-upd-"));
const releaseZip = (version, extra = {}) => zipSync({
  "BIT-Atelier/package.json": strToU8(JSON.stringify({ name: "bit-atelier", version })),
  "BIT-Atelier/server/index.js": strToU8("// server " + version),
  "BIT-Atelier/tools/update-anwenden.mjs": fs.readFileSync(path.join(process.cwd(), "tools", "update-anwenden.mjs")),
  "BIT-Atelier/neu.txt": strToU8("neu"),
  ...extra,
});
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Fake fetch: GitHub API + asset downloads. */
function fakeGithub({ version = "1.1.0", zip, shaText, mitSha = true }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/releases/latest")) {
      const assets = [{ name: "BIT-Atelier.zip", size: zip.length, browser_download_url: "https://github.com/x/y/releases/download/v/BIT-Atelier.zip" }];
      if (mitSha) assets.push({ name: "BIT-Atelier.zip.sha256", size: 80, browser_download_url: "https://github.com/x/y/releases/download/v/BIT-Atelier.zip.sha256" });
      return new Response(JSON.stringify({ tag_name: `v${version}`, published_at: "2026-10-11T10:00:00Z", body: "Neu", assets }), { status: 200 });
    }
    if (u.endsWith(".sha256")) return new Response(shaText, { status: 200 });
    if (u.endsWith(".zip")) return new Response(zip, { status: 200, headers: { "content-length": String(zip.length) } });
    return new Response("nope", { status: 404 });
  };
}

async function mitServer(router, fn) {
  const app = express(); app.use("/api", router);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

describe("selbstUpdate helpers", () => {
  it("compares versions", () => {
    assert.ok(versionVergleich("1.1.0", "1.0.9") > 0);
    assert.ok(versionVergleich("v1.0.10", "1.0.9") > 0);
    assert.equal(versionVergleich("1.0", "1.0.0"), 0);
    assert.ok(versionVergleich("1.0.1-beta", "1.0.2") < 0);
  });

  it("parses the latest release and its assets", async () => {
    const zip = releaseZip("1.1.0");
    const n = await neuesteVersion({ fetchFn: fakeGithub({ zip, shaText: "x" }) });
    assert.equal(n.version, "1.1.0");
    assert.equal(n.zip?.groesse, zip.length);
    assert.ok(n.sha?.url.endsWith(".sha256"));
  });

  it("falls back to the releases/latest redirect when the API rate limit is used up", async () => {
    const fetchFn = async (url) => (String(url).includes("api.github.com")
      ? new Response("rate limit", { status: 403 })
      : new Response(null, { status: 302, headers: { location: "https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.2.3" } }));
    const n = await neuesteVersion({ fetchFn });
    assert.equal(n.version, "1.2.3");
    assert.equal(n.zip?.url, "https://github.com/mozzi86/bit-atelier-oss/releases/download/v1.2.3/BIT-Atelier.zip");
    assert.ok(n.sha?.url.endsWith("/v1.2.3/BIT-Atelier.zip.sha256"));
  });

  it("allows only GitHub hosts over https; reads the checksum token", () => {
    assert.equal(hostErlaubt("https://objects.githubusercontent.com/a"), true);
    assert.equal(hostErlaubt("http://github.com/a"), false);
    assert.equal(hostErlaubt("https://evil.example/a"), false);
    assert.equal(shaAusDatei(`${"a".repeat(64)}  BIT-Atelier.zip\n`), "a".repeat(64));
    assert.equal(shaAusDatei("kaputt"), null);
  });

  it("unzips without the top folder and refuses path traversal and incomplete apps", () => {
    const ziel = path.join(tmp(), "neu");
    assert.equal(entpacken(releaseZip("1.1.0"), ziel).dateien, 4);
    assert.ok(fs.existsSync(path.join(ziel, "server", "index.js")));
    assert.throws(() => entpacken(releaseZip("1.1.0", { "BIT-Atelier/../../boese.txt": strToU8("x") }), path.join(tmp(), "n")), /Unsicherer Pfad/);
    assert.throws(() => entpacken(zipSync({ "BIT-Atelier/readme.txt": strToU8("x") }), path.join(tmp(), "n")), /keine vollständige App/);
  });

  it("locks developer checkouts and non-app mode; keeps data entries out of the swap", () => {
    const root = tmp();
    assert.match(updateSperre({ root, appModus: false }), /Entwicklungsmodus/);
    fs.mkdirSync(path.join(root, ".git"));
    assert.match(updateSperre({ root, appModus: true }), /git/);
    assert.deepEqual(zuErsetzen(["daten", "src", ".env", "node_modules", "package.json", ".update"]), ["src", "package.json"]);
  });
});

describe("updateRouter", () => {
  it("reports an available update; a wrong checksum is rejected, the right one unpacks and hands over", async () => {
    const zip = releaseZip("1.1.0");
    const root = tmp();
    fs.mkdirSync(path.join(root, "tools"));
    fs.copyFileSync(path.join(process.cwd(), "tools", "update-anwenden.mjs"), path.join(root, "tools", "update-anwenden.mjs"));
    let beendet = 0;
    const lauf = async (shaText) => mitServer(updateRouter({ root, port: 4711, appModus: true, version: "1.0.1", fetchFn: fakeGithub({ zip, shaText }), beenden: () => { beendet += 1; }, starteAnwenden: false }), async (basis) => {
      const info = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(info.verfuegbar, true);
      assert.equal(info.installierbar, true);
      const fremd = await fetch(`${basis}/api/update/installieren`, { method: "POST", headers: { Origin: "https://evil.example" } });
      assert.equal(fremd.status, 403);
      const r = await fetch(`${basis}/api/update/installieren`, { method: "POST", headers: { Origin: "http://localhost:4711" } });
      assert.equal(r.status, 202);
      let s;
      for (let i = 0; i < 50; i += 1) { s = await (await fetch(`${basis}/api/update/fortschritt`)).json(); if (["fehler", "neustart"].includes(s.phase)) break; await new Promise((x) => setTimeout(x, 20)); }
      return s;
    });
    const falsch = await lauf(`${"0".repeat(64)}  BIT-Atelier.zip`);
    assert.equal(falsch.phase, "fehler");
    assert.match(falsch.fehler, /Prüfsumme stimmt nicht/);
    assert.equal(fs.existsSync(path.join(root, ".update", "neu")), false);
    const richtig = await lauf(`${sha(zip)}  BIT-Atelier.zip`);
    assert.equal(richtig.phase, "neustart");
    assert.ok(fs.existsSync(path.join(root, ".update", "neu", "neu.txt")));
    assert.ok(fs.existsSync(path.join(root, ".update", "update-anwenden.mjs")));
    await new Promise((x) => setTimeout(x, 1700));
    assert.equal(beendet, 1);
  });

  it("a release without checksum is reported but not installable", async () => {
    const zip = releaseZip("1.1.0");
    await mitServer(updateRouter({ root: tmp(), port: 1, appModus: true, version: "1.0.1", fetchFn: fakeGithub({ zip, shaText: "", mitSha: false }), starteAnwenden: false }), async (basis) => {
      const info = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(info.verfuegbar, true);
      assert.equal(info.installierbar, false);
      assert.match(info.sperre, /keine Prüfsumme/);
    });
  });
});

describe("update-anwenden.mjs", () => {
  it("swaps program files, keeps daten/ and .env, writes a backup and a log", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.1" }));
    fs.mkdirSync(path.join(root, "server")); fs.writeFileSync(path.join(root, "server", "index.js"), "// alt");
    fs.writeFileSync(path.join(root, "server", "db.json"), "{\"alt\":true}");
    fs.writeFileSync(path.join(root, "alt.txt"), "alt");
    fs.mkdirSync(path.join(root, "daten")); fs.writeFileSync(path.join(root, "daten", "db.json"), "{\"daten\":1}");
    fs.writeFileSync(path.join(root, ".env"), "X=1");
    // A start script that only proves the restart was triggered.
    entpacken(releaseZip("1.1.0", {
      "BIT-Atelier/start.sh": strToU8("#!/bin/sh\necho gestartet > daten/neustart.txt\n"),
      "BIT-Atelier/start-windows.cmd": strToU8("@echo off\r\necho gestartet> daten\\neustart.txt\r\n"),
    }), path.join(root, ".update", "neu"));
    fs.copyFileSync(path.join(process.cwd(), "tools", "update-anwenden.mjs"), path.join(root, ".update", "update-anwenden.mjs"));
    const r = spawnSync(process.execPath, [path.join(root, ".update", "update-anwenden.mjs"), "--root", root, "--pid", "0"], { encoding: "utf8", timeout: 30000, env: { ...process.env, BIT_UPDATE_KEIN_NEUSTART: "1" } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version, "1.1.0");
    assert.equal(fs.existsSync(path.join(root, "alt.txt")), false);
    assert.equal(fs.readFileSync(path.join(root, "neu.txt"), "utf8"), "neu");
    assert.equal(fs.readFileSync(path.join(root, "daten", "db.json"), "utf8"), "{\"daten\":1}");
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), "X=1");
    assert.equal(fs.readFileSync(path.join(root, "server", "db.json"), "utf8"), "{\"alt\":true}", "data inside server/ restored");
    const sicherung = fs.readdirSync(path.join(root, ".update")).find((n) => n.startsWith("sicherung-"));
    assert.ok(sicherung && fs.existsSync(path.join(root, ".update", sicherung, "alt.txt")));
    assert.match(fs.readFileSync(path.join(root, "daten", "update.log"), "utf8"), /Update fertig[\s\S]*Neustart übersprungen/);
  });
});
