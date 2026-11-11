// Gemeinsames Gebäudemodell (Meter-Einheiten) — Single Source of Truth für
// 3D-Darstellung, später 2D-Schnitt und IFC-Export. Koordinaten in der XZ-Ebene
// (y = oben). Footprint-Polygon zentriert um den Ursprung.

import { metersPerPixel } from "@core/lib/geo";
import { WALL_COMPOSITES, aufbauById, aufbautenListe } from "./bauteil/aufbauten.js";
import { elevationOf, geschosshoehe, geschosseAus, deckenLage, kniestockAus, MIN_WANDHOEHE_M, DECKEN_STANDARD } from "./bauteil/hoehen.js";
import { untergeschosseAnzahl, geschossName } from "./bauteil/ebenen.js";
import { globalesDach, dachEbenen, deckeUnterDach } from "./bauteil/dachGeometrie.js";
import { deckenUmriss } from "./bauteil/deckenRand.js"; // 108-03 follow-up: hull slabs end at the insulation of the envelope (one truth for 3D, IFC, quantities)

/**
 * Build-up of the basement hull walls (107-13, D-BK-20). [ASSUMED] "single24" (reinforced concrete 24 cm, bauteil/aufbauten.js):
 * the facade build-up of the storeys above (e.g. clinker) would be wrong below ground; waterproofing and perimeter insulation follow
 * with the build-up plan 107-03 (own basement build-up). Way to a proven value: the basement wall of the structural design.
 */
export const UG_AUFBAU_STANDARD = "single24";

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

/**
 * 108-01: another area of the site planning (e.g. the building envelope, type "baufeld") in the MODEL frame of the footprint area —
 * its px points relative to the vertex mean of the footprint area, × m/px: exactly the transform of footprintToMeters (which centres
 * on the vertex mean, not on the bounding box), so both outlines keep their relative position.
 * @param {Array<{x: number, y: number}>} punkte the other area, px
 * @param {Array<{x: number, y: number}>} bezug the footprint area the model was built from, px
 * @param {any} parcel site parcel (m_per_px)
 * @returns {Array<{x: number, z: number}>|null} m; null without 3 points on either side
 */
export function flaecheImModellrahmen(punkte, bezug, parcel) {
  if (!Array.isArray(punkte) || punkte.length < 3 || !Array.isArray(bezug) || bezug.length < 3) return null;
  const mpp = metersPerPixel(parcel);
  const cx = bezug.reduce((s, p) => s + p.x, 0) / bezug.length;
  const cy = bezug.reduce((s, p) => s + p.y, 0) / bezug.length;
  return punkte.map((p) => ({ x: (p.x - cx) * mpp, z: (p.y - cy) * mpp }));
}

export const DEFAULT_FOOTPRINT = [
  { x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 },
];

/** Global roof forms with a slope — only under one of them does a knee wall exist (108-02; a flat roof has no attic storey). */
const GENEIGTE_DACHFORMEN = Object.freeze(["sattel", "walm", "pult"]);

/**
 * @typedef {object} KniestockGeometrie
 * @property {number} kniestock_m      knee wall in m (>= 0), from the top row of the storey table (hoehen.kniestockAus)
 * @property {number} okRohdecke_m     top of the structural slab below the top storey, m above +-0.00 (hoehen.deckenLage of that hull slab)
 * @property {number} traufhoehe_m     eaves of the global roof = okRohdecke_m + kniestock_m, m above +-0.00 (at least elevation + MIN_WANDHOEHE_M)
 * @property {number} wandHoehe_m      height of the hull walls of the top storey, m = eaves - storey elevation (at least MIN_WANDHOEHE_M)
 * @property {Array<{x: number, z: number}>|null} kehlbalken  outline of the collar-beam floor (hull slab above the top storey) clipped
 *   to the roof at the top of that slab, m; null = the slab lies above the ridge and is dropped
 */

