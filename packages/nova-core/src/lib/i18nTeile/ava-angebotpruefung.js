// Besitzer: 90-04 — nur diese Datei ändern.
//
// English dictionary part of the offer check (AngebotPruefungDialog + the check controls in the
// Preisspiegel). Existing keys ("Schließen", "Speichern…", "ohne Preis" …) are not repeated
// (duplicate guard in tests/unit/i18nAbdeckung.test.js). "Anschlag" is taken (door hinge side) —
// the dialog says "Kostenanschlag-EP".
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Angebots-PDF stempeln": "Stamp the offer PDF",
  "Angebotsprüfung": "Offer check",
  "Angebotssumme des Bieters weicht ab": "Bidder's offer total differs",
  "Angebotssumme laut Bieter (netto, optional)": "Offer total stated by the bidder (net, optional)",
  "Befund / Hinweis": "Finding / hint",
  "Befund(e)": "finding(s)",
  "Befunde (rechnerisch)": "Findings (arithmetic)",
  "Bemerkung": "Remark",
  "Bieter": "Bidder",
  "Einheitspreis 0,00 €": "Unit price 0.00 €",
  "Einzelpreis auffällig": "Unit price conspicuous",
  "GP Bieter": "Total (bidder)",
  "GP nachgerechnet": "Total (recomputed)",
  "GP ≠ Menge × EP": "Total ≠ quantity × unit price",
  "Geprüft von": "Checked by",
  "Hinweise (Plausibilität)": "Hints (plausibility)",
  "Keine Auffälligkeiten in den Positionen.": "No anomalies in the positions.",
  "Kostenanschlag-EP": "Cost-estimate unit price",
  "Leere EP-Felder bleiben leer (kein Preis) — sie werden nicht als 0 gespeichert.": "Empty unit price fields stay empty (no price) — they are not saved as 0.",
  "Median Bieter": "Bidders' median",
  "Menge": "Quantity",
  "Menge vom Bieter geändert": "Quantity changed by the bidder",
  "Noch kein Prüfvermerk.": "No check note yet.",
  "Position": "Item",
  "Protokoll als CSV": "Protocol as CSV",
  "Prüfung veraltet": "Check outdated",
  "Prüfvermerk gespeichert": "Check note saved",
  "Prüfvermerk gestempelt": "Check note stamped",
  "Prüfvermerk speichern": "Save check note",
  "Prüfvermerk veraltet — die Preise haben sich seit der Prüfung geändert. Bitte neu prüfen.": "Check note outdated — the prices changed since the check. Please check again.",
  "Prüfvermerk vom": "Check note of",
  "Seite(n)": "page(s)",
  "Summe laut Bieter": "Total stated by the bidder",
  "Summe nachgerechnet (LV-Mengen)": "Total recomputed (BoQ quantities)",
  "aktuell": "current",
  "alle Positionen": "all items",
  "alle Seiten": "all pages",
  "alle zeigen": "show all",
  "deutlich unter dem nächsten Angebot – Aufklärung prüfen": "far below the next offer – consider asking for clarification",
  "erst „Geprüft von“ ausfüllen": "fill in “Checked by” first",
  "erste Seite": "first page",
  "geprüft": "checked",
  "kein Preis": "no price",
  "letzte Seite": "last page",
  "nur Positionen mit Befund oder Hinweis": "only items with a finding or hint",
  "prüfen": "check",
  "unter dem nächsten vollständigen Angebot": "below the next complete offer",
  "unvollständig": "incomplete",
};
