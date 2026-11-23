// 115-05b part 2 (A-5, A-7): English texts of the focus check and of the strict writers without a holder - the banner when the
// model of the open project was replaced by another record (import, seed, restore), and AVA's note when its copy of the model is
// older than the stored one. German source text = key ("Neu laden" exists in i18n.jsx and is not repeated here).
//
// LAZY part (size budget of the entry chunk, pattern standschutz-115-05.js): NOT listed in ./index.js. StandWaechterHinweis.jsx
// (loaded lazily by ComplexDesigner) and AVA.jsx import it and call englischErgaenzen(EN) of ../i18n.jsx once when they load.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Modell wurde ersetzt — neu laden": "Model was replaced — reload",
  "Das gespeicherte Gebäudemodell dieses Projekts ist ein anderer Datensatz (Import, Wiederherstellung). Bis zum Neuladen wird nichts gespeichert.":
    "The stored building model of this project is a different record (import, restore). Nothing is saved until you reload.",
  "Modell inzwischen geändert — neu laden": "Model changed in the meantime — reload",
};
