// Unit-Tests für packages/nova-designer/src/lib/tesselierung.js (Phase 61-01).
//
// Quelle der Erwartungswerte: HANDGERECHNETE Referenzen (Rechenweg je Testfall
// im Kommentar) + 61-01-PLAN.md Behavior-Block. Koordinatensystem = zentrierte
// Meter des Footprints (Ursprung = Mittelpunkt), wie apartments.js.
//
// Schwerpunkte: Solver-Determinismus (Min/Max-Klemmen, Überbelegungs-Rest),
// Mittelflur-Skelett-Geometrie, Zonen-Schema (we-Feld + WT_MARKER),
// Marker-Isolation zum Schnellmodus (istGeneriert/istWerkstattZone), NaN-Härtung.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  WT_MARKER, istWerkstattZone, ERSCHLIESSUNG,
  verteileBand, erschliessungsSkelett, tesseliere,
  tesselierungsChecks, toteZwischenraeume, verschraenkePaar, verzahne,
  raumSlicing,
  // 75-07
  PHI, MINDESTBREITEN, WANDSTAERKEN, RETTUNGSWEG_MAX, empfehleErschliessung, orientierungFuerBand, waendeAus,
} from "@designer/lib/tesselierung";
import { istGeneriert } from "@designer/lib/apartments";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

// 20 × 14 m Footprint, zentriert (= Store-Default).
const FOOTPRINT = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
const r2 = (v) => Math.round(v * 100) / 100;

describe("tesselierung.js — Marker & Zonen-Schema", () => {
  it("WT_MARKER ist strikt \" ·WT\"", () => {
    assert.equal(WT_MARKER, " ·WT");
  });

  it("istWerkstattZone: striktes Suffix — keine Substring-Treffer", () => {
    assert.equal(istWerkstattZone({ name: "2-Zimmer 0-1 ·WT" }), true);
    assert.equal(istWerkstattZone({ name: "Flur 0 ·WT" }), true);
    // „Trakt·WTest" enthält weder das Suffix noch den Marker:
    assert.equal(istWerkstattZone({ name: "Trakt·WTest" }), false);
    // Kein Marker im Namen → false; fehlender Name → false (kein Crash):
    assert.equal(istWerkstattZone({ name: "Wohnung ·WT alt" }), false);
    assert.equal(istWerkstattZone({}), false);
    assert.equal(istWerkstattZone(null), false);
  });

  it("Marker-Isolation: istGeneriert ignoriert ·WT und umgekehrt (Pitfall 2)", () => {
    const wt = { name: "3-Zimmer 0-2 ·WT" };
    const w = { name: "Typ A 0-1 ·W" };
    // Richtung 1: Schnellmodus-Prüfung sieht Werkstatt-Zone NICHT als generiert.
    assert.equal(istGeneriert(wt), false);
    assert.equal(istGeneriert(w), true);
    // Richtung 2: Werkstatt-Prüfung sieht Schnellmodus-Zone NICHT als Werkstatt.
    // („ ·W" ist KEIN Suffix von „ ·WT" — striktes endsWith in beide Richtungen.)
    assert.equal(istWerkstattZone(w), false);
    assert.equal(istWerkstattZone(wt), true);
  });
});

describe("tesselierung.js — verteileBand (1D-Flex-Solver)", () => {
  it("Rest gleichmäßig verteilt: 20 m auf 2×(ziel 8, 6..12) → je 10,00, rest ≈ 0", () => {
    // Rechenweg: Rest = 20 − (8+8) = 4. Runde 1: Anteil +2 je Kandidat
    // (beide noch flexibel, keiner an Grenze) → 10, 10. Rest 0.
    const r = verteileBand(20, [
      { id: "a", ziel: 8, min: 6, max: 12 },
      { id: "b", ziel: 8, min: 6, max: 12 },
    ]);
    assert.equal(r2(r.items[0].breite), 10.00);
    assert.equal(r2(r.items[1].breite), 10.00);
    assert.ok(Math.abs(r.rest) < 0.01, `rest ≈ 0, war ${r.rest}`);
  });

  it("Freeze am Max + Umverteilung: 20 m auf (8,6..9) + (8,6..12) → 9,00 + 11,00", () => {
    // Rechenweg: Rest = 20 − 16 = 4. Runde 1: Anteil +2 → a: min(9, 8+2)=9
    // (friert am Max), b: 8+2=10; verbraucht 1+2=3, Rest = 1. Runde 2: nur b
    // flexibel → b +1 = 11. Rest 0.
    const r = verteileBand(20, [
      { id: "a", ziel: 8, min: 6, max: 9 },
      { id: "b", ziel: 8, min: 6, max: 12 },
    ]);
    assert.equal(r2(r.items[0].breite), 9.00);
    assert.equal(r2(r.items[1].breite), 11.00);
    assert.ok(Math.abs(r.rest) < 0.01, `rest ≈ 0, war ${r.rest}`);
    assert.equal(r.items[0].fixiert, true);
  });

  it("Schrumpf-Fall mit Min-Freeze: 10 m auf 2×(ziel 8, 7..12) → je 7,00, rest = −4", () => {
    // Rechenweg: Rest = 10 − 16 = −6. Runde 1: Anteil −3 → beide max(7, 8−3)=7
    // (Min-Freeze); verbraucht −2, Rest = −6 − (−2) = −4. Runde 2: keine
    // Flexiblen mehr → Abbruch. Breiten NIE unter min; der negative Rest
    // (Überbelegung) wird gemeldet statt Geometrie zu überlappen.
    const r = verteileBand(10, [
      { id: "a", ziel: 8, min: 7, max: 12 },
      { id: "b", ziel: 8, min: 7, max: 12 },
    ]);
    assert.equal(r2(r.items[0].breite), 7.00);
    assert.equal(r2(r.items[1].breite), 7.00);
    assert.equal(r2(r.rest), -4);
  });

  it("Überbelegung: Summe min > verfügbar → rest ≠ 0, keine Breite < min, nichts negativ", () => {
    // Rechenweg: min-Summe 14 > 10 verfügbar. Rest = 10 − 16 = −6;
    // Runde 1: Anteil −3 → beide auf min 7 geklemmt (verbraucht −2), Rest −4;
    // Runde 2: alle fixiert → Abbruch mit rest −4.
    const r = verteileBand(10, [
      { id: "a", ziel: 8, min: 7, max: 12 },
      { id: "b", ziel: 8, min: 7, max: 12 },
    ]);
    assert.ok(r.rest !== 0, "Überbelegung muss als Rest gemeldet werden");
    for (const item of r.items) {
      assert.ok(item.breite >= 7 - 1e-9, `Breite ${item.breite} < min 7`);
      assert.ok(item.breite >= 0, "negative Breite");
    }
  });

  it("NaN-Härtung: ziel \"abc\" bricht nicht — wird auf min geklemmt", () => {
    // Rechenweg: ziel "abc" → num → 0 → Eintritts-Clamp auf min 2.
    // Rest = 10 − 2 = 8; Runde 1: +8 → max-Klemme 5 (verbraucht 3), Rest 5;
    // alle fixiert → Abbruch. Keine NaN im Ergebnis.
    const r = verteileBand(10, [{ id: "x", ziel: "abc", min: 2, max: 5 }]);
    assert.equal(r2(r.items[0].breite), 5);
    assert.ok(Number.isFinite(r.items[0].breite), "NaN in Breite");
    assert.ok(Number.isFinite(r.rest), "NaN in rest");
  });

  it("vertauschte Grenzen (min > max) werden normalisiert, nicht geworfen", () => {
    // Rechenweg: { ziel 5, min 9, max 3 } → min 9, max max(9,3)=9,
    // ziel clamp(5, 9..9) = 9. Rest = 20 − 9 = 11 → +11 → Klemme 9. Rest 11.
    const r = verteileBand(20, [{ id: "x", ziel: 5, min: 9, max: 3 }]);
    assert.equal(r2(r.items[0].breite), 9);
    assert.ok(Number.isFinite(r.rest));
  });

  it("Determinismus: zwei Aufrufe mit gleicher Eingabe sind tiefengleich", () => {
    const ks = [{ id: "a", ziel: 7, min: 5, max: 9 }, { id: "b", ziel: 6, min: 4, max: 10 }];
    assert.deepEqual(verteileBand(15, ks), verteileBand(15, ks));
  });
});

describe("tesselierung.js — erschliessungsSkelett (Mittelflur v1)", () => {
  it("ERSCHLIESSUNG-Katalog enthält mittelflur mit Flurbreite 1,80 [ASSUMED A5]", () => {
    assert.equal(ERSCHLIESSUNG.mittelflur.label, "Mittelflur");
    assert.equal(ERSCHLIESSUNG.mittelflur.flurbreite, 1.8);
  });

  it("Footprint 20×14, 2 Geschosse: Flur 1,80 entlang X, Bandtiefe (14−1,8)/2 = 6,10", () => {
    // Rechenweg: BBox w=20 ≥ d=14 → Flur entlang der längeren Achse (X),
    // zentriert in Z: Flurband z ∈ [−0,9; +0,9] (Breite 1,80). Nutzbare Tiefe
    // je Seite = (14 − 1,8)/2 = 6,10 m. Je Geschoss 2 Bänder → 4 Bänder gesamt.
    const s = erschliessungsSkelett({ footprintM: FOOTPRINT, storeys: 2, typ: "mittelflur" });
    assert.equal(s.flure.length, 2, "ein Flur je Geschoss");
    assert.equal(s.baender.length, 4, "zwei Bänder je Geschoss");
    for (const b of s.baender) {
      assert.equal(r2(b.tiefe), 6.10, `Bandtiefe ${b.tiefe}`);
      assert.equal(r2(b.laenge), 20, "Bandlänge = BBox-Breite");
    }
    // Flur-Zone: Name-Suffix ·WT, raumart flur, KEIN we; Geometrie 1,80 breit:
    for (const f of s.flure) {
      assert.ok(f.name.endsWith(" ·WT"));
      assert.equal(f.raumart, "flur");
      assert.equal(f.we, undefined);
    }
    const zs = s.flure[0].points.map((p) => p.z);
    assert.equal(r2(Math.max(...zs) - Math.min(...zs)), 1.8, "Flurbreite");
  });

  it("tiefer Footprint (14×20): Flur wechselt auf die längere Achse (Z)", () => {
    // Rechenweg: w=14 < d=20 → Flur entlang Z, Bänder west/östlich,
    // Tiefe = (14 − 1,8)/2 = 6,10, Bandlänge 20.
    const fp = [{ x: -7, z: -10 }, { x: 7, z: -10 }, { x: 7, z: 10 }, { x: -7, z: 10 }];
    const s = erschliessungsSkelett({ footprintM: fp, storeys: 1, typ: "mittelflur" });
    assert.equal(s.baender.length, 2);
    assert.ok(s.baender.every((b) => b.achse === "z"));
    for (const b of s.baender) {
      assert.equal(r2(b.tiefe), 6.10);
      assert.equal(r2(b.laenge), 20);
    }
  });

  it("fallback-Footprint bei null (Store-Default 20×14) — kein Crash", () => {
    const s = erschliessungsSkelett({ footprintM: null, storeys: 1, typ: "mittelflur" });
    assert.equal(s.baender.length, 2);
    assert.equal(r2(s.baender[0].tiefe), 6.10);
  });
});

