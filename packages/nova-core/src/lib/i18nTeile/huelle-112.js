// English dictionary part of phase 112 (foreign review 08.11.2026, plan 112-01 review fixes): the compact hints of the
// app shell when one of its lazily loaded parts fails to load (TeilFehlergrenze in ../../components/ModulFehlergrenze.jsx).
// Eager on purpose: the shell (Layout.jsx, App.jsx) shows these texts, so they cannot live in a lazy part.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Speicherstatus nicht verfügbar – neu laden": "Storage status unavailable – reload",
  "Abgleich-Hinweise nicht verfügbar – neu laden": "Sync notices unavailable – reload",
  "Datei-Empfang nicht verfügbar – neu laden": "File receiver unavailable – reload",
};
