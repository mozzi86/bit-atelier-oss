// Unit tests of the DATEV EXTF booking-batch export (79-11): header (31
// fields), 125-column line, booking rows in "Rechnungsbuchungen" mode,
// CP1252 encoding of the shared winAnsi core (79-03), blocking checks,
// SKR03/SKR04 switch, and a byte-identical golden file.
//
// In:  src/lib/accounting/datevExtf.js, src/lib/accounting/einstellungen.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { buchungszeilen, exportiere, kopfzeile, KONTENRAHMEN, pruefe, sperrgrundText, SPALTEN } from "@/lib/accounting/datevExtf.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";

const SAETZE = saetzeZum("2026-03-31");
const EINST = wirksameEinstellungen({ datev: { berater: "1001", mandant: "456" } });
const GOLDEN_PFAD = path.resolve(import.meta.dirname, "fixtures/buchhaltung/datev/EXTF_Buchungsstapel_golden.csv");

// --- T2/T3: Kopf, Spalten, Buchungszeilen -------------------------------------------------

test("SPALTEN: 125 Spaltennamen (öffentliches Referenzbeispiel, Formatversion 13)", () => {
  assert.equal(SPALTEN.length, 125);
  assert.equal(SPALTEN[6], "Konto");
  assert.equal(SPALTEN[36], "KOST1 – Kostenstelle");
});

test("kopfzeile: 31 Felder, beginnt mit \"EXTF\";700;21;\"Buchungsstapel\";13;, SKR-Position 27", () => {
  const zeile = kopfzeile({
    kopf: SAETZE.datev.kopf, exportiertVon: "Beispiel Architekturbüro", berater: "1001", mandant: "456",
    wjBeginn: "2026-01-01", von: "2026-01-01", bis: "2026-03-31", skr: "03", zeitstempel: "20260327120000000",
  });
  const felder = zeile.split(";");
  assert.equal(felder.length, 31);
  assert.ok(zeile.startsWith('"EXTF";700;21;"Buchungsstapel";13;'));
  assert.equal(felder[26], '"03"');
  const skr04 = kopfzeile({
    kopf: SAETZE.datev.kopf, exportiertVon: "x", berater: "1", mandant: "2",
    wjBeginn: "2026-01-01", von: "2026-01-01", bis: "2026-03-31", skr: "04", zeitstempel: "20260327120000000",
  });
  assert.equal(skr04.split(";")[26], '"04"');
});