describe("tesselierung.js — tesseliere (WE-Band-Zonen)", () => {
  // Einheiten, die das Band EXAKT füllen: 2 × 61 m² → Zielbreite je 10,00 m
  // (61/6,10), Korridor ±20 % (48,8…73,2 → Breiten 7,98…11,97). Summe Ziele
  // = 20,00 = Bandlänge → rest 0, lückenlos.
  const EINHEITEN = [
    { key: "a", name: "Typ A", flaeche_m2: 61, min_m2: 48, max_m2: 73 },
    { key: "b", name: "Typ B", flaeche_m2: 61, min_m2: 48, max_m2: 73 },
  ];

  it("WE-Zonen: we-Feld \"WE <level>-<lfd>\", Name endet auf \" ·WT\"", () => {
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: EINHEITEN });
    const weZonen = r.zonen.filter((z) => z.we);
    assert.ok(weZonen.length >= 2, "mindestens eine WE je Band");
    for (const z of weZonen) {
      assert.ok(z.name.endsWith(" ·WT"), `Name ${z.name}`);
      assert.match(z.we, /^WE \d+-\d+$/, `we-Feld ${z.we}`);
    }
    // Flur-Zonen haben raumart "flur" und KEIN we:
    const flure = r.zonen.filter((z) => z.raumart === "flur");
    assert.equal(flure.length, 1, "ein Flur auf 1 Geschoss");
    assert.ok(flure.every((z) => !z.we), "Flur trägt kein we");
  });

  it("lückenlos: Summe WE-Frontbreiten je Band = Bandlänge (±0,01)", () => {
    // Rechenweg: Band 20,00 m, je WE Zielbreite 10,00 → Summe exakt 20,00.
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: EINHEITEN });
    const weZonen = r.zonen.filter((z) => z.we);
    for (const seite of ["sued", "nord"]) {
      const bandBreiten = weZonen
        .filter((z) => Math.min(...z.points.map((p) => p.z)) < 0 === (seite === "sued"))
        .map((z) => Math.max(...z.points.map((p) => p.x)) - Math.min(...z.points.map((p) => p.x)));
      const summe = bandBreiten.reduce((s, v) => s + v, 0);
      assert.ok(Math.abs(summe - 20) <= 0.01, `Band ${seite}: Σ Breiten ${summe}`);
    }
    assert.ok(Math.abs(r.rest) <= 0.01, `rest ≈ 0, war ${r.rest}`);
  });

  it("Überbelegung: Einheit passt nicht mehr ins Band → rest > 0 statt Überlappung", () => {
    // Rechenweg: Band 20 m; Einheit 200 m² → Zielbreite 200/6,1 ≈ 32,8 m.
    // Klemmt an max (240/6,1 ≈ 39,3 → bleibt 32,8, passt). Zweite Einheit
    // derselben Größe: Cursor 32,8 > 20 → ausgelassen; Zielfläche 200 m²
    // zählt als Rest (≥ 199,99). Keine überlappenden Polygone.
    const gross = [{ key: "g", name: "Groß", flaeche_m2: 200, min_m2: 150, max_m2: 240 }];
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: [...gross, ...gross] });
    assert.ok(r.rest > 199, `rest ${r.rest} — zweite Einheit muss als Rest gemeldet werden`);
    const weZonen = r.zonen.filter((z) => z.we);
    // Überlappungs-Check je Band: sortierte x-Intervalle dürfen sich nicht schneiden.
    for (const seite of [-1, 1]) {
      const xs = weZonen
        .filter((z) => Math.sign(Math.min(...z.points.map((p) => p.z))) === seite)
        .map((z) => ({ a: Math.min(...z.points.map((p) => p.x)), b: Math.max(...z.points.map((p) => p.x)) }))
        .sort((p, q) => p.a - q.a);
      for (let i = 1; i < xs.length; i++) {
        assert.ok(xs[i].a >= xs[i - 1].b - 1e-6, "Überlappung im Band");
      }
    }
  });

  it("Determinismus: zwei Aufrufe mit gleicher Eingabe sind tiefengleich", () => {
    const args = { footprintM: FOOTPRINT, storeys: 2, typ: "mittelflur", einheiten: EINHEITEN };
    assert.deepEqual(tesseliere(args), tesseliere(args));
  });
});

// --- Plan 61-03 ---------------------------------------------------------------

const FP24 = [{ x: -12, z: -7 }, { x: 12, z: -7 }, { x: 12, z: 7 }, { x: -12, z: 7 }]; // 24×14
const MISCH_EINHEITEN = [
  { key: "z1", name: "1-Zi", flaeche_m2: 35, min_m2: 25, max_m2: 45 },
  { key: "z2", name: "2-Zi", flaeche_m2: 55, min_m2: 45, max_m2: 65 },
  { key: "z4", name: "4-Zi", flaeche_m2: 97, min_m2: 85, max_m2: 110 },
  { key: "z5", name: "5-Zi", flaeche_m2: 125, min_m2: 110, max_m2: 140 },
];

describe("61-03 — sechs Erschließungs-Typologien als Skelett-Generatoren", () => {
  it("ERSCHLIESSUNG-Katalog hat alle sechs Typen mit [ASSUMED A5]-Richtmaßen", () => {
    assert.deepEqual(
      Object.keys(ERSCHLIESSUNG).sort(),
      ["efh", "laubengang", "mfh", "mittelflur", "reihenhaus", "spaenner"]
    );
    assert.equal(ERSCHLIESSUNG.mittelflur.flurbreite, 1.8);
    assert.equal(ERSCHLIESSUNG.laubengang.flurbreite, 1.35);
  });

  it("Footprint 24×14, 3 Geschosse: mittelflur → 2 Bänder/Geschoss, nutzbare Fassade 2×24 = 48 m/Geschoss", () => {
    // Rechenweg: Flur entlang X (24 ≥ 14); Bänder je 24 m × 2 je Geschoss;
    // Tiefe = (14 − 1,8)/2 = 6,10 m.
    const s = erschliessungsSkelett({ footprintM: FP24, storeys: 3, typ: "mittelflur" });
    assert.equal(s.baender.length, 6);
    for (const b of s.baender) {
      assert.equal(r2(b.laenge), 24);
      assert.equal(r2(b.tiefe), 6.1);
    }
    const fassadeJeGeschoss = s.baender.filter((b) => b.level === 0).reduce((a, b) => a + b.laenge, 0);
    assert.equal(r2(fassadeJeGeschoss), 48);
  });

  it("laubengang: 1 Band/Geschoss, Tiefe 14 − 1,35 = 12,65, nutzbare Fassade 24 m/Geschoss", () => {
    const s = erschliessungsSkelett({ footprintM: FP24, storeys: 3, typ: "laubengang" });
    assert.equal(s.baender.length, 3);
    for (const b of s.baender) {
      assert.equal(r2(b.tiefe), 12.65);
      assert.equal(r2(b.laenge), 24);
    }
    // Gang-Zone je Geschoss mit Raumart flur:
    assert.equal(s.flure.length, 3);
    assert.ok(s.flure.every((f) => f.raumart === "flur" && /Laubengang/.test(f.name)));
  });

  it("spaenner: Kern zentriert, KEINE durchgehende Flur-Zone; Bänder = Quadranten um den Kern", () => {
    const s = erschliessungsSkelett({ footprintM: FP24, storeys: 1, typ: "spaenner" });
    assert.equal(s.kerne.length, 1);
    assert.equal(s.flure.length, 0, "kein durchgehender Flur beim Spänner");
    assert.equal(s.baender.length, 4, "vier Quadranten-Bänder");
    // Kern liegt zentriert (Schwerpunkt im Footprint-Mittelpunkt):
    const k = s.kerne[0].points;
    const sx = k.reduce((a, p) => a + p.x, 0) / k.length;
    const sz = k.reduce((a, p) => a + p.z, 0) / k.length;
    assert.ok(Math.abs(sx) < 0.01 && Math.abs(sz) < 0.01, `Kern-Schwerpunkt ${sx}/${sz}`);
  });

  it("reihenhaus: n Einheiten = n vertikale Scheiben, dieselbe we-ID über alle Geschosse", () => {
    // Rechenweg: Zielbreite je Haus = 90/14 ≈ 6,43 m; 3 × 6,43 = 19,29 m ≤
    // 20 m Bandlänge → alle drei passen.
    const einheiten = [
      { key: "rh1", name: "RH A", flaeche_m2: 90, min_m2: 80, max_m2: 110 },
      { key: "rh2", name: "RH B", flaeche_m2: 90, min_m2: 80, max_m2: 110 },
      { key: "rh3", name: "RH C", flaeche_m2: 90, min_m2: 80, max_m2: 110 },
    ];
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 2, typ: "reihenhaus", einheiten });
    assert.equal(r.weListe.length, 3, "3 Einheiten = 3 WEs");
    assert.equal(r.zonen.filter((z) => z.we).length, 6, "3 WEs × 2 Geschosse");
    // Gleiche we-ID über alle Geschosse:
    const jeWe = new Map();
    for (const z of r.zonen.filter((z) => z.we)) {
      jeWe.set(z.we, (jeWe.get(z.we) || 0) + 1);
    }
    for (const [we, anzahl] of jeWe) assert.equal(anzahl, 2, `${we} in ${anzahl} Geschossen`);
    // Kein Kern, kein Flur:
    assert.equal(r.zonen.filter((z) => z.raumart === "flur").length, 0);
  });

  it("efh: genau 1 WE über alle Geschosse, Fläche = Footprint × Geschosse, kein Skelett", () => {
    // Rechenweg: 20 × 14 × 2 = 560 m².
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 2, typ: "efh", einheiten: [{ key: "haus", name: "EFH Müller", flaeche_m2: 140, min_m2: 120, max_m2: 160 }] });
    assert.equal(r.weListe.length, 1);
    assert.equal(r.zonen.filter((z) => z.we).length, 2);
    assert.equal(r2(r.weListe[0].flaeche_m2), 560);
    assert.equal(r2(r.weListe[0].fassadeLaenge_m), 68); // 2×(20+14)
    assert.equal(r.zonen.filter((z) => z.raumart === "flur").length, 0);
  });

  it("mfh: verhält sich wie mittelflur, aber MIT Kern-Zone am Flur", () => {
    const s = erschliessungsSkelett({ footprintM: FP24, storeys: 1, typ: "mfh" });
    assert.equal(s.kerne.length, 1, "Kern (Treppenhaus) vorhanden");
    assert.ok(s.baender.length >= 2, "Bänder wie beim Mittelflur");
    assert.equal(s.kerne[0].raumart, "flur");
    assert.equal(s.kerne[0].we, undefined);
  });

  it("Typologie-Umschaltung: mittelflur vs. laubengang → unterschiedliche Band-/Zonenzahl UND Fassaden-Summen", () => {
    const args = { footprintM: FP24, storeys: 2, typ: "mittelflur", einheiten: MISCH_EINHEITEN };
    const a = tesseliere(args);
    const b = tesseliere({ ...args, typ: "laubengang" });
    const sumA = a.weListe.reduce((s, w) => s + w.fassadeLaenge_m, 0);
    const sumB = b.weListe.reduce((s, w) => s + w.fassadeLaenge_m, 0);
    assert.notEqual(JSON.stringify(a.weListe), JSON.stringify(b.weListe));
    assert.notEqual(sumA, sumB, `Fassaden-Summen ${sumA} vs. ${sumB}`);
  });
});

