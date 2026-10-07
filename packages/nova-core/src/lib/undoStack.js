// Undo/redo stack for editor state (quick task 260921, MSB-11 / UNDO-01).
//
// Pure and framework-free so every editor (Massing, BimPlan2D, Lageplan, Netz)
// can adopt the same behaviour: Ctrl+Z / Ctrl+Y over immutable snapshots.
// Snapshots are compared by JSON to avoid duplicate entries.
//
// In:  snapshots (any JSON-serialisable value).
// Out: new stack objects (never mutated) + the snapshot to restore.

/** Maximum remembered steps [ASSUMED] - enough for a drawing session, bounded memory. */
export const UNDO_MAX = 50;

/**
 * Creates an empty stack.
 * @returns {{past: any[], future: any[]}}
 */
export function leererStack() {
  return { past: [], future: [] };
}

/**
 * Remembers the state BEFORE a change. Clears the redo branch.
 * @param {{past: any[], future: any[]}} stack
 * @param {any} snapshot state before the change
 * @param {number} [max] maximum entries (default UNDO_MAX)
 * @returns {{past: any[], future: any[]}}
 */
export function merke(stack, snapshot, max = UNDO_MAX) {
  const last = stack.past[stack.past.length - 1];
  if (last !== undefined && JSON.stringify(last) === JSON.stringify(snapshot)) return { past: stack.past, future: [] };
  const past = [...stack.past, snapshot];
  while (past.length > max) past.shift();
  return { past, future: [] };
}

/**
 * Undo: returns the previous snapshot and moves the current one to redo.
 * @param {{past: any[], future: any[]}} stack
 * @param {any} aktuell current state (goes to redo)
 * @returns {{stack: {past: any[], future: any[]}, snapshot: any}|null} null when nothing to undo
 */
export function zurueck(stack, aktuell) {
  if (!stack.past.length) return null;
  const past = stack.past.slice(0, -1);
  const snapshot = stack.past[stack.past.length - 1];
  return { stack: { past, future: [...stack.future, aktuell] }, snapshot };
}

/**
 * Redo: returns the next snapshot and moves the current one back to undo.
 * @param {{past: any[], future: any[]}} stack
 * @param {any} aktuell current state (goes to undo)
 * @returns {{stack: {past: any[], future: any[]}, snapshot: any}|null} null when nothing to redo
 */
export function vor(stack, aktuell) {
  if (!stack.future.length) return null;
  const future = stack.future.slice(0, -1);
  const snapshot = stack.future[stack.future.length - 1];
  return { stack: { past: [...stack.past, aktuell], future }, snapshot };
}
