// prueflaufLink.js — shareable check-run state in a URL (Phase 69-06).
//
// Why: "look at this finding" currently has to be described in words. With a
// link it is a click — serverless, without an account (PROD-11). Same pattern
// as viewerLink.js (65-05): the IFC GlobalId is the anchor (stable across
// model versions, unlike the expressId which changes on every export);
// fixed parameter order so two identical states yield the same string;
// broken values yield null instead of a half-read state.
//
// In:  { quelle, regelsatz, filter, sel, sort } — the visible run state.
// Out: a query string for the hash router (#/ModelCheck?…), and back again.
//
// What a link deliberately does NOT carry: the model itself. A file-based run
// cannot be restored from a link — the receiver is told so instead of seeing
// an empty list (plan must-have 2).
//
// Everything here is pure — no DOM — so it is testable under Node.

/** Allowed values for `quelle` (q). Anything else is a broken link → null. */
export const QUELLEN = ['beispiel', 'datei'];

/**
 * Serialises the check-run state. Parameter order is FIXED (q, r, f, s, o) so
 * the same state always yields the same string — otherwise two identical links
 * would not compare equal.
 * @param {{
 *   quelle?: string|null,      // 'beispiel' | 'datei'
 *   regelsatz?: string|null,   // rule-set / IDS file name
 *   filter?: string[]|null,    // open group keys, sorted alphabetically here
 *   sel?: string|null,         // GlobalId of the selected finding (anchor)
 *   sort?: string|null         // sort order identifier
 * }} [zustand]
 * @returns {string|null} query string WITHOUT the leading "?"; empty state →
 *   ""; null when a value is unusable (unknown source) — a half-built link
 *   would load the wrong model (viewerLink pattern: broken → null)
 */
export function serialisierePruefzustand(zustand = {}) {
  const teile = [];

  // q: only a known source travels — an unknown one would load a wrong model.
  if (zustand.quelle != null && zustand.quelle !== '') {
    if (!QUELLEN.includes(String(zustand.quelle))) return null;
    teile.push(['q', String(zustand.quelle)]);
  }

  if (typeof zustand.regelsatz === 'string' && zustand.regelsatz) {
    teile.push(['r', zustand.regelsatz]);
  }

  // f: sorted alphabetically — the link must not depend on the insertion
  // order of a Set/object (viewerLink pattern).
  if (Array.isArray(zustand.filter) && zustand.filter.length) {
    const namen = zustand.filter
      .filter((x) => typeof x === 'string' && x)
      .sort();
    if (namen.length) teile.push(['f', namen.join(',')]);
  }

  // s: the GlobalId travels UNCHANGED — IFC GlobalIds are base64-ish and may
  // contain $ and _; URLSearchParams percent-encodes on toString and decodes
  // symmetrically, so no manual escaping (and none lost).
  if (typeof zustand.sel === 'string' && zustand.sel) teile.push(['s', zustand.sel]);

  if (typeof zustand.sort === 'string' && zustand.sort) teile.push(['o', zustand.sort]);

  const p = new URLSearchParams();
  for (const [k, v] of teile) p.set(k, v);
  return p.toString();
}

/**
 * Reads a check-run state back. Returns null when nothing usable is in there
 * — a half-read state would show a wrong model or a wrong finding.
 * Backward compatible: the legacy `?beispiel=1` deep link (65-04) is also
 * accepted and mapped to { quelle: 'beispiel' } (plan Task 1).
 * @param {string|URLSearchParams} suche query string (with or without "?")
 * @returns {{quelle?: string, regelsatz?: string, filter?: string[], sel?: string, sort?: string}|null}
 */
export function parsePruefzustand(suche) {
  if (!suche) return null;
  let p;
  try {
    p = suche instanceof URLSearchParams ? suche : new URLSearchParams(String(suche).replace(/^\?/, ''));
  } catch {
    return null;
  }

  /** @type {any} */
  const raus = {};

  const q = p.get('q');
  if (q) {
    if (!QUELLEN.includes(q)) return null; // unknown source → nothing usable
    raus.quelle = q;
  } else if (p.get('beispiel') === '1') {
    // Legacy deep link from the website screenshot (65-04) — stays readable.
    raus.quelle = 'beispiel';
  }

  const r = p.get('r');
  if (r) raus.regelsatz = r;

  const f = p.get('f');
  if (f) {
    const namen = f.split(',').filter(Boolean);
    if (namen.length) raus.filter = namen;
    else return null; // broken filter (empty segments only) → null
  }

  const s = p.get('s');
  if (s) raus.sel = s;

  const o = p.get('o');
  if (o) raus.sort = o;

  return Object.keys(raus).length ? raus : null;
}

/**
 * The full link to a check-run state, for the "share" button.
 * @param {string} basis e.g. location.origin + location.pathname
 * @param {{quelle?: string, regelsatz?: string, filter?: string[], sel?: string, sort?: string}} zustand
 * @returns {string|null} URL on #/ModelCheck; null when the state is unusable
 */
export function prueflaufLink(basis, zustand) {
  const q = serialisierePruefzustand(zustand);
  if (q === null) return null;
  return `${String(basis).replace(/[#?].*$/, '')}#/ModelCheck${q ? `?${q}` : ''}`;
}
