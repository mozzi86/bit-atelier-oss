// Unit-Tests für packages/nova-designer/src/lib/funding.js (Förderprogramme, Phase 20).
//
// Belegte Sample-Werte: .planning/phases/20-f-rderantr-ge-reiter-.../20-01-PLAN.md:39-40
//   (7 Katalogeinträge mit Sätzen/Deckeln; Smoke: foerderSchaetzung(100000, 15, 60000)
//   = 15.000, foerderSchaetzung(1000000, 15, 60000) = 60.000,
//   kunstAmBauBetrag(2000000, 1) = 20.000, fristStatus("2026-08-01","2026-07-11") = "bald",
//   fristStatus("2026-06-01","2026-07-11") = "abgelaufen", fristStatus(null, …) = "keine";
//   fundingChecks nie "fail").
//
// HINWEIS (Befund FU-01, siehe .planning/BEFUNDE-AUS-TESTS.md): Die Lib kennt KEINE
// Kunst-am-Bau-Staffel nach Bausummen-Schwellen — `kunstAmBauBetrag` ist ein flacher
// %-Satz (Default 1 %, Panel-Slider 0,5–2 %). Getestet wird das IST-Verhalten.
//
// Determinismus: fristStatus nimmt "heute" IMMER als Parameter — kein Date.now in der Lib.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROGRAMM_KATALOG,
  TYP_LABEL,
  ANTRAG_STATUS,
  KUNST_PCT_MIN,
  KUNST_PCT_MAX,
  KUNST_PCT_DEFAULT,
  FRIST_WARN_TAGE,
  foerderSchaetzung,
  kunstAmBauBetrag,
  kunstAmBauSatzVorschlag,
  fristStatus,
  fundingChecks,
} from "@designer/lib/funding";

const HEUTE = "2026-07-11";

describe("funding.js — Programmkatalog", () => {
  it("7 Einträge mit den vereinbarten Keys", () => {
    assert.deepEqual(Object.keys(PROGRAMM_KATALOG), [
      "kfw_beg_wg", "beg_em", "kfw_kfn", "bafa_heizung", "landesprogramm", "kommunal", "kunst_am_bau",
    ]);
  });

  it("Sätze und Deckel entsprechen dem PLAN: BEG WG 5 %/150.000, BEG EM 15 %/60.000, KFN null/100.000, BAFA 30 %/21.000", () => {
    assert.equal(PROGRAMM_KATALOG.kfw_beg_wg.satz_pct, 5);
    assert.equal(PROGRAMM_KATALOG.kfw_beg_wg.max_betrag, 150000);
    assert.equal(PROGRAMM_KATALOG.beg_em.satz_pct, 15);
    assert.equal(PROGRAMM_KATALOG.beg_em.max_betrag, 60000);
    assert.equal(PROGRAMM_KATALOG.kfw_kfn.satz_pct, null);
    assert.equal(PROGRAMM_KATALOG.kfw_kfn.max_betrag, 100000);
    assert.equal(PROGRAMM_KATALOG.bafa_heizung.satz_pct, 30);
    assert.equal(PROGRAMM_KATALOG.bafa_heizung.max_betrag, 21000);
  });

  it("Landesprogramm 10 % ohne Deckel, kommunal 5 %/50.000", () => {
    assert.equal(PROGRAMM_KATALOG.landesprogramm.satz_pct, 10);
    assert.equal(PROGRAMM_KATALOG.landesprogramm.max_betrag, null);
    assert.equal(PROGRAMM_KATALOG.kommunal.satz_pct, 5);
    assert.equal(PROGRAMM_KATALOG.kommunal.max_betrag, 50000);
  });

  it("Kunst am Bau ist Typ \"pflicht\" (keine Förderung) mit 1 % und ohne Deckel", () => {
    assert.equal(PROGRAMM_KATALOG.kunst_am_bau.typ, "pflicht");
    assert.equal(PROGRAMM_KATALOG.kunst_am_bau.satz_pct, 1);
    assert.equal(PROGRAMM_KATALOG.kunst_am_bau.max_betrag, null);
    assert.match(PROGRAMM_KATALOG.kunst_am_bau.hinweis, /keine Förderung/);
  });

  it("jeder Eintrag hat Label, Träger, gültigen Typ und Hinweis", () => {
    for (const [key, p] of Object.entries(PROGRAMM_KATALOG)) {
      assert.ok(p.label && p.traeger && p.hinweis, `${key} unvollständig`);
      assert.ok(["zuschuss", "kredit", "pflicht"].includes(p.typ), `${key}: Typ ${p.typ}`);
      assert.ok(TYP_LABEL[p.typ], `${key}: kein TYP_LABEL für ${p.typ}`);
    }
  });

  it("Antragsstatus-Workflow: geplant → eingereicht → bewilligt / abgelehnt", () => {
    assert.deepEqual(Object.keys(ANTRAG_STATUS), ["geplant", "eingereicht", "bewilligt", "abgelehnt"]);
  });

  it("Kunst-am-Bau-Band 0,5–2 % mit Default 1 % (flacher Satz, keine Staffel — FU-01)", () => {
    assert.equal(KUNST_PCT_MIN, 0.5);
    assert.equal(KUNST_PCT_MAX, 2);
    assert.equal(KUNST_PCT_DEFAULT, 1);
  });
});

