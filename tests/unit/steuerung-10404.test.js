// 104-04: local agent control — token, not-run vs. may-have-run, answer through the app bridge, queue limit, LAN refusal.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import { steuerungRouter, jsonAusserSteuerung, STEUERUNGS_KOPF } from "../../server/steuerungRouter.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";

const TOKEN = "t".repeat(48);

/**
 * Same order as server/index.js: the global JSON parser (10 MB, without /api/steuerung*) FIRST, then the control router.
 * A router tested alone would not show that a global parser in front of it makes its limits dead (review of 106-04).
 */
async function mitServer(optionen, fn) {
  const app = express();
  app.use(jsonAusserSteuerung(10 * 1024 * 1024));
  app.post("/api/anderes", (req, res) => res.json({ laenge: JSON.stringify(req.body).length })); // stand-in for every other route
  app.use("/api", steuerungRouter({ lokalGebunden: true, token: TOKEN, wartezeit: 400, abholWarten: 300, ...optionen }));
  app.use((/** @type {any} */ err, /** @type {any} */ _req, /** @type {any} */ res, /** @type {any} */ _next) => res.status(err.status || 500).json({ fehler: err.type || "fehler" })); // quiet like a real error page
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const senden = (basis, body, token = TOKEN) => fetch(`${basis}/api/steuerung`, { method: "POST", headers: { "Content-Type": "application/json", [STEUERUNGS_KOPF]: token }, body: JSON.stringify(body) });

describe("steuerungRouter", () => {
  it("Brücke: ein statischer Host antwortet 200 mit HTML (SPA-Fallback) — sie hört für immer auf, statt alle 3 s zu fragen", async () => {
    let anfragen = 0, pausen = 0;
    const fetchFn = async () => { anfragen += 1; return new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }); };
    const stopp = starteSteuerungsBruecke(befehlsRegister(), { fetchFn: /** @type {any} */ (fetchFn), pause: async () => { pausen += 1; }, aktivSeit: () => 1 });
    try {
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(anfragen, 1);
      assert.equal(pausen, 0, "keine Wiederholung");
    } finally { stopp(); }
  });

  it("ohne/falsches Token 401; ohne App not-run (darf wiederholt werden)", async () => {
    await mitServer({}, async (basis) => {
      assert.equal((await senden(basis, { id: 1, method: "befehle" }, "falsch")).status, 401);
      const r = await senden(basis, { id: 2, method: "befehle" });
      assert.equal(r.status, 504);
      assert.deepEqual(await r.json(), { id: 2, ok: false, status: "not-run", error: "Keine geöffnete Zeichenfläche hat die Anfrage abgeholt — darf wiederholt werden." });
    });
  });

  it("App-Brücke beantwortet über das Befehlsregister", async () => {
    await mitServer({ wartezeit: 2000 }, async (basis) => {
      const reg = befehlsRegister();
      reg.registrieren({ id: "hallo", label: "Hallo", ausfuehren: (p) => `Hallo ${p.name}` });
      const stopp = starteSteuerungsBruecke(reg, { basis });
      try {
        const r = await senden(basis, { id: "a", method: "ausfuehren", params: { befehl: "hallo", params: { name: "Welt" } } });
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { id: "a", ok: true, result: "Hallo Welt" });
      } finally { stopp(); }
    });
  });

  it("mehrere Tabs: der zuletzt benutzte bekommt die Anfrage", async () => {
    await mitServer({ wartezeit: 2000 }, async (basis) => {
      const alt = befehlsRegister(), neu = befehlsRegister();
      alt.registrieren({ id: "wer", label: "Wer", ausfuehren: () => "alt" });
      neu.registrieren({ id: "wer", label: "Wer", ausfuehren: () => "neu" });
      const s1 = starteSteuerungsBruecke(alt, { basis, aktivSeit: () => 1000 });
      const s2 = starteSteuerungsBruecke(neu, { basis, aktivSeit: () => 2000 });
      try {
        await new Promise((r) => setTimeout(r, 100)); // both polls waiting
        const r = await senden(basis, { id: "w", method: "ausfuehren", params: { befehl: "wer" } });
        assert.equal((await r.json()).result, "neu");
      } finally { s1(); s2(); }
    });
  });

  it("abgeholt, aber keine Antwort → may-have-run", async () => {
    await mitServer({}, async (basis) => {
      const anfrage = senden(basis, { id: 3, method: "befehle" });
      await new Promise((r) => setTimeout(r, 50));
      const abgeholt = await fetch(`${basis}/api/steuerung/naechste`);
      assert.equal(abgeholt.status, 200);
      const r = await anfrage;
      assert.equal((await r.json()).status, "may-have-run");
    });
  });

  it("106-04: Grenzen im echten Aufbau (globaler Parser davor) — Antwort der App über 64 KB kommt an, die Anfrage des Agenten bleibt bei 64 KB", async () => {
    // the image gate (106-06) allows this one: the test is about the size limits, not about the project rules
    await mitServer({ wartezeit: 3000, bildPruefen: () => ({ ok: true, text: "" }) }, async (basis) => {
      const reg = befehlsRegister();
      const gross = "A".repeat(600 * 1024); // about a 450 KB PNG as base64
      reg.registrieren({ id: "bild", label: "Bild", ausfuehren: () => ({ png_base64: gross }) });
      const stopp = starteSteuerungsBruecke(reg, { basis });
      try {
        const r = await senden(basis, { id: "b", method: "ausfuehren", params: { befehl: "bild" } });
        assert.equal(r.status, 200, "the answer limit is its own (default 4 MB), not the 64 KB of a request");
        assert.equal((await r.json()).result.png_base64.length, gross.length);
        const zuLang = await senden(basis, { id: "c", method: "ausfuehren", params: { befehl: "bild", params: { text: "x".repeat(70 * 1024) } } });
        assert.equal(zuLang.status, 413, "the request limit of 64 KB really holds (before the fix the global 10 MB parser took the body first)");
        assert.equal((await zuLang.json()).ok, false);
      } finally { stopp(); }
    });
  });

  it("106-04: maxAntwortBytes gilt wirklich — eine zu große Antwort wird abgelehnt, der Agent bekommt eine kleine Fehlerantwort statt 10 s Warten und may-have-run", async () => {
    await mitServer({ wartezeit: 3000, maxAntwortBytes: 1024 }, async (basis) => {
      const reg = befehlsRegister();
      reg.registrieren({ id: "bild", label: "Bild", ausfuehren: () => "B".repeat(5000) });
      const stopp = starteSteuerungsBruecke(reg, { basis });
      try {
        const t0 = Date.now();
        const r = await senden(basis, { id: "d", method: "ausfuehren", params: { befehl: "bild" } });
        const j = await r.json();
        assert.equal(r.status, 200);
        assert.equal(j.id, "d");
        assert.equal(j.ok, false);
        assert.match(j.error, /abgelehnt/);
        assert.match(j.error, /breite/);
        assert.ok(Date.now() - t0 < 2500, "answered at once, not after the wait time");
      } finally { stopp(); }
    });
  });

  it("106-04: der globale Parser gilt für alle anderen Pfade weiter (10 MB), /api/steuerung* nimmt er nicht", async () => {
    await mitServer({}, async (basis) => {
      const post = (pfad, text) => fetch(`${basis}${pfad}`, { method: "POST", headers: { "Content-Type": "application/json", [STEUERUNGS_KOPF]: TOKEN }, body: JSON.stringify({ id: 1, x: text }) });
      assert.equal((await post("/api/anderes", "y".repeat(5 * 1024 * 1024))).status, 200, "5 MB passes on another route");
      assert.equal((await post("/api/anderes", "y".repeat(11 * 1024 * 1024))).status, 413, "11 MB is over the global limit");
      assert.equal((await post("/api/steuerung", "y".repeat(200 * 1024))).status, 413, "the control channel keeps its 64 KB, not the global 10 MB");
    });
  });

  it("106-04: server/index.js hängt den globalen Parser über jsonAusserSteuerung ein (kein zweiter, ungeschützter express.json davor)", () => {
    const quelle = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
    assert.match(quelle, /app\.use\(jsonAusserSteuerung\(/);
    const zeilen = quelle.split("\n").filter((z) => /express\.json\(/.test(z) && !/^\s*\/\//.test(z));
    assert.deepEqual(zeilen, [], "no other global express.json() in the server composition root: " + zeilen.join(" | "));
    assert.ok(quelle.indexOf("jsonAusserSteuerung(") < quelle.indexOf("steuerungRouter({"), "the parser comes before the router, like in this test");
  });

  it("Review-Fix 106-06: jedes Bild der Ansicht läuft durch die Bildprüfung — auch über den allgemeinen Befehl, ohne Prüfung kein Bild", async () => {
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    /** @type {Array<string|null>} */
    const gefragt = [];
    const pruefen = (/** @type {string|null} */ pid) => { gefragt.push(pid); return pid === "frei" ? { ok: true, text: "" } : { ok: false, text: "NDA-Projekt: nie ein Bild" }; };
    await mitServer({ wartezeit: 2000, bildPruefen: pruefen }, async (basis) => {
      let projekt = "geheim";
      const reg = befehlsRegister();
      reg.registrieren({ id: "ansicht-bild", label: "Ansicht als Bild", ausfuehren: () => ({ png_base64: PNG, breite: 1, hoehe: 1, projekt_id: projekt }) });
      reg.registrieren({ id: "text", label: "Text", ausfuehren: () => ({ png_base64_laenge: 3 }) });
      const stopp = starteSteuerungsBruecke(reg, { basis });
      try {
        const nein = await (await senden(basis, { id: "n", method: "ausfuehren", params: { befehl: "ansicht-bild" } })).json();
        assert.equal(nein.ok, false, "refused project: no image");
        assert.equal(JSON.stringify(nein).includes(PNG), false, "the PNG does not reach the agent");
        assert.match(nein.error, /Bild der Ansicht abgelehnt: NDA-Projekt/);
        projekt = "frei";
        const ja = await (await senden(basis, { id: "j", method: "ausfuehren", params: { befehl: "ansicht-bild" } })).json();
        assert.equal(ja.result.png_base64, PNG, "allowed project: the image passes");
        const ohne = await (await senden(basis, { id: "t", method: "ausfuehren", params: { befehl: "text" } })).json();
        assert.deepEqual(ohne.result, { png_base64_laenge: 3 }, "answers without an image are not touched");
        assert.deepEqual(gefragt, ["geheim", "frei"]);
      } finally { stopp(); }
    });
    // without a check (an old composition) no image passes - fail closed
    await mitServer({ wartezeit: 2000 }, async (basis) => {
      const reg = befehlsRegister();
      reg.registrieren({ id: "ansicht-bild", label: "Ansicht als Bild", ausfuehren: () => ({ png_base64: PNG, projekt_id: "frei" }) });
      const stopp = starteSteuerungsBruecke(reg, { basis });
      try {
        const r = await (await senden(basis, { id: "x", method: "ausfuehren", params: { befehl: "ansicht-bild" } })).json();
        assert.equal(r.ok, false);
        assert.match(r.error, /Bildprüfung fehlt/);
      } finally { stopp(); }
    });
    // the composition root wires the check
    assert.match(fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8"), /steuerungRouter\(\{[^)]*bildPruefen/);
  });

  it("Warteschlange begrenzt, LAN-Gerät abgewiesen", async () => {
    await mitServer({ maxWarteschlange: 1 }, async (basis) => {
      const erste = senden(basis, { id: 4, method: "befehle" });
      await new Promise((r) => setTimeout(r, 30));
      const zweite = await senden(basis, { id: 5, method: "befehle" });
      assert.equal(zweite.status, 503);
      assert.equal((await zweite.json()).status, "not-run");
      await erste;
    });
    await mitServer({ anfrageEntfernt: () => true }, async (basis) => {
      assert.equal((await senden(basis, { id: 6, method: "befehle" })).status, 403);
    });
  });
});
