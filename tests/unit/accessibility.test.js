// Unit-Tests für packages/nova-designer/src/lib/accessibility.js (Barrierefreiheit, DIN 18040).
//
// Belegte Sample-Werte: .planning/phases/19-barrierefreiheit-reiter-nachweise-nach-din-18040/
//   19-RESEARCH.md:223 (Standardgebäude: footArea 730 m², storeys 9, ngf ≈ 5.256 m²,
//   OKF ≈ 27,5 m ⇒ WE = round(5256/75) = 70, Aufzugspflicht ja) und 19-01-PLAN.md
//   (Smoke-Assertions: 70 WE erreichbar, 7 R-WE bei Quote 10 %).
//
// Diese Tests dokumentieren den IST-Zustand. Aufzugspflicht und Wohnungsquoten sind
// BUNDESLANDABHÄNGIG (siehe HANDOFF E-3) — hier wird nur die Lib-Logik festgeschrieben.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AUFZUG_GESCHOSS_GRENZE,
  AUFZUG_OKF_GRENZE,
  KABINE_BREITE,
  KABINE_TIEFE,
  BEWEGUNG_B,
  BEWEGUNG_R,
  TUER_BREITE_B,
  TUER_BREITE_R,
  TUER_HOEHE,
  FLUR_BREITE,
  WC_SEITLICH,
  DEFAULT_R_QUOTE,
  QM_JE_WE,
  aufzugPflicht,
  kabineOk,
  weAusNgf,
  weJeGeschoss,
  erfBarrierefreiErreichbar,
  erfRollstuhlgerecht,
  bewegungsflaeche,
  tuerBreiteOk,
  flurOk,
  sanitaerOk,
  bfChecks,
} from "@designer/lib/accessibility";

// Standardgebäude aus 19-RESEARCH.md:223.
const STD = { storeys: 9, okf: 27.5, ngf: 5256, we: 70 };

describe("accessibility.js — Richtwert-Konstanten", () => {
  it("Aufzugsgrenzen sind > 3 Vollgeschosse und OKF > 13 m", () => {
    assert.equal(AUFZUG_GESCHOSS_GRENZE, 3);
    assert.equal(AUFZUG_OKF_GRENZE, 13);
  });

  it("Kabinenmindestmaß DIN EN 81-70 Typ 2: 1,10 × 1,40 m", () => {
    assert.equal(KABINE_BREITE, 1.10);
    assert.equal(KABINE_TIEFE, 1.40);
  });

  it("Bewegungsflächen: B 1,20 m / R 1,50 m (DIN 18040-2)", () => {
    assert.equal(BEWEGUNG_B, 1.20);
    assert.equal(BEWEGUNG_R, 1.50);
  });

  it("Türmaße: B ≥ 0,80 / R ≥ 0,90 m Breite, Höhe 2,05 m; Flur 1,20 m; WC seitlich 0,90 m", () => {
    assert.equal(TUER_BREITE_B, 0.80);
    assert.equal(TUER_BREITE_R, 0.90);
    assert.equal(TUER_HOEHE, 2.05);
    assert.equal(FLUR_BREITE, 1.20);
    assert.equal(WC_SEITLICH, 0.90);
  });

  it("R-Quote-Default ist 0 % (neutral, LBO-abhängig), m² je WE ist 75", () => {
    assert.equal(DEFAULT_R_QUOTE, 0);
    assert.equal(QM_JE_WE, 75);
  });
});

describe("accessibility.js — aufzugPflicht() (ODER-Verknüpfung)", () => {
  it("Standardgebäude: 9 Vollgeschosse, OKF 27,5 m ⇒ Aufzugspflicht", () => {
    assert.equal(aufzugPflicht(STD.storeys, STD.okf), true);
  });

  it("3 Geschosse, OKF 9 m ⇒ keine Aufzugspflicht", () => {
    assert.equal(aufzugPflicht(3, 9), false);
  });

  it("OKF-Kriterium allein reicht: 3 Geschosse, OKF 14 m ⇒ Pflicht", () => {
    assert.equal(aufzugPflicht(3, 14), true);
  });

  it("Grenzwert Vollgeschosse exakt: 3 ⇒ keine Pflicht, 3,01/4 ⇒ Pflicht (> 3, nicht ≥ 3)", () => {
    assert.equal(aufzugPflicht(3, 0), false);
    assert.equal(aufzugPflicht(3.01, 0), true);
    assert.equal(aufzugPflicht(4, 0), true);
  });

  it("Grenzwert OKF exakt: 13,0 m ⇒ keine Pflicht, 13,01 m ⇒ Pflicht (> 13, nicht ≥ 13)", () => {
    assert.equal(aufzugPflicht(1, 13), false);
    assert.equal(aufzugPflicht(1, 13.01), true);
  });

  it("Härtung: 0/negativ/undefined/NaN ⇒ false, immer boolesch", () => {
    for (const [s, o] of [[0, 0], [-9, -27], [undefined, undefined], [NaN, NaN], ["", ""], [null, null]]) {
      assert.equal(aufzugPflicht(s, o), false, `aufzugPflicht(${String(s)}, ${String(o)})`);
    }
  });
});

