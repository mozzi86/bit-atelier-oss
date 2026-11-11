// The "3D-Fenster" bar of a 3D viewer — the logic only (quick task 261110-mzl).
//
// A viewer describes its bar as a list of entries (walk through, fit, picture, style …). This module decides which of
// them are shown and what the tooltip says; DreiDLeiste.jsx draws them. The entries carry no viewer code besides their
// own click action, so the same bar serves the BIM studio and the IFC viewer.
//
// In:  entries as plain objects. Out: the entries to show, tooltip texts. No DOM, no React.

/**
 * One button of the bar.
 * @typedef {object} LeistenEintrag
 * @property {string} id            stable id (also the React key)
 * @property {string} text          German label = i18n key; tooltip and accessible name
 * @property {any} symbol           icon component (e.g. from lucide-react), rendered with a className
 * @property {() => void} onClick   what the button does
 * @property {boolean} [aktiv]      a switch that is on (aria-pressed); leave undefined for a plain action
 * @property {boolean} [gesperrt]   shown but not usable right now (e.g. no model, nothing selected)
 * @property {boolean} [sichtbar]   false = not shown at all (default true)
 * @property {string} [taste]       key shown behind the label in the tooltip, e.g. "F3"
 * @property {string} [testid]      data-testid of the button
 */

/**
 * The entries a bar shows, in the given order: nothing empty, nothing with sichtbar === false, every id once (the
 * first one wins — two buttons with the same id would be the same command twice).
 * @param {Array<LeistenEintrag|null|undefined|false>} liste
 * @returns {LeistenEintrag[]}
 */
export function leistenEintraege(liste) {
  const gesehen = new Set();
  const out = [];
  for (const e of liste || []) {
    if (!e || e.sichtbar === false || !e.id || gesehen.has(e.id)) continue;
    gesehen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * Tooltip of an entry: the translated label, and the key behind it when there is one.
 * @param {LeistenEintrag} e
 * @param {(s: string) => string} [t] translator (German key → shown text)
 * @returns {string}
 */
export function leistenTitel(e, t = (s) => s) {
  return e.taste ? `${t(e.text)} · ${e.taste}` : t(e.text);
}
