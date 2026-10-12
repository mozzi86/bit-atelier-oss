// Phase 82 (82-01): the storage layer of phase 82 (src/lib/bueroOrga/speicher.js)
// — the cloud lock of E-03 without the release E-20 before any API call, the
// open entities in every build, one IndexedDB version bump for all seven stores
// with a bounded retry (H-4) — and the source guards: no other file names the
// four locked entities, the personnel API appears in phase-82 code only in the
// adapter, and no 82 personnel file writes an audit log or calls fetch.
//
// In:  speicher.js, entitaeten.js; source text of src/ and packages/. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bereitmachen, bueroEntitaet, ladeBueroOrga, verfuegbar } from "@/lib/bueroOrga/speicher.js";
import { BUERO_ORGA_ENTITAETEN } from "@/lib/bueroOrga/entitaeten.js";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/** Fake api counting calls. */
function attrappe() {
  const aufrufe = [];
  const entities = new Proxy({}, { get: (_, name) => new Proxy({}, { get: (_, op) => async (...args) => { aufrufe.push([name, op]); return op === "list" || op === "filter" ? [{ id: `${String(name)}-1` }] : { id: "x", ...(args[0] || {}) }; } }) });
  return { api: { entities }, aufrufe };
}

test("verfuegbar: Supabase nur mit Freigabe E-20", () => {
  assert.equal(verfuegbar("supabase", false), false);
  assert.equal(verfuegbar("supabase", true), true);
  assert.equal(verfuegbar("serverlos", false), true);
  assert.equal(verfuegbar("express", false), true);
});

test("bueroEntitaet: gesperrte Entitäten lehnen in der Cloud ohne Freigabe im Klartext ab, ohne API-Aufruf", async () => {
  const { api, aufrufe } = attrappe();
  const c = bueroEntitaet(api, "Schreiben", { datenquelle: "supabase", freigabe: false });
  for (const op of ["list", "filter", "get", "create", "update", "delete"]) {
    await assert.rejects(() => c[op]({}), /Schriftverkehr bleibt lokal – in der Cloud-Fassung erst nach Zugriffstrennung \(Phase 74\)/);
  }
  await assert.rejects(() => bueroEntitaet(api, "Nutzer", { datenquelle: "supabase", freigabe: false }).list(), /Nutzer & Rechte bleiben lokal/);
  assert.equal(aufrufe.length, 0);
  // Open entity and released cloud: the normal client.
  await bueroEntitaet(api, "Termin", { datenquelle: "supabase", freigabe: false }).list();
  await bueroEntitaet(api, "Schreiben", { datenquelle: "supabase", freigabe: true }).list();
  await bueroEntitaet(api, "Postbucheintrag", { datenquelle: "express" }).list();
  assert.equal(aufrufe.length, 3);
  assert.throws(() => bueroEntitaet(api, "Zeitbuchung", { datenquelle: "express" }), /gehört nicht/);
});

test("ladeBueroOrga: gesperrte Listen leer mit Grund, offene geladen", async () => {
  const { api } = attrappe();
  const r = await ladeBueroOrga(api, { datenquelle: "supabase", freigabe: false });
  assert.deepEqual(r.daten.Schreiben, []);
  assert.ok(r.gesperrt.Schreiben);
  assert.equal(r.daten.Termin.length, 1);
  assert.deepEqual(Object.keys(r.daten).sort(), [...BUERO_ORGA_ENTITAETEN].sort());
});

test("bereitmachen: ein Aufruf mit allen sieben Stores; Wiederholung nur bei „blockiert“, höchstens sechs Versuche; Express nichts", async () => {
  const aufrufe = [];
  await bereitmachen({ datenquelle: "serverlos", idb: { stelleStoresSicher: async (n) => { aufrufe.push(n); } }, warte: async () => {} });
  assert.equal(aufrufe.length, 1);
  assert.deepEqual([...aufrufe[0]].sort(), [...BUERO_ORGA_ENTITAETEN].sort());
  let n = 0;
  await bereitmachen({ datenquelle: "serverlos", idb: { stelleStoresSicher: async () => { n += 1; if (n < 3) throw new Error("IndexedDB blockiert"); } }, warte: async () => {} });
  assert.equal(n, 3);
  let m = 0;
  await assert.rejects(() => bereitmachen({ datenquelle: "serverlos", idb: { stelleStoresSicher: async () => { m += 1; throw new Error("IndexedDB blockiert"); } }, warte: async () => {} }));
  assert.equal(m, 6);
  let k = 0;
  await assert.rejects(() => bereitmachen({ datenquelle: "serverlos", idb: { stelleStoresSicher: async () => { k += 1; throw new Error("Speicher voll"); } }, warte: async () => {} }));
  assert.equal(k, 1, "other errors at once");
  let e = 0;
  await bereitmachen({ datenquelle: "express", idb: { stelleStoresSicher: async () => { e += 1; } } });
  assert.equal(e, 0);
});

/** All js/jsx files under src/ and packages/<x>/src. @returns {string[]} relative paths */
function quelldateien() {
  const aus = [];
  const laufe = (ordner) => {
    if (!fs.existsSync(ordner)) return;
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const voll = path.join(ordner, e.name);
      if (e.isDirectory()) laufe(voll);
      else if (/\.(jsx?|mjs)$/.test(e.name)) aus.push(path.relative(WURZEL, voll).replace(/\\/g, "/"));
    }
  };
  laufe(path.join(WURZEL, "src"));
  for (const p of fs.readdirSync(path.join(WURZEL, "packages"))) laufe(path.join(WURZEL, "packages", p, "src"));
  return aus;
}

test("Quelltext-Wächter: die vier gesperrten Entitäten nur in src/lib/bueroOrga/", () => {
  const verstoss = quelldateien().filter((d) => !d.startsWith("src/lib/bueroOrga/"))
    .filter((d) => /entities\??\.(Nutzer|Schreiben|Briefvorlage|Postbucheintrag)\b/.test(fs.readFileSync(path.join(WURZEL, d), "utf8")));
  assert.deepEqual(verstoss, []);
});

test("Quelltext-Wächter: Personal-API in 82-Dateien nur im Adapter; kein AuditLog/fetch in 82-Personaldateien", () => {
  const dateien82 = quelldateien().filter((d) => /^src\/(lib\/(bueroOrga|termine|abwesenheit|schriftverkehr)\/|components\/(bueroOrga|abwesenheit|rechte|termine|schriftverkehr)\/|pages\/(Deadlines|Absences|Correspondence)\.jsx)/.test(d));
  for (const d of dateien82) assert.doesNotMatch(fs.readFileSync(path.join(WURZEL, d), "utf8"), /bitApi\.personal|PERSONAL_ENTITAETEN|personalDb/, d);
  const ohneAudit = quelldateien().filter((d) => /^src\/(lib\/abwesenheit\/|components\/abwesenheit\/|components\/rechte\/|lib\/termine\/quellen\/(personal|abwesenheit)\.js|components\/dashboard\/MeineWoche\.jsx|lib\/people\/bueroOrgaPersonal\.js)/.test(d));
  for (const d of ohneAudit) assert.doesNotMatch(fs.readFileSync(path.join(WURZEL, d), "utf8"), /AuditLog|fetch\(/, d);
});