describe("accessibility.js — kabineOk() (DIN EN 81-70 Typ 2)", () => {
  it("genau 1,10 × 1,40 m ist ausreichend (≥, nicht >)", () => {
    assert.equal(kabineOk(1.10, 1.40), true);
  });

  it("1,00 × 1,30 m ist zu klein", () => {
    assert.equal(kabineOk(1.0, 1.3), false);
  });

  it("nur eine Achse unterschritten reicht zum Nichtbestehen", () => {
    assert.equal(kabineOk(1.09, 1.40), false);
    assert.equal(kabineOk(1.10, 1.39), false);
  });

  it("Härtung: 0/negativ/undefined ⇒ false (fehlende Maße sind NICHT erfüllt, ME-05)", () => {
    assert.equal(kabineOk(0, 0), false);
    assert.equal(kabineOk(undefined, undefined), false);
    assert.equal(kabineOk(-1.5, -2), false);
    assert.equal(kabineOk(NaN, NaN), false);
  });
});

describe("accessibility.js — weAusNgf() / weJeGeschoss()", () => {
  it("Standardgebäude: round(5.256 / 75) = 70 WE", () => {
    assert.equal(weAusNgf(STD.ngf), 70);
  });

  it("mindestens 1 WE, auch bei NGF 0 oder negativ", () => {
    assert.equal(weAusNgf(0), 1);
    assert.equal(weAusNgf(-5000), 1);
    assert.equal(weAusNgf(undefined), 1);
    assert.equal(weAusNgf(NaN), 1);
  });

  it("70 WE auf 9 Geschosse ⇒ 8 WE je Geschoss (aufgerundet)", () => {
    assert.equal(weJeGeschoss(70, 9), 8);
  });

  it("Härtung: storeys = 0 bleibt endlich (Math.max(1, …)) — 70 WE auf 1 Geschoss", () => {
    const n = weJeGeschoss(70, 0);
    assert.ok(Number.isFinite(n), `nicht endlich: ${n}`);
    assert.equal(n, 70);
  });

  it("Härtung: leere/negative Eingaben ⇒ 0, nie NaN", () => {
    assert.equal(weJeGeschoss(0, 0), 0);
    assert.equal(weJeGeschoss(-70, -9), 0);
    assert.ok(Number.isFinite(weJeGeschoss(undefined, undefined)));
  });
});

describe("accessibility.js — erfBarrierefreiErreichbar() (MBO §50)", () => {
  it("mit Aufzug: alle 70 WE müssen barrierefrei erreichbar sein", () => {
    assert.equal(erfBarrierefreiErreichbar(70, 9, true), 70);
  });

  it("ohne Aufzug: nur die WE eines Geschosses (70/9 ⇒ 8)", () => {
    assert.equal(erfBarrierefreiErreichbar(70, 9, false), 8);
  });

  it("Härtung: storeys = 0 ohne Aufzug bleibt endlich", () => {
    const n = erfBarrierefreiErreichbar(70, 0, false);
    assert.ok(Number.isFinite(n), `nicht endlich: ${n}`);
    assert.equal(n, 70);
  });

  it("Härtung: ohne Aufzug immer mind. 1 WE; mit Aufzug und 0 WE genau 0", () => {
    assert.equal(erfBarrierefreiErreichbar(0, 9, false), 1);
    assert.equal(erfBarrierefreiErreichbar(0, 9, true), 0);
    assert.equal(erfBarrierefreiErreichbar(-70, 9, true), 0);
  });

  it("Härtung: leerer Aufruf liefert eine endliche Zahl", () => {
    assert.ok(Number.isFinite(erfBarrierefreiErreichbar()));
  });
});

