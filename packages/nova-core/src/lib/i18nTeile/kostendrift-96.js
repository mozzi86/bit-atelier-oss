// Phase 96 (96-03): English texts of the frozen anrechenbare Kosten and the
// LV drift notice (KostenDriftHinweis, LeistungsbildFelder,
// HonorarvertragFormular, VertragReiter). Format and guard as in every part
// file (tests/unit/i18nAbdeckung.test.js refuses a key defined twice).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "eingefroren am {datum}": "frozen on {datum}",
  "LV hat sich seit dem Einfrieren um {x} % geändert (Stand {datum})": "The bill of quantities has changed by {x} % since the costs were frozen (as of {datum})",
  "LV hat sich seit dem Einfrieren geändert (Stand {datum})": "The bill of quantities has changed since the costs were frozen (as of {datum})",
  "Die eingefrorenen Kosten bleiben Grundlage des Vertrags; gestellte Abschlagsrechnungen ändern sich nicht.": "The frozen costs remain the basis of the contract; issued instalment invoices do not change.",
  "Mit „aus LV übernehmen“ den neuen Stand einfrieren.": "Use “Take from bill of quantities” to freeze the new stand.",
  "Vertrag im Entwurf: über „Honorar-Grundlagen bearbeiten“ neu aus dem LV übernehmen.": "Draft contract: take the costs from the bill of quantities again via “Edit fee basis”.",
  "Als Honorarnachtrag übernehmen": "Take over as fee amendment",
  "Anrechenbare Kosten fortgeschrieben (LV-Stand {datum})": "Eligible costs updated (bill of quantities as of {datum})",
  "LV konnte für den Kostenvergleich nicht geladen werden": "Could not load the bill of quantities for the cost comparison",
};