/**
 * 108-02 (D-EFH-01): the knee wall of the building model — ONE computation for createBuildingModel (walls, eaves, collar-beam floor) and
 * the quantity fallback (bimClassification.synthHull). Only with a pitched GLOBAL roof form and a knee wall on the top row of the storey
 * table; everything else gives null (the model stays byte-identical to before).
 * Rule: eaves = top of the structural slab under the top storey + kniestock_m. With the default hull slab (0.25 m, bezug "unten": the
 * slab stands ON the storey elevation) that top lies 0.25 m above the elevation, so the hull walls of the top storey are 0.25 m + knee wall
 * high (computed, not assumed); with bezug "oben" the slab hangs below the elevation and the wall is exactly the knee wall.
 * User decision 01.11.2026 (assumption A1 of 108-02): the hull slab ABOVE the top storey stays as a collar-beam floor, its outline clipped
 * to the inside of the roof faces at the TOP of the slab (dachGeometrie.deckeUnterDach) — a slab whose top lies above the ridge is dropped.
 * @param {{footprintM?: Array<{x: number, z: number}>|null, storeys?: number, storeyHeight?: number, geschosse?: Array<any>|null,
 *          deckenDicke?: number, deckenBezug?: string, dachform?: string|null, dachneigung?: number|null, wallComposite?: any}} [q] footprint in m, storey
 *   height in m, storey table, hull slab thickness in m and reference side, roof form and slope in degrees (fields of the BimModel record)
 * @returns {KniestockGeometrie|null}
 */
export function kniestockGeometrie({ footprintM, storeys = 4, storeyHeight = 3, geschosse = null, deckenDicke = DECKEN_STANDARD.huelle.dicke_m, deckenBezug = DECKEN_STANDARD.huelle.bezug, dachform = null, dachneigung = null, wallComposite = null } = {}) {
  if (!dachform || !GENEIGTE_DACHFORMEN.includes(dachform)) return null;
  if (!Array.isArray(geschosse) || !geschosse.length) return null;
  const tab = geschosseAus({ geschosse, storeyHeight });
  if (!Array.isArray(tab)) return null;
  const n = Math.max(1, Math.round(Number(storeys) || 1));
  const k = kniestockAus(tab, n);
  if (k == null) return null;
  const fp = (footprintM && footprintM.length >= 3) ? footprintM : DEFAULT_FOOTPRINT;
  // the same optional slab fields createBuildingModel writes (a default value writes none)
  const felder = {
    ...(Number(deckenDicke) > 0 && deckenDicke !== DECKEN_STANDARD.huelle.dicke_m ? { dicke_m: Number(deckenDicke) } : {}),
    ...(deckenBezug === "oben" ? { bezug: "oben" } : {}),
  };
  const elevTop = elevationOf(n - 1, tab);
  // the hull slab under the top storey lies on the elevation of the top storey (createBuildingModel: slab of level n - 2, or the base slab)
  const okRohdecke_m = deckenLage({ elevation: elevTop, ...felder }, tab, "huelle").oberkante_m;
  let traufhoehe_m = okRohdecke_m + k;
  const wandHoehe_m = Math.max(MIN_WANDHOEHE_M, traufhoehe_m - elevTop);
  // review fix: a knee wall below MIN_WANDHOEHE_M with bezug "oben" (eaves at or near the elevation) would leave the clamped hull wall
  // sticking out above the eaves into the roof — the eaves then rise to the wall top, so wall, roof and section read one number
  if (traufhoehe_m - elevTop < MIN_WANDHOEHE_M) traufhoehe_m = elevTop + wandHoehe_m;
  const oben = deckenLage({ elevation: elevationOf(n, tab), ...felder }, tab, "huelle");
  // the roof exactly as the 3D view, the section and the IFC export build it (globalesDach with this eaves height)
  const dach = globalesDach({ footprint: fp, traufhoehe_m }, dachform, Number(dachneigung));
  const ebenen = dach && dach.ok ? dachEbenen(dach) : [];
  // the collar-beam floor starts from the slab outline (inset by the envelope insulation, deckenRand.js), not from the footprint
  const deckeFp = deckenUmriss(fp, compositeById(wallComposite)).polygon;
  const kehl = ebenen.length ? deckeUnterDach(deckeFp, ebenen, oben.oberkante_m) : deckeFp;
  return { kniestock_m: k, okRohdecke_m, traufhoehe_m, wandHoehe_m, kehlbalken: kehl.length >= 3 ? kehl : null };
}

