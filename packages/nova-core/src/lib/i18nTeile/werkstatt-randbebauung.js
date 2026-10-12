// Besitzer: 86-04 — nur diese Datei ändern.
//
// English dictionary part of the workshop building-form control (WohnungsWerkstatt: automatic
// decomposition vs. perimeter block around a court, storeys per house) and the proposal hint
// (VorschlaegePanel: dropped storey counts). "Riegel" exists in massing-studio.js already.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double quotes.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "(nur Werkstatt — das Massing-Volumen bleibt einheitlich hoch)": "(workshop only — the massing volume keeps one height)",
  "Bebauung": "Building form",
  "Geschosse je Haus": "Storeys per house",
  "Geschosszahlen je Haus": "storey counts per house",
  "Randbebauung (Hof)": "Perimeter block (court)",
  "automatisch (Riegel/Zeilen)": "automatic (bars/rows)",
};
