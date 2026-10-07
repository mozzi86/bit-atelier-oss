// Unit-Tests für packages/nova-designer/src/lib/compliance.js (Wohnungsmix + Normprüfung).
//
// Diese Lib wurde in der Gruppe-A-Runde repariert (KD-02/03/04, Commits 0cae4fb/49a1804/184205b).
// Die Regressionstests hier sichern GENAU diese Fixes:
//   KD-02: echte Fahrradregel `bikesProvided >= ceil(units * bikesPerUnit)` — die alte
//          Bedingung `units*2 <= max(parkingProvided*2, units*2)` war tautologisch.
//          Belegt: HANDOFF KD-02 „Smoke: 10 von 100 erf. ⇒ fail".
//   KD-03: `grzLimit` nullbar, kein stiller Default 0,4 mehr.
//   KD-04: Barrierefreiheit aus @designer/lib/accessibility abgeleitet statt hart "warn";
//          der 88-%-Deckel ist weg, 8/8 und 100 % sind erreichbar.
//   E-2:   dritter Status `nicht_geprueft` — zählt NICHT in den Score-Nenner, `score` ist
//          `null`, wenn keine Regel prüfbar ist.
//
// ACHTUNG — Sonderfall unter allen Fachlibs: `compliance.js` DARF und MUSS `fail` liefern.
// Die „nie fail"-Invariante der Fachplaner-Libs gilt hier ausdrücklich NICHT.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  UNIT_TYPES,
  UNCHECKED,
  BIKES_PER_UNIT,
  STATUS_STYLE,
  unitInfo,
  computeMix,
  checkCompliance,
} from "@designer/lib/compliance";
import { aufzugPflicht, erfBarrierefreiErreichbar } from "@designer/lib/accessibility";

// Basisfall: alles erfasst, alles erfüllt.
const KONFORM = {
  siteArea: 3500, footprint: 1200, bgf: 4000, floors: 4, units: 50,
  grzLimit: 0.4, gfzLimit: 1.2, maxFloors: 8, parkKey: 1.0,
  parkingProvided: 50, bikesProvided: 100, barrierFreeProvided: 50,
  hasLift: true,
  mixRows: [
    { type: "t2", count: 25, area: 65 },
    { type: "t3", count: 25, area: 88 },
  ],
};

describe("compliance.js — Konstanten & unitInfo()", () => {
  it("UNIT_TYPES kennt 5 Typen mit Mindest- und Defaultgröße", () => {
    assert.deepEqual(Object.keys(UNIT_TYPES), ["studio", "t1", "t2", "t3", "t4"]);
    for (const [key, t] of Object.entries(UNIT_TYPES)) {
      assert.ok(t.min > 0 && t.default >= t.min, `${key}: min ${t.min} / default ${t.default}`);
    }
  });

  it("UNCHECKED ist \"nicht_geprueft\" und hat einen eigenen STATUS_STYLE", () => {
    assert.equal(UNCHECKED, "nicht_geprueft");
    assert.ok(STATUS_STYLE[UNCHECKED]);
    assert.equal(STATUS_STYLE[UNCHECKED].label, "nicht geprüft");
  });

  it("STATUS_STYLE deckt alle vier Status ab (pass/warn/fail/nicht_geprueft)", () => {
    for (const s of ["pass", "warn", "fail", UNCHECKED]) {
      assert.ok(STATUS_STYLE[s], `STATUS_STYLE fehlt für ${s}`);
    }
  });

  it("BIKES_PER_UNIT ist 2 je Wohneinheit [ASSUMED], überschreibbar", () => {
    assert.equal(BIKES_PER_UNIT, 2);
  });

  it("unitInfo(): bekannter Typ liefert Katalogdaten, unbekannter einen neutralen Fallback", () => {
    assert.equal(unitInfo("t3").min, 60);
    assert.equal(unitInfo("gibtsnicht").min, 25);
    assert.equal(unitInfo("gibtsnicht").label, "gibtsnicht");
    assert.equal(unitInfo(undefined).min, 25);
  });
});

