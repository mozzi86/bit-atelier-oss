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
  // 100-06 (Argon review 18.10.): draft amendment hint
  "Honorarnachtrag Nr. {nr} im Entwurf — noch nicht beim Bauherrn. Die Kostenänderung ist erst mit Angebot und Beauftragung vereinbart.":
    "Fee amendment no. {nr} is a draft — not yet with the client. The cost change is only agreed once offered and commissioned.",
  // 100-05 (Argon review 18.10.): office catalogue update
  "Katalog-Update übernehmen?": "Apply the catalogue update?",
  "Büro-Katalog veraltet: Abbruch gehört zu LB 084 (nicht 040, das ist Wärmeversorgung), KG 212 Abbruchmaßnahmen fehlt.":
    "Office catalogue outdated: demolition belongs to LB 084 (not 040, which is heating), KG 212 demolition is missing.",
  "Katalog-Update: LB 084 (Abbruch), KG 212 ergänzen": "Catalogue update: add LB 084 (demolition), KG 212",
  "Hinweis: Ein Abbruch-Eintrag steht noch unter LB 040 — LB 084 ist vorhanden; den alten Eintrag bei Bedarf selbst löschen.":
    "Note: a demolition entry is still filed under LB 040 — LB 084 exists; delete the old entry yourself if needed.",
};
