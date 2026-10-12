// zuletztProjekte.js — "recently opened projects" of this device (72-07): at most
// five project ids in localStorage, newest first. Shown only as far as the current
// role still sees the project (intersection with the visible list — 82-02's project
// view and 81-06's archive filter decide, not this list).
//
// In:  project ids, a Storage (injectable for tests). Out: ZULETZT_SCHLUESSEL,
//      ZULETZT_MAX, merke, lies, zuletztSichtbar. Side effect: merke writes localStorage.

/** localStorage key (registered in browserSpeicher.js). */
export const ZULETZT_SCHLUESSEL = "bit-atelier-zuletzt-projekte";
/** Length of the list (projects). */
export const ZULETZT_MAX = 5;

/** @returns {Storage|null} */
const standardSpeicher = () => (typeof localStorage === "undefined" ? null : localStorage);

/**
 * The stored ids, newest first (an unreadable value counts as empty).
 * @param {Storage|null} [speicher]
 * @returns {string[]}
 */
export function lies(speicher = standardSpeicher()) {
  try {
    const roh = JSON.parse(speicher?.getItem(ZULETZT_SCHLUESSEL) || "[]");
    return Array.isArray(roh) ? roh.filter((x) => typeof x === "string" && x).slice(0, ZULETZT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Puts a project at the top of the list. Side effect: writes localStorage (a full or
 * blocked storage is ignored — the list is a convenience).
 * @param {string|null|undefined} projectId
 * @param {Storage|null} [speicher]
 * @returns {string[]} the new list
 */
export function merke(projectId, speicher = standardSpeicher()) {
  const alt = lies(speicher);
  if (!projectId) return alt;
  const neu = [projectId, ...alt.filter((x) => x !== projectId)].slice(0, ZULETZT_MAX);
  try { speicher?.setItem(ZULETZT_SCHLUESSEL, JSON.stringify(neu)); } catch { /* storage full or blocked: keep working without the list */ }
  return neu;
}

/**
 * The recent projects the role still sees, in the order of the list.
 * @template {{id: string}} P
 * @param {ReadonlyArray<string>} ids
 * @param {ReadonlyArray<P>} sichtbar visible projects (useProject().projects)
 * @returns {P[]}
 */
export function zuletztSichtbar(ids, sichtbar) {
  const nachId = new Map((sichtbar || []).map((p) => [p.id, p]));
  return (ids || []).map((id) => nachId.get(id)).filter((p) => p !== undefined);
}
