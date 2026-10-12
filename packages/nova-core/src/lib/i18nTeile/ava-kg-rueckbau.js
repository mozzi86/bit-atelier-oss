// Besitzer: 76-07 — nur diese Datei ändern.
//
// English dictionary part of the cost-group open list in the cost calculation table
// (KostenberechnungTabelle, TypeSafe rollback D-P76-03: rules first, TypeSafe only for the
// open list). Existing keys ("offen", "Regel", "Vorschlag" …) are not repeated (duplicate guard
// in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Gemessen 21.09.2026: ohne Bürokonventionen trifft TypeSafe 18,5 % der Kostengruppen — nur ein Hinweis, keine Zuordnung.":
    "Measured 21 Sep 2026: without office conventions TypeSafe hits 18.5 % of the cost groups — a hint only, not an assignment.",
  "Keine offenen Positionen — alle tragen einen Regel-Vorschlag.": "No open positions — all carry a rule suggestion.",
  "Offene Liste per TypeSafe vorschlagen": "Suggest the open list via TypeSafe",
  "Ohne Kostengruppe": "Without cost group",
  "Regel-Vorschlag übernehmen": "Accept rule suggestion",
  "Regeln zuerst: Vorschläge aus den bereits zugeordneten Positionen dieses LV erscheinen als Chip „Regel“ in der Spalte KG. Offen bleiben Positionen, die keine Regel trifft.":
    "Rules first: suggestions from the already assigned positions of this bill of quantities appear as a \"rule\" chip in the cost group column. Positions no rule hits stay open.",
  "per Regel": "by rule",
};