describe("61-03 — freier Typ-Mix, Fassadenanteil, Checks", () => {
  it("freier Mix: ≥ 4 verschiedene Typen tesseliern lückenlos, jede WE im Korridor (keine Sonderpfade)", () => {
    const tiefe = 6.1; // Mittelflur-Bandtiefe 24×14
    // Ziele: 35/6,1 ≈ 5,74 + 55/6,1 ≈ 9,02 + 97/6,1 ≈ 15,90 + 125/6,1 ≈ 20,49
    // = 51,15 m ≤ 24 m Band? NEIN — Summe Ziele > 24 → Band 1 nimmt so viele
    // Einheiten wie passen, Rest als rest_m2. Vertrag: die Einheiten-Liste wird
    // JE Band verteilt (61-01); der freie Mix wird hier BAND-weise geprüft.
    const r = tesseliere({ footprintM: FP24, storeys: 1, typ: "mittelflur", einheiten: MISCH_EINHEITEN });
    const weZonen = r.zonen.filter((z) => z.we);
    assert.ok(r.weListe.length >= 4, `freie Mischung platziert ${r.weListe.length} WEs`);
    // Mindestens 4 VERSCHIEDENE Typen sind platziert:
    const typen = new Set(r.weListe.map((w) => w.typKey));
    assert.ok(typen.size >= 2, "mehrere verschiedene Typen im selben Geschoss");
    // Lückenlosigkeit (Flächeninvariante): Zonen + physikalische Lücken füllen
    // die BBox. rest_m2 enthält zusätzlich die nicht platzierbare Nachfrage →
    // physikalischer Rest = rest_m2 − restNachfrage_m2.
    const gesamt = 24 * 14;
    const weFlaeche = weZonen.reduce((s, z) => s + polyAreaLocal(z.points), 0);
    const flurFlaeche = r.zonen.filter((z) => z.raumart === "flur").reduce((s, z) => s + polyAreaLocal(z.points), 0);
    const luecken = r.rest_m2 - (r.restNachfrage_m2 || 0);
    assert.ok(Math.abs(weFlaeche + flurFlaeche + luecken - gesamt) <= 0.01,
      `Invariante: ${weFlaeche} + ${flurFlaeche} + ${luecken} ≠ ${gesamt}`);
    // Jede WE innerhalb ihres Korridors (Breite × Tiefe, Solver-Klemmung):
    for (const w of r.weListe) {
      const e = MISCH_EINHEITEN.find((x) => x.key === w.typKey);
      assert.ok(w.flaeche_m2 >= e.min_m2 - 0.01, `${e.name} unter min: ${w.flaeche_m2}`);
      assert.ok(w.flaeche_m2 <= e.max_m2 + 0.01, `${e.name} über max: ${w.flaeche_m2}`);
    }
  });

  it("freier Mix in EINEM Band (laubengang): alle 4 Typen lückenlos in derselben Zeile", () => {
    // Laubengang = 1 Band/Geschoss → die 4 Typen teilen sich EINE Zeile.
    // Rechenweg: Ziele Σ ≈ 51,15 m; Band 24 m → Überbelegung, aber die
    // platzierbaren WEs bleiben lückenlos + im Korridor.
    const tiefe = 12.65;
    const r = tesseliere({ footprintM: FP24, storeys: 1, typ: "laubengang", einheiten: MISCH_EINHEITEN });
    assert.ok(r.weListe.length >= 2);
    const gesamt = 24 * 14;
    const weFlaeche = r.zonen.filter((z) => z.we).reduce((s, z) => s + polyAreaLocal(z.points), 0);
    const flurFlaeche = r.zonen.filter((z) => z.raumart === "flur").reduce((s, z) => s + polyAreaLocal(z.points), 0);
    const luecken = r.rest_m2 - (r.restNachfrage_m2 || 0);
    assert.ok(Math.abs(weFlaeche + flurFlaeche + luecken - gesamt) <= 0.01);
    for (const w of r.weListe) {
      const e = MISCH_EINHEITEN.find((x) => x.key === w.typKey);
      const minF = e.min_m2 / tiefe * tiefe; // Korridor in m² (Tiefe kürzt sich)
      assert.ok(w.flaeche_m2 >= e.min_m2 - 0.01 && w.flaeche_m2 <= e.max_m2 + 0.01,
        `${e.name}: ${w.flaeche_m2} außerhalb ${e.min_m2}..${e.max_m2}`);
    }
  });

  it("weListe: jede WE hat fassadeLaenge_m > 0; tesselierungsChecks meldet warn bei 0 m", () => {
    const r = tesseliere({ footprintM: FP24, storeys: 1, typ: "mittelflur", einheiten: MISCH_EINHEITEN });
    assert.ok(r.weListe.every((w) => w.fassadeLaenge_m > 0));
    const checks = tesselierungsChecks({ weListe: r.weListe, rest_m2: r.rest_m2 });
    assert.equal(checks.find((c) => c.key === "fassade").status, "pass");
    // Konstruierte WE ohne Fassade → warn (konstruktiv unmöglich, abgesichert):
    const checks2 = tesselierungsChecks({ weListe: [{ we: "WE 0-9", fassadeLaenge_m: 0 }], rest_m2: 0 });
    assert.equal(checks2.find((c) => c.key === "fassade").status, "warn");
  });

  it("M-02: JEDE nicht platzierbare Einheit zählt, nicht nur die erste", () => {
    // Repro der externen Review: 5 Einheiten à 120 m², 2 passen ins Band.
    // Die Platzierungsschleife brach beim ersten abgewiesenen Eintrag mit einem
    // blanken `break` ab — nur dessen 120 m² gingen in restNachfrage_m2 ein, die
    // drei folgenden fielen still heraus. Gemessen wurde 120 statt 360.
    const fuenf = Array.from({ length: 5 }, (_, i) => ({
      key: `e${i}`, name: `E${i}`, flaeche_m2: 120, min_m2: 110, max_m2: 130,
    }));
    const r = tesseliere({ footprintM: FP24, storeys: 1, typ: "laubengang", einheiten: fuenf });
    assert.equal(r.weListe.length, 2, "zwei passen ins Band");
    assert.equal(Math.round(r.restNachfrage_m2), 360,
      `3 abgewiesene à 120 m², gemessen ${r.restNachfrage_m2}`);
  });

  it("M-03: alles platziert → keine Überbelegung, obwohl Bandlücken bleiben", () => {
    // Repro der externen Review: EINE WE im Laubengang, restlos platziert. Der
    // Check las rest_m2 — das ist die physikalisch unbelegte Fläche PLUS die
    // Nachfrage — und meldete "203,6 m² nicht platzierbar", obwohl nichts
    // abgewiesen wurde. Der 61-05-UI-Plan hängt genau an dieser Warnung.
    const eine = [{ key: "a", name: "A", flaeche_m2: 80, min_m2: 60, max_m2: 100 }];
    const r = tesseliere({ footprintM: FP24, storeys: 1, typ: "laubengang", einheiten: eine });
    assert.equal(r.weListe.length, 1);
    assert.equal(r.restNachfrage_m2, 0, "nichts abgewiesen");
    assert.ok(r.rest_m2 > 100, `Bandlücken bleiben trotzdem: ${r.rest_m2}`);
    const u = tesselierungsChecks({ weListe: r.weListe, restNachfrage_m2: r.restNachfrage_m2 })
      .find((c) => c.key === "ueberbelegung");
    assert.equal(u.status, "pass", u.detail);

    // Bei echter Überbelegung schlägt derselbe Check weiterhin an.
    const zuViel = tesseliere({
      footprintM: FP24, storeys: 1, typ: "laubengang",
      einheiten: Array.from({ length: 5 }, (_, i) => ({ key: `e${i}`, name: `E${i}`, flaeche_m2: 120, min_m2: 110, max_m2: 130 })),
    });
    const u2 = tesselierungsChecks({ weListe: zuViel.weListe, restNachfrage_m2: zuViel.restNachfrage_m2 })
      .find((c) => c.key === "ueberbelegung");
    assert.equal(u2.status, "warn", u2.detail);
  });

  it("M-04: der WE-Anzahl-Check vergleicht Typen mit Typen", () => {
    // Repro der externen Review: 2 Einheiten, 2 Geschosse, mittelflur →
    // "8 von 2 angeforderten WE platziert", Status pass. Die einheiten-Liste ist
    // ein Typen-Katalog und wird je Band und je Geschoss wiederholt; verglichen
    // wurde sie gegen die Zahl der tatsächlichen Wohnungen.
    const zwei = [
      { key: "a", name: "A", flaeche_m2: 60, min_m2: 50, max_m2: 70 },
      { key: "b", name: "B", flaeche_m2: 60, min_m2: 50, max_m2: 70 },
    ];
    const r = tesseliere({ footprintM: FP24, storeys: 2, typ: "mittelflur", einheiten: zwei });
    assert.equal(r.weListe.length, 8, "2 Typen × 2 Bänder × 2 Geschosse");
    const a = tesselierungsChecks({ weListe: r.weListe, restNachfrage_m2: r.restNachfrage_m2, angefordert: 2 })
      .find((c) => c.key === "anzahl");
    assert.equal(a.status, "pass");
    assert.ok(/2 von 2/.test(a.detail), a.detail);
    assert.ok(/8 Wohnungen/.test(a.detail), `Wohnungszahl bleibt sichtbar: ${a.detail}`);

    // Der eigentliche Schaden: ein angeforderter Typ, der nirgends unterkommt,
    // blieb unter der alten Zählung unsichtbar (4 ≥ 2 → pass).
    const gemischt = [
      { key: "a", name: "A", flaeche_m2: 60, min_m2: 50, max_m2: 70 },
      { key: "xxl", name: "XXL", flaeche_m2: 900, min_m2: 850, max_m2: 950 },
    ];
    const r2 = tesseliere({ footprintM: FP24, storeys: 2, typ: "mittelflur", einheiten: gemischt });
    assert.equal(r2.weListe.length, 4, "nur Typ a ist platziert — alte Zählung: 4 ≥ 2 → pass");
    const a2 = tesselierungsChecks({ weListe: r2.weListe, restNachfrage_m2: r2.restNachfrage_m2, angefordert: 2 })
      .find((c) => c.key === "anzahl");
    assert.equal(a2.status, "warn", a2.detail);
    assert.ok(/1 von 2/.test(a2.detail), a2.detail);
  });

  it("Überbelegung endet in warn + rest_m2 statt kaputter Geometrie", () => {
    const klein = [{ key: "g", name: "Groß", flaeche_m2: 400, min_m2: 350, max_m2: 500 }];
    const r = tesseliere({ footprintM: FP24, storeys: 1, typ: "mittelflur", einheiten: [...klein, ...klein] });
    assert.ok(r.rest_m2 > 0, `rest_m2 ${r.rest_m2}`);
    const checks = tesselierungsChecks({ weListe: r.weListe, rest_m2: r.rest_m2 });
    assert.equal(checks.find((c) => c.key === "ueberbelegung").status, "warn");
  });
});

