// Table export of the accounting module (phase 79): ONE table model per area feeds
// both CSV and XLSX, so the two files can never disagree.
//
// The model, the CSV/XLSX writers and the download helper moved to
// @core/lib/tabellenExport.js in plan 66-14 (the check suite in @ifc may only import
// @core and needs the same export). They are re-exported here unchanged, so every
// accounting import path keeps working; what stays is the one accounting-specific
// piece, the file name "buchhaltung-<bereich>-<jahr>.<endung>".
//
// In:  table models {titel, spalten[{key, label, typ}], zeilen}; labels already
//      translated by the caller. Out: CSV text, XLSX bytes, a browser download.

export { tabelleAlsCsv, tabellenAlsXlsx, dateiAnbieten } from "@core/lib/tabellenExport.js";

/**
 * One exportable table (see @core/lib/tabellenExport.js).
 * @typedef {import("@core/lib/tabellenExport.js").Tabellenmodell} Tabellenmodell
 */

/**
 * File name of an export: "buchhaltung-<bereich>-<jahr>.<endung>" with a
 * file-system-safe area name.
 * @param {string} bereich area key, e.g. "ausgangsrechnungen"
 * @param {number|string} jahr business year
 * @param {string} endung "csv" or "xlsx"
 * @returns {string}
 */
export function dateiname(bereich, jahr, endung) {
  const sauber = String(bereich || "export").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `buchhaltung-${sauber}-${jahr}.${String(endung || "csv").replace(/^\./, "")}`;
}
