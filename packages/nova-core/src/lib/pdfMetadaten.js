// 105-19: document language and title for every PDF the app writes (PDF/UA-1 7.2 / WCAG 3.1.1: a screen
// reader picks its pronunciation from the catalog /Lang; a viewer shows /Title instead of the file name
// when /DisplayDocTitle is set). One helper per PDF library, used by every generator; the guard test
// tests/unit/pdfMetadaten-10519.test.js enumerates all files that import jspdf or pdf-lib so a new
// generator cannot forget it.
//
// This module imports neither library: the jsPDF instance and the pdf-lib PDFDocument are passed in, so
// the helper costs a few hundred bytes in whatever (lazy) chunk already carries the generator.
// W0-F6: client modules import it ONLY with `await import(…)`. A static import from many route chunks made Rollup give
// it a chunk of its own that the entry's preload map then named (+63 B gzip on the entry); a dynamically imported
// module is not preloaded with its importer's route. Guard: tests/unit/pdfMetadaten-nachgang.test.js (node-only
// bitCheckBericht.js is the one exception).
//
// Language rule:
// - generated reports, letters and plans write their text in German (hard-coded content strings) →
//   PDF_SPRACHE_STANDARD ("de-DE"), whatever the UI language is: /Lang describes the CONTENT;
// - a PDF that only re-packs a user's file (merge, split, stamp, flatten …) keeps the source's /Lang;
//   when the source has none, the active UI language is used [ASSUMED: the person working on it reads
//   that language] (pdfSpracheAusUi).

/** BCP 47 tag of the German content every generator writes. */
export const PDF_SPRACHE_STANDARD = "de-DE";

/** UI language code (@core/lib/i18n LANGS) → BCP 47 tag for /Lang. en-GB [ASSUMED: DACH office English]. */
export const UI_SPRACHE_ZU_PDF = Object.freeze({ de: "de-DE", en: "en-GB" });

/** Producer/creator name written into the info dictionary of generated files. */
export const PDF_ERSTELLER = "BIT-Atelier";

/**
 * BCP 47 tag of the active UI language: <html lang> (set by I18nProvider), else the stored choice
 * (localStorage "lang"), else German. Never throws (no DOM under node, blocked storage).
 * @returns {string} e.g. "de-DE" or "en-GB"
 */
export function pdfSpracheAusUi() {
  /** @type {string} */
  let code = "";
  try {
    code = String(globalThis.document?.documentElement?.lang || "");
    if (!code) code = String(globalThis.localStorage?.getItem("lang") || "");
  } catch {
    code = "";
  }
  const kurz = code.toLowerCase().split("-")[0];
  return /** @type {Record<string, string>} */ (UI_SPRACHE_ZU_PDF)[kurz] || PDF_SPRACHE_STANDARD;
}

/**
 * A readable document title from a download file name: no folder, no ".pdf", underscores as spaces.
 * @param {string|null|undefined} dateiname e.g. "Protokoll_03_Baubesprechung_2026-11-19.pdf"
 * @returns {string} e.g. "Protokoll 03 Baubesprechung 2026-11-19" ("" for an empty name)
 */
