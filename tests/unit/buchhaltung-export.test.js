// Unit tests of CSV and table export (79-01 T6): the writer rules for German
// spreadsheet programs incl. the formula-injection guard, the quote- and
// multi-line-safe parser, charset fallback for bank exports and the XLSX
// round trip through the independent reader leseArbeitsmappe.
//
// In:  src/lib/accounting/csv.js, tabellenExport.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { csvText, dekodiere, erkenneTrenner, parseCsv } from "@/lib/accounting/csv.js";
import { dateiname, tabelleAlsCsv, tabellenAlsXlsx } from "@/lib/accounting/tabellenExport.js";
import { formelzahl, leseArbeitsmappe, zellwert } from "@ava/lib/xlsxRead.js";

const MODELL = {
  titel: "Ausgangsrechnungen",
  spalten: [
    { key: "nummer", label: "Nummer", typ: "text" },
    { key: "datum", label: "Datum", typ: "datum" },
    { key: "betrag", label: "Betrag", typ: "betrag" },
    { key: "notiz", label: "Notiz", typ: "text" },
  ],
  zeilen: [
    { nummer: "RE-2026-001", datum: "2026-09-27", betrag: 1234.5, notiz: "=SUMME(A1)" },
    { nummer: "RE-2026-002", datum: "2026-09-28", betrag: -12.5, notiz: "Zeile\nzwei; mit \"Zitat\"" },
    { nummer: "+49 000", datum: null, betrag: null, notiz: "@Mail" },
  ],
};

test("csvText: BOM, Semikolon, CRLF, Dezimalkomma, dd.mm.yyyy, Formelschutz nur für Text", () => {
  const text = csvText(MODELL);
  assert.ok(text.startsWith("\uFEFF"), "BOM");
  const zeilen = text.slice(1).split("\r\n");
  assert.equal(zeilen[0], "Nummer;Datum;Betrag;Notiz");
  assert.equal(zeilen[1], "RE-2026-001;27.09.2026;1234,50;'=SUMME(A1)");
  assert.ok(zeilen[2].startsWith("RE-2026-002;28.09.2026;-12,50;"), "negative Zahl ohne Apostroph");
  assert.ok(text.includes('"Zeile\nzwei; mit ""Zitat"""'), "Feld mit Umbruch/Trenner/Quote gequotet");
  assert.ok(text.includes("'+49 000;;;'@Mail"), "Text mit + und @ geschützt, leere Felder leer");
  assert.ok(text.endsWith("\r\n"));
  assert.equal(tabelleAlsCsv(MODELL), text);
});

test("parseCsv: Umbruch in Quotes bleibt ein Feld, Trenner wählbar, BOM weg", () => {
  const zeilen = parseCsv(csvText(MODELL));
  assert.equal(zeilen.length, 4);
  assert.equal(zeilen[2][3], 'Zeile\nzwei; mit "Zitat"');
  assert.deepEqual(parseCsv("a,b\r\n\"1,5\",2\n", { trenner: "," }), [["a", "b"], ["1,5", "2"]]);
  assert.deepEqual(parseCsv(""), []);
});

test("erkenneTrenner: Semikolon, Komma, Tab", () => {
  assert.equal(erkenneTrenner("a;b;c\n1;2;3"), ";");
  assert.equal(erkenneTrenner("a,b,c\n1,2,3"), ",");
  assert.equal(erkenneTrenner("a\tb\n1\t2"), "\t");
  assert.equal(erkenneTrenner('"x;y",b,c\n1,2,3'), ",", "Trenner in Quotes zählen nicht");
});

test("dekodiere: windows-1252 als Rückfall, UTF-8 mit BOM", () => {
  assert.equal(dekodiere(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72])), "Müller");
  assert.equal(dekodiere(new TextEncoder().encode("\uFEFFMüller")), "Müller");
  assert.equal(dekodiere(new Uint8Array([0x80]).buffer), "€");
});

test("XLSX-Roundtrip: Blattname, Zahlen unverändert, Datum als Serie 46292, keine Formeln", () => {
  const mappe = leseArbeitsmappe(tabellenAlsXlsx([MODELL, { ...MODELL, titel: "Zweites Blatt" }]));
  assert.deepEqual(mappe.blattNamen, ["Ausgangsrechnungen", "Zweites Blatt"]);
  const blatt = mappe.blaetter[0];
  assert.equal(zellwert(blatt, "A1"), "Nummer");
  assert.equal(zellwert(blatt, "A2"), "RE-2026-001");
  assert.equal(zellwert(blatt, "B2"), 46292);
  assert.equal(zellwert(blatt, "C2"), 1234.5);
  assert.equal(zellwert(blatt, "C3"), -12.5);
  assert.equal(zellwert(blatt, "D2"), "'=SUMME(A1)");
  assert.equal(zellwert(blatt, "B4"), null, "leeres Datum bleibt leer");
  assert.equal(formelzahl(blatt), 0);
  assert.throws(() => tabellenAlsXlsx([]), /keine Tabelle/);
});

test("dateiname: bereich-jahr.endung, dateisystemfest", () => {
  assert.equal(dateiname("Ausgangsrechnungen", 2026, "csv"), "buchhaltung-ausgangsrechnungen-2026.csv");
  assert.equal(dateiname("Jahresübersicht / EÜR", 2026, ".xlsx"), "buchhaltung-jahresuebersicht-euer-2026.xlsx");
});
