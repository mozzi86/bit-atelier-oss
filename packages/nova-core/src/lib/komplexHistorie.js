// Undo history of the site data of the designer page (plot, building envelopes, blocks, location) — 115-05d (C-2 … C-4).
//
// One history per page instead of one per editor: the page (ComplexDesigner) outlives its tabs, so the history outlives a tab
// switch, and every writer of the site group lands in the same order of steps — drawing on the plan, dragging on the map, the
// parcel import, "Neu schätzen", the massing page moving the plot.
//
// A step is the state BEFORE a change, with a running number and a label. The number is page-wide (naechsteNr), so several
// histories of one page (site data, building model, massing bodies) can be undone in ONE order: neuesterVerlauf picks the history
// whose next step is the newest.
//
// A gesture (pointer held down) is one step: the first change inside it stores the state of the press, the later ones nothing.
//
// In:  snapshots (JSON-serialisable values). Out: new history objects (never mutated) and the snapshot to restore.
// Pure, no React, no DOM. Lives in @core because the draft core must not import @designer.
import { UNDO_MAX } from "./undoStack.js";

/**
 * @typedef {{nr: number, label: string, werte: any}} Schritt
 * @typedef {{past: Schritt[], future: Schritt[], ziehe: boolean, gemerkt: boolean}} KomplexHistorie
 */

let zaehler = 0;
/** The next page-wide step number (strictly increasing). @returns {number} */
export function naechsteNr() { zaehler += 1; return zaehler; }

/** Empty history. @returns {KomplexHistorie} */
export function leereKomplexHistorie() {
  return { past: [], future: [], ziehe: false, gemerkt: false };
}

const gleich = (/** @type {any} */ a, /** @type {any} */ b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Remembers `vorher` (the state before a change) as one step and clears the redo branch. Inside a gesture only the first change
 * is stored. A state equal to the newest stored one is not stored twice.
 * @param {KomplexHistorie} h
 * @param {any} vorher state before the change
 * @param {{label?: string, nr?: number, max?: number}} [o] label shown after an undo; nr default: the next page-wide number
 * @returns {KomplexHistorie}
 */
export function aufzeichnen(h, vorher, { label = "", nr = undefined, max = UNDO_MAX } = {}) {
  if (h.ziehe && h.gemerkt) return h;
  const letzter = h.past[h.past.length - 1];
  if (letzter && gleich(letzter.werte, vorher)) return { ...h, future: [], gemerkt: h.ziehe };
  const past = [...h.past, { nr: nr ?? naechsteNr(), label, werte: vorher }];
  while (past.length > max) past.shift();
  return { past, future: [], ziehe: h.ziehe, gemerkt: h.ziehe };
}

/** A gesture begins (pointer down). @param {KomplexHistorie} h @returns {KomplexHistorie} */
export function gesteStart(h) {
  return h.ziehe ? h : { ...h, ziehe: true, gemerkt: false };
}

/** The gesture is over (pointer up). @param {KomplexHistorie} h @returns {KomplexHistorie} */
export function gesteEnde(h) {
  return !h.ziehe && !h.gemerkt ? h : { ...h, ziehe: false, gemerkt: false };
}

/**
 * The gesture was cancelled (Esc) and the editor wrote the state of the press back: the step this gesture stored is taken off
 * again — only when the newest step really equals the state now. The gesture stays open until the pointer is released.
 * @param {KomplexHistorie} h
 * @param {any} aktuell the state now (after the editor restored it)
 * @returns {KomplexHistorie}
 */
export function gesteAbbrechen(h, aktuell) {
  const letzter = h.past[h.past.length - 1];
  if (!(h.ziehe && h.gemerkt && letzter && gleich(letzter.werte, aktuell))) return h;
  return { ...h, past: h.past.slice(0, -1), gemerkt: false };
}

/**
 * Undo: the newest step's state, the state now goes to redo under the same number and label.
 * @param {KomplexHistorie} h
 * @param {any} aktuell the state now
 * @returns {{historie: KomplexHistorie, werte: any, label: string, nr: number}|null} null when there is nothing to undo
 */
export function schrittZurueck(h, aktuell) {
  const s = h.past[h.past.length - 1];
  if (!s) return null;
  return { historie: { past: h.past.slice(0, -1), future: [...h.future, { nr: s.nr, label: s.label, werte: aktuell }], ziehe: false, gemerkt: false },
    werte: s.werte, label: s.label, nr: s.nr };
}

/**
 * Redo: the mirror of schrittZurueck.
 * @param {KomplexHistorie} h
 * @param {any} aktuell the state now
 * @returns {{historie: KomplexHistorie, werte: any, label: string, nr: number}|null} null when there is nothing to redo
 */
export function schrittVor(h, aktuell) {
  const s = h.future[h.future.length - 1];
  if (!s) return null;
  return { historie: { past: [...h.past, { nr: s.nr, label: s.label, werte: aktuell }], future: h.future.slice(0, -1), ziehe: false, gemerkt: false },
    werte: s.werte, label: s.label, nr: s.nr };
}

/**
 * One order for several histories of a page: which one holds the step Strg+Z (or Strg+Y) means now. Undo takes the history whose
 * newest step has the highest number; redo the one whose next redo step has the lowest (steps come back in the order they were made).
 * @template T
 * @param {Array<{name: T, zurueckNr?: number|null, vorNr?: number|null}>} verlaeufe per history: number of its newest undo step and
 *   of its next redo step (null / absent = it has none)
 * @param {"zurueck"|"vor"} [richtung]
 * @returns {T|null} the name of the history to use, null when none has a step
 */
export function neuesterVerlauf(verlaeufe, richtung = "zurueck") {
  /** @type {{name: T, nr: number}|null} */
  let wahl = null;
  for (const v of Array.isArray(verlaeufe) ? verlaeufe : []) {
    const nr = richtung === "vor" ? v.vorNr : v.zurueckNr;
    if (nr == null || !Number.isFinite(nr)) continue;
    if (!wahl || (richtung === "vor" ? nr < wahl.nr : nr > wahl.nr)) wahl = { name: v.name, nr };
  }
  return wahl ? wahl.name : null;
}

/** Numbers of the newest undo step and the next redo step of a history, for neuesterVerlauf. @param {KomplexHistorie} h */
export function verlaufNummern(h) {
  return { zurueckNr: h.past.length ? h.past[h.past.length - 1].nr : null, vorNr: h.future.length ? h.future[h.future.length - 1].nr : null };
}
