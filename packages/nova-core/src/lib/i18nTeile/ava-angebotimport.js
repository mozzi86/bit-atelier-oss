// Besitzer: 90-03 — nur diese Datei ändern.
//
// English dictionary part of the GAEB offer import (AngebotImportDialog in the Preisspiegel).
// Existing keys ("Abbrechen", "Speichern…" …) are not repeated (duplicate guard in
// tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Als Angebot übernehmen": "Take over as offer",
  "Angebotsdatei (GAEB DA XML .x84 / .x86)": "Offer file (GAEB DA XML .x84 / .x86)",
  "Angebotssumme (LV-Mengen)": "Offer total (BoQ quantities)",
  "Bieter laut Datei": "Bidder according to the file",
  "Datei zu groß": "File too large",
  "Die Datei enthält keine Einheitspreise — ist es eine Angebotsaufforderung (X83) statt eines Angebots (X84)?": "The file contains no unit prices — is it a request for offers (X83) instead of an offer (X84)?",
  "GAEB-Angebot importieren": "Import GAEB offer",
  "Kein GAEB-DA-XML — erwartet wird ein Angebot als .x84 (oder .x86).": "Not a GAEB DA XML — an offer as .x84 (or .x86) is expected.",
  "Kein eindeutiger Kontakt gefunden — bitte den Bieter wählen (kein automatisches Raten).": "No unique contact found — please choose the bidder (no automatic guessing).",
  "Kontakt im Adressbuch": "Contact in the address book",
  "kein Preis im Angebot — bleibt im Preisspiegel leer": "no price in the offer — stays empty in the price comparison",
  "mit Preis übernommen": "taken over with price",
  "nicht angegeben": "not stated",
  "nicht im LV dieser Vergabe — nicht übernommen": "not in the BoQ of this tender — not taken over",
  "nicht im LV": "not in the BoQ",
  "ohne Preis": "without price",
  "— bitte wählen —": "— please choose —",
};
