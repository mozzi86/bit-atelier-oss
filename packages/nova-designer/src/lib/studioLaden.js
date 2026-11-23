// 115-05a (A-2): the values of the BIM studio exactly as its load sets them from a stored BimModel record - the ten element
// lists (missing → [], roofs through dachMigrieren like at load) and the envelope values of the autosave (STUDIO_WERTE of
// @core/lib/abgleich/modellAbgleich.js), normalised the same way. ONE function for the load, for taking a foreign state over
// as a whole (a clean tab reloads) and for the stored image ("abbild") the studio compares its values with: if load and
// image disagreed, a tab nobody touched would count as changed (e.g. migrated roofs) and meet fake conflicts.
//
// studioPatch (A-3): the autosave's patch built from these values when the save is planned (flush on a project switch).
//
// Pure: no React, no I/O. In: a record (or {}), the values the studio holds now. Out: the studio values, the patch.

import { dachMigrieren, DECKEN_STANDARD } from "@core/lib/bauteil/hoehen.js";
import { IDX_LISTEN } from "@core/lib/abgleich/idxListen.js";
import { guidsAnheften } from "@core/lib/bauteil/steckbrief.js";
import { ENTRANCE_START } from "@designer/lib/autoOpenings";

/**
 * Studio values of a stored record, as BitBimStudio's load sets them.
 * Values the load sets only when the record has them (envComposite, envThickness, parapet, dachform, dachneigung,
 * entranceCfg) keep `bisher` when the record has none - the studio keeps its value then as well.
 * @param {Record<string, any>|null|undefined} m stored BimModel record (or the base merged with a foreign patch)
 * @param {Record<string, any>} [bisher] the studio's single values now (studioWerteRef: same keys as the result)
 * @returns {Record<string, any>} the ten lists plus envComposite, envThickness (m), huelle_bezug, huelle_erscheinung,
 *   huelle_decke_dicke_m (m), huelle_decke_bezug, parapet ({enabled, height m}), dachform, dachneigung (degrees),
 *   entranceCfg (sizes in m), verschneidung, dachform_ifc, bauteil_attribute_layer (115-05c)
 */
export function studioWerteAusDatensatz(m, bisher = {}) {
  const r = m || {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of IDX_LISTEN) out[k] = Array.isArray(r[k]) ? r[k] : [];
  // 107-02: old roofs (only `pitch`, metres) get firsthoehe_m like at load
  out.customRoofs = out.customRoofs.map(dachMigrieren);
  out.envComposite = r.envComposite !== undefined ? r.envComposite : bisher.envComposite;
  out.envThickness = r.envThickness ? r.envThickness : bisher.envThickness;
  out.huelle_bezug = r.huelle_bezug === "outside" || r.huelle_bezug === "inside" ? r.huelle_bezug : "center";
  out.huelle_erscheinung = typeof r.huelle_erscheinung === "string" && r.huelle_erscheinung ? r.huelle_erscheinung : null;
  out.huelle_decke_dicke_m = Number(r.huelle_decke_dicke_m) > 0 ? Number(r.huelle_decke_dicke_m) : DECKEN_STANDARD.huelle.dicke_m;
  out.huelle_decke_bezug = r.huelle_decke_bezug === "oben" ? "oben" : DECKEN_STANDARD.huelle.bezug;
  out.parapet = r.parapet ? r.parapet : bisher.parapet;
  out.dachform = r.dachform ? r.dachform : bisher.dachform;
  out.dachneigung = r.dachneigung != null ? r.dachneigung : bisher.dachneigung;
  // 108-01: a stored `enabled` stays, none is added
  out.entranceCfg = r.entranceCfg ? { ...ENTRANCE_START, ...r.entranceCfg } : (bisher.entranceCfg ?? ENTRANCE_START);
  out.verschneidung = r.verschneidung === true; // 107-09
  out.dachform_ifc = r.dachform_ifc === true; // 107-10 review
  // 115-05c: the attribute layer of the hull / workshop elements (97-02) is a draft field of the studio as well (before: written at
  // once on each change in the panel)
  out.bauteil_attribute_layer = r.bauteil_attribute_layer ?? null;
  return out;
}

