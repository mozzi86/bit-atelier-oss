// 115-13 (D-115-48/49, W-1118-03): English texts of the stair types in the inspector of the building model — the type choice with
// preview, the fields of the two-flight stair with intermediate landing and its DIN 18065 warnings. German source text = key.
//
// LAZY part (size budget of the entry chunk, pattern raeume-115-12.js): NOT listed in ./index.js. TreppeInspektor.jsx — the lazily
// loaded inspector of a selected stair — imports it and calls englischErgaenzen(EN) of ../i18n.jsx once when it loads. Keys that already
// exist in another part ("Treppe", "Ergebnis", "Hinweise", "links", "rechts", the 108-06 stair fields in efh-108.js) are not repeated —
// the guard (tests/unit/i18nAbdeckung.test.js) refuses a key defined twice.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Treppenart": "Stair type",
  "gerade, einläufig": "straight, single flight",
  "zweiläufig mit Zwischenpodest": "two flights with intermediate landing",
  "Steigungen Lauf 1": "Risers of flight 1",
  "Treppenauge (m)": "Stairwell eye (m)",
  "Podesttiefe (m)": "Landing depth (m)",
  "Wendung": "Turn",
  "Läufe": "Flights",
  "Podestfläche": "Landing area",
  "Podesttiefe kleiner als die Laufbreite (DIN 18065)": "Landing depth below the flight width (DIN 18065)",
  "Mehr als 18 Steigungen in einem Lauf (DIN 18065)": "More than 18 risers in one flight (DIN 18065)",
};
