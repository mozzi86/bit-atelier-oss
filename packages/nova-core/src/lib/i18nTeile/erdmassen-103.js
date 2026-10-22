// B-103-03: English texts of the earthworks, pit and data-basis panels of TerrainView3D.jsx, plus the
// LO-01 label of StaticsPlanner.jsx (22.10.2026)
// (before hard-coded German). Placeholders {a} {b} {n} {w} {d} are filled with String.replace.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Synthetisches Gelände (Offline-Fallback).": "Synthetic terrain (offline fallback).",
  "Die Höhen sind aus dem Standort errechnet — eine glatte Fläche mit fester Neigung, kein Geländemodell. Die folgenden Kubikmeter sind ein Rechenbeispiel und keine Mengen.":
    "The heights are computed from the location — a smooth plane with a fixed slope, no terrain model. The cubic metres below are a worked example, not quantities.",
  "Rechen-Raster {a} m über {b} m": "Calculation grid {a} m over {b} m",
  "Anzeige-Raster {a} m über {b} m": "Display grid {a} m over {b} m",
  "Quelle Copernicus DEM GLO-90 (~{n} m native Rasterweite)": "Source Copernicus DEM GLO-90 (~{n} m native grid)",
  "unterscheidbare Stützstellen unter dem Baufeld ({w}×{d} m): {n}": "distinct support points under the footprint ({w}×{d} m): {n}",
  "kein Baufeld — ganzer Geländeausschnitt": "no footprint — whole terrain extract",
  "Baufeld ohne gezeichnete Lage — am Projektstandort abgetastet": "footprint without a drawn position — sampled at the project location",
  "Damit sind die Volumen nur eine Größenordnung: Das Baufeld ist kleiner als das Höhenraster, die Geländeform darunter ist interpoliert. Für Aushubmengen ist eine Vermessung bzw. ein amtliches DGM erforderlich.":
    "The volumes are therefore only an order of magnitude: the footprint is smaller than the height grid, the terrain under it is interpolated. Excavation quantities need a survey or an official DTM.",
  "Standard-Planum = mittlere Geländehöhe unter dem Baufeld. Abtrag ≈ Auftrag ist dann rechnerisch vorgegeben und keine Aussage über den Standort.":
    "Default formation level = mean terrain height under the footprint. Cut ≈ fill is then a consequence of the calculation, not a statement about the site.",
  "Erdmassen": "Earthworks",
  "Größenordnung": "order of magnitude",
  "auf Baufeld begrenzt": "limited to the footprint",
  "ganzer Geländeausschnitt": "whole terrain extract",
  "Abtrag": "Cut",
  "Auftrag": "Fill",
  "Planum {n} m ü. NHN": "Formation level {n} m a.s.l.",
  "Planum-Höhe anpassen": "Adjust formation level",
  "Baugrube": "Excavation pit",
  "Tiefe {n} m": "Depth {n} m",
  "Aushubtiefe unter Planum": "Excavation depth below formation level",
  "Böschung {n}°": "Slope {n}°",
  "Böschungswinkel": "Slope angle",
  "Aushub": "Excavation",
  "Sohle": "Bottom",
  "Krone": "Top edge",
  "Arbeitsraum 0,5 m": "Working space 0.5 m",
  "Gesamt": "Total",
  // LO-01: wind zone has no calculation behind it
  "Windzone (informativ, ohne Rechenwirkung)": "Wind zone (for information, no effect on the calculation)",
  // LO-05: DÖE import year (PriceReferencePanel.jsx)
  "Jahr zwischen {a} und {b} eingeben": "Enter a year between {a} and {b}",
};
