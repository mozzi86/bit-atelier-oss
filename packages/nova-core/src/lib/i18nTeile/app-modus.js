// Besitzer: 93-11 — App-Modus (eigenes Fenster, unsichtbarer Server, „Programm beenden“).
//
// English dictionary part of the card "Programm" in Settings › System & Info (ProgrammBeenden.jsx).
// "Abbrechen" exists already and is not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Programm & Server": "Program & server",
  "Programm beenden": "Quit the program",
  "BIT-Atelier beenden?": "Quit BIT-Atelier?",
  "Der Server wird beendet, alle Fenster der App verlieren die Verbindung. Gespeicherte Daten bleiben erhalten.":
    "The server stops and every window of the app loses its connection. Saved data are kept.",
  "BIT-Atelier läuft im Hintergrund weiter, wenn Sie das Fenster schließen – so öffnet ein Doppelklick auf eine Projektdatei sofort. Hier beenden Sie es ganz; Protokoll: daten/server.log.":
    "BIT-Atelier keeps running in the background when you close the window – so a double-click on a project file opens at once. Quit it completely here; log: daten/server.log.",
  "BIT-Atelier wurde beendet. Sie können dieses Fenster schließen.": "BIT-Atelier has been quit. You can close this window.",
};
