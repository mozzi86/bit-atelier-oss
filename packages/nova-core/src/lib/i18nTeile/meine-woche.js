// Besitzer: 82-06, Spur — — nur diese Datei ändern.
//
// English dictionary part of phase 82 "Dashboard-Karte Meine Woche und Abschluss".
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
  "Meine Woche": "My week",
  "Meine Woche konnte nicht geladen werden": "My week could not be loaded",
  "überfällig und heute": "overdue and today",
  "Meine Stunden": "My hours",
  "Soll diese Woche {n} h": "Target this week {n} h",
  "Abwesend im Team": "Absent in the team",
  "Diese Woche ist niemand abwesend.": "Nobody is absent this week.",
  "Offene Anträge": "Open requests",
  "Posteingang mit Frist": "Incoming mail with deadline",
  "Erinnerungen erscheinen nur hier in der App — keine Mail, kein Push.": "Reminders appear only here in the app — no mail, no push.",
  "{n} fällig": "{n} due",
};
