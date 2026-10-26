// Gemeinsames Gebäudemodell (Meter-Einheiten) — Single Source of Truth für
// 3D-Darstellung, später 2D-Schnitt und IFC-Export. Koordinaten in der XZ-Ebene
// (y = oben). Footprint-Polygon zentriert um den Ursprung.

import { metersPerPixel } from "@core/lib/geo";
import { WALL_COMPOSITES, aufbauById, aufbautenListe } from "./bauteil/aufbauten.js";
import { elevationOf, geschosshoehe, geschosseAus, DECKEN_STANDARD } from "./bauteil/hoehen.js";

// ---- Wand-Aufbauten (Composites, mehrschichtig) ---------------------------
// Schichten von außen (oben in der Liste) nach innen. thickness in mm.
// material = Id im MATERIAL_KATALOG (@designer/lib/bauteilAufbau — Phase 44,
// gemeinsame Kennwert-Quelle für Bauphysik/Schallschutz). rw = bewertetes
// Schalldämm-Maß R'w in dB, [ASSUMED]-Richtwert je Aufbau (Phase 39).
// 97-02a: defined in the ONE build-up table (bauteil/aufbauten.js), re-exported here.
// 107-03 (D-BK-22): compositeById asks the build-ups of the PROJECT first (fachlayer aufbauten_layer, handed over through
// setzeProjektAufbauten), then the constants; aufbautenListe() is the list for selects (project first). WALL_COMPOSITES stays
// the constant table.
export { WALL_COMPOSITES, aufbautenListe };
export const compositeById = aufbauById;

// ---- Fenster-Bibliothek (Typen mit Flügeln/Sprossen) ----------------------
// w/h/sill in m; cols = Flügel nebeneinander, rows = Felder übereinander.
// g/ug seit Phase 45 (KLIMA-03): [ASSUMED] Verglasungs-Richtwerte 2-Scheiben-
// Wärmeschutzverglasung (g⊥ 0,60 nach EN 410, Ug 1,1 W/(m²K)); gemeinsame
// Quelle für Raumklima (45) und Bauphysik. Der 0,9-Faktor auf g gehört NUR zum
// Heizfall (DIN V 4108-6/18599), nicht ins Sonneneintragskennwert-Verfahren.
// Kein Produktnachweis — bei bekannter Verglasung überschreiben.
export const WINDOW_TYPES = [
  { id: "single", name: "Einflügelig", w: 1.0, h: 1.4, sill: 0.9, cols: 1, rows: 2, g: 0.6, ug: 1.1 },
  { id: "double", name: "Zweiflügelig", w: 1.8, h: 1.4, sill: 0.9, cols: 2, rows: 2, g: 0.6, ug: 1.1 },
  { id: "triple", name: "Dreiflügelig", w: 2.7, h: 1.4, sill: 0.9, cols: 3, rows: 2, g: 0.6, ug: 1.1 },
  { id: "hung", name: "Doppel-Hung", w: 1.0, h: 1.6, sill: 0.8, cols: 1, rows: 2, g: 0.6, ug: 1.1 },
  { id: "hungDouble", name: "Doppel-Hung 2", w: 1.8, h: 1.6, sill: 0.8, cols: 2, rows: 2, g: 0.6, ug: 1.1 },
  { id: "french", name: "Boden-Fenster", w: 1.6, h: 2.1, sill: 0.0, cols: 2, rows: 3, g: 0.6, ug: 1.1 },
];
export const windowTypeById = (id) => WINDOW_TYPES.find((w) => w.id === id) || WINDOW_TYPES[0];

// ---- Tür-Bibliothek (sill = 0, mit Türblatt) ------------------------------
export const DOOR_TYPES = [
  { id: "single", name: "Tür einflügelig", w: 1.0, h: 2.1, sill: 0, cols: 1, rows: 1, glass: false },
  { id: "doubleLeaf", name: "Tür zweiflügelig", w: 1.8, h: 2.1, sill: 0, cols: 2, rows: 1, glass: false },
  { id: "glassDoor", name: "Glastür", w: 1.0, h: 2.1, sill: 0, cols: 1, rows: 3, glass: true },
  { id: "sliding", name: "Schiebetür", w: 2.0, h: 2.2, sill: 0, cols: 2, rows: 1, glass: true },
  { id: "entrance", name: "Haustür", w: 1.2, h: 2.2, sill: 0, cols: 1, rows: 2, glass: false },
];
export const doorTypeById = (id) => DOOR_TYPES.find((d) => d.id === id) || DOOR_TYPES[0];
// 107-04: opening without a filling (kind "oeffnung", IfcOpeningElement without window/door): sizes only, no sash, door leaf or glazing.
// The type size is the default as long as the opening carries no sizes of its own (width/height/sill, see bauteil/oeffnungen.js).
// [ASSUMED] 1.00 × 2.10 m from the wall bottom = a passage at door height (sizes of the type "Tür einflügelig" in DOOR_TYPES);
// no norm value for a wall opening — way to a proven value: the size from the planning of that opening; overridable per opening.
/**
 * Type table of the opening without a filling (kind "oeffnung"): `w` width, `h` height, `sill` sill, all in m; `cols`/`rows` unused (no glazing).
 * @type {Array<{id: string, name: string, w: number, h: number, sill: number, cols: number, rows: number, glass: boolean}>}
 */
