// Besitzer: 80-03, 80-05, 80-07 (nacheinander), Spur A — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Einstellungen (Büro & Briefkopf, Darstellung, KI, Daten & Sicherung, Datenschutz, Regelwerke)".
// Decision list § 5: i18n.jsx is touched once per phase (80-01); every plan of the
// phase writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
// Before adding a key, grep all dictionary files: an existing key is reused, never
// entered again. A word that both lanes need and that appears only after wave 1 is
// not entered twice; if the guard still finds one after merging a wave, the merge
// fix moves it once into the block "Words several tabs share" of
// buchhaltung-fundament.js (rule of c8858d0) — i18n.jsx stays closed after 80-01.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // --- 80-03: office & letterhead (BriefkopfFormular.jsx, Reports.jsx preview card) ---
  "Architekturbüro": "Architecture office",
  // FELDER label (t(f.label), a dynamic call the guard cannot see): "Büroname",
  // "Anschrift", "Kontakt" already exist (buchhaltung-fundament.js/-rechnungen.js,
  // i18n.jsx) — only "Untertitel" was still missing.
  "Untertitel": "Subtitle",
  "Briefkopf": "Letterhead",
  "In den Einstellungen ändern": "Change in Settings",
  "Gilt für Berichte und Prüfberichte dieses Büros.": "Applies to this office's reports and check reports.",
  "Änderungen verwerfen": "Discard changes",
  "Änderungen verwerfen?": "Discard changes?",
  "Die Eingaben im Briefkopf gehen verloren.": "The changes to the letterhead will be lost.",
  // --- 80-03: appearance & language (DarstellungBereich.jsx) ---
  "Farbschema": "Colour scheme",
  // THEME_LABEL values (t(THEME_LABEL[wert]), a dynamic call the i18n guard's
  // literal-only extraction cannot see — entered here anyway, EN mode needs them.
  "Hell": "Light",
  "Dunkel": "Dark",
  "System": "System",
  "Englisch (Vorschau, unvollständig)": "English (preview, incomplete)",
  "Gilt für diesen Browser.": "Applies to this browser.",
  // --- 80-03: settings search (EinstellungsSuche.jsx, Settings.jsx) ---
  "Einstellung suchen": "Search settings",
  "z. B. Briefkopf, Mindestlohn, Zahlungsziel …": "e.g. letterhead, minimum wage, payment term …",
  "{n} Treffer": "{n} results",
  // "Keine Treffer." is shared with MitarbeiterTabelle.jsx: buchhaltung-fundament.js (shared block).
  // --- 80-03: AI connections (KiBereich.jsx, AIDashboard.jsx connections tab) ---
  "Atelier-KI-Harness (lokal)": "Atelier AI harness (local)",
  "Dienst": "Service",
  "Konfiguration": "Configuration",
  "Zum KI-Tool": "Go to the AI tool",
  "KI-Verbindungen verwalten Sie jetzt in den Einstellungen.": "You now manage AI connections in Settings.",
  "Zu den KI-Verbindungen": "Go to AI connections",
  // --- 80-03: LlmConnections.jsx (embedded in KiBereich.jsx) ---
  "Verbindungen konnten nicht geladen werden": "Connections could not be loaded",
  "Bitte Modellname angeben": "Please enter a model name",
  "Verbindung aktualisiert": "Connection updated",
  "Verbindung gespeichert": "Connection saved",
  "Verbindung gelöscht": "Connection deleted",
  "Umschalten fehlgeschlagen": "Switching failed",
  "Verbindung bearbeiten": "Edit connection",
  "Eigenes KI-Modell / API verbinden": "Connect your own AI model / API",
  "Bezeichnung (optional)": "Label (optional)",
  "z. B. Büro-Claude": "e.g. Office Claude",
  "Anbieter": "Provider",
  "Basis-URL": "Base URL",
  "Modellname": "Model name",
  "API-Schlüssel": "API key",
  "(leer lassen = unverändert)": "(leave empty = unchanged)",
  "Für Ollama nicht erforderlich": "Not required for Ollama",
  "Aktiv — dieses Modell für alle KI-Funktionen verwenden": "Active — use this model for every AI feature",
  "Der Schlüssel wird lokal in Ihrer BIT-Atelier-Datenbank gespeichert und nie an Dritte übertragen.": "The key is stored locally in your BIT-Atelier database and never sent to a third party.",
  "Teste…": "Testing…",
  "Verbindung testen": "Test connection",
  "Aktualisieren": "Update",
  "Verbindung erfolgreich": "Connection successful",
  "Verbindung fehlgeschlagen": "Connection failed",
  "Modell {modell}: „{antwort}\"": "Model {modell}: \"{antwort}\"",
  "Gespeicherte Verbindungen": "Saved connections",
  "Noch keine Verbindung — links ein eigenes Modell verbinden. Ohne aktive Verbindung nutzt BIT-Atelier das eingebaute Standardverhalten.": "No connection yet — connect your own model on the left. Without an active connection, BIT-Atelier uses its built-in default behaviour.",
  "(kein Modell)": "(no model)",
  "Standard-URL": "Default URL",
  "Schlüssel": "Key",
  "ohne Schlüssel": "without a key",
  "Verbindung löschen": "Delete connection",
  // --- 80-05: data & backup (DatenBereich.jsx) ---
  "Als Datei sichern": "Save as a file",
  "Letzte Sicherung": "Last backup",
  "Füllstand": "Fill level",
  "Dauerhafter Speicher": "Persistent storage",
  "noch nie": "never",
  "Übergabedatei an Fachplaner und Bauherr — enthält Projektdaten und Büro-Einstellungen wie den Briefkopf, Büro-Bereiche nur per Häkchen, keine Personaldaten.": "Handover file for specialist planners and the client — contains project data and office settings such as the letterhead, office areas only by checkbox, never personnel data.",
  // "heute", "vor {n} Tagen", "Personaldaten sichern" are shared with the personnel
  // backup tile (80-10): buchhaltung-fundament.js (shared block).
  "Projektdaten liegen in": "Project data lives in",
  "Sicherungskopie": "Backup copy",
  "Personaldaten liegen getrennt in": "Personnel data lives separately in",
  "Sicherungsskript": "Backup script",
  "Liegt das Verzeichnis in OneDrive, synchronisiert das automatisch — ohne Verschlüsselung dieser Dateien selbst.": "If the folder sits in OneDrive, that syncs it automatically — without encrypting these files on its own.",
  "Cloud-Gesamtexport folgt (78-04).": "A full cloud export is coming (78-04).",
  "Gerätespeicher": "Device storage",
  "Entfernt nur gerätebezogene Anzeige-Einstellungen (IFC-Automatik, Favoriten im Gebäudemodell) — keine Projektdaten.": "Removes only device-bound display settings (IFC auto-load, building-model favourites) — no project data.",
  "Gerätespeicher leeren": "Clear device storage",
  "Gerätespeicher leeren?": "Clear device storage?",
  "Entfernt die IFC-Automatik und die Favoriten im Gebäudemodell auf diesem Gerät. Projektdaten bleiben unverändert.": "Removes the IFC auto-load setting and the building-model favourites on this device. Project data stays unchanged.",
  "Leeren": "Clear",
  "Gerätespeicher geleert.": "Device storage cleared.",
  // --- 80-05: privacy & browser data (DatenschutzBereich.jsx) ---
  "Nutzungsprotokoll": "Usage log",
  "Erlaubt": "Allowed",
  "Widerrufen": "Withdraw",
  "Erteilen": "Grant",
  "Was dieser Browser speichert": "What this browser stores",
  "Ort": "Location",
  "Lokale Einstellungen löschen": "Delete local settings",
  "Lokale Einstellungen löschen?": "Delete local settings?",
  "Datenschutzerklärung": "Privacy policy",
  // "Cookies" is shared with the app footer: buchhaltung-fundament.js (shared block).
  // --- 80-05: shared export/import dialogs (speicherDialoge.jsx) ---
  "Personaldaten sind nie Teil der Projektdatei und bleiben unverändert.": "Personnel data is never part of the project file and stays unchanged.",
  "Für {bereich} fehlt der Sicherungsschritt — nicht gesichert": "The backup step for {bereich} is missing — not backed up",
  // --- B-2 (BEFUNDE-80): .bitpers passphrase field inside the export dialog ---
  // "Passphrase" / "Passphrase wiederholen" / "Mindestens {n} Zeichen." / "Die
  // Passphrasen stimmen nicht überein." are shared with PersonalSicherung.jsx:
  // personal-datenschutz.js (same rule, same dictionary entry, not repeated here).
  "Für {bereich} eine Passphrase für die verschlüsselte Sicherung festlegen.": "Set a passphrase for {bereich}'s encrypted backup.",
  // --- 80-07: rule-book editor (RegelwerkTabelle.jsx) — table columns, status chips, actions ---
  "Ihr Wert": "Your value",
  "Tabelle anzeigen": "Show table",
  "Alle zurücksetzen": "Reset all",
  // HERKUNFT_TEXT/STATUS_TEXT (RegelwerkTabelle.jsx): "gesetzlich" covers both a
  // rule's own origin label ("gesetzlich" = HERKUNFT_TEXT.gesetz) and its status
  // chip (STATUS_TEXT.gesetzlich) — one German word, one entry.
  "gesetzlich": "legal",
  "Praxiswert": "Practice value",
  "berechnet": "calculated",
  "fest": "fixed",
  "geplant": "scheduled",
  "abweichend": "changed",
  "veraltet – prüfen": "outdated – review",
  "Auf Standard zurücksetzen": "Reset to standard",
  "Auf Standard zurücksetzen?": "Reset to standard?",
  "Alle Regeln dieser Gruppe auf Standard zurücksetzen?": "Reset all rules of this group to standard?",
  "{n} Werte betroffen": "{n} values affected",
  "Wert nicht übernommen": "Value not accepted",
  "Wert von der Buchhaltung abgelehnt": "Value rejected by accounting",
  // Units of typ:'zahl' rules not covered by an existing key (80-01-SUMMARY
  // "Offen": the HR rule units had no EN yet; EURO_SUFFIX in RegelwerkTabelle.jsx
  // covers the Euro-valued ones directly and needs no separate unit entry).
  "Werktage": "working days",
  "Arbeitstage": "working days",
  "Tage/Woche": "days/week",
  "Stunden/Woche": "hours/week",
  "MB": "MB",
  "km": "km",
  "g/km": "g/km",
  "Byte": "byte",
  // --- 80-07: RegelwerkBereich.jsx (banners, EinstellungenDialog.jsx's link card) ---
  "Richtwerte, keine Rechts- oder Steuerberatung. Mit [ASSUMED] gekennzeichnete Werte vor der Nutzung prüfen lassen.": "Guideline values, not legal or tax advice. Have values marked [ASSUMED] checked before use.",
  "Gesetzlicher Wert hat sich geändert – Abweichung prüfen": "The legal value has changed – review the deviation",
  "Erinnerungen erscheinen nur in der App, ohne Mail und ohne Push.": "Reminders appear in the app only, without email or push.",
  "Sätze und Bürowerte der Buchhaltung pflegen Sie in Einstellungen › Regelwerke": "You maintain the accounting rates and office values in Settings › Rule books",
  "Zu den Regelwerken": "Go to rule books",
  // --- 28.09.2026: Settings › System, "Als App installieren" (SystemBereich.jsx) ---
  "Als App installieren": "Install as an app",
  "App installieren": "Install app",
  "Die App ist installiert. Ihre Daten liegen in diesem Browserprofil; sichern Sie sie über Daten & Sicherung.": "The app is installed. Your data lives in this browser profile; back it up under Data & Backup.",
  "Die App läuft danach wie ein Programm mit eigenem Fenster, auch ohne Internet. Buchhaltung, Personal und alle Daten bleiben auf diesem Gerät.": "The app then runs like a program in its own window, even offline. Accounting, HR and all data stay on this device.",
  "Installation abgebrochen. Sie können es jederzeit hier erneut starten.": "Installation cancelled. You can start it again here at any time.",
  "Sicherung nicht vergessen: Daten & Sicherung → Projektdatei exportieren, alle Bereiche angehakt.": "Do not forget a backup: Data & Backup → export the project file with every area ticked.",
  "Auf dem iPhone oder iPad: Teilen-Symbol → „Zum Home-Bildschirm“.": "On iPhone or iPad: share icon → “Add to Home Screen”.",
  "In Safari: Menü „Ablage“ → „Zum Dock hinzufügen“.": "In Safari: menu “File” → “Add to Dock”.",
  "Firefox bietet keine App-Installation. Bitte Chrome oder Edge verwenden.": "Firefox offers no app installation. Please use Chrome or Edge.",
  "In Chrome oder Edge: das Installations-Symbol rechts in der Adressleiste anklicken.": "In Chrome or Edge: click the install icon at the right end of the address bar.",
};
