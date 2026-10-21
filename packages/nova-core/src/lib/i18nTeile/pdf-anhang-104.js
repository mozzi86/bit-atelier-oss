// Phase 104-09 (PDF studio: appending save, original bytes untouched, + crash recovery): English
// texts of PdfStudio.jsx. Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
// "Verwerfen", "Wiederherstellen" and "PDF herunterladen" already exist elsewhere and are not repeated.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Alle Anmerkungen sind im PDF gespeichert": "All annotations are saved in the PDF",
  "Anmerkung nicht beim Server angekommen — im Browser gesichert, wird beim Speichern oder nächsten Öffnen nachgetragen.":
    "Annotation did not reach the server — kept in this browser, it is sent when you save or open the file again.",
  "Anmerkungen ins PDF schreiben — die Originalbytes bleiben unverändert, die Änderung wird angehängt":
    "Write the annotations into the PDF — the original bytes stay unchanged, the change is appended",
  "Bearbeitungsstand konnte nicht gelesen werden": "Editing state could not be read",
  "Bearbeitungsstand konnte nicht gesichert werden": "Editing state could not be saved",
  "Bearbeitungsstand wiederhergestellt": "Editing state restored",
  "Dateiinhalt nicht gefunden": "File content not found",
  "Festgeschriebenes Dokument (versendet bzw. bestätigt) — die Datei bleibt unverändert":
    "Fixed document (sent or confirmed) — the file stays unchanged",
  "Festgeschriebenes Dokument (versendet bzw. bestätigt, mit Prüfsumme): Anmerkungen bleiben im Studio und lassen sich annotiert exportieren — in die Datei selbst wird nichts geschrieben.":
    "Fixed document (sent or confirmed, with checksum): annotations stay in the studio and can be exported annotated — nothing is written into the file itself.",
  "Gespeicherte Anmerkungen werden doppelt angezeigt": "Saved annotations are shown twice",
  "Herunterladen fehlgeschlagen": "Download failed",
  "Im PDF gespeichert — Originaldatei unverändert, Änderungen angehängt ({n} Bytes).":
    "Saved in the PDF — original file unchanged, changes appended ({n} bytes).",
  "Im PDF speichern": "Save in PDF",
  "Löschen nicht beim Server angekommen — vorgemerkt und im Browser gesichert.":
    "Deletion did not reach the server — queued and kept in this browser.",
  "Nicht gespeicherter Bearbeitungsstand gefunden": "Unsaved editing state found",
  "PDF ist bereits aktuell": "PDF is already up to date",
  "Server nicht erreichbar — ausstehende Anmerkungen konnten nicht nachgetragen werden.":
    "Server not reachable — pending annotations could not be sent.",
  "Speichern im PDF fehlgeschlagen": "Saving in the PDF failed",
  "Wiederhergestellt — einiges ist noch nicht beim Server angekommen und bleibt im Browser gesichert.":
    "Restored — some items have not reached the server yet and stay kept in this browser.",
  "{n} Punkte vom {zeit} — vermutlich nach einem Absturz oder geschlossenem Fenster.":
    "{n} items from {zeit} — probably after a crash or a closed window.",
  "{n} Änderungen nur im Browser gesichert — der Server hat sie noch nicht.":
    "{n} changes kept only in this browser — the server does not have them yet.",
};
