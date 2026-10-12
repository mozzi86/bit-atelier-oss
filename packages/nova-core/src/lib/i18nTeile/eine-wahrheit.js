// Besitzer: 89-07 — nur diese Datei ändern.
//
// English dictionary part of "one truth" (89-07, BW-09): the one door system in the apartment
// focus (zone door = door component with GUID, furniture reads its swing — wohnMoebel
// BAUTEIL_TUER_TEXTE, passed to t() by WohnungsFokus) and the workshop components the AVA derives
// from the saved workshop (useWerkstattZonen).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double quotes.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Türen sind Bauteile mit GUID — die Möblierung liest ihren Aufschlag.": "Doors are components with a GUID — the furniture reads their swing.",
  "Türaufschlag einer Raumtür (Bauteil) trifft dieses Möbel.": "The swing of a room door (component) hits this piece of furniture.",
  "Türaufschlag einer Raumtür (Bauteil) schneidet die Bewegungsfläche dieses Möbels.": "The swing of a room door (component) cuts the movement area of this piece of furniture.",
  "Möbeltür doppelt: die Türen dieser Wohnung sind Bauteile der Werkstatt — bitte löschen.": "Duplicate furniture door: the doors of this unit are workshop components — please delete it.",
  "aus der Werkstatt dieser Sitzung": "from the workshop of this session",
  "aus der gespeicherten Werkstatt abgeleitet": "derived from the saved workshop",
};
