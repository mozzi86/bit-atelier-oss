// reiter.js — tabs and routes of the pages "Werkplanung" (/Werkplanung, LP 5) and
// "Baustelle" (/Baustelle, LP 8), split by NAV-PLAN 2026-10-13 variant A. Import-free
// so that unit tests (naechsteSchritte.test.js) can validate ?tab= deep links without
// React.
//
// In:  nothing. Out: ROUTE, REITER, reiterVon(bereich).

/** @typedef {"werkplanung"|"baustelle"} Bereich */

/** Route of each page. @type {Readonly<Record<Bereich, string>>} */
export const ROUTE = Object.freeze({ werkplanung: "/Werkplanung", baustelle: "/Baustelle" });

/**
 * All tabs in order, each with the page it belongs to. `label` doubles as i18n key.
 * Permits stay with LP 5 [ASSUMED]: the building permit is the precondition of the
 * detailed design, and a page of its own for LP 4 would hold one tab.
 * @type {ReadonlyArray<{key: string, label: string, bereich: Bereich}>}
 */
export const REITER = Object.freeze([
  { key: "plaene", label: "Planliste", bereich: "werkplanung" },
  { key: "durchbrueche", label: "Durchbrüche", bereich: "werkplanung" },
  { key: "bemusterung", label: "Bemusterung", bereich: "werkplanung" },
  // 99-01…03: stored apartments, special requests of buyers and their deadlines; next to
  // sampling because a released request ends as an apartment sample there.
  { key: "sonderwuensche", label: "Wohnungen & Sonderwünsche", bereich: "werkplanung" },
  { key: "sige", label: "SiGe", bereich: "werkplanung" },
  { key: "genehmigungen", label: "Genehmigungen", bereich: "werkplanung" },
  { key: "bautagebuch", label: "Bautagebuch", bereich: "baustelle" },
]);

/**
 * Tab keys of one page.
 * @param {Bereich} bereich
 * @returns {string[]}
 */
export function reiterVon(bereich) {
  return REITER.filter((r) => r.bereich === bereich).map((r) => r.key);
}
