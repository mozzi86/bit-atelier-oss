// Besitzer: 93-06 — nur diese Datei ändern.
//
// English dictionary part of the automatic local backup (lever 161): the card "Automatische Sicherung"
// (src/components/settings/AutoSicherung.jsx) and the corrected restore hint in Settings › "Daten & Sicherung".
// Existing keys ("Wird geladen …") are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Automatische Sicherung": "Automatic backup",
  "Letzte automatische Sicherung": "Last automatic backup",
  "ausgeschaltet (BIT_SICHERUNG_AUS=1)": "switched off (BIT_SICHERUNG_AUS=1)",
  "Alle {n} Stunden, aufbewahrt werden {t} tägliche und {w} wöchentliche Sicherungen.": "Every {n} hours; {t} daily and {w} weekly backups are kept.",
  "Jetzt sichern": "Back up now",
  "Sichert …": "Backing up …",
  "Sicherung angelegt: {name}": "Backup created: {name}",
  "Letzte Sicherung fehlgeschlagen:": "Last backup failed:",
  "Sicherung nicht abrufbar:": "Backup status unavailable:",
  "Die Sicherungen liegen auf diesem Rechner. Gegen Diebstahl, Brand oder einen defekten Datenträger hilft nur eine Kopie woanders: den Ordner in Ihre Büro-Sicherung aufnehmen oder regelmäßig auf ein anderes Laufwerk kopieren.":
    "The backups are on this computer. Only a copy elsewhere protects against theft, fire or a failed disk: include the folder in your office backup or copy it to another drive regularly.",
  "Wiederherstellen: App beenden, die gewünschte Sicherung (ZIP) in den Datenordner entpacken, App starten.":
    "To restore: quit the app, unzip the backup you want into the data folder, start the app.",
};
