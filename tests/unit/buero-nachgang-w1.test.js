// Wave 1 "buero", review follow-up (R-BUERO-1..3).
//
// R-BUERO-1: saving back under a restricted role (e.g. "Ansicht als" an employee) must never overwrite
//   the linked project file — that file may be the full office file (other projects, accounting,
//   users). Only a copy is allowed; server route and desktop shell share one rule (zurueckKonflikt).
// R-BUERO-2: when loading the rights FAILED (no data), ordinary exports are refused with their own
//   message, but the emergency backup of the error card still writes the full local state.
// R-BUERO-3: a restricted role's "vorher sichern" file is a handover (own projects only), while the
//   replacing import replaces everything — so the internal full snapshot before the import becomes
//   mandatory for a restricted role: no snapshot, no import.
//
// In:  server/dateiOeffnenRouter.js, @core/api/projektDatei.js, @core/api/exportSicht.js,
//      @core/api/exportSichtStand.js, @core/api/projektDateiFormat.js, @core/api/schnappschuesse.js,
//      src/client/dateiHuelle.js and src/App.jsx (source wiring). Out: assertions only.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Buffer } from "node:buffer";
import * as projektDatei from "@core/api/projektDatei.js";
import * as exportSicht from "@core/api/exportSicht.js";
import * as exportSichtStand from "@core/api/exportSichtStand.js";
import * as format from "@core/api/projektDateiFormat.js";
import { setzeSpeicher, demoDbAuslesen } from "@core/api/demoDb.js";
import { setzeSchnappschussSpeicher, schnappschuesseListe } from "@core/api/schnappschuesse.js";
import { SCHNAPP_STORE } from "@core/api/schnappschussRing.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { dateiOeffnenRouter, bytesEinlesen, dateiStand, projektDateiBytes, QUELLE_DATEI } from "../../server/dateiOeffnenRouter.js";

const WURZEL = path.resolve(import.meta.dirname, "../..");

/** Neutral full office workspace: two projects, project rows, accounting, users. */
function seed() {
  return {
    Project: [{ id: "p1", name: "Projekt A" }, { id: "p2", name: "Projekt B" }],
    Room: [{ id: "r1", project_id: "p1" }, { id: "r2", project_id: "p2" }],
    Ausgangsrechnung: [{ id: "ar2", project_id: "p2" }],
    Nutzer: [{ id: "nu1", rolle: "inhaber" }],
  };
}

const ZUORDNUNGEN = [{ mitarbeiter_id: "m1", alle: false, zuordnungen: [{ project_id: "p1" }] }];
const MITARBEITER = baueZugriff({ nutzer: { id: "u1", rolle: "mitarbeiter", mitarbeiter_id: "m1" }, zuordnungen: ZUORDNUNGEN });
const INHABER = baueZugriff({ rolle: "inhaber" });

/** @param {Record<string, any[]>} daten @returns {string[]} sorted ids of every row */
const ids = (daten) => Object.values(daten).flat().map((r) => r.id).sort();

/** In-memory adapter (same shape as in export-bereiche-rolle-w1.test.js). */
function speicherAttrappe(start = {}, { schreibFehler = false } = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  return {
    async entities() { return Object.keys(daten); },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben(entity, d) {
      if (schreibFehler) throw new Error("Testspeicher: Schreiben fehlgeschlagen");
      daten[entity] = [...(daten[entity] || []).filter((r) => r.id !== d.id), structuredClone(d)];
    },
    async schreibeViele(entity, ds) { daten[entity] = structuredClone(ds); },
    async loeschen(entity, id) { daten[entity] = (daten[entity] || []).filter((r) => r.id !== id); },
    async leeren(entity) { delete daten[entity]; },
    async meta(key, wert) { if (arguments.length === 1) return metaWerte[key]; metaWerte[key] = wert; return wert; },
  };
}

/** Registers a role the way ZugriffProvider does. @param {any} z */
async function registriere(z) {
  const { verborgeneExportBereiche } = await import("@/lib/exportSichtBereiche.js");
  exportSicht.setzeExportBereichsRechner(verborgeneExportBereiche);
  exportSicht.setzeExportZugriff(z);
}

