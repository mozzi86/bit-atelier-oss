// Tab registry of /Deadlines (Fristen & Termine) (phase 82, E-01): English `?tab=` keys, German aliases
// that are normalised to the key, German labels as t() source strings, lucide
// icon names. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it). The tabs are filled by 82-03.
//
// The keys are a contract (links and the "Weiter mit" bar point at them) — never
// rename one. Pattern of src/lib/accounting/reiter.js (79-01).
//
// In:  nothing (import-free). Out: FRISTEN_REITER, REITER_SCHLUESSEL, REITER_ALIAS,
//      STANDARD_REITER. The i18n guard reads the `label` fields of the literal
//      below (double quotes, no "];" inside the block).

/**
 * The tabs in display order: key (URL), label (German source for t()), icon
 * (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const FRISTEN_REITER = [
  { key: "agenda", label: "Agenda", icon: "ListChecks", alias: ["liste"] },
  { key: "month", label: "Monat", icon: "CalendarDays", alias: ["monat", "kalender"] },
  { key: "warranty", label: "Gewährleistung", icon: "ShieldCheck", alias: ["gewaehrleistung"] },
];
for (const r of FRISTEN_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(FRISTEN_REITER);
export { FRISTEN_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const REITER_SCHLUESSEL = Object.freeze(FRISTEN_REITER.map((r) => r.key));

/** German alias → tab key. */
export const REITER_ALIAS = Object.freeze(Object.fromEntries(FRISTEN_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const STANDARD_REITER = "agenda";
