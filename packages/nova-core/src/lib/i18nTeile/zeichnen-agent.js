// English texts of the drawing-agent inputs (numeric wall, opening, slab, zone,
// copy storey, massing corners, footprint-grip hint). German source text = key.
//
// LAZY part (size budget of the entry chunk): NOT listed in ./index.js. BitBimStudio,
// ZeichenMasszeile and MassingStudio import it and call englischErgaenzen() once.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Ecken (m)": "Corners (m)",
  "Ecke x (m)": "Corner x (m)",
  "Ecke y (m)": "Corner y (m)",
  "Ecken übernehmen": "Apply corners",
  "Start x (m)": "Start x (m)",
  "Start z (m)": "Start z (m)",
  "Winkel (°)": "Angle (°)",
  "Wand setzen": "Place wall",
  "Klick rastet ein, Alt ist frei. 0° zeigt nach +x, 90° nach +z (Süden).": "A click snaps, Alt is free. 0° points along +x, 90° along +z (south).",
  "Abstand (m)": "Offset (m)",
  "Öffnung setzen": "Place opening",
  "Tiefe (m)": "Depth (m)",
  "Decke setzen": "Place slab",
  "Raum setzen": "Place room",
  "von Geschoss": "from storey",
  "nach Geschoss": "to storey",
  "Geschoss kopieren": "Copy storey",
  "dieses Geschoss": "this storey",
  "Wand abgebrochen — Esc noch einmal beendet das Werkzeug": "Wall cancelled — Esc again leaves the tool",
  "Ecke bleibt: Doppelklick direkt nach dem Wählen ändert den Grundriss nicht. Wand wählen, kurz warten, Griff erneut doppelklicken — oder Rückgängig.": "Corner kept: a double-click right after selecting does not change the footprint. Select the wall, wait a moment, double-click the grip again — or undo.",
  "Keine Bauteile auf diesem Geschoss.": "No elements on this storey.",
  "Geschoss kopiert.": "Storey copied.",
  "Auswahl löschen": "Delete selection",
};