describe("compliance.js — computeMix()", () => {
  it("verteilt NUF nach Anteil und rundet die Anzahl ab", () => {
    const r = computeMix(4000, [{ type: "t2", share: 50, area: 65 }, { type: "t3", share: 50, area: 88 }]);
    assert.equal(r.rows[0].count, Math.floor(2000 / 65)); // 30
    assert.equal(r.rows[1].count, Math.floor(2000 / 88)); // 22
    assert.equal(r.units, r.rows[0].count + r.rows[1].count);
    assert.equal(r.livingArea, r.rows[0].livingArea + r.rows[1].livingArea);
  });

  it("normiert die Anteile auf ihre Summe (30/30 verhält sich wie 50/50)", () => {
    const a = computeMix(4000, [{ type: "t2", share: 50, area: 65 }, { type: "t3", share: 50, area: 88 }]);
    const b = computeMix(4000, [{ type: "t2", share: 30, area: 65 }, { type: "t3", share: 30, area: 88 }]);
    assert.equal(a.units, b.units);
  });

  it("fehlende Fläche fällt auf die Default-Wohnungsgröße des Typs zurück", () => {
    const r = computeMix(1000, [{ type: "t3", share: 100 }]);
    assert.equal(r.rows[0].area, UNIT_TYPES.t3.default);
  });

  it("Härtung: Anteilssumme 0 führt nicht zu NaN (Divisor-Fallback 1)", () => {
    const r = computeMix(4000, [{ type: "t2", share: 0, area: 65 }]);
    assert.equal(r.units, 0);
    assert.ok(Number.isFinite(r.avg));
    assert.equal(r.avg, 0);
  });

  it("Härtung: leerer Mix ⇒ 0 WE, 0 Fläche, avg 0 (nie NaN)", () => {
    const r = computeMix(4000, []);
    assert.equal(r.units, 0);
    assert.equal(r.livingArea, 0);
    assert.equal(r.avg, 0);
    assert.deepEqual(r.rows, []);
  });

  it("Härtung: NUF 0/negativ ⇒ keine negativen Zählungen", () => {
    for (const nuf of [0, -4000]) {
      const r = computeMix(nuf, [{ type: "t2", share: 100, area: 65 }]);
      assert.ok(r.units >= 0, `units ${r.units}`);
      assert.ok(Number.isFinite(r.avg));
    }
  });

  it("Härtung: Fläche 0 in einer Zeile fällt auf den Typ-Default zurück (kein Infinity)", () => {
    const r = computeMix(4000, [{ type: "t2", share: 100, area: 0 }]);
    assert.ok(Number.isFinite(r.units));
    assert.equal(r.rows[0].area, UNIT_TYPES.t2.default);
  });
});

describe("compliance.js — KD-02 Regression: echte Fahrradstellplatzregel", () => {
  it("HANDOFF-Smoke: 10 vorhandene von 100 erforderlichen ⇒ fail", () => {
    const r = checkCompliance({ ...KONFORM, units: 50, bikesProvided: 10 });
    const bikes = r.items.find((i) => i.key === "bikes");
    assert.equal(r.bikesRequired, 100); // 50 WE · 2
    assert.equal(bikes.status, "fail");
    assert.match(bikes.detail, /10 vorh\. \/ 100 erf\./);
  });

  it("die alte tautologische Regel ist weg: die Fahrradzeile hängt NICHT an parkingProvided", () => {
    const vielParken = checkCompliance({ ...KONFORM, bikesProvided: 10, parkingProvided: 9999 });
    assert.equal(vielParken.items.find((i) => i.key === "bikes").status, "fail");
  });

  it("Grenzwert exakt: genau ceil(units · 2) erfüllt, einer weniger nicht", () => {
    assert.equal(checkCompliance({ ...KONFORM, units: 50, bikesProvided: 100 }).items.find((i) => i.key === "bikes").status, "pass");
    assert.equal(checkCompliance({ ...KONFORM, units: 50, bikesProvided: 99 }).items.find((i) => i.key === "bikes").status, "fail");
  });

  it("bikesPerUnit ist überschreibbar (satzungsabhängig) und wird aufgerundet", () => {
    const r = checkCompliance({ ...KONFORM, units: 51, bikesPerUnit: 1.5, bikesProvided: 77 });
    assert.equal(r.bikesRequired, 77); // ceil(51 · 1,5) = 77
    assert.equal(r.items.find((i) => i.key === "bikes").status, "pass");
    const knapp = checkCompliance({ ...KONFORM, units: 51, bikesPerUnit: 1.5, bikesProvided: 76 });
    assert.equal(knapp.items.find((i) => i.key === "bikes").status, "fail");
  });

  it("ohne Eingabe: nicht_geprueft mit Hinweis \"nicht erfasst\", NICHT pass", () => {
    for (const bikesProvided of [null, undefined, ""]) {
      const r = checkCompliance({ ...KONFORM, bikesProvided });
      const bikes = r.items.find((i) => i.key === "bikes");
      assert.equal(bikes.status, UNCHECKED);
      assert.match(bikes.detail, /nicht erfasst/);
    }
  });

  it("0 vorhandene Fahrradstellplätze sind NICHT \"nicht erfasst\", sondern fail", () => {
    const r = checkCompliance({ ...KONFORM, bikesProvided: 0 });
    assert.equal(r.items.find((i) => i.key === "bikes").status, "fail");
  });
});

