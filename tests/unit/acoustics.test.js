// Unit-Tests für packages/nova-designer/src/lib/acoustics.js (Schallschutz, DIN 4109).
//
// Belegte Sample-Werte: .planning/phases/24-schallschutzgutachten-reiter/24-01-PLAN.md:38-39
//   (Bänder I–VII, ERF_RW_AUSSEN, TRENN_RICHTWERTE 53/54/27 dB, TRITTSCHALL_GRENZE 50,
//   DECKENAUFBAU 46/53/63 dB, TGA_GRENZE 30; Smoke: laermpegelbereich(58) = "II",
//   laermpegelbereich(72) = "V", erfRwGes("IV","wohnen") = 40, Basisfall dbA 68 /
//   rwAussenIst 40 ⇒ 0 Hinweise) und 24-01-SUMMARY.md:6/14.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LAERMPEGELBEREICHE,
  ERF_RW_AUSSEN,
  TRENN_RICHTWERTE,
  TRITTSCHALL_GRENZE,
  DECKENAUFBAU,
  TGA_GRENZE,
  LAERMQUELLEN,
  RAUMARTEN,
  laermpegelbereich,
  erfRwGes,
  schallChecks,
} from "@designer/lib/acoustics";

// Basisfall aus 24-01-PLAN.md:39 (Lärmpegelbereich IV, alles erfüllt).
const BASIS = {
  dbA: 68, raumart: "wohnen", rwAussenIst: 40, rwTrennIst: 54, rwDeckeIst: 54,
  deckenaufbau: "massiv_estrich", tgaPegel: 28,
};

describe("acoustics.js — Richtwert-Konstanten", () => {
  it("7 Lärmpegelbereiche I–VII mit den Bandobergrenzen 55/60/65/70/75/80/999", () => {
    assert.equal(LAERMPEGELBEREICHE.length, 7);
    assert.deepEqual(LAERMPEGELBEREICHE.map((b) => b.bereich), ["I", "II", "III", "IV", "V", "VI", "VII"]);
    assert.deepEqual(LAERMPEGELBEREICHE.map((b) => b.bis), [55, 60, 65, 70, 75, 80, 999]);
  });

  it("ERF_RW_AUSSEN deckt alle 7 Bereiche mit wohnen/buero ab", () => {
    for (const b of ["I", "II", "III", "IV", "V", "VI", "VII"]) {
      assert.ok(Number.isFinite(ERF_RW_AUSSEN[b].wohnen), `${b}.wohnen`);
      assert.ok(Number.isFinite(ERF_RW_AUSSEN[b].buero), `${b}.buero`);
    }
    assert.equal(ERF_RW_AUSSEN.IV.wohnen, 40);
    assert.equal(ERF_RW_AUSSEN.IV.buero, 35);
  });

  it("Anforderungen steigen monoton mit dem Lärmpegelbereich", () => {
    const reihe = ["I", "II", "III", "IV", "V", "VI", "VII"];
    for (let i = 1; i < reihe.length; i += 1) {
      assert.ok(ERF_RW_AUSSEN[reihe[i]].wohnen >= ERF_RW_AUSSEN[reihe[i - 1]].wohnen, `wohnen ${reihe[i]}`);
      assert.ok(ERF_RW_AUSSEN[reihe[i]].buero >= ERF_RW_AUSSEN[reihe[i - 1]].buero, `buero ${reihe[i]}`);
    }
  });

  it("Trennbauteil-Richtwerte 53/54/27 dB, Trittschallgrenze 50 dB, TGA-Grenze 30 dB(A)", () => {
    assert.equal(TRENN_RICHTWERTE.wand_wohnungstrennend, 53);
    assert.equal(TRENN_RICHTWERTE.decke_wohnungstrennend, 54);
    assert.equal(TRENN_RICHTWERTE.tuer_flur, 27);
    assert.equal(TRITTSCHALL_GRENZE, 50);
    assert.equal(TGA_GRENZE, 30);
  });

  it("Deckenaufbauten: massiv+Estrich 46 dB, Holz 53 dB, ohne 63 dB", () => {
    assert.equal(DECKENAUFBAU.massiv_estrich.lnw, 46);
    assert.equal(DECKENAUFBAU.holz.lnw, 53);
    assert.equal(DECKENAUFBAU.ohne.lnw, 63);
  });

  it("Lärmquellen und Raumarten sind exportiert (Select-Vertrag)", () => {
    assert.deepEqual(Object.keys(LAERMQUELLEN), ["strasse", "schiene", "gewerbe", "flug"]);
    assert.deepEqual(Object.keys(RAUMARTEN), ["wohnen", "buero"]);
  });
});

