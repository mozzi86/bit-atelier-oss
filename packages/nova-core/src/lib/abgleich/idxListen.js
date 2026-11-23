// 115-05a (A-1, D-115-50): the element lists of the BIM studio that share ONE `_idx` counter. Before, the counter of the
// studio ran over ten lists while the renumbering of the sync (modellAbgleich.js) and the takeover of the massing modeller
// looked at seven - stairs, dormers and plan notes were neither merged live nor counted. Every reader of "which lists carry
// an `_idx`" takes it from here.
//
// Small and without dependencies on purpose: modellAbgleich.js (on the start path through useBimModelSync) and the change
// tools (zeigen/aenderungen.js) both import it.
//
// In:  a model object with element lists. Out: IDX_LISTEN, naechsteFreieIdx().

/**
 * The eleven element lists whose elements carry a number `_idx` of the studio's one counter (field names of the stored
 * BimModel record, never renamed). Order: the seven lists of 106-09, then stairs (108-06), dormers (108-13), plan notes
 * (261111-zs1), canopies (W-1118-29).
 * @type {ReadonlyArray<string>}
 */
export const IDX_LISTEN = Object.freeze([
  "customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs", "gauben", "planNotizen", "vordaecher",
]);

/**
 * Next free `_idx` over all element lists of a model (what the studio's counter idRef hands out next). Elements without a
 * finite number are skipped. Moved here unchanged from zeigen/aenderungen.js (which re-exports it).
 * @param {any} modell object with element lists (missing lists count as empty)
 * @returns {number} highest `_idx` + 1, at least 1
 */
export function naechsteFreieIdx(modell) {
  let max = 0;
  for (const k of IDX_LISTEN) {
    for (const el of Array.isArray(modell?.[k]) ? modell[k] : []) if (Number.isFinite(el?._idx) && el._idx > max) max = el._idx;
  }
  return max + 1;
}
