// Reference line of a wall — the ONE derivation of where the wall body lies (phase 107-01,
// spec part II.1 and VI.2/VI.3). Before, the offset of the body against the line a→b was copied into
// BimPlan2D (screen plan), vektorPlan (PDF plan) and twice into BitBimStudio (3D), and the IFC export
// had none: a wall with reference line "outside" stood half a wall thickness elsewhere in the IFC
// than in the plan. Now all four call this file.
//
// Rule (spec VI.3): the store holds the BASE GEOMETRY of a wall (a, b, thickness or build-up,
// refLine); mesh, plan, PDF and IFC are always derived from it. A mesh is never the source and may
// at most later lie as a discardable intermediate store (D-BK-08a, plan 107-14). Nothing here writes
// back into a, b or the thickness: changing thickness or build-up moves the body, not the line.
//
// Geometry (model plane x/z in metres, y up; IFC X = x, IFC Y = z):
//   direction  d = (b − a) / |b − a|
//   normal     n = (−dz, dx)               — the same normal as the 3D walls and the IFC local Y axis
//   body       = rectangle a→b over the thickness, its centre line shifted by `versatz_m` along n
// `refLine` names the side of the line on which the body lies (stored English enum, unchanged):
//   "center"   versatz_m = 0         line = centre of the body (default, old projects)
//   "outside"  versatz_m = +d/2      body on the +n side of the line, the line is the −n face
//   "inside"   versatz_m = −d/2      body on the −n side of the line, the line is the +n face
// Build-up layers run outside → inside along −n (the first skin sits at +n, aufbauten.js header).
//
// New values (D-BK-01, 107-01; real offsets since 107-03): "coreOutside" | "coreInside" |
// "coreCenter" put the LINE on the outer face / inner face / centre of the core layer (the face of the layer that carries
// `funktion: "kern"`, e.g. the concrete wall behind the insulation; German labels "Kern außen / Kern innen / Kern Mitte").
// They need `kern = { aussen_m, kern_m }` (sum of the layers outside the core, core thickness, both m), which kernVon() derives
// from the build-up of the wall (bauteil/aufbauten.js: stated or proposed core layer, never from the material category alone;
// wandGeometrie() calls it itself when the wall carries a core value, so plan, PDF, 3D and IFC all get the same offset).
// Without a core they behave exactly like "center" (D-BW-03: nothing is invented); the data sheet then says
// "abgeleitet" (steckbrief.js: source "abgeleitet" + an assumption text, decided through kernFehlt()); it says the same when
// the core layer is only a proposal.
//
// Workshop walls (werkstattBauteile.js D-BW-02): they carry no refLine; they are drawn as
// "center" on the shared zone edge (the zone keeps its clear dimension, the wall is centred on the
// edge in plan, 3D and IFC). Nothing changes there.
//
// In:  wall records ({a, b, composite?, thickness?, refLine?}), thickness in m, optional core split.
// Out: plain numbers and objects; pure, no I/O, node-testable.
import { compositeTotalM } from "../buildingModel.js";
import { aufbauVon, kernLage } from "./aufbauten.js";
import { wandHoehe, unterkante } from "./hoehen.js";

/** Stored reference-line values of a wall (English enum, extended additively in 107-01). */
export const REF_LINIEN = Object.freeze(["center", "outside", "inside", "coreOutside", "coreInside", "coreCenter"]);

/** The three values that need a core layer; without one they act as "center". */
export const KERN_REF_LINIEN = Object.freeze(["coreOutside", "coreInside", "coreCenter"]);

/**
 * Fallback wall thickness in m when neither a build-up nor a thickness is known.
 * [ASSUMED] 0.30 m: the editor's long-standing default for a drawn wall (it was the literal in all four old copies);
 * not a norm value, replace by the project's wall type once one is set.
 */
export const STANDARD_DICKE_M = 0.3;

/**
 * Core split of a build-up for the core reference lines.
 * @typedef {{aussen_m: number, kern_m: number}} KernLage
 *   aussen_m = sum of the layer thicknesses outside the core (m), kern_m = core thickness (m);
 *   the rest of the thickness lies inside the core. Delivered by kernVon() (107-03); `null` = no core known.
 */

