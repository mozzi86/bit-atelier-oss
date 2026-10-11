// Besitzer: 90-08 — nur diese Datei ändern.
//
// English dictionary part of the minutes book (ProtokollBuch, Berichte › Protokolle) and the item kinds of
// src/lib/protokoll/protokoll.js. The PDF stays German. Existing keys ("Titel", "Datum", "Ort", "Name" …)
// are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Aufgabe": "Task",
  "Festlegung": "Decision",
  "Firma": "Company",
  "Fortschreiben": "Carry forward",
  "Hinweis": "Note",
  "Information": "Information",
  "Inhalt": "Content",
  "Neues Protokoll": "New minutes",
  "Noch keine Protokolle.": "No minutes yet.",
  "Nr.": "No.",
  "Nummerierte Protokolle dieses Projekts. Offene Aufgaben werden beim Fortschreiben übernommen.": "Numbered minutes of this project. Open tasks are carried over when carrying forward.",
  "Nächster Termin": "Next meeting",
  "Protokolle": "Minutes",
  "Punkt": "Item",
  "Punkte": "Items",
  "Teilnehmer": "Participants",
  "Thema": "Topic",
  "Verteiler": "Distribution",
  "anwesend": "present",
};