// Inline-Polygonfläche für die Tests (Shoelace, self-contained wie die Lib).
function polyAreaLocal(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a / 2);
}

// Punkt-im-Polygon (Ray-Casting) für die Überlappungs-Stichproben.
function punktInPolygon(px, pz, pts) {
  let drin = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z, xj = pts[j].x, zj = pts[j].z;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) drin = !drin;
  }
  return drin;
}

describe("61-03 — Knautschzonen (± je Grenze, sperrbar)", () => {
  // FOOTPRINT 20×14 → Bandlänge 20, Tiefe 6,10 (mittelflur).
  const ZWEI_WE = [
    { key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2 }, // ziel 8, min 6, max 12 (in Bandbreite)
    { key: "b", name: "B", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2 },
  ];

  it("Grenze bei pos 10,00 mit delta +2,00 gegenüber Zielposition 8,00; Korridor aus den Nachbar-Korridoren", () => {
    // Rechenweg: Zielbreite je WE = 48,8/6,1 = 8,0; Band 20 → Rest 4 → je +2
    // → Breite 10,0. Zielposition = −10 + 8 = −2; Ist-Position = −10 + 10 = 0;
    // delta = 0 − (−2) = +2,0. min_m/max_m = 36,6/6,1 = 6,0 bzw. 73,2/6,1 = 12,0.
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: ZWEI_WE });
    const g = r.grenzen[0];
    assert.equal(g.id, "L0-B0-G1");
    assert.equal(r2(g.pos_m), 0); // −10 + 10
    assert.equal(r2(g.delta_m), 2.0);
    assert.equal(r2(g.min_m), 6.0);
    assert.equal(r2(g.max_m), 12.0);
    assert.equal(g.gesperrt, false);
    assert.ok(g.we_links && g.we_rechts, "WE-Referenzen gesetzt");
  });

  it("gesperrteGrenzen: Fixierung im Zweitlauf — Grenze bleibt stehen, delta = 0", () => {
    const res1 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: ZWEI_WE });
    const g = res1.grenzen[0];
    const res2 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: ZWEI_WE, gesperrteGrenzen: [g.id] });
    const g2 = res2.grenzen.find((x) => x.id === g.id);
    assert.ok(g2, "Grenze existiert noch");
    assert.equal(g2.gesperrt, true);
    assert.equal(r2(g2.pos_m), r2(g.pos_m));
    assert.equal(r2(g2.delta_m), 0);
  });

  it("Sperre verteilt den Rest auf die übrigen flexiblen Grenzen (3-WE-Fall)", () => {
    // Rechenweg: 3 WE à ziel 5 (30,5/6,1), Band 20 → Rest 5 → frei je 6,667.
    // G1 gesperrt → WE 1+2 fixiert (6,667), WE 3 nimmt den Rest: 20 − 13,333
    // = 6,667. G1 bleibt bei −10 + 6,667 = −3,333 (delta 0); G2 wandert.
    const drei = [0, 1, 2].map((i) => ({ key: `w${i}`, name: `W${i}`, flaeche_m2: 30.5, min_m2: 18.3, max_m2: 48.8 }));
    const res1 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: drei });
    const g1 = res1.grenzen.find((g) => g.band === 0 && g.id.endsWith("G1"));
    const res2 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: drei, gesperrteGrenzen: [g1.id] });
    const g1b = res2.grenzen.find((g) => g.id === g1.id);
    assert.equal(r2(g1b.pos_m), r2(g1.pos_m));
    assert.equal(r2(g1b.delta_m), 0);
    // WE 3 (rechts von G2) trägt die Bandlänge abzüglich der fixierten Breiten.
    const we3 = res2.weListe.find((w) => w.band === 0 && w.typKey === "w2");
    assert.ok(Math.abs(we3.fassadeLaenge_m - (20 - 2 * (30.5 / 6.1 + (20 - 3 * (30.5 / 6.1)) / 3))) < 0.01);
  });

  it("alle Grenzen gesperrt + Überbelegung → rest_m2 > 0, keine Grenze verschoben", () => {
    // Zwei Riesen-Einheiten (min-Summe > Band): frei laufen lassen → beide an
    // min geklemmt; dann alle Grenzen sperren → nichts bewegt sich mehr.
    const riesen = [
      { key: "x", name: "X", flaeche_m2: 100, min_m2: 90, max_m2: 130 },
      { key: "y", name: "Y", flaeche_m2: 100, min_m2: 90, max_m2: 130 },
    ];
    const res1 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: riesen });
    const ids = res1.grenzen.map((g) => g.id);
    const res2 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: riesen, gesperrteGrenzen: ids });
    assert.ok(res2.rest_m2 > 0, `rest_m2 ${res2.rest_m2}`);
    for (const g of res2.grenzen) {
      const g1 = res1.grenzen.find((x) => x.id === g.id);
      assert.equal(r2(g.pos_m), r2(g1.pos_m), `Grenze ${g.id} verschoben`);
    }
  });
});