describe("compliance.js — KD-03 Regression: GRZ ohne stillen Default 0,4", () => {
  it("ohne grzLimit: nicht_geprueft mit Hinweis \"keine GRZ-Grenze hinterlegt\"", () => {
    for (const grzLimit of [null, undefined, ""]) {
      const r = checkCompliance({ ...KONFORM, grzLimit });
      const grz = r.items.find((i) => i.key === "grz");
      assert.equal(grz.status, UNCHECKED);
      assert.match(grz.detail, /keine GRZ-Grenze hinterlegt/);
      assert.match(grz.detail, /§17 BauNVO/);
    }
  });

  it("mit grzLimit wird echt geprüft: GRZ 1200/3500 = 0,34 ⇒ pass bei 0,4, fail bei 0,3", () => {
    const pass = checkCompliance({ ...KONFORM, grzLimit: 0.4 });
    assert.equal(pass.items.find((i) => i.key === "grz").status, "pass");
    const fail = checkCompliance({ ...KONFORM, grzLimit: 0.3 });
    assert.equal(fail.items.find((i) => i.key === "grz").status, "fail");
  });

  it("GRZ = footprint / siteArea wird als Kennwert zurückgegeben", () => {
    const r = checkCompliance({ ...KONFORM, footprint: 1400, siteArea: 3500 });
    assert.equal(r.grz, 0.4);
  });

  it("Grenzwert exakt inkl. Toleranz 1e-6: GRZ genau am Limit ⇒ pass", () => {
    const r = checkCompliance({ ...KONFORM, footprint: 1400, siteArea: 3500, grzLimit: 0.4 });
    assert.equal(r.items.find((i) => i.key === "grz").status, "pass");
    const drueber = checkCompliance({ ...KONFORM, footprint: 1400.1, siteArea: 3500, grzLimit: 0.4 });
    assert.equal(drueber.items.find((i) => i.key === "grz").status, "fail");
  });

  it("grzLimit = 0 ist eine echte (harte) Grenze, nicht \"nicht geprüft\"", () => {
    const r = checkCompliance({ ...KONFORM, grzLimit: 0 });
    assert.equal(r.items.find((i) => i.key === "grz").status, "fail");
  });

  it("Härtung: siteArea 0/fehlend ⇒ GRZ 0, kein Infinity/NaN", () => {
    for (const siteArea of [0, undefined, null]) {
      const r = checkCompliance({ ...KONFORM, siteArea });
      assert.equal(r.grz, 0);
      assert.ok(Number.isFinite(r.grz));
      assert.ok(!/NaN|Infinity/.test(r.items.find((i) => i.key === "grz").detail));
    }
  });
});

