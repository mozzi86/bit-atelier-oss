// Undo/redo for the building model in BitBimStudio.
//
// In:  a history object and the model snapshot from BEFORE a change.
// Out: a new history object (never mutated) and, on undo/redo, the snapshot to restore.
// A drag counts as one step: zieheStart marks the gesture, the first mutation
// inside it is stored, later mutations of the same gesture are not.
// Load, undo apply and the change-step writer pass still:true and record nothing.
// The stack itself is @core/lib/undoStack.js (same one as the massing studio).

import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";

/**
 * Empty history: no steps, no open drag.
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function leereHistorie() {
  return { stack: leererStack(), ziehe: false, gemerkt: false };
}

/**
 * Remember `vorher` (the state before this mutation) unless the call is silent
 * or it continues a drag whose first mutation was already stored.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} vorher snapshot before the change (JSON-serialisable)
 * @param {{ still?: boolean }} [opt] still: load, applying undo/redo, or a remote/change-step write
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function vorAenderung(h, vorher, { still = false } = {}) {
  if (still) return h;
  if (h.ziehe && h.gemerkt) return h;
  return { stack: merke(h.stack, vorher), ziehe: h.ziehe, gemerkt: h.ziehe };
}

/**
 * A grip drag begins. No snapshot yet — the first real mutation stores one step.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function zieheStart(h) {
  if (h.ziehe) return h;
  return { ...h, ziehe: true, gemerkt: false };
}

/**
 * The grip was released. The next mutation is a new step.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function zieheEnde(h) {
  if (!h.ziehe && !h.gemerkt) return h;
  return { ...h, ziehe: false, gemerkt: false };
}

/**
 * Grundriss-Bedienung part 2: a drag was cancelled (Esc) and the caller has written the state of the press back. The step this drag
 * stored is taken off again, so the next undo does not land on a state equal to the present one. Only removed when the newest
 * undo entry equals `vorher` (JSON), i.e. really is the snapshot of this drag; the redo branch the drag cleared stays cleared.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} vorher snapshot of the press (the state written back)
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} drag closed (ziehe false)
 */
export function zieheAbbrechen(h, vorher) {
  const past = h.stack.past;
  const letzter = past[past.length - 1];
  const weg = h.ziehe && h.gemerkt && letzter !== undefined && JSON.stringify(letzter) === JSON.stringify(vorher);
  return { stack: weg ? { past: past.slice(0, -1), future: h.stack.future } : h.stack, ziehe: false, gemerkt: false };
}

/**
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} aktuell state now (moves to the redo branch)
 * @returns {{ historie: {stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean}, snapshot: any }|null}
 */
export function schrittZurueck(h, aktuell) {
  const r = zurueck(h.stack, aktuell);
  if (!r) return null;
  return { historie: { stack: r.stack, ziehe: false, gemerkt: false }, snapshot: r.snapshot };
}

/**
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} aktuell state now (moves back to the undo branch)
 * @returns {{ historie: {stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean}, snapshot: any }|null}
 */
export function schrittVor(h, aktuell) {
  const r = vor(h.stack, aktuell);
  if (!r) return null;
  return { historie: { stack: r.stack, ziehe: false, gemerkt: false }, snapshot: r.snapshot };
}

/**
 * 108-08 (finding 12): values another device changed are not part of THIS studio's history. Every snapshot of the undo and the
 * redo branch takes them over, so undoing a local step (e.g. the entrance switch) no longer writes the storey count, basements or
 * storey table of the other device back to the state before it (before, "Rückgängig" restored the whole programme of the snapshot).
 * Only keys a snapshot already carries are replaced; the open drag flags stay.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {Record<string, any>} werte field → value as it is now (after the foreign change was taken over)
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} the same object when nothing changed
 */
export function historieUmbasieren(h, werte) {
  const felder = Object.keys(werte || {});
  if (!felder.length || (!h.stack.past.length && !h.stack.future.length)) return h;
  let geaendert = false;
  /** @param {any} s */
  const umbasieren = (s) => {
    if (!s || typeof s !== "object") return s;
    const treffer = felder.filter((k) => k in s && JSON.stringify(s[k]) !== JSON.stringify(werte[k]));
    if (!treffer.length) return s;
    geaendert = true;
    return { ...s, ...Object.fromEntries(treffer.map((k) => [k, werte[k]])) };
  };
  const past = h.stack.past.map(umbasieren);
  const future = h.stack.future.map(umbasieren);
  return geaendert ? { ...h, stack: { past, future } } : h;
}