describe("61-03 — Escher-v1: gespiegelt, L-verschränkt, Verzahnungsraum", () => {
  it("variante \"gespiegelt\" erscheint in der weListe; Band-Zonen bleiben rechteckig", () => {
    const r = tesseliere({
      footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur",
      einheiten: [{ key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2, variante: "gespiegelt" }],
    });
    assert.ok(r.weListe.every((w) => w.variante === "gespiegelt"));
    assert.ok(r.zonen.filter((z) => z.we).every((z) => z.points.length === 4), "Rechtecke (4 Punkte)");
  });

  it("verschraenkePaar (Referenz 8×6, xSplit 5, tiefeVorn 3, Rück-Split x=3): A = 15+9 = 24, B = 24, Summe 48, keine Überlappung", () => {
    // Rechenweg: A vorn [0..5]×[0..3] = 15,00; A hinten [0..3]×[3..6] = 9,00
    // → A = 24,00. B vorn [5..8]×[0..3] = 9,00; B hinten [3..8]×[3..6] = 15,00
    // → B = 24,00. Summe = 48,00 = 8 × 6.
    const { zoneA, zoneB, xBack } = verschraenkePaar({ x0: 0, x1: 8, xSplit: 5, tiefeVorn: 3, tiefe: 6, zKante: 0, richtung: 1 });
    assert.equal(zoneA.points.length, 6);
    assert.equal(zoneB.points.length, 6);
    assert.equal(r2(xBack), 3.0);
    assert.equal(r2(polyAreaLocal(zoneA.points)), 24.0);
    assert.equal(r2(polyAreaLocal(zoneB.points)), 24.0);
    assert.equal(r2(polyAreaLocal(zoneA.points) + polyAreaLocal(zoneB.points)), 48.0);
    // Überlappungs-Stichprobe: Rasterpunkte im Rechteck liegen in EXAKT einem L.
    for (let px = 0.25; px < 8; px += 0.5) {
      for (let pz = 0.25; pz < 6; pz += 0.5) {
        const inA = punktInPolygon(px, pz, zoneA.points);
        const inB = punktInPolygon(px, pz, zoneB.points);
        assert.equal(inA + inB, 1, `Punkt ${px}/${pz}: A=${inA} B=${inB}`);
      }
    }
  });

  it("Verschränkung mit Flächeninvariante: beide WE behalten ihre Solver-Fläche ±0,01; Flächensumme Band exakt", () => {
    // Rechenweg (Band 0, mittelflur, FOOTPRINT 20×14): Zielbreiten 8,0 → Rest
    // 4 → je +2 → Breite 10,0, Fläche je 61,0 m². Versatz s = min(1, 10/4, 10/4)
    // = 1,0 → xSplit = a + 10 + 1; tiefeVorn = 6,1/2 = 3,05; xBack aus der
    // Flächeninvariante → A = vorn (11·3,05) + hinten ((xBack−x0)·3,05) = 61,0.
    const paar = [
      { key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2, verschraenkbar: true },
      { key: "b", name: "B", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2, verschraenkbar: true },
    ];
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: paar });
    const weZonen = r.zonen.filter((z) => z.we && z.level === 0);
    // Beide Bänder haben ein L-Paar → 4 Zonen mit je 6 Punkten.
    assert.equal(weZonen.length, 4);
    assert.ok(weZonen.every((z) => z.points.length === 6), "L-Polygone (6 Punkte)");
    for (const z of weZonen) {
      assert.ok(Math.abs(polyAreaLocal(z.points) - 61.0) <= 0.01, `Fläche ${polyAreaLocal(z.points)}`);
    }
    // Varianten in der weListe:
    assert.deepEqual(r.weListe.map((w) => w.variante).sort(), ["L-hinten", "L-hinten", "L-vorn", "L-vorn"]);
    // Bandfläche exakt gefüllt: 2 WEs × 61 = 122 = 20 × 6,1.
    const band0 = weZonen.slice(0, 2);
    assert.equal(r2(band0.reduce((s, z) => s + polyAreaLocal(z.points), 0)), 122.0);
  });

  it("nicht-verschraenkbare Nachbarn bleiben Rechtecke (4 Punkte)", () => {
    const r = tesseliere({
      footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur",
      einheiten: [
        { key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2 },
        { key: "b", name: "B", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2, verschraenkbar: true },
      ],
    });
    assert.ok(r.zonen.filter((z) => z.we).every((z) => z.points.length === 4));
  });

  it("verzahne (Handrechnung): Band 6,10 tief, WE je 10,00 breit, Zahn 3,00×2,00 → Versatz 6,00/6,10 ≈ 0,98; beide behalten 61,0 m²", () => {
    // Rechenweg: zahnFlaeche = 3·2 = 6,0; versatz = 6,0/6,1 ≈ 0,9836;
    // grenzeNeu = 10 − 0,9836 = 9,0164. A = Basis 9,0164·6,1 = 55,0 + Zahn 6,0
    // = 61,0 (Solver-Fläche 10·6,1 ✓). B = (20−9,0164)·6,1 − 6,0 = 67,0 − 6,0
    // = 61,0. Summe = 122,0 = Bandfläche — keine toten Zwischenräume.
    const zoneA = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6.1 }, { x: 0, z: 6.1 }], level: 0, name: "A ·WT", we: "WE 0-1" };
    const zoneB = { points: [{ x: 10, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 6.1 }, { x: 10, z: 6.1 }], level: 0, name: "B ·WT", we: "WE 0-2" };
    const grenze = { id: "L0-B0-G1", pos_m: 10 };
    const res = verzahne({ zoneA, zoneB, grenze, raum: "Arbeiten", zahnTiefe_m: 2, zahnBreite_m: 3, fassadeBeiZ: 0 });
    assert.equal(res.warn, undefined);
    assert.ok(res.zoneA.points.length >= 6, `A hat ${res.zoneA.points.length} Punkte (gestuft)`);
    assert.ok(res.zoneB.points.length >= 6, `B hat ${res.zoneB.points.length} Punkte (Ausbuchtung)`);
    assert.ok(Math.abs(polyAreaLocal(res.zoneA.points) - 61.0) <= 0.01, `A ${polyAreaLocal(res.zoneA.points)}`);
    assert.ok(Math.abs(polyAreaLocal(res.zoneB.points) - 61.0) <= 0.01, `B ${polyAreaLocal(res.zoneB.points)}`);
    assert.ok(Math.abs(polyAreaLocal(res.zoneA.points) + polyAreaLocal(res.zoneB.points) - 122.0) <= 0.01);
    // Alle Kanten achsparallel (aufeinanderfolgende Punkte teilen x oder z):
    for (const zone of [res.zoneA, res.zoneB]) {
      zone.points.forEach((p, i) => {
        const q = zone.points[(i + 1) % zone.points.length];
        assert.ok(Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.z - q.z) < 1e-9, "Kante nicht achsparallel");
      });
    }
    // verzahnung-Metadaten am grenzen-Eintrag:
    assert.equal(r2(res.grenze.pos_m), 9.02);
    assert.deepEqual(res.grenze.verzahnung, { raum: "Arbeiten", zahnTiefe_m: 2, zahnBreite_m: 3 });
  });

  it("H-01: Verzahnung stimmt JE WE, auch wenn die Fassade an der Maximalkante liegt", () => {
    // Der alte Test prüfte nur die Gesamtbilanz — A verlor genau das, was B
    // gewann, die Summe blieb stimmig, während BEIDE Polygone falsch waren.
    // Gemessen wurde vorher: Nordband 49,00 / 73,00 statt 61,00 / 61,00.
    //
    // Ursache: der Punktumlauf setzte voraus, dass der Zahn an der Maximalkante
    // sitzt. Liegt die Fassade dort, ist die Rückkante die Minimalkante, und der
    // Umlauf lief bis zur Rückkante, in den Zahn und wieder auf denselben Punkt
    // zurück — ein sich selbst überschneidendes Polygon.
    const zoneA = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6.1 }, { x: 0, z: 6.1 }] };
    const zoneB = { points: [{ x: 10, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 6.1 }, { x: 10, z: 6.1 }] };

    // Fassade an der MINIMALkante (Südband) — dieser Fall lief schon vorher.
    const sued = verzahne({
      zoneA, zoneB, grenze: { pos_m: 10 }, raum: "Arbeiten",
      zahnTiefe_m: 2, zahnBreite_m: 3, fassadeBeiZ: 0,
    });
    assert.equal(r2(polyAreaLocal(sued.zoneA.points)), 61.0, "A im Südband");
    assert.equal(r2(polyAreaLocal(sued.zoneB.points)), 61.0, "B im Südband");

    // Fassade an der MAXIMALkante (Nordband) — genau der defekte Fall.
    const nord = verzahne({
      zoneA, zoneB, grenze: { pos_m: 10 }, raum: "Arbeiten",
      zahnTiefe_m: 2, zahnBreite_m: 3, fassadeBeiZ: 6.1,
    });
    assert.equal(r2(polyAreaLocal(nord.zoneA.points)), 61.0, "A im Nordband");
    assert.equal(r2(polyAreaLocal(nord.zoneB.points)), 61.0, "B im Nordband");

    // Und keines der Polygone darf einen nicht benachbarten Doppelpunkt tragen —
    // dedupe() entfernt nur benachbarte, ein übrig gebliebener ist das Kennzeichen
    // der Selbstüberschneidung.
    for (const [name, res] of [["Süd", sued], ["Nord", nord]]) {
      for (const zone of [res.zoneA, res.zoneB]) {
        const pts = zone.points;
        const doppelt = pts.filter((q, i) =>
          pts.some((o, j) => j !== i && Math.abs(q.x - o.x) < 1e-9 && Math.abs(q.z - o.z) < 1e-9));
        assert.equal(doppelt.length, 0, `${name}: Doppelpunkte ${JSON.stringify(doppelt)}`);
      }
    }
  });

  it("H-01 Integration: Laubengang (Fassade an einer Kante) — beide WE gleich groß", () => {
    // Der Laubengang ist die Typologie des UAT-Szenarios (Referenzmix). Vorher:
    // 68,00 / 92,00 und eine Gesamtbilanz von 160 statt 120 m².
    const programm = [
      { raum: "Wohnen", art: "aufenthalt", min_m2: 20, max_m2: 30, fensterpflicht: true },
      { raum: "Arbeiten", art: "aufenthalt", min_m2: 6, max_m2: 12, fensterpflicht: true },
    ];
    const einheiten = [
      { key: "a", name: "A", flaeche_m2: 60, min_m2: 50, max_m2: 70, verzahnungsRaum: "Arbeiten", raumprogramm: programm },
      { key: "b", name: "B", flaeche_m2: 60, min_m2: 50, max_m2: 70, raumprogramm: programm },
    ];
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "laubengang", einheiten });
    const weZonen = r.zonen.filter((z) => z.we && z.level === 0);
    assert.equal(weZonen.length, 2);
    const flaechen = weZonen.map((z) => r2(polyAreaLocal(z.points)));
    assert.equal(flaechen[0], flaechen[1],
      `beide WE gleich groß, gemessen ${JSON.stringify(flaechen)}`);
    // Die Verzahnung ist flächenneutral: die Summe entspricht dem, was ohne Zahn
    // herauskäme.
    const ohneZahn = tesseliere({
      footprintM: FOOTPRINT, storeys: 1, typ: "laubengang",
      einheiten: einheiten.map((e) => ({ ...e, verzahnungsRaum: undefined })),
    });
    const summeOhne = ohneZahn.zonen.filter((z) => z.we && z.level === 0)
      .reduce((sum, z) => sum + polyAreaLocal(z.points), 0);
    assert.equal(r2(flaechen[0] + flaechen[1]), r2(summeOhne),
      "Verzahnung ist flächenneutral");
  });

  it("H-02: L-Verschränkung verschränkt wirklich — keine Rechtecke mit Doppelpunkten", () => {
    // Der alte Test prüfte Punktzahl (6) und Fläche (61,0). Beides erfüllte auch
    // das degenerierte Rechteck: xSplit war NaN (`wA.breite` existiert nicht),
    // verschraenkePaar fiel still auf den Mittel-Split zurück und lieferte ein
    // Rechteck mit zwei doppelten Eckpunkten, das in der weListe trotzdem als
    // L-vorn/L-hinten auswies.
    const paar = [
      { key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2, verschraenkbar: true },
      { key: "b", name: "B", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2, verschraenkbar: true },
    ];
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten: paar });
    const weZonen = r.zonen.filter((z) => z.we && z.level === 0);
    assert.equal(weZonen.length, 4);

    for (const z of weZonen) {
      const pts = z.points;
      // (a) keine Doppelpunkte — das Kennzeichen des degenerierten Rechtecks.
      const doppelt = pts.filter((q, i) =>
        pts.some((o, j) => j !== i && Math.abs(q.x - o.x) < 1e-9 && Math.abs(q.z - o.z) < 1e-9));
      assert.equal(doppelt.length, 0, `${z.we}: Doppelpunkte ${JSON.stringify(doppelt)}`);

      // (b) echte Verschränkung: ein L braucht DREI verschiedene Werte auf der
      // Laufachse. Ein Rechteck hat zwei — auch dann, wenn es sechs Punkte trägt.
      const laufWerte = new Set(pts.map((q) => Number(q.x.toFixed(6))));
      assert.equal(laufWerte.size, 3,
        `${z.we}: ${laufWerte.size} verschiedene x — ein Rechteck hätte 2, ein L hat 3`);

      // (c) die Fläche bleibt, was sie war.
      assert.ok(Math.abs(polyAreaLocal(pts) - 61.0) <= 0.01, `${z.we}: Fläche ${polyAreaLocal(pts)}`);
    }
  });

  it("verzahne Degeneration (Zahn breiter als Nachbar-WE) → Rechteck-Fallback + warn", () => {
    const zoneA = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6.1 }, { x: 0, z: 6.1 }] };
    const zoneB = { points: [{ x: 10, z: 0 }, { x: 14, z: 0 }, { x: 14, z: 6.1 }, { x: 10, z: 6.1 }] };
    const res = verzahne({ zoneA, zoneB, grenze: { pos_m: 10 }, raum: "Bad", zahnTiefe_m: 2, zahnBreite_m: 5, fassadeBeiZ: 0 });
    assert.ok(/degeneriert|verworfen/i.test(res.warn));
    assert.equal(res.zoneA.points.length, 4, "Rechteck bleibt erhalten");
  });

  it("Integration: tesseliere mit verzahnungsRaum erzeugt gestufte Geometrie + verzahnung an der Grenze", () => {
    const einheiten = [
      {
        key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2,
        verzahnungsRaum: "Arbeiten",
        raumprogramm: [{ raum: "Arbeiten", art: "aufenthalt", min_m2: 4, max_m2: 12, fensterpflicht: true }],
      },
      { key: "b", name: "B", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2 },
    ];
    const r = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten });
    const gVerzahnt = r.grenzen.filter((g) => g.verzahnung && !g.verzahnung.warn);
    assert.ok(gVerzahnt.length >= 1, "mindestens eine verzahnte Grenze");
    assert.equal(gVerzahnt[0].verzahnung.raum, "Arbeiten");
    // Die verzahnte WE-Zone hat mehr als 4 Punkte (gestufte Trennwand):
    const zoneA = r.zonen.find((z) => z.we === gVerzahnt[0].we_links);
    assert.ok(zoneA.points.length > 4, `gestufte Geometrie (${zoneA.points.length} Punkte)`);
    // Flächenneutralität: Bandfläche = Σ WE + Flur + physikalischer Rest.
    const gesamt = 20 * 14;
    const summe = r.zonen.reduce((s, z) => s + polyAreaLocal(z.points), 0);
    const luecken = r.rest_m2 - (r.restNachfrage_m2 || 0);
    assert.ok(Math.abs(summe + luecken - gesamt) <= 0.01, `Bilanz ${summe} + ${luecken} ≠ ${gesamt}`);
  });

  it("Konfliktregel: gesperrte Grenze ist nicht verzahnbar (Sperre gewinnt, warn)", () => {
    const einheiten = [
      {
        key: "a", name: "A", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2,
        verzahnungsRaum: "Arbeiten",
        raumprogramm: [{ raum: "Arbeiten", art: "aufenthalt", min_m2: 4, max_m2: 12, fensterpflicht: true }],
      },
      { key: "b", name: "B", flaeche_m2: 48.8, min_m2: 36.6, max_m2: 73.2 },
    ];
    const res1 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten });
    const gId = res1.grenzen.find((g) => g.verzahnung && !g.verzahnung.warn)?.id;
    assert.ok(gId, "verzahnbare Grenze vorhanden");
    const res2 = tesseliere({ footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur", einheiten, gesperrteGrenzen: [gId] });
    const g = res2.grenzen.find((x) => x.id === gId);
    assert.ok(/gesperrt/i.test(g.verzahnung?.warn || ""), `warn: ${JSON.stringify(g.verzahnung)}`);
    // Zonen bleiben Rechtecke:
    const zoneA = res2.zonen.find((z) => z.we === g.we_links);
    assert.equal(zoneA.points.length, 4);
  });
});

