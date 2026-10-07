// Anzeige-Labels für BIM-Rohwerte (Layer-Keys, Gewerke). Die Rohwerte in State und
// Daten bleiben unverändert — hier wird ausschließlich die Anzeige übersetzt.

// Modell-Layer / Gewerke (visibleLayers-Keys, IFC-Disziplinen)
export const LAYER_LABELS = {
  structure: "Tragwerk",
  architecture: "Architektur",
  mechanical: "Heizung-Klima",
  electrical: "Elektro",
  plumbing: "Sanitär",
  site: "Außenanlagen",
  fire: "Brandschutz"
};

// Fallback: unbekannte Rohwerte lesbar anzeigen (Unterstriche zu Leerzeichen).
export const labelFor = (map, value) =>
  map[value] || (typeof value === "string" ? value.replaceAll("_", " ") : value);
