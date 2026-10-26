// Data sheets of a penetration (Durchbruch of the openings planning) and its fire stop (97-02a), moved here in 107-04 from
// src/lib/werkplanung/durchbrueche.js (which re-exports it, every app caller stays valid). Reason: the IFC export and the BIM studio
// (@designer) write penetrations into the model and may not import from `src/` (app only); the function itself needs nothing but
// the data sheet of this folder.
//
// A requested or approved penetration is a "provision for void" (IfcBuildingElementProxy, PROVISIONFORVOID), an executed one a real
// IfcOpeningElement in its host; the fire stop is an element of its own.
//
// In:  Durchbruch record (src/lib/werkplanung/durchbrueche.js, DurchbruchRecord) and the project id of the derived GUIDs.
// Out: the two data sheets (steckbrief.js). Pure, no I/O.
import { steckbrief } from "./steckbrief.js";

/**
 * Data sheets of an opening and its fire stop (97-02a). Requested/approved openings are a
 * provision for void, an executed one a real opening; the fire stop is its own element.
 * @param {any} d Durchbruch record (status, kg, gewerk_lb, bauabschnitt, brandschott, id/nr)
 * @param {{projektId?: string|number|null}} [ctx] projektId: project of the derived GUID
 * @returns {{durchbruch: import("./steckbrief.js").Steckbrief, brandschott: import("./steckbrief.js").Steckbrief|null}}
 */
export function durchbruchSteckbriefe(d, { projektId = null } = {}) {
  const id = d?.id || d?.nr || "?";
  const durchbruch = steckbrief({ id, kg: d?.kg, gewerk_lb: d?.gewerk_lb, bauabschnitt: d?.bauabschnitt }, d?.status === "ausgefuehrt" ? "oeffnung" : "durchbruch", { projektId, quelle: "durchbruch" });
  const s = d?.brandschott;
  const brandschott = s && typeof s === "object"
    ? steckbrief({ id, material: [s.system, s.hersteller].filter(Boolean).join(", ") || null }, "brandschott", { projektId, quelle: "brandschott" })
    : null;
  return { durchbruch, brandschott };
}
