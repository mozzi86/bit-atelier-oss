// Anzeige-Labels für Kontakt-Rohwerte (DB-Werte der Kategorie bleiben unverändert).
export const CATEGORY_LABELS = {
  client: "Bauherr",
  engineer: "Fachplanung",
  consultant: "Beratung",
  manufacturer: "Hersteller",
  contractor: "Auftragnehmer",
  internal: "Intern"
};

// Fallback: unbekannte Rohwerte lesbar anzeigen (Unterstriche zu Leerzeichen).
export const labelFor = (map, value) =>
  map[value] || (typeof value === "string" ? value.replaceAll("_", " ") : value);
