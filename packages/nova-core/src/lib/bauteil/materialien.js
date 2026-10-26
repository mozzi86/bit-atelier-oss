// Material catalogue of the build-up tables (moved from @designer/lib/bauteilAufbau.js in phase 107-03, D-BK-24:
// moving with a re-export is no change to the phase-44 file's behaviour). Reason: the layer function of a build-up
// (bauteil/aufbauten.js, @core) needs the material CATEGORY ("Massiv", "Holz", "Dämmung" …) and @core may not import
// @designer (eslint boundary rule). bauteilAufbau.js imports and re-exports MATERIAL_KATALOG and materialById, so every
// `@designer/lib/bauteilAufbau` import stays valid.
//
// Per material: id, name, kategorie, lambda (W/(m·K)), mu (-), optional sd (m, fixed diffusion-equivalent air layer of a
// membrane), luft ("ruhend" | "belueftet"), schicht (AVA bucket of bimClassification.SCHICHTEN or null), color, hatch
// (layer-stack drawing) and, new in 107-03, optional `dichte` (bulk density in kg/m³) and `textur` (texture id of the 3D
// view; no material carries one yet — the field is the place for 107-12 and the object catalogue).
//
// [ASSUMED] lambda (W/mK) and mu (-): usual design guide values (order of magnitude of DIN 4108-4, one value per range).
// [ASSUMED] dichte (kg/m³): usual bulk densities, one value per material (reinforced concrete 2400, calcium silicate 1800 as
// the catalogue name says, clay brick 1800, vertically perforated brick 800, aerated concrete 500, mineral wool 30-40, EPS 20,
// XPS 35, PUR/PIR 32, wood fibre 160, cellulose 50, plasterboard 900, OSB 650, softwood 500, gypsum plaster 1200, lime-cement
// plaster 1800, clay plaster 1600, PE vapour barrier 950, bitumen membrane 1100). Way to a proven value: the manufacturer's
// declaration of performance or DIN 4108-4 Tab. 1 / DIN EN ISO 10456 for the actual product.
//
// In: nothing. Out: MATERIAL_KATALOG, materialById(). No imports, no I/O (node-testable).

/**
 * @typedef {object} Material
 * @property {string} id
 * @property {string} name                German display name
 * @property {string} kategorie           "Massiv" | "Holz" | "Platte" | "Putz" | "Dämmung" | "Bahn" | "Luft"
 * @property {number|null} lambda         thermal conductivity in W/(m·K), null for an air layer
 * @property {number} mu                  water vapour resistance factor (-)
 * @property {number} [sd]                fixed sd value in m (membranes)
 * @property {"ruhend"|"belueftet"} [luft] air layer kind
 * @property {string|null} schicht        AVA layer bucket (bimClassification SCHICHTEN) or null
 * @property {number} [dichte]            bulk density in kg/m³ [ASSUMED guide value], absent = unknown
 * @property {string} [textur]            texture id of the 3D view, absent = none
 * @property {string} color               display colour (hex)
 * @property {string} hatch               hatch pattern of the layer-stack drawing
 */

/**
 * The catalogue (22 building materials).
 * @type {Material[]}
 */
