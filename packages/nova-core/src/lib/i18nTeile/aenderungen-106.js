// 106-03: English texts of the change proposals of phase 106 (@core/lib/zeigen/aenderungen.js, pruefung.js).
// The sentence templates are German texts WITH {placeholders}; the code passes them to t() by variable and fills the
// placeholders afterwards (satzAusVorlage), so the coverage guard does not see them - they are listed here so the
// English UI does not fall back to German. Words for empty/yes/no and the origin labels are listed too.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // origins of a step (HERKUNFT_LABEL); "Agent" and "Bildkontext"-like words exist elsewhere or are listed here
  "Von Hand": "By hand",
  "Textbefehl": "Text command",
  "Spracheingabe": "Voice input",
  "Bildkontext": "Image context",
  "leer": "empty",
  // proposal sentences (SATZ_VORLAGEN)
  "{ziel}: {eigenschaft} {vorher} → {nachher}": "{ziel}: {eigenschaft} {vorher} → {nachher}",
  "{ziel}: {schritte}": "{ziel}: {schritte}",
  "um {dx} m in x und {dz} m in z verschieben": "move by {dx} m in x and {dz} m in z",
  "um {dx} m in x, {dy} m in y und {dz} m in z verschieben": "move by {dx} m in x, {dy} m in y and {dz} m in z",
  "um {grad}° drehen": "rotate by {grad}°",
  "auf {prozent} % skalieren": "scale to {prozent} %",
  "{ziel}: bei {t} m teilen → {laengeA} m + {laengeB} m": "{ziel}: split at {t} m → {laengeA} m + {laengeB} m",
  "{ziel}: entlang der Linie teilen → {flaecheA} m² + {flaecheB} m²": "{ziel}: split along the line → {flaecheA} m² + {flaecheB} m²",
  // check sentences (PRUEF_VORLAGEN)
  "Gesperrt: {text} — erst klären, dann ändern": "Blocked: {text} — clarify first, then change",
  "{text} — neu durch diese Änderung": "{text} — new through this change",
  "Hinweis: {text}": "Note: {text}",
  "Überschneidet {name}: {tiefeX} m × {tiefeZ} m im Grundriss (Näherung über umschließende Boxen)": "Overlaps {name}: {tiefeX} m × {tiefeZ} m in plan (approximation by bounding boxes)",
  "… und {n} weitere Überschneidungen": "… and {n} more overlaps",
  "{art} {nr} liegt nach der Änderung außerhalb der Wand ({u} m von {laenge} m)": "{art} {nr} lies outside the wall after the change ({u} m of {laenge} m)",
  "{n} Durchbruch/Durchbrüche verweisen auf die alte GUID der Wand und verlieren ihr Bauteil": "{n} penetration(s) refer to the wall's old GUID and lose their element",
  "Das Bauteil hat keine ausdrückliche Kostengruppe im Modell": "The element has no explicit cost group in the model",
  "Der Feuerwiderstand (FireRating) ist nicht gesetzt": "The fire resistance (FireRating) is not set",
  "Das Merkmal tragend (LoadBearing) ist nicht gesetzt": "The load-bearing flag (LoadBearing) is not set",
  "Keine Auffälligkeit gefunden ({geprueft}).": "No findings ({geprueft}).",
  "Prüfregeln": "Planning rules",
  "Attribute": "Attributes",
  "Nachbarschaft": "Neighbourhood",
  "Nicht geprüft: {was}": "Not checked: {was}",
  // stale proposal (review fix)
  "Veraltet: {ziel} hat sich seit dem Vorschlag verändert ({was}) — verwerfen und neu vorschlagen": "Outdated: {ziel} changed since the proposal ({was}) — discard it and propose again",
  "{eigenschaft} ist jetzt {jetzt}, der Vorschlag ging von {vorschlag} aus": "{eigenschaft} is now {jetzt}, the proposal started from {vorschlag}",
  "Lage oder Maße": "position or size",
  "Bauteil oder Öffnungen": "element or openings",
  // data sheet rows and viewer messages (review fix)
  "Feuerwiderstand": "Fire resistance",
  "Statik-Vermerk": "Structural note",
  "Journal nicht geladen": "Journal not loaded",
  "Journal nicht gespeichert": "Journal not saved",
  "Journal-Eintrag nicht gelöscht": "Journal entry not deleted",
  "Der Journal-Eintrag dieses Schrittes ist nicht mehr da": "The journal entry of this step is gone",
  "Nur für gezeichnete Bauteile (BIM-Studio) — IFC-Dateien bleiben unverändert": "Only for drawn elements (BIM studio) — IFC files stay unchanged",
  "Dieses Bauteil gehört zu einem Änderungsschritt — im Änderungsverlauf zurücknehmen": "This element belongs to a change step — undo it in the change history",
};