describe("R-BUERO-1: a restricted save-back never overwrites the linked file", () => {
  it("one rule for server and shell: restricted → only a copy", () => {
    assert.equal(typeof format.zurueckKonflikt, "function", "zurueckKonflikt exported");
    const k = format.zurueckKonflikt;
    assert.equal(k({ eingeschraenkt: true, geaendert: false, vorhanden: true }), "eingeschraenkt");
    assert.equal(k({ eingeschraenkt: true, geaendert: false, vorhanden: true, entscheidung: "ueberschreiben" }), "eingeschraenkt");
    assert.equal(k({ eingeschraenkt: true, geaendert: true, vorhanden: true, entscheidung: "kopie" }), null);
    assert.equal(k({ eingeschraenkt: false, geaendert: false, vorhanden: true }), null);
    assert.equal(k({ eingeschraenkt: false, geaendert: true, vorhanden: true }), "geaendert");
    assert.equal(k({ eingeschraenkt: false, geaendert: true, vorhanden: false }), "fehlt");
    assert.equal(k({ eingeschraenkt: false, geaendert: true, vorhanden: true, entscheidung: "ueberschreiben" }), null);
  });

  it("the desktop shell asks the same rule before it builds the file", () => {
    const src = fs.readFileSync(path.join(WURZEL, "src/client/dateiHuelle.js"), "utf8");
    const zurueck = src.slice(src.indexOf("async zurueck("));
    assert.match(zurueck, /zurueckKonflikt\(/, "shell save-back uses zurueckKonflikt");
    assert.match(zurueck, /exportEinschraenkung\(\)/, "shell save-back asks the role's restriction");
    assert.ok(zurueck.indexOf("zurueckKonflikt(") < zurueck.indexOf("projektAlsBlob("), "decided before the file is built");
  });

  describe("server route (installed edition)", () => {
    const APP = "http://localhost:5428";
    /** @type {string} */ let ordner;
    /** @type {any} */ let srv;
    /** @type {string} */ let basis;
    /** @type {string} */ let datei;
    /** @type {Buffer} */ let vorher;
    before(async () => {
      ordner = fs.mkdtempSync(path.join(os.tmpdir(), "bitproj-nachgang-"));
      const db = createDb(path.join(ordner, "db.json"));
      db._reset(seed());
      // The linked file is the FULL office file, unchanged since the import (fingerprint matches).
      datei = path.join(fs.realpathSync.native(ordner), "Buero.bitproj");
      fs.writeFileSync(datei, projektDateiBytes(format.serialisiereProjekt(seed(), "Buero", { art: "sicherung" })));
      vorher = fs.readFileSync(datei);
      const st = await dateiStand(datei);
      fs.writeFileSync(path.join(ordner, QUELLE_DATEI), JSON.stringify({ pfad: datei, name: "Buero.bitproj", groesse: st.groesse, sha256: st.sha256, projektname: "Buero", art: "sicherung" }));
      const app = express();
      app.use(express.json());
      app.use("/api", dateiOeffnenRouter({ db, lokalGebunden: true, port: 5428, origins: [APP], datenOrdnerFn: () => ordner }));
      srv = app.listen(0, "127.0.0.1");
      await new Promise((r) => srv.once("listening", r));
      basis = `http://127.0.0.1:${srv.address().port}/api`;
    });
    after(() => { srv?.close(); fs.rmSync(ordner, { recursive: true, force: true }); });

    /** @param {Record<string, any>} koerper */
    const zurueck = (koerper) => fetch(`${basis}/datei/zurueckschreiben`, {
      method: "POST", headers: { Origin: APP, "content-type": "application/json" }, body: JSON.stringify(koerper),
    });

    it("employee, no decision: answer 'eingeschraenkt', full file byte-identical", async () => {
      await registriere(MITARBEITER);
      const r = await zurueck(await exportSicht.exportEinschraenkungKoerper());
      const j = await r.json();
      assert.equal(j.ok, false, JSON.stringify(j));
      assert.equal(j.konflikt, "eingeschraenkt");
      assert.ok(fs.readFileSync(datei).equals(vorher), "the linked full file must stay byte-identical");
    });

    it("employee, 'ueberschreiben': still refused, file byte-identical", async () => {
      await registriere(MITARBEITER);
      const r = await zurueck({ entscheidung: "ueberschreiben", ...(await exportSicht.exportEinschraenkungKoerper()) });
      const j = await r.json();
      assert.equal(j.ok, false, JSON.stringify(j));
      assert.equal(j.konflikt, "eingeschraenkt");
      assert.ok(fs.readFileSync(datei).equals(vorher));
    });

    it("employee, 'kopie': a handover copy beside it, the source untouched", async () => {
      await registriere(MITARBEITER);
      const r = await zurueck({ entscheidung: "kopie", ...(await exportSicht.exportEinschraenkungKoerper()) });
      const j = await r.json();
      assert.equal(j.ok, true, JSON.stringify(j));
      assert.equal(j.kopie, true);
      assert.notEqual(j.pfad, datei);
      assert.ok(fs.readFileSync(datei).equals(vorher));
      const bytes = fs.readFileSync(j.pfad);
      const obj = (await bytesEinlesen(bytes, { groesse: bytes.length, mtimeMs: 0 })).obj;
      assert.deepEqual(ids(obj.daten), ["p1", "r1"]);
      assert.equal(obj.art, "weitergabe");
    });
  });
});

describe("R-BUERO-2: a failed rights load keeps the emergency backup", () => {
  it("the provider's state: 'ladefehler' when loading failed without data", () => {
    assert.equal(typeof exportSichtStand.exportSichtZugriff, "function", "exportSichtZugriff exported");
    const f = exportSichtStand.exportSichtZugriff;
    const aktiv = { rolle: "mitarbeiter" };
    const lade = () => {};
    assert.equal(f(null, lade, null, null, aktiv), undefined, "still loading");
    assert.equal(f(null, lade, null, "kaputt", aktiv), exportSichtStand.EXPORT_LADEFEHLER);
    assert.notEqual(exportSichtStand.EXPORT_LADEFEHLER, undefined, "a state of its own, not 'still loading'");
    assert.equal(f(null, lade, { nutzer: [] }, "kaputt", aktiv), aktiv, "old data stays valid");
    assert.equal(f(aktiv, null, null, null, aktiv), aktiv);
  });

  it("ordinary exports are refused with their own message; the emergency backup writes everything", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(exportSichtStand.EXPORT_LADEFEHLER);
    await assert.rejects(() => projektDatei.projektAlsBlob("Test"), (e) => e.name === "ExportGesperrtFehler" && e.message === exportSicht.EXPORT_LADEFEHLER_TEXT);
    const { obj } = await projektDatei.projektAlsBlob("Test", { notsicherung: true });
    assert.deepEqual(ids(obj.daten), ids(seed()));
    assert.notEqual(obj.art, "weitergabe");
  });

  it("while still loading, the emergency backup is refused too (no 'all' before the first answer)", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(undefined);
    await assert.rejects(() => projektDatei.projektAlsBlob("Test", { notsicherung: true }), { name: "ExportGesperrtFehler" });
  });

  it("a loaded employee's emergency backup stays restricted", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    await registriere(MITARBEITER);
    const { obj } = await projektDatei.projektAlsBlob("Test", { notsicherung: true });
    assert.deepEqual(ids(obj.daten), ["p1", "r1"]);
  });

  it("the error card asks for the emergency backup", () => {
    const src = fs.readFileSync(path.join(WURZEL, "src/App.jsx"), "utf8");
    assert.match(src, /const projektSichern = [^\n]*exportProjekt\(undefined, \{ notsicherung: true \}\)/);
  });
});

