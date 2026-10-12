// Besitzer: 81-04, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 81 "Honorarnachträge".
// Decision list § 5 / HANDOFF § 5: i18n.jsx is touched once per phase (81-01, menu
// and "Weiter mit" only); every plan writes its English texts only into its own
// part file under i18nTeile/. Only texts of this area here — a generic word that
// is missing after 81-01 goes here too and is named in the plan's SUMMARY (it
// moves to zeit-honorar-fundament.js when the lanes are merged, 79 pattern).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  "Honorarnachtrag gespeichert": "Fee amendment saved",
  "ohne Leistungsphase": "no work stage",
  "Berechnung": "Calculation",
  "Verrechnungssatz": "Charge-out rate",
  "Wiederholte Leistungsphase": "Repeated work stage",
  "Wiederholung (% der LPH)": "Repetition (% of work stage)",
  "Betrag netto": "Net amount",
  "zuzüglich Nebenkosten laut Vertrag": "plus incidental costs per contract",
  "Honorarnachträge gehören zu einem Architektenvertrag.": "Fee amendments belong to an architect's contract.",
  "Vertragssumme inkl. beauftragter Honorarnachträge": "Contract total incl. commissioned fee amendments",
  "Neuer Honorarnachtrag": "New fee amendment",
  "Keine Honorarnachträge.": "No fee amendments.",
  "erbracht (%)": "done (%)",
  "Anbieten": "Offer",
  "Beauftragen": "Commission",
  "Honorarnachtrag anbieten?": "Offer fee amendment?",
  "Honorarnachtrag beauftragen?": "Commission fee amendment?",
  "Honorarnachtrag als abgelehnt markieren?": "Mark fee amendment as rejected?",
  "Leistungsänderung": "Change of services",
  "Wiederholung von Grundleistungen": "Repetition of basic services",
  "Anordnung des Bauherrn": "Client's instruction",
  "Kostenfortschreibung": "Cost update",
  "Terminverlängerung": "Schedule extension",
};
