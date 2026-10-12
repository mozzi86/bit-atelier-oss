// Phase 81 (81-06, E-07, T-81-29/T-81-30): the export row "Zeiten & Aufträge" of
// the 79-12 registry with the real registry and the real project-file functions
// — a handover file (no tick) carries no time booking, working time, fee offer,
// fee amendment, no marker Setting zeit_honorar and no override row
// regel:zeit_honorar.*; a backup needs every tick; importing a handover file keeps
// the local phase-81 data; no file ever carries cost rates or other personnel
// entities (80 invariant). Storage is injected (same fake as demoDb.test.js).
//
// In:  src/lib/exportBereiche.js, @core/api/projektDatei.js, @core/api/demoDb.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { projektAlsBlob, uebernehmeProjekt } from "@core/api/projektDatei.js";
import { demoDbAuslesen, setzeSpeicher } from "@core/api/demoDb.js";
import { EXPORT_BEREICHE, exportOptionen, importOptionen } from "@/lib/exportBereiche.js";
import { BUCHHALTUNG_ENTITAETEN, SETTING_KEY } from "@/lib/accounting/datenmodell.js";
import { ZEIT_HONORAR_ENTITAETEN, ZEIT_HONORAR_SETTING_KEY, ZEIT_HONORAR_SETTING_KEYS } from "@/lib/zeitHonorar/entitaeten.js";
import { PERSONAL_EXPORT_BEREICH } from "@/lib/people/exportBereich.js";
import { englischePaareAlle } from "./helpers/woerterbuch.mjs";

/** In-memory storage adapter (shape of tests/unit/demoDb.test.js). */
function speicherAttrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  return {
    daten,
    async entities() { return Object.keys(daten); },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben(entity, datensatz) {
      daten[entity] = daten[entity] || [];
      const i = daten[entity].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[entity].push(structuredClone(datensatz));
      else daten[entity][i] = structuredClone(datensatz);
    },
    async schreibeViele(entity, datensaetze) { daten[entity] = structuredClone(datensaetze); },
    async loeschen(entity, recordId) { daten[entity] = (daten[entity] || []).filter((r) => r.id !== recordId); },
    async leeren(entity) { delete daten[entity]; },
    async meta(key, wert) {
      if (arguments.length === 1) return metaWerte[key];
      metaWerte[key] = wert;
      return wert;
    },
  };
}

/** An office with accounting, time and fee data and its own rule overrides. */
function buero() {
  const daten = { Project: [{ id: "p1", name: "Alpha" }] };
  for (const e of BUCHHALTUNG_ENTITAETEN) daten[e] = [{ id: `${e}-1` }];
  for (const e of ZEIT_HONORAR_ENTITAETEN) daten[e] = [{ id: `${e}-1`, project_id: "p1" }, { id: `${e}-2`, project_id: "p1" }];
  daten.Setting = [
    { id: "set-briefkopf", key: "briefkopf", value: { office: "Büro Muster" } },
    { id: "set-buchhaltung", key: SETTING_KEY, value: { rechtsform: "einzelunternehmen" } },
    { id: "set-zh", key: ZEIT_HONORAR_SETTING_KEY, value: { beispiel: true } },
    { id: "set-gk", key: "regel:zeit_honorar.gemeinkosten", value: { wert: 95 } },
  ];
  return daten;
}

test("Registry: genau eine Zeile zeiten, Label mit EN „Time & orders“", () => {
  const zeilen = EXPORT_BEREICHE.filter((b) => b.key === "zeiten");
  assert.equal(zeilen.length, 1);
  // 82-02: + dokumentBereiche ["buero"] — the fee PDFs travel only with this row (B-81-01).
  assert.deepEqual({ ...zeilen[0] }, { key: "zeiten", label: "Zeiten & Aufträge", entitaeten: ZEIT_HONORAR_ENTITAETEN, settingKeys: ZEIT_HONORAR_SETTING_KEYS, separat: null, dokumentBereiche: ["buero"] });
  const en = new Map(englischePaareAlle().map(([k, v]) => [k, v]));
  assert.equal(en.get("Zeiten & Aufträge"), "Time & orders");
});