describe("accessibility.js — erfRollstuhlgerecht()", () => {
  it("70 WE bei Quote 10 % ⇒ 7 rollstuhlgerechte WE", () => {
    assert.equal(erfRollstuhlgerecht(70, 10), 7);
  });

  it("Quote 0 % oder fehlend ⇒ 0 (neutraler Default, LBO-abhängig)", () => {
    assert.equal(erfRollstuhlgerecht(70, 0), 0);
    assert.equal(erfRollstuhlgerecht(70), 0);
  });

  it("wird immer aufgerundet: 70 WE bei 1 % ⇒ 1, bei 11 % ⇒ 8", () => {
    assert.equal(erfRollstuhlgerecht(70, 1), 1);
    assert.equal(erfRollstuhlgerecht(70, 11), 8);
  });

  it("Härtung: negative Quote/WE ⇒ 0, nie negativ, nie NaN", () => {
    assert.equal(erfRollstuhlgerecht(70, -10), 0);
    assert.equal(erfRollstuhlgerecht(-70, 10), 0);
    assert.equal(erfRollstuhlgerecht(NaN, NaN), 0);
    assert.ok(Number.isFinite(erfRollstuhlgerecht()));
  });
});

describe("accessibility.js — Maßprüfungen je Ausbaustufe", () => {
  it("bewegungsflaeche(): B 1,20 m, R 1,50 m; unbekannte Stufe fällt auf B zurück", () => {
    assert.equal(bewegungsflaeche("B"), 1.2);
    assert.equal(bewegungsflaeche("R"), 1.5);
    assert.equal(bewegungsflaeche(undefined), 1.2);
    assert.equal(bewegungsflaeche("X"), 1.2);
  });

  it("tuerBreiteOk(): R verlangt 0,90 m, B genügt 0,80 m", () => {
    assert.equal(tuerBreiteOk(0.90, "R"), true);
    assert.equal(tuerBreiteOk(0.80, "R"), false);
    assert.equal(tuerBreiteOk(0.80, "B"), true);
  });

  it("tuerBreiteOk(): Grenzwerte exakt (≥) — 0,899 R und 0,799 B fallen durch", () => {
    assert.equal(tuerBreiteOk(0.899, "R"), false);
    assert.equal(tuerBreiteOk(0.799, "B"), false);
  });

  it("tuerBreiteOk() Härtung: 0/negativ/undefined ⇒ false", () => {
    for (const v of [0, -0.9, undefined, NaN, ""]) {
      assert.equal(tuerBreiteOk(v, "R"), false);
      assert.equal(tuerBreiteOk(v, "B"), false);
    }
  });

  it("flurOk(): 1,20 m genügt, 1,00 m nicht; 1,199 m fällt durch", () => {
    assert.equal(flurOk(1.20), true);
    assert.equal(flurOk(1.0), false);
    assert.equal(flurOk(1.199), false);
  });

  it("flurOk() Härtung: 0/negativ/undefined ⇒ false", () => {
    for (const v of [0, -1.2, undefined, NaN]) {
      assert.equal(flurOk(v), false);
    }
  });
});

