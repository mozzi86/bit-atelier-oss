// 104-04: local agent control — token, not-run vs. may-have-run, answer through the app bridge, queue limit, LAN refusal.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { steuerungRouter, STEUERUNGS_KOPF } from "../../server/steuerungRouter.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";

const TOKEN = "t".repeat(48);

async function mitServer(optionen, fn) {
  const app = express(); app.use("/api", steuerungRouter({ lokalGebunden: true, token: TOKEN, wartezeit: 400, abholWarten: 300, ...optionen }));
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const senden = (basis, body, token = TOKEN) => fetch(`${basis}/api/steuerung`, { method: "POST", headers: { "Content-Type": "application/json", [STEUERUNGS_KOPF]: token }, body: JSON.stringify(body) });

describe("steuerungRouter", () => {
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