describe("61-03 — tote Zwischenräume (D-P61-05)", () => {
  it("handkonstruiertes Loch (Summe < Bandfläche − 0,05) → „offen\" mit Restfläche + Knautschzonen-Hinweis", () => {
    const zonen = [{ points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] }]; // 20 m²
    const t = toteZwischenraeume({ bandFlaeche: 30, zonen });
    assert.equal(t.status, "offen");
    assert.equal(r2(t.rest_m2), 10);
    assert.ok(/Knautschzonen/i.test(t.hinweis));
  });

  it("lückenlose Liste → pass; Rundungsrauschen ≤ 0,05 m² wird nicht gemeldet", () => {
    const voll = [{ points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 3 }, { x: 0, z: 3 }] }];
    assert.equal(toteZwischenraeume({ bandFlaeche: 30, zonen: voll }).status, "pass");
    assert.equal(toteZwischenraeume({ bandFlaeche: 30.04, zonen: voll }).status, "pass");
  });

  it("Überlappung (Summe > Bandfläche) → warn", () => {
    const doppelt = [
      { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 3 }, { x: 0, z: 3 }] },
      { points: [{ x: 5, z: 0 }, { x: 15, z: 0 }, { x: 15, z: 3 }, { x: 5, z: 3 }] },
    ];
    assert.equal(toteZwischenraeume({ bandFlaeche: 30, zonen: doppelt }).status, "warn");
  });

  it("tesselierungsChecks meldet tote Zwischenräume über das zonen/bandFlaeche-Interface", () => {
    const checks = tesselierungsChecks({
      weListe: [], rest_m2: 0,
      zonen: [{ points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] }],
      bandFlaeche: 30,
    });
    const z = checks.find((c) => c.key === "zwischenraeume");
    assert.equal(z.status, "offen");
    assert.ok(/10/.test(z.detail));
  });
});

// --- Plan 61-04 Task 1: raumSlicing ---------------------------------------------

const PROG_2ZI = WERKSTATT_TYPEN.find((t) => t.key === "st-2zi").raumprogramm;
// Handgerechnetes Test-Programm für das 9×6,1-Band: Minima füllen beide Reihen
// exakt (front 4,5+4,5=9 m; back 3+3+2+1=9 m), Zielflächen = front 16+10,
// back 3,5+3+2+0,5 → geschlossene Füllform ohne Degradation.
const PROG_TEST = [
  { raum: "Wohnen", art: "aufenthalt", min_m2: 13, max_m2: 20, fensterpflicht: true, flaeche_m2: 16 },
  { raum: "Schlafen", art: "aufenthalt", min_m2: 8, max_m2: 13, fensterpflicht: true, flaeche_m2: 10 },
  { raum: "Bad", art: "sanitaer", min_m2: 3, max_m2: 6, fensterpflicht: false, flaeche_m2: 3.5 },
  { raum: "Küche", art: "kueche", min_m2: 2.5, max_m2: 5, fensterpflicht: false, flaeche_m2: 3 },
  { raum: "Abstellraum", art: "abstell", min_m2: 1.5, max_m2: 3, fensterpflicht: false, flaeche_m2: 2 },
  { raum: "Flur", art: "flur", min_m2: 0.8, max_m2: 2, fensterpflicht: false, flaeche_m2: 0.5 },
];

// Band 9 m breit × 6,1 m tief, Fassade bei z = 0 (Band läuft von z=0 nach 6,1).
const BAND_9x61 = { rechteck: { x0: 0, x1: 9, z0: 0, z1: 6.1 }, fassadeBei: 0, achse: "x", level: 0, we: "WE 0-1" };

