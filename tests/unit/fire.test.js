// Unit-Tests für packages/nova-designer/src/lib/fire.js (Brandschutz, genehmigungsrelevant).
//
// Belegte Sample-Werte: .planning/phases/18-brandschutz-abnahme-bmz-reiter-brandmeldezentrale/
//   18-RESEARCH.md:214 (Standardgebäude: footArea 730 m², storeys 9, storeyHeight ≈ 3,44 m
//   ⇒ bgf 6.570 m², ngf ≈ 5.256 m², OKF ≈ 27,5 m, WE 70) und 18-RESEARCH.md:216-226 (KPI-Tabelle),
//   18-01-PLAN.md:158-165 (Assertions), 18-01-SUMMARY.md:63 (Ergebnis des Lib-Smokes).
//
// Diese Tests dokumentieren den IST-Zustand der Lib. Sie sind KEIN fachlicher Nachweis,
// dass die Werte der MBO/BayBO entsprechen (siehe HANDOFF Abschnitt E-3).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HOCHHAUS_GRENZE,
  DEFAULT_MAX_FLUCHTWEG,
  DEFAULT_FLAECHE_JE_TR,
  ANLEITER_TRAGBAR,
  ANLEITER_DREHLEITER,
  NE_GRENZE_GK,
  VERKAUFSSTAETTE_GRENZE,
  DEFAULT_FLAECHE_JE_MELDER,
  FEUERWIDERSTAND,
  SCHUTZUMFANG,
  FEUERWEHRPLAN_BESTANDTEILE,
  gebaeudeklasse,
  feuerwiderstand,
  istHochhaus,
  erfTreppenraeume,
  fluchtwegOk,
  anleiterZulaessig,
  schutzumfangFlaeche,
  melderAnzahl,
  sonderbauTrigger,
  feuerwehrplanErforderlich,
  feuerwehrplanStatus,
  brandChecks,
} from "@designer/lib/fire";

// Standardgebäude aus 18-RESEARCH.md:214.
const STD = {
  footArea: 730,
  storeys: 9,
  bgf: 6570,
  okf: 27.5,
  groessteNE: 730,
};

describe("fire.js — Richtwert-Konstanten (Vertrag mit den Panels)", () => {
  it("Hochhausgrenze ist 22 m", () => {
    assert.equal(HOCHHAUS_GRENZE, 22);
  });

  it("Fläche je notwendigem Treppenraum ist 1.600 m²", () => {
    assert.equal(DEFAULT_FLAECHE_JE_TR, 1600);
  });

  it("Anleitergrenzen sind 8 m (tragbar) und 23 m (Drehleiter)", () => {
    assert.equal(ANLEITER_TRAGBAR, 8);
    assert.equal(ANLEITER_DREHLEITER, 23);
  });

  it("Verkaufsstätten-Schwelle ist 800 m² — bewusst NICHT 400 m²", () => {
    assert.equal(VERKAUFSSTAETTE_GRENZE, 800);
    assert.notEqual(VERKAUFSSTAETTE_GRENZE, NE_GRENZE_GK);
  });

  it("NE-Grenze der Gebäudeklassen ist 400 m², Fluchtweg-Stichmaß 35 m, Fläche je Melder 40 m²", () => {
    assert.equal(NE_GRENZE_GK, 400);
    assert.equal(DEFAULT_MAX_FLUCHTWEG, 35);
    assert.equal(DEFAULT_FLAECHE_JE_MELDER, 40);
  });

  it("Schutzumfang-Faktoren DIN 14675: Kat.1 1,0 / Kat.2 0,4 / Kat.3 0,15 / Kat.4 0,05", () => {
    assert.equal(SCHUTZUMFANG.kat1.faktor, 1.0);
    assert.equal(SCHUTZUMFANG.kat2.faktor, 0.4);
    assert.equal(SCHUTZUMFANG.kat3.faktor, 0.15);
    assert.equal(SCHUTZUMFANG.kat4.faktor, 0.05);
  });

  it("Feuerwehrplan hat genau 5 Bestandteile (DIN 14095)", () => {
    assert.equal(Object.keys(FEUERWEHRPLAN_BESTANDTEILE).length, 5);
  });
});

