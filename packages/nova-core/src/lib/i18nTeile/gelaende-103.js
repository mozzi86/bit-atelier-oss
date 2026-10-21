// Phase 103 (terrain study and flood scenario): English texts of TerrainView3D.jsx,
// GelaendeSteuerung.jsx and HochwasserHqListe.jsx. Existing keys ("Begehung", "Quelle",
// "Bezeichnung", "Entfernen", "lädt…") are reused, not repeated (duplicate guard in
// tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // View and overlays (103-01)
  "Gelände 3D": "Terrain 3D",
  "tiefster Punkt": "lowest point",
  "höchster Punkt": "highest point",
  "Grundstücksmitte": "plot centre",
  "Standort": "Site",
  "Begehung beenden (Esc)": "End walk-through (Esc)",
  "Begehung auf Augenhöhe starten": "Start a walk-through at eye level",
  "Begehung beenden": "End walk-through",
  "Aktuelle Ansicht hochauflösend als PNG exportieren": "Export the current view as a high-resolution PNG",
  "Exposé-Bild": "Exposé image",
  "Die 3D-Ansicht hat den Grafikkontext verloren — Seite neu laden.": "The 3D view lost its graphics context — reload the page.",
  "3D-Ansicht nicht verfügbar — WebGL fehlt oder ist abgeschaltet. Höhen, Pegel und Erdmassen unten gelten trotzdem.":
    "3D view not available — WebGL is missing or switched off. Heights, water level and earthworks below still apply.",
  "Demo-Gelände — erfundene Höhen": "Demo terrain — invented heights",
  "Keine Höhendaten für diesen Standort erreichbar — Form, Koten und Pegel sind Rechenbeispiele.":
    "No elevation data reachable for this site — shape, spot heights and water levels are worked examples.",
  "Copernicus DEM GLO-90 (~90 m, Oberflächenmodell)": "Copernicus DEM GLO-90 (~90 m, surface model)",
  "m ü. NHN (näherungsweise)": "m above sea level (approximate)",
  "m ü. NHN": "m a.s.l.",
  "Nordpfeil": "North arrow",
  "≈ in Bildmitte": "≈ at the image centre",
  "WASD bewegen · Maus ziehen: umsehen · Shift: schnell · Esc: beenden": "WASD move · drag mouse: look around · Shift: fast · Esc: end",
  "Begehung aktiv — Esc oder Button beendet und stellt die Orbit-Ansicht wieder her": "Walk-through active — Esc or the button ends it and restores the orbit view",
  "Ziehen: drehen und neigen · Rad: zoomen": "Drag: rotate and tilt · wheel: zoom",
  // Exaggeration (103-02)
  "Überhöhung {n}×": "Exaggeration {n}×",
  "(echt)": "(true scale)",
  "Überhöhung": "Vertical exaggeration",
  "Höhen werden für die Darstellung gestreckt — 1× ist maßstäblich": "Heights are stretched for display — 1× is true to scale",
  "Ausschnitt": "Cut-out",
  "Der Scan bleibt unverzerrt — nur das Gelände ist {n}× überhöht.": "The scan stays undistorted — only the terrain is exaggerated {n}×.",
  // Water level (103-03)
  "Wasserpegel": "Water level",
  "Wasserpegel in m ü. NHN": "Water level in m a.s.l.",
  "Grundstück wird nass": "Plot gets wet",
  "{name}: Wasser am Baukörper": "{name}: water reaches the building",
  "{name}: EG-Fußboden nass": "{name}: ground floor wet",
  "Grundstück überflutet:": "Plot flooded:",
  "Kein gezeichnetes Grundstück — keine Flächenangabe": "No drawn plot — no area figure",
  "Was überflutet zuerst": "What floods first",
  "Was überflutet zuerst:": "What floods first:",
  "ab": "from",
  "m Wasser": "m of water",
  "Studie nach dem Badewannen-Modell: Alles unter dem Pegel gilt als nass — ohne Fließwege, Deiche, Abfluss oder Rückstau. Kein Hochwassernachweis.":
    "Bathtub-model study: everything below the level counts as wet — no flow paths, dykes, drainage or backwater. Not a flood assessment.",
  "Höhen aus einem 90-m-Oberflächenmodell (Bäume und Dächer können mitgemessen sein), Bezug EGM2008 statt DHHN2016 — Abweichung einige Dezimeter. EG-Fußboden = höchster Geländepunkt unter dem Baukörper + 0,30 m (Annahme).":
    "Heights from a 90-m surface model (trees and roofs may be included), datum EGM2008 instead of DHHN2016 — a few decimetres apart. Ground floor = highest terrain point under the building + 0.30 m (assumption).",
  // Design flood levels in the flood tab (103-03)
  "Bemessungswasserstände (HQ)": "Design flood levels (HQ)",
  "Wasserstände aus der amtlichen Hochwassergefahrenkarte eintragen — sie erscheinen als Marken am Pegel-Schieber in „Gelände 3D“.":
    "Enter water levels from the official flood hazard map — they appear as marks on the water level slider in “Terrain 3D”.",
  "Noch keine HQ-Werte eingetragen.": "No HQ values entered yet.",
  "Wasserstand in m ü. NHN": "Water level in m a.s.l.",
  "z. B. Hochwassergefahrenkarte, Stand 2024": "e.g. flood hazard map, 2024 edition",
  "HQ-Wert hinzufügen": "Add HQ value",
};
