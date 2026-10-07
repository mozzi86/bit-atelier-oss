// CSV writer for table models — the part of the accounting CSV module (phase 79)
// that every area needs, lifted into @core in plan 66-14 so the check suite (@ifc,
// which may only import @core) writes its findings list with the SAME rules as the
// bookkeeping exports instead of a second implementation. src/lib/accounting/csv.js
// re-exports `csvText`; the reader (parseCsv, erkenneTrenner, dekodiere) stays there.
//
// Writer rules: UTF-8 BOM (Excel recognises the charset), ";" as separator, CRLF,
// decimal comma without thousands separator, dates as dd.mm.yyyy, and a leading
// apostrophe before text starting with = + - @ tab or CR (formula injection guard,
// never for numbers — a negative amount stays a number).
//
// In:  a table model {spalten: [{key, label, typ?}], zeilen: [{…}]}.
// Out: CSV text.

/** @param {number} zahl @returns {string} decimal comma, no thousands separator */
function zahlText(zahl) {
  return String(zahl).replace(".", ",");
}

/**
 * One value as a CSV field according to its column type.
 * @param {unknown} wert
 * @param {string} typ "text" | "betrag" | "datum" | "prozent" | "zahl"
 * @returns {string} unquoted field content
 */
function feldText(wert, typ) {
  if (wert === null || wert === undefined || wert === "") return "";
  if (typeof wert === "number" && Number.isFinite(wert)) {
    if (typ === "betrag") return (Math.round(wert * 100) / 100).toFixed(2).replace(".", ",");
    return zahlText(wert);
  }
  const s = String(wert);
  if (typ === "datum" && /^\d{4}-\d{2}-\d{2}/.test(s)) return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  // Formula injection guard (text only): = + - @ tab CR at the start.
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** @param {string} s @returns {string} quoted when needed */
const quote = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * CSV text of a table model: BOM, header row with the column labels, ";"
 * separator, CRLF line ends. Labels are passed in already translated.
 * @param {{spalten: Array<{key: string, label: string, typ?: string}>, zeilen: Array<Record<string, any>>}} modell
 * @returns {string}
 */
export function csvText(modell) {
  const spalten = modell?.spalten || [];
  const kopf = spalten.map((s) => quote(feldText(s.label, "text")));
  const zeilen = (modell?.zeilen || []).map((z) => spalten.map((s) => quote(feldText(z?.[s.key], s.typ || "text"))).join(";"));
  return "﻿" + [kopf.join(";"), ...zeilen].join("\r\n") + "\r\n";
}
