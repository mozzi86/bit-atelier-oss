// Term source "vertrag" (phase 82, 82-03): milestones, deadlines and
// instalments of the architect's contracts as phase 81 lists them
// (vertragsFristen in src/lib/honorar/vertrag.js). Read through the 81 storage
// layer (Honorarvertrag, read-only there). Dates are calendar days.
//
// In:  api, ctx.datenquelle. Out: QUELLE for quellenRegistry.js.

import { terminId } from "@core/lib/kalender/termin.js";
import { ladeZeitHonorar } from "@/lib/zeitHonorar/speicher.js";
import { vertragsFristen } from "@/lib/honorar/vertrag.js";

/** Kind of term per kind of contract date. */
const ART = Object.freeze({ meilenstein: "vertrag_meilenstein", frist: "vertrag_frist", rate: "vertrag_rate" });

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "vertrag",
  label: "Architektenverträge",
  modul: "auftrag",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await ladeZeitHonorar(api, { entitaeten: ["Honorarvertrag"] })).Honorarvertrag || [],
  berechnen: (/** @type {any[]} */ vertraege) => (vertraege || []).flatMap((v) => vertragsFristen(v).map((f, i) => {
    const art = ART[/** @type {"meilenstein"|"frist"|"rate"} */ (f.art)] || "vertrag_meilenstein";
    return {
      id: terminId("vertrag", v.id, `${f.datum}:${i}`),
      quelle: "vertrag", art, klasse: /** @type {any} */ (art === "vertrag_frist" ? "frist" : art === "vertrag_rate" ? "hinweis" : "termin"),
      datum: f.datum, project_id: f.project_id, modul: "auftrag",
      objekt: [f.titel, f.objekt].filter(Boolean).join(" · "), ziel: f.ziel,
    };
  })),
});