/**
 * Which additive fields the stored record has or got (they are written only then - a record that never had them stays without).
 * @typedef {{verschneidung: boolean, dachIfc: boolean, treppen: boolean, gauben: boolean, notizen: boolean, vordaecher?: boolean}} StudioHatte
 */

/**
 * 115-05a (A-3): the patch the studio's autosave writes, built from its values when the save is PLANNED (so a flush on a project
 * switch writes exactly what was pending for the project it belongs to). Content and GUID pinning are unchanged from the
 * autosave before 115-05a (BitBimStudio.jsx): only element fields - the programme fields belong to useBimModelSync (one writer
 * per field); a real save pins the GlobalId of walls, columns, rooms, slabs, roofs, stairs and dormers (107-08 review, lazy GUID;
 * the IFC export stays byte-identical).
 * @param {Record<string, any>} werte the studio values (same keys as studioWerteAusDatensatz)
 * @param {string|null} pid project the values belong to (part of the derived GUID)
 * @param {StudioHatte} hatte additive fields the record has or got
 * @returns {{patch: Record<string, any>, zonenAngeheftet: any[]}} zonenAngeheftet = the rooms as written (with GUIDs), for the
 *   write-back of the pinned room GUIDs into the state (W-1118-02 review)
 */
export function studioPatch(werte, pid, hatte) {
  const zonenAngeheftet = guidsAnheften(werte.customZones, pid, "customZones");
  const patch = {
    envComposite: werte.envComposite, envThickness: werte.envThickness, huelle_bezug: werte.huelle_bezug, huelle_erscheinung: werte.huelle_erscheinung || null,
    huelle_decke_dicke_m: werte.huelle_decke_dicke_m, huelle_decke_bezug: werte.huelle_decke_bezug, parapet: werte.parapet, dachform: werte.dachform,
    dachneigung: werte.dachneigung, entranceCfg: werte.entranceCfg,
    // 107-09: a record without the field stays without it until the switch is used (old projects load and save unchanged)
    ...(werte.verschneidung || hatte.verschneidung ? { verschneidung: werte.verschneidung } : {}),
    // 107-10 review: the same rule for the switch "Gebäudedach ins IFC"
    ...(werte.dachform_ifc || hatte.dachIfc ? { dachform_ifc: werte.dachform_ifc } : {}),
    customWalls: guidsAnheften(werte.customWalls, pid, "customWalls"), customColumns: guidsAnheften(werte.customColumns, pid, "customColumns"),
    customWindows: werte.customWindows, envOpenings: werte.envOpenings,
    customZones: zonenAngeheftet, customSlabs: guidsAnheften(werte.customSlabs, pid, "customSlabs"), customRoofs: guidsAnheften(werte.customRoofs, pid, "customRoofs"),
    // 108-06 / 108-13: additive — written only once the record had or got the list (an emptied list is written as [] so a deletion sticks)
    ...(hatte.treppen ? { customStairs: guidsAnheften(werte.customStairs, pid, "customStairs") } : {}),
    ...(hatte.gauben ? { gauben: guidsAnheften(werte.gauben, pid, "gauben") } : {}),
    ...(hatte.notizen ? { planNotizen: werte.planNotizen } : {}), // 261111-zs1: the same additive rule for the plan notes
    ...(hatte.vordaecher ? { vordaecher: guidsAnheften(werte.vordaecher, pid, "vordaecher") } : {}), // W-1118-29: canopies, additive like the dormers
    // 115-05c: null on a record without the layer is equal to its base and not sent (saveBimModel)
    bauteil_attribute_layer: werte.bauteil_attribute_layer ?? null,
  };
  return { patch, zonenAngeheftet };
}
