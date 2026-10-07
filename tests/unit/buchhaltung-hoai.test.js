// Unit tests of the HOAI 2021 fee engine (79-02 T2, decision E-13): anrechenbare
// Kosten (§ 33), the § 13 table interpolation (generic over any zone count),
// the full fee contract and the instalment/payment-plan billing.
//
// In:  @core/lib/hoai/honorar.js, abrechnung.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LPH } from "@core/lib/hoai/leistungsbilder.js";
import { anrechenbareKosten, honorarAusTafel, honorarVertrag, kostenAusLv, lpStand } from "@core/lib/hoai/honorar.js";
import { abschlagsVorlage, abschlagsVorschlag, restBisSchluss, zahlungsplan } from "@core/lib/hoai/abrechnung.js";

test("anrechenbareKosten: § 33 Abs. 2 — KG 400 voll bis 25 %, darüber zur Hälfte", () => {
  assert.equal(anrechenbareKosten({ kg300_euro: 1000000, kg400_euro: 400000 }), 1325000);
  assert.equal(anrechenbareKosten({ kg300_euro: 1000000, kg400_euro: 200000 }), 1200000);
  assert.equal(anrechenbareKosten({}), 0);
});

test("honorarAusTafel: drittes/viertes Argument, Basissatz, Zwischenwerte, Zeilen-Interpolation (Gebäude)", () => {
  assert.equal(honorarAusTafel(1000000, "III", 0).honorar, 115675, "Aufruf mit nur 3 Argumenten wie in Phase 81");
  assert.equal(honorarAusTafel(25000, "I", 0).honorar, 3120);
  assert.equal(honorarAusTafel(1000000, "III", 0).honorar, 115675);
  assert.equal(honorarAusTafel(1000000, "III", 100).honorar, 144268);
  assert.equal(honorarAusTafel(1000000, "III", 50).honorar, 129971.5);
  assert.equal(honorarAusTafel(1200000, "III", 0).honorar, 135769.4, "Interpolation zwischen den Zeilen 1.000.000 und 1.500.000");
  assert.equal(honorarAusTafel(1200000, "III", 100).honorar, 169330);
  assert.equal(honorarAusTafel(2680716, "III", 0).honorar, 276770.63);
  assert.equal(honorarAusTafel(180000, "III", 0, "freianlagen").honorar, 33774);
});

test("honorarAusTafel: außerhalb der Tafel nie 0 € (frei vereinbar), keine Extrapolation", () => {
  for (const [wert, lb] of [[24999, "gebaeude"], [25000001, "gebaeude"], [19999, "freianlagen"], [1500001, "freianlagen"]]) {
    const r = honorarAusTafel(wert, "III", 0, lb);
    assert.equal(r.honorar, null, `${lb} ${wert}`);
    assert.equal(r.ausserhalb, true, `${lb} ${wert}`);
  }
});

test("honorarAusTafel: E-13 — kein amtlicher Tafeleintrag rechnet nicht (unregistriertes Leistungsbild, ohne injizierten Datensatz)", () => {
  // 79-14 hat alle 14 Leistungsbilder amtlich übertragen (WEITERE_TAFELN nicht
  // mehr leer) — "Tragwerksplanung" taugt seither nicht mehr als Beispiel für
  // ein FEHLENDES Leistungsbild (tests/unit/buchhaltung-einstellungen.test.js
  // deckt die jetzt amtliche Tragwerksplanung ab); ein unregistrierter
  // Schlüssel demonstriert dieselbe E-13-Regel unverändert.
  const r = honorarAusTafel(1000000, "III", 0, "unregistriertes_leistungsbild");
  assert.equal(r.honorar, null);
  assert.equal(r.tafelFehlt, true);
});

test("honorarAusTafel: ein Test-Datensatz mit status amtlich, annahme true rechnet nicht", () => {
  const r = honorarAusTafel(1000000, "III", 0, "gebaeude", {
    weitere: [{ leistungsbild: "gebaeude", status: "amtlich", annahme: true, zonen: ["III"], zeilen: [[1000000, [1, 2]]] }],
  });
  assert.equal(r.honorar, null);
  assert.equal(r.tafelFehlt, true);
});