describe("funding.js — foerderSchaetzung()", () => {
  it("belegte Sample-Werte: 100.000 · 15 % = 15.000 €; über dem Deckel greift 60.000 €", () => {
    assert.equal(foerderSchaetzung(100000, 15, 60000), 15000);
    assert.equal(foerderSchaetzung(1000000, 15, 60000), 60000);
  });

  it("Deckel exakt: genau am Deckel wird nicht gekappt", () => {
    assert.equal(foerderSchaetzung(400000, 15, 60000), 60000);
    assert.equal(foerderSchaetzung(400001, 15, 60000), 60000);
    assert.equal(foerderSchaetzung(399999, 15, 60000), 59999.85);
  });

  it("null/undefined/leerer Deckel bedeutet OHNE Deckel (nicht 0)", () => {
    assert.equal(foerderSchaetzung(1000000, 15, null), 150000);
    assert.equal(foerderSchaetzung(1000000, 15, undefined), 150000);
    assert.equal(foerderSchaetzung(1000000, 15, ""), 150000);
  });

  it("Deckel 0 ist ein echter Deckel ⇒ 0 €", () => {
    assert.equal(foerderSchaetzung(1000000, 15, 0), 0);
  });

  it("Härtung: leere/negative Eingaben ⇒ 0, immer endlich und ≥ 0", () => {
    assert.equal(foerderSchaetzung("", "", null), 0);
    assert.ok(Number.isFinite(foerderSchaetzung("", "", null)));
    assert.equal(foerderSchaetzung(-100000, 15, null), 0);
    assert.equal(foerderSchaetzung(100000, -15, null), 0);
    assert.equal(foerderSchaetzung(NaN, NaN, NaN), 0);
    assert.equal(foerderSchaetzung(), 0);
  });

  it("Härtung: absurde Werte bleiben endlich (kein Infinity)", () => {
    const v = foerderSchaetzung(Number.MAX_VALUE, 100, null);
    assert.ok(Number.isFinite(v), `nicht endlich: ${v}`);
  });
});

