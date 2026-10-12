// Neutral sample data for the test print of a template (phase 82, 82-05):
// invented names and addresses only (projektneutral), every catalogue group
// filled so a template shows all its placeholders.
//
// In:  date, letterhead. Out: musterDaten, MUSTER_EMPFAENGER.

/** Recipient of a test print (invented). */
export const MUSTER_EMPFAENGER = Object.freeze({
  contact_id: null, anrede: "", titel: "", name: "Kontakt Beispiel", firma: "Firma Beispiel", abteilung: "",
  strasse: "Musterweg 1", plz: "90000", ort: "Musterstadt", land: "",
});

/**
 * Placeholder data of a test print.
 * @param {string} heute 'YYYY-MM-DD'
 * @param {Record<string, any>|null} briefkopf normalised letterhead
 * @returns {Record<string, any>}
 */
export function musterDaten(heute, briefkopf) {
  return {
    buero: { name: briefkopf?.office || "Büro Beispiel", zusatz: briefkopf?.tagline || "", anschrift: briefkopf?.address || "", kontakt: briefkopf?.contact || "" },
    empfaenger: { ...MUSTER_EMPFAENGER },
    projekt: { name: "Projekt Beispiel", nummer: "P-0000", adresse: "Musterweg 1, Musterstadt" },
    datum: heute, unser_zeichen: "AB", ihr_zeichen: "XY",
    postbuch: { nummer: `PE-${heute.slice(0, 4)}-0000`, datum: heute, betreff: "Musterbetreff", ihr_zeichen: "XY" },
    rechnung: { nummer: `RE-${heute.slice(0, 4)}-000`, datum: heute, offen: 1000 },
    mahnung: { stufe: 1, frist: heute, zinsen: 0, pauschale: 0, summe: 1000 },
    angebot: { nummer: `HA-${heute.slice(0, 4)}-000`, datum: heute, gueltig_bis: heute, netto: 1000, brutto: 1190 },
    vertrag: { nummer: `AV-${heute.slice(0, 4)}-000`, datum: heute },
    honorarnachtrag: { nr: 1, titel: "Musternachtrag", betrag: 500 },
    protokoll: { titel: "Jour fixe", datum: heute, ort: "Baustelle" },
  };
}