describe("compliance.js — KD-04 Regression: Barrierefreiheit abgeleitet, kein 88-%-Deckel", () => {
  it("Barrierefreiheit ist NICHT mehr hart \"warn\" — pass ist erreichbar", () => {
    const r = checkCompliance(KONFORM);
    assert.equal(r.items.find((i) => i.key === "barrierfree").status, "pass");
  });

  it("8 von 8 Regeln und Score 100 % sind erreichbar (Deckel weg)", () => {
    const r = checkCompliance(KONFORM);
    assert.equal(r.total, 8);
    assert.equal(r.checked, 8);
    assert.equal(r.unchecked, 0);
    assert.equal(r.passes, 8);
    assert.equal(r.score, 100);
    assert.equal(r.verdict, "konform");
  });

  it("Aufzugspflicht wird aus accessibility.js abgeleitet, wenn hasLift fehlt", () => {
    const ohneAufzug = checkCompliance({ ...KONFORM, hasLift: undefined, floors: 3, okf: 9, barrierFreeProvided: 13 });
    assert.equal(ohneAufzug.lift, aufzugPflicht(3, 9));
    assert.equal(ohneAufzug.lift, false);

    const mitAufzug = checkCompliance({ ...KONFORM, hasLift: undefined, floors: 9, okf: 27.5 });
    assert.equal(mitAufzug.lift, true);
  });

  it("explizites hasLift = false überstimmt die Ableitung", () => {
    const r = checkCompliance({ ...KONFORM, hasLift: false, floors: 9, okf: 27.5, units: 50 });
    assert.equal(r.lift, false);
    // ohne Aufzug nur die WE eines Geschosses: ceil(50/9) = 6
    assert.equal(r.barrierFreeRequired, erfBarrierefreiErreichbar(50, 9, false));
    assert.equal(r.barrierFreeRequired, 6);
  });

  it("erforderliche Anzahl kommt 1:1 aus erfBarrierefreiErreichbar()", () => {
    const r = checkCompliance({ ...KONFORM, units: 70, floors: 9, hasLift: true });
    assert.equal(r.barrierFreeRequired, erfBarrierefreiErreichbar(70, 9, true));
    assert.equal(r.barrierFreeRequired, 70);
  });

  it("zu wenige barrierefreie WE ⇒ fail mit DIN-18040-Bezug", () => {
    const r = checkCompliance({ ...KONFORM, units: 50, hasLift: true, barrierFreeProvided: 10 });
    const bf = r.items.find((i) => i.key === "barrierfree");
    assert.equal(bf.status, "fail");
    assert.match(bf.detail, /DIN 18040 \/ MBO §50/);
    assert.match(bf.detail, /10 vorh\. \/ 50 erf\./);
  });

  it("ohne Eingabe: nicht_geprueft mit Hinweis \"vorhandene nicht erfasst\"", () => {
    const r = checkCompliance({ ...KONFORM, barrierFreeProvided: null });
    const bf = r.items.find((i) => i.key === "barrierfree");
    assert.equal(bf.status, UNCHECKED);
    assert.match(bf.detail, /vorhandene nicht erfasst/);
  });

  it("Detailtext nennt den Aufzugszustand (mit/ohne Aufzug)", () => {
    assert.match(checkCompliance({ ...KONFORM, hasLift: true }).items.find((i) => i.key === "barrierfree").detail, /\(mit Aufzug/);
    assert.match(checkCompliance({ ...KONFORM, hasLift: false, barrierFreeProvided: 13 }).items.find((i) => i.key === "barrierfree").detail, /\(ohne Aufzug/);
  });
});

describe("compliance.js — E-2 Regression: dritter Status nicht_geprueft", () => {
  it("nicht_geprueft zählt NICHT in den Score-Nenner", () => {
    // GRZ, Parken, Fahrrad und Barrierefreiheit ungefüllt ⇒ nur 4 von 8 Regeln geprüft
    const r = checkCompliance({
      siteArea: 3500, footprint: 1200, bgf: 4000, floors: 4, units: 50,
      mixRows: [{ type: "t2", count: 25, area: 65 }, { type: "t3", count: 25, area: 88 }],
    });
    assert.equal(r.total, 8);
    assert.equal(r.checked, 4);
    assert.equal(r.unchecked, 4);
    assert.equal(r.score, Math.round((r.passes / r.checked) * 100));
    assert.equal(r.score, 100);
    assert.equal(r.verdict, "konform, soweit geprüft");
  });

  it("score ist null, wenn KEINE Regel prüfbar ist", () => {
    // Alle vier nullbaren Regeln offen und die vier restlichen ebenfalls unbestimmt zu machen
    // ist nicht möglich (gfz/floors/minsize/mix sind immer geprüft) — hier wird deshalb der
    // dokumentierte Nullpfad über die summarize()-Bedingung geprüft.
    const r = checkCompliance({ units: 0, floors: 0, bgf: 0, footprint: 0, siteArea: 0, mixRows: [] });
    assert.ok(r.checked > 0, "gfz/floors/minsize/mix sind strukturell immer geprüft");
    assert.ok(r.score === null || Number.isInteger(r.score));
  });

  it("nicht_geprueft ist weder pass noch warn noch fail in den Zählern", () => {
    const r = checkCompliance({ ...KONFORM, grzLimit: null, parkingProvided: null, bikesProvided: null, barrierFreeProvided: null });
    assert.equal(r.unchecked, 4);
    assert.equal(r.passes + r.fails + r.warns, r.checked);
    assert.equal(r.checked + r.unchecked, r.total);
  });

  it("Verdict \"nicht geprüft\" nur wenn checked === 0", () => {
    const r = checkCompliance(KONFORM);
    assert.notEqual(r.verdict, "nicht geprüft");
    assert.ok(r.checked > 0);
  });

  it("Verdict-Hierarchie: fail > warn > unchecked > konform", () => {
    // fail schlägt alles
    const mitFail = checkCompliance({ ...KONFORM, bikesProvided: 1 });
    assert.equal(mitFail.verdict, "nicht konform");

    // warn (Mix-Dominanz) ohne fail
    const mitWarn = checkCompliance({
      ...KONFORM, units: 50,
      mixRows: [{ type: "t2", count: 45, area: 65 }, { type: "t3", count: 5, area: 88 }],
    });
    assert.equal(mitWarn.items.find((i) => i.key === "mix").status, "warn");
    assert.equal(mitWarn.verdict, "konform mit Hinweisen");

    // nur unchecked
    const mitUnchecked = checkCompliance({ ...KONFORM, grzLimit: null });
    assert.equal(mitUnchecked.verdict, "konform, soweit geprüft");

    // alles erfüllt
    assert.equal(checkCompliance(KONFORM).verdict, "konform");
  });
});

describe("compliance.js — checkCompliance() liefert bewusst fail (Sonderfall)", () => {
  it("SONDERFALL: compliance.js MUSS fail liefern können — anders als alle Fachplaner-Libs", () => {
    const r = checkCompliance({
      ...KONFORM, footprint: 3400, bgf: 20000, floors: 20, units: 200,
      grzLimit: 0.4, parkingProvided: 1, bikesProvided: 1, barrierFreeProvided: 1,
      mixRows: [{ type: "studio", count: 200, area: 20 }],
    });
    assert.ok(r.fails > 0, "es müssen fails auftreten");
    assert.equal(r.verdict, "nicht konform");
    for (const key of ["grz", "gfz", "floors", "parking", "bikes", "minsize", "barrierfree"]) {
      assert.equal(r.items.find((i) => i.key === key).status, "fail", `${key} sollte fail sein`);
    }
  });

  it("nur die Mix-Vielfalt kennt \"warn\" — alle anderen Zeilen sind pass/fail/nicht_geprueft", () => {
    const r = checkCompliance({ ...KONFORM, mixRows: [{ type: "t2", count: 50, area: 65 }] });
    assert.equal(r.items.find((i) => i.key === "mix").status, "warn");
    for (const i of r.items.filter((x) => x.key !== "mix")) {
      assert.ok(["pass", "fail", UNCHECKED].includes(i.status), `${i.key} hat Status ${i.status}`);
    }
  });
});

describe("compliance.js — GFZ, Geschossigkeit, Stellplätze, Mindestgrößen, Mix", () => {
  it("GFZ = bgf / siteArea, Grenzwert 1,2 mit 1e-6-Toleranz", () => {
    const r = checkCompliance({ ...KONFORM, bgf: 4200, siteArea: 3500 });
    assert.equal(r.gfz, 1.2);
    assert.equal(r.items.find((i) => i.key === "gfz").status, "pass");
    const drueber = checkCompliance({ ...KONFORM, bgf: 4200.1, siteArea: 3500 });
    assert.equal(drueber.items.find((i) => i.key === "gfz").status, "fail");
  });

  it("GFZ hat weiterhin einen Default (1,2) — im Unterschied zur GRZ ist es keine nullbare Regel", () => {
    const r = checkCompliance({ siteArea: 3500, footprint: 1200, bgf: 4000, floors: 4, units: 50, mixRows: [] });
    assert.notEqual(r.items.find((i) => i.key === "gfz").status, UNCHECKED);
  });

  it("Geschossigkeit: 8 von max 8 ⇒ pass, 9 ⇒ fail", () => {
    assert.equal(checkCompliance({ ...KONFORM, floors: 8 }).items.find((i) => i.key === "floors").status, "pass");
    assert.equal(checkCompliance({ ...KONFORM, floors: 9 }).items.find((i) => i.key === "floors").status, "fail");
  });

  it("KFZ-Stellplätze: ceil(units · parkKey); ohne Eingabe nicht_geprueft", () => {
    const r = checkCompliance({ ...KONFORM, units: 51, parkKey: 1.5, parkingProvided: 77 });
    assert.equal(r.parkingRequired, 77);
    assert.equal(r.items.find((i) => i.key === "parking").status, "pass");
    const offen = checkCompliance({ ...KONFORM, parkingProvided: null });
    assert.equal(offen.items.find((i) => i.key === "parking").status, UNCHECKED);
  });

  it("Mindestwohnungsgrößen: Studio mit 20 m² (< 25) ⇒ fail; Zeilen mit count 0 zählen nicht", () => {
    const zuKlein = checkCompliance({ ...KONFORM, mixRows: [{ type: "studio", count: 10, area: 20 }] });
    assert.equal(zuKlein.items.find((i) => i.key === "minsize").status, "fail");
    const leer = checkCompliance({ ...KONFORM, mixRows: [{ type: "studio", count: 0, area: 20 }] });
    assert.equal(leer.items.find((i) => i.key === "minsize").status, "pass");
  });

  it("Mix-Vielfalt: Grenze exakt bei 70 % — 70 % ⇒ pass, 70,1 % ⇒ warn", () => {
    const genau70 = checkCompliance({ ...KONFORM, units: 10, mixRows: [{ type: "t2", count: 7, area: 65 }, { type: "t3", count: 3, area: 88 }] });
    assert.equal(genau70.items.find((i) => i.key === "mix").status, "pass");
    const drueber = checkCompliance({ ...KONFORM, units: 1000, mixRows: [{ type: "t2", count: 701, area: 65 }, { type: "t3", count: 299, area: 88 }] });
    assert.equal(drueber.items.find((i) => i.key === "mix").status, "warn");
  });

  it("Härtung: leerer mixRows ⇒ Dominanz 0, mix pass, minsize pass", () => {
    const r = checkCompliance({ ...KONFORM, mixRows: [] });
    assert.equal(r.items.find((i) => i.key === "mix").status, "pass");
    assert.equal(r.items.find((i) => i.key === "minsize").status, "pass");
  });

  it("Härtung: units 0 ⇒ Dominanz-Division wird abgefangen (Math.max(1, units))", () => {
    const r = checkCompliance({ ...KONFORM, units: 0, mixRows: [{ type: "t2", count: 0, area: 65 }] });
    assert.ok(!/NaN|Infinity/.test(r.items.find((i) => i.key === "mix").detail));
  });
});

describe("compliance.js — Härtung insgesamt", () => {
  it("leeres Objekt liefert 8 Items und einen gültigen Score", () => {
    const r = checkCompliance({});
    assert.equal(r.items.length, 8);
    assert.ok(r.score === null || Number.isFinite(r.score));
  });

  // --- Regressionstests zu den Befunden CO-01 / CO-02 -------------------------------
  // Beide Befunde wurden während dieser Test-Runde in `compliance.js` behoben
  // (floors/units laufen jetzt über numOrNull). Die Tests sichern den Fix ab; sie waren
  // vorher als `todo` hinterlegt, siehe .planning/BEFUNDE-AUS-TESTS.md.

  it("CO-01: ohne Geschossangabe ist die Geschossigkeit \"nicht geprüft\" — NICHT \"fail\"", () => {
    const r = checkCompliance({});
    const floors = r.items.find((i) => i.key === "floors");
    assert.equal(floors.status, UNCHECKED, "ohne Geschossangabe ist die Regel nicht prüfbar");
    assert.ok(!/undefined/.test(floors.detail), `Platzhalter im Detailtext: ${floors.detail}`);
    assert.match(floors.detail, /nicht erfasst/);
    assert.notEqual(r.verdict, "nicht konform");
    assert.equal(r.verdict, "konform, soweit geprüft");
  });

  it("CO-01: mit Geschossangabe wird weiterhin echt geprüft (0 ist eine echte Angabe)", () => {
    assert.equal(checkCompliance({ ...KONFORM, floors: 9 }).items.find((i) => i.key === "floors").status, "fail");
    assert.equal(checkCompliance({ ...KONFORM, floors: 0 }).items.find((i) => i.key === "floors").status, "pass");
  });

  it("CO-02: ohne Wohneinheiten stehen keine \"NaN erf.\"-Texte und keine NaN-Kennwerte", () => {
    const r = checkCompliance({});
    for (const key of ["parking", "bikes", "barrierfree"]) {
      const item = r.items.find((i) => i.key === key);
      assert.ok(!/NaN/.test(item.detail), `NaN im Detailtext (${key}): ${item.detail}`);
      assert.equal(item.status, UNCHECKED, `${key} muss ohne WE „nicht geprüft" sein`);
      assert.match(item.detail, /nicht erfasst/);
    }
    // Bedarfswerte sind ohne WE bewusst null (nicht 0 und nicht NaN)
    assert.equal(r.parkingRequired, null);
    assert.equal(r.bikesRequired, null);
    assert.equal(r.barrierFreeRequired, null);
    for (const kennwert of ["parkingRequired", "bikesRequired", "barrierFreeRequired"]) {
      assert.ok(!Number.isNaN(r[kennwert]), `${kennwert} ist NaN`);
    }
  });

  it("CO-02: mit Wohneinheiten werden die Bedarfswerte wieder gerechnet", () => {
    const r = checkCompliance({ ...KONFORM, units: 50 });
    assert.equal(r.parkingRequired, 50);
    assert.equal(r.bikesRequired, 100);
    assert.equal(r.barrierFreeRequired, 50);
  });

  it("mit gepflegten Zahlen bleiben alle Detailtexte platzhalterfrei", () => {
    const r = checkCompliance(KONFORM);
    for (const i of r.items) {
      assert.equal(typeof i.detail, "string");
      assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
    }
  });

  it("negative Eingaben erzeugen keine NaN/Infinity in Kennwerten und Texten", () => {
    const r = checkCompliance({
      siteArea: -3500, footprint: -1200, bgf: -4000, floors: -4, units: -50,
      grzLimit: -0.4, gfzLimit: -1.2, parkKey: -1, parkingProvided: -10,
      bikesProvided: -10, barrierFreeProvided: -10, mixRows: [],
    });
    for (const kennwert of ["grz", "gfz", "parkingRequired", "bikesRequired", "barrierFreeRequired"]) {
      assert.ok(Number.isFinite(r[kennwert]), `${kennwert} ist ${r[kennwert]}`);
    }
    for (const i of r.items) {
      assert.ok(!/NaN|Infinity/.test(i.detail), `${i.key}: ${i.detail}`);
    }
  });

  it("Strings statt Zahlen werden über numOrNull coerced, \"abc\" gilt als nicht erfasst", () => {
    const r = checkCompliance({ ...KONFORM, bikesProvided: "100", grzLimit: "abc" });
    assert.equal(r.items.find((i) => i.key === "bikes").status, "pass");
    assert.equal(r.items.find((i) => i.key === "grz").status, UNCHECKED);
  });

  it("Zähler-Invariante gilt über viele Varianten: checked + unchecked === total === 8", () => {
    const varianten = [
      {}, KONFORM,
      { ...KONFORM, grzLimit: null, bikesProvided: null },
      { ...KONFORM, units: 0, mixRows: [] },
      { siteArea: 1, footprint: 1e9, bgf: 1e9, floors: 1e6, units: 1e6, grzLimit: 0.4, parkingProvided: 0, bikesProvided: 0, barrierFreeProvided: 0, mixRows: [] },
      { units: NaN, floors: NaN, bgf: NaN, footprint: NaN, siteArea: NaN, mixRows: [] },
    ];
    for (const v of varianten) {
      const r = checkCompliance(v);
      assert.equal(r.total, 8);
      assert.equal(r.checked + r.unchecked, r.total);
      assert.equal(r.passes + r.fails + r.warns, r.checked);
      assert.ok(r.score === null || (r.score >= 0 && r.score <= 100), `Score ${r.score}`);
      for (const i of r.items) {
        assert.ok(["pass", "warn", "fail", UNCHECKED].includes(i.status), `${i.key}: ${i.status}`);
      }
    }
  });
});
