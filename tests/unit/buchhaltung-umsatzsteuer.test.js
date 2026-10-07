// Unit tests of the VAT preview (79-05 T1–T4, BUCH-09/BUCH-18): period splitting,
// Ist/Soll and Mindest-Ist, Vorsteuer timing, § 13b, Sondervorauszahlung, the
// year-clock contract (ustTermine) and the Ist-Versteuerung threshold (E-04).
// Check table: 79-05-PLAN.md <behavior>.
//
// In:  src/lib/accounting/umsatzsteuer.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  istVersteuerungPruefen, periodenHinweis, sondervorauszahlungCent, umsatzsteuerTabelle, ustAusgang, ustTermine,
  vorjahrZahllastCent, voranmeldungen, vorsteuer, zeitraeume, zeitraumVon,
} from "@/lib/accounting/umsatzsteuer.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";

const T = (s) => s; // no-op translator: the keys ARE the German text

// --- T1: zeitraeume / zeitraumVon --------------------------------------------

test("zeitraeume: 12 Monate, 4 Quartale, 1 Jahr — lückenlos und aneinandergrenzend", () => {
  const monate = zeitraeume(2026, "monat");
  assert.equal(monate.length, 12);
  assert.deepEqual(monate[0], { von: "2026-01-01", bis: "2026-01-31" });
  assert.deepEqual(monate[1], { von: "2026-02-01", bis: "2026-02-28" });
  const quartale = zeitraeume(2026, "quartal");
  assert.equal(quartale.length, 4);
  assert.deepEqual(quartale[2], { von: "2026-07-01", bis: "2026-09-30" });
  assert.deepEqual(zeitraeume(2026, "jahr"), [{ von: "2026-01-01", bis: "2026-12-31" }]);
});

test("zeitraumVon: findet den umschließenden Zeitraum je Art", () => {
  assert.deepEqual(zeitraumVon("2026-08-15", "monat"), { von: "2026-08-01", bis: "2026-08-31" });
  assert.deepEqual(zeitraumVon("2026-08-15", "quartal"), { von: "2026-07-01", bis: "2026-09-30" });
  assert.deepEqual(zeitraumVon("2026-08-15", "jahr"), { von: "2026-01-01", bis: "2026-12-31" });
  assert.equal(zeitraumVon("nicht-datum", "monat"), null);
});

// --- T1: ustAusgang (Ist/Soll/Mindest-Ist) ------------------------------------

const Q1_2026 = { von: "2026-01-01", bis: "2026-03-31" };
const Q2_2026 = { von: "2026-04-01", bis: "2026-06-30" };
const Q3_2026 = { von: "2026-07-01", bis: "2026-09-30" };

test("ustAusgang: RE 20.03. netto 10.000/USt 1.900, Zahlung 11.900 am 05.04. — Ist Q2 1.900,00 €, Soll Q1 1.900,00 €", () => {
  const rechnung = {
    id: "r1", status: "gestellt", art: "sonstige", netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900,
    rechnungsdatum: "2026-03-20", zahlungen: [{ datum: "2026-04-05", betrag: 11900 }],
  };
  assert.equal(ustAusgang([rechnung], Q1_2026, "ist").cent, 0);
  assert.equal(ustAusgang([rechnung], Q2_2026, "ist").cent, 190000);
  assert.equal(ustAusgang([rechnung], Q1_2026, "soll").cent, 190000);
  assert.equal(ustAusgang([rechnung], Q2_2026, "soll").cent, 0);
});

test("ustAusgang: Teilzahlung 5.950,00 € von 11.900,00 € am 05.04. — Ist Q2 950,00 €", () => {
  const rechnung = {
    id: "r2", status: "gestellt", art: "sonstige", netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900,
    rechnungsdatum: "2026-03-20", zahlungen: [{ datum: "2026-04-05", betrag: 5950 }],
  };
  assert.equal(ustAusgang([rechnung], Q2_2026, "ist").cent, 95000);
});