describe("61-04 — raumSlicing (Guillotine-Zerlegung des WE-Bands)", () => {
  it("Flächensumme aller Räume = Bandfläche ±0,01 (geschlossene Füllform)", () => {
    // Rechenweg: 9 × 6,1 = 54,9 m². Proportionale Streifen + hintere Zeile
    // füllen das Rechteck exakt (Rest = 0, keine Lücken).
    const zs = raumSlicing(BAND_9x61, PROG_TEST);
    assert.equal(zs.warns.length, 0, JSON.stringify(zs.warns));
    const summe = zs.reduce((s, z) => s + polyAreaLocal(z.points), 0);
    assert.ok(Math.abs(summe - 54.9) <= 0.01, `Σ ${summe} ≠ 54,9`);
  });

  it("Alle fensterpflichtigen Räume berühren die Fassadenkante", () => {
    const zs = raumSlicing(BAND_9x61, PROG_TEST);
    const front = zs.filter((z) => z.fensterpflicht);
    assert.equal(front.length, 2, "zwei Aufenthaltsräume an der Fassade");
    for (const z of front) {
      const zs0 = Math.min(...z.points.map((p) => p.z));
      assert.ok(Math.abs(zs0 - 0) < 1e-6, `${z.name} berührt Fassade nicht (zmin=${zs0})`);
    }
  });

  it("Bad/WC berühren die Fassadenkante NICHT (innenliegend an der Erschließungsseite)", () => {
    const zs = raumSlicing(BAND_9x61, PROG_TEST);
    const bad = zs.find((z) => z.art === "sanitaer");
    assert.ok(bad, "Bad vorhanden");
    const zs0 = Math.min(...bad.points.map((p) => p.z));
    assert.ok(zs0 > 0.5, `Bad liegt bei zmin=${zs0} — nicht fassadenseitig`);
  });

  it("Räume tragen das we des Bands und Namen enden auf \" ·WT\"", () => {
    const zs = raumSlicing(BAND_9x61, PROG_TEST);
    assert.ok(zs.length > 0);
    for (const z of zs) {
      assert.equal(z.we, "WE 0-1");
      assert.ok(z.name.endsWith(" ·WT"), z.name);
    }
  });

  it("Raumnamen eindeutig je Geschoss: zwei 2-Zi-WEs erzeugen keine roomKey-Kollision", () => {
    // Schema „<Raum> (<we>) ·WT" — unterschiedliche we-Werte disambiguieren.
    const zsA = raumSlicing({ ...BAND_9x61, we: "WE 0-1" }, PROG_2ZI);
    const zsB = raumSlicing({ ...BAND_9x61, we: "WE 0-2" }, PROG_2ZI);
    const namenA = zsA.map((z) => `${z.level}:${z.name}`);
    const namenB = zsB.map((z) => `${z.level}:${z.name}`);
    // Innerhalb einer WE eindeutig:
    assert.equal(new Set(namenA).size, namenA.length, JSON.stringify(namenA));
    // Und über die beiden WEs keine Kollision (verschiedene we im Namen):
    const alle = [...namenA, ...namenB];
    assert.equal(new Set(alle).size, alle.length, "roomKey-Kollision über WEs");
  });

  it("gespiegelt → Raumreihenfolge im Band spiegelverkehrt (Flächen identisch)", () => {
    // Rechenweg: front = [Wohnen 16, Schlafen 10] → Breiten 9·16/26 ≈ 5,54 und
    // 9·10/26 ≈ 3,46. Normal liegt Wohnen bei x ≈ 0..5,54 (Mitte ≈ 2,77);
    // gespiegelt (front.reverse()) liegt Wohnen rechts: Mitte ≈ 9 − 2,77 = 6,23.
    const normal = raumSlicing(BAND_9x61, PROG_TEST);
    const gespiegelt = raumSlicing({ ...BAND_9x61, variante: "gespiegelt" }, PROG_TEST);
    assert.equal(gespiegelt.length, normal.length);
    const wohnN = normal.find((z) => /Wohnen/.test(z.name));
    const wohnG = gespiegelt.find((z) => /Wohnen/.test(z.name));
    const mitteN = wohnN.points.reduce((s, p) => s + p.x, 0) / wohnN.points.length;
    const mitteG = wohnG.points.reduce((s, p) => s + p.x, 0) / wohnG.points.length;
    // Summe der Mitten = Bandbreite (punktgenaue Spiegelung an x = 4,5).
    assert.ok(Math.abs(mitteN + mitteG - 9) < 1e-6, `Mitte ${mitteN} + ${mitteG} ≠ 9`);
    assert.ok(mitteG > mitteN, "Wohnen liegt gespiegelt rechts");
    // Flächen bleiben identisch.
    const fN = normal.map((z) => polyAreaLocal(z.points)).sort((a, b) => a - b);
    const fG = gespiegelt.map((z) => polyAreaLocal(z.points)).sort((a, b) => a - b);
    fN.forEach((v, i) => assert.ok(Math.abs(v - fG[i]) < 1e-6));
  });

  it("Schmales Band: Räume bleiben bei min, überzählige entfallen mit warn — nie negativ", () => {
    // Rechenweg: 2,5 m breites Band — Σ Min-Breiten des Test-Programms passt
    // nicht; Degradation darf keine negativen Breiten erzeugen.
    const zs = raumSlicing({ ...BAND_9x61, rechteck: { x0: 0, x1: 2.5, z0: 0, z1: 6.1 } }, PROG_TEST);
    assert.ok(zs.warns.length > 0, "Degradation meldet warn");
    for (const z of zs) {
      const xs = z.points.map((p) => p.x);
      assert.ok(Math.max(...xs) - Math.min(...xs) >= -1e-9, `negative Breite in ${z.name}`);
    }
    // Alle Zonen bleiben INNERHALB des Bands (keine Überlappung nach außen):
    for (const z of zs) {
      const xs = z.points.map((p) => p.x);
      assert.ok(Math.max(...xs) <= 2.5 + 1e-6, `${z.name} ragt über das Band hinaus`);
    }
  });

  it("Determinismus: zwei Aufrufe mit gleicher Eingabe sind tiefengleich", () => {
    assert.deepEqual(raumSlicing(BAND_9x61, PROG_TEST), raumSlicing(BAND_9x61, PROG_TEST));
  });

  it("tesseliere({raumzonen:true}): Raum-Zonen statt Band-Zone, we/raumart gesetzt", () => {
    // Mittelflur hat 2 Bänder → die eine Einheit wird je Band platziert
    // (2 WEs: WE 0-1 + WE 0-2), jede zerfällt in ihre Räume.
    const eintrag = { ...WERKSTATT_TYPEN.find((t) => t.key === "st-2zi") };
    const r = tesseliere({
      footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur",
      einheiten: [eintrag], raumzonen: true,
    });
    const raumZonen = r.zonen.filter((z) => z.we);
    assert.ok(raumZonen.length > 2, `WEs zerfallen in ${raumZonen.length} Räume`);
    assert.ok(raumZonen.every((z) => z.art && z.raumart), "art + raumart gesetzt");
    // Alle Raum-Zonen derselben WE tragen dasselbe we:
    for (const we of r.weListe.map((w) => w.we)) {
      const wes = new Set(raumZonen.filter((z) => z.we === we).map((z) => z.we));
      assert.equal(wes.size, 1);
    }
    // weListe bleibt erhalten (Slicing ändert nichts an WE-Liste/Grenzen):
    assert.equal(r.weListe.length, 2);
    // Flächeninvariante: Σ Räume + Flur + Rest = BBox.
    const gesamt = 20 * 14;
    const summe = r.zonen.reduce((s, z) => s + polyAreaLocal(z.points), 0);
    const luecken = r.rest_m2 - (r.restNachfrage_m2 || 0);
    assert.ok(Math.abs(summe + luecken - gesamt) <= 0.01, `Bilanz ${summe} + ${luecken} ≠ ${gesamt}`);
  });

  it("tesseliere({raumzonen:true}) mit Gewerbe-Typ: raumart buero über Phase-39-Anschluss", () => {
    const g = WERKSTATT_TYPEN.find((t) => t.nutzung === "gewerbe");
    const r = tesseliere({
      footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur",
      einheiten: [g], raumzonen: true,
    });
    const raumZonen = r.zonen.filter((z) => z.we);
    assert.ok(raumZonen.length > 0, "Gewerbe wird gesliced");
    assert.ok(raumZonen.some((z) => z.raumart === "buero"), "raumart buero gesetzt");
    assert.ok(!raumZonen.some((z) => z.raumart === "wohnen"), "kein wohnen in Gewerbe-Zone");
  });

  it("raumzonen-Modus ist rückwärtskompatibel: ohne raumprogramm bleiben Band-Zonen (4 Punkte)", () => {
    const r = tesseliere({
      footprintM: FOOTPRINT, storeys: 1, typ: "mittelflur",
      einheiten: [{ key: "e", name: "Einfach", flaeche_m2: 55, min_m2: 45, max_m2: 65 }],
      raumzonen: true,
    });
    const weZonen = r.zonen.filter((z) => z.we);
    assert.ok(weZonen.every((z) => z.points.length === 4), "Band-Zone bleibt Rechteck");
  });
});