describe("fire.js — gebaeudeklasse() (MBO §2 Abs. 3, vereinfacht)", () => {
  it("Standardgebäude OKF 27,5 m ⇒ GK 5", () => {
    assert.equal(gebaeudeklasse({ okf: STD.okf, groessteNE: STD.groessteNE, freistehend: false }), 5);
  });

  it("GK-Matrix 1–5 aus 18-01-PLAN.md", () => {
    assert.equal(gebaeudeklasse({ okf: 6, groessteNE: 300, freistehend: true }), 1);
    assert.equal(gebaeudeklasse({ okf: 6, groessteNE: 300, freistehend: false }), 2);
    assert.equal(gebaeudeklasse({ okf: 6, groessteNE: 600, freistehend: false }), 3);
    assert.equal(gebaeudeklasse({ okf: 12, groessteNE: 300 }), 4);
    assert.equal(gebaeudeklasse({ okf: 12, groessteNE: 600 }), 5);
  });

  it("Grenzwert 7 m: genau 7,0 gehört noch in die untere Stufe (> 7, nicht ≥ 7)", () => {
    assert.equal(gebaeudeklasse({ okf: 7, groessteNE: 300, freistehend: true }), 1);
    assert.equal(gebaeudeklasse({ okf: 7.01, groessteNE: 300, freistehend: true }), 4);
  });

  it("Grenzwert 13 m: genau 13,0 ⇒ GK 4 bei NE ≤ 400, erst > 13 ⇒ GK 5", () => {
    assert.equal(gebaeudeklasse({ okf: 13, groessteNE: 400 }), 4);
    assert.equal(gebaeudeklasse({ okf: 13.01, groessteNE: 400 }), 5);
  });

  it("Grenzwert NE 400 m²: genau 400 zählt als ≤ 400", () => {
    assert.equal(gebaeudeklasse({ okf: 10, groessteNE: 400 }), 4);
    assert.equal(gebaeudeklasse({ okf: 10, groessteNE: 400.01 }), 5);
    assert.equal(gebaeudeklasse({ okf: 5, groessteNE: 400, freistehend: false }), 2);
    assert.equal(gebaeudeklasse({ okf: 5, groessteNE: 400.01, freistehend: false }), 3);
  });

  it("Härtung: leerer Aufruf, 0, negativ und undefined liefern eine gültige GK ohne NaN", () => {
    for (const arg of [undefined, {}, { okf: 0, groessteNE: 0 }, { okf: -50, groessteNE: -50 }, { okf: NaN, groessteNE: NaN }]) {
      const gk = arg === undefined ? gebaeudeklasse() : gebaeudeklasse(arg);
      assert.ok(Number.isInteger(gk), `GK nicht ganzzahlig: ${gk}`);
      assert.ok(gk >= 1 && gk <= 5, `GK außerhalb 1–5: ${gk}`);
    }
  });

  it("negative Werte werden auf 0 geklemmt (num) — nicht als kleines Gebäude fehlinterpretiert", () => {
    assert.equal(gebaeudeklasse({ okf: -100, groessteNE: 300, freistehend: true }), 1);
  });
});

describe("fire.js — feuerwiderstand()", () => {
  it("GK 5 ⇒ feuerbeständig F90, GK 4 ⇒ F60, GK 3/2 ⇒ F30", () => {
    assert.match(feuerwiderstand(5), /F90|feuerbeständig/);
    assert.match(feuerwiderstand(4), /F60/);
    assert.match(feuerwiderstand(3), /F30/);
    assert.match(feuerwiderstand(2), /F30/);
  });

  it("GK 1 hat keine besonderen Anforderungen", () => {
    assert.equal(feuerwiderstand(1), FEUERWIDERSTAND[1]);
  });

  it("Härtung: unbekannte/leere GK fällt konservativ auf GK 5 (F90) zurück, nie undefined", () => {
    for (const gk of [undefined, null, 0, 99, "x", NaN]) {
      assert.equal(feuerwiderstand(gk), FEUERWIDERSTAND[5]);
    }
  });
});

describe("fire.js — istHochhaus() (Grenzwert 22,0 m exakt)", () => {
  it("Standardgebäude OKF 27,5 m ist ein Hochhaus", () => {
    assert.equal(istHochhaus(STD.okf), true);
  });

  it("genau 22,0 m ist KEIN Hochhaus (> 22, nicht ≥ 22)", () => {
    assert.equal(istHochhaus(22), false);
  });

  it("21,99 m ist kein Hochhaus, 22,01 m ist eines", () => {
    assert.equal(istHochhaus(21.99), false);
    assert.equal(istHochhaus(22.01), true);
  });

  it("Härtung: 0, negativ, undefined, leerer String und NaN sind kein Hochhaus", () => {
    for (const v of [0, -30, undefined, null, "", NaN, {}]) {
      assert.equal(istHochhaus(v), false, `istHochhaus(${String(v)}) sollte false sein`);
    }
  });
});

