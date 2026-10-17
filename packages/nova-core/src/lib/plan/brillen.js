// Lens register ("Brillen", phase 97-03, concept .planning/phases/97-brillen/97-KONZEPT.md §4).
// ONE model, many lenses: a lens never stores anything — it decides per renovation status
// whether an element is shown, emphasised, faded or hidden, plus scale, depth and purpose.
// Plan, 3D, quantities and PDF read the same register; the lens choice is a view setting.
//
// Rule against wrong planning: an element WITHOUT status is never hidden by a lens (it would
// silently drop out of a demolition plan or a tender) — it stays visible with the "ohne"
// look until somebody decides (D-BW-03).
//
// In: nothing. Out: BRILLEN, brilleVon(), brilleSicht(), zeigtStatus(), sichtbarUnter(),
// planDarstellung(). No I/O.

import { statusDarstellung } from "./statusDarstellung.js";

/** @typedef {'normal'|'hervor'|'blass'|'aus'} Sicht  how a status appears under a lens */

/**
 * @typedef {object} Brille
 * @property {string} id
 * @property {string} label        German UI string (i18n key)
 * @property {string} kurz         short label for the segment bar
 * @property {string} zweck        purpose (tooltip, i18n key)
 * @property {Readonly<Record<'bestand'|'abbruch'|'neubau'|'temporaer'|'ohne', Sicht>>} sicht
 * @property {number} massstab     scale denominator (100 = 1:100)
 * @property {'kern'|'schichten'|'mengen'} tiefe  level of detail (97-04 draws it)
 * @property {boolean} [sw]        black-and-white variant allowed (permit drawings)
 * @property {string} [lph]        HOAI work phase the lens serves
 */

// Typed directly (top-down) so the literal's `sicht` values keep their Sicht type (cf. browserSpeicher.js).
/** @type {Brille[]} */
const ROH = [
  { id: "eingabe", label: "Eingabe", kurz: "Eingabe", zweck: "Modellieren und Status setzen — alles sichtbar",
    sicht: { bestand: "normal", abbruch: "normal", neubau: "normal", temporaer: "normal", ohne: "normal" }, massstab: 100, tiefe: "kern" },
  { id: "bestand", label: "Bestand", kurz: "Bestand", zweck: "Bauaufnahme prüfen — nur was heute steht",
    sicht: { bestand: "normal", abbruch: "normal", neubau: "aus", temporaer: "aus", ohne: "normal" }, massstab: 100, tiefe: "kern", lph: "1–2" },
  { id: "abbruch", label: "Abbruchplan", kurz: "Abbruch", zweck: "Rückbau planen (DIN 18459) — Abbruch kräftig, Bestand blass",
    sicht: { bestand: "blass", abbruch: "hervor", neubau: "aus", temporaer: "normal", ohne: "normal" }, massstab: 100, tiefe: "kern", lph: "4–5" },
  { id: "bauantrag", label: "Bauantrag (LPH 4)", kurz: "Bauantrag", zweck: "Bauvorlage nach Landes-Bauvorlagenverordnung — grau/gelb/rot",
    sicht: { bestand: "normal", abbruch: "normal", neubau: "normal", temporaer: "aus", ohne: "normal" }, massstab: 100, tiefe: "kern", sw: true, lph: "4" },
  { id: "ausfuehrung", label: "Ausführung 1:50 (LPH 5)", kurz: "1:50", zweck: "Werkplanung — alle Schichten, Abbruch auf eigenem Blatt",
    sicht: { bestand: "blass", abbruch: "aus", neubau: "hervor", temporaer: "normal", ohne: "normal" }, massstab: 50, tiefe: "schichten", lph: "5" },
  { id: "ausschreibung", label: "Ausschreibung", kurz: "Mengen", zweck: "Mengen und Material — getrennt nach Status",
    sicht: { bestand: "blass", abbruch: "hervor", neubau: "hervor", temporaer: "normal", ohne: "normal" }, massstab: 100, tiefe: "mengen", lph: "6" },
  { id: "bauleitung", label: "Bauleitung", kurz: "Bau", zweck: "Baufortschritt nach Bauabschnitt",
    sicht: { bestand: "blass", abbruch: "normal", neubau: "normal", temporaer: "normal", ohne: "normal" }, massstab: 100, tiefe: "kern", lph: "8" },
];

/** @type {ReadonlyArray<Readonly<Brille>>} */
export const BRILLEN = Object.freeze(ROH.map((b) => Object.freeze({ ...b, sicht: Object.freeze(b.sicht) })));

/** Default lens: everything visible, nothing changes compared to before 97-03. */
export const STANDARD_BRILLE = "eingabe";

/**
 * Lens by id; unknown ids fall back to the input lens (never an empty plan).
 * @param {string|null|undefined} id
 * @returns {Readonly<Brille>}
 */
export function brilleVon(id) {
  return BRILLEN.find((b) => b.id === id) || /** @type {Readonly<Brille>} */ (BRILLEN.find((b) => b.id === STANDARD_BRILLE));
}

/**
 * How an element of this status looks under the lens. Unknown/missing status → "ohne".
 * @param {Readonly<Brille>} brille
 * @param {string|null|undefined} status
 * @returns {Sicht}
 */
