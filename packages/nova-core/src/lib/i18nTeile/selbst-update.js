// Besitzer: 92-01 — nur diese Datei ändern.
//
// English dictionary part of the self-update banner of the local app (UpdateHinweis in the layout).
// Existing keys ("Später", "Schließen") are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "App startet neu – die Seite lädt gleich von selbst neu …": "The app is restarting – the page will reload by itself …",
  "Die App ist nach dem Update nicht wieder gestartet. Bitte start-windows.cmd bzw. start.sh von Hand starten; Details in daten/update.log.": "The app did not start again after the update. Please run start-windows.cmd or start.sh by hand; details in daten/update.log.",
  "Jetzt aktualisieren": "Update now",
  "Prüfsumme wird geprüft …": "Checking the checksum …",
  "Update fehlgeschlagen.": "Update failed.",
  "Update verfügbar": "Update available",
  "Update wird geladen": "Downloading the update",
  "Update wird vorbereitet …": "Preparing the update …",
  "installiert": "installed",
};
