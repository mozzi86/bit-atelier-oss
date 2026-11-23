// Wave 1 "buero" (BEFUNDE-82 H-2): a .bitproj carries only the projects the
// exporting role may see. Before, the role filter only hid office ROWS of the
// export dialog; every project with all its records went into the file.
//
// The rule sits below the dialog: projektDateiFormat.nurSichtbareProjekte (pure,
// shared by browser and server), applied by projektAlsBlob() to the project view
// the access context registered (setzeExportZugriff) — so the dialog, "vorher
// sichern", the desktop shell's save-back and every other caller get it — and by
// the Express export route of the installed edition.
//
// Roles are built with the real baueZugriff (rechte.js): owner (all projects),
// an employee assigned to p1, a project lead assigned to p2.
//
// In:  @core/api/projektDateiFormat.js, @core/api/projektDatei.js, @core/lib/rechte.js,
//      server/dateiOeffnenRouter.js. Out: assertions only.

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Buffer } from "node:buffer";
import * as format from "@core/api/projektDateiFormat.js";
import * as projektDatei from "@core/api/projektDatei.js";
import { setzeSpeicher } from "@core/api/demoDb.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { dateiOeffnenRouter, bytesEinlesen } from "../../server/dateiOeffnenRouter.js";

/** Neutral two-project workspace: project-bound rows in three id spellings plus office rows. */
function seed() {
  return {
    Project: [{ id: "p1", name: "Projekt A" }, { id: "p2", name: "Projekt B" }],
    Room: [{ id: "r1", project_id: "p1" }, { id: "r2", project_id: "p2" }],
    Document: [{ id: "d1", project_id: "p1", bereich: "projekt" }, { id: "d2", project_id: "p2", bereich: "projekt" }],
    Notiz: [{ id: "n1", projectId: "p2" }, { id: "n2", projekt_id: "p2" }, { id: "n3", projectId: "p1" }],
    Kontakt: [{ id: "k1", name: "Kontakt" }],
    Setting: [{ id: "s1", key: "briefkopf", value: { office: "Testbüro" } }],
  };
}

