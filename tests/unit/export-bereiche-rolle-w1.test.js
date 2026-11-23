// Wave 1 "buero", W1-BUERO-F1: every .bitproj export of a non-owner role leaves out the office areas
// that role may not export completely — not only the export DIALOG (82-02 exportBereicheFuer), but
// also "vorher sichern" (exportProjekt() without options), and the installed edition's server export
// and save-back. Before the access is loaded, every export is refused (deny until loaded).
//
// Roles are built with the real baueZugriff (rechte.js): owner, an employee assigned to p1 (hides
// accounting, times, deadlines, correspondence, rights), the accounting role (all projects, hides
// only the rights area).
//
// In:  @core/api/projektDatei.js, @core/api/exportSicht.js, src/lib/exportSichtBereiche.js,
//      server/dateiOeffnenRouter.js. Out: assertions only.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Buffer } from "node:buffer";
import * as projektDatei from "@core/api/projektDatei.js";
import * as exportSicht from "@core/api/exportSicht.js";
import { setzeSpeicher } from "@core/api/demoDb.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { dateiOeffnenRouter, bytesEinlesen, QUELLE_DATEI } from "../../server/dateiOeffnenRouter.js";

/** Neutral workspace: two projects, project rows, accounting/time/rights rows, settings, documents. */
function seed() {
  return {
    Project: [{ id: "p1", name: "Projekt A" }, { id: "p2", name: "Projekt B" }],
    Room: [{ id: "r1", project_id: "p1" }, { id: "r2", project_id: "p2" }],
    Ausgangsrechnung: [{ id: "ar1", project_id: "p1" }, { id: "ar2", project_id: "p2" }],
    Honorarvertrag: [{ id: "hv1", project_id: "p1" }],
    Zeitbuchung: [{ id: "zb1", project_id: "p1" }],
    Nutzer: [{ id: "nu1", rolle: "inhaber" }],
    Document: [
      { id: "dp1", project_id: "p1", bereich: "projekt" },
      { id: "db1", project_id: "p1", bereich: "buero" },
    ],
    Setting: [{ id: "s-bk", key: "briefkopf", value: {} }, { id: "s-bh", key: "buchhaltung", value: {} }],
  };
}

const ZUORDNUNGEN = [{ mitarbeiter_id: "m1", alle: false, zuordnungen: [{ project_id: "p1" }] }];
const ROLLEN = {
  inhaber: baueZugriff({ rolle: "inhaber" }),
  mitarbeiter: baueZugriff({ nutzer: { id: "u1", rolle: "mitarbeiter", mitarbeiter_id: "m1" }, zuordnungen: ZUORDNUNGEN }),
  buchhaltung: baueZugriff({ nutzer: { id: "u3", rolle: "buchhaltung", mitarbeiter_id: "m3" }, zuordnungen: ZUORDNUNGEN }),
};

/** @param {Record<string, any[]>} daten @returns {string[]} sorted ids of every row */
const ids = (daten) => Object.values(daten).flat().map((r) => r.id).sort();

/** Same in-memory adapter as projektDatei-weitergabe.test.js. */
function speicherAttrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  return {
    async entities() { return Object.keys(daten); },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben(entity, d) { daten[entity] = [...(daten[entity] || []).filter((r) => r.id !== d.id), structuredClone(d)]; },
    async schreibeViele(entity, ds) { daten[entity] = structuredClone(ds); },
    async loeschen(entity, id) { daten[entity] = (daten[entity] || []).filter((r) => r.id !== id); },
    async leeren(entity) { delete daten[entity]; },
    async meta(key, wert) { if (arguments.length === 1) return metaWerte[key]; metaWerte[key] = wert; return wert; },
  };
}

/**
 * Registers a role the way ZugriffProvider does (access + the app's area calculator).
 * @param {any} z
 */
async function registriere(z) {
  const { verborgeneExportBereiche } = await import("@/lib/exportSichtBereiche.js");
  exportSicht.setzeExportBereichsRechner(verborgeneExportBereiche);
  exportSicht.setzeExportZugriff(z);
}

describe("deny until loaded", () => {
  it("a fresh module refuses every export (no 'all' default)", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await assert.rejects(() => projektDatei.projektAlsBlob("Test"), { name: "ExportGesperrtFehler" });
  });

  it("the provider's 'not loaded' state refuses too, also with dialog options", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    exportSicht.setzeExportZugriff(undefined);
    await assert.rejects(() => projektDatei.projektAlsBlob("Test", { ohne: [], art: "sicherung", bereiche: [] }), { name: "ExportGesperrtFehler" });
    await assert.rejects(() => exportSicht.exportEinschraenkungAbfrage(), { name: "ExportGesperrtFehler" });
  });

  it("a non-owner without the app's area calculator is refused, never exported in full", async () => {
    exportSicht.setzeExportBereichsRechner(null);
    exportSicht.setzeExportZugriff(ROLLEN.mitarbeiter);
    await assert.rejects(() => exportSicht.exportEinschraenkung(), { name: "ExportGesperrtFehler" });
  });
});

