// Tab registry of /People (80-01, E-01): English `?tab=` keys like the existing
// routes, German aliases normalised to the key, German labels and hints as t()
// source strings. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it).
//
// The keys are a contract (phases 81/82 and the plans 80-04 … 80-10 link them) —
// never rename one.
//
// In:  nothing (import-free). Out: PERSONAL_REITER_INFO, PERSONAL_REITER,
//      PERSONAL_REITER_ALIAS, STANDARD_PERSONAL_REITER. The i18n guard reads the
//      `label` and `hinweis` fields of the literal below (double quotes, no "];" inside).

/**
 * The four tabs in display order: key (URL), label and hint (German source for t()),
 * aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, hinweis: string, alias: string[]}>}
 */
const PERSONAL_REITER_INFO = [
  { key: "staff", label: "Mitarbeitende", hinweis: "Stammdaten, Funktion, Kammer, Qualifikationen und Projekte", alias: ["mitarbeitende", "mitarbeiter", "team"] },
  { key: "recruiting", label: "Mitarbeitersuche", hinweis: "Stellen, Bewerbungen und Löschfristen", alias: ["suche", "mitarbeitersuche", "stellen", "bewerbungen", "bewerber"] },
  { key: "onboarding", label: "Einstellung & Austritt", hinweis: "Checklisten für Eintritt und Austritt", alias: ["einstellung", "eintritt", "austritt"] },
  { key: "contracts", label: "Verträge", hinweis: "Arbeitsverträge, Gehaltsverlauf und Fristen", alias: ["vertraege", "vertrag"] },
];
for (const r of PERSONAL_REITER_INFO) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(PERSONAL_REITER_INFO);
export { PERSONAL_REITER_INFO };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const PERSONAL_REITER = Object.freeze(PERSONAL_REITER_INFO.map((r) => r.key));

/** German alias → tab key (e.g. { vertraege: "contracts" }). */
export const PERSONAL_REITER_ALIAS = Object.freeze(Object.fromEntries(PERSONAL_REITER_INFO.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const STANDARD_PERSONAL_REITER = "staff";
