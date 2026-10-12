// Tab registry of /Controlling (Projektcontrolling) (phase 81, E-01): English `?tab=` keys, German aliases
// that are normalised to the key, German labels as t() source strings, lucide
// icon names. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it).
//
// The keys are a contract (links and the "Weiter mit" bar point at them) — never
// rename one. Pattern of src/lib/accounting/reiter.js (79-01).
//
// In:  nothing (import-free). Out: CONTROLLING_REITER, CONTROLLING_REITER_SCHLUESSEL, CONTROLLING_REITER_ALIAS,
//      CONTROLLING_REITER_STANDARD. The i18n guard reads the `label` fields of the literal
//      below (double quotes, no "];" inside the block).

/**
 * The tabs in display order: key (URL), label (German source for t()), icon
 * (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const CONTROLLING_REITER = [
  { key: "overview", label: "Übersicht", icon: "LayoutGrid", alias: ["uebersicht"] },
  { key: "project", label: "Projekt", icon: "FolderKanban", alias: ["projekt"] },
  { key: "month", label: "Monat", icon: "CalendarRange", alias: ["monat"] },
  { key: "rates", label: "Kostensätze", icon: "Coins", alias: ["kostensaetze"] },
];
for (const r of CONTROLLING_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(CONTROLLING_REITER);
export { CONTROLLING_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const CONTROLLING_REITER_SCHLUESSEL = Object.freeze(CONTROLLING_REITER.map((r) => r.key));

/** German alias → tab key. */
export const CONTROLLING_REITER_ALIAS = Object.freeze(Object.fromEntries(CONTROLLING_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const CONTROLLING_REITER_STANDARD = "overview";
