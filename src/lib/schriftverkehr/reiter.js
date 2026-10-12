// Tab registry of /Correspondence (Schriftverkehr) (phase 82, E-01): English `?tab=` keys, German aliases
// that are normalised to the key, German labels as t() source strings, lucide
// icon names. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it). The tabs are filled by 82-05.
//
// The keys are a contract (links and the "Weiter mit" bar point at them) — never
// rename one. Pattern of src/lib/accounting/reiter.js (79-01).
//
// In:  nothing (import-free). Out: SCHRIFT_REITER, REITER_SCHLUESSEL, REITER_ALIAS,
//      STANDARD_REITER. The i18n guard reads the `label` fields of the literal
//      below (double quotes, no "];" inside the block).

/**
 * The tabs in display order: key (URL), label (German source for t()), icon
 * (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const SCHRIFT_REITER = [
  { key: "letters", label: "Schreiben", icon: "PenLine", alias: ["schreiben", "briefe"] },
  { key: "register", label: "Postbuch", icon: "Inbox", alias: ["postbuch", "post"] },
  { key: "templates", label: "Briefvorlagen", icon: "LayoutTemplate", alias: ["vorlagen"] },
];
for (const r of SCHRIFT_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(SCHRIFT_REITER);
export { SCHRIFT_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const REITER_SCHLUESSEL = Object.freeze(SCHRIFT_REITER.map((r) => r.key));

/** German alias → tab key. */
export const REITER_ALIAS = Object.freeze(Object.fromEntries(SCHRIFT_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const STANDARD_REITER = "letters";
