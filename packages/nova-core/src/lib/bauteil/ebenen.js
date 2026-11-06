// Storey levels of the building model, including basements (phase 107-13, decision D-BK-20: D-P61-09 "basement only as an
// overlay" is lifted). The ONE place that knows which levels a model has, what they are called and which hull slab is the
// base slab — the BIM studio, the plan (BimPlan2D), the structure, building-services, furnishing and fire-protection
// editors, the selection and the IFC export all read it instead of counting `0 … storeys − 1` on their own.
//
// Convention (read from D-BK-20 as negative LEVELS, not a negative storey count; assumption A6 of the plan, the user has
// not confirmed it yet): `storeys` stays the number of storeys above ground (about 400 places compute `storeys − 1`);
// the optional programme field `untergeschosse` (0 … 3) adds levels −1 … −U below ±0.00. Level 0 = ground floor (EG),
// n = "n. OG", −n = "n. UG". Basement entries are APPENDED to the model lists, so `model.storeys[level]` and
// `model.walls[0]` stay right for level ≥ 0.
//
// In:  a model from createBuildingModel (`storeys[]`, `slabs[]`, optional `untergeschosse`), levels (integers).
// Out: plain numbers, strings and lists; pure, no I/O, node-testable.
// 108-01: globaleTraufhoehe_m() — the ONE eaves height of the global roof form (3D, IFC, section read it; 108-02 moves it to the
// knee wall without touching the readers). 108-02: it does — `model.traufhoehe_m` when the model has a knee wall.

import { gesamtHoehe } from "./hoehen.js";

/**
 * Highest number of basement storeys. [ASSUMED] 3: three basements reach about 9 m below ground at 3 m storey height,
 * which the section and the concept phase still cover; deeper buildings are no concept case of this app. No norm value —
 * way to a proven value: the deepest basement the users really plan (raise the clamp, nothing else depends on it).
 */
export const MAX_UNTERGESCHOSSE = 3;

/**
 * Number of basement storeys from a programme value, clamped to 0 … MAX_UNTERGESCHOSSE (integers; anything else = 0).
 * @param {unknown} v stored value (`untergeschosse` of the programme)
 * @returns {number} 0 … 3
 */
export function untergeschosseAnzahl(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_UNTERGESCHOSSE, n);
}

/**
 * Fixed German name of a storey level: 0 "EG", n "n. OG", −n "n. UG". The name never depends on the number of basements
 * (the first basement is "1. UG" whether there are one or three).
 * @param {number} level storey level (integer)
 * @returns {string}
 */
export function geschossName(level) {
  const l = Math.round(Number(level) || 0);
  if (l === 0) return "EG";
  return l > 0 ? `${l}. OG` : `${-l}. UG`;
}

/**
 * The same name through a translation function, for the editors (keys "EG", "OG", "UG" of @core/lib/i18n).
 * @param {number} level storey level (integer)
 * @param {(key: string) => string} [t] translation function (default: the German key itself)
 * @returns {string}
 */
export function geschossLabel(level, t = (k) => k) {
  const l = Math.round(Number(level) || 0);
  if (l === 0) return t("EG");
  return l > 0 ? `${l}. ${t("OG")}` : `${-l}. ${t("UG")}`;
}

/**
 * @typedef {{level: number, name: string, unterirdisch: boolean}} Ebene  one storey level of a model
 */

/**
 * All storey levels of a model, ascending by level (lowest basement first), with the model's own name (a storey table may
 * rename a storey) and whether it lies below ground.
 * @param {any} model built model (`storeys: [{level, name, unterirdisch?}]`)
 * @returns {Ebene[]} empty list without a model
 */
export function ebenenListe(model) {
  const liste = Array.isArray(model?.storeys) ? model.storeys : [];
  return liste
    .filter((s) => Number.isFinite(Number(s?.level)))
    .map((s) => {
      const level = Math.round(Number(s.level));
      return { level, name: typeof s.name === "string" && s.name ? s.name : geschossName(level), unterirdisch: level < 0 };
    })
    .sort((a, b) => a.level - b.level);
}

