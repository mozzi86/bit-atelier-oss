// English dictionary part of "An Plan ablegen" in the BIM studio (packages/nova-designer/src/components/BitBimStudio.jsx,
// output panel): file the current floor plan / section PDF directly on a plan of the plan list. Keys already defined by the
// plan list ("Pläne konnten nicht geladen werden", "Plandatei konnte nicht abgelegt werden", "Noch keine Pläne in diesem
// Projekt.") are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "PDF an Plan ablegen": "File PDF on a drawing",
  "Plan wählen …": "Choose a drawing …",
  "An Plan ablegen": "File on drawing",
  "PDF am Plan ersetzen": "Replace the drawing's PDF",
  "● = Plan hat schon ein PDF. Nur Grundriss und Schnitt aus dem Modell.": "● = the drawing already has a PDF. Floor plans and sections from the model only.",
  "Bitte zuerst einen Plan aus der Planliste wählen.": "Please choose a drawing from the drawing list first.",
  "PDF 1:{{massstab}} an Plan „{{plan}}“ abgelegt.": "PDF 1:{{massstab}} filed on drawing \"{{plan}}\".",
};
