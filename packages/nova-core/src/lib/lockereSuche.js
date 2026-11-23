// Forgiving search — THE one matcher for every search field of the app (plan 111-13, S-18).
//
// Why a module of its own and not textMatch.js: textMatch.js is the similarity of the price/STLB pipeline and must stay
// bit-identical to Python's difflib (including its known "ß" loss). A search field has a different job: a person types a
// few letters, maybe with "ae" for "ä", a swapped letter or the words in another order, and expects the record anyway.
// Mixing both into one normalisation would break the frozen pipeline numbers, so the two stay apart on purpose.
//
// Rules (each query word must match somewhere in the text; the words may come in any order):
//   1. folding: lowercase, ä/ö/ü → ae/oe/ue, ß → ss, other accents stripped, every non-letter/digit is a separator —
//      so "Straße" = "Strasse", "Prüf-Suite" = "pruef suite"; typed "Wände" and "Waende" are the same query
//   2. a word of the text equals the query word                            → score 1.0
//   3. a word of the text starts with the query word                       → 0.9
//   4. the text without separators contains the query word ("pruefsuite")  → 0.75
//   5. one small typo (swap, missing, extra or wrong letter) against a word or a word start, query word ≥ 4 letters
//                                                                          → 0.5
//   6. the query letters appear in order inside one word, same first letter, within a span of at most 2·n+1 letters
//      (abbreviations like "kmplx" → "Komplex"), query word ≥ 3 letters      → 0.3
// The result is the mean over the query words, plus a small bonus when the whole folded text equals or starts with the
// whole folded query (so "Prüf-Suite" ranks above "Zur Prüf-Suite"). 0 = no match.
// [ASSUMED] the thresholds (typo tolerance only from 4 letters, exactly one edit; abbreviation span 2·n+1) — chosen so that
// two-letter words never match by accident; to be tuned from real use, not from a norm.
//
// Pure and isomorphic (no window, no React). In: a query and texts (raw strings or suchVorbereiten() results).
// Out: suchNormal, suchVorbereiten, lockerBewerten, lockerPasst, lockerFiltern.

/**
 * A text prepared once for many queries (the palette scores thousands of records per keystroke).
 * @typedef {{voll: string, woerter: string[], kompakt: string}} SuchText
 *   voll: folded text with single spaces; woerter: its words; kompakt: folded text without any separator
 */

/** Minimum query-word length for the one-typo rule (letters). [ASSUMED] see file head. */
export const TIPPFEHLER_AB = 4;

/** Minimum query-word length for the abbreviation rule (letters). [ASSUMED] see file head. */
export const FOLGE_AB = 3;

/**
 * Folds a text for searching: lowercase, ä/ö/ü → ae/oe/ue, ß → ss, accents stripped, separators → one space.
 * @param {unknown} s any value (null/undefined → "")
 * @returns {string} folded text, e.g. "Prüf-Suite" → "pruef suite"
 */
export function suchNormal(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Prepares a text once so that many queries can be scored against it cheaply.
 * @param {unknown} text raw text (several fields may be joined with spaces by the caller)
 * @returns {SuchText}
 */
export function suchVorbereiten(text) {
  const voll = suchNormal(text);
  const woerter = voll ? voll.split(' ') : [];
  return { voll, woerter, kompakt: woerter.join('') };
}

/**
 * Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps), aborted early above `grenze`.
 * @param {string} a
 * @param {string} b
 * @param {number} grenze largest distance of interest (edits)
 * @returns {number} the distance, or grenze + 1 when it is larger
 */
function abstand(a, b, grenze) {
  if (Math.abs(a.length - b.length) > grenze) return grenze + 1;
  let vorvor = /** @type {number[]} */ ([]);
  let vor = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const zeile = [i];
    let min = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(vor[j] + 1, zeile[j - 1] + 1, vor[j - 1] + kosten);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, vorvor[j - 2] + 1);
      zeile.push(d);
      if (d < min) min = d;
    }
    if (min > grenze) return grenze + 1;
    vorvor = vor;
    vor = zeile;
  }
  return vor[b.length];
}

