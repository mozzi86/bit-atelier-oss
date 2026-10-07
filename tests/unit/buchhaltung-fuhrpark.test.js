// Unit tests of the fleet module (79-08): 1 % rule factor and rounding order
// by acquisition date, monthly/yearly flat-rate value, months in use, logbook
// evaluation (shares + data-quality warnings), running cost, logbook value,
// the flat-rate/logbook comparison, mileage allowance, and the legal-form
// switch of nutzungsentnahme()/geldwerterVorteil() (E-04).
//
// In:  src/lib/accounting/fuhrpark.js, src/lib/accounting/beispielDaten.js
//      (contract test T6), src/lib/accounting/einstellungen.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bemessung, fahrtenbuchAuswertung, fahrtenbuchWert, fahrzeugJahreswert, fahrzeugKosten, faktor,
  geldwerterVorteil, kilometergeld, monateInNutzung, nutzerLabel, nutzungsentnahme, pauschalJahr, pauschalWertMonat,
  vergleich,
} from "@/lib/accounting/fuhrpark.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { euroZuCent } from "@/lib/accounting/geld.js";

const SAETZE = saetzeZum("2026-09-27");
const EINZEL = wirksameEinstellungen({ rechtsform: "einzelunternehmen" });
const GMBH = wirksameEinstellungen({ rechtsform: "gmbh" });

// --- T1: Faktor, Bemessung, Rundung, Monatswerte -------------------------------------------

test("faktor: E-Fahrzeug BLP 60.000 €, Anschaffung 2024-03-01 (Grenze 70.000) → ¼", () => {
  const f = faktor({ antrieb: "elektro", blp: 60000, anschaffung_datum: "2024-03-01" }, SAETZE);
  assert.equal(f.faktor, 0.25);
});

test("faktor: E-Fahrzeug BLP 64.800 € — Anschaffung 2023-06-01 (Grenze 60.000) → ½; Anschaffung 2024-02-01 (Grenze 70.000) → ¼", () => {
  assert.equal(faktor({ antrieb: "elektro", blp: 64800, anschaffung_datum: "2023-06-01" }, SAETZE).faktor, 0.5);
  assert.equal(faktor({ antrieb: "elektro", blp: 64800, anschaffung_datum: "2024-02-01" }, SAETZE).faktor, 0.25);
});

test("faktor: Hybrid CO₂ 45 g/km → ½ (unter 50 g/km, unabhängig von der Reichweite)", () => {
  const f = faktor({ antrieb: "hybrid", co2_g_km: 45, e_reichweite_km: 10, anschaffung_datum: "2025-03-01" }, SAETZE);
  assert.equal(f.faktor, 0.5);
  assert.match(f.grund, /CO₂ 45 g\/km ≤ 50 g\/km/);
});

test("faktor: Hybrid CO₂ 60 g/km, Reichweite 70 km, Anschaffung 2025-03 (Schwelle ab 2025: 80 km) → 1, Begründung „Reichweite 70 km < 80 km“", () => {
  const f = faktor({ antrieb: "hybrid", co2_g_km: 60, e_reichweite_km: 70, anschaffung_datum: "2025-03-15" }, SAETZE);
  assert.equal(f.faktor, 1);
  assert.equal(f.grund, "Reichweite 70 km < 80 km");
});

test("faktor: Verbrenner → 1, Begründung „Verbrenner“", () => {
  assert.deepEqual(faktor({ antrieb: "verbrenner" }, SAETZE), { faktor: 1, grund: "Verbrenner" });
});

test("bemessung + pauschalWertMonat: E-Fahrzeug BLP 60.000 €, 20 km, Anschaffung 2024-03-01 → Bemessung 15.000 € → 240,00 €/Monat (150,00 + 90,00)", () => {
  const fahrzeug = { antrieb: "elektro", blp: 60000, anschaffung_datum: "2024-03-01", entfernung_km: 20 };
  assert.equal(bemessung(fahrzeug, SAETZE), euroZuCent(15000));
  const wert = pauschalWertMonat(fahrzeug, SAETZE);
  assert.deepEqual(wert, { privat: euroZuCent(150), fahrten: euroZuCent(90), summe: euroZuCent(240) });
});

test("pauschalWertMonat: E-Fahrzeug BLP 64.800 €, 20 km — Anschaffung 2023-06-01 → 518,40 €; Anschaffung 2024-02-01 → 259,20 €", () => {
  const alt = { antrieb: "elektro", blp: 64800, anschaffung_datum: "2023-06-01", entfernung_km: 20 };
  const neu = { antrieb: "elektro", blp: 64800, anschaffung_datum: "2024-02-01", entfernung_km: 20 };
  assert.equal(pauschalWertMonat(alt, SAETZE).summe, euroZuCent(518.4));
  assert.equal(pauschalWertMonat(neu, SAETZE).summe, euroZuCent(259.2));
});

