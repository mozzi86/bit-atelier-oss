// Close guard for form dialogs (72-11, N-07): may a close request close the
// dialog right away, or must it first ask before typed input is lost?
//
// Why this exists: FormModal used to close on any click next to the dialog, so a
// slip of the mouse threw a half-filled form away without a word (KRITIK-02).
// The rule lives here, pure and testable under node --test; FormModal only wires
// the gestures to it and shows the inline question.
//
// In:  whether the dialog content changed since it opened, which gesture asked
//      to close ('esc' | 'aussen' | 'x'), whether the question is already on
//      screen, and whether the caller wants the guard at all.
// Out: 'schliessen' (close now) | 'nachfragen' (keep open, show the question)
//      | 'weiter' (hide the question, keep editing).
//
// Not routed through here: the explicit "Abbrechen" button of a form. The caller
// calls onClose directly and is never asked — choosing Cancel already is the
// decision to discard. No React, no browser APIs, no imports.

/**
 * Gestures that ask a dialog to close without an explicit decision:
 * Escape key, pointer down on the backdrop, the X in the dialog header.
 * @typedef {'esc' | 'aussen' | 'x'} SchliessAusloeser
 */

/**
 * Outcome of a close request.
 * @typedef {'schliessen' | 'nachfragen' | 'weiter'} SchliessEntscheidung
 */

/**
 * All gestures the guard knows, for iteration in tests and callers.
 * @type {readonly SchliessAusloeser[]}
 */
export const SCHLIESS_AUSLOESER = Object.freeze(/** @type {SchliessAusloeser[]} */ (['esc', 'aussen', 'x']));

/**
 * Decides what a close request does.
 *
 * - Guard off (`schuetzen === false`) or nothing changed → 'schliessen'.
 * - Something changed → 'nachfragen' for every gesture, also for an unknown one:
 *   losing input by accident is worse than one extra question.
 * - Question already on screen and Escape pressed → 'weiter': Escape cancels the
 *   innermost thing, and that is now the question, not the form. A second
 *   backdrop click or X click leaves the question standing ('nachfragen') — a
 *   double click must not discard what the first click asked about.
 *
 * @param {{ geaendert?: boolean, ausloeser: SchliessAusloeser | string,
 *   rueckfrageOffen?: boolean, schuetzen?: boolean }} anfrage
 *   geaendert: an input/change event fired inside the dialog since it opened;
 *   rueckfrageOffen: the "verwerfen?" question is currently shown;
 *   schuetzen: the caller's opt-out (default true).
 * @returns {SchliessEntscheidung}
 */
export function schliessAnfrage({ geaendert = false, ausloeser, rueckfrageOffen = false, schuetzen = true }) {
  if (schuetzen === false || !geaendert) return 'schliessen';
  if (rueckfrageOffen && ausloeser === 'esc') return 'weiter';
  return 'nachfragen';
}
