// Unit tests of the fixed-asset register module (79-09): method suggestion,
// yearly depreciation and book value for all four methods (sofort/gwg/
// sammel/linear), disposal, and the takeover from the fleet / activation
// from an incoming invoice.
//
// In:  src/lib/accounting/anlagen.js, src/lib/accounting/einstellungen.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afaJahr, afaSumme, anlagenverzeichnis, ausEingangsrechnung, fahrzeugKandidaten, fahrzeugUebernehmen,
  kategorieText, methodeText, methodeVorschlag, nutzungsdauerVorschlag, restbuchwert,
} from "@/lib/accounting/anlagen.js";
import { saetzeZum } from "@/lib/accounting/einstellungen.js";
import { euroZuCent } from "@/lib/accounting/geld.js";

const SAETZE = saetzeZum("2026-09-27");

// --- T1: Vorschlag, AfA je Methode, Restbuchwert, Verzeichnis ------------------------------

test("methodeVorschlag: 250,00 € → sofort; 690 € → gwg; 2.600 € → linear", () => {
  assert.equal(methodeVorschlag(euroZuCent(250), SAETZE), "sofort");
  assert.equal(methodeVorschlag(euroZuCent(690), SAETZE), "gwg");
  assert.equal(methodeVorschlag(euroZuCent(2600), SAETZE), "linear");
});

test("methodeVorschlag: Sammelposten wird NIE automatisch vorgeschlagen (jahresweite Wahl, kein Je-Posten-Standard) — 900 € → linear", () => {
  assert.equal(methodeVorschlag(euroZuCent(900), SAETZE), "linear");
});

test("methodeVorschlag: mit GWG-Grenze 500 € in einer Test-Satzkopie wird 690 € linear (nicht mehr gwg, und auch nicht sammel)", () => {
  const kopie = { ...SAETZE, afa: { ...SAETZE.afa, gwg_grenze: 500 } };
  assert.equal(methodeVorschlag(euroZuCent(690), kopie), "linear");
});

test("nutzungsdauerVorschlag: aus der ND-Tabelle je Kategorie", () => {
  assert.equal(nutzungsdauerVorschlag("fahrzeug", SAETZE), 6);
  assert.equal(nutzungsdauerVorschlag("plotter", SAETZE), 7);
  assert.equal(nutzungsdauerVorschlag("rechner", SAETZE), 1);
});

test("afaJahr linear: Schreibtisch 2.600 € netto, ND 13, Anschaffung 2026-07-10 → AfA 2026 = 100,00 € (6 Monate), Restbuchwert 31.12.2026 = 2.500,00 €", () => {
  const anlage = { ak_netto: 2600, nutzungsdauer: 13, anschaffung_datum: "2026-07-10", methode: "linear", abgang: null };
  assert.equal(afaJahr(anlage, 2026, SAETZE), euroZuCent(100));
  assert.equal(restbuchwert(anlage, "2026-12-31", SAETZE), euroZuCent(2500));
});

test("afaJahr linear: Plotter 6.800 €, ND 7, Anschaffung 2024-06-15 → AfA 2024 = 566,67 € (7 Monate), 2025 = 971,43 €; letztes Jahr bringt den Buchwert auf 0,00 €; Summe der AfA über die Laufzeit = AK", () => {
  const anlage = { ak_netto: 6800, nutzungsdauer: 7, anschaffung_datum: "2024-06-15", methode: "linear", abgang: null };
  assert.equal(afaJahr(anlage, 2024, SAETZE), euroZuCent(566.67));
  assert.equal(afaJahr(anlage, 2025, SAETZE), euroZuCent(971.43));
  let summe = 0;
  for (let j = 2024; j <= 2032; j++) summe += afaJahr(anlage, j, SAETZE);
  assert.equal(summe, euroZuCent(6800));
  assert.equal(restbuchwert(anlage, "2031-12-31", SAETZE), 0, "nach der Nutzungsdauer ist der Buchwert 0,00 €");
});

test("afaJahr gwg: Monitor 690 € netto → volle AfA im Anschaffungsjahr, Restbuchwert 0,00 €", () => {
  const heute = "2026-06-27"; // 3 Monate vor dem Stichtag der Beispieldaten, beliebig für diesen Test
  const anlage = { ak_netto: 690, nutzungsdauer: 1, anschaffung_datum: heute, methode: "gwg", abgang: null };
  assert.equal(afaJahr(anlage, 2026, SAETZE), euroZuCent(690));
  assert.equal(restbuchwert(anlage, "2026-12-31", SAETZE), 0);
  assert.equal(afaJahr(anlage, 2027, SAETZE), 0, "im Folgejahr keine weitere AfA");
});

