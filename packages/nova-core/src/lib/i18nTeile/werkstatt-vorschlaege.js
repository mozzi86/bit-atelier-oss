// Besitzer: 86-05b — nur diese Datei ändern.
//
// English dictionary part of the workshop tab "Vorschläge" (building proposals): tab,
// sort control, status lines, stale badge, applied hint and the labels of the figure
// register KENNZAHLEN (@designer/lib/bebauungsvorschlaege — the card passes k.label to t()).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double quotes. The
// guard (tests/unit/i18nAbdeckung.test.js) refuses a key that already exists in i18n.jsx or
// another part file — "Vorschläge", "Übernehmen", "Vorschlag", "Riegel" exist there already.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Algorithmus geändert": "algorithm changed",
  "Anordnungen": "arrangements",
  "BGF": "GFA",
  "Berechnung läuft …": "Computing …",
  "Erschließungslänge": "Circulation length",
  "Fails": "fails",
  "Fassade je WE": "Facade per unit",
  "Flächeneffizienz": "Area efficiency",
  "Füllgrad": "Fill rate",
  "Grenzpositionen": "boundary positions",
  "Grundfläche geändert": "footprint changed",
  "Keine Vorschläge für diese Grundfläche": "No proposals for this footprint",
  "Kerne": "Cores",
  "Längster Rettungsweg": "Longest escape route",
  "Restfläche": "Remainder area",
  "Sortieren nach": "Sort by",
  "Sperren": "locks",
  "Stufen-Schalter": "level switches",
  "Türaufschläge": "door swings",
  "Vorschlag übernommen": "Proposal applied",
  "Vorschlag veraltet": "Proposal outdated",
  "Vorschläge konnten nicht berechnet werden": "Proposals could not be computed",
  "Warnungen": "Warnings",
  "Wohneinheiten": "Residential units",
  "Wohnfläche": "Living area",
  "ein Baukörper": "one building",
  "gewählt": "selected",
  "keine layout-gebundenen Eingaben verworfen": "no layout-bound inputs discarded",
  "verworfen": "discarded",
  "Übernehmen Sie einen Vorschlag aus der aktuellen Liste.": "Apply a proposal from the current list.",
  // 86-05c: comparison + "ähnliche erzeugen"
  "Als PDF exportieren": "Export as PDF",
  "Aus dem Vergleich entfernen": "Remove from comparison",
  "Auswahl leeren": "Clear selection",
  "Erdgeschoss": "Ground floor",
  "Export läuft …": "Exporting …",
  "Kennzahlen: Einheit und Quelle": "Figures: unit and source",
  "Liste voll — keine weiteren Vorschläge": "List full — no further proposals",
  "Nachbarn ohne Zufall: Erschließung ±1, Riegel-Mindestfläche bis zur nächsten anderen Zerlegung": "Neighbours without randomness: access type ±1, bar minimum up to the next different decomposition",
  "PDF gespeichert": "PDF saved",
  "Vergleich": "Comparison",
  "Vergleich schließen": "Close comparison",
  "Vergleichen": "Compare",
  "Ähnliche erzeugen": "Generate similar",
  "Ähnliche werden berechnet …": "Computing similar proposals …",
  "beste Zelle je Zeile hervorgehoben": "best cell per row highlighted",
  "größer ist besser": "larger is better",
  "höchstens 4 Vorschläge im Vergleich": "at most 4 proposals in the comparison",
  "keine neuen ähnlichen Vorschläge (Rechteck: ein Riegel, alle Erschließungen vorhanden)": "no new similar proposals (rectangle: one bar, every access type present)",
  "keine neuen ähnlichen Vorschläge (alle schon in der Liste)": "no new similar proposals (all already listed)",
  "kleiner ist besser": "smaller is better",
  "ähnlich zu": "similar to",
  "ähnliche Vorschläge hinzugefügt": "similar proposals added",
};
