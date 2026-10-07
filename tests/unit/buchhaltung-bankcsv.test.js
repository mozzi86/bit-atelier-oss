// Unit tests of the bank CSV import (79-07 T1/T2, BUCH-11): amount and date
// parsing, header-line search, profile detection, the six fixture bank
// exports, and the reimport fingerprint — every <behavior> figure of
// 79-07-PLAN.md that concerns bankCsv.js.
//
// In:  src/lib/accounting/bankCsv.js. Out: assertions only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  BANK_PROFILE, betragCent, datumIso, eigenesProfil, erkenneProfil, findeKopfzeile, fingerabdruck, neueUmsaetze, normZweck,
  umsaetzeAus,
} from "@/lib/accounting/bankCsv.js";
import { dekodiere } from "@/lib/accounting/csv.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/buchhaltung/bank");

describe("betragCent: German and English amount text (T1)", () => {
  test('de: "1.234,56" -> 123456, "-12,5" -> -1250', () => {
    assert.equal(betragCent("1.234,56", "de"), 123456);
    assert.equal(betragCent("-12,5", "de"), -1250);
  });
  test('en: "1,234.56" -> 123456', () => {
    assert.equal(betragCent("1,234.56", "en"), 123456);
  });
  test("plain integers and a leading + are read in both formats", () => {
    assert.equal(betragCent("50", "de"), 5000);
    assert.equal(betragCent("+50,00", "de"), 5000);
    assert.equal(betragCent("50.00", "en"), 5000);
  });
  test("not an amount -> null (no silent guess)", () => {
    assert.equal(betragCent("keine Zahl", "de"), null);
    assert.equal(betragCent("", "de"), null);
    assert.equal(betragCent(undefined, "en"), null);
  });
});

describe("datumIso: three date formats (T1)", () => {
  test('"tt.mm.jj" -> 20xx (Sparkasse CAMT V2)', () => {
    assert.equal(datumIso("31.12.25", "tt.mm.jj"), "2025-12-31");
  });
  test('"tt.mm.jjjj" full year', () => {
    assert.equal(datumIso("01.09.2026", "tt.mm.jjjj"), "2026-09-01");
  });
  test('"jjjj-mm-tt" already ISO (N26)', () => {
    assert.equal(datumIso("2026-09-01", "jjjj-mm-tt"), "2026-09-01");
  });
  test("an impossible calendar date is refused, not silently corrected", () => {
    assert.equal(datumIso("30.02.2026", "tt.mm.jjjj"), null);
  });
  test("a 4-digit year given to the 2-digit format (and vice versa) is refused", () => {
    assert.equal(datumIso("01.09.2026", "tt.mm.jj"), null);
    assert.equal(datumIso("01.09.26", "tt.mm.jjjj"), null);
  });
});

describe("findeKopfzeile: skips preamble to the Buchungstag/-datum + Betrag row (T1)", () => {
  test("header on the first line", () => {
    assert.equal(findeKopfzeile(["Buchungstag;Betrag", "01.09.2026;10,00"]), 0);
  });
  test("DKB: header after 4 preamble lines", () => {
    const text = dekodiere(fs.readFileSync(path.join(FIXTURES, "dkb.csv")));
    assert.equal(findeKopfzeile(text.split(/\r?\n/)), 4);
  });
  test("no matching line -> -1", () => {
    assert.equal(findeKopfzeile(["nur Vorspann", "noch mehr Vorspann"]), -1);
  });
});

describe("erkenneProfil: identifies the six fixture dialects, unaffected by ING's duplicate \"Währung\" (T1)", () => {
  const FAELLE = {
    "sparkasse-camt-v2.csv": "sparkasse-camt-v2",
    "vr-bank.csv": "vr-gls-sparda",
    "dkb.csv": "dkb",
    "ing.csv": "ing",
    "postbank-soll-haben.csv": "postbank-deutschebank",
    "n26.csv": "n26",
  };
  for (const [datei, erwartet] of Object.entries(FAELLE)) {
    test(`${datei} -> ${erwartet}`, () => {
      const text = dekodiere(fs.readFileSync(path.join(FIXTURES, datei)));
      const zeilen = text.split(/\r?\n/);
      const kopf = zeilen[findeKopfzeile(zeilen)];
      assert.equal(erkenneProfil(kopf), erwartet);
    });
  }
  test("an unrecognisable header returns null (falls back to manual mapping)", () => {
    assert.equal(erkenneProfil("Spalte A;Spalte B;Spalte C"), null);
  });
});

