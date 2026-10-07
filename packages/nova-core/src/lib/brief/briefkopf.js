// Letterhead normaliser of the shared letter core (phase 79-03, reused by
// phases 81/82 — D-P79-27): the office letterhead is stored once as
// Setting{key:"briefkopf"} (src/Layout.jsx, src/pages/Reports.jsx). This
// package cannot import src/ (the app/package boundary — @core may not depend
// on the app), so the same default shape is repeated here rather than
// re-derived; src/pages/Reports.jsx's BRIEFKOPF_DEFAULTS is the source of truth
// and this copy must be kept in step with it by hand.
//
// In:  the raw Setting.value (or null/undefined before it is ever saved).
// Out: a complete, defaulted letterhead object for briefLayout()/mahnPdf.js.

/** Mirrors src/pages/Reports.jsx BRIEFKOPF_DEFAULTS (28.09.2026). */
const STANDARD = Object.freeze({ office: "Architekturbüro", tagline: "", address: "", contact: "" });

/**
 * @param {{office?: string, tagline?: string, address?: string, contact?: string}|null|undefined} settingWert
 *   Setting{key:"briefkopf"}.value, as saved by src/Layout.jsx / src/pages/Reports.jsx
 * @returns {{office: string, tagline: string, address: string, contact: string}}
 */
export function briefkopfAus(settingWert) {
  return {
    office: settingWert?.office || STANDARD.office,
    tagline: settingWert?.tagline || STANDARD.tagline,
    address: settingWert?.address || STANDARD.address,
    contact: settingWert?.contact || STANDARD.contact,
  };
}

/**
 * Letterhead as address lines for a letter (office name, then the free-text
 * address, one line per non-empty part; the tagline and contact are not
 * address lines and are left to the caller's footer/signature, if any).
 * @param {{office?: string, tagline?: string, address?: string, contact?: string}|null|undefined} settingWert
 * @returns {string[]}
 */
export function briefkopfZeilen(settingWert) {
  const bk = briefkopfAus(settingWert);
  const adresse = String(bk.address || "").split("\n").map((z) => z.trim()).filter(Boolean);
  return [bk.office, ...adresse].filter(Boolean);
}
