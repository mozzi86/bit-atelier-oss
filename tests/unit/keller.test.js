// Unit-Tests für packages/nova-designer/src/lib/keller.js (Phase 61-06).
//
// Erwartungswerte sind HANDGERECHNET (Rechenweg je Fall im Kommentar).
// Referenz-Szenario: Footprint 20 × 14 m (Store-Default), 6 WEs, Default-Optionen.
//   Pflichtflächen: Technik 12 + Fahrrad 6 × 1,5 = 9 → 21 m²; Zeilentiefe
//     21 / 14 = 1,5 m < Mindesttiefe 2,0 → pfL = 2,0 m, Zeile = 28 m²
//     (Technik 12/21 · 14 = 8 m quer → 16 m²; Fahrrad 6 m quer → 12 m²).
//   Gang: u 2…20 (18 m) × 1,1 m = 19,8 m², mittig v 6,45…7,55.
//   Abteiltiefe T = (14 − 1,1) / 2 = 6,45 m. Je Seite 3 WEs, Kandidaten
//     min 4/6,45 · ziel 6/6,45 · max 10/6,45 = 1,5504 m; Rest 18 − 3 · 0,93
//     = 15,2 wird gleichmäßig verteilt → alle klemmen am max → 1,5504 m ·
//     6,45 m = 10,0 m² je Abteil. 6 Abteile = 60 m².
//   Zwischenwände: 2 je Seite · 6,45 = 25,8 lfm. Fronten 6 · 1,5504 = 9,30 lfm.
//   Gesamt 28 + 19,8 + 60 = 107,8 m² ≤ 280 m² Footprint.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KELLER_ABTEIL_MIN_M2, KELLER_GANG_B, KELLER_DEFAULT_OPTIONEN,
  kellerLayout, kellerChecks, kellerMengen, kellerOptionen,
  eindeutigeWEs, teiltKante, zonenFlaeche,
} from "@designer/lib/keller";
import { istWerkstattZone, WT_MARKER } from "@designer/lib/tesselierung";

const FOOTPRINT = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
const r2 = (v) => Math.round(v * 100) / 100;

// 6 WEs; "WE 1" ist eine Reihenhaus-WE mit zwei level-Einträgen → EIN Abteil.
const WE_LISTE = [
  { we: "WE 0-1", level: 0, flaeche_m2: 60 },
  { we: "WE 0-2", level: 0, flaeche_m2: 75 },
  { we: "WE 0-3", level: 0, flaeche_m2: 90 },
  { we: "WE 1", level: 0, flaeche_m2: 110 },
  { we: "WE 1", level: 1, flaeche_m2: 110 },
  { we: "WE 1-1", level: 1, flaeche_m2: 60 },
  { we: "WE 1-2", level: 1, flaeche_m2: 75 },
];

const layout = () => kellerLayout({ footprintM: FOOTPRINT, weListe: WE_LISTE, optionen: {} });

describe("keller.js — Richtwerte & Optionen", () => {
  it("Richtwert-Konstanten [ASSUMED] stehen fest", () => {
    assert.equal(KELLER_ABTEIL_MIN_M2, 4);
    assert.equal(KELLER_GANG_B, 1.1);
    assert.equal(KELLER_DEFAULT_OPTIONEN.wasch, false);
  });
  it("kellerOptionen defaultet fehlende Felder und ordnet min ≤ ziel ≤ max", () => {
    const o = kellerOptionen({ abteilMin_m2: 8, abteilZiel_m2: 3, abteilMax_m2: "abc" });
    assert.equal(o.abteilMin_m2, 8);
    assert.equal(o.abteilMax_m2, 10); // Default-max 10 ≥ min 8
    assert.equal(o.abteilZiel_m2, 8); // auf min geklemmt
    assert.equal(o.gang_b, 1.1);
    assert.equal(o.abteilTiefeMax_m, 3);
    assert.equal(o.technik, true);
  });
  it("eindeutigeWEs dedupliziert Reihenhaus-WEs in Reihenfolge des ersten Auftretens", () => {
    assert.deepEqual(eindeutigeWEs(WE_LISTE), ["WE 0-1", "WE 0-2", "WE 0-3", "WE 1", "WE 1-1", "WE 1-2"]);
    assert.deepEqual(eindeutigeWEs(null), []);
  });
});

