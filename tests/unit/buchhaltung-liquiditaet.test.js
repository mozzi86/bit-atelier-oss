// Unit tests of the liquidity plan (79-10, BUCH-08/BUCH-18, D-P79-18):
// ereignisse() across all areas, the monthly balance (monatsModell), tax-day
// coverage and its warning window (steuerzahltage/spaetesterVersand), the
// "send invoices by" list (rechnungenRausBis), the status bar (lage) and the
// legal-form / VAT-switch behaviour (E-04/E-09) against beispielDaten.js.
//
// In:  src/lib/accounting/liquiditaet.js, beispielDaten.js, einstellungen.js, umsatzsteuer.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bueroSteuerarten, ereignisse, fristParameter, lage, liquiditaetTabelle, monatsModell, rechnungenRausBis,
  spaetesterVersand, startSaldo, steuerzahltage, ueberfaelligeForderungen,
} from "@/lib/accounting/liquiditaet.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { BUERO_STANDARD, saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { euroZuCent } from "@/lib/accounting/geld.js";
import { ustTermine } from "@/lib/accounting/umsatzsteuer.js";

const HEUTE = "2026-09-27";
const SAETZE = saetzeZum(HEUTE);
const EINZEL = wirksameEinstellungen({ zahlungsziel_tage: 14, puffer_tage: 7, warn_tage_rest: 7 });

/** @param {Partial<Record<string, any[]>>} teil */
const daten = (teil = {}) => ({
  Ausgangsrechnung: [], Eingangsrechnung: [], WiederkehrendeAusgabe: [], Versicherung: [], Steuerzahlung: [],
  Gesellschafter: [], Entnahme: [], Bankumsatz: [], Fahrzeug: [], Fahrt: [], Anlagegut: [], Beleg: [], ...teil,
});

test("spaetesterVersand: Bürostandard 14+7, und mit Ziel 30", () => {
  assert.equal(spaetesterVersand("2026-10-10", 14, 7), "2026-09-19");
  assert.equal(spaetesterVersand("2026-11-10", 14, 7), "2026-10-20");
  assert.equal(spaetesterVersand("2028-03-10", 14, 7), "2028-02-18");
  assert.equal(spaetesterVersand("2027-01-10", 14, 7), "2026-12-20");
  assert.equal(spaetesterVersand("2026-10-10", 30, 7), "2026-09-03");
});