test("honorarAusTafel: generische Tafel für ein unregistriertes Leistungsbild (synthetische Testregistrierung, ha)", () => {
  const testTafel = {
    leistungsbild: "test_ha", status: "amtlich", zonen: ["I", "II", "III"],
    zeilen: [[10, [1000, 1200, 1500, 1700]], [20, [1800, 2160, 2700, 3060]]],
  };
  assert.equal(honorarAusTafel(15, "II", 0, "test_ha", { weitere: [testTafel] }).honorar, 1680, "Mitte zwischen 1.200 und 2.160");
  assert.equal(honorarAusTafel(15, "III", 100, "test_ha", { weitere: [testTafel] }).honorar, 2380, "Mitte zwischen 1.700 und 3.060");
  assert.equal(honorarAusTafel(15, "IV", 0, "test_ha", { weitere: [testTafel] }).zoneUngueltig, true);
});

/** LPH array with every stage beauftragt as given (index-aligned with LPH.gebaeude/innenraeume order). */
const lphBeauftragt = (...nummern) => LPH.gebaeude.map((_, i) => ({ beauftragt: nummern.includes(i + 1) }));

test("honorarVertrag: Grundhonorar, Umbau, Nebenkosten, USt (1,2 Mio €, Zone III, Basis, Gebäude, LPH 1–4)", () => {
  const vertrag = {
    leistungsbild: "gebaeude", kg300_euro: 1200000, kg400_euro: 0, honorarzone: "III", satz_position_prozent: 0,
    lph: lphBeauftragt(1, 2, 3, 4), umbauzuschlag_prozent: 20, nebenkosten_prozent: 5, ust_satz: 19,
  };
  const r = honorarVertrag(vertrag);
  assert.equal(r.quelle, "tafel");
  assert.equal(r.grund, 36657.74);
  assert.equal(r.umbau, 7331.55);
  assert.equal(r.nebenkosten, 2199.46);
  assert.equal(r.netto, 46188.75);
  assert.equal(r.ust, 8775.86);
  assert.equal(r.brutto, 54964.61);
});

test("honorarVertrag: Innenräume LP 5 = 30 %, Gebäude gleiche Eingabe LP 5 = 25 % (1 Mio €, Zone III, Basis)", () => {
  const basis = { kg300_euro: 1000000, kg400_euro: 0, honorarzone: "III", satz_position_prozent: 0, umbauzuschlag_prozent: 0, nebenkosten_prozent: 0 };
  const innen = honorarVertrag({ ...basis, leistungsbild: "innenraeume", lph: lphBeauftragt(5) });
  assert.equal(innen.grund, 34702.5);
  const gebaeude = honorarVertrag({ ...basis, leistungsbild: "gebaeude", lph: lphBeauftragt(5) });
  assert.equal(gebaeude.grund, 28918.75);
});

test("honorarVertrag: E-13 — Tafel fehlt (unregistriertes Leistungsbild), Pauschale rechnet trotzdem", () => {
  // Siehe Kommentar oben: Tragwerksplanung ist seit 79-14 amtlich, ein
  // unregistrierter Schlüssel übernimmt hier ihre bisherige Rolle.
  const ohnePauschale = honorarVertrag({ leistungsbild: "unregistriertes_leistungsbild", bezugswert: 1000000, honorarzone: "III", satz_position_prozent: 0 });
  assert.equal(ohnePauschale.quelle, "tafel_fehlt");
  assert.equal(ohnePauschale.netto, null);
  const mitPauschale = honorarVertrag({ leistungsbild: "unregistriertes_leistungsbild", pauschal_euro: 12000, nebenkosten_prozent: 5, ust_satz: 19 });
  assert.equal(mitPauschale.quelle, "pauschal");
  assert.equal(mitPauschale.nebenkosten, 600, "+ Nebenkosten laut Vertrag (E-16: 5 %)");
  assert.equal(mitPauschale.netto, 12600);
});

test("honorarVertrag: neuer Vertrag ohne Bezugswert (außerhalb der Tafel) → frei vereinbar, kein Absturz", () => {
  const r = honorarVertrag({ leistungsbild: "gebaeude", kg300_euro: 1, kg400_euro: 0, honorarzone: "III", satz_position_prozent: 0 });
  assert.equal(r.quelle, "frei");
  assert.equal(r.netto, null);
});