/**
 * @typedef {{x: number, z: number}} PktXZ  plan point in metres
 * @typedef {object} WandGeometrie
 * @property {PktXZ} mitte           middle of the REFERENCE LINE a→b (m)
 * @property {PktXZ} richtung        unit vector a→b (zero vector for a zero-length wall)
 * @property {PktXZ} normale         unit normal n = (−dz, dx)
 * @property {number} laenge_m       length of a→b in m
 * @property {number} dicke_m        wall thickness in m
 * @property {number} versatz_m      shift of the body centre line against the reference line along n, in m
 * @property {PktXZ} koerperMitte    middle of the body centre line = mitte + n · versatz_m (m)
 * @property {PktXZ[]} polygon       body outline a+, b+, b−, a− (m): + = versatz + dicke/2, − = versatz − dicke/2
 */

/**
 * @param {unknown} kern
 * @param {number} dicke_m
 * @returns {KernLage|null} the core split if it is usable, else null
 */
function kernGueltig(kern, dicke_m) {
  const k = /** @type {any} */ (kern);
  if (!k || !Number.isFinite(k.aussen_m) || !Number.isFinite(k.kern_m)) return null;
  if (k.aussen_m < 0 || !(k.kern_m > 0)) return null;
  // [ASSUMED] 1 mm tolerance for the mm → m rounding of the build-up table (thicknesses are whole mm); a way to a
  // proven value: none needed, it only absorbs float noise and never decides a position.
  if (k.aussen_m + k.kern_m > dicke_m + 1e-3) return null;
  return { aussen_m: k.aussen_m, kern_m: k.kern_m };
}

/**
 * Shift of the wall body centre line against the reference line, along the normal.
 * @param {string|null|undefined} refLine one of REF_LINIEN; unknown or missing = "center"
 * @param {number} dicke_m total wall thickness in m
 * @param {KernLage|null} [kern] core split for the core values; null = no core known (acts as "center")
 * @returns {number} shift in m (positive = towards +n); 0 for "center", unknown values and core values without a core
 */
export function refVersatz_m(refLine, dicke_m, kern = null) {
  const d = Number.isFinite(dicke_m) ? dicke_m : 0;
  if (refLine === "outside") return d / 2;
  if (refLine === "inside") return -d / 2;
  if (refLine === "coreOutside" || refLine === "coreInside" || refLine === "coreCenter") {
    const k = kernGueltig(kern, d);
    if (!k) return 0;
    // Position of the line in body coordinates (0 = body centre, +d/2 = outer face at +n):
    //   outer face of the core  d/2 − aussen_m,  inner face  d/2 − aussen_m − kern_m,  centre between.
    // The body centre then lies at −position from the line.
    const lage = refLine === "coreOutside" ? d / 2 - k.aussen_m
      : refLine === "coreInside" ? d / 2 - k.aussen_m - k.kern_m
        : d / 2 - k.aussen_m - k.kern_m / 2;
    return -lage;
  }
  return 0;
}

/**
 * True when the value is a core reference line but no usable core is known, i.e. the wall is
 * treated as "center" (the data sheet reports the position as derived).
 * @param {string|null|undefined} refLine
 * @param {number} dicke_m total thickness in m
 * @param {KernLage|null} [kern]
 * @returns {boolean}
 */
export function kernFehlt(refLine, dicke_m, kern = null) {
  return KERN_REF_LINIEN.includes(/** @type {any} */ (refLine)) && !kernGueltig(kern, Number.isFinite(dicke_m) ? dicke_m : 0);
}

/**
 * Core split of a wall from its build-up (107-03): the layer with function "kern", stated in the build-up or on the element
 * (`schicht_funktion`) or proposed (aufbauten.js funktionVorschlag). Never decided by the material category alone.
 * A wall that only has a thickness (no build-up, source "dicke") has no core for the reference lines: its single layer is only a
 * placeholder, and a core value on such a wall acted like "center" before 107-03 — old projects load unchanged (107-03 review).
 * @param {any} w wall record (composite / klasse / thickness / schicht_funktion …)
 * @returns {(KernLage & {abgeleitet: boolean})|null} core split in m, abgeleitet = the core layer is only a proposal; null = no core layer
 */
