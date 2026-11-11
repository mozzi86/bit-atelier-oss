// Quick task 261110-mzj: English texts of the 3D navigation (walk mode button and hint). German source text = key.
//
// LAZY part (size budget of the entry chunk): NOT listed in ./index.js. LaufModusHinweis.jsx and DreiDLeiste.jsx import
// it and call englischErgaenzen() of ../i18n.jsx once when they load; every viewer that shows these texts renders them.
// The guard test (tests/unit/i18nAbdeckung.test.js) reads this file like every other part.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Durchlaufen": "Walk through",
  "Durchlaufen (W A S D) – durch das Modell gehen": "Walk through (W A S D) – move through the model",
  "Durchlaufen startet nicht, solange ein Werkzeug die Kamera hält": "Walk-through does not start while a tool holds the camera",
  "Durchlaufen beenden": "End walk-through",
  "W A S D gehen": "W A S D walk",
  "Leertaste / C hoch / runter": "Space / C up / down",
  "Umschalt schnell": "Shift fast",
  "+ / − oder Mausrad Tempo": "+ / − or wheel speed",
  "Esc beendet": "Esc ends",
  "Tempo {tempo} m/s": "Speed {tempo} m/s",
  "Blick folgt der Maus": "View follows the mouse",
  "ins Modell klicken zum Umsehen": "click into the model to look around",
  // 261110-mzl: the "3D-Fenster" bar (DreiDLeiste.jsx)
  "3D-Fenster": "3D window",
  "Ganzes Modell zeigen": "Show the whole model",
  "Auswahl zeigen": "Show the selection",
  "Bild der Ansicht speichern": "Save a picture of the view",
  "Exposé-Bild speichern": "Save the exposé picture (2x PNG)",
  "Render-Modus umschalten": "Toggle render mode",
  // 261110-vf3: the 3D section of the BIM studio
  "Axonometrie (Parallelprojektion)": "Axonometry (parallel projection)",
  "3D-Schnitt": "3D section",
  "Kein Schnitt": "No section",
  "Schnitt waagerecht": "Horizontal section",
  "Schnitt senkrecht (X)": "Vertical section (X)",
  "Schnitt senkrecht (Z)": "Vertical section (Z)",
  "Lage der Schnittebene": "Position of the section plane",
  "Schnittseite wechseln": "Switch the kept side",
};
