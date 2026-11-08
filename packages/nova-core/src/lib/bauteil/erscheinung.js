// Appearance catalogue for the building studio. The single source is the harness
// catalogue (harness/harness/bauteilkatalog/daten), read here and not copied into
// a second list. MATERIAL_KATALOG in materialien.js stays the building-physics
// source (lambda, mu, hatch of the layer stack) and is not this list.
//
// In:  baustoffe.json and typen/grundbestand.json.
// Out: lookups by key, the three choice lists (wall surface, frame, glass, floor
//      finish) and which vendored colour map, if any, belongs to a texture id.
// A texture id is only reported when this repo actually contains that map
// (see src/assets/erscheinung/HERKUNFT.md). Other URNs stay colour-only.

import baustoffDatei from "../../../../../harness/harness/bauteilkatalog/daten/baustoffe.json";
import typenDatei from "../../../../../harness/harness/bauteilkatalog/daten/typen/grundbestand.json";

/**
 * @typedef {{ schluessel: string, name: string, farbe: string, textur: string|null, werkstoffklasse: string }} Erscheinungsstoff
 * @typedef {{ id: string, name: string, sicht: Erscheinungsstoff|null, muster: string|null }} Bodenbelag
 */

/** Colour maps we downloaded and checked. Key = catalog `textur` value. Span in metres is the asset page. */
const MUSTER = Object.freeze({
  "ambientcg:Wood051": Object.freeze({ id: "Wood051", spanne_m: 0.8 }),
  "ambientcg:Tiles074": Object.freeze({ id: "Tiles074", spanne_m: 2.1 }),
});

/** Wall surfaces: finishes and masonry, not insulation or glass. */
const WAND_KLASSEN = new Set(["putz", "mauerwerk", "holz", "holzwerkstoff", "stahlbeton", "beton", "leichtbeton"]);
/** Frames: solid frame materials, not membranes. */
const RAHMEN_KLASSEN = new Set(["metall", "holz", "kunststoff"]);

/** @type {Erscheinungsstoff[]} */
const STOFFE = (baustoffDatei.baustoffe || []).map((/** @type {any} */ r) => ({
  schluessel: String(r.schluessel),
  name: String(r.name || r.schluessel),
  farbe: typeof r.farbe === "string" && r.farbe.startsWith("#") ? r.farbe : "#94a3b8",
  textur: typeof r.textur === "string" ? r.textur : null,
  werkstoffklasse: String(r.werkstoffklasse || ""),
}));

const NACH_SCHLUESSEL = new Map(STOFFE.map((s) => [s.schluessel, s]));

/**
 * One appearance material, or null when the key is missing or unknown.
 * @param {string|null|undefined} schluessel catalogue key (`parkett-350`, …)
 * @returns {Erscheinungsstoff|null}
 */
export function baustoff(schluessel) {
  if (!schluessel) return null;
  return NACH_SCHLUESSEL.get(String(schluessel)) || null;
}

/**
 * Vendored colour-map id for a catalog texture reference, or null.
 * Null means we do not claim a file for that URN.
 * @param {string|null|undefined} textur catalog field, e.g. `ambientcg:Wood051`
 * @returns {string|null} `Wood051` or `Tiles074`
 */
export function musterBild(textur) {
  if (!textur) return null;
  return MUSTER[textur]?.id || null;
}

/**
 * Real-world width of one repeat of a vendored map, in metres.
 * @param {string|null|undefined} muster `Wood051` or `Tiles074`
 * @returns {number} metres; 1 when the map is unknown
 */
export function musterSpanne_m(muster) {
  const treffer = Object.values(MUSTER).find((m) => m.id === muster);
  return treffer ? treffer.spanne_m : 1;
}

/** @param {Set<string>} klassen @returns {Erscheinungsstoff[]} */
function klasse(klassen) {
  return STOFFE.filter((s) => klassen.has(s.werkstoffklasse));
}

/**
 * Wall surface choices (plaster, masonry, timber, concrete).
 * Floor-finish materials stay on the floor list, even when their class is timber.
 * @returns {Erscheinungsstoff[]}
 */
export function wandOberflaechen() {
  const boden = new Set(bodenBelaege().map((b) => b.sicht?.schluessel).filter(Boolean));
  return klasse(WAND_KLASSEN).filter((s) => !boden.has(s.schluessel));
}

/** Frame choices (metal, timber, plastic). @returns {Erscheinungsstoff[]} */
export function rahmenBaustoffe() { return klasse(RAHMEN_KLASSEN); }

/** Glass choices. @returns {Erscheinungsstoff[]} */
export function glasBaustoffe() { return klasse(new Set(["glas"])); }

/**
 * Floor finishes from the type catalogue (`IfcCovering` / `FLOORING`).
 * The visible layer is the outer finish, else the first layer.
 * @returns {Bodenbelag[]}
 */
export function bodenBelaege() {
  const typen = typenDatei.typen || [];
  return typen.filter((/** @type {any} */ t) => t?.ifc?.predefined_type === "FLOORING").map((/** @type {any} */ t) => {
    const schichten = Array.isArray(t.schichten) ? t.schichten : [];
    const aussen = schichten.find((/** @type {any} */ s) => s?.rolle === "Outer finish") || schichten[0];
    const sicht = baustoff(aussen?.baustoff);
    return {
      id: String(t.schluessel),
      name: sicht ? `${sicht.name}` : String(t.schluessel),
      sicht,
      muster: sicht ? musterBild(sicht.textur) : null,
    };
  });
}

/**
 * Floor finish by type key, or null.
 * @param {string|null|undefined} id type key (`estrich-parkett-15-cm`, …)
 * @returns {Bodenbelag|null}
 */
export function bodenBelag(id) {
  if (!id) return null;
  return bodenBelaege().find((b) => b.id === String(id)) || null;
}
