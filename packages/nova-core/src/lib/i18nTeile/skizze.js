// Besitzer: 72-05 — nur diese Datei ändern.
//
// English dictionary part of the sketch tool (SketchStudio, variant a: freehand with pen pressure,
// widths, colours, eraser; the constraint drawing is a mode). Existing keys ("Labor", "Skizze" — the menu title lives in i18n.jsx …) are not
// repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Stift": "Pen",
  "Radierer": "Eraser",
  "Modus": "Mode",
  "Freihand": "Freehand",
  "Constraint-Modus": "Constraint mode",
  "Strichstärke": "Line width",
  "fein": "fine",
  "mittel": "medium",
  "breit": "broad",
  "Farbe": "Colour",
  "Striche": "Strokes",
  "Stiftbreite bei 1:100": "Pen width at 1:100",
  "Freihand mit Stift: Druck steuert die Strichstärke, Radierer entfernt ganze Striche (auch die Radiertaste des Stifts).":
    "Freehand with a pen: pressure sets the line width, the eraser removes whole strokes (also the pen's eraser button).",
  "Die Skizze ist größer als 256 KB — sie liegt im Datensatz des Projekts. Alte Striche radieren oder aufteilen.":
    "The sketch is larger than 256 KB — it lives in the project record. Erase old strokes or split it.",
};
