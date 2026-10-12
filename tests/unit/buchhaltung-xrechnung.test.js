// Unit tests of the XRechnung export (93-01, lever 156): the EN 16931 / XRechnung
// 3.0 rules that can be checked without the official KoSIT validator — mandatory
// BT fields, sums, VAT categories S and E, the Leitweg-ID check digits, the
// storno → credit note path — plus well-formed, escaped UBL XML.
// All data are placeholders (no real names; IBAN from the allowed test list of
// tools/sperrliste.mjs, VAT ID and tax number obviously fake).
//
// In:  src/lib/accounting/xrechnung.js, ausgangsrechnungen.js, einstellungen.js.
// Out: assertions only. The official validator run stays an external step.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anschriftTeile, exportiereXRechnung, kontaktTeile, leitwegIdGueltig, MELDUNGEN, pruefeXRechnung, rechnungstyp,
  xmlText, xrechnungDateiname, xrechnungModell, xrechnungUbl, XRECHNUNG_KENNUNG,
} from "@/lib/accounting/xrechnung.js";
import { empfaengerAus, rechnungBetraege } from "@/lib/accounting/ausgangsrechnungen.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { englischePaareAlle } from "./helpers/woerterbuch.mjs";

const LEITWEG = "04011000-1234512345-06"; // public example of the KoSIT format specification
const EINST = wirksameEinstellungen({ buero: { name: "Beispiel Architekturbüro", steuernr: "", ust_idnr: "DE123456789", iban: "DE02120300000000202051" } });
const BRIEFKOPF = { office: "Beispiel Architekturbüro", address: "Musterstraße 1\n90402 Musterstadt", contact: "Tel. 0911 000000 · info@example.de" };

/** An issued Abschlag invoice of 10 000 € net, two LP lines, 19 %. */
function rechnung(extra = {}) {
  const b = rechnungBetraege(10000, 19);
  return {
    id: "r1", nummer: "RE-2026-001", art: "abschlag", status: "gestellt", project_name: "Testhaus",
    lp_pos: [{ lp: 2, stand: 100, netto: 4000 }, { lp: 3, stand: 50, netto: 6000 }],
    netto: b.netto, ust_satz: 19, ust: b.ust, brutto: b.brutto,
    rechnungsdatum: "2026-10-01", faellig_am: "2026-10-15", leistung_von: "2026-07-01", leistung_bis: "2026-09-30",
    empfaenger: { name: "Stadt Musterstadt, Hochbauamt", anschrift: "Rathausplatz 2, 90403 Musterstadt", ust_idnr: "", art: "oeffentlich", leitweg_id: LEITWEG },
    ...extra,
  };
}

/**
 * Minimal well-formedness check: balanced tags, one root, no raw "&" or "<" in text.
 * @param {string} xml
 */
function wohlgeformt(xml) {
  const ohneKopf = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stapel = [];
  let wurzeln = 0;
  for (const m of ohneKopf.matchAll(/<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(m[5]), `rohes & im Text: ${m[5]}`);
      continue;
    }
    const [, schliesst, name, , leer] = m;
    if (schliesst) assert.equal(stapel.pop(), name, `falsch geschlossen: ${name}`);
    else if (!leer) { if (stapel.length === 0) wurzeln += 1; stapel.push(name); }
  }
  assert.equal(stapel.length, 0, "offene Tags");
  assert.equal(wurzeln, 1, "genau ein Wurzelelement");
}

/** @param {string} xml @param {string} tag @returns {string[]} text of every element with this name */
const werte = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) => m[1]);

test("anschriftTeile: Straße, PLZ, Ort aus Mehrzeiler und Kommaliste; Länderpräfix; Name übersprungen", () => {
  assert.deepEqual(anschriftTeile("Musterstraße 1\n90402 Musterstadt"), { strasse: "Musterstraße 1", zusatz: "", plz: "90402", ort: "Musterstadt", land: "DE" });
  assert.deepEqual(anschriftTeile("Hochbauamt, Rathausplatz 2, 90403 Musterstadt"), { strasse: "Rathausplatz 2", zusatz: "Hochbauamt", plz: "90403", ort: "Musterstadt", land: "DE" });
  assert.equal(anschriftTeile("Büro X\nGasse 3\nA-1010 Wien", "Büro X").land, "AT");
  assert.equal(anschriftTeile("Büro X\nGasse 3\nA-1010 Wien", "Büro X").zusatz, "");
  assert.deepEqual(anschriftTeile(""), { strasse: "", zusatz: "", plz: "", ort: "", land: "DE" });
});