test("buchungszeilen: Ausgangsrechnung RE-2026-014, brutto 11.900,00 €, 05.03.2026 → Konto 10000, Gegenkonto 8400, Belegdatum 0503", () => {
  const daten = { Ausgangsrechnung: [{
    id: "ar-1", status: "gestellt", nummer: "RE-2026-014", rechnungsdatum: "2026-03-05",
    netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900, empfaenger: { name: "Bauherr Beispiel" },
  }] };
  const { zeilen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  assert.equal(zeilen.length, 1);
  const felder = zeilen[0].split(";");
  assert.equal(felder.length, 125);
  assert.equal(felder[0], "11900,00");
  assert.equal(felder[1], '"S"');
  assert.equal(felder[6], "10000");
  assert.equal(felder[7], "8400");
  assert.equal(felder[9], "0503");
  assert.equal(felder[10], '"RE-2026-014"');
});

test("buchungszeilen: Umsatz 1.234,56 € → „1234,56“ ohne Tausenderpunkt", () => {
  const daten = { Ausgangsrechnung: [{ id: "ar-2", status: "gestellt", nummer: "RE-2026-020", rechnungsdatum: "2026-02-10",
    netto: 1037.44, ust_satz: 19, ust: 197.12, brutto: 1234.56, empfaenger: { name: "Bauherr Beispiel" } }] };
  const { zeilen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  assert.equal(zeilen[0].split(";")[0], "1234,56");
});

test("buchungszeilen: Eingangsrechnung Software brutto 119,00 € (regel19) → Konto 4964, BU \"9\"", () => {
  const daten = { Eingangsrechnung: [{ id: "er-1", lieferant: "Software Anbieter Beispiel", kategorie: "software",
    steuerfall: "regel19", netto: 100, vorsteuer: 19, brutto: 119, rechnungsdatum: "2026-02-01" }] };
  const { zeilen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  const felder = zeilen[0].split(";");
  assert.equal(felder[0], "119,00");
  assert.equal(felder[6], "4964");
  assert.equal(felder[8], '"9"');
});

test("buchungszeilen: Versicherung 6.800 € (Versicherungsteuer) → Konto 4360, ohne BU", () => {
  const daten = { Eingangsrechnung: [{ id: "er-2", lieferant: "Versicherung Beispiel", kategorie: "versicherung",
    steuerfall: "versicherungsteuer", netto: 6800, vorsteuer: 0, brutto: 6800, rechnungsdatum: "2026-02-01" }] };
  const { zeilen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  const felder = zeilen[0].split(";");
  assert.equal(felder[6], "4360");
  assert.equal(felder[8], "", "kein BU-Schlüssel bei Versicherungsteuer");
});

test("buchungszeilen: Kategorie „personal“ wird nicht gebucht, sondern gezählt", () => {
  const daten = { Eingangsrechnung: [
    { id: "er-3", lieferant: "Lohnbüro Beispiel", kategorie: "personal", steuerfall: "steuerfrei", netto: 3000, vorsteuer: 0, brutto: 3000, rechnungsdatum: "2026-02-01" },
    { id: "er-4", lieferant: "Software Anbieter Beispiel", kategorie: "software", steuerfall: "regel19", netto: 100, vorsteuer: 19, brutto: 119, rechnungsdatum: "2026-02-01" },
  ] };
  const { zeilen, warnungLohnbuchungen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  assert.equal(zeilen.length, 1, "nur die Software-Rechnung wird gebucht");
  assert.equal(warnungLohnbuchungen, 1);
});

test("buchungszeilen: Eingangsrechnung mit anlage_id wird nicht gebucht (nur ihre AfA zählt, anderswo)", () => {
  const daten = { Eingangsrechnung: [{ id: "er-5", lieferant: "Autohaus Beispiel", kategorie: "fahrzeug", steuerfall: "regel19",
    netto: 30000, vorsteuer: 5700, brutto: 35700, rechnungsdatum: "2026-02-01", anlage_id: "ag-1" }] };
  const { zeilen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  assert.equal(zeilen.length, 0);
});

test("buchungszeilen: Stornobeleg (negativ) → Soll/Haben getauscht, Umsatz positiv", () => {
  const daten = { Ausgangsrechnung: [{ id: "ar-3", status: "storniert", nummer: "ST-2026-001", rechnungsdatum: "2026-02-15",
    netto: -500, ust_satz: 19, ust: -95, brutto: -595, empfaenger: { name: "Bauherr Beispiel" } }] };
  const { zeilen } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: EINST, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  const felder = zeilen[0].split(";");
  assert.equal(felder[0], "595,00", "Umsatz immer positiv");
  assert.equal(felder[1], '"H"');
});

test("buchungszeilen: Debitorenkonten je Bauherr fortlaufend ab 10000, bereits bekannte werden wiederverwendet", () => {
  const daten = { Ausgangsrechnung: [
    { id: "ar-a", status: "gestellt", nummer: "RE-1", rechnungsdatum: "2026-01-10", netto: 100, ust_satz: 19, ust: 19, brutto: 119, empfaenger: { name: "Bauherr A" } },
    { id: "ar-b", status: "gestellt", nummer: "RE-2", rechnungsdatum: "2026-01-11", netto: 100, ust_satz: 19, ust: 19, brutto: 119, empfaenger: { name: "Bauherr B" } },
    { id: "ar-a2", status: "gestellt", nummer: "RE-3", rechnungsdatum: "2026-01-12", netto: 100, ust_satz: 19, ust: 19, brutto: 119, empfaenger: { name: "Bauherr A" } },
  ] };
  const einstMitKonto = wirksameEinstellungen({ datev: { berater: "1001", mandant: "456", personenkonten: { "debitor:Bauherr A": 10005 } } });
  const { zeilen, personenkontenNeu } = buchungszeilen(daten, { von: "2026-01-01", bis: "2026-03-31", einst: einstMitKonto, kontenrahmen: SAETZE.kontenrahmen.SKR03 });
  assert.equal(zeilen[0].split(";")[6], "10005", "bereits bekanntes Konto wird wiederverwendet");
  assert.equal(zeilen[1].split(";")[6], "10000", "erstes freies Konto für einen neuen Bauherrn");
  assert.equal(zeilen[2].split(";")[6], "10005", "derselbe Bauherr bekommt dasselbe Konto innerhalb des Stapels");
  assert.deepEqual(personenkontenNeu, { "debitor:Bauherr B": 10000 });
});

// --- T5: Sperrgründe -----------------------------------------------------------------------

test("pruefe: ohne Beraternummer/Mandantennummer gesperrt", () => {
  assert.deepEqual(pruefe({}, "2026-01-01", "2026-03-31"), ["berater_fehlt", "mandant_fehlt"]);
  assert.deepEqual(pruefe({ berater: "1001", mandant: "456" }, "2026-01-01", "2026-03-31"), []);
  assert.equal(sperrgrundText("berater_fehlt", (s) => s), "Beraternummer fehlt");
});

test("pruefe: Zeitraum 2026-12-01 bis 2027-01-31 überschreitet das Wirtschaftsjahr", () => {
  const gruende = pruefe({ berater: "1001", mandant: "456", wjBeginn: "01-01" }, "2026-12-01", "2027-01-31");
  assert.ok(gruende.includes("zeitraum_wirtschaftsjahr"));
});

// --- Kontenrahmen-Schalter (E-11) ----------------------------------------------------------

test("KONTENRAHMEN: SKR03 Standard ohne Annahme-Marke an der Kontenzuordnung selbst, SKR04 als zweites Preset mit Annahme-Marke", () => {
  assert.equal(KONTENRAHMEN.SKR04[0].annahme, true);
  assert.equal(SAETZE.kontenrahmen.SKR03.erloese_19, 8400);
  assert.equal(SAETZE.kontenrahmen.SKR04.erloese_19, 4400);
});

// --- CP1252-Kodierung (79-03, geteilter Kern) ----------------------------------------------

test("exportiere: „€“ → 0x80, „–“ → 0x96, „„“ → 0x84, „ä“ → 0xE4, „✓“ → „?“ mit Warnung, CRLF-Zeilenenden", () => {
  const daten = { Ausgangsrechnung: [{ id: "ar-cp", status: "gestellt", nummer: "RE-2026-099", rechnungsdatum: "2026-02-01",
    netto: 100, ust_satz: 19, ust: 19, brutto: 119, empfaenger: { name: "Bauherr Beispiel" },
    project_name: 'Muster „Gerät" – 1 € Pauschale ✓' }] };
  const { bytes, warnungen } = exportiere({
    daten, einst: EINST, saetze: SAETZE, von: "2026-01-01", bis: "2026-03-31",
    exportiertVon: "Beispiel Architekturbüro", zeitstempel: "20260327120000000",
  });
  assert.ok(Array.from(bytes).includes(0x80), "€ als 0x80");
  assert.ok(Array.from(bytes).includes(0x96), "– als 0x96");
  assert.ok(Array.from(bytes).includes(0x84), "„ als 0x84");
  assert.ok(Array.from(bytes).includes(0xe4), "ä als 0xE4");
  assert.equal(warnungen.ersetzt, 1, "✓ ist nicht darstellbar → ein Ersatzzeichen");
  assert.ok(Buffer.from(bytes).includes(Buffer.from([0x0d, 0x0a])), "CRLF vorhanden");
  assert.ok(bytes[0] === 0x22, "beginnt mit dem Kopf (\"EXTF…)");
});

// --- Golden file -----------------------------------------------------------------------------

test("exportiere: Golden-File byte-identisch (neutrale Daten, injizierter Zeitstempel)", () => {
  const daten = { Ausgangsrechnung: [{
    id: "ar-golden-1", status: "gestellt", nummer: "RE-2026-014", rechnungsdatum: "2026-03-05",
    netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900, empfaenger: { name: "Bauherr Beispiel" },
  }], Eingangsrechnung: [] };
  const einst = wirksameEinstellungen({ datev: { berater: "1001", mandant: "456" } });
  const { bytes, dateiname } = exportiere({
    daten, einst, saetze: SAETZE, von: "2026-01-01", bis: "2026-03-31",
    exportiertVon: "Beispiel Architekturbüro", zeitstempel: "20260327120000000",
  });
  const golden = fs.readFileSync(GOLDEN_PFAD);
  assert.deepEqual(Buffer.from(bytes), golden);
  assert.equal(dateiname, "EXTF_Buchungsstapel_2026-01-01_2026-03-31.csv");
});
