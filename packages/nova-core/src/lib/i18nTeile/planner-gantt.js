// Besitzer: 90-09 — nur diese Datei ändern.
//
// English dictionary part of the Planner Excel import and the large-format Gantt PDF (PlannerGanttWerkzeuge
// above the site Gantt). The PDF stays German. Existing keys ("Vorgänge", "Abbrechen" …) are not repeated
// (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Ausschließen (Gliederungsnummern oder Namen, mit Komma)": "Exclude (outline numbers or names, comma-separated)",
  "Blatt": "Sheet",
  "Eigene Aufgaben bleiben unverändert.": "Own tasks stay unchanged.",
  "Gantt als PDF": "Gantt as PDF",
  "Kompletter Plan": "Whole plan",
  "Kopfzeile": "Header row",
  "Papierformat": "Paper size",
  "Planner-Excel importieren": "Import Planner Excel",
  "Planner-Export (.xlsx)": "Planner export (.xlsx)",
  "Vorgänge importiert": "tasks imported",
  "Vorgänge werden übernommen.": "tasks will be imported.",
  "Zweig": "Branch",
  "eigene Aufgaben unverändert": "own tasks unchanged",
  "erledigt": "done",
  "frühere Planner-Vorgänge ersetzt": "earlier Planner tasks replaced",
  "frühere Planner-Vorgänge werden ersetzt.": "earlier Planner tasks will be replaced.",
  "quer": "landscape",
};