test("Standard (kein Häkchen) → Weitergabe ohne 81-Sammlungen, ohne Marker und Regel-Overrides; Project und Briefkopf bleiben", async () => {
  const opt = exportOptionen([]);
  assert.equal(opt.art, "weitergabe");
  for (const e of ZEIT_HONORAR_ENTITAETEN) assert.ok(opt.ohne.includes(e), e);
  for (const k of ZEIT_HONORAR_SETTING_KEYS) assert.ok(opt.ohneSettingKeys.includes(k), k);
  setzeSpeicher(speicherAttrappe(buero()));
  const { obj } = await projektAlsBlob("Test", opt);
  for (const e of ZEIT_HONORAR_ENTITAETEN) assert.ok(!(e in obj.daten), `${e} darf nicht in der Weitergabe stehen`);
  const keys = (obj.daten.Setting || []).map((s) => s.key);
  assert.deepEqual(keys, ["briefkopf"]);
  assert.equal(obj.daten.Project.length, 1);
  assert.ok(!JSON.stringify(obj).includes("zeit_honorar"));
});

test("Sicherung nur mit allen Häkchen; buchhaltung + zeiten ohne personal bleibt Weitergabe", async () => {
  assert.equal(exportOptionen(["buchhaltung"]).art, "weitergabe");
  assert.equal(exportOptionen(["buchhaltung", "zeiten"]).art, "weitergabe");
  const alle = exportOptionen(EXPORT_BEREICHE.map((b) => b.key));
  assert.equal(alle.art, "sicherung");
  for (const e of PERSONAL_EXPORT_BEREICH.entitaeten) assert.ok(alle.ohne.includes(e), `${e} bleibt separat`);
  setzeSpeicher(speicherAttrappe(buero()));
  const { obj } = await projektAlsBlob("Test", alle);
  for (const e of ZEIT_HONORAR_ENTITAETEN) assert.equal(obj.daten[e]?.length, 2, `${e} in der Sicherung`);
  assert.ok((obj.daten.Setting || []).some((s) => s.key === "regel:zeit_honorar.gemeinkosten"));
  // 82-01: the three rows of phase 82 travel in a backup too.
  assert.deepEqual(obj.bereiche, ["buchhaltung", "zeiten", "fristen", "schriftverkehr", "rechte"]);
});

test("Import der Weitergabe-Datei: lokale Zeitbuchungen und Override-Zeilen bleiben, Projekte werden ersetzt", async () => {
  setzeSpeicher(speicherAttrappe(buero()));
  const { obj } = await projektAlsBlob("Weitergabe", exportOptionen([]));
  // A second office imports it: its own 81 data must survive.
  const anderes = buero();
  anderes.Project = [{ id: "p9", name: "Eigenes" }];
  anderes.Zeitbuchung.push({ id: "Zeitbuchung-3", project_id: "p9" });
  setzeSpeicher(speicherAttrappe(anderes));
  const opt = importOptionen(obj);
  assert.ok(opt.behalten.includes("zeiten"));
  await uebernehmeProjekt(obj, opt);
  const nachher = await demoDbAuslesen();
  assert.deepEqual(nachher.Project, [{ id: "p1", name: "Alpha" }]);
  assert.equal(nachher.Zeitbuchung.length, 3, "Zahl der Zeitbuchungen unverändert");
  assert.ok(nachher.Setting.some((s) => s.key === "regel:zeit_honorar.gemeinkosten"));
  assert.ok(nachher.Setting.some((s) => s.key === ZEIT_HONORAR_SETTING_KEY));
});

test("Gegenprobe 80: keine Datei enthält Kostensatz oder eine andere Personal-Entität", async () => {
  const start = buero();
  for (const e of PERSONAL_EXPORT_BEREICH.entitaeten) start[e] = [{ id: `${e}-x` }];
  assert.ok(PERSONAL_EXPORT_BEREICH.entitaeten.includes("Kostensatz"));
  for (const gewaehlt of [[], ["buchhaltung"], ["zeiten"], EXPORT_BEREICHE.map((b) => b.key)]) {
    setzeSpeicher(speicherAttrappe(start));
    const { obj } = await projektAlsBlob("Test", exportOptionen(gewaehlt));
    for (const e of PERSONAL_EXPORT_BEREICH.entitaeten) assert.ok(!(e in obj.daten), `${e} bei ${gewaehlt.join("+") || "nichts"}`);
  }
});
