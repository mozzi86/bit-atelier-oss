// Gemeinsame Anzeige-Labels für Machbarkeits-Rohwerte (Daten-/Enum-Werte bleiben unverändert).

// Erschließung (data.utilities-Keys)
export const UTILITY_LABELS = {
  water: "Wasser",
  sewer: "Abwasser",
  electric: "Strom",
  gas: "Gas",
  heat: "Fernwärme",
  telecom: "Telekommunikation"
};

// Baukörper-Typen (massing.buildings[].type)
export const BUILDING_TYPE_LABELS = {
  apartment_tower: "Wohnhochhaus",
  apartment_block: "Wohnblock",
  townhouse: "Reihenhaus",
  office: "Bürogebäude",
  office_tower: "Bürohochhaus",
  retail: "Einzelhandel",
  mixed_use: "Mischnutzung",
  parking: "Parkhaus"
};

// Ausrichtung (massing.buildings[].orientation)
export const ORIENTATION_LABELS = {
  north: "Nord",
  north_east: "Nordost",
  east: "Ost",
  south_east: "Südost",
  south: "Süd",
  south_west: "Südwest",
  west: "West",
  north_west: "Nordwest"
};

// Wirkung der KI-Vorschläge (suggestion.impact)
export const IMPACT_LABELS = {
  high: "hoch",
  medium: "mittel",
  low: "gering"
};

// Fallback: unbekannte Rohwerte lesbar anzeigen (Unterstriche zu Leerzeichen).
export const labelFor = (map, value) =>
  map[value] || (typeof value === "string" ? value.replaceAll("_", " ") : value);
