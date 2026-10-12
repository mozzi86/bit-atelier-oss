// Unit tests for plan 92-07: server/systemRouter.js (data folder, "open folder" with Origin check, MCP facts;
// everything refused when the API is not loopback-only) and src/lib/kiAnbindung.js (Claude Code command and
// Claude Desktop JSON with real paths: blanks quoted, Windows backslashes escaped by JSON, --schreiben,
// BIT_API_URL only on a non-default port). The folder opener is injected — no Explorer window opens.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";

import { systemRouter } from "../../server/systemRouter.js";
import { claudeCodeBefehl, claudeDesktopJson } from "@/lib/kiAnbindung";

async function mitServer(router, fn) {
  const app = express(); app.use("/api", router);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.close(); }
}

const ORDNER = path.join(path.sep === "\\" ? "C:\\" : "/", "app", "daten");

describe("systemRouter", () => {
  it("names the data folder and opens only that folder, only from the app's own Origin", async () => {
    const geoeffnet = [];
    const router = systemRouter({
      root: "/app", port: 4711, lokalGebunden: true, origins: ["http://localhost:5173"],
      datenOrdnerFn: () => ORDNER, oeffnen: async (o) => { geoeffnet.push(o); }, execPath: "/usr/bin/node",
    });
    await mitServer(router, async (basis) => {
      const info = await (await fetch(`${basis}/api/system/datenordner`)).json();
      assert.equal(info.ordner, ORDNER);
      assert.equal(info.dateien.db, path.join(ORDNER, "db.json"));
      const post = (origin) => fetch(`${basis}/api/system/datenordner/oeffnen`, { method: "POST", headers: origin ? { Origin: origin } : {} });
      assert.equal((await post(null)).status, 403, "no Origin");
      assert.equal((await post("https://evil.example")).status, 403, "foreign page");
      assert.equal((await post("http://localhost:4711")).status, 200);
      assert.equal((await post("http://localhost:5173")).status, 200, "dev server origin passed in");
      assert.deepEqual(geoeffnet, [ORDNER, ORDNER]);
    });
  });

  it("reports an opener failure as 500 with the reason", async () => {
    const router = systemRouter({ root: "/app", port: 1, lokalGebunden: true, datenOrdnerFn: () => ORDNER, oeffnen: async () => { throw new Error("xdg-open konnte nicht gestartet werden: ENOENT"); } });
    await mitServer(router, async (basis) => {
      const r = await fetch(`${basis}/api/system/datenordner/oeffnen`, { method: "POST", headers: { Origin: "http://127.0.0.1:1" } });
      assert.equal(r.status, 500);
      assert.match((await r.json()).error, /xdg-open/);
    });
  });

  it("returns the MCP facts: this Node binary, the absolute script path, the API URL", async () => {
    const root = process.cwd();
    await mitServer(systemRouter({ root, port: 3002, lokalGebunden: true, execPath: "/opt/node/bin/node" }), async (basis) => {
      const k = await (await fetch(`${basis}/api/system/ki-anbindung`)).json();
      assert.equal(k.node, "/opt/node/bin/node");
      assert.equal(k.mcpServer, path.join(root, "tools", "mcp-server.mjs"));
      assert.equal(k.vorhanden, true);
      assert.equal(k.apiUrl, "http://127.0.0.1:3002/api");
      assert.equal(k.standardPort, false);
    });
  });

  it("refuses every route when the API is reachable from the network (API_HOST)", async () => {
    let geoeffnet = 0;
    await mitServer(systemRouter({ root: "/app", port: 3001, lokalGebunden: false, datenOrdnerFn: () => ORDNER, oeffnen: async () => { geoeffnet += 1; } }), async (basis) => {
      assert.equal((await fetch(`${basis}/api/system/datenordner`)).status, 403);
      assert.equal((await fetch(`${basis}/api/system/ki-anbindung`)).status, 403);
      assert.equal((await fetch(`${basis}/api/system/datenordner/oeffnen`, { method: "POST", headers: { Origin: "http://localhost:3001" } })).status, 403);
    });
    assert.equal(geoeffnet, 0);
  });
});

describe("kiAnbindung", () => {
  const WIN = { node: "C:\\Program Files\\nodejs\\node.exe", mcpServer: "C:\\Users\\nutzer\\AppData\\Local\\BIT-Atelier\\tools\\mcp-server.mjs", apiUrl: "http://127.0.0.1:3001/api", standardPort: true };

  it("Claude Code: quoted paths, -- before the command, --schreiben on request", () => {
    assert.equal(claudeCodeBefehl(WIN), 'claude mcp add bit-atelier -- "C:\\Program Files\\nodejs\\node.exe" C:\\Users\\nutzer\\AppData\\Local\\BIT-Atelier\\tools\\mcp-server.mjs');
    assert.match(claudeCodeBefehl(WIN, true), / --schreiben$/);
    const anderer = claudeCodeBefehl({ node: "/usr/bin/node", mcpServer: "/home/nutzer/BIT-Atelier/tools/mcp-server.mjs", apiUrl: "http://127.0.0.1:3002/api", standardPort: false });
    assert.equal(anderer, "claude mcp add bit-atelier -e BIT_API_URL=http://127.0.0.1:3002/api -- /usr/bin/node /home/nutzer/BIT-Atelier/tools/mcp-server.mjs");
  });

  it("Claude Desktop: valid JSON with the real paths, env only on a non-default port", () => {
    const text = claudeDesktopJson(WIN, true);
    assert.match(text, /"C:\\\\Program Files\\\\nodejs\\\\node\.exe"/, "backslashes doubled by JSON");
    const j = JSON.parse(text);
    assert.deepEqual(j.mcpServers["bit-atelier"], { command: WIN.node, args: [WIN.mcpServer, "--schreiben"] });
    const port = JSON.parse(claudeDesktopJson({ ...WIN, apiUrl: "http://127.0.0.1:3002/api", standardPort: false }));
    assert.deepEqual(port.mcpServers["bit-atelier"].env, { BIT_API_URL: "http://127.0.0.1:3002/api" });
  });
});
