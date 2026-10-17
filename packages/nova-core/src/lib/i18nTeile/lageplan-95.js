// Phase 95 (site plan / Baufeld-Planung, tickets 15.10.): English texts of the block tools
// (selection, move/copy/rotate, snapping, checks) plus the older untranslated strings of
// SiteDesigner.jsx. Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Auswahl-Modus": "Selection mode",
  "Auswahl": "Select",
  "Klick wählt, Umschalt+Klick ergänzt; Rahmen nach rechts = ganz drin, nach links = berührt. Ziehen verschiebt (Strg = Kopie, Alt = ohne Fang), oranger Griff dreht, Pfeile 0,1 m (Umschalt 1 m), Entf löscht.":
    "Click selects, Shift+click adds; frame to the right = fully inside, to the left = touching. Drag moves (Ctrl = copy, Alt = no snapping), the orange handle rotates, arrows 0.1 m (Shift 1 m), Del deletes.",
  "Karte: Leertaste + Ziehen verschiebt die Ansicht, Scrollen zoomt.": "Map: Space + drag pans the view, scrolling zooms.",
  "Fang": "Snap",
  "Drehen (15°-Schritte, Alt = frei)": "Rotate (15° steps, Alt = free)",
  "Grenze": "Boundary",
  "Abstandsfläche": "Setback area",
  "Baufeld": "Building envelope",
  "Baukörper": "Building volume",
  "anderer Block": "other block",
  "Kante": "Edge",
  "Ecke": "Corner",
  "liegt nicht ganz auf dem Grundstück": "is not entirely on the plot",
  "Abstandsfläche reicht über die Grenze": "setback area extends beyond the boundary",
  "überlappt": "overlaps",
  "Abstandsfläche trifft": "setback area hits",
  "Prüfung (Studie)": "Check (study)",
  "Richtwerte 0,4 / 1,2": "reference values 0.4 / 1.2",
  "Ohne Grundstück nicht prüfbar.": "Cannot be checked without a plot.",
  "Keine Konflikte gefunden — Abstandsflächen 0,4 H, mind. 3 m, Geschoss 3,0 m [Annahme].":
    "No conflicts found — setbacks 0.4 H, min. 3 m, storey 3.0 m [assumption].",
  "Erst im Tab „Standort & Karte“ einen Standort übernehmen — ohne Standort fehlt der Bezugspunkt für den Import.":
    "First adopt a location in the “Location & map” tab — without a location the import has no reference point.",
  "Import fehlgeschlagen": "Import failed",
  "Rolle des gezeichneten Polygons": "Role of the drawn polygon",
  "Flurstücke (GeoJSON)": "Cadastral parcels (GeoJSON)",
  "Flurstück löschen": "Delete parcel",
  "Der Import wird erst mit „Entwurf speichern“ dauerhaft (Pflichtfelder: Name + Standort).":
    "The import is only kept after “Save draft” (required: name + location).",
};