/**
 * Do the letters of `q` appear in order inside `w`, starting at its first letter, within a span of 2·n+1?
 * @param {string} q folded query word
 * @param {string} w folded text word
 * @returns {boolean}
 */
function folgeIn(q, w) {
  if (w[0] !== q[0]) return false;
  let j = 0;
  for (let i = 0; i < q.length; i += 1) {
    while (j < w.length && w[j] !== q[i]) j += 1;
    if (j >= w.length) return false;
    j += 1;
  }
  return j <= 2 * q.length + 1;
}

/**
 * Score of one folded query word against a prepared text.
 * @param {string} q folded query word (no spaces)
 * @param {SuchText} t
 * @returns {number} 0 … 1
 */
function wortWert(q, t) {
  let bester = 0;
  for (const w of t.woerter) {
    if (w === q) return 1;
    if (w.startsWith(q)) bester = 0.9;
  }
  if (bester) return bester;
  if (t.kompakt.includes(q)) return 0.75;
  if (q.length >= TIPPFEHLER_AB) {
    for (const w of t.woerter) {
      if (w.length < q.length - 1) continue;
      // The whole word, or a word start of about the query's length (a typo in a half-typed word).
      for (const laenge of [w.length, q.length - 1, q.length, q.length + 1]) {
        if (laenge < q.length - 1 || laenge > w.length) continue;
        if (abstand(q, w.slice(0, laenge), 1) <= 1) return 0.5;
      }
    }
  }
  if (q.length >= FOLGE_AB) {
    for (const w of t.woerter) if (folgeIn(q, w)) return 0.3;
  }
  return 0;
}

/**
 * How well a query matches a text. Every query word must match (any order), else 0.
 * @param {string} anfrage raw query as typed
 * @param {string|SuchText} text raw text or suchVorbereiten() result
 * @returns {number} 0 (no match) … about 1.2 (exact); an empty query scores 1 (matches everything)
 */
export function lockerBewerten(anfrage, text) {
  const q = suchNormal(anfrage);
  if (!q) return 1;
  const t = typeof text === 'string' || text == null ? suchVorbereiten(text) : text;
  if (!t.voll) return 0;
  const woerter = q.split(' ');
  let summe = 0;
  for (const w of woerter) {
    const wert = wortWert(w, t);
    if (!wert) return 0;
    summe += wert;
  }
  let bonus = 0;
  if (t.voll === q) bonus = 0.2;
  else if (t.voll.startsWith(q)) bonus = 0.1;
  return summe / woerter.length + bonus;
}

/**
 * Does a query match a text at all?
 * @param {string} anfrage raw query
 * @param {string|SuchText} text raw text or suchVorbereiten() result
 * @returns {boolean} true for an empty query
 */
export function lockerPasst(anfrage, text) {
  return lockerBewerten(anfrage, text) > 0;
}

/**
 * Filters and ranks a list by a query: best score first, original order on equal scores.
 * An empty query returns the list unchanged (cut to `max`).
 * @template T
 * @param {ReadonlyArray<T>} liste
 * @param {string} anfrage raw query
 * @param {(eintrag: T) => string|SuchText} textVon searchable text of an entry (join several fields with spaces)
 * @param {{max?: number}} [optionen] max: largest number of entries returned (default: all)
 * @returns {T[]}
 */
export function lockerFiltern(liste, anfrage, textVon, optionen = {}) {
  const max = optionen.max ?? Infinity;
  if (!suchNormal(anfrage)) return (liste || []).slice(0, max);
  const bewertet = [];
  (liste || []).forEach((e, i) => {
    const wert = lockerBewerten(anfrage, textVon(e));
    if (wert > 0) bewertet.push({ e, i, wert });
  });
  bewertet.sort((a, b) => b.wert - a.wert || a.i - b.i);
  return bewertet.slice(0, max).map((x) => x.e);
}
