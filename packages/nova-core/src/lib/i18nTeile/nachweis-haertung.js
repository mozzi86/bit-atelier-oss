// Besitzer: 72-04 — nur diese Datei ändern.
//
// English dictionary part of the attribute check before the quantity takeover in the IFC viewer
// (mengenAttributPruefung.js). Existing keys ("offen", "Hinweis" …) are not repeated (duplicate
// guard in tests/unit/i18nAbdeckung.test.js). Placeholders {n}/{werte} are replaced after t().
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "{n} Bauteil(e) ohne DIN-276-Klassifikation im Modell — Kostengruppe nur aus dem Bauteiltyp abgeleitet":
    "{n} element(s) without DIN 276 classification in the model — cost group only derived from the element type",
  "{n} Bauteil(e) mit anderer Kostengruppe als die Position: {werte}": "{n} element(s) with a cost group other than the position: {werte}",
  "{n} Bauteil(e) ohne Feuerwiderstand (FireRating)": "{n} element(s) without fire rating (FireRating)",
  "Feuerwiderstand gemischt: {werte} — eine Position, verschiedene Qualitäten?": "Mixed fire ratings: {werte} — one position, different qualities?",
  "{n} Bauteil(e) ohne Angabe tragend/nichttragend (LoadBearing)": "{n} element(s) without load-bearing flag (LoadBearing)",
  "Tragende und nichttragende Bauteile gemischt — DIN 276 trennt 341/342": "Load-bearing and non-load-bearing elements mixed — DIN 276 separates 341/342",
  "Attribute vollständig: DIN 276, Feuerwiderstand, tragend": "Attributes complete: DIN 276, fire rating, load-bearing",
  "Übernahme bleibt möglich — die Befunde werden an der Position vermerkt.": "Takeover stays possible — the findings are noted at the position.",
  "Übernommen mit offenen Attributen — Befunde an der Position vermerkt.": "Taken over with open attributes — findings noted at the position.",
};
