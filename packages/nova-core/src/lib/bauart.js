// 73-01: the ONE place that resolves the kind of work of a project — new build or existing building.
// `build_kind` ("neubau" / "sanierung") has been written by ProjectForm since 23.06.2026 but had no reader;
// every consumer (project tile, start path, later the designer registry in 73-02) asks here instead of
// reading the raw field, so legacy values and missing fields are handled once.
//   - "sanierung" (form value) and "bestand" both map to the internal "bestand"
//   - missing / unknown → "neubau" WITH gesetzt=false, so the UI can say "not set" instead of silently
//     pretending the user chose new build (4 of 6 local projects had no field, 73 draft §Befund)
//
// In:  a project record (or null). Out: { bauart, gesetzt } — pure, no side effects.

/** Internal kinds of work. */
export const BAUARTEN = Object.freeze(["neubau", "bestand"]);

/** Display labels (German UI strings; components pass them through t()). */
export const BAUART_LABEL = Object.freeze({ neubau: "Neubau", bestand: "Bestand / Sanierung" });

/**
 * Resolve the kind of work of a project.
 * @param {{build_kind?: string|null}|null|undefined} project
 * @returns {{bauart: "neubau"|"bestand", gesetzt: boolean}} gesetzt = the project carries an explicit, known value
 */
export function bauartVon(project) {
  const roh = String(project?.build_kind ?? "").trim().toLowerCase();
  if (roh === "sanierung" || roh === "bestand" || roh === "umbau") return { bauart: "bestand", gesetzt: true };
  if (roh === "neubau") return { bauart: "neubau", gesetzt: true };
  return { bauart: "neubau", gesetzt: false };
}

/** True when the project works on an existing building. */
export const istBestand = (project) => bauartVon(project).bauart === "bestand";

/**
 * Provenance line of the survey of an existing building (73-02, BEST-03: source, storeys, date) for the
 * "Gemessen" badge in the designer's PanelHeader.
 * @param {{name?: string, quelle?: string, anzahl?: number, geschosse?: unknown[], created_date?: string, updated_date?: string}|null|undefined} snapshot
 *   the project's BimSnapshot (or null)
 * @returns {string|null} German UI line, null without a snapshot
 */
export function herkunftZeile(snapshot) {
  if (!snapshot) return null;
  const teile = [`Bauaufnahme: ${snapshot.name || snapshot.quelle || "Modellstand"}`];
  if (Array.isArray(snapshot.geschosse) && snapshot.geschosse.length) teile.push(`${snapshot.geschosse.length} Geschosse`);
  if (Number(snapshot.anzahl) > 0) teile.push(`${Number(snapshot.anzahl).toLocaleString("de-DE")} Bauteile`);
  const datum = snapshot.updated_date || snapshot.created_date;
  if (datum && !Number.isNaN(Date.parse(datum))) teile.push(`Stand ${new Date(datum).toLocaleDateString("de-DE")}`);
  return teile.join(" · ");
}
