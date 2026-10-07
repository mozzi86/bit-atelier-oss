// Unit tests of the basic functions (79-01 T3): invoice status, payment-term
// chain (E-12), client key, expected receipts (D-P79-18), recurring occurrences,
// straight-line depreciation and the GoBD write protection.
//
// In:  src/lib/accounting/grundlagen.js, datenmodell.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afaLinearCent, bauherrSchluessel, bezahltCent, erwarteterEingang, faelligAm, offenerBetragCent, rechnungsStatus,
  schreibschutzVerletzt, wiederkehrendeVorkommen, zahlungszielTage,
} from "@/lib/accounting/grundlagen.js";
import {
  BUCHHALTUNG_ENTITAETEN, EINGANG_KATEGORIEN, GESELLSCHAFTER_ROLLEN, RECHNUNGS_STATUS, SETTING_KEY,
} from "@/lib/accounting/datenmodell.js";

test("Datenvertrag: 13 Entitäten, Setting-Schlüssel, Kategorie personal, Rollen", () => {
  assert.deepEqual([...BUCHHALTUNG_ENTITAETEN], [
    "Honorarvertrag", "Ausgangsrechnung", "Eingangsrechnung", "WiederkehrendeAusgabe", "Versicherung", "Steuerzahlung",
    "Gesellschafter", "Entnahme", "Bankumsatz", "Fahrzeug", "Fahrt", "Anlagegut", "Beleg",
  ]);
  assert.equal(SETTING_KEY, "buchhaltung");
  assert.ok(EINGANG_KATEGORIEN.includes("personal"));
  assert.deepEqual([...GESELLSCHAFTER_ROLLEN], ["inhaber", "gesellschafter", "partner", "geschaeftsfuehrer"]);
  assert.deepEqual([...RECHNUNGS_STATUS], ["geplant", "entwurf", "offen", "teilbezahlt", "ueberfaellig", "bezahlt", "storniert"]);
});

test("rechnungsStatus: offen am Fälligkeitstag, überfällig am Tag danach; Teil- und Vollzahlung", () => {
  const r = { status: "gestellt", brutto: 1190, faellig_am: "2026-09-26", zahlungen: [] };
  assert.equal(rechnungsStatus(r, "2026-09-26"), "offen");
  assert.equal(rechnungsStatus(r, "2026-09-27"), "ueberfaellig");
  const teil = { ...r, faellig_am: "2026-10-30", zahlungen: [{ datum: "2026-09-20", betrag: 500 }] };
  assert.equal(rechnungsStatus(teil, "2026-09-27"), "teilbezahlt");
  assert.equal(offenerBetragCent(teil), 69000);
  assert.equal(bezahltCent(teil), 50000);
  const voll = { ...r, zahlungen: [{ datum: "2026-09-20", betrag: 500 }, { datum: "2026-09-25", betrag: 690 }] };
  assert.equal(rechnungsStatus(voll, "2026-09-27"), "bezahlt");
  // A payment after the reference day does not count yet.
  assert.equal(rechnungsStatus(voll, "2026-09-22"), "teilbezahlt");
  assert.equal(rechnungsStatus({ ...r, status: "geplant" }, "2030-01-01"), "geplant");
  assert.equal(rechnungsStatus({ ...r, status: "entwurf" }, "2030-01-01"), "entwurf");
  assert.equal(rechnungsStatus({ ...r, status: "storniert" }, "2030-01-01"), "storniert");
  // Due date from invoice date + term when not frozen.
  assert.equal(faelligAm({ rechnungsdatum: "2026-09-01", zahlungsziel_tage: 21 }), "2026-09-22");
  assert.equal(faelligAm({ rechnungsdatum: "2026-09-01" }), "2026-09-15");
});

test("zahlungszielTage: Rechnung > Vertrag > Bauherr > Standard (E-12: 14)", () => {
  const einst = { zahlungsziel_tage: 14, zahlungsziel_je_bauherr: { "stadtwerke musterstadt": 45 } };
  const quellen = { rechnung: { zahlungsziel_tage: 10 }, vertrag: { zahlungsziel_tage: 21 }, einst, bauherrSchluessel: "stadtwerke musterstadt" };
  assert.equal(zahlungszielTage(quellen), 10);
  assert.equal(zahlungszielTage({ ...quellen, rechnung: {} }), 21);
  assert.equal(zahlungszielTage({ ...quellen, rechnung: null, vertrag: {} }), 45);
  assert.equal(zahlungszielTage({ einst, bauherrSchluessel: "andere" }), 14);
  assert.equal(zahlungszielTage({}), 14);
  assert.equal(zahlungszielTage(), 14);
  assert.equal(zahlungszielTage({ einst: { zahlungsziel_tage: 30 } }), 30);
  assert.equal(zahlungszielTage({ rechnung: { zahlungsziel_tage: -3 } }), 14, "ungültige Tage zählen nicht");
});

test("bauherrSchluessel: Kontakt-id vor normalisiertem Projekt-Bauherrn", () => {
  assert.equal(bauherrSchluessel(null, { client: "  Stadtwerke   Musterstadt " }), "stadtwerke musterstadt");
  assert.equal(bauherrSchluessel({ bauherr_contact_id: "c-3" }, { client: "Egal" }), "c-3");
  assert.equal(bauherrSchluessel(null, { client: "   " }), null);
  assert.equal(bauherrSchluessel(null, null), null);
});

