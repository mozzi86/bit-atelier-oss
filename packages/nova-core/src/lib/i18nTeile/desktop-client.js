// Owner: Phase 70 (desktop client, 70-02 shell + profile, 70-03 own storage location) — change only this file
// for the client's texts.
//
// English dictionary part of the Tauri desktop client: first-start profile dialog, storage-location card.
// Existing keys ("Büro", "Abbrechen", "Speichern", "Ordner öffnen", "Belegt", "Datenordner", "Name") are not
// repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // 70-02: profile dialog (src/client/ProfilDialog.jsx)
  "Willkommen bei BIT-Atelier": "Welcome to BIT-Atelier",
  "Profil bearbeiten": "Edit profile",
  "Ein lokales Profil für dieses Gerät – kein Konto, kein Server, keine Zahlung. Sie können es jederzeit ändern.": "A local profile for this device – no account, no server, no payment. You can change it at any time.",
  "Das gespeicherte Profil ließ sich nicht lesen:": "The saved profile could not be read:",
  "Ihr Name": "Your name",
  "Ablageort": "Storage location",
  "WebView-Speicher (vorläufig)": "WebView storage (provisional)",
  "Profil anlegen": "Create profile",
  // 70-03: storage location — profile dialog, start gate (src/client/ClientTor.jsx), takeover, settings card
  "Bitte einen Ablageort wählen.": "Please choose a storage location.",
  "Ordner wählen": "Choose folder",
  "Hier legt BIT-Atelier alle Projekte als Dateien ab. Nehmen Sie den Ordner in Ihre Datensicherung auf.": "BIT-Atelier keeps all projects here as files. Include this folder in your backup.",
  "Dieser Ordner wird von einem Cloud-Dienst synchronisiert. Das kann Dateien sperren oder Konfliktkopien erzeugen – ein lokaler Ordner ist sicherer.": "This folder is synchronised by a cloud service. That can lock files or create conflict copies – a local folder is safer.",
  "Der Ordner enthält bereits BIT-Atelier-Daten – sie werden verwendet.": "The folder already contains BIT-Atelier data – it will be used.",
  "Der Ordner ist nicht leer. BIT-Atelier legt seine Unterordner daneben an.": "The folder is not empty. BIT-Atelier creates its sub-folders alongside.",
  "Ablageort nicht gefunden": "Storage location not found",
  "Der Ordner aus Ihrem Profil existiert nicht (mehr). Ist ein Laufwerk nicht verbunden, schließen Sie BIT-Atelier und verbinden Sie es zuerst.": "The folder from your profile does not exist (any more). If a drive is not connected, close BIT-Atelier and connect it first.",
  "Anderen Ordner wählen": "Choose another folder",
  "Leer neu anlegen": "Create it empty",
  "Ablageort nicht nutzbar": "Storage location not usable",
  "Bisherige Daten übernehmen?": "Take over existing data?",
  "{n} Datensätze aus der bisherigen Installation übernehmen?": "Take over {n} records from the previous installation?",
  "Quelle: Browser-Speicher dieses Programms (frühere Fassung)": "Source: browser storage of this program (earlier version)",
  "Vorher wird eine Sicherungskopie im Ablageort (Ordner „uebernahme“) angelegt. Die bisherige Installation bleibt unverändert.": "A backup copy is created first in the storage location (folder “uebernahme”). The previous installation stays unchanged.",
  "Nicht übernehmen": "Do not take over",
  "Ohne Übernahme weiter": "Continue without takeover",
  "Ablageort wird geöffnet …": "Opening the storage location …",
  "Zu diesem Ablageort wechseln?": "Switch to this storage location?",
  "Der Ordner enthält bereits BIT-Atelier-Daten. BIT-Atelier arbeitet danach mit diesem Bestand; der bisherige Ablageort bleibt unverändert.": "The folder already contains BIT-Atelier data. BIT-Atelier will then work with that data; the previous storage location stays unchanged.",
  "Wechseln": "Switch",
  "Daten in den neuen Ordner kopieren?": "Copy the data into the new folder?",
  "Alle Daten werden in den neuen Ordner kopiert, danach arbeitet BIT-Atelier dort. Der bisherige Ordner bleibt als Kopie erhalten.": "All data is copied into the new folder, then BIT-Atelier works there. The previous folder remains as a copy.",
  "Kopieren und wechseln": "Copy and switch",
  "Bitte einen leeren Ordner oder einen bestehenden BIT-Atelier-Ablageort wählen.": "Please choose an empty folder or an existing BIT-Atelier storage location.",
  "Ablageort ändern": "Change storage location",
  "Profil": "Profile",
  "Ihre Arbeit liegt nur im Ablageort auf diesem Gerät — eine Sicherung als Datei schützt vor Festplattenschaden und versehentlichem Löschen.": "Your work exists only in the storage location on this device — a backup file protects against disk failure and accidental deletion.",
};
