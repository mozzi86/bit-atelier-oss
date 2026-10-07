// Besitzer: 79-09 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Anlagenverzeichnis (Spur B)".
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
  "AK netto": "Net acquisition cost",
  "AfA im Jahr": "Depreciation this year",
  "Abgangsdatum (optional)": "Disposal date (optional)",
  "Anlage angelegt": "Asset created",
  "Anlage aus Eingangsrechnung aktiviert": "Asset activated from the invoice",
  "Anlage bearbeiten": "Edit asset",
  "Anlage gespeichert": "Asset saved",
  "Anlagenverzeichnis": "Fixed-asset register",
  "Aus Eingangsrechnung aktivieren": "Activate from an incoming invoice",
  "Bezeichnung": "Name",
  "Bitte ein Abgangsdatum eingeben.": "Please enter a disposal date.",
  "Bitte eine Bezeichnung eingeben.": "Please enter a name.",
  "Bitte eine Nutzungsdauer von mindestens einem Jahr eingeben.": "Please enter a useful life of at least one year.",
  "Bitte einen Anschaffungswert eingeben.": "Please enter an acquisition cost.",
  "Büroausstattung": "Office equipment",
  "Fahrzeuge aus dem Fuhrpark übernehmen": "Take over vehicles from the fleet",
  "GWG": "Low-value asset",
  "GWG-Grenze": "Low-value-asset limit",
  "Keine Anlagegüter angelegt.": "No fixed assets recorded yet.",
  "Keine aktivierbaren Eingangsrechnungen.": "No incoming invoices to activate.",
  "Keine offenen Kauf-Fahrzeuge.": "No unassigned purchased vehicles.",
  "Linear": "Straight line",
  "Neue Anlage": "New asset",
  "Nutzungsdauer (Jahre)": "Useful life (years)",
  "Plotter": "Plotter",
  "Rechner": "Computer",
  "Restbuchwert": "Book value",
  "Sofortabzug": "Immediate write-off",
  "Übernehmen": "Take over",
  "Veräußerungserlös (optional)": "Disposal proceeds (optional)",
  "Werte und Quelle in den Einstellungen.": "Values and source in Settings.",
};