// Erzeugt das Gebäudemodell aus Footprint + Geschossparametern.
/**
 * @param {{footprintM?: Array<{x: number, z: number}>|null, storeys?: number, storeyHeight?: number,
 *          wallThickness?: number, wallComposite?: any, parapet?: {enabled: boolean, height: number},
 *          huelleBezug?: string|null, geschosse?: Array<{level: number, name?: string, hoehe_m: number}>|null,
 *          deckenDicke?: number, deckenBezug?: "oben"|"unten", untergeschosse?: number, ugComposite?: string,
 *          dachform?: string|null, dachneigung?: number|null}} [q]
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
 *   untergeschosse (107-13, D-BK-20; programme field `untergeschosse`, 0 … 3 [ASSUMED], see bauteil/ebenen.js): basement storeys on
 *   the levels −1 … −U. `storeys` stays the number of storeys ABOVE ground. The basement entries (storeys, walls with the build-up
 *   `ugComposite`, slabs, spaces, all flagged `unterirdisch: true`) are APPENDED after the storeys above ground, so readers that
 *   index by level (`storeys[level]`, `walls[0]` as the facade) stay right. Each basement gets the ceiling above it as a slab with an
 *   own `id` "ug-1", "ug-2" … (else it would share the GlobalId of the base slab, whose key is its id/level). The base slab moves to
 *   level −(U+1) at the elevation `fusshoehe_m` (negative, m) and keeps the id "-1" (its GUID stays stable). The model then carries
 *   `untergeschosse` and `fusshoehe_m`; `totalHeight`, `parapets` and modelBBox stay above ground. Basement height = the storey source
 *   (storey table row of that level, else the nearest row as hoehen.js geschosshoehe() reads it, else `storeyHeight`).
 *   0/absent = the model is byte-identical to before (golden tests/unit/fixtures/gebaeudemodell-golden-107-13.json).
 *   dachform / dachneigung (108-02, D-EFH-01; BimModel fields of the global roof form, degrees): only read together with a knee wall
 *   (`kniestock_m` on the top row of `geschosse`, see kniestockGeometrie). Then the hull walls of the top storey end at the eaves, the
 *   model carries `traufhoehe_m` and `kniestock_m` (dachGeometrie.globalesDach puts the roof there, through ebenen.globaleTraufhoehe_m),
 *   the parapets stand on the eaves, and the hull slab above the top storey is the collar-beam floor (`kehlbalkenlage: true`, outline
 *   clipped to the roof; dropped above the ridge, then `kehlbalkenlage_entfallen: true`). `totalHeight` stays the sum of the storey
 *   heights and the spaces keep the storey height. Without a knee wall or with a flat roof the model is byte-identical (golden
 *   tests/unit/fixtures/gebaeudemodell-golden-108-02.json holds the test house WITH it).
 */
