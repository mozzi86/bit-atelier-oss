// Unit tests for plan 93-11 (app window mode): tools/app-fenster.mjs (which browser, which arguments — as
// data, nothing is started), tools/app-start.mjs (first start vs. hidden start, hidden command, log rotation,
// "use a running server / refuse a foreign one"), server/programmRouter.js ("Programm beenden": Origin,
// loopback, LAN device, once only — the shutdown is injected, no process exits), and the file rules of
// tools/bit-atelier.ps1, start-windows.cmd and the updater exclusions. No window, no shortcut, no registry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import express from "express";

import { fensterBefehl, browserKandidaten, ERSTE_GROESSE } from "../../tools/app-fenster.mjs";
import { startArt, verstecktBefehl, logOeffnen, serverBereit, LOG_MAX_BYTES } from "../../tools/app-start.mjs";
import { programmRouter } from "../../server/programmRouter.js";

const WURZEL = process.cwd();
const WIN_ENV = { "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\Nutzer\\AppData\\Local" };
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DATEN = "C:\\Users\\Nutzer\\AppData\\Local\\BIT-Atelier\\daten";

describe("app-fenster (93-11)", () => {
  it("Edge first, own profile in the data folder, default size only on the first start", () => {
    assert.equal(browserKandidaten("win32", WIN_ENV)[0], EDGE);
    const erst = fensterBefehl("http://localhost:3001/", { plattform: "win32", env: WIN_ENV, datenOrdner: DATEN, vorhanden: (p) => p === EDGE });
    assert.equal(erst.programm, EDGE);
    assert.equal(erst.art, "fenster");
    assert.deepEqual(erst.args, ["--app=http://localhost:3001/", `--user-data-dir=${path.join(DATEN, "fenster-profil")}`, "--no-first-run", "--no-default-browser-check", `--window-size=${ERSTE_GROESSE}`]);
    const spaeter = fensterBefehl("http://localhost:3001/", { plattform: "win32", env: WIN_ENV, datenOrdner: DATEN, vorhanden: (p) => p === EDGE || p.endsWith("fenster-profil") });
    assert.equal(spaeter.args.some((a) => a.startsWith("--window-size")), false, "Chromium restores the user's size itself");
  });

  it("Chrome when there is no Edge, the default browser when there is neither or BIT_FENSTER=0", () => {
    assert.equal(fensterBefehl("http://localhost:3001/", { plattform: "win32", env: WIN_ENV, datenOrdner: DATEN, vorhanden: (p) => p === CHROME }).programm, CHROME);
    const keiner = fensterBefehl("http://localhost:3001/", { plattform: "win32", env: WIN_ENV, datenOrdner: DATEN, vorhanden: () => false });
    assert.deepEqual([keiner.programm, keiner.art], ["rundll32.exe", "browser"]);
    const aus = fensterBefehl("http://localhost:3001/", { plattform: "win32", env: { ...WIN_ENV, BIT_FENSTER: "0" }, datenOrdner: DATEN, vorhanden: () => true });
    assert.equal(aus.art, "browser");
    assert.equal(fensterBefehl("u", { plattform: "darwin", env: {}, datenOrdner: "/d", vorhanden: (p) => p.includes("Google Chrome") }).programm, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("Linux looks the browser up in PATH", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-9311-pfad-"));
    try {
      fs.writeFileSync(path.join(tmp, "chromium"), "#!/bin/sh\n", { mode: 0o755 });
      const b = fensterBefehl("http://localhost:3001/", { plattform: "linux", env: { PATH: tmp }, datenOrdner: "/home/nutzer/BIT-Atelier/daten", vorhanden: () => false });
      assert.equal(b.programm, path.join(tmp, "chromium"));
      assert.equal(b.args[0], "--app=http://localhost:3001/");
      assert.equal(fensterBefehl("u", { plattform: "linux", env: { PATH: "" }, datenOrdner: "/d" }).programm, "xdg-open");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the command line only opens local URLs", () => {
    const r = spawnSync(process.execPath, ["tools/app-fenster.mjs", "https://evil.example/"], { encoding: "utf8" });
    assert.equal(r.status, 1);
  });
});

describe("app-start (93-11)", () => {
  it("first start (visible) until node_modules and dist exist, then hidden", () => {
    const w = path.resolve("/app");
    assert.equal(startArt(w, () => false), "erststart");
    assert.equal(startArt(w, (p) => p.endsWith("node_modules")), "erststart");
    assert.equal(startArt(w, () => true), "versteckt");
  });

  it("the hidden server: this Node, app mode, the data folder the start scripts use", () => {
    const w = path.resolve("/app");
    const b = verstecktBefehl(w, {});
    assert.equal(b.programm, process.execPath);
    assert.deepEqual(b.args, ["--env-file-if-exists=.env", path.join("server", "index.js"), "--app"]);
    assert.equal(b.datenOrdner, path.join(w, "daten"));
    assert.equal(verstecktBefehl(w, { BIT_DATA_DIR: path.join(w, "x") }).datenOrdner, path.join(w, "x"));
  });

  it("server.log is appended and rotated above 5 MB", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-9311-log-"));
    try {
      fs.writeFileSync(path.join(tmp, "server.log"), Buffer.alloc(LOG_MAX_BYTES + 1, 0x41));
      fs.closeSync(logOeffnen(tmp));
      assert.equal(fs.statSync(path.join(tmp, "server.log.1")).size, LOG_MAX_BYTES + 1);
      assert.match(fs.readFileSync(path.join(tmp, "server.log"), "utf8"), /BIT-Atelier wird gestartet/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses a running BIT-Atelier, refuses a foreign program, never starts with keinStart", async () => {
    const mit = async (name, fn) => {
      const srv = http.createServer((_q, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ name })); });
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      try { await fn(/** @type {any} */ (srv.address()).port); } finally { srv.close(); }
    };
    await mit("bit-atelier", (port) => serverBereit(port, { keinStart: true }));
    await mit("etwas-anderes", (port) => assert.rejects(serverBereit(port, { keinStart: true }), /anderen Programm/));
    const frei = http.createServer();
    await new Promise((r) => frei.listen(0, "127.0.0.1", r));
    const port = /** @type {any} */ (frei.address()).port;
    await new Promise((r) => frei.close(r));
    await assert.rejects(serverBereit(port, { keinStart: true }), /Kein Server/);
  });
});

describe("programmRouter (93-11)", () => {
  it("stops only for the app's own Origin, on loopback, not for a LAN device — and only once", async () => {
    let beendet = 0;
    let fertig;
    const gerufen = new Promise((r) => { fertig = r; });
    const app = express();
    app.use((req, _res, next) => { /** @type {any} */ (req).bitZugang = { lokal: req.headers["x-lan"] !== "1" }; next(); });
    app.use("/api", programmRouter({ lokalGebunden: true, port: 4711, anfrageEntfernt: (req) => req.bitZugang?.lokal === false, verzoegerung: 10, beenden: () => { beendet += 1; fertig(); } }));
    const srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    try {
      const url = `http://127.0.0.1:${/** @type {any} */ (srv.address()).port}/api/programm/beenden`;
      const post = (kopf) => fetch(url, { method: "POST", headers: kopf });
      assert.equal((await post({})).status, 403, "no Origin");
      assert.equal((await post({ Origin: "https://evil.example" })).status, 403, "foreign page");
      assert.equal((await post({ Origin: "http://localhost:4711", "x-lan": "1" })).status, 403, "paired LAN device");
      assert.equal(beendet, 0);
      assert.equal((await post({ Origin: "http://localhost:4711" })).status, 200);
      assert.equal((await post({ Origin: "http://127.0.0.1:4711" })).status, 200);
      await gerufen;
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(beendet, 1, "shut down once");
    } finally {
      srv.close();
    }
    const app2 = express();
    app2.use("/api", programmRouter({ lokalGebunden: false, port: 1, beenden: () => { beendet += 1; } }));
    const s2 = app2.listen(0, "127.0.0.1");
    await new Promise((r) => s2.once("listening", r));
    try {
      const r = await fetch(`http://127.0.0.1:${/** @type {any} */ (s2.address()).port}/api/programm/beenden`, { method: "POST", headers: { Origin: "http://localhost:1" } });
      assert.equal(r.status, 403, "not on loopback");
    } finally {
      s2.close();
    }
  });
});

describe("start files (93-11)", () => {
  it("bit-atelier.ps1: ASCII, CRLF, parses, message box on every failure, -Datei for .bitproj", (t) => {
    const roh = fs.readFileSync(path.join(WURZEL, "tools", "bit-atelier.ps1"));
    assert.ok(roh.every((b) => b < 0x80 && (b >= 0x20 || b === 0x0d || b === 0x0a)), "pure printable ASCII");
    const text = roh.toString("ascii");
    assert.equal(/(^|[^\r])\n/.test(text), false, "CRLF only");
    assert.match(text, /param\(\[string\]\$Datei = ''\)/);
    assert.match(text, /tools\\datei-oeffnen\.mjs[\s\S]*tools\\app-start\.mjs/);
    assert.equal((text.match(/Meldung /g) || []).length >= 3, true, "node missing, node too old, start failed");
    if (process.platform !== "win32") { t.skip("PowerShell parse runs on Windows"); return; }
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:BIT_PS1,[ref]$null,[ref]$e); exit $e.Count"], { encoding: "utf8", windowsHide: true, env: { ...process.env, BIT_PS1: path.join(WURZEL, "tools", "bit-atelier.ps1") } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("the start scripts open the app window; the updater keeps the profile and logs out of its backup", () => {
    const cmd = fs.readFileSync(path.join(WURZEL, "start-windows.cmd"), "ascii");
    assert.match(cmd, /:browser\r\n[\s\S]*node tools\\app-fenster\.mjs http:\/\/localhost:%API_PORT%\/\r\nif errorlevel 1 start "" http:\/\/localhost:%API_PORT%/);
    assert.ok([...cmd].every((c) => c.charCodeAt(0) >= 0x20 || c === "\r" || c === "\n"), "no control characters");
    assert.match(fs.readFileSync(path.join(WURZEL, "start.sh"), "ascii"), /node tools\/app-fenster\.mjs "\$URL"/);
    const upd = fs.readFileSync(path.join(WURZEL, "tools", "update-anwenden.mjs"), "utf8");
    assert.match(upd, /NICHT_SICHERN = new Set\(\[[^\]]*'server\.log'[^\]]*'fenster-profil'\]\)/);
    assert.match(upd, /windowsHide: true, stdio: \['ignore', out, out\]/, "hidden restart on Windows");
  });
});
