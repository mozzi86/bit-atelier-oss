// Besitzer: 79-13 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Gesamt-Export und Abschluss (Welle 4)".
// Decision list § 5: i18n.jsx is touched once per phase (79-01); every area plan
// writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Export": "Export",
  "Export der Buchhaltung": "Accounting export",
  "Alle Bereiche als Excel ({jahr})": "All areas as Excel ({jahr})",
  "Ein Blatt je Bereich in der Reihenfolge der Reiter und die Jahresübersicht — Beträge als Zahlen, Daten als Datum, ohne Formeln.": "One sheet per area in tab order plus the annual summary — amounts as numbers, dates as dates, no formulas.",
  "CSV je Bereich": "CSV per area",
  "Jeder Reiter hat oben eigene Knöpfe für CSV und Excel.": "Every tab has its own CSV and Excel buttons at the top.",
  "DATEV-Buchungsstapel im Reiter Jahresübersicht": "DATEV booking batch in the Annual summary tab",
  // Reason of the 1 % rule factor (fuhrpark.faktorGrund) — the German sentence
  // stayed untranslated in English until the 79-13 language check found it.
  "Elektrofahrzeug außerhalb der gesetzlichen Staffel (Anschaffung {datum})": "Electric vehicle outside the statutory staggering (acquired {datum})",
  "Elektrofahrzeug bis {grenze} € (BLP {blp} €)": "Electric vehicle up to €{grenze} (list price €{blp})",
  "Elektrofahrzeug über {grenze} € (BLP {blp} €)": "Electric vehicle above €{grenze} (list price €{blp})",
  "Hybrid: CO₂ {co2} g/km ≤ {max} g/km": "Hybrid: CO₂ {co2} g/km ≤ {max} g/km",
  "Hybrid außerhalb der gesetzlichen Staffel (Anschaffung {datum})": "Hybrid outside the statutory staggering (acquired {datum})",
  "Reichweite {km} km ≥ {grenze} km": "Electric range {km} km ≥ {grenze} km",
  "Reichweite {km} km < {grenze} km": "Electric range {km} km < {grenze} km",
};
