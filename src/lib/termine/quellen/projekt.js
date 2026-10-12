// Term source "projekt" (phase 82, 82-01): the completion date of every project
// that is not finished yet. Project.completion_date may be a timestamp
// (seed: '2026-09-30T00:00:00.000Z'); it is read as the Berlin calendar day
// (isoTag), so the agenda shows the same day on every device and under TZ=UTC.
//
// In:  api (Project list). Out: QUELLE for quellenRegistry.js.

import { isoTag } from "@core/lib/kalender/datum.js";
import { terminId } from "@core/lib/kalender/termin.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "projekt",
  label: "Projekttermine",
  modul: "projekte",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await api.entities.Project.list()) || [],
  berechnen: (/** @type {any[]} */ projekte) => (projekte || []).flatMap((p) => {
    const datum = isoTag(p?.completion_date);
    if (!p?.id || !datum || p.status === "completed") return [];
    return [{
      id: terminId("projekt", p.id, "fertigstellung"),
      quelle: "projekt",
      art: "projekt_fertigstellung",
      klasse: /** @type {"termin"} */ ("termin"),
      datum,
      project_id: p.id,
      modul: "projekte",
      objekt: String(p.name || p.id),
      ziel: "/Projects",
    }];
  }),
});
