// Wave 1 (B-81-04): English texts of the 16 federal states (option labels of the
// rule "kalender.bundesland", src/lib/abwesenheit/kalenderRegeln.js) and of the
// holidays of the states other than Bavaria (src/lib/abwesenheit/feiertagNamen.js).
// "Bayern" exists already (buero-orga-fundament.js) and is not repeated.
//
// LAZY part (index.js, sanctioned exception): imported by RegelwerkBereich.jsx,
// FeiertageReiter.jsx and MonatsRaster.jsx, which call englischErgaenzen(EN).
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Baden-Württemberg": "Baden-Württemberg",
  "Berlin": "Berlin",
  "Brandenburg": "Brandenburg",
  "Bremen": "Bremen",
  "Hamburg": "Hamburg",
  "Hessen": "Hesse",
  "Mecklenburg-Vorpommern": "Mecklenburg-Western Pomerania",
  "Niedersachsen": "Lower Saxony",
  "Nordrhein-Westfalen": "North Rhine-Westphalia",
  "Rheinland-Pfalz": "Rhineland-Palatinate",
  "Saarland": "Saarland",
  "Sachsen": "Saxony",
  "Sachsen-Anhalt": "Saxony-Anhalt",
  "Schleswig-Holstein": "Schleswig-Holstein",
  "Thüringen": "Thuringia",
  "Internationaler Frauentag": "International Women's Day",
  "Tag der Befreiung": "Liberation Day",
  "Weltkindertag": "World Children's Day",
  "Reformationstag": "Reformation Day",
  "Buß- und Bettag": "Day of Repentance and Prayer",
};