test("afaJahr sammel: 900 € als Sammelposten (Anschaffung 2026) → 180,00 € p. a. von 2026 bis 2030, danach 0", () => {
  const anlage = { ak_netto: 900, anschaffung_datum: "2026-03-01", methode: "sammel", abgang: null };
  for (let j = 2026; j <= 2030; j++) assert.equal(afaJahr(anlage, j, SAETZE), euroZuCent(180), `Jahr ${j}`);
  assert.equal(afaJahr(anlage, 2025, SAETZE), 0);
  assert.equal(afaJahr(anlage, 2031, SAETZE), 0);
  let summe = 0;
  for (let j = 2026; j <= 2030; j++) summe += afaJahr(anlage, j, SAETZE);
  assert.equal(summe, euroZuCent(900), "Summe der Sammelposten-AfA über die Laufzeit = AK");
});

test("afaJahr linear: Pkw Kauf, AK netto 42.016,81 €, ND 6, Anschaffung 2026-04-01 → AfA 2026 = 5.252,10 € (9 Monate); der BLP geht nicht ein", () => {
  const anlage = { ak_netto: 42016.81, nutzungsdauer: 6, anschaffung_datum: "2026-04-01", methode: "linear", abgang: null };
  assert.equal(afaJahr(anlage, 2026, SAETZE), euroZuCent(5252.10));
});

test("afaJahr linear: Beispiel-Pkw AK 49.500 €, ND 6, Anschaffung 2025-03-15 → AfA 2025 = 6.875,00 € (10 Monate), 2026 = 8.250,00 €", () => {
  const anlage = { ak_netto: 49500, nutzungsdauer: 6, anschaffung_datum: "2025-03-15", methode: "linear", abgang: null };
  assert.equal(afaJahr(anlage, 2025, SAETZE), euroZuCent(6875));
  assert.equal(afaJahr(anlage, 2026, SAETZE), euroZuCent(8250));
});

test("afaJahr linear: Abgang 2027-06-30 → AfA 2027 (elapsed months + Restbuchwert als Aufwand), 0 danach, Restbuchwert nie negativ, Summe über die Laufzeit = AK", () => {
  const anlage = { ak_netto: 2600, nutzungsdauer: 13, anschaffung_datum: "2026-07-10", methode: "linear", abgang: { datum: "2027-06-30", erloes: 0 } };
  const afa2026 = afaJahr(anlage, 2026, SAETZE);
  const afa2027 = afaJahr(anlage, 2027, SAETZE);
  assert.equal(afa2026, euroZuCent(100), "2026 unverändert, vor dem Abgang");
  assert.ok(afa2027 > euroZuCent(100), "2027 enthält die anteilige AfA UND den restlichen Buchwert");
  assert.equal(afaJahr(anlage, 2028, SAETZE), 0, "nach dem Abgang keine weitere AfA");
  assert.equal(restbuchwert(anlage, "2027-12-31", SAETZE), 0);
  assert.equal(restbuchwert(anlage, "2030-12-31", SAETZE), 0, "nie negativ, bleibt 0");
  assert.equal(afa2026 + afa2027, euroZuCent(2600), "Summe der AfA über die Laufzeit = AK");
});

test("anlagenverzeichnis + afaSumme: summiert über alle Anlagegüter eines Jahres", () => {
  const daten = {
    Anlagegut: [
      { id: "a1", ak_netto: 690, nutzungsdauer: 1, anschaffung_datum: "2026-03-01", methode: "gwg", abgang: null },
      { id: "a2", ak_netto: 2600, nutzungsdauer: 13, anschaffung_datum: "2026-07-10", methode: "linear", abgang: null },
    ],
  };
  const verzeichnis = anlagenverzeichnis(daten, 2026, SAETZE);
  assert.equal(verzeichnis.length, 2);
  assert.equal(afaSumme(daten, 2026, SAETZE), euroZuCent(690) + euroZuCent(100));
});

test("anlagenverzeichnis: eine kaputte Anlage (Nutzungsdauer 0, grundlagen.afaLinearCent wirft) bricht das Verzeichnis nicht", () => {
  const daten = { Anlagegut: [{ id: "kaputt", ak_netto: 100, nutzungsdauer: 0, anschaffung_datum: "2026-01-01", methode: "linear" }] };
  assert.deepEqual(anlagenverzeichnis(daten, 2026, SAETZE), []);
});

