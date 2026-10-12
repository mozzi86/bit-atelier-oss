// Monthly history of the work-stage progress (Leistungsstand-Verlauf, phase 81-05,
// CTRL-04). HoaiPlan.progress holds the CURRENT progress per LPH (0–100 %, nine
// stages of the Objektplanung); the month view of the project controlling needs
// the progress at the end of each month to derive the earned value per month
// (ΔE = H × (F_month − F_previous month)). The Designer tab "Planer" stays the
// only progress editor (D-P81-17); on save it appends to HoaiPlan.verlauf
// through mitVerlauf — no second editor, no back-filling.
//
// In @core because the Designer (packages/nova-designer) reads it and may only
// import @core (package boundary).
//
// In:  the stored history, the progress just saved, today 'YYYY-MM-DD'.
// Out: the new history (at most one entry per month, at most VERLAUF_MAX entries)
//      and the progress valid in a month.

/** Months kept in HoaiPlan.verlauf (five years); older entries are dropped. */
export const VERLAUF_MAX = 60;

/**
 * @typedef {{monat: string, progress: Array<number|null>}} VerlaufEintrag
 *   monat 'YYYY-MM'; progress per LPH in percent (0–100) or null = not recorded
 */

/**
 * The history with the progress of today's save: the entry of the current month
 * is replaced (the last save of a month wins), otherwise appended; sorted by
 * month; at most VERLAUF_MAX entries (the oldest go). Invalid entries of the
 * stored list are dropped rather than carried along.
 * @param {ReadonlyArray<any>|null|undefined} verlauf stored HoaiPlan.verlauf
 * @param {ReadonlyArray<number|null|undefined>} progress progress per LPH in percent
 * @param {string} heuteIso 'YYYY-MM-DD' (local day of the save)
 * @returns {{verlauf: VerlaufEintrag[], monat: string}} new history; the month written
 */
export function mitVerlauf(verlauf, progress, heuteIso) {
  const monat = String(heuteIso || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monat)) throw new Error(`Leistungsstand-Verlauf: ungültiges Datum „${heuteIso}“.`);
  const eintrag = { monat, progress: Array.from(progress || [], (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)) };
  const gueltig = (Array.isArray(verlauf) ? verlauf : [])
    .filter((v) => v && typeof v.monat === "string" && /^\d{4}-\d{2}$/.test(v.monat) && Array.isArray(v.progress) && v.monat !== monat);
  const neu = [...gueltig, eintrag].sort((a, b) => a.monat.localeCompare(b.monat));
  return { verlauf: neu.slice(Math.max(0, neu.length - VERLAUF_MAX)), monat };
}

/**
 * Progress valid in a month: the entry of that month or, without one, the latest
 * entry before it (the progress did not change in between). Null before the
 * first entry — the progress then is unknown, not 0 %.
 * @param {ReadonlyArray<any>|null|undefined} verlauf HoaiPlan.verlauf
 * @param {string} monat 'YYYY-MM'
 * @returns {Array<number|null>|null} progress per LPH in percent
 */
export function fortschrittImMonat(verlauf, monat) {
  let treffer = null;
  for (const v of Array.isArray(verlauf) ? verlauf : []) {
    if (!v || typeof v.monat !== "string" || !Array.isArray(v.progress) || v.monat > monat) continue;
    if (!treffer || v.monat > treffer.monat) treffer = v;
  }
  return treffer ? [...treffer.progress] : null;
}
