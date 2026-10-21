// Phase 104-05 (object snap): English texts of the snap switches, the right-click group "Fang", the command line
// chips and the snap messages (@core/lib/fangEinstellungen.js). "Fang" and "Raster" already live in
// lageplan-95.js / massing-98.js. Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Objektfang": "Object snap",
  "Endpunkt": "Endpoint",
  "Mitte": "Midpoint",
  "Schnittpunkt": "Intersection",
  "Lot": "Perpendicular",
  "Nächster": "Nearest",
  "Ortho": "Ortho",
  "Polar": "Polar",
  "Objektfang an": "Object snap on",
  "Objektfang aus": "Object snap off",
  "Ortho an": "Ortho on",
  "Ortho aus": "Ortho off",
  "Polar an": "Polar tracking on",
  "Polar aus": "Polar tracking off",
  "Raster an": "Grid snap on",
  "Raster aus": "Grid snap off",
  "Polarwinkel 1 bis 180 Grad": "Polar angle 1 to 180 degrees",
  "Rastermaß größer 0 bis 100 m": "Grid spacing above 0 up to 100 m",
  "Einmal-Fang: Endpunkt": "One-shot snap: endpoint",
  "Einmal-Fang: Mitte": "One-shot snap: midpoint",
  "Einmal-Fang: Schnittpunkt": "One-shot snap: intersection",
  "Einmal-Fang: Lot": "One-shot snap: perpendicular",
  "Einmal-Fang: Nächster": "One-shot snap: nearest",
  // browser storage registry (browserSpeicher.js)
  "Fang-Einstellungen der Zeichenflächen (Objektfang, Ortho, Polar, Raster)": "Snap settings of the drawing surfaces (object snap, ortho, polar, grid)",
};
