// Unit-Tests für packages/nova-designer/src/lib/landscape.js (Außenanlagen/Landschaft).
//
// Belegte Sample-Werte: .planning/phases/16-landschaftsplanung-au-enanlagen-reiter-.../
//   16-01-PLAN.md (Smoke: erfKfzStellplaetze(40, 1.0) = 40, Fahrrad 80 (WE-Basis) bzw. 72
//   (BGF-Basis 3.600 m²), erfBarrierefrei(40, 3, 1) = 2, Fläche je Stpl. 25 m² ⇒ 1.000 m²
//   gesamt, A_red = 1.910 m², Q ≈ 38,2 l/s, V ≈ 34 m³; Checks bei Versiegelung 0,543 /
//   Grün 0,286 / FW-Breite 3,50 m / Grundstück 3.500 m²).
//
// Wie statics.js gibt diese Lib bei fehlender Grundstücksfläche bewusst `null` zurück.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_KFZ_SCHLUESSEL,
  DEFAULT_FAHRRAD_SCHLUESSEL,
  DEFAULT_BARRIEREFREI_PCT,
  DEFAULT_BARRIEREFREI_MIN,
  BF_STPL_MASS,
  DEFAULT_STPL_BREITE,
  DEFAULT_STPL_LAENGE,
  DEFAULT_FLAECHENFAKTOR,
  PSI_DACH,
  PSI_BEFESTIGT,
  PSI_GRUEN,
  DEFAULT_REGEN_R,
  DEFAULT_REGENDAUER_MIN,
  DEFAULT_FW_BREITE,
  erfKfzStellplaetze,
  erfFahrradStellplaetze,
  erfBarrierefrei,
  stellplatzFlaecheJe,
  stellplatzFlaecheGesamt,
  versiegelungsgrad,
  gruenflaecheAnteil,
  abflussFlaeche,
  spitzenabflussQ,
  rueckhaltevolumen,
  aussenanlagenChecks,
} from "@designer/lib/landscape";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""}: ${actual} ≠ ${expected} (±${tol})`);

describe("landscape.js — Richtwert-Konstanten", () => {
  it("Stellplatzschlüssel 1,0 KFZ/WE und 2,0 Fahrrad/WE [ASSUMED, kommunal abweichend]", () => {
    assert.equal(DEFAULT_KFZ_SCHLUESSEL, 1.0);
    assert.equal(DEFAULT_FAHRRAD_SCHLUESSEL, 2.0);
  });

  it("barrierefrei 3 % mit Mindestanzahl 1; Maßangabe 3,50 × 5,00 m (informativ)", () => {
    assert.equal(DEFAULT_BARRIEREFREI_PCT, 3);
    assert.equal(DEFAULT_BARRIEREFREI_MIN, 1);
    assert.equal(BF_STPL_MASS, "3,50 × 5,00 m");
  });

  it("Stellplatzmaße 2,5 × 5,0 m, Flächenfaktor 2,0 inkl. Fahrgasse", () => {
    assert.equal(DEFAULT_STPL_BREITE, 2.5);
    assert.equal(DEFAULT_STPL_LAENGE, 5.0);
    assert.equal(DEFAULT_FLAECHENFAKTOR, 2.0);
  });

  it("Abflussbeiwerte ψ: Dach 0,9 · befestigt 0,9 · Grün 0,2", () => {
    assert.equal(PSI_DACH, 0.9);
    assert.equal(PSI_BEFESTIGT, 0.9);
    assert.equal(PSI_GRUEN, 0.2);
    assert.ok(PSI_GRUEN < PSI_DACH, "Grün muss weniger abführen als Dach");
  });

  it("Regenspende 200 l/(s·ha), Regendauer 15 min, FW-Breite 3,5 m (DIN 14090)", () => {
    assert.equal(DEFAULT_REGEN_R, 200);
    assert.equal(DEFAULT_REGENDAUER_MIN, 15);
    assert.equal(DEFAULT_FW_BREITE, 3.5);
  });
});

describe("landscape.js — Stellplätze", () => {
  it("belegte Sample-Werte: 40 WE ⇒ 40 KFZ, 80 Fahrrad (WE-Basis), 72 Fahrrad (BGF 3.600)", () => {
    assert.equal(erfKfzStellplaetze(40, 1.0), 40);
    assert.equal(erfFahrradStellplaetze({ we: 40, schluessel: 2.0, basis: "we" }), 80);
    assert.equal(erfFahrradStellplaetze({ bgf: 3600, schluessel: 2.0, basis: "bgf" }), 72);
  });

  it("wird immer aufgerundet: 40 WE bei Schlüssel 1,2 ⇒ 48; 41 WE bei 1,2 ⇒ 50", () => {
    assert.equal(erfKfzStellplaetze(40, 1.2), 48);
    assert.equal(erfKfzStellplaetze(41, 1.2), 50);
  });

  it("Default-Schlüssel greifen ohne explizite Angabe", () => {
    assert.equal(erfKfzStellplaetze(40), 40);
    assert.equal(erfFahrradStellplaetze({ we: 40 }), 80);
  });

  it("unbekannte Basis fällt auf \"we\" zurück", () => {
    assert.equal(erfFahrradStellplaetze({ we: 40, bgf: 3600, basis: "gibtsnicht" }), 80);
  });

  it("belegter Sample-Wert: erfBarrierefrei(40, 3 %, min 1) = 2", () => {
    assert.equal(erfBarrierefrei(40, 3, 1), 2);
  });

  it("Mindestanzahl greift bei kleinen Projekten: 5 Stpl. bei 3 % ⇒ 1", () => {
    assert.equal(erfBarrierefrei(5, 3, 1), 1);
    assert.equal(erfBarrierefrei(0, 3, 1), 1);
  });

  it("Härtung: 0/negativ/undefined ⇒ 0 (Stellplätze) bzw. Mindestanzahl (barrierefrei), nie NaN", () => {
    for (const v of [0, -40, undefined, NaN, null]) {
      assert.equal(erfKfzStellplaetze(v), 0, `erfKfzStellplaetze(${String(v)})`);
      assert.equal(erfFahrradStellplaetze({ we: v }), 0);
      assert.equal(erfBarrierefrei(v), DEFAULT_BARRIEREFREI_MIN);
    }
    assert.equal(erfFahrradStellplaetze(), 0);
    assert.ok(Number.isFinite(erfBarrierefrei()));
  });

  it("belegte Sample-Werte: 25 m² je Stellplatz ⇒ 40 Stpl. = 1.000 m²", () => {
    assert.equal(stellplatzFlaecheJe(2.5, 5.0, 2.0), 25);
    assert.equal(stellplatzFlaecheGesamt(40, 2.5, 5.0, 2.0), 1000);
  });

  it("Defaults greifen: stellplatzFlaecheJe() = 25 m², stellplatzFlaecheGesamt(40) = 1.000 m²", () => {
    assert.equal(stellplatzFlaecheJe(), 25);
    assert.equal(stellplatzFlaecheGesamt(40), 1000);
  });

  it("Härtung: 0/negativ ⇒ 0, nie NaN oder negativ", () => {
    assert.equal(stellplatzFlaecheJe(0, 0, 0), 0);
    assert.equal(stellplatzFlaecheJe(-2.5, -5, -2), 0);
    assert.equal(stellplatzFlaecheGesamt(-40), 0);
    assert.ok(Number.isFinite(stellplatzFlaecheJe(NaN, NaN, NaN)));
  });
});

describe("landscape.js — null bei fehlender Grundstücksfläche (erwünschtes Verhalten)", () => {
  it("versiegelungsgrad(): (900 + 1.000) / 3.500 ≈ 0,543", () => {
    near(versiegelungsgrad({ footArea: 900, stellplatzflaeche: 1000, gruenflaeche: 1000, plot: 3500 }), 0.543, 0.001, "Versiegelung");
  });

  it("Grünflächen zählen NICHT als versiegelt", () => {
    const ohneGruen = versiegelungsgrad({ footArea: 900, stellplatzflaeche: 1000, gruenflaeche: 0, plot: 3500 });
    const mitGruen = versiegelungsgrad({ footArea: 900, stellplatzflaeche: 1000, gruenflaeche: 1000, plot: 3500 });
    assert.equal(ohneGruen, mitGruen);
  });

  it("versiegelungsgrad(): OHNE Grundstücksfläche exakt null — kein „4.000 % versiegelt“", () => {
    assert.equal(versiegelungsgrad({ footArea: 900, plot: 0 }), null);
    assert.equal(versiegelungsgrad({ footArea: 900, plot: -3500 }), null);
    assert.equal(versiegelungsgrad({ footArea: 900 }), null);
    assert.equal(versiegelungsgrad({}), null);
    assert.equal(versiegelungsgrad(), null);
  });

  it("gruenflaecheAnteil(): 1.000 / 3.500 ≈ 0,286; ohne Plot exakt null", () => {
    near(gruenflaecheAnteil(1000, 3500), 0.286, 0.001, "Grünanteil");
    assert.equal(gruenflaecheAnteil(1000, 0), null);
    assert.equal(gruenflaecheAnteil(1000, -3500), null);
    assert.equal(gruenflaecheAnteil(1000, undefined), null);
  });

  it("null ist ausdrücklich NICHT 0 und NICHT Infinity", () => {
    const v = versiegelungsgrad({ footArea: 900, plot: 0 });
    assert.notEqual(v, 0);
    assert.notEqual(v, Infinity);
    assert.equal(v, null);
  });
});

describe("landscape.js — Entwässerung", () => {
  it("belegter Sample-Wert: A_red = 900·0,9 + 1.000·0,9 + 1.000·0,2 = 1.910 m²", () => {
    assert.equal(abflussFlaeche({ footArea: 900, psiDach: 0.9, stellplatzflaeche: 1000, psiBefestigt: 0.9, gruenflaeche: 1000, psiGruen: 0.2 }), 1910);
  });

  it("Defaults greifen: abflussFlaeche mit den Standard-ψ", () => {
    assert.equal(abflussFlaeche({ footArea: 900, stellplatzflaeche: 1000, gruenflaeche: 1000 }), 1910);
  });

  it("belegter Sample-Wert: Q = 200 · 1.910 / 10.000 = 38,2 l/s", () => {
    near(spitzenabflussQ(200, 1910), 38.2, 0.01, "Q");
  });

  it("EINHEITENFALLE: /10.000 rechnet l/(s·ha) auf m² um (1 ha = 10.000 m²)", () => {
    assert.equal(spitzenabflussQ(200, 10000), 200);
    assert.equal(spitzenabflussQ(200, 1), 0.02);
  });

  it("belegter Sample-Wert: V = 38,2 · 15 · 60 / 1.000 ≈ 34 m³", () => {
    near(rueckhaltevolumen(38.2, 15), 34.38, 0.01, "V");
    assert.equal(Math.round(rueckhaltevolumen(38.2, 15)), 34);
  });

  it("EINHEITENFALLE: ·60 (s/min) und /1.000 (l → m³)", () => {
    near(rueckhaltevolumen(1000 / 60, 1), 1, 1e-9, "16,67 l/s · 60 s = 1.000 l = 1 m³");
  });

  it("Defaults greifen: spitzenabflussQ(undefined, 1910) nutzt r = 200; rueckhaltevolumen(Q) nutzt 15 min", () => {
    near(spitzenabflussQ(undefined, 1910), 38.2, 0.01, "Q mit Default r");
    near(rueckhaltevolumen(38.2), 34.38, 0.01, "V mit Default-Dauer");
  });

  it("Härtung: 0/negativ/undefined ⇒ 0, nie NaN", () => {
    assert.equal(abflussFlaeche(), 0);
    assert.equal(abflussFlaeche({}), 0);
    assert.equal(abflussFlaeche({ footArea: -900, stellplatzflaeche: -1000, gruenflaeche: -1000 }), 0);
    assert.equal(spitzenabflussQ(200, 0), 0);
    assert.equal(spitzenabflussQ(-200, -1910), 0);
    assert.equal(rueckhaltevolumen(0, 15), 0);
    assert.equal(rueckhaltevolumen(-38.2, -15), 0);
    assert.ok(Number.isFinite(rueckhaltevolumen()));
  });
});

describe("landscape.js — aussenanlagenChecks() Invarianten", () => {
  const BASIS = {
    erfKfz: 40, vorhandenKfz: 40, erfBarrierefrei: 2, barrierefreiVorh: 2,
    versiegelung: 0.543, gruen: 0.286, volumen: 34, fwBreite: 3.5, plot: 3500,
  };

  it("Basisfall: 7 Items, 0 Hinweise, Score 100, Verdict plausibel", () => {
    const c = aussenanlagenChecks(BASIS);
    assert.equal(c.items.length, 7);
    assert.deepEqual(c.items.map((i) => i.key), ["kfz", "barrierefrei", "versiegelung", "gruen", "retention", "feuerwehr", "plot"]);
    assert.equal(c.warns, 0);
    assert.equal(c.score, 100);
    assert.equal(c.verdict, "Konzept plausibel");
  });

  it("versiegelung/gruen === null ⇒ warn mit \"nicht berechenbar\", kein stiller pass", () => {
    const c = aussenanlagenChecks({ ...BASIS, versiegelung: null, gruen: null, plot: 0 });
    for (const key of ["versiegelung", "gruen"]) {
      const item = c.items.find((i) => i.key === key);
      assert.equal(item.status, "warn", `${key}`);
      assert.match(item.detail, /nicht berechenbar/);
      assert.match(item.detail, /Grundstücksfläche eingeben/);
    }
  });

  it("Grenzwerte exakt: Versiegelung ≤ 0,60 pass / 0,601 warn; Grün ≥ 0,20 pass / 0,199 warn", () => {
    assert.equal(aussenanlagenChecks({ ...BASIS, versiegelung: 0.6 }).items.find((i) => i.key === "versiegelung").status, "pass");
    assert.equal(aussenanlagenChecks({ ...BASIS, versiegelung: 0.601 }).items.find((i) => i.key === "versiegelung").status, "warn");
    assert.equal(aussenanlagenChecks({ ...BASIS, gruen: 0.2 }).items.find((i) => i.key === "gruen").status, "pass");
    assert.equal(aussenanlagenChecks({ ...BASIS, gruen: 0.199 }).items.find((i) => i.key === "gruen").status, "warn");
  });

  it("Feuerwehr-Aufstellfläche: 3,50 m exakt ⇒ pass, 3,49 m ⇒ warn (DIN 14090)", () => {
    assert.equal(aussenanlagenChecks({ ...BASIS, fwBreite: 3.5 }).items.find((i) => i.key === "feuerwehr").status, "pass");
    assert.equal(aussenanlagenChecks({ ...BASIS, fwBreite: 3.49 }).items.find((i) => i.key === "feuerwehr").status, "warn");
  });

  it("Stellplätze: vorhanden = erforderlich ⇒ pass, einer weniger ⇒ warn", () => {
    assert.equal(aussenanlagenChecks({ ...BASIS, vorhandenKfz: 40 }).items.find((i) => i.key === "kfz").status, "pass");
    assert.equal(aussenanlagenChecks({ ...BASIS, vorhandenKfz: 39 }).items.find((i) => i.key === "kfz").status, "warn");
    assert.equal(aussenanlagenChecks({ ...BASIS, barrierefreiVorh: 1 }).items.find((i) => i.key === "barrierefrei").status, "warn");
  });

  it("INVARIANTE: aussenanlagenChecks liefert NIE Status \"fail\" (T-16-04, Haftung)", () => {
    const varianten = [
      {}, BASIS,
      { erfKfz: 999, vorhandenKfz: 0, erfBarrierefrei: 30, barrierefreiVorh: 0, versiegelung: 5, gruen: 0, volumen: 0, fwBreite: 0, plot: 0 },
      { versiegelung: null, gruen: null, plot: -3500, erfKfz: -40, vorhandenKfz: -40, volumen: -34, fwBreite: -3.5 },
      { versiegelung: NaN, gruen: NaN, volumen: NaN, fwBreite: NaN, plot: NaN },
    ];
    for (const v of varianten) {
      const c = aussenanlagenChecks(v);
      for (const i of c.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Score konsistent, 0–100; Verdict folgt der Hinweiszahl", () => {
    for (const v of [{}, BASIS, { ...BASIS, plot: 0, versiegelung: null, gruen: null }]) {
      const c = aussenanlagenChecks(v);
      const passes = c.items.filter((i) => i.status === "pass").length;
      assert.equal(c.score, Math.round((passes / c.items.length) * 100));
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.equal(c.warns, c.items.length - passes);
      assert.equal(c.verdict, c.warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel");
    }
  });

  it("Härtung: leerer Aufruf liefert 7 Items ohne NaN-Texte", () => {
    for (const c of [aussenanlagenChecks(), aussenanlagenChecks({})]) {
      assert.equal(c.items.length, 7);
      assert.ok(Number.isFinite(c.score));
      for (const i of c.items) {
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });
});
