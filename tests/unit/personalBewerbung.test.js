// personalBewerbung.test.js — Pipeline-Stufen, Übergänge und Löschuhr der
// Bewerbung (Plan 80-08, Behavior 1, 2, 6). regelWert liest die echten
// HR_REGELN (Muster: personalFristen.test.js) statt eines handgeschriebenen
// Werte-Duplikats.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import {
  STUFEN, darfWechseln, naechsteStufe, vorigeStufe, loeschenAb,
  FELDER_BEWERBUNG, normalisiereBewerbung, entscheidungMitArt, absageText,
} from "@/lib/people/bewerbung.js";

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

describe("bewerbung — Behavior 1: Stufen und Übergänge", () => {
  it("STUFEN.length === 9", () => {
    assert.equal(STUFEN.length, 9);
  });
  it("darfWechseln folgt der offenen Kette plus den Endstufen", () => {
    assert.equal(darfWechseln("gespraech_1", "zusage"), false);
    assert.equal(darfWechseln("angebot", "zusage"), true);
    assert.equal(darfWechseln("absage", "sichtung"), false);
    assert.equal(darfWechseln("arbeitsprobe", "absage"), true);
  });
  it("naechsteStufe/vorigeStufe sind rein positional", () => {
    assert.equal(naechsteStufe("eingang"), "sichtung");
    assert.equal(vorigeStufe("sichtung"), "eingang");
    assert.equal(naechsteStufe("zusage"), null);
  });
});

describe("bewerbung — Behavior 2: loeschenAb (DSGVO-Löschuhr, DS-13)", () => {
  it("Basis = Entscheidung + aufbewahrung_bewerbung_monate (6)", () => {
    assert.equal(loeschenAb({ entscheidung: { art: "absage", am: "2026-03-15" } }, regelWert), "2026-09-15");
  });
  it("gültiger Talentpool verlängert auf dessen Ende", () => {
    const b = { entscheidung: { art: "absage", am: "2026-03-15" }, talentpool: { eingewilligt_am: "2026-03-15", bis: "2027-09-30" } };
    assert.equal(loeschenAb(b, regelWert), "2027-09-30");
  });
  it("Widerruf ersetzt das Talentpool-Ende durch das Widerrufsdatum (max mit der AGG-Frist)", () => {
    const b = {
      entscheidung: { art: "absage", am: "2026-03-15" },
      talentpool: { eingewilligt_am: "2026-03-15", bis: "2027-09-30", widerrufen_am: "2026-10-01" },
    };
    assert.equal(loeschenAb(b, regelWert), "2026-10-01");
  });
  it("B-2 aus dem Seed (Absage 2026-06-30, Talentpool bis 2027-09-30) mit Widerruf 2026-10-01 — die AGG-Frist läuft weiter", () => {
    const b = {
      entscheidung: { art: "absage", am: "2026-06-30" },
      talentpool: { eingewilligt_am: "2026-06-30", bis: "2027-09-30", widerrufen_am: "2026-10-01" },
    };
    assert.equal(loeschenAb(b, regelWert), "2026-12-30");
  });
  it("eine offene Bewerbung (keine Entscheidung) hat keine Löschfrist", () => {
    assert.equal(loeschenAb({ entscheidung: {} }, regelWert), null);
    assert.equal(loeschenAb({}, regelWert), null);
  });
});

describe("bewerbung — Behavior 6 (DS-06): FELDER_BEWERBUNG ohne bisheriges_gehalt", () => {
  it("FELDER_BEWERBUNG.oben enthält bisheriges_gehalt nicht", () => {
    assert.ok(!FELDER_BEWERBUNG.oben.includes("bisheriges_gehalt"));
  });
  it("normalisiereBewerbung verwirft bisheriges_gehalt und konfession", () => {
    const aus = normalisiereBewerbung({ vorname: "A", bisheriges_gehalt: 5000, konfession: "x" });
    assert.equal(aus.vorname, "A");
    assert.equal("bisheriges_gehalt" in aus, false);
    assert.equal("konfession" in aus, false);
  });
});

describe("bewerbung — Entscheidung im Formular (Review-Nachtrag 80-08)", () => {
  it("zurück auf „Offen“ leert die ganze Entscheidung, kein verwaistes Datum bleibt", () => {
    const vorher = { art: "absage", am: "2026-09-27", absage_versandt_am: "2026-09-28" };
    assert.deepEqual(entscheidungMitArt(vorher, ""), {});
    assert.deepEqual(normalisiereBewerbung({ entscheidung: entscheidungMitArt(vorher, undefined) }).entscheidung, {});
  });
  it("Wechsel Absage -> Zusage behält am/grund, verwirft absage_versandt_am", () => {
    const aus = entscheidungMitArt({ art: "absage", am: "2026-09-27", grund: "x", absage_versandt_am: "2026-09-28" }, "zusage");
    assert.deepEqual(aus, { art: "zusage", am: "2026-09-27", grund: "x" });
  });
  it("erste Auswahl aus einer leeren Entscheidung setzt nur art", () => {
    assert.deepEqual(entscheidungMitArt({}, "absage"), { art: "absage" });
    assert.deepEqual(entscheidungMitArt(null, "zurueckgezogen"), { art: "zurueckgezogen" });
  });
});

describe("bewerbung — absageText nutzt den Büronamen aus dem Briefkopf", () => {
  it("mit Briefkopf steht der Büroname im Text", () => {
    const text = absageText({ vorname: "Paula", nachname: "Muster" }, { office: "Planwerk Musterstadt" });
    assert.ok(text.includes("Interesse an Planwerk Musterstadt"));
    assert.ok(text.includes("Paula Muster"));
  });
  it("ohne Briefkopf (oder leerer Büroname) der neutrale Rückfall", () => {
    assert.ok(absageText({ vorname: "A" }, null).includes("Interesse an unserem Büro"));
    assert.ok(absageText({ vorname: "A" }, { office: "  " }).includes("Interesse an unserem Büro"));
  });
});