test("kontaktTeile: Telefon und E-Mail aus der Kontaktzeile", () => {
  assert.deepEqual(kontaktTeile("Tel. 0911 000000 · info@example.de"), { telefon: "0911 000000", email: "info@example.de" });
  assert.deepEqual(kontaktTeile("+49 (911) 000-00 | buero@example.org"), { telefon: "+49 (911) 000-00", email: "buero@example.org" });
  assert.deepEqual(kontaktTeile(""), { telefon: "", email: "" });
});

test("leitwegIdGueltig: Prüfziffer MOD 97-10, Format grob-fein-prüf", () => {
  assert.ok(leitwegIdGueltig("04011000-1234512345-06"));
  assert.ok(leitwegIdGueltig("991-33333TEST-33"));
  assert.ok(leitwegIdGueltig("992-90009-96"));
  assert.ok(leitwegIdGueltig("991-33333test-33"), "Kleinbuchstaben wie Großbuchstaben");
  assert.ok(!leitwegIdGueltig("04011000-1234512345-07"), "falsche Prüfziffer");
  assert.ok(!leitwegIdGueltig("04011000"), "ohne Prüfziffer");
  assert.ok(!leitwegIdGueltig(""));
});

test("rechnungstyp: Abschlag 326, Schluss/Teilschluss 380, Storno 381", () => {
  assert.equal(rechnungstyp("abschlag"), "326");
  assert.equal(rechnungstyp("schluss"), "380");
  assert.equal(rechnungstyp("teilschluss"), "380");
  assert.equal(rechnungstyp("storno"), "381");
});

test("vollständige Rechnung: keine Regelverletzung, Summen in Cent, LP-Positionen", () => {
  const m = xrechnungModell(rechnung(), { einst: EINST, briefkopf: BRIEFKOPF });
  assert.deepEqual(pruefeXRechnung(m), []);
  assert.equal(m.positionen.length, 2);
  assert.equal(m.positionen[1].name, "Leistungsphase 3 (HOAI), Stand 50 %");
  assert.deepEqual(m.summen, { positionenCent: 1000000, ohneUstCent: 1000000, ustCent: 190000, mitUstCent: 1190000, zahlbarCent: 1190000 });
  assert.equal(m.steuern[0].kategorie, "S");
  assert.equal(m.kaeufer.plz, "90403");
  assert.equal(m.verkaeufer.email, "info@example.de");
  assert.equal(m.zahlungsbedingung, "Zahlbar ohne Abzug bis 15.10.2026.");
});