test("erwarteterEingang: überfällig zählt nicht, geplant nur bis zum Versanddatum (D-P79-18)", () => {
  const einst = { zahlungsziel_tage: 14 };
  const offen = { status: "gestellt", brutto: 1190, faellig_am: "2026-10-05", zahlungen: [{ datum: "2026-09-01", betrag: 190 }] };
  assert.deepEqual(erwarteterEingang(offen, einst, "2026-09-27"), { datum: "2026-10-05", cent: 100000, sicher: true });
  assert.equal(erwarteterEingang({ ...offen, faellig_am: "2026-09-20" }, einst, "2026-09-27"), null);
  const geplant = { status: "geplant", brutto: 2380, versand_geplant_am: "2026-10-09" };
  assert.deepEqual(erwarteterEingang(geplant, einst, "2026-09-27"), { datum: "2026-10-23", cent: 238000, sicher: false });
  assert.equal(erwarteterEingang({ ...geplant, versand_geplant_am: "2026-09-20" }, einst, "2026-09-27"), null);
  assert.equal(erwarteterEingang({ status: "storniert", brutto: 1 }, einst, "2026-09-27"), null);
  assert.equal(erwarteterEingang({ status: "gestellt", brutto: 10, zahlungen: [{ datum: "2026-09-01", betrag: 10 }], faellig_am: "2026-10-01" }, einst, "2026-09-27"), null);
});

test("wiederkehrendeVorkommen: vom Start aus gerechnet, Monatsende gekappt, Schlüssel wa:<id>:<periode>", () => {
  const monat = wiederkehrendeVorkommen({ id: "wa-1", rhythmus: "monat", start: "2026-01-31" }, "2026-01-01", "2026-12-31");
  assert.equal(monat.length, 12);
  assert.equal(monat[1].datum, "2026-02-28");
  assert.equal(monat[1].schluessel, "wa:wa-1:2026-02");
  assert.equal(monat[2].datum, "2026-03-31");
  const jahr = wiederkehrendeVorkommen({ id: "wa-2", rhythmus: "jahr", start: "2028-02-29" }, "2028-01-01", "2030-12-31");
  assert.deepEqual(jahr.map((v) => v.datum), ["2028-02-29", "2029-02-28", "2030-02-28"]);
  assert.equal(jahr[1].schluessel, "wa:wa-2:2029");
  const quartal = wiederkehrendeVorkommen({ id: "wa-3", rhythmus: "quartal", start: "2025-01-31" }, "2026-01-01", "2026-12-31");
  assert.deepEqual(quartal.map((v) => v.periode), ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  assert.equal(wiederkehrendeVorkommen({ id: "x", rhythmus: "monat", start: "2026-01-15", aktiv: false }, "2026-01-01", "2026-12-31").length, 0);
  assert.equal(wiederkehrendeVorkommen({ id: "x", rhythmus: "monat", start: "2026-01-15", bis: "2026-03-31" }, "2026-01-01", "2026-12-31").length, 3);
});

test("afaLinearCent: monatsgenau, Rest im letzten Jahr, Summe = AK", () => {
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2026), 166667);
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2027), 200000);
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2032), 33333);
  let summe = 0;
  for (let j = 2026; j <= 2032; j++) summe += afaLinearCent(1200000, 6, "2026-03-15", j);
  assert.equal(summe, 1200000);
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2025), 0);
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2033), 0);
  // Disposal in June 2028: Jan–Jun count, nothing afterwards.
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2028, { datum: "2028-06-10" }), 100000);
  assert.equal(afaLinearCent(1200000, 6, "2026-03-15", 2029, { datum: "2028-06-10" }), 0);
  assert.throws(() => afaLinearCent(1000, 0, "2026-01-01", 2026), /Nutzungsdauer/);
});

test("schreibschutzVerletzt: gestellte Rechnung nur Zahlungen, Mahnungen, Storno (GoBD)", () => {
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "gestellt", netto: 100 }, { status: "gestellt", netto: 120 }), true);
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "gestellt", netto: 100, zahlungen: [] },
    { status: "gestellt", netto: 100, zahlungen: [{ datum: "2026-09-27", betrag: 50 }] }), false);
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "gestellt", netto: 100 }, { status: "storniert", netto: 100 }), false);
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "gestellt", netto: 100 }, { status: "entwurf", netto: 100 }), true);
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "storniert", netto: 100 }, { status: "gestellt", netto: 100 }), true);
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "entwurf", netto: 100 }, { status: "entwurf", netto: 120 }), false);
  assert.equal(schreibschutzVerletzt("Eingangsrechnung", { status: "gestellt", netto: 100 }, { status: "gestellt", netto: 120 }), false);
  assert.equal(schreibschutzVerletzt("Ausgangsrechnung", { status: "gestellt", netto: 100, updated_date: "a" },
    { status: "gestellt", netto: 100, updated_date: "b", mahnungen: [{ stufe: 1 }] }), false);
});