export function pdfTitelAusDateiname(dateiname) {
  const name = String(dateiname || "").split(/[\\/]/).pop() || "";
  return name.replace(/\.pdf$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Metadata of a PDF.
 * @typedef {object} PdfMetadaten
 * @property {string} titel document title (required; an empty title falls back to "BIT-Atelier", except in
 *   pdfLibMetadaten's `nurErgaenzen` mode, where it writes no title)
 * @property {string} [sprache] BCP 47 tag; default PDF_SPRACHE_STANDARD
 * @property {string} [autor] author, only where the generator knows it
 * @property {string} [betreff] subject, e.g. the project name
 * @property {string} [stichwoerter] keywords (jsPDF: one string)
 */

/**
 * A BCP 47 tag in its canonical letter case (RFC 5646 2.1.1): language lower case, script title case, region upper
 * case; "_" is read as "-". Something that is not a language tag gives "".
 * @param {string|null|undefined} tag e.g. "DE_de", "zh-hant-tw", " en "
 * @returns {string} e.g. "de-DE", "zh-Hant-TW", "en"; "" for an empty or invalid tag
 */
export function pdfSpracheNormalisieren(tag) {
  const teile = String(tag || "").trim().split(/[-_]+/).filter(Boolean);
  if (!teile.length || !/^[a-z]{2,8}$/i.test(teile[0])) return "";
  return teile.map((t, i) => {
    if (i === 0) return t.toLowerCase();
    if (/^[a-z]{4}$/i.test(t)) return t[0].toUpperCase() + t.slice(1).toLowerCase();
    if (/^([a-z]{2}|\d{3})$/i.test(t)) return t.toUpperCase();
    return t.toLowerCase();
  }).join("-");
}

/**
 * Tags to offer jsPDF's setLanguage for a language, most exact first. jsPDF knows a fixed, case-sensitive list
 * ("de-DE", "de", "en-GB" …) and silently ignores any other code, so a source's "de-de", "de-Latn-DE" or "gsw-CH"
 * would end up without /Lang: try the canonical tag, then language-region without script, then the language alone.
 * @param {string|null|undefined} tag BCP 47 tag
 * @returns {string[]} e.g. ["de-Latn-DE", "de-DE", "de"]; [] for an invalid tag
 */
export function jsPdfSprachKandidaten(tag) {
  const kanonisch = pdfSpracheNormalisieren(tag);
  if (!kanonisch) return [];
  const teile = kanonisch.split("-");
  const region = teile.slice(1).find((t) => /^([A-Z]{2}|\d{3})$/.test(t));
  return [...new Set([kanonisch, region ? `${teile[0]}-${region}` : "", teile[0]].filter(Boolean))];
}

/**
 * Sets /Lang on a jsPDF document: the first candidate jsPDF accepts (jsPdfSprachKandidaten); a language jsPDF does not
 * know at all counts as missing and gets the UI language (pdfSpracheAusUi) [ASSUMED: same rule as a source without
 * /Lang], then German. Whether jsPDF took a code is read from `internal.languageSettings.languageCode`; a jsPDF build
 * without that field is trusted with the first candidate.
 * @param {any} pdf jsPDF instance
 * @param {string|null|undefined} sprache BCP 47 tag
 * @returns {string} the tag written as /Lang
 */
function jsPdfSpracheSetzen(pdf, sprache) {
  const kandidaten = [...jsPdfSprachKandidaten(sprache), ...jsPdfSprachKandidaten(pdfSpracheAusUi()), PDF_SPRACHE_STANDARD];
  for (const k of kandidaten) {
    pdf.setLanguage(k);
    const einstellung = pdf.internal?.languageSettings;
    if (!einstellung || einstellung.languageCode === k) return k;
  }
  return "";
}

/**
 * Sets /Lang, /Title (shown in the viewer's title bar), subject, author, keywords and creator on a jsPDF
 * document. jsPDF's setDocumentProperties only sets truthy values, so missing fields keep what is there.
 * The language is normalised to a code jsPDF accepts (jsPdfSprachKandidaten).
 * @param {any} pdf jsPDF instance
 * @param {PdfMetadaten} meta
 * @returns {any} the same jsPDF instance
 */
export function jsPdfMetadaten(pdf, meta) {
  const titel = String(meta?.titel || "").trim() || PDF_ERSTELLER;
  jsPdfSpracheSetzen(pdf, meta?.sprache || PDF_SPRACHE_STANDARD);
  pdf.setDocumentProperties({
    title: titel,
    subject: meta?.betreff || "",
    author: meta?.autor || "",
    keywords: meta?.stichwoerter || "",
    creator: PDF_ERSTELLER,
  });
  if (typeof pdf.viewerPreferences === "function") pdf.viewerPreferences({ DisplayDocTitle: true });
  return pdf;
}

/**
 * The /Lang of a pdf-lib document, or "" when it has none. Reads the catalog without importing pdf-lib.
 * @param {any} doc pdf-lib PDFDocument
 * @returns {string}
 */
export function pdfLibSprache(doc) {
  try {
    for (const [schluessel, wert] of doc.catalog.entries()) {
      if (String(schluessel) !== "/Lang") continue;
      const w = doc.context.lookup(wert);
      return typeof w?.decodeText === "function" ? String(w.decodeText()).trim() : "";
    }
  } catch {
    return "";
  }
  return "";
}

/**
 * Sets /Lang and /Title (shown in the title bar) and, when given, subject and author on a pdf-lib document.
 * `nurErgaenzen` (a user's own file being stamped, flattened or re-packed): only what the file does not have
 * yet is written — its own language, title, author and subject stay; a missing title is written only when `titel`
 * is given (never the app name).
 * @param {any} doc pdf-lib PDFDocument
 * @param {PdfMetadaten & {nurErgaenzen?: boolean}} meta
 * @returns {any} the same document
 */
export function pdfLibMetadaten(doc, meta) {
  const ergaenzen = !!meta?.nurErgaenzen;
  const titel = String(meta?.titel || "").trim();
  const sprache = pdfSpracheNormalisieren(meta?.sprache) || PDF_SPRACHE_STANDARD;
  if (!ergaenzen || !pdfLibSprache(doc)) doc.setLanguage(sprache);
  const alterTitel = String(doc.getTitle() || "").trim();
  // A user's own file never gets the app name as its title: without a given title it keeps what it has (also none,
  // or a title the user cleared on purpose). Only a document the app writes itself falls back to PDF_ERSTELLER.
  if (!ergaenzen) doc.setTitle(titel || PDF_ERSTELLER, { showInWindowTitleBar: true });
  else if (!alterTitel && titel) doc.setTitle(titel, { showInWindowTitleBar: true });
  if (meta?.betreff && (!ergaenzen || !doc.getSubject())) doc.setSubject(meta.betreff);
  if (meta?.autor && (!ergaenzen || !doc.getAuthor())) doc.setAuthor(meta.autor);
  if (meta?.stichwoerter && (!ergaenzen || !doc.getKeywords())) doc.setKeywords([meta.stichwoerter]);
  return doc;
}
