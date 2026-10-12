// Besitzer: 81-04, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 81 "Architektenverträge, Auftragsbestätigung, Vertragskonto, Abschlag".
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
  "Honorarangebot annehmen?": "Accept fee offer?",
  "Aus Honorarangebot {a} wird der Architektenvertrag {v}.": "Fee offer {a} becomes architect's contract {v}.",
  "Annehmen": "Accept",
  "Architektenvertrag {v} angelegt": "Architect's contract {v} created",
  "Annehmen fehlgeschlagen": "Accepting failed",
  "Noch kein Architektenvertrag": "No architect's contract yet",
  "ohne Nummer": "no number",
  "Ein Architektenvertrag entsteht, wenn ein versendetes Honorarangebot angenommen wird.": "An architect's contract is created when a sent fee offer is accepted.",
  "Summe inkl. Honorarnachträge": "Total incl. fee amendments",
  "Rest bis zur Schlussrechnung": "Remaining until final invoice",
  "Honorar-Grundlagen bearbeiten": "Edit fee basis",
  "Vertragsdaten": "Contract data",
  "Änderungen an einem beauftragten Vertrag als Honorarnachtrag erfassen.": "Record changes to a commissioned contract as a fee amendment.",
  "Status ändern?": "Change status?",
  "Vertragsdaten gespeichert": "Contract data saved",
  "Auftragsbestätigung": "Order confirmation",
  "wird beim Speichern vergeben": "assigned on saving",
  "Vertragsdatum": "Contract date",
  "Stufen der Beauftragung": "Commissioning stages",
  "beauftragt am": "commissioned on",
  "Stufe beauftragen": "Commission stage",
  "Stufe hinzufügen": "Add stage",
  "Termine": "Dates",
  "Meilenstein": "Milestone",
  "Termin hinzufügen": "Add date",
  "Haftung": "Liability",
  "Berufshaftpflicht bei": "Professional liability insurance with",
  "Haftungsbegrenzung": "Limitation of liability",
  "Deckung Personenschäden (€)": "Cover personal injury (€)",
  "Deckung Sach- und Vermögensschäden (€)": "Cover property and financial loss (€)",
  "laut Architektenvertrag": "per architect's contract",
  "vereinbart je Bauherr": "agreed per client",
  "vertraglich vereinbart": "contractually agreed",
  "Mitzuverarbeitende Bausubstanz (€)": "Existing building fabric to be incorporated (€)",
  "Die Projektleitung pflegt das Personal.": "Project management maintains the staff records.",
  "Projektzuordnung pflegen": "Maintain project assignment",
  "Auftragsbestätigung erzeugen": "Create order confirmation",
  "Vertragskonto": "Contract account",
  "Erbracht": "Earned",
  "Storno": "Cancellation",
  "Tafel seit Vertragsschluss geändert — maßgeblich ist der Vergütungs-Beleg.": "Fee table changed since the contract was signed — the remuneration record is binding.",
  "Leistungsstand": "Progress",
  "Leistungsstand im Formular eintragen (Leistungsbild ohne neun LPH).": "Enter progress in the form (service profile without nine work stages).",
  "Noch keine Rechnung zu diesem Vertrag.": "No invoice for this contract yet.",
  "Abschlagsrechnung Nr. {n}": "Instalment invoice no. {n}",
  "Ohne Betrag kein Abschlag (Tafel fehlt).": "No instalment without an amount (fee table missing).",
  "Abschlagsrechnung stellen": "Issue instalment invoice",
  "in der Buchhaltung öffnen (ohne Honorarnachträge)": "open in accounting (without fee amendments)",
};