test("ustAusgang: Abschlagsrechnung 20.03., Zahlung 05.04. — auch bei Soll in Q2 (Mindest-Ist)", () => {
  const rechnung = {
    id: "r3", status: "gestellt", art: "abschlag", netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900,
    rechnungsdatum: "2026-03-20", zahlungen: [{ datum: "2026-04-05", betrag: 11900 }],
  };
  assert.equal(ustAusgang([rechnung], Q1_2026, "soll").cent, 0, "Rechnungsdatum zählt bei Mindest-Ist nicht");
  assert.equal(ustAusgang([rechnung], Q2_2026, "soll").cent, 190000);
});

test("ustAusgang: geplante/entworfene Rechnungen zählen nicht, Stornos (negative Beträge) schon", () => {
  const geplant = { id: "r4", status: "geplant", art: "sonstige", ust: 1000, brutto: 5000, rechnungsdatum: "2026-04-01", zahlungen: [] };
  const storno = {
    id: "r5", status: "gestellt", art: "storno", netto: -1000, ust: -190, brutto: -1190, rechnungsdatum: "2026-05-15", zahlungen: [],
  };
  assert.equal(ustAusgang([geplant], Q2_2026, "soll").cent, 0);
  assert.equal(ustAusgang([storno], Q2_2026, "soll").cent, -19000, "Storno mindert die USt des Zeitraums der Ausstellung");
});

// --- T1: vorsteuer, § 13b -----------------------------------------------------

test("vorsteuer: Rechnungsdatum 28.03., Leistung 02.04., Zahlung 20.05. — Vorsteuer in Q2 (April), nicht Mai/Q1", () => {
  const eingang = { id: "e1", steuerfall: "regel19", netto: 1000, vorsteuer: 190, brutto: 1190, rechnungsdatum: "2026-03-28", leistungsdatum: "2026-04-02" };
  assert.equal(vorsteuer([eingang], Q1_2026).cent, 0);
  assert.equal(vorsteuer([eingang], Q2_2026).cent, 19000);
});

test("vorsteuer: steuerfrei/versicherungsteuer zählen mit 0 VSt, unabhängig vom gespeicherten Feld", () => {
  const frei = { id: "e2", steuerfall: "steuerfrei", netto: 480, vorsteuer: 91.2, brutto: 480, rechnungsdatum: "2026-03-01" };
  assert.equal(vorsteuer([frei], Q1_2026).cent, 0);
});

test("§ 13b: netto 1.000 € im März — USt 190,00 € und VSt 190,00 € in Q1, Zahllast-Beitrag 0", () => {
  const eingang13b = { id: "e3", steuerfall: "reverse_charge_13b", netto: 1000, vorsteuer: 190, brutto: 1000, rechnungsdatum: "2026-03-10" };
  const v = vorsteuer([eingang13b], Q1_2026);
  const a = ustAusgang([], Q1_2026, "ist");
  assert.equal(v.cent, 19000);
  assert.equal(v.cent13b, 19000, "die gesamte Vorsteuer dieses Belegs ist § 13b");
  assert.equal(a.cent + v.cent13b, 19000, "USt-Seite: eigene Reverse-Charge-USt");
  assert.equal((a.cent + v.cent13b) - v.cent, 0, "Zahllast-Beitrag netto 0");
});

// --- T2: voranmeldungen — Q3/2026 Beispiel, Fälligkeiten ---------------------

test("voranmeldungen: Q3/2026 USt 19.000,00 €, VSt 4.000,00 € — Zahllast 15.000,00 €; Fälligkeit ohne/mit DFV", () => {
  const ausgang = [{ id: "a1", status: "gestellt", art: "sonstige", ust: 19000, brutto: 119000, rechnungsdatum: "2026-08-15", zahlungen: [] }];
  const eingang = [{ id: "e4", steuerfall: "regel19", netto: 21052.63, vorsteuer: 4000, brutto: 25052.63, rechnungsdatum: "2026-08-20" }];
  const daten = { Ausgangsrechnung: ausgang, Eingangsrechnung: eingang, Steuerzahlung: [] };
  const saetze = saetzeZum("2026-01-01");

  const ohneDfv = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: false, versteuerung: "soll" });
  const q3a = voranmeldungen(2026, daten, ohneDfv, saetze, "2026-09-27").find((z) => z.zeitraum?.von === "2026-07-01");
  assert.equal(q3a.ust, 1900000);
  assert.equal(q3a.vst, 400000);
  assert.equal(q3a.zahllast, 1500000);
  assert.equal(q3a.nenn, "2026-10-10");
  assert.equal(q3a.faellig, "2026-10-12", "10.10.2026 (Sa) → 12.10.2026");

  const mitDfv = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: true, versteuerung: "soll" });
  const q3b = voranmeldungen(2026, daten, mitDfv, saetze, "2026-09-27").find((z) => z.zeitraum?.von === "2026-07-01");
  assert.equal(q3b.nenn, "2026-11-10");
  assert.equal(q3b.faellig, "2026-11-10");
});

