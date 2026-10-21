// 104-09: pure helpers of the PDF studio's saving state — no pdf-lib, so the studio chunk can use
// them without loading the PDF library (that is imported on demand when the user saves).
//
// - pinNummern / anmerkungFingerabdruck: how a studio annotation looks in the PDF (number + content
//   hash); the same functions decide in pdfAnmerkungen.js whether an object must be rewritten.
// - pdfStandVergleich: which records are not yet in the PDF, compared with the map the document
//   record keeps after each save (Document.pdf_anmerkungen = { record id: fingerprint }).
// - enthaeltStudioMarke: quick byte search whether a file carries studio annotations at all (only
//   then the studio builds its display copy without them).
//
// In: annotation records (entity PdfAnnotation), PDF bytes. Out: numbers, maps, booleans.

/** Prefix of /NM (annotation name) of every annotation the studio writes into a PDF. */
export const NM_PRAEFIX = "bit-atelier:";

/**
 * Studio annotation record (subset used here).
 * @typedef {object} StudioAnmerkung
 * @property {string} id record id
 * @property {"pin"|"ink"|"text"} type
 * @property {number} page page number, 1-based
 * @property {number} x normalised 0…1 of the rendered page width, from the left
 * @property {number} y normalised 0…1 of the rendered page height, from the top
 * @property {Array<{x: number, y: number}>} [points] freehand points, normalised like x/y
 * @property {string} [text] comment / text
 * @property {string} [color] "#rrggbb"
 * @property {string} [author]
 * @property {string} [created_date] ISO date
 * @property {boolean} [_lokal] only in this browser — the server has not confirmed it (104-09)
 */

/**
 * Pin numbers as the studio shows them: per page, ordered by creation time, starting at 1.
 * @param {StudioAnmerkung[]} anmerkungen
 * @returns {Map<string, number>} record id → number
 */
export function pinNummern(anmerkungen) {
  /** @type {Record<number, StudioAnmerkung[]>} */
  const jeSeite = {};
  for (const a of anmerkungen) if (a.type === "pin") (jeSeite[a.page] ||= []).push(a);
  const out = new Map();
  for (const liste of Object.values(jeSeite)) {
    liste.sort((a, b) => (a.created_date || "").localeCompare(b.created_date || ""));
    liste.forEach((a, i) => out.set(a.id, i + 1));
  }
  return out;
}

const r4 = (/** @type {number} */ v) => Math.round(Number(v || 0) * 10000) / 10000;

/**
 * Fingerprint of everything that ends up in the PDF for one annotation (FNV-1a, 32 bit, hex). Two
 * records with the same fingerprint produce the same PDF object, so an unchanged one is not rewritten.
 * @param {StudioAnmerkung} a
 * @param {number} [nr] pin number (pinNummern)
 * @returns {string} 8 hex digits
 */
export function anmerkungFingerabdruck(a, nr = 0) {
  const roh = JSON.stringify([a.type, a.page, r4(a.x), r4(a.y), (a.points || []).map((p) => [r4(p.x), r4(p.y)]),
    a.text || "", a.color || "", a.author || "", a.type === "pin" ? nr : 0]);
  let h = 0x811c9dc5;
  for (let i = 0; i < roh.length; i += 1) {
    h ^= roh.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Difference between the studio records and what the last save wrote into the PDF.
 * Local-only records (`_lokal`) count as "neu" — they reach the PDF after they reached the server.
 * @param {StudioAnmerkung[]} anmerkungen current records of the document
 * @param {Record<string, string>|null|undefined} imPdf Document.pdf_anmerkungen (record id → fingerprint)
 * @returns {{neu: number, geaendert: number, entfernt: number, offen: number}} counts; offen = sum
 */
export function pdfStandVergleich(anmerkungen, imPdf) {
  const pdf = imPdf && typeof imPdf === "object" ? imPdf : {};
  const nummern = pinNummern(anmerkungen);
  let neu = 0;
  let geaendert = 0;
  const ids = new Set();
  for (const a of anmerkungen) {
    ids.add(a.id);
    const fp = pdf[a.id];
    if (!fp || a._lokal) neu += 1;
    else if (fp !== anmerkungFingerabdruck(a, nummern.get(a.id) || 0)) geaendert += 1;
  }
  const entfernt = Object.keys(pdf).filter((id) => !ids.has(id)).length;
  return { neu, geaendert, entfernt, offen: neu + geaendert + entfernt };
}

/** Byte patterns of NM_PRAEFIX as pdf-lib writes it (UTF-16BE hex with BOM) and as a literal string. */
const MARKEN = (() => {
  const hex = "FEFF" + Array.from(NM_PRAEFIX).map((z) => z.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");
  return [hex, hex.toLowerCase(), `(${NM_PRAEFIX}`].map((m) => Uint8Array.from(m, (z) => z.charCodeAt(0)));
})();

/**
 * True when the file contains an annotation name written by the studio (byte search, no parsing).
 * A file rewritten by another tool may encode the name differently — then this says false and the
 * studio shows those annotations twice (PDF + overlay), nothing is lost.
 * @param {Uint8Array} bytes whole PDF
 * @returns {boolean}
 */
export function enthaeltStudioMarke(bytes) {
  for (const m of MARKEN) {
    const erstes = m[0];
    outer: for (let i = bytes.indexOf(erstes); i >= 0 && i <= bytes.length - m.length; i = bytes.indexOf(erstes, i + 1)) {
      for (let j = 1; j < m.length; j += 1) if (bytes[i + j] !== m[j]) continue outer;
      return true;
    }
  }
  return false;
}

/**
 * True when the document record is fixed: it carries a SHA-256 of its bytes (Document.sha256, set
 * by dokumentAblegen for sent or confirmed documents — outgoing letters, fee offers, order
 * confirmations). Those bytes are the proof of WHAT was sent and must stay exactly as they are, so
 * "Im PDF speichern" refuses them; annotations stay studio records and can still be exported.
 * @param {{sha256?: unknown}|null|undefined} dokument Document record
 * @returns {boolean}
 */
export function istFestgeschrieben(dokument) {
  return typeof dokument?.sha256 === "string" && dokument.sha256.trim() !== "";
}
