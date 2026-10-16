// Unit tests for plan 93-03 (office mode, lever 158): address classes (server/bueroModus.js), pairing code,
// rate limit, token hashing, expiry and revocation, and the gate + routes of server/bueroRouter.js on a real
// Express app. The source address is injected per request (header x-test-quelle) — nothing binds a LAN
// address here; the LAN listener manager is a stub.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

import {
  adressArt, lanAdressen, createBuero, tokenHash, bereinigeName,
  CODE_GUELTIG_MS, TOKEN_GUELTIG_MS, DROSSEL_MAX_VERSUCHE, CODE_MAX_FEHLVERSUCHE,
} from "../../server/bueroModus.js";
import { bueroWaechter, bueroRouter, geraetDarf, tokenAusAnfrage, gleicherUrsprung, COOKIE_NAME } from "../../server/bueroRouter.js";
import { veralteterStand } from "../../packages/nova-core/server/routes.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "buero-9303-"));

describe("adressArt", () => {
  const faelle = {
    "127.0.0.1": "loopback", "127.8.9.1": "loopback", "::1": "loopback", "::ffff:127.0.0.1": "loopback",
    "10.0.0.7": "privat", "172.16.0.1": "privat", "172.31.255.255": "privat", "192.168.178.20": "privat",
    "::ffff:192.168.1.5": "privat", "169.254.10.1": "privat", "fe80::1%12": "privat", "fd92:da::1": "privat", "fc00::5": "privat",
    "172.15.0.1": "oeffentlich", "172.32.0.1": "oeffentlich", "8.8.8.8": "oeffentlich", "2001:db8::1": "oeffentlich",
    "192.169.0.1": "oeffentlich", "": "oeffentlich", "not-an-ip": "oeffentlich", "999.1.1.1": "oeffentlich",
  };
  for (const [ip, art] of Object.entries(faelle)) {
    it(`${ip || "(leer)"} → ${art}`, () => assert.equal(adressArt(ip), art));
  }
  it("lanAdressen takes only private, non-internal IPv4 (no link-local, no IPv6)", () => {
    const netz = /** @type {any} */ ({
      wlan: [
        { address: "192.168.178.20", family: "IPv4", internal: false },
        { address: "2001:db8::5", family: "IPv6", internal: false },
        { address: "fd92::5", family: "IPv6", internal: false },
      ],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      vpn: [{ address: "100.64.0.1", family: 4, internal: false }, { address: "10.8.0.2", family: 4, internal: false }],
      apipa: [{ address: "169.254.3.4", family: "IPv4", internal: false }],
    });
    assert.deepEqual(lanAdressen(netz), ["10.8.0.2", "192.168.178.20"]);
  });
});

