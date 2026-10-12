// Term source "abnahme" (phase 82, 82-03): warranty end, inspection before it,
// return of the security and the architect's liability, computed from the
// acceptances (entity Abnahme) by the pure rules of
// @core/lib/kalender/gewaehrleistung.js with the rule values fristen.* (E-16).
// Dates of an acceptance are calendar days 'YYYY-MM-DD' already.
//
// In:  api (Abnahme list), ctx.regelWert. Out: QUELLE for quellenRegistry.js.

import { termineAusAbnahmen } from "@core/lib/kalender/gewaehrleistung.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "abnahme",
  label: "Abnahmen & Gewährleistung",
  modul: "fristen",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await api.entities.Abnahme.list()) || [],
  berechnen: (/** @type {any[]} */ abnahmen, /** @type {any} */ ctx) => termineAusAbnahmen(abnahmen, ctx.regelWert || (() => null)).termine,
});
