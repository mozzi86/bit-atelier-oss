// The ONE place for how a renovation status looks (phase 97-01, concept
// .planning/phases/97-brillen/97-KONZEPT.md §3). Before, the IFC viewer, its legends and
// the designer's status fields each carried their own hex values — and they followed no
// convention (Abbruch red, Neubau green).
//
// Convention: the German state building-permit regulations (Landes-Bauvorlagenverordnungen,
// e.g. BayBauVorlV §8 with Anlage 1 "Zeichen oder Farben") — Bestand grey, Neubau red,
// Abbruch yellow. Binding for permit drawings (LPH 4), common practice everywhere else.
// Austria/Switzerland differ (SIA) — a country preset can override STATUS_DARSTELLUNG later.
// "temporaer" has no legal colour; violet is the house colour [ASSUMED].
//
// In:  nothing. Out: STATUS_DARSTELLUNG (hex, rgb 0..1, line style, label), statusFarbe(),
//      statusRgb(). No I/O.

/** Status keys that have a look; `ohne` = no status set (never shown as new build, D-BW-03). */
export const DARGESTELLTE_STATUS = Object.freeze(["bestand", "abbruch", "neubau", "temporaer", "ohne"]);

/**
 * Look per status. `strich`: SVG stroke-dasharray in drawing units (null = solid).
 * `sw` (black and white variant for permit plans): fill style when colour printing is not wanted.
 * @type {Readonly<Record<string, Readonly<{label: string, hex: string, rgb: readonly number[], strich: string|null, sw: string}>>>}
 */
export const STATUS_DARSTELLUNG = Object.freeze({
  bestand: Object.freeze({ label: "Bestand", hex: "#9aa3ad", rgb: Object.freeze([0.604, 0.639, 0.678]), strich: null, sw: "hellgrau" }),
  abbruch: Object.freeze({ label: "Abbruch", hex: "#f2c230", rgb: Object.freeze([0.949, 0.761, 0.188]), strich: "6 3", sw: "nur-kontur-gestrichelt" }),
  neubau: Object.freeze({ label: "Neubau", hex: "#d6453d", rgb: Object.freeze([0.839, 0.271, 0.239]), strich: null, sw: "schraffur-45" }),
  temporaer: Object.freeze({ label: "Temporär", hex: "#8b6fd6", rgb: Object.freeze([0.545, 0.435, 0.839]), strich: "8 2 2 2", sw: "strichpunkt" }),
  ohne: Object.freeze({ label: "ohne Status", hex: "#c8d0db", rgb: Object.freeze([0.784, 0.816, 0.859]), strich: "1 2", sw: "gepunktet" }),
});

/**
 * Look of a status; unknown, null or "unbekannt" map to `ohne` — never to Neubau.
 * @param {string|null|undefined} status
 * @returns {{label: string, hex: string, rgb: readonly number[], strich: string|null, sw: string}}
 */
export function statusDarstellung(status) {
  return STATUS_DARSTELLUNG[/** @type {string} */ (status)] || STATUS_DARSTELLUNG.ohne;
}

/** @param {string|null|undefined} status @returns {string} CSS hex colour */
export function statusFarbe(status) {
  return statusDarstellung(status).hex;
}

/** @param {string|null|undefined} status @returns {readonly number[]} RGB 0..1 (three.js / web-ifc) */
export function statusRgb(status) {
  return statusDarstellung(status).rgb;
}