/**
 * The storey levels an editor offers (structure, building services, furnishing, fire protection): the levels of the model
 * (basements included, ascending), or 0 … storeys − 1 while no model with storeys is there yet. The ONE fallback, so no editor
 * counts levels on its own.
 * @param {any} model built model (may be null)
 * @param {number} [storeys] number of storeys above ground for the fallback (integer ≥ 1)
 * @returns {number[]} ascending levels
 */
export function ebenenLevels(model, storeys = 1) {
  const liste = ebenenListe(model);
  if (liste.length) return liste.map((e) => e.level);
  return Array.from({ length: Math.max(1, Math.round(Number(storeys) || 1)) }, (_, i) => i);
}

/**
 * A level clamped into a list of levels (between its lowest and highest entry); an empty list returns the level unchanged.
 * Used with ebenenLevels() so the editors and their fallback share one clamp.
 * @param {number[]} levels ascending levels (ebenenLevels)
 * @param {number} level wanted level (integer)
 * @returns {number}
 */
export function levelKlemmen(levels, level) {
  const l = Math.round(Number(level) || 0);
  if (!levels.length) return l;
  return Math.max(levels[0], Math.min(levels[levels.length - 1], l));
}

/**
 * Lowest and highest storey level of a model.
 * @param {any} model built model
 * @returns {{min: number, max: number}} {0, 0} without storeys
 */
export function ebenenGrenzen(model) {
  const l = ebenenListe(model);
  if (!l.length) return { min: 0, max: 0 };
  return { min: l[0].level, max: l[l.length - 1].level };
}

/**
 * A level clamped between the lowest and the highest storey of the model (a saved view on level −1 of a project whose
 * basement was removed lands on the lowest storey that exists). Without a model with storeys the level is returned unchanged.
 * @param {any} model built model
 * @param {number} level wanted level (integer)
 * @returns {number}
 */
export function ebeneKlemmen(model, level) {
  const l = Math.round(Number(level) || 0);
  if (!Array.isArray(model?.storeys) || !model.storeys.length) return l;
  const { min, max } = ebenenGrenzen(model);
  return Math.max(min, Math.min(max, l));
}

/**
 * The level the floor plan (BimPlan2D) draws: with basements clamped between the lowest and the highest storey (ebeneKlemmen);
 * WITHOUT basements a negative level is kept as it is (only the top is clamped) - the behaviour before 107-13, which callers such
 * as the flat focus rely on when they pass the level of a cellar zone (−1) to draw its rooms (107-13 review).
 * @param {any} model built model
 * @param {number} level wanted level (integer)
 * @returns {number}
 */
export function planEbene(model, level) {
  if (level < 0 && !untergeschosseAnzahl(model?.untergeschosse)) return level;
  return ebeneKlemmen(model, level);
}

/**
 * Lowest storey level of a model (−U with basements, else 0). Hull slabs below it (the base slab) are contained in it.
 * @param {any} model built model
 * @returns {number}
 */
export function untersterLevel(model) {
  return Math.min(0, ebenenGrenzen(model).min);
}

/**
 * Is this hull slab the base slab? With basements: the lowest hull slab by elevation (the first one if two lie equally low).
 * Without basements the old rule of the IFC export and the selection (level ≤ 0 and not above ±0.00), so old projects keep
 * exactly their classification.
 * @param {any} model built model (`slabs`, optional `untergeschosse`)
 * @param {any} slab one entry of `model.slabs`
 * @returns {boolean}
 */
export function istBodenplatte(model, slab) {
  if (!slab) return false;
  const platten = Array.isArray(model?.slabs) ? model.slabs : [];
  if (!(untergeschosseAnzahl(model?.untergeschosse) > 0)) return slab.level <= 0 && !(slab.elevation > 0);
  let tiefste = null;
  for (const p of platten) if (tiefste == null || Number(p.elevation) < Number(tiefste.elevation)) tiefste = p;
  // compared by key (id, else level), not by reference: a caller that copies or filters the slabs ({...s}) still finds its base slab
  return tiefste != null && huellPlattenId(tiefste) === huellPlattenId(slab);
}

