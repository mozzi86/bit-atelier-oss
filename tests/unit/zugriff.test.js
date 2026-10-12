// 82-02: access of a session (ermittleZugriff), shell filters, export rows per
// role, project view before the archive filter, loader projection, source guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ermittleZugriff, ANSICHT_ALS_SCHLUESSEL } from "@core/lib/zugriffErmitteln.js";
import { projekteNachZugriff, sichtbareDokumente } from "@core/lib/rechte.js";
import { sichtbareProjekte } from "@core/lib/projektArchiv.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { navFlach } from "@/navigation.js";
import { EXPORT_BEREICHE, exportOptionen } from "@/lib/exportBereiche.js";
import { exportBereicheFuer, EXPORT_ZEILEN_MODULE, paletteEintraege, weiterMitFuer } from "@/lib/zugriffFilter.js";
import { contacts } from "../../packages/nova-core/server/seed-data.js";
import { SEED82_ANKER, SICHTBARE_PROJEKTE_JE_ROLLE } from "./helpers/seed82Erwartung.mjs";

const PERSONAL_SEED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const saat = () => beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal: personalSeedVerschieben(PERSONAL_SEED, SEED82_ANKER), kontakte: contacts });
const PROJEKTE = ["proj-1", "proj-2", "proj-3", "proj-4"].map((id) => ({ id, name: id }));

/** Assignments projection as the loader delivers it. */
function projektion(s) {
  return s.zuordnungen.map((z) => ({ mitarbeiter_id: z.mitarbeiter_id, alle: false, zuordnungen: z.projekt_zuordnungen.map((x) => ({ project_id: x.project_id, funktion: x.funktion, von: x.von, bis: x.bis })) }));
}
const als = (/** @type {string|null} */ id, extra = {}) => {
  const s = saat();
  return ermittleZugriff({ nutzerListe: s.Nutzer, zuordnungen: projektion(s), datenquelle: "express", gespeicherteNutzerId: id, ...extra });
};

test("ohne Nutzer-Datensätze: Inhaber, keine echte Anmeldung, kein Umschalter", () => {
  const r = ermittleZugriff({ nutzerListe: [], datenquelle: "express" });
  assert.equal(r.zugriff.rolle, "inhaber");
  assert.equal(r.zugriff.istEchteAnmeldung, false);
  assert.equal(r.kannWechseln, false);
  assert.equal(r.zugriff.projektIds, null);
  assert.equal(ANSICHT_ALS_SCHLUESSEL, "bit-atelier-ansicht-als");
});

test("Saat: Start als nu-1 (Inhaber); Ansicht als nu-3 → Mitarbeiter mit proj-1/proj-2", () => {
  const start = als(null);
  assert.equal(start.aktiverNutzerId, "nu-1");
  assert.equal(start.zugriff.rolle, "inhaber");
  assert.equal(start.kannWechseln, true);
  assert.deepEqual(start.nutzerListe.map((n) => n.id), ["nu-1", "nu-2", "nu-3", "nu-4"]);
  const ma = als("nu-3");
  assert.equal(ma.zugriff.rolle, "mitarbeiter");
  assert.ok(ma.zugriff.mitarbeiterId);
  assert.deepEqual([...(ma.zugriff.projektIds || [])].sort(), ["proj-1", "proj-2"]);
  assert.equal(projekteNachZugriff(PROJEKTE, ma.zugriff).length, SICHTBARE_PROJEKTE_JE_ROLLE.mitarbeiter);
  assert.equal(projekteNachZugriff(PROJEKTE, als("nu-4").zugriff).length, SICHTBARE_PROJEKTE_JE_ROLLE.buchhaltung);
});

test("aktiver Nutzer inaktiv oder gelöscht → erster aktiver Inhaber", () => {
  const s = saat();
  const ohne = ermittleZugriff({ nutzerListe: s.Nutzer.map((n) => (n.id === "nu-3" ? { ...n, aktiv: false } : n)), datenquelle: "express", gespeicherteNutzerId: "nu-3" });
  assert.equal(ohne.aktiverNutzerId, "nu-1");
  assert.equal(ermittleZugriff({ nutzerListe: s.Nutzer, datenquelle: "express", gespeicherteNutzerId: "gibt-es-nicht" }).aktiverNutzerId, "nu-1");
});

test("Person ohne Zuordnung (alle: true) sieht alle Projekte", () => {
  const s = saat();
  const nu3 = s.Nutzer.find((n) => n.id === "nu-3");
  const r = ermittleZugriff({ nutzerListe: s.Nutzer, zuordnungen: [{ mitarbeiter_id: nu3.mitarbeiter_id, alle: true, zuordnungen: [] }], datenquelle: "express", gespeicherteNutzerId: "nu-3" });
  assert.equal(r.zugriff.projektIds, null);
});

test("Cloud: kein Umschalter, Rolle aus der Serverrolle, Nutzer mit gleicher E-Mail nie ausweitend", () => {
  const s = saat();
  const owner = ermittleZugriff({ nutzerListe: s.Nutzer, datenquelle: "supabase", serverRolle: { role: "owner" }, user: { email: "nobody@example.org" } });
  assert.equal(owner.kannWechseln, false);
  assert.equal(owner.zugriff.rolle, "inhaber");
  const mitglied = ermittleZugriff({ nutzerListe: s.Nutzer, datenquelle: "supabase", serverRolle: { role: "mitglied" }, user: { email: "inhaberin@example.org" } });
  assert.equal(mitglied.aktiverNutzerId, "nu-1");
  // Server role 'mitglied' (projektleitung) + user 'inhaber' → never more than projektleitung.
  assert.equal(mitglied.zugriff.stufen.buchhaltung, "aus");
  assert.equal(mitglied.zugriff.stufen.personal, "aus");
});

