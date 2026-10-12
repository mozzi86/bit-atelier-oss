// Unit tests of the settings area registry (80-01, the Settings half of behavior 12
// and behavior 17): keys, German aliases, visibility per context, palette entries.
//
// In:  src/lib/settings/bereiche.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EINSTELLUNGS_ALIAS, EINSTELLUNGS_BEREICHE, EINSTELLUNGS_REITER, paletteEintraege, sichtbareBereiche,
} from "@/lib/settings/bereiche.js";
import { waehleTab } from "@core/lib/tabParam.js";

const ALLE = { datenquelle: "serverlos", personalZugang: "erlaubt" };
const OHNE_PERSONAL = { datenquelle: "express", personalZugang: "keine-berechtigung" };
const CLOUD = { datenquelle: "supabase", personalZugang: "nur-lokal" };

// 82-01: area "access" (Nutzer & Rechte) registered before "system"; hidden until 82-02 fills it.
test("Behavior 12: zehn Bereiche mit englischen Schlüsseln in fester Reihenfolge", () => {
  assert.deepEqual([...EINSTELLUNGS_REITER], ["office", "display", "data", "privacy", "ai", "catalogs", "rules", "templates", "access", "system"]);
  assert.ok(Object.isFrozen(EINSTELLUNGS_BEREICHE) && Object.isFrozen(EINSTELLUNGS_BEREICHE[0]));
  for (const b of EINSTELLUNGS_BEREICHE) {
    assert.ok(b.titel && b.beschreibung && b.stichworte, `${b.key}: Text fehlt`);
    assert.ok(!b.stichworte.includes("];"), `${b.key}: "];" bricht die Tabellenlesung des Wächters`);
  }
  assert.equal(EINSTELLUNGS_BEREICHE.find((b) => b.key === "rules").titel, "Regelwerke", "E-16");
});

test("Behavior 12: jeder deutsche Alias löst über waehleTab auf seinen Schlüssel auf", () => {
  const faelle = { regeln: "rules", regelwerke: "rules", buchhaltung: "rules", buero: "office", briefkopf: "office",
    darstellung: "display", sprache: "display", daten: "data", sicherung: "data", datenschutz: "privacy",
    cookies: "privacy", ki: "ai", connections: "ai", kataloge: "catalogs", mengenregeln: "catalogs",
    vorlagen: "templates", personal: "templates", info: "system", Regeln: "rules",
    rechte: "access", rollen: "access", nutzer: "access", zugriff: "access" };
  for (const [alias, ziel] of Object.entries(faelle)) {
    assert.equal(waehleTab(alias, EINSTELLUNGS_REITER, "office", EINSTELLUNGS_ALIAS), ziel, alias);
  }
  const alle = EINSTELLUNGS_BEREICHE.flatMap((b) => b.alias);
  assert.equal(new Set(alle).size, alle.length, "Alias doppelt");
  assert.ok(alle.every((a) => !EINSTELLUNGS_REITER.includes(a)), "Alias gleich einem Schlüssel");
  // An alias of an area that is not allowed on the page falls back to the default.
  assert.equal(waehleTab("regeln", ["catalogs", "system"], "catalogs", EINSTELLUNGS_ALIAS), "catalogs");
  assert.equal(waehleTab("info", ["catalogs", "system"], "catalogs", EINSTELLUNGS_ALIAS), "system");
});

test("sichtbareBereiche: Regelwerke nur mit sichtbarem Regelwerk, Vorlagen nur mit Personal-Zugang", () => {
  // 82-02: access is visible without the role model; with zugriff only for a role that may read rechte (below).
  // 82-02: the area access "Nutzer & Rechte" is built and visible without the role model.
  assert.equal(sichtbareBereiche(ALLE).length, 10);
  assert.deepEqual(sichtbareBereiche(OHNE_PERSONAL).map((b) => b.key), ["office", "display", "data", "privacy", "ai", "catalogs", "rules", "access", "system"]);
  assert.deepEqual(sichtbareBereiche(CLOUD).map((b) => b.key), ["office", "display", "data", "privacy", "ai", "catalogs", "access", "system"]);
  assert.deepEqual(sichtbareBereiche(undefined).map((b) => b.key), ["office", "display", "data", "privacy", "ai", "catalogs", "rules", "access", "system"]);
});

test("Behavior 17: paletteEintraege je Kontext (DS-12)", () => {
  const alle = paletteEintraege(ALLE);
  assert.equal(alle.length, 10); // + access (82-02)
  assert.deepEqual(alle.find((e) => e.key === "system"), {
    key: "system", titel: "System & Info", beschreibung: "Build, Datenquelle, Rolle und Speicherzustand — nur lesen",
    stichworte: "Version, Build, Datenquelle, Rolle, Tastenkürzel, Dubletten, Info", ziel: "/Settings?tab=system",
  });
  const ohne = paletteEintraege(OHNE_PERSONAL);
  assert.equal(ohne.length, 9); // + access (82-02; without zugriff in the context it is visible)
  assert.ok(!ohne.some((e) => e.key === "templates"));
  const cloud = paletteEintraege(CLOUD);
  assert.equal(cloud.length, 8);
  assert.ok(!cloud.some((e) => e.key === "rules" || e.key === "templates"));
  for (const e of alle) assert.equal(e.ziel, `/Settings?tab=${e.key}`);
});

test("bereiche.js importiert weder React noch bitApi", () => {
  const quelle = fs.readFileSync(new URL("../../src/lib/settings/bereiche.js", import.meta.url), "utf8");
  assert.doesNotMatch(quelle, /from\s+["']react["']/);
  assert.doesNotMatch(quelle, /bitApi/);
});

test("82-02: Bereich access nur für eine Rolle mit dem Modul rechte", async () => {
  const { baueZugriff } = await import("@core/lib/rechte.js");
  const mit = (/** @type {string} */ rolle) => sichtbareBereiche({ ...ALLE, zugriff: baueZugriff({ rolle, datenquelle: "serverlos" }) }).map((b) => b.key);
  assert.ok(mit("inhaber").includes("access"));
  for (const r of ["projektleitung", "mitarbeiter", "buchhaltung"]) assert.ok(!mit(r).includes("access"), r);
});
