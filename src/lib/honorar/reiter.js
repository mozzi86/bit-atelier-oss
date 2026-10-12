// Tab registry of /Fees (Angebot & Auftrag) (phase 81, E-01): English `?tab=` keys, German aliases
// that are normalised to the key, German labels as t() source strings, lucide
// icon names. One table for the page, the unit tests and "Weiter mit"
// (naechsteSchritte.test.js validates ?tab against it).
//
// The keys are a contract (links and the "Weiter mit" bar point at them) — never
// rename one. Pattern of src/lib/accounting/reiter.js (79-01).
//
// In:  nothing (import-free). Out: HONORAR_REITER, HONORAR_REITER_SCHLUESSEL, HONORAR_REITER_ALIAS,
//      HONORAR_REITER_STANDARD. The i18n guard reads the `label` fields of the literal
//      below (double quotes, no "];" inside the block).

/**
 * The tabs in display order: key (URL), label (German source for t()), icon
 * (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const HONORAR_REITER = [
  { key: "offers", label: "Honorarangebote", icon: "FileSignature", alias: ["angebote", "honorarangebote"] },
  { key: "contracts", label: "Architektenverträge", icon: "FileCheck2", alias: ["vertraege", "architektenvertraege"] },
  { key: "amendments", label: "Honorarnachträge", icon: "FilePlus2", alias: ["nachtraege", "honorarnachtraege"] },
  { key: "calculator", label: "Honorarrechner", icon: "Calculator", alias: ["rechner"] },
];
for (const r of HONORAR_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(HONORAR_REITER);
export { HONORAR_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const HONORAR_REITER_SCHLUESSEL = Object.freeze(HONORAR_REITER.map((r) => r.key));

/** German alias → tab key. */
export const HONORAR_REITER_ALIAS = Object.freeze(Object.fromEntries(HONORAR_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab. */
export const HONORAR_REITER_STANDARD = "offers";
