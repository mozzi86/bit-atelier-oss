// Unit tests of incoming invoices and expenses (79-04): tax-case amount split,
// category registry, recurring-expense occurrences and idempotent booking,
// insurance/bond due dates and warnings, expected-expense de-duplication.
//
// In:  src/lib/accounting/ausgaben.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ablaufWarnungen, betraegeAusBrutto, betraegeAusNetto, buergschaftStatus, erwarteteAusgaben, KATEGORIEN,
  offeneVorkommen, steuerfallVorschlag, STEUERFAELLE, vorkommenBezahlen, versicherungFaelligkeiten, vorsteuerDatum,
} from "@/lib/accounting/ausgaben.js";
import { EINGANG_KATEGORIEN, STEUERFAELLE as STEUERFALL_SCHLUESSEL } from "@/lib/accounting/datenmodell.js";
import { centZuEuro } from "@/lib/accounting/geld.js";

// betraegeAusBrutto/betraegeAusNetto compute in CENTS (the plan's own contract,
// for precise live calculation from a BetragFeld); a stored Eingangsrechnung /
// WiederkehrendeAusgabe keeps netto/vorsteuer/brutto in EURO (datenmodell.js,
// beispielDaten.js `betraege()`) — so record fixtures convert back with this helper.
const euroFelder = (cent) => ({ netto: centZuEuro(cent.netto), vorsteuer: centZuEuro(cent.vorsteuer), brutto: centZuEuro(cent.brutto) });

test("KATEGORIEN/STEUERFAELLE: Schlüssel decken den Datenvertrag, personal ist kein DATEV-Posten", () => {
  assert.deepEqual(Object.keys(KATEGORIEN), [...EINGANG_KATEGORIEN]);
  assert.deepEqual(Object.keys(STEUERFAELLE), [...STEUERFALL_SCHLUESSEL]);
  assert.equal(KATEGORIEN.personal.datev, false);
  assert.equal(KATEGORIEN.personal.steuerfall, "steuerfrei");
  assert.ok(EINGANG_KATEGORIEN.filter((k) => k !== "personal").every((k) => KATEGORIEN[k].datev === true), "alle außer personal gehen in den DATEV-Stapel");
  assert.equal(STEUERFAELLE.regel19.vorsteuerSatz, 19);
  assert.equal(STEUERFAELLE.reverse_charge_13b.rc13b, true);
});

test("betraegeAusBrutto/betraegeAusNetto: regel19/regel7, Versicherungsteuer und steuerfrei ohne Vorsteuer", () => {
  assert.deepEqual(betraegeAusBrutto(11900, "regel19"), { netto: 10000, vorsteuer: 1900, brutto: 11900, rc13b: false });
  assert.deepEqual(betraegeAusBrutto(10700, "regel7"), { netto: 10000, vorsteuer: 700, brutto: 10700, rc13b: false });
  // Insurance premium: gross = net, no VAT (insurance tax is inside the premium).
  assert.deepEqual(betraegeAusBrutto(680000, "versicherungsteuer"), { netto: 680000, vorsteuer: 0, brutto: 680000, rc13b: false });
  // Chamber fee, tax-exempt: no VAT either.
  assert.deepEqual(betraegeAusBrutto(110000, "steuerfrei"), { netto: 110000, vorsteuer: 0, brutto: 110000, rc13b: false });
  // Reverse charge (§ 13b): no VAT on the supplier's invoice, flagged for the 79-05 VAT return.
  assert.deepEqual(betraegeAusNetto(5000, "reverse_charge_13b"), { netto: 5000, vorsteuer: 0, brutto: 5000, rc13b: true });
});

test("vorsteuerDatum: der spätere von Rechnungs- und Leistungsdatum", () => {
  assert.equal(vorsteuerDatum({ rechnungsdatum: "2026-03-28", leistungsdatum: "2026-04-02" }), "2026-04-02");
  assert.equal(vorsteuerDatum({ rechnungsdatum: "2026-04-02", leistungsdatum: "2026-03-28" }), "2026-04-02");
  assert.equal(vorsteuerDatum({ rechnungsdatum: "2026-04-02" }), "2026-04-02");
  assert.equal(vorsteuerDatum({}), null);
});

