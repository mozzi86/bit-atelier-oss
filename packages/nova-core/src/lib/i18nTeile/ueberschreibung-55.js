// 55-01: English texts of BIT-Überschreibung (graphic rules editor, presets, 3D switch, IFC viewer hint).
// German source text = key.
//
// LAZY part (size budget of the entry chunk, pattern ansicht-107-12.js): NOT listed in ./index.js. Every module that shows
// these texts imports this file and calls englischErgaenzen(EN) of ../i18n.jsx once at module level (existing keys win).
// Today: RegelEditor.jsx, BitBimStudio.jsx, IfcViewer.jsx.
// Keys already defined elsewhere (i18n.jsx / a11y-namen / ava-vhb / bauteilkern-107 / buchhaltung-ausgaben) are NOT repeated —
// the i18nAbdeckung guard forbids duplicates across part files.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Regel-Editor": "Rule editor",
  "Nach oben": "Move up",
  "Nach unten": "Move down",
  "Erste passende Regel gewinnt": "First matching rule wins",
  "Bedingung": "Condition",
  "Operator": "Operator",
  "Füllung": "Fill",
  "Kontur": "Outline",
  "Strich": "Dash",
  "Strichbreite (mm)": "Stroke width (mm)",
  "Deckkraft": "Opacity",
  "dunkler": "darker",
  "Vorlage laden": "Load preset",
  "Als Vorlage speichern": "Save as preset",
  "Name der Vorlage": "Preset name",
  "Brandschutz-Prüfung": "Fire-safety check",
  "Tragende Bauteile": "Load-bearing elements",
  "Unvollständiger Steckbrief": "Incomplete data sheet",
  "Eingebaute Vorlagen": "Built-in presets",
  "Projekt-Vorlagen": "Project presets",
  "Regel-Vorlage gespeichert": "Rule preset saved",
  "Regeln im BIM-Studio bearbeiten": "Edit rules in the BIM studio",
  // technical field / operator ids shown in the editor (unique keys = the id itself where not already taken)
  "feuerwiderstand": "fire resistance",
  "bauteil_typ": "element type",
  "schallschutz_rw_db": "sound insulation Rw (dB)",
  "u_wert": "U-value",
  "enthaelt": "contains",
  "vordergrund": "foreground",
};
