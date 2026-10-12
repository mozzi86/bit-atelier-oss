// Tab registry of /Absences (Abwesenheiten) (phase 82, E-01): English `?tab=` keys, German aliases
// that are normalised to the key, German labels as t() source strings, lucide
// icon names. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it). The tabs are filled by 82-04.
//
// The keys are a contract (links and the "Weiter mit" bar point at them) — never
// rename one. Pattern of src/lib/accounting/reiter.js (79-01).
//
// In:  nothing (import-free). Out: ABWESENHEIT_REITER, REITER_SCHLUESSEL, REITER_ALIAS,
//      STANDARD_REITER. The i18n guard reads the `label` fields of the literal
//      below (double quotes, no "];" inside the block).

/**
 * The tabs in display order: key (URL), label (German source for t()), icon
 * (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const ABWESENHEIT_REITER = [
  { key: "team", label: "Teamkalender", icon: "Users", alias: ["kalender"] },
  { key: "requests", label: "Anträge", icon: "ClipboardList", alias: ["antraege"] },
  { key: "balance", label: "Urlaubskonto", icon: "CalendarCheck", alias: ["konto", "urlaubskonto"] },
  { key: "holidays", label: "Feiertage", icon: "Sun", alias: ["feiertage"] },
];
for (const r of ABWESENHEIT_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(ABWESENHEIT_REITER);
export { ABWESENHEIT_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const REITER_SCHLUESSEL = Object.freeze(ABWESENHEIT_REITER.map((r) => r.key));

/** German alias → tab key. */
export const REITER_ALIAS = Object.freeze(Object.fromEntries(ABWESENHEIT_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const STANDARD_REITER = "team";
