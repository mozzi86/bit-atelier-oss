// 72-01 A-5 (Befund N-05): Kennzahlen je Projekttyp.
//
// Das Massing-Studio zeigte „Wohneinheiten" für JEDES Projekt — ein
// Gewerbe-Projekt bekam damit falsche Zahlen. kennzahlenJeTyp ist die eine
// pure Ableitung; hier werden die Abnahme-Kriterien des Reviews geprüft:
// „Wohneinheiten" verschwindet bei Gewerbe, Arbeitsplätze erscheinen.
// Alle Richtwerte sind [ASSUMED] (Review §3 A-5) und in kennzahlen.js
// als benannte Konstanten mit Einheit dokumentiert.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  kennzahlenJeTyp,
  NUF_JE_WOHNUNG_M2,
  NUF_JE_ARBEITSPLATZ_M2,
  BGF_JE_STELLPLATZ_M2,
} from "@designer/lib/kennzahlen";

/** KPI-Liste auf ein Schlüssel-Wert-Objekt reduzieren. */
const alsMap = (liste) => Object.fromEntries(liste.map((k) => [k.key, k.value]));

describe("kennzahlenJeTyp — Wohnen", () => {
  it("residential: Wohneinheiten = NUF/75, Stellplätze = WE × 1,0", () => {
    const kpis = kennzahlenJeTyp("residential", { nuf: 1500, bgf: 1875 });
    assert.deepEqual(alsMap(kpis), {
      wohneinheiten: Math.round(1500 / NUF_JE_WOHNUNG_M2), // 20
      stellplaetze: Math.round(1500 / NUF_JE_WOHNUNG_M2),   // Schlüssel 1,0
    });
    assert.deepEqual(kpis.map((k) => k.label), ["Wohneinheiten", "Stellplätze"]);
  });

  it("mixed_use zählt als Wohnen (WE-Ansatz)", () => {
    assert.ok("wohneinheiten" in alsMap(kennzahlenJeTyp("mixed_use", { nuf: 750, bgf: 900 })));
  });
});

describe("kennzahlenJeTyp — Gewerbe / Öffentlich / unbekannt", () => {
  it("commercial: Arbeitsplätze = NUF/12, Stellplätze = BGF/40 — KEINE Wohneinheiten", () => {
    const kpis = kennzahlenJeTyp("commercial", { nuf: 1200, bgf: 1500 });
    const map = alsMap(kpis);
    assert.equal(map.arbeitsplaetze, Math.round(1200 / NUF_JE_ARBEITSPLATZ_M2)); // 100
    assert.equal(map.stellplaetze, Math.round(1500 / BGF_JE_STELLPLATZ_M2));       // 38
    assert.ok(!("wohneinheiten" in map), "Abnahme A-5: Wohneinheiten verschwinden bei Gewerbe");
  });

  it("institutional und unbekannter Typ verhalten sich wie Gewerbe", () => {
    for (const typ of ["institutional", "urban_development", null, undefined, ""]) {
      const map = alsMap(kennzahlenJeTyp(typ, { nuf: 600, bgf: 800 }));
      assert.ok("arbeitsplaetze" in map, `${typ}: Arbeitsplätze erwartet`);
      assert.ok(!("wohneinheiten" in map), `${typ}: keine Wohneinheiten`);
    }
  });

  it("[ASSUMED]-Kennzeichnung steht im Untertitel (Richtwerte ehrlich benannt)", () => {
    const kpis = kennzahlenJeTyp("commercial", { nuf: 100, bgf: 100 });
    assert.ok(kpis.every((k) => k.sub.includes("[ASSUMED]")));
  });
});

describe("kennzahlenJeTyp — Härtung", () => {
  it("fehlende/unsinnige Flächen ergeben 0, nie NaN", () => {
    for (const flachen of [{ nuf: null, bgf: null }, {}, { nuf: NaN, bgf: undefined }]) {
      for (const kpi of kennzahlenJeTyp("commercial", flachen)) {
        assert.ok(Number.isFinite(kpi.value), `${kpi.key} ist keine Zahl`);
        assert.equal(kpi.value, 0);
      }
    }
  });

  it("negative Flächen werden auf 0 geklemmt (keine negativen Kennzahlen)", () => {
    assert.equal(alsMap(kennzahlenJeTyp("residential", { nuf: -500, bgf: -10 })).wohneinheiten, 0);
  });
});
