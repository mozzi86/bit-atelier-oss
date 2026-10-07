// Unit tests of bank reconciliation (79-07 T3, BUCH-11): candidate matching
// (automatic ONLY on invoice number in the purpose text AND exact open
// amount), applying and undoing a match, and the consistency check — every
// <behavior> figure of 79-07-PLAN.md that concerns abgleich.js.
//
// In:  src/lib/accounting/abgleich.js. Out: assertions only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { autoZuordnen, bankTabelle, kandidaten, konsistenz, normNummer, zuordnungAnwenden, zuordnungLoesen } from "@/lib/accounting/abgleich.js";

/** A minimal issued invoice, open for its full gross amount unless payments are given. */
function rechnung(overrides = {}) {
  return { id: "ar-1", status: "gestellt", nummer: "RE-2026-014", brutto: 11900, zahlungen: [], ...overrides };
}

describe("normNummer: SEPA line-wrap space and hyphens removed, upper case (T3)", () => {
  test('"RE-2026 -014" and "RE2026014" normalise to the same text', () => {
    assert.equal(normNummer("RE-2026 -014"), normNummer("RE2026014"));
    assert.equal(normNummer("RE-2026 -014"), "RE2026014");
  });
});

describe("kandidaten: outgoing invoices (T3, behavior)", () => {
  test('Zweck "RE-2026 -014 Abschlag" +11.900,00 €, RE-2026-014 offen über genau diesen Betrag -> sicher', () => {
    const daten = { Ausgangsrechnung: [rechnung()] };
    const umsatz = { betrag: 11900, zweck: "RE-2026 -014 Abschlag", gegenpartei: "Beispiel Bauherr GmbH" };
    const [k] = kandidaten(umsatz, daten);
    assert.deepEqual(k, { typ: "Ausgangsrechnung", id: "ar-1", grund: "nummer_und_betrag", sicher: true });
  });
  test("+11.899,99 € (ein Cent zu wenig) -> nur Vorschlag „Betrag weicht ab“", () => {
    const daten = { Ausgangsrechnung: [rechnung()] };
    const umsatz = { betrag: 11899.99, zweck: "RE-2026 -014 Abschlag", gegenpartei: "x" };
    const [k] = kandidaten(umsatz, daten);
    assert.equal(k.sicher, false);
    assert.equal(k.grund, "nummer");
  });
  test("Betrag allein passt, keine Nummer im Zweck -> nur Vorschlag", () => {
    const daten = { Ausgangsrechnung: [rechnung()] };
    const umsatz = { betrag: 11900, zweck: "Gutschrift ohne Verwendungszweck", gegenpartei: "x" };
    const [k] = kandidaten(umsatz, daten);
    assert.equal(k.sicher, false);
    assert.equal(k.grund, "betrag");
  });
  test("zwei offene Rechnungen mit gleichem Betrag, keine Nummer im Zweck -> zwei Vorschläge, keiner sicher", () => {
    const daten = { Ausgangsrechnung: [rechnung({ id: "ar-1" }), rechnung({ id: "ar-2", nummer: "RE-2026-020" })] };
    const umsatz = { betrag: 11900, zweck: "Gutschrift", gegenpartei: "x" };
    const ks = kandidaten(umsatz, daten);
    assert.equal(ks.length, 2);
    assert.ok(ks.every((k) => !k.sicher));
  });
  test("eine bereits bezahlte (offen = 0) Rechnung erscheint nicht als Kandidat", () => {
    const daten = { Ausgangsrechnung: [rechnung({ zahlungen: [{ datum: "2026-09-01", betrag: 11900 }] })] };
    assert.deepEqual(kandidaten({ betrag: 11900, zweck: "RE-2026-014", gegenpartei: "x" }, daten), []);
  });
  test("ein Entwurf (nicht gestellt) ist nie Kandidat", () => {
    const daten = { Ausgangsrechnung: [rechnung({ status: "entwurf" })] };
    assert.deepEqual(kandidaten({ betrag: 11900, zweck: "RE-2026-014", gegenpartei: "x" }, daten), []);
  });
});