// --- T2: Übernahme aus Fuhrpark, Aktivierung aus Eingangsrechnung --------------------------

test("fahrzeugKandidaten: nur Kauf-Fahrzeuge ohne Anlagegut; Leasing erscheint nie; nach Übernahme verschwindet das Fahrzeug", () => {
  const daten = {
    Fahrzeug: [
      { id: "fz-kauf", kauf_leasing: "kauf" },
      { id: "fz-leasing", kauf_leasing: "leasing" },
      { id: "fz-schon-uebernommen", kauf_leasing: "kauf" },
    ],
    Anlagegut: [{ id: "ag-1", fahrzeug_id: "fz-schon-uebernommen" }],
  };
  const kandidaten = fahrzeugKandidaten(daten);
  assert.deepEqual(kandidaten.map((f) => f.id), ["fz-kauf"]);

  const nachUebernahme = fahrzeugKandidaten({ ...daten, Anlagegut: [...daten.Anlagegut, { id: "ag-2", fahrzeug_id: "fz-kauf" }] });
  assert.deepEqual(nachUebernahme, []);
});

test("fahrzeugUebernehmen: AK netto aus der Rechnung (nie BLP), ND 6, kategorie fahrzeug; ohne Rechnung leer zur Eingabe; Leasing wird abgelehnt", () => {
  const fahrzeug = { id: "fz-1", kennzeichen: "BSP-A 999", anschaffung_datum: "2026-01-15", blp: 30000, kauf_leasing: "kauf" };
  const mitRechnung = fahrzeugUebernehmen(fahrzeug, { netto: 25000 });
  assert.equal(mitRechnung.ak_netto, 25000, "AK netto kommt aus der Rechnung, nicht aus dem BLP");
  assert.equal(mitRechnung.kategorie, "fahrzeug");
  assert.equal(mitRechnung.nutzungsdauer, 6);
  assert.equal(mitRechnung.fahrzeug_id, "fz-1");
  assert.equal(mitRechnung.anschaffung_datum, "2026-01-15");

  const ohneRechnung = fahrzeugUebernehmen(fahrzeug, null);
  assert.equal(ohneRechnung.ak_netto, "", "ohne Rechnung leer zur Eingabe");

  assert.throws(() => fahrzeugUebernehmen({ ...fahrzeug, kauf_leasing: "leasing" }), /Leasingfahrzeuge werden nicht aktiviert/);
});

test("ausEingangsrechnung: Entwurf + Schreibliste — Anlagegut anlegen, anlage_id an der Eingangsrechnung setzen (dieselbe id in beiden Schreibungen)", () => {
  const er = { id: "er-1", lieferant: "Computerhandel Beispiel", kategorie: "sonstiges", netto: 2400, rechnungsdatum: "2026-03-10" };
  const { entwurf, schreibliste } = ausEingangsrechnung(er);
  assert.equal(entwurf.ak_netto, 2400);
  assert.equal(entwurf.anschaffung_datum, "2026-03-10");
  assert.equal(entwurf.eingangsrechnung_id, "er-1");
  assert.equal(schreibliste.length, 2);
  assert.equal(schreibliste[0].entitaet, "Anlagegut");
  assert.equal(schreibliste[0].obj.id, entwurf.id);
  assert.equal(schreibliste[1].entitaet, "Eingangsrechnung");
  assert.equal(schreibliste[1].obj.id, "er-1");
  assert.equal(schreibliste[1].obj.anlage_id, entwurf.id, "dieselbe id wie das neue Anlagegut");
});

test("ausEingangsrechnung: kategorie „software“/„fahrzeug“ übernommen, alles andere sonstiges", () => {
  assert.equal(ausEingangsrechnung({ id: "1", kategorie: "software", netto: 300 }).entwurf.kategorie, "software");
  assert.equal(ausEingangsrechnung({ id: "2", kategorie: "miete", netto: 300 }).entwurf.kategorie, "sonstiges");
});

// --- Text-Helfer (i18n guard) ---------------------------------------------------------------

test("kategorieText/methodeText: literale t()-Aufrufe für jeden Enum-Wert", () => {
  for (const k of ["bueroausstattung", "rechner", "plotter", "fahrzeug", "software", "sonstiges"]) {
    assert.equal(typeof kategorieText(k, (s) => s), "string");
  }
  for (const m of ["sofort", "gwg", "sammel", "linear"]) {
    assert.equal(typeof methodeText(m, (s) => s), "string");
  }
});
