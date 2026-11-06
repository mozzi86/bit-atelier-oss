// Adapter between the English element schema of the external spec (part V: guid, container, ifc_classification,
// pset_common, renovation_status, spatial_linking, geometry, structure) and the German fields BIT-Atelier stores
// (phase 107-08, decision D-BK-18, mapping table 107-RESEARCH.md §3.2).
//
// The English JSON is NEVER a store format: stores stay German and are only extended additively. This file translates both
// ways for the readers that speak the spec's language (AI harness, the MCP tools of 106-04):
//   bauteilSchemaAus(el, ctx)  German element → English schema object (derived through steckbrief(), the ONE data sheet)
//   elementAusSchema(json)     English schema object → the German fields it carries (a patch; nothing is invented)
// Values the store does not hold (calculated_height, home_story_elevation, total_thickness, transformation_matrix) are DERIVED
// on the way out and ignored on the way in.
// Review 107-08 (D-BW-03, nothing is set silently): a round trip out and back in never turns a derived value into a set one.
// `pset_common` carries only values SET on the element, exactly the ones the IFC export writes (FireRating "ohne" = none = null);
// guide values derived from the build-up stand apart in `pset_common_derived` and are never read back. `ifc_classification.source`
// says whether the type is stated on the element ("set") or derived (wall thickness rule, box automatic, caller's default); a
// derived type is not taken back as `bauteil_typ`. A GUID is only taken over when the caller asks for it.
//
// In: element records (drawn wall, slab, column, Massing body seen as an element …) plus context. Out: plain objects. Pure,
// no I/O, node-testable.

import { steckbrief, typFuerWand, BAUTEIL_TYPEN } from "./steckbrief.js";
import { elevationOf, wandHoehe, oberkanteFolgtGeschoss, geschosseAus } from "./hoehen.js";

/** Spec words of the renovation status ↔ internal status (catalogue kataloge.js knows the same aliases). */
const STATUS_ZU_SPEC = Object.freeze({ bestand: "Existing", neubau: "New", abbruch: "Demolition", temporaer: "Temporary" });
const SPEC_ZU_STATUS = Object.freeze({ Existing: "bestand", New: "neubau", Demolition: "abbruch", Temporary: "temporaer" });

/**
 * @typedef {object} BauteilSchema  element in the language of the spec (part V)
 * @property {string} guid
 * @property {string|null} name
 * @property {{type: 'ComponentInstance'|'Element', definition_id: string|null, transformation_matrix: number[]|null}} container
 * @property {{schema: 'IFC4', entity: string, predefined_type: string, source: 'set'|'derived'}} ifc_classification
 *   source: "set" = the element states its type (bauteil_typ by hand), "derived" = rule, box automatic or the caller's default
 * @property {{IsExternal: boolean, LoadBearing: boolean, FireRating: string|null, AcousticRating: number|null, ThermalTransmittance: number|null}} pset_common
 *   only values set on the element (as in the IFC export); AcousticRating = R'w in dB, ThermalTransmittance = U in W/(m²·K)
 * @property {{AcousticRating: number|null, ThermalTransmittance: number|null}} pset_common_derived
 *   guide values derived from the build-up when none is set (R'w of the composite, U from λ and thickness); read-only, never stored
 * @property {'Existing'|'New'|'Demolition'|'Temporary'|null} renovation_status
 * @property {{home_story_id: number, home_story_elevation: number, bottom_offset_to_home: number, top_link_story_id: number|null,
 *   top_offset_to_link: number|null, calculated_height: number|null}} spatial_linking  heights and offsets in m
 * @property {{reference_line: {location: string, start_point: {x: number, z: number}|null, end_point: {x: number, z: number}|null}|null, push_pull_vector: number|null}} geometry
 * @property {{composite_name: string|null, total_thickness: number|null, skins: Array<{material: string|null, thickness: number, function: string, intersection_priority: number}>}|null} structure
 *   thicknesses in m (the store keeps skins of a build-up in mm; the schema speaks metres like every other length here)
 */

