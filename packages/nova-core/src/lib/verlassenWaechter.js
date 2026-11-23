// 115-05c (§6.6, D-115-12 "Verlassen fragt nach"): the registry a project switch (ProjectContext) and an in-app link ask
// before the page with unsaved model changes is left. In the entry chunk (ProjectContext imports it), therefore without any
// logic of its own: the draft (entwurfStand.js, loaded lazily) registers a guard while it holds unsaved work; the guard either
// takes the leaving over - shows its dialog and calls `weiter` after the person decided - or lets it pass.
//
// In:  a guard function. Out: verlassenWaechterSetzen, verlassenPruefen.

/** @typedef {(weiter: () => void, ziel: {art: string, ziel?: any}) => boolean} VerlassenWaechter */

/** @type {Set<VerlassenWaechter>} */
const waechter = new Set();

/**
 * Registers a guard. It returns true when it takes the leaving over (it calls `weiter` later itself), else false.
 * @param {VerlassenWaechter} fn @returns {() => void} unregister
 */
export function verlassenWaechterSetzen(fn) {
  waechter.add(fn);
  return () => { waechter.delete(fn); };
}

/**
 * Asks the guards before leaving. A guard that throws never traps the person: its error is logged and the leaving goes on.
 * @param {() => void} weiter what the leaving does (called by the guard after the decision)
 * @param {{art: string, ziel?: any}} ziel what is left for what ("projekt", "link")
 * @returns {boolean} true = a guard took it over (the caller does nothing now); false = go on at once
 */
export function verlassenPruefen(weiter, ziel) {
  for (const fn of waechter) {
    try { if (fn(weiter, ziel)) return true; } catch (err) { console.error(`[verlassen] guard failed: ${/** @type {any} */ (err)?.message || err}`); }
  }
  return false;
}
