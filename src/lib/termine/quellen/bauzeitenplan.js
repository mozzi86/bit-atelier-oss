// Term source "bauzeitenplan" (phase 82, 82-03): the end of every task of the
// site schedule (ScheduleTask, Labor). TaskScheduleForm stores local 07:00/17:00
// as UTC timestamps ('2026-06-19T22:30:00Z' is already 20.06. in Berlin) — read
// as the Berlin calendar day (isoTag). Off by default: a big schedule would fill
// the agenda.
//
// In:  api (ScheduleTask list). Out: QUELLE for quellenRegistry.js.

import { isoTag } from "@core/lib/kalender/datum.js";
import { terminId } from "@core/lib/kalender/termin.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "bauzeitenplan",
  label: "Bauzeitenplan",
  modul: "labor",
  standardAn: false,
  laden: async (/** @type {any} */ api) => (await api.entities.ScheduleTask.list()) || [],
  berechnen: (/** @type {any[]} */ aufgaben) => (aufgaben || []).flatMap((a) => {
    const datum = isoTag(a?.end_date);
    if (!a?.id || !datum) return [];
    return [{
      id: terminId("bauzeitenplan", a.id, "ende"),
      quelle: "bauzeitenplan", art: "bauzeitenplan", klasse: /** @type {"termin"} */ ("termin"), datum,
      project_id: a.project_id || null, modul: "labor", objekt: String(a.name || a.title || a.id), ziel: "/SiteControl",
      erledigt: a.status === "completed" || Number(a.progress) >= 100,
    }];
  }),
});