describe("kandidaten: incoming invoice, tax payment, drawing — always a proposal (T3, behavior)", () => {
  test("−6.800,00 € an „Beispiel Versicherung AG“ mit Police im Zweck, Eingangsrechnung brutto 6.800,00 € -> Vorschlag", () => {
    const daten = { Eingangsrechnung: [{ id: "er-1", lieferant: "Beispiel Versicherung AG", brutto: 6800, bezahlt_am: null }] };
    const umsatz = { betrag: -6800, zweck: "Beitrag Police BH-000001", gegenpartei: "Beispiel Versicherung AG" };
    assert.deepEqual(kandidaten(umsatz, daten), [{ typ: "Eingangsrechnung", id: "er-1", grund: "lieferant", sicher: false }]);
  });
  test("Eingangsrechnung matched also by fremd_nr in the purpose text, not just the counterparty name", () => {
    const daten = { Eingangsrechnung: [{ id: "er-2", lieferant: "Andere Firma", fremd_nr: "F-901", brutto: 500, bezahlt_am: null }] };
    const umsatz = { betrag: -500, zweck: "Rechnung F-901", gegenpartei: "Andere Firma AG" };
    const [k] = kandidaten(umsatz, daten);
    assert.equal(k.grund, "fremdnummer");
    assert.equal(k.sicher, false);
  });
  test('−15.000,00 € an „Finanzamt Musterstadt“, offene Steuerzahlung USt Q3 über 15.000,00 € -> Vorschlag', () => {
    const daten = { Steuerzahlung: [{ id: "st-1", art: "ust", betrag: 15000, bezahlt_am: null }] };
    const umsatz = { betrag: -15000, zweck: "USt-Vorauszahlung Q3", gegenpartei: "Finanzamt Musterstadt" };
    assert.deepEqual(kandidaten(umsatz, daten), [{ typ: "Steuerzahlung", id: "st-1", grund: "finanzamt", sicher: false }]);
  });
  test("eine Zahlung an ein Konto ohne \"Finanzamt\" im Namen ist nie ein Steuerzahlungs-Kandidat", () => {
    const daten = { Steuerzahlung: [{ id: "st-1", art: "ust", betrag: 15000, bezahlt_am: null }] };
    const umsatz = { betrag: -15000, zweck: "USt-Vorauszahlung Q3", gegenpartei: "Musterbank" };
    assert.deepEqual(kandidaten(umsatz, daten), []);
  });
  test("Gegenpartei-IBAN = Gesellschafter-IBAN -> nur Vorschlag „Entnahme“", () => {
    const daten = { Gesellschafter: [{ id: "g-1", aktiv: true, iban: "DE89 3704 0044 0532 0130 99" }] };
    const umsatz = { betrag: -2000, zweck: "Privatentnahme", gegenpartei: "Inhaberin A", iban: "DE89370400440532013099" };
    assert.deepEqual(kandidaten(umsatz, daten), [{ typ: "Entnahme", id: "g-1", grund: "gesellschafter_iban", sicher: false }]);
  });
});

describe("autoZuordnen: only unique sicher candidates are assigned (T3)", () => {
  test("genau ein sicherer Kandidat wird automatisch zugeordnet, die Rechnung ist danach bezahlt", () => {
    const daten = { Bankumsatz: [{ id: "bu-1", buchungstag: "2026-09-01", betrag: 11900, zweck: "RE-2026-014", gegenpartei: "x", status: "offen" }],
      Ausgangsrechnung: [rechnung()] };
    const writes = autoZuordnen(daten);
    const bankWrite = writes.find((w) => w.entitaet === "Bankumsatz");
    const rechnungWrite = writes.find((w) => w.entitaet === "Ausgangsrechnung");
    assert.equal(bankWrite.obj.status, "zugeordnet");
    assert.equal(bankWrite.obj.zuordnung.modus, "auto");
    assert.equal(rechnungWrite.obj.zahlungen.length, 1);
    assert.equal(rechnungWrite.obj.zahlungen[0].bankumsatz_id, "bu-1");
  });
  test("mehrere sichere Kandidaten -> keine automatische Zuordnung (bleibt manuell)", () => {
    const daten = {
      Bankumsatz: [{ id: "bu-1", buchungstag: "2026-09-01", betrag: 11900, zweck: "RE-2026-014 RE-2026-020", gegenpartei: "x", status: "offen" }],
      Ausgangsrechnung: [rechnung({ id: "ar-1" }), rechnung({ id: "ar-2", nummer: "RE-2026-020" })],
    };
    assert.deepEqual(autoZuordnen(daten), []);
  });
  test("bereits zugeordnete oder ignorierte Umsätze werden nicht erneut geprüft", () => {
    const daten = {
      Bankumsatz: [{ id: "bu-1", buchungstag: "2026-09-01", betrag: 11900, zweck: "RE-2026-014", gegenpartei: "x", status: "ignoriert" }],
      Ausgangsrechnung: [rechnung()],
    };
    assert.deepEqual(autoZuordnen(daten), []);
  });
});

