// personalUebersicht.test.js — View-Model des Personal-Überblicks (Plan 80-04,
// Task 3). Behavior 9 gegen den 80-02-Seed, verschoben mit
// personalSeedVerschieben(seed, '2026-09-27') (Bezug ist bereits 2026-09-27,
// also unverändert — die Funktion wird trotzdem aufgerufen, wie der Plan verlangt).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { personalUebersicht } from "@/lib/people/uebersicht.js";
import { personalFristen } from "@/lib/people/fristen.js";
import { personalkostenMonat } from "@/lib/people/kosten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";

// ESLint's parser does not yet accept import-attribute syntax ("with { type:
// 'json' }") — read + parse instead, same pattern as personalSeed.test.js.
const REPO = path.resolve(import.meta.dirname, "../..");
const roherSeed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));

const HEUTE = "2026-09-27";
const seed = personalSeedVerschieben(roherSeed, HEUTE);
// 80-08: der frühere handgeschriebene Stand-in (nur wochenstunden_standard)
// reichte nicht mehr, sobald recruiting.loeschung_ueberfaellig über
// bewerbung.js loeschenAb() personal.aufbewahrung_bewerbung_monate braucht —
// jetzt die echten HR_REGELN, Muster wie personalFristen.test.js.
/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

describe("personalUebersicht — Seed @ 2026-09-27", () => {
  const uebersicht = personalUebersicht(seed, HEUTE, regelWert);

  it("team: aktiv 3, im_eintritt 1, inhaber_gesellschafter 1", () => {
    assert.equal(uebersicht.team.aktiv, 3);
    assert.equal(uebersicht.team.im_eintritt, 1);
    assert.equal(uebersicht.team.inhaber_gesellschafter, 1);
  });
  it("beschaeftigte 2 (die Inhaberin zählt weder hier noch bei der Kopfzahl)", () => {
    assert.equal(uebersicht.team.beschaeftigte, 2);
  });
  it("vzae 1.5 (P-003 40h + P-004 20h = 60h / 40h Standard)", () => {
    assert.equal(uebersicht.team.vzae, 1.5);
  });
  it("kopfzahl_kschg 1.5 (1 + 0.5) und kleinbetrieb true", () => {
    assert.equal(uebersicht.team.kopfzahl_kschg, 1.5);
    assert.equal(uebersicht.team.kleinbetrieb, true);
  });
  // Plan 80-08, Behavior 7: loeschung_ueberfaellig kommt additiv hinzu —
  // B-1 (Absage 2026-03-15, kein Talentpool) ist mit Basis 2026-09-15 am
  // Stichtag 2026-09-27 überfällig; B-2 hat einen gültigen Talentpool bis
  // 2027-09-30 (noch nicht überfällig), B-3/B-4 sind offen (keine Entscheidung).
  it("recruiting: 2 Stellen offen, 2 Bewerbungen aktiv, 1 Löschung überfällig", () => {
    assert.equal(uebersicht.recruiting.stellen_offen, 2);
    assert.equal(uebersicht.recruiting.bewerbungen_aktiv, 2);
    assert.equal(uebersicht.recruiting.loeschung_ueberfaellig, 1);
  });
  it("eintritte: ein Vorgang für P-005, Stichtag 2026-11-02, 5 von 13 erledigt", () => {
    assert.equal(uebersicht.eintritte.length, 1);
    const [v] = uebersicht.eintritte;
    assert.equal(v.mitarbeiter_id, "P-005");
    assert.equal(v.stichtag, "2026-11-02");
    assert.equal(v.erledigt, 5);
    assert.equal(v.gesamt, 13);
  });
  // 80-06 Task 3, Behavior 10: das Ergebnisobjekt wächst nur additiv — team,
  // recruiting und eintritte (oben) bleiben exakt wie in 80-04, faellig kommt
  // NEU hinzu und ist identisch mit einem direkten personalFristen()-Aufruf
  // mit denselben Eingaben.
  it("faellig ist gleich personalFristen(seed, HEUTE, regelWert) (additiv), 4 Einträge nach 80-08", () => {
    assert.equal(uebersicht.faellig.length, 4);
    assert.deepEqual(uebersicht.faellig, personalFristen(seed, HEUTE, regelWert));
  });

  // 80-10 Task 4, Behavior additiv: personalkosten (Monat aus `heute` abgeleitet)
  // und sicherung_tage (aus dem übergebenen letzteSicherung-Wert, die Funktion
  // selbst liest personalMeta nicht — s. Dateikopf).
  it("personalkosten ist gleich personalkostenMonat(heute.slice(0,7), seed, regelWert)", () => {
    assert.deepEqual(uebersicht.personalkosten, personalkostenMonat("2026-09", seed, regelWert));
  });
  it("sicherung_tage ist null ohne letzteSicherung, sonst die Differenz in Tagen", () => {
    assert.equal(uebersicht.sicherung_tage, null);
    const mitSicherung = personalUebersicht(seed, HEUTE, regelWert, { letzteSicherung: "2026-09-17" });
    assert.equal(mitSicherung.sicherung_tage, 10);
  });
});
