// Besitzer: 89-06 — nur diese Datei ändern.
//
// English dictionary part of the 4D timeline construction section × trade (FourDFiveD,
// src/lib/planung/zeitstrahl.js, decision D-BW-04). "Bauabschnitt" and "Gewerk" were old keys
// without English (i18n-en-altlast.json) — translated here and removed from that list.
// Existing keys ("Ist" …) are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Zeitpunkt": "Point in time",
  "4D — Bauzustand je Bauabschnitt und Gewerk": "4D — construction state per section and trade",
  "Keine Vorgänge mit Start- und Enddatum — im Bauzeitenplan anlegen.": "No tasks with start and end date — create them in the construction schedule.",
  "Bauabschnitt": "Construction section",
  "Gewerk": "Trade",
  "nicht begonnen": "not started",
  "fertig": "finished",
  "Baufortschritt (Soll, dauergewichtet)": "Construction progress (planned, duration-weighted)",
  "Auf der Baustelle am": "On site on",
  "Vorgänge ohne gültiges Start-/Enddatum nicht dargestellt": "Tasks without a valid start/end date not shown",
  "Bauteilgenau (Bauteile je Datum ein-/ausblenden) folgt mit den Bauteil-GUIDs aus 89-03.": "Element-level (show/hide elements per date) follows with the element GUIDs from 89-03.",
};
