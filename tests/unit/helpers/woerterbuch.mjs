// Shared reader of the English dictionary for the guard tests (79-01, decision
// list § 5): DICT.en of packages/nova-core/src/lib/i18n.jsx AND every part file
// under packages/nova-core/src/lib/i18nTeile/ (except index.js), read as TEXT —
// no React, no module loading, so a broken part file shows up as a failed
// assertion instead of a crash. One helper for every guard, so a phase that adds
// part files (80–82) needs no change in the tests.
//
// In:  the source files above. Out: [schluessel, wert, datei] triples in file order.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../../", import.meta.url));
const I18N = "packages/nova-core/src/lib/i18n.jsx";
const TEILE = "packages/nova-core/src/lib/i18nTeile";

/** One dictionary line: "key": "value" (values may sit on the next line). */
const PAAR = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/gm;

/**
 * Undo the escapes a JS string literal may contain in these files.
 * @param {string} s raw literal content
 * @returns {string}
 */
export const entschluesseln = (s) => s.replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n");

/**
 * Pairs of the object literal between `start` and the next "\n};".
 * @param {string} datei path relative to the repo root
 * @param {string} start text that opens the literal
 * @returns {Array<[string, string, string]>}
 */
function paareAus(datei, start) {
  const quelle = fs.readFileSync(path.join(WURZEL, datei), "utf8");
  const anfang = quelle.indexOf(start);
  const ende = quelle.indexOf("\n};", anfang);
  if (anfang < 0 || ende < anfang) throw new Error(`Wörterbuch nicht gefunden in ${datei} (erwartet „${start}“ … „};“)`);
  return [...quelle.slice(anfang, ende).matchAll(PAAR)].map((m) => [entschluesseln(m[1]), entschluesseln(m[2]), datei]);
}

/**
 * Part files of the dictionary (relative paths, sorted), without index.js.
 * @returns {string[]}
 */
export function teilDateien() {
  return fs.readdirSync(path.join(WURZEL, TEILE))
    .filter((n) => n.endsWith(".js") && n !== "index.js")
    .sort()
    .map((n) => `${TEILE}/${n}`);
}

/**
 * Every English entry: DICT.en of i18n.jsx first, then each part file.
 * @returns {Array<[string, string, string]>} [German key, English value, file]
 */
export function englischePaareAlle() {
  const paare = paareAus(I18N, "en: {");
  for (const datei of teilDateien()) paare.push(...paareAus(datei, "export const EN = {"));
  return paare;
}
