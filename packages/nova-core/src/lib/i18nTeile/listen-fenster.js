// English dictionary part of plan 72-21 (windowed lists: filter fields of the check
// suite findings and of the AVA bill of quantities). Decision list § 5: new UI texts
// go here, i18n.jsx stays closed. The guard (tests/unit/i18nAbdeckung.test.js) refuses
// a key that exists elsewhere.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // --- 72-21: ModelCheck — filter over findings and IDS violations.
  "Befunde filtern: Nr., GlobalId, Bauteiltyp, Regel, Name": "Filter findings: no., GlobalId, element type, rule, name",
  "Befunde filtern": "Filter findings",
  "{{n}} von {{m}} Befunden": "{{n}} of {{m}} findings",
  "Kein Befund passt zum Filter.": "No finding matches the filter.",
  "Kein Bauteil passt zum Filter.": "No element matches the filter.",
  // --- 72-21: LVTable — filter over the positions.
  "Positionen filtern: OZ, Titel, Kurztext, Gewerk, KG": "Filter items: item no., title, short text, trade, cost group",
  "Positionen filtern": "Filter items",
  "{{n}} von {{m}} Positionen": "{{n}} of {{m}} items",
  "Keine Position passt zum Filter.": "No item matches the filter.",
};
