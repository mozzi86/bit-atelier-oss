// Besitzer: 104-10 — Pfad-Richtlinie für Dokumentverweise (@core/lib/pfadRichtlinie.js).
//
// English dictionary part of the plain-text reasons a refused path or document reference shows
// (PFAD_MELDUNGEN, the app passes them through t()), plus the messages of the document window
// (src/lib/dokumentAnzeige.js, Reports openDoc). Existing keys ("Herunterladen", "Beleg nicht gefunden.")
// are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Kein Pfad angegeben.": "No path given.",
  "Der Pfad ist zu lang (mehr als 4096 Zeichen).": "The path is too long (more than 4096 characters).",
  "Der Pfad enthält Steuer- oder unsichtbare Zeichen und wird nicht geöffnet.":
    "The path contains control or invisible characters and is not opened.",
  "Nur lokale Pfade oder file:-Adressen sind erlaubt — Web-, Netzwerk- und Skript-Adressen (http:, smb:, javascript:, data: …) werden nicht geöffnet.":
    "Only local paths or file: addresses are allowed — web, network and script addresses (http:, smb:, javascript:, data: …) are not opened.",
  "Eine file:-Adresse mit Rechnernamen zeigt ins Netzwerk und wird nicht geöffnet — bitte die Datei auf ein lokales Laufwerk kopieren.":
    "A file: address with a computer name points into the network and is not opened — please copy the file to a local drive.",
  "Die file:-Adresse ist ungültig kodiert.": "The file: address is not encoded correctly.",
  "Netzwerkpfade (\\\\Server\\Freigabe) werden nicht geöffnet — bitte die Datei auf ein lokales Laufwerk kopieren.":
    "Network paths (\\\\server\\share) are not opened — please copy the file to a local drive.",
  "Geräte- und Systempfade (\\\\?\\, \\\\.\\, /dev, /proc) werden nicht geöffnet.":
    "Device and system paths (\\\\?\\, \\\\.\\, /dev, /proc) are not opened.",
  "Der Pfad enthält einen unter Windows reservierten Gerätenamen (CON, NUL, COM1, LPT1 …).":
    "The path contains a device name reserved by Windows (CON, NUL, COM1, LPT1 …).",
  "Der Pfad enthält Zeichen, die in Windows-Dateinamen nicht erlaubt sind (< > : \" | ? *).":
    "The path contains characters that are not allowed in Windows file names (< > : \" | ? *).",
  "Ein Datei- oder Ordnername im Pfad endet auf Punkt oder Leerzeichen — Windows würde ihn still kürzen.":
    "A file or folder name in the path ends with a dot or a space — Windows would silently shorten it.",
  "Laufwerk ohne Ordnerangabe (z. B. „C:Datei“) ist mehrdeutig — bitte den vollständigen Pfad mit „C:\\“ angeben.":
    "A drive without a folder (e.g. “C:file”) is ambiguous — please give the full path with “C:\\”.",
  "Der Pfad nennt kein Laufwerk — bitte den vollständigen Pfad mit Laufwerksbuchstaben angeben.":
    "The path names no drive — please give the full path with a drive letter.",
  "Der Pfad muss absolut sein.": "The path must be absolute.",
  "Pfade mit „..“ sind nicht erlaubt.": "Paths with “..” are not allowed.",
  "Der Pfad liegt außerhalb der erlaubten Ordner.": "The path lies outside the allowed folders.",
  "Dieser Dateityp wird aus Sicherheitsgründen nicht im Browser geöffnet.":
    "For security reasons this file type is not opened in the browser.",
  "Das Dokument enthält keinen eingebetteten Inhalt, sondern einen Verweis, der nicht geöffnet wird.":
    "The document contains no embedded content but a reference, which is not opened.",
  "Inhalt nicht gefunden.": "Content not found.",
};