test("Palette und Weiter-mit: Mitarbeiter ohne Buchhaltung, Personal und Einstellungen", () => {
  const ma = { ...als("nu-3").zugriff };
  const titel = paletteEintraege(navFlach, { zugriff: ma }).map((e) => e.title);
  for (const x of ["Buchhaltung", "Personal", "Einstellungen"]) assert.ok(!titel.includes(x), x);
  assert.ok(titel.includes("Projekte"));
  const inhaberTitel = paletteEintraege(navFlach, { zugriff: als(null).zugriff }).map((e) => e.title);
  assert.ok(inhaberTitel.includes("Buchhaltung"));
  // A step into accounting disappears for the employee.
  for (const p of navFlach.map((e) => e.url)) {
    for (const s of weiterMitFuer(p, ma, navFlach)) assert.ok(!s.ziel.startsWith("/Accounting"), `${p} → ${s.ziel}`);
  }
});

test("Exportzeilen je Rolle (Standard-Matrix): Mitarbeiter/Projektleitung keine, Buchhaltung fünf ohne rechte, Inhaber alle", () => {
  const keys = (/** @type {any} */ z) => exportBereicheFuer(EXPORT_BEREICHE, z).map((r) => r.key);
  assert.deepEqual(keys(als("nu-3").zugriff), []);
  assert.deepEqual(keys(als("nu-2").zugriff), []);
  assert.deepEqual(keys(als("nu-4").zugriff), ["buchhaltung", "personal", "zeiten", "fristen", "schriftverkehr"]);
  assert.deepEqual(keys(als(null).zugriff), EXPORT_BEREICHE.map((r) => r.key));
  for (const r of EXPORT_BEREICHE) assert.ok(r.key in EXPORT_ZEILEN_MODULE, `Zeile ${r.key} ohne Modulzuordnung`);
  // Options always against the full registry: what the employee may tick never yields a backup.
  const opt = exportOptionen(keys(als("nu-3").zugriff), EXPORT_BEREICHE);
  assert.equal(opt.art, "weitergabe");
  for (const e of ["Ausgangsrechnung", "Zeitbuchung", "Schreiben", "Nutzer"]) assert.ok(opt.ohne.includes(e), e);
  assert.notEqual(exportOptionen(keys(als("nu-4").zugriff), EXPORT_BEREICHE).art, "sicherung");
});

test("Projektsicht vor dem Archiv: Projektleitung mit archiviertem proj-2", () => {
  const pl = als("nu-2").zugriff;
  const roh = PROJEKTE.map((p) => (p.id === "proj-2" ? { ...p, archiviert_am: "2026-09-01" } : p));
  const alle = projekteNachZugriff(roh, pl);
  assert.deepEqual(alle.map((p) => p.id), ["proj-1", "proj-2"]);
  assert.deepEqual(sichtbareProjekte(alle, "proj-1").map((p) => p.id), ["proj-1"]);
  assert.equal(projekteNachZugriff(roh, als(null).zugriff).length, 4);
});

test("Dokumentlisten: kein Büro-, Buchhaltungs-, Schriftverkehrs- oder Personal-Dokument ohne Recht", () => {
  const docs = [{ bereich: "projekt", project_id: "proj-1" }, { bereich: "buero", project_id: "proj-1" }, { bereich: "buchhaltung" }, { bereich: "schriftverkehr" }, { bereich: "personal" }, { project_id: "proj-3" }];
  const ma = sichtbareDokumente(docs, als("nu-3").zugriff);
  assert.deepEqual(ma.map((d) => d.bereich ?? "ohne"), ["projekt", "schriftverkehr"]);
  assert.equal(sichtbareDokumente(docs, als(null).zugriff).length, 6);
});

test("Quellwächter: Lader ohne Personal-API, Provider in App vor ProjectProvider, Aufrufer filtern", () => {
  const lader = fs.readFileSync(new URL("../../src/lib/zugriffLader.js", import.meta.url), "utf8");
  assert.doesNotMatch(lader, /bitApi\.personal|\.personal\./);
  assert.match(lader, /ladeZuordnungsProjektion/);
  const app = fs.readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.ok(app.indexOf("<ZugriffProvider") < app.indexOf("<ProjectProvider"));
  for (const datei of ["src/pages/Dashboard.jsx", "src/pages/AIDashboard.jsx", "src/pages/AtelierDeveloper.jsx", "src/pages/Projects.jsx", "packages/nova-pdf/src/pages/BitAegis.jsx", "packages/nova-core/src/lib/ProjectContext.jsx"]) {
    const q = fs.readFileSync(new URL(`../../${datei}`, import.meta.url), "utf8");
    if (/Project\.list\(/.test(q)) assert.match(q, /projekteNachZugriff/, datei);
  }
  for (const datei of ["src/pages/Reports.jsx", "packages/nova-pdf/src/components/CloudDataManager.jsx", "packages/nova-pdf/src/components/PdfStudio.jsx", "packages/nova-pdf/src/pages/BitAegis.jsx"]) {
    assert.match(fs.readFileSync(new URL(`../../${datei}`, import.meta.url), "utf8"), /sichtbareDokumente/, datei);
  }
  const umschalter = fs.readFileSync(new URL("../../src/components/NutzerUmschalter.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(umschalter, /<input|type=["']password/, "no password or PIN field");
});