test("kostenAusLv: DIN-276-Erstziffer gruppiert nach KG 300/KG 400 (Muster der Demo-Kostenbasis von proj-1)", () => {
  // Nachgebildet aus den anrechenbaren Kosten des Beispiel-Honorarvertrags bsp-hv-1
  // (src/lib/accounting/beispielDaten.js): 2.399.716 € KG 300 / 281.000 € KG 400 —
  // proj-1 selbst führt seit der AVA-Demo-Isolierung (Phase 33) keine eigenen
  // LV-Positionen mehr (siehe 79-02-SUMMARY "Abweichungen").
  const positionen = [
    { din276: "320", quantity: 1, unit_price: 1899716 },
    { din276: "341", quantity: 500000, unit_price: 1 },
    { din276: "421", quantity: 1, unit_price: 281000 },
  ];
  assert.deepEqual(kostenAusLv(positionen), { kg300_euro: 2399716, kg400_euro: 281000 });
});

test("lpStand: aus HoaiPlan.progress (Vorschlag, Quelle hoaiplan), sonst aus der Projektphase, sonst manuell (null)", () => {
  const plan = { progress: [100, 100, 80, 0, 40, null, 0, 0, 0] };
  const r = lpStand(plan, { hoai_phase: "LP 5" }, "gebaeude");
  assert.equal(r.quelle, "hoaiplan");
  assert.equal(r.stand[1], 100);
  assert.equal(r.stand[5], 40);
  assert.equal(r.stand[6], 0, "null wird zu 0 (nicht erfasst)");
  const ausPhase = lpStand(null, { hoai_phase: "LP 3" }, "gebaeude");
  assert.equal(ausPhase.quelle, "projektphase");
  assert.equal(ausPhase.stand[1], 100);
  assert.equal(ausPhase.stand[3], 50);
  assert.equal(ausPhase.stand[4], 0);
  assert.equal(lpStand(null, {}, "gebaeude").quelle, "unbekannt");
  assert.equal(lpStand(null, null, "tragwerksplanung"), null, "kein Leistungsbild mit 9 LPH der Objektplanung → manuell");
});

// Synthetische Tafel mit Bezugswert 1 → Honorar exakt 100.000 € (jede Position),
// damit die Abrechnungstests von den echten HOAI-Tabellenwerten unabhängig sind.
const TAFEL_100K = {
  leistungsbild: "gebaeude", status: "amtlich", zonen: ["I"], zeilen: [[1, [100000, 100000]]], lph: LPH.gebaeude,
};
const OPT_100K = { weitere: [TAFEL_100K] };

test("abschlagsVorschlag / restBisSchluss: Leistungsstand aus Stand je LP, abzüglich bereits gestellter Abschläge", () => {
  const vertrag = {
    id: "v-abschlag-test", leistungsbild: "gebaeude", honorarzone: "I", satz_position_prozent: 0,
    kg300_euro: 1, kg400_euro: 0, umbauzuschlag_prozent: 0, nebenkosten_prozent: 0,
    lph: LPH.gebaeude.map(() => ({ beauftragt: true })), // voll beauftragt: Honorar netto = 100.000 €
  };
  const stand = { 1: 100, 2: 100, 3: 100, 5: 40 };
  let rechnungen = [{ honorarvertrag_id: "v-abschlag-test", status: "gestellt", art: "abschlag", netto: 20000 }];
  assert.equal(restBisSchluss(vertrag, rechnungen, OPT_100K), 80000, "vorher");
  const vorschlag = abschlagsVorschlag(vertrag, stand, rechnungen, OPT_100K);
  assert.equal(vorschlag, 14000);
  rechnungen = [...rechnungen, { honorarvertrag_id: "v-abschlag-test", status: "gestellt", art: "abschlag", netto: vorschlag }];
  assert.equal(restBisSchluss(vertrag, rechnungen, OPT_100K), 66000, "nach Stellen des Vorschlags");
});

