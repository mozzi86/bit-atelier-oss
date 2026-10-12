// Besitzer: 92-01 — nur diese Datei ändern. Ergänzt in 92-04 (Änderungen im Hinweis, Update-Einstellungen),
// 92-05 (Rücksprung) und 92-07 (Datenordner, KI-Assistent verbinden) — Phase 92 hält ihre Texte hier.
//
// English dictionary part of the local app's installation features: self-update banner (UpdateHinweis),
// "Updates" card, data folder row and the MCP card in Settings.
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
  // 92-04: release-note lines in the banner, "Updates" card in Settings › System & Info.
  "Alle Änderungen": "All changes",
  "Weniger anzeigen": "Show less",
  "Release-Seite öffnen": "Open the release page",
  "Updates": "Updates",
  "Installierte Fassung": "Installed version",
  "Neueste Fassung": "Latest version",
  "Letzte Prüfung": "Last check",
  "noch nicht": "not yet",
  "Jetzt prüfen": "Check now",
  "Automatisch nach Updates suchen": "Check for updates automatically",
  "Fassung festhalten bis (einschließlich)": "Hold this version until (inclusive)",
  "Aufheben": "Clear",
  "Gespeichert.": "Saved.",
  "Die Update-Prüfung ist auf diesem Rechner abgeschaltet (Umgebungsvariable BIT_KEIN_UPDATECHECK).": "The update check is switched off on this computer (environment variable BIT_KEIN_UPDATECHECK).",
  // 92-05: the apply script rolled the update back after a failed health check.
  "Das Update ließ sich nicht starten und wurde zurückgenommen – die bisherige Fassung läuft wieder. Details in daten/update.log.": "The update did not start and was rolled back – the previous version is running again. Details in daten/update.log.",
  // 92-07: data folder in "Daten & Sicherung", MCP entry in "KI-Verbindungen".
  "Datenordner": "Data folder",
  "Ordner öffnen": "Open folder",
  "Ordner wird im Dateimanager geöffnet.": "Opening the folder in the file manager.",
  "Datenordner nicht abrufbar:": "Data folder not available:",
  "Hier liegen alle Projekte dieser Installation. Nehmen Sie den Ordner in Ihre Datensicherung auf – Ordner unter AppData erfasst eine Büro-Sicherung oft nicht.": "All projects of this installation live here. Include this folder in your backup – office backups often miss folders under AppData.",
  "Mit einem KI-Assistenten verbinden": "Connect an AI assistant",
  "BIT-Atelier ist ein MCP-Server: Claude Code, Claude Desktop und andere MCP-Clients können Ihre Projekte lesen – mit Schreibrecht auch Einträge anlegen und ändern, nie löschen. Die App muss dafür laufen.": "BIT-Atelier is an MCP server: Claude Code, Claude Desktop and other MCP clients can read your projects – with write permission also create and change records, never delete. The app must be running.",
  "Pfade nicht abrufbar:": "Paths not available:",
  "tools/mcp-server.mjs fehlt in diesem App-Ordner.": "tools/mcp-server.mjs is missing in this app folder.",
  "Schreibrecht erlauben (--schreiben)": "Allow writing (--schreiben)",
  "Claude Code – in einem Terminal ausführen:": "Claude Code – run in a terminal:",
  "Claude Desktop – in claude_desktop_config.json eintragen:": "Claude Desktop – add to claude_desktop_config.json:",
  "Speicherort der Datei:": "Location of the file:",
  "Gibt es dort schon andere Server, nur den Block „bit-atelier“ in „mcpServers“ ergänzen; danach Claude Desktop neu starten.": "If other servers are already listed, only add the \"bit-atelier\" block to \"mcpServers\"; then restart Claude Desktop.",
  "Kopiert.": "Copied.",
  "Kopieren nicht möglich – der Text ist markiert, mit Strg+C kopieren.": "Copying is not possible – the text is selected, copy it with Ctrl+C.",
  "Bis zu diesem Tag zeigt die App keinen Update-Hinweis und installiert keine neue Fassung – z. B. bis zur Submission einer laufenden Vergabe.": "Until this day the app shows no update notice and installs no new version – e.g. until the bid deadline of a running tender.",
};
