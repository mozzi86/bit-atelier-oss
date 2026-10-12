// Term source "foerderung" (phase 82, 82-03): the application deadline of every
// funding application (FoerderAntrag.frist, a calendar day or a timestamp, read
// as the Berlin day). An approved or rejected application is done.
//
// In:  api (FoerderAntrag list). Out: QUELLE for quellenRegistry.js.

import { isoTag } from "@core/lib/kalender/datum.js";
import { terminId } from "@core/lib/kalender/termin.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "foerderung",
  label: "Förderfristen",
  modul: "planung",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await api.entities.FoerderAntrag.list()) || [],
  berechnen: (/** @type {any[]} */ antraege) => (antraege || []).flatMap((a) => {
    const datum = isoTag(a?.frist);
    if (!a?.id || !datum) return [];
    return [{
      id: terminId("foerderung", a.id, "frist"),
      quelle: "foerderung", art: "foerderfrist", klasse: /** @type {"frist"} */ ("frist"), datum,
      project_id: a.project_id || null, modul: "planung", objekt: String(a.programm || a.programm_key || a.id), ziel: "/ComplexDesigner?tab=funding",
      erledigt: a.status === "bewilligt" || a.status === "abgelehnt",
    }];
  }),
});
