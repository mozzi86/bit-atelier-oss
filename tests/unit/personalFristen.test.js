// personalFristen.test.js — abgeleitete Personal-Fristen (Plan 80-06, Task 3):
// Behavior 9 gegen den echten 80-02-Seed, verschoben mit
// personalSeedVerschieben(seed, '2026-09-27') (Bezug ist bereits 2026-09-27,
// die Funktion wird trotzdem aufgerufen, wie der Plan verlangt).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { personalFristen } from "@/lib/people/fristen.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const roherSeed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

describe("personalFristen — Behavior 9, Seed @ 2026-09-27", () => {
  const heute = "2026-09-27";
  const seed = personalSeedVerschieben(roherSeed, heute);

  // Plan 80-08, Behavior 3: bewerbung_loeschen (B-1, überfällig, faellig_am
  // 2026-09-15) kommt additiv hinzu und steht als frühestes Datum zuerst;
  // talentpool_ablauf (B-2, 2027-09-30) ist mit Vorlauf 30 Tage am Stichtag
  // noch nicht fällig, deshalb bleibt die Liste bei 4 statt 5 Einträgen.
  it("genau 4 Einträge in der Reihenfolge bewerbung_loeschen, resturlaub_hinweis, immatrikulation, probezeit_ende", () => {
    const liste = personalFristen(seed, heute, regelWert);
    assert.equal(liste.length, 4);
    assert.deepEqual(liste.map((e) => e.art), ["bewerbung_loeschen", "resturlaub_hinweis", "immatrikulation", "probezeit_ende"]);

    const bewerbung = liste[0];
    assert.equal(bewerbung.faellig_am, "2026-09-15");
    assert.equal(bewerbung.ueberfaellig, true);
    assert.equal(bewerbung.bezug.tab, "recruiting");
    assert.equal(bewerbung.bezug.id, "B-1");

    const resturlaub = liste[1];
    assert.equal(resturlaub.faellig_am, "2026-09-30");
    assert.equal(resturlaub.anzahl, 2);

    const immatrikulation = liste[2];
    assert.equal(immatrikulation.faellig_am, "2026-10-01");
    assert.equal(immatrikulation.bezug.id, "P-004");

    const probezeit = liste[3];
    assert.equal(probezeit.faellig_am, "2026-10-20");
    assert.equal(probezeit.bezug.id, "V-003");

    assert.ok(!liste.some((e) => e.art === "befristung_ende"), "befristung_ende ist noch nicht fällig");
    assert.ok(!liste.some((e) => e.art === "talentpool_ablauf"), "talentpool_ablauf (B-2, 2027-09-30) ist am Stichtag noch nicht fällig");
  });

  it("mit einer Fristquittung für probezeit_ende:V-003:2026-10-20 → 3 Einträge", () => {
    const seedMitQuittung = { ...seed, Fristquittung: [{ id: "FQ-1", schluessel: "probezeit_ende:V-003:2026-10-20", quittiert_am: heute }] };
    const liste = personalFristen(seedMitQuittung, heute, regelWert);
    assert.equal(liste.length, 3);
    assert.ok(!liste.some((e) => e.art === "probezeit_ende"));
  });

  it("am 2028-01-20 enthält die Liste befristung_ende (Vorlauf 97), aber nicht befristung_entscheidung (Vorlauf 42)", () => {
    // Eigenes, festes Fixture statt des verschobenen Seeds: personalSeedVerschieben
    // würde bei diesem weit entfernten Stichtag ALLE Daten des Seeds (inkl.
    // V-003.ende) um dieselbe Differenz verschieben — hier soll gezielt V-003s
    // originales Vertragsende (2028-04-20) unverändert gegen den späteren
    // Stichtag geprüft werden.
    const spaeterHeute = "2028-01-20";
    const daten = {
      Mitarbeiter: [],
      Arbeitsvertrag: [{ id: "V-003", mitarbeiter_id: "P-003", vertragsart: "befristet_ohne_sachgrund", status: "unterschrieben", beginn: "2026-04-21", ende: "2028-04-20" }],
      Gehaltsaenderung: [], Fristquittung: [],
    };
    const liste = personalFristen(daten, spaeterHeute, regelWert);
    assert.ok(liste.some((e) => e.art === "befristung_ende" && e.faellig_am === "2028-04-20"));
    assert.ok(!liste.some((e) => e.art === "befristung_entscheidung"));
  });

  // Plan 80-09: die Frist-Quelle vorgang_punkt_faellig — Behavior 11 (der
  // ausführliche Rechenweg mit Vorlauf/Schwelle steht in
  // personalOnboarding.test.js, das auch checklisteAusVorlage importiert; hier
  // nur die Bestätigung gegen den echten, unveränderten Seed).
  it("der reale Seed (PV-005, legacy schritte ohne faellig_am) erzeugt keinen vorgang_punkt_faellig-Eintrag", () => {
    const liste = personalFristen(seed, heute, regelWert);
    assert.ok(!liste.some((e) => e.art === "vorgang_punkt_faellig"));
  });
});