test("pauschalWertMonat: Beispiel-E-Fahrzeug BLP 58.800 €, 12 km, Anschaffung 2025-03-15 → 199,92 €/Monat", () => {
  const fahrzeug = { antrieb: "elektro", blp: 58800, anschaffung_datum: "2025-03-15", entfernung_km: 12 };
  assert.equal(bemessung(fahrzeug, SAETZE), euroZuCent(14700));
  assert.equal(pauschalWertMonat(fahrzeug, SAETZE).summe, euroZuCent(199.92));
});

test("Rundung nach Minderung [ASSUMED]: E, BLP 58.900 €, Anschaffung 2025-08-01 (Grenze 100.000) → ¼ = 14.725 € → abgerundet 14.700 € → 12 km → 199,92 €/Monat", () => {
  const fahrzeug = { antrieb: "elektro", blp: 58900, anschaffung_datum: "2025-08-01", entfernung_km: 12 };
  assert.equal(faktor(fahrzeug, SAETZE).faktor, 0.25, "58.900 € liegt innerhalb der ab 2025-07-01 geltenden Grenze 100.000 €");
  assert.equal(bemessung(fahrzeug, SAETZE), euroZuCent(14700), "14.725 € auf volle 100 € abgerundet, nicht vor der Minderung gerundet");
  assert.equal(pauschalWertMonat(fahrzeug, SAETZE).summe, euroZuCent(199.92));
});

test("pauschalWertMonat: Verbrenner BLP 45.678 € → 45.600 € → 456,00 € + 15 km × 0,03 % = 205,20 € → 661,20 €/Monat", () => {
  const fahrzeug = { antrieb: "verbrenner", blp: 45678, entfernung_km: 15 };
  assert.equal(bemessung(fahrzeug, SAETZE), euroZuCent(45600));
  assert.equal(pauschalWertMonat(fahrzeug, SAETZE).summe, euroZuCent(661.2));
});

test("monateInNutzung: Nutzung ab 2026-03-20 → 10 Monate in 2026 (März zählt voll)", () => {
  assert.equal(monateInNutzung({ nutzung_ab: "2026-03-20" }, 2026), 10);
});

test("monateInNutzung: Nutzung ab 2025-01-01 bis 2026-06-05 → 6 Monate in 2026 (Juni zählt voll)", () => {
  assert.equal(monateInNutzung({ nutzung_ab: "2025-01-01", nutzung_bis: "2026-06-05" }, 2026), 6);
});

test("pauschalJahr: Beispiel-E-Fahrzeug, ganzjährig genutzt → 12 × 199,92 € = 2.399,04 €", () => {
  const fahrzeug = { antrieb: "elektro", blp: 58800, anschaffung_datum: "2025-03-15", entfernung_km: 12, nutzung_ab: "2025-03-15" };
  const jahr = pauschalJahr(fahrzeug, SAETZE, 2026);
  assert.equal(jahr.monate, 12);
  assert.equal(jahr.summe, euroZuCent(2399.04));
});

// --- T2: Fahrtenbuch, Kosten, Vergleich, Nutzungsentnahme, Kilometergeld -------------------

test("fahrtenbuchAuswertung: 20.000 km, davon 4.000 km privat → Privatanteil 20 %", () => {
  const fahrzeug = { id: "fz-1" };
  const fahrten = [
    { fahrzeug_id: "fz-1", art: "dienstlich", km: 16000, datum: "2026-01-05", ziel: "A", zweck: "B" },
    { fahrzeug_id: "fz-1", art: "privat", km: 4000, datum: "2026-06-10", ziel: "C", zweck: "D" },
  ];
  const auswertung = fahrtenbuchAuswertung(fahrten, fahrzeug);
  assert.equal(auswertung.km.gesamt, 20000);
  assert.equal(auswertung.privatanteil, 20);
  assert.equal(auswertung.wohnungArbeitAnteil, 0);
  assert.deepEqual(auswertung.warnungen, []);
});

