// Term source "lieferplan" (phase 82, 82-03): model deliveries of the active
// project that are not delivered yet (BimModel.lieferung_layer, read by
// sollIst of @ifc/lib/lieferplan, ISO days). A BimModel record can be megabytes
// (T-82-24): the source reads only the active project and is off by default.
//
// In:  api (BimModel filtered by project), ctx.projectId, ctx.heute. Out: QUELLE.

import { terminId } from "@core/lib/kalender/termin.js";
import { sollIst } from "@ifc/lib/lieferplan.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "lieferplan",
  label: "Modelllieferungen",
  modul: "modell",
  standardAn: false,
  laden: async (/** @type {any} */ api, /** @type {any} */ ctx) => (ctx.projectId ? (await api.entities.BimModel.filter({ project_id: ctx.projectId })) || [] : []),
  berechnen: (/** @type {any[]} */ modelle, /** @type {any} */ ctx) => (modelle || []).flatMap((m) => {
    if (!m?.lieferung_layer) return [];
    return sollIst(m.lieferung_layer, ctx.heute).filter((l) => l.termin && l.status === "geplant").map((l) => ({
      id: terminId("lieferplan", `${m.project_id || m.id}:${l.id}`, l.termin),
      quelle: "lieferplan", art: "modelllieferung", klasse: /** @type {"frist"} */ ("frist"), datum: l.termin,
      project_id: m.project_id || null, modul: "modell", objekt: `LOD ${l.log} · ${l.bauabschnitt || l.nr}`, ziel: "/ModelVersions",
    }));
  }),
});
