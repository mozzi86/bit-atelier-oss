// Besitzer: 89-02 — nur diese Datei ändern.
//
// English dictionary part of the workshop components (WohnungsWerkstatt: component line with
// shell growth after D-BW-02) and the separating walls read by the sound-insulation planner
// (SchallschutzPlanner). "Bauteile", "Türen", "Räume", "bei" exist elsewhere already.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double quotes.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Anforderung Wohnungstrennwand R'w ≥ 53 dB (DIN 4109-1 Tab. 2)": "requirement for walls between units R'w ≥ 53 dB (DIN 4109-1 Table 2)",
  "Außenwand-Abschnitte (Hülle)": "exterior wall pieces (envelope)",
  "Rohbau": "Shell",
  "Werkstatt-Bauteile": "Workshop components",
  "leichte Innenwände (KS 11,5)": "light interior walls (sand-lime 11.5)",
  "lichter Fläche — Wände liegen außen, Wohnfläche unverändert (D-BW-02)": "clear area — walls lie outside, living area unchanged (D-BW-02)",
  "tragende Innen-/Trennwände (KS 24)": "load-bearing interior/separating walls (sand-lime 24)",
  "tragende Trennwände (Wohnung/Flur/Treppenraum)": "load-bearing separating walls (unit/corridor/stair)",
};
