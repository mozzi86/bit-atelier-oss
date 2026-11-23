// 108-09: POST /api/modell/import and /modell/import/zuruecknehmen (server/modellImportRouter.js) on a real Express app with a
// temporary database (createDb) and the real change stream hub: the dry run writes nothing; applying writes the record, keeps a
// backup and reports exactly one stream event; an outdated or missing stand is a 409; the undo puts the backup back; a strict save of
// an open studio on the old base meets a 409 (no silent overwrite); paired devices never reach the route. Neutral test data only.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { fileURLToPath } from "node:url";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter } from "../../packages/nova-core/server/routes.js";
import { aenderungsStrom, aenderungenMelden, ereignisAusSchreiben } from "../../server/aenderungsStrom.js";
import { modellImportRouter, IMPORT_SICHERUNG, STAND_FEHLT_TEXT } from "../../server/modellImportRouter.js";
import { STAND_KONFLIKT_TEXT } from "../../packages/nova-core/server/routes.js";
import { geraetDarf } from "../../server/bueroRouter.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(WURZEL, "tests", "unit", "fixtures", "efh-108-import.json"), "utf8"));

/** @type {any} */ let db;
/** @type {any} */ let strom;
/** @type {any[]} */ const ereignisse = [];
/** @type {http.Server} */ let server;
let basis = "";
let ordner = "";

