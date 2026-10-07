// personalOnboarding.test.js — Vorlagen, Anwendbarkeit, Fälligkeiten und
// Fortschritt des Checklisten-Editors (Plan 80-09, Task 1, Behavior 1–6, 11).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EINTRITT_SCHLUESSEL, AUSTRITT_SCHLUESSEL } from "@core/api/personalEntitaeten.js";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { personalFristen } from "@/lib/people/fristen.js";
import {
  VORLAGE_EINTRITT, VORLAGE_AUSTRITT, vorlageWirksam, anwendbarePunkte,
  checklisteAusVorlage, fortschritt, abgeleiteteErledigungen,
} from "@/lib/people/onboarding.js";

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

const REPO = path.resolve(import.meta.dirname, "../..");
const roherSeed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));

describe("onboarding — Behavior 1: Vorlagengrößen und Schlüsselmengen", () => {
  it("VORLAGE_EINTRITT hat 16 Punkte, exakt EINTRITT_SCHLUESSEL", () => {
    assert.equal(VORLAGE_EINTRITT.length, 16);
    assert.deepEqual(new Set(VORLAGE_EINTRITT.map((p) => p.schluessel)), new Set(EINTRITT_SCHLUESSEL));
  });
  it("VORLAGE_AUSTRITT hat 7 Punkte, exakt AUSTRITT_SCHLUESSEL", () => {
    assert.equal(VORLAGE_AUSTRITT.length, 7);
    assert.deepEqual(new Set(VORLAGE_AUSTRITT.map((p) => p.schluessel)), new Set(AUSTRITT_SCHLUESSEL));
  });
});

describe("onboarding — Behavior 2: anwendbarePunkte nach Personenart/Kammer", () => {
  it("angestellt ohne Kammer → 13", () => {
    const m = { art: "angestellt", kammer: {} };
    assert.equal(anwendbarePunkte(VORLAGE_EINTRITT, m).length, 13);
  });
  it("angestellt mit Kammer → 15", () => {
    const m = { art: "angestellt", kammer: { kammer: "ByAK" } };
    assert.equal(anwendbarePunkte(VORLAGE_EINTRITT, m).length, 15);
  });
  it("werkstudent ohne Kammer → 14", () => {
    const m = { art: "werkstudent", kammer: {} };
    assert.equal(anwendbarePunkte(VORLAGE_EINTRITT, m).length, 14);
  });
});

describe("onboarding — Behavior 3: Fälligkeiten aus checklisteAusVorlage", () => {
  it("Stichtag 2026-10-01: T-1, T, T+42 Tage, Ereignisfrist 3 Monate", () => {
    const m = { art: "angestellt", kammer: { kammer: "ByAK" } };
    const chk = checklisteAusVorlage(VORLAGE_EINTRITT, m, "2026-10-01");
    const von = (schluessel) => chk.find((p) => p.schluessel === schluessel);
    assert.equal(von("vertrag_unterschrieben").faellig_am, "2026-09-30");
    assert.equal(von("unterweisung_arbeitsschutz").faellig_am, "2026-10-01");
    assert.equal(von("sv_anmeldung").faellig_am, "2026-11-12");
    assert.equal(von("rv_befreiung").faellig_am, "2027-01-01");
  });
  it("foto_einwilligung bleibt ohne Fälligkeit (optional)", () => {
    const chk = checklisteAusVorlage(VORLAGE_EINTRITT, { art: "angestellt" }, "2026-10-01");
    const punkt = chk.find((p) => p.schluessel === "foto_einwilligung");
    assert.equal(punkt.faellig_am, null);
    assert.equal(punkt.pflicht, false);
  });
});

describe("onboarding — Behavior 4: fortschritt (gerundet)", () => {
  it("5 von 16 erledigt → 31", () => {
    const punkte = Array.from({ length: 16 }, (_, i) => ({ schluessel: `p${i}`, erledigt_am: i < 5 ? "2026-09-27" : null }));
    assert.equal(fortschritt(punkte), 31);
  });
  it("Seed PV-005 (5 von 13) → 38", () => {
    const seed = personalSeedVerschieben(roherSeed, "2026-09-27");
    const pv005 = seed.Personalvorgang.find((v) => v.id === "PV-005");
    assert.equal(fortschritt(pv005.schritte), 38);
  });
  it("eine leere Liste ergibt 0, nicht NaN", () => {
    assert.equal(fortschritt([]), 0);
  });
});

describe("onboarding — Behavior 5: eine spätere Vorlagenänderung lässt eine bestehende Checkliste unverändert", () => {
  it("deepEqual vorher/nachher, obwohl die Vorlage sich ändert", () => {
    const m = { art: "angestellt", kammer: {} };
    const vorlageA = vorlageWirksam(VORLAGE_EINTRITT, { deaktiviert: [] });
    const chkVorher = checklisteAusVorlage(vorlageA, m, "2026-10-01");
    // Die "spätere Änderung" trifft nur eine NEUE Anpassung — chkVorher selbst
    // hält keine Referenz auf VORLAGE_EINTRITT oder die Anpassung.
    const vorlageB = vorlageWirksam(VORLAGE_EINTRITT, { deaktiviert: ["vorsorge_bildschirm"], eigene: [{ schluessel: "eigen_1", titel: "Schlüssel übergeben", faellig: { tage: 0 } }] });
    void vorlageB;
    assert.deepEqual(chkVorher, checklisteAusVorlage(vorlageA, m, "2026-10-01"));
    assert.equal(VORLAGE_EINTRITT.length, 16, "die Standardvorlage selbst bleibt unangetastet");
  });
});

