// Unit-Tests für packages/nova-designer/src/lib/thermalBridges.js (Wärmebrücken, Phase 32).
//
// Belegte Sample-Werte: .planning/phases/32-waermebruecken-nachweis/32-RESEARCH.md:404-412
//   (Standardgebäude: footArea 730 m², storeys 9, height 31 m, bgf 6.570 m²,
//   Quadrat-Footprint Kante √730 ≈ 27,02 m ⇒ P ≈ 108,07 m, A_Hüll ≈ 4.810 m²,
//   Q_ref = 55 · 6.570 = 361.350 kWh/a) und 32-01-PLAN.md:340 (Smoke-Assertions),
//   32-01-SUMMARY.md:58/65 (Ergebnisse: ΔU 0,15 ⇒ 60.610 · 0,10 ⇒ 40.407 ·
//   0,05 ⇒ 20.203 · 0,03 ⇒ 12.122 kWh/a; detailliert 0,0456 ⇒ 18.422 kWh/a).
//
// Diese Tests dokumentieren den IST-Zustand. Kein GEG-/Wärmebrückennachweis.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VERFAHREN,
  AUSFUEHRUNG,
  PSI_KATALOG,
  DEFAULT_GT_KKH,
  DEFAULT_DELTA_T,
  DEFAULT_HT_MAX,
  DEFAULT_FENSTER_ANTEIL_PCT,
  DEFAULT_FENSTER_B,
  DEFAULT_FENSTER_H,
  DEFAULT_BALKON_BREITE,
  pauschalWert,
  umfangM,
  eckenAnzahl,
  huellflaeche,
  aussenwandflaeche,
  fensterAnzahl,
  laengenAusGeometrie,
  psiDefault,
  psiL,
  summePsiL,
  deltaUwbDetailliert,
  waermebrueckenVerlust,
  heizlastZuschlag,
  htZuschlag,
  anteilPct,
  einsparpotenzial,
  wirkung,
  verfahrensvergleich,
  wbChecks,
} from "@designer/lib/thermalBridges";