describe("keller.js — Layout Referenz-Szenario 6 WE auf 20 × 14", () => {
  it("genau ein Abteil je WE, K-01…K-06 fortlaufend, jedes ≥ 4 m²", () => {
    const { zuordnung, zonen } = layout();
    assert.equal(zuordnung.length, 6);
    assert.deepEqual(zuordnung.map((z) => z.abteil), ["K-01", "K-02", "K-03", "K-04", "K-05", "K-06"]);
    assert.deepEqual(zuordnung.map((z) => z.we), ["WE 0-1", "WE 0-2", "WE 0-3", "WE 1", "WE 1-1", "WE 1-2"]);
    zuordnung.forEach((z) => { assert.equal(z.status, "pass"); assert.ok(z.flaeche_m2 >= 4); });
    const abteile = zonen.filter((z) => z.keller === "abteil");
    assert.equal(abteile.length, 6);
  });
  it("Abteilfläche handgerechnet 10,0 m² (max-Klemme: 1,5504 m · 6,45 m)", () => {
    const { zuordnung } = layout();
    zuordnung.forEach((z) => assert.equal(z.flaeche_m2, 10));
  });
  it("Plan-Beschriftung und Liste tragen denselben Bezeichner: „K-01 (WE 0-1) ·WT“", () => {
    const { zuordnung, zonen } = layout();
    for (const z of zuordnung) {
      const zone = zonen.find((x) => x.abteil === z.abteil);
      assert.ok(zone, `Zone für ${z.abteil}`);
      assert.equal(zone.name, `${z.abteil} (${z.we})${WT_MARKER}`);
      assert.equal(zone.we, z.we);
    }
  });
  it("alle Keller-Zonen: level −1, Name endet auf ·WT (istWerkstattZone)", () => {
    const { zonen } = layout();
    assert.ok(zonen.length >= 9); // Technik, Fahrrad, Gang, 6 Abteile
    zonen.forEach((z) => {
      assert.equal(z.level, -1);
      assert.ok(istWerkstattZone(z), z.name);
    });
  });
  it("Pflichtflächen: Technik 16 m² (≥ 10), Fahrrad 12 m² (≈ 1,5 × 6 aufgerundet auf Zeilentiefe 2 m)", () => {
    const { zonen, mengen, hinweise } = layout();
    assert.equal(r2(zonenFlaeche(zonen.find((z) => z.keller === "technik"))), 16);
    assert.equal(r2(zonenFlaeche(zonen.find((z) => z.keller === "fahrrad"))), 12);
    assert.equal(mengen.technik_m2, 16);
    assert.equal(mengen.fahrrad_m2, 12);
    assert.equal(mengen.wasch_m2, 0); // wasch default aus
    assert.ok(hinweise.some((h) => /aufgerundet/.test(h)));
  });
  it("Gang verbindet alle Abteile: jedes Abteil teilt eine Kante mit der Gang-Zone", () => {
    const { zonen } = layout();
    const gang = zonen.find((z) => z.keller === "gang");
    assert.ok(gang);
    assert.equal(gang.raumart, "flur");
    zonen.filter((z) => z.keller === "abteil").forEach((a) => assert.ok(teiltKante(a, gang), a.name));
    // Gegenprobe: Technikraum berührt den Gang nur an der Stirnseite (Kante 1,1 m) — auch das ist eine Kante;
    // ein weit entferntes Rechteck dagegen nicht.
    assert.equal(teiltKante(a0(zonen), { points: [{ x: 50, z: 50 }, { x: 51, z: 50 }, { x: 51, z: 51 }, { x: 50, z: 51 }] }), false);
  });
  it("Flächeninvariante: Σ Zonen = 107,8 m² ≤ 280 m² Footprint, keine Überlappung (Stichproben)", () => {
    const { zonen, mengen } = layout();
    const summe = zonen.reduce((s, z) => s + zonenFlaeche(z), 0);
    assert.equal(r2(summe), 107.8);
    assert.equal(mengen.gesamt_m2, 107.8);
    assert.ok(summe <= 280 + 0.01);
    // Paarweise: zwei Rechtecke überlappen, wenn beide Achsen echt überlappen.
    const bb = (z) => {
      const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
      return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    };
    for (let i = 0; i < zonen.length; i++) {
      for (let j = i + 1; j < zonen.length; j++) {
        const A = bb(zonen[i]), B = bb(zonen[j]);
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        assert.ok(!(ox > 1e-6 && oz > 1e-6), `${zonen[i].name} × ${zonen[j].name}`);
      }
    }
  });
  it("Mengen handgerechnet: 6 Stk · 60 m² · Zwischenwände 25,8 lfm · Fronten 9,3 lfm · Verkehr 19,8 m²", () => {
    const { mengen } = layout();
    assert.equal(mengen.abteile_stk, 6);
    assert.equal(mengen.abteile_m2, 60);
    assert.equal(mengen.trennwaende_lfm, 25.8);
    assert.equal(mengen.abteilfronten_lfm, 9.3);
    assert.equal(mengen.verkehr_m2, 19.8);
  });
  it("Determinismus: doppelter Aufruf → tiefengleiches Ergebnis", () => {
    assert.deepEqual(layout(), layout());
  });
  it("kellerMengen aus Zonen allein (Fallback ohne Layout-Metadaten) liefert dieselben Flächen", () => {
    const { zonen, mengen } = layout();
    const m2 = kellerMengen({ zonen });
    assert.equal(m2.abteile_stk, 6);
    assert.equal(m2.abteile_m2, mengen.abteile_m2);
    assert.equal(m2.verkehr_m2, mengen.verkehr_m2);
    assert.equal(m2.trennwaende_lfm, 0); // Wandlängen kennt nur das Layout
  });
});

