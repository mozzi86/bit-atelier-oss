// Tab registry of /Accounting (phase 79, E-01): English `?tab=` keys like the
// existing routes, German aliases that are normalised to the key, German labels
// as t() source strings, lucide icon names. One table for the page, the unit
// tests and "Weiter mit" (naechsteSchritte.test.js validates ?tab against it).
//
// The keys are a contract (links from phase 81 and the "Weiter mit" bar point
// at them) — never rename one. "ausgang" is the name phase 81 expects.
//
// In:  nothing (import-free). Out: BUCHHALTUNG_REITER, REITER_SCHLUESSEL,
//      REITER_ALIAS, STANDARD_REITER. The i18n guard reads the `label` fields of
//      the literal below (double quotes, no "];" inside the block).

/**
 * The nine tabs in display order: key (URL), label (German source for t()),
 * icon (lucide export name), aliases (German URL values). Frozen below.
 * @type {Array<{key: string, label: string, icon: string, alias: string[]}>}
 */
const BUCHHALTUNG_REITER = [
  { key: "invoices", label: "Ausgangsrechnungen", icon: "FileOutput", alias: ["ausgangsrechnungen", "rechnungen", "ausgang"] },
  { key: "expenses", label: "Eingangsrechnungen", icon: "FileInput", alias: ["eingangsrechnungen", "ausgaben"] },
  { key: "liquidity", label: "Jahresuhr", icon: "Clock", alias: ["liquiditaet", "jahresuhr"] },
  { key: "vat", label: "Umsatzsteuer", icon: "Percent", alias: ["ust", "umsatzsteuer"] },
  { key: "drawings", label: "Entnahmen", icon: "HandCoins", alias: ["entnahmen"] },
  { key: "bank", label: "Bank-Abgleich", icon: "ArrowLeftRight", alias: ["bankabgleich"] },
  { key: "fleet", label: "Fuhrpark", icon: "Car", alias: ["fuhrpark", "fahrten"] },
  { key: "assets", label: "Anlagen", icon: "Package", alias: ["anlagen", "afa"] },
  { key: "annual", label: "Jahresübersicht", icon: "Scale", alias: ["euer", "jahresuebersicht"] },
];
for (const r of BUCHHALTUNG_REITER) { Object.freeze(r.alias); Object.freeze(r); }
Object.freeze(BUCHHALTUNG_REITER);
export { BUCHHALTUNG_REITER };

/** Tab keys in display order (module constant, as useTabParam requires). */
export const REITER_SCHLUESSEL = Object.freeze(BUCHHALTUNG_REITER.map((r) => r.key));

/** German alias → tab key (e.g. { jahresuhr: "liquidity" }). */
export const REITER_ALIAS = Object.freeze(Object.fromEntries(BUCHHALTUNG_REITER.flatMap((r) => r.alias.map((a) => [a, r.key]))));

/** Tab shown without ?tab (the year clock, D-P79-02). */
export const STANDARD_REITER = "liquidity";
