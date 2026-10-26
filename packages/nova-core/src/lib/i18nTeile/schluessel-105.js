// 105-12: English texts of the personnel-key rows in Settings › "Daten & Sicherung" (DatenOrdner.jsx,
// DatenBereich.jsx) — fingerprint, open-folder button, locked-store alert, restore note.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Fingerabdruck": "Fingerprint",
  "(steht auch in jeder Sicherung, sicherung.json)": "(also recorded in every backup, sicherung.json)",
  "Schlüssel-Ordner öffnen": "Open key folder",
  "Personalbereich gesperrt:": "Personnel area locked:",
  "Legen Sie die getrennt gesicherte Schlüsseldatei an den oben genannten Ort und starten Sie die App neu.":
    "Put the separately backed-up key file at the location shown above and restart the app.",
  "Die Sicherung enthält den Schlüssel der Personaldaten bewusst nicht: auf einem anderen Rechner zusätzlich die getrennt gesicherte Datei personal.key an den angezeigten Ort legen, sonst bleiben die Personaldaten gesperrt.":
    "The backup deliberately does not contain the key of the personnel data: on another computer, also put the separately backed-up file personal.key at the location shown, otherwise the personnel data stay locked.",
};