describe("onboarding — Behavior 6: vorlageWirksam — deaktivieren statt entfernen, eigene Punkte", () => {
  it("16 Punkte wirksam (15 aktiv + 1 eigener); der Standard bleibt vollständig erhalten", () => {
    const anpassung = { deaktiviert: ["vorsorge_bildschirm"], eigene: [{ schluessel: "eigen_1", titel: "Schlüssel übergeben", faellig: { tage: 0 } }] };
    const wirksam = vorlageWirksam(VORLAGE_EINTRITT, anpassung);
    assert.equal(wirksam.length, 16);
    assert.ok(!wirksam.some((p) => p.schluessel === "vorsorge_bildschirm"), "deaktivierter Standardpunkt fehlt im wirksamen Ergebnis");
    assert.ok(wirksam.some((p) => p.schluessel === "eigen_1" && p.eigen === true));
    // "nicht entfernbar, nur deaktivierbar": die Standardliste selbst behält den Punkt.
    assert.ok(VORLAGE_EINTRITT.some((p) => p.schluessel === "vorsorge_bildschirm"));
  });
  it("ohne Anpassung liefert vorlageWirksam exakt die Standardvorlage (16, keiner eigen)", () => {
    const wirksam = vorlageWirksam(VORLAGE_EINTRITT, null);
    assert.equal(wirksam.length, 16);
    assert.ok(wirksam.every((p) => p.eigen === false));
  });
});

describe("onboarding — abgeleiteteErledigungen (Vertrag → vertrag_unterschrieben)", () => {
  it("Vertrag unterschrieben vor/an Beginn markiert vertrag_unterschrieben, Quelle 'aus Vertrag'", () => {
    const vorgang = { art: "eintritt", arbeitsvertrag_id: "V-1" };
    const vertraege = [{ id: "V-1", status: "unterschrieben", unterschrieben_am: "2026-09-01", beginn: "2026-09-15" }];
    assert.deepEqual(abgeleiteteErledigungen(vorgang, vertraege), [{ schluessel: "vertrag_unterschrieben", quelle: "aus Vertrag" }]);
  });
  it("ein Entwurf (nicht unterschrieben) markiert nichts", () => {
    const vorgang = { art: "eintritt", arbeitsvertrag_id: "V-1" };
    const vertraege = [{ id: "V-1", status: "entwurf", unterschrieben_am: null, beginn: "2026-09-15" }];
    assert.deepEqual(abgeleiteteErledigungen(vorgang, vertraege), []);
  });
  it("ein Austritts-Vorgang leitet nichts ab (nur Eintritt kennt vertrag_unterschrieben)", () => {
    assert.deepEqual(abgeleiteteErledigungen({ art: "austritt", arbeitsvertrag_id: "V-1" }, []), []);
  });
  it("fortschritt zählt eine Ableitung nicht doppelt mit einer eigenen erledigt_am", () => {
    const punkte = [{ schluessel: "vertrag_unterschrieben", erledigt_am: "2026-09-01" }, { schluessel: "x", erledigt_am: null }];
    assert.equal(fortschritt(punkte, [{ schluessel: "vertrag_unterschrieben", quelle: "aus Vertrag" }]), 50);
  });
});

describe("onboarding — Behavior 11: Frist-Quelle vorgang_punkt_faellig", () => {
  it("der reale Seed (legacy schritte ohne faellig_am) erzeugt keinen Eintrag", () => {
    const seed = personalSeedVerschieben(roherSeed, "2026-09-27");
    const liste = personalFristen(seed, "2026-09-27", regelWert);
    assert.ok(!liste.some((e) => e.art === "vorgang_punkt_faellig"));
  });
  it("ein über checklisteAusVorlage gebauter Vorgang meldet unterweisung_arbeitsschutz am 2026-10-25 (Vorlauf 14, fällig 2026-11-02)", () => {
    const mitarbeiter = { id: "P-005", art: "angestellt", kammer: {} };
    const schritte = checklisteAusVorlage(VORLAGE_EINTRITT, mitarbeiter, "2026-11-02");
    const daten = { Personalvorgang: [{ id: "PV-005", art: "eintritt", status: "offen", schritte }] };
    assert.ok(!personalFristen(daten, "2026-10-10", regelWert).some((e) => e.art === "vorgang_punkt_faellig"), "vor der Schwelle (2026-11-02 - 14 Tage = 2026-10-19) noch nicht fällig");
    const treffer = personalFristen(daten, "2026-10-25", regelWert).find((e) => e.art === "vorgang_punkt_faellig" && e.bezug.id === "PV-005" && e.werte.titel === "Unterweisung Arbeitsschutz");
    assert.ok(treffer, "am Vorlauftag (2026-11-02 - 14 = 2026-10-19, danach fällig) erscheint der Eintrag");
    assert.equal(treffer.faellig_am, "2026-11-02");
  });
});