export function kernVon(w) {
  const aufbau = aufbauVon(w);
  return aufbau.quelle === "dicke" ? null : kernLage(aufbau.schichten);
}

/**
 * Effective wall thickness: total of the build-up if one is set, else the single thickness, else 0.30 m.
 * (The one rule that plan, PDF, 3D and IFC used four times.)
 * @param {{composite?: string|null, thickness?: number|null}} w wall record (thickness in m)
 * @returns {number} thickness in m
 */
export function wandDicke_m(w) {
  return compositeTotalM(w?.composite) || w?.thickness || STANDARD_DICKE_M;
}

/**
 * All derived plan geometry of one wall from its base geometry. Pure; never stores anything.
 * @param {{a: PktXZ, b: PktXZ, composite?: string|null, thickness?: number|null, refLine?: string|null}} w
 *   wall record: reference line end points a, b in m, build-up id or thickness in m, reference line value
 * @param {{dicke_m?: number, kern?: KernLage|null}} [opt]
 *   dicke_m: thickness in m that replaces the one derived from the record (3D draws every layer of a build-up as its own body);
 *   kern: core split for the core reference lines; absent = derived from the wall record itself (kernVon, 107-03) when the wall
 *   carries a core value, `null` = no core on purpose
 * @returns {WandGeometrie}
 */
export function wandGeometrie(w, opt = {}) {
  const dx0 = w.b.x - w.a.x, dz0 = w.b.z - w.a.z;
  // `|| 1` keeps a zero-length wall finite (zero direction) instead of NaN — same as the old copies
  const laenge = Math.hypot(dx0, dz0);
  const len = laenge || 1;
  const dx = dx0 / len, dz = dz0 / len;
  const nx = -dz, nz = dx;
  const dicke = opt.dicke_m ?? wandDicke_m(w);
  // 107-03: a core value needs the core split; the record carries the build-up, so the one derivation stays here for all callers
  const kern = opt.kern !== undefined ? opt.kern : KERN_REF_LINIEN.includes(/** @type {any} */ (w.refLine)) ? kernVon(w) : null;
  const o = refVersatz_m(w.refLine, dicke, kern);
  const h = dicke / 2;
  const punkt = (/** @type {PktXZ} */ p, /** @type {number} */ q) => ({ x: p.x + nx * q, z: p.z + nz * q });
  return {
    mitte: { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 },
    richtung: { x: dx, z: dz },
    normale: { x: nx, z: nz },
    laenge_m: laenge,
    dicke_m: dicke,
    versatz_m: o,
    koerperMitte: { x: (w.a.x + w.b.x) / 2 + nx * o, z: (w.a.z + w.b.z) / 2 + nz * o },
    polygon: [punkt(w.a, o + h), punkt(w.b, o + h), punkt(w.b, o - h), punkt(w.a, o - h)],
  };
}

/**
 * @typedef {object} SchnittWand
 * @property {number} von_m    left edge of the cut wall in the section, x in m
 * @property {number} bis_m    right edge of the cut wall, x in m
 * @property {number} dicke_m  cut thickness in m (bis_m − von_m)
 */

