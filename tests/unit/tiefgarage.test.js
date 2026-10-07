// Unit-Tests für packages/nova-designer/src/lib/tiefgarage.js (Phase 62-01).
//
// Erwartungswerte sind HANDGERECHNET (Rechenweg je Fall im Kommentar).
// Referenz-Footprint 40 × 16 m, Geschosshöhe 3,0 m, 90°-Aufstellung, Gegenverkehr:
//   D = 16 = 5,00 + 6,00 + 5,00 → genau EIN zweiseitiges Modul, Rest 0.
//   Rampe: 3,0 / 0,15 = 20 m, im Band A (v 0…5) ab u = 0 → Fläche 20 · 5 = 100 m².
//   Seite A: u 20…40 = 20 m; Wandzuschlag 2 · 0,10 = 0,20 → (20 − 0,20) / 2,5 = 7,92 → 7 Plätze.
//   Seite B: u 0…40 = 40 m; 1 barrierefreier (3,50) zuerst: 0,20 + 3,50 = 3,70;
//     (40 − 3,70) / 2,5 = 14,52 → 14 Regelplätze → Seite B 15 Plätze.
//   Summe 22 Stellplätze; Fahrgasse 40 · 6 = 240 m²; Verkehr 240 + 100 = 340 m².
//   Stellplatzfläche 21 · 12,5 + 3,5 · 5 = 262,5 + 17,5 = 280 m². Nutzfläche 40 · 16 = 640 → Mittelgarage.
//   Nachweis: 12 WE · 1,0 = 12 erforderlich, 22 vorhanden → pass; barrierefrei erf. max(1, ⌈12 · 3 %⌉ = 1) = 1.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TG_STPL_B, TG_STPL_L, TG_BF_B, TG_FAHRGASSE, TG_RAMPE_NEIGUNG_MAX,
  tiefgarageLayout, tiefgarageChecks, tiefgarageMengen, tiefgarageOptionen,
  stellplatzNachweis, garagenklasse, rampeLaenge, geigAnforderung,
} from "@designer/lib/tiefgarage";
import { kellerLayout } from "@designer/lib/keller";
import { istWerkstattZone } from "@designer/lib/tesselierung";
import { PLAN_RAUMARTEN } from "@designer/lib/schallschutzPlan";

const FP = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const REF = FP(40, 16);
const r2 = (v) => Math.round(v * 100) / 100;

describe("tiefgarage — Konstanten und Helfer", () => {
  it("Richtwerte stehen (GaStellV/EAR [ASSUMED])", () => {
    assert.equal(TG_STPL_B, 2.5); assert.equal(TG_STPL_L, 5.0); assert.equal(TG_BF_B, 3.5);
    assert.equal(TG_FAHRGASSE.senkrecht, 6.0); assert.equal(TG_RAMPE_NEIGUNG_MAX, 0.15);
  });
  it("rampeLaenge: 3,0 m / 15 % = 20 m; 3,5 m / 10 % = 35 m", () => {
    assert.equal(rampeLaenge(3.0, 0.15), 20);
    assert.equal(rampeLaenge(3.5, 0.10), 35);
  });
  it("garagenklasse nach Nutzfläche", () => {
    assert.equal(garagenklasse(100), "klein");
    assert.equal(garagenklasse(640), "mittel");
    assert.equal(garagenklasse(1000.5), "gross");
  });
  it("geigAnforderung: Wohnen > 5 → jeder Stellplatz; Nichtwohn > 6 → jeder 3. + 1 Ladepunkt", () => {
    assert.deepEqual(geigAnforderung(5, true).pflicht, false);
    const w = geigAnforderung(22, true);
    assert.equal(w.pflicht, true); assert.equal(w.leitungsinfrastruktur_stk, 22); assert.equal(w.ladepunkte_stk, 0);
    const n = geigAnforderung(22, false);
    assert.equal(n.leitungsinfrastruktur_stk, 8); assert.equal(n.ladepunkte_stk, 1); // ⌈22/3⌉ = 8
    assert.equal(geigAnforderung(6, false).pflicht, false);
  });
  it("tiefgarageOptionen härtet Eingaben", () => {
    const o = tiefgarageOptionen({ rampeNeigung: "abc", anordnung: "quer", laenge_m: "", oberirdisch_stk: 2.6 });
    assert.equal(o.rampeNeigung, 0.15); assert.equal(o.anordnung, "senkrecht"); assert.equal(o.laenge_m, null); assert.equal(o.oberirdisch_stk, 3);
  });
  it("Raumart verkehr ist im Schallschutz registriert — kein Rückfall auf wohnen", () => {
    assert.equal(PLAN_RAUMARTEN.verkehr.schutz, false);
    assert.equal(PLAN_RAUMARTEN.verkehr.quelle, false);
  });
});

