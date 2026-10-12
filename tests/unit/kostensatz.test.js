// Phase 81 (81-01): cost rate per person from salary and contract (ZEIT-05) and
// the cost rate as the tenth HR entity (E-14: personnel storage class, deletion
// rule, data subject request).
//
// Hand calculation of the oracle (81-RESEARCH § Kostensatz-Orakel):
//   5.000 €/month × 12 = 60.000 €; × 1,21 (AG-Anteil 21 %) = 72.600 €
//   productive hours at 40 h / 5 days, 30 days leave, 13 holidays, 10 sick days, 85 %:
//   (52 × 40 − 30 × 8 − 23 × 8) × 0,85 = (2080 − 240 − 184) × 0,85 = 1.407,6 h
//   direct 72.600 / 1.407,6 = 51,58 €/h; rate 72.600 × 1,8 / 1.407,6 = 92,84 €/h
//
// In:  src/lib/controlling/kostensatz.js, the 80 storage-class modules. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buerosatz, gueltigerSatz, jahresbrutto, satzAusGehalt } from "@/lib/controlling/kostensatz.js";
import { PERSONAL_ENTITAETEN } from "@core/api/personalEntitaeten.js";
import { bitApi } from "@core/api/bitApi";
import { LOESCH_REGELN, loeschPlan, personAuskunft } from "@/lib/people/auskunft.js";

const WERTE = { ag_anteil: 21, gemeinkosten: 80, produktivquote: 85, feiertage: 13, krankheitstage: 10 };
const VOLLZEIT = { wochenstunden: 40, arbeitstage_woche: 5, urlaub_tage_jahr: 30 };

test("jahresbrutto: Monatsgehalt mit Zusatzbetrag, Stundenlohn, Text-Zusätze zählen nicht", () => {
  assert.equal(jahresbrutto({ art: "monat", brutto_eur: 5000, zusatz: [{ betrag_eur: 1000, rhythmus: "jaehrlich" }] }, VOLLZEIT), 61000);
  assert.equal(jahresbrutto({ art: "stunde", brutto_eur: 20 }, { wochenstunden: 20 }), 20800);
  // 80 stores the occasion in `art` and working students as hourly (src/lib/people/kosten.js).
  assert.equal(jahresbrutto({ art: "einstellung", brutto_eur: 15 }, { wochenstunden: 20 }, "werkstudent"), 15600);
  assert.equal(jahresbrutto({ art: "einstellung", brutto_eur: 4200, zusatz: ["Jobticket"] }, VOLLZEIT), 50400);
  assert.equal(jahresbrutto({ brutto_eur: 100, zusatz: [{ betrag_eur: 50, rhythmus: "monatlich" }] }, VOLLZEIT), 1800);
  assert.equal(jahresbrutto(null, VOLLZEIT), 0);
});

test("satzAusGehalt: Orakel 92,84 / 111,41 / 74,27 €/h", () => {
  const r = satzAusGehalt({ gehalt: { brutto_eur: 5000 }, vertrag: VOLLZEIT }, WERTE);
  assert.ok(r);
  assert.equal(r.basis.jahreskosten_eur, 72600);
  assert.equal(r.basis.produktive_stunden_h, 1407.6);
  assert.equal(r.direkt_eur_h, 51.58);
  assert.equal(r.satz_eur_h, 92.84);
  assert.equal(satzAusGehalt({ gehalt: { brutto_eur: 6000 }, vertrag: VOLLZEIT }, WERTE)?.satz_eur_h, 111.41);
  assert.equal(satzAusGehalt({ gehalt: { brutto_eur: 4000 }, vertrag: VOLLZEIT }, WERTE)?.satz_eur_h, 74.27);
});

test("satzAusGehalt: Teilzeit 20 h an 3 Tagen rechnet den Urlaub mit wh/at", () => {
  // (52 × 20 − 12 × 20/3 − 23 × 20/5) × 0,85 = (1040 − 80 − 92) × 0,85 = 737,8 h
  // 15 €/h × 20 h × 52 = 15.600 €; × 1,21 = 18.876 €; × 1,8 / 737,8 = 46,05 €/h
  const r = satzAusGehalt({ gehalt: { brutto_eur: 15 }, vertrag: { wochenstunden: 20, arbeitstage_woche: 3, urlaub_tage_jahr: 12 }, personArt: "werkstudent" }, WERTE);
  assert.equal(r?.basis.produktive_stunden_h, 737.8);
  assert.equal(r?.satz_eur_h, 46.05);
  assert.equal(satzAusGehalt({ gehalt: null, vertrag: VOLLZEIT }, WERTE), null, "ohne Gehalt kein Satz");
  assert.equal(satzAusGehalt({ gehalt: { brutto_eur: 5000 }, vertrag: null }, WERTE), null, "ohne Vertrag kein Satz");
});

