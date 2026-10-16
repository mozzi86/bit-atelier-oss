// Leistungsstand (progress per work stage) outside the designer (94-04,
// B-ABN-08). The one store stays the project's HoaiPlan record
// ({project_id, progress[9], verlauf}) that the designer tab "Planer"
// (ProjectPlanner.jsx) writes — controlling, the contract account and the
// Abschlag proposal all read it. This module lets the contract account write
// the same record, so an office that never opens the designer can still keep
// its Leistungsstand; there is no second copy.
//
// In:  the stored HoaiPlan rows of the project, the changed stages.
// Out: fortschrittMit (pure) and speichereLeistungsstand (one write).

import { mitVerlauf } from "@core/lib/leistungsstand.js";

/**
 * The new progress array: the stored one with the given stages replaced.
 * Stages not given keep their stored value (null = not recorded).
 * @param {ReadonlyArray<number|null|undefined>|null|undefined} alt stored progress (index 0 = LPH 1)
 * @param {Record<number, number|null>} aenderungen percent per stage number 1–9 (null clears)
 * @returns {Array<number|null>} nine entries, each 0–100 or null
 */
export function fortschrittMit(alt, aenderungen) {
  const neu = Array.from({ length: 9 }, (_, i) => {
    const v = alt?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  });
  for (const [nr, wert] of Object.entries(aenderungen || {})) {
    const i = Number(nr) - 1;
    if (!(i >= 0 && i < 9)) continue;
    neu[i] = wert === null || wert === undefined || Number.isNaN(Number(wert)) ? null : Math.min(100, Math.max(0, Math.round(Number(wert))));
  }
  return neu;
}

/**
 * Writes the project's Leistungsstand into its HoaiPlan (creates the record
 * when there is none) and records the month in `verlauf` exactly like the
 * designer does (mitVerlauf).
 * @param {any} api bitApi (entities.HoaiPlan.filter/update/create)
 * @param {string} projectId project id
 * @param {Record<number, number|null>} aenderungen percent per stage number
 * @param {string} heuteIso 'YYYY-MM-DD' (local day of the save)
 * @returns {Promise<Record<string, any>>} the stored record
 */
export async function speichereLeistungsstand(api, projectId, aenderungen, heuteIso) {
  if (!projectId) throw new Error("Kein Projekt — Leistungsstand kann nicht gespeichert werden.");
  const zeilen = await api.entities.HoaiPlan.filter({ project_id: projectId });
  const zeile = Array.isArray(zeilen) ? zeilen[0] : null;
  const progress = fortschrittMit(zeile?.progress, aenderungen);
  const payload = { project_id: projectId, progress, verlauf: mitVerlauf(zeile?.verlauf, progress, heuteIso).verlauf };
  return zeile ? api.entities.HoaiPlan.update(zeile.id, payload) : api.entities.HoaiPlan.create(payload);
}