describe("fire.js — erfTreppenraeume()", () => {
  it("Standardgebäude (Hochhaus, 730 m²) ⇒ 2 notwendige Treppenräume", () => {
    assert.equal(erfTreppenraeume({ footArea: 730, hochhaus: true, anleiterOk: false }), 2);
  });

  it("kein Hochhaus + Anleiterung zulässig ⇒ Mindestzahl 1", () => {
    assert.equal(erfTreppenraeume({ footArea: 730, hochhaus: false, anleiterOk: true }), 1);
  });

  it("kein Hochhaus, keine Anleiterung ⇒ Mindestzahl 2", () => {
    assert.equal(erfTreppenraeume({ footArea: 730, hochhaus: false, anleiterOk: false }), 2);
  });

  it("Hochhaus erzwingt mind. 2, auch wenn Anleiterung zulässig wäre", () => {
    assert.equal(erfTreppenraeume({ footArea: 100, hochhaus: true, anleiterOk: true }), 2);
  });

  it("flächenabhängig: 3.400 m² / 1.600 m² ⇒ 3 Treppenräume", () => {
    assert.equal(erfTreppenraeume({ footArea: 3400, hochhaus: false, anleiterOk: true }), 3);
  });

  it("Grenzwert 1.600 m² je Treppenraum exakt: 1.600 ⇒ 1, 1.600,01 ⇒ 2", () => {
    assert.equal(erfTreppenraeume({ footArea: 1600, hochhaus: false, anleiterOk: true }), 1);
    assert.equal(erfTreppenraeume({ footArea: 1600.01, hochhaus: false, anleiterOk: true }), 2);
    assert.equal(erfTreppenraeume({ footArea: 3200, hochhaus: false, anleiterOk: true }), 2);
    assert.equal(erfTreppenraeume({ footArea: 3200.01, hochhaus: false, anleiterOk: true }), 3);
  });

  it("Härtung: flaecheJeTr = 0 bleibt endlich (safeDiv), kein Infinity", () => {
    const n = erfTreppenraeume({ footArea: 730, flaecheJeTr: 0, hochhaus: false, anleiterOk: true });
    assert.ok(Number.isFinite(n), `nicht endlich: ${n}`);
    assert.equal(n, 7300); // 730 / max(0.1, 0) = 7300
  });

  it("Härtung: negative/leere Eingaben ⇒ Mindestzahl, nie NaN oder 0", () => {
    for (const arg of [{}, { footArea: -500 }, { footArea: NaN }, { footArea: 730, flaecheJeTr: -1600 }]) {
      const n = erfTreppenraeume(arg);
      assert.ok(Number.isFinite(n) && n >= 1, `unplausibel: ${n}`);
    }
    assert.equal(erfTreppenraeume(), 2);
  });
});

describe("fire.js — fluchtwegOk() (Stichmaß)", () => {
  it("30 m ≤ 35 m zulässig, 40 m nicht", () => {
    assert.equal(fluchtwegOk(30, 35), true);
    assert.equal(fluchtwegOk(40, 35), false);
  });

  it("Grenzwert exakt: 35,0 m ist zulässig (≤), 35,01 m nicht", () => {
    assert.equal(fluchtwegOk(35, 35), true);
    assert.equal(fluchtwegOk(35.01, 35), false);
  });

  it("Default-Grenze ist DEFAULT_MAX_FLUCHTWEG (35 m)", () => {
    assert.equal(fluchtwegOk(DEFAULT_MAX_FLUCHTWEG), true);
    assert.equal(fluchtwegOk(DEFAULT_MAX_FLUCHTWEG + 0.5), false);
  });

  it("Härtung: 0/leer/negativ ist zulässig (nichts erfasst ⇒ 0 ≤ 35), maxZul = 0 ⇒ nur 0 zulässig", () => {
    assert.equal(fluchtwegOk(0, 35), true);
    assert.equal(fluchtwegOk(-10, 35), true);
    assert.equal(fluchtwegOk(undefined, 35), true);
    assert.equal(fluchtwegOk(0, 0), true);
    assert.equal(fluchtwegOk(1, 0), false);
  });
});

