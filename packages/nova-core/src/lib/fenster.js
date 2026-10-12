// fenster.js — window arithmetic for long lists (72-21, register no. 134).
//
// Why: the check suite and the AVA table drew every row; a model with a few thousand
// findings or a bill of quantities with 1 500 positions put the same number of table
// rows into the DOM. A "window" draws only the rows inside the visible scroll area plus
// an overhang, and keeps the scroll height honest with two spacer heights.
//
// In:  scroll position and viewport height of the scroll container (px), number of
//      rows, the (measured) row height (px), the overhang (rows).
// Out: fensterBereich() → {start, ende, vorher, nachher} — `start` inclusive, `ende`
//      exclusive; `vorher`/`nachher` are the spacer heights in px above/below.
//
// Pure, no DOM, no React — the hook useFenster (@core/hooks) wraps it.

/** Default overhang: rows drawn above and below the visible part (rows). */
export const FENSTER_UEBERHANG = 8;

/** Default threshold: lists up to this many rows are drawn in full (rows). */
export const FENSTER_AB = 60;

/** Fallback row height until the first measurement (px). */
export const FENSTER_ZEILENHOEHE = 32;

/**
 * Rows to draw for a scroll position.
 *
 * The window is clamped at the end of the list: when a filter shrinks the list while
 * the container is scrolled far down, the browser may not report the new (smaller)
 * scroll position before the next render — the clamp keeps the last rows visible
 * instead of drawing an empty window.
 *
 * @param {{scrollTop?: number, hoehe?: number, anzahl: number, zeilenHoehe?: number, ueberhang?: number}} p
 *   scrollTop   — scroll offset of the container (px, ≥ 0);
 *   hoehe       — visible height of the container (px);
 *   anzahl      — number of rows in the list;
 *   zeilenHoehe — height of one row (px, > 0; measured mean);
 *   ueberhang   — extra rows above and below the visible part.
 * @returns {{start: number, ende: number, vorher: number, nachher: number}}
 *   start/ende — row indices (ende exclusive); vorher/nachher — spacer heights (px).
 */
export function fensterBereich({ scrollTop = 0, hoehe = 0, anzahl, zeilenHoehe = FENSTER_ZEILENHOEHE, ueberhang = FENSTER_UEBERHANG }) {
  const n = Math.max(0, Math.floor(Number(anzahl) || 0));
  if (n === 0) return { start: 0, ende: 0, vorher: 0, nachher: 0 };
  const h = Number.isFinite(zeilenHoehe) && zeilenHoehe > 0 ? zeilenHoehe : FENSTER_ZEILENHOEHE;
  const ue = Math.max(0, Math.floor(Number(ueberhang) || 0));
  const sichtbar = Math.max(1, Math.ceil((Math.max(0, Number(hoehe) || 0)) / h));
  const oben = Math.max(0, Number(scrollTop) || 0);
  // First visible row, clamped so that a full screen of rows stays drawn at the end.
  const erste = Math.min(Math.floor(oben / h), Math.max(0, n - sichtbar));
  const start = Math.max(0, erste - ue);
  const ende = Math.min(n, erste + sichtbar + ue);
  return { start, ende, vorher: start * h, nachher: (n - ende) * h };
}

/**
 * Case-insensitive "contains every word" test — the data filter of the windowed lists.
 * Words are separated by blanks; an empty query matches everything. German umlauts are
 * compared as typed (no folding): "Wand" finds "Außenwand", "aussen" does not find
 * "Außen" — [ASSUMED] good enough for GlobalIds, OZ and type names, which carry no umlauts.
 *
 * @param {string} anfrage the text typed into the filter field
 * @param {Array<unknown>} felder values of one row to search in (null/undefined skipped)
 * @returns {boolean} true when every word of `anfrage` occurs in one of the fields
 */
export function passtFilter(anfrage, felder) {
  const woerter = String(anfrage || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return true;
  const text = (Array.isArray(felder) ? felder : [])
    .filter((f) => f !== null && f !== undefined)
    .map((f) => String(f).toLowerCase())
    .join(" \u0000 ");
  return woerter.every((w) => text.includes(w));
}
