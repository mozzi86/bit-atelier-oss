// 96-04: session header for the local API — server middleware and client fetch wrapper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sitzungsSchutz, sitzungsToken, vomBrowser } from "../../server/sitzungsSchutz.js";
import { installiereSitzungsKopf } from "../../src/lib/sitzungsKopf.js";

/** Runs the middleware on a fake request; returns {weiter, status, kopf}. */
function lauf(mw, { method = "POST", path = "/entities/Project", headers = {} } = {}) {
  const out = { weiter: false, status: 200, kopf: {} };
  const res = {
    set(k, v) { out.kopf[k] = v; return res; },
    status(s) { out.status = s; return res; },
    json() { return res; },
  };
  mw({ method, path, headers }, res, () => { out.weiter = true; });
  return out;
}

test("Token ist zufällig und lang genug", () => {
  const a = sitzungsToken();
  assert.ok(a.length >= 32);
  assert.notEqual(a, sitzungsToken());
});

test("Browser-Schreibzugriff braucht das Token; Lesen, Kopplung und Werkzeuge ohne Browser nicht", () => {
  const mw = sitzungsSchutz({ token: "geheim-123" });
  const browser = { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" };
  assert.equal(lauf(mw, { headers: browser }).status, 401);
  assert.equal(lauf(mw, { headers: browser }).kopf["X-Bit-Sitzung-Erneuern"], "1");
  assert.equal(lauf(mw, { headers: { ...browser, "x-bit-session": "falsch" } }).status, 401);
  assert.ok(lauf(mw, { headers: { ...browser, "x-bit-session": "geheim-123" } }).weiter);
  // A foreign page's form POST: Origin of another site, no header → refused.
  assert.equal(lauf(mw, { headers: { origin: "https://boese.example", "sec-fetch-site": "cross-site" } }).status, 401);
  assert.ok(lauf(mw, { method: "GET", headers: browser }).weiter);
  assert.ok(lauf(mw, { path: "/buero/koppeln", headers: browser }).weiter);
  // Node tools (MCP server, harness, tests' API context): no Origin, no Fetch Metadata.
  assert.ok(lauf(mw, { headers: { "content-type": "application/json" } }).weiter);
  assert.equal(vomBrowser({ headers: { "sec-fetch-mode": "cors" } }), true);
});

/** Fake window: fetch answers /api/sitzung with the current token, writes check it. */
function fakeFenster() {
  const zustand = { token: "t1", aufrufe: [] };
  const fenster = {
    location: { href: "http://localhost:5173/Projects" },
    fetch: async (url, init = {}) => {
      const u = String(url);
      const kopf = new globalThis.Headers(init.headers);
      zustand.aufrufe.push({ u, methode: init.method || "GET", session: kopf.get("X-Bit-Session") });
      if (u.endsWith("/api/sitzung")) return new Response(JSON.stringify({ token: zustand.token }), { status: 200 });
      if ((init.method || "GET") !== "GET" && kopf.get("X-Bit-Session") !== zustand.token) {
        return new Response("{}", { status: 401, headers: { "X-Bit-Sitzung-Erneuern": "1" } });
      }
      return new Response("{}", { status: 200 });
    },
  };
  return { fenster, zustand };
}

test("Client: Schreibzugriffe bekommen den Kopf, Lesen und fremde Adressen nicht; neues Token nach Neustart", async () => {
  const { fenster, zustand } = fakeFenster();
  installiereSitzungsKopf({ fenster });
  installiereSitzungsKopf({ fenster }); // idempotent

  assert.equal((await fenster.fetch("/api/entities/Project", { method: "POST", body: "{}" })).status, 200);
  const post = zustand.aufrufe.find((a) => a.u.endsWith("/api/entities/Project"));
  assert.equal(post.session, "t1");

  await fenster.fetch("/api/entities/Project");
  assert.equal(zustand.aufrufe.filter((a) => a.u.endsWith("/api/entities/Project") && a.methode === "GET")[0].session, null);
  await fenster.fetch("https://tile.example/x.png", { method: "POST" });
  assert.equal(zustand.aufrufe.at(-1).session, null);

  // Server restarted → new token; the wrapper renews once and repeats.
  zustand.token = "t2";
  const r = await fenster.fetch("/api/entities/Project/1", { method: "PUT", body: "{}" });
  assert.equal(r.status, 200);
  assert.equal(zustand.aufrufe.at(-1).session, "t2");
});
