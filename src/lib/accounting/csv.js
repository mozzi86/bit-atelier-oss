// CSV for the accounting module (phase 79): a quote- and multi-line-safe parser
// with a selectable separator (generalised from parseCsvSemikolon in
// @ifc/lib/loiListe.js, which stays unchanged), separator and charset detection
// for bank exports, and — re-exported from @core/lib/tabellenCsv.js since plan
// 66-14 — the writer for German spreadsheet programs.
//
// Writer rules (see tabellenCsv.js): UTF-8 BOM (Excel recognises the charset), ";"
// as separator, CRLF, decimal comma without thousands separator, dates as
// dd.mm.yyyy, and a leading apostrophe before text starting with = + - @ tab or CR
// (formula injection guard, never for numbers — a negative amount stays a number).
//
// In:  text / bytes / a table model (tabellenExport.js). Out: rows or CSV text.

/**
 * Parses CSV text into rows of fields. Double quotes may contain the separator
 * and line breaks; "" inside quotes is a literal quote. BOM is dropped, CRLF/LF
 * both end a row, a trailing empty line is ignored.
 * @param {string} text
 * @param {{trenner?: string}} [optionen] separator, default ";"
 * @returns {string[][]}
 */
export function parseCsv(text, { trenner = ";" } = {}) {
  const t = String(text ?? "").replace(/^\uFEFF/, "");
  /** @type {string[][]} */
  const zeilen = [];
  /** @type {string[]} */
  let zeile = [];
  let feld = "";
  let inQuotes = false;
  for (let i = 0; i < t.length; i++) {
    const z = t[i];
    if (inQuotes) {
      if (z === '"') {
        if (t[i + 1] === '"') { feld += '"'; i++; } else inQuotes = false;
      } else feld += z;
    } else if (z === '"') {
      inQuotes = true;
    } else if (z === trenner) {
      zeile.push(feld); feld = "";
    } else if (z === "\n" || z === "\r") {
      if (z === "\r" && t[i + 1] === "\n") i++;
      zeile.push(feld); feld = "";
      zeilen.push(zeile); zeile = [];
    } else feld += z;
  }
  zeile.push(feld);
  if (zeile.some((f) => f !== "")) zeilen.push(zeile);
  return zeilen;
}

/**
 * Guesses the separator from the first lines: the candidate that occurs most
 * often (outside quotes) and equally often in each line wins; ";" on a tie.
 * @param {string} text
 * @returns {";"|","|"\t"}
 */
export function erkenneTrenner(text) {
  const zeilen = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((z) => z.trim()).slice(0, 10);
  /** @param {string} zeile @param {string} zeichen */
  const zaehle = (zeile, zeichen) => {
    let n = 0;
    let q = false;
    for (const c of zeile) { if (c === '"') q = !q; else if (!q && c === zeichen) n++; }
    return n;
  };
  let bester = /** @type {";"|","|"\t"} */ (";");
  let besteWertung = -1;
  for (const kandidat of /** @type {Array<";"|","|"\t">} */ ([";", ",", "\t"])) {
    const anzahlen = zeilen.map((z) => zaehle(z, kandidat));
    const gleich = anzahlen.length > 0 && anzahlen.every((a) => a === anzahlen[0]);
    const wertung = (anzahlen[0] || 0) * (gleich ? 2 : 1);
    if (wertung > besteWertung) { bester = kandidat; besteWertung = wertung; }
  }
  return bester;
}

/**
 * Bytes of an uploaded file → text. `file.text()` would destroy windows-1252
 * exports of German banks, so: BOM removed, UTF-8 with `fatal: true`, and on a
 * decoding error windows-1252.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {string}
 */
export function dekodiere(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ohneBom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(ohneBom);
  } catch {
    return new TextDecoder("windows-1252").decode(ohneBom);
  }
}

// The writer (csvText: BOM, ";", CRLF, decimal comma, formula guard) moved to @core in
// plan 66-14 so the check suite can use the same rules; re-exported here unchanged.
export { csvText } from "@core/lib/tabellenCsv.js";
