// Tracing underlays ("Transparenzpausen") for the sketch tool (user wish 15.11.2026): the floor plan of every storey and the
// sections A-A and B-B of the project's building model as plain grey line work the sketch is drawn over — like tracing paper on a plan.
//
// One source with the printed plans: the lines come from planGrafik() / schnittGrafik() (vektorPlan.js), the same primitives the
// PDF and DXF sheets are made of, in black-and-white mode. Only the line work is taken (texts, fills and hatches stay out: an
// underlay must not compete with the ink). Display only — nothing is written to the model or to the sketch.
//
// Coordinates: the sketch world is metres with y up and maps onto the plan as sketch.x = model.x, sketch.y = −model.z
// (SketchEditOverlay.jsx). The section stores its vertical axis as z = −height, so the same mapping draws it upright with the
// floor level ±0,00 on y = 0.
//
// In:  the stored BimModel record of the project (planAusDatensatz builds the model from it — the sketch page does not mount the
//      programme store, so its values would be the defaults of an empty project). Out: a list of underlays for
//      @sketch/pages/SketchStudio (prop `pausen`); @sketch may not import @designer, so the host hands the data in.
import { planGrafik, schnittGrafik } from "@designer/lib/vektorPlan";
import { globalesDach } from "@core/lib/bauteil/dachGeometrie.js";
import { planModellBauen } from "@designer/lib/usePlanModel";

/**
 * @typedef {{pts: Array<{x: number, y: number}>, geschlossen: boolean, dash: string|null}} PauseLinie  points in m (sketch world)
 * @typedef {{id: string, art: "grundriss"|"schnitt", geschoss: string|null, linien: PauseLinie[],
 *   bbox: {minX: number, minY: number, maxX: number, maxY: number}|null}} Pause  geschoss: storey name, or "A-A" / "B-B" of a
 *   section; bbox in m, null for an empty underlay
 */

/**
 * Line work of a plan graphic in sketch coordinates.
 * @param {{elemente?: any[]}|null|undefined} grafik output of planGrafik() / schnittGrafik() (m, z down)
 * @returns {{linien: PauseLinie[], bbox: Pause["bbox"]}}
 */
export function grafikZuPause(grafik) {
  /** @type {PauseLinie[]} */
  const linien = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of grafik?.elemente || []) {
    if (e?.art !== "poly" || !Array.isArray(e.pts) || e.pts.length < 2) continue;
    if (!e.stroke || e.stroke === "none") continue; // a fill without an outline (hatch area, room tint) is no line
    const pts = e.pts.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z)).map((p) => ({ x: p.x, y: 0 - p.z })); // 0 − z: no negative zero
    if (pts.length < 2) continue;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    linien.push({ pts, geschlossen: !e.offen, dash: e.dash || null });
  }
  return { linien, bbox: linien.length ? { minX, minY, maxX, maxY } : null };
}

/**
 * Read model of a stored BimModel record: the built model (same builder as the planner tabs, planModellBauen) and the drawn
 * elements. Project build-ups must be registered before (setzeProjektAufbauten), as for every model built from a record.
 * @param {any} satz BimModel record (footprintM in m, storeys, storeyHeight in m, geschosse, untergeschosse, custom…, dachform …)
 * @returns {any|null} input of transparenzPausen(); null without a footprint of at least three points
 */
export function planAusDatensatz(satz) {
  if (!satz || !Array.isArray(satz.footprintM) || satz.footprintM.length < 3) return null;
  const storeys = Math.max(1, Math.round(Number(satz.storeys) || 1));
  const storeyHeight = Number(satz.storeyHeight) > 0 ? Number(satz.storeyHeight) : 3;
  const model = planModellBauen({ footprintM: satz.footprintM, storeys, storeyHeight, geschosse: satz.geschosse || null, untergeschosse: satz.untergeschosse || 0 }, satz);
  return {
    model, storeyHeight, geschosse: satz.geschosse || null,
    customWalls: satz.customWalls || [], customColumns: satz.customColumns || [], customSlabs: satz.customSlabs || [],
    customRoofs: satz.customRoofs || [], zones: satz.customZones || [], customWindows: satz.customWindows || [],
    envOpenings: satz.envOpenings || [], customStairs: satz.customStairs || [], gauben: satz.gauben || [],
    dachform: satz.dachform || "flach", dachneigung: satz.dachneigung ?? 30,
  };
}

/**
 * The underlays of a project: one floor plan per storey (lowest first) and the sections A-A and B-B.
 * @param {any} plan read model (planAusDatensatz): model, customWalls, customColumns, customSlabs, customRoofs, zones,
 *   customWindows, envOpenings, customStairs, gauben, dachform, dachneigung (degrees), geschosse, storeyHeight (m)
 * @returns {Pause[]} empty without a footprint
 */
export function transparenzPausen(plan) {
  const model = plan?.model;
  if (!model || !Array.isArray(model.storeys) || !model.storeys.length || !(model.walls || []).length) return [];
  const dach = plan.dachform && plan.dachform !== "flach" ? globalesDach(model, plan.dachform, Number(plan.dachneigung), plan.geschosse || undefined) : null;
  const dachOk = dach && /** @type {any} */ (dach).ok ? dach : null;
  /** @type {Pause[]} */
  const out = [];
  const geschosse = [...model.storeys].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  for (const st of geschosse) {
    const level = st.level ?? 0;
    const grafik = planGrafik({
      model, level, sw: true, massstab: 100,
      customWalls: plan.customWalls || [], customColumns: plan.customColumns || [], customSlabs: plan.customSlabs || [],
      customRoofs: plan.customRoofs || [], customZones: plan.zones || [], customWindows: plan.customWindows || [],
      envOpenings: plan.envOpenings || [], customStairs: plan.customStairs || [], gauben: plan.gauben || [],
      dach: dachOk, geschosse: plan.geschosse || null,
    });
    out.push({ id: `grundriss:${level}`, art: "grundriss", geschoss: st.name || String(level), ...grafikZuPause(grafik) });
  }
  // both section axes of the studio: A-A (cut along x) and B-B (model turned, cut along z — the gable profile of a gable roof)
  for (const [id, name, achse] of /** @type {Array<[string, string, "x"|"z"]>} */ ([["schnitt", "A-A", "x"], ["schnitt-b", "B-B", "z"]])) {
    const schnitt = schnittGrafik({ model, storeyHeight: plan.storeyHeight || 3, sw: true, massstab: 100, dach: dachOk, achse });
    out.push({ id, art: "schnitt", geschoss: name, ...grafikZuPause(schnitt) });
  }
  return out.filter((p) => p.linien.length);
}