describe("accessibility.js — sanitaerOk()", () => {
  it("Stufe R mit 1,50 m Bewegung, bodengleicher Dusche und Defaults ⇒ plausibel", () => {
    assert.equal(sanitaerOk({ stufe: "R", bewegung: 1.50, dusche: "ja" }), true);
  });

  it("Stufe R mit nur 1,20 m Bewegung ⇒ nicht plausibel", () => {
    assert.equal(sanitaerOk({ stufe: "R", bewegung: 1.20, dusche: "ja" }), false);
  });

  it("Stufe B genügt 1,20 m Bewegung", () => {
    assert.equal(sanitaerOk({ stufe: "B", bewegung: 1.20, dusche: "ja" }), true);
  });

  it("fehlende bodengleiche Dusche lässt jede Stufe durchfallen", () => {
    assert.equal(sanitaerOk({ stufe: "R", bewegung: 1.50, dusche: "nein" }), false);
    assert.equal(sanitaerOk({ stufe: "B", bewegung: 1.20, dusche: "nein" }), false);
  });

  it("Stufe R: seitliche WC-Fläche < 0,90 m oder nicht unterfahrbarer Waschtisch ⇒ false", () => {
    assert.equal(sanitaerOk({ stufe: "R", bewegung: 1.50, dusche: "ja", wcSeitlich: 0.5 }), false);
    assert.equal(sanitaerOk({ stufe: "R", bewegung: 1.50, dusche: "ja", waschtisch: "nein" }), false);
  });

  it("Stufe B prüft WC-Seitenfläche und Waschtisch NICHT", () => {
    assert.equal(sanitaerOk({ stufe: "B", bewegung: 1.20, dusche: "ja", wcSeitlich: 0, waschtisch: "nein" }), true);
  });

  it("boolesches true wird wie \"ja\" akzeptiert", () => {
    assert.equal(sanitaerOk({ stufe: "R", bewegung: 1.50, dusche: true, waschtisch: true }), true);
  });

  it("Härtung: leerer Aufruf ⇒ false (Stufe R, Bewegung 0), nie NaN-Vergleich", () => {
    assert.equal(sanitaerOk(), false);
    assert.equal(sanitaerOk({}), false);
    assert.equal(sanitaerOk({ stufe: "R", bewegung: NaN, dusche: "ja" }), false);
    assert.equal(sanitaerOk({ stufe: "R", bewegung: -1.5, dusche: "ja" }), false);
  });
});

