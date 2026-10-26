// Vertical binding of building elements — the ONE place where a storey index is turned into a height
// (phase 107-02, spec part II.1 reference plane of slab/roof and II.2 home story, top link, propagation).
// Before, `level * storeyHeight` stood twelve times in ifcExport.js and ten times in BitBimStudio.jsx, slab
// thicknesses were literals (0.25 / 0.22 / 0.2 m) in the IFC export, the 3D view, the plan and the PDF section, and a
// drawn wall froze its `height` when it was created. Now 3D, plan, PDF and IFC call this file.
//
// Rule (spec VI.3, as in referenz.js): the store holds BASE DATA (level, offsets, thickness, link); heights and
// elevations are derived here, never written back. Every new field is German, optional, and its absence means
// today's behaviour (old projects load unchanged, the IFC export stays byte-identical, golden tests/unit/ifc-golden-107*.ifc).
// One deliberate exception: the roof class of the IFC export (D-BK-25, 25.10.2026) follows the real slope for every roof, also one
// that only has the old `pitch`; the golden ifc-golden-107-steckbrief.ifc was regenerated on purpose for that.
//
// Storey source `geschosse` (the second argument of every function) is either
//   - a number  = one storey height in m for all storeys (the project's `storeyHeight`), or
//   - an array  = storey table [{level, name?, hoehe_m}] (programme field `geschosse`, D-BK-05), or
//   - missing   = 3 m.
// The number path multiplies exactly like the old code (`level * h`), so old projects produce the same digits.
//
// New element fields (customWalls / customColumns / customZones):
//   unterkante_versatz_m   shift of the lower edge against the storey elevation, m (default 0)
//   oberkante_bezug        "geschoss" = top edge follows a storey (default for NEW drawn walls, D-BK-04) | "absolut" = `height`
//   oberkante_geschosse    storeys above `level` the top edge is linked to (integer ≥ 1, default 1 = the storey above)
//   oberkante_versatz_m    shift of the top edge against that storey elevation, m (default 0, negative = below)
// Slabs / roofs (customSlabs, customRoofs, model.slabs): `dicke_m` (m) and `bezug` ("oben" | "unten").
// Roofs additionally `firsthoehe_m` (ridge rise above the eaves, m) and `neigung_grad` (degrees), kept apart because
// the old field `pitch` held a rise in metres in the editor (until D-BK-25 the IFC export read it as degrees by mistake).
//
// In:  element records, storey source. Out: plain numbers and objects; pure, no I/O, node-testable.

/** Storey height in m when nothing is known. [ASSUMED] 3.0 m: the long-standing default of the building programme. */
export const STANDARD_GESCHOSSHOEHE_M = 3;

/**
 * Smallest height a linked wall may get, m. [ASSUMED] 0.1 m: a top link at or below the lower edge would give a
 * zero or negative wall; the clamp keeps 3D, plan and IFC drawable and the inspector shows the resulting height, so the
 * input is corrected by sight instead of the wall vanishing. No norm value.
 */
export const MIN_WANDHOEHE_M = 0.1;

/**
 * Standard slab/roof thickness and reference side per kind, as the code hard-coded them before 107-02.
 *  - huelle: hull slab (`model.slabs`), lower edge on the stored elevation, 0.25 m
 *  - decke:  drawn slab (`customSlabs`), upper edge on the storey ceiling (elevation of level + 1), 0.22 m
 *  - dach:   drawn roof (`customRoofs`), lower edge on the eaves (elevation of level + 1), 0.2 m
 * [ASSUMED] thicknesses (editor values since phase 14, not from a build-up); Decke is not reconciled with Hülle (D-BK-03).
 */
export const DECKEN_STANDARD = Object.freeze({
  huelle: Object.freeze({ dicke_m: 0.25, bezug: "unten" }),
  decke: Object.freeze({ dicke_m: 0.22, bezug: "oben" }),
  dach: Object.freeze({ dicke_m: 0.2, bezug: "unten" }),
});