describe("fire.js — anleiterZulaessig()", () => {
  it("Standardgebäude: Drehleiter bei Brüstung 27,5 m ist unzulässig", () => {
    assert.equal(anleiterZulaessig(27.5, "drehleiter"), false);
  });

  it("tragbare Leiter ≤ 8 m, Drehleiter ≤ 23 m", () => {
    assert.equal(anleiterZulaessig(6, "tragbar"), true);
    assert.equal(anleiterZulaessig(10, "tragbar"), false);
    assert.equal(anleiterZulaessig(20, "drehleiter"), true);
  });

  it("Grenzwerte exakt: 8,0 / 8,01 (tragbar) und 23,0 / 23,01 (Drehleiter)", () => {
    assert.equal(anleiterZulaessig(8, "tragbar"), true);
    assert.equal(anleiterZulaessig(8.01, "tragbar"), false);
    assert.equal(anleiterZulaessig(23, "drehleiter"), true);
    assert.equal(anleiterZulaessig(23.01, "drehleiter"), false);
  });

  it("Art \"nein\" und unbekannte Arten sind nie über Anleiterung zulässig", () => {
    assert.equal(anleiterZulaessig(2, "nein"), false);
    assert.equal(anleiterZulaessig(2, "leiterwagen"), false);
    assert.equal(anleiterZulaessig(2, undefined), false);
  });

  it("Härtung: 0/negativ/undefined liefern boolesche Werte, nie NaN", () => {
    for (const b of [0, -5, undefined, null, NaN, ""]) {
      assert.equal(typeof anleiterZulaessig(b, "tragbar"), "boolean");
    }
    // 0/undefined ⇒ num() = 0 ⇒ 0 ≤ 8 ⇒ true (Konzeptverhalten: nichts erfasst = unkritisch)
    assert.equal(anleiterZulaessig(0, "tragbar"), true);
  });
});

describe("fire.js — schutzumfangFlaeche() / melderAnzahl() (DIN 14675)", () => {
  it("Standardgebäude Kat. 1 Vollschutz: 6.570 m² überwachte Fläche", () => {
    assert.equal(schutzumfangFlaeche(STD.bgf, "kat1"), 6570);
  });

  it("Kat. 2 Teilschutz: 6.570 · 0,4 = 2.628 m²", () => {
    assert.equal(schutzumfangFlaeche(STD.bgf, "kat2"), 2628);
  });

  it("unbekannte Kategorie fällt auf Faktor 1,0 zurück (konservativ)", () => {
    assert.equal(schutzumfangFlaeche(STD.bgf, "kat9"), 6570);
    assert.equal(schutzumfangFlaeche(STD.bgf, undefined), 6570);
  });

  it("Standardgebäude: ceil(6.570 / 40) = 165 Melder", () => {
    assert.equal(melderAnzahl(6570, 40), 165);
  });

  it("Default-Fläche je Melder ist 40 m² — melderAnzahl(6570) = 165", () => {
    assert.equal(melderAnzahl(6570), 165);
  });

  it("Härtung: flaecheJeMelder = 0 bleibt endlich (safeDiv), kein Infinity/NaN", () => {
    const n = melderAnzahl(6570, 0);
    assert.ok(Number.isFinite(n), `nicht endlich: ${n}`);
    assert.equal(n, 65700);
  });

  it("Härtung: leere/negative Eingaben ⇒ 0 Melder, nie NaN", () => {
    assert.equal(melderAnzahl(0, 40), 0);
    assert.equal(melderAnzahl(-500, 40), 0);
    assert.equal(melderAnzahl(undefined, 40), 0);
    assert.equal(melderAnzahl(NaN, NaN), 0);
    assert.ok(Number.isFinite(melderAnzahl()));
  });

  it("Härtung: negative Fläche/negative Melderfläche liefern keine negative Anzahl", () => {
    assert.ok(melderAnzahl(-6570, -40) >= 0);
  });
});