describe("createBuero", () => {
  /** @param {{jetzt?: () => number}} [o] */
  function neu(o = {}) {
    const datei = path.join(tmp(), "buero.json");
    let n = 0;
    const b = createBuero({ datei, zufallsCode: () => String(123456 + n++).slice(0, 6), ...o });
    return { b, datei };
  }

  it("is off by default and creates a code only when on", () => {
    const { b } = neu();
    assert.equal(b.istAktiv(), false);
    assert.throws(() => b.codeErzeugen("Tablet"), /Büro-Modus ist aus/);
    b.setzeAktiv(true);
    assert.throws(() => b.codeErzeugen("   "), /Gerätenamen/);
    const c = b.codeErzeugen("Tablet Baustelle");
    assert.match(c.code, /^\d{6}$/);
    assert.equal(b.offenerCode()?.name, "Tablet Baustelle");
  });

  it("pairs once, stores only the SHA-256 of the token, and the token finds its device", () => {
    const { b, datei } = neu();
    b.setzeAktiv(true);
    const { code } = b.codeErzeugen("Tablet Baustelle");
    const e = b.koppeln(code, "192.168.1.5");
    assert.equal(e.ok, true);
    const token = /** @type {any} */ (e).token;
    assert.ok(token.length >= 40);
    const roh = fs.readFileSync(datei, "utf8");
    assert.ok(!roh.includes(token), "the token itself never lands in buero.json");
    assert.ok(roh.includes(tokenHash(token)));
    assert.equal(b.geraetFuerToken(token)?.name, "Tablet Baustelle");
    assert.equal(b.geraetFuerToken("x".repeat(43)), null);
    // single use
    assert.equal(b.koppeln(code, "192.168.1.5").ok, false);
  });

  it("burns the code after the allowed number of wrong guesses", () => {
    const { b } = neu();
    b.setzeAktiv(true);
    const { code } = b.codeErzeugen("Tablet");
    for (let i = 0; i < CODE_MAX_FEHLVERSUCHE; i += 1) assert.equal(b.koppeln("000000", `10.0.0.${i}`).ok, false);
    assert.equal(b.koppeln(code, "10.0.0.99").ok, false, "the right code no longer works");
    assert.equal(b.offenerCode(), null);
  });

  it("rate-limits pairing per source address (429 with a wait time)", () => {
    const { b } = neu();
    b.setzeAktiv(true);
    for (let i = 0; i < DROSSEL_MAX_VERSUCHE; i += 1) b.koppeln("999999", "192.168.1.7");
    const e = /** @type {any} */ (b.koppeln("999999", "192.168.1.7"));
    assert.equal(e.status, 429);
    assert.ok(e.warteSekunden > 0);
    assert.notEqual(/** @type {any} */ (b.koppeln("999999", "192.168.1.8")).status, 429, "another address is not affected");
  });

  it("lets codes and tokens expire, revokes devices, keeps devices across off/on", () => {
    let uhr = 1_000_000;
    const { b, datei } = neu({ jetzt: () => uhr });
    b.setzeAktiv(true);
    const alt = b.codeErzeugen("Alt");
    uhr += CODE_GUELTIG_MS + 1;
    assert.equal(b.koppeln(alt.code, "10.0.0.1").ok, false, "expired code");
    const { code } = b.codeErzeugen("Laptop Besprechung");
    const token = /** @type {any} */ (b.koppeln(code, "10.0.0.1")).token;
    b.setzeAktiv(false); b.setzeAktiv(true);
    assert.equal(b.geraetFuerToken(token)?.name, "Laptop Besprechung");
    // a second instance reads the same file
    assert.equal(createBuero({ datei, jetzt: () => uhr }).geraetFuerToken(token)?.name, "Laptop Besprechung");
    uhr += TOKEN_GUELTIG_MS + 1;
    assert.equal(b.geraetFuerToken(token), null, "expired token");
    assert.deepEqual(b.geraete(), []);
    uhr -= TOKEN_GUELTIG_MS;
    const { code: c2 } = b.codeErzeugen("Tablet");
    const g = /** @type {any} */ (b.koppeln(c2, "10.0.0.1"));
    assert.equal(b.widerrufen(g.geraet.id), true);
    assert.equal(b.geraetFuerToken(g.token), null);
    assert.equal(b.widerrufen(g.geraet.id), false);
  });

  it("treats a broken state file as off", () => {
    const datei = path.join(tmp(), "buero.json");
    fs.writeFileSync(datei, "{kaputt");
    const fehler = console.error; console.error = () => {};
    try { assert.equal(createBuero({ datei }).istAktiv(), false); } finally { console.error = fehler; }
  });

  it("cleans device names", () => {
    assert.equal(bereinigeName("  Tablet\u0000  Baustelle\n"), "Tablet Baustelle");
    assert.equal(bereinigeName("x".repeat(100)).length, 60);
  });
});

