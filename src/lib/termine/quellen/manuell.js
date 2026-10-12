// Term source "manuell" (phase 82, 82-01): the terms the office enters by hand
// (entity Termin) — appointments and deadlines, optionally recurring
// (woechentlich, zweiwoechentlich, monatlich up to `bis`). Every occurrence gets
// its own stable id 'manuell:<id>:<datum>', so one occurrence can be ticked off
// without touching the others.
//
// In:  api (Termin list), window of ladeTermine. Out: QUELLE for quellenRegistry.js.

import { wiederholungen } from "@core/lib/kalender/termin.js";

/**
 * Kind of a manual term from its fields.
 * @param {Record<string, any>} t
 * @returns {string} key of TERMIN_ARTEN
 */
function artVon(t) {
  if (t?.terminart === "jour_fixe") return "jour_fixe";
  if (t?.terminart === "baugenehmigung") return "baugenehmigung";
  return t?.art === "frist" ? "frist_manuell" : "termin_manuell";
}

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "manuell",
  label: "Eigene Termine",
  modul: "fristen",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await api.entities.Termin.list()) || [],
  berechnen: (/** @type {any[]} */ termine, /** @type {{von: string, bis: string}} */ ctx) => (termine || []).flatMap((t) => {
    if (!t?.id) return [];
    const art = artVon(t);
    // A manual entry is a deadline only when entered as one (a site visit is an
    // appointment, not the warranty inspection of 82-03's acceptances).
    const klasse = /** @type {"frist"|"termin"} */ (t.art === "frist" ? "frist" : "termin");
    // Overdue deadlines before the window stay visible (sammleTermine keeps them a year).
    const von = klasse === "frist" ? "0000-01-01" : ctx.von;
    return wiederholungen({ ...t, quelle: "manuell" }, von, ctx.bis).map((v) => ({
      id: v.id,
      quelle: "manuell",
      art,
      klasse,
      datum: v.datum,
      bis: t.wiederholung ? null : t.bis || null,
      zeit: t.zeit || null,
      dauer_min: t.dauer_min ?? null,
      project_id: t.project_id || null,
      modul: "fristen",
      objekt: String(t.titel || ""),
      ziel: "/Deadlines?tab=agenda",
      // The stored record behind the occurrence (edit/delete in the term dialog, 82-03).
      datensatz_id: t.id,
    }));
  }),
});
