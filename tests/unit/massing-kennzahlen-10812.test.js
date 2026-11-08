// 108-12 (finding 15a-c of the 108-11 review): massing key figures of the single-family house.
// Test house (neutral, invented): EFH 11.40 × 10.20 m = 116.28 m², storeys 2 (EG 2.90 + DG 2.90 with knee wall 0.75), untergeschosse 1
// (KG 2.75), 1 dwelling, double carport (2 spaces).
// Hand calculation:
//   BGF (DIN 277, all storeys) = 116.28 × (2 + 1) = 348.84 m² ≈ 349 m²; GFZ area (BauNVO § 20, storeys above ground) = 116.28 × 2 = 232.56 m²
//   dwellings 1 (unit mix of the site planning, or workshop typology "efh"); parking spaces 1 × 2 = 2
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flaechenKennzahlen, geschossHoehenUebersicht, reglerGeschosshoehe, koerperHoehe_m } from "@core/lib/massing/flaechenKennzahlen.js";
import { elevationOf, geschosseAus } from "@core/lib/bauteil/hoehen.js";
import { hauptkoerperDach } from "@core/lib/massing/hauptdach.js";
import { dachEbenen } from "@core/lib/bauteil/dachGeometrie.js";
import { vollgeschossAusDach } from "@core/lib/bauteil/vollgeschoss.js";
import { kennzahlenJeTyp, handZahl, wohnungsmixAnzahl, STELLPLATZ_SCHLUESSEL_EFH, NUF_JE_WOHNUNG_M2 } from "@designer/lib/kennzahlen";

const A = 11.4 * 10.2;
const GESCHOSSE = [
  { level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.9, kniestock_m: 0.75 },
];
const alsMap = (/** @type {any[]} */ l) => Object.fromEntries(l.map((k) => [k.key, k.value]));

describe("108-12 BGF (DIN 277) und GFZ-Fläche (BauNVO § 20)", () => {
  it("EFH mit Keller: BGF ≈ 349 m² mit KG, GFZ-Fläche ohne KG", () => {
    const f = flaechenKennzahlen({ grundflaeche_m2: A, geschosse: 2, untergeschosse: 1 });
    assert.ok(Math.abs(f.bgf_m2 - 348.84) < 1e-9);
    assert.equal(Math.round(f.bgf_m2), 349);
    assert.ok(Math.abs(f.gfzFlaeche_m2 - 232.56) < 1e-9);
    assert.ok(Math.abs(f.untergeschossFlaeche_m2 - 116.28) < 1e-9);
    assert.equal(f.untergeschosse, 1);
  });

  it("ohne Untergeschoss: BGF = GFZ-Fläche = Grundfläche × Geschosse (alter Wert unverändert)", () => {
    for (const ug of [0, undefined, null, "x", -2]) {
      const f = flaechenKennzahlen({ grundflaeche_m2: 600, geschosse: 5, untergeschosse: ug });
      assert.equal(f.bgf_m2, 600 * 5);
      assert.equal(f.gfzFlaeche_m2, 600 * 5);
      assert.equal(f.untergeschossFlaeche_m2, 0);
    }
  });

  // 108-12 review: full-storey check of the attic from the roof geometry (vollgeschossAusDach) decides the GF
  it("Testhaus 42°, Kniestock 0,75: DG kein Vollgeschoss nach Dachgeometrie → GF nur EG (116 m²), BGF unverändert", () => {
    const fp = [{ x: 0, z: 0 }, { x: 11.4, z: 0 }, { x: 11.4, z: 10.2 }, { x: 0, z: 10.2 }];
    const hd = hauptkoerperDach({ footprintM: fp, storeys: 2, storeyHeight: 2.9, geschosse: GESCHOSSE, untergeschosse: 1, dachform: "sattel", dachneigung: 42 });
    assert.ok(hd && hd.kniestock_m === 0.75);
    const vg = vollgeschossAusDach({ grundriss: fp, dachEbenen: dachEbenen(hd.dach), boden_m: hd.traufhoehe_m - hd.kniestock_m });
    assert.equal(vg.voll, false); // about 66 % ≥ 2.30 m, below 2/3
    const f = flaechenKennzahlen({ grundflaeche_m2: A, geschosse: 2, untergeschosse: 1, obersterVoll: vg.voll });
    assert.ok(Math.abs(f.gfzFlaeche_m2 - 116.28) < 1e-9);
    assert.equal(f.vollgeschosse, 1);
    assert.equal(f.vollgeschossQuelle, "dach");
    assert.ok(Math.abs(f.bgf_m2 - 348.84) < 1e-9);
    assert.ok(Math.abs(f.oberirdisch_m2 - 232.56) < 1e-9);
    // a full attic or no decision keeps every storey above ground
    assert.ok(Math.abs(flaechenKennzahlen({ grundflaeche_m2: A, geschosse: 2, obersterVoll: true }).gfzFlaeche_m2 - 232.56) < 1e-9);
    assert.equal(flaechenKennzahlen({ grundflaeche_m2: A, geschosse: 2 }).vollgeschossQuelle, "annahme");
  });

  it("Untergeschosse werden auf 0 … 3 begrenzt, ungültige Fläche zählt 0", () => {
    assert.equal(flaechenKennzahlen({ grundflaeche_m2: 100, geschosse: 1, untergeschosse: 7 }).bgf_m2, 400);
    assert.equal(flaechenKennzahlen({ grundflaeche_m2: NaN, geschosse: 3, untergeschosse: 1 }).bgf_m2, 0);
  });
});

