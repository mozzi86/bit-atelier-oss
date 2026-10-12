// Besitzer: 93-10 — Dateizuordnung .bitproj (Doppelklick → Import-Vorschau, Zurück in die Datei speichern).
//
// English dictionary part of the double-click import (DateiOeffnenEmpfang.jsx, the re-open/copy buttons of
// ImportVorschauDialog) and the card "Verknüpfte Projektdatei" (DateiQuelleKarte.jsx).
// Existing keys ("Aktualisieren", "Abbrechen", "Schließen", "Geöffnet am") are not repeated (duplicate guard
// in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Datei": "File",
  "Als Kopie": "As a copy",
  "Als Kopie hinzufügen": "Add as a copy",
  "Dieses Projekt ist hier schon vorhanden:": "This project already exists here:",
  "Aktualisieren ersetzt den Stand durch die Datei. Als Kopie übernimmt nur die Projektdaten mit neuen IDs, ohne Büro-Bereiche und Einstellungen.":
    "Update replaces the current state with the file. As a copy takes only the project data with new IDs, without office areas and settings.",
  "Der aktuelle Stand auf diesem Rechner wird dabei vollständig ersetzt.": "The current state on this computer will be replaced completely.",
  "Vorher wird eine Sicherungskopie im Datenordner angelegt (vor-import).": "A backup copy is stored in the data folder first (vor-import).",
  "Projektdatei konnte nicht geöffnet werden": "The project file could not be opened",
  "Verknüpfte Projektdatei": "Linked project file",
  "Zuletzt gespeichert": "Last saved",
  "Datei fehlt": "File missing",
  "Zurück in die Datei speichern": "Save back to the file",
  "Der Pfad bleibt auf diesem Rechner und geht nie in eine Projektdatei.": "The path stays on this computer and never goes into a project file.",
  "Als Kopie gespeichert:": "Saved as a copy:",
  "In die Datei gespeichert.": "Saved to the file.",
  "Datei geändert": "File changed",
  "Die Datei ist nicht mehr vorhanden.": "The file no longer exists.",
  "Die Datei wurde seit dem Öffnen geändert.": "The file has changed since it was opened.",
  "Als Kopie speichern": "Save as a copy",
  "Überschreiben": "Overwrite",
  // 93-13 save / load in the installed edition
  "Datei wird erstellt …": "Creating the file …",
  "Gespeichert als": "Saved as",
  "Datei wird geprüft …": "Checking the file …",
  "Laden fehlgeschlagen": "Loading failed",
  "Projektdatei (.bitproj)": "Project file (.bitproj)",
  "Aus Datei laden …": "Load from file …",
  "Projektdatei wählen": "Choose project file",
  "Alle Projekte als eine Datei sichern oder eine Datei laden — beim Laden erscheint zuerst die Vorschau.": "Save all projects as one file or load a file — loading shows the preview first.",
};