test("gueltigerSatz: größtes gueltig_ab ≤ Datum", () => {
  const saetze = [
    { mitarbeiter_id: "P-003", gueltig_ab: "2025-01-01", satz_eur_h: 85 },
    { mitarbeiter_id: "P-003", gueltig_ab: "2026-01-01", satz_eur_h: 92.84 },
    { mitarbeiter_id: "P-004", gueltig_ab: "2024-01-01", satz_eur_h: 40 },
  ];
  assert.equal(gueltigerSatz(saetze, "P-003", "2025-12-31")?.satz_eur_h, 85);
  assert.equal(gueltigerSatz(saetze, "P-003", "2026-01-01")?.satz_eur_h, 92.84);
  assert.equal(gueltigerSatz(saetze, "P-003", "2024-12-31"), null);
});

test("buerosatz: Regelwert vor dem Mittel; Mittel 115,00 / 111,41 / 74,27 = 100,23", () => {
  const saetze = [
    { mitarbeiter_id: "inhaber", gueltig_ab: "2026-01-01", satz_eur_h: 115 },
    { mitarbeiter_id: "P-003", gueltig_ab: "2026-01-01", satz_eur_h: 111.41 },
    { mitarbeiter_id: "P-004", gueltig_ab: "2026-01-01", satz_eur_h: 74.27 },
  ];
  assert.deepEqual(buerosatz(saetze, "2026-09-28", null), { satz: 100.23, quelle: "mittel" });
  assert.deepEqual(buerosatz(saetze, "2026-09-28", 95), { satz: 95, quelle: "regel" });
  assert.equal(buerosatz([], "2026-09-28", null), null);
});

test("Kostensatz ist Personal-Entität (E-14): Speicherklasse personal, nie bitApi.entities", async () => {
  assert.ok(PERSONAL_ENTITAETEN.includes("Kostensatz"));
  await assert.rejects(() => /** @type {any} */ (bitApi.entities).Kostensatz.list(), /nur über bitApi\.personal erreichbar/);
});

test("DS-10: Löschregel Kostensatz folgt der Lohnkonto-Frist; Auskunft enthält die Sätze der Person", () => {
  assert.deepEqual(LOESCH_REGELN.Kostensatz, {
    bezug: "mitarbeiter_id", aufbewahrung: "aufbewahrung_lohnkonto_jahre", modus: "sperren",
    norm: "aus der Gehaltsaenderung abgeleitet, folgt deren Frist (§ 41 Abs. 1 S. 9 EStG) [ASSUMED]",
  });
  const daten = {
    Mitarbeiter: [{ id: "P-003", art: "angestellt", status: "ausgeschieden", austritt: "2026-06-30" }],
    Gehaltsaenderung: [{ id: "g1", mitarbeiter_id: "P-003", gueltig_ab: "2026-01-01", brutto_eur: 5000 }],
    Kostensatz: [{ id: "k1", mitarbeiter_id: "P-003", gueltig_ab: "2026-01-01", satz_eur_h: 92.84 }, { id: "k2", mitarbeiter_id: "inhaber", gueltig_ab: "2026-01-01", satz_eur_h: 115 }],
  };
  const auskunft = personAuskunft({ mitarbeiterId: "P-003" }, daten);
  assert.deepEqual(auskunft.datensaetze.Kostensatz.map((k) => k.id), ["k1"]);
  const plan = loeschPlan({ mitarbeiterId: "P-003" }, "austritt", daten, "2026-10-01", (id) => (id === "personal.aufbewahrung_lohnkonto_jahre" ? 6 : 0));
  assert.ok(plan.sperren.some((s) => s.entitaet === "Kostensatz" && s.id === "k1" && s.bis === "2032-12-31"));
  assert.ok(!plan.sperren.some((s) => s.id === "k2") && !plan.loeschen.some((s) => s.id === "k2"), "Sätze der virtuellen Inhaber:in gehören zu keiner Person");
});
