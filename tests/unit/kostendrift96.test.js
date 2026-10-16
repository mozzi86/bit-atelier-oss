// Plan 96-03: anrechenbare Kosten deliberately frozen from the LV, drift
// warning over 1 %, and the fee amendment drafted from a drift (§ 10 HOAI).
// Covers: no snapshot → null, exactly 1 % not over / just above over, per-KG
// values, zero frozen total, the freeze helper writing integer cents, the
// amendment draft (fee difference, reference for the next drift), and the
// snapshot travelling offer → contract.
//
// In:  @core/lib/hoai/kostenDrift.js, src/lib/honorar/honorarNachtrag.js,
//      src/lib/honorar/angebot.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KOSTEN_DRIFT_SCHWELLE_PROZENT, KOSTEN_SNAPSHOT_LEER, kostenDrift, kostenEinfrieren } from "@core/lib/hoai/kostenDrift.js";
import { honorarVertrag, kostenAusLv, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { driftBezug, nachtragAusKostenDrift } from "@/lib/honorar/honorarNachtrag.js";
import { neuesAngebot, VERTRAGSFELDER } from "@/lib/honorar/angebot.js";

/** One LV position per cost group with quantity 1 → the unit price is the amount in Euro. */
const lv = (kg300Euro, kg400Euro = 0) => [
  { din276: "331", quantity: 1, unit_price: kg300Euro },
  { din276: "411", quantity: 1, unit_price: kg400Euro },
];
const snap = (kg300_cent, kg400_cent = 0, sonstige_cent = 0) => ({
  kosten_eingefroren_am: "2026-10-01", kosten_eingefroren: { kg300_cent, kg400_cent, sonstige_cent },
});

test("96-03: kein Snapshot → null (Altbestand verhält sich wie vorher)", () => {
  assert.equal(kostenDrift({ kg300_euro: 1000, anrechenbare_quelle: "lv" }, lv(5000)), null);
  assert.equal(kostenDrift({ ...KOSTEN_SNAPSHOT_LEER }, lv(5000)), null);
  assert.equal(kostenDrift(null, lv(5000)), null);
});

test("96-03: Schwelle 1 % — genau 1 % ist nicht drüber, knapp darüber schon", () => {
  assert.equal(KOSTEN_DRIFT_SCHWELLE_PROZENT, 1);
  const genau = kostenDrift(snap(100_000_00), lv(101_000));
  assert.equal(genau.abweichungProzent, 1);
  assert.equal(genau.ueberSchwelle, false);
  const knapp = kostenDrift(snap(100_000_00), lv(101_000.01));
  assert.equal(knapp.ueberSchwelle, true);
  const runter = kostenDrift(snap(100_000_00), lv(98_999.99));
  assert.equal(runter.ueberSchwelle, true);
  assert.ok(runter.abweichungProzent < 0);
  assert.equal(kostenDrift(snap(100_000_00), lv(99_000)).ueberSchwelle, false);
});

test("96-03: Werte je KG in Cent, Sonstige driften nicht", () => {
  const d = kostenDrift(snap(800_000_00, 200_000_00, 50_000_00), lv(820_000, 190_000.5));
  assert.deepEqual(d.jeKg.kg300, { eingefrorenCent: 800_000_00, aktuellCent: 820_000_00, differenzCent: 20_000_00 });
  assert.deepEqual(d.jeKg.kg400, { eingefrorenCent: 200_000_00, aktuellCent: 190_000_50, differenzCent: -9_999_50 });
  assert.deepEqual(d.jeKg.sonstige, { eingefrorenCent: 50_000_00, aktuellCent: 50_000_00, differenzCent: 0 });
  assert.equal(d.eingefrorenCent, 1_050_000_00);
  assert.equal(d.aktuellCent, 1_060_000_50);
  assert.equal(d.differenzCent, 10_000_50);
  assert.equal(d.abweichungProzent, 0.95);
  assert.equal(d.ueberSchwelle, false);
  assert.equal(d.eingefrorenAm, "2026-10-01");
  // Same computation as the take-over: kostenAusLv is the single source.
  const ausLv = kostenAusLv(lv(820_000, 190_000.5));
  assert.equal(d.jeKg.kg300.aktuellCent, Math.round(ausLv.kg300_euro * 100));
});

test("96-03: eingefrorene Summe 0 € teilt nicht durch null", () => {
  const leer = kostenDrift(snap(0), []);
  assert.equal(leer.abweichungProzent, 0);
  assert.equal(leer.ueberSchwelle, false);
  const neu = kostenDrift(snap(0), lv(1000));
  assert.equal(neu.abweichungProzent, null);
  assert.equal(neu.ueberSchwelle, true);
  assert.equal(neu.differenzCent, 1000_00);
});

test("96-03: kostenEinfrieren schreibt Cent-Snapshot und Datum, Euro-Felder behalten ihre Bedeutung", () => {
  const p = kostenEinfrieren({ kg300_euro: 1234.565, kg400_euro: 0.1 + 0.2, sonstige_euro: 0 }, "2026-10-16");
  assert.deepEqual(p.kosten_eingefroren, { kg300_cent: 123457, kg400_cent: 30, sonstige_cent: 0 });
  for (const c of Object.values(p.kosten_eingefroren)) assert.ok(Number.isInteger(c));
  assert.equal(p.kosten_eingefroren_am, "2026-10-16");
  assert.equal(p.anrechenbare_quelle, "lv");
  assert.equal(p.kg300_euro, 1234.57);
  assert.equal(p.kg400_euro, 0.3);
  // Freeze, then nothing changed in the LV → no drift.
  const vertrag = kostenEinfrieren(kostenAusLv(lv(500_000, 80_000)), "2026-10-16");
  const d = kostenDrift(vertrag, lv(500_000, 80_000));
  assert.equal(d.differenzCent, 0);
  assert.equal(d.ueberSchwelle, false);
});

const VERTRAG = {
  id: "hv-1", project_id: "p-1", leistungsbild: "gebaeude", honorarzone: "III", satz_position_prozent: 0,
  lph: lphFuerLeistungsbild("gebaeude"), nebenkosten_prozent: 5, ust_satz: 19, status: "beauftragt",
  ...kostenEinfrieren({ kg300_euro: 1_000_000, kg400_euro: 200_000, sonstige_euro: 0 }, "2026-10-01"),
};

test("96-03: Honorarnachtrag aus der Drift — Honorardifferenz ohne Nebenkosten, § 10 HOAI, Vertrag unverändert", () => {
  const vorher = structuredClone(VERTRAG);
  const drift = kostenDrift(driftBezug(VERTRAG, []), lv(1_100_000, 200_000));
  assert.equal(drift.ueberSchwelle, true);
  const n = nachtragAusKostenDrift(VERTRAG, drift, [{ honorarvertrag_id: "hv-1", nr: 2 }], { heuteIso: "2026-10-16", titel: "T" });
  const alt = honorarVertrag(VERTRAG);
  const neu = honorarVertrag({ ...VERTRAG, kg300_euro: 1_100_000 });
  const erwartet = Math.round((neu.grund + neu.umbau - alt.grund - alt.umbau) * 100) / 100;
  assert.ok(erwartet > 0);
  assert.equal(n.betrag_euro, erwartet);
  assert.deepEqual(n.berechnung, { art: "pauschal", betrag_euro: erwartet });
  assert.equal(n.grund, "leistungsaenderung");
  assert.equal(n.status, "entwurf");
  assert.equal(n.nr, 3);
  assert.equal(n.id, undefined);
  assert.deepEqual(n.kosten_drift.aktuell, { kg300_cent: 1_100_000_00, kg400_cent: 200_000_00, sonstige_cent: 0 });
  assert.equal(n.kosten_drift.bezug_am, "2026-10-01");
  assert.deepEqual(VERTRAG, vorher, "the contract (and thus its invoices) is never touched");
});

test("96-03: ein Honorarnachtrag aus der Drift wird neuer Bezug, ein abgelehnter nicht", () => {
  const drift = kostenDrift(VERTRAG, lv(1_100_000, 200_000));
  const n = { ...nachtragAusKostenDrift(VERTRAG, drift, [], { heuteIso: "2026-10-16", titel: "T" }), id: "n-1" };
  const bezug = driftBezug(VERTRAG, [n]);
  assert.equal(bezug.kosten_eingefroren_am, "2026-10-16");
  assert.equal(kostenDrift(bezug, lv(1_100_000, 200_000)).ueberSchwelle, false);
  assert.equal(kostenDrift(driftBezug(VERTRAG, [{ ...n, status: "abgelehnt" }]), lv(1_100_000, 200_000)).ueberSchwelle, true);
  // Without a snapshot on the contract, amendments do not invent one.
  assert.equal(driftBezug({ id: "hv-2" }, [n]).kosten_eingefroren, undefined);
});

test("96-03: Snapshot reist vom Angebot in den Vertrag (VERTRAGSFELDER), neues Angebot ohne Snapshot", () => {
  assert.ok(VERTRAGSFELDER.includes("kosten_eingefroren_am"));
  assert.ok(VERTRAGSFELDER.includes("kosten_eingefroren"));
  const a = neuesAngebot({ id: "p-1" }, () => null, [], { heuteIso: "2026-10-16" });
  assert.equal(a.kosten_eingefroren, null);
  assert.equal(kostenDrift(a, lv(1000)), null);
});