/**
 * Key of a hull slab for its GUID and its selection: its own `id` (base slab "-1", basement ceilings "ug-1" …), else its
 * level as text (every model without basements, so old files keep their GlobalIds).
 * @param {{id?: string, level: number}} slab
 * @returns {string}
 */
export function huellPlattenId(slab) {
  return slab?.id ?? `${slab?.level}`;
}

/**
 * The record of a generated hull wall as its data sheet (BIM studio panel) and the IFC export read it: the model wall plus
 * `huelle: true` and the key `<level>:<edge>`. Above ground the studio hands its live facade build-up (`aktuell`), which the
 * model wall carries anyway once it is rebuilt; a basement wall (`unterirdisch`, 107-13) always keeps its own build-up and
 * thickness (UG_AUFBAU_STANDARD of buildingModel.js), so panel and export describe the same wall (107-13 review: the panel showed the facade).
 * The attributes of the whole envelope ("hull-wall") apply to basement walls too - an own attribute key for walls in contact
 * with the ground is open (build-up plan 107-03).
 * @param {any} w  one entry of `model.walls` (thickness in m)
 * @param {{composite?: string|null, thickness?: number}} [aktuell]  live facade build-up of the studio (thickness in m)
 * @returns {any}  new object, `w` is not changed
 */
export function huellwandDaten(w, aktuell) {
  const basis = { ...w, huelle: true, id: `${w.level}:${w.edge}` };
  if (!aktuell || w.unterirdisch) return basis;
  return { ...basis, composite: aktuell.composite || undefined, thickness: aktuell.thickness };
}

/**
 * Name of a level as the model has it (a storey table may rename a storey), else the fixed name ("1. UG"). Replaces the index
 * access `model.storeys[level]`, which is wrong for basements (they are appended after the top storey).
 * @param {any} model built model
 * @param {number} level storey level (integer)
 * @returns {string}
 */
export function ebeneName(model, level) {
  const l = Math.round(Number(level) || 0);
  return ebenenListe(model).find((e) => e.level === l)?.name ?? geschossName(l);
}

/**
 * Number of storeys ABOVE ground in a model (storeys without `unterirdisch`), for readers that counted `model.storeys.length`.
 * @param {any} model built model
 * @returns {number} ≥ 0
 */
export function oberirdischeGeschosse(model) {
  return (Array.isArray(model?.storeys) ? model.storeys : []).filter((s) => !s?.unterirdisch && !(Number(s?.level) < 0)).length;
}

/**
 * 108-01: eaves height of the GLOBAL roof form of the BIM studio (select "Dachform" over the footprint), in m above ±0.00. The one
 * place every reader of that roof takes it from — 3D (BitBimStudio), the solid relations (roof as cutting body), the IFC export and
 * the screen and PDF section.
 * 108-02 (D-EFH-01): with a knee wall the model carries `traufhoehe_m` = top of the structural slab BELOW the top storey
 * (hoehen.deckenLage(...).oberkante_m of that hull slab, computed in buildingModel.kniestockGeometrie) + `kniestock_m`; that value is
 * returned. Without it, as before: the top of the uppermost storey, `model.totalHeight` (sum of the storey heights), else the storey
 * source for the storeys above ground. The readers stay untouched.
 * @param {any} model built model (createBuildingModel: traufhoehe_m, totalHeight, storeys)
 * @param {import("./hoehen.js").Geschosse} [gs] storey table of the programme (fallback when the model carries no totalHeight)
 * @returns {number} m
 */
export function globaleTraufhoehe_m(model, gs) {
  const t = model?.traufhoehe_m;
  if (t != null && Number.isFinite(Number(t))) return Number(t);
  return Number(model?.totalHeight) || gesamtHoehe(oberirdischeGeschosse(model) || 1, gs);
}
