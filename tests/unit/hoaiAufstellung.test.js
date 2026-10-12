// Phase 81 (81-03): fee breakdown on 79's ONE fee engine — oracles of 79
// re-checked, Fixtures A/D/E of 81-RESEARCH, open spaces and structural planning
// (six stages), special services, points → fee zone, outside the table.
//
// Rounding: 79's honorarVertrag rounds every stage commercially (half up).
// 81-RESEARCH computed Fixture A with two half cents rounded down (20.553,795 and
// 34.256,325); the engine gives grund 134.284,81 and net 140.999,05 — the
// expectations below follow the engine (81-01-SUMMARY § 5).
//
// In:  src/lib/honorar/aufstellung.js, @core/lib/hoai/*. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aufstellung, honorarzoneAusPunkten } from "@/lib/honorar/aufstellung.js";
import { honorarAusTafel, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";

/** Stages of a profile, the first n commissioned. */
const lph = (lb, n) => lphFuerLeistungsbild(lb).map((l, i) => ({ ...l, beauftragt: i < n }));
const A = { leistungsbild: "gebaeude", kg300_euro: 900000, kg400_euro: 400000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph("gebaeude", 8), nebenkosten_prozent: 5, ust_satz: 19 };

test("79-Orakel erneut: honorarAusTafel", () => {
  assert.equal(honorarAusTafel(25000, "I", 0).honorar, 3120);
  assert.equal(honorarAusTafel(1000000, "III", 0).honorar, 115675);
  assert.equal(honorarAusTafel(1000000, "III", 100).honorar, 144268);
  assert.equal(honorarAusTafel(1200000, "III", 0).honorar, 135769.4);
  assert.equal(honorarAusTafel(2680716, "III", 0).honorar, 276770.63);
});

test("Fixture A (Gebäude, 1.212.500 €, Zone III, LPH 1–8): LPH-Beträge, Summen, jede Zeile mit Quelle", () => {
  const a = aufstellung(A);
  // anrechenbar: 900.000 + min(400.000, 25 % × 900.000 = 225.000) + (400.000 − 225.000) / 2 = 1.212.500 (§ 33 Abs. 2)
  assert.equal(a.tafel?.bezugswert, 1212500);
  assert.equal(a.tafel?.basis, 137025.3);
  assert.deepEqual(a.zeilen.filter((z) => z.art === "lph").map((z) => z.betrag_eur), [2740.51, 9591.77, 20553.8, 4110.76, 34256.33, 13702.53, 5481.01, 43848.1]);
  assert.deepEqual(a.summen, { grund: 134284.81, umbau: 0, besondere: 0, nebenkosten: 6714.24, netto: 140999.05, ust: 26789.82, brutto: 167788.87, quelle: "tafel" });
  for (const z of a.zeilen.filter((x) => !["netto", "brutto"].includes(x.art))) assert.ok(z.quelle, `${z.art} ohne Quelle`);
  const quellen = a.zeilen.map((z) => z.quelle).join(" ");
  for (const q of ["§ 33", "§ 35", "§ 34", "§ 14"]) assert.ok(quellen.includes(q), q);
  assert.equal(a.zeilen.find((z) => z.art === "lph")?.text, "LPH 1 Grundlagenermittlung (2 %)");
});

test("Umbau ohne Textform 20 % (§ 6 Abs. 2), Satzposition 25 %, Besondere Leistung pauschal", () => {
  const umbau = aufstellung({ ...A, umbauzuschlag_prozent: 20 });
  assert.equal(umbau.summen.umbau, 26856.96);
  assert.equal(umbau.summen.nebenkosten, 8057.09);
  assert.equal(umbau.summen.netto, 169198.86);
  assert.equal(umbau.summen.brutto, 201346.64);
  assert.ok(umbau.zeilen.some((z) => z.art === "umbau" && z.quelle === "§ 6 Abs. 2 HOAI"));
  const s25 = aufstellung({ ...A, satz_position_prozent: 25 });
  assert.deepEqual(s25.tafel, { bezugswert: 1212500, basis: 137025.3, oben: 170896.38, gewaehlt: 145493.07 });
  const bes = aufstellung({ ...A, besondere_leistungen: [{ titel: "Bestandsaufnahme", art: "pauschal", betrag_euro: 5000 }] });
  // NK on grund + besondere: (134.284,81 + 5.000) × 5 % = 6.964,24
  assert.equal(bes.summen.besondere, 5000);
  assert.equal(bes.summen.nebenkosten, 6964.24);
  assert.equal(bes.summen.netto, 146249.05);
  const std = aufstellung({ ...A, besondere_leistungen: [{ titel: "Varianten", art: "stunden", stunden: 10, satz_eur_h: 105 }] });
  assert.equal(std.summen.besondere, 1050);
});

test("Fixture D (Innenräume, 480.000 €): LPH 5 = 18.182,43, netto 62.365,74", () => {
  const a = aufstellung({ leistungsbild: "innenraeume", kg300_euro: 480000, kg400_euro: 0, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph("innenraeume", 8), nebenkosten_prozent: 5, ust_satz: 19 });
  assert.equal(a.tafel?.basis, 60608.1);
  assert.equal(a.zeilen.filter((z) => z.art === "lph")[4].betrag_eur, 18182.43);
  assert.equal(a.summen.grund, 59395.94);
  assert.equal(a.summen.netto, 62365.74);
  assert.equal(a.summen.brutto, 74215.23);
});

test("Fixture E „Tafel fehlt“ (per Injektion): kein Betrag, Hinweiszeile; mit Pauschale rechnet sie", () => {
  const tw = WEITERE_TAFELN.find((t) => t.leistungsbild === "tragwerksplanung");
  const optionen = { weitere: [{ ...tw, annahme: true }] };
  const e = { leistungsbild: "tragwerksplanung", bezugswert: 1000000, honorarzone: "III", satz_position_prozent: 0, lph: lph("tragwerksplanung", 6), nebenkosten_prozent: 5, ust_satz: 19 };
  const a = aufstellung(e, optionen);
  assert.equal(a.tafelFehlt, true);
  assert.equal(a.summen.netto, null);
  assert.equal(a.summen.quelle, "tafel_fehlt");
  assert.equal(a.zeilen[0].text, "Tafel fehlt — HOAI § 52 noch nicht amtlich übertragen");
  assert.equal(a.zeilen[0].schluessel, "Tafel fehlt — HOAI § {nr} noch nicht amtlich übertragen", "79-Schlüssel mit {nr}");
  const p = aufstellung({ ...e, pauschal_euro: 12000 }, optionen);
  assert.equal(p.summen.quelle, "pauschal");
  assert.equal(p.summen.netto, 12600);
  assert.deepEqual(p.lph, [], "79: Pauschale ohne LPH-Aufteilung");
  assert.ok(p.zeilen.some((z) => z.art === "pauschal"));
});

test("Freianlagen (Kostenregel manuell) und Tragwerksplanung (sechs LPH)", () => {
  const f = aufstellung({ leistungsbild: "freianlagen", bezugswert: 180000, honorarzone: "III", satz_position_prozent: 0, lph: lph("freianlagen", 9), nebenkosten_prozent: 5, ust_satz: 19 });
  assert.equal(f.tafel?.basis, 33774);
  assert.deepEqual(f.lph.map((l) => l.prozent), [3, 10, 16, 4, 25, 7, 3, 30, 2]);
  assert.equal(f.zeilen.find((z) => z.art === "kosten")?.quelle, "§ 40 HOAI");
  const t = aufstellung({ leistungsbild: "tragwerksplanung", bezugswert: 425000, honorarzone: "III", satz_position_prozent: 0, lph: lph("tragwerksplanung", 6), nebenkosten_prozent: 5, ust_satz: 19 });
  assert.equal(t.summen.grund, 39204.51, "79-Orakel (H-2)");
  assert.equal(t.zeilen.filter((z) => z.art === "lph").length, 6);
});

test("außerhalb der Tafel: frei vereinbar, keine Beträge", () => {
  for (const kg300 of [24999, 25000001]) {
    const a = aufstellung({ ...A, kg300_euro: kg300, kg400_euro: 0 });
    assert.equal(a.ausserhalb, true, String(kg300));
    assert.equal(a.summen.netto, null);
    assert.equal(a.zeilen[0].text, "frei vereinbar (§ 7 Abs. 2 HOAI)");
  }
});

test("honorarzoneAusPunkten (§ 35 Abs. 6)", () => {
  const erwartet = [[10, "I"], [11, "II"], [18, "II"], [19, "III"], [26, "III"], [27, "IV"], [34, "IV"], [35, "V"], [42, "V"], [43, null], [-1, null]];
  for (const [p, z] of erwartet) assert.equal(honorarzoneAusPunkten(p), z, String(p));
});
