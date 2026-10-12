// Besitzer: 82-02, Spur A — nur diese Datei ändern.
//
// English dictionary part of phase 82 "Rollen & Rechte (Bereich Nutzer & Rechte, Ansicht als, Tore)".
// A word both lanes need is not entered twice: if the duplicate guard reports
// one after a wave merge, the merge fix moves it once into the block "Words
// several tabs share" of buero-orga-fundament.js (79 lesson 4a726bb/c8858d0).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) refuses a key that
// already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Header, gate
  "Ansicht als …": "View as …",
  "Ansicht als – keine Anmeldung. Ordnet, was angezeigt wird; schützt keine Daten auf diesem Gerät.": "View as – no sign-in. It orders what is shown; it protects no data on this device.",
  "Rechte konnten nicht geladen werden": "Permissions could not be loaded",
  "Dieser Bereich ist für Ihre Rolle nicht freigegeben.": "This area is not enabled for your role.",
  "Dieser Bereich bleibt lokal – in der Cloud-Fassung erst nach Zugriffstrennung (Phase 74).": "This area stays local – in the cloud version only after access separation (phase 74).",
  "Nur lesen — Ihre Rolle darf hier nichts ändern.": "Read only — your role may not change anything here.",
  "Laden, Schnappschüsse und Zurücksetzen nur für Inhaber": "Loading, snapshots and reset for owners only",
  "Sie erfassen Ihre eigenen Stunden.": "You record your own hours.",
  // Settings area Nutzer & Rechte
  "Was diese Rechte leisten": "What these permissions do",
  "Sie ordnen, wer was sieht. Sie sind keine Zugriffssicherheit — alle Daten liegen in diesem Browser bzw. auf dem Express-Server, der im Netzwerk ohne Anmeldung erreichbar ist. Echte Trennung kommt serverseitig mit Phase 74/78.": "They order who sees what. They are no access security — all data lie in this browser or on the Express server, which the network reaches without sign-in. Real separation comes server-side with phase 74/78.",
  "„Ansicht als …“ ist keine Anmeldung: Wer das Gerät nutzt, kann jede Ansicht wählen.": "“View as …” is no sign-in: whoever uses the device can pick any view.",
  "Nutzer anlegen": "Add user",
  "Nutzer bearbeiten": "Edit user",
  "Nutzer deaktivieren?": "Deactivate user?",
  "Nutzer gespeichert": "User saved",
  "Noch keine Nutzer — die App arbeitet als Inhaber/in.": "No users yet — the app works as the owner.",
  "Mindestens ein aktiver Inhaber muss bleiben.": "At least one active owner must remain.",
  "Ohne verknüpfte Person sieht diese Rolle keine Projekte.": "Without a linked person this role sees no projects.",
  "alle Projekte (keine Zuordnung)": "all projects (no assignment)",
  "Projektzuordnung bearbeiten": "Edit project assignment",
  "Projektzuordnungen pflegt, wer Personal verwalten darf.": "Project assignments are maintained by whoever may manage personnel.",
  "aktiv": "active",
  // Matrix
  "Rechte je Rolle": "Permissions per role",
  "Projektsicht": "Project view",
  "nur zugeordnete": "assigned only",
  "alle Projekte": "all projects",
  "Rechte gespeichert": "Permissions saved",
  "Der Inhaber behält Einstellungen und Rechte.": "The owner keeps settings and permissions.",
  "Mitarbeiter/innen sehen nie Personal, Buchhaltung, Kostensätze oder die Freigabe.": "Employees never see personnel, accounting, cost rates or the approval.",
};
