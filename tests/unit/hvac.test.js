// Unit-Tests für packages/nova-designer/src/lib/hvac.js (Haustechnik/TGA).
//
// Belegte Sample-Werte: .planning/phases/17-haustechnik-konzepte-reiter-.../17-01-PLAN.md
//   (Smoke: heizlastKW(50, 3600) = 180 kW, jahresHeizwaermebedarf(55, 3600) = 198.000 kWh/a,
//   waermepumpeStrombedarf(198000, 3.5) ≈ 56.571 kWh/a, Lüftung 4.320 bzw. 2.850 m³/h,
//   Trinkwasser 11.875 l/d ⇒ 3.562,5 l/d WW und ≈ 4.334 m³/a, Elektro 64,8 bzw. 330,6 kW,
//   PV 162 kWp / 153.900 kWh/a) und 17-01-SUMMARY.md.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GEBAEUDESTANDARDS,
  WAERMEERZEUGER,
  LUEFTUNGSSYSTEME,
  DEFAULT_LUFTWECHSEL,
  DEFAULT_AUSSENLUFT_P,
  DEFAULT_TRINKWASSER_LPD,
  DEFAULT_WW_ANTEIL_PCT,
  DEFAULT_PERSONEN_JE_WE,
  DEFAULT_SANITAER_JE_WE,
  DEFAULT_VA_M2,
  DEFAULT_KW_JE_WE,
  DEFAULT_GZF,
  DEFAULT_PV_KWP_M2,
  DEFAULT_PV_ERTRAG,
  heizlastKW,
  jahresHeizwaermebedarf,
  waermepumpeStrombedarf,
  lueftungVolumenstrom,
  trinkwasserBedarf,
  warmwasserBedarf,
  trinkwasserJahrM3,
  elektroAnschlusswert,
  pvPotenzial,
  tgaChecks,
} from "@designer/lib/hvac";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""}: ${actual} ≠ ${expected} (±${tol})`);

// Referenzgebäude aus dem 17-01-PLAN-Smoke.
const REF = { flaeche: 3600, we: 38, personen: 95, dachflaeche: 900 };

describe("hvac.js — Kennwert-Kataloge und Defaults", () => {
  it("GEBAEUDESTANDARDS: geg-neubau 50 W/m² / 55 kWh/(m²·a) — die Referenzbasis für Phase 32", () => {
    assert.equal(GEBAEUDESTANDARDS["geg-neubau"].heizlast, 50);
    assert.equal(GEBAEUDESTANDARDS["geg-neubau"].bedarf, 55);
  });

  it("spez. Heizlast und Bedarf sinken über die Standards hinweg monoton", () => {
    const reihe = ["bestand-unsaniert", "bestand-saniert", "geg-neubau", "kfw-55", "kfw-40", "passivhaus"];
    for (let i = 1; i < reihe.length; i += 1) {
      assert.ok(GEBAEUDESTANDARDS[reihe[i]].heizlast < GEBAEUDESTANDARDS[reihe[i - 1]].heizlast, `heizlast ${reihe[i]}`);
      assert.ok(GEBAEUDESTANDARDS[reihe[i]].bedarf < GEBAEUDESTANDARDS[reihe[i - 1]].bedarf, `bedarf ${reihe[i]}`);
    }
  });

  it("jeder Standard hat ein Plausibilitätsband [min, max], das die Heizlast einschließt", () => {
    for (const [key, s] of Object.entries(GEBAEUDESTANDARDS)) {
      const [min, max] = s.band;
      assert.ok(min < max, `${key}: Band ${min}–${max}`);
      assert.ok(s.heizlast >= min && s.heizlast <= max, `${key}: heizlast ${s.heizlast} außerhalb ${min}–${max}`);
    }
  });

  it("nur KfW-40 und Passivhaus empfehlen zwingend WRG", () => {
    assert.equal(GEBAEUDESTANDARDS["kfw-40"].wrgEmpfohlen, true);
    assert.equal(GEBAEUDESTANDARDS.passivhaus.wrgEmpfohlen, true);
    assert.equal(GEBAEUDESTANDARDS["geg-neubau"].wrgEmpfohlen, undefined);
  });

  it("Gas-Brennwert ist der einzige Erzeuger ohne EE-Kontext", () => {
    assert.equal(WAERMEERZEUGER.gas.ee, false);
    for (const [key, e] of Object.entries(WAERMEERZEUGER)) {
      if (key !== "gas") assert.equal(e.ee, true, `${key} sollte ee=true haben`);
    }
  });

  it("nur zentral-/dezentral-WRG haben Wärmerückgewinnung", () => {
    assert.equal(LUEFTUNGSSYSTEME["zentral-wrg"].wrg, true);
    assert.equal(LUEFTUNGSSYSTEME["dezentral-wrg"].wrg, true);
    assert.equal(LUEFTUNGSSYSTEME.fenster.wrg, false);
    assert.equal(LUEFTUNGSSYSTEME.abluft.wrg, false);
  });

  it("Defaults: n 0,5 1/h · 30 m³/(h·P) · 125 l/(P·d) · 30 % WW · 2,5 P/WE · 4 Sanitärobjekte/WE", () => {
    assert.equal(DEFAULT_LUFTWECHSEL, 0.5);
    assert.equal(DEFAULT_AUSSENLUFT_P, 30);
    assert.equal(DEFAULT_TRINKWASSER_LPD, 125);
    assert.equal(DEFAULT_WW_ANTEIL_PCT, 30);
    assert.equal(DEFAULT_PERSONEN_JE_WE, 2.5);
    assert.equal(DEFAULT_SANITAER_JE_WE, 4);
  });

  it("Defaults Elektro/PV: 30 VA/m² · 14,5 kW/WE · GZF 0,6 · 0,18 kWp/m² · 950 kWh/(kWp·a)", () => {
    assert.equal(DEFAULT_VA_M2, 30);
    assert.equal(DEFAULT_KW_JE_WE, 14.5);
    assert.equal(DEFAULT_GZF, 0.6);
    assert.equal(DEFAULT_PV_KWP_M2, 0.18);
    assert.equal(DEFAULT_PV_ERTRAG, 950);
  });
});

describe("hvac.js — Heizung", () => {
  it("belegter Sample-Wert: heizlastKW(50, 3.600) = 180 kW (Einheit W → kW)", () => {
    assert.equal(heizlastKW(50, REF.flaeche), 180);
  });

  it("EINHEITENFALLE: /1000 fehlt nicht — 180 kW, nicht 180.000", () => {
    assert.equal(heizlastKW(50, 3600) * 1000, 180000);
    assert.notEqual(heizlastKW(50, 3600), 180000);
  });

  it("belegter Sample-Wert: jahresHeizwaermebedarf(55, 3.600) = 198.000 kWh/a", () => {
    assert.equal(jahresHeizwaermebedarf(55, REF.flaeche), 198000);
  });

  it("belegter Sample-Wert: waermepumpeStrombedarf(198.000, 3,5) ≈ 56.571 kWh/a", () => {
    assert.equal(Math.round(waermepumpeStrombedarf(198000, 3.5)), 56571);
  });

  it("Härtung: JAZ = 0 bleibt endlich (safeDiv), kein Infinity", () => {
    const v = waermepumpeStrombedarf(198000, 0);
    assert.ok(Number.isFinite(v), `nicht endlich: ${v}`);
    assert.equal(v, 1980000); // 198.000 / max(0,1; 0)
  });

  it("Härtung: 0/negativ/undefined ⇒ 0, nie NaN", () => {
    for (const [q, a] of [[0, 3600], [-50, 3600], [50, -3600], [undefined, undefined], [NaN, NaN]]) {
      assert.equal(heizlastKW(q, a), 0, `heizlastKW(${String(q)}, ${String(a)})`);
      assert.equal(jahresHeizwaermebedarf(q, a), 0);
    }
    assert.ok(Number.isFinite(waermepumpeStrombedarf(undefined, undefined)));
  });
});

describe("hvac.js — Lüftung", () => {
  it("belegte Sample-Werte: Luftwechsel 0,5 · 8.640 m³ = 4.320 m³/h; Personen 95 · 30 = 2.850 m³/h", () => {
    assert.equal(lueftungVolumenstrom({ basis: "luftwechsel", n: 0.5, volumen: 8640 }), 4320);
    assert.equal(lueftungVolumenstrom({ basis: "personen", personen: 95, aussenluft: 30 }), 2850);
  });

  it("unbekannte Basis fällt auf \"luftwechsel\" zurück", () => {
    assert.equal(lueftungVolumenstrom({ basis: "gibtsnicht", n: 0.5, volumen: 8640 }), 4320);
  });

  it("Härtung: leerer Aufruf ⇒ 0, negative Werte werden geklemmt", () => {
    assert.equal(lueftungVolumenstrom(), 0);
    assert.equal(lueftungVolumenstrom({}), 0);
    assert.equal(lueftungVolumenstrom({ basis: "personen", personen: -95, aussenluft: -30 }), 0);
    assert.ok(Number.isFinite(lueftungVolumenstrom({ n: NaN, volumen: NaN })));
  });
});

describe("hvac.js — Trinkwasser / Warmwasser", () => {
  it("belegte Sample-Werte: 95 P · 125 l = 11.875 l/d; 30 % ⇒ 3.562,5 l/d; ≈ 4.334 m³/a", () => {
    assert.equal(trinkwasserBedarf(REF.personen, 125), 11875);
    assert.equal(warmwasserBedarf(11875, 30), 3562.5);
    assert.equal(Math.round(trinkwasserJahrM3(11875)), 4334);
  });

  it("EINHEITENFALLE: ·365 / 1000 — Liter/Tag zu m³/Jahr", () => {
    assert.equal(trinkwasserJahrM3(1000), 365);
    assert.equal(trinkwasserJahrM3(11875), (11875 * 365) / 1000);
  });

  it("Defaults greifen: trinkwasserBedarf(95) nutzt 125 l/(P·d), warmwasserBedarf 30 %", () => {
    assert.equal(trinkwasserBedarf(95), 11875);
    assert.equal(warmwasserBedarf(11875), 3562.5);
  });

  it("Härtung: 0/negativ/undefined/NaN ⇒ 0, nie NaN", () => {
    for (const v of [0, -95, undefined, null, NaN]) {
      assert.equal(trinkwasserBedarf(v), 0, `trinkwasserBedarf(${String(v)})`);
      assert.equal(warmwasserBedarf(v), 0);
      assert.equal(trinkwasserJahrM3(v), 0);
    }
  });
});

describe("hvac.js — Elektro / PV", () => {
  it("belegte Sample-Werte: 30 VA/m² · 3.600 m² · 0,6 / 1000 = 64,8 kW", () => {
    near(elektroAnschlusswert({ basis: "va-m2", vaM2: 30, bezugsflaeche: 3600, gzf: 0.6 }), 64.8, 0.01, "VA-Basis");
  });

  it("belegter Sample-Wert: 14,5 kW/WE · 38 WE · 0,6 = 330,6 kW", () => {
    near(elektroAnschlusswert({ basis: "we", kwJeWe: 14.5, we: 38, gzf: 0.6 }), 330.6, 0.01, "WE-Basis");
  });

  it("unbekannte Basis fällt auf \"va-m2\" zurück", () => {
    near(elektroAnschlusswert({ basis: "gibtsnicht", vaM2: 30, bezugsflaeche: 3600, gzf: 0.6 }), 64.8, 0.01, "Fallback");
  });

  it("Härtung: leerer Aufruf ⇒ 0, negative Eingaben werden geklemmt", () => {
    assert.equal(elektroAnschlusswert(), 0);
    assert.equal(elektroAnschlusswert({}), 0);
    assert.equal(elektroAnschlusswert({ basis: "we", kwJeWe: -14.5, we: -38 }), 0);
  });

  it("belegte Sample-Werte: 900 m² · 0,18 = 162 kWp ⇒ 153.900 kWh/a", () => {
    const pv = pvPotenzial({ dachflaeche: REF.dachflaeche, kwpJeM2: 0.18, ertrag: 950 });
    near(pv.kwp, 162, 0.01, "kWp");
    near(pv.kwhA, 153900, 1, "kWh/a");
  });

  it("PV-Defaults greifen ohne explizite Angaben", () => {
    const pv = pvPotenzial({ dachflaeche: 900 });
    near(pv.kwp, 162, 0.01, "kWp mit Default");
    near(pv.kwhA, 153900, 1, "kWh/a mit Default");
  });

  it("Härtung: pvPotenzial() leer/negativ ⇒ {kwp:0, kwhA:0}, nie NaN", () => {
    for (const arg of [undefined, {}, { dachflaeche: -900 }, { dachflaeche: NaN, kwpJeM2: NaN, ertrag: NaN }]) {
      const pv = arg === undefined ? pvPotenzial() : pvPotenzial(arg);
      assert.equal(pv.kwp, 0);
      assert.equal(pv.kwhA, 0);
      assert.ok(Number.isFinite(pv.kwp) && Number.isFinite(pv.kwhA));
    }
  });
});

describe("hvac.js — tgaChecks() Invarianten", () => {
  const BASIS = {
    standard: "geg-neubau", qHeizlast: 50, erzeuger: "wp-luft",
    lueftungssystem: "zentral-wrg", beheizteFlaeche: 3600, we: 38,
  };

  it("Basisfall: 5 Items, 0 Hinweise, Score 100, Verdict plausibel", () => {
    const c = tgaChecks(BASIS);
    assert.equal(c.items.length, 5);
    assert.equal(c.warns, 0);
    assert.equal(c.score, 100);
    assert.equal(c.verdict, "Konzept plausibel");
    assert.deepEqual(c.items.map((i) => i.key), ["heizlast", "wrg", "erzeuger_ee", "flaeche", "we"]);
  });

  it("Gas-Brennwert ⇒ erzeuger_ee warn (GEG §71 Hinweis, kein Nachweis)", () => {
    const c = tgaChecks({ ...BASIS, erzeuger: "gas" });
    const item = c.items.find((i) => i.key === "erzeuger_ee");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /kein Nachweis/);
  });

  it("KfW-40 ohne WRG ⇒ wrg warn (\"unplausibel\")", () => {
    const c = tgaChecks({ ...BASIS, standard: "kfw-40", qHeizlast: 25, lueftungssystem: "fenster" });
    const item = c.items.find((i) => i.key === "wrg");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /unplausibel/);
  });

  it("Heizlast-Band exakt: geg-neubau 30–60 W/m² — 30 und 60 pass, 29,9 und 60,1 warn", () => {
    for (const q of [30, 60, 45]) {
      assert.equal(tgaChecks({ ...BASIS, qHeizlast: q }).items.find((i) => i.key === "heizlast").status, "pass", `q ${q}`);
    }
    for (const q of [29.9, 60.1]) {
      assert.equal(tgaChecks({ ...BASIS, qHeizlast: q }).items.find((i) => i.key === "heizlast").status, "warn", `q ${q}`);
    }
  });

  it("unbekannter Standard fällt auf geg-neubau zurück, unbekannte Systeme führen zu warn", () => {
    const c = tgaChecks({ ...BASIS, standard: "gibtsnicht" });
    assert.equal(c.items.find((i) => i.key === "heizlast").status, "pass");
    assert.match(c.items.find((i) => i.key === "heizlast").detail, /GEG-Neubau/);

    const unbekannt = tgaChecks({ ...BASIS, erzeuger: "kernfusion" });
    assert.equal(unbekannt.items.find((i) => i.key === "erzeuger_ee").status, "warn");
  });

  it("fehlende Fläche / fehlende WE ⇒ warn mit Pflegehinweis, kein stiller pass", () => {
    const c = tgaChecks({ ...BASIS, beheizteFlaeche: 0, we: 0 });
    assert.equal(c.items.find((i) => i.key === "flaeche").status, "warn");
    assert.match(c.items.find((i) => i.key === "flaeche").detail, /eingeben|pflegen/);
    assert.equal(c.items.find((i) => i.key === "we").status, "warn");
  });

  it("INVARIANTE: tgaChecks liefert NIE Status \"fail\" (Haftung, T-17-04)", () => {
    const varianten = [
      {}, BASIS,
      { standard: "passivhaus", qHeizlast: 999, erzeuger: "gas", lueftungssystem: "fenster", beheizteFlaeche: 0, we: 0 },
      { standard: "gibtsnicht", qHeizlast: -50, erzeuger: undefined, lueftungssystem: null, beheizteFlaeche: -1, we: -1 },
      { qHeizlast: NaN, beheizteFlaeche: NaN, we: NaN },
    ];
    for (const v of varianten) {
      const c = tgaChecks(v);
      for (const i of c.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Score konsistent, 0–100; Verdict folgt der Hinweiszahl", () => {
    for (const v of [{}, BASIS, { ...BASIS, erzeuger: "gas" }]) {
      const c = tgaChecks(v);
      const passes = c.items.filter((i) => i.status === "pass").length;
      assert.equal(c.score, Math.round((passes / c.items.length) * 100));
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.equal(c.warns, c.items.length - passes);
      assert.equal(c.verdict, c.warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel");
    }
  });

  it("Härtung: leerer Aufruf liefert 5 Items ohne NaN-Texte", () => {
    for (const c of [tgaChecks(), tgaChecks({})]) {
      assert.equal(c.items.length, 5);
      for (const i of c.items) {
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });
});
