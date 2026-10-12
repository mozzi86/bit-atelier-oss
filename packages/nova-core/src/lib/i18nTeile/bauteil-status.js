// Besitzer: 89-04 — nur diese Datei ändern.
//
// English dictionary part of the status visibility in the IFC viewer (D-BW-03: no default, an
// element without status is shown as "ohne Status"). Existing keys ("ohne Status" from bestand.js, "Abbruch", "Neubau" …)
// are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Sichtbar": "Visible",
  "Ausblenden": "Hide",
  "Einblenden": "Show",
};