/**
 * Steepest roof slope the editor and the derivation accept, degrees. [ASSUMED] 85°: tan(90°) is infinite, so the ridge rise needs a
 * ceiling; 85° (rise = 11.4 × half span) is far beyond any real roof (steep gables stay below about 70°) and no norm value.
 * The inspector field ends at the same value, and dachNeigung_grad() clamps a stored value to it so the slope shown in the data
 * sheet always matches the rise the 3D view draws.
 */
export const MAX_NEIGUNG_GRAD = 85;

/** Roof slope up to which a roof counts as flat, degrees. [ASSUMED] 10° as in the data-sheet classification (97-02a); DIN 18531 calls < 5° flat. */
export const FLACHDACH_BIS_GRAD = 10;

/**
 * @typedef {{level: number, name?: string, hoehe_m: number}} Geschoss  one row of the storey table (height in m)
 * @typedef {number|Geschoss[]|null|undefined} Geschosse  storey source: one height in m, a storey table, or nothing (3 m)
 */

const zahl = (/** @type {unknown} */ v, /** @type {number} */ d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

/**
 * Is this a usable storey table (non-empty array)?
 * @param {Geschosse} g
 * @returns {g is Geschoss[]}
 */
function istTabelle(g) {
  return Array.isArray(g) && g.length > 0;
}

/**
 * Height of the storey `level` in m. Table: the row with that level; levels outside the table take the height of the
 * nearest listed storey (a project that grows a storey keeps working). Number: that number. Otherwise 3 m.
 * @param {number} level storey index (0 = ground floor, integer)
 * @param {Geschosse} [geschosse]
 * @returns {number} metres, > 0
 */
export function geschosshoehe(level, geschosse) {
  if (istTabelle(geschosse)) {
    const l = Math.round(zahl(level, 0));
    const zeilen = geschosse.filter((g) => Number.isFinite(Number(g?.level)) && Number(g?.hoehe_m) > 0);
    if (zeilen.length) {
      const treffer = zeilen.find((g) => Math.round(Number(g.level)) === l);
      if (treffer) return Number(treffer.hoehe_m);
      const nah = zeilen.reduce((b, g) => (Math.abs(Number(g.level) - l) < Math.abs(Number(b.level) - l) ? g : b));
      return Number(nah.hoehe_m);
    }
  }
  const h = typeof geschosse === "number" ? geschosse : NaN;
  return h > 0 ? h : STANDARD_GESCHOSSHOEHE_M;
}

/**
 * Elevation of the lower edge of storey `level` above ±0.00, in m (the structural level, as `model.storeys[].elevation`).
 * Number/missing: `level * height` — the exact arithmetic of the old code. Table: the sum of the storey heights from
 * level 0 up to `level` (negative levels sum downwards, so level −1 lies one storey height below ±0).
 * @param {number} level storey index (integer; 0 = ground floor)
 * @param {Geschosse} [geschosse]
 * @returns {number} metres
 */
export function elevationOf(level, geschosse) {
  const l = zahl(level, 0);
  if (!istTabelle(geschosse)) return l * geschosshoehe(0, geschosse);
  const n = Math.round(l);
  let summe = 0;
  if (n > 0) for (let i = 0; i < n; i += 1) summe += geschosshoehe(i, geschosse);
  else for (let i = -1; i >= n; i -= 1) summe -= geschosshoehe(i, geschosse);
  return summe;
}

/**
 * Total height of the building above ±0.00 for `storeys` above-ground storeys, in m.
 * @param {number} storeys number of storeys (integer ≥ 1)
 * @param {Geschosse} [geschosse]
 * @returns {number} metres
 */
export function gesamtHoehe(storeys, geschosse) {
  return elevationOf(Math.max(1, Math.round(zahl(storeys, 1))), geschosse);
}

/**
 * Lower edge of an element in m: storey elevation + `unterkante_versatz_m`. Works for walls, columns and zones
 * (anything with `level`); slabs and roofs get their lower edge from deckenLage().
 * @param {{level?: number, unterkante_versatz_m?: number}} el
 * @param {Geschosse} [geschosse]
 * @returns {number} metres
 */
export function unterkante(el, geschosse) {
  return elevationOf(el?.level || 0, geschosse) + zahl(el?.unterkante_versatz_m, 0);
}

/**
 * Does the element's top edge follow a storey (`oberkante_bezug === "geschoss"`)?
 * @param {{oberkante_bezug?: string}|null|undefined} el
 * @returns {boolean}
 */
export function oberkanteFolgtGeschoss(el) {
  return el?.oberkante_bezug === "geschoss";
}

/**
 * Top edge of an element in m. Linked: elevation of (level + `oberkante_geschosse`) + `oberkante_versatz_m`. Not linked:
 * lower edge + `hoehe_m` (the stored height, or the storey height when none is stored).
 * @param {{level?: number, height?: number, hoehe_m?: number, unterkante_versatz_m?: number, oberkante_bezug?: string, oberkante_geschosse?: number, oberkante_versatz_m?: number}} el
 * @param {Geschosse} [geschosse]
 * @returns {number} metres
 */
export function oberkante(el, geschosse) {
  return unterkante(el, geschosse) + elementHoehe(el, geschosse);
}

/**
 * Height of a linear/standing element in m (wall, column, zone). Linked (`oberkante_bezug: "geschoss"`): top edge minus
 * lower edge, at least MIN_WANDHOEHE_M. Otherwise the stored `height` (or `hoehe_m`), else the height of the storey of `level`.
 * @param {any} el
 * @param {Geschosse} [geschosse]
 * @returns {number} metres, > 0
 */
function elementHoehe(el, geschosse) {
  if (oberkanteFolgtGeschoss(el)) {
    const ziel = (el.level || 0) + Math.max(1, Math.round(zahl(el.oberkante_geschosse, 1)));
    const h = elevationOf(ziel, geschosse) + zahl(el.oberkante_versatz_m, 0) - unterkante(el, geschosse);
    return Math.max(MIN_WANDHOEHE_M, h);
  }
  const fest = zahl(el?.height ?? el?.hoehe_m, 0);
  return fest > 0 ? fest : geschosshoehe(el?.level || 0, geschosse);
}

/**
 * Height of a wall in m. `oberkante_bezug === "geschoss"`: elevation(level + oberkante_geschosse) + oberkante_versatz_m − lower
 * edge — so raising the storey height from 3.0 to 3.2 m makes the wall grow with it. Otherwise (or absent, old
 * walls) the stored `height`, falling back to the storey height like the old `w.height || storeyHeight`.
 * @param {any} w wall record (customWalls entry, or any record with `level`)
 * @param {Geschosse} [geschosse]
 * @returns {number} metres, > 0
 */
export function wandHoehe(w, geschosse) {
  return elementHoehe(w, geschosse);
}

/**
 * Height of a column in m: the storey height of its level (a column has no stored height), or the linked height when
 * `oberkante_bezug` is "geschoss".
 * @param {any} c column record
 * @param {Geschosse} [geschosse]
 * @returns {number} metres, > 0
 */
export function stuetzenHoehe(c, geschosse) {
  return oberkanteFolgtGeschoss(c) ? elementHoehe(c, geschosse) : geschosshoehe(c?.level || 0, geschosse);
}

/**
 * Clear height of a zone/space in m. Linked: top − lower edge. Otherwise 98 % of the storey height of its level — the
 * rule of the IFC space (a room does not reach into the slab above). [ASSUMED] 0.98 as in the export since phase 14.
 * @param {any} z zone record
 * @param {Geschosse} [geschosse]
 * @returns {number} metres, > 0
 */
export function raumHoehe(z, geschosse) {
  return oberkanteFolgtGeschoss(z) ? elementHoehe(z, geschosse) : geschosshoehe(z?.level || 0, geschosse) * 0.98;
}

/**
 * Position of a slab or roof over height: lower edge, upper edge and thickness in m.
 * Reference plane: hull slabs (`kind` "huelle") use their stored `elevation`; drawn slabs and roofs use the elevation of
 * `level + 1` (the storey ceiling resp. the eaves). `bezug` says which edge of the body lies on that plane:
 * "unten" = the body stands on it (lower edge = plane), "oben" = it hangs below it (upper edge = plane).
 * Absent `dicke_m`/`bezug`: DECKEN_STANDARD of the kind — exactly today's literals.
 * @param {{level?: number, elevation?: number, dicke_m?: number, bezug?: string}} s slab or roof record
 * @param {Geschosse} [geschosse]
 * @param {"huelle"|"decke"|"dach"} [art] default "decke"
 * @returns {{unterkante_m: number, oberkante_m: number, dicke_m: number}} metres
 */
export function deckenLage(s, geschosse, art = "decke") {
  const std = DECKEN_STANDARD[art] || DECKEN_STANDARD.decke;
  const d = zahl(s?.dicke_m, 0) > 0 ? Number(s.dicke_m) : std.dicke_m;
  const bezug = s?.bezug === "oben" || s?.bezug === "unten" ? s.bezug : std.bezug;
  // Hull slabs hold their plane as `elevation`; the others derive it from the level. A hull slab WITHOUT `elevation` falls back to
  // the plane of `level + 1`, which is the convention of createBuildingModel too (the slab of storey `level` lies on that storey's
  // ceiling, the base plate has level −1 → elevation 0), so a foreign model without the field gets the same plane. Arithmetic order as before:
  // (level * h + h) was the old drawn-slab plane, elevation(level + 1) equals it up to the last float digit
  // (the IFC text rounds to 4 decimals, so the golden stays identical).
  const ebene = art === "huelle" && Number.isFinite(Number(s?.elevation)) ? Number(s.elevation) : elevationOf((s?.level || 0) + 1, geschosse);
  return bezug === "oben"
    ? { unterkante_m: ebene - d, oberkante_m: ebene, dicke_m: d }
    : { unterkante_m: ebene, oberkante_m: ebene + d, dicke_m: d };
}

/**
 * Half span of a roof polygon in m: half of the shorter side of its bounding box (the 3D gable runs along the longer side).
 * @param {Array<{x: number, z: number}>|undefined} points roof outline in m
 * @returns {number} metres (0 for no outline)
 */
export function dachHalbspannweite_m(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;
}

/**
 * Ridge rise of a drawn roof in m. One of the two fields leads: a stored `neigung_grad` (the user fixed the slope, so the
 * rise follows the outline: half span × tan) wins over `firsthoehe_m`; without either the old field `pitch`, which the
 * editor always wrote in metres (label "Firsthöhe (m)"); else 2.5 m [ASSUMED editor default].
 * @param {{firsthoehe_m?: number, pitch?: number, neigung_grad?: number, points?: Array<{x: number, z: number}>}} rf
 * @returns {number} metres
 */
export function dachFirsthoehe_m(rf) {
  const g = zahl(rf?.neigung_grad, NaN);
  const halb = dachHalbspannweite_m(rf?.points);
  if (g >= 0 && halb > 0) return firsthoeheAusNeigung(rf?.points, g);
  const f = zahl(rf?.firsthoehe_m, NaN);
  if (f >= 0) return f;
  const p = zahl(rf?.pitch, NaN);
  return p >= 0 ? p : 2.5;
}

/**
 * Slope of a drawn roof in degrees: the stored `neigung_grad`, otherwise atan(rise / half span) of the gable the 3D view
 * builds. The ONE derivation for 3D view, inspector, IFC class and IFC data sheet (D-BK-25): a roof that only has the old
 * `pitch` gets its real slope from that rise in metres, never the metres read as degrees (the old IFC reading, which called
 * nearly every roof flat).
 * @param {{firsthoehe_m?: number, pitch?: number, neigung_grad?: number, points?: Array<{x: number, z: number}>}} rf
 * @returns {number} degrees, 0…MAX_NEIGUNG_GRAD (0 when the outline is unknown)
 */
export function dachNeigung_grad(rf) {
  const g = zahl(rf?.neigung_grad, NaN);
  if (g >= 0) return Math.min(MAX_NEIGUNG_GRAD, g);
  const halb = dachHalbspannweite_m(rf?.points);
  if (!(halb > 0)) return 0;
  return (Math.atan2(dachFirsthoehe_m(rf), halb) * 180) / Math.PI;
}

/**
 * Ridge rise in m for a slope in degrees over the half span of an outline (inverse of dachNeigung_grad).
 * @param {Array<{x: number, z: number}>|undefined} points roof outline in m
 * @param {number} grad slope in degrees (clamped to 0…MAX_NEIGUNG_GRAD)
 * @returns {number} metres
 */
export function firsthoeheAusNeigung(points, grad) {
  const g = Math.max(0, Math.min(MAX_NEIGUNG_GRAD, zahl(grad, 0)));
  return dachHalbspannweite_m(points) * Math.tan((g * Math.PI) / 180);
}

/**
 * Does the roof carry one of the new fields (`firsthoehe_m` or `neigung_grad`)? A roof without them is an old one that only
 * has `pitch`; dachMigrieren() converts it on load.
 * @param {any} rf
 * @returns {boolean}
 */
export function dachHatGetrennteFelder(rf) {
  return rf?.firsthoehe_m != null || rf?.neigung_grad != null;
}

/**
 * Old roof → roof with the split fields: `firsthoehe_m` takes the old `pitch` (metres, as the editor wrote it); `pitch` and
 * everything else stay. Roofs that already have a new field are returned unchanged (same object).
 * @template {object} T
 * @param {T} rf roof record
 * @returns {T}
 */
export function dachMigrieren(rf) {
  const r = /** @type {any} */ (rf);
  if (!r || dachHatGetrennteFelder(r)) return rf;
  return /** @type {T} */ ({ ...r, firsthoehe_m: dachFirsthoehe_m(r) });
}

/**
 * Storey table from the plain programme (`storeys` × `storeyHeight`), with the names of createBuildingModel
 * ("EG", "1. OG" …). Used when the user edits one storey height for the first time.
 * @param {number} storeys number of above-ground storeys (integer ≥ 1)
 * @param {number} storeyHeight one storey height in m
 * @returns {Geschoss[]}
 */
export function geschosseErzeugen(storeys, storeyHeight) {
  const n = Math.max(1, Math.round(zahl(storeys, 1)));
  const h = zahl(storeyHeight, 0) > 0 ? Number(storeyHeight) : STANDARD_GESCHOSSHOEHE_M;
  return Array.from({ length: n }, (_, level) => ({ level, name: level === 0 ? "EG" : `${level}. OG`, hoehe_m: h }));
}

/**
 * The storey source of a project: the stored table when it is valid, else the plain storey height. A valid table has
 * only rows with an integer level and `hoehe_m` > 0; broken rows are dropped (a table with none left counts as absent).
 * @param {{geschosse?: unknown, storeyHeight?: number}} programm programme fields (`buildingProgram.get()` or the BimModel record)
 * @returns {Geschosse} the cleaned table, or the number `storeyHeight` (3 m when unknown)
 */
export function geschosseAus(programm) {
  const roh = programm?.geschosse;
  if (Array.isArray(roh)) {
    const sauber = roh
      .filter((g) => g && Number.isFinite(Number(g.level)) && Number(g.hoehe_m) > 0)
      .map((g) => ({ level: Math.round(Number(g.level)), name: typeof g.name === "string" ? g.name : undefined, hoehe_m: Number(g.hoehe_m) }))
      .sort((a, b) => a.level - b.level);
    if (sauber.length) return sauber;
  }
  const h = Number(programm?.storeyHeight);
  return h > 0 ? h : STANDARD_GESCHOSSHOEHE_M;
}

/**
 * Height of storey `level` read from a built BimModel (`model.storeys[].elevation`, `model.totalHeight`), m: the elevation of the
 * next storey (or the total height for the top storey) minus its own elevation. The section drawings use it for the storey
 * dimension so the figure agrees with the level marks beside it, also with a storey table (107-02 review fix; before, the one
 * number `storeyHeight` was drawn next to a mark that said otherwise).
 * @param {{storeys?: Array<{level?: number, elevation: number}>, totalHeight?: number}|null|undefined} model result of createBuildingModel()
 * @param {number} [level] storey index (integer; default 0 = ground floor)
 * @returns {number} metres; 0 when the model has no such storey
 */
export function geschossHoeheAusModell(model, level = 0) {
  const liste = Array.isArray(model?.storeys) ? model.storeys : [];
  const i = liste.findIndex((st) => Math.round(Number(st?.level)) === Math.round(level));
  if (i < 0) return 0;
  const oben = liste[i + 1] ? Number(liste[i + 1].elevation) : Number(model?.totalHeight);
  const h = oben - Number(liste[i].elevation);
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/**
 * Floor level (OKF) of the top storey in m: the elevation of storey `storeys − 1`. Brand-protection and accessibility checks use it
 * (the 22 m high-rise limit of the MBO is measured from there). With a storey table the real elevation, otherwise
 * (storeys − 1) × one height like the old inline code.
 * @param {number} storeys number of above-ground storeys (integer ≥ 1; smaller values count as 1)
 * @param {Geschosse} [geschosse]
 * @returns {number} metres
 */
export function okfObersterGeschoss(storeys, geschosse) {
  return elevationOf(Math.max(1, Math.round(zahl(storeys, 1))) - 1, geschosse);
}

/**
 * Programme patch for "ALL storeys get this height": always `storeyHeight`, and with a storey table also every row. The
 * single place for every writer of the one height (BitBimStudio input, Massing-Studio slider), so the table and the number
 * can never disagree (107-02 review fix; the Massing slider used to write only `storeyHeight` and was then ignored).
 * @param {{geschosse?: unknown}|null|undefined} programm current programme (`buildingProgram.get()`)
 * @param {number} hoehe_m new storey height in m (> 0)
 * @returns {{storeyHeight: number, geschosse?: Geschoss[]}} patch for `buildingProgram.set`
 */
export function patchAlleGeschosshoehen(programm, hoehe_m) {
  const roh = programm?.geschosse;
  return { storeyHeight: hoehe_m, ...(Array.isArray(roh) && roh.length ? { geschosse: roh.map((g) => ({ ...g, hoehe_m })) } : {}) };
}

/**
 * Programme patch for "ONE storey gets this height". Without a table it is created from `storeys × storeyHeight`; a storey that
 * is not a row yet (the user raised the storey count after the table was made) gets a new row, so the edit is kept instead of
 * snapping back (107-02 review fix). Rows stay sorted by level.
 * @param {{geschosse?: unknown, storeys?: number, storeyHeight?: number}|null|undefined} programm current programme
 * @param {number} level storey index (integer)
 * @param {number} hoehe_m new height of that storey in m
 * @returns {{geschosse: Geschoss[]}|null} patch for `buildingProgram.set`; null when the height is not a positive number
 */
export function patchGeschosshoehe(programm, level, hoehe_m) {
  if (!(Number(hoehe_m) > 0)) return null;
  const l = Math.round(zahl(level, 0));
  const roh = programm?.geschosse;
  const basis = Array.isArray(roh) && roh.length ? /** @type {Geschoss[]} */ (roh) : geschosseErzeugen(programm?.storeys ?? 1, programm?.storeyHeight ?? STANDARD_GESCHOSSHOEHE_M);
  const hat = basis.some((g) => Math.round(Number(g.level)) === l);
  const zeilen = hat
    ? basis.map((g) => (Math.round(Number(g.level)) === l ? { ...g, hoehe_m: Number(hoehe_m) } : g))
    : [...basis, { level: l, name: l === 0 ? "EG" : l > 0 ? `${l}. OG` : `${-l}. UG`, hoehe_m: Number(hoehe_m) }].sort((a, b) => a.level - b.level);
  return { geschosse: zeilen };
}
