// Placeholder engine of the correspondence (phase 82, 82-05, D-P82-28): fills
// `{{pfad|filter}}` in a letter text from a data object. Own mini engine on
// purpose — Mustache would be a new dependency and escapes HTML, which is wrong
// for a PDF and for a plain-text preview.
//
// Rules:
// - syntax `{{pfad}}`, `{{pfad|filter}}`, block `{{tabelle:name}}`; no logic, no loops;
// - filters only from the whitelist FILTER (eur, datum, datum_lang, prozent, zahl, gross);
// - a path is resolved over OWN properties only, the segments `__proto__`,
//   `prototype` and `constructor` are never followed (prototype pollution);
// - a missing required value becomes the visible mark `[[fehlt: pfad]]` and is
//   reported in `fehlend` (the editor blocks freezing then);
// - a line that consists of nothing but an empty optional placeholder is
//   dropped together with its line break (e.g. an empty department line);
// - an unknown filter leaves the placeholder as literal text and is reported in `fehler`.
// Values are formatted in German (de-DE): the letter content is German whatever
// language the app shows.
//
// In:  text, data object, options {pflicht}. Out: {text, teile, fehlend, fehler}. Pure, import-free.

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Path segments that are never followed (prototype pollution). */
const GESPERRT = new Set(["__proto__", "prototype", "constructor"]);

/** One placeholder: `{{ pfad }}` or `{{ pfad | filter }}`; no braces inside. */
const MUSTER = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;

/** Block placeholder: `{{tabelle:name}}`. */
const BLOCK = /^(tabelle):([A-Za-z0-9_]+)$/;

/** @param {string} s @returns {string} plain spaces instead of the (narrow) no-break spaces Intl writes (\s covers U+00A0 and U+202F; Intl output is one line) */
const leer = (s) => s.replace(/\s/g, " ");

/** @param {unknown} v @returns {number|null} */
function zahlVon(v) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} v @returns {[string, string, string]|null} year, month, day of 'YYYY-MM-DD…' */
function tagTeile(v) {
  const m = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? [m[1], m[2], m[3]] : null;
}

/**
 * The filter whitelist: value → text, or null when the value does not fit the filter.
 * @type {Readonly<Record<string, (v: unknown) => string|null>>}
 */
export const FILTER = Object.freeze({
  /** Euro amount, 2 decimals: 1234.56 → "1.234,56 €". */
  eur: (v) => {
    const n = zahlVon(v);
    return n === null ? null : leer(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n));
  },
  /** '2026-09-27' → '27.09.2026'. */
  datum: (v) => {
    const t = tagTeile(v);
    return t ? `${t[2]}.${t[1]}.${t[0]}` : null;
  },
  /** '2026-09-27' → '27. September 2026'. */
  datum_lang: (v) => {
    const t = tagTeile(v);
    return t ? `${Number(t[2])}. ${MONATE[Number(t[1]) - 1]} ${t[0]}` : null;
  },
  /** 5 → '5 %' (percent as given, not ×100). */
  prozent: (v) => {
    const n = zahlVon(v);
    return n === null ? null : `${leer(new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n))} %`;
  },
  /** 1234.5 → '1.234,5'. */
  zahl: (v) => {
    const n = zahlVon(v);
    return n === null ? null : leer(new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n));
  },
  /** Upper case (German rules). */
  gross: (v) => (v === null || v === undefined ? null : String(v).toLocaleUpperCase("de-DE")),
});

/**
 * Resolves a dotted path over own properties only.
 * @param {unknown} daten
 * @param {string} pfad
 * @returns {{gesperrt: boolean, wert: unknown}}
 */
function aufloesen(daten, pfad) {
  const teile = pfad.split(".");
  if (teile.some((s) => !s || GESPERRT.has(s))) return { gesperrt: true, wert: undefined };
  /** @type {any} */
  let wert = daten;
  for (const s of teile) {
    if (wert === null || typeof wert !== "object" || !Object.prototype.hasOwnProperty.call(wert, s)) return { gesperrt: false, wert: undefined };
    wert = wert[s];
  }
  return { gesperrt: false, wert };
}

/** @param {unknown} v @returns {boolean} */
const istLeer = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Block marker inside the result (table position of a protocol letter).
 * @typedef {{typ: 'tabelle', name: string}} BlockMarker
 */

/**
 * Fills the placeholders of a text.
 * @param {string} text template text
 * @param {Record<string, any>} daten data object (paths like `rechnung.nummer`)
 * @param {{pflicht?: ReadonlyArray<string>}} [optionen] pflicht: paths that must have a value
 * @returns {{text: string, teile: Array<string|BlockMarker>, fehlend: string[], fehler: string[]}}
 *   text: the filled text without block markers; teile: the text split at the block
 *   markers in order; fehlend: required paths without value; fehler: plain-text problems
 */
export function fuellePlatzhalter(text, daten, { pflicht = [] } = {}) {
  const pflichtSet = new Set(pflicht);
  /** @type {string[]} */
  const fehlend = [];
  /** @type {string[]} */
  const fehler = [];
  /** @type {Array<string|BlockMarker>} */
  const teile = [];
  let puffer = [];

  for (const zeile of String(text ?? "").split("\n")) {
    const nurEiner = zeile.trim().match(/^\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}$/);
    if (nurEiner) {
      const block = nurEiner[1].match(BLOCK);
      if (block) {
        teile.push(puffer.join("\n"));
        teile.push(/** @type {BlockMarker} */ ({ typ: /** @type {'tabelle'} */ (block[1]), name: block[2] }));
        puffer = [];
        continue;
      }
      // A line of one empty optional placeholder disappears with its line break.
      const { gesperrt, wert } = aufloesen(daten, nurEiner[1]);
      if (!gesperrt && istLeer(wert) && !pflichtSet.has(nurEiner[1]) && !nurEiner[2]) continue;
    }
    puffer.push(zeile.replace(MUSTER, (ganz, pfad, filter) => {
      if (BLOCK.test(pfad)) return "";
      const { gesperrt, wert } = aufloesen(daten, pfad);
      if (gesperrt) {
        fehler.push(`gesperrter Pfad: ${pfad}`);
        return ganz;
      }
      if (filter !== undefined && !Object.prototype.hasOwnProperty.call(FILTER, filter)) {
        fehler.push(`unbekannter Filter: ${filter}`);
        return ganz;
      }
      if (istLeer(wert) || (typeof wert === "object")) {
        if (pflichtSet.has(pfad)) {
          if (!fehlend.includes(pfad)) fehlend.push(pfad);
          return `[[fehlt: ${pfad}]]`;
        }
        return "";
      }
      if (filter === undefined) return String(wert);
      const aus = FILTER[filter](wert);
      if (aus === null) {
        fehler.push(`Wert passt nicht zum Filter ${filter}: ${pfad}`);
        return String(wert);
      }
      return aus;
    }));
  }
  teile.push(puffer.join("\n"));
  // Required paths that do not occur in the text are missing too.
  for (const p of pflichtSet) if (istLeer(aufloesen(daten, p).wert) && !fehlend.includes(p)) fehlend.push(p);
  return { text: teile.filter((x) => typeof x === "string").join("\n"), teile, fehlend, fehler };
}

/**
 * The placeholders of a text in order of appearance, without filters, each once.
 * Block placeholders keep their prefix (`tabelle:tops`).
 * @param {string} text
 * @returns {string[]}
 */
export function platzhalterIn(text) {
  /** @type {string[]} */
  const liste = [];
  for (const m of String(text ?? "").matchAll(MUSTER)) if (!liste.includes(m[1])) liste.push(m[1]);
  return liste;
}
