// Term source "ausschreibung" (phase 82, 82-03): the submission deadline of
// every tender (Tender.deadline, stored as midnight UTC '2026-06-15T00:00:00.000Z'
// by TenderPanel.jsx) — read as the Berlin calendar day (isoTag), so the date
// is the same on every device and under TZ=UTC. An awarded or closed tender is done.
//
// In:  api (Tender list). Out: QUELLE for quellenRegistry.js.

import { isoTag } from "@core/lib/kalender/datum.js";
import { terminId } from "@core/lib/kalender/termin.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "ausschreibung",
  label: "Ausschreibungen",
  modul: "ava",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await api.entities.Tender.list()) || [],
  berechnen: (/** @type {any[]} */ tender) => (tender || []).flatMap((t) => {
    const datum = isoTag(t?.deadline);
    if (!t?.id || !datum) return [];
    return [{
      id: terminId("ausschreibung", t.id, "submission"),
      quelle: "ausschreibung", art: "submission", klasse: /** @type {"termin"} */ ("termin"), datum,
      project_id: t.project_id || null, modul: "ava", objekt: String(t.name || t.title || t.id), ziel: "/AVA?tab=tender",
      erledigt: t.status === "awarded" || t.status === "closed",
    }];
  }),
});