const ZUORDNUNGEN = [
  { mitarbeiter_id: "m1", alle: false, zuordnungen: [{ project_id: "p1" }] },
  { mitarbeiter_id: "m2", alle: false, zuordnungen: [{ project_id: "p2" }] },
];
const ROLLEN = {
  inhaber: baueZugriff({ rolle: "inhaber" }),
  mitarbeiter: baueZugriff({ nutzer: { id: "u1", rolle: "mitarbeiter", mitarbeiter_id: "m1" }, zuordnungen: ZUORDNUNGEN }),
  projektleitung: baueZugriff({ nutzer: { id: "u2", rolle: "projektleitung", mitarbeiter_id: "m2" }, zuordnungen: ZUORDNUNGEN }),
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

describe("nurSichtbareProjekte (pure, projektDateiFormat.js)", () => {
  it("owner: everything, unchanged", () => {
    assert.equal(typeof format.nurSichtbareProjekte, "function", "nurSichtbareProjekte exported");
    const d = seed();
    assert.equal(format.nurSichtbareProjekte(d, ROLLEN.inhaber.projektIds), d);
  });

  it("employee (p1): only p1 and its rows, office rows stay", () => {
    const raus = format.nurSichtbareProjekte(seed(), ROLLEN.mitarbeiter.projektIds);
    assert.deepEqual(ids(raus), ["d1", "k1", "n3", "p1", "r1", "s1"]);
  });

  it("project lead (p2): only p2 and its rows, all three id spellings", () => {
    const raus = format.nurSichtbareProjekte(seed(), ROLLEN.projektleitung.projektIds);
    assert.deepEqual(ids(raus), ["d2", "k1", "n1", "n2", "p2", "r2", "s1"]);
  });

  it("empty project view (user without linked person): no project at all", () => {
    const raus = format.nurSichtbareProjekte(seed(), new Set());
    assert.deepEqual(ids(raus), ["k1", "s1"]);
  });
});

describe("W1-BUERO-F3: records bound to a project only through a parent id", () => {
  /** Neutral rows that name no project themselves (each case found in the create payloads, see ELTERN_VERWEISE). */
  const mitEltern = () => ({
    Project: [{ id: "p1" }, { id: "p2" }],
    Tender: [{ id: "t1", project_id: "p1" }, { id: "t2", project_id: "p2" }],
    LVPosition: [{ id: "l2", project_id: "p2" }],
    Issue: [{ id: "i2", project_id: "p2" }],
    Genehmigung: [{ id: "g2", project_id: "p2" }],
    Sonderwunsch: [{ id: "sw2", project_id: "p2" }],
    ProjectFolder: [{ id: "f2", project_id: "p2", parent_id: null }, { id: "f2b", parent_id: "f2" }],
    Bid: [{ id: "b1", tender_id: "t1" }, { id: "b2", tender_id: "t2" }, { id: "bx", tender_id: "weg" }],
    Measurement: [{ id: "m2", position_id: "l2" }, { id: "m2t", tender_id: "t2" }],
    ChangeOrder: [{ id: "co2", issue_id: "i2", project_id: null }],
    Auflage: [{ id: "a2", genehmigung_id: "g2" }],
    Bemusterung: [{ id: "be2", sonderwunsch_id: "sw2" }],
    Document: [{ id: "doc2", folder_id: "f2b" }, { id: "doc0", project_id: null, folder_id: null, bereich: "buero" }],
  });

  it("employee (p1): bids, measurements, change orders, conditions, samples, folders of p2 stay out", () => {
    const raus = format.nurSichtbareProjekte(mitEltern(), ROLLEN.mitarbeiter.projektIds);
    assert.deepEqual(ids(raus), ["b1", "doc0", "p1", "t1"], "only p1's tender and bid, plus the office document");
  });

  it("project lead (p2): the same rows follow their parent into p2's file; an orphan stays out", () => {
    const raus = format.nurSichtbareProjekte(mitEltern(), ROLLEN.projektleitung.projektIds);
    assert.deepEqual(ids(raus), ["a2", "b2", "be2", "co2", "doc0", "doc2", "f2", "f2b", "g2", "i2", "l2", "m2", "m2t", "p2", "sw2", "t2"]);
  });
});

describe("projektAlsBlob applies the registered project view (browser edition)", () => {
  // W1-BUERO-F1: a non-owner needs the app's area calculator (ZugriffProvider registers it).
  before(async () => {
    projektDatei.setzeExportBereichsRechner((await import("@/lib/exportSichtBereiche.js")).verborgeneExportBereiche);
  });
  afterEach(() => { projektDatei.setzeExportZugriff(undefined); });

  it("employee: the file holds p1 only and is a handover, not a backup", async () => {
    assert.equal(typeof projektDatei.setzeExportZugriff, "function", "setzeExportZugriff exported by projektDatei.js");
    setzeSpeicher(speicherAttrappe(seed()));
    projektDatei.setzeExportZugriff(ROLLEN.mitarbeiter);
    const { obj } = await projektDatei.projektAlsBlob("Test");
    assert.deepEqual(/** @type {any} */ (obj).daten.Project.map((p) => p.id), ["p1"]);
    assert.deepEqual(ids(/** @type {any} */ (obj).daten), ["d1", "k1", "n3", "p1", "r1", "s1"]);
    assert.equal(/** @type {any} */ (obj).art, "weitergabe");
  });

  it("project lead: p2 only, also with explicit dialog options", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    projektDatei.setzeExportZugriff(ROLLEN.projektleitung);
    const { obj } = await projektDatei.projektAlsBlob("Test", { ohne: [], art: "sicherung", bereiche: [] });
    assert.deepEqual(/** @type {any} */ (obj).daten.Project.map((p) => p.id), ["p2"]);
    assert.equal(/** @type {any} */ (obj).art, "weitergabe", "a filtered file never claims to be a backup");
  });

  it("owner: both projects, a backup stays a backup", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    projektDatei.setzeExportZugriff(ROLLEN.inhaber);
    const { obj } = await projektDatei.projektAlsBlob("Test");
    assert.deepEqual(/** @type {any} */ (obj).daten.Project.map((p) => p.id), ["p1", "p2"]);
    assert.notEqual(/** @type {any} */ (obj).art, "weitergabe");
  });
});

describe("GET /api/datei/export applies the project view (installed edition)", () => {
  const PORT_APP = 4798;
  /** @type {string} */ let ordner;
  /** @type {any} */ let srv;
  /** @type {string} */ let basis;
  before(async () => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), "bitproj-sicht-"));
    const db = createDb(path.join(ordner, "db.json"));
    db._reset(seed());
    const app = express();
    app.use(express.json());
    app.use("/api", dateiOeffnenRouter({ db, lokalGebunden: true, port: PORT_APP, datenOrdnerFn: () => ordner }));
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

  it("employee view (p1): only p1", async () => {
    const obj = await exportiere("?sicht=zuordnung&projekt=p1");
    assert.deepEqual(obj.daten.Project.map((p) => p.id), ["p1"]);
    assert.deepEqual(ids(obj.daten), ["d1", "k1", "n3", "p1", "r1", "s1"]);
    assert.equal(obj.art, "weitergabe");
  });

  it("project lead view (p2): only p2", async () => {
    const obj = await exportiere("?sicht=zuordnung&projekt=p2");
    assert.deepEqual(obj.daten.Project.map((p) => p.id), ["p2"]);
  });

  it("empty assignment list: no project", async () => {
    const obj = await exportiere("?sicht=zuordnung");
    assert.deepEqual(obj.daten.Project, []);
  });

  it("owner (no view parameter): both projects", async () => {
    const obj = await exportiere("");
    assert.deepEqual(obj.daten.Project.map((p) => p.id), ["p1", "p2"]);
  });
});