export const MATERIAL_KATALOG = [
  { id: "beton", name: "Stahlbeton", kategorie: "Massiv", lambda: 2.3, mu: 100, schicht: "Stahlbeton", dichte: 2400, color: "#9aa6b2", hatch: "concrete" },
  { id: "ks", name: "Kalksandstein (1800)", kategorie: "Massiv", lambda: 0.99, mu: 10, schicht: "Kalksandstein", dichte: 1800, color: "#94a3b8", hatch: "block" },
  { id: "klinker", name: "Klinker / Vollziegel", kategorie: "Massiv", lambda: 0.81, mu: 100, schicht: "Klinker", dichte: 1800, color: "#b45309", hatch: "brick" },
  { id: "hlz", name: "Hochlochziegel (Poroton)", kategorie: "Massiv", lambda: 0.12, mu: 8, schicht: null, dichte: 800, color: "#c2703d", hatch: "brick" },
  { id: "porenbeton", name: "Porenbeton", kategorie: "Massiv", lambda: 0.11, mu: 8, schicht: null, dichte: 500, color: "#e5e7eb", hatch: "block" },
  { id: "mw035", name: "Mineralwolle WLG 035", kategorie: "Dämmung", lambda: 0.035, mu: 1, schicht: "Dämmung", dichte: 40, color: "#fde68a", hatch: "insul" },
  { id: "mw040", name: "Mineralwolle WLG 040", kategorie: "Dämmung", lambda: 0.04, mu: 1, schicht: "Dämmung", dichte: 30, color: "#fde68a", hatch: "insul" },
  { id: "eps032", name: "EPS WLG 032", kategorie: "Dämmung", lambda: 0.032, mu: 50, schicht: "Dämmung", dichte: 20, color: "#f5f5f4", hatch: "insul" },
  { id: "xps", name: "XPS", kategorie: "Dämmung", lambda: 0.035, mu: 100, schicht: "Dämmung", dichte: 35, color: "#a5f3fc", hatch: "insul" },
  { id: "pur", name: "PUR/PIR", kategorie: "Dämmung", lambda: 0.024, mu: 60, schicht: "Dämmung", dichte: 32, color: "#fbcfe8", hatch: "insul" },
  { id: "holzfaser", name: "Holzfaserdämmung", kategorie: "Dämmung", lambda: 0.042, mu: 5, schicht: "Dämmung", dichte: 160, color: "#d6b38a", hatch: "insul" },
  { id: "zellulose", name: "Zellulose (Einblas)", kategorie: "Dämmung", lambda: 0.04, mu: 2, schicht: "Dämmung", dichte: 50, color: "#e7e5e4", hatch: "insul" },
  { id: "gk", name: "Gipskarton", kategorie: "Platte", lambda: 0.25, mu: 8, schicht: "Gipskarton", dichte: 900, color: "#e2e8f0", hatch: "none" },
  { id: "osb", name: "OSB-Platte", kategorie: "Platte", lambda: 0.13, mu: 200, schicht: "Holz", dichte: 650, color: "#d6b38a", hatch: "wood" },
  { id: "holz", name: "Nadelholz", kategorie: "Holz", lambda: 0.13, mu: 40, schicht: "Holz", dichte: 500, color: "#92400e", hatch: "wood" },
  { id: "gipsputz", name: "Gipsputz (innen)", kategorie: "Putz", lambda: 0.51, mu: 10, schicht: "Putz", dichte: 1200, color: "#e2e8f0", hatch: "none" },
  { id: "kalkzementputz", name: "Kalkzementputz (außen)", kategorie: "Putz", lambda: 1.0, mu: 25, schicht: "Putz", dichte: 1800, color: "#d1d5db", hatch: "none" },
  { id: "lehmputz", name: "Lehmputz", kategorie: "Putz", lambda: 0.8, mu: 10, schicht: "Putz", dichte: 1600, color: "#ca8a04", hatch: "none" },
  { id: "dampfbremse", name: "Dampfbremse PE (sd 20 m)", kategorie: "Bahn", lambda: 0.2, mu: 1, sd: 20, schicht: null, dichte: 950, color: "#60a5fa", hatch: "none" },
  { id: "bitumenbahn", name: "Bitumenbahn (sd 300 m)", kategorie: "Bahn", lambda: 0.17, mu: 1, sd: 300, schicht: null, dichte: 1100, color: "#334155", hatch: "none" },
  { id: "luft", name: "Luftschicht (ruhend)", kategorie: "Luft", lambda: null, mu: 1, luft: "ruhend", schicht: null, color: "#f1f5f9", hatch: "none" },
  { id: "luftbel", name: "Luftschicht (hinterlüftet)", kategorie: "Luft", lambda: null, mu: 1, luft: "belueftet", schicht: null, color: "#f1f5f9", hatch: "none" },
];

/**
 * @param {string|null|undefined} id MATERIAL_KATALOG id
 * @returns {Material|null} the material, or null for an unknown id
 */
export const materialById = (id) => MATERIAL_KATALOG.find((m) => m.id === id) || null;