test("fahrtenbuchAuswertung: km-Stand Ende 10.250, nächste Fahrt Start 10.300 → Warnung „Lücke“ 50 km", () => {
  const fahrzeug = { id: "fz-1" };
  const fahrten = [
    { id: "f1", fahrzeug_id: "fz-1", art: "dienstlich", km: 250, datum: "2026-01-05", ziel: "A", zweck: "B", km_start: 10000, km_ende: 10250 },
    { id: "f2", fahrzeug_id: "fz-1", art: "dienstlich", km: 100, datum: "2026-01-10", ziel: "A", zweck: "B", km_start: 10300, km_ende: 10400 },
  ];
  const auswertung = fahrtenbuchAuswertung(fahrten, fahrzeug);
  const luecke = auswertung.warnungen.find((w) => w.typ === "luecke");
  assert.ok(luecke, "Lücke nicht gefunden");
  assert.equal(/** @type {any} */ (luecke).differenzKm, 50);
});

test("fahrtenbuchAuswertung: fehlendes Pflichtfeld (kein Ziel) wird gemeldet", () => {
  const fahrten = [{ id: "f1", fahrzeug_id: "fz-1", art: "dienstlich", km: 10, datum: "2026-01-05", zweck: "B" }];
  const warnungen = fahrtenbuchAuswertung(fahrten, { id: "fz-1" }).warnungen;
  assert.ok(warnungen.some((w) => w.typ === "pflichtfeld" && /** @type {any} */ (w).feld === "ziel"));
});

test("fahrzeugKosten + fahrtenbuchWert: Kosten 9.000 € × Privatanteil 20 % = 1.800,00 €/Jahr; Vergleich nennt die günstigere Methode", () => {
  const daten = {
    Eingangsrechnung: [{ fahrzeug_id: "fz-1", rechnungsdatum: "2026-03-01", netto: 9000, brutto: 10710, vorsteuer: 1710 }],
    Anlagegut: [],
    Fahrt: [
      { fahrzeug_id: "fz-1", art: "dienstlich", km: 16000, datum: "2026-01-05", ziel: "A", zweck: "B" },
      { fahrzeug_id: "fz-1", art: "privat", km: 4000, datum: "2026-06-10", ziel: "C", zweck: "D" },
    ],
  };
  const fahrzeug = { id: "fz-1" };
  assert.equal(fahrzeugKosten(daten, fahrzeug, 2026), euroZuCent(9000));
  const fahrtenbuchCent = fahrtenbuchWert(daten, fahrzeug, 2026);
  assert.equal(fahrtenbuchCent, euroZuCent(1800));
  const cmp = vergleich(euroZuCent(2399.04), fahrtenbuchCent);
  assert.equal(cmp.guenstiger, "fahrtenbuch");
});

test("kilometergeld: 42 + 18 + 120 km mit Privat-Pkw → 180 km × 0,30 € = 54,00 €, je Projekt aufgeteilt; km_satz 0,35 in einer Test-Satzkopie → 63,00 €", () => {
  const fahrten = [
    { fahrzeug_id: null, person: "Inhaberin A", datum: "2026-03-05", km: 42, project_id: "proj-1" },
    { fahrzeug_id: null, person: "Inhaberin A", datum: "2026-03-18", km: 18, project_id: "proj-2" },
    { fahrzeug_id: null, person: "Inhaberin A", datum: "2026-04-02", km: 120, project_id: "proj-1" },
  ];
  const ergebnis = kilometergeld(fahrten, SAETZE);
  assert.equal(ergebnis.summeKm, 180);
  assert.equal(ergebnis.summeCent, euroZuCent(54));
  assert.equal(ergebnis.zeilen.length, 3, "je Monat/Person/Projekt eine Zeile");
  assert.ok(ergebnis.zeilen.every((z) => z.person === "Inhaberin A"));

  const saetzeKopie = { ...SAETZE, reisekosten: { ...SAETZE.reisekosten, km_satz: 0.35 } };
  assert.equal(kilometergeld(fahrten, saetzeKopie).summeCent, euroZuCent(63));
});

test("kilometergeld: Fahrten MIT Fahrzeug (fahrzeug_id gesetzt) zählen nicht mit", () => {
  const fahrten = [{ fahrzeug_id: "fz-1", person: "X", datum: "2026-01-01", km: 500 }];
  assert.equal(kilometergeld(fahrten, SAETZE).summeCent, 0);
});