/**
 * German element → English schema of the spec (D-BK-18). Everything is read through steckbrief(), so the GUID, class, status and
 * the property values are exactly what the IFC export writes — which needs the GUID source `ctx.quelle` of the export (the list the
 * element lives in), so it is required.
 * @param {any} el element record (German fields)
 * @param {{typ?: string, projektId?: string|number|null, quelle?: string, storeyHeight?: number, geschosse?: any, matrix?: number[]|null}} [ctx]
 *   typ: type key when the element states none (default: walls by typFuerWand, else "decke" for a polygon, "stuetze" for a point);
 *   quelle (required): GUID source like the export ("customWalls", "customColumns", "customSlabs", "customRoofs", "customZones",
 *   "massing" …); storeyHeight m / geschosse: storey source; matrix: the instance matrix of a
 *   Massing body (instanzMatrix), passed through as the container transformation
 * @returns {BauteilSchema}
 * @throws {Error} without ctx.quelle (a GUID derived from another source would differ from the IFC GlobalId)
 */
export function bauteilSchemaAus(el, ctx = {}) {
  if (!ctx.quelle) throw new Error("bauteilSchemaAus: GUID-Quelle (ctx.quelle) fehlt — z. B. „customWalls“ wie im IFC-Export");
  const istWand = !!(el?.a && el?.b);
  const typKey = el?.bauteil_typ && BAUTEIL_TYPEN[el.bauteil_typ] ? el.bauteil_typ
    : ctx.typ && BAUTEIL_TYPEN[ctx.typ] ? ctx.typ
      : istWand ? typFuerWand(el).typ : Array.isArray(el?.points) ? "decke" : "stuetze";
  const gs = ctx.geschosse ?? geschosseAus({ geschosse: null, storeyHeight: ctx.storeyHeight ?? 3 });
  const s = steckbrief(el, typKey, { projektId: ctx.projektId ?? null, quelle: ctx.quelle, storeyHeight: ctx.storeyHeight, geschosse: gs });
  // stated = a type on the element that is not the box automatic's proposal (bauteil_typ_quelle "automatisch")
  const typGesetzt = typKey === el?.bauteil_typ && el?.bauteil_typ_quelle !== "automatisch";
  const gesetzt = (/** @type {{wert: any, quelle: string}} */ k) => (k.quelle === "gesetzt" ? k.wert : null);
  const level = Number.isInteger(el?.level) ? el.level : 0;
  const folgt = oberkanteFolgtGeschoss(el);
  const kw = s.kennwerte;
  return {
    guid: s.guid,
    name: typeof el?.name === "string" && el.name ? el.name : null,
    container: { type: el?.gruppe != null ? "ComponentInstance" : "Element", definition_id: el?.gruppe != null ? String(el.gruppe) : null, transformation_matrix: Array.isArray(ctx.matrix) ? ctx.matrix : null },
    ifc_classification: { schema: "IFC4", entity: s.ifc.klasse, predefined_type: s.ifc.typ, source: typGesetzt ? "set" : "derived" },
    pset_common: {
      IsExternal: !!BAUTEIL_TYPEN[s.typ]?.extern || !!el?.huelle,
      LoadBearing: !!s.tragend,
      FireRating: kw.feuerwiderstand.wert && kw.feuerwiderstand.wert !== "ohne" ? kw.feuerwiderstand.wert : null,
      AcousticRating: gesetzt(kw.schallschutz_rw_db),
      ThermalTransmittance: gesetzt(kw.u_wert),
    },
    pset_common_derived: {
      AcousticRating: kw.schallschutz_rw_db.quelle === "abgeleitet" ? kw.schallschutz_rw_db.wert : null,
      ThermalTransmittance: kw.u_wert.quelle === "abgeleitet" ? kw.u_wert.wert : null,
    },
    renovation_status: s.status ? /** @type {any} */ (STATUS_ZU_SPEC)[s.status] ?? null : null,
    spatial_linking: {
      home_story_id: level,
      home_story_elevation: elevationOf(level, gs),
      bottom_offset_to_home: Number(el?.unterkante_versatz_m) || 0,
      top_link_story_id: folgt ? level + (Number.isInteger(el?.oberkante_geschosse) ? el.oberkante_geschosse : 1) : null,
      top_offset_to_link: folgt ? Number(el?.oberkante_versatz_m) || 0 : null,
      calculated_height: istWand ? wandHoehe(el, gs) : Number(el?.height ?? el?.hoehe ?? el?.dicke_m) || null,
    },
    geometry: {
      reference_line: istWand ? { location: el.refLine || "center", start_point: { x: el.a.x, z: el.a.z }, end_point: { x: el.b.x, z: el.b.z } } : null,
      push_pull_vector: Number(el?.height ?? el?.hoehe) || null,
    },
    structure: s.aufbau ? {
      composite_name: el?.composite || null,
      total_thickness: s.aufbau.dicke_m,
      skins: s.aufbau.schichten.map((l) => ({ material: l.material, thickness: l.dicke_m, function: l.funktion, intersection_priority: l.prioritaet })),
    } : null,
  };
}