describe("funding.js — kunstAmBauBetrag()", () => {
  it("belegter Sample-Wert: 2.000.000 € bei 1 % ⇒ 20.000 €", () => {
    assert.equal(kunstAmBauBetrag(2000000, 1), 20000);
  });

  it("FU-01 behoben: ohne expliziten Satz greift die Bundes-Staffel, nicht mehr pauschal 1 %", () => {
    // 2 Mio < 20 Mio ⇒ 1,5 % (vorher: immer 1 %)
    assert.equal(kunstAmBauBetrag(2000000), 30000);
    // Explizit gesetzter Satz schlägt die Staffel — freie Eingabe bleibt möglich
    assert.equal(kunstAmBauBetrag(2000000, KUNST_PCT_DEFAULT), 20000);
  });

  it("explizite Sätze rechnen weiterhin linear (Bandgrenzen 0,5 % und 2 %)", () => {
    assert.equal(kunstAmBauBetrag(2000000, 0.5), 10000);
    assert.equal(kunstAmBauBetrag(2000000, 2), 40000);
    assert.equal(kunstAmBauBetrag(20000000, 1), 200000);
    assert.equal(kunstAmBauBetrag(100000000, 1), 1000000);
    const sprung = kunstAmBauBetrag(20000001, 1) - kunstAmBauBetrag(20000000, 1);
    assert.ok(Math.abs(sprung - 0.01) < 1e-6, `mit explizitem Satz kein Staffelsprung: ${sprung}`);
  });

  it("FU-01: Staffelgrenzen exakt nach BMWSB 07/2024 (< 20 Mio 1,5 % · 20–100 Mio 1,0 % · > 100 Mio 0,5 %)", () => {
    const pct = (k) => kunstAmBauSatzVorschlag(k)?.pct;
    assert.equal(pct(19_999_999), 1.5);
    assert.equal(pct(20_000_000), 1.0, "genau 20 Mio gehört in die Mittelstufe");
    assert.equal(pct(100_000_000), 1.0, "genau 100 Mio gehört noch in die Mittelstufe");
    assert.equal(pct(100_000_001), 0.5);
    // Realprojekt Referenzprojekt: Bauwerkskosten 15,768 Mio ⇒ 1,5 % ⇒ 236.520 €
    assert.equal(pct(15_768_000), 1.5);
    assert.equal(Math.round(kunstAmBauBetrag(15_768_000)), 236520);
  });

  it("FU-01 Härtung: ohne Bauwerkskosten kein stiller Satz, sondern null", () => {
    for (const v of [0, -5, null, undefined, NaN, ""]) {
      assert.equal(kunstAmBauSatzVorschlag(v), null, `kunstAmBauSatzVorschlag(${String(v)})`);
    }
  });

  it("Härtung: 0/negativ/undefined/NaN ⇒ 0, nie NaN", () => {
    for (const v of [0, -2000000, undefined, null, NaN, ""]) {
      assert.equal(kunstAmBauBetrag(v), 0, `kunstAmBauBetrag(${String(v)})`);
    }
    assert.equal(kunstAmBauBetrag(2000000, -1), 0);
    assert.ok(Number.isFinite(kunstAmBauBetrag()));
  });
});

describe("funding.js — fristStatus() (deterministisch, \"heute\" als Parameter)", () => {
  it("belegte Sample-Werte: 21 Tage ⇒ \"bald\", Vergangenheit ⇒ \"abgelaufen\", ohne Frist ⇒ \"keine\"", () => {
    assert.equal(fristStatus("2026-08-01", HEUTE), "bald");
    assert.equal(fristStatus("2026-06-01", HEUTE), "abgelaufen");
    assert.equal(fristStatus(null, HEUTE), "keine");
  });

  it("Vorwarnzeit ist 30 Tage: Tag 29 ⇒ \"bald\", Tag 30 ⇒ \"ok\"", () => {
    assert.equal(FRIST_WARN_TAGE, 30);
    assert.equal(fristStatus("2026-08-09", HEUTE), "bald"); // 29 Tage
    assert.equal(fristStatus("2026-08-10", HEUTE), "ok");   // 30 Tage
  });

  it("Grenzwert exakt: heute selbst ist noch nicht abgelaufen (0 Tage ⇒ \"bald\")", () => {
    assert.equal(fristStatus(HEUTE, HEUTE), "bald");
    assert.equal(fristStatus("2026-07-10", HEUTE), "abgelaufen");
  });

  it("Zeitanteil wird abgeschnitten — Uhrzeiten ändern das Ergebnis nicht", () => {
    assert.equal(fristStatus("2026-08-01T23:59:59Z", "2026-07-11T00:00:01Z"), "bald");
    assert.equal(fristStatus("2026-07-11T23:59:59Z", "2026-07-11T00:00:01Z"), "bald");
  });

  it("DETERMINISMUS: identische Eingaben liefern immer dasselbe Ergebnis (kein Date.now)", () => {
    const a = fristStatus("2026-08-01", HEUTE);
    const b = fristStatus("2026-08-01", HEUTE);
    assert.equal(a, b);
    // und das Ergebnis hängt nachweislich von heuteIso ab
    assert.notEqual(fristStatus("2026-08-01", "2025-01-01"), a);
  });

  it("Härtung: fehlende/unparsebare Daten ⇒ \"keine\", nie \"abgelaufen\"", () => {
    for (const [f, h] of [[null, HEUTE], [undefined, HEUTE], ["", HEUTE], ["2026-08-01", null], ["quatsch", HEUTE], ["2026-08-01", "quatsch"], [{}, HEUTE]]) {
      assert.equal(fristStatus(f, h), "keine", `fristStatus(${String(f)}, ${String(h)})`);
    }
    assert.equal(fristStatus(), "keine");
  });
});

