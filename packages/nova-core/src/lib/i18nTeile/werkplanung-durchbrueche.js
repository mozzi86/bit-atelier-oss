// Besitzer: 88-01 — nur diese Datei ändern.
//
// English dictionary part of the openings planning (Schlitz- und Durchbruchsplanung):
// tab "Durchbrüche" of the page Werkplanung (src/components/werkplanung/DurchbruchListe.jsx)
// and the findings of src/lib/werkplanung/durchbrueche.js. Existing keys ("Art",
// "Gewerk", "Geschoss", "Status" …) are not repeated (duplicate guard).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Durchbrüche konnten nicht geladen werden": "Openings could not be loaded",
  "Durchbruch konnte nicht gespeichert werden": "The opening could not be saved",
  "Prüfschritt nicht möglich (Reihenfolge Statik → Architekt, Name nötig)": "Review step not possible (order structure → architect, name required)",
  "Durchbrüche": "Openings",
  "Durchbruch": "Opening",
  "Schlitz": "Slot",
  "Kernbohrung": "Core drilling",
  "Alle als BCF": "All as BCF",
  "Durchbruch beantragen": "Request opening",
  "Noch keine Durchbrüche beantragt.": "No openings requested yet.",
  "Art / Maße": "Kind / size",
  "Statik": "Structure",
  "Architekt": "Architect",
  "Statik i. O.": "Structure OK",
  "Statik lehnt ab": "Structure rejects",
  "Architekt gibt frei": "Architect releases",
  "Architekt lehnt ab": "Architect rejects",
  "Beantragt": "Requested",
  "Statik geprüft": "Structure checked",
  "Ausgeführt": "Executed",
  "Im Modell zeigen": "Show in model",
  "Ablauf: beantragt → Statik prüft → Architekt gibt frei → ausgeführt. Hinweise ersetzen keine Prüfung durch Tragwerks- und Brandschutzplanung.": "Process: requested → structure checks → architect releases → executed. Hints do not replace the review by the structural and fire protection engineers.",
  "rechteckig": "rectangular",
  "rund": "round",
  "ohne": "none",
  "Beantragen": "Request",
  "i. O.": "OK",
  "Kommentar": "Comment",
  "Vermerk speichern": "Save note",
  "Form": "Shape",
  "Ø (mm)": "Ø (mm)",
  "Breite (mm)": "Width (mm)",
  "Höhe (mm)": "Height (mm)",
  "Tiefe (mm)": "Depth (mm)",
  "x (m)": "x (m)",
  "y (m)": "y (m)",
  "z (m)": "z (m)",
  "Bauteil (IFC-GUID)": "Element (IFC GUID)",
  "Bauteil (Bezeichnung)": "Element (name)",
  "Feuerwiderstand des Bauteils": "Fire resistance of the element",
  "Abschottung (System, Zulassung)": "Fire stop (system, approval)",
  "Maße fehlen oder sind nicht positiv": "Size missing or not positive",
  "Kein Bauteil (IFC-GUID) zugeordnet — Sprung ins Modell nicht möglich": "No element (IFC GUID) assigned — jump into the model not possible",
  "Lage (x, y, z) unvollständig": "Position (x, y, z) incomplete",
  "Bauteil mit Feuerwiderstand — Abschottung angeben (MLAR Abschn. 4)": "Element with fire resistance — state the fire stop (MLAR section 4)",
  "Überlagert einen anderen Durchbruch im selben Bauteil": "Overlaps another opening in the same element",
};