describe("accessibility.js — bfChecks() Invarianten", () => {
  // Basis-Eingabe aus 19-01-PLAN.md.
  const base = {
    storeys: 9, okf: 27.5, aufzugMode: "auto", kabineB: 1.10, kabineT: 1.40,
    erschliessung: "ja", we: 70, quotePct: 10, vorhErreichbar: 70, vorhR: 0,
    stufe: "B", bewegung: 1.20, tuerBreite: 0.80, tuerHoehe: 2.05, flur: 1.20,
    saniStufe: "R", saniBewegung: 1.50, saniDusche: "ja", saniWcSeitlich: 0.90, saniWaschtisch: "ja",
  };

  it("liefert genau 8 Items mit den vereinbarten Keys", () => {
    const c = bfChecks(base);
    assert.equal(c.items.length, 8);
    assert.deepEqual(
      c.items.map((i) => i.key),
      ["aufzug", "erschliessung", "erreichbar", "rollstuhl", "bewegung", "tuer", "flur", "sanitaer"],
    );
  });

  it("Standardgebäude mit 10 % R-Quote und 0 vorhandenen R-WE ⇒ rollstuhl warn, Verdict mit Hinweisen", () => {
    const c = bfChecks(base);
    assert.equal(c.items.find((i) => i.key === "aufzug").status, "pass");
    assert.equal(c.items.find((i) => i.key === "rollstuhl").status, "warn");
    assert.equal(c.verdict, "Konzept mit Hinweisen");
    assert.equal(c.warns, 1);
    assert.equal(c.score, 88); // 7 von 8 pass
  });

  it("mit 7 vorhandenen R-WE (= erf. bei 70 WE / 10 %) ⇒ vollständig plausibel", () => {
    const c = bfChecks({ ...base, vorhR: 7 });
    assert.equal(c.items.find((i) => i.key === "rollstuhl").status, "pass");
    assert.equal(c.verdict, "Konzept plausibel");
    assert.equal(c.warns, 0);
    assert.equal(c.score, 100);
  });

  it("INVARIANTE: bfChecks liefert NIE Status \"fail\" (Haftung, T-19-04)", () => {
    const varianten = [
      {},
      base,
      { ...base, vorhR: 7 },
      { storeys: 0, okf: 0, we: 0 },
      { storeys: -9, okf: -27.5, we: -70, quotePct: -10, bewegung: -1, tuerBreite: -1, flur: -1 },
      { storeys: NaN, okf: NaN, we: NaN, quotePct: NaN, kabineB: NaN, kabineT: NaN },
      { ...base, aufzugMode: "nein" },
      { ...base, aufzugMode: "ja", kabineB: 0.8, kabineT: 1.0 },
      { ...base, erschliessung: "nein", stufe: "R", saniStufe: "R", saniDusche: "nein" },
    ];
    for (const v of varianten) {
      const r = bfChecks(v);
      assert.ok(!r.items.some((i) => i.status === "fail"), `fail-Status bei ${JSON.stringify(v)}`);
      for (const i of r.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Score konsistent mit Item-Status, 0–100, warns = Rest", () => {
    for (const v of [{}, base, { ...base, vorhR: 7 }, { storeys: 1, okf: 3, we: 4 }]) {
      const r = bfChecks(v);
      const passes = r.items.filter((i) => i.status === "pass").length;
      assert.equal(r.score, Math.round((passes / r.items.length) * 100));
      assert.ok(r.score >= 0 && r.score <= 100);
      assert.equal(r.warns, r.items.length - passes);
    }
  });

  it("ME-05: fehlende Kabinenmaße bei Aufzugspflicht ⇒ warn mit Pflegehinweis, kein stiller pass", () => {
    const c = bfChecks({ ...base, kabineB: undefined, kabineT: undefined });
    const auf = c.items.find((i) => i.key === "aufzug");
    assert.equal(auf.status, "warn");
    assert.match(auf.detail, /Kabinenmaße pflegen/);
  });

  it("zu kleine Kabine bei Aufzugspflicht ⇒ warn mit Maßhinweis", () => {
    const c = bfChecks({ ...base, kabineB: 1.0, kabineT: 1.2 });
    const auf = c.items.find((i) => i.key === "aufzug");
    assert.equal(auf.status, "warn");
    assert.match(auf.detail, /unter 1,10 × 1,40/);
  });

  it("aufzugMode \"nein\" trotz abgeleiteter Pflicht ⇒ warn mit LBO-Hinweis", () => {
    const c = bfChecks({ ...base, aufzugMode: "nein" });
    const auf = c.items.find((i) => i.key === "aufzug");
    assert.equal(auf.status, "warn");
    assert.match(auf.detail, /Landesbauordnung prüfen/);
  });

  it("ohne Aufzugspflicht und ohne Kabinenmaße ⇒ pass (keine Pflicht abgeleitet)", () => {
    const c = bfChecks({ storeys: 2, okf: 6, we: 8, vorhErreichbar: 8, erschliessung: "ja", bewegung: 1.2, tuerBreite: 0.8, tuerHoehe: 2.05, flur: 1.2, saniBewegung: 1.5 });
    const auf = c.items.find((i) => i.key === "aufzug");
    assert.equal(auf.status, "pass");
    assert.match(auf.detail, /keine Aufzugspflicht/);
  });

  it("R-Quote 0 % ⇒ rollstuhl pass mit LBO-Prüfhinweis (bewusst kein warn)", () => {
    const c = bfChecks({ ...base, quotePct: 0, vorhR: 0 });
    const r = c.items.find((i) => i.key === "rollstuhl");
    assert.equal(r.status, "pass");
    assert.match(r.detail, /Landesbauordnung prüfen/);
  });

  it("Härtung: leerer Aufruf liefert 8 Items ohne NaN/undefined in den Detailtexten", () => {
    const c = bfChecks();
    assert.equal(c.items.length, 8);
    assert.ok(Number.isFinite(c.score));
    for (const i of c.items) {
      assert.equal(typeof i.detail, "string");
      assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter im Detailtext (${i.key}): ${i.detail}`);
    }
  });

  it("Härtung: absurd große Eingaben bleiben endlich und ohne Infinity im Text", () => {
    const c = bfChecks({ storeys: 1e6, okf: 1e6, we: 1e9, quotePct: 1e6, vorhErreichbar: 0, vorhR: 0 });
    assert.ok(Number.isFinite(c.score));
    for (const i of c.items) {
      assert.ok(!/Infinity|NaN/.test(i.detail), `${i.key}: ${i.detail}`);
    }
  });
});

describe("accessibility.js — Kopplung zu compliance.js (KD-04)", () => {
  it("aufzugPflicht/erfBarrierefreiErreichbar sind die von compliance.js genutzten Exporte", () => {
    assert.equal(typeof aufzugPflicht, "function");
    assert.equal(typeof erfBarrierefreiErreichbar, "function");
  });

  it("Standardgebäude ⇒ Aufzugspflicht ⇒ compliance verlangt alle 70 WE barrierefrei erreichbar", () => {
    const lift = aufzugPflicht(STD.storeys, STD.okf);
    assert.equal(lift, true);
    assert.equal(erfBarrierefreiErreichbar(STD.we, STD.storeys, lift), 70);
  });
});
