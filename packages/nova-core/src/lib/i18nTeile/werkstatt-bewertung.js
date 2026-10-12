// Besitzer: 75-10 — nur diese Datei ändern.
//
// English dictionary part of the variant evaluation in the workshop "Vorschläge" tab
// (VorschlaegePanel: weights, rank badge, "why rank 1"; dimension labels of the register
// DIMENSIONEN in @designer/lib/variantenBewertung — the panel passes d.label to t()).
// "Bürostandard" and "Rang" exist elsewhere already.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double quotes.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Belichtung (Fassade je WE)": "Daylight (facade per unit)",
  "Bewertung (gewichtet)": "Evaluation (weighted)",
  "Bewertung — Gewichte": "Evaluation — weights",
  "Gewicht": "weight",
  "Graue Energie": "Embodied carbon",
  "K.-o.": "Knock-out",
  "Kompaktheit A/V": "Compactness A/V",
  "Nur harte Regeln schließen aus (Planungsfehler, Rettungsweg > 35 m); keine weichen Kriterien.": "Only hard rules exclude (planning errors, escape route > 35 m); no soft criteria.",
  "Versiegelung je Wohnfläche": "Sealed area per living area",
  "Vorschläge ausgeschlossen (K.-o.)": "proposals excluded (knock-out)",
  "Warum Rang 1": "Why rank 1",
  "Wohnfläche / BGF": "Living area / GFA",
};
