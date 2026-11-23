// 115-05c (D-115-12): English texts of the draft mode of the building model - the draft bar of the designer (state, "Speichern",
// "Verwerfen", the banners of a restored / not fitting / not locally stored draft, the leave dialog, the hold of one tab) and the
// state chip of the BIM studio. German source text = key ("Speichern", "Gespeichert", "Verwerfen", "Abbrechen", "Schließen" live in
// the main dictionary of ../i18n.jsx and are not repeated here).
//
// LAZY part (size budget of the entry and the designer chunk): NOT listed in ./index.js. EntwurfLeiste.jsx (loaded lazily by
// ComplexDesigner) imports it; BitBimStudio loads it with its draft module. Both call englischErgaenzen(EN) of ../i18n.jsx.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Speichert…": "Saving…",
  "Teilweise gespeichert": "Partly saved",
  "Konflikt — bitte entscheiden": "Conflict — please decide",
  "Speicherfehler": "Save error",
  "Nicht gespeichert": "Not saved",
  "{{n}} Änderungen": "{{n}} changes",
  "Modell speichern (Strg+S)": "Save the model (Ctrl+S)",
  "Entwurf verwerfen?": "Discard the draft?",
  "Ungespeicherte Änderungen aus diesem Browser wiederhergestellt — „Speichern“ übernimmt sie, „Verwerfen“ verwirft sie.":
    "Unsaved changes restored from this browser — “Save” keeps them, “Discard” drops them.",
  "Der lokale Entwurf passt nicht mehr zum gespeicherten Modell (ersetzt oder gelöscht). Er wird nicht automatisch fortgesetzt.":
    "The local draft no longer fits the stored model (replaced or deleted). It is not continued automatically.",
  "Trotzdem fortsetzen": "Continue anyway",
  "Entwurf nicht lokal gesichert": "Draft not stored locally",
  "Der Entwurf bleibt erhalten.": "The draft is kept.",
  "Mehrere Tabs: der zuletzt gesicherte Entwurf gilt.": "Several tabs: the draft stored last applies.",
  "Dieses Projekt wird in einem anderen Tab dieses Browsers bearbeitet. Hier ist das Modell schreibgeschützt.":
    "This project is being edited in another tab of this browser. The model is read-only here.",
  "Hier übernehmen": "Take over here",
  "Ungespeicherte Änderungen am Modell": "Unsaved changes to the model",
  "Als Entwurf behalten": "Keep as draft",
  "Änderungen am Modell sind ein Entwurf, bis „Speichern“ gedrückt wird": "Changes to the model are a draft until you press “Save”",
  "Erst „Speichern“ legt das Modell an": "The model is created only when you press “Save”",
  "Grundstück und Lage werden erst gespeichert, wenn Name und Standort gesetzt sind.":
    "Site and location are saved only once a name and a location are set.",
  "Entwurf — nicht gespeichert": "Draft — not saved",
  "Erst „Speichern“, dann am Plan ablegen.": "Press “Save” first, then file it with the plan.",
  "Was sofort gespeichert wird": "What is saved at once",
  "Hinweise zum Speichern": "Notes on saving",
  "Lokal gesicherter Entwurf aus einer anderen Programmversion — nicht lesbar.": "Locally stored draft from another program version — not readable.",
  "Lokal gesicherter Entwurf gehört nicht zu dieser Person oder diesem Projekt — nicht übernommen.":
    "Locally stored draft does not belong to this person or this project — not taken over.",
  "Lokal gesicherter Entwurf ist beschädigt — nicht lesbar.": "Locally stored draft is damaged — not readable.",
  "Das gespeicherte Modell ist geöffnet; die nächste Änderung ersetzt den unlesbaren Eintrag.":
    "The stored model is open; the next change replaces the unreadable entry.",
  "Sofort gespeichert (kein Entwurf): Massing-Körper, Wohnungs-Werkstatt, Aufbauten, Fachplanung (Tragwerk, Brandschutz, Schallschutz, Raumklima, Barrierefreiheit, Entwässerung, TGA-Netz), Außenanlagen, Bauaufnahme mit Georeferenz, Bestandsbefunde, Möblierung und Innenausbau, Wohnungstypen, Stellplätze, Energiesysteme, Hochwasser, Kennzahlen von Hand, Name des Entwurfs, Ansichten und Ebenen, Skizze, Raumprogramm, Förderanträge, HOAI-Plan, ASR-Raumdatenblatt und Projektdaten. Im IFC-Viewer sofort: „Grundriss übernehmen“ (Grundriss und Geschosszahl), Lieferpaket, IDS-Regeln, Befunde (BCF). Gebäudemodell (Bauteile, Hülle, Attribute, Solid-Relationen), Geschosse, Grundstück und Lage werden erst mit „Speichern“ übernommen.":
    "Saved at once (no draft): massing bodies, dwelling workshop, build-ups, specialist planning (structure, fire safety, acoustics, indoor climate, accessibility, drainage, building services network), outdoor works, survey with georeference, findings on the existing building, furniture and interior, unit types, parking, energy systems, flood, key figures by hand, name of the design, views and layers, sketch, space programme, funding applications, HOAI plan, ASR room data sheet and project data. In the IFC viewer at once: “Take over floor plan” (outline and storey count), delivery package, IDS rules, issues (BCF). Building model (components, envelope, attributes, solid relations), storeys, site and location are taken over only with “Save”.",
  "Kein Browserspeicher verfügbar — der Bearbeitungsstand kann nicht gesichert werden.":
    "No browser storage available — the editing state cannot be secured.",
};