test("UBL: wohlgeformt, Pflichtelemente, Beträge mit Punkt, Leitweg-ID als BT-10 und BT-49", () => {
  const { xml, fehler, dateiname } = exportiereXRechnung(rechnung(), { einst: EINST, briefkopf: BRIEFKOPF });
  assert.deepEqual(fehler, []);
  assert.ok(xml);
  wohlgeformt(xml);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'));
  assert.deepEqual(werte(xml, "cbc:CustomizationID"), [XRECHNUNG_KENNUNG]);
  assert.deepEqual(werte(xml, "cbc:InvoiceTypeCode"), ["326"]);
  assert.deepEqual(werte(xml, "cbc:BuyerReference"), [LEITWEG]);
  assert.ok(xml.includes(`<cbc:EndpointID schemeID="0204">${LEITWEG}</cbc:EndpointID>`));
  assert.ok(xml.includes('<cbc:EndpointID schemeID="EM">info@example.de</cbc:EndpointID>'));
  assert.deepEqual(werte(xml, "cbc:PayableAmount"), ["11900.00"]);
  assert.deepEqual(werte(xml, "cbc:LineExtensionAmount"), ["10000.00", "4000.00", "6000.00"]);
  assert.deepEqual(werte(xml, "cbc:TaxAmount"), ["1900.00", "1900.00"]);
  assert.deepEqual(werte(xml, "cbc:PaymentMeansCode"), ["58"]);
  assert.deepEqual(werte(xml, "cbc:ID").filter((v) => v.startsWith("DE0")), ["DE02120300000000202051"]);
  assert.deepEqual(werte(xml, "cbc:StartDate"), ["2026-07-01"]);
  assert.equal(dateiname, "XRechnung-RE-2026-001.xml");
  // UBL sequence: DueDate before InvoiceTypeCode, TaxTotal before LegalMonetaryTotal before the lines.
  assert.ok(xml.indexOf("cbc:DueDate") < xml.indexOf("cbc:InvoiceTypeCode"));
  assert.ok(xml.indexOf("cac:TaxTotal") < xml.indexOf("cac:LegalMonetaryTotal"));
  assert.ok(xml.indexOf("cac:LegalMonetaryTotal") < xml.indexOf("cac:InvoiceLine"));
  assert.ok(xml.indexOf("AccountingSupplierParty") < xml.indexOf("AccountingCustomerParty"));
});

test("fehlende Büro- und Empfängerangaben: jede Lücke mit ihrer Regel, kein XML", () => {
  const leer = wirksameEinstellungen({});
  const r = rechnung({ empfaenger: { name: "Stadt Musterstadt", anschrift: "", art: "oeffentlich" } });
  const { xml, fehler } = exportiereXRechnung(r, { einst: leer, briefkopf: null });
  assert.equal(xml, null);
  const regeln = fehler.map((f) => f.regel).sort();
  assert.deepEqual(regeln, ["BR-06", "BR-DE-15", "BR-DE-16", "BR-DE-2", "BR-DE-23", "BR-DE-3", "BR-DE-34", "BR-DE-4", "BR-DE-5", "BR-DE-6", "BR-DE-7", "BR-DE-8", "BR-DE-9"].sort());
  for (const f of fehler) assert.equal(f.text, MELDUNGEN[f.regel]);
});

test("Leitweg-ID: Rechnungsfeld geht vor dem Vertrag; ungültige Prüfziffer wird gemeldet", () => {
  const eigene = xrechnungModell(rechnung({ leitweg_id: "992-90009-96" }), { einst: EINST, briefkopf: BRIEFKOPF });
  assert.equal(eigene.kaeuferReferenz, "992-90009-96");
  const falsch = xrechnungModell(rechnung({ leitweg_id: "992-90009-97" }), { einst: EINST, briefkopf: BRIEFKOPF });
  assert.deepEqual(pruefeXRechnung(falsch).map((f) => f.regel), ["LEITWEG"]);
});

test("empfaengerAus trägt die Leitweg-ID des Vertrags nur, wenn gesetzt (alte Form unverändert)", () => {
  const mit = empfaengerAus({ bauherr_name: "Amt", bauherr_leitweg_id: " 992-90009-96 " }, [], null);
  assert.equal(mit.leitweg_id, "992-90009-96");
  const ohne = empfaengerAus({ bauherr_name: "Amt" }, [], null);
  assert.deepEqual(Object.keys(ohne).sort(), ["anschrift", "art", "name", "ust_idnr"]);
});

test("Summenregeln: manipulierte Beträge verletzen BR-CO-15 und BR-S-09", () => {
  const m = xrechnungModell(rechnung({ ust: 1899.99, brutto: 11900 }), { einst: EINST, briefkopf: BRIEFKOPF });
  const regeln = pruefeXRechnung(m).map((f) => f.regel);
  assert.ok(regeln.includes("BR-CO-15"));
  assert.ok(regeln.includes("BR-S-09"));
});

test("LP-Summe ≠ Netto: eine Sammelposition statt falscher Zeilen (BR-CO-10 bleibt erfüllt)", () => {
  const m = xrechnungModell(rechnung({ lp_pos: [{ lp: 2, stand: 100, netto: 1 }] }), { einst: EINST, briefkopf: BRIEFKOPF });
  assert.equal(m.positionen.length, 1);
  assert.equal(m.positionen[0].nettoCent, 1000000);
  assert.equal(m.positionen[0].name, "Abschlagszahlung Architektenhonorar");
  assert.deepEqual(pruefeXRechnung(m), []);
});