describe("108-12 Geschosshöhen je Geschoss", () => {
  it("Testhaus: KG 2,75 · EG 2,90 · DG 2,90 + Kniestock 0,75 — ungleich, je Geschoss", () => {
    const u = geschossHoehenUebersicht({ storeys: 2, storeyHeight: 2.9, geschosse: GESCHOSSE, untergeschosse: 1 });
    assert.deepEqual(u.zeilen.map((z) => [z.level, z.name, z.hoehe_m, z.kniestock_m]), [
      [-1, "KG", 2.75, null], [0, "EG", 2.9, null], [1, "DG", 2.9, 0.75],
    ]);
    assert.equal(u.ungleich, true);
    assert.equal(u.jeGeschoss, true);
  });

  it("ohne Tabelle: alle Geschosse mit storeyHeight, keine Liste (altes Panel)", () => {
    const u = geschossHoehenUebersicht({ storeys: 4, storeyHeight: 3.1, geschosse: null, untergeschosse: 0 });
    assert.equal(u.zeilen.length, 4);
    assert.ok(u.zeilen.every((z) => z.hoehe_m === 3.1 && z.kniestock_m === null));
    assert.deepEqual(u.zeilen.map((z) => z.name), ["EG", "1. OG", "2. OG", "3. OG"]);
    assert.equal(u.ungleich, false);
    assert.equal(u.jeGeschoss, false);
  });

  it("gleiche Höhen mit Kniestock: Liste ja, Regler bleibt frei (nicht ungleich)", () => {
    const u = geschossHoehenUebersicht({ storeys: 2, storeyHeight: 2.9, geschosse: [{ level: 0, hoehe_m: 2.9 }, { level: 1, hoehe_m: 2.9, kniestock_m: 0.5 }] });
    assert.equal(u.ungleich, false);
    assert.equal(u.jeGeschoss, true);
  });

  // 108-12 review (finding 15b, rest): a uniform table that differs from storeyHeight (per-storey edits in the BIM studio)
  it("gleiche Tabelle 2,90/2,90 bei storeyHeight 3,0: Regler 2,9, Höhe 5,8 m wie das Gebäudemodell", () => {
    const programm = { storeys: 2, storeyHeight: 3, geschosse: [{ level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.9, kniestock_m: 0.75 }] };
    const u = geschossHoehenUebersicht(programm);
    assert.equal(u.ungleich, false);
    assert.equal(u.tabelle, true);
    assert.equal(u.einheitlich_m, 2.9);
    assert.equal(u.abweichend, true);
    assert.equal(reglerGeschosshoehe(programm, 2), 2.9);
    assert.ok(Math.abs(koerperHoehe_m(programm, 2, 3) - 5.8) < 1e-9);
    assert.ok(Math.abs(koerperHoehe_m(programm, 2, 3) - elevationOf(2, geschosseAus(programm))) < 1e-12);
  });

  it("ohne Tabelle: Regler = storeyHeight, Höhe = Geschosse × Reglerwert (alte Rechnung)", () => {
    const programm = { storeys: 3, storeyHeight: 3.1, geschosse: null };
    assert.equal(reglerGeschosshoehe(programm, 3), 3.1);
    assert.equal(koerperHoehe_m(programm, 3, 3.3), 3 * 3.3);
    assert.ok(Number.isNaN(reglerGeschosshoehe({ storeys: 1 }, 1)));
    assert.equal(geschossHoehenUebersicht(programm).abweichend, false);
  });

  it("Flachdach mit ungleicher Tabelle EG 2,90 / OG 3,20: Höhe 6,1 m (Summe der Tabelle, bewusste Änderung)", () => {
    const programm = { storeys: 2, storeyHeight: 2.9, geschosse: [{ level: 0, hoehe_m: 2.9 }, { level: 1, hoehe_m: 3.2 }] };
    assert.ok(Math.abs(koerperHoehe_m(programm, 2, 2.9) - 6.1) < 1e-9);
    assert.equal(geschossHoehenUebersicht(programm).ungleich, true);
    // rows without a table name are marked, the studio translates them (geschossLabel)
    assert.deepEqual(geschossHoehenUebersicht(programm).zeilen.map((z) => [z.name, z.ausTabelle]), [["EG", false], ["1. OG", false]]);
  });

  it("der Live-Wert der Geschosszahl zählt (Studio-Regler), Untergeschoss ohne Zeile nimmt die nächste Zeile", () => {
    const u = geschossHoehenUebersicht({ storeys: 2, geschosse: [{ level: 0, hoehe_m: 2.8 }], untergeschosse: 1 }, 3);
    assert.deepEqual(u.zeilen.map((z) => z.level), [-1, 0, 1, 2]);
    assert.ok(u.zeilen.every((z) => z.hoehe_m === 2.8));
  });
});

