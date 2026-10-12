// Besitzer: 88-05 — nur diese Datei ändern.
//
// English dictionary part of sampling (Bemusterung, tab of the page Werkplanung) and the
// room book per room type in the space programme (RaumbuchTabelle, @designer/lib/raumbuch).
// The space-programme use labels ("Wohnen", "Gewerbe" …) are translated here because the
// room book passes them through t(); "Gewerbe" and "Wohnen" left i18n-en-altlast.json.
// Existing keys ("Farbe", "Gegenstand" …) are not repeated (duplicate guard).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Bemusterung konnte nicht geladen werden": "Sampling could not be loaded",
  "Muster konnte nicht gespeichert werden": "The sample could not be saved",
  "Entscheidung nur für vorgelegte Muster und mit Namen": "Decision only for submitted samples and with a name",
  "Protokoll abgelegt unter Berichtswesen / Protokolle": "Protocol filed under reporting / protocols",
  "Protokoll nicht abgelegt": "Protocol not filed",
  "Protokoll konnte nicht erzeugt werden": "The protocol could not be created",
  "Bemusterung": "Sampling",
  "{n} Muster aus dem Raumbuch anlegen": "Create {n} samples from the room book",
  "Freigabeprotokoll (PDF)": "Release protocol (PDF)",
  "Neues Muster": "New sample",
  "Kein Raumbuch: im Raumprogramm Ausbau je Raumtyp erfassen, dann schlägt diese Liste Muster vor.": "No room book: record the finishes per room type in the space programme, then this list suggests samples.",
  "Zum Raumprogramm": "To the space programme",
  "Noch keine Muster.": "No samples yet.",
  "Fabrikat / Produkt": "Manufacturer / product",
  "Oberfläche": "Surface",
  "LV": "BoQ",
  "Vorgelegt": "Submitted",
  "z. B. Bodenbelag Büro": "e.g. office floor covering",
  "Farbsystem": "Colour system",
  "sonstig": "other",
  "Entschieden von": "Decided by",
  "Raumbuch je Raumtyp": "Room book per room type",
  "Ausbau je Zeile des Raumprogramms; „Speichern“ oben schreibt das Raumbuch mit.": "Finishes per row of the space programme; “Save” above stores the room book too.",
  "Raumtyp": "Room type",
  "Lichte Höhe (m)": "Clear height (m)",
  "Lichte Höhe unter dem Richtwert": "Clear height below the guide value",
  "Raum / Bereich": "Room / area",
  "LV-Position (OZ)": "BoQ item (no.)",
  "Fabrikat": "Manufacturer",
  "Produkt": "Product",
  "Boden": "Floor",
  "Sockel": "Skirting",
  "Wand": "Wall",
  "Decke": "Ceiling",
  "Farbangabe passt nicht zum Farbsystem (RAL 9010 / NCS S 0502-Y)": "Colour does not match the colour system (RAL 9010 / NCS S 0502-Y)",
  "Fabrikat / Produkt fehlt": "Manufacturer / product missing",
  "Freigegeben ohne Bezug zur LV-Position": "Released without reference to a BoQ item",
  "Raumbuch unvollständig": "Room book incomplete",
  "Tiefgarage / Parken": "Underground car park / parking",
  "Technik / Lager": "Plant / storage",
  "Einzelhandel": "Retail",
  "Gastronomie": "Gastronomy",
  "Gewerbe": "Commercial",
  "Gemeinschaft": "Community",
  "Wohnen": "Residential",
};
