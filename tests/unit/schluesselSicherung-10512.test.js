// 105-12 (register no. 197/178): the personnel key stays OUT of every backup (96-01: never next to the ciphertext),
// but the backup records its fingerprint, the settings show fingerprint and lock reason, and the key's folder can
// be opened (only from the app's own Origin, only while the API is loopback-only) to copy it next to the backup.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { unzipSync, strFromU8 } from "fflate";

import { schluesselFingerabdruck } from "../../packages/nova-core/server/ruheVerschluesselung.js";
import { sicherungAnlegen } from "../../server/sicherung.js";
import { systemRouter } from "../../server/systemRouter.js";

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), "bit-10512-"));

async function mitServer(router, fn) {
  const app = express(); app.use("/api", router);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.close(); }
}

describe("105-12 Personal-Schlüssel und Sicherung", () => {
  it("Fingerabdruck: 16 Hex-Zeichen, stabil, verschieden je Schlüssel, enthält den Schlüssel nicht", () => {
    const a = crypto.randomBytes(32), b = crypto.randomBytes(32);
    assert.match(schluesselFingerabdruck(a), /^[0-9a-f]{16}$/);
    assert.equal(schluesselFingerabdruck(a), schluesselFingerabdruck(a.subarray(0)));
    assert.notEqual(schluesselFingerabdruck(a), schluesselFingerabdruck(b));
    assert.ok(!a.toString("hex").includes(schluesselFingerabdruck(a)));
  });

  it("Sicherung: Fingerabdruck im Kopf, Schlüsseldatei nicht im ZIP", () => {
    const daten = path.join(WURZEL, "daten");
    fs.mkdirSync(daten, { recursive: true });
    fs.writeFileSync(path.join(daten, "db.json"), "{}");
    fs.writeFileSync(path.join(daten, "personal.key"), "nie-in-die-sicherung");
    const e = sicherungAnlegen({ datenOrdner: daten, zielOrdner: path.join(WURZEL, "ziel"), jetzt: new Date("2026-10-22T20:00:00.000Z"),
      kopfZusatz: { personal_schluessel_fingerabdruck: "0123456789abcdef" } });
    const inhalt = unzipSync(new Uint8Array(fs.readFileSync(e.datei)));
    assert.deepEqual(Object.keys(inhalt).sort(), ["db.json", "sicherung.json"]);
    assert.equal(JSON.parse(strFromU8(inhalt["sicherung.json"])).personal_schluessel_fingerabdruck, "0123456789abcdef");
  });

  it("Status und Schlüssel-Ordner: gesperrt mit Grund, Öffnen nur aus der App, nur der Ordner des Schlüssels", async () => {
    const ordner = path.join(WURZEL, "appdata", "BIT-Atelier");
    fs.mkdirSync(ordner, { recursive: true });
    const geoeffnet = [];
    const router = systemRouter({ root: "/app", port: 4711, lokalGebunden: true, datenOrdnerFn: () => WURZEL, oeffnen: async (o) => { geoeffnet.push(o); },
      personalSchluessel: path.join(ordner, "personal.key"),
      personalStatus: () => ({ fingerabdruck: null, gesperrt: true, grund: "Verschlüsselte Personaldaten, aber kein Schlüssel." }) });
    await mitServer(router, async (basis) => {
      const info = await (await fetch(`${basis}/api/system/datenordner`)).json();
      assert.deepEqual(info.personalStatus, { fingerabdruck: null, gesperrt: true, grund: "Verschlüsselte Personaldaten, aber kein Schlüssel." });
      const post = (origin) => fetch(`${basis}/api/system/schluesselordner/oeffnen`, { method: "POST", headers: origin ? { Origin: origin } : {} });
      assert.equal((await post(null)).status, 403, "ohne Origin");
      assert.equal((await post("https://evil.example")).status, 403, "fremde Seite");
      assert.equal((await post("http://localhost:4711")).status, 200);
      assert.deepEqual(geoeffnet, [ordner]);
    });
  });

  it("Schlüssel-Ordner fehlt / kein Schlüssel eingerichtet / Netzfreigabe → Klartext, kein Öffnen", async () => {
    const geoeffnet = [];
    const fehlt = systemRouter({ root: "/app", port: 1, lokalGebunden: true, oeffnen: async (o) => { geoeffnet.push(o); }, personalSchluessel: path.join(WURZEL, "gibt-es-nicht", "personal.key") });
    await mitServer(fehlt, async (basis) => {
      const r = await fetch(`${basis}/api/system/schluesselordner/oeffnen`, { method: "POST", headers: { Origin: "http://127.0.0.1:1" } });
      assert.equal(r.status, 404); assert.match((await r.json()).error, /Ordner des Schlüssels fehlt/);
    });
    const ohne = systemRouter({ root: "/app", port: 1, lokalGebunden: true, oeffnen: async (o) => { geoeffnet.push(o); } });
    await mitServer(ohne, async (basis) => {
      const r = await fetch(`${basis}/api/system/schluesselordner/oeffnen`, { method: "POST", headers: { Origin: "http://127.0.0.1:1" } });
      assert.equal(r.status, 404);
      assert.equal((await (await fetch(`${basis}/api/system/datenordner`)).json()).personalStatus, null);
    });
    const netz = systemRouter({ root: "/app", port: 1, lokalGebunden: false, oeffnen: async (o) => { geoeffnet.push(o); }, personalSchluessel: path.join(WURZEL, "personal.key") });
    await mitServer(netz, async (basis) => {
      assert.equal((await fetch(`${basis}/api/system/schluesselordner/oeffnen`, { method: "POST", headers: { Origin: "http://127.0.0.1:1" } })).status, 403);
    });
    assert.deepEqual(geoeffnet, []);
  });
});