/**
 * The two cut side walls of the hull in the section at z = 0 (screen section BimPlan2D and PDF section vektorPlan
 * use this one function; 107-01 review fix: both had their own copy that did not know the hull reference line).
 * The cut follows the wall BODY from wandGeometrie() like plan, 3D and IFC: the part of the body outline of the hull walls of the
 * lowest storey that crosses z = 0. With `huelle_bezug` "center" the wall is centred on the footprint line, so the cut spans half a
 * thickness to either side of it; "outside" puts the body inside the footprint box, "inside" outside of it.
 * 107-03 (user decision 25.10.2026, D-BK-26): this replaces the old "center" section, which drew the walls INSIDE the footprint box
 * (x0 … x0 + wt) while plan, 3D and IFC centred them on the line — a deviation of half a wall thickness that existed before 107-01.
 * Existing sections therefore shift: both cut walls move outwards by half a wall thickness (left wall x0 − wt/2 … x0 + wt/2, right wall
 * x1 − wt/2 … x1 + wt/2) and now agree with the plan; the dimension line (footprint width) stays.
 * @param {{footprint?: Array<PktXZ>, walls?: Array<any>}} model createBuildingModel result (m)
 * @returns {SchnittWand[]} [left, right]; empty without a footprint
 */
export function huellSchnittWaende(model) {
  const fp = Array.isArray(model?.footprint) ? model.footprint : [];
  if (fp.length < 3) return [];
  const x0 = Math.min(...fp.map((p) => p.x)), x1 = Math.max(...fp.map((p) => p.x));
  const wt = model.walls?.[0]?.thickness || STANDARD_DICKE_M;
  // Fallback (no hull wall crosses the section plane twice, e.g. a model without walls): centred on the footprint line like the plan.
  /** @type {SchnittWand[]} */
  const mitte = [{ von_m: x0 - wt / 2, bis_m: x0 + wt / 2, dicke_m: wt }, { von_m: x1 - wt / 2, bis_m: x1 + wt / 2, dicke_m: wt }];
  const erste = (model.walls || []).filter((w) => w.level === model.walls?.[0]?.level);
  /** @type {Array<{von: number, bis: number}>} */
  const schnitte = [];
  for (const w of erste) {
    const g = wandGeometrie(w);
    if (Math.abs(g.richtung.z) < 1e-6) continue; // runs along the section plane: no cut
    const xs = [];
    for (let i = 0; i < 4; i++) {
      const p = g.polygon[i], q = g.polygon[(i + 1) % 4];
      if ((p.z <= 0 && q.z >= 0 || p.z >= 0 && q.z <= 0) && p.z !== q.z) xs.push(p.x + (q.x - p.x) * (0 - p.z) / (q.z - p.z));
    }
    if (xs.length >= 2) schnitte.push({ von: Math.min(...xs), bis: Math.max(...xs) });
  }
  if (schnitte.length < 2) return mitte;
  const links = schnitte.reduce((a, b) => (b.von < a.von ? b : a));
  const rechts = schnitte.reduce((a, b) => (b.bis > a.bis ? b : a));
  if (links === rechts) return mitte;
  return [{ von_m: links.von, bis_m: links.bis, dicke_m: links.bis - links.von }, { von_m: rechts.von, bis_m: rechts.bis, dicke_m: rechts.bis - rechts.von }];
}

/**
 * @typedef {object} Eckfueller
 * @property {number} x       centre x in m
 * @property {number} z       centre z in m
 * @property {number} dicke_m side length of the square pillar in m (thickest wall of the corner)
 * @property {number} hoehe_m pillar height in m (tallest wall of the corner, 3 m if none states one; 107-02: through wandHoehe, so a wall linked to the storey counts with its linked height)
 * @property {number} unterkante_m lower edge of the pillar in m (lowest lower edge of the walls of the corner, 107-02)
 * @property {number} level   storey index
 */

/**
 * Corner fillers of drawn walls: where two or more walls of one storey end at the same spot, the
 * corner gets a small square pillar so the joint is closed (wall clean-up, dependency-free).
 * The pillar sits on the BODY corner, not on the line end point: for walls whose reference line is
 * not "center" the body lies beside the line, so a pillar centred on the line end would stand half
 * a thickness out of the corner (107-01; seen in the browser for "outside" with equally thick walls, "inside", "center", mixed thicknesses
 * and mixed references are covered by the `eckfueller` unit tests only).
 * Walls that all have no offset (old projects, "center") keep the old position — the mean of the
 * line end points — so their 3D stays unchanged.
 * @param {Array<{a: PktXZ, b: PktXZ, level?: number, _idx?: number|string, height?: number, composite?: string|null, thickness?: number|null, refLine?: string|null}>} waende drawn walls (m)
 * @param {number} [toleranz_m] end points closer than this (m) belong to one corner [ASSUMED default 0.3 m, the value of the old
 *   BitBimStudio.cornerFillers; matches the drawing snap, not a measured figure]
 * @param {import("./hoehen.js").Geschosse} [geschosse] storey source for linked wall heights and lower edges (107-02; one height in m or the storey table)
 * @returns {Eckfueller[]}
 */