/**
 * English schema object → the German fields it carries (D-BK-18). Returns a PATCH: only fields the schema states; derived values
 * (calculated_height, home_story_elevation, total_thickness, the matrix, skins of a named composite, pset_common_derived) are not
 * taken over, and a class that matches a type of BAUTEIL_TYPEN becomes `bauteil_typ` — unless `ifc_classification.source` says
 * "derived" (then nothing: the type stays as open as it was) — any other class `ifc_klasse`/`ifc_typ`.
 * @param {Partial<BauteilSchema>|null|undefined} json
 * @param {{guidUebernehmen?: boolean}} [opt] guidUebernehmen: also take `guid` (default false — pinning a GUID is the export's job,
 *   and a GUID from another source would change the element's GlobalId)
 * @returns {Record<string, any>} German element fields (a, b in m in the model plane x/z; heights in m)
 */
export function elementAusSchema(json, { guidUebernehmen = false } = {}) {
  /** @type {Record<string, any>} */
  const el = {};
  if (!json || typeof json !== "object") return el;
  if (guidUebernehmen && typeof json.guid === "string" && json.guid.length === 22) el.guid = json.guid;
  if (typeof json.name === "string" && json.name) el.name = json.name;
  if (json.container?.type === "ComponentInstance" && json.container.definition_id != null) el.gruppe = String(json.container.definition_id);
  const ic = json.ifc_classification;
  if (ic?.entity && /** @type {any} */ (ic).source !== "derived") {
    const passend = Object.entries(BAUTEIL_TYPEN).filter(([, t]) => t.ifc === ic.entity && (!ic.predefined_type || t.ifcTyp === ic.predefined_type));
    const ext = json.pset_common?.IsExternal, trag = json.pset_common?.LoadBearing;
    // several types share one class (three walls are IfcWall STANDARD/PARTITIONING): IsExternal and LoadBearing pick among them
    const genau = passend.find(([, t]) => !!t.extern === !!ext && !!t.tragend === !!trag) || (passend.length === 1 ? passend[0] : null);
    if (genau) el.bauteil_typ = genau[0];
    else { el.ifc_klasse = ic.entity; if (ic.predefined_type) el.ifc_typ = ic.predefined_type; }
  }
  const pc = json.pset_common;
  if (pc?.FireRating) el.feuerwiderstand = String(pc.FireRating);
  const rw = typeof pc?.AcousticRating === "string" ? Number(/(\d+(?:[.,]\d+)?)/.exec(pc.AcousticRating)?.[1]?.replace(",", ".")) : pc?.AcousticRating;
  if (Number(rw) > 0) el.schallschutz_rw_db = Number(rw);
  if (Number(pc?.ThermalTransmittance) > 0) el.u_wert = Number(pc?.ThermalTransmittance);
  if (json.renovation_status && /** @type {any} */ (SPEC_ZU_STATUS)[json.renovation_status]) el.status = /** @type {any} */ (SPEC_ZU_STATUS)[json.renovation_status];
  const sl = json.spatial_linking;
  if (sl && Number.isInteger(sl.home_story_id)) el.level = sl.home_story_id;
  if (sl && Number(sl.bottom_offset_to_home)) el.unterkante_versatz_m = Number(sl.bottom_offset_to_home);
  if (sl && Number.isInteger(sl.top_link_story_id)) {
    el.oberkante_bezug = "geschoss";
    el.oberkante_geschosse = /** @type {number} */ (sl.top_link_story_id) - (Number.isInteger(sl.home_story_id) ? /** @type {number} */ (sl.home_story_id) : 0);
    el.oberkante_versatz_m = Number(sl.top_offset_to_link) || 0;
  }
  const rl = json.geometry?.reference_line;
  if (rl?.start_point && rl?.end_point) {
    el.a = { x: Number(rl.start_point.x), z: Number(rl.start_point.z) };
    el.b = { x: Number(rl.end_point.x), z: Number(rl.end_point.z) };
    if (rl.location && rl.location !== "center") el.refLine = rl.location;
  }
  if (Number(json.geometry?.push_pull_vector) > 0) el.height = Number(json.geometry?.push_pull_vector);
  if (json.structure?.composite_name) el.composite = json.structure.composite_name;
  return el;
}