describe("allow-list, token and origin helpers", () => {
  it("lets a device reach project data, never system/update/llm/admin/personal", () => {
    assert.equal(geraetDarf("GET", "/api/entities/Project"), true);
    assert.equal(geraetDarf("PUT", "/api/entities/Project/abc"), true);
    // 96-04: a paired device fetches the session token (read only).
    assert.equal(geraetDarf("GET", "/api/sitzung"), true);
    assert.equal(geraetDarf("POST", "/api/sitzung"), false);
    assert.equal(geraetDarf("POST", "/api/entities/Project/bulk"), true);
    assert.equal(geraetDarf("GET", "/api/catalogs"), true);
    assert.equal(geraetDarf("PUT", "/api/blobs/abc"), true);
    assert.equal(geraetDarf("POST", "/api/integrations/invoke-llm"), true);
    for (const [m, p] of [["GET", "/api/system/datenordner"], ["POST", "/api/update/installieren"], ["GET", "/api/update"],
      ["GET", "/api/llm/connections"], ["POST", "/api/buero/aktivieren"], ["GET", "/api/buero/status"],
      ["GET", "/api/ifc-files"], ["GET", "/api/bauteilfilter"], ["GET", "/api/personal/Mitarbeiter"],
      ["GET", "/API/entities/Project"], ["GET", "/api/entities/a/b/c"], ["DELETE", "/api/catalogs"]]) {
      assert.equal(geraetDarf(m, p), false, `${m} ${p}`);
    }
    assert.equal(geraetDarf("GET", "/api/personal/Mitarbeiter", true), true, "PERSONAL_LAN=1");
  });

  it("reads Bearer before cookie and ignores malformed values", () => {
    const t = "a".repeat(43);
    assert.deepEqual(tokenAusAnfrage({ headers: { authorization: `Bearer ${t}`, cookie: `${COOKIE_NAME}=${"b".repeat(43)}` } }), { token: t, art: "bearer" });
    assert.deepEqual(tokenAusAnfrage({ headers: { cookie: `x=1; ${COOKIE_NAME}=${t}` } }), { token: t, art: "cookie" });
    assert.deepEqual(tokenAusAnfrage({ headers: { cookie: `${COOKIE_NAME}=<script>` } }), { token: null, art: null });
  });

  it("same origin = Origin host equals Host header, http only", () => {
    assert.equal(gleicherUrsprung({ headers: { origin: "http://192.168.1.5:3001", host: "192.168.1.5:3001" } }), true);
    assert.equal(gleicherUrsprung({ headers: { origin: "http://evil.example", host: "192.168.1.5:3001" } }), false);
    assert.equal(gleicherUrsprung({ headers: { host: "192.168.1.5:3001" } }), false);
    assert.equal(gleicherUrsprung({ headers: { origin: "null", host: "192.168.1.5:3001" } }), false);
  });

  it("veralteterStand: only when the body carries an older updated_date", () => {
    assert.equal(veralteterStand({ updated_date: "2026-10-12T10:00:00.000Z" }, { updated_date: "2026-10-12T09:00:00.000Z" }), true);
    assert.equal(veralteterStand({ updated_date: "2026-10-12T10:00:00.000Z" }, { updated_date: "2026-10-12T10:00:00.000Z" }), false);
    assert.equal(veralteterStand({ updated_date: "2026-10-12T10:00:00.000Z" }, { name: "x" }), false);
    assert.equal(veralteterStand({}, { updated_date: "2026-10-12T09:00:00.000Z" }), false);
  });
});

