// Grundriss-Bedienung (2D handling of the BIM studio, parts 1–3): English texts of the hints and labels it adds. German source text = key.
//
// LAZY part (size budget of the entry chunk, pattern efh-108.js): NOT listed in ./index.js. BitBimStudio.jsx imports this file and
// calls englischErgaenzen(EN) of ../i18n.jsx once at module level (existing keys win). Keys already defined in another part
// ("Länge (m)" in bestand.js, the snap labels of fangEinstellungen.js) are not repeated — the guard test refuses a key defined twice.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  // point 2: wall end / typed length (@core/lib/bauteil/grundrissBearbeiten.js)
  "Wand zu kurz – eine Wand braucht mindestens 5 cm Länge.": "Wall too short – a wall needs a length of at least 5 cm.",
  "Kein gültiger Punkt.": "No valid point.",
  "Keine gültige Länge.": "No valid length.",
  "Wand ohne Richtung – Länge nicht änderbar.": "Wall without direction – length cannot be changed.",
  // point 4: ⌘A / Ctrl+A
  "Keine Bauteile in diesem Geschoss": "No elements on this storey",
  // part 2: drag the selection, Alt = copies
  "+ Kopie": "+ copy",
  "Objekt(e) verschoben": "object(s) moved",
  "Verschieben abgebrochen": "Move cancelled",
  // part 3: typed length in the wall chain
  "Länge": "Length",
  "Enter setzt den Punkt, Esc leert": "Enter sets the point, Esc clears",
  "Kein gültiges Maß – Ziffern mit Komma, in Metern.": "Not a valid length – digits with a decimal comma, in metres.",
  "Keine Richtung – den Zeiger vom letzten Punkt wegbewegen.": "No direction – move the pointer away from the last point.",
};