test("steuerfallVorschlag: Miete/Software mit Hinweis, personal steuerfrei ohne Hinweis", () => {
  const miete = steuerfallVorschlag("miete");
  assert.equal(miete.steuerfall, "regel19");
  assert.ok(miete.hinweis && /Option zur Umsatzsteuer/.test(miete.hinweis));
  const software = steuerfallVorschlag("software");
  assert.equal(software.steuerfall, "regel19");
  assert.ok(software.hinweis && /13b/.test(software.hinweis));
  const personal = steuerfallVorschlag("personal");
  assert.deepEqual(personal, { steuerfall: "steuerfrei", hinweis: null });
});

test("offeneVorkommen: monatliche Miete ab 2026-01-31 → 12 Vorkommen, Monatsende gekappt", () => {
  const vorlage = { id: "v-miete", kategorie: "miete", steuerfall: "regel19", lieferant: "Vermieter Test",
    ...euroFelder(betraegeAusNetto(200000, "regel19")), rhythmus: "monat", start: "2026-01-31", aktiv: true };
  const vk = offeneVorkommen({ WiederkehrendeAusgabe: [vorlage], Eingangsrechnung: [] }, "2026-01-01", "2026-12-31");
  assert.equal(vk.length, 12);
  assert.equal(vk[0].datum, "2026-01-31");
  assert.equal(vk[1].datum, "2026-02-28", "das zweite Vorkommen");
  assert.equal(vk[2].datum, "2026-03-31", "das dritte Vorkommen");
});

test("offeneVorkommen: jährliche Vorlage ab 2028-02-29 → zweites Vorkommen 2029-02-28", () => {
  const vorlage = { id: "v-jahr", kategorie: "sonstiges", steuerfall: "regel19", lieferant: "Test",
    ...euroFelder(betraegeAusNetto(10000, "regel19")), rhythmus: "jahr", start: "2028-02-29", aktiv: true };
  const vk = offeneVorkommen({ WiederkehrendeAusgabe: [vorlage], Eingangsrechnung: [] }, "2028-01-01", "2029-12-31");
  assert.equal(vk.length, 2);
  assert.equal(vk[0].datum, "2028-02-29");
  assert.equal(vk[1].datum, "2029-02-28");
});

test("vorkommenBezahlen: „bezahlt“ zweimal für Periode 2026-02 → dieselbe id wa:<vorlage>:2026-02 (idempotent über speichere)", () => {
  const vorlage = { id: "v-soft", kategorie: "software", steuerfall: "regel19", lieferant: "CAD-Software Test",
    ...euroFelder(betraegeAusNetto(29000, "regel19")), rhythmus: "monat", start: "2026-01-15", aktiv: true };
  const erste = vorkommenBezahlen(vorlage, "2026-02", "2026-02-05");
  const zweite = vorkommenBezahlen(vorlage, "2026-02", "2026-02-06");
  assert.equal(erste.id, "wa:v-soft:2026-02");
  assert.equal(erste.id, zweite.id);
  assert.equal(erste.wiederkehrend_id, "v-soft");
  assert.equal(erste.periode, "2026-02");
  assert.equal(erste.rechnungsdatum, "2026-02-15");
  // An inactive template has no occurrences at all (grundlagen.wiederkehrendeVorkommen) — any period is "outside" it.
  assert.throws(() => vorkommenBezahlen({ ...vorlage, aktiv: false }, "2026-02", "2026-02-05"), /außerhalb der Vorlage/);
});

test("Geschäftsführergehalt (kategorie personal): Steuerfall vorbelegt steuerfrei, 12 Vorkommen 2026, erwarteteAusgaben Q4 = 3 × 7.000,00 €", () => {
  const vorschlag = steuerfallVorschlag("personal");
  assert.equal(vorschlag.steuerfall, "steuerfrei");
  const vorlage = { id: "v-gf", kategorie: "personal", lieferant: "Geschäftsführergehalt", steuerfall: vorschlag.steuerfall,
    ...euroFelder(betraegeAusNetto(700000, vorschlag.steuerfall)), rhythmus: "monat", start: "2026-01-31", aktiv: true };
  assert.equal(vorlage.vorsteuer, 0);
  const daten = { WiederkehrendeAusgabe: [vorlage], Eingangsrechnung: [], Versicherung: [] };
  const vk = offeneVorkommen(daten, "2026-01-01", "2026-12-31");
  assert.equal(vk.length, 12, "12 Vorkommen 2026");
  const q4 = erwarteteAusgaben(daten, "2026-10-01", "2026-12-31");
  assert.equal(q4.length, 3);
  assert.ok(q4.every((p) => p.cent === 700000), "3 × 7.000,00 €");
});