test("voranmeldungen: USt 2.000 € bei VSt 2.500 € — Erstattung 500,00 €, negative Zahllast bleibt ein Eintrag (kein Abfluss)", () => {
  const ausgang = [{ id: "a2", status: "gestellt", art: "sonstige", ust: 2000, brutto: 12000, rechnungsdatum: "2026-02-10", zahlungen: [] }];
  const eingang = [{ id: "e5", steuerfall: "regel19", netto: 13157.9, vorsteuer: 2500, brutto: 15657.9, rechnungsdatum: "2026-02-15" }];
  const daten = { Ausgangsrechnung: ausgang, Eingangsrechnung: eingang, Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: false, versteuerung: "soll" });
  const saetze = saetzeZum("2026-01-01");
  const q1 = voranmeldungen(2026, daten, einst, saetze, "2026-09-27").find((z) => z.zeitraum?.von === "2026-01-01");
  assert.equal(q1.zahllast, -50000, "Erstattung 500,00 €");
  const termin = ustTermine(2026, daten, einst, saetze, "2026-09-27").find((z) => z.nenn === q1.nenn);
  assert.ok(termin, "der Zeitraum bleibt im Vertrag — nur negativ, kein „Abfluss“");
  assert.equal(termin.betragCent, -50000);
});

// --- T2: Monat ohne DFV — Dezember über den Jahreswechsel --------------------

test("ustTermine: Monat 12/2026 ohne DFV — Nenntermin 10.01.2027 (So) → fällig 11.01.2027", () => {
  const daten = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "monat", dauerfrist: false });
  const saetze = saetzeZum("2027-01-01");
  const termin = ustTermine(2027, daten, einst, saetze, "2026-12-15").find((z) => z.zeitraum?.von === "2026-12-01");
  assert.equal(termin.nenn, "2027-01-10");
  assert.equal(termin.faellig, "2027-01-11");
});

// --- T2: Sondervorauszahlung ---------------------------------------------------

// § 48 Abs. 4 UStDV: the SVZ FOR year N (due 10.02.N) is credited in the December-N
// return (filed 10.02.N+1) — not in December N−1, which only shares the due date.
test("voranmeldungen: Monat + DFV, Vorjahres-Zahllast 33.000 € — SVZ 3.000,00 €, fällig 10.02.2026; die Dezember-Zahllast 2026 sinkt um 3.000,00 €", () => {
  const daten = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "monat", dauerfrist: true, ust_vorjahr_zahllast: { 2025: 33000 } });
  const zeilen = voranmeldungen(2026, daten, einst, saetzeZum("2026-01-01"), "2026-09-27");
  const svz = zeilen.find((z) => z.art === "ust_svz");
  assert.equal(svz.zahllast, 300000, "1/11 von 33.000 €");
  assert.equal(svz.faellig, "2026-02-10");
  const dezember2025 = zeilen.find((z) => z.zeitraum?.von === "2025-12-01");
  assert.equal(dezember2025.svzAnrechnung, 0, "die SVZ 2026 gehört nicht in die Dezember-VA 2025");
  assert.equal(dezember2025.zahllast, 0, "0 € eigene Zahllast, keine SVZ 2025 bekannt (keine Basis 2024)");

  const zeilen2027 = voranmeldungen(2027, daten, einst, saetzeZum("2027-01-01"), "2026-09-27");
  const dezember2026 = zeilen2027.find((z) => z.zeitraum?.von === "2026-12-01");
  assert.equal(dezember2026.nenn, "2027-02-10", "Dezember 2026 mit DFV: Nenntermin 10.02.2027");
  assert.equal(dezember2026.svzAnrechnung, 300000);
  assert.equal(dezember2026.zahllast, -300000, "0 € eigene Zahllast minus 3.000,00 € Anrechnung der SVZ 2026");
});