before(async () => {
  ordner = fs.mkdtempSync(path.join(os.tmpdir(), "modell-import-10809-"));
  db = createDb(path.join(ordner, "db.json"));
  strom = aenderungsStrom();
  strom.abonnieren({ projekt: "P1", quelle: "lokal", senden: (/** @type {any} */ e) => ereignisse.push(e) });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", aenderungenMelden(strom, db));
  app.use("/api", entitiesRouter(db));
  app.use("/api", modellImportRouter(db, {
    nachAenderung: (w) => {
      const e = ereignisAusSchreiben({ methode: w.methode, entitaet: w.entitaet, id: w.id, datensatz: w.datensatz, vorher: w.vorher, body: w.body });
      if (e) strom.melden(e);
    },
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  basis = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api`;
  db.create("Project", { id: "P1", name: "Testprojekt Import" }, { kennungUebernehmen: true });
});

after(() => { server?.close(); fs.rmSync(ordner, { recursive: true, force: true }); });

/** @param {string} pfad @param {any} [body] @param {Record<string, string>} [kopf] */
async function post(pfad, body = {}, kopf = {}) {
  const r = await fetch(basis + pfad, { method: "POST", headers: { "content-type": "application/json", ...kopf }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
const modellVon = (/** @type {string} */ p) => db.filter("BimModel", { project_id: p })[0] || null;

test("dry run: errors with path and sentence, nothing written; a valid import says what it would create", async () => {
  const kaputt = structuredClone(FIXTURE);
  kaputt.customWindows[0].wallIdx = 12;
  const f = await post("/modell/import?projekt=P1", kaputt);
  assert.equal(f.status, 200);
  assert.equal(f.json.ok, false);
  assert.deepEqual(f.json.fehler, [{ pfad: "customWindows[0].wallIdx", text: "Tür 4: Wand 12 gibt es nicht (vorhanden: 1–3)." }]);
  const g = await post("/modell/import?projekt=P1&modus=pruefen", FIXTURE);
  assert.equal(g.json.ok, true);
  assert.equal(g.json.geschrieben, false);
  assert.equal(g.json.wuerde.anlegen, true);
  assert.equal(g.json.wuerde.nachher.customWalls, 3);
  assert.equal(g.json.stand, null);
  assert.equal(modellVon("P1"), null, "the dry run wrote no record");
  assert.equal(db.list(IMPORT_SICHERUNG).length, 0);
  assert.equal(ereignisse.length, 0, "and reported nothing");
});

test("bad requests: no project, unknown project, unknown mode, foreign web page", async () => {
  assert.equal((await post("/modell/import", FIXTURE)).status, 400);
  assert.equal((await post("/modell/import?projekt=GIBTSNICHT", FIXTURE)).status, 404);
  assert.equal((await post("/modell/import?projekt=P1&modus=loeschen", FIXTURE)).status, 400);
  assert.equal((await post("/modell/import?projekt=P1", FIXTURE, { "sec-fetch-site": "cross-site" })).status, 403);
  const k = structuredClone(FIXTURE); k.version = 9;
  const r = await post("/modell/import?projekt=P1&modus=anwenden", k);
  assert.equal(r.status, 422, "an import with errors is never applied");
  assert.match(r.json.error, /1 Fehler — nichts geschrieben/);
  assert.equal(modellVon("P1"), null);
});

test("apply: creates the record with pinned GUIDs, a backup and exactly one stream event; then a stale or missing stand is a 409", async () => {
  ereignisse.length = 0;
  const a = await post("/modell/import?projekt=P1&modus=anwenden", FIXTURE);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const m = modellVon("P1");
  assert.equal(m.id, a.json.bim_model_id);
  assert.equal(m.customWalls.length, 3);
  assert.equal(m.customWalls[0].guid.length, 22);
  assert.equal(m.dachform, "sattel");
  assert.equal(ereignisse.length, 1);
  assert.equal(ereignisse[0].art, "angelegt");
  assert.equal(ereignisse[0].entitaet, "BimModel");
  const s = db.get(IMPORT_SICHERUNG, a.json.sicherung);
  assert.equal(s.vorher, null, "the record did not exist before");
  assert.equal(s.bim_model_id, m.id);

  // a second import on the existing record needs the stand of a dry run
  const neu = structuredClone(FIXTURE);
  neu.customWalls = neu.customWalls.slice(0, 1);
  neu.customWindows = [neu.customWindows[0]];
  const ohne = await post("/modell/import?projekt=P1&modus=anwenden", neu);
  assert.equal(ohne.status, 409);
  assert.equal(ohne.json.error, STAND_FEHLT_TEXT);
  const veraltet = await post(`/modell/import?projekt=P1&modus=anwenden&stand=${encodeURIComponent("2020-01-01T00:00:00.000Z")}`, neu);
  assert.equal(veraltet.status, 409);
  assert.equal(modellVon("P1").customWalls.length, 3, "nothing overwritten");
});

test("re-import with the stand: backup of the replaced fields, other fields stay; an open studio's strict save on the old base gets 409; undo restores", async () => {
  // a field outside the format (a trade layer) and a stair-less record field set must survive the import
  const vorher = modellVon("P1");
  const mitLayer = db.update("BimModel", vorher.id, { netz_layer: { version: 1, kanten: [] } });
  const studioBasis = mitLayer.updated_date;
  await new Promise((r) => setTimeout(r, 5)); // distinct updated_date
  ereignisse.length = 0;
  const neu = structuredClone(FIXTURE);
  neu.customWalls = neu.customWalls.slice(0, 1);
  neu.customWindows = [neu.customWindows[0]];
  const probe = await post("/modell/import?projekt=P1", neu);
  assert.equal(probe.json.stand, studioBasis);
  assert.equal(probe.json.wuerde.vorher.customWalls, 3);
  assert.equal(probe.json.wuerde.nachher.customWalls, 1);
  const a = await post(`/modell/import?projekt=P1&modus=anwenden&stand=${encodeURIComponent(probe.json.stand)}`, neu);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const m = modellVon("P1");
  assert.equal(m.customWalls.length, 1);
  assert.deepEqual(m.netz_layer, { version: 1, kanten: [] }, "fields outside the format stay");
  assert.equal(ereignisse.length, 1);
  assert.equal(ereignisse[0].art, "geaendert");
  assert.ok(ereignisse[0].felder.includes("customWalls"));
  const s = db.get(IMPORT_SICHERUNG, a.json.sicherung);
  assert.equal(s.vorher.customWalls.length, 3, "the backup holds the replaced walls");

  // the open studio still builds on the old base: its strict save (PUT ?stand=) is refused, nothing silently overwritten
  const studio = await fetch(`${basis}/entities/BimModel/${m.id}?stand=${encodeURIComponent(studioBasis)}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ customWalls: vorher.customWalls }),
  });
  assert.equal(studio.status, 409);
  assert.equal(modellVon("P1").customWalls.length, 1);

  // undo: preview, then apply with the stand
  const zp = await post(`/modell/import/zuruecknehmen?projekt=P1&id=${a.json.sicherung}`);
  assert.equal(zp.json.geschrieben, false);
  assert.equal(zp.json.wuerde.nachher.customWalls, 3);
  assert.equal((await post(`/modell/import/zuruecknehmen?projekt=P1&id=${a.json.sicherung}&modus=anwenden`)).status, 409, "stand needed");
  const z = await post(`/modell/import/zuruecknehmen?projekt=P1&id=${a.json.sicherung}&modus=anwenden&stand=${encodeURIComponent(zp.json.stand)}`);
  assert.equal(z.status, 200, JSON.stringify(z.json));
  assert.equal(modellVon("P1").customWalls.length, 3);
  assert.deepEqual(modellVon("P1").customWalls, vorher.customWalls);
  assert.ok(db.get(IMPORT_SICHERUNG, a.json.sicherung).zurueckgenommen);
  assert.equal(ereignisse.length, 2, "the undo is reported as well");
});

