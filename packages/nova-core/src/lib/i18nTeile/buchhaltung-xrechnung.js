// Besitzer: 93-01 — nur diese Datei ändern.
//
// English dictionary part of the XRechnung export (lever 156): the download button
// (XRechnungKnopf), the Leitweg-ID fields of fee contract and invoice, and every rule
// message of src/lib/accounting/xrechnung.js (MELDUNGEN — the unit test
// buchhaltung-xrechnung.test.js checks that each one has an entry here).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "XRechnung": "XRechnung",
  "XRechnung erstellt": "XRechnung created",
  "XRechnung nicht erstellt — Pflichtangaben fehlen": "XRechnung not created — mandatory details are missing",
  "Elektronische Rechnung nach EN 16931 für öffentliche Auftraggeber": "Electronic invoice under EN 16931 for public clients",
  "Leitweg-ID": "Leitweg-ID",
  "Leitweg-ID (für XRechnung)": "Leitweg-ID (for XRechnung)",
  "aus dem Honorarvertrag": "from the fee contract",
  // Rule messages (xrechnung.js MELDUNGEN).
  "Rechnungsnummer fehlt (BT-1) — nur gestellte Rechnungen haben eine Nummer.": "Invoice number missing (BT-1) — only issued invoices have a number.",
  "Rechnungsdatum fehlt (BT-2).": "Invoice date missing (BT-2).",
  "Name des Büros fehlt (BT-27) — Einstellungen › Büro & Briefkopf.": "Office name missing (BT-27) — Settings › Office & letterhead.",
  "Name des Rechnungsempfängers fehlt (BT-44).": "Name of the invoice recipient missing (BT-44).",
  "Die Rechnung hat keine Position (BG-25).": "The invoice has no line (BG-25).",
  "Ein Einzelpreis ist negativ (BT-146).": "A unit price is negative (BT-146).",
  "Summe der Positionen weicht vom Nettobetrag ab (BT-106).": "Sum of the lines differs from the net amount (BT-106).",
  "Umsatzsteuer weicht von der Summe der Steueraufschlüsselung ab (BT-110).": "VAT differs from the sum of the VAT breakdown (BT-110).",
  "Bruttobetrag ist nicht Netto plus Umsatzsteuer (BT-112).": "Gross amount is not net plus VAT (BT-112).",
  "Fälligkeitsdatum oder Zahlungsbedingung fehlt (BT-9/BT-20).": "Due date or payment terms missing (BT-9/BT-20).",
  "Umsatzsteuer passt nicht zu Bemessungsgrundlage und Satz (BT-117).": "VAT does not match taxable amount and rate (BT-117).",
  "Zahlungsangaben fehlen (BG-16).": "Payment instructions missing (BG-16).",
  "Kontaktangaben des Büros fehlen (BG-6).": "Office contact details missing (BG-6).",
  "Ort des Büros fehlt (BT-37) — Anschrift im Briefkopf mit „PLZ Ort“ angeben.": "Office city missing (BT-37) — enter the letterhead address with “postcode city”.",
  "Postleitzahl des Büros fehlt (BT-38) — Anschrift im Briefkopf mit „PLZ Ort“ angeben.": "Office postcode missing (BT-38) — enter the letterhead address with “postcode city”.",
  "Ansprechpartner des Büros fehlt (BT-41).": "Office contact point missing (BT-41).",
  "Telefonnummer des Büros fehlt (BT-42) — im Briefkopf unter Kontakt angeben.": "Office phone number missing (BT-42) — enter it under contact in the letterhead.",
  "E-Mail-Adresse des Büros fehlt (BT-43) — im Briefkopf unter Kontakt angeben.": "Office e-mail address missing (BT-43) — enter it under contact in the letterhead.",
  "Ort des Rechnungsempfängers fehlt (BT-52) — Anschrift am Honorarvertrag mit „PLZ Ort“ angeben.": "Recipient city missing (BT-52) — enter the address on the fee contract with “postcode city”.",
  "Postleitzahl des Rechnungsempfängers fehlt (BT-53) — Anschrift am Honorarvertrag angeben.": "Recipient postcode missing (BT-53) — enter the address on the fee contract.",
  "Leitweg-ID bzw. Käuferreferenz fehlt (BT-10) — am Honorarvertrag oder an der Rechnung eintragen.": "Leitweg-ID or buyer reference missing (BT-10) — enter it on the fee contract or the invoice.",
  "USt-IdNr. oder Steuernummer des Büros fehlt (BT-31/BT-32) — Buchhaltung › Einstellungen.": "Office VAT ID or tax number missing (BT-31/BT-32) — Accounting › Settings.",
  "Rechnungsart ist für XRechnung nicht zulässig (BT-3).": "Invoice type is not allowed for XRechnung (BT-3).",
  "IBAN des Büros fehlt (BT-84) — Buchhaltung › Einstellungen.": "Office IBAN missing (BT-84) — Accounting › Settings.",
  "Elektronische Adresse des Büros fehlt (BT-34) — E-Mail im Briefkopf angeben.": "Office electronic address missing (BT-34) — enter an e-mail in the letterhead.",
  "Leitweg-ID hat kein gültiges Format oder eine falsche Prüfziffer (BT-10/BT-49).": "Leitweg-ID has an invalid format or a wrong check digit (BT-10/BT-49).",
  "Nur gestellte oder stornierte Rechnungen lassen sich als XRechnung ausgeben.": "Only issued or cancelled invoices can be exported as XRechnung.",
};