describe("tiefgarageLayout — Referenz 40 × 16 m (Handrechnung im Kopf)", () => {
  const e = tiefgarageLayout({ footprintM: REF, storeyHeight: 3.0, weAnzahl: 12 });

  it("ein zweiseitiges Modul, keine Resttiefe", () => {
    assert.equal(e.module, 1); assert.equal(e.einseitig, false);
    assert.ok(!e.hinweise.some((h) => /ungenutzt/.test(h)));
  });
  it("Rampe 20 m im Band A, Fläche 100 m²", () => {
    assert.equal(e.rampe.laenge_m, 20);
    const xs = e.rampe.points.map((p) => p.x), zs = e.rampe.points.map((p) => p.z);
    assert.equal(Math.min(...xs), -20); assert.equal(Math.max(...xs), 0);
    assert.equal(Math.min(...zs), -8); assert.equal(Math.max(...zs), -3);
  });
  it("7 Plätze Seite A, 15 Seite B (1 barrierefrei), 22 gesamt", () => {
    const a = e.stellplaetze.filter((s) => s.seite === "A"), b = e.stellplaetze.filter((s) => s.seite === "B");
    assert.equal(a.length, 7); assert.equal(b.length, 15); assert.equal(e.stellplaetze.length, 22);
    assert.equal(b.filter((s) => s.bf).length, 1);
    assert.equal(b[0].bf, true); assert.equal(b[0].breite_m, 3.5);
    // Erster Platz Seite A beginnt hinter der Rampe + Wandzuschlag: u = 20,10 → x = 0,10
    assert.equal(r2(Math.min(...a[0].points.map((p) => p.x))), 0.1);
  });
  it("keine Überlappung zwischen Stellplätzen", () => {
    const boxes = e.stellplaetze.map((s) => ({ x0: Math.min(...s.points.map((p) => p.x)), x1: Math.max(...s.points.map((p) => p.x)),
      z0: Math.min(...s.points.map((p) => p.z)), z1: Math.max(...s.points.map((p) => p.z)) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ov = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
      assert.equal(ov, false, `${e.stellplaetze[i].id} überlappt ${e.stellplaetze[j].id}`);
    }
  });
  it("Mengen: 340 m² Verkehr, 280 m² Stellplätze, 640 m² Nutzfläche, Mittelgarage", () => {
    assert.equal(e.mengen.verkehr_m2, 340);
    assert.equal(e.mengen.stellplatz_m2, 280);
    assert.equal(e.mengen.nutzflaeche_m2, 640);
    assert.equal(e.mengen.stellplaetze_stk, 22); assert.equal(e.mengen.barrierefrei_stk, 1);
    assert.equal(e.mengen.rampe_lfm, 20); assert.equal(e.klasse, "mittel");
  });
  it("Nachweis 22 ≥ 12 → pass, barrierefrei 1/1, GEIG Pflicht (Wohnen, 22 > 5)", () => {
    assert.equal(e.nachweis.erforderlich, 12); assert.equal(e.nachweis.vorhanden, 22); assert.equal(e.nachweis.status, "pass");
    assert.equal(e.nachweis.bfErforderlich, 1); assert.equal(e.nachweis.bfVorhanden, 1);
    assert.equal(e.geig.pflicht, true); assert.equal(e.geig.leitungsinfrastruktur_stk, 22);
  });
  it("Zonen: level −1, ·WT-Marker, raumart verkehr, Fahrgasse + Rampe + 22 Stellplätze", () => {
    assert.equal(e.zonen.length, 24);
    assert.ok(e.zonen.every((z) => z.level === -1 && istWerkstattZone(z) && z.raumart === "verkehr" && z.tg === true));
    assert.equal(e.zonen.filter((z) => z.fahrgasse).length, 1);
    assert.equal(e.zonen.filter((z) => z.rampe).length, 1);
    // Nummerierung läuft Seite A (P-01…P-07) vor Seite B; der barrierefreie Platz ist der erste von B = P-08.
    assert.ok(e.zonen.some((z) => /P-08 ♿/.test(z.name)));
  });
  it("Checks: alles pass außer GEIG offen; Rettungsweg ≤ 30 m", () => {
    const c = tiefgarageChecks(e);
    const by = Object.fromEntries(c.map((x) => [x.key, x.status]));
    assert.equal(by.rampe_neigung, "pass"); assert.equal(by.rampe_lage, "pass"); assert.equal(by.lichte_hoehe, "pass");
    assert.equal(by.fahrgasse, "pass"); assert.equal(by.brandabschnitt, "pass"); assert.equal(by.lueftung, "pass");
    assert.equal(by.rettungsweg, "pass"); assert.equal(by.stuetzen, "pass"); assert.equal(by.nachweis, "pass");
    assert.equal(by.barrierefrei, "pass"); assert.equal(by.geig, "offen");
    // Rettungsweg: weitester Platz ist der barrierefreie P-08 am Kopfende (u 0,10 + 3,50/2 = 1,85; v 13,5),
    // Rampenfuß u 20, v 8 → √(18,15² + 5,5²) = 18,97 m. (Seite-B-Ende u 37,35 → 18,20 m; Seite A ≤ 17,25 m.)
    assert.equal(e.rettungswegMax_m, 18.97);
    assert.ok(c.every((x) => ["pass", "warn", "offen"].includes(x.status)));
  });
  it("deterministisch", () => {
    assert.deepEqual(tiefgarageLayout({ footprintM: REF, storeyHeight: 3.0, weAnzahl: 12 }), e);
  });
});

describe("tiefgarageLayout — Varianten", () => {
  it("Default 20 × 14: D < 16 → einseitig (5 + 6 = 11), 3 m ungenutzt; Rampe 20 m passt genau", () => {
    const e = tiefgarageLayout({ footprintM: null, storeyHeight: 3.0, weAnzahl: 6 });
    assert.equal(e.module, 1); assert.equal(e.einseitig, true);
    assert.ok(e.hinweise.some((h) => /3 m Tiefe bleiben ungenutzt/.test(h)));
    assert.equal(e.rampe.laenge_m, 20); // = Footprint-Länge → passt (≤)
    // einseitig: Seite A entfällt, Seite B: 0,20 + 3,50 (bf) + n·2,5 ≤ 20 → n = 6 → 7 Plätze
    assert.equal(e.stellplaetze.length, 7);
    assert.equal(e.stellplaetze.filter((s) => s.seite === "A").length, 0);
  });
  it("Demo 60 × 26: ein zweiseitiges Modul (16), 10 m ungenutzt, Großgarage nicht — 60·16 = 960 m² Mittel", () => {
    const e = tiefgarageLayout({ footprintM: FP(60, 26), storeyHeight: 3.0, weAnzahl: 24 });
    assert.equal(e.module, 1); assert.equal(e.einseitig, false);
    assert.ok(e.hinweise.some((h) => /10 m Tiefe bleiben ungenutzt/.test(h)));
    assert.equal(e.mengen.nutzflaeche_m2, 960); assert.equal(e.klasse, "mittel");
    // Seite A: (40 − 0,2)/2,5 = 15,92 → 15; Seite B: bf erf = max(1, ⌈24·3 %⌉=1) = 1 → (60 − 3,7)/2,5 = 22,52 → 22 + 1 = 23 → 38
    assert.equal(e.stellplaetze.length, 38);
  });
  it("kurze Garage: Rampe passt nicht → warn, Seite A wird trotzdem belegt, kein Absturz", () => {
    const e = tiefgarageLayout({ footprintM: REF, storeyHeight: 3.0, weAnzahl: 4, optionen: { laenge_m: 15 } });
    assert.equal(e.rampe, null);
    assert.ok(e.hinweise.some((h) => /Rampe braucht 20 m/.test(h)));
    // ohne Rampe steht Band A komplett frei: (15 − 0,20) / 2,5 = 5,92 → 5 Plätze
    assert.equal(e.stellplaetze.filter((s) => s.seite === "A").length, 5);
    assert.equal(Object.fromEntries(tiefgarageChecks(e).map((x) => [x.key, x.status])).rampe_lage, "warn");
  });
  it("Neigung 20 % → Rampe 15 m, Check warn; lichte Höhe 2,6 → pass, 2,3 mit Reserve → 1,9 warn", () => {
    const e = tiefgarageLayout({ footprintM: REF, storeyHeight: 3.0, weAnzahl: 4, optionen: { rampeNeigung: 0.2 } });
    assert.equal(e.rampe.laenge_m, 15);
    assert.equal(Object.fromEntries(tiefgarageChecks(e).map((x) => [x.key, x.status])).rampe_neigung, "warn");
    const flach = tiefgarageLayout({ footprintM: REF, storeyHeight: 2.3, weAnzahl: 4 });
    assert.equal(flach.lichteHoehe_m, 1.9);
    assert.equal(Object.fromEntries(tiefgarageChecks(flach).map((x) => [x.key, x.status])).lichte_hoehe, "warn");
  });
  it("Stütze mitten in einem Stellplatz → konflikt-Flag, Check warn, Platz bleibt", () => {
    // Seite B, erster Regelplatz nach dem bf-Platz: u 3,70…6,20, v 11…16 → x −16,3…−13,8, z 3…8; Stütze bei x −15, z 5
    const e = tiefgarageLayout({ footprintM: REF, storeyHeight: 3.0, weAnzahl: 12, stuetzen: [{ x: -15, z: 5, w: 0.4, d: 0.4 }] });
    assert.equal(e.konflikte, 1);
    assert.equal(e.stellplaetze.length, 22);
    const k = e.stellplaetze.find((s) => s.konflikt);
    assert.equal(k.seite, "B"); assert.equal(k.bf, false);
    assert.equal(Object.fromEntries(tiefgarageChecks(e).map((x) => [x.key, x.status])).stuetzen, "warn");
  });
  it("Längsaufstellung: 2,00 tief, 6,00 lang, Fahrgasse 5,50 bei Gegenverkehr", () => {
    const e = tiefgarageLayout({ footprintM: REF, storeyHeight: 3.0, weAnzahl: 4, optionen: { anordnung: "laengs" } });
    assert.equal(e.fahrgassen[0].breite_m, 5.5);
    assert.ok(e.stellplaetze.every((s) => s.laenge_m === 2 && s.breite_m === 6));
    // Modul 2 + 5,5 + 2 = 9,5 → floor(16 / 9,5) = 1 Modul, 6,5 m ungenutzt
    assert.equal(e.module, 1);
  });
  it("Großgarage: 80 × 32 → 2 Module, 2.560 m² → gross, Lüftung offen, Brandabschnitt warn", () => {
    const e = tiefgarageLayout({ footprintM: FP(80, 32), storeyHeight: 3.0, weAnzahl: 60 });
    assert.equal(e.module, 2); assert.equal(e.klasse, "gross");
    const by = Object.fromEntries(tiefgarageChecks(e).map((x) => [x.key, x.status]));
    assert.equal(by.lueftung, "offen"); assert.equal(by.brandabschnitt, "warn");
    const mit = tiefgarageLayout({ footprintM: FP(80, 32), storeyHeight: 3.0, weAnzahl: 60, optionen: { lueftungMaschinell: true } });
    assert.equal(Object.fromEntries(tiefgarageChecks(mit).map((x) => [x.key, x.status])).lueftung, "pass");
  });
});

describe("stellplatzNachweis + Kopplung Keller (uStart)", () => {
  it("Nachweis rechnet mit oberirdischen Plätzen; 0 WE → offen", () => {
    const n = stellplatzNachweis({ weAnzahl: 10, tg_stk: 6, oberirdisch_stk: 4, bf_stk: 0 });
    assert.equal(n.erforderlich, 10); assert.equal(n.vorhanden, 10); assert.equal(n.status, "pass"); assert.equal(n.differenz, 0);
    assert.equal(stellplatzNachweis({ weAnzahl: 0, tg_stk: 3 }).status, "offen");
    assert.equal(stellplatzNachweis({ weAnzahl: 10, tg_stk: 6 }).status, "warn");
  });
  it("tiefgarageMengen aus leerem Input bricht nicht", () => {
    const m = tiefgarageMengen({});
    assert.equal(m.stellplaetze_stk, 0); assert.equal(m.klasse, "klein");
  });
  it("kellerLayout mit uStart 20 legt Pflichtzeile und Gänge hinter die Garage; uStart 0 = wie bisher", () => {
    const weListe = [1, 2, 3, 4].map((i) => ({ we: `WE ${i}`, level: 0, index: i }));
    const ohne = kellerLayout({ footprintM: REF, weListe });
    const mit = kellerLayout({ footprintM: REF, weListe, uStart: 20 });
    assert.equal(ohne.uStart, 0);
    assert.equal(mit.uStart, 20);
    // REF ist 40 × 16, u = x ab −20: alles der Keller-Zonen liegt bei x ≥ 0
    assert.ok(mit.zonen.every((z) => Math.min(...z.points.map((p) => p.x)) >= 0 - 1e-6), "Keller ragt in die Garage");
    assert.ok(ohne.zonen.some((z) => Math.min(...z.points.map((p) => p.x)) < 0));
    assert.ok(mit.hinweise.some((h) => /Tiefgarage belegt die ersten 20 m/.test(h)));
    // Mit uStart geht weniger Platz → nie mehr Abteile als ohne
    assert.ok(mit.mengen.abteile_stk <= ohne.mengen.abteile_stk);
  });
});
