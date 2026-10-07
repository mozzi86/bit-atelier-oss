// Unit-Tests für packages/nova-designer/src/lib/tragwerkPlan.js (Phase 40, TRAG-02…05).
// Kulisse: Default-Footprint 20 × 14 m = 280 m², zwei Stützen symmetrisch bei x = ±5 → je 140 m²;
// q = gk 5,0 + Δg 1,5 + qk 2,0 = 8,5 kN/m², C25/30 → fcd = 25/1,5 · 1000 = 16.666,7 kN/m².
// Handrechnung Stütze EG bei 4 Geschossen: N = 8,5 · 140 · 4 = 4.760 kN;
// A_c = 4.760 / (0,5 · 16.666,7) = 0,5712 m² = 5.712 cm²; vorh 0,4² = 1.600 cm² → Auslastung 3,57.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { betonFcd } from "@designer/lib/statics";
import {
  STATIK_LAYER_DEFAULT, TRAEGER_BREITE_M, TRAEGER_EINZUG_M, TRAEGER_SCHLANKHEIT, STUETZEN_FANG_M,
  layerHardened, fangeStuetze, neuerTraeger, verschiebeTraegerPunkt, aendereTraeger, loescheTraeger,
  lasteinzug, stuetzenBerechnung, traegerVordim, traegerBerechnung, tragwerkChecks, eingabenHash, berechnung,
} from "@designer/lib/tragwerkPlan";

const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const FOOT = rect(-10, -7, 10, 7); // 280 m²
const STUETZEN = [
  { x: -5, z: 0, level: 0, size: 0.4, _idx: 1 },
  { x: 5, z: 0, level: 0, size: 0.4, _idx: 2 },
  { x: 0, z: 0, level: 3, size: 0.4, _idx: 3 },
];
const Q = 8.5, FCD = betonFcd("C25/30");
const erlaubt = (items) => items.every((i) => ["pass", "warn", "offen"].includes(i.status));

describe("tragwerkPlan — Lasteinzug", () => {
  it("zwei symmetrische Stützen teilen 280 m² je zur Hälfte (±1 Zelle), Zellen liegen im Footprint", () => {
    const { flaechen, zellen, footArea } = lasteinzug(FOOT, STUETZEN.filter((s) => s.level === 0));
    assert.equal(footArea, 280);
    assert.equal(flaechen.length, 2);
    const summe = flaechen.reduce((s, f) => s + f.flaeche_m2, 0);
    assert.ok(Math.abs(summe - 280) < 1e-6, `Summe ${summe}`);
    assert.ok(Math.abs(flaechen[0].flaeche_m2 - 140) <= 0.25 && Math.abs(flaechen[1].flaeche_m2 - 140) <= 0.25, JSON.stringify(flaechen));
    assert.ok(zellen.length > 0 && zellen.every((z) => z.x > -10 && z.x < 10 && z.z > -7 && z.z < 7));
    assert.ok(zellen.every((z) => (z.x < 0 ? z.idx === 1 : z.idx === 2)), "linke Hälfte → Stütze 1, rechte → Stütze 2");
  });

  it("eine Stütze bekommt alles; keine Stützen / kein Footprint → leer", () => {
    const eine = lasteinzug(FOOT, [STUETZEN[0]]);
    assert.equal(eine.flaechen.length, 1);
    assert.ok(Math.abs(eine.flaechen[0].flaeche_m2 - 280) < 1e-6);
    assert.deepEqual(lasteinzug(FOOT, []).flaechen, []);
    assert.deepEqual(lasteinzug([{ x: 0, z: 0 }], STUETZEN).flaechen, []);
    assert.deepEqual(lasteinzug(null, STUETZEN).flaechen, []);
  });

  it("L-Footprint: keine Zelle im Ausschnitt", () => {
    const L = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 6 }, { x: 8, z: 6 }, { x: 8, z: 14 }, { x: 0, z: 14 }];
    const { zellen } = lasteinzug(L, [{ x: 4, z: 4, size: 0.4, _idx: 9 }]);
    assert.ok(zellen.length > 0 && zellen.every((z) => !(z.x > 8 && z.z > 6)));
  });
});

