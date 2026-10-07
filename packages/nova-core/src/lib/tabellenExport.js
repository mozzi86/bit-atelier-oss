// Table export: ONE table model feeds both CSV and XLSX, so the two files can never
// disagree. Written for the accounting module (phase 79), lifted into @core in plan
// 66-14 so the check suite (@ifc, which may only import @core) exports its findings
// list through the same code. src/lib/accounting/tabellenExport.js re-exports it.
//
// XLSX goes through the in-house writer novaXlsx (no dependency): dates as Excel
// serial numbers with the format dd.mm.yyyy, amounts with #,##0.00, values only — no
// formulas. novaXlsx writes any string starting with "=" as a FORMULA, so such text
// is prefixed with an apostrophe first.
//
// In:  table models {titel, spalten[{key, label, typ, breite}], zeilen}; labels
//      already translated by the caller. Out: CSV text, XLSX bytes, a browser download.

import { createWorkbook, writeWorkbook } from "./novaXlsx.js";
import { excelSerie } from "./kalender/datum.js";
import { csvText } from "./tabellenCsv.js";

/**
 * One exportable table.
 * `typ`: "text" | "betrag" (Euro) | "datum" ('YYYY-MM-DD') | "prozent" | "zahl".
 * `breite`: optional XLSX column width in characters (default 28 for text, 14 otherwise).
 * @typedef {{titel: string, spalten: Array<{key: string, label: string, typ?: string, breite?: number}>, zeilen: Array<Record<string, any>>}} Tabellenmodell
 */

/**
 * CSV text of one table model (rules in tabellenCsv.js).
 * @param {Tabellenmodell} modell
 * @returns {string}
 */
export function tabelleAlsCsv(modell) {
  return csvText(modell);
}

/**
 * XLSX workbook with one sheet per table model (sheet name = titel, header row
 * bold and frozen, auto filter).
 * @param {Tabellenmodell[]} modelle
 * @returns {Uint8Array} XLSX bytes
 * @throws {Error} when no model is given
 */
export function tabellenAlsXlsx(modelle) {
  const liste = Array.isArray(modelle) ? modelle : [];
  if (!liste.length) throw new Error("Export: keine Tabelle übergeben.");
  const wb = createWorkbook();
  for (const modell of liste) {
    const ws = wb.addSheet(modell.titel || "Tabelle");
    const spalten = modell.spalten || [];
    ws.zeile(1, spalten.map((s) => schuetze(s.label)), { bold: true });
    (modell.zeilen || []).forEach((z, i) => {
      spalten.forEach((s, j) => {
        const [wert, stil] = zelle(z?.[s.key], s.typ || "text");
        ws.setze(i + 2, j + 1, wert, stil);
      });
    });
    spalten.forEach((s, j) => ws.breite(j + 1, s.breite ?? (s.typ === "text" || !s.typ ? 28 : 14)));
    if (spalten.length) {
      ws.freeze("A2");
      ws.autoFilter(`A1:${spaltenBuchstabe(spalten.length)}${Math.max(1, (modell.zeilen || []).length + 1)}`);
    }
  }
  return writeWorkbook(wb);
}

/** @param {number} n 1-based column @returns {string} "A", "B", … "AA" */
function spaltenBuchstabe(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** @param {unknown} wert @returns {any} text with a leading "=" protected (would become a formula) */
function schuetze(wert) {
  return typeof wert === "string" && wert.startsWith("=") ? `'${wert}` : wert;
}

/**
 * Cell value and style for one value of a column type.
 * @param {unknown} wert
 * @param {string} typ
 * @returns {[any, object|null]}
 */
function zelle(wert, typ) {
  if (wert === null || wert === undefined || wert === "") return [null, null];
  if (typ === "datum" && typeof wert === "string") {
    const serie = excelSerie(wert);
    return serie === null ? [schuetze(wert), null] : [serie, { numFmt: "dd.mm.yyyy" }];
  }
  if (typeof wert === "number" && Number.isFinite(wert)) {
    if (typ === "betrag") return [Math.round(wert * 100) / 100, { numFmt: "#,##0.00" }];
    if (typ === "prozent") return [wert, { numFmt: "0.00" }];
    return [wert, null];
  }
  return [schuetze(String(wert)), null];
}

/**
 * Offers bytes as a download in the browser (pattern of projektDatei.js: a
 * temporary link, the URL revoked after one second so the download can start).
 * Purely local — a Blob URL, no network request.
 * @param {Uint8Array|string} bytes file content
 * @param {string} name file name
 * @param {string} mime MIME type, e.g. "text/csv;charset=utf-8"
 */
export function dateiAnbieten(bytes, name, mime) {
  const blob = new Blob([/** @type {BlobPart} */ (bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