export function createBuildingModel({ footprintM, storeys = 4, storeyHeight = 3, wallThickness = 0.3, wallComposite = null, parapet = { enabled: true, height: 1.0 }, huelleBezug = "center", geschosse = null, deckenDicke = DECKEN_STANDARD.huelle.dicke_m, deckenBezug = DECKEN_STANDARD.huelle.bezug, untergeschosse = 0, ugComposite = UG_AUFBAU_STANDARD, dachform = null, dachneigung = null } = {}) {
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
  // 108-02: knee wall of the top storey (null without one or with a flat roof = everything below as before)
  const knie = kniestockGeometrie({ footprintM: fp, storeys: n, storeyHeight, geschosse, deckenDicke, deckenBezug, dachform, dachneigung, wallComposite });
  // 108-03 follow-up (user 08.11.2026): the hull slabs end at the insulation of the envelope build-up — a slab to the outer face would be a
  // thermal bridge. Without a build-up with an insulation layer the slab is the footprint (as before). The base slab keeps the footprint.
  const deckeFp = deckenUmriss(fp, compositeById(wallComposite)).polygon;

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
      // 108-02: the hull walls of the top storey end at the eaves (knee wall) and say so (`kniestock: true`: rule windows that do not fit
      // under the eaves are left out, autoOpenings.js; only with a knee wall, so every other model keeps its objects)
      if (knie && lvl === n - 1) walls.push({ a, b, height: knie.wandHoehe_m, thickness: wt, composite: wallComposite, level: lvl, elevation, edge: i, ...hRef, kniestock: true });
      else walls.push({ a, b, height: hLvl, thickness: wt, composite: wallComposite, level: lvl, elevation, edge: i, ...hRef });
    }
    // Decke (Slab) als Footprint-Polygon auf Geschossdecke
    // 108-02: above the top storey with a knee wall = the collar-beam floor, clipped to the roof (dropped above the ridge)
    if (knie && lvl === n - 1) {
      if (knie.kehlbalken) slabs.push({ level: lvl, elevation: elevation + hLvl, polygon: knie.kehlbalken, ...slabFelder, kehlbalkenlage: true });
    } else slabs.push({ level: lvl, elevation: elevation + hLvl, polygon: deckeFp, ...slabFelder });
    // Ein Raum (Space) je Geschoss
    // 107-11: one space per storey (the footprint); rooms inside it are customZones / workshop zones (bauteil/raeume.js)
    spaces.push({ level: lvl, polygon: fp, name: lvlName, elevation });
  }
  // 107-13: basement storeys, appended after the storeys above ground (see JSDoc). Without them nothing below runs.
  const U = untergeschosseAnzahl(untergeschosse);
  const ugWt = compositeTotalM(ugComposite) || wt;
  for (let lvl = -1; lvl >= -U; lvl--) {
    const elevation = elev(lvl);
    // [ASSUMED] basement height (assumption A1 of plan 107-13, deviates from the plan text): with a storey table WITHOUT a row for
    // this basement it is the height of the NEAREST row (usually the ground floor, hoehen.js geschosshoehe()), not `storeyHeight`
    // as the plan says - the same function places elements drawn on this level in 3D, plan and IFC, a second rule here would let
    // the model basement and a drawn basement wall drift apart. A tall ground floor (4.5 m shop) therefore makes the basement as
    // deep. Way to a decided value: the user decides A1 (keep, or "no row → storeyHeight" in geschosshoehe() for level < 0);
    // until then a basement row in the storey table ("Geschosshöhen") sets the real height.
    const hLvl = hoeheJe(lvl);
    const lvlName = (tab && Array.isArray(geschosse) && geschosse.find((g) => Math.round(Number(g?.level)) === lvl)?.name) || geschossName(lvl);
    storeyList.push({ level: lvl, elevation, name: lvlName, unterirdisch: true });
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i];
      const b = fp[(i + 1) % fp.length];
      walls.push({ a, b, height: hLvl, thickness: ugWt, composite: ugComposite, level: lvl, elevation, edge: i, ...hRef, unterirdisch: true });
    }
    // ceiling above the basement (same convention as the storeys above: slab on the top of its storey); own id against a shared GUID
    slabs.push({ level: lvl, id: `ug${lvl}`, elevation: elevation + hLvl, polygon: deckeFp, ...slabFelder, unterirdisch: true });
    spaces.push({ level: lvl, polygon: fp, name: lvlName, elevation, unterirdisch: true });
  }
  const fusshoehe_m = U > 0 ? elev(-U) : 0;
  // Bodenplatte (107-13: with basements below the lowest one, id "-1" keeps its GUID; without them exactly as before)
  if (U > 0) slabs.unshift({ level: -(U + 1), id: "-1", elevation: fusshoehe_m, polygon: fp, ...slabFelder, unterirdisch: true });
  else slabs.unshift({ level: -1, elevation: 0, polygon: fp, ...slabFelder });

  // Attika (Brüstung) entlang des Footprints auf der obersten Decke
  const parapetH = parapet?.enabled ? (parapet.height ?? 1.0) : 0;
  if (parapetH > 0) {
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      // 107-01: the parapet is as thick as the hull wall below it (wt: build-up total if one is set), not the plain wallThickness
      // 108-02: with a knee wall on the eaves (the top of the walls), not on the collar-beam floor
      parapets.push({ a, b, height: parapetH, thickness: wt, elevation: knie ? knie.traufhoehe_m : elev(n), ...hRef });
    }
  }

  return { footprint: fp, storeys: storeyList, walls, slabs, spaces, parapets, parapetHeight: parapetH, storeyHeight: sh, totalHeight: elev(n), ...(U > 0 ? { untergeschosse: U, fusshoehe_m } : {}),
    ...(knie ? { traufhoehe_m: knie.traufhoehe_m, kniestock_m: knie.kniestock_m, ...(knie.kehlbalken ? {} : { kehlbalkenlage_entfallen: true }) } : {}) };
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
