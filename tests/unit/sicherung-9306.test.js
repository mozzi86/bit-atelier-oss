// Unit tests for plan 93-06: server/sicherung.js (automatic local backup) and its two routes in
// server/systemRouter.js. Checks: only the data entries land in the zip (never program files, .bak, .tmp),
// the databases are flushed BEFORE reading, retention 7 daily + 4 weekly, the self-updater's copies
// trimmed to the newest two, environment settings, the target folder may not lie inside the data, and the
// POST route only from the app's own Origin. All in throwaway folders under the OS temp directory.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { unzipSync, strFromU8 } from "fflate";

import {
  aufbewahrung, isoWoche, sicherungAnlegen, sicherungenListe, sicherungsDienst, sicherungsEinstellungen,
  sicherungsName, updateKopienAufraeumen, zeitAusName,
} from "../../server/sicherung.js";
import { systemRouter } from "../../server/systemRouter.js";

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), "bit-sicherung-"));
after(() => fs.rmSync(WURZEL, { recursive: true, force: true }));
let zaehler = 0;

/** A data folder shaped like server/ without BIT_DATA_DIR: data entries next to program files. */
function datenOrdnerAnlegen() {
  const ordner = path.join(WURZEL, `daten-${(zaehler += 1)}`);
  fs.mkdirSync(path.join(ordner, "blobs"), { recursive: true });
  fs.writeFileSync(path.join(ordner, "db.json"), '{"Project":[{"id":"p1"}]}');
  fs.writeFileSync(path.join(ordner, "db.json.bak"), '{"alt":true}');
  fs.writeFileSync(path.join(ordner, "db.json.tmp"), "halb");
  fs.writeFileSync(path.join(ordner, "personal.json"), '{"Mitarbeiter":[]}');
  fs.writeFileSync(path.join(ordner, "blobs", "b1.json"), '{"elemente":[1,2,3]}');
  fs.writeFileSync(path.join(ordner, "index.js"), "// program code, never backed up");
  return ordner;
}

async function mitServer(router, fn) {
  const app = express(); app.use("/api", router);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.close(); }
}

describe("sicherung — Name und Zeit", () => {
  it("Name trägt die ISO-Zeit, zurück lesbar; fremde Namen null", () => {
    const zeit = new Date("2026-10-12T19:54:45.123Z");
    assert.equal(sicherungsName(zeit), "bit-atelier-2026-10-12T19-54-45-123Z.zip");
    assert.equal(zeitAusName(sicherungsName(zeit)), "2026-10-12T19:54:45.123Z");
    assert.equal(zeitAusName("notiz.txt"), null);
    assert.equal(zeitAusName("bit-atelier-2026-10-12T19-54-45-123Z.zip.tmp"), null);
  });

  it("isoWoche: Jahreswechsel nach ISO 8601", () => {
    assert.equal(isoWoche("2026-01-01T10:00:00.000Z"), "2026-W01");
    assert.equal(isoWoche("2024-12-30T10:00:00.000Z"), "2025-W01");
    assert.equal(isoWoche("2021-01-03T10:00:00.000Z"), "2020-W53");
    assert.equal(isoWoche("2026-10-12T10:00:00.000Z"), "2026-W42");
  });
});

describe("sicherung — Aufbewahrung", () => {
  it("7 tägliche + 4 wöchentliche: je Tag die jüngste, ältere Wochen je eine", () => {
    // 40 days, two backups each day (06:00 and 18:00), newest 2026-10-12.
    const liste = [];
    for (let i = 0; i < 40; i += 1) {
      const tag = new Date(Date.UTC(2026, 9, 12 - i)).toISOString().slice(0, 10);
      for (const h of ["06", "18"]) liste.push({ name: `${tag}-${h}`, zeit: `${tag}T${h}:00:00.000Z` });
    }
    const { behalten, loeschen } = aufbewahrung(liste, { taeglich: 7, woechentlich: 4 });
    // Daily: 12.10. … 06.10. (18:00 each). Weekly: newest of W42 (12.10.), W41 (11.10.), W40 (04.10.), W39 (27.09.).
    assert.deepEqual(behalten, [
      "2026-10-12-18", "2026-10-11-18", "2026-10-10-18", "2026-10-09-18", "2026-10-08-18", "2026-10-07-18",
      "2026-10-06-18", "2026-10-04-18", "2026-09-27-18",
    ]);
    assert.equal(behalten.length + loeschen.length, 80);
    assert.ok(!loeschen.includes("2026-10-12-18"), "die jüngste bleibt immer");
  });

  it("wenige Sicherungen: nichts wird gelöscht", () => {
    const liste = [{ name: "a", zeit: "2026-10-12T06:00:00.000Z" }, { name: "b", zeit: "2026-10-01T06:00:00.000Z" }];
    assert.deepEqual(aufbewahrung(liste, { taeglich: 7, woechentlich: 4 }).loeschen, []);
  });
});

