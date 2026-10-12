// Project archive (phase 81-06, BUERO-03, D-P81-30): a project with time
// bookings, fee offers, contracts or invoices is archived instead of deleted
// (records with retention duties must not lose their project). Archived =
// the additive field Project.archiviert_am ('YYYY-MM-DD').
//
// In @core because ProjectContext.jsx (package nova-core) filters the project
// list with it and may only import @core (package boundary); the app re-exports
// istArchiviert from src/lib/projektLoeschschutz.js.
//
// In:  project records. Out: istArchiviert, sichtbareProjekte.

/**
 * Whether a project is archived.
 * @param {{archiviert_am?: string|null}|null|undefined} project
 * @returns {boolean}
 */
export function istArchiviert(project) {
  return Boolean(project?.archiviert_am);
}

/**
 * The project list for pickers (top bar, command palette, time sheet): without
 * archived projects, except the one with id === aktiveId — an archived project
 * that is currently open stays selectable until the user switches away.
 * @template {{id?: string, archiviert_am?: string|null}} P
 * @param {ReadonlyArray<P>|null|undefined} projekte all projects
 * @param {string|null|undefined} aktiveId id of the active project
 * @returns {P[]} same order
 */
export function sichtbareProjekte(projekte, aktiveId) {
  return (Array.isArray(projekte) ? projekte : []).filter((p) => !istArchiviert(p) || (aktiveId && p?.id === aktiveId));
}