describe("keller.js — Überbelegung & Checks", () => {
  // 60 WEs: Fahrrad 90 + Technik 12 = 102 m² → pfL 102/14 = 7,29 m, Rest 12,71 m.
  // Je Seite 30 Kandidaten, Σ min = 30 · 0,62 = 18,6 > 12,71 → alle am min 0,6202 m;
  // es passen floor(12,71 / 0,6202) = 20 je Seite → 40 Abteile, 20 WEs ohne.
  const viele = Array.from({ length: 60 }, (_, i) => ({ we: `WE 0-${i + 1}`, level: 0, flaeche_m2: 50 }));
  const ueber = kellerLayout({ footprintM: FOOTPRINT, weListe: viele, optionen: {} });

  it("zu viele WEs → weniger Abteile als WEs, keines unter Mindestgröße, warn statt fail", () => {
    assert.equal(ueber.mengen.abteile_stk, 40);
    assert.equal(ueber.zuordnung.filter((z) => !z.abteil).length, 20);
    ueber.zonen.filter((z) => z.keller === "abteil").forEach((a) => assert.ok(zonenFlaeche(a) + 1e-6 >= 4, a.name));
    const checks = kellerChecks(ueber);
    const c = checks.find((x) => x.key === "abteil_je_we");
    assert.equal(c.status, "warn");
    assert.match(c.detail, /^20 WE ohne Abteil/);
    checks.forEach((x) => assert.ok(["pass", "warn", "offen"].includes(x.status)));
  });
  it("Referenz-Szenario: alle vier Checks pass", () => {
    const l = layout();
    const checks = kellerChecks(l);
    assert.deepEqual(checks.map((c) => c.key), ["abteil_je_we", "mindestgroesse", "gang_anbindung", "pflichtflaechen"]);
    checks.forEach((c) => assert.equal(c.status, "pass", c.key));
  });
  it("ohne WEs: Checks „offen“, keine Abteile, Pflichtflächen nur Technik (Fahrrad braucht WEs)", () => {
    const l = kellerLayout({ footprintM: FOOTPRINT, weListe: [], optionen: {} });
    assert.equal(l.zuordnung.length, 0);
    assert.equal(l.mengen.abteile_stk, 0);
    assert.equal(l.mengen.fahrrad_m2, 0);
    assert.ok(l.mengen.technik_m2 > 0);
    const checks = kellerChecks(l);
    assert.equal(checks.find((c) => c.key === "abteil_je_we").status, "offen");
  });
  it("Optionen überschreiben Richtwerte: Wasch an, Technik aus, Mindestgröße 6 m²", () => {
    const l = kellerLayout({ footprintM: FOOTPRINT, weListe: WE_LISTE, optionen: { wasch: true, technik: false, abteilMin_m2: 6, abteilZiel_m2: 6, abteilMax_m2: 6 } });
    assert.equal(l.mengen.technik_m2, 0);
    assert.ok(l.mengen.wasch_m2 > 0);
    // min = ziel = max = 6 m² → jedes Abteil exakt 6 m² (Breite 6 / 6,45 = 0,93 m)
    l.zuordnung.forEach((z) => assert.equal(z.flaeche_m2, 6));
    const pf = kellerChecks(l).find((c) => c.key === "pflichtflaechen");
    assert.equal(pf.status, "pass");
    assert.match(pf.detail, /Fahrrad, Wasch/);
  });
  it("Footprint hochkant (14 × 20): Laufrichtung folgt der längeren Seite, Layout bleibt vollständig", () => {
    const hoch = [{ x: -7, z: -10 }, { x: 7, z: -10 }, { x: 7, z: 10 }, { x: -7, z: 10 }];
    const l = kellerLayout({ footprintM: hoch, weListe: WE_LISTE, optionen: {} });
    assert.equal(l.mengen.abteile_stk, 6);
    assert.equal(l.mengen.gesamt_m2, 107.8);
    const gang = l.zonen.find((z) => z.keller === "gang");
    const xs = gang.points.map((p) => p.x), zs = gang.points.map((p) => p.z);
    assert.equal(r2(Math.max(...xs) - Math.min(...xs)), 1.1); // Gang läuft in z
    assert.equal(r2(Math.max(...zs) - Math.min(...zs)), 18);
  });
  // Tiefer Footprint 60 × 26 m, 24 WEs: Reihen = floor(26 / (2 · 3,0 + 1,1)) = 3,
  // Reihentiefe 26 / 3 = 8,667 m, Abteiltiefe T = (8,667 − 1,1) / 2 = 3,783 m.
  // Pflicht: Technik 12 + Fahrrad 36 = 48 m² → 48 / 26 = 1,85 < 2,0 → pfL 2,0 m.
  // 6 Bänder à 4 WEs, Rest 58 m → alle am max: Breite 10 / 3,783 = 2,643 m → 10,0 m².
  // Ohne Deckel wäre T = 12,45 m und ein Abteil nur 0,80 m breit.
  it("tiefer Footprint 60 × 26: drei Gang-Reihen, Abteiltiefe 3,78 m statt 12,45 m Schlitze", () => {
    const tief = [{ x: -30, z: -13 }, { x: 30, z: -13 }, { x: 30, z: 13 }, { x: -30, z: 13 }];
    const viele24 = Array.from({ length: 24 }, (_, i) => ({ we: `WE 0-${i + 1}`, level: 0, flaeche_m2: 50 }));
    const l = kellerLayout({ footprintM: tief, weListe: viele24, optionen: {} });
    assert.equal(l.reihen, 3);
    const gaenge = l.zonen.filter((z) => z.keller === "gang");
    assert.equal(gaenge.length, 3);
    assert.deepEqual(gaenge.map((g) => g.name), ["Kellergang 1 ·WT", "Kellergang 2 ·WT", "Kellergang 3 ·WT"]);
    assert.equal(l.mengen.abteile_stk, 24);
    const abteile = l.zonen.filter((z) => z.keller === "abteil");
    abteile.forEach((a) => {
      const b = { xs: a.points.map((p) => p.x), zs: a.points.map((p) => p.z) };
      assert.equal(r2(Math.max(...b.zs) - Math.min(...b.zs)), 3.78); // Tiefe
      assert.equal(r2(Math.max(...b.xs) - Math.min(...b.xs)), 2.64); // Breite
      assert.ok(gaenge.some((g) => teiltKante(a, g)), a.name);
    });
    assert.equal(l.mengen.verkehr_m2, r2(3 * 58 * 1.1)); // 191,4
    assert.equal(kellerChecks(l).find((c) => c.key === "gang_anbindung").status, "pass");
    // Referenz-Szenario bleibt einreihig (14 m Tiefe < 2 · 7,1).
    assert.equal(layout().reihen, 1);
  });
  it("NaN-Härtung: kaputter Footprint → Default-BBox, kaputte weListe → leer", () => {
    const l = kellerLayout({ footprintM: [{ x: "a" }], weListe: [{ we: 7 }, null], optionen: null });
    assert.equal(l.zuordnung.length, 0);
    assert.ok(l.zonen.every((z) => z.level === -1));
  });
});

function a0(zonen) { return zonen.find((z) => z.keller === "technik"); }
