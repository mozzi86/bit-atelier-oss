// Hand-computed expectations of the phase-82 sample on the reference day
// Mon 28.09.2026 (82-RESEARCH § Saat und Erwartungswerte) — plain data,
// deliberately NOT computed with the code under test. 82-01 owns the file;
// 82-03/04/05 check their source's contribution, 82-06 the sum.
//
// Agenda window: today .. today + 90 days = 28.09. .. 27.12.2026.
// Groups: Überfällig (deadlines only) · Heute 28.09. · Diese Woche 29.09.–04.10.
// · Nächste Woche 05.–11.10. · Später 12.10.–27.12.
//
// Owner, per source (own sources of phase 82):
//   projekt:     proj-1 completion 30.09. → diese_woche 1 (proj-4 is completed)
//   manuell:     te-1 28.09. → heute 1; te-2 weekly 29.09.–15.12. = 12 occurrences:
//                29.09. → diese_woche 1, 06.10. → naechste_woche 1, 13.10.–15.12. = 10 → spaeter;
//                te-3 15.10. → spaeter 1 — spaeter 10 + 1 = 11
//   abnahme:     ab-1 inspection 14.07. (3 months before 14.10.) overdue 1; end of warranty 14.10. → spaeter 1;
//                ab-2 liability ends 15.12.2030 (outside the window)
//   postbuch:    pb-1 reply due 02.10. → diese_woche 1
//   abwesenheit: aw-3 from 05.10. → naechste_woche 1, aw-5 22.10. → spaeter 1 (aw-4 only requested)
// Sum owner: ueberfaellig 1, heute 1, diese_woche 3, naechste_woche 2, spaeter 13 = 20.
// Project lead and staff see proj-1/proj-2 only: without the two proj-4 terms of
// abnahme → ueberfaellig 0, spaeter 12, sum 18. Bookkeeping sees all projects = owner.

/** Reference day the expectations hold for. */
export const SEED82_ANKER = "2026-09-28";

/** Last day of the agenda window (today + 90 days). */
export const AGENDA_FENSTER_BIS = "2026-12-27";

/** Agenda groups per role on the reference day. */
export const AGENDA_ERWARTUNG = Object.freeze({
  inhaber: Object.freeze({ ueberfaellig: 1, heute: 1, diese_woche: 3, naechste_woche: 2, spaeter: 13, summe: 20 }),
  projektleitung: Object.freeze({ ueberfaellig: 0, heute: 1, diese_woche: 3, naechste_woche: 2, spaeter: 12, summe: 18 }),
  mitarbeiter: Object.freeze({ ueberfaellig: 0, heute: 1, diese_woche: 3, naechste_woche: 2, spaeter: 12, summe: 18 }),
  buchhaltung: Object.freeze({ ueberfaellig: 1, heute: 1, diese_woche: 3, naechste_woche: 2, spaeter: 13, summe: 20 }),
});

/** Contribution per source (owner). */
export const AGENDA_BEITRAG = Object.freeze({
  projekt: Object.freeze({ diese_woche: 1 }),
  manuell: Object.freeze({ heute: 1, diese_woche: 1, naechste_woche: 1, spaeter: 11 }),
  abnahme: Object.freeze({ ueberfaellig: 1, spaeter: 1 }),
  postbuch: Object.freeze({ diese_woche: 1 }),
  abwesenheit: Object.freeze({ naechste_woche: 1, spaeter: 1 }),
});

/** Projects of project lead and staff after the sample's assignments. */
export const ZUORDNUNG_ANNAHME = Object.freeze({ projektleitung: Object.freeze(["proj-1", "proj-2"]), mitarbeiter: Object.freeze(["proj-1", "proj-2"]) });

/** Number of visible projects per role (proj-1…4). */
export const SICHTBARE_PROJEKTE_JE_ROLLE = Object.freeze({ inhaber: 4, projektleitung: 2, mitarbeiter: 2, buchhaltung: 4 });

/** Next register numbers on the reference day. */
export const NAECHSTE_NUMMERN = Object.freeze({ eingang: "PE-2026-0003", ausgang: "PA-2026-0002" });

/**
 * Agenda group of a term on a day (test helper, mirrors the rule of 82-RESEARCH:
 * week = Monday to Sunday; only deadlines are overdue).
 * @param {{datum: string, klasse: string, erledigt?: boolean}} t
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {'ueberfaellig'|'heute'|'diese_woche'|'naechste_woche'|'spaeter'|null}
 */
export function gruppeVon(t, heute) {
  const tage = Math.round((Date.parse(t.datum + "T00:00:00Z") - Date.parse(heute + "T00:00:00Z")) / 86400000);
  const wt = new Date(heute + "T00:00:00Z").getUTCDay();
  const bisSonntag = wt === 0 ? 0 : 7 - wt;
  if (tage < 0) return t.klasse === "frist" && !t.erledigt ? "ueberfaellig" : null;
  if (tage === 0) return "heute";
  if (tage <= bisSonntag) return "diese_woche";
  if (tage <= bisSonntag + 7) return "naechste_woche";
  return "spaeter";
}
