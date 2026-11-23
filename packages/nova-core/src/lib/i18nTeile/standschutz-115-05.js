// 115-05a (D-115-50, W-1115-01): English texts of the stand protection — the labels of the lists and values the BIM studio now
// merges live (modellAbgleich.js ELEMENT_FELDER / STUDIO_WERTE, passed to t() by variable), the conflict card of the design
// record (komplexAbgleich.js KOMPLEX_FELDNAMEN, translated by the card) and the notes of the studio and the designer when a model
// was not loaded or a last change could not be written. German source text = key.
//
// LAZY part (size budget of the entry chunk, pattern raeume-115-12.js): NOT listed in ./index.js. BitBimStudio.jsx and
// ComplexDesigner.jsx import it and call englischErgaenzen(EN) of ../i18n.jsx once when they load. Keys that already exist in
// another part are not repeated here ("Treppen", "Gauben", "Gaube" in efh-108.js, "Treppe" in steckbrief-97.js, "Notiz" in
// personal-suche.js, "Name" in buchhaltung-fundament.js, "Kostenschätzung" in ava-kostenstaende.js, "Entwurf gespeichert" in
// buchhaltung-rechnungen.js, the card buttons in abgleich-106.js) — the guard (tests/unit/i18nAbdeckung.test.js) refuses a key
// defined twice.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  // labels of the lists / values merged live (conflict cards, notes "arrived from another device")
  "Plan-Notizen": "Plan notes",
  "Erscheinung der Hülle": "Envelope appearance",
  // conflict card of the design record (BuildingComplex)
  "Grundstück und Lage": "Site and location",
  "Möblierung": "Furnishing",
  "Innenausbau": "Interior fit-out",
  "Eigene Möbel": "Own furniture",
  "Wohnungstypen": "Unit types",
  "Stellplätze": "Parking spaces",
  "Energiesysteme": "Energy systems",
  "Hochwasser": "Flood levels",
  "Kennzahlen von Hand": "Key figures by hand",
  // notes
  "Modell nicht geladen — bitte die Seite neu laden. Bis dahin wird nichts gespeichert.": "Model not loaded — please reload the page. Nothing is saved until then.",
  "Letzte Änderung am Modell nicht gespeichert — es wurde inzwischen an anderer Stelle geändert.": "Last change to the model not saved — it was changed elsewhere in the meantime.",
  "Entwurf nicht gespeichert — er wird gerade an anderer Stelle geändert. Bitte neu laden.": "Design not saved — it is being changed elsewhere right now. Please reload.",
  "Automatisches Speichern fehlgeschlagen — bitte „Entwurf speichern“": "Automatic save failed — please use “Save design”",
  "Speichern fehlgeschlagen — bitte erneut versuchen": "Saving failed — please try again",
  // 115-05b (E-3): old data with two design records of one project
  "Für dieses Projekt sind {{n}} Entwürfe gespeichert — der neueste wird verwendet, keiner wurde gelöscht.": "{{n}} designs are stored for this project — the newest is used, none was deleted.",
};