describe("umsaetzeAus: all six fixtures parse to the same six transactions (T1 done-criterion)", () => {
  // [buchungstag, betrag(€), zweck, gegenpartei, iban] — the canonical set every fixture encodes in its own dialect.
  const KANONISCH = [
    ["2026-09-01", 11900.00, "RE-2026 -014 Abschlag", "Beispiel Bauherr GmbH", "DE89370400440532013000"],
    ["2026-09-03", -650.00, "Miete Büro September", "Müller Hausverwaltung", "DE12500105170648489890"],
    ["2026-09-05", -280.00, "Beitrag Versicherung Police BH-000001", "Beispiel Versicherung AG", "DE27100777770209299700"],
    ["2026-09-08", -1900.00, "USt-Vorauszahlung Q2 2026", "Finanzamt Musterstadt", "DE02120300000000202051"],
    ["2026-09-10", -2000.00, "Privatentnahme September", "Inhaberin A", "DE89370400440532013099"],
    ["2026-09-12", 4800.00, "RE2026014 Restzahlung", "Beispiel Bauherr GmbH", "DE89370400440532013000"],
  ];
  const FAELLE = {
    "sparkasse-camt-v2.csv": "sparkasse-camt-v2",
    "vr-bank.csv": "vr-gls-sparda",
    "dkb.csv": "dkb",
    "ing.csv": "ing",
    "postbank-soll-haben.csv": "postbank-deutschebank",
    "n26.csv": "n26",
  };
  for (const [datei, profil] of Object.entries(FAELLE)) {
    test(`${datei} (Profil ${profil}) liefert die sechs kanonischen Umsätze`, () => {
      const bytes = fs.readFileSync(path.join(FIXTURES, datei));
      const umsaetze = umsaetzeAus(bytes, profil);
      assert.equal(umsaetze.length, 6);
      umsaetze.forEach((u, i) => {
        const [datum, betrag, zweck, gegenpartei, iban] = KANONISCH[i];
        assert.equal(u.buchungstag, datum, `Zeile ${i}: buchungstag`);
        assert.equal(u.betrag, betrag, `Zeile ${i}: betrag`);
        assert.equal(u.zweck, zweck, `Zeile ${i}: zweck`);
        assert.equal(u.gegenpartei, gegenpartei, `Zeile ${i}: gegenpartei`);
        if (profil !== "ing") assert.equal(u.iban, iban, `Zeile ${i}: iban`); // ING's layout has no IBAN column
      });
    });
  }
  test("Sparkasse (windows-1252): „Müller” decodes correctly, not file.text()'s mojibake", () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, "sparkasse-camt-v2.csv"));
    const umsaetze = umsaetzeAus(bytes, "sparkasse-camt-v2");
    assert.equal(umsaetze[1].gegenpartei, "Müller Hausverwaltung");
  });
  test("unknown profile name throws plain text", () => {
    assert.throws(() => umsaetzeAus(new Uint8Array(), "unbekannt"), /unbekanntes Profil/);
  });
  test("a body row with an unreadable amount throws plain text (not swallowed)", () => {
    const bytes = Buffer.from("Buchungstag;Betrag;Verwendungszweck\r\n01.09.2026;keine Zahl;Test\r\n", "utf8");
    assert.throws(() => umsaetzeAus(bytes, "generisch"), /unlesbar/);
  });
});

describe("eigenesProfil: a manual SpaltenZuordnung mapping becomes a usable BankProfil (T1, T6)", () => {
  test("round-trips through umsaetzeAus", () => {
    const profil = eigenesProfil({
      name: "Testbank",
      trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj",
      spalten: { datum: 0, betrag: 1, zweck: 2, gegenpartei: 3, iban: 4 },
    });
    const bytes = Buffer.from("Datum;Betrag;Zweck;Gegenpartei;IBAN\r\n01.09.2026;-42,00;Test;Jemand;DE00\r\n", "utf8");
    const [u] = umsaetzeAus(bytes, profil);
    assert.equal(u.betrag, -42);
    assert.equal(u.gegenpartei, "Jemand");
  });
  test("BANK_PROFILE lists all nine dialects the plan names", () => {
    assert.deepEqual(Object.keys(BANK_PROFILE).sort(), [
      "commerzbank", "dkb", "generisch", "ing", "n26", "postbank-deutschebank", "sparkasse-camt-v2", "vr-alt", "vr-gls-sparda",
    ]);
  });
});

describe("Fingerprint and reimport dedup (T2)", () => {
  test("normZweck collapses whitespace and upper-cases", () => {
    assert.equal(normZweck("  Miete   Büro  September "), "MIETE BÜRO SEPTEMBER");
  });
  test("fingerabdruck differs only by the occurrence index for otherwise identical lines", () => {
    const u = { buchungstag: "2026-09-01", betrag: -10, zweck: "Kartenzahlung", iban: "DE01" };
    assert.notEqual(fingerabdruck(u, 0), fingerabdruck(u, 1));
  });
  test("neueUmsaetze: reimport of the exact same file gives 0 new transactions", () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, "n26.csv"));
    const importiert = umsaetzeAus(bytes, "n26");
    const ersterImport = neueUmsaetze([], importiert, "import-1");
    assert.equal(ersterImport.neu.length, 6);
    assert.equal(ersterImport.dubletten.length, 0);
    const zweiterImport = neueUmsaetze(ersterImport.neu, importiert, "import-2");
    assert.equal(zweiterImport.neu.length, 0, "0 neue Umsätze beim Reimport");
    assert.equal(zweiterImport.dubletten.length, 6);
  });
  test("two identical bookings on the same day in one file stay two separate transactions", () => {
    const gleich = { buchungstag: "2026-09-01", betrag: -18.90, zweck: "Kartenzahlung Bürobedarf", gegenpartei: "Laden", iban: "DE01" };
    const { neu } = neueUmsaetze([], [gleich, { ...gleich }], "import-1");
    assert.equal(neu.length, 2);
    assert.notEqual(neu[0].hash, neu[1].hash);
  });
});
