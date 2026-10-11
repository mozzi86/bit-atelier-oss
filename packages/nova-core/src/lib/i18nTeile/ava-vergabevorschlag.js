// Besitzer: 90-05 — nur diese Datei ändern.
//
// English dictionary part of the award proposal dialog (VergabevorschlagDialog in the Preisspiegel):
// labels, procedures, warning texts and text-block titles. The text blocks themselves and the PDF stay
// German — they are the document that goes to the client. Existing keys ("Bieter", "Vorschlag", "netto" …)
// are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Aufklärung niedriger Preis": "Clarification of a low price",
  "Auftrags-LV als PDF": "Contract BoQ as PDF",
  "Begründung (Textbausteine — Lücken ______ im PDF von Hand ergänzen)": "Justification (text blocks — fill in the gaps ______ by hand in the PDF)",
  "Beschränkte Ausschreibung": "Restricted tender",
  "Beteiligung": "Participation",
  "Das vorgeschlagene Angebot hat noch keinen Prüfvermerk.": "The proposed offer has no check note yet.",
  "Der Prüfvermerk ist veraltet – die Preise haben sich seit der Prüfung geändert.": "The check note is outdated – the prices changed since the check.",
  "Deutlicher Preisabstand – Aufklärung nach § 16d Abs. 1 VOB/A dokumentieren.": "Large price gap – document the clarification under § 16d (1) VOB/A.",
  "Die rechnerische Prüfung hat Befunde ergeben – vor der Vergabe klären.": "The arithmetic check found issues – clarify before the award.",
  "Direktauftrag": "Direct award",
  "Eigener Text (optional)": "Own text (optional)",
  "Empfehlung": "Recommendation",
  "Freihändige Vergabe": "Negotiated award",
  "Kein vollständiges Angebot – kein Vorschlag möglich.": "No complete offer – no proposal possible.",
  "Kostenanschlag LV": "BoQ cost estimate",
  "Kostenberechnung": "Cost calculation",
  "Kostenberechnung brutto (optional)": "Cost calculation gross (optional)",
  "Kostenvergleich": "Cost comparison",
  "MwSt. (%)": "VAT (%)",
  "Nicht das günstigste Angebot": "Not the cheapest offer",
  "Nicht gewertete Angebote": "Offers not evaluated",
  "Nur ein wertbares Angebot.": "Only one offer that can be evaluated.",
  "Prüfung": "Check",
  "Rang": "Rank",
  "Rechnerische Prüfung": "Arithmetic check",
  "Verfahren": "Procedure",
  "Vergabevorschlag": "Award proposal",
  "Vergabevorschlag als PDF": "Award proposal as PDF",
  "Vergabevorschlag gespeichert — der Zuschlag bleibt ein eigener Schritt im Preisspiegel.": "Award proposal saved — the award stays a separate step in the price comparison.",
  "Vorgeschlagen wird nicht das günstigste Angebot – Begründung erforderlich.": "The proposed offer is not the cheapest – justification required.",
  "Vorgeschlagener Bieter": "Proposed bidder",
  "Vorschlag speichern": "Save proposal",
  "Wirtschaftlichstes Angebot": "Most economical offer",
  "nicht gewertet": "not evaluated",
  "zum Kostenanschlag": "vs. cost estimate",
  "Öffentliche Ausschreibung": "Open tender",
};