export function eckfueller(waende, toleranz_m = 0.3, geschosse = undefined) {
  const pts = [];
  for (const w of waende) {
    const g = wandGeometrie(w);
    pts.push({ x: w.a.x, z: w.a.z, w, g }, { x: w.b.x, z: w.b.z, w, g });
  }
  const benutzt = new Array(pts.length).fill(false);
  /** @type {Eckfueller[]} */
  const ergebnis = [];
  for (let i = 0; i < pts.length; i++) {
    if (benutzt[i]) continue;
    const gruppe = [i]; benutzt[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (benutzt[j]) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < toleranz_m && pts[i].w.level === pts[j].w.level) { gruppe.push(j); benutzt[j] = true; }
    }
    // different walls → a real corner
    const verschieden = [...new Set(gruppe.map((k) => pts[k].w._idx))];
    if (verschieden.length < 2) continue;
    const mittel = (/** @type {(k: number) => PktXZ} */ pos) => ({ x: gruppe.reduce((s, k) => s + pos(k).x, 0) / gruppe.length, z: gruppe.reduce((s, k) => s + pos(k).z, 0) / gruppe.length });
    let mitte = mittel((k) => pts[k]);
    if (gruppe.some((k) => pts[k].g.versatz_m !== 0)) {
      // body end points: line end shifted by the offset along the normal
      const koerper = mittel((k) => ({ x: pts[k].x + pts[k].g.normale.x * pts[k].g.versatz_m, z: pts[k].z + pts[k].g.normale.z * pts[k].g.versatz_m }));
      mitte = koerper;
      // two non-parallel walls: the corner is the crossing of their body centre lines
      const a = pts[gruppe[0]];
      // [ASSUMED] |sin| > 0.1 (about 5.7°) counts as "not parallel"; flatter corners use the mean of the body ends instead
      const b = gruppe.map((k) => pts[k]).find((p) => p.w._idx !== a.w._idx && Math.abs(a.g.richtung.x * p.g.richtung.z - a.g.richtung.z * p.g.richtung.x) > 0.1);
      if (b) {
        const det = a.g.richtung.x * b.g.richtung.z - a.g.richtung.z * b.g.richtung.x;
        const pa = a.g.koerperMitte, pb = b.g.koerperMitte;
        const t = ((pb.x - pa.x) * b.g.richtung.z - (pb.z - pa.z) * b.g.richtung.x) / det;
        const kreuz = { x: pa.x + a.g.richtung.x * t, z: pa.z + a.g.richtung.z * t };
        // sanity: the crossing must lie near the body end points (guards nearly parallel walls)
        const dmax = Math.max(...gruppe.map((k) => pts[k].g.dicke_m));
        if (Math.hypot(kreuz.x - koerper.x, kreuz.z - koerper.z) <= dmax + toleranz_m) mitte = kreuz;
      }
    }
    ergebnis.push({
      x: mitte.x, z: mitte.z,
      dicke_m: Math.max(...gruppe.map((k) => pts[k].g.dicke_m)),
      // [ASSUMED] 3 m when no wall of the corner states a height and no storey source is given: the literal of the old
      // BitBimStudio.cornerFillers (wandHoehe falls back to the storey height of `geschosse`, 3 m without it).
      hoehe_m: Math.max(...gruppe.map((k) => wandHoehe(pts[k].w, geschosse))),
      unterkante_m: Math.min(...gruppe.map((k) => unterkante(pts[k].w, geschosse))),
      level: pts[gruppe[0]].w.level,
    });
  }
  return ergebnis;
}