const near = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg || ""}: ${actual} weicht von ${expected} um mehr als ${tol} ab`,
  );

// Standardgebäude aus 32-RESEARCH.md:404.
const KANTE = Math.sqrt(730);
const QUAD = [{ x: 0, z: 0 }, { x: KANTE, z: 0 }, { x: KANTE, z: KANTE }, { x: 0, z: KANTE }];
const P = umfangM(QUAD);
const GEO = { umfang: P, hoehe: 31, storeys: 9, storeyHeight: 31 / 9, ecken: 4 };
const EIN = {
  fensterAnteilPct: 20, fensterB: 1.30, fensterH: 1.40,
  balkonAnzahl: 24, balkonBreite: 4, stuetzenAnzahl: 0, innenwandLaenge: 0,
  keller: "nein", dachform: "flach", bauzustand: "neubau", innendaemmung: "nein",
};
const A_HUELL = huellflaeche({ umfang: P, hoehe: 31, grundflaeche: 730, dach: true, boden: true });
const Q_REF = 55 * 6570; // 361.350 kWh/a

// Standard-Detailkatalog aus 32-01-PLAN.md:340.
const ROWS_STANDARD = [
  { key: "sockel", laenge: 108.07, psi: 0.25 },
  { key: "attika", laenge: 108.07, psi: 0.25 },
  { key: "fensterlaibung", laenge: 1031, psi: 0.04 },
  { key: "fenstersturz", laenge: 479, psi: 0.08 },
  { key: "fensterbruestung", laenge: 479, psi: 0.10 },
  { key: "deckenauflager", laenge: 865, psi: 0.02 },
  { key: "gebaeudekante", laenge: 124, psi: 0.05 },
  { key: "balkonplatte", laenge: 96, psi: 0.15 },
];

describe("thermalBridges.js — VERFAHREN & Defaults", () => {
  it("ΔU_WB je Verfahren: 0,10 / 0,15 / 0,05 / 0,03 / detailliert = null", () => {
    assert.equal(VERFAHREN.pauschal.dU, 0.10);
    assert.equal(VERFAHREN.innendaemmung.dU, 0.15);
    assert.equal(VERFAHREN.gleichwertigkeit_a.dU, 0.05);
    assert.equal(VERFAHREN.gleichwertigkeit_b.dU, 0.03);
    assert.equal(VERFAHREN.detailliert.dU, null);
  });

  it("Randbedingungen: G_t 84 kKh/a, ΔT 32 K, H'_T,max 0,50, Fensteranteil 20 %, 1,30 × 1,40 m, Balkon 4,0 m", () => {
    assert.equal(DEFAULT_GT_KKH, 84);
    assert.equal(DEFAULT_DELTA_T, 32);
    assert.equal(DEFAULT_HT_MAX, 0.50);
    assert.equal(DEFAULT_FENSTER_ANTEIL_PCT, 20);
    assert.equal(DEFAULT_FENSTER_B, 1.30);
    assert.equal(DEFAULT_FENSTER_H, 1.40);
    assert.equal(DEFAULT_BALKON_BREITE, 4.0);
  });

  it("Katalog hat 14 Anschlüsse × 3 Ausführungsqualitäten", () => {
    assert.equal(Object.keys(PSI_KATALOG).length, 14);
    assert.equal(Object.keys(AUSFUEHRUNG).length, 3);
    for (const [key, d] of Object.entries(PSI_KATALOG)) {
      assert.deepEqual(Object.keys(d.psi), ["unkritisch", "standard", "kritisch"], `Qualitäten bei ${key}`);
    }
  });
});

describe("thermalBridges.js — pauschalWert() (Verfahrenswahl)", () => {
  it("pauschal + Innendämmung \"ja\" hebt den Zuschlag auf 0,15", () => {
    assert.equal(pauschalWert("pauschal", "ja"), 0.15);
    assert.equal(pauschalWert("pauschal", "nein"), 0.10);
  });

  it("Innendämmung verändert die Gleichwertigkeitskategorien NICHT", () => {
    assert.equal(pauschalWert("gleichwertigkeit_a", "ja"), 0.05);
    assert.equal(pauschalWert("gleichwertigkeit_b", "ja"), 0.03);
  });

  it("detailliert ⇒ null (wird gerechnet, nicht pauschal gesetzt)", () => {
    assert.equal(pauschalWert("detailliert", "nein"), null);
    assert.equal(pauschalWert("detailliert", "ja"), null);
  });

  it("Härtung: unbekanntes/leeres Verfahren fällt konservativ auf 0,10 zurück", () => {
    assert.equal(pauschalWert("gibtsnicht", "nein"), 0.10);
    assert.equal(pauschalWert(undefined, undefined), 0.10);
    assert.equal(pauschalWert(null, null), 0.10);
  });
});

describe("thermalBridges.js — Geometrie", () => {
  it("umfangM(): Quadrat-Footprint mit Kante √730 ⇒ ≈ 108,07 m", () => {
    near(umfangM(QUAD), 108.07, 0.3, "P");
  });

  it("umfangM(): U-Footprint hat 124 m echten Umfang — mehr als die Bounding-Box (100 m)", () => {
    const U = [
      { x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 }, { x: 20, z: 20 },
      { x: 20, z: 8 }, { x: 10, z: 8 }, { x: 10, z: 20 }, { x: 0, z: 20 },
    ];
    near(umfangM(U), 124, 0.01, "U-Umfang");
    assert.ok(umfangM(U) > 2 * (30 + 20), "echter Umfang muss die Bounding-Box überschreiten");
  });

  it("Härtung: null/undefined/< 3 Punkte ⇒ 0 (kein Umfang aus einer Linie)", () => {
    assert.equal(umfangM(null), 0);
    assert.equal(umfangM(undefined), 0);
    assert.equal(umfangM([]), 0);
    assert.equal(umfangM([{ x: 0, z: 0 }, { x: 1, z: 1 }]), 0);
    assert.equal(umfangM("nichts"), 0);
  });

  it("Härtung: Punkte mit fehlenden/NaN-Koordinaten liefern endliche Umfänge", () => {
    const kaputt = [{ x: 0 }, { z: 5 }, { x: NaN, z: NaN }, {}];
    assert.ok(Number.isFinite(umfangM(kaputt)));
  });

  it("eckenAnzahl() = Anzahl Polygonpunkte, Härtung ⇒ 0", () => {
    assert.equal(eckenAnzahl(QUAD), 4);
    assert.equal(eckenAnzahl(null), 0);
    assert.equal(eckenAnzahl(undefined), 0);
    assert.equal(eckenAnzahl([]), 0);
  });

  it("huellflaeche(): P·H + 2·A_G ⇒ 3.350 + 1.460 = 4.810 m²", () => {
    near(A_HUELL, 4810, 4, "A_Hüll");
  });

  it("huellflaeche(): dach/boden abschaltbar", () => {
    near(huellflaeche({ umfang: P, hoehe: 31, grundflaeche: 730, dach: false, boden: false }), 3350, 4, "nur AW");
    near(huellflaeche({ umfang: P, hoehe: 31, grundflaeche: 730, dach: true, boden: false }), 4080, 4, "AW+Dach");
  });

  it("aussenwandflaeche(): P·H ⇒ 3.350 m² (brutto, ohne Öffnungsabzug)", () => {
    near(aussenwandflaeche({ umfang: P, hoehe: 31 }), 3350, 4, "A_AW");
  });

  it("Härtung: huellflaeche/aussenwandflaeche bei leerem oder negativem Input ⇒ 0, nie NaN", () => {
    assert.equal(huellflaeche(), 0);
    assert.equal(huellflaeche({}), 0);
    assert.equal(huellflaeche({ umfang: -100, hoehe: -31, grundflaeche: -730 }), 0);
    assert.equal(aussenwandflaeche(), 0);
    assert.equal(aussenwandflaeche({ umfang: NaN, hoehe: NaN }), 0);
  });

  it("fensterAnzahl(): Standardgebäude ⇒ ≈ 368 Fenster (rechnerisch, nicht gerundet)", () => {
    near(fensterAnzahl(GEO, EIN), 368, 2, "nF");
  });

  it("fensterAnzahl() Härtung: Fenstermaß 0 bleibt endlich (safeDiv), leerer Aufruf ⇒ 0", () => {
    assert.ok(Number.isFinite(fensterAnzahl(GEO, { ...EIN, fensterB: 0, fensterH: 0 })));
    assert.ok(Number.isFinite(fensterAnzahl({}, {})));
    assert.equal(fensterAnzahl({}, {}), 0);
  });
});

describe("thermalBridges.js — laengenAusGeometrie()", () => {
  const L = laengenAusGeometrie(GEO, EIN);

  it("liefert immer alle 14 Katalog-Keys", () => {
    assert.equal(Object.keys(L).length, 14);
    assert.deepEqual(Object.keys(L).sort(), Object.keys(PSI_KATALOG).sort());
  });

  it("Flachdach-Standardgebäude: Sockel und Attika = Umfang, Traufe/Ortgang = 0", () => {
    near(L.sockel, 108.07, 0.3, "L.sockel");
    near(L.attika, 108.07, 0.3, "L.attika");
    assert.equal(L.traufe, 0);
    assert.equal(L.ortgang, 0);
  });

  it("ohne Keller und im Neubau sind Kelleraußenwand und Bestands-Geschossdecke 0", () => {
    assert.equal(L.kelleraussenwand, 0);
    assert.equal(L.geschossdecke_bestand, 0);
  });

  it("Deckenauflager = (Geschosse − 1) · P ⇒ ≈ 864,6 m; Gebäudekante = Ecken · Höhe = 124 m", () => {
    near(L.deckenauflager, 864.6, 2, "L.deckenauflager");
    near(L.gebaeudekante, 124, 0.5, "L.gebaeudekante");
  });

  it("Fensterlängen: Laibung ≈ 1.031 m, Sturz ≈ 479 m, Brüstung identisch zum Sturz", () => {
    near(L.fensterlaibung, 1031, 6, "L.fensterlaibung");
    near(L.fenstersturz, 479, 3, "L.fenstersturz");
    assert.equal(L.fensterbruestung, L.fenstersturz);
  });

  it("Balkonplatte = Anzahl · Breite = 24 · 4 = 96 m; ohne Stützen 0", () => {
    near(L.balkonplatte, 96, 0.01, "L.balkonplatte");
    assert.equal(L.stuetze, 0);
  });

  it("Steildach + Keller + Bestand mit Innendämmung schaltet die passenden Details ein", () => {
    const steil = laengenAusGeometrie(GEO, { ...EIN, dachform: "steil", keller: "ja", bauzustand: "bestand", innendaemmung: "ja" });
    assert.equal(steil.attika, 0);
    near(steil.traufe, 54.04, 0.3, "steil.traufe");
    near(steil.ortgang, 54.04, 0.3, "steil.ortgang");
    near(steil.kelleraussenwand, 108.07, 0.3, "steil.kelleraussenwand");
    near(steil.geschossdecke_bestand, 864.6, 2, "steil.geschossdecke_bestand");
  });

  it("Bestand OHNE Innendämmung aktiviert die Bestands-Geschossdecke nicht (UND-Bedingung)", () => {
    const nurBestand = laengenAusGeometrie(GEO, { ...EIN, bauzustand: "bestand", innendaemmung: "nein" });
    assert.equal(nurBestand.geschossdecke_bestand, 0);
  });

  it("Härtung: leerer Aufruf liefert 14 endliche Längen (alle 0), nie NaN", () => {
    const L0 = laengenAusGeometrie({}, {});
    assert.equal(Object.keys(L0).length, 14);
    for (const [k, v] of Object.entries(L0)) {
      assert.ok(Number.isFinite(v), `${k} nicht endlich: ${v}`);
      assert.equal(v, 0, `${k} sollte 0 sein`);
    }
    for (const [k, v] of Object.entries(laengenAusGeometrie(undefined, undefined))) {
      assert.ok(Number.isFinite(v), `${k} nicht endlich`);
    }
  });

  it("Härtung: negative Geometrie erzeugt keine negativen Längen", () => {
    const Lneg = laengenAusGeometrie(
      { umfang: -100, hoehe: -31, storeys: -9, storeyHeight: -3, ecken: -4 },
      { ...EIN, balkonAnzahl: -24, balkonBreite: -4, innenwandLaenge: -50, stuetzenAnzahl: -3 },
    );
    for (const [k, v] of Object.entries(Lneg)) {
      assert.ok(Number.isFinite(v) && v >= 0, `${k} ist ${v}`);
    }
  });
});

describe("thermalBridges.js — ψ-Vorzeichen (die zentrale Einheitenfalle)", () => {
  it("psiDefault(): Sockel Standard 0,25; Balkonplatte kritisch 0,70", () => {
    assert.equal(psiDefault("sockel", "standard"), 0.25);
    assert.equal(psiDefault("balkonplatte", "kritisch"), 0.70);
  });

  it("Gebäudekante unkritisch ist NEGATIV (−0,05) — bei Außenmaßbezug korrekt", () => {
    assert.equal(psiDefault("gebaeudekante", "unkritisch"), -0.05);
    assert.ok(psiDefault("gebaeudekante", "unkritisch") < 0);
  });

  it("psiDefault() Härtung: unbekanntes Detail/unbekannte Qualität ⇒ 0", () => {
    assert.equal(psiDefault("gibtsnicht", "standard"), 0);
    assert.equal(psiDefault("sockel", "gibtsnicht"), 0);
    assert.equal(psiDefault(undefined, undefined), 0);
  });

  it("psiL(): negatives ψ bleibt negativ (psiNum, KEIN num)", () => {
    assert.equal(psiL({ psi: -0.05, laenge: 124 }), -6.2);
    assert.ok(psiL({ psi: -0.05, laenge: 124 }) < 0);
  });

  it("psiL() Härtung: negative Länge wird auf 0 geklemmt, ψ nicht", () => {
    assert.equal(psiL({ psi: 0.25, laenge: -100 }), 0);
    assert.equal(psiL({}), 0);
    assert.equal(psiL(undefined), 0);
    assert.equal(psiL({ psi: NaN, laenge: NaN }), 0);
  });

  it("summePsiL(): Standardkatalog ⇒ ≈ 219,4 W/K", () => {
    near(summePsiL(ROWS_STANDARD), 219.4, 0.5, "Σψ·l");
  });

  it("summePsiL(): aktiv=false wird ausgeschlossen, fehlendes aktiv gilt als aktiv", () => {
    const aus = ROWS_STANDARD.map((r) => ({ ...r, aktiv: false }));
    assert.equal(summePsiL(aus), 0);
    const ein = ROWS_STANDARD.map((r) => ({ ...r, aktiv: true }));
    near(summePsiL(ein), summePsiL(ROWS_STANDARD), 1e-9, "aktiv=true == ohne Flag");
  });

  it("summePsiL(): eine negative Zeile senkt die Summe (Vorzeichen wirkt)", () => {
    const mitNeg = [...ROWS_STANDARD, { key: "extra", laenge: 100, psi: -0.10 }];
    near(summePsiL(mitNeg), summePsiL(ROWS_STANDARD) - 10, 1e-9, "negative Zeile");
  });

  it("summePsiL() Härtung: kein Array/leer ⇒ 0", () => {
    assert.equal(summePsiL(null), 0);
    assert.equal(summePsiL(undefined), 0);
    assert.equal(summePsiL([]), 0);
    assert.equal(summePsiL("x"), 0);
  });
});

describe("thermalBridges.js — deltaUwbDetailliert()", () => {
  it("Standardkatalog / A_Hüll 4.810 m² ⇒ ΔU_WB ≈ 0,0456 W/(m²K)", () => {
    near(deltaUwbDetailliert(ROWS_STANDARD, A_HUELL), 0.0456, 0.001, "ΔU detailliert");
  });

  it("leerer Katalog ⇒ exakt 0 (nicht NaN)", () => {
    assert.equal(deltaUwbDetailliert([], A_HUELL), 0);
    assert.equal(deltaUwbDetailliert(null, A_HUELL), 0);
    assert.equal(deltaUwbDetailliert(undefined, undefined), 0);
  });

  it("Härtung: A_Hüll = 0 bleibt endlich (safeDiv), kein Infinity", () => {
    assert.ok(Number.isFinite(deltaUwbDetailliert(ROWS_STANDARD, 0)));
    assert.ok(Number.isFinite(deltaUwbDetailliert(ROWS_STANDARD, -4810)));
  });

  it("VORZEICHEN: ein rein negativer Katalog ergibt ein negatives ΔU_WB", () => {
    const negativ = deltaUwbDetailliert([{ key: "gebaeudekante", laenge: 124, psi: -0.05 }], A_HUELL);
    assert.ok(negativ < 0, `ΔU sollte negativ sein, ist ${negativ}`);
  });

  it("kritische Ausführung liegt über dem Pauschalwert 0,10 (0,10 < ΔU < 0,13)", () => {
    const krit = [
      { laenge: 108.07, psi: 0.45 }, { laenge: 108.07, psi: 0.45 },
      { laenge: 1031, psi: 0.10 }, { laenge: 479, psi: 0.15 },
      { laenge: 479, psi: 0.20 }, { laenge: 865, psi: 0.10 },
      { laenge: 124, psi: 0.05 }, { laenge: 96, psi: 0.70 },
    ];
    const dK = deltaUwbDetailliert(krit, A_HUELL);
    assert.ok(dK > 0.10 && dK < 0.13, `ΔU kritisch ist ${dK}`);
  });
});

describe("thermalBridges.js — Einheitenkette der Wirkung", () => {
  it("waermebrueckenVerlust(): ΔU · A · G_t ohne Zusatzfaktor ⇒ 0,10 · 4.810 · 84 ≈ 40.407 kWh/a", () => {
    near(waermebrueckenVerlust(0.10, A_HUELL, 84), 40407, 80, "q_WB");
  });

  it("heizlastZuschlag(): /1000 (W → kW) ⇒ ≈ 15,4 kW", () => {
    near(heizlastZuschlag(0.10, A_HUELL, 32), 15.4, 0.2, "Heizlast");
  });

  it("htZuschlag() ist exakt 1:1 = ΔU_WB (A kürzt sich heraus) — auch negativ", () => {
    assert.equal(htZuschlag(0.10), 0.10);
    assert.equal(htZuschlag(-0.05), -0.05);
    assert.equal(htZuschlag(undefined), 0);
    assert.equal(htZuschlag(NaN), 0);
  });

  it("anteilPct(): Division durch 0 bleibt endlich (safeDiv)", () => {
    assert.ok(Number.isFinite(anteilPct(1, 0)));
    near(anteilPct(40407, Q_REF), 11.2, 0.2, "Anteil");
    assert.equal(anteilPct(0, Q_REF), 0);
  });

  it("VORZEICHEN: negatives ΔU führt zu negativem Verlust/Heizlast, nicht zu 0", () => {
    assert.ok(waermebrueckenVerlust(-0.05, A_HUELL, 84) < 0);
    assert.ok(heizlastZuschlag(-0.05, A_HUELL, 32) < 0);
  });

  it("einsparpotenzial(): 0,10 → 0,05 ⇒ ≈ 20.203 kWh/a", () => {
    near(einsparpotenzial(0.10, 0.05, A_HUELL, 84), 20203, 60, "Einsparpotenzial");
  });

  it("einsparpotenzial(): Verschlechterung ergibt einen negativen Wert (0,10 → 0,15)", () => {
    assert.ok(einsparpotenzial(0.10, 0.15, A_HUELL, 84) < 0);
  });
});

describe("thermalBridges.js — wirkung()", () => {
  const w = wirkung({ deltaUwb: 0.10, aHuell: A_HUELL, gT: 84, qRef: Q_REF, dT: 32, bgf: 6570, htMax: 0.50 });

  it("Standardgebäude bei ΔU 0,10: H_WB ≈ 481 W/K, q_WB ≈ 40.407 kWh/a, Anteil ≈ 11,2 %", () => {
    near(w.hWb, 481, 1, "H_WB");
    near(w.qWb, 40407, 80, "q_WB");
    near(w.anteilPct, 11.2, 0.2, "Anteil");
  });

  it("Heizlast ≈ 15,4 kW, spez. ≈ 6,15 kWh/(m²·a), ΔH'_T = 0,10, H'_T-Anteil 20 %", () => {
    near(w.heizlastKw, 15.4, 0.2, "Heizlast");
    near(w.spezQwb, 6.15, 0.1, "spez. q_WB");
    near(w.htZuschlag, 0.10, 0.001, "ΔH'_T");
    near(w.htAnteilPct, 20, 0.5, "H'_T-Anteil");
  });

  it("Härtung: wirkung({}) und wirkung() liefern durchweg endliche Werte", () => {
    for (const r of [wirkung(), wirkung({})]) {
      for (const [k, v] of Object.entries(r)) {
        assert.ok(Number.isFinite(v), `${k} nicht endlich: ${v}`);
      }
    }
  });

  it("Härtung: negative/NaN-Eingaben bleiben endlich, Flächen werden geklemmt", () => {
    const r = wirkung({ deltaUwb: NaN, aHuell: -4810, gT: -84, qRef: 0, dT: -32, bgf: -6570, htMax: 0 });
    for (const [k, v] of Object.entries(r)) {
      assert.ok(Number.isFinite(v), `${k} nicht endlich: ${v}`);
    }
  });
});

describe("thermalBridges.js — verfahrensvergleich()", () => {
  const dUdet = deltaUwbDetailliert(ROWS_STANDARD, A_HUELL);
  const v = verfahrensvergleich({ aHuell: A_HUELL, gT: 84, qRef: Q_REF, dT: 32, bgf: 6570, deltaUwbDet: dUdet });
  const z = (k) => v.zeilen.find((r) => r.key === k);

  it("Verlust je Verfahren: 0,15 ⇒ 60.610 · 0,10 ⇒ 40.407 · 0,05 ⇒ 20.203 · 0,03 ⇒ 12.122 kWh/a", () => {
    near(z("innendaemmung").qWb, 60610, 120, "0,15");
    near(z("pauschal").qWb, 40407, 80, "0,10");
    near(z("gleichwertigkeit_a").qWb, 20203, 60, "0,05");
    near(z("gleichwertigkeit_b").qWb, 12122, 60, "0,03");
  });

  it("Anteile am Referenzbedarf: 16,8 / 11,2 / 5,6 / 3,4 %", () => {
    near(z("innendaemmung").anteilPct, 16.8, 0.3, "16,8 %");
    near(z("pauschal").anteilPct, 11.2, 0.2, "11,2 %");
    near(z("gleichwertigkeit_a").anteilPct, 5.6, 0.2, "5,6 %");
    near(z("gleichwertigkeit_b").anteilPct, 3.4, 0.2, "3,4 %");
  });

  it("detaillierte Zeile (ΔU 0,0456) ⇒ ≈ 18.422 kWh/a und wird nur bei ΔU > 0 angehängt", () => {
    near(z("detailliert").qWb, 18422, 90, "detailliert");
    const ohne = verfahrensvergleich({ aHuell: A_HUELL, gT: 84, qRef: Q_REF, deltaUwbDet: 0 });
    assert.equal(ohne.zeilen.length, 4);
    assert.equal(ohne.zeilen.find((r) => r.key === "detailliert"), undefined);
  });

  it("Innendämmung ist SCHLECHTER als der Pauschalwert ⇒ negative Einsparung", () => {
    assert.ok(z("innendaemmung").einsparungKwh < 0);
    assert.ok(z("gleichwertigkeit_a").einsparungKwh > 0);
    assert.equal(z("pauschal").einsparungKwh, 0);
  });

  it("Einsparpotenzial 0,10 → 0,05 ⇒ 20.203 kWh/a bzw. 5,6 %; Referenz-ΔU ist 0,10", () => {
    near(v.einsparPotenzialKwh, 20203, 60, "Potenzial kWh");
    near(v.einsparPotenzialPct, 5.6, 0.2, "Potenzial %");
    assert.equal(v.referenzDU, 0.10);
  });

  it("Härtung: verfahrensvergleich() ohne Argumente liefert 4 Zeilen mit endlichen Werten", () => {
    const leer = verfahrensvergleich();
    assert.equal(leer.zeilen.length, 4);
    for (const zeile of leer.zeilen) {
      for (const [k, val] of Object.entries(zeile)) {
        if (typeof val === "number") assert.ok(Number.isFinite(val), `${zeile.key}.${k} nicht endlich`);
      }
    }
    assert.ok(Number.isFinite(leer.einsparPotenzialKwh));
    assert.ok(Number.isFinite(leer.einsparPotenzialPct));
  });

  it("Härtung: negatives deltaUwbDet erzeugt KEINE detaillierte Zeile (nur > 0)", () => {
    const r = verfahrensvergleich({ aHuell: A_HUELL, deltaUwbDet: -0.02 });
    assert.equal(r.zeilen.find((zeile) => zeile.key === "detailliert"), undefined);
  });
});

describe("thermalBridges.js — wbChecks() Invarianten", () => {
  const dUdet = deltaUwbDetailliert(ROWS_STANDARD, A_HUELL);
  const aktiv = ROWS_STANDARD.map((r) => ({ ...r, aktiv: true, qualitaet: "standard" }));
  const c = wbChecks({
    verfahren: "pauschal", innendaemmung: "nein", aHuell: A_HUELL,
    deltaUwb: 0.10, deltaUwbDet: dUdet, htMax: 0.50, gT: 84,
    rows: aktiv, balkonAnzahl: 24, einsparPotenzialKwh: 20203,
  });

  it("liefert genau 10 Items mit den vereinbarten Keys", () => {
    assert.equal(c.items.length, 10);
    assert.deepEqual(c.items.map((i) => i.key), [
      "verfahren", "gleichwertigkeit", "huellflaeche", "laengen_vollstaendig", "balkon",
      "kritische_details", "innendaemmung", "plausibilitaet_detail", "ht_budget", "mindestwaermeschutz",
    ]);
  });

  it("Standardfall: verfahren warn, gleichwertigkeit/mindestwaermeschutz offen, huellflaeche pass, Ampel neutral", () => {
    const byKey = Object.fromEntries(c.items.map((i) => [i.key, i.status]));
    assert.equal(byKey.verfahren, "warn");
    assert.equal(byKey.gleichwertigkeit, "offen");
    assert.equal(byKey.mindestwaermeschutz, "offen");
    assert.equal(byKey.huellflaeche, "pass");
    assert.equal(c.ampel, "neutral");
    assert.equal(c.verdict, "Konzept offen");
  });

  it("INVARIANTE: wbChecks liefert NIE Status \"fail\" — nur pass/warn/offen", () => {
    const kritRows = aktiv.map((r) => ({ ...r, qualitaet: "kritisch" }));
    const varianten = [
      {},
      { rows: [] },
      { verfahren: "detailliert", deltaUwbDet: 0.0456, aHuell: A_HUELL, rows: aktiv, balkonAnzahl: 24 },
      { verfahren: "detailliert", deltaUwbDet: 0.30, aHuell: A_HUELL, rows: kritRows, innendaemmung: "ja", balkonAnzahl: 24 },
      { verfahren: "detailliert", deltaUwbDet: -0.05, aHuell: A_HUELL, rows: aktiv },
      { aHuell: -1, deltaUwb: NaN, htMax: -1, rows: null, balkonAnzahl: -5 },
      { verfahren: "gibtsnicht", rows: [{ laenge: 0, psi: 0 }] },
    ];
    for (const v of varianten) {
      const r = wbChecks(v);
      for (const i of r.items) {
        assert.ok(["pass", "warn", "offen"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
      assert.ok(!r.items.some((i) => i.status === "fail"), `fail bei ${JSON.stringify(v)}`);
    }
  });

  it("INVARIANTE: Ampel/Verdict folgen der Reihenfolge offen > warn > pass", () => {
    for (const v of [{}, { aHuell: A_HUELL, rows: aktiv, balkonAnzahl: 24 }]) {
      const r = wbChecks(v);
      const erwartet = r.offen > 0 ? "neutral" : r.warns > 0 ? "warn" : "pass";
      assert.equal(r.ampel, erwartet);
      assert.equal(r.verdict, r.offen > 0 ? "Konzept offen" : r.warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel");
    }
  });

  it("TB-01 behoben: \"offen\" zählt NICHT in den Score-Nenner ⇒ 100 % erreichbar", () => {
    const best = wbChecks({
      verfahren: "gleichwertigkeit_a", innendaemmung: "nein", aHuell: A_HUELL,
      deltaUwb: 0.05, htMax: 0.50, rows: aktiv.map((r) => ({ ...r, qualitaet: "standard" })), balkonAnzahl: 24,
    });
    assert.equal(best.offen, 2); // gleichwertigkeit + mindestwaermeschutz sind strukturell offen
    assert.equal(best.warns, 0);
    assert.equal(best.score, 100, "kein struktureller Deckel mehr (vorher 80 %)");
    assert.equal(best.bewertet, best.total - best.offen, "Nenner = bewertete Items");
    // Ampel bleibt bewusst neutral, solange etwas offen ist — Score und Ampel sind getrennt.
    assert.equal(best.ampel, "neutral");
  });

  it("TB-01: score ist null, wenn kein einziges Item bewertet werden konnte", () => {
    const leer = wbChecks({});
    assert.ok(leer.offen > 0);
    if (leer.bewertet === 0) assert.equal(leer.score, null, "kein bewertetes Item ⇒ score null, nicht 0 %");
    else assert.ok(typeof leer.score === "number");
  });

  it("Verfahrenswahl: Gleichwertigkeit A/B und detailliert ⇒ pass, pauschal ⇒ warn mit Potenzialhinweis", () => {
    for (const verfahren of ["gleichwertigkeit_a", "gleichwertigkeit_b", "detailliert"]) {
      assert.equal(wbChecks({ verfahren }).items.find((i) => i.key === "verfahren").status, "pass");
    }
    const warnItem = wbChecks({ verfahren: "pauschal", einsparPotenzialKwh: 20203 }).items.find((i) => i.key === "verfahren");
    assert.equal(warnItem.status, "warn");
    assert.match(warnItem.detail, /20\.203 kWh\/a/);
  });

  it("Plausibilität detailliert: 0,0456 ⇒ pass, > 0,10 ⇒ warn (schlechter als pauschal), 0 ⇒ warn (unplausibel niedrig)", () => {
    const rows = aktiv;
    const gut = wbChecks({ verfahren: "detailliert", deltaUwbDet: 0.0456, aHuell: A_HUELL, rows });
    assert.equal(gut.items.find((i) => i.key === "plausibilitaet_detail").status, "pass");

    const schlecht = wbChecks({ verfahren: "detailliert", deltaUwbDet: 0.12, aHuell: A_HUELL, rows });
    const sItem = schlecht.items.find((i) => i.key === "plausibilitaet_detail");
    assert.equal(sItem.status, "warn");
    assert.match(sItem.detail, /schlechter als der Pauschalwert/);

    const zuNiedrig = wbChecks({ verfahren: "detailliert", deltaUwbDet: 0.005, aHuell: A_HUELL, rows });
    const nItem = zuNiedrig.items.find((i) => i.key === "plausibilitaet_detail");
    assert.equal(nItem.status, "warn");
    assert.match(nItem.detail, /unplausibel niedrig/);
  });

  it("Plausibilitätsgrenzen exakt: 0,01 und 0,10 sind noch pass, 0,1001 ist warn", () => {
    const rows = aktiv;
    assert.equal(wbChecks({ verfahren: "detailliert", deltaUwbDet: 0.01, aHuell: A_HUELL, rows }).items.find((i) => i.key === "plausibilitaet_detail").status, "pass");
    assert.equal(wbChecks({ verfahren: "detailliert", deltaUwbDet: 0.10, aHuell: A_HUELL, rows }).items.find((i) => i.key === "plausibilitaet_detail").status, "pass");
    assert.equal(wbChecks({ verfahren: "detailliert", deltaUwbDet: 0.1001, aHuell: A_HUELL, rows }).items.find((i) => i.key === "plausibilitaet_detail").status, "warn");
  });

  it("kritische Details und Innendämmung erzeugen jeweils warn", () => {
    const cKrit = wbChecks({
      verfahren: "detailliert", innendaemmung: "ja", aHuell: A_HUELL,
      deltaUwb: 0.12, deltaUwbDet: 0.12, htMax: 0.50,
      rows: aktiv.map((r) => ({ ...r, qualitaet: "kritisch" })), balkonAnzahl: 24,
    });
    assert.equal(cKrit.items.find((i) => i.key === "kritische_details").status, "warn");
    assert.equal(cKrit.items.find((i) => i.key === "innendaemmung").status, "warn");
    assert.equal(cKrit.items.find((i) => i.key === "plausibilitaet_detail").status, "warn");
    assert.equal(cKrit.items.find((i) => i.key === "balkon").status, "warn");
  });

  it("Zeilen ohne Länge ⇒ laengen_vollstaendig warn (ΔU_WB zu niedrig)", () => {
    const r = wbChecks({ aHuell: A_HUELL, rows: [{ key: "sockel", laenge: 0, psi: 0.25, aktiv: true }] });
    const item = r.items.find((i) => i.key === "laengen_vollstaendig");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /ohne Länge/);
  });

  it("H'_T-Budget: Grenze exakt bei 20 % — 0,10/0,50 ⇒ pass, 0,101/0,50 ⇒ warn", () => {
    assert.equal(wbChecks({ deltaUwb: 0.10, htMax: 0.50 }).items.find((i) => i.key === "ht_budget").status, "pass");
    assert.equal(wbChecks({ deltaUwb: 0.101, htMax: 0.50 }).items.find((i) => i.key === "ht_budget").status, "warn");
    assert.equal(wbChecks({ deltaUwb: 0.10, htMax: 0 }).items.find((i) => i.key === "ht_budget").status, "offen");
  });

  it("leerer Aufruf: mehrere offene Items, Hüllfläche offen, keine NaN-Texte", () => {
    const leer = wbChecks({});
    assert.ok(leer.offen > 0);
    assert.equal(leer.items.find((i) => i.key === "huellflaeche").status, "offen");
    assert.ok(Number.isFinite(leer.score));
    for (const i of leer.items) {
      assert.equal(typeof i.detail, "string");
      assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
    }
  });

  it("Härtung: rows = null / nicht-Array wird als leer behandelt", () => {
    for (const rows of [null, undefined, "x", 42, {}]) {
      const r = wbChecks({ rows, aHuell: A_HUELL });
      assert.equal(r.items.length, 10);
      assert.equal(r.items.find((i) => i.key === "laengen_vollstaendig").status, "offen");
    }
  });
});