export const OEFFNUNG_TYPES = [
  { id: "oeffnung", name: "Öffnung", w: 1.0, h: 2.1, sill: 0, cols: 1, rows: 1, glass: false },
];
/**
 * Type of an opening without a filling by id (unknown id = the first entry).
 * @param {string|undefined} id type id
 * @returns {{id: string, name: string, w: number, h: number, sill: number, cols: number, rows: number, glass: boolean}} sizes in m
 */
export const oeffnungTypeById = (id) => OEFFNUNG_TYPES.find((o) => o.id === id) || OEFFNUNG_TYPES[0];
// Einheitlicher Zugriff nach Art.
export const openingTypeById = (kind, id) => (kind === "door" ? doorTypeById(id) : kind === "oeffnung" ? oeffnungTypeById(id) : windowTypeById(id));
const positivM = (/** @type {any} */ v) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null; };
const nichtNegativM = (/** @type {any} */ v) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n >= 0 ? n : null; };
/**
 * Own sizes of an opening record laid over its type, field by field (107-04): `width`/`height` must be positive, `sill` not negative, anything else
 * (0, negative, text, empty) falls back to the type size. The ONE rule behind bauteil/oeffnungen.js oeffnungsMasse() and the quantity list
 * (bimClassification.js, which cannot import oeffnungen.js: import cycle through steckbrief.js).
 * @param {any} o opening record (`kind`, `typeId`, optional `width`, `height`, `sill` in m)
 * @returns {{w: number, h: number, sill: number}} width, height, sill above the wall bottom (as stored, no anchor conversion), all in m
 */
export function oeffnungsGroesse(o) {
  const ty = openingTypeById(o?.kind, o?.typeId);
  return { w: positivM(o?.width) ?? ty.w, h: positivM(o?.height) ?? ty.h, sill: nichtNegativM(o?.sill) ?? ty.sill };
}
export const compositeTotalM = (id) => {
  const c = compositeById(id);
  return c ? c.skins.reduce((s, k) => s + k.thickness, 0) / 1000 : null;
};

// px-Polygon (designated_areas) → Meter-Polygon [{x,z}], zentriert auf den Schwerpunkt.
export function footprintToMeters(points, parcel) {
  if (!points || points.length < 3) return null;
  const mpp = metersPerPixel(parcel);
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => ({ x: (p.x - cx) * mpp, z: (p.y - cy) * mpp }));
}

export const DEFAULT_FOOTPRINT = [
  { x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 },
];

// Erzeugt das Gebäudemodell aus Footprint + Geschossparametern.
/**
 * @param {{footprintM?: Array<{x: number, z: number}>|null, storeys?: number, storeyHeight?: number,
 *          wallThickness?: number, wallComposite?: any, parapet?: {enabled: boolean, height: number},
 *          huelleBezug?: string|null, geschosse?: Array<{level: number, name?: string, hoehe_m: number}>|null,
 *          deckenDicke?: number, deckenBezug?: "oben"|"unten"}} [q]
 *   footprintM in Metern (x/z), storeyHeight/wallThickness in Metern.
 *   huelleBezug (107-01, D-BK-02; stored as `huelle_bezug`): "center" (default = today: the hull wall is centred on the
 *   footprint line), "outside" = the footprint line is the OUTER face of the hull wall (the body lies inside the footprint),
 *   "inside" = the footprint line is the INNER face (the body lies outside it). The words mean the same for either winding
 *   of the footprint: the stored wall `refLine` (side of the line on which the body lies, bauteil/referenz.js) is swapped
 *   when the footprint runs the other way round (107-01 review fix; before, "outside" put the wall outside for one winding
 *   and inside for the other). Only `walls` and `parapets` carry it as `refLine`; footprint, slabs and spaces always stay
 *   on the footprint line (site coverage and zones do not move). Absent/"center" = byte-identical objects as before.
 *   geschosse (107-02, D-BK-05; programme field `geschosse`): optional storey table [{level, name?, hoehe_m}] in m. With it the
 *   storey elevations are the running sum of the table heights (`storeys[].elevation`), every storey wall has the height of
 *   its storey, `totalHeight` is the sum; `storeyHeight` stays the uniform value for readers that only need one number.
 *   Absent/empty = `storeys × storeyHeight` exactly as before (same arithmetic, byte-identical objects).
 *   deckenDicke (m, default 0.25) and deckenBezug ("unten" default = the slab stands on its plane, "oben" = it hangs below it)
 *   describe the HULL slabs (`slabs`). Only a value other than the default writes `dicke_m` / `bezug` on the slab, so the
 *   default model has no new fields (107-02, D-BK-03: the two slab conventions are NOT unified here).
 */