describe("tragwerkPlan — Stützen und Träger", () => {
  it("Stütze EG bei 4 Geschossen: N = 4.760 kN, A_c = 5.712 cm², Auslastung 3,57 → warn", () => {
    const r = stuetzenBerechnung({ footprint: FOOT, stuetzen: STUETZEN, level: 0, storeys: 4, qFlaeche: Q, fcd: FCD });
    assert.equal(r.length, 2, "nur die Stützen des Geschosses");
    const s1 = r.find((s) => s.idx === 1);
    assert.equal(s1.geschosse, 4);
    assert.ok(Math.abs(s1.N_kN - 4760) <= 8.5, `N ${s1.N_kN}`);           // ±1 Zelle · q · 4
    assert.ok(Math.abs(s1.Ac_erf_cm2 - 5712) <= 12, `A_c ${s1.Ac_erf_cm2}`);
    assert.equal(s1.Ac_vorh_cm2, 1600);
    assert.ok(Math.abs(s1.auslastung - 3.57) < 0.02);
    assert.equal(s1.status, "warn");
  });

  it("Stütze im 3. OG trägt ein Geschoss; ohne fcd bleibt A_c offen; Auslastung ≤ 1 → pass", () => {
    const og = stuetzenBerechnung({ footprint: FOOT, stuetzen: STUETZEN, level: 3, storeys: 4, qFlaeche: Q, fcd: FCD });
    assert.equal(og.length, 1);
    assert.equal(og[0].geschosse, 1);
    assert.ok(Math.abs(og[0].N_kN - 8.5 * 280) < 1e-6);
    const offen = stuetzenBerechnung({ footprint: FOOT, stuetzen: STUETZEN, level: 0, storeys: 4, qFlaeche: Q, fcd: 0 });
    assert.equal(offen[0].Ac_erf_cm2, null);
    assert.equal(offen[0].status, "offen");
    const dick = stuetzenBerechnung({ footprint: FOOT, stuetzen: [{ x: 0, z: 0, level: 0, size: 1.0, _idx: 7 }], level: 0, storeys: 1, qFlaeche: Q, fcd: FCD });
    assert.equal(dick[0].status, "pass", `Auslastung ${dick[0].auslastung}`); // 2.380 kN → 2.856 cm² < 10.000
  });

  it("traegerVordim: L = 6 m, q = 42,5 kN/m → M = 191,25 kNm, V = 127,5 kN, h = 0,50 m", () => {
    assert.deepEqual(traegerVordim({ L: 6, qLin: 42.5 }), { h_m: 0.5, M_kNm: 191.25, V_kN: 127.5 });
    assert.deepEqual(traegerVordim({ L: 7.3, qLin: 10 }), { h_m: 0.65, M_kNm: 66.61, V_kN: 36.5 }); // 7,3/12 = 0,608 → 0,65
    assert.deepEqual(traegerVordim({}), { h_m: 0, M_kNm: 0, V_kN: 0 });
    assert.equal(TRAEGER_SCHLANKHEIT, 12);
  });

  it("traegerBerechnung nutzt Einzugsbreite (q_lin = q · b) und meldet angeschlossen", () => {
    const { layer } = neuerTraeger(STATIK_LAYER_DEFAULT, { level: 0, a: { x: -5.2, z: 0.1 }, b: { x: 4.9, z: -0.2 }, stuetzen: STUETZEN });
    const r = traegerBerechnung(layer.traeger, { qFlaeche: Q });
    assert.equal(r.length, 1);
    assert.equal(r[0].L_m, 10, "Endpunkte auf die Stützen gefangen");
    assert.equal(r[0].qLin_kNm, 42.5);
    assert.equal(r[0].h_m, 0.85);
    assert.equal(r[0].angeschlossen, true);
  });
});

describe("tragwerkPlan — Layer und Editor", () => {
  it("layerHardened: Defaults, kurze/kaputte Träger weg, Breite/Einzug default, ergebnis durchgereicht", () => {
    assert.deepEqual(layerHardened(null), STATIK_LAYER_DEFAULT);
    const h = layerHardened({ traeger: [
      { id: "tr_1", level: 0, a: { x: 0, z: 0 }, b: { x: 6, z: 0 } },
      { id: "tr_2", level: 0, a: { x: 0, z: 0 }, b: { x: 0.2, z: 0 } },     // zu kurz
      { level: 1, a: { x: "x", z: 0 }, b: { x: 3, z: 0 } },                 // Punkt kaputt
    ], ergebnis: { stand: "x" } });
    assert.equal(h.traeger.length, 1);
    assert.equal(h.traeger[0].breite_m, TRAEGER_BREITE_M);
    assert.equal(h.traeger[0].einzugsbreite_m, TRAEGER_EINZUG_M);
    assert.equal(h.traeger[0].vonIdx, null);
    assert.deepEqual(h.ergebnis, { stand: "x" });
  });

  it("fangeStuetze / neuerTraeger fangen auf Stützen des Geschosses; zu kurz → null", () => {
    assert.equal(fangeStuetze(STUETZEN, 0, { x: -4.7, z: 0.3 }).idx, undefined);
    assert.equal(fangeStuetze(STUETZEN, 0, { x: -4.7, z: 0.3 })._idx, 1);
    assert.equal(fangeStuetze(STUETZEN, 0, { x: 0, z: 0 }), null, "Stütze 3 liegt im 3. OG");
    assert.equal(fangeStuetze(STUETZEN, 3, { x: 0.1, z: 0 })._idx, 3);
    assert.equal(STUETZEN_FANG_M, 0.6);
    const r = neuerTraeger(STATIK_LAYER_DEFAULT, { level: 0, a: { x: -5, z: 0 }, b: { x: 2, z: 3 }, stuetzen: STUETZEN });
    assert.equal(r.traeger.id, "tr_1");
    assert.equal(r.traeger.vonIdx, 1);
    assert.equal(r.traeger.nachIdx, null, "freies Ende");
    assert.equal(neuerTraeger(r.layer, { level: 0, a: { x: 0, z: 0 }, b: { x: 0.1, z: 0 } }).traeger, null);
    assert.equal(neuerTraeger(r.layer, { level: 0, a: { x: 0, z: 0 }, b: { x: 3, z: 0 } }).traeger.id, "tr_2");
  });

  it("verschiebeTraegerPunkt fängt neu und lehnt zu kurze Ergebnisse ab; aendere/loesche", () => {
    const { layer } = neuerTraeger(STATIK_LAYER_DEFAULT, { level: 0, a: { x: -5, z: 0 }, b: { x: 0, z: 3 }, stuetzen: STUETZEN });
    const v = verschiebeTraegerPunkt(layer, "tr_1", "b", { x: 4.8, z: 0.2 }, STUETZEN);
    assert.deepEqual(v.traeger[0].b, { x: 5, z: 0 });
    assert.equal(v.traeger[0].nachIdx, 2);
    const kurz = verschiebeTraegerPunkt(layer, "tr_1", "b", { x: -4.8, z: 0.1 }, STUETZEN);
    assert.deepEqual(kurz.traeger[0].b, { x: 0, z: 3 }, "unverändert, wäre 0 m lang");
    assert.equal(aendereTraeger(layer, "tr_1", { einzugsbreite_m: 3 }).traeger[0].einzugsbreite_m, 3);
    assert.equal(loescheTraeger(layer, "tr_1").traeger.length, 0);
  });
});