test("voranmeldungen: Dezember 2025 wird mit der SVZ 2025 verrechnet — aus der Basis 2024, eine erfasste SVZ-Zahlung geht vor", () => {
  const ausgang = [{ id: "a7", status: "gestellt", art: "sonstige", ust: 5000, brutto: 31315.79, rechnungsdatum: "2025-12-05",
    zahlungen: [{ datum: "2025-12-20", betrag: 31315.79 }] }];
  const einst = wirksameEinstellungen({ ust_zeitraum: "monat", dauerfrist: true, ust_vorjahr_zahllast: { 2024: 22000, 2025: 33000 } });
  const saetze = saetzeZum("2026-01-01");
  const ohneZahlung = voranmeldungen(2026, { Ausgangsrechnung: ausgang, Eingangsrechnung: [], Steuerzahlung: [] }, einst, saetze, "2026-09-27");
  const dez = ohneZahlung.find((z) => z.zeitraum?.von === "2025-12-01");
  assert.equal(dez.ust, 500000);
  assert.equal(dez.svzAnrechnung, 200000, "SVZ 2025 = 1/11 von 22.000 €");
  assert.equal(dez.zahllast, 300000, "5.000 € USt minus 2.000 € SVZ 2025 — nicht minus 3.000 € SVZ 2026");
  assert.equal(ohneZahlung.find((z) => z.art === "ust_svz").zahllast, 300000, "die SVZ-Zeile 2026 bleibt 1/11 von 33.000 €");

  const erfasst = [{ id: "st-svz-2025", art: "ust_svz", zeitraum: null, betrag: 2100, faellig_am: "2025-02-10", bezahlt_am: "2025-02-10" }];
  const mitZahlung = voranmeldungen(2026, { Ausgangsrechnung: ausgang, Eingangsrechnung: [], Steuerzahlung: erfasst }, einst, saetze, "2026-09-27");
  const dez2 = mitZahlung.find((z) => z.zeitraum?.von === "2025-12-01");
  assert.equal(dez2.svzAnrechnung, 210000, "die tatsächlich angemeldete SVZ 2025 (§ 48 Abs. 4 UStDV: die festgesetzte)");
  assert.equal(dez2.zahllast, 290000);
});

test("sondervorauszahlungCent: erfasste Zahlung des Jahres, sonst 1/11 der Vorjahres-Zahllast, sonst 0", () => {
  const saetze = saetzeZum("2026-01-01");
  const einst = wirksameEinstellungen({ ust_vorjahr_zahllast: { 2025: 26400 } });
  assert.equal(sondervorauszahlungCent(2026, { Steuerzahlung: [] }, einst, saetze), 240000);
  assert.equal(sondervorauszahlungCent(2025, { Steuerzahlung: [] }, einst, saetze), 0, "keine Basis 2024 bekannt");
  const erfasst = { Steuerzahlung: [{ art: "ust_svz", zeitraum: null, betrag: 2500, faellig_am: "2026-02-10" }] };
  assert.equal(sondervorauszahlungCent(2026, erfasst, einst, saetze), 250000);
  assert.equal(sondervorauszahlungCent(2027, erfasst, einst, saetze), 0, "die Zahlung 2026 zählt nicht für 2027");
});

test("vorjahrZahllastCent: aus Steuerzahlung, sonst aus der Einstellung", () => {
  const einst = wirksameEinstellungen({ ust_vorjahr_zahllast: { 2025: 26400 } });
  assert.equal(vorjahrZahllastCent(2025, { Steuerzahlung: [] }, einst), 2640000);
  const echte = { Steuerzahlung: [{ art: "ust", zeitraum: { von: "2025-04-01", bis: "2025-06-30" }, betrag: 12000 }] };
  assert.equal(vorjahrZahllastCent(2025, echte, einst), 1200000, "eine echte Zahlung geht vor der Einstellung");
});

