// personalKosten.test.js — Plan 80-10, Task 4: personalkostenMonat(). Behavior
// 8 gegen den 80-02-Seed, verschoben mit personalSeedVerschieben (Bezug ist
// bereits 2026-09-27, unverändert).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { personalkostenMonat, AG_ANTEIL_RUECKFALL_PROZENT } from "@/lib/people/kosten.js";
import { ereignisse, monatsModell, tagesSaldo } from "@/lib/accounting/liquiditaet.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const roherSeed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));
const HEUTE = "2026-09-27";
const seed = personalSeedVerschieben(roherSeed, HEUTE);

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWertOhneZeitHonorar } = regelWerteAus([HR_GRUPPE], []);

describe("personalkostenMonat — Behavior 8 (Rückfall 21 %, keine Gruppe zeit_honorar)", () => {
  it("AG_ANTEIL_RUECKFALL_PROZENT ist 21", () => assert.equal(AG_ANTEIL_RUECKFALL_PROZENT, 21));

  it("2026-10: 5500 brutto (P-003 voll + P-004 anteilig-Stunde), 6655 AG, 2 Köpfe, faktor 1.21 rueckfall", () => {
    const r = personalkostenMonat("2026-10", seed, regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 5500);
    assert.equal(r.summe_ag_eur, 6655);
    assert.equal(r.koepfe, 2);
    assert.equal(r.stand, "soll");
    assert.equal(r.faktor, 1.21);
    assert.equal(r.faktor_quelle, "rueckfall");
    assert.ok(!("mitarbeiter_id" in r) && !("name" in r) && !("vorname" in r) && !("nachname" in r));
  });

  it("2026-11: P-005 tritt anteilig ein (29/30 Tage), 8496.67 brutto, 10280.97 AG, 3 Köpfe", () => {
    const r = personalkostenMonat("2026-11", seed, regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 8496.67);
    assert.equal(r.summe_ag_eur, 10280.97);
    assert.equal(r.koepfe, 3);
  });

  it("mit zeit_honorar.ag_anteil=20 (Stand nach Phase 81): faktor 1.2, summe_ag_eur 6600, faktor_quelle zeit_honorar.ag_anteil", () => {
    /** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
    const ZEIT_HONORAR_GRUPPE = {
      gruppe: "zeit_honorar", titel: "Zeit & Honorar",
      regeln: [{ id: "zeit_honorar.ag_anteil", label: "AG-Anteil", einheit: "Prozent", typ: "zahl", art: "buero", werte: [{ ab: "2000-01-01", wert: 20 }], stand: "2026-09-27", quelle: "Test" }],
      sichtbar: () => true, speicher: { art: "zeilen" },
    };
    const { wert } = regelWerteAus([HR_GRUPPE, ZEIT_HONORAR_GRUPPE], []);
    const r = personalkostenMonat("2026-10", seed, wert);
    assert.equal(r.faktor, 1.2);
    assert.equal(r.faktor_quelle, "zeit_honorar.ag_anteil");
    assert.equal(r.summe_ag_eur, 6600);
  });

  it("die Inhaberin (Entnahme) zählt nie mit — 0 Köpfe ohne Angestellte", () => {
    const nurInhaberin = { Mitarbeiter: seed.Mitarbeiter.filter((m) => m.id === "P-001"), Arbeitsvertrag: [], Gehaltsaenderung: [] };
    const r = personalkostenMonat("2026-10", nurInhaberin, regelWertOhneZeitHonorar);
    assert.equal(r.koepfe, 0);
    assert.equal(r.summe_brutto_eur, 0);
  });
});

// Review follow-up 80-10: the exit side of the proration. Before the fix a
// contract ending before the last day of the month was dropped entirely
// (aktiverVertrag checked the month end only) — 0 € instead of 15/31.
describe("personalkostenMonat — Austritt im Monat zählt anteilig (Review-Befund 80-10)", () => {
  /**
   * One synthetic employee (invented, project-neutral) with one contract and 3.100 €/month.
   * @param {Record<string, any>} vertrag fields overriding the default contract
   */
  const eine = (vertrag) => ({
    Mitarbeiter: [{ id: "P-T1", art: "angestellt", status: "aktiv" }],
    Arbeitsvertrag: [{ id: "V-T1", mitarbeiter_id: "P-T1", beginn: "2026-01-01", ende: null, status: "unterschrieben", ...vertrag }],
    Gehaltsaenderung: [{ id: "G-T1", mitarbeiter_id: "P-T1", gueltig_ab: "2026-01-01", brutto_eur: 3100 }],
  });

  it("Ende 2026-10-15 (gekündigt): Oktober 15/31 × 3.100 = 1.500,00 brutto, 1.815,00 AG, 1 Kopf", () => {
    const r = personalkostenMonat("2026-10", eine({ ende: "2026-10-15", status: "gekuendigt" }), regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 1500);
    assert.equal(r.summe_ag_eur, 1815);
    assert.equal(r.koepfe, 1);
  });

  it("derselbe Vertrag: September voll (3.100), November 0 und 0 Köpfe", () => {
    const daten = eine({ ende: "2026-10-15", status: "gekuendigt" });
    assert.equal(personalkostenMonat("2026-09", daten, regelWertOhneZeitHonorar).summe_brutto_eur, 3100);
    const nov = personalkostenMonat("2026-11", daten, regelWertOhneZeitHonorar);
    assert.equal(nov.summe_brutto_eur, 0);
    assert.equal(nov.koepfe, 0);
  });

  it("Ende am Monatsletzten 2026-10-31: voller Monat 3.100", () => {
    const r = personalkostenMonat("2026-10", eine({ ende: "2026-10-31", status: "gekuendigt" }), regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 3100);
  });

  it("Ende am Monatsersten 2026-10-01: 1/31 × 3.100 = 100,00", () => {
    const r = personalkostenMonat("2026-10", eine({ ende: "2026-10-01", status: "gekuendigt" }), regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 100);
    assert.equal(r.koepfe, 1);
  });

  it("Ein- und Austritt im selben Monat (2026-10-05 bis 2026-10-20): 16/31 × 3.100 = 1.600,00", () => {
    const daten = eine({ beginn: "2026-10-05", ende: "2026-10-20" });
    daten.Gehaltsaenderung[0].gueltig_ab = "2026-10-05";
    const r = personalkostenMonat("2026-10", daten, regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 1600);
    assert.equal(r.koepfe, 1);
  });

  it("ein Entwurf mit Ende im Monat zählt weiter nicht (Statusregel bleibt in aktiverVertrag)", () => {
    const r = personalkostenMonat("2026-10", eine({ ende: "2026-10-15", status: "entwurf" }), regelWertOhneZeitHonorar);
    assert.equal(r.summe_brutto_eur, 0);
    assert.equal(r.koepfe, 0);
  });
});

// Task 7b, Behavior 13: der additive Kontext-Abfluss zusatzAbfluesse in
// liquiditaet.js (79-10). Die Menge 665500 Cent = personalkostenMonat('2026-10').summe_ag_eur × 100 —
// derselbe Wert, den usePersonalkostenPlan.js tatsächlich in den Kontext einhängt.
describe("liquiditaet.js zusatzAbfluesse — Task 7b, Behavior 13", () => {
  const BASIS_KONTEXT = { daten: {}, einst: {}, saetze: {}, jahr: 2026, heute: "2026-09-27" };

  it("ohne zusatzAbfluesse ist monatsModell/ereignisse deepEqual dem Stand vor 80-10", () => {
    assert.deepEqual(ereignisse(BASIS_KONTEXT), []);
    const modell = monatsModell(BASIS_KONTEXT);
    assert.equal(modell.length, 12);
    for (const m of modell) assert.equal(m.abflussCent, 0);
  });

  it("mit zusatzAbfluesse: Oktober-Abfluss steigt um genau 665500 Cent, Posten am 2026-10-31 mit quelle/id", () => {
    const kontext = { ...BASIS_KONTEXT, zusatzAbfluesse: [{ monat: "2026-10", betragCent: 665500, art: "personal_plan" }] };
    const posten = ereignisse(kontext);
    assert.equal(posten.length, 1);
    assert.deepEqual(posten[0], { datum: "2026-10-31", art: "ausgabe", betragCent: 665500, quelle: "personal_plan", id: "personal_plan-2026-10", sicher: false });

    const modell = monatsModell(kontext);
    assert.equal(modell[9].abflussCent, 665500); // Index 9 = Oktober
    for (let i = 0; i < 12; i++) if (i !== 9) assert.equal(modell[i].abflussCent, 0);
  });

  it("tagesSaldo(2026-11-10) sinkt um denselben Betrag gegenüber ohne zusatzAbfluesse", () => {
    const ohne = tagesSaldo(BASIS_KONTEXT, "2026-11-10");
    const mit = tagesSaldo({ ...BASIS_KONTEXT, zusatzAbfluesse: [{ monat: "2026-10", betragCent: 665500, art: "personal_plan" }] }, "2026-11-10");
    assert.equal(ohne - mit, 665500);
  });

  it("ein Eintrag für 2025 wirkt im Jahr 2026 nicht", () => {
    const kontext = { ...BASIS_KONTEXT, zusatzAbfluesse: [{ monat: "2025-12", betragCent: 100000, art: "personal_plan" }] };
    assert.deepEqual(ereignisse(kontext), []);
  });
});