describe("zuordnungAnwenden / zuordnungLoesen (T3, behavior)", () => {
  test("zuordnungAnwenden auf eine Ausgangsrechnung schreibt beide Seiten", () => {
    const daten = { Ausgangsrechnung: [rechnung()] };
    const umsatz = { id: "bu-1", buchungstag: "2026-09-01", betrag: 11900 };
    const writes = zuordnungAnwenden(umsatz, { typ: "Ausgangsrechnung", id: "ar-1", modus: "manuell" }, daten);
    assert.deepEqual(writes, [
      { entitaet: "Ausgangsrechnung", obj: { id: "ar-1", zahlungen: [{ datum: "2026-09-01", betrag: 11900, bankumsatz_id: "bu-1" }] } },
      { entitaet: "Bankumsatz", obj: { id: "bu-1", status: "zugeordnet", zuordnung: { typ: "Ausgangsrechnung", id: "ar-1", modus: "manuell" } } },
    ]);
  });
  test("zuordnungAnwenden auf eine Entnahme legt einen neuen Datensatz mit deterministischer id an", () => {
    const daten = { Gesellschafter: [{ id: "g-1", aktiv: true, iban: "DE89370400440532013099" }] };
    const umsatz = { id: "bu-9", buchungstag: "2026-09-10", betrag: -2000 };
    const writes = zuordnungAnwenden(umsatz, { typ: "Entnahme", id: "g-1", modus: "manuell" }, daten);
    const entnahme = writes.find((w) => w.entitaet === "Entnahme");
    assert.deepEqual(entnahme.obj, { id: "bu:bu-9", gesellschafter_id: "g-1", datum: "2026-09-10", betrag: 2000, art: "ueberweisung", bankumsatz_id: "bu-9" });
  });
  test("ein unbekanntes Zuordnungsziel wirft im Klartext", () => {
    assert.throws(() => zuordnungAnwenden({ id: "bu-1" }, { typ: "Ausgangsrechnung", id: "fehlt" }, { Ausgangsrechnung: [] }), /nicht gefunden/);
  });
  test("zuordnungLoesen entfernt die Zahlung, die Rechnung ist wieder offen, der Umsatz wieder offen", () => {
    const r = rechnung({ zahlungen: [{ datum: "2026-09-01", betrag: 11900, bankumsatz_id: "bu-1" }] });
    const daten = { Ausgangsrechnung: [r] };
    const umsatz = { id: "bu-1", zuordnung: { typ: "Ausgangsrechnung", id: "ar-1" } };
    const writes = zuordnungLoesen(umsatz, daten);
    const rechnungWrite = writes.find((w) => w.entitaet === "Ausgangsrechnung");
    const bankWrite = writes.find((w) => w.entitaet === "Bankumsatz");
    assert.deepEqual(rechnungWrite.obj.zahlungen, []);
    assert.deepEqual(bankWrite.obj, { id: "bu-1", status: "offen", zuordnung: null });
  });
  test("zuordnungLoesen auf eine Eingangsrechnung setzt bezahlt_am zurück auf null", () => {
    const daten = { Eingangsrechnung: [{ id: "er-1", bezahlt_am: "2026-09-05" }] };
    const umsatz = { id: "bu-2", zuordnung: { typ: "Eingangsrechnung", id: "er-1" } };
    const writes = zuordnungLoesen(umsatz, daten);
    assert.equal(writes.find((w) => w.entitaet === "Eingangsrechnung").obj.bezahlt_am, null);
  });
});

