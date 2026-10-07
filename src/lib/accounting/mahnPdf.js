// PDF of one dunning letter (phase 79-03): turns mahnwesen.mahnTextFelder()
// into the shared letter core's input and, only in the browser, a PDF.
//
// In:  the fields object mahnwesen.mahnTextFelder() returns. Out:
//      mahnBrief() (pure, testable without jsPDF — see buchhaltung-mahnpdf.
//      test.js) and erzeugeMahnPdf() (browser only, dynamic jsPDF import).

import { briefLayout } from "@core/lib/brief/briefLayout.js";
import { erzeugeBriefPdf } from "@core/lib/brief/briefPdf.js";

/**
 * The shared letter core's input from one set of dunning text fields.
 * @param {ReturnType<typeof import("./mahnwesen.js").mahnTextFelder>} felder
 * @returns {Parameters<typeof briefLayout>[0]}
 */
export function mahnBrief(felder) {
  return {
    absender: felder.absenderZeilen,
    empfaenger: felder.empfaengerZeilen,
    datum: felder.datum,
    betreff: felder.betreff,
    absaetze: [felder.anrede, ...felder.absaetze],
    tabelle: felder.tabelle,
  };
}

/**
 * @param {ReturnType<typeof import("./mahnwesen.js").mahnTextFelder>} felder
 * @returns {Promise<Uint8Array>}
 */
export async function erzeugeMahnPdf(felder) {
  return erzeugeBriefPdf(briefLayout(mahnBrief(felder)));
}

/**
 * Download file name of a dunning PDF.
 * @param {string|undefined} nummer Ausgangsrechnung.nummer
 * @param {number} stufe 1 | 2 | 3
 * @returns {string}
 */
export function mahnDateiname(nummer, stufe) {
  return `Mahnung-${nummer || "Entwurf"}-Stufe${stufe}.pdf`;
}