describe("acoustics.js — laermpegelbereich()", () => {
  it("belegte Sample-Werte: 58 dB(A) ⇒ II, 72 dB(A) ⇒ V", () => {
    assert.equal(laermpegelbereich(58), "II");
    assert.equal(laermpegelbereich(72), "V");
  });

  it("Basisfall 68 dB(A) ⇒ Lärmpegelbereich IV", () => {
    assert.equal(laermpegelbereich(68), "IV");
  });

  it("Bandgrenzen sind inklusiv (≤): 55 ⇒ I, 55,01 ⇒ II, 80 ⇒ VI, 80,01 ⇒ VII", () => {
    assert.equal(laermpegelbereich(55), "I");
    assert.equal(laermpegelbereich(55.01), "II");
    assert.equal(laermpegelbereich(60), "II");
    assert.equal(laermpegelbereich(60.01), "III");
    assert.equal(laermpegelbereich(80), "VI");
    assert.equal(laermpegelbereich(80.01), "VII");
  });

  it("Härtung: 0/negativ/undefined/NaN ⇒ Bereich I (num-Klemmung), nie undefined", () => {
    for (const v of [0, -70, undefined, null, NaN, "", {}]) {
      assert.equal(laermpegelbereich(v), "I", `laermpegelbereich(${String(v)})`);
    }
  });

  it("absurd hoher Pegel bleibt in Bereich VII (kein undefined)", () => {
    assert.equal(laermpegelbereich(1e6), "VII");
  });
});

describe("acoustics.js — erfRwGes()", () => {
  it("belegter Sample-Wert: Bereich IV / wohnen ⇒ 40 dB", () => {
    assert.equal(erfRwGes("IV", "wohnen"), 40);
  });

  it("Büro verlangt in Bereich IV nur 35 dB", () => {
    assert.equal(erfRwGes("IV", "buero"), 35);
  });

  it("Härtung: unbekannter Bereich fällt auf I zurück", () => {
    assert.equal(erfRwGes("XIII", "wohnen"), ERF_RW_AUSSEN.I.wohnen);
    assert.equal(erfRwGes(undefined, "wohnen"), ERF_RW_AUSSEN.I.wohnen);
  });

  it("Härtung: unbekannte Raumart fällt auf wohnen zurück (konservativer Wert)", () => {
    assert.equal(erfRwGes("IV", "werkstatt"), ERF_RW_AUSSEN.IV.wohnen);
    assert.equal(erfRwGes("IV", undefined), ERF_RW_AUSSEN.IV.wohnen);
    assert.ok(erfRwGes("IV", "werkstatt") >= erfRwGes("IV", "buero"), "Fallback muss die schärfere Anforderung sein");
  });

  it("Härtung: leerer Aufruf liefert eine endliche Zahl", () => {
    assert.ok(Number.isFinite(erfRwGes()));
  });
});

