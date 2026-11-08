// 108-03 (D-EFH-02): the hull walls of the top storey under a pitched GLOBAL roof reach up to the roof contour — a gable wall is the
// wall itself, cut against the roof planes, not a separate "giebel" triangle of the roof. Pure mathematics, no three.js, no React: the
// studio (3D wall polygon, host of openings in the gable), the IFC export (IfcArbitraryClosedProfileDef), the opening checks
// (oeffnungPasst / lochImWand against the profile) and the quantities (gable area) read the SAME profile from here.
//
// The profile comes from seoAnalytik.wandProfilUnterDach (107-10, exact break points) in the frame of the wall body — the same frame
// ifcExport.js and bauteil/seo.js use (origin at the body start a + n·versatz, x along a→b, y up from the wall bottom). The roof is
// dachGeometrie.globalesDach, so 3D, IFC, section and this file build on ONE roof.
//
// Rules:
//  - Only hull walls of the top storey above ground (`kniestock: true`, or `level` = highest storey) and only with `dach.ok` and a
//    pitched form. The wall is first thought of as high as the ridge; the roof clips it.
//  - An eaves wall (profile top = eaves height everywhere, `quer_geneigt` across the thickness) keeps its stored height: no profile is
//    returned for it, so every reader behaves exactly as before 108-03 for eaves walls. [ASSUMED] threshold 1 cm above the stored height.
//  - Nothing is stored: `mitGiebelProfilen` returns a COPY of the built model with `profil` on the affected walls (createBuildingModel
//    stays untouched, goldens without a pitched roof are byte-identical).
//
// In:  built model (createBuildingModel), DachErgebnis of the global roof.
// Out: huellProfile (Map "<level>:<edge>" → profile), mitGiebelProfilen (model copy), profilHoehe / profilHoeheBereich (height of the
//      profile at a position / its minimum over a span), hatGiebelProfile.

import { wandProfilUnterDach, dachImRahmen } from "./seoAnalytik.js";
import { wandGeometrie } from "./referenz.js";

/** Minimum rise above the stored wall height for a wall to count as a gable (profile) wall, m. [ASSUMED] 1 cm (numerical noise guard). */
export const GIEBEL_MIN_ANSTIEG_M = 0.01;

/**
 * @typedef {{x: number, y: number}} PktXY
 * @typedef {object} HuellProfil
 * @property {PktXY[]} punkte          polygon in the wall plane, m: x along the wall from the body start (0…L), y above the wall bottom; bottom edge first
 * @property {PktXY[]} oben            the top edge only, sorted by x ascending (for height lookups)
 * @property {number} hoehe_max_m      highest point of the profile above the wall bottom, m
 * @property {number} flaeche_m2       area of the profile, m²
 * @property {number} laenge_m         wall length, m
 * @property {boolean} quer_geneigt    the roof changes across the thickness (the profile takes the lower face)
 */

/**
 * Key of a hull wall as the openings chain and the IFC export use it.
 * @param {{level: number, edge: number}} w
 * @returns {string}
 */
export function huellSchluessel(w) {
  return `${w.level}:${w.edge}`;
}

/**
 * Profiles of the hull walls of the top storey under the global roof (see file head).
 * @param {any} model built model (createBuildingModel: walls with a, b, thickness, height, elevation, level, edge, refLine)
 * @param {import("./dachGeometrie.js").DachErgebnis|import("./dachGeometrie.js").DachFehler|null|undefined} dach globalesDach
 * @returns {Map<string, HuellProfil>} "<level>:<edge>" → profile; empty without a pitched roof
 */
