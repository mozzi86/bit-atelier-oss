// Tab registry of /TimeTracking (Zeiterfassung) (phase 81, E-01): English `?tab=` keys, German aliases
// that are normalised to the key, German labels as t() source strings, lucide
// icon names. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it).
//
// The keys are a contract (links and the "Weiter mit" bar point at them) — never
// rename one. Pattern of src/lib/accounting/reiter.js (79-01).
//
// In:  nothing (import-free). Out: ZEIT_REITER, ZEIT_REITER_SCHLUESSEL, ZEIT_REITER_ALIAS,
//      ZEIT_REITER_STANDARD. The i18n guard reads the `label` fields of the literal
//      below (double quotes, no "];" inside the block).

/**
 * The tabs in display order: key (URL), label (German source for t()), icon
 * (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const ZEIT_REITER = [
  { key: "week", label: "Wochenansicht", icon: "CalendarDays", alias: ["woche"] },
  { key: "day", label: "Tagesansicht", icon: "Sun", alias: ["tag"] },
  { key: "approval", label: "Freigabe", icon: "CheckCheck", alias: ["freigabe"] },
  { key: "export", label: "Export", icon: "Download", alias: ["ausgabe"] },
];
for (const r of ZEIT_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(ZEIT_REITER);
export { ZEIT_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const ZEIT_REITER_SCHLUESSEL = Object.freeze(ZEIT_REITER.map((r) => r.key));

/** German alias → tab key. */
export const ZEIT_REITER_ALIAS = Object.freeze(Object.fromEntries(ZEIT_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const ZEIT_REITER_STANDARD = "week";