export function createBuildingModel({ footprintM, storeys = 4, storeyHeight = 3, wallThickness = 0.3, wallComposite = null, parapet = { enabled: true, height: 1.0 }, huelleBezug = "center", geschosse = null, deckenDicke = DECKEN_STANDARD.huelle.dicke_m, deckenBezug = DECKEN_STANDARD.huelle.bezug } = {}) {
  const fp = (footprintM && footprintM.length >= 3) ? footprintM : DEFAULT_FOOTPRINT;
  const n = Math.max(1, Math.round(storeys));
  const sh = storeyHeight;
  // 107-02: storey table → elevations by sum (elevationOf), else level × height as before.
  const tab = Array.isArray(geschosse) && geschosse.length ? geschosseAus({ geschosse, storeyHeight }) : null;
  const elev = (/** @type {number} */ l) => (tab ? elevationOf(l, tab) : l * sh);
  const hoeheJe = (/** @type {number} */ l) => (tab ? geschosshoehe(l, tab) : sh);
  const slabFelder = {
    ...(deckenDicke > 0 && deckenDicke !== DECKEN_STANDARD.huelle.dicke_m ? { dicke_m: deckenDicke } : {}),
    ...(deckenBezug === "oben" ? { bezug: "oben" } : {}),
  };
  const wt = compositeTotalM(wallComposite) || wallThickness;
  // 107-01: reference line of the hull walls; "center" adds no field (old projects stay unchanged).
  // The wall normal n = (−dz, dx) points INTO the building for a footprint with a positive shoelace sum in x/z (the
  // default rectangle) and OUT of it for the opposite winding; the body of "outside" must stay inside the footprint for
  // both, so the stored side is swapped for the reversed winding.
  const umlauf2 = fp.reduce((s, p, i) => { const q = fp[(i + 1) % fp.length]; return s + (p.x * q.z - q.x * p.z); }, 0);
  const hSeite = umlauf2 < 0 ? { outside: "inside", inside: "outside" }[huelleBezug] : huelleBezug;
  const hRef = huelleBezug === "outside" || huelleBezug === "inside" ? { refLine: hSeite } : {};

  const storeyList = [];
  const walls = [];
  const slabs = [];
  const spaces = [];
  const parapets = [];

  for (let lvl = 0; lvl < n; lvl++) {
    const elevation = elev(lvl);
    const hLvl = hoeheJe(lvl);
    const lvlName = (tab && Array.isArray(geschosse) && geschosse.find((g) => Math.round(Number(g?.level)) === lvl)?.name) || (lvl === 0 ? "EG" : `${lvl}. OG`);
    storeyList.push({ level: lvl, elevation, name: lvlName });
    // Wände entlang jeder Footprint-Kante
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i];
      const b = fp[(i + 1) % fp.length];
      walls.push({ a, b, height: hLvl, thickness: wt, composite: wallComposite, level: lvl, elevation, edge: i, ...hRef });
    }
    // Decke (Slab) als Footprint-Polygon auf Geschossdecke
    slabs.push({ level: lvl, elevation: elevation + hLvl, polygon: fp, ...slabFelder });
    // Ein Raum (Space) je Geschoss
    spaces.push({ level: lvl, polygon: fp, name: lvlName, elevation });
  }
  // Bodenplatte
  slabs.unshift({ level: -1, elevation: 0, polygon: fp, ...slabFelder });

  // Attika (Brüstung) entlang des Footprints auf der obersten Decke
  const parapetH = parapet?.enabled ? (parapet.height ?? 1.0) : 0;
  if (parapetH > 0) {
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      // 107-01: the parapet is as thick as the hull wall below it (wt: build-up total if one is set), not the plain wallThickness
      parapets.push({ a, b, height: parapetH, thickness: wt, elevation: elev(n), ...hRef });
    }
  }

  return { footprint: fp, storeys: storeyList, walls, slabs, spaces, parapets, parapetHeight: parapetH, storeyHeight: sh, totalHeight: elev(n) };
}

// Bounding-Box (Meter) für Kamera-Fokus.
export function modelBBox(model) {
  const fp = model?.footprint || DEFAULT_FOOTPRINT;
  const xs = fp.map((p) => p.x);
  const zs = fp.map((p) => p.z);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
    height: model?.totalHeight || 12,
  };
}

// Hilfsfunktion: Polygon-Schwerpunkt in Metern.
export function footprintCentroid(fp) {
  const s = fp.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: s.x / fp.length, z: s.z / fp.length };
}