describe("funding.js — fundingChecks() Invarianten", () => {
  const ANTRAG = { programm_key: "beg_em", foerderfaehige_kosten: 100000, frist: "2026-12-31", status: "geplant" };

  it("liefert genau 3 Items mit den vereinbarten Keys", () => {
    const c = fundingChecks([ANTRAG], { oeffentlich: false, bausumme: 2000000 }, HEUTE);
    assert.equal(c.items.length, 3);
    assert.deepEqual(c.items.map((i) => i.key), ["kunst_am_bau", "fristen", "kosten"]);
  });

  it("privater Bauherr: Kunst am Bau ⇒ pass mit Hinweis \"kein öffentlicher Bauherr\"", () => {
    const c = fundingChecks([ANTRAG], { oeffentlich: false, bausumme: 2000000 }, HEUTE);
    const item = c.items.find((i) => i.key === "kunst_am_bau");
    assert.equal(item.status, "pass");
    assert.match(item.detail, /kein öffentlicher Bauherr/);
  });

  it("öffentlicher Bauherr OHNE Kunst-am-Bau-Antrag ⇒ warn mit Richtwert-Betrag", () => {
    const c = fundingChecks([ANTRAG], { oeffentlich: true, bausumme: 2000000 }, HEUTE);
    const item = c.items.find((i) => i.key === "kunst_am_bau");
    assert.equal(item.status, "warn");
    // FU-01: 2 Mio < 20 Mio ⇒ Staffelsatz 1,5 % ⇒ 30.000 € (vorher pauschal 1 % / 20.000 €)
    assert.match(item.detail, /30\.000 €/);
    assert.match(item.detail, /1,50 %/);
    assert.match(item.detail, /unter 20 Mio/);
  });

  it("FU-01: ohne Bauwerkskosten nennt die Prüfzeile keinen erfundenen Satz", () => {
    const c = fundingChecks([ANTRAG], { oeffentlich: true, bausumme: 0 }, HEUTE);
    const item = c.items.find((i) => i.key === "kunst_am_bau");
    assert.match(item.detail, /nicht ermittelbar/);
    assert.doesNotMatch(item.detail, /€/, "kein Betrag ohne Bemessungsgrundlage");
  });

  it("öffentlicher Bauherr MIT Kunst-am-Bau-Antrag ⇒ pass", () => {
    const antraege = [ANTRAG, { ...ANTRAG, programm_key: "kunst_am_bau" }];
    const c = fundingChecks(antraege, { oeffentlich: true, bausumme: 2000000 }, HEUTE);
    assert.equal(c.items.find((i) => i.key === "kunst_am_bau").status, "pass");
  });

  it("Fristen: nur OFFENE Anträge (geplant/eingereicht) zählen — bewilligt/abgelehnt nicht", () => {
    const kritisch = { ...ANTRAG, frist: "2026-06-01", status: "geplant" };
    assert.equal(fundingChecks([kritisch], {}, HEUTE).items.find((i) => i.key === "fristen").status, "warn");

    for (const status of ["bewilligt", "abgelehnt"]) {
      const entschieden = { ...kritisch, status };
      const c = fundingChecks([entschieden], {}, HEUTE);
      assert.equal(c.items.find((i) => i.key === "fristen").status, "pass", `Status ${status}`);
    }
  });

  it("Fristen: \"bald\" und \"abgelaufen\" gelten beide als kritisch, \"ok\"/\"keine\" nicht", () => {
    assert.equal(fundingChecks([{ ...ANTRAG, frist: "2026-08-01" }], {}, HEUTE).items.find((i) => i.key === "fristen").status, "warn");
    assert.equal(fundingChecks([{ ...ANTRAG, frist: "2026-06-01" }], {}, HEUTE).items.find((i) => i.key === "fristen").status, "warn");
    assert.equal(fundingChecks([{ ...ANTRAG, frist: "2026-12-31" }], {}, HEUTE).items.find((i) => i.key === "fristen").status, "pass");
    assert.equal(fundingChecks([{ ...ANTRAG, frist: null }], {}, HEUTE).items.find((i) => i.key === "fristen").status, "pass");
  });

  it("Singular/Plural in den Detailtexten ist korrekt", () => {
    const einer = fundingChecks([{ ...ANTRAG, frist: "2026-06-01" }], {}, HEUTE);
    assert.match(einer.items.find((i) => i.key === "fristen").detail, /1 offener Antrag/);
    const zwei = fundingChecks([{ ...ANTRAG, frist: "2026-06-01" }, { ...ANTRAG, frist: "2026-06-02" }], {}, HEUTE);
    assert.match(zwei.items.find((i) => i.key === "fristen").detail, /2 offene Anträge/);

    const ohneKosten1 = fundingChecks([{ ...ANTRAG, foerderfaehige_kosten: 0 }], {}, HEUTE);
    assert.match(ohneKosten1.items.find((i) => i.key === "kosten").detail, /1 Antrag ohne/);
  });

  it("Kosten: Anträge mit 0/leeren förderfähigen Kosten ⇒ warn mit Pflegehinweis", () => {
    for (const kosten of [0, null, undefined, "", -5000]) {
      const c = fundingChecks([{ ...ANTRAG, foerderfaehige_kosten: kosten }], {}, HEUTE);
      const item = c.items.find((i) => i.key === "kosten");
      assert.equal(item.status, "warn", `Kosten ${String(kosten)}`);
      assert.match(item.detail, /Beträge pflegen/);
    }
  });

  it("leere Antragsliste: alle 3 Items pass, Score 100", () => {
    const c = fundingChecks([], { oeffentlich: false, bausumme: 0 }, HEUTE);
    assert.equal(c.warns, 0);
    assert.equal(c.score, 100);
    assert.equal(c.verdict, "Konzept plausibel");
    assert.match(c.items.find((i) => i.key === "kosten").detail, /noch keine Anträge erfasst/);
  });

  it("INVARIANTE: fundingChecks liefert NIE Status \"fail\" (Haftung)", () => {
    const varianten = [
      [[], {}, HEUTE],
      [[ANTRAG], { oeffentlich: true, bausumme: 2000000 }, HEUTE],
      [[{ ...ANTRAG, frist: "2020-01-01", foerderfaehige_kosten: 0 }], { oeffentlich: true, bausumme: -1 }, HEUTE],
      [null, {}, HEUTE],
      [[null, undefined, {}], {}, HEUTE],
      [[ANTRAG], {}, null],
      [undefined, undefined, undefined],
    ];
    for (const [a, ctx, heute] of varianten) {
      const c = fundingChecks(a, ctx, heute);
      assert.equal(c.items.length, 3);
      for (const i of c.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Score konsistent, 0–100; Verdict folgt der Hinweiszahl", () => {
    for (const [a, ctx] of [[[], {}], [[ANTRAG], { oeffentlich: true, bausumme: 1e6 }], [[{ ...ANTRAG, foerderfaehige_kosten: 0, frist: "2020-01-01" }], {}]]) {
      const c = fundingChecks(a, ctx, HEUTE);
      const passes = c.items.filter((i) => i.status === "pass").length;
      assert.equal(c.score, Math.round((passes / c.items.length) * 100));
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.equal(c.warns, c.items.length - passes);
      assert.equal(c.verdict, c.warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel");
    }
  });

  it("Härtung: kein Array / kaputte Anträge / fehlendes heuteIso ⇒ keine NaN-Texte", () => {
    for (const c of [
      fundingChecks(),
      fundingChecks("keine Liste", {}, HEUTE),
      fundingChecks([null, undefined, { programm_key: null }], { oeffentlich: true, bausumme: NaN }, undefined),
    ]) {
      assert.equal(c.items.length, 3);
      for (const i of c.items) {
        assert.equal(typeof i.detail, "string");
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });
});