describe("sicherung — ZIP anlegen", () => {
  it("nur Datendateien (kein Programmcode, kein .bak/.tmp), Prüfsummen im Kopf, geflusht vor dem Lesen", () => {
    const daten = datenOrdnerAnlegen();
    const ziel = path.join(daten, "sicherungen");
    const reihenfolge = [];
    // The flush writes the pending state — the zip must contain it, not the stale file.
    const db = { flush: () => { reihenfolge.push("flush"); fs.writeFileSync(path.join(daten, "db.json"), '{"Project":[{"id":"p1"},{"id":"p2"}]}'); } };
    const e = sicherungAnlegen({ datenOrdner: daten, zielOrdner: ziel, dbs: [db], jetzt: new Date("2026-10-12T08:00:00.000Z"), version: "1.1.0" });
    assert.deepEqual(reihenfolge, ["flush"]);
    assert.equal(e.name, "bit-atelier-2026-10-12T08-00-00-000Z.zip");
    assert.equal(e.dateien, 3);
    assert.ok(fs.existsSync(e.datei));
    assert.ok(!fs.existsSync(`${e.datei}.tmp`));
    const inhalt = unzipSync(new Uint8Array(fs.readFileSync(e.datei)));
    assert.deepEqual(Object.keys(inhalt).sort(), ["blobs/b1.json", "db.json", "personal.json", "sicherung.json"]);
    assert.equal(strFromU8(inhalt["db.json"]), '{"Project":[{"id":"p1"},{"id":"p2"}]}');
    const kopf = JSON.parse(strFromU8(inhalt["sicherung.json"]));
    assert.equal(kopf.version, "1.1.0");
    assert.equal(kopf.zeit, "2026-10-12T08:00:00.000Z");
    const dbEintrag = kopf.dateien.find((d) => d.name === "db.json");
    assert.equal(dbEintrag.sha256, crypto.createHash("sha256").update(inhalt["db.json"]).digest("hex"));
  });

  it("fehlende personal.json/blobs sind kein Fehler", () => {
    const daten = path.join(WURZEL, "nur-db");
    fs.mkdirSync(daten, { recursive: true });
    fs.writeFileSync(path.join(daten, "db.json"), "{}");
    const e = sicherungAnlegen({ datenOrdner: daten, zielOrdner: path.join(daten, "sicherungen"), jetzt: new Date("2026-10-12T08:00:00.000Z") });
    assert.equal(e.dateien, 1);
  });

  it("Zielordner in den Daten (blobs/) wird abgewiesen", () => {
    const daten = datenOrdnerAnlegen();
    assert.throws(() => sicherungAnlegen({ datenOrdner: daten, zielOrdner: path.join(daten, "blobs", "x") }), /Sicherungsordner liegt in den Daten/);
  });
});

describe("sicherung — Update-Kopien", () => {
  it("behält die neuesten zwei .update/sicherung-*, lässt anderes in .update/ stehen", () => {
    const app = path.join(WURZEL, "app");
    const namen = ["sicherung-2026-10-01T10-00-00-000Z", "sicherung-2026-10-05T10-00-00-000Z", "sicherung-2026-10-09T10-00-00-000Z", "sicherung-2026-10-11T10-00-00-000Z"];
    for (const n of [...namen, "neu"]) fs.mkdirSync(path.join(app, ".update", n, "daten"), { recursive: true });
    fs.writeFileSync(path.join(app, ".update", "update-anwenden.mjs"), "//");
    const entfernt = updateKopienAufraeumen(app);
    assert.deepEqual(entfernt.sort(), namen.slice(0, 2));
    assert.deepEqual(fs.readdirSync(path.join(app, ".update")).sort(), ["neu", namen[2], namen[3], "update-anwenden.mjs"].sort());
    assert.deepEqual(updateKopienAufraeumen(path.join(WURZEL, "ohne-update")), []);
  });
});

