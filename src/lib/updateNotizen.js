// updateNotizen.js — turns the "what changed" part of a release note into display lines for the update
// banner (plan 92-04). The note is the CHANGELOG.md section of the release (Keep a Changelog, Markdown);
// the server already cut off the install instructions (aenderungenAusNotiz in server/selbstUpdate.js).
//
// Only the little Markdown a changelog uses is understood: "### Neu" headings, "- " bullets (continuation
// lines are joined), **bold**, `code` and [text](url) links reduced to their text. No HTML is produced —
// the banner renders plain text nodes, so a release note can never inject markup.
//
// In:  note text. Out: [{art: 'kopf'|'punkt'|'text', text}], plus the first lines for the collapsed banner.

/**
 * @typedef {{art: 'kopf'|'punkt'|'text', text: string}} NotizZeile
 */

/**
 * Strip the inline Markdown a changelog line may carry.
 * @param {string} s
 * @returns {string}
 */
function inline(s) {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display lines of a release note.
 * @param {string} text "what changed" part of the release note (Markdown)
 * @returns {NotizZeile[]}
 */
export function notizZeilen(text) {
  /** @type {NotizZeile[]} */
  const aus = [];
  let offen = /** @type {NotizZeile|null} */ (null);
  for (const roh of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const zeile = roh.trimEnd();
    if (!zeile.trim() || /^\s*<!--.*-->\s*$/.test(zeile) || /^\s*-{3,}\s*$/.test(zeile)) { offen = null; continue; }
    const kopf = /^\s*#{1,6}\s+(.*)$/.exec(zeile);
    const punkt = /^\s*[-*+]\s+(.*)$/.exec(zeile);
    if (kopf) { aus.push({ art: 'kopf', text: inline(kopf[1]) }); offen = null; } else if (punkt) {
      offen = { art: 'punkt', text: inline(punkt[1]) };
      aus.push(offen);
    } else if (offen) {
      offen.text = inline(`${offen.text} ${zeile}`);
    } else {
      offen = { art: 'text', text: inline(zeile) };
      aus.push(offen);
    }
  }
  return aus.filter((z) => z.text);
}

/**
 * The first content lines (bullets or text, headings skipped) for the collapsed banner.
 * @param {NotizZeile[]} zeilen output of notizZeilen
 * @param {number} [anzahl] number of lines (default 3)
 * @returns {NotizZeile[]}
 */
export function ersteZeilen(zeilen, anzahl = 3) {
  return zeilen.filter((z) => z.art !== 'kopf').slice(0, anzahl);
}