describe("fire.js — sonderbauTrigger()", () => {
  it("Standardgebäude (Wohnen, OKF 27,5 m) ist Sonderbau wegen Hochhaus", () => {
    const sb = sonderbauTrigger({ okf: STD.okf, nutzung: "wohnen", groessteNE: STD.groessteNE });
    assert.equal(sb.ist, true);
    assert.ok(sb.gruende.some((g) => /Hochhaus/.test(g)));
  });

  it("Wohnhaus OKF 10 m, NE 300 m² ist kein Sonderbau", () => {
    const sb = sonderbauTrigger({ okf: 10, nutzung: "wohnen", groessteNE: 300 });
    assert.equal(sb.ist, false);
    assert.deepEqual(sb.gruende, []);
  });

  it("Verkaufsstätte > 800 m² ist Sonderbau, genau 800 m² noch nicht (Verkaufsschwelle)", () => {
    assert.equal(sonderbauTrigger({ okf: 10, nutzung: "verkauf", groessteNE: 900 }).ist, true);
    const bei800 = sonderbauTrigger({ okf: 10, nutzung: "verkauf", groessteNE: 800 });
    // 800 löst die Verkaufsschwelle nicht aus, aber die NE-Regel (Nicht-Wohnen > 400 m²)
    assert.equal(bei800.ist, true);
    assert.ok(!bei800.gruende.some((g) => /Verkaufsstätte/.test(g)));
    assert.ok(bei800.gruende.some((g) => /Nutzungseinheit/.test(g)));
  });

  it("Versammlung und Beherbergung sind immer Sonderbau", () => {
    assert.equal(sonderbauTrigger({ okf: 5, nutzung: "versammlung", groessteNE: 100 }).ist, true);
    assert.equal(sonderbauTrigger({ okf: 5, nutzung: "beherbergung", groessteNE: 100 }).ist, true);
  });

  it("NE > 400 m² triggert nur bei Nicht-Wohnen", () => {
    assert.equal(sonderbauTrigger({ okf: 10, nutzung: "buero", groessteNE: 500 }).ist, true);
    assert.equal(sonderbauTrigger({ okf: 10, nutzung: "wohnen", groessteNE: 500 }).ist, false);
  });

  it("Grenzwert NE 400 m² exakt: 400 triggert nicht, 400,01 triggert (Nicht-Wohnen)", () => {
    assert.equal(sonderbauTrigger({ okf: 10, nutzung: "buero", groessteNE: 400 }).ist, false);
    assert.equal(sonderbauTrigger({ okf: 10, nutzung: "buero", groessteNE: 400.01 }).ist, true);
  });

  it("Härtung: leerer Aufruf liefert {ist:false, gruende:[]}", () => {
    const sb = sonderbauTrigger();
    assert.equal(sb.ist, false);
    assert.deepEqual(sb.gruende, []);
  });

  it("Härtung: negative NE / undefined Nutzung erzeugen keine Falschtreffer", () => {
    const sb = sonderbauTrigger({ okf: -10, nutzung: undefined, groessteNE: -900 });
    assert.equal(sb.ist, false);
  });
});

describe("fire.js — feuerwehrplanErforderlich() / feuerwehrplanStatus() (DIN 14095)", () => {
  it("BMA oder Sonderbau ⇒ Feuerwehrplan erforderlich", () => {
    assert.equal(feuerwehrplanErforderlich(true, false), true);
    assert.equal(feuerwehrplanErforderlich(false, true), true);
    assert.equal(feuerwehrplanErforderlich(true, true), true);
    assert.equal(feuerwehrplanErforderlich(false, false), false);
  });

  it("Härtung: undefined/0/leerer String ⇒ false (kein stilles true)", () => {
    assert.equal(feuerwehrplanErforderlich(undefined, undefined), false);
    assert.equal(feuerwehrplanErforderlich(0, ""), false);
  });

  it("Standardgebäude ohne Bestandteile: Status 0/5, nicht vollständig", () => {
    const s = feuerwehrplanStatus({});
    assert.equal(s.erfuellt, 0);
    assert.equal(s.gesamt, 5);
    assert.equal(s.vollstaendig, false);
  });

  it("alle 5 Bestandteile als \"ja\" ⇒ vollständig", () => {
    const s = feuerwehrplanStatus({
      uebersichtsplan: "ja", geschossplaene: "ja", legende: "ja", laufkarten: "ja", abstimmung: "ja",
    });
    assert.equal(s.erfuellt, 5);
    assert.equal(s.vollstaendig, true);
  });

  it("true und \"ja\" zählen, andere Wahrheitswerte (\"nein\", 1, \"x\") NICHT", () => {
    const s = feuerwehrplanStatus({ uebersichtsplan: true, geschossplaene: "nein", legende: 1, laufkarten: "x", abstimmung: {} });
    assert.equal(s.erfuellt, 1);
  });

  it("Härtung: leerer Aufruf und Fremdkeys ⇒ 0/5, kein NaN", () => {
    assert.equal(feuerwehrplanStatus().erfuellt, 0);
    assert.equal(feuerwehrplanStatus({ irgendwas: true }).erfuellt, 0);
    assert.equal(feuerwehrplanStatus({ irgendwas: true }).gesamt, 5);
  });
});