test("abschlagsVorlage: bisher Gestelltes wird den LP der Reihe nach angerechnet, Summe = abschlagsVorschlag", () => {
  const vertrag = {
    id: "v-vorlage", leistungsbild: "gebaeude", honorarzone: "I", satz_position_prozent: 0,
    kg300_euro: 1, kg400_euro: 0, umbauzuschlag_prozent: 0, nebenkosten_prozent: 0,
    lph: LPH.gebaeude.map(() => ({ beauftragt: true })),
  };
  const stand = { 1: 100, 2: 100, 3: 100, 5: 40 };
  const rechnungen = [{ honorarvertrag_id: "v-vorlage", status: "gestellt", art: "abschlag", netto: 20000 }];
  const vorlage = abschlagsVorlage(vertrag, stand, rechnungen, OPT_100K);
  // LP 1 (2.000) + LP 2 (7.000) + 11.000 of LP 3 are covered by the 20.000 € already issued.
  assert.deepEqual(vorlage.lp_pos, [{ lp: 3, stand: 100, netto: 4000 }, { lp: 5, stand: 40, netto: 10000 }]);
  assert.equal(vorlage.netto, 14000);
  assert.equal(vorlage.netto, abschlagsVorschlag(vertrag, stand, rechnungen, OPT_100K));
  const ohneStand = abschlagsVorlage(vertrag, {}, rechnungen, OPT_100K);
  assert.deepEqual(ohneStand, { netto: 0, lp_pos: [] }, "kein Stand: nichts vorzuschlagen");
});

test("restBisSchluss: gestellte Beträge werden in Cent summiert (keine Gleitkomma-Reste)", () => {
  const vertrag = {
    id: "v-cent", leistungsbild: "gebaeude", honorarzone: "I", satz_position_prozent: 0, kg300_euro: 1,
    umbauzuschlag_prozent: 0, nebenkosten_prozent: 0, lph: LPH.gebaeude.map(() => ({ beauftragt: true })),
  };
  const rechnungen = [0.1, 0.2, 33.33, 33.33, 33.33].map((netto) => ({ honorarvertrag_id: "v-cent", status: "gestellt", art: "abschlag", netto }));
  assert.equal(restBisSchluss(vertrag, rechnungen, OPT_100K), 99899.71);
});

test("abschlagsVorschlag: nie negativ, wenn schon mehr gestellt ist als der Leistungsstand", () => {
  const vertrag = { id: "v-neg", leistungsbild: "gebaeude", honorarzone: "I", satz_position_prozent: 0, kg300_euro: 1, lph: LPH.gebaeude.map(() => ({ beauftragt: true })) };
  const rechnungen = [{ honorarvertrag_id: "v-neg", status: "gestellt", art: "schluss", netto: 99000 }];
  assert.equal(abschlagsVorschlag(vertrag, { 1: 100 }, rechnungen, OPT_100K), 0);
});

test("restBisSchluss: eine stornierte Rechnung netzt sich mit ihrem Storno zu null (kein negativer Rest)", () => {
  const vertrag = {
    id: "v-storno", leistungsbild: "gebaeude", honorarzone: "I", satz_position_prozent: 0, kg300_euro: 1,
    umbauzuschlag_prozent: 0, nebenkosten_prozent: 0, lph: LPH.gebaeude.map(() => ({ beauftragt: true })),
  };
  const rechnungen = [
    { honorarvertrag_id: "v-storno", status: "storniert", art: "abschlag", netto: 10000 },
    { honorarvertrag_id: "v-storno", status: "gestellt", art: "storno", netto: -10000, storno_von: "orig" },
  ];
  assert.equal(restBisSchluss(vertrag, rechnungen, OPT_100K), 100000);
});

test("restBisSchluss: null, wenn das Honorar selbst nicht berechenbar ist (E-13)", () => {
  assert.equal(restBisSchluss({ id: "v-fehlt", leistungsbild: "tragwerksplanung" }, []), null);
});

test("zahlungsplan: eine geplante Rechnung je beauftragter LP, monatlich ab dem Startdatum", () => {
  const vertrag = {
    id: "v-plan", project_id: "proj-2", leistungsbild: "gebaeude", honorarzone: "I", satz_position_prozent: 0,
    kg300_euro: 1, kg400_euro: 0, umbauzuschlag_prozent: 0, nebenkosten_prozent: 0,
    lph: lphBeauftragt(1, 2, 3),
  };
  const plan = zahlungsplan(vertrag, { start: "2026-10-01", intervallMonate: 1 }, OPT_100K);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => [p.netto, p.rechnungsdatum, p.status]), [
    [2000, "2026-10-01", "geplant"],
    [7000, "2026-11-01", "geplant"],
    [15000, "2026-12-01", "geplant"],
  ]);
  assert.ok(plan.every((p) => p.honorarvertrag_id === "v-plan" && p.project_id === "proj-2"));
});
