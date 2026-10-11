// Besitzer: 90-10 — nur diese Datei ändern.
//
// English dictionary part of the per-KG cost control card (KostenJeKgKarte in CostControl) and its
// budget-increase dialog. The Excel export and the PDF stay German. Existing keys ("Prognose",
// "Bezeichnung", "Schließen" …) are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Abgerechnet": "Billed",
  "Abweichung": "Deviation",
  "Antrag als PDF (Entwurf)": "Request as PDF (draft)",
  "Antrag auf Budgeterhöhung": "Request for a budget increase",
  "Beantragtes Budget (€)": "Requested budget (€)",
  "Begründung (Lücken ______ ergänzen)": "Justification (fill in the gaps ______)",
  "Budget (LV-Anschlag)": "Budget (BoQ estimate)",
  "Budget bisher": "Current budget",
  "Budgeterhöhung": "Budget increase",
  "Deckungsvorschlag": "Proposed cover",
  "Excel-Export": "Excel export",
  "Keine LV-Positionen.": "No BoQ items.",
  "Kostenkontrolle je Kostengruppe (DIN 276)": "Cost control per cost group (DIN 276)",
  "Prognose = Vergabesumme der vergebenen Positionen + Anschlag der noch nicht vergebenen. Nachträge haben keine Kostengruppe und stehen im Export als eigene Summe.": "Forecast = contract value of the awarded items + estimate of those not yet awarded. Change orders have no cost group and appear as a separate total in the export.",
  "Vergabe": "Award",
  "z. B. Einsparung in KG …, Reserve": "e.g. savings in cost group …, reserve",
};