describe("R-BUERO-3: the replacing import of a restricted role needs the full internal snapshot", () => {
  const datei = () => ({ daten: { Project: [{ id: "p9", name: "Fremd" }] } });

  it("employee: snapshot fails → no import, data untouched", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    setzeSchnappschussSpeicher(speicherAttrappe({}, { schreibFehler: true }));
    await registriere(MITARBEITER);
    await assert.rejects(() => projektDatei.uebernehmeProjekt(datei()));
    assert.deepEqual(ids(await demoDbAuslesen()), ids(seed()), "the import must not replace data without a full snapshot");
  });

  it("employee: the snapshot before the import holds the WHOLE office, not the role's view", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    const ring = speicherAttrappe({});
    setzeSchnappschussSpeicher(ring);
    await registriere(MITARBEITER);
    const r = await projektDatei.uebernehmeProjekt(datei());
    assert.equal(r.schnappschussFehler, null);
    assert.equal((await schnappschuesseListe()).length, 1, "snapshot taken");
    const [eintrag] = await ring.alle(SCHNAPP_STORE);
    assert.deepEqual(ids(eintrag.projekt.daten), ids(seed()), "p2 and the accounting row are in the snapshot");
    assert.deepEqual(ids(await demoDbAuslesen()), ["p9"]);
  });

  it("owner: unchanged — a failed snapshot is reported, the import goes on", async () => {
    setzeSpeicher(speicherAttrappe(seed()));
    setzeSchnappschussSpeicher(speicherAttrappe({}, { schreibFehler: true }));
    await registriere(INHABER);
    const r = await projektDatei.uebernehmeProjekt(datei());
    assert.ok(r.schnappschussFehler);
    assert.deepEqual(ids(await demoDbAuslesen()), ["p9"]);
  });
});
