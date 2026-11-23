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
 * Phase 115 (user finding 15.11.2026): with `felder.schlussAb` the paragraphs from that index on (deadline sentence,
 * greeting) become `schluss` — printed AFTER the amount table; before, the table stood below the greeting. Fields
 * without `schlussAb` give the input they gave before (everything in `absaetze`).
 * @param {Omit<ReturnType<typeof import("./mahnwesen.js").mahnTextFelder>, 'schlussAb'> & {schlussAb?: number}} felder
 * @returns {NonNullable<Parameters<typeof briefLayout>[0]>}
 */
export function mahnBrief(felder) {
  const ab = felder.schlussAb;
  const geteilt = typeof ab === "number" && Number.isInteger(ab) && ab >= 0 && ab < felder.absaetze.length;
  return {
    absender: felder.absenderZeilen,
    empfaenger: felder.empfaengerZeilen,
    datum: felder.datum,
    betreff: felder.betreff,
    absaetze: [felder.anrede, ...(geteilt ? felder.absaetze.slice(0, ab) : felder.absaetze)],
    tabelle: felder.tabelle,
    ...(geteilt ? { schluss: felder.absaetze.slice(ab) } : {}),
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