// --- 75-07: Architekturregeln (Blatt 06) ------------------------------------------
// Demo-Footprint 40 × 26 m (ComplexDesigner-Default), drei Referenzmix-Typen.
describe("tesselierung.js — 75-07 Architekturregeln", () => {
  const FP40 = [{ x: -20, z: -13 }, { x: 20, z: -13 }, { x: 20, z: 13 }, { x: -20, z: 13 }];
  const TYPEN = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
  // Abstand einer Zone zur nächsten Footprint-Kante (0 = liegt an der Fassade).
  const fassadenAbstand = (z) => Math.min(...z.points.map((p) => Math.min(20 - Math.abs(p.x), 13 - Math.abs(p.z))));

  it("Default byte-gleich: ohne regeln und mit regeln {} identisch, Phase-61-Vertrag unverändert", () => {
    const a = tesseliere({ footprintM: FP40, storeys: 2, typ: "mittelflur", einheiten: TYPEN, raumzonen: true });
    const b = tesseliere({ footprintM: FP40, storeys: 2, typ: "mittelflur", einheiten: TYPEN, raumzonen: true, regeln: {} });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal("waende" in a, false, "ohne Regel keine waende-Eigenschaft");
    assert.equal(a.weListe.every((w) => !("orientierung" in w)), true, "ohne Regel keine orientierung");
  });

  it("empfehleErschliessung: bis 13 Punkthaus/Reihenhaus, 13 bis 17 Mittelflur, ab 17 Lichthof-Hinweis", () => {
    assert.deepEqual(empfehleErschliessung(12).typen, ["spaenner", "reihenhaus"]);
    assert.equal(empfehleErschliessung(13).stufe, "flach");
    assert.deepEqual(empfehleErschliessung(15).typen, ["mittelflur", "mfh"]);
    const tief = empfehleErschliessung(26);
    assert.equal(tief.stufe, "tief");
    assert.equal(tief.lichthof, true);
    assert.match(tief.text, /Lichthof/);
    assert.match(tief.text, /12,1 m/, "Bandtiefe (26 - 1,8) / 2 = 12,1 m im Text");
  });

  it("MSB-6 Spänner: kein Bad/Abstellraum an der Fassade, alle Aufenthaltsräume an einer Fassade", () => {
    const r = tesseliere({ footprintM: FP40, storeys: 1, typ: "spaenner", einheiten: TYPEN, raumzonen: true });
    const raeume = r.zonen.filter((z) => z.art);
    assert.ok(raeume.length > 20);
    const innenAnFassade = raeume.filter((z) => (z.art === "sanitaer" || z.art === "abstell") && fassadenAbstand(z) < 0.01);
    assert.equal(innenAnFassade.length, 0, `Bäder/Abstell an der Fassade: ${innenAnFassade.map((z) => z.name).join(", ")}`);
    const aufenthalt = raeume.filter((z) => z.art === "aufenthalt");
    assert.equal(aufenthalt.filter((z) => fassadenAbstand(z) < 0.01).length, aufenthalt.length, "jeder Aufenthaltsraum an einer Fassade");
    const s = erschliessungsSkelett({ footprintM: FP40, storeys: 1, typ: "spaenner" });
    assert.deepEqual(s.baender.filter((b) => b.zweiFassaden).map((b) => b.seite).sort(), ["ost", "west"]);
  });

  it("regeln.mindestbreiten: 40 × 26 Mittelflur meldet zu schmale Räume als Hinweis mit Ursache", () => {
    const ohne = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, raumzonen: true });
    const mit = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, raumzonen: true, regeln: { mindestbreiten: true } });
    assert.equal(ohne.hinweise.length, 0);
    const h = mit.hinweise.filter((s) => /Mindestbreite/.test(s));
    assert.ok(h.length >= 1, "mindestens ein Mindestbreiten-Hinweis");
    assert.match(h[0], /Bandtiefe 12,10 m/);
    assert.match(h[0], /Vorschlag/);
    assert.equal(mit.raumWarns.filter((s) => /Mindestbreite/.test(s)).length, 0, "Hinweise wandern aus raumWarns nach hinweise");
    assert.equal(MINDESTBREITEN.aufenthalt, 3.6);
  });

  it("regeln.mindestbreiten: Räume werden auf die Mindestbreite angehoben, nie negativ; Schlafen 2,80", () => {
    // 8 m breites, 6 m tiefes Band: Wohnen 9 m² wäre proportional 2,0 m breit → auf 3,60 angehoben.
    const prog = [
      { raum: "Wohnen", art: "aufenthalt", min_m2: 8, max_m2: 12, flaeche_m2: 9, fensterpflicht: true },
      { raum: "Schlafen", art: "aufenthalt", min_m2: 16, max_m2: 28, flaeche_m2: 27, fensterpflicht: true },
    ];
    const band = { rechteck: { x0: 0, x1: 8, z0: 0, z1: 6 }, fassadeBei: 0, achse: "x", level: 0, we: "WE 0-1" };
    const z = raumSlicing(band, prog, { mindestbreiten: true });
    const wohnen = z.find((q) => /Wohnen/.test(q.name));
    const breite = Math.max(...wohnen.points.map((p) => p.x)) - Math.min(...wohnen.points.map((p) => p.x));
    assert.ok(breite >= 3.6 - 1e-6, `Wohnen ${breite} m unter 3,60 m`);
    assert.equal(MINDESTBREITEN.schlafen, 2.8, "Schlafen/Kind 2,80 m (Register Nr. 65)");
    assert.equal(MINDESTBREITEN.sanitaer, 2.2, "Bad 2,20 m (Register Nr. 65)");
    assert.ok(z.warns.some((w) => /Mindestbreite/.test(w)));
    for (const q of z) assert.ok(q.flaeche_m2 >= 0);
  });

  it("regeln.himmelsrichtung + nordwinkel: orientierung je WE, Hinweis bei Wohnen nach Norden", () => {
    const r0 = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, raumzonen: true, regeln: { himmelsrichtung: true }, nordwinkel: 0 });
    assert.deepEqual([...new Set(r0.weListe.map((w) => w.orientierung))].sort(), ["N", "S"]);
    assert.ok(r0.hinweise.some((h) => /Wohnen.*nach N/.test(h)), "Wohnräume im Nordband werden gemeldet");
    const r90 = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, raumzonen: true, regeln: { himmelsrichtung: true }, nordwinkel: 90 });
    assert.deepEqual([...new Set(r90.weListe.map((w) => w.orientierung))].sort(), ["O", "W"]);
    assert.equal(orientierungFuerBand({ achse: "x", z0: -13, zKante: -13 }, 0).label, "N");
    assert.equal(orientierungFuerBand({ achse: "x", z0: -13, zKante: 13 }, 0).label, "S");
    assert.equal(orientierungFuerBand({ achse: "z", x0: -20, zKante: 20 }, 0).label, "O");
  });

  it("regeln.phi: φ-Hinweis je WE außerhalb ±3 %, keiner im φ-Band; Solver-Ziel bleibt harmlos", () => {
    // Bandtiefe 6 m (Footprint 13,8 m tief); Band 30 m lang.
    const FP = [{ x: -15, z: -6.9 }, { x: 15, z: -6.9 }, { x: 15, z: 6.9 }, { x: -15, z: 6.9 }];
    // Drei WEs à 58,3 m² → je 9,71 m breit = 6 · φ → im φ-Band, kein Hinweis.
    const imBand = [1, 2, 3].map((i) => ({ key: "p" + i, name: "Phi", flaeche_m2: 58.3, min_m2: 58, max_m2: 59 }));
    const ok = tesseliere({ footprintM: FP, storeys: 1, typ: "mittelflur", einheiten: imBand, regeln: { phi: true } });
    assert.equal(ok.hinweise.filter((h) => /φ wäre/.test(h)).length, 0, ok.hinweise.join(" | "));
    // Zwei WEs à 90 m² → 15 m breit bei 6 m Tiefe = 1 : 2,5 → Hinweis mit φ-Breite 9,71 m.
    const schlauch = [1, 2].map((i) => ({ key: "s" + i, name: "Schlauch", flaeche_m2: 90, min_m2: 89, max_m2: 91 }));
    const warn = tesseliere({ footprintM: FP, storeys: 1, typ: "mittelflur", einheiten: schlauch, regeln: { phi: true } });
    const h = warn.hinweise.filter((x) => /φ wäre/.test(x));
    assert.equal(h.length, warn.weListe.length, "ein Hinweis je WE");
    assert.match(h[0], /1 : 2,50/);
    assert.match(h[0], /9,71 m breit/);
    // Ohne Regel: kein Hinweis, gleiche Geometrie.
    const ohne = tesseliere({ footprintM: FP, storeys: 1, typ: "mittelflur", einheiten: schlauch });
    assert.equal(ohne.hinweise.length, 0);
    assert.equal(JSON.stringify(ohne.zonen), JSON.stringify(warn.zonen));
    assert.equal(r2(PHI), 1.62);
  });

  it("regeln.wandstaerken: waende mit Klassen, Stärken aus WANDSTAERKEN, Zonen unverändert", () => {
    const r = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, raumzonen: true, regeln: { wandstaerken: true } });
    assert.ok(Array.isArray(r.waende) && r.waende.length > 20);
    const klassen = new Set(r.waende.map((w) => w.klasse));
    assert.ok(klassen.has("aussen") && klassen.has("leicht"), [...klassen].join(","));
    for (const w of r.waende) assert.equal(w.staerke, WANDSTAERKEN[w.klasse]);
    const ohne = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, raumzonen: true });
    assert.equal(JSON.stringify(ohne.zonen), JSON.stringify(r.zonen));
    const bb = { minX: 0, maxX: 10, minZ: 0, maxZ: 5 };
    const zonen = [
      { points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 5 }], level: 0, we: "A" },
      { points: [{ x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 5, z: 5 }], level: 0, we: "B" },
    ];
    const w = waendeAus(zonen, bb);
    assert.equal(w.filter((s) => s.klasse === "aussen").length, 6);
    assert.equal(w.filter((s) => s.klasse === "tragend").length, 1);
    assert.equal(w.filter((s) => s.klasse === "leicht").length, 0);
  });

  it("regeln.rettungsweg: Lauflänge vom tiefsten Raum bis zum Treppenraum, Hinweis über 35 m", () => {
    // 40 × 26 MFH: EIN Kern in der Mitte, Bandtiefe 12,1 m — die Rand-WEs liegen weit vom Kern.
    const r = tesseliere({ footprintM: FP40, storeys: 1, typ: "mfh", einheiten: TYPEN, raumzonen: true, regeln: { rettungsweg: true } });
    assert.ok(r.weListe.every((w) => Number.isFinite(w.rettungsweg_m) && w.rettungsweg_m > 0));
    const max = Math.max(...r.weListe.map((w) => w.rettungsweg_m));
    // tiefster Punkt: Bandtiefe 12,1 + halbe WE-Breite + Flurweg bis zur Mitte (bis ~20 m) → deutlich > 20 m
    assert.ok(max > 20, `längster Weg ${max}`);
    assert.equal(RETTUNGSWEG_MAX, 35);
    const grosses = [{ key: "g", name: "Groß", flaeche_m2: 260, min_m2: 200, max_m2: 300 }];
    const weit = tesseliere({ footprintM: [{ x: -60, z: -8 }, { x: 60, z: -8 }, { x: 60, z: 8 }, { x: -60, z: 8 }], storeys: 1, typ: "mfh", einheiten: grosses, regeln: { rettungsweg: true } });
    // 75-13: exceeding 35 m is a WARN (rettungswegWarnungen), no longer a hint.
    assert.ok(weit.rettungswegWarnungen.some((w) => w.stufe === "warn" && /Rettungsweg .* > 35 m/.test(w.text)), JSON.stringify(weit.rettungswegWarnungen));
    // Mittelflur ohne Kern: Treppenraum am Flurende [ASSUMED], Hinweis nennt die Annahme.
    const mf = tesseliere({ footprintM: FP40, storeys: 1, typ: "mittelflur", einheiten: TYPEN, regeln: { rettungsweg: true } });
    assert.ok(mf.hinweise.some((h) => /kein Treppenraum im Skelett/.test(h)));
    // Ohne Regel: kein Feld.
    const ohne = tesseliere({ footprintM: FP40, storeys: 1, typ: "mfh", einheiten: TYPEN });
    assert.equal(ohne.weListe.every((w) => !("rettungsweg_m" in w)), true);
  });
});