describe("konsistenz: findet die drei Bruchstellen (T3, behavior)", () => {
  test("eine Zahlung mit bankumsatz_id, deren Bankumsatz nicht existiert", () => {
    const daten = { Ausgangsrechnung: [rechnung({ zahlungen: [{ datum: "2026-09-01", betrag: 11900, bankumsatz_id: "bu-fehlt" }] })], Bankumsatz: [] };
    const befunde = konsistenz(daten);
    assert.ok(befunde.some((b) => b.art === "zahlung_ohne_umsatz" && b.id === "ar-1"));
  });
  test("ein als zugeordnet markierter Umsatz ohne Gegenstück", () => {
    const daten = { Bankumsatz: [{ id: "bu-1", status: "zugeordnet", zuordnung: { typ: "Ausgangsrechnung", id: "ar-1" } }], Ausgangsrechnung: [rechnung({ zahlungen: [] })] };
    const befunde = konsistenz(daten);
    assert.ok(befunde.some((b) => b.art === "umsatz_ohne_gegenstueck" && b.bankumsatz_id === "bu-1"));
  });
  test("doppelt zugeordnet: zwei Bankumsätze beanspruchen dasselbe Ziel", () => {
    const r = rechnung({ zahlungen: [{ datum: "2026-09-01", betrag: 5000, bankumsatz_id: "bu-1" }, { datum: "2026-09-02", betrag: 6900, bankumsatz_id: "bu-2" }] });
    const daten = {
      Ausgangsrechnung: [r],
      Bankumsatz: [
        { id: "bu-1", status: "zugeordnet", zuordnung: { typ: "Ausgangsrechnung", id: "ar-1" } },
        { id: "bu-2", status: "zugeordnet", zuordnung: { typ: "Ausgangsrechnung", id: "ar-1" } },
      ],
    };
    const befunde = konsistenz(daten);
    assert.ok(befunde.some((b) => b.art === "doppelt_zugeordnet" && b.id === "ar-1" && b.anzahl === 2));
  });
  test("ein sauber zugeordneter Umsatz erzeugt keinen Befund", () => {
    const r = rechnung({ zahlungen: [{ datum: "2026-09-01", betrag: 11900, bankumsatz_id: "bu-1" }] });
    const daten = { Ausgangsrechnung: [r], Bankumsatz: [{ id: "bu-1", status: "zugeordnet", zuordnung: { typ: "Ausgangsrechnung", id: "ar-1" } }] };
    assert.deepEqual(konsistenz(daten), []);
  });
});

describe("bankTabelle: exportable table, filterable by status", () => {
  const t = (s) => s;
  const daten = {
    Bankumsatz: [
      { id: "bu-1", buchungstag: "2026-09-01", betrag: 11900, zweck: "z1", gegenpartei: "g1", status: "offen", zuordnung: null },
      { id: "bu-2", buchungstag: "2026-09-03", betrag: -650, zweck: "z2", gegenpartei: "g2", status: "zugeordnet", zuordnung: { typ: "Eingangsrechnung", id: "er-1" } },
    ],
    Eingangsrechnung: [{ id: "er-1", lieferant: "Müller" }],
  };
  test("„alle“ liefert beide Zeilen, neueste zuerst", () => {
    const modell = bankTabelle(daten, t, "alle");
    assert.equal(modell.zeilen.length, 2);
    assert.equal(modell.zeilen[0].buchungstag, "2026-09-03");
  });
  test("Filter „offen“ liefert nur den offenen Umsatz", () => {
    const modell = bankTabelle(daten, t, "offen");
    assert.equal(modell.zeilen.length, 1);
    assert.equal(modell.zeilen[0].buchungstag, "2026-09-01");
  });
  test("die Zuordnungs-Spalte nennt den Lieferanten der Eingangsrechnung", () => {
    const modell = bankTabelle(daten, t, "zugeordnet");
    assert.match(modell.zeilen[0].zuordnung, /Müller/);
  });
});