describe("'vorher sichern' (projektAlsBlob without options) follows the role's areas", () => {
  it("employee (p1): no accounting, times, rights, office documents; only p1", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(ROLLEN.mitarbeiter);
    const { obj } = await projektDatei.projektAlsBlob("Test");
    const d = /** @type {any} */ (obj).daten;
    for (const e of ["Ausgangsrechnung", "Honorarvertrag", "Zeitbuchung", "Nutzer"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(d, e), false, `${e} must not be in the file`);
    }
    assert.deepEqual(ids(d), ["dp1", "p1", "r1", "s-bk"]);
    assert.equal(/** @type {any} */ (obj).art, "weitergabe");
  });

  it("accounting role (all projects): books stay, only the rights area leaves", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(ROLLEN.buchhaltung);
    const { obj } = await projektDatei.projektAlsBlob("Test");
    const d = /** @type {any} */ (obj).daten;
    assert.deepEqual(d.Project.map((p) => p.id), ["p1", "p2"]);
    assert.deepEqual(d.Ausgangsrechnung.map((r) => r.id), ["ar1", "ar2"]);
    assert.equal(Object.prototype.hasOwnProperty.call(d, "Nutzer"), false, "rights area hidden");
    assert.equal(/** @type {any} */ (obj).art, "weitergabe", "a role that may not see everything writes no backup");
  });

  it("dialog options cannot bring a hidden area back, and the file does not name it", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(ROLLEN.buchhaltung);
    const { obj } = await projektDatei.projektAlsBlob("Test", { ohne: [], art: "sicherung", bereiche: ["buchhaltung", "rechte"] });
    assert.equal(Object.prototype.hasOwnProperty.call(/** @type {any} */ (obj).daten, "Nutzer"), false);
    assert.deepEqual(/** @type {any} */ (obj).bereiche, ["buchhaltung"]);
  });

  it("owner: everything, still a backup", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(ROLLEN.inhaber);
    const { obj } = await projektDatei.projektAlsBlob("Test");
    assert.deepEqual(ids(/** @type {any} */ (obj).daten), ids(seed()));
    assert.notEqual(/** @type {any} */ (obj).art, "weitergabe");
  });
});

describe("server routes apply the same restriction (installed edition)", () => {
  const APP = "http://localhost:5428";
  /** @type {string} */ let ordner;
  /** @type {any} */ let db;
  /** @type {any} */ let srv;
  /** @type {string} */ let basis;
  before(async () => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), "bitproj-bereiche-"));
    db = createDb(path.join(ordner, "db.json"));
    db._reset(seed());
    const app = express();
    app.use(express.json());
    app.use("/api", dateiOeffnenRouter({ db, lokalGebunden: true, port: 5428, origins: [APP], datenOrdnerFn: () => ordner }));
    srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    basis = `http://127.0.0.1:${srv.address().port}/api`;
  });
  after(() => { srv?.close(); fs.rmSync(ordner, { recursive: true, force: true }); });

  /** @param {string} abfrage @returns {Promise<any>} parsed project object */
  const exportiere = async (abfrage) => {
    const r = await fetch(`${basis}/datei/export${abfrage}`, { headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    return (await bytesEinlesen(bytes, { groesse: bytes.length, mtimeMs: 0 })).obj;
  };

  it("GET export: employee view (p1) without office areas (literal query)", async () => {
    const obj = await exportiere("?eingeschraenkt=1&sicht=zuordnung&projekt=p1&ohne=Ausgangsrechnung&ohne=Honorarvertrag&ohne=Zeitbuchung&ohne=Nutzer&ohneSettingKey=buchhaltung&ohneDokumentBereich=buero");
    assert.equal(Object.prototype.hasOwnProperty.call(obj.daten, "Ausgangsrechnung"), false, "accounting must not leave the server");
    assert.deepEqual(ids(obj.daten), ["dp1", "p1", "r1", "s-bk"]);
    assert.equal(obj.art, "weitergabe");
  });

  it("GET export with the query the app builds: employee and accounting role", async () => {
    await registriere(ROLLEN.mitarbeiter);
    const ma = await exportiere(await exportSicht.exportEinschraenkungAbfrage());
    assert.deepEqual(ids(ma.daten), ["dp1", "p1", "r1", "s-bk"]);
    await registriere(ROLLEN.buchhaltung);
    const bh = await exportiere(await exportSicht.exportEinschraenkungAbfrage());
    assert.deepEqual(bh.daten.Project.map((p) => p.id), ["p1", "p2"]);
    assert.equal(Object.prototype.hasOwnProperty.call(bh.daten, "Nutzer"), false);
    assert.ok(Array.isArray(bh.daten.Ausgangsrechnung));
    assert.equal(bh.art, "weitergabe");
    await registriere(ROLLEN.inhaber);
    assert.equal(await exportSicht.exportEinschraenkungAbfrage(), "", "owner: no restriction");
  });

  it("POST save-back: the employee's body drops the office areas (as a copy; R-BUERO-1)", async () => {
    const datei = path.join(ordner, "Verknuepft.bitproj");
    fs.writeFileSync(datei, "{}");
    fs.writeFileSync(path.join(ordner, QUELLE_DATEI), JSON.stringify({ pfad: fs.realpathSync.native(datei), name: "Verknuepft.bitproj", groesse: 0, sha256: "", projektname: "T" }));
    await registriere(ROLLEN.mitarbeiter);
    // A restricted role only ever saves a copy beside the linked file (buero-nachgang-w1.test.js).
    const koerper = { entscheidung: "kopie", ...(await exportSicht.exportEinschraenkungKoerper()) };
    const r = await fetch(`${basis}/datei/zurueckschreiben`, { method: "POST", headers: { Origin: APP, "content-type": "application/json" }, body: JSON.stringify(koerper) });
    assert.equal(r.status, 200, await r.clone().text());
    const antwort = await r.json();
    assert.equal(antwort.kopie, true, JSON.stringify(antwort));
    assert.equal(fs.readFileSync(datei, "utf8"), "{}", "the linked file stays untouched");
    const bytes = fs.readFileSync(antwort.pfad);
    const obj = (await bytesEinlesen(bytes, { groesse: bytes.length, mtimeMs: 0 })).obj;
    assert.deepEqual(ids(obj.daten), ["dp1", "p1", "r1", "s-bk"]);
    assert.equal(obj.art, "weitergabe");
  });
});