describe("acoustics.js — schallChecks() Invarianten", () => {
  it("Basisfall (dbA 68, alles erfüllt): 5 Items, 0 Hinweise, Verdict plausibel, Score 100", () => {
    const c = schallChecks(BASIS);
    assert.equal(c.items.length, 5);
    assert.equal(c.warns, 0);
    assert.equal(c.score, 100);
    assert.equal(c.verdict, "Konzept plausibel");
    assert.deepEqual(c.items.map((i) => i.key), ["aussen", "trennwand", "trenndecke", "trittschall", "tga"]);
  });

  it("Basisfall nennt den Lärmpegelbereich IV im Detailtext", () => {
    assert.match(schallChecks(BASIS).items.find((i) => i.key === "aussen").detail, /Lärmpegelbereich IV/);
  });

  it("INVARIANTE: schallChecks liefert NIE Status \"fail\" (Haftung)", () => {
    const varianten = [
      {}, BASIS,
      { dbA: 95, raumart: "wohnen", rwAussenIst: 0, rwTrennIst: 0, rwDeckeIst: 0, deckenaufbau: "ohne", tgaPegel: 90 },
      { dbA: -68, rwAussenIst: -40, rwTrennIst: -54, rwDeckeIst: -54, tgaPegel: -28 },
      { dbA: NaN, rwAussenIst: NaN, rwTrennIst: NaN, rwDeckeIst: NaN, tgaPegel: NaN },
      { deckenaufbau: "gibtsnicht", raumart: "gibtsnicht" },
      { dbA: 1e9, tgaPegel: 1e9 },
    ];
    for (const v of varianten) {
      const c = schallChecks(v);
      for (const i of c.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("Grenzwerte exakt: R'w,ges genau am erforderlichen Wert ⇒ pass, 1 dB darunter ⇒ warn", () => {
    assert.equal(schallChecks({ ...BASIS, rwAussenIst: 40 }).items.find((i) => i.key === "aussen").status, "pass");
    assert.equal(schallChecks({ ...BASIS, rwAussenIst: 39 }).items.find((i) => i.key === "aussen").status, "warn");
    assert.equal(schallChecks({ ...BASIS, rwTrennIst: 53 }).items.find((i) => i.key === "trennwand").status, "pass");
    assert.equal(schallChecks({ ...BASIS, rwTrennIst: 52.9 }).items.find((i) => i.key === "trennwand").status, "warn");
    assert.equal(schallChecks({ ...BASIS, rwDeckeIst: 54 }).items.find((i) => i.key === "trenndecke").status, "pass");
    assert.equal(schallChecks({ ...BASIS, rwDeckeIst: 53.9 }).items.find((i) => i.key === "trenndecke").status, "warn");
  });

  it("TGA-Grenze exakt: 30 dB(A) ⇒ pass, 30,1 ⇒ warn", () => {
    assert.equal(schallChecks({ ...BASIS, tgaPegel: 30 }).items.find((i) => i.key === "tga").status, "pass");
    assert.equal(schallChecks({ ...BASIS, tgaPegel: 30.1 }).items.find((i) => i.key === "tga").status, "warn");
  });

  it("Deckenaufbau \"ohne\" (63 dB) und Holz (53 dB) verletzen die Trittschallgrenze 50 dB", () => {
    assert.equal(schallChecks({ ...BASIS, deckenaufbau: "ohne" }).items.find((i) => i.key === "trittschall").status, "warn");
    assert.equal(schallChecks({ ...BASIS, deckenaufbau: "holz" }).items.find((i) => i.key === "trittschall").status, "warn");
    assert.equal(schallChecks({ ...BASIS, deckenaufbau: "massiv_estrich" }).items.find((i) => i.key === "trittschall").status, "pass");
  });

  it("Härtung: unbekannter Deckenaufbau fällt konservativ auf \"ohne\" (63 dB) zurück ⇒ warn", () => {
    const c = schallChecks({ ...BASIS, deckenaufbau: "gibtsnicht" });
    const tritt = c.items.find((i) => i.key === "trittschall");
    assert.equal(tritt.status, "warn");
    assert.match(tritt.detail, new RegExp(DECKENAUFBAU.ohne.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("dbA > 75 fügt ein sechstes Hinweis-Item hinzu; genau 75 nicht", () => {
    const hoch = schallChecks({ ...BASIS, dbA: 76 });
    assert.equal(hoch.items.length, 6);
    const hinweis = hoch.items.find((i) => i.key === "hoherAussenlaerm");
    assert.equal(hinweis.status, "warn");
    assert.match(hinweis.detail, /Einzelfallnachweis/);

    assert.equal(schallChecks({ ...BASIS, dbA: 75 }).items.length, 5);
  });

  it("ME-04: fehlende Ist-Werte sind kein stiller pass (Default 0 ⇒ warn)", () => {
    const c = schallChecks({ dbA: 68, raumart: "wohnen" });
    for (const key of ["aussen", "trennwand", "trenndecke"]) {
      assert.equal(c.items.find((i) => i.key === key).status, "warn", `${key} sollte warn sein`);
    }
  });

  it("INVARIANTE: Score konsistent mit den Item-Status, 0–100; warns = Rest", () => {
    for (const v of [{}, BASIS, { ...BASIS, dbA: 90 }, { ...BASIS, deckenaufbau: "ohne", tgaPegel: 50 }]) {
      const c = schallChecks(v);
      const passes = c.items.filter((i) => i.status === "pass").length;
      assert.equal(c.score, Math.round((passes / c.items.length) * 100));
      assert.ok(c.score >= 0 && c.score <= 100, `Score ${c.score}`);
      assert.equal(c.warns, c.items.length - passes);
      assert.equal(c.verdict, c.warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel");
    }
  });

  it("Härtung: leerer Aufruf liefert 5 Items ohne NaN/Infinity im Detailtext", () => {
    for (const c of [schallChecks(), schallChecks({})]) {
      assert.equal(c.items.length, 5);
      assert.ok(Number.isFinite(c.score));
      for (const i of c.items) {
        assert.equal(typeof i.detail, "string");
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });

  it("Härtung: extreme und negative Eingaben erzeugen keine NaN-Texte", () => {
    const c = schallChecks({ dbA: 1e9, rwAussenIst: -1e9, rwTrennIst: NaN, rwDeckeIst: -5, tgaPegel: 1e9 });
    for (const i of c.items) {
      assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `${i.key}: ${i.detail}`);
    }
  });
});