describe("108-12 Wohneinheiten und Stellplätze aus der Nutzung", () => {
  const flaechen = { nuf: 232.56 * 0.8, bgf: 232.56 };

  it("EFH aus dem Wohnungsmix der Baufeld-Planung: 1 WE, 2 Stellplätze (Schlüssel 2)", () => {
    const kpis = kennzahlenJeTyp("residential", flaechen, { wohnungsmix: [{ count: 1, area: 180 }], stellplatzPlanung: { parking_key: 2, total_spaces: 2 } });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 1, stellplaetze: 2 });
    assert.equal(kpis[0].quelle, "wohnungsmix");
    assert.equal(kpis[1].quelle, "planung");
    assert.equal(kpis[1].geplant, 2);
  });

  it("EFH aus dem Werkstatt-Typ ohne Wohnungsmix: 1 WE, 2 Stellplätze [ASSUMED-Schlüssel]", () => {
    const kpis = kennzahlenJeTyp("residential", flaechen, { werkstattTyp: "efh", stellplatzPlanung: { parking_key: 1, total_spaces: 0 } });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 1, stellplaetze: STELLPLATZ_SCHLUESSEL_EFH });
    assert.equal(kpis[0].quelle, "efh");
    assert.equal(kpis[1].quelle, "efh");
    assert.equal(kpis[1].geplant, null);
  });

  it("von Hand überschreibt beides, leer = automatisch", () => {
    const basis = { wohnungsmix: [{ count: 1 }], stellplatzPlanung: { parking_key: 2 } };
    const hand = kennzahlenJeTyp("residential", flaechen, { ...basis, hand: { wohneinheiten: 2, stellplaetze: 3 } });
    assert.deepEqual(alsMap(hand), { wohneinheiten: 2, stellplaetze: 3 });
    assert.ok(hand.every((k) => k.quelle === "hand"));
    const leer = kennzahlenJeTyp("residential", flaechen, { ...basis, hand: { wohneinheiten: null, stellplaetze: "" } });
    assert.deepEqual(alsMap(leer), { wohneinheiten: 1, stellplaetze: 2 });
    // a hand dwelling count drives the parking requirement with the planning key
    assert.deepEqual(alsMap(kennzahlenJeTyp("residential", flaechen, { ...basis, hand: { wohneinheiten: 2 } })), { wohneinheiten: 2, stellplaetze: 4 });
  });

  it("Schlüssel der Baufeld-Planung rundet auf wie das Stellplatz-Soll (3 WE × 1,1 = 4)", () => {
    const kpis = kennzahlenJeTyp("residential", flaechen, { wohnungsmix: [{ count: 2 }, { count: 1 }], stellplatzPlanung: { parking_key: 1.1 } });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 3, stellplaetze: 4 });
  });

  it("MFH ohne Nutzungsangaben: unverändert NUF/75 und Schlüssel 1,0 (auch mit leerem Mix und Standard-Parken)", () => {
    const alt = kennzahlenJeTyp("residential", { nuf: 1500, bgf: 1875 });
    const neu = kennzahlenJeTyp("residential", { nuf: 1500, bgf: 1875 }, { wohnungsmix: [], stellplatzPlanung: { total_spaces: 0, parking_key: 1 }, werkstattTyp: "mittelflur", hand: null });
    assert.deepEqual(alsMap(neu), alsMap(alt));
    assert.deepEqual(alsMap(alt), { wohneinheiten: Math.round(1500 / NUF_JE_WOHNUNG_M2), stellplaetze: 20 });
    assert.deepEqual(neu.map((k) => k.sub), alt.map((k) => k.sub));
    assert.ok(neu.every((k) => k.quelle === "schaetzung"));
  });

  it("Gewerbe: keine Wohneinheiten, Stellplätze von Hand möglich", () => {
    const map = alsMap(kennzahlenJeTyp("commercial", { nuf: 1200, bgf: 1500 }, { hand: { wohneinheiten: 5, stellplaetze: 7 } }));
    assert.ok(!("wohneinheiten" in map));
    assert.equal(map.stellplaetze, 7);
  });

  // 108-12 review: the untouched start key 1.0 of a new design record is no planning decision
  it("EFH mit Wohnungsmix und unberührtem Standardschlüssel 1,0 + Werkstatt-Typ efh: 2 Stellplätze", () => {
    const kpis = kennzahlenJeTyp("residential", flaechen, { wohnungsmix: [{ count: 1 }], stellplatzPlanung: { total_spaces: 0, parking_key: 1.0 }, werkstattTyp: "efh" });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 1, stellplaetze: 2 });
    assert.equal(kpis[1].quelle, "efh");
  });

  it("Wohnungsmix aus EINER Wohnung ohne Werkstatt-Typ gilt als EFH (Standardschlüssel → 2)", () => {
    assert.deepEqual(alsMap(kennzahlenJeTyp("residential", flaechen, { wohnungsmix: [{ count: 1 }], stellplatzPlanung: { parking_key: 1 } })), { wohneinheiten: 1, stellplaetze: 2 });
    // inside a mixed-use project one dwelling is no single-family house
    const mi = kennzahlenJeTyp("mixed_use", flaechen, { wohnungsmix: [{ count: 1 }], stellplatzPlanung: { parking_key: 1 } });
    assert.deepEqual(alsMap(mi), { wohneinheiten: 1, stellplaetze: 1 });
    assert.equal(mi[1].quelle, "schaetzung");
  });

  it("ausdrücklich gesetzter Schlüssel 1,0 (parking_key_gesetzt) gilt als Planung", () => {
    const kpis = kennzahlenJeTyp("residential", flaechen, { wohnungsmix: [{ count: 1 }], stellplatzPlanung: { parking_key: 1, parking_key_gesetzt: true }, werkstattTyp: "efh" });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 1, stellplaetze: 1 });
    assert.equal(kpis[1].quelle, "planung");
  });

  it("MFH mit Wohnungsmix und Standardschlüssel: Schätzschlüssel 1,0 wie vorher (Untertitel unverändert)", () => {
    const kpis = kennzahlenJeTyp("residential", { nuf: 1500, bgf: 1875 }, { wohnungsmix: [{ count: 12 }], stellplatzPlanung: { total_spaces: 14, parking_key: 1 } });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 12, stellplaetze: 12 });
    assert.equal(kpis[1].quelle, "schaetzung");
    assert.equal(kpis[1].sub, kennzahlenJeTyp("residential", { nuf: 1500, bgf: 1875 })[1].sub);
  });

  it("Planungsschlüssel gilt auch mit Wohneinheiten von Hand ohne Mix (2 × 1,5 = 3)", () => {
    const kpis = kennzahlenJeTyp("residential", flaechen, { stellplatzPlanung: { parking_key: 1.5 }, hand: { wohneinheiten: 2 } });
    assert.deepEqual(alsMap(kpis), { wohneinheiten: 2, stellplaetze: 3 });
    assert.equal(kpis[1].quelle, "planung");
  });

  it("Projekt ohne Typ: Wohnungsmix oder Werkstatt-Typ efh führt in den Wohnzweig, ausdrücklich Gewerbe bleibt Gewerbe", () => {
    for (const typ of [null, undefined, ""]) {
      assert.deepEqual(alsMap(kennzahlenJeTyp(typ, flaechen, { wohnungsmix: [{ count: 1 }] })), { wohneinheiten: 1, stellplaetze: 2 });
      assert.deepEqual(alsMap(kennzahlenJeTyp(typ, flaechen, { werkstattTyp: "efh" })), { wohneinheiten: 1, stellplaetze: 2 });
      assert.ok("arbeitsplaetze" in alsMap(kennzahlenJeTyp(typ, flaechen, { wohnungsmix: [] })));
    }
    assert.ok("arbeitsplaetze" in alsMap(kennzahlenJeTyp("commercial", flaechen, { wohnungsmix: [{ count: 1 }] })));
  });

  it("handZahl / wohnungsmixAnzahl", () => {
    assert.equal(handZahl(""), null);
    assert.equal(handZahl("-1"), null);
    assert.equal(handZahl("2.4"), 2);
    assert.equal(handZahl(123456), 9999);
    assert.equal(wohnungsmixAnzahl([{ count: 2 }, { count: "3" }, { count: -1 }, null]), 5);
    assert.equal(wohnungsmixAnzahl(null), 0);
  });
});
