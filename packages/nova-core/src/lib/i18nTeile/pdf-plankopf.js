// Besitzer: 90-01 (+ 90-02 PDF unveränderbar) — nur diese Datei ändern.
//
// English dictionary part of the PDF-studio tool "Plankopf setzen" (title block): mode
// labels, hints, the field labels of PLANKOPF_FELDER (@pdf/lib/plankopf — the form passes
// z.label to t()). Keys that exist elsewhere ("Projekt", "Bauherr", "Maßstab", "Datum") are
// not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Abdeckung alter Plankopf, Höhe in mm": "Cover over the old title block, height in mm",
  "Alten Plankopf endgültig entfernen (Seiten neu rastern — der abgedeckte Text ist sonst im PDF noch auslesbar; Text danach nicht mehr durchsuchbar)": "Remove the old title block for good (re-raster pages — otherwise the covered text can still be read from the PDF; text is no longer searchable afterwards)",
  "Anlage zu": "Attachment to",
  "Anmerkungen": "annotations",
  "Art der Umwandlung": "Conversion type",
  "Als Bild-PDF": "As image PDF",
  "Formular abflachen": "Flatten form",
  "Formularfelder": "form fields",
  "Formularfelder werden fest in die Seite geschrieben, Kommentare und Stempel entfernt. Text bleibt durchsuchbar, Datei bleibt klein.": "Form fields are burned into the page, comments and stamps removed. Text stays searchable, the file stays small.",
  "Jede Seite wird zum Bild, Kommentare bleiben sichtbar. Nichts ist mehr bearbeitbar oder kopierbar; Text nicht mehr durchsuchbar, Datei größer.": "Every page becomes an image, comments stay visible. Nothing can be edited or copied any more; text is no longer searchable, the file gets larger.",
  "Keine Formularfelder oder Anmerkungen gefunden — Text und Seiten lassen sich trotzdem in jedem Editor ändern; dafür „Als Bild-PDF“ wählen.": "No form fields or annotations found — text and pages can still be changed in any editor; choose \"As image PDF\" for that.",
  "PDF wird geprüft …": "Checking PDF …",
  "Seiten": "pages",
  "Zuerst ein PDF wählen.": "Select a PDF first.",
  "Anlagen-Plankopf neutral (für LV/Ausschreibung)": "Neutral attachment title block (for bills of quantities / tenders)",
  "Art des Plankopfs": "Title block type",
  "Bauort": "Site",
  "Der alte Plankopf unten rechts wird weiß abgedeckt; Büroname, Adresse, Kontakt und Unterschrift entfallen.": "The old title block at the bottom right is covered in white; office name, address, contact and signature are left out.",
  "Format": "Format",
  "Geprüft": "Checked",
  "Gezeichnet": "Drawn",
  "Index": "Revision",
  "Leistungsphase": "Work stage",
  "Planinhalt": "Drawing title",
  "Plankopf (mit Planverfasser)": "Title block (with author)",
  "Plannummer": "Drawing number",
  "Planverfasser": "Author",
  "Planverfasser leer: Büroname im Büroprofil (Einstellungen › Büro) eintragen.": "Author empty: enter the office name in the office profile (Settings › Office).",
  "Seiten (leer = alle, z. B. 1-3,5)": "Pages (empty = all, e.g. 1-3,5)",
};
