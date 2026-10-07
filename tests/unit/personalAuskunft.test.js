// personalAuskunft.test.js — Plan 80-10, Task 1: LOESCH_REGELN (DS-10),
// personAuskunft, loeschPlan. Behavior 1–4 gegen den 80-02-Seed
// (personalSeedVerschieben mit Bezug 2026-09-27 = unverändert) plus einer
// konstruierten Austrittskopie für P-003.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { PERSONAL_ENTITAETEN } from "@core/api/personalEntitaeten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { LOESCH_REGELN, personAuskunft, loeschPlan } from "@/lib/people/auskunft.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const roherSeed = JSON.parse(fs.readFileSync(path.join(REPO, "packages/nova-core/src/api/personalSeed.json"), "utf8"));
const HEUTE = "2026-09-27";
const seed = personalSeedVerschieben(roherSeed, HEUTE);

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

describe("LOESCH_REGELN — DS-10-Wächter", () => {
  it("ein Eintrag je PERSONAL_ENTITAETEN, keiner mehr, keiner weniger", () => {
    assert.deepEqual(Object.keys(LOESCH_REGELN).sort(), [...PERSONAL_ENTITAETEN].sort());
  });
});

describe("personAuskunft — Behavior 2 (P-003, Seed @ 2026-09-27)", () => {
  const auskunft = personAuskunft({ mitarbeiterId: "P-003" }, seed, {});
  it("enthält genau die Datensätze von P-003", () => {
    assert.equal(auskunft.datensaetze.Mitarbeiter.length, 1);
    assert.equal(auskunft.datensaetze.Arbeitsvertrag.length, 1);
    assert.ok(auskunft.datensaetze.Gehaltsaenderung.length >= 1);
    for (const zeilen of Object.values(auskunft.datensaetze)) {
      for (const z of zeilen) {
        if (Object.prototype.hasOwnProperty.call(z, "mitarbeiter_id")) assert.equal(z.mitarbeiter_id, "P-003");
      }
    }
  });
  it("der JSON-Text enthält keinen Namen einer anderen Seed-Person", () => {
    const text = JSON.stringify(auskunft);
    assert.ok(!text.includes("Jonas"));
    assert.ok(!text.includes("Muster"));
    assert.ok(!text.includes("Probe"));
  });
});

describe("loeschPlan — Behavior 3 (Bewerbung B-1, überfällig)", () => {
  const plan = loeschPlan({ bewerbungId: "B-1" }, "frist", seed, HEUTE, regelWert);
  it("löscht B-1 (und ihre — hier keine — Personaldokumente), sperrt nichts, kein Grabstein", () => {
    assert.deepEqual(plan.loeschen, [{ entitaet: "Bewerbung", id: "B-1" }]);
    assert.deepEqual(plan.sperren, []);
    assert.equal(plan.grabstein, false);
  });
});

describe("loeschPlan — Behavior 4 (Mitarbeiter P-003, Austritt 2026-12-31)", () => {
  const seedMitAustritt = {
    ...seed,
    Mitarbeiter: seed.Mitarbeiter.map((m) => (m.id === "P-003" ? { ...m, status: "ausgeschieden", austritt: "2026-12-31" } : m)),
  };
  const plan = loeschPlan({ mitarbeiterId: "P-003" }, "austritt", seedMitAustritt, "2026-12-31", regelWert);

  it("Gehaltsänderungen gesperrt bis 2032-12-31 (2026 + 6 Jahre, § 41 EStG)", () => {
    const g = plan.sperren.find((s) => s.entitaet === "Gehaltsaenderung");
    assert.ok(g, "G-003 sollte gesperrt sein");
    assert.equal(g.bis, "2032-12-31");
  });
  it("Arbeitsvertrag gesperrt bis 2029-12-31 (2026 + 3 Jahre)", () => {
    const v = plan.sperren.find((s) => s.entitaet === "Arbeitsvertrag");
    assert.ok(v, "V-003 sollte gesperrt sein");
    assert.equal(v.bis, "2029-12-31");
  });
  it("grabstein true", () => {
    assert.equal(plan.grabstein, true);
  });
  it("Mitarbeiter steht NICHT in loeschen (Grabstein statt Löschung)", () => {
    assert.ok(!plan.loeschen.some((e) => e.entitaet === "Mitarbeiter"));
  });
  it("Fristquittungs-Zeilen der Person stehen in loeschen", () => {
    const seedMitQuittung = {
      ...seedMitAustritt,
      Fristquittung: [
        { id: "FQ-1", schluessel: "probezeit_ende:V-003:2026-10-21", quittiert_am: "2026-10-01" },
        { id: "FQ-2", schluessel: "probezeit_ende:V-004:2026-08-01", quittiert_am: "2026-07-15" }, // fremd (P-004) — darf NICHT erscheinen
      ],
    };
    const p = loeschPlan({ mitarbeiterId: "P-003" }, "austritt", seedMitQuittung, "2026-12-31", regelWert);
    assert.deepEqual(p.loeschen, [{ entitaet: "Fristquittung", id: "FQ-1" }]);
  });
});

describe("loeschPlan — ohne Sperre (jung, keine Historie) löscht den Mitarbeiter direkt", () => {
  it("ein Mitarbeiter ohne Verträge/Gehälter/Vorgänge wird sofort gelöscht, kein Grabstein", () => {
    const daten = { Mitarbeiter: [{ id: "X-1", austritt: "2026-09-01" }], Arbeitsvertrag: [], Gehaltsaenderung: [], Personalvorgang: [], Personaldokument: [], Fristquittung: [] };
    const plan = loeschPlan({ mitarbeiterId: "X-1" }, "austritt", daten, "2026-09-27", regelWert);
    assert.equal(plan.grabstein, false);
    assert.deepEqual(plan.loeschen, [{ entitaet: "Mitarbeiter", id: "X-1" }]);
    assert.deepEqual(plan.sperren, []);
  });
});