test("0 %: Kategorie E mit Befreiungsgrund, Steuer 0, Steuernummer genügt statt USt-IdNr.", () => {
  const b = rechnungBetraege(10000, 0);
  const einst = wirksameEinstellungen({ buero: { name: "Beispiel Architekturbüro", steuernr: "000/000/00000", ust_idnr: "", iban: "DE02120300000000202051" } });
  const { xml, fehler } = exportiereXRechnung(rechnung({ ust_satz: 0, ust: b.ust, brutto: b.brutto }), { einst, briefkopf: BRIEFKOPF });
  assert.deepEqual(fehler, []);
  assert.ok(xml);
  assert.ok(xml.includes("<cbc:ID>E</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReason>"));
  assert.ok(xml.includes("<cbc:ID>FC</cbc:ID>"));
  assert.deepEqual(werte(xml, "cbc:TaxAmount"), ["0.00", "0.00"]);
});

test("Storno: CreditNote 381 mit positiven Beträgen, Positionen und Verweis auf die Originalrechnung", () => {
  const original = rechnung({ status: "storniert" });
  const storno = {
    id: "s1", nummer: "RE-2026-002", art: "storno", status: "gestellt", storno_von: "r1", project_name: "Testhaus",
    netto: -10000, ust_satz: 19, ust: -1900, brutto: -11900, rechnungsdatum: "2026-10-05", faellig_am: "2026-10-05",
    empfaenger: original.empfaenger,
  };
  const { xml, fehler } = exportiereXRechnung(storno, { einst: EINST, briefkopf: BRIEFKOPF, rechnungen: [original, storno] });
  assert.deepEqual(fehler, []);
  assert.ok(xml);
  wohlgeformt(xml);
  assert.ok(xml.includes("<CreditNote xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2\""));
  assert.deepEqual(werte(xml, "cbc:CreditNoteTypeCode"), ["381"]);
  assert.ok(!xml.includes("cbc:DueDate"));
  assert.deepEqual(werte(xml, "cbc:PayableAmount"), ["11900.00"]);
  assert.equal((xml.match(/<cac:CreditNoteLine>/g) || []).length, 2);
  assert.ok(xml.includes('<cbc:CreditedQuantity unitCode="C62">1</cbc:CreditedQuantity>'));
  assert.ok(xml.includes("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>RE-2026-001</cbc:ID><cbc:IssueDate>2026-10-01</cbc:IssueDate>"));
});

test("Entwurf ohne Nummer: STATUS und BR-02, kein XML", () => {
  const { xml, fehler } = exportiereXRechnung(rechnung({ status: "entwurf", nummer: undefined }), { einst: EINST, briefkopf: BRIEFKOPF });
  assert.equal(xml, null);
  assert.deepEqual(fehler.map((f) => f.regel), ["STATUS", "BR-02"]);
});

test("Escaping: Sonderzeichen im Namen bleiben wohlgeformt; Dateiname dateisystemsicher", () => {
  const r = rechnung({ empfaenger: { name: "Müller & Söhne <GbR>", anschrift: "Weg 1, 90403 Musterstadt", leitweg_id: LEITWEG } });
  const { xml } = exportiereXRechnung(r, { einst: EINST, briefkopf: BRIEFKOPF });
  assert.ok(xml);
  wohlgeformt(xml);
  assert.ok(xml.includes("Müller &amp; Söhne &lt;GbR&gt;"));
  assert.equal(xmlText(`a"b'c`), "a&quot;b&apos;c");
  assert.equal(xrechnungDateiname("RE/2026 001"), "XRechnung-RE-2026-001.xml");
});

test("jede Regelmeldung hat einen englischen Eintrag", () => {
  const en = new Map(englischePaareAlle().map(([de, wert]) => [de, wert]));
  for (const text of Object.values(MELDUNGEN)) assert.ok(en.has(text), `EN fehlt: ${text}`);
});