describe("fire.js — brandChecks() Invarianten", () => {
  const stdChecks = brandChecks({
    okf: 27.5, groessteNE: 730, freistehend: false, nutzung: "wohnen",
    laengsteFlucht: 30, maxFluchtweg: 35, anleiterArt: "drehleiter", bruestung: 27.5,
    flaecheJeTr: 1600, footArea: 730, bmaMode: "auto", schutzumfang: "kat1",
    ueberwachteFlaeche: 6570, flaecheJeMelder: 40, fwpMode: "auto", feuerwehrBestandteile: {},
  });

  it("liefert genau 7 Items mit den vereinbarten Keys", () => {
    assert.equal(stdChecks.items.length, 7);
    assert.deepEqual(
      stdChecks.items.map((i) => i.key),
      ["gk", "hochhaus", "fluchtweg", "rettungsweg2", "treppenraeume", "bma", "feuerwehrplaene"],
    );
  });

  it("Standardgebäude: hochhaus/rettungsweg2/feuerwehrplaene sind \"warn\", Verdict \"Konzept mit Hinweisen\"", () => {
    const byKey = Object.fromEntries(stdChecks.items.map((i) => [i.key, i.status]));
    assert.equal(byKey.hochhaus, "warn");
    assert.equal(byKey.rettungsweg2, "warn");
    assert.equal(byKey.feuerwehrplaene, "warn");
    assert.equal(stdChecks.verdict, "Konzept mit Hinweisen");
  });

  it("Standardgebäude: Score 57 %, 3 Hinweise (18-01-SUMMARY.md:79)", () => {
    assert.equal(stdChecks.score, 57);
    assert.equal(stdChecks.warns, 3);
  });

  it("Melderanzahl 165 steht im BMA-Detailtext", () => {
    const bma = stdChecks.items.find((i) => i.key === "bma");
    assert.match(bma.detail, /165 Melder/);
  });

  it("INVARIANTE: brandChecks liefert NIE Status \"fail\" (Haftung, T-18-04)", () => {
    const varianten = [
      {},
      { okf: 0 },
      { okf: 300, groessteNE: 99999, nutzung: "versammlung", laengsteFlucht: 999, footArea: 99999 },
      { okf: -50, groessteNE: -50, footArea: -50, laengsteFlucht: -50, maxFluchtweg: -50 },
      { okf: NaN, groessteNE: NaN, footArea: NaN, flaecheJeTr: 0, flaecheJeMelder: 0 },
      { anleiterArt: "nein", bmaMode: "ja", fwpMode: "nein", schutzumfang: "kat4" },
      { anleiterArt: "tragbar", bruestung: 4, okf: 6, footArea: 200, fwpMode: "auto" },
      { bmaMode: "nein", fwpMode: "ja", feuerwehrBestandteile: { uebersichtsplan: true } },
    ];
    for (const v of varianten) {
      const r = brandChecks(v);
      assert.ok(!r.items.some((i) => i.status === "fail"), `fail-Status bei ${JSON.stringify(v)}`);
      for (const i of r.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Score ist konsistent mit den Item-Status und immer 0–100", () => {
    for (const v of [{}, { okf: 27.5, footArea: 730 }, { okf: 300, nutzung: "versammlung" }]) {
      const r = brandChecks(v);
      const passes = r.items.filter((i) => i.status === "pass").length;
      assert.equal(r.score, Math.round((passes / r.items.length) * 100));
      assert.ok(r.score >= 0 && r.score <= 100);
      assert.equal(r.warns, r.items.length - passes);
    }
  });

  it("INVARIANTE: Verdict folgt der Hinweiszahl", () => {
    const mitHinweis = brandChecks({ okf: 27.5, footArea: 730 });
    assert.ok(mitHinweis.warns > 0);
    assert.equal(mitHinweis.verdict, "Konzept mit Hinweisen");

    const sauber = brandChecks({
      okf: 6, groessteNE: 300, freistehend: true, nutzung: "wohnen",
      laengsteFlucht: 20, anleiterArt: "tragbar", bruestung: 4, footArea: 400,
      bmaMode: "auto", fwpMode: "auto",
    });
    assert.equal(sauber.warns, 0);
    assert.equal(sauber.verdict, "Konzept plausibel");
    assert.equal(sauber.score, 100);
  });

  it("Härtung: leerer Aufruf liefert 7 Items, endlichen Score und keinen NaN-Text", () => {
    const r = brandChecks();
    assert.equal(r.items.length, 7);
    assert.ok(Number.isFinite(r.score));
    for (const i of r.items) {
      assert.equal(typeof i.detail, "string");
      assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter im Detailtext (${i.key}): ${i.detail}`);
    }
  });

  it("HI-02: fehlende Brüstung UND fehlende OKF ⇒ Anleiterbarkeit nicht bewertbar (kein stiller pass)", () => {
    const r = brandChecks({ okf: 0, bruestung: 0, anleiterArt: "drehleiter" });
    const rw2 = r.items.find((i) => i.key === "rettungsweg2");
    assert.equal(rw2.status, "warn");
    assert.match(rw2.detail, /nicht bewertbar/);
  });

  it("ME-02: baulicher 2. Rettungsweg (\"nein\") gilt als ok, reduziert aber die Treppenraum-Mindestzahl NICHT", () => {
    const r = brandChecks({ okf: 10, footArea: 500, anleiterArt: "nein", groessteNE: 300 });
    assert.equal(r.items.find((i) => i.key === "rettungsweg2").status, "pass");
    assert.match(r.items.find((i) => i.key === "treppenraeume").detail, /^2 notwendige/);
  });

  it("fehlende OKF bzw. Grundfläche werden als Pflegehinweis (warn) ausgegeben, nicht als pass", () => {
    const r = brandChecks({ okf: 0, footArea: 0 });
    assert.equal(r.items.find((i) => i.key === "gk").status, "warn");
    assert.match(r.items.find((i) => i.key === "gk").detail, /pflegen/);
    assert.equal(r.items.find((i) => i.key === "treppenraeume").status, "warn");
    assert.match(r.items.find((i) => i.key === "treppenraeume").detail, /pflegen/);
  });

  it("Hochhausgrenze im Check exakt bei 22,0 m: 22,0 ⇒ pass, 22,01 ⇒ warn", () => {
    assert.equal(brandChecks({ okf: 22, footArea: 500 }).items.find((i) => i.key === "hochhaus").status, "pass");
    assert.equal(brandChecks({ okf: 22.01, footArea: 500 }).items.find((i) => i.key === "hochhaus").status, "warn");
  });

  it("bmaMode \"nein\" unterdrückt die BMA-Pflicht auch beim Hochhaus (manueller Override)", () => {
    const r = brandChecks({ okf: 27.5, footArea: 730, bmaMode: "nein", fwpMode: "auto" });
    assert.match(r.items.find((i) => i.key === "bma").detail, /keine BMA-Pflicht/);
    // Sonderbau (Hochhaus) verlangt trotzdem Feuerwehrpläne
    assert.equal(r.items.find((i) => i.key === "feuerwehrplaene").status, "warn");
  });
});

describe("fire.js — fluchtwegLaenge() (Phase 34 Beispiel-Layer)", () => {
  it("Polylinie: Summe der Segmentlängen ({x,z}-Meter)", async () => {
    const { fluchtwegLaenge } = await import("@designer/lib/fire");
    // 3-4-5-Dreieck + 10 m Gerade = 5 + 10
    const pts = [{ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 13, z: 4 }];
    assert.equal(fluchtwegLaenge(pts), 15);
  });

  it("Härtung: <2 Punkte / null / kaputte Werte ⇒ 0 bzw. endlich", async () => {
    const { fluchtwegLaenge } = await import("@designer/lib/fire");
    assert.equal(fluchtwegLaenge(null), 0);
    assert.equal(fluchtwegLaenge([]), 0);
    assert.equal(fluchtwegLaenge([{ x: 1, z: 1 }]), 0);
    assert.ok(Number.isFinite(fluchtwegLaenge([{ x: 0, z: 0 }, { x: NaN, z: 2 }])));
  });
});
