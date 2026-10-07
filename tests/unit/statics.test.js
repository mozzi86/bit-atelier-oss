// Unit-Tests für packages/nova-designer/src/lib/statics.js (Tragwerks-Vorbemessung).
//
// Belegte Sample-Werte: .planning/phases/15-statik-reiter-eingaben-zur-tragwerksplanung/
//   15-01-PLAN.md (Smoke: deckenstaerke(8, "flachdecke") = 30 cm, deckenstaerke(8, "holz")
//   = 40 cm, gesamtlast({gk:5, dg:1.5, qk:2, footArea:280}) = 2.380 kN).
//
// BESONDERHEIT (HANDOFF Abschnitt G): Diese Lib gibt bei fehlender Fläche bewusst `null`
// statt eines plausibel aussehenden Werts zurück. Das ist ERWÜNSCHTES Verhalten und wird
// hier explizit festgeschrieben — safeDiv-Klemmen wären hier ein Rückschritt.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LOAD_CATEGORIES,
  BETON_GRADES,
  EC8_ZONES,
  deckenstaerke,
  gesamtlast,
  gebaeudelast,
  gruendungslast,
  betonFcd,
  stuetzenVordim,
  bewehrungMasse,
  betonvolumenDecken,
  vorbemessungChecks,
  erdbebenKennwerte,
} from "@designer/lib/statics";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""}: ${actual} ≠ ${expected} (±${tol})`);

describe("statics.js — Kataloge", () => {
  it("Nutzlast-Kategorien A–E nach EC1 mit qk 2,0/2,0/5,0/5,0/7,5 kN/m²", () => {
    assert.deepEqual(Object.keys(LOAD_CATEGORIES), ["A", "B", "C", "D", "E"]);
    assert.equal(LOAD_CATEGORIES.A.qk, 2.0);
    assert.equal(LOAD_CATEGORIES.B.qk, 2.0);
    assert.equal(LOAD_CATEGORIES.C.qk, 5.0);
    assert.equal(LOAD_CATEGORIES.D.qk, 5.0);
    assert.equal(LOAD_CATEGORIES.E.qk, 7.5);
  });

  it("Betongüten C20/25 bis C35/45 mit fck 20/25/30/35 N/mm²", () => {
    assert.equal(BETON_GRADES["C20/25"].fck, 20);
    assert.equal(BETON_GRADES["C25/30"].fck, 25);
    assert.equal(BETON_GRADES["C30/37"].fck, 30);
    assert.equal(BETON_GRADES["C35/45"].fck, 35);
  });

  it("EC8-Zonen 0–3 mit agR 0,0/0,4/0,6/0,8 m/s²", () => {
    assert.equal(EC8_ZONES["0"].agR, 0.0);
    assert.equal(EC8_ZONES["1"].agR, 0.4);
    assert.equal(EC8_ZONES["2"].agR, 0.6);
    assert.equal(EC8_ZONES["3"].agR, 0.8);
  });
});

describe("statics.js — deckenstaerke() (Biegeschlankheit l/d)", () => {
  it("belegte Sample-Werte: 8 m Spannweite ⇒ 30 cm Flachdecke, 40 cm Holzdecke", () => {
    assert.equal(deckenstaerke(8, "flachdecke", false), 30);
    assert.equal(deckenstaerke(8, "holz"), 40);
  });

  it("auf 5 cm aufgerundet: 8 m/30 = 26,7 cm ⇒ 30 cm", () => {
    near(800 / 30, 26.67, 0.01, "roher Wert");
    assert.equal(deckenstaerke(8), 30);
    assert.equal(deckenstaerke(8) % 5, 0);
  });

  it("strenge Durchbiegung VERSCHÄRFT nur (kleinerer Teiler ⇒ dickere Decke)", () => {
    assert.ok(deckenstaerke(8, "flachdecke", true) >= deckenstaerke(8, "flachdecke", false));
    assert.equal(deckenstaerke(8, "flachdecke", true), 35); // 800/25 = 32 ⇒ 35
    assert.ok(deckenstaerke(8, "holz", true) >= deckenstaerke(8, "holz", false));
    assert.equal(deckenstaerke(8, "holz", true), 50); // 800/17 = 47,1 ⇒ 50
  });

  it("unbekanntes Deckensystem verhält sich wie Stahlbeton (Teiler 30)", () => {
    assert.equal(deckenstaerke(8, "gibtsnicht"), deckenstaerke(8, "flachdecke"));
  });

  it("Härtung: Spannweite 0/negativ/undefined wird auf 0,1 m geklemmt ⇒ 5 cm, nie 0 oder NaN", () => {
    for (const v of [0, -8, undefined, null, NaN, ""]) {
      const d = deckenstaerke(v);
      assert.ok(Number.isFinite(d) && d > 0, `deckenstaerke(${String(v)}) ist ${d}`);
      assert.equal(d, 5);
    }
  });

  it("monoton: größere Spannweite ergibt nie eine dünnere Decke", () => {
    let vorher = 0;
    for (const l of [2, 4, 6, 8, 10, 12, 15, 20]) {
      const d = deckenstaerke(l);
      assert.ok(d >= vorher, `bei ${l} m: ${d} < ${vorher}`);
      vorher = d;
    }
  });
});

describe("statics.js — Lasten", () => {
  it("belegter Sample-Wert: (5 + 1,5 + 2) · 280 m² = 2.380 kN je Geschoss", () => {
    assert.equal(gesamtlast({ gk: 5, dg: 1.5, qk: 2, footArea: 280 }), 2380);
  });

  it("gebaeudelast() multipliziert mit der Geschossanzahl", () => {
    assert.equal(gebaeudelast(2380, 4), 9520);
  });

  it("Härtung: negative Fläche/Geschosse werden geklemmt ⇒ 0, nie negativ", () => {
    assert.equal(gesamtlast({ gk: 5, dg: 1.5, qk: 2, footArea: -280 }), 0);
    assert.equal(gebaeudelast(2380, -4), 0);
  });

  it("Härtung: leere/NaN-Eingaben ⇒ 0, nie NaN", () => {
    assert.equal(gesamtlast({}), 0);
    assert.equal(gesamtlast({ gk: NaN, dg: NaN, qk: NaN, footArea: NaN }), 0);
    assert.equal(gebaeudelast(undefined, undefined), 0);
  });

  it("negative Lastanteile bleiben erhalten (Auftrieb/Entlastung ist rechnerisch möglich)", () => {
    assert.equal(gesamtlast({ gk: 5, dg: -1, qk: 0, footArea: 100 }), 400);
  });
});

describe("statics.js — null bei fehlender Fläche (ERWÜNSCHTES Verhalten, HANDOFF G)", () => {
  it("gruendungslast(): mit Fläche wird σ gerechnet", () => {
    assert.equal(gruendungslast({ N: 9520, footArea: 280 }), 34);
  });

  it("gruendungslast(): OHNE Fläche exakt null — kein plausibel aussehender Falschwert", () => {
    assert.equal(gruendungslast({ N: 9520, footArea: 0 }), null);
    assert.equal(gruendungslast({ N: 9520 }), null);
    assert.equal(gruendungslast({ N: 9520, footArea: -280 }), null);
    assert.equal(gruendungslast({}), null);
    // ausdrücklich NICHT 0 und ausdrücklich NICHT Infinity
    assert.notEqual(gruendungslast({ N: 9520, footArea: 0 }), 0);
    assert.notEqual(gruendungslast({ N: 9520, footArea: 0 }), Infinity);
  });

  it("stuetzenVordim(): mit Fläche und fcd wird A_c gerechnet", () => {
    const fcd = betonFcd("C25/30");
    const ac = stuetzenVordim({ gesamtlastProGeschoss: 2380, storeys: 4, footArea: 280, einzugA: 25, fcd });
    assert.ok(Number.isFinite(ac) && ac > 0, `A_c ist ${ac}`);
    // N_Stütze = 9520 · 25 / 280 = 850 kN; A_c = 850 / (0,5 · 16.666,7) = 0,102 m² = 1.020 cm²
    near(ac, 1020, 5, "A_c");
  });

  it("stuetzenVordim(): OHNE Fläche oder OHNE fcd exakt null", () => {
    const fcd = betonFcd("C25/30");
    assert.equal(stuetzenVordim({ gesamtlastProGeschoss: 2380, storeys: 4, footArea: 0, einzugA: 25, fcd }), null);
    assert.equal(stuetzenVordim({ gesamtlastProGeschoss: 2380, storeys: 4, footArea: 280, einzugA: 25, fcd: 0 }), null);
    assert.equal(stuetzenVordim({ footArea: -280, fcd }), null);
    assert.equal(stuetzenVordim({}), null);
  });
});

describe("statics.js — Beton / Bewehrung", () => {
  it("betonFcd(): fck / 1,5 · 1000 ⇒ C25/30 ergibt 16.666,67 kN/m²", () => {
    near(betonFcd("C25/30"), (25 / 1.5) * 1000, 0.01, "fcd C25/30");
    near(betonFcd("C20/25"), (20 / 1.5) * 1000, 0.01, "fcd C20/25");
  });

  it("EINHEITENFALLE: fcd wird in kN/m² geliefert (1 N/mm² = 1.000 kN/m²)", () => {
    assert.ok(betonFcd("C25/30") > 1000, "kN/m² muss > 1000 sein");
    near(betonFcd("C25/30") / 1000, 25 / 1.5, 0.01, "zurück in N/mm²");
  });

  it("unbekannte Güte fällt auf C25/30 zurück", () => {
    assert.equal(betonFcd("C99/99"), betonFcd("C25/30"));
    assert.equal(betonFcd(undefined), betonFcd("C25/30"));
    assert.equal(betonFcd(), betonFcd("C25/30"));
  });

  it("betonvolumenDecken(): 30 cm · 6.570 m² BGF = 1.971 m³", () => {
    assert.equal(betonvolumenDecken(30, 6570), 1971);
  });

  it("bewehrungMasse(): 100 kg/m³ Decke, 200 Stütze, 110 Platte; unbekanntes Bauteil ⇒ Decke", () => {
    assert.equal(bewehrungMasse(1971, "decke"), 197100);
    assert.equal(bewehrungMasse(10, "stuetze"), 2000);
    assert.equal(bewehrungMasse(10, "platte"), 1100);
    assert.equal(bewehrungMasse(10, "gibtsnicht"), bewehrungMasse(10, "decke"));
  });

  it("Härtung: 0/negativ/undefined ⇒ 0, nie NaN", () => {
    for (const v of [0, undefined, NaN, null]) {
      assert.equal(betonvolumenDecken(v, 6570), 0, `betonvolumenDecken(${String(v)})`);
      assert.equal(bewehrungMasse(v), 0);
    }
    assert.equal(betonvolumenDecken(30, -6570), 0);
  });
});

describe("statics.js — vorbemessungChecks() Invarianten", () => {
  it("Basisfall (σ 150 ≤ zul. 200, Fläche und Geschosse erfasst): 3 Items, 0 Hinweise", () => {
    const c = vorbemessungChecks({ sigma: 150, zulSohldruck: 200, gesamtlastProGeschoss: 2380, storeys: 4, footArea: 280 });
    assert.equal(c.items.length, 3);
    assert.deepEqual(c.items.map((i) => i.key), ["sohldruck", "footArea", "storeys"]);
    assert.equal(c.warns, 0);
    assert.equal(c.score, 100);
    assert.equal(c.verdict, "Vorbemessung plausibel");
  });

  it("sigma === null (Fläche fehlt) ⇒ warn mit \"nicht berechenbar\", kein stiller pass", () => {
    const c = vorbemessungChecks({ sigma: null, zulSohldruck: 200, footArea: 0, storeys: 4 });
    const item = c.items.find((i) => i.key === "sohldruck");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /nicht berechenbar/);
    assert.match(item.detail, /Grundfläche fehlt/);
  });

  it("Grenzwert exakt: σ = zul. ⇒ pass, σ = zul. + 0,1 ⇒ warn", () => {
    assert.equal(vorbemessungChecks({ sigma: 200, zulSohldruck: 200 }).items.find((i) => i.key === "sohldruck").status, "pass");
    assert.equal(vorbemessungChecks({ sigma: 200.1, zulSohldruck: 200 }).items.find((i) => i.key === "sohldruck").status, "warn");
  });

  it("INVARIANTE: vorbemessungChecks liefert NIE Status \"fail\" (T-15-03, Haftung)", () => {
    const varianten = [
      {},
      { sigma: 1e9, zulSohldruck: 0, footArea: 0, storeys: 0 },
      { sigma: null, footArea: -280, storeys: -4, gesamtlastProGeschoss: -2380 },
      { sigma: NaN, zulSohldruck: NaN, footArea: NaN, storeys: NaN },
      { sigma: 150, zulSohldruck: 200, gesamtlastProGeschoss: 2380, storeys: 4, footArea: 280 },
    ];
    for (const v of varianten) {
      const c = vorbemessungChecks(v);
      for (const i of c.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("Härtung: leerer Aufruf liefert 3 Items ohne NaN-Texte und endlichen Score", () => {
    for (const c of [vorbemessungChecks(), vorbemessungChecks({})]) {
      assert.equal(c.items.length, 3);
      assert.ok(Number.isFinite(c.score));
      for (const i of c.items) {
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });

  it("Härtung: negative Geschossanzahl erscheint nicht negativ im Text", () => {
    const c = vorbemessungChecks({ storeys: -4, gesamtlastProGeschoss: -2380 });
    const item = c.items.find((i) => i.key === "storeys");
    assert.match(item.detail, /^0 Geschosse/);
    assert.ok(!/-/.test(item.detail.split("·")[0]), `negative Zahl im Text: ${item.detail}`);
  });
});

describe("statics.js — erdbebenKennwerte() (EC8, vereinfacht)", () => {
  it("Zone 0 ist inaktiv: agR 0 ⇒ Sd 0, Fb 0, active false", () => {
    const e = erdbebenKennwerte({ zone: "0", height: 31, gebaeudelastKN: 9520 });
    assert.equal(e.agR, 0);
    assert.equal(e.Sd, 0);
    assert.equal(e.Fb, 0);
    assert.equal(e.active, false);
    assert.equal(e.topDisp, 0);
  });

  it("Zone 2: Sd = agR · S · 2,5 / q ⇒ 0,6 · 1,25 · 2,5 / 1,5 = 1,25 m/s²", () => {
    const e = erdbebenKennwerte({ zone: "2", height: 31, gebaeudelastKN: 9520 });
    near(e.Sd, 1.25, 1e-9, "Sd");
    assert.equal(e.active, true);
    near(e.seismicCoeff, 1.25 / 9.81, 1e-9, "Erdbebenbeiwert");
    near(e.Fb, (1.25 / 9.81) * 9520 * 0.85, 1e-6, "Basisschub");
  });

  it("T1 = 0,05 · H^0,75 — bei 31 m ⇒ ≈ 0,656 s", () => {
    const e = erdbebenKennwerte({ zone: "2", height: 31 });
    near(e.T1, 0.05 * Math.pow(31, 0.75), 1e-9, "T1");
    near(e.T1, 0.656, 0.005, "T1 ≈ 0,656 s");
  });

  it("q wird auf mind. 1 geklemmt: q = 0 darf Sd NICHT überhöhen", () => {
    const mit0 = erdbebenKennwerte({ zone: "2", height: 31, q: 0 });
    assert.equal(mit0.q, 1);
    assert.ok(Number.isFinite(mit0.Sd));
    near(mit0.Sd, 0.6 * 1.25 * 2.5, 1e-9, "Sd bei q=1");
    const mitNegativ = erdbebenKennwerte({ zone: "2", height: 31, q: -3 });
    assert.equal(mitNegativ.q, 1);
  });

  it("höheres q reduziert Sd und damit den Basisschub", () => {
    const q15 = erdbebenKennwerte({ zone: "3", height: 31, gebaeudelastKN: 9520, q: 1.5 });
    const q30 = erdbebenKennwerte({ zone: "3", height: 31, gebaeudelastKN: 9520, q: 3.0 });
    assert.ok(q30.Sd < q15.Sd);
    assert.ok(q30.Fb < q15.Fb);
  });

  it("Härtung: unbekannte Zone fällt auf 0 zurück (inaktiv)", () => {
    for (const zone of ["9", "abc", undefined, null, 99]) {
      const e = erdbebenKennwerte({ zone, height: 31 });
      assert.equal(e.active, false, `Zone ${String(zone)}`);
      assert.equal(e.agR, 0);
    }
  });

  it("Härtung: Höhe 0/negativ wird auf 0,1 m geklemmt, alle Werte endlich", () => {
    for (const height of [0, -31, undefined, NaN]) {
      const e = erdbebenKennwerte({ zone: "2", height, gebaeudelastKN: 9520 });
      for (const [k, v] of Object.entries(e)) {
        if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} nicht endlich bei height=${String(height)}`);
      }
      assert.ok(e.T1 > 0, "T1 muss positiv bleiben");
    }
  });

  it("Härtung: leerer Aufruf liefert durchweg endliche Zahlen und einen Zonen-Label-String", () => {
    for (const e of [erdbebenKennwerte(), erdbebenKennwerte({})]) {
      for (const [k, v] of Object.entries(e)) {
        if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} nicht endlich`);
      }
      assert.equal(typeof e.zoneLabel, "string");
      assert.ok(e.zoneLabel.length > 0);
    }
  });

  it("Härtung: negative Gebäudelast wird geklemmt ⇒ Fb 0, nicht negativ", () => {
    const e = erdbebenKennwerte({ zone: "3", height: 31, gebaeudelastKN: -9520 });
    assert.equal(e.Fb, 0);
  });
});
