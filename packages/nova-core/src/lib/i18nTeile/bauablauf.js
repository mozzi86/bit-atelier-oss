// Besitzer: 89-05 — nur diese Datei ändern.
//
// English dictionary part of the construction sequence chain (src/lib/planung/bauablauf.js,
// BauablaufKette card, chain fields of TaskScheduleForm, Gantt badge). Existing keys
// ("Bauabschnitt", "Gewerk", "LV-Positionen" …) are not repeated (duplicate guard).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Bauablauf-Kette": "Construction sequence chain",
  "Bauteil → Gewerk → LV-Position → Vorgang. Hinweise, keine Sperren: Überlappungen können gewollt sein.": "Element → trade → BoQ item → task. Hints, no locks: overlaps may be intended.",
  "Vorgänger und Reihenfolge": "Predecessors and order",
  "Keine Auffälligkeiten.": "Nothing conspicuous.",
  "Vergabeeinheiten": "Award units",
  "Noch keine Vorgänge mit Vergabeeinheit.": "No tasks with an award unit yet.",
  "Vergabeeinheit": "Award unit",
  "Gewerke": "Trades",
  "Baubeginn": "Start on site",
  "Vergabe spätestens": "Award at the latest",
  "Vergabe spätestens = Baubeginn − {n} Tage [Annahme].": "Award at the latest = start on site − {n} days [assumption].",
  "Deckungsreport: jedes Bauteil hat Gewerk, Position, Vorgang": "Coverage report: every element has trade, BoQ item, task",
  "Kein Modellstand mit Bauteilen — Werkstatt-Bauteile folgen mit 89-03.": "No model state with elements — workshop elements follow with 89-03.",
  "{v} von {g} Bauteilen vollständig": "{v} of {g} elements complete",
  "Vorgang": "Task",
  "ohne Gewerk": "without trade",
  "ohne Position": "without BoQ item",
  "ohne Vorgang": "without task",
  "Vorgang bearbeiten": "Edit task",
  "Gewerk (STLB-Leistungsbereich)": "Trade (STLB work section)",
  "— ohne Katalog —": "— without catalogue —",
  "z. B. BA 1": "e.g. CS 1",
  "z. B. VE 03 Rohbau": "e.g. AU 03 shell",
  "Vorgänger": "Predecessors",
  "Anordnung": "Relationship",
  "Abstand (Tage)": "Lag (days)",
  "Bauteile (IFC-GUIDs, je Zeile eine)": "Elements (IFC GUIDs, one per line)",
  "Ende → Anfang": "Finish → start",
  "Anfang → Anfang": "Start → start",
  "Ende → Ende": "Finish → finish",
  "Termin verletzt die Anordnungsbeziehung zum Vorgänger": "Date violates the relationship to the predecessor",
  "Ungewöhnliche Gewerke-Reihenfolge (Vorgänger-Gewerk kommt üblicherweise später)": "Unusual trade order (the predecessor's trade usually comes later)",
  "Vorgänger bilden einen Kreis": "Predecessors form a cycle",
  "Vorgänger nicht mehr vorhanden": "Predecessor no longer exists",
};
