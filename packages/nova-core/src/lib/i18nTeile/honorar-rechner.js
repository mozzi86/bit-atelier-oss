// Besitzer: 81-03, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 81 "Honorarrechner und Labor-Hülle".
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
  "Basishonorarsatz": "Base fee rate",
  "Oberer Honorarsatz": "Top fee rate",
  "Gewählter Satz": "Chosen rate",
  "Als Honorarangebot übernehmen": "Use as fee offer",
};