test("monatsModell: Saldo-Kette — Start 20.000 €, Januar +15.000/-8.000/-5.000 → Ende 22.000,00 €, Februar startet dort", () => {
  const einst = wirksameEinstellungen({ kontostand_start: { 2026: { betrag: 20000, datum: "2026-01-01" } } });
  const d = daten({
    Ausgangsrechnung: [{ id: "a1", status: "gestellt", brutto: 15000, faellig_am: "2026-01-05", zahlungen: [{ datum: "2026-01-05", betrag: 15000 }] }],
    Eingangsrechnung: [{ id: "e1", brutto: 8000, bezahlt_am: "2026-01-10", faellig_am: "2026-01-10" }],
    Gesellschafter: [{ id: "g1", aktiv: true, entnahme_plan_monat: 0 }],
    Entnahme: [{ id: "n1", gesellschafter_id: "g1", datum: "2026-01-15", betrag: 5000 }],
  });
  const modell = monatsModell({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(modell[0].saldoEndeCent, euroZuCent(22000), "Ende Januar 22.000,00 €");
  assert.equal(modell[1].saldoAnfangCent, modell[0].saldoEndeCent, "Februar startet bei Endsaldo Januar");
});

test("steuerzahltage: Deckung — Start 10.000 €, Steuer 12.000 € fällig 10.03., Eingang 3.000 € am 10.03. → gedeckt, Saldo 1.000,00 €", () => {
  const einst = wirksameEinstellungen({
    rechtsform: "einzelunternehmen", kontostand_start: { 2026: { betrag: 10000, datum: "2026-01-01" } },
    vorauszahlungen: { 2026: { est: [12000, 0, 0, 0] } }, ust_zeitraum: "jahr",
  });
  const d = daten({
    Ausgangsrechnung: [{ id: "a1", status: "gestellt", brutto: 3000, faellig_am: "2026-03-10", zahlungen: [{ datum: "2026-03-10", betrag: 3000 }] }],
  });
  const tage = steuerzahltage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const q1 = tage.find((t) => t.nenn === "2026-03-10");
  assert.equal(q1.gedeckt, true);
  assert.equal(q1.saldoAm, euroZuCent(1000));
});

test("steuerzahltage: Deckung fehlt, wenn der Eingang erst am 11.03. kommt → Saldo -2.000,00 €", () => {
  const einst = wirksameEinstellungen({
    rechtsform: "einzelunternehmen", kontostand_start: { 2026: { betrag: 10000, datum: "2026-01-01" } },
    vorauszahlungen: { 2026: { est: [12000, 0, 0, 0] } }, ust_zeitraum: "jahr",
  });
  const d = daten({
    Ausgangsrechnung: [{ id: "a1", status: "gestellt", brutto: 3000, faellig_am: "2026-03-11", zahlungen: [{ datum: "2026-03-11", betrag: 3000 }] }],
  });
  const tage = steuerzahltage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const q1 = tage.find((t) => t.nenn === "2026-03-10");
  assert.equal(q1.gedeckt, false);
  assert.equal(q1.saldoAm, euroZuCent(-2000));
});

test("ereignisse/steuerzahltage: eine überfällige Forderung über 20.000 € deckt keinen Steuertermin", () => {
  const einst = wirksameEinstellungen({
    rechtsform: "einzelunternehmen", kontostand_start: { 2026: { betrag: 0, datum: "2026-01-01" } },
    vorauszahlungen: { 2026: { est: [1000, 0, 0, 0] } }, ust_zeitraum: "jahr",
  });
  const d = daten({
    Ausgangsrechnung: [{ id: "a1", status: "gestellt", brutto: 20000, faellig_am: "2026-01-01", zahlungen: [] }],
  });
  const tage = steuerzahltage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const q1 = tage.find((t) => t.nenn === "2026-03-10");
  assert.equal(q1.gedeckt, false, "die überfällige Forderung darf die Steuer nicht decken");
});

test("steuerzahltage: fehlt der ESt-Betrag eines Quartals → Marke gezeichnet, 'Betrag fehlt' (null), kein NaN", () => {
  const einst = wirksameEinstellungen({ rechtsform: "einzelunternehmen", vorauszahlungen: {}, ust_zeitraum: "jahr" });
  const tage = steuerzahltage({ daten: daten(), einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const q1 = tage.find((t) => t.nenn === "2026-03-10");
  assert.ok(q1, "Marke ist trotzdem da");
  assert.equal(q1.betragCent, null);
  assert.equal(Number.isNaN(q1.saldoAm), false);
});

test("Warnung: heute 2026-09-15, Frist 19.09. zum Termin 10.10. → 'knapp' (restTage 4)", () => {
  const einst = wirksameEinstellungen({ rechtsform: "einzelunternehmen", vorauszahlungen: {}, ust_zeitraum: "quartal", zahlungsziel_tage: 14, puffer_tage: 7, warn_tage_rest: 7 });
  const tage = steuerzahltage({ daten: daten(), einst, saetze: SAETZE, jahr: 2026, heute: "2026-09-15" });
  const q3ust = tage.find((t) => t.nenn === "2026-10-10");
  assert.equal(q3ust.spaetesterVersand, "2026-09-19");
  assert.equal(q3ust.restTage, 4);
  assert.equal(q3ust.warnung, "knapp");
});

test("Rechnungen-raus-Liste: heute 2026-09-21, Termin (USt Q3, Frist 19.09. bereits vorbei) ungedeckt, Rechnung noch geplant → 'ueberschritten'", () => {
  const einst = wirksameEinstellungen({
    rechtsform: "einzelunternehmen", kontostand_start: { 2026: { betrag: 0, datum: "2026-01-01" } },
    ust_zeitraum: "quartal", dauerfrist: false, versteuerung: "soll", zahlungsziel_tage: 14, puffer_tage: 7,
  });
  const d = daten({ Ausgangsrechnung: [
    // Soll-Versteuerung: USt owed by invoice date, unpaid — a liability with no matching cash yet.
    { id: "a0", status: "gestellt", netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900, rechnungsdatum: "2026-08-05", faellig_am: "2026-08-19", zahlungen: [] },
    { id: "a1", status: "geplant", brutto: 1000, versand_geplant_am: "2026-09-25", zahlungen: [] },
  ] });
  const liste = rechnungenRausBis({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: "2026-09-21" });
  const q3 = liste.find((e) => e.datum === "2026-10-10");
  assert.ok(q3, "USt Q3 (ohne DFV) am 10.10.2026 steht in der Liste");
  assert.equal(q3.gedeckt, false, "kein Kontostand hinterlegt, keine Deckung");
  assert.equal(q3.spaetesterVersand, "2026-09-19");
  const zeile = q3.rechnungen.find((r) => r.id === "a1");
  assert.equal(zeile?.warnung, "ueberschritten");
});

test("USt-Marken folgen dem Schalter (E-09): Monat+DFV → 13 USt-Termine (12 VA + SVZ) an 12 Tagen, USt-VA Januar am 10.03.; Quartal ohne DFV → nur 10.01./10.04./10.07./10.10.; keine Voranmeldung → nur die 4 ESt", () => {
  const basis = { rechtsform: "einzelunternehmen", vorauszahlungen: { 2026: { est: [9000, 9000, 9000, 9000] } }, ust_vorjahr_zahllast: { 2025: 26400 } };
  const bsp = beispielDatensaetze(HEUTE);
  const d = daten({ Ausgangsrechnung: bsp.Ausgangsrechnung, Eingangsrechnung: bsp.Eingangsrechnung });

  const einstMonat = wirksameEinstellungen({ ...basis, ust_zeitraum: "monat", dauerfrist: true });
  const tageMonat = steuerzahltage({ daten: d, einst: einstMonat, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const ustArten = tageMonat.flatMap((t) => t.arten.filter((a) => a === "ust" || a === "ust_svz"));
  assert.equal(ustArten.length, 13, "12 Voranmeldungen + Sondervorauszahlung");
  assert.equal(tageMonat.length, 12, "12 Nenntermine: die SVZ teilt sich den 10.02. mit der USt-VA Dezember, ESt fällt auf USt-Tage");
  const januar = ustTermine(2026, d, einstMonat, SAETZE, HEUTE).find((u) => u.art === "ust" && u.zeitraum?.von === "2026-01-01");
  assert.equal(januar?.nenn, "2026-03-10", "USt-VA Januar mit DFV am 10.03.");
  assert.deepEqual([...(tageMonat.find((t) => t.nenn === "2026-03-10")?.arten || [])].sort(), ["est", "ust"]);
  assert.deepEqual([...(tageMonat.find((t) => t.nenn === "2026-02-10")?.arten || [])].sort(), ["ust", "ust_svz"]);

  const einstQuartal = wirksameEinstellungen({ ...basis, ust_zeitraum: "quartal", dauerfrist: false });
  const tageQuartal = steuerzahltage({ daten: d, einst: einstQuartal, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const ustQuartal = tageQuartal.filter((t) => t.arten.includes("ust"));
  assert.deepEqual(ustQuartal.map((t) => t.nenn), ["2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10"]);
  assert.deepEqual(ustQuartal.map((t) => t.faellig), ["2026-01-12", "2026-04-10", "2026-07-10", "2026-10-12"], "10.01. und 10.10.2026 sind Samstage");
  assert.equal(tageQuartal.length, 8, "4 USt + 4 ESt, keine Zusammenlegung (andere Nenntermine)");

  const einstJahr = wirksameEinstellungen({ ...basis, ust_zeitraum: "jahr" });
  const tageJahr = steuerzahltage({ daten: d, einst: einstJahr, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(tageJahr.some((t) => t.arten.includes("ust")), false, "keine USt-Marken ohne Voranmeldung");
  assert.deepEqual(tageJahr.map((t) => t.nenn), ["2026-03-10", "2026-06-10", "2026-09-10", "2026-12-10"]);
  assert.ok(tageJahr.every((t) => t.arten.length === 1 && t.arten[0] === "est"));
});

test("ESt nur über das Bürokonto (T1): est_ueber_buero aus → keine ESt-Abflüsse und keine ESt-Termine; KSt einer GmbH bleibt", () => {
  const basis = { rechtsform: "einzelunternehmen", ust_zeitraum: "quartal", vorauszahlungen: { 2026: { est: [9000, 9000, 9000, 9000] } } };
  const an = wirksameEinstellungen({ ...basis, est_ueber_buero: true });
  const aus = wirksameEinstellungen({ ...basis, est_ueber_buero: false });
  const k = { daten: daten(), saetze: SAETZE, jahr: 2026, heute: HEUTE };
  assert.equal(ereignisse({ ...k, einst: an }).filter((e) => e.quelle === "est").length, 4);
  assert.equal(ereignisse({ ...k, einst: aus }).filter((e) => e.quelle === "est").length, 0, "kein ESt-Abfluss vom Bürokonto");
  assert.equal(steuerzahltage({ ...k, einst: aus }).some((t) => t.arten.includes("est")), false, "keine ESt-Termine");
  assert.equal(steuerzahltage({ ...k, einst: aus }).length, 4, "die vier USt-Termine bleiben");
  assert.deepEqual(bueroSteuerarten(aus), ["ust"]);
  assert.deepEqual(bueroSteuerarten(wirksameEinstellungen({ rechtsform: "gbr", est_ueber_buero: false, ust_zeitraum: "jahr" })), []);
  assert.deepEqual(bueroSteuerarten(wirksameEinstellungen({ rechtsform: "gmbh", est_ueber_buero: false, ust_zeitraum: "jahr" })), ["kst", "gewst"]);
});

test("Fristen (E-12): 0 Tage ist ein gültiger Wert — Puffer 0 → 10.11.2026 → 27.10.2026, Ziel 0 → 03.11.2026; fehlende Werte → BUERO_STANDARD", () => {
  assert.deepEqual(fristParameter({ zahlungsziel_tage: 0, puffer_tage: 0, warn_tage_rest: 0 }), { ziel: 0, puffer: 0, warnTageRest: 0 });
  assert.deepEqual(fristParameter({}), { ziel: BUERO_STANDARD.zahlungsziel_tage, puffer: BUERO_STANDARD.puffer_tage, warnTageRest: BUERO_STANDARD.warn_tage_rest });
  const k = { daten: daten(), saetze: SAETZE, jahr: 2026, heute: HEUTE };
  const nov = (einst) => steuerzahltage({ ...k, einst }).find((t) => t.nenn === "2026-11-10")?.spaetesterVersand;
  assert.equal(nov(wirksameEinstellungen({ ust_zeitraum: "monat", puffer_tage: 0 })), "2026-10-27");
  assert.equal(nov(wirksameEinstellungen({ ust_zeitraum: "monat", zahlungsziel_tage: 0 })), "2026-11-03");
  assert.equal(nov(wirksameEinstellungen({ ust_zeitraum: "monat" })), "2026-10-20");
  // warn_tage_rest 0: never "knapp" (restTage < 0 is the only way below 0)
  const knappNie = steuerzahltage({ ...k, heute: "2026-09-15", einst: wirksameEinstellungen({ ust_zeitraum: "quartal", warn_tage_rest: 0 }) });
  assert.equal(knappNie.find((t) => t.nenn === "2026-10-10")?.warnung, null);
});

test("steuerzahltage: fehlt nur der ESt-Betrag eines gemeinsamen Termins, bleibt der bekannte USt-Betrag stehen; Deckung bei Saldo < 0 gefährdet, sonst unbekannt", () => {
  const rechnung = { id: "a1", status: "gestellt", art: "schluss", netto: 10000, ust: 1900, brutto: 11900, rechnungsdatum: "2026-02-01", faellig_am: "2026-02-10", zahlungen: [{ datum: "2026-02-10", betrag: 11900 }] };
  const basis = { rechtsform: "einzelunternehmen", ust_zeitraum: "monat", dauerfrist: false, vorauszahlungen: {} };
  const k = { daten: daten({ Ausgangsrechnung: [rechnung] }), saetze: SAETZE, jahr: 2026, heute: HEUTE };
  const plus = steuerzahltage({ ...k, einst: wirksameEinstellungen({ ...basis, kontostand_start: { 2026: { betrag: 0, datum: "2026-01-01" } } }) })
    .find((t) => t.nenn === "2026-03-10");
  assert.deepEqual([...plus.arten].sort(), ["est", "ust"]);
  assert.equal(plus.betragCent, euroZuCent(1900), "USt Februar bekannt");
  assert.deepEqual(plus.fehlendeArten, ["est"]);
  assert.equal(plus.gedeckt, null, "Saldo ≥ 0, aber ESt unbekannt → Deckung unbekannt, kein optimistisches ✓");
  const minus = steuerzahltage({ ...k, einst: wirksameEinstellungen({ ...basis, kontostand_start: { 2026: { betrag: -20000, datum: "2026-01-01" } } }) })
    .find((t) => t.nenn === "2026-03-10");
  assert.equal(minus.gedeckt, false, "Saldo < 0 → gefährdet, was auch immer fehlt");
});

test("Rechnungen-raus-Liste (Seed 2026-09-27): 10.10. gedeckt und Frist vorbei → die drei geplanten Rechnungen stehen am 10.11.2026, Frist nach Vertragsziel 30/21/14 Tage (E-12); Liste = 12 Termine 2026 + 10.01.2027 (Frist 20.12.2026)", () => {
  const bsp = beispielDatensaetze(HEUTE);
  const einst = wirksameEinstellungen(bsp.Setting[0].value);
  const k = { daten: daten(bsp), einst, saetze: SAETZE, heute: HEUTE };
  const liste = rechnungenRausBis({ ...k, jahr: 2026 });
  assert.deepEqual(liste.map((e) => e.datum), [
    "2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10", "2026-06-10",
    "2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10", "2026-11-10", "2026-12-10", "2027-01-10",
  ]);
  const okt = liste.find((e) => e.datum === "2026-10-10");
  assert.equal(okt.gedeckt, true);
  assert.equal(okt.rechnungen.length, 0, "gedeckter Termin mit abgelaufener Frist bekommt keine Rechnung");
  const nov = liste.find((e) => e.datum === "2026-11-10");
  assert.equal(nov.spaetesterVersand, "2026-10-20");
  assert.deepEqual(nov.rechnungen.map((r) => [r.id, r.zielTage, r.frist, r.warnung]), [
    ["bsp-ar-14", 30, "2026-10-04", null], ["bsp-ar-15", 21, "2026-10-13", null], ["bsp-ar-16", 14, "2026-10-20", null],
  ]);
  assert.equal(liste.find((e) => e.datum === "2027-01-10")?.spaetesterVersand, "2026-12-20");
  const liste2027 = rechnungenRausBis({ ...k, jahr: 2027 });
  assert.equal(liste2027[0].datum, "2027-01-10");
  assert.equal(liste2027[0].spaetesterVersand, "2026-12-20", "Vorjahresfrist bleibt in der Liste 2027 sichtbar");
});

test("Rechnungen-raus-Liste: 'knapp' bei < warn_tage_rest Resttagen; gedeckter nächster Termin → die Rechnung wandert zum nächsten Termin mit eigener Frist ≥ heute", () => {
  const knappEinst = wirksameEinstellungen({ rechtsform: "einzelunternehmen", ust_zeitraum: "quartal", vorauszahlungen: {} });
  const d = daten({ Ausgangsrechnung: [{ id: "a1", status: "geplant", brutto: 1000, versand_geplant_am: "2026-09-18", zahlungen: [] }] });
  const knapp = rechnungenRausBis({ daten: d, einst: knappEinst, saetze: SAETZE, jahr: 2026, heute: "2026-09-15" });
  const zeile = knapp.find((e) => e.datum === "2026-10-10")?.rechnungen.find((r) => r.id === "a1");
  assert.deepEqual([zeile?.frist, zeile?.warnung], ["2026-09-19", "knapp"]);

  const gedecktEinst = wirksameEinstellungen({
    rechtsform: "einzelunternehmen", ust_zeitraum: "quartal", vorauszahlungen: {}, kontostand_start: { 2026: { betrag: 50000, datum: "2026-01-01" } },
  });
  const weiter = rechnungenRausBis({ daten: d, einst: gedecktEinst, saetze: SAETZE, jahr: 2026, heute: "2026-09-21" });
  assert.equal(weiter.find((e) => e.datum === "2026-10-10")?.rechnungen.length, 0);
  const dez = weiter.find((e) => e.datum === "2026-12-10");
  assert.deepEqual(dez?.rechnungen.map((r) => [r.id, r.frist]), [["a1", "2026-11-19"]]);
});

test("lage() (Seed 2026-09-27): 2 überfällige Rechnungen mit offenem Betrag, nächster Steuertermin 12.10.2026 (USt August), nächste Versandfrist 20.10.2026 für den 10.11. mit 3 zugeordneten Rechnungen", () => {
  const bsp = beispielDatensaetze(HEUTE);
  const einst = wirksameEinstellungen(bsp.Setting[0].value);
  const l = lage({ daten: daten(bsp), einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const erwartet = bsp.Ausgangsrechnung.filter((r) => r.id === "bsp-ar-12" || r.id === "bsp-ar-13").reduce((n, r) => n + euroZuCent(r.brutto), 0);
  assert.deepEqual(l.ueberfaellig, { anzahl: 2, summeCent: erwartet });
  assert.equal(l.naechsterSteuertag?.faellig, "2026-10-12");
  assert.deepEqual(l.naechsterSteuertag?.arten, ["ust"]);
  assert.deepEqual(l.naechsteFrist, { datum: "2026-10-20", tage: 23, nenn: "2026-11-10", arten: ["ust"], rechnungen: 3 });
});

test("lage(): Überfälligkeit wie in der Rechnungsliste (rechnungsStatus) — ohne faellig_am zählt das Zahlungsziel, Zahlungen nach heute zählen nicht", () => {
  const einst = wirksameEinstellungen({ rechtsform: "einzelunternehmen", ust_zeitraum: "jahr" });
  const d = daten({ Ausgangsrechnung: [
    { id: "x1", status: "gestellt", brutto: 1000, rechnungsdatum: "2026-09-01", zahlungsziel_tage: 30, zahlungen: [] },
    { id: "x2", status: "gestellt", brutto: 2000, rechnungsdatum: "2026-08-01", zahlungsziel_tage: 14, zahlungen: [{ datum: "2026-09-30", betrag: 2000 }] },
  ] });
  const l = lage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.deepEqual(l.ueberfaellig, { anzahl: 1, summeCent: euroZuCent(2000) });
  assert.deepEqual(ueberfaelligeForderungen({ daten: d, heute: HEUTE }).map((r) => [r.id, r.faellig]), [["x2", "2026-08-15"]]);
});

test("startSaldo: eigener Startwert, sonst Endsaldo des Vorjahres, sonst 0 mit Hinweis (leeres Jahr)", () => {
  const bsp = beispielDatensaetze(HEUTE);
  const einst = wirksameEinstellungen(bsp.Setting[0].value);
  const k = { daten: daten(bsp), einst, saetze: SAETZE, heute: HEUTE };
  assert.deepEqual(startSaldo({ ...k, jahr: 2026 }), { cent: euroZuCent(48000), quelle: "eigen" });
  const ende2026 = monatsModell({ ...k, jahr: 2026 })[11].saldoEndeCent;
  assert.deepEqual(startSaldo({ ...k, jahr: 2027 }), { cent: ende2026, quelle: "vorjahresende" });
  assert.deepEqual(startSaldo({ ...k, jahr: 2024 }), { cent: 0, quelle: "hinweis" });
  assert.ok(monatsModell({ ...k, jahr: 2024 }).every((m) => m.eingaengeCent === 0 && m.abflussCent === 0), "2024 ist im Seed leer");
});

test("Rechtsform (E-04): Einzelunternehmen → ESt+USt, keine GewSt; Oktober-Abfluss enthält die Plan-Privatentnahme 9.500,00 €", () => {
  const einst = wirksameEinstellungen({
    rechtsform: "einzelunternehmen", ust_zeitraum: "jahr", kontostand_start: { 2026: { betrag: 0, datum: "2026-01-01" } },
    vorauszahlungen: { 2026: { est: [9000, 9000, 9000, 9000] } },
  });
  const d = daten({ Gesellschafter: [{ id: "g1", name: "Inhaberin A", rolle: "inhaber", aktiv: true, entnahme_plan_monat: 9500 }] });
  const tage = steuerzahltage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.ok(tage.every((t) => !t.arten.includes("gewst")), "keine GewSt bei Einzelunternehmen ohne gewst_aktiv");
  const modell = monatsModell({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(modell[9].entnahmenCent, euroZuCent(9500), "Oktober (Index 9): volle Plan-Entnahme");
});

test("Rechtsform (E-04): GbR mit Gesellschafter B (Plan 2.000 €, ohne Ist) → Oktober-Entnahmen 11.500,00 €", () => {
  const einst = wirksameEinstellungen({ rechtsform: "gbr", ust_zeitraum: "jahr" });
  const d = daten({
    Gesellschafter: [
      { id: "g1", name: "Inhaberin A", rolle: "inhaber", aktiv: true, entnahme_plan_monat: 9500 },
      { id: "g2", name: "Gesellschafter B", rolle: "gesellschafter", aktiv: true, entnahme_plan_monat: 2000 },
    ],
    Entnahme: [{ id: "n1", gesellschafter_id: "g1", datum: "2026-09-25", betrag: 9500 }],
  });
  const modell = monatsModell({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(modell[9].entnahmenCent, euroZuCent(11500), "Oktober: 9.500 + 2.000");
});

test("Rechtsform (E-04): GmbH → keine ESt, KSt ohne Betrag, GewSt fällig 16.02./15.05./17.08./16.11.2026, keine Plan-Entnahmen, GF-Gehalt als Ausgabe", () => {
  const einst = wirksameEinstellungen({ rechtsform: "gmbh", ust_zeitraum: "jahr" });
  const d = daten({
    Gesellschafter: [{ id: "g1", name: "Inhaberin A", rolle: "geschaeftsfuehrer", aktiv: true, entnahme_plan_monat: 9500 }],
    WiederkehrendeAusgabe: [{ id: "wa-gf", lieferant: "GF-Gehalt", kategorie: "personal", steuerfall: "steuerfrei", netto: 7000, vorsteuer: 0, brutto: 7000, rhythmus: "monat", start: "2025-01-01", aktiv: true }],
  });
  const tage = steuerzahltage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(tage.some((t) => t.arten.includes("est")), false, "keine ESt-Termine für GmbH");
  const kstTermine = tage.filter((t) => t.arten.includes("kst")).sort((a, b) => (a.nenn < b.nenn ? -1 : 1));
  assert.equal(kstTermine.length, 4);
  assert.ok(kstTermine.every((t) => t.betragCent === null), "KSt ohne hinterlegten Betrag: 'Betrag fehlt'");
  const gewstTermine = tage.filter((t) => t.arten.includes("gewst")).map((t) => t.faellig).sort();
  assert.deepEqual(gewstTermine, ["2026-02-16", "2026-05-15", "2026-08-17", "2026-11-16"]);
  const modell = monatsModell({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(modell[9].entnahmenCent, 0, "GmbH: keine Plan-Entnahmen, Oktober 0,00 €");
  assert.equal(modell[9].ausgabenCent, euroZuCent(7000), "GF-Gehalt erscheint unter Ausgaben");
  assert.equal(Number.isNaN(modell[9].abflussCent), false);
});

test("Seed (beispielDatensaetze 2026-09-27): mindestens ein ungedeckter und ein gedeckter Steuertag sowie ein Defizit-Monat in 2026", () => {
  const bsp = beispielDatensaetze(HEUTE);
  const settingWert = bsp.Setting[0].value;
  const einst = wirksameEinstellungen(settingWert);
  const d = daten(bsp);
  const tage = steuerzahltage({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.ok(tage.some((t) => t.gedeckt === true), "mindestens ein gedeckter Steuertag");
  assert.ok(tage.some((t) => t.gedeckt === false), "mindestens ein ungedeckter Steuertag");
  const modell = monatsModell({ daten: d, einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.ok(modell.some((m) => m.abflussCent > m.eingaengeCent), "mindestens ein Defizit-Monat");
});

test("lage(): überfällige Rechnungen, nächster Steuertermin, nächste Frist, Kontostand heute — kein Wurf bei leeren Daten", () => {
  const einst = wirksameEinstellungen({ rechtsform: "einzelunternehmen", ust_zeitraum: "jahr" });
  const ergebnis = lage({ daten: daten(), einst, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  assert.equal(ergebnis.ueberfaellig.anzahl, 0);
  assert.equal(typeof ergebnis.kontostandHeute, "number");
});

test("liquiditaetTabelle: Tabellenmodell mit 12 Zeilen", () => {
  const modell = monatsModell({ daten: daten(), einst: EINZEL, saetze: SAETZE, jahr: 2026, heute: HEUTE });
  const tabelle = liquiditaetTabelle(modell, (k) => k);
  assert.equal(tabelle.zeilen.length, 12);
});