test("Rechtsform (E-04): Beispiel-E-Fahrzeug, Einzelunternehmen → Nutzungsentnahme 2.399,04 €, geldwerter Vorteil 0,00 €, Label „Inhaber/in“; GmbH → Nutzungsentnahme 0,00 €, geldwerter Vorteil 2.399,04 €, Label „Gesellschafter-Geschäftsführer/in“", () => {
  const daten = {
    Fahrzeug: [{ id: "fz-1", kennzeichen: "X-1", nutzer_art: "gesellschafter", antrieb: "elektro", blp: 58800,
      anschaffung_datum: "2025-03-15", entfernung_km: 12, nutzung_ab: "2025-03-15", methode: "pauschal" }],
    Eingangsrechnung: [], Anlagegut: [], Fahrt: [],
  };
  const einzel = nutzungsentnahme(daten, 2026, SAETZE, EINZEL);
  assert.equal(einzel.summeCent, euroZuCent(2399.04));
  assert.equal(einzel.zeilen[0].ustBemessungCent, Math.round(euroZuCent(2399.04) * 0.8));
  assert.equal(geldwerterVorteil(daten, 2026, SAETZE, EINZEL).summeCent, 0);
  assert.equal(nutzerLabel("einzelunternehmen", (k) => k), "Inhaber/in");

  const gmbh = nutzungsentnahme(daten, 2026, SAETZE, GMBH);
  assert.equal(gmbh.summeCent, 0);
  assert.equal(geldwerterVorteil(daten, 2026, SAETZE, GMBH).summeCent, euroZuCent(2399.04));
  assert.equal(nutzerLabel("gmbh", (k) => k), "Gesellschafter-Geschäftsführer/in");
});

test("geldwerterVorteil: nutzer_art „arbeitnehmer“ zählt in JEDER Rechtsform (nicht erst bei GmbH/UG)", () => {
  const daten = {
    Fahrzeug: [{ id: "fz-2", kennzeichen: "X-2", nutzer_art: "arbeitnehmer", antrieb: "verbrenner", blp: 30000, entfernung_km: 0, methode: "pauschal", nutzung_ab: "2025-01-01" }],
    Eingangsrechnung: [], Anlagegut: [], Fahrt: [],
  };
  assert.ok(geldwerterVorteil(daten, 2026, SAETZE, EINZEL).summeCent > 0);
  assert.equal(nutzungsentnahme(daten, 2026, SAETZE, EINZEL).summeCent, 0, "arbeitnehmer zählt nie zur Nutzungsentnahme");
});

test("fahrzeugJahreswert: Fahrzeug mit methode „fahrtenbuch“ hat keinen Monatswert (null)", () => {
  const daten = { Eingangsrechnung: [], Anlagegut: [], Fahrt: [] };
  const ergebnis = fahrzeugJahreswert(daten, { id: "fz-3", methode: "fahrtenbuch" }, 2026, SAETZE);
  assert.equal(ergebnis.monatCent, null);
  assert.equal(ergebnis.jahrCent, 0);
});

// --- T6 Vertragstest: der Kontrakt hält auf den echten Beispieldaten -----------------------

test("Vertragstest (T6): beispielDatensaetze('2026-09-27') 2026 — Einzelunternehmen: Nutzungsentnahme 2.399,04 € (nur bsp-fz-1, bsp-fz-2 ist Fahrtenbuch ohne Privatanteil); GmbH tauscht auf geldwerter Vorteil", () => {
  const heute = "2026-09-27";
  const bsp = beispielDatensaetze(heute);
  const saetze = saetzeZum(heute);
  const daten = { Fahrzeug: bsp.Fahrzeug, Eingangsrechnung: bsp.Eingangsrechnung, Anlagegut: bsp.Anlagegut, Fahrt: bsp.Fahrt };
  const einst = wirksameEinstellungen(bsp.Setting[0].value);

  const einzel = nutzungsentnahme(daten, 2026, saetze, einst);
  assert.equal(einzel.summeCent, euroZuCent(2399.04));
  assert.equal(geldwerterVorteil(daten, 2026, saetze, einst).summeCent, 0);

  const bsp2 = daten.Fahrzeug.find((f) => f.id === "bsp-fz-2");
  assert.equal(bsp2.methode, "fahrtenbuch");
  const auswertungBsp2 = fahrtenbuchAuswertung(daten.Fahrt, bsp2);
  assert.equal(auswertungBsp2.privatanteil, 0, "bsp-fz-2 hat im Seed nur dienstliche Fahrten");

  const gmbhEinst = wirksameEinstellungen({ ...bsp.Setting[0].value, rechtsform: "gmbh" });
  assert.equal(nutzungsentnahme(daten, 2026, saetze, gmbhEinst).summeCent, 0);
  assert.equal(geldwerterVorteil(daten, 2026, saetze, gmbhEinst).summeCent, euroZuCent(2399.04));

  const kmGeld = kilometergeld(daten.Fahrt, saetze);
  assert.ok(kmGeld.summeCent > 0);
  assert.equal(kmGeld.summeCent, euroZuCent(kmGeld.summeKm * saetze.reisekosten.km_satz));
});
