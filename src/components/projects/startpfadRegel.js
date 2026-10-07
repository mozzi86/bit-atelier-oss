// Visibility rule of the project start path (72-02 Task 5, extended in 72-09/N-04).
//
// Lives in its OWN .js file, not inside Startpfad.jsx: node --test cannot load
// .jsx, so a pure rule buried in a component is untestable (same lesson as
// abfrage.js in 57-02). Markup stays in the component, the decision stays here.
//
// In:  the active project, its BIM model and (optionally) counts of what else the
//      project already holds (tickets, bill-of-quantities positions).
// Out: a boolean. No side effects.

/**
 * Should the start path be shown for this project?
 *
 * True only while the project is genuinely empty: no drawn geometry (parcel,
 * building bodies or a designer footprint), no imported model and no tickets or
 * bill-of-quantities positions. Once any of these exists the user has a state
 * to return to, and beginner cards would be in the way.
 *
 * Why footprintM counts (72-09): the designer stores its building outline as
 * `footprintM` + `storeys` and never writes `site_parcel`/`buildings` — the demo
 * project proj-1 has exactly that shape. Without it the full sample project was
 * treated as empty. Three points is the smallest outline that encloses an area.
 * @param {{ id?: string }|null|undefined} project the active project
 * @param {{ site_parcel?: object, buildings?: unknown[], elements?: unknown[], footprintM?: unknown[] }|null|undefined} bimModel
 *   the project's BimModel record, if already loaded (footprintM = outline points in metres)
 * @param {{ tickets?: number, lvPositionen?: number }|null} [inhalt]
 *   counts (pieces) of the project's tickets and bill-of-quantities positions;
 *   omitted = unknown, the rule then decides on the model alone (72-02 behaviour)
 * @returns {boolean} true when the three cards should be rendered
 */
export function zeigeStartpfad(project, bimModel, inhalt) {
  if (!project?.id) return false;
  const hatGeometrie = Boolean(
    bimModel?.site_parcel ||
    (Array.isArray(bimModel?.buildings) && bimModel.buildings.length > 0) ||
    (Array.isArray(bimModel?.footprintM) && bimModel.footprintM.length >= 3)
  );
  const hatModell = Array.isArray(bimModel?.elements) && bimModel.elements.length > 0;
  const hatInhalt = (inhalt?.tickets ?? 0) > 0 || (inhalt?.lvPositionen ?? 0) > 0;
  return !hatGeometrie && !hatModell && !hatInhalt;
}