test("undo of an import that created the record is refused; an unknown backup is 404", async () => {
  const erste = db.list(IMPORT_SICHERUNG).find((/** @type {any} */ s) => s.vorher === null);
  const r = await post(`/modell/import/zuruecknehmen?projekt=P1&id=${erste.id}`);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Papierkorb/);
  assert.equal((await post("/modell/import/zuruecknehmen?projekt=P1&id=nix")).status, 404);
});

test("R-GJ-1: only the exact stand of the dry run writes - a non-date or a future stand is a 409 (import and undo)", async () => {
  db.create("Project", { id: "P2", name: "Testprojekt Stand" }, { kennungUebernehmen: true });
  const erst = await post("/modell/import?projekt=P2&modus=anwenden", FIXTURE);
  assert.equal(erst.status, 201, JSON.stringify(erst.json));
  const neu = structuredClone(FIXTURE);
  neu.customWalls = neu.customWalls.slice(0, 1);
  neu.customWindows = [neu.customWindows[0]];
  const egal = await post("/modell/import?projekt=P2&modus=anwenden&stand=egal", neu);
  assert.equal(egal.status, 409, "a stand that is not the record's stand must not write");
  assert.equal(egal.json.error, STAND_FEHLT_TEXT);
  const zukunft = await post(`/modell/import?projekt=P2&modus=anwenden&stand=${encodeURIComponent("2999-01-01T00:00:00.000Z")}`, neu);
  assert.equal(zukunft.status, 409, "a stand in the future was never seen");
  assert.equal(zukunft.json.error, STAND_KONFLIKT_TEXT);
  assert.equal(modellVon("P2").customWalls.length, 3, "nothing overwritten");
  // the undo follows the same rule
  const probe = await post("/modell/import?projekt=P2", neu);
  const a = await post(`/modell/import?projekt=P2&modus=anwenden&stand=${encodeURIComponent(probe.json.stand)}`, neu);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const z = await post(`/modell/import/zuruecknehmen?projekt=P2&id=${a.json.sicherung}&modus=anwenden&stand=egal`);
  assert.equal(z.status, 409);
  assert.equal(modellVon("P2").customWalls.length, 1, "undo not applied without the stand");
});

test("paired devices never reach the import (office mode allow-list)", () => {
  assert.equal(geraetDarf("POST", "/api/modell/import"), false);
  assert.equal(geraetDarf("POST", "/api/modell/import/zuruecknehmen"), false);
});