describe("sicherung — Einstellungen und Dienst", () => {
  it("Umgebung: Vorgaben, relativer Ordner gegen den Datenordner, Unsinn fällt auf die Vorgabe zurück", () => {
    const d = path.join(WURZEL, "x");
    assert.deepEqual(sicherungsEinstellungen(d, {}), { aus: false, stunden: 24, ordner: path.join(d, "sicherungen"), taeglich: 7, woechentlich: 4 });
    const e = sicherungsEinstellungen(d, { BIT_SICHERUNG_AUS: "1", BIT_SICHERUNG_STUNDEN: "6", BIT_SICHERUNG_ORDNER: "../ablage", BIT_SICHERUNG_TAEGLICH: "3", BIT_SICHERUNG_WOECHENTLICH: "0" });
    assert.deepEqual(e, { aus: true, stunden: 6, ordner: path.resolve(d, "../ablage"), taeglich: 3, woechentlich: 0 });
    assert.equal(sicherungsEinstellungen(d, { BIT_SICHERUNG_STUNDEN: "0" }).stunden, 24);
    assert.equal(sicherungsEinstellungen(d, { BIT_SICHERUNG_STUNDEN: "abc" }).stunden, 24);
  });

  it("jetztSichern legt an, räumt nach Aufbewahrung auf, Status zeigt die letzte und die nächste", () => {
    const daten = datenOrdnerAnlegen();
    let uhr = new Date("2026-10-01T08:00:00.000Z");
    const dienst = sicherungsDienst({ datenOrdner: daten, appOrdner: WURZEL, dbs: [], env: { BIT_SICHERUNG_TAEGLICH: "2", BIT_SICHERUNG_WOECHENTLICH: "0" }, jetzt: () => uhr, automatisch: false });
    assert.equal(dienst.status().letzte, null);
    for (const tag of ["01", "02", "03", "04"]) {
      uhr = new Date(`2026-10-${tag}T08:00:00.000Z`);
      dienst.jetztSichern();
    }
    const s = dienst.status();
    assert.equal(s.anzahl, 2, "nur zwei tägliche bleiben");
    assert.equal(s.letzte?.zeit, "2026-10-04T08:00:00.000Z");
    assert.equal(s.naechste, "2026-10-05T08:00:00.000Z");
    assert.equal(s.aktiv, true);
    assert.deepEqual(sicherungenListe(s.ordner).map((e) => e.zeit), ["2026-10-04T08:00:00.000Z", "2026-10-03T08:00:00.000Z"]);
  });

  it("Fehler wird im Status gemeldet, nicht verschluckt", () => {
    const daten = datenOrdnerAnlegen();
    const dienst = sicherungsDienst({ datenOrdner: daten, appOrdner: WURZEL, dbs: [], env: { BIT_SICHERUNG_ORDNER: "blobs" }, automatisch: false });
    assert.throws(() => dienst.jetztSichern(), /Sicherungsordner liegt in den Daten/);
    assert.match(String(dienst.status().letzterFehler), /Sicherungsordner liegt in den Daten/);
  });
});

describe("systemRouter — Sicherungsrouten", () => {
  it("GET Status, POST nur mit App-Origin, ohne Dienst 404, ohne Loopback 403", async () => {
    let aufrufe = 0;
    const sicherung = { status: () => ({ aktiv: true, anzahl: aufrufe }), jetztSichern: () => { aufrufe += 1; return { name: "bit-atelier-x.zip", zeit: "z", bytes: 10, dateien: 3, datei: "/geheim/pfad" }; } };
    await mitServer(systemRouter({ root: "/app", port: 4711, lokalGebunden: true, sicherung }), async (basis) => {
      assert.deepEqual(await (await fetch(`${basis}/api/system/sicherung`)).json(), { aktiv: true, anzahl: 0 });
      const post = (origin) => fetch(`${basis}/api/system/sicherung`, { method: "POST", headers: origin ? { Origin: origin } : {} });
      assert.equal((await post(null)).status, 403);
      assert.equal((await post("https://evil.example")).status, 403);
      const ok = await post("http://localhost:4711");
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true, name: "bit-atelier-x.zip", zeit: "z", bytes: 10, dateien: 3 });
      assert.equal(aufrufe, 1);
    });
    await mitServer(systemRouter({ root: "/app", port: 4711, lokalGebunden: true }), async (basis) => {
      assert.equal((await fetch(`${basis}/api/system/sicherung`)).status, 404);
    });
    await mitServer(systemRouter({ root: "/app", port: 4711, lokalGebunden: false, sicherung }), async (basis) => {
      assert.equal((await fetch(`${basis}/api/system/sicherung`)).status, 403);
    });
  });
});