export function huellProfile(model, dach) {
  /** @type {Map<string, HuellProfil>} */
  const out = new Map();
  if (!dach || !dach.ok || dach.form === "flach" || !Array.isArray(model?.walls)) return out;
  const oben = Math.max(-Infinity, ...model.walls.filter((w) => !w.unterirdisch && Number(w.level) >= 0).map((w) => Number(w.level)));
  if (!Number.isFinite(oben)) return out;
  const first = dach.traufhoehe_m + dach.anstieg_m;
  for (const w of model.walls) {
    if (w.unterirdisch || Math.round(Number(w.level)) !== oben) continue;
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    if (len < 0.05) continue;
    const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
    const th = Number(w.thickness) || 0.3;
    const { versatz_m } = wandGeometrie({ a: w.a, b: w.b, refLine: w.refLine }, { dicke_m: th });
    // the wall thought of as high as the ridge; the roof clips it (same frame as ifcExport / seo.js wandUnterDach)
    const H = Math.max(Number(w.height) || 0, first - Number(w.elevation || 0));
    const rahmen = { ursprung: { x: w.a.x - dz * versatz_m, y: Number(w.elevation) || 0, z: w.a.z + dx * versatz_m }, drehung_y: -Math.atan2(dz, dx) };
    const prof = wandProfilUnterDach({ laenge_m: len, hoehe_m: H, dicke_m: th }, dachImRahmen(dach, rahmen));
    if (!prof || prof.punkte.length < 3) continue;
    const obenPts = prof.punkte.slice(2).slice().reverse(); // punkte = [bottom-left, bottom-right, top edge from x = L back to 0]
    const hoeheMax = Math.max(...obenPts.map((p) => p.y));
    if (hoeheMax <= (Number(w.height) || 0) + GIEBEL_MIN_ANSTIEG_M) continue; // eaves wall: stays as stored
    out.set(huellSchluessel(w), { punkte: prof.punkte, oben: obenPts.sort((p, q) => p.x - q.x), hoehe_max_m: hoeheMax, flaeche_m2: prof.flaeche_m2, laenge_m: len, quer_geneigt: prof.quer_geneigt });
  }
  return out;
}

/**
 * Height of the profile top edge at `x` m along the wall (piecewise linear; outside 0…L the nearest end).
 * @param {HuellProfil} profil
 * @param {number} x m
 * @returns {number} m
 */
export function profilHoehe(profil, x) {
  const o = profil.oben;
  if (!o.length) return profil.hoehe_max_m;
  if (x <= o[0].x) return o[0].y;
  for (let i = 1; i < o.length; i += 1) {
    const a = o[i - 1], b = o[i];
    if (x <= b.x + 1e-12) {
      // a vertical jump (two points at the same x): the lower of both
      if (b.x - a.x < 1e-9) return Math.min(a.y, b.y);
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return o[o.length - 1].y;
}

/**
 * Lowest profile height over the span x0…x1 (ends and every break point inside), m — the height an opening of that span has to fit under.
 * @param {HuellProfil} profil
 * @param {number} x0 m
 * @param {number} x1 m
 * @returns {number} m
 */
export function profilHoeheBereich(profil, x0, x1) {
  const a = Math.min(x0, x1), b = Math.max(x0, x1);
  let h = Math.min(profilHoehe(profil, a), profilHoehe(profil, b));
  for (const p of profil.oben) if (p.x > a && p.x < b) h = Math.min(h, p.y);
  return h;
}

/**
 * A copy of the built model whose top-storey hull walls carry `profil` (HuellProfil) and `hoehe_profil_m`; `height` stays the stored
 * value (rule windows and every reader that ignores the profile behave as before). Without profiles the same model object is returned.
 * @param {any} model built model
 * @param {import("./dachGeometrie.js").DachErgebnis|import("./dachGeometrie.js").DachFehler|null|undefined} dach
 * @returns {{model: any, profile: Map<string, HuellProfil>}}
 */
export function mitGiebelProfilen(model, dach) {
  const profile = huellProfile(model, dach);
  if (!profile.size) return { model, profile };
  const walls = model.walls.map((w) => { const p = profile.get(huellSchluessel(w)); return p ? { ...w, profil: p, hoehe_profil_m: p.hoehe_max_m } : w; });
  return { model: { ...model, walls }, profile };
}

/**
 * Extra wall area of the gables above the stored wall height, m² — what the hull quantities add for the gable triangles.
 * @param {Map<string, HuellProfil>} profile huellProfile
 * @param {any} model built model (for the stored heights)
 * @returns {number} m²
 */
export function giebelZuschlag_m2(profile, model) {
  let s = 0;
  for (const w of Array.isArray(model?.walls) ? model.walls : []) {
    const p = profile.get(huellSchluessel(w));
    if (p) s += Math.max(0, p.flaeche_m2 - p.laenge_m * (Number(w.height) || 0));
  }
  return s;
}
