// 106-01: the four pointing states (focus / selected / warning / error) and how each one LOOKS,
// in one frozen table. Every viewer (IFC viewer, BIM studio, later VR) takes its highlight look
// from here, so "what is under the pointer" and "what is wrong with this element" read the same
// everywhere. Concept: phase 106 guard rail 5 — colour (app token) PLUS form (outline style,
// symbol), never colour alone (FARB-01).
//
// Colour sources (the app has NO JS-side token export; 3D code hardcodes hex, so these hex values
// copy the LIGHT-theme tokens of packages/nova-core/src/index.css; the 3D views are light-only, the
// dark-theme tokens (--warnung 46 97% 55%, --fehler 0 94% 70%) are deliberately NOT followed).
// tests/unit/zeigen-farben-10601.test.js parses index.css and compares, so a token change that is
// not copied here turns the unit run red:
//   fokus    #0d968b  --ring (index.css:37, 175 84% 32%). There is no "akzent" token in this app — the
//                     focus ring colour is the closest thing [ASSUMED]. (Earlier teal-600 #0d9488 was a
//                     near-copy that did not equal the token; BIM aura no longer uses it.)
//   auswahl  #3b82f5  SELECT_COLOR [0.23, 0.51, 0.96] of ifcGeometry.js:38 (stays the selection blue;
//                     no token, compared against SELECT_COLOR in the same test).
//   warnung  #542508  --warnung (index.css:26, 23 83% 18%).
//   fehler   #a91919  --fehler (index.css:29, 0 74% 38%).
//
// Colour-vision check (node .claude/skills/bit-farbsehen/scripts/farbsehen.mjs, light background):
//   all four >= 3:1 against white (3.65 / 3.69 / 12.77 / 7.39).
//   FINDING (reported, colour NOT changed, FARB-06): fokus/auswahl are confusable for tritan vision
//   (OKLab dE 0.044 < 0.06); warnung/fehler are tight for protan vision (dE 0.086 < 0.10).
//   Both pairs are therefore separated by FORM as well: fokus = dotted outline, auswahl = solid
//   outline; warnung = dashed outline, fehler = solid outline + "!" symbol. A caller that shows
//   two of these states must not rely on the hue.
//
// In:  nothing. Out: ZEIGE_ZUSTAENDE, ZEIGE_ZUSTAND_NAMEN, ZEIGE_CSS_RAND, istZeigeZustand(). No I/O, no three.

/**
 * @typedef {Object} ZeigeZustand
 * @property {string} hex        Colour "#rrggbb" (sRGB), for materials, lines and CSS.
 * @property {readonly number[]} rgb  The same colour as 3 numbers 0..1 (raw sRGB, written 1:1
 *                               into vertex-colour buffers like statusRgb() does).
 * @property {'durchgezogen'|'gestrichelt'|'gepunktet'} umriss  Outline form (second, non-colour cue).
 * @property {string|null} strich  Dash pattern "dash gap" in outline units (1 unit = strichEinheit
 *                               of hervorhebung(), default 0.05 m); null = solid.
 * @property {string|null} symbol  Marker glyph drawn next to the element, null = none.
 * @property {string} label      German UI text; pass it to t() (key = the German string).
 * @property {number} rang       Priority 1..4 when several states sit on one element (higher wins
 *                               the fill colour; every outline is still drawn).
 */

/**
 * "#rrggbb" to [r, g, b] in 0..1.
 * @param {string} hex
 * @returns {readonly number[]}
 */
function rgbAus(hex) {
  const n = parseInt(hex.slice(1), 16);
  return Object.freeze([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);
}

/**
 * @param {string} hex
 * @param {'durchgezogen'|'gestrichelt'|'gepunktet'} umriss
 * @param {string|null} strich
 * @param {string|null} symbol
 * @param {string} label
 * @param {number} rang
 * @returns {Readonly<ZeigeZustand>}
 */
function zustand(hex, umriss, strich, symbol, label, rang) {
  return Object.freeze({ hex, rgb: rgbAus(hex), umriss, strich, symbol, label, rang });
}

/**
 * Look per pointing state. Keys: fokus (under the pointer), auswahl (selected), warnung, fehler.
 * @type {Readonly<Record<'fokus'|'auswahl'|'warnung'|'fehler', Readonly<ZeigeZustand>>>}
 */
export const ZEIGE_ZUSTAENDE = Object.freeze({
  fokus: zustand("#0d968b", "gepunktet", "1.5 2.5", null, "Unter dem Zeiger", 1),
  auswahl: zustand("#3b82f5", "durchgezogen", null, null, "Ausgewählt", 2),
  warnung: zustand("#542508", "gestrichelt", "6 3", null, "Warnung am Bauteil", 3),
  fehler: zustand("#a91919", "durchgezogen", null, "!", "Fehler am Bauteil", 4),
});

/**
 * CSS border-style per outline form, for DOM swatches that mirror the 3D outline (overlay legend).
 * @type {Readonly<Record<'durchgezogen'|'gestrichelt'|'gepunktet', string>>}
 */
export const ZEIGE_CSS_RAND = Object.freeze({ durchgezogen: "solid", gestrichelt: "dashed", gepunktet: "dotted" });

/** The state names in priority order (lowest first). */
export const ZEIGE_ZUSTAND_NAMEN = Object.freeze(["fokus", "auswahl", "warnung", "fehler"]);

/**
 * True when `name` is one of the four pointing states.
 * @param {unknown} name
 * @returns {boolean}
 */
export function istZeigeZustand(name) {
  return typeof name === "string" && Object.hasOwn(ZEIGE_ZUSTAENDE, name);
}
