// English dictionary part of plan 66-15 (finding ↔ construction section: order of the
// check suite findings by section date, storeys per delivery in the delivery plan).
// Decision list § 5: new UI texts go here, i18n.jsx stays closed. The printed report
// stays German (like the rest of the report).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // --- 66-15: ModelCheck — order select and section group headers.
  "Ordnen nach": "Order by",
  "Paar-Typ": "Pair type",
  "Abschnittstermin (was blockiert zuerst)": "Section date (what blocks first)",
  "ohne Abschnittstermin — nach Schwere": "no section date — by severity",
  "blockiert als Nächstes": "blocks next",
  "in {{n}} Tagen": "in {{n}} days",
  "{{n}} Tage überfällig": "{{n}} days overdue",
  "ganzes Gebäude": "whole building",
  "blockiert keinen Abschnitt mit Termin": "blocks no dated section",
  "kein Abschnittstermin im Modelllieferplan": "no section date in the model delivery plan",
  // --- 66-15: LieferpaketKarte — storeys of a section.
  "alle / gleichnamig": "all / same-named",
  "Kein Geschoss im Modell.": "No storey in the model.",
};
