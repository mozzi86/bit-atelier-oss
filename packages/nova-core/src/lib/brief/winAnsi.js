// WinAnsi/CP1252 encoder of the shared letter core (phase 79-03, D-P79-27):
// jsPDF's standard 14 fonts (Helvetica etc.) render Unicode text through their
// own internal WinAnsi glyph table — this file does NOT feed jsPDF pre-encoded
// bytes (that would re-encode an already-CP1252 byte value through the same
// table a second time and corrupt it). Its job is upstream of drawing: decide
// whether a character survives the trip at all, and provide the real byte
// encoder for consumers that write CP1252 bytes directly (79-11's DATEV
// export — a fixed-column text file, not a PDF).
//
// Neither Node nor the browser exposes a "windows-1252" TextEncoder/-Decoder
// (same gap gaeb90.js documents for CP437), so the high range is a hand-built
// table here.
//
// In:  JS strings (Unicode code points). Out: {text, ersetzt} / {bytes,
//      ersetzt} — every character outside WinAnsi becomes "?", counted in
//      `ersetzt` so a caller can warn instead of silently mangling a letter.

/**
 * CP1252 byte (0x80–0x9F) → Unicode code point; five bytes in this range are
 * undefined in CP1252 and left out. Typed as a plain number map (not the
 * literal-union tsc would otherwise infer from the object literal) so the
 * reverse lookup below can be queried with any code point.
 * @type {Record<number, number>}
 */
const CP1252_HOCH = Object.freeze({
  0x80: 0x20ac, // €
  0x82: 0x201a, // ‚
  0x83: 0x0192, // ƒ
  0x84: 0x201e, // „  (German opening double quote)
  0x85: 0x2026, // …
  0x86: 0x2020, // †
  0x87: 0x2021, // ‡
  0x88: 0x02c6, // ˆ
  0x89: 0x2030, // ‰
  0x8a: 0x0160, // Š
  0x8b: 0x2039, // ‹
  0x8c: 0x0152, // Œ
  0x8e: 0x017d, // Ž
  0x91: 0x2018, // '
  0x92: 0x2019, // '
  0x93: 0x201c, // "  (German closing double quote)
  0x94: 0x201d, // "
  0x95: 0x2022, // •
  0x96: 0x2013, // – (en dash)
  0x97: 0x2014, // — (em dash)
  0x98: 0x02dc, // ˜
  0x99: 0x2122, // ™
  0x9a: 0x0161, // š
  0x9b: 0x203a, // ›
  0x9c: 0x0153, // œ
  0x9e: 0x017e, // ž
  0x9f: 0x0178, // Ÿ
});

/** Reverse of CP1252_HOCH: Unicode code point → CP1252 byte, built once. */
const CODEPUNKT_ZU_BYTE = new Map(
  Object.entries(CP1252_HOCH).map(([byte, codepunkt]) => [codepunkt, Number(byte)]),
);

/**
 * True when a single character is representable in WinAnsi/CP1252: printable
 * ASCII (0x20–0x7E), the CP1252 high symbols above, or Latin-1 0xA0–0xFF
 * (identical code point and byte in that range — includes äöüß and €'s
 * neighbours, but € itself lives at 0x80, not in Latin-1).
 * @param {string} zeichen exactly one character (one code point)
 * @returns {boolean}
 */
export function istWinAnsi(zeichen) {
  const cp = zeichen.codePointAt(0) ?? -1;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return CODEPUNKT_ZU_BYTE.has(cp);
}

/**
 * Replaces every character outside WinAnsi with "?" (iterates by code point,
 * so a surrogate pair is one replacement, not two).
 * @param {string} text
 * @returns {{text: string, ersetzt: number}}
 */
export function ersetzeNichtWinAnsi(text) {
  let ersetzt = 0;
  const zeichen = Array.from(String(text ?? "")).map((z) => {
    if (istWinAnsi(z)) return z;
    ersetzt += 1;
    return "?";
  });
  return { text: zeichen.join(""), ersetzt };
}

/**
 * Text → CP1252 bytes. For a PDF written with a jsPDF standard font, do NOT
 * feed these bytes to `pdf.text()` — jsPDF re-encodes a normal JS string to
 * WinAnsi itself; this encoder is for a real byte stream (79-11's DATEV
 * export, a fixed-width text file with no font in between).
 * @param {string} text
 * @returns {{bytes: Uint8Array, ersetzt: number}}
 */
export function kodiereCp1252(text) {
  const zeichen = Array.from(String(text ?? ""));
  const bytes = new Uint8Array(zeichen.length);
  let ersetzt = 0;
  zeichen.forEach((z, i) => {
    const cp = z.codePointAt(0) ?? -1;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) { bytes[i] = cp; return; }
    const hoch = CODEPUNKT_ZU_BYTE.get(cp);
    if (hoch !== undefined) { bytes[i] = hoch; return; }
    bytes[i] = 0x3f; // "?"
    ersetzt += 1;
  });
  return { bytes, ersetzt };
}