// --- T2/T4: ustTermine — feste Zählungen je Schalter (Vertrag für 79-10) -----

test("ustTermine: Bürostandard E-09 (quartal ohne DFV) — 4 Termine mit exakten Nenn-/Fälligkeitsdaten", () => {
  const daten = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: false });
  const saetze = saetzeZum("2026-01-01");
  const t = ustTermine(2026, daten, einst, saetze, "2026-09-27");
  assert.deepEqual(t.map((x) => x.nenn), ["2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10"]);
  assert.deepEqual(t.map((x) => x.faellig), ["2026-01-12", "2026-04-10", "2026-07-10", "2026-10-12"]);
  assert.ok(t.every((x) => Number.isFinite(x.betragCent)));
});

test("ustTermine: quartal MIT DFV — 4 Termine, Nenntermine +1 Monat", () => {
  const daten = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: true });
  const saetze = saetzeZum("2026-01-01");
  const t = ustTermine(2026, daten, einst, saetze, "2026-09-27");
  assert.deepEqual(t.map((x) => x.nenn), ["2026-02-10", "2026-05-10", "2026-08-10", "2026-11-10"]);
  assert.deepEqual(t.map((x) => x.faellig), ["2026-02-10", "2026-05-11", "2026-08-10", "2026-11-10"]);
});