describe("tragwerkPlan — Checks und Berechnungslauf", () => {
  it("Checks: leer → offen; Beispiel (Auslastung 3,57) → warn; Wandbau → offen; nie fail", () => {
    const leer = tragwerkChecks({});
    assert.ok(erlaubt(leer) && leer.every((i) => i.status === "offen"));
    const st = stuetzenBerechnung({ footprint: FOOT, stuetzen: STUETZEN, level: 0, storeys: 4, qFlaeche: Q, fcd: FCD });
    const c = Object.fromEntries(tragwerkChecks({ stuetzen: st, traeger: [], tragsystem: "Skelettbau (Stützen/Riegel)", spannweite: 14 }).map((i) => [i.key, i.status]));
    assert.deepEqual(c, { stuetzen: "pass", auslastung: "warn", raster: "pass", traeger: "offen" }); // 140 ≤ 1,5·196 = 294
    const eng = Object.fromEntries(tragwerkChecks({ stuetzen: st, spannweite: 8 }).map((i) => [i.key, i.status]));
    assert.equal(eng.raster, "warn", "140 m² > 1,5 · 64 = 96 m²");
    const wand = Object.fromEntries(tragwerkChecks({ stuetzen: st, tragsystem: "Wandbau (Schottenbau)", spannweite: 14 }).map((i) => [i.key, i.status]));
    assert.equal(wand.auslastung, "offen");
    assert.ok(!JSON.stringify(tragwerkChecks({ stuetzen: st, traeger: [{ angeschlossen: false }] })).includes('"fail"'));
  });

  it("berechnung liefert Stand, Hash, Tabelle, Checks, Summe; Hash ändert sich mit Eingaben", () => {
    const { layer } = neuerTraeger(STATIK_LAYER_DEFAULT, { level: 0, a: { x: -5, z: 0 }, b: { x: 5, z: 0 }, stuetzen: STUETZEN });
    const e = berechnung({ layer, footprint: FOOT, stuetzen: STUETZEN, level: 0, storeys: 4, qFlaeche: Q, fcd: FCD, tragsystem: "Skelettbau (Stützen/Riegel)", spannweite: 14, stand: "2026-09-06T00:00:00.000Z" });
    assert.equal(e.stand, "2026-09-06T00:00:00.000Z");
    assert.equal(e.level, 0);
    assert.equal(e.stuetzen.length, 2);
    assert.equal(e.traeger.length, 1);
    assert.ok(Math.abs(e.summeN_kN - 9520) <= 17, `Summe ${e.summeN_kN}`); // 2 · 4.760
    assert.equal(e.checks.length, 4);
    const h1 = eingabenHash({ footprint: FOOT, stuetzen: STUETZEN, traeger: layer.traeger, level: 0, storeys: 4, qFlaeche: Q, fcd: FCD, tragsystem: "Skelettbau (Stützen/Riegel)", spannweite: 14 });
    assert.equal(e.hash, h1, "Hash reproduzierbar");
    const h2 = eingabenHash({ footprint: FOOT, stuetzen: STUETZEN, traeger: layer.traeger, level: 0, storeys: 4, qFlaeche: 9.0, fcd: FCD, tragsystem: "Skelettbau (Stützen/Riegel)", spannweite: 14 });
    assert.notEqual(h1, h2, "andere Last → anderer Hash (Ergebnis veraltet)");
  });
});