export function brilleSicht(brille, status) {
  const k = status === "bestand" || status === "abbruch" || status === "neubau" || status === "temporaer" ? status : "ohne";
  return brille.sicht[k];
}

/**
 * @param {Readonly<Brille>} brille
 * @param {string|null|undefined} status
 * @returns {boolean} false only when the lens hides this status
 */
export function zeigtStatus(brille, status) {
  return brilleSicht(brille, status) !== "aus";
}

/**
 * Elements visible under the lens (same objects, same order). The default lens returns the
 * input array itself, so plan and 3D render exactly as before 97-03.
 * @template {{status?: string|null}} T
 * @param {Readonly<Brille>} brille
 * @param {T[]} liste
 * @returns {T[]}
 */
export function sichtbarUnter(brille, liste) {
  if (!Array.isArray(liste)) return [];
  if (Object.values(brille.sicht).every((s) => s !== "aus")) return liste;
  return liste.filter((el) => zeigtStatus(brille, el?.status));
}

/** Mix a hex colour with black (anteil 0..1) — the outline is a darker shade of the status fill. */
function dunkler(hex, anteil) {
  const n = parseInt(hex.slice(1), 16);
  const k = (v) => Math.round(v * (1 - anteil)).toString(16).padStart(2, "0");
  return `#${k((n >> 16) & 255)}${k((n >> 8) & 255)}${k(n & 255)}`;
}

/**
 * Plan look of an element with a renovation status under a lens (97-04): fill and outline from
 * the ONE status table (statusDarstellung), dashed outline for demolition, faded or emphasised
 * per lens, line weight per scale. Line weights after ISO 128-23 / DIN 1356-1: cut edges
 * 0.5 mm at 1:100 and 0.7 mm at 1:50 → factor 1.4 for the 1:50 lens; values in SVG units of
 * the plan, relative to the existing 0.6 outline.
 * Returns null for elements WITHOUT status (they keep today's look — nothing invented) and for
 * hidden statuses.
 * @param {Readonly<Brille>|null|undefined} brille
 * @param {string|null|undefined} status
 * @param {{sw?: boolean}} [opt] sw: black-and-white variant (permit lens only)
 * @returns {{fill: string, stroke: string, dash: string|undefined, opacity: number, strokeWidth: number, sicht: Sicht, schraffur?: boolean, leer?: boolean}|null}
 */
export function planDarstellung(brille, status, { sw = false } = {}) {
  if (!brille || !(status === "bestand" || status === "abbruch" || status === "neubau" || status === "temporaer")) return null;
  const sicht = brilleSicht(brille, status);
  if (sicht === "aus") return null;
  const d = statusDarstellung(status);
  const gewicht = brille.massstab <= 50 ? 1.4 : 1;
  // 97-04b: black-and-white variant for permit drawings (only lenses with `sw`): the status
  // table's `sw` column — Bestand light grey, Abbruch outline dashed without fill, Neubau 45°
  // hatch (drawn by the caller: `schraffur: true`), temporary dash-dot.
  if (sw && brille.sw) {
    return {
      fill: d.sw === "hellgrau" ? "#d4d4d8" : "#ffffff",
      stroke: "#18181b",
      dash: d.strich || undefined,
      opacity: sicht === "blass" ? 0.35 : 1,
      strokeWidth: Math.round((sicht === "hervor" ? 1.2 : 0.6) * gewicht * 100) / 100,
      sicht,
      schraffur: d.sw === "schraffur-45",
      leer: d.sw === "nur-kontur-gestrichelt",
    };
  }
  return {
    fill: d.hex,
    stroke: dunkler(d.hex, 0.45),
    dash: d.strich || undefined,
    opacity: sicht === "blass" ? 0.35 : 1,
    strokeWidth: Math.round((sicht === "hervor" ? 1.2 : 0.6) * gewicht * 100) / 100,
    sicht,
  };
}

/**
 * 45° hatch of a CONVEX polygon as line segments (97-04b, S/W permit drawings and vector PDF).
 * Lines x − z = c at spacing `abstand` (same unit as the points), clipped to the polygon.
 * @param {Array<{x: number, z: number}>} pts convex polygon
 * @param {number} abstand distance between hatch lines (perpendicular), > 0
 * @returns {Array<[{x: number, z: number}, {x: number, z: number}]>}
 */
export function schraffur45(pts, abstand) {
  if (!Array.isArray(pts) || pts.length < 3 || !(abstand > 0)) return [];
  const c = pts.map((p) => p.x - p.z);
  const schritt = abstand * Math.SQRT2; // spacing along the c axis for perpendicular distance `abstand`
  /** @type {Array<[{x: number, z: number}, {x: number, z: number}]>} */
  const out = [];
  for (let k = Math.ceil(Math.min(...c) / schritt) * schritt; k <= Math.max(...c); k += schritt) {
    const treffer = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const fa = a.x - a.z - k, fb = b.x - b.z - k;
      if ((fa <= 0 && fb > 0) || (fa > 0 && fb <= 0)) {
        const t = fa / (fa - fb);
        treffer.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
      }
    }
    if (treffer.length >= 2) out.push([treffer[0], treffer[1]]);
  }
  return out;
}