test("ustTermine: Monat ohne DFV — 12 Termine 10.01.–10.12.2026", () => {
  const daten = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "monat", dauerfrist: false });
  const saetze = saetzeZum("2026-01-01");
  const t = ustTermine(2026, daten, einst, saetze, "2026-09-27");
  assert.equal(t.length, 12);
  assert.deepEqual(t.map((x) => x.nenn), Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-10`));
});

test("ustTermine/voranmeldungen: {ust_zeitraum: 'jahr', dauerfrist: true} — keine Termine, genau eine Zeile „Jahreserklärung“ ohne faellig", () => {
  const daten = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [] };
  const einst = wirksameEinstellungen({ ust_zeitraum: "jahr", dauerfrist: true });
  const saetze = saetzeZum("2026-01-01");
  assert.deepEqual(ustTermine(2026, daten, einst, saetze, "2026-09-27"), []);
  const zeilen = voranmeldungen(2026, daten, einst, saetze, "2026-09-27");
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].jahreserklaerung, true);
  assert.equal(zeilen[0].faellig, null);
  assert.deepEqual(zeilen[0].zeitraum, { von: "2026-01-01", bis: "2026-12-31" });
});

// --- T2: Hinweise zur Periodizität --------------------------------------------

test("periodenHinweis: „keine Voranmeldung“, Vorjahres-Zahllast 2.400 € — Hinweis; 1.800 € — kein Hinweis", () => {
  const saetze = saetzeZum("2026-01-01");
  assert.equal(periodenHinweis("jahr", 240000, saetze), "voranmeldung_pflicht");
  assert.equal(periodenHinweis("jahr", 180000, saetze), null);
});

test("periodenHinweis: Quartal eingestellt, Vorjahres-Zahllast 12.000 € — „Monatliche Voranmeldung wahrscheinlich Pflicht“", () => {
  const saetze = saetzeZum("2026-01-01");
  assert.equal(periodenHinweis("quartal", 1200000, saetze), "monat_pflicht");
  assert.equal(periodenHinweis("quartal", 500000, saetze), null);
  assert.equal(periodenHinweis("monat", 5000000, saetze), null, "Monat ist bereits die häufigste Stufe");
});

// --- T2: istVersteuerungPruefen (E-04) ----------------------------------------

test("istVersteuerungPruefen: Vorjahresumsatz 900.000 € — Einzelunternehmen/GbR zulässig als Freiberufler, GmbH/UG Soll-Pflicht", () => {
  const daten = {};
  const saetze = saetzeZum("2026-01-01");
  const pruefe = (rechtsform) => istVersteuerungPruefen(
    wirksameEinstellungen({ rechtsform, umsatz_vorjahr: { 2025: 900000 } }), daten, 2026, saetze,
  );
  assert.deepEqual(pruefe("einzelunternehmen"), { zulaessig: true, grund: "freiberufler", umsatzVorjahrCent: 90000000 });
  assert.deepEqual(pruefe("gbr"), { zulaessig: true, grund: "freiberufler", umsatzVorjahrCent: 90000000 });
  assert.deepEqual(pruefe("gmbh"), { zulaessig: false, grund: "soll_pflicht", umsatzVorjahrCent: 90000000 });
  assert.deepEqual(pruefe("ug"), { zulaessig: false, grund: "soll_pflicht", umsatzVorjahrCent: 90000000 });
});

test("istVersteuerungPruefen: GmbH mit 500.000 € Vorjahresumsatz — zulässig (Umsatzgrenze)", () => {
  const einst = wirksameEinstellungen({ rechtsform: "gmbh", umsatz_vorjahr: { 2025: 500000 } });
  const r = istVersteuerungPruefen(einst, {}, 2026, saetzeZum("2026-01-01"));
  assert.deepEqual(r, { zulaessig: true, grund: "umsatzgrenze", umsatzVorjahrCent: 50000000 });
});

// --- umsatzsteuerTabelle -------------------------------------------------------

test("umsatzsteuerTabelle: Titel, Spalten, Periodenbeschriftung (Monat/Quartal/SVZ/Jahreserklärung)", () => {
  const zeilen = [
    { zeitraum: { von: "2026-03-01", bis: "2026-03-31" }, ust: 190000, vst: 40000, zahllast: 150000, faellig: "2026-04-10", bezahlt: null, art: "ust", jahreserklaerung: false },
    { zeitraum: null, ust: 0, vst: 0, zahllast: 240000, faellig: "2026-02-10", bezahlt: null, art: "ust_svz", jahreserklaerung: false, nenn: "2026-02-10" },
  ];
  const m = umsatzsteuerTabelle(zeilen, T);
  assert.equal(m.titel, "Umsatzsteuer");
  assert.deepEqual(m.spalten.map((s) => s.key), ["zeitraum", "ust", "vorsteuer", "zahllast", "faellig", "bezahlt"]);
  assert.equal(m.zeilen[0].zeitraum, "03/2026");
  assert.equal(m.zeilen[0].zahllast, 1500);
  assert.equal(m.zeilen[1].zeitraum, "SVZ 2026");
});

// --- T4: Vertragstest gegen die Beispieldaten (79-10 kann sich darauf verlassen) ---

test("Vertrag (Beispieldaten 2026-09-27, Monat + DFV): 13 Termine, sortiert, jeder Betrag endlich", () => {
  const heute = "2026-09-27";
  const daten = beispielDatensaetze(heute);
  const einst = wirksameEinstellungen(daten.Setting[0].value);
  assert.equal(einst.ust_zeitraum, "monat");
  assert.equal(einst.dauerfrist, true);
  const saetze = saetzeZum(heute);
  const t = ustTermine(2026, daten, einst, saetze, heute);
  assert.equal(t.length, 13);
  assert.deepEqual(t.map((x) => x.nenn), [...t.map((x) => x.nenn)].sort(), "sortiert nach Nenntermin");
  assert.ok(t.every((x) => Number.isFinite(x.betragCent)), "kein NaN");
  const nennListe = t.map((x) => x.nenn);
  assert.deepEqual(nennListe.slice(0, 1), ["2026-01-10"], "VA November 2025");
  assert.equal(nennListe.filter((n) => n === "2026-02-10").length, 2, "VA Dezember 2025 UND SVZ 2026 am selben Nenntermin");
  assert.deepEqual(nennListe.slice(3), Array.from({ length: 10 }, (_, i) => `2026-${String(i + 3).padStart(2, "0")}-10`), "VA Januar–Oktober 2026");
});

test("Vertrag (Beispieldaten 2026-09-27, Monat + DFV): die erfasste SVZ 2026 (2.400 €) mindert die VA Dezember 2026 (Termine 2027), nicht die VA Dezember 2025", () => {
  const heute = "2026-09-27";
  const daten = beispielDatensaetze(heute);
  const einst = wirksameEinstellungen(daten.Setting[0].value);
  const zeilen2026 = voranmeldungen(2026, daten, einst, saetzeZum(heute), heute);
  const dez2025 = zeilen2026.find((z) => z.zeitraum?.von === "2025-12-01");
  assert.equal(dez2025.svzAnrechnung, 0, "keine SVZ 2025 in den Beispieldaten");
  const termin2025 = ustTermine(2026, daten, einst, saetzeZum(heute), heute).find((x) => x.zeitraum?.von === "2025-12-01");
  assert.equal(termin2025.betragCent, dez2025.ust - dez2025.vst, "Jahresuhr 2026: Dezember 2025 ohne Anrechnung der SVZ 2026");

  const zeilen2027 = voranmeldungen(2027, daten, einst, saetzeZum("2027-01-01"), heute);
  const dez2026 = zeilen2027.find((z) => z.zeitraum?.von === "2026-12-01");
  assert.equal(dez2026.svzAnrechnung, 240000, "die erfasste SVZ 2026 der Beispieldaten");
  const termin2026 = ustTermine(2027, daten, einst, saetzeZum("2027-01-01"), heute).find((x) => x.zeitraum?.von === "2026-12-01");
  assert.equal(termin2026.nenn, "2027-02-10");
  assert.equal(termin2026.betragCent, dez2026.ust - dez2026.vst - 240000);
});

test("Vertrag (dieselbe Datenlage, Bürostandard quartal ohne DFV): 4 Termine", () => {
  const heute = "2026-09-27";
  const daten = beispielDatensaetze(heute);
  const einst = wirksameEinstellungen({ ...daten.Setting[0].value, ust_zeitraum: "quartal", dauerfrist: false });
  const saetze = saetzeZum(heute);
  const t = ustTermine(2026, daten, einst, saetze, heute);
  assert.equal(t.length, 4);
  assert.deepEqual(t.map((x) => x.nenn), ["2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10"]);
});

test("Vertrag (dieselbe Datenlage, {ust_zeitraum: 'jahr'}): keine Termine", () => {
  const heute = "2026-09-27";
  const daten = beispielDatensaetze(heute);
  const einst = wirksameEinstellungen({ ...daten.Setting[0].value, ust_zeitraum: "jahr" });
  const saetze = saetzeZum(heute);
  assert.deepEqual(ustTermine(2026, daten, einst, saetze, heute), []);
});

// --- Umschalten Ist/Soll ändert eine sichtbare Summe --------------------------

test("voranmeldungen: Umschalten Ist/Soll ändert die Summe von Q1 bzw. Q2 sichtbar", () => {
  const rechnung = {
    id: "r6", status: "gestellt", art: "sonstige", netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900,
    rechnungsdatum: "2026-03-20", zahlungen: [{ datum: "2026-04-05", betrag: 11900 }],
  };
  const daten = { Ausgangsrechnung: [rechnung], Eingangsrechnung: [], Steuerzahlung: [] };
  const saetze = saetzeZum("2026-01-01");
  const heute = "2026-09-27";
  const ist = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: false, versteuerung: "ist" });
  const soll = wirksameEinstellungen({ ust_zeitraum: "quartal", dauerfrist: false, versteuerung: "soll" });
  const q1Ist = voranmeldungen(2026, daten, ist, saetze, heute).find((z) => z.zeitraum.von === "2026-01-01").ust;
  const q1Soll = voranmeldungen(2026, daten, soll, saetze, heute).find((z) => z.zeitraum.von === "2026-01-01").ust;
  const q2Ist = voranmeldungen(2026, daten, ist, saetze, heute).find((z) => z.zeitraum.von === "2026-04-01").ust;
  const q2Soll = voranmeldungen(2026, daten, soll, saetze, heute).find((z) => z.zeitraum.von === "2026-04-01").ust;
  assert.notEqual(q1Ist, q1Soll);
  assert.notEqual(q2Ist, q2Soll);
  assert.equal(q1Soll, 190000);
  assert.equal(q2Ist, 190000);
});
