// Letterhead defaults and normalisation (80-03, KRITIK-05/A11Y-I18N-22): the ONE
// source both the settings editor (BriefkopfFormular) and every reader (the
// sidebar footer, Reports.jsx) build on — no more separate copies of the same
// defaults in Layout.jsx and Reports.jsx.
//
// Older installs (and the former demo seed, removed in 83-02) still carry the
// built-in English subtitle "INTEGRATED PROJECT PLATFORM" in the stored Setting
// row (value.tagline) as if the office had chosen it — normalisiereBriefkopf
// turns exactly that value into "" so it never reappears on a report, without
// touching anything the office actually typed itself.
//
// In:  a raw stored Setting value (or undefined while nothing is saved yet).
// Out: BRIEFKOPF_SCHLUESSEL, DEFAULT_BRIEFKOPF, ALTER_STANDARD_UNTERTITEL,
//      normalisiereBriefkopf.

/** Setting key of the letterhead row (one row per key, see @core/lib/einstellungen). */
export const BRIEFKOPF_SCHLUESSEL = "briefkopf";

/**
 * Empty defaults. No built-in subtitle: an English product slogan does not belong
 * on the office's own letterhead.
 * @type {Readonly<{office: string, tagline: string, address: string, contact: string}>}
 */
export const DEFAULT_BRIEFKOPF = Object.freeze({ office: "Architekturbüro", tagline: "", address: "", contact: "" });

/**
 * The former built-in subtitle (moved here from Reports.jsx, 80-03 task 1). A
 * stored value equal to it counts as "no subtitle" — see normalisiereBriefkopf.
 */
export const ALTER_STANDARD_UNTERTITEL = "INTEGRATED PROJECT PLATFORM";

/**
 * Fills in defaults, drops unknown fields and clears the retired subtitle.
 * @param {any} wert raw stored Setting value (or undefined)
 * @returns {{office: string, tagline: string, address: string, contact: string}} a
 *   fresh object with exactly the four letterhead fields
 */
export function normalisiereBriefkopf(wert) {
  const w = wert && typeof wert === "object" ? wert : {};
  const tagline = w.tagline === ALTER_STANDARD_UNTERTITEL ? "" : (w.tagline ?? DEFAULT_BRIEFKOPF.tagline);
  return {
    office: w.office ?? DEFAULT_BRIEFKOPF.office,
    tagline,
    address: w.address ?? DEFAULT_BRIEFKOPF.address,
    contact: w.contact ?? DEFAULT_BRIEFKOPF.contact,
  };
}