describe("gate + routes on an Express app", () => {
  /** @type {import('node:http').Server} */
  let srv;
  let basis = "";
  let buero;
  let personalLan = false;
  const lanStub = { starten: async () => ({ adressen: ["192.168.1.5"], fehler: [] }), stoppen: async () => {}, adressen: () => ["192.168.1.5"], fehler: () => [] };

  before(async () => {
    buero = createBuero({ datei: path.join(tmp(), "buero.json") });
    const app = express();
    app.use(bueroWaechter(buero, { personalImLan: () => personalLan, adresseVon: (req) => req.headers["x-test-quelle"] || req.socket.remoteAddress }));
    app.use(express.json());
    const port = 4799;
    app.use("/api", bueroRouter(buero, { port, appModus: true, lan: lanStub }));
    app.get("/api/auth/me", (_req, res) => res.json({ full_name: "Lokaler Nutzer" }));
    app.get("/api/entities/:e", (_req, res) => res.json([{ id: "p1" }]));
    app.post("/api/entities/:e", (req, res) => res.status(201).json(req.body));
    app.get("/api/system/datenordner", (_req, res) => res.json({ ordner: "/geheim" }));
    app.get("/api/personal/:e", (_req, res) => res.json([]));
    app.get("/", (_req, res) => res.send("<html>shell</html>"));
    srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    basis = `http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`;
  });
  after(() => srv.close());

  const LAN = "192.168.1.23";
  const hol = (p, { quelle = LAN, ...o } = /** @type {any} */ ({})) => fetch(`${basis}${p}`, { ...o, headers: { "x-test-quelle": quelle, ...(o.headers || {}) } });
  const hostOrigin = "http://localhost:4799";

  it("loopback passes as before; LAN is refused while office mode is off", async () => {
    assert.equal((await hol("/api/entities/Project", { quelle: "127.0.0.1" })).status, 200);
    assert.equal((await hol("/api/system/datenordner", { quelle: "::1" })).status, 200);
    assert.equal((await hol("/api/entities/Project")).status, 403);
    assert.equal((await hol("/")).status, 403);
  });

  it("host actions need loopback AND the app's Origin", async () => {
    const an = (o) => hol("/api/buero/aktivieren", { quelle: "127.0.0.1", method: "POST", headers: { "Content-Type": "application/json", ...(o ? { Origin: o } : {}) }, body: JSON.stringify({ aktiv: true }) });
    assert.equal((await an(null)).status, 403, "no Origin");
    assert.equal((await an("https://evil.example")).status, 403, "foreign page");
    const r = await an(hostOrigin);
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.equal(s.aktiv, true);
    assert.deepEqual(s.urls, ["http://192.168.1.5:4799/"]);
  });

  it("refuses public sources even in office mode", async () => {
    assert.equal((await hol("/", { quelle: "8.8.8.8" })).status, 403);
    assert.equal((await hol("/api/buero/ich", { quelle: "2001:db8::1" })).status, 403);
  });

  it("an unpaired LAN device gets the shell and /buero/ich, nothing else", async () => {
    assert.equal((await hol("/")).status, 200);
    assert.deepEqual(await (await hol("/api/buero/ich")).json(), { lokal: false, aktiv: true, geraet: null });
    const r = await hol("/api/entities/Project");
    assert.equal(r.status, 401);
    assert.equal((await r.json()).koppeln, true);
    for (const p of ["/API/entities/Project", "/Api/entities/Project", "/api/system/datenordner", "/api/buero/status"]) {
      assert.equal((await hol(p)).status, 401, p);
    }
    assert.equal((await hol("/", { method: "POST" })).status, 405);
  });

  /** @type {string} */
  let token = "";
  let cookie = "";

  it("pairs with a code from the host: cookie httpOnly + SameSite=Strict, token on request", async () => {
    const c = await (await hol("/api/buero/code", { quelle: "127.0.0.1", method: "POST", headers: { "Content-Type": "application/json", Origin: hostOrigin }, body: JSON.stringify({ name: "Tablet Baustelle" }) })).json();
    assert.match(c.code, /^\d{6}$/);
    const koppeln = (code, extra = {}) => hol("/api/buero/koppeln", { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify({ code, alsToken: true }) });
    assert.equal((await koppeln(c.code, { Origin: "http://evil.example" })).status, 403, "foreign page may not pair");
    assert.equal((await koppeln(c.code === "000000" ? "111111" : "000000")).status, 401);
    const r = await koppeln(c.code);
    assert.equal(r.status, 200);
    const setCookie = r.headers.get("set-cookie") || "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const j = await r.json();
    assert.equal(j.geraet.name, "Tablet Baustelle");
    token = j.token;
    cookie = `${COOKIE_NAME}=${token}`;
  });

  it("a paired device reads and writes project data, identifies itself, and stays out of host routes", async () => {
    assert.equal((await hol("/api/entities/Project", { headers: { cookie } })).status, 200);
    const ich = await (await hol("/api/buero/ich", { headers: { cookie } })).json();
    assert.equal(ich.geraet.name, "Tablet Baustelle");
    const me = await (await hol("/api/auth/me", { headers: { cookie } })).json();
    assert.equal(me.full_name, "Gerät: Tablet Baustelle");
    assert.equal(me.buero_rolle, "projektleitung");
    for (const p of ["/api/system/datenordner", "/api/buero/status", "/api/buero/geraete", "/api/personal/Mitarbeiter"]) {
      assert.equal((await hol(p, { headers: { cookie } })).status, 403, p);
    }
    personalLan = true;
    assert.equal((await hol("/api/personal/Mitarbeiter", { headers: { cookie } })).status, 200, "PERSONAL_LAN=1 opens HR data");
    personalLan = false;
  });

  it("CSRF: cookie writes need the own Origin; Bearer writes do not", async () => {
    const post = (headers) => hol("/api/entities/Note", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ a: 1 }) });
    assert.equal((await post({ cookie })).status, 403, "cookie without Origin");
    assert.equal((await post({ cookie, Origin: "http://evil.example" })).status, 403, "cookie from a foreign page");
    const eigen = `http://${new URL(basis).host}`;
    assert.equal((await post({ cookie, Origin: eigen })).status, 201, "cookie from the app itself");
    assert.equal((await post({ Authorization: `Bearer ${token}` })).status, 201, "Bearer (script)");
  });

  it("revoking on the host locks the device out at once; logout clears the cookie", async () => {
    const liste = await (await hol("/api/buero/geraete", { quelle: "127.0.0.1" })).json();
    assert.equal(liste.length, 1);
    assert.equal((await hol(`/api/buero/geraete/${liste[0].id}`, { quelle: "127.0.0.1", method: "DELETE" })).status, 403, "no Origin");
    assert.equal((await hol(`/api/buero/geraete/${liste[0].id}`, { quelle: "127.0.0.1", method: "DELETE", headers: { Origin: hostOrigin } })).status, 200);
    assert.equal((await hol("/api/entities/Project", { headers: { cookie } })).status, 401);
    // a fresh pairing, then logout from the device
    const c = await (await hol("/api/buero/code", { quelle: "127.0.0.1", method: "POST", headers: { "Content-Type": "application/json", Origin: hostOrigin }, body: JSON.stringify({ name: "Laptop" }) })).json();
    const t2 = (await (await hol("/api/buero/koppeln", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c.code, alsToken: true }) })).json()).token;
    const ab = await hol("/api/buero/abmelden", { method: "POST", headers: { Authorization: `Bearer ${t2}` } });
    assert.equal(ab.status, 200);
    assert.match(ab.headers.get("set-cookie") || "", /Max-Age=0/);
    assert.equal((await hol("/api/entities/Project", { headers: { Authorization: `Bearer ${t2}` } })).status, 401);
  });

  it("switching office mode off locks LAN devices out again", async () => {
    await hol("/api/buero/aktivieren", { quelle: "127.0.0.1", method: "POST", headers: { "Content-Type": "application/json", Origin: hostOrigin }, body: JSON.stringify({ aktiv: false }) });
    assert.equal((await hol("/api/buero/ich")).status, 403);
    assert.equal((await hol("/api/entities/Project", { quelle: "127.0.0.1" })).status, 200);
  });
});