test("erwarteteAusgaben: eine bereits erfasste Miete zählt genau einmal (nicht doppelt über offeneVorkommen)", () => {
  const vorlage = { id: "v-miete2", kategorie: "miete", steuerfall: "regel19", lieferant: "Vermieter Test",
    ...euroFelder(betraegeAusNetto(200000, "regel19")), rhythmus: "monat", start: "2026-01-31", aktiv: true };
  const erfasst = { id: "wa:v-miete2:2026-02", kategorie: "miete", lieferant: "Vermieter Test", steuerfall: "regel19",
    ...euroFelder(betraegeAusNetto(200000, "regel19")), rechnungsdatum: "2026-02-28", leistungsdatum: "2026-02-28",
    faellig_am: "2026-02-28", bezahlt_am: null, wiederkehrend_id: "v-miete2", periode: "2026-02" };
  const daten = { WiederkehrendeAusgabe: [vorlage], Eingangsrechnung: [erfasst], Versicherung: [] };
  const posten = erwarteteAusgaben(daten, "2026-02-01", "2026-02-28");
  assert.equal(posten.length, 1, "genau ein Posten, nicht doppelt");
  assert.equal(posten[0].quelle, "eingangsrechnung");
  assert.equal(posten[0].cent, 238000, "200.000 Cent netto + 19 % → 238.000 Cent brutto");
});

test("versicherungFaelligkeiten: jährlich 1.800 € → eine Fälligkeit 2026; vierteljährlich → 4 × 450,00 €", () => {
  const jaehrlich = { naechste_faelligkeit: "2026-11-01", zahlweise: "jahr", praemie: 1800 };
  const f1 = versicherungFaelligkeiten(jaehrlich, "2026-01-01", "2026-12-31");
  assert.deepEqual(f1, [{ datum: "2026-11-01", betrag: 1800 }]);

  const quartal = { naechste_faelligkeit: "2026-01-01", zahlweise: "quartal", praemie: 1800 };
  const f2 = versicherungFaelligkeiten(quartal, "2026-01-01", "2026-12-31");
  assert.equal(f2.length, 4);
  assert.ok(f2.every((f) => f.betrag === 450));
  assert.deepEqual(f2.map((f) => f.datum), ["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
});

test("buergschaftStatus: 50.000 €, 1,2 % p. a., 2026-01-01 bis 2027-12-31 → Avalprovision 2026 = 600,00 €, Rückgabe 2027-12-31", () => {
  const v = { beginn: "2026-01-01", ende: "2027-12-31", buergschaft_betrag: 50000, aval_prozent: 1.2 };
  const status = buergschaftStatus(v, "2026-06-15");
  assert.equal(status.avalprovisionJahrCent, 60000, "600,00 € in Cent");
  assert.equal(status.rueckgabeAm, "2027-12-31");
  assert.equal(status.jahr, 2026);
});

test("ablaufWarnungen: Ende in 30 Tagen warnt, Ende in 90 Tagen nicht (Standard-Schwelle 60 Tage)", () => {
  const heute = "2026-09-27";
  const balda = { id: "vs-1", typ: "berufshaftpflicht", ende: "2026-10-27" }; // +30 Tage
  const spaeter = { id: "vs-2", typ: "berufshaftpflicht", ende: "2026-12-26" }; // +90 Tage
  const warnungenBald = ablaufWarnungen({ Versicherung: [balda] }, heute, 60);
  const warnungenSpaeter = ablaufWarnungen({ Versicherung: [spaeter] }, heute, 60);
  assert.equal(warnungenBald.length, 1);
  assert.equal(warnungenBald[0].grund, "ablauf");
  assert.equal(warnungenSpaeter.length, 0);
});
