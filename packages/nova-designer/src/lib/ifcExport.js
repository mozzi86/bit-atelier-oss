// Minimaler, abhängigkeitsfreier IFC4-Export (STEP) aus dem BIT-BIM-Modell.
// Erzeugt Projekt-/Site-/Building-/Storey-Struktur + Wände/Decken/Stützen/Räume
// und Fenster/Türen mit extrudierter Box-Geometrie. Koordinaten: IFC X=Modell-x,
// IFC Y=Modell-z (Plan), IFC Z=Höhe.
// 107-02: every height and elevation (storey index × storey height, slab thickness and side, roof slope, wall top link)
// comes from @core/lib/bauteil/hoehen.js — this file has no own storey-index multiplication any more (guard test hoehen-10702).
// An element on a storey the model does not have is reported through onWarn instead of silently landing on the ground floor.
// 107-01: Wände liegen mit Bezug zur Referenzlinie (refLine: center/outside/inside, Hülle: huelle_bezug) an
// derselben Stelle wie im 3D und im Plan — der Versatz kommt aus @core/lib/bauteil/referenz.js; ohne refLine
// bleibt die Datei byte-identisch (Golden tests/unit/ifc-golden-107.ifc).
// 107-03: with `steckbrief.schichtdetails` the layer sets carry IfcMaterialLayer.Category (from the layer function) and .Priority
// (0-999 of the build-up table, written /10 rounded because IFC4 limits Priority to 0-100), every wall with a real build-up gets an
// IfcMaterialLayerSetUsage instead of the direct layer-set association, and materials carry Pset_MaterialCommon.MassDensity and
// Pset_MaterialThermal.ThermalConductivity. Without the option (and for walls without a build-up) the text is byte-identical to
// before (goldens tests/unit/fixtures/ifc-golden-107*.ifc); the new output has its own golden ifc-golden-107-aufbau.ifc.
// 107-04: openings read their sizes, host and height anchor from @core/lib/bauteil/oeffnungen.js (one reader for 3D, plan, room module and
// this file); a filling-less opening (kind "oeffnung") is an IfcOpeningElement + IfcRelVoidsElement without IfcRelFillsElement; with
// the option `durchbrueche` the penetrations of the openings planning are written (requested/approved: IfcBuildingElementProxy
// PROVISIONFORVOID, executed: IfcOpeningElement in the host wall); a drawn slab may carry `oeffnungen: [{points}]` (holes, IfcOpeningElement
// + IfcRelVoidsElement at the slab). Without these fields/options the text is byte-identical to before (golden tests).
// 107-09 (D-BK-08b): with the option `verschneidung` (the cleaned layer bands of @core/lib/bauteil/verschneidung.js modellBaender, computed
// by the caller) every hull or drawn wall WITH a build-up is still ONE IfcWall, but its body is one IfcExtrudedAreaSolid per outline of a
// cleaned band (IfcArbitraryClosedProfileDef, usually one per layer, two where a layer is cut through; in the wall's placement frame) in one 'SweptSolid' representation — extruded bodies
// plus IfcRelVoidsElement as before, never the CSG solid. A wall without a build-up keeps rectSolid. What only the solid can do (the slab
// shortened by the wall cores) is not in the IFC: a slab with a build-up gets an onWarn of kind WARNART_VERSCHNEIDUNG. Without the option
// the text is byte-identical (goldens); the new output has its own golden ifc-golden-107-verschneidung.ifc.
// Öffnungen werden als echte Voids exportiert (IfcOpeningElement +
// IfcRelVoidsElement je Fenster/Tür, IfcRelFillsElement zum Bauteil), damit die
// Wandmengen um die Öffnungen reduziert sind (Mengengrundlage/AVA-Kopplung).
// Öffnungen, die nicht in ihre Wand passen, werden NICHT exportiert, sondern über
// den optionalen onWarn-Callback gemeldet (keine stillen Falschmengen).
// STEP-Syntax: E() erwartet die Attributliste OHNE äußere Klammern; nur echte
// Listen-Attribute (IfcCartesianPoint.Coordinates, IfcDirection.DirectionRatios,
// IfcPolyline.Points, IfcUnitAssignment.Units …) klammern selbst. Strings gehen
// durch S() (Apostroph-Verdopplung + ISO-10303-21-Kodierung von Umlauten).
import { GEWERKE_TGA, netzHardened } from "@designer/lib/tgaNetz";
import { layerHardened as statikHardened, traegerVordim } from "@designer/lib/tragwerkPlan";
import { steckbrief, typFuerWand, typFuerNetz, bauteilGuid, TYP_ABGELEITET_TEXT } from "@core/lib/bauteil/steckbrief.js";
import { geometrie as massingGeometrie, profilGueltig, oeffnungenPruefen as massingOeffnungenPruefen, koerperElement as massingElement, profilNormieren, instanzMassstab } from "@core/lib/massing/massingModell.js";
import { attributeVon, mitAttributen, werkstattMitAttributen } from "@core/lib/bauteil/attribute.js";
import { wandGeometrie, wandDicke_m, kernVon } from "@core/lib/bauteil/referenz.js";
import { materialById } from "@core/lib/bauteil/materialien.js";
import { oeffnungsMasse, oeffnungPasst, oeffnungMitte_m, wirtVon, ankerFuerWand, istOeffnungOhneFuellung, durchbruchImWirt, durchbruchTiefe, schlitzImKoerper, DURCHBRUCH_TIEFE_OHNE_WIRT_M } from "@core/lib/bauteil/oeffnungen.js";
import { durchbruchSteckbriefe } from "@core/lib/bauteil/durchbruchSteckbrief.js";
import { istBodenplatte, huellPlattenId, huellwandDaten, untersterLevel, globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js";
import { elevationOf, unterkante, wandHoehe, stuetzenHoehe, raumHoehe, geschosshoehe, deckenLage, dachNeigung_grad, geschosseAus, FLACHDACH_BIS_GRAD, DECKEN_STANDARD } from "@core/lib/bauteil/hoehen.js";
import { dachBerechnen, dachVonDachelement, globalerDachAnstieg_m } from "@core/lib/bauteil/dachGeometrie.js";
import { dachImRahmen, wandProfilUnterDach } from "@core/lib/bauteil/seoAnalytik.js";
import { grenzWaende, nettoFlaeche_m2, raeumeMitNetto, polyAreaXZ } from "@core/lib/bauteil/raeume.js";

// Phase 41 (NETZ-05): Achshöhe der TGA-Leitungen über OK Rohdecke des Geschosses (m).
// [ASSUMED] Konzeptwert — Installationsebene liegt real je Gewerk anders (Boden/Decke).
export const NETZ_ACHSHOEHE_M = 0.5;
// IFC4-Segmentklasse je Gewerk (IfcFlowSegment selbst ist Obertyp ohne PredefinedType).
const NETZ_IFC_KLASSE = {
  heizung: ["IFCPIPESEGMENT", ".RIGIDSEGMENT."],
  trinkwasser: ["IFCPIPESEGMENT", ".RIGIDSEGMENT."],
  abwasser: ["IFCPIPESEGMENT", ".GUTTER."],
  lueftung: ["IFCDUCTSEGMENT", ".RIGIDSEGMENT."],
  elektro: ["IFCCABLESEGMENT", ".CABLESEGMENT."],
};

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function guid(n) { let s = "", x = n; for (let i = 0; i < 22; i++) { s = B64[x & 63] + s; x = Math.floor(x / 64); } return s; }
const f = (v) => (Number.isFinite(v) ? v : 0).toFixed(4);
// STEP-String: Apostroph verdoppeln und Nicht-ASCII nach ISO-10303-21 kodieren
// (\X2\<UTF-16-Hex>\X0\). Rohe Umlaute machen die Datei für strenge IFC-Leser
// unlesbar — und ein unlesbarer Export ist keine Mengengrundlage.
const S = (v) => {
  const t = String(v ?? "").replace(/'/g, "''");
  let out = "", buf = "";
  const flush = () => { if (buf) { out += `\\X2\\${buf}\\X0\\`; buf = ""; } };
  for (const ch of t) {
    if (ch.codePointAt(0) < 128) { flush(); out += ch; }
    else for (let i = 0; i < ch.length; i++) buf += ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  flush();
  return `'${out}'`;
};

/**
 * Kind of an onWarn message about an element on a storey the model does not have (second argument of onWarn, third carries
 * `{level, ziel}`). The studio tells the kinds apart by this value and builds its own (translated) text, not by the wording.
 */
export const WARNART_GESCHOSS = "geschoss";

/**
 * Kind of an onWarn message about a penetration of the openings planning (107-04): it was written as a provision (proxy) instead of a void,
 * or not at all. The studio shows these apart from the missing-opening list (third argument of onWarn carries `{nr}`).
 */
export const WARNART_DURCHBRUCH = "durchbruch";

/**
 * Kind of an onWarn message about a Massing body whose profile is invalid (107-05: self-intersection, double point, no area,
 * inner ring not free); the body is not written. Third argument of onWarn carries `{id, name, grund, text}` (grund and German text
 * of profilGueltig). 107-06: the same kind with `oeffnung` (index) = one opening of the body no longer fits (oeffnungenPruefen) and
 * is left out, the body itself is written.
 */
export const WARNART_MASSING = "massing";

/**
 * Kind of an onWarn message of the roof library (107-10): a roof form the library does not compute (curved or unknown — only plane faces
 * exist) stays a flat plate or is left out. Third argument of onWarn carries `{nr, form}` (drawn roof), `{nr: null, form, global: true}` (global
 * roof form) or `{id, name, form}` (Massing body) — the studio builds its own translated text from these (review 107-10), the German `msg` is the fallback.
 */
export const WARNART_DACH = "dach";

/**
 * Kind of an onWarn message of the solid relations (107-10, D-BK-08b): what only the solid shows is not in the IFC — a wall cut by a
 * roof whose top is inclined ACROSS its thickness (written up to its lowest height), a wall under more than one roof, an intersected
 * wall under a roof, the terrain subtraction of the basement. Third argument of onWarn carries `{schluessel, grund: "verschnitten"|"mehrere"|"quer"}`
 * or `{art: "gelaende"}` — the studio builds its translated text from these (review 107-10).
 */
export const WARNART_SEO = "seo";

/**
 * Kind of an onWarn message of the intersection (107-09): a slab with a build-up is shortened by the wall cores only in 3D and in the
 * quantities; the IFC keeps its extruded body (D-BK-08b). Third argument of onWarn carries `{nr}` (the slab's _idx); review 107-09:
 * `{nr, waende}` = the slab shortens walls of a lower priority (only in 3D and the quantities), `{schluessel, leer: true}` = a wall whose
 * cleaned bands keep no area is written as its whole rectangle (an empty item list would be invalid STEP).
 */
export const WARNART_VERSCHNEIDUNG = "verschneidung";

/**
 * 107-08: IFC4 classes a typed Massing body may be written as — the subtypes of IfcBuildingElement whose attribute list is exactly
 * GlobalId … Representation, Tag, PredefinedType (nine attributes, like the proxy). Any other class stays a proxy.
 */
const TYPEN_9 = new Set(["IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcRoof", "IfcCovering", "IfcFooting", "IfcRailing", "IfcStair", "IfcBuildingElementProxy"]);

/**
 * IFC4-STEP-Export des Gebäudemodells plus gezeichneter Elemente.
 * @param {object} model createBuildingModel-Ergebnis
 * @param {{ customWalls?: Array<object>, customColumns?: Array<object>, customWindows?: Array<object>,
 *   envOpenings?: Array<object>, autoOpenings?: Array<object>, customZones?: Array<object>,
 *   customSlabs?: Array<object>, customRoofs?: Array<object>, storeyHeight?: number, geschosse?: Array<{level: number, name?: string, hoehe_m: number}>|null, projectName?: string,
 *   timestamp?: number, onWarn?: ((msg: string, art?: string, daten?: Record<string, any>) => void)|null, netz?: object|null, werkstatt?: any, dachGlobal?: {form: string, neigung_grad?: number}|null, seo?: {waende: Map<string, any[]>}|null,
 *   steckbrief?: {projektId?: string|number|null, schichtdetails?: boolean}|null, tragwerk?: object|null, bauteilAttribute?: object|null, massing?: object|null, durchbrueche?: Array<object>|null, instanzTypen?: boolean,
 *   verschneidung?: {jeSchluessel: Map<string, Array<{umrisse: Array<Array<{x: number, z: number}>>}>>, decken?: Map<number, {kerne: boolean, waende: string[]}>|null}|null, raumGrenzen?: boolean }} [opts]
 *   netz (Phase 41): TGA-Netz (`netz_layer`) — je Kante ein IfcPipe-/Duct-/CableSegment mit
 *   Polylinien-Achse; ohne Netz ist die Datei byte-identisch zu vorher.
 *   werkstatt (89-03): `werkstattBauteile(...)` of @core — interior walls as IfcWall, doors as
 *   IfcDoor with a real void in their wall, rooms as IfcSpace, each with its STABLE GUID and the
 *   property set Pset_BIT_Bauteil (Status, KG, Gewerk, Material, Bauabschnitt …) plus
 *   Pset_WallCommon; envelope pieces (`huelle`) are skipped (model.walls/autoOpenings carry them).
 *   Without it the file is byte-identical to before.
 *   steckbrief (97-02a): `{ projektId }` — every element (hull, drawn, workshop, columns, beams,
 *   network segments AND nodes) gets its data sheet: stable GUID, IFC class + PredefinedType of the
 *   type registry, Pset_BIT_Bauteil (type, status, KG, STLB-LB, build-up, quantity, section,
 *   origin of each value), IfcRelAssociatesMaterial (layer set / material) and
 *   IfcRelAssociatesClassification (DIN 276:2018). Without it the file is byte-identical to before.
 *   steckbrief.schichtdetails (107-03, needs steckbrief): layer Category/Priority, IfcMaterialLayerSetUsage per wall with a build-up (offset
 *   see below), material density and conductivity; absent/false = byte-identical to before.
 *   tragwerk (97-02a, needs steckbrief): `statik_layer` — beams as IfcBeam.
 *   massing (98-05): `massing_layer` of the Massing Studio — each body an IfcBuildingElementProxy (stable
 *   GUID, extruded profile, Pset_BIT_Bauteil), each group number an IfcElementAssembly aggregating its
 *   instances; placed via `massing.bezug` (site → model). Without bodies the file is unchanged. 107-05: the profile comes
 *   normalised (outer ring positive in the profile plane); a body with inner rings (`loecher`) gets an
 *   IfcArbitraryProfileDefWithVoids; a body with an invalid profile (profilGueltig) is left out and reported (WARNART_MASSING).
 *   107-06: each entry of `oeffnungen` (wall-like body, pushed through) → IfcOpeningElement + IfcRelVoidsElement at the proxy.
 *   durchbrueche (107-04): Durchbruch records of the openings planning (x, y, z = middle in model coordinates in m, b/h or d in m, bauteil_guid,
 *   status). Status requested/checked/approved → IfcBuildingElementProxy PROVISIONFORVOID (box or cylinder through the host); executed → an
 *   IfcOpeningElement in the host wall (found by wirtVon) without filling; rejected ones are left out; one without a usable host stays a
 *   proxy and is reported (WARNART_DURCHBRUCH). A slot (`t` smaller than the wall thickness) is a void of depth t from the nearest wall face,
 *   not a hole through the wall. The host is named by the GUID the openings planning derived from the project: it is found only together with
 *   the option `steckbrief` (its projectId makes the wall GUIDs equal); without it every penetration stays a proxy ("kein Wirt gefunden").
 *   The data sheet of a penetration is written in either case (own status and GUID). Without the option the file is byte-identical to before.
 *   107-08: a body with `bauteil_typ` is written as the class of that type (IfcWall, IfcSlab, IfcColumn …) with its data sheet
 *   (Pset_BIT_Bauteil incl. Bauteiltyp_Herkunft "abgeleitet (Annahme)" for an automatic type, Pset_*Common); a stored `guid` wins.
 *   instanzTypen (107-08, D-BK-17): untyped group instances as IfcMappedItem of one IfcBuildingElementProxyType per group number
 *   (IfcRepresentationMap of the definition, mirror and scale per instance); without it the file is byte-identical.
 *   bauteilAttribute (97-02): `bauteil_attribute_layer` — decisions on workshop and hull elements
 *   (status, KG, trade, section) by stable id; without it nothing changes.
 *   verschneidung (107-09): `{jeSchluessel: Map<wall key, Band[]>}` of modellBaender() — walls with a build-up get one body item per
 *   cleaned band piece (see file head); absent = byte-identical. `decken` (review 107-09, solidAbleitung.deckenKuerzungen): which drawn
 *   slabs are really cut (by slab _idx) — only those get the onWarn note; without it every slab with a build-up is named (as before).
 *   107-10 (roof library, D-BK-08b — extruded bodies only, nothing from the CSG solid): a drawn roof with the optional field `form`
 *   ("sattel" | "walm" | "pult") is written as ONE extruded plate (its thickness, default 0.2 m) per plane roof face in an inclined
 *   IfcAxis2Placement3D (faces of @core/lib/bauteil/dachGeometrie.js); a roof without `form` keeps the flat plate (byte-identical);
 *   an unknown (curved) form keeps the flat plate and is reported (WARNART_DACH). dachGlobal `{form, neigung_grad}`: the global roof
 *   form of the BIM studio over the footprint as an IfcRoof of inclined plates on the top storey; absent or "flach" = nothing written.
 *   A Massing body with `dach` gets an IfcRoof of inclined plates on its top (flat: nothing, the body top is the roof).
 *   seo (107-10): `{waende: Map<wall key, DachErgebnis[]>}` — the active relations "wall under roof" (bauteil/seo.js): such a wall is
 *   written as its ANALYTIC profile in the wall plane (IfcArbitraryClosedProfileDef extruded over the thickness, seoAnalytik.js), never
 *   from the solid; openings stay IfcOpeningElement + IfcRelVoidsElement. A top inclined across the thickness, several roofs and an
 *   intersected wall are reported (WARNART_SEO). Absent = byte-identical. With basements and a Massing terrain grid the export reports
 *   that the terrain subtraction is not in the file (the basement walls and slabs of 107-13 are).
 *   raumGrenzen (107-11, D-BK-13): IfcRelSpaceBoundary between every space and the walls that bound it (raeume.js grenzWaende) plus
 *   Qto_SpaceBaseQuantities (GrossFloorArea, NetFloorArea in m²) per space; absent/false = byte-identical.
 * @returns {string} STEP-Text
 */
export function exportIFC(model, { customWalls = [], customColumns = [], customWindows = [], envOpenings = [], autoOpenings = [], customZones = [], customSlabs = [], customRoofs = [], storeyHeight = 3, geschosse = null, projectName = "BIT-Atelier", timestamp = 0, onWarn = null, netz = null, werkstatt = null, steckbrief: sbOpt = null, tragwerk = null, bauteilAttribute = null, massing = null, durchbrueche = null, instanzTypen = false, verschneidung = null, dachGlobal = null, seo = null, raumGrenzen = false } = {}) {
  // 97-02: workshop walls/doors carry the attribute table's decisions (status, KG, trade …).
  if (werkstatt && bauteilAttribute) werkstatt = werkstattMitAttributen(werkstatt, bauteilAttribute);
  // 107-02: storey source — the programme's storey table when it has one, else one height for all storeys (the old behaviour).
  const gs = geschosseAus({ geschosse, storeyHeight });
  const rows = []; let nid = 0; let gid = 1;
  // Warnings are declared first because the storey lookup below uses them (const → no use before the declaration).
  const warn = (/** @type {string} */ msg, /** @type {string} */ art = undefined, /** @type {Record<string, any>} */ daten = undefined) => { if (typeof onWarn === "function") onWarn(msg, art, daten); };
  // args = Attributliste OHNE äußere Klammern (Listen-Attribute klammern selbst).
  const E = (type, args) => { const id = ++nid; rows.push(`#${id}=${type}(${args});`); return `#${id}`; };
  const G = () => `'${guid(gid++)}'`;

  // Basis-Geometriekontext (Coordinates/DirectionRatios sind Listen -> geklammert)
  const p0 = E("IFCCARTESIANPOINT", "(0.,0.,0.)");
  const dirZ = E("IFCDIRECTION", "(0.,0.,1.)");
  const dirX = E("IFCDIRECTION", "(1.,0.,0.)");
  const axWorld = E("IFCAXIS2PLACEMENT3D", `${p0},${dirZ},${dirX}`);
  const ctx = E("IFCGEOMETRICREPRESENTATIONCONTEXT", `$,'Model',3,1.E-5,${axWorld},$`);
  const uL = E("IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE.");
  const uA = E("IFCSIUNIT", "*,.AREAUNIT.,$,.SQUARE_METRE.");
  const uV = E("IFCSIUNIT", "*,.VOLUMEUNIT.,$,.CUBIC_METRE.");
  const uP = E("IFCSIUNIT", "*,.PLANEANGLEUNIT.,$,.RADIAN.");
  const units = E("IFCUNITASSIGNMENT", `(${uL},${uA},${uV},${uP})`);
  const project = E("IFCPROJECT", `${G()},$,${S(projectName)},$,$,$,$,(${ctx}),${units}`);

  // Platzierung an (x,y,z) mit RefDirection in der XY-Ebene (Winkel ang).
  // parent = übergeordnete IfcLocalPlacement-Referenz (dann sind x/y/z lokale
  // Koordinaten in deren Achsensystem), sonst absolut.
  const placement = (x, y, z, ang = 0, parent = null) => {
    const loc = E("IFCCARTESIANPOINT", `(${f(x)},${f(y)},${f(z)})`);
    const rd = E("IFCDIRECTION", `(${f(Math.cos(ang))},${f(Math.sin(ang))},0.)`);
    const a2p = E("IFCAXIS2PLACEMENT3D", `${loc},${dirZ},${rd}`);
    return E("IFCLOCALPLACEMENT", `${parent || "$"},${a2p}`);
  };
  // Extrudierter Rechteck-Körper (XDim×YDim, zentriert) Höhe h.
  const rectSolid = (xd, yd, h) => {
    const pc = E("IFCCARTESIANPOINT", "(0.,0.)");
    const pos2 = E("IFCAXIS2PLACEMENT2D", `${pc},$`);
    const prof = E("IFCRECTANGLEPROFILEDEF", `.AREA.,$,${pos2},${f(xd)},${f(yd)}`);
    const pos3 = E("IFCAXIS2PLACEMENT3D", `${p0},${dirZ},${dirX}`);
    return E("IFCEXTRUDEDAREASOLID", `${prof},${pos3},${dirZ},${f(h)}`);
  };
  // Extrudierter Polygon-Körper (Footprint in x,z) Höhe h.
  // 107-05: optional inner rings (`loecher`, same x/z frame) → IfcArbitraryProfileDefWithVoids (IFC4: ProfileType, ProfileName,
  // OuterCurve, InnerCurves); without them the entity sequence is exactly the old one (golden byte-identical).
  const polySolid = (poly, h, loecher = null) => {
    const kurve = (/** @type {Array<{x: number, z: number}>} */ ring) => {
      const pts = ring.map((p) => E("IFCCARTESIANPOINT", `(${f(p.x)},${f(p.z)})`));
      return E("IFCPOLYLINE", `(${[...pts, pts[0]].join(",")})`);
    };
    const line = kurve(poly);
    const prof = Array.isArray(loecher) && loecher.length
      ? E("IFCARBITRARYPROFILEDEFWITHVOIDS", `.AREA.,$,${line},(${loecher.map(kurve).join(",")})`)
      : E("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${line}`);
    const pos3 = E("IFCAXIS2PLACEMENT3D", `${p0},${dirZ},${dirX}`);
    return E("IFCEXTRUDEDAREASOLID", `${prof},${pos3},${dirZ},${f(h)}`);
  };
  // 107-10: one plate of a plane roof face — the face polygon (model metres from the roof library: x, y up, z) as the profile in its
  // own plane, extruded by `dicke` (m) along the upward face normal. IFC frame = (x, z, y) like polySolid. The local x axis runs along
  // the first edge of the face (an eave or ridge line), so the profile coordinates stay readable. Exact for plane faces (D-BK-08b).
  const geneigtePlatte = (/** @type {Array<{x: number, y: number, z: number}>} */ ecken, /** @type {number} */ dicke) => {
    const q = ecken.map((p) => ({ x: p.x, y: p.z, z: p.y }));
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < q.length; i += 1) {
      const a = q[i], b = q[(i + 1) % q.length];
      nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
    }
    const nl = Math.hypot(nx, ny, nz) || 1, sg = nz < 0 ? -1 : 1;
    const n = { x: (sg * nx) / nl, y: (sg * ny) / nl, z: (sg * nz) / nl };
    const o = q[0];
    let ex = { x: q[1].x - o.x, y: q[1].y - o.y, z: q[1].z - o.z };
    const d = ex.x * n.x + ex.y * n.y + ex.z * n.z;
    ex = { x: ex.x - d * n.x, y: ex.y - d * n.y, z: ex.z - d * n.z };
    const el = Math.hypot(ex.x, ex.y, ex.z) || 1;
    ex = { x: ex.x / el, y: ex.y / el, z: ex.z / el };
    const ey = { x: n.y * ex.z - n.z * ex.y, y: n.z * ex.x - n.x * ex.z, z: n.x * ex.y - n.y * ex.x };
    const pts = q.map((p) => {
      const v = { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z };
      return E("IFCCARTESIANPOINT", `(${f(v.x * ex.x + v.y * ex.y + v.z * ex.z)},${f(v.x * ey.x + v.y * ey.y + v.z * ey.z)})`);
    });
    const prof = E("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${E("IFCPOLYLINE", `(${[...pts, pts[0]].join(",")})`)}`);
    const pos3 = E("IFCAXIS2PLACEMENT3D", `${E("IFCCARTESIANPOINT", `(${f(o.x)},${f(o.y)},${f(o.z)})`)},${E("IFCDIRECTION", `(${f(n.x)},${f(n.y)},${f(n.z)})`)},${E("IFCDIRECTION", `(${f(ex.x)},${f(ex.y)},${f(ex.z)})`)}`);
    return E("IFCEXTRUDEDAREASOLID", `${prof},${pos3},${dirZ},${f(dicke)}`);
  };
  /** 107-10: plates of every plane roof face (gables are wall parts, never roof plates) joined as items of one body. */
  const dachPlatten = (/** @type {import("@core/lib/bauteil/dachGeometrie.js").DachErgebnis} */ dd, /** @type {number} */ dicke) =>
    dd.flaechen.filter((fl) => fl.art === "dachflaeche" || fl.art === "walm").map((fl) => geneigtePlatte(fl.punkte3d, dicke)).join(",");
  /** IFC PredefinedType of a pitched roof form (IfcRoofTypeEnum). */
  const DACHTYP = /** @type {Record<string, string>} */ ({ sattel: "GABLE_ROOF", walm: "HIP_ROOF", pult: "SHED_ROOF" });
  const shape = (solid) => {
    // 107-09: `solid` may be several items joined by "," (one extruded body per cleaned layer band)
    const sr = E("IFCSHAPEREPRESENTATION", `${ctx},'Body','SweptSolid',(${solid})`);
    return E("IFCPRODUCTDEFINITIONSHAPE", `$,$,(${sr})`);
  };

  // ---- Spatial structure ----
  const site = E("IFCSITE", `${G()},$,${S("Gelände")},$,$,${placement(0, 0, 0)},$,$,.ELEMENT.,$,$,$,$,$`);
  const building = E("IFCBUILDING", `${G()},$,${S("Gebäude")},$,$,${placement(0, 0, 0)},$,$,.ELEMENT.,$,$,$`);
  const storeyRefs = (model.storeys || []).map((s) =>
    ({ s, ref: E("IFCBUILDINGSTOREY", `${G()},$,${S(s.name)},$,$,${placement(0, 0, s.elevation)},$,$,.ELEMENT.,${f(s.elevation)}`) }));
  E("IFCRELAGGREGATES", `${G()},$,$,$,${project},(${site})`);
  E("IFCRELAGGREGATES", `${G()},$,$,$,${site},(${building})`);
  // 107-13 review: listed by elevation (basements are appended to model.storeys, viewers that show the aggregation order would
  // list them above the roof); without basements the list is already ascending, the output is unchanged. storeyRefs keeps the
  // model order, so storeyRefs[0] stays the ground floor (fallback below).
  if (storeyRefs.length) E("IFCRELAGGREGATES", `${G()},$,$,$,${building},(${[...storeyRefs].sort((a, b) => a.s.elevation - b.s.elevation).map((x) => x.ref).join(",")})`);
  // 107-02: an unknown level used to fall back to the ground floor without a word. It still lands there (a file without
  // the element would be worse), but once per level the user is told. Missing level (undefined/null) = ground floor, no warning.
  const unbekannteLevel = new Set();
  const storeyOf = (lvl) => {
    const treffer = storeyRefs.find((x) => x.s.level === lvl);
    if (!treffer && storeyRefs.length && lvl != null && !unbekannteLevel.has(lvl)) {
      unbekannteLevel.add(lvl);
      warn(`Element auf Geschoss ${lvl}: das Modell hat dieses Geschoss nicht — im ${storeyRefs[0].s.name} abgelegt.`, WARNART_GESCHOSS, { level: lvl, ziel: storeyRefs[0].s.name });
    }
    return (treffer || storeyRefs[0])?.ref;
  };
  const contained = {}; // storeyRef -> [elementRefs]
  const contain = (lvl, ref) => { const st = storeyOf(lvl) || storeyRefs[0]?.ref; if (!st) return; (contained[st] = contained[st] || []).push(ref); };

  // 89-03: property sets (IfcPropertySingleValue: text → IfcLabel, boolean → IfcBoolean, number →
  // IfcReal; null → "ohne Status"/"—" as text, D-BW-03 no default) attached via IfcRelDefinesByProperties.
  // 107-08: a value may also be {ifc, wert} = a typed IFC measure (e.g. IFCTHERMALTRANSMITTANCEMEASURE for a U-value)
  const pset = (ref, name, props) => {
    const werte = props.map(([k, v]) => {
      const nominal = v && typeof v === "object" && typeof v.ifc === "string" ? `${v.ifc}(${f(v.wert)})` : typeof v === "boolean" ? `IFCBOOLEAN(${v ? ".T." : ".F."})` : typeof v === "number" && Number.isFinite(v) ? `IFCREAL(${f(v)})` : `IFCLABEL(${S(v ?? "—")})`;
      return E("IFCPROPERTYSINGLEVALUE", `${S(k)},$,${nominal},$`);
    });
    const ps = E("IFCPROPERTYSET", `${G()},$,${S(name)},$,(${werte.join(",")})`);
    E("IFCRELDEFINESBYPROPERTIES", `${G()},$,$,$,(${ref}),${ps}`);
  };
  const bauteilProps = (b) => [
    ["Status", b.status ?? "ohne Status"], ["KG", b.kg ?? "—"], ["Gewerk", b.gewerk ?? "—"], ["Material", b.material ?? "—"],
    ["Bauabschnitt", b.bauabschnitt ?? "—"], ["GUID_Quelle", "Wohnungs-Werkstatt (stabil über Re-Tesselierung)"],
  ];
  // ---- 97-02a: element data sheet (only with opts.steckbrief) ----
  const projektId = sbOpt?.projektId ?? null;
  // 107-03: layer details (Category, Priority, LayerSetUsage, material psets) only on request, so every older export stays byte-identical
  const schichtDetail = !!sbOpt?.schichtdetails;
  /** @type {Map<string, string[]>} KG → element refs (one classification relation per KG) */
  const nachKg = new Map();
  /** @type {Array<{ref: string, s: any, wand?: any}>} elements with material */
  const mitMaterial = [];
  const sb = (el, typ, quelle, extra = {}) => steckbrief(el, typ, { projektId, quelle, storeyHeight, geschosse: gs, ...extra });
  const herkunft = (s) => Object.entries(s.quelle).map(([k, v]) => `${k}:${v}`).join(", ");
  // 97-08: IFC4 PEnum_ElementStatus in the standard Pset_<Element>Common (NEW/EXISTING/DEMOLISH/
  // TEMPORARY; no status = NOTKNOWN, never NEW). Walls and beams add it to their own Common pset
  // below; Pset_BIT_Bauteil.Status stays as the fallback for IFC2x3 readers.
  const STATUS_ENUM = { neubau: "NEW", bestand: "EXISTING", abbruch: "DEMOLISH", temporaer: "TEMPORARY" };
  const statusEnum = (s) => STATUS_ENUM[s?.status] || "NOTKNOWN";
  const COMMON_PSET = { IfcSlab: "Pset_SlabCommon", IfcColumn: "Pset_ColumnCommon", IfcRoof: "Pset_RoofCommon", IfcWindow: "Pset_WindowCommon",
    IfcDoor: "Pset_DoorCommon", IfcStair: "Pset_StairCommon", IfcRailing: "Pset_RailingCommon", IfcCovering: "Pset_CoveringCommon",
    IfcFooting: "Pset_FootingCommon", IfcPile: "Pset_PileCommon", IfcBuildingElementProxy: "Pset_BuildingElementProxyCommon" };
  /** 106-03: IFC FireRating of an element with a fire resistance class ("ohne" = none = not written). */
  const feuerRating = (s) => (s?.feuerwiderstand && s.feuerwiderstand !== "ohne" ? [["FireRating", s.feuerwiderstand]] : []);
  /**
   * 107-08 (spec V pset_common): FireRating plus AcousticRating (IfcLabel "Rw <n> dB") and ThermalTransmittance (W/(m²·K)) in the
   * Pset_*Common of an element — written only when the value is SET on the element (kennwerte.quelle "gesetzt"). A value derived
   * from the build-up (R'w of the composite, U from λ) stays in the data sheet [ASSUMED: derived guide values are not published as
   * properties], so every export without the new fields is byte-identical.
   * @param {any} s data sheet
   * @returns {any[]}
   */
  const kennwertRows = (s) => [
    ...feuerRating(s),
    ...(s?.kennwerte?.schallschutz_rw_db?.quelle === "gesetzt" ? [["AcousticRating", `Rw ${s.kennwerte.schallschutz_rw_db.wert} dB`]] : []),
    ...(s?.kennwerte?.u_wert?.quelle === "gesetzt" ? [["ThermalTransmittance", { ifc: "IFCTHERMALTRANSMITTANCEMEASURE", wert: s.kennwerte.u_wert.wert }]] : []),
  ];
  /**
   * @param {string} ref  element ref
   * @param {any} s       data sheet
   * @param {any[]} [zusatz] extra Pset_BIT_Bauteil entries
   * @param {{aussen_m?: number}|null} [wand] set for a wall with a real build-up in schichtdetails mode: the element then gets an IfcMaterialLayerSetUsage
   */
  const datenblatt = (ref, s, zusatz = [], wand = null) => {
    pset(ref, "Pset_BIT_Bauteil", [
      ["Bauteiltyp", s.label], ["Status", s.status ?? "ohne Status"], ["KG", s.kg ?? "offen"],
      ["Gewerk_LB", s.gewerk ? `${s.gewerk.lb} ${s.gewerk.name}` : "offen"], ["Gewerk", s.gewerkGrob ?? "—"],
      ["Material", s.material ?? "offen"], ["Menge", s.menge.wert], ["Einheit", s.menge.einheit],
      ["Bauabschnitt", s.bauabschnitt ?? "offen"], ["Ablauf_Folge", s.gewerk ? s.gewerk.folge : "offen"],
      ["Tragend", !!s.tragend], ["Herkunft", herkunft(s)], ["Offen", s.offen.join(", ") || "—"],
      // 106-03: set through the change tools; only written when set, so older exports stay byte-identical
      ...(s.feuerwiderstand ? [["Feuerwiderstand", s.feuerwiderstand]] : []), ...(s.statik_vermerk ? [["Statik_Vermerk", s.statik_vermerk]] : []),
      // 107-08: set building-physics values (only when set, byte-identical otherwise)
      ...(s.kennwerte?.schallschutz_rw_db?.quelle === "gesetzt" ? [["Schallschutz_Rw_dB", s.kennwerte.schallschutz_rw_db.wert]] : []),
      ...(s.kennwerte?.u_wert?.quelle === "gesetzt" ? [["U_Wert", s.kennwerte.u_wert.wert]] : []),
      ...zusatz,
    ]);
    if (COMMON_PSET[s.ifc.klasse]) pset(ref, COMMON_PSET[s.ifc.klasse], [["Status", statusEnum(s)], ...(s.tragend ? [["LoadBearing", true]] : []), ...kennwertRows(s)]);
    if (s.kg) { const l = nachKg.get(s.kg) || []; l.push(ref); nachKg.set(s.kg, l); }
    if (s.aufbau?.schichten?.length || s.material) mitMaterial.push({ ref, s, wand });
  };
  const sguid = (s) => `'${s.guid}'`;

  // ---- Wände (Hülle + gezeichnet) ----
  // Registry: Schlüssel -> IFC-Referenz + Geometrie. Nötig, damit jede Öffnung
  // per IfcRelVoidsElement genau EINER Wand zugeordnet werden kann (KD-15).
  // Schlüssel: Hüllwand = `env:<level>:<edge>`, gezeichnete Wand = `cw:<_idx>`.
  const wallList = [];
  (model.walls || []).forEach((w) => wallList.push({ key: `env:${w.level}:${w.edge}`, a: w.a, b: w.b, th: w.thickness, h: w.height, elev: w.elevation, level: w.level, refLine: w.refLine, roh: mitAttributen(huellwandDaten(w), attributeVon(bauteilAttribute, "hull-wall")), quelle: "huelle" }));
  customWalls.forEach((w) => wallList.push({ key: `cw:${w._idx}`, a: w.a, b: w.b, th: wandDicke_m(w), h: wandHoehe(w, gs), elev: unterkante(w, gs), level: w.level || 0, refLine: w.refLine, roh: w, quelle: "customWalls" }));
  // 89-03: workshop interior walls (stable GUID, name, property sets) — envelope pieces skipped.
  const wtWaende = (werkstatt?.waende || []).filter((w) => !w.huelle);
  wtWaende.forEach((w) => wallList.push({ key: `wt:${w.guid}`, a: w.a, b: w.b, th: w.dicke_m, h: w.hoehe_m || geschosshoehe(w.level || 0, gs), elev: elevationOf(w.level || 0, gs), level: w.level || 0, guid: w.guid, name: w.klasse === "tragend" ? "Trennwand" : "Innenwand", bauteil: w }));
  const wallByKey = new Map();
  wallList.forEach((w) => {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.05) return;
    // 107-01: the body centre lies at the middle of a→b shifted by n · offset of the reference line — the
    // same derivation as 3D and plan (bauteil/referenz.js). Without refLine ("center") the offset is 0 and the
    // text is identical to before (golden tests/unit/ifc-golden-107.ifc). Openings hang on this placement.
    // 107-03: a core value needs the build-up of the wall (kernVon); without a record (workshop wall) there is none
    const { koerperMitte, versatz_m: versatzM } = wandGeometrie({ a: w.a, b: w.b, refLine: w.refLine }, { dicke_m: w.th, kern: w.roh ? kernVon(w.roh) : null });
    const ang = Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
    // 107-09: the cleaned bands of a wall with a build-up, in the wall's placement frame (local X = a→b, local Y = normal n = (−dz, dx))
    const vb = verschneidung?.jeSchluessel?.get(w.key);
    const dxW = Math.cos(ang), dzW = Math.sin(ang);
    const lokal = (/** @type {{x: number, z: number}} */ p) => ({ x: (p.x - koerperMitte.x) * dxW + (p.z - koerperMitte.z) * dzW, z: -(p.x - koerperMitte.x) * dzW + (p.z - koerperMitte.z) * dxW });
    // review 107-09: bands that keep no area at all (a stub fully inside higher-ranked layers) would give an empty item list — invalid STEP
    const items = vb && vb.length ? vb.flatMap((b) => b.umrisse.map((t) => polySolid(t.map(lokal), w.h))).join(",") : "";
    if (vb && vb.length && !items) warn(`Wand ${w.key}: nach der Verschneidung ohne Fläche, im IFC als ganzer Wandkörper geschrieben.`, WARNART_VERSCHNEIDUNG, { schluessel: w.key, leer: true });
    // 107-10: a wall under a roof (active relation) — its analytic profile in the wall plane, extruded over the thickness (D-BK-08b)
    const seoDaecher = seo?.waende?.get(w.key) || null;
    let seoSolid = "";
    if (seoDaecher && seoDaecher.length && items) warn(`Wand ${w.key}: verschnitten und gegen ein Dach abgeschrägt — die Abschrägung steht nur im 3D und in den Mengen.`, WARNART_SEO, { schluessel: w.key, grund: "verschnitten" });
    else if (seoDaecher && seoDaecher.length > 1) warn(`Wand ${w.key}: gegen mehrere Dächer abgeschrägt — im IFC als ganzer Wandkörper, die Abschrägung steht nur im 3D.`, WARNART_SEO, { schluessel: w.key, grund: "mehrere" });
    else if (seoDaecher && seoDaecher.length === 1) {
      const dxs = (w.b.x - w.a.x) / len, dzs = (w.b.z - w.a.z) / len;
      // the frame of the wall body (bauteil/seo.js wandUnterDach): origin at the body start, x along a→b, y from the wall bottom
      const rahmen = { ursprung: { x: w.a.x - dzs * versatzM, y: w.elev, z: w.a.z + dxs * versatzM }, drehung_y: -Math.atan2(dzs, dxs) };
      const prof = wandProfilUnterDach({ laenge_m: len, hoehe_m: w.h, dicke_m: w.th }, dachImRahmen(seoDaecher[0], rahmen));
      if (prof.quer_geneigt) warn(`Wand ${w.key}: der geneigte Abschluss quer zur Dicke steht nur im 3D und in den Mengen — im IFC bis zur niedrigsten Höhe.`, WARNART_SEO, { schluessel: w.key, grund: "quer" });
      if (prof.punkte.length >= 3 && prof.flaeche_m2 > 1e-9) {
        const pts = prof.punkte.map((p) => E("IFCCARTESIANPOINT", `(${f(p.x - len / 2)},${f(p.y)})`));
        const profDef = E("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${E("IFCPOLYLINE", `(${[...pts, pts[0]].join(",")})`)}`);
        // Axis = −Y of the wall placement, RefDirection = X: profile x along the wall, profile y = up; extruded from +th/2 over th
        const pos3 = E("IFCAXIS2PLACEMENT3D", `${E("IFCCARTESIANPOINT", `(0.,${f(w.th / 2)},0.)`)},${E("IFCDIRECTION", "(0.,-1.,0.)")},${dirX}`);
        seoSolid = E("IFCEXTRUDEDAREASOLID", `${profDef},${pos3},${dirZ},${f(w.th)}`);
      }
    }
    const solid = items || seoSolid || rectSolid(len, w.th, w.h);
    const pl = placement(koerperMitte.x, koerperMitte.z, w.elev, ang);
    // 97-02a: hull and drawn walls carry their data sheet (workshop walls keep their own psets below).
    const wTyp = sbOpt && w.roh ? typFuerWand(w.roh) : null;
    const wSb = wTyp ? sb(w.roh, wTyp.typ, w.quelle, { typAbgeleitet: wTyp.abgeleitet }) : null;
    // the GUID text of the wall is kept in the registry: the data sheet of a penetration names its host by the GUID the file really holds (107-04 review)
    const wandGuid = wSb ? sguid(wSb) : w.guid ? `'${w.guid}'` : G();
    const wall = wSb
      ? E("IFCWALL", `${wandGuid},$,${S(wSb.label)},$,$,${pl},${shape(solid)},$,.${wSb.ifc.typ}.`)
      : E("IFCWALL", `${wandGuid},$,${w.name ? S(w.name) : "'Wand'"},$,$,${pl},${shape(solid)},$,.STANDARD.`);
    contain(w.level, wall);
    if (wSb) {
      // 107-03: a wall with a REAL build-up (table or workshop class, not just a thickness) gets a LayerSetUsage in schichtdetails mode, and
      // its data sheet says where the reference line lies and where the function/priority of the layers come from (they may be proposals)
      const echterAufbau = schichtDetail && (wSb.aufbau?.quelle === "composite" || wSb.aufbau?.quelle === "klasse");
      const detailPsets = schichtDetail && wSb.aufbau ? [
        ["Referenzlinie", w.refLine || "center"], ["Referenzlinie_Versatz", versatzM],
        ["Schichtfunktion_Herkunft", wSb.aufbau.funktionAbgeleitet ? "abgeleitet (Vorschlag)" : wSb.aufbau.funktionAnnahme ? "gesetzt (Annahme, bitte bestätigen)" : "gesetzt"],
        ["Schichtprioritaet_Herkunft", wSb.aufbau.prioritaetAbgeleitet ? "abgeleitet (Vorschlag)" : "gesetzt"],
      ] : [];
      datenblatt(wall, wSb, [["Dicke", w.th], ...detailPsets], echterAufbau ? {} : null);
      pset(wall, "Pset_WallCommon", [["IsExternal", wTyp.typ === "wand-aussen"], ["LoadBearing", !!wSb.tragend], ["Status", statusEnum(wSb)], ...kennwertRows(wSb)]);
    }
    // Geometrie für die Öffnungs-Platzierung merken (lokales System der Wand:
    // X entlang a→b ab Wandmitte, Y quer, Z nach oben).
    w.ref = wall; w.pl = pl; w.len = len; w.ang = ang; w.versatz = versatzM; w.guidWert = wandGuid.slice(1, -1);
    w.dx = (w.b.x - w.a.x) / len; w.dz = (w.b.z - w.a.z) / len;
    if (!wallByKey.has(w.key)) wallByKey.set(w.key, w);
  });

  // ---- Stützen ----
  customColumns.forEach((c) => {
    const s = c.size || 0.4; const solid = rectSolid(s, s, stuetzenHoehe(c, gs));
    const cSb = sbOpt ? sb(c, "stuetze", "customColumns") : null;
    const col = E("IFCCOLUMN", `${cSb ? sguid(cSb) : G()},$,${S("Stütze")},$,$,${placement(c.x, c.z, unterkante(c, gs))},${shape(solid)},$,.COLUMN.`);
    contain(c.level || 0, col);
    if (cSb) datenblatt(col, cSb, [["Querschnitt", s]]);
  });

  // ---- Decken (Slabs) ----
  (model.slabs || []).forEach((s) => {
    // 107-02: thickness and side from the slab (dicke_m/bezug), default 0.25 m standing on its plane = the old literals
    const lage = deckenLage(s, gs, "huelle");
    const solid = polySolid(s.polygon, lage.dicke_m);
    // 97-02a: the lowest hull slab is the base slab (level < 0 or elevation 0 on level 0).
    // 107-13: through bauteil/ebenen.js — with basements the lowest slab by elevation; without them the old rule (same file).
    // The GUID key is the slab's own id (base slab "-1", basement ceilings "ug-1" …), else its level as before; without the id
    // the base slab and the ceiling of the first basement would hash to the same GlobalId.
    const hTyp = istBodenplatte(model, s) ? "bodenplatte" : "decke";
    const hSb = sbOpt ? sb(mitAttributen({ ...s, id: huellPlattenId(s), points: s.polygon }, attributeVon(bauteilAttribute, hTyp === "bodenplatte" ? "hull-floor" : "hull-slab")), hTyp, "huelle-decke") : null;
    const slab = hSb
      ? E("IFCSLAB", `${sguid(hSb)},$,${S(hSb.label)},$,$,${placement(0, 0, lage.unterkante_m)},${shape(solid)},$,.${hSb.ifc.typ}.`)
      : E("IFCSLAB", `${G()},$,'Decke',$,$,${placement(0, 0, lage.unterkante_m)},${shape(solid)},$,.FLOOR.`);
    // 107-13: the base slab lies in the lowest storey (EG without basements, as before), a basement ceiling in its basement
    contain(Math.max(untersterLevel(model), s.level), slab);
    // 108-02: the collar-beam floor above the attic storey (outline clipped to the roof in the model) says so in its data sheet
    if (hSb) datenblatt(slab, hSb, [["Dicke", lage.dicke_m], ...(s.kehlbalkenlage ? [["Kehlbalkenlage", true]] : [])]);
  });

  // ---- Gezeichnete Decken + Dächer ----
  (customSlabs || []).forEach((s, si) => {
    if (!s.points || s.points.length < 3) return;
    // 107-02: default 0.22 m, upper edge on the storey ceiling (bezug "oben") = the old literals; D-BK-03: not unified with the hull slab
    const lage = deckenLage(s, gs, "decke");
    const solid = polySolid(s.points, lage.dicke_m);
    // 107-09: the shortening by the wall cores exists only in the solid (D-BK-08b) — said, not hidden. Review 107-09: with `decken` from the
    // caller (solidAbleitung.deckenKuerzungen) only a slab that is really cut, or that cuts walls of a lower priority, is named
    if (verschneidung && s.composite) {
      const nr = s._idx ?? si + 1;
      const k = verschneidung.decken ? verschneidung.decken.get(nr) : { kerne: true, waende: [] };
      if (k?.kerne) warn(`Decke ${nr}: Kürzung an den Wandkernen nur im 3D und in den Mengen, im IFC ungekürzt (extrudierter Körper).`, WARNART_VERSCHNEIDUNG, { nr });
      if (k?.waende?.length) warn(`Decke ${nr}: kürzt Wände niedrigerer Priorität nur im 3D und in den Mengen, im IFC ungekürzt (extrudierte Körper).`, WARNART_VERSCHNEIDUNG, { nr, waende: k.waende });
    }
    const dSb = sbOpt ? sb(s, "decke", "customSlabs") : null;
    /** @type {string} */
    let slabPl = "";
    const slab = E("IFCSLAB", `${dSb ? sguid(dSb) : G()},$,'Decke',$,$,${(slabPl = placement(0, 0, lage.unterkante_m))},${shape(solid)},$,.FLOOR.`);
    contain(s.level || 0, slab);
    if (dSb) datenblatt(slab, dSb, [["Dicke", lage.dicke_m]]);
    // 107-04: holes of the slab (`oeffnungen: [{points}]`, plan polygon in m): an IfcOpeningElement through the full thickness (+2 cm each side) and
    // IfcRelVoidsElement to the slab, no filling, no CSG. Placed relative to the slab placement (plan coordinates are absolute there).
    (Array.isArray(s.oeffnungen) ? s.oeffnungen : []).forEach((loch, i) => {
      if (!Array.isArray(loch?.points) || loch.points.length < 3) return;
      // stable GUID: slab `_idx` (else its list position) + the id of the hole (else its list position; the old key, so old files keep their GUID) — two slabs never share one (107-04 review)
      const hSb = sbOpt ? sb({ id: `${s._idx ?? `s${si}`}:${loch.id != null ? `id${loch.id}` : i}` }, "oeffnung", "deckenoeffnung") : null;
      const op = E("IFCOPENINGELEMENT", `${hSb ? sguid(hSb) : G()},$,${S("Deckenöffnung")},$,$,${placement(0, 0, -0.02, 0, slabPl)},${shape(polySolid(loch.points, lage.dicke_m + 0.04))},$,.OPENING.`);
      E("IFCRELVOIDSELEMENT", `${G()},$,$,$,${slab},${op}`);
      if (hSb) datenblatt(op, hSb, []);
    });
  });
  (customRoofs || []).forEach((rf) => {
    if (!rf.points || rf.points.length < 3) return;
    // vereinfacht als flache Dachplatte (IfcRoof) auf Trauf-Höhe (107-02: Dicke/Bezug aus dicke_m/bezug, default 0.2 m auf der Traufe)
    const lage = deckenLage(rf, gs, "dach");
    // 107-10: a roof with the optional `form` gets one inclined plate per plane face (roof library, faces relative to the eaves);
    // without `form` the flat plate exactly as before (golden byte-identical). An unknown (curved) form stays the flat plate, reported.
    const formDach = rf.form ? dachVonDachelement(rf) : null;
    const dd = formDach && formDach.dach.form !== "flach" && formDach.anstieg_m > 0.005 ? dachBerechnen(rf.points, formDach.dach, { traufhoehe_m: 0, anstieg_m: formDach.anstieg_m }) : null;
    if (dd && !dd.ok) warn(`Dach ${rf._idx ?? ""}: Dachform „${rf.form}“ wird nicht berechnet (nur ebene Dachflächen) — im IFC als flache Platte.`, WARNART_DACH, { nr: rf._idx ?? null, form: String(rf.form) });
    const solid = dd && dd.ok ? dachPlatten(dd, lage.dicke_m) : polySolid(rf.points, lage.dicke_m);
    // 97-02a: up to 10° [ASSUMED] is a flat roof (FLAT_ROOF, LB 021), steeper a pitched one.
    // 107-02 / D-BK-25: EVERY roof is classified by its real slope in degrees, derived like the 3D view and the inspector
    // (dachNeigung_grad). A roof that only has the old `pitch` (metres of ridge rise) is no exception: the IFC must not lie.
    const neigung = dachNeigung_grad(rf);
    const rSb = sbOpt ? sb(rf, neigung <= FLACHDACH_BIS_GRAD ? "dach-flach" : "dach-geneigt", "customRoofs") : null;
    const roof = rSb
      ? E("IFCROOF", `${sguid(rSb)},$,${S(rSb.label)},$,$,${placement(0, 0, lage.unterkante_m)},${shape(solid)},$,.${rSb.ifc.typ}.`)
      : E("IFCROOF", `${G()},$,'Dach',$,$,${placement(0, 0, lage.unterkante_m)},${shape(solid)},$,.${dd && dd.ok ? DACHTYP[dd.form] : "GABLE_ROOF"}.`);
    contain(rf.level || 0, roof);
    if (rSb) datenblatt(roof, rSb, [["Neigung", neigung], ...(rf.form ? [["Dachform", String(rf.form)]] : [])]);
  });

  // 107-10: the global roof form of the BIM studio (select "Dachform" over the footprint) — until 107-10 it was drawn in 3D only and
  // missing from the file. Written only with the option `dachGlobal` and a pitched form (goldens without it byte-identical).
  if (dachGlobal && dachGlobal.form && dachGlobal.form !== "flach" && Array.isArray(model.footprint) && model.footprint.length >= 3) {
    const anstieg = globalerDachAnstieg_m(model.footprint, dachGlobal.form, Number(dachGlobal.neigung_grad));
    const dd = dachBerechnen(model.footprint, { form: dachGlobal.form }, { traufhoehe_m: 0, anstieg_m: anstieg });
    if (!dd.ok) warn(`Dachform „${dachGlobal.form}“ wird nicht berechnet (nur ebene Dachflächen) — nicht exportiert.`, WARNART_DACH, { nr: null, form: String(dachGlobal.form), global: true });
    else {
      const oben = Math.max(0, ...(model.storeys || []).map((st) => st.level).filter((l) => Number.isFinite(l) && l >= 0));
      const traufe = globaleTraufhoehe_m(model, gs); // 108-01: the one eaves function (3D, section, IFC)
      const roof = E("IFCROOF", `'${bauteilGuid(projektId, "dach-global", { id: "global" })}',$,${S("Dach")},$,$,${placement(0, 0, traufe)},${shape(dachPlatten(dd, DECKEN_STANDARD.dach.dicke_m))},$,.${DACHTYP[dd.form]}.`);
      contain(oben, roof);
      pset(roof, "Pset_BIT_Bauteil", [["Bauteiltyp", "Dach (Gebäudeform)"], ["Dachform", dd.form], ["Neigung", dd.neigung_grad], ["Firsthoehe", dd.anstieg_m]]);
    }
  }

  // ---- Räume (Spaces) — Modell-Spaces + gezeichnete Zonen ----
  // 107-11: every space is remembered with its polygon for the optional room boundaries (option `raumGrenzen`, written at the end);
  // remembering writes nothing, so without the option the file stays byte-identical.
  /** @type {Array<{ref: string, punkte: Array<{x: number, z: number}>, level: number, netto: () => number}>} */
  const raumListe = [];
  // 107-11 review: the storey space lies on the footprint = the axis of the hull walls, so its NetFloorArea follows the measuring rule
  // "referenzlinie": minus the bodies of ALL walls of its storey (hull, drawn, workshop interior walls), the columns and the stair/lift
  // shafts of the drawn zones and workshop rooms (each area once) — the storey's net area, not its gross area.
  const alleWaendeNetto = () => [...(model.walls || []), ...customWalls,
    ...wtWaende.map((w) => ({ a: w.a, b: w.b, level: w.level || 0, thickness: w.dicke_m }))];
  const alleZonenNetto = () => [...(customZones || []), ...(werkstatt?.raeume || [])];
  (model.spaces || []).forEach((s) => {
    const solid = polySolid(s.polygon, geschosshoehe(s.level, gs) * 0.98);
    const sp = E("IFCSPACE", `${G()},$,${S(s.name)},$,$,${placement(0, 0, s.elevation)},${shape(solid)},$,.ELEMENT.,.INTERNAL.,$`);
    contain(s.level, sp);
    raumListe.push({ ref: sp, punkte: s.polygon, level: s.level || 0, netto: () => nettoFlaeche_m2({ points: s.polygon, level: s.level || 0, messregel: "referenzlinie" }, { stuetzen: customColumns, zonen: alleZonenNetto(), waende: alleWaendeNetto() }) });
  });
  (customZones || []).forEach((z) => {
    if (!z.points || z.points.length < 3) return;
    const solid = polySolid(z.points, raumHoehe(z, gs));
    const zSb = sbOpt ? sb(z, "raum", "customZones") : null;
    const sp = E("IFCSPACE", `${zSb ? sguid(zSb) : G()},$,${S(z.name || "Raum")},$,$,${placement(0, 0, unterkante(z, gs))},${shape(solid)},$,.ELEMENT.,.INTERNAL.,$`);
    contain(z.level || 0, sp);
    if (zSb) datenblatt(sp, zSb);
    raumListe.push({ ref: sp, punkte: z.points, level: z.level || 0, netto: () => nettoFlaeche_m2(z, { stuetzen: customColumns, zonen: customZones, waende: [...(model.walls || []), ...customWalls] }) });
  });

  // ---- Fenster/Türen mit ECHTEN Voids (KD-15) ----
  // Je Öffnung: IfcOpeningElement (Void über die volle Wanddicke) +
  // IfcRelVoidsElement zur Wand -> die Wandmenge ist um die Öffnung reduziert,
  // damit ist der Export Mengengrundlage. IfcRelFillsElement verbindet den Void
  // mit dem Bauteil (Fenster/Tür). Platzierung relativ zur Wand-Platzierung:
  // lokal X = u - len/2 (entlang der Wand), Y = 0 (mittig in der Dicke),
  // Z = Brüstungshöhe (sill).
  // 107-04: sizes of an opening from oeffnungsMasse() (own width/height/sill first, field by field, then the type table) — the same reader as
  // 3D, plan and room module; a sill stated against OKRD/OKFF is converted to the wall bottom (bruestung_bezug, default wand_uk = as stored).
  // The host of every opening is found by wirtVon() (drawn wall, hull wall, workshop wall, penetration) — no own resolver here any more.
  const wirtModell = { customWalls, huelle: model.walls || [], werkstatt, projektId: sbOpt?.projektId ?? null, geschosse: gs };
  const deckenFuerAnker = { huelle: model.slabs || [], gezeichnet: customSlabs };

  /** Cylinder through a wall (round penetration): axis along the local Y of the placement it hangs on (= across the wall), centred on it. */
  const zylSolid = (/** @type {number} */ r, /** @type {number} */ tiefe) => {
    const pc = E("IFCCARTESIANPOINT", "(0.,0.)");
    const pos2 = E("IFCAXIS2PLACEMENT2D", `${pc},$`);
    const prof = E("IFCCIRCLEPROFILEDEF", `.AREA.,$,${pos2},${f(r)}`);
    const org = E("IFCCARTESIANPOINT", `(0.,${f(-tiefe / 2)},0.)`);
    const dirY = E("IFCDIRECTION", "(0.,1.,0.)");
    const pos3 = E("IFCAXIS2PLACEMENT3D", `${org},${dirY},${dirX}`);
    return E("IFCEXTRUDEDAREASOLID", `${prof},${pos3},${dirZ},${f(tiefe)}`);
  };

  /**
   * One opening in its wall: IfcOpeningElement + IfcRelVoidsElement, and — unless it has no filling (kind "oeffnung") — the window/door in it.
   * @param {string} wallKey key of the wall registry (wirtVon().schluessel)
   * @param {any} o opening record (u = middle along the wall in m, own sizes optional)
   * @param {string} label text for the warning
   * @param {{rund?: boolean, sheet?: any, zusatz?: any[], quer?: number|null, tiefe?: number|null}} [opt] rund: cylindrical void of diameter width; sheet: data sheet to use (a penetration
   *   brings its own, with its own GUID); zusatz: extra data-sheet rows; quer: offset of the void middle from the wall BODY middle in m (slot: the void is open to one wall face);
   *   tiefe: depth of the void across the wall in m (slot: slot depth + 2 cm overshoot on the open face); null = full wall thickness + 4 cm
   * @returns {string|undefined} the element that carries the data sheet (filling, or the void itself when there is none)
   */
  const addOpening = (wallKey, o, label, opt = {}) => {
    const w = wallByKey.get(wallKey);
    if (!w) { warn(`${label}: keine zugehörige Wand (${wallKey}) — nicht exportiert.`); return; }
    // anchor heights only when the opening states a bruestung_bezug other than the wall bottom (no slab lookup otherwise: byte-identical path)
    const anker = o.bruestung_bezug === "okrd" || o.bruestung_bezug === "okff"
      ? ankerFuerWand({ level: w.level, unterkante_m: w.elev }, gs, deckenFuerAnker, { x: w.a.x + w.dx * (o.u ?? w.len / 2), z: w.a.z + w.dz * (o.u ?? w.len / 2) }) : null;
    const d = oeffnungsMasse(o, anker);
    // Passt die Öffnung überhaupt in die Wand? Sonst NICHT exportieren (ein zu
    // großer Void würde die Wandmenge falsch reduzieren) — mit Meldung.
    const passt = oeffnungPasst(d, w.len, w.h);
    if (!passt.ok) { warn(`${label}: ${passt.text} — nicht exportiert.`); return; }
    // Position entlang der Wand in den gültigen Bereich legen (Öffnung bleibt
    // vollständig in der Wand; ohne Randabstand gäbe es Nullkanten-Booleans).
    const u = oeffnungMitte_m(o.u, d.w, w.len);
    const isDoor = o.kind === "door";
    const ohneFuellung = istOeffnungOhneFuellung(o);
    const quer = opt.quer ?? 0;
    // Void: volle Wanddicke + 2 cm Überstand je Seite (robuste Subtraktion). A round one is a cylinder around its centre height.
    const voidPl = placement(u - w.len / 2, quer, d.sill + (opt.rund ? d.h / 2 : 0), 0, w.pl);
    const voidTiefe = opt.tiefe ?? w.th + 0.04;
    const voidSolid = opt.rund ? zylSolid(d.w / 2, voidTiefe) : rectSolid(d.w, voidTiefe, d.h);
    // 97-02a: the data sheet of a filling-less opening is the "oeffnung" type (IfcOpeningElement OPENING)
    const oSb = opt.sheet ?? (sbOpt && !o.guid ? sb(o, ohneFuellung ? "oeffnung" : isDoor ? (wallKey.startsWith("env:") ? "tuer-aussen" : "tuer-innen") : "fenster", `oeffnung|${wallKey}|${o.kind}|${o._idx ?? o.u ?? 0}`) : null);
    const opName = ohneFuellung ? (o.name || "Öffnung") : isDoor ? "Türöffnung" : "Fensteröffnung";
    const op = E("IFCOPENINGELEMENT", `${ohneFuellung ? (oSb ? sguid(oSb) : o.guid ? `'${o.guid}'` : G()) : G()},$,${S(opName)},$,$,${voidPl},${shape(voidSolid)},$,.OPENING.`);
    E("IFCRELVOIDSELEMENT", `${G()},$,$,$,${w.ref},${op}`);
    // Rows every opening gets in its data sheet: size, sill above the wall bottom, and the anchor when it is not the wall bottom
    const masse = [[opt.rund ? "Durchmesser" : "Breite", d.w], ["Hoehe", d.h], ["Bruestung", d.sill], ...(opt.tiefe != null ? [["Tiefe", opt.tiefe - 0.02]] : []), ...(o.bruestung_bezug === "okrd" || o.bruestung_bezug === "okff" ? [["Bruestung_Bezug", o.bruestung_bezug.toUpperCase()]] : []), ...(opt.zusatz || [])];
    if (ohneFuellung) {
      if (oSb) datenblatt(op, oSb, masse);
      else pset(op, "Pset_BIT_Bauteil", [["Bauteiltyp", "Öffnung"], ...masse]);
      return op;
    }
    // Bauteil im Void (12 cm Ansichtsdicke), Platzierung relativ zum Void.
    const pl = placement(0, 0, 0, 0, voidPl);
    const ent = isDoor ? "IFCDOOR" : "IFCWINDOW";
    // IFC4-Attributreihenfolge: …,Tag,OverallHeight,OverallWidth,PredefinedType,
    // OperationType/PartitioningType,UserDefined… (die letzten drei offen).
    // 97-02a: a door in a hull wall is an exterior door, in a drawn/workshop wall [ASSUMED] interior.
    const ref = E(ent, `${oSb ? sguid(oSb) : o.guid ? `'${o.guid}'` : G()},$,${S(o.name || (isDoor ? "Tür" : "Fenster"))},$,$,${pl},${shape(rectSolid(d.w, 0.12, d.h))},$,${f(d.h)},${f(d.w)},$,$,$`);
    E("IFCRELFILLSELEMENT", `${G()},$,$,$,${op},${ref}`);
    contain(w.level, ref);
    if (oSb) datenblatt(ref, oSb, masse);
    return ref;
  };
  const artText = (/** @type {any} */ o) => (o.kind === "door" ? "Tür" : o.kind === "oeffnung" ? "Öffnung" : "Fenster");
  const schluesselVon = (/** @type {any} */ o, /** @type {string} */ weich) => wirtVon(o, wirtModell)?.schluessel ?? weich;
  customWindows.forEach((o) => addOpening(schluesselVon(o, `cw:${o.wallIdx}`), o, `${artText(o)} auf gezeichneter Wand ${o.wallIdx}`));
  envOpenings.forEach((o) => addOpening(schluesselVon(o, `env:${o.level}:${o.edge}`), o, `${artText(o)} auf Hüllwand ${o.level}/${o.edge}`));
  // Regel-Öffnungen der Hülle (Auto-Fenster + Eingangstür aus autoOpenings.js).
  // Sie sind in 3D, Grundriss und Maßketten sichtbar und müssen deshalb auch im
  // IFC stehen — sonst gehen Plan und Export auseinander (KD-16). Maße kommen
  // explizit mit (width/height/sill), nicht aus der Typ-Bibliothek.
  autoOpenings.forEach((o) => addOpening(`env:${o.level}:${o.edge}`, o, `${o.kind === "door" ? "Eingangstür" : "Auto-Fenster"} auf Hüllwand ${o.level}/${o.edge}`));

  // ---- 107-04: penetrations of the openings planning ----
  // Requested / checked / approved: IfcBuildingElementProxy PROVISIONFORVOID (a box b × depth × h, or a cylinder of diameter d, through the host or in
  // the open); executed: IfcOpeningElement in the host wall. x/y/z are the MIDDLE of the penetration in model coordinates (the overlap check of
  // durchbruchHinweise reads them that way too) [ASSUMED: the form does not say whether z is bottom or middle]. Depth: t (slot), else the host
  // thickness + 4 cm, else DURCHBRUCH_TIEFE_OHNE_WIRT_M [ASSUMED: no host, no depth stated]. Rejected ones are not written.
  // A slot (`t` smaller than the host thickness) is a recess from the wall face nearest to its point, `t` deep (schlitzImKoerper), not a through void.
  // The data sheet of a penetration is written even without the `steckbrief` option: it is a planning object with its own status and GUID from the openings planning.
  const geschossBei = (/** @type {number} */ z) => {
    let l = 0;
    for (const st of model.storeys || []) if (st.elevation <= z + 1e-6) l = st.level;
    return l;
  };
  (Array.isArray(durchbrueche) ? durchbrueche : []).forEach((d) => {
    if (!d || d.status === "abgelehnt") return;
    const nr = d.nr || d.id || "?";
    const rund = d.form === "rund";
    const b = Number(rund ? d.d : d.b), h = Number(rund ? d.d : d.h), x = Number(d.x), y = Number(d.y), z = Number(d.z);
    const melde = (/** @type {string} */ text) => warn(`Durchbruch ${nr}: ${text}`, WARNART_DURCHBRUCH, { nr });
    if (!(b > 0) || !(h > 0) || ![x, y, z].every(Number.isFinite) || d.x == null || d.y == null || d.z == null) { melde("Maße oder Lage fehlen — nicht exportiert."); return; }
    const sheet = durchbruchSteckbriefe(d, { projektId: sbOpt?.projektId ?? null }).durchbruch;
    const wirt = wirtVon(d, wirtModell);
    const imWirt = wirt ? durchbruchImWirt(d, wirt) : null;
    // the host GUID is the one the wall carries in THIS file (without `steckbrief` the walls get sequential GUIDs, not the derived ones)
    const wirtGuid = wirt ? wallByKey.get(wirt.schluessel)?.guidWert ?? wirt.guid : "—";
    const zusatz = [["Nr", nr], ["Art", d.art || "durchbruch"], ["Wirt_GUID", wirtGuid], ["Durchbruch_Status", d.status || "beantragt"], ["Feuerwiderstand_Bauteil", d.feuerwiderstand || "ohne"]];
    // executed and inside its host: a real void (the sill is measured from the wall bottom)
    if (d.status === "ausgefuehrt" && wirt && imWirt?.innen) {
      const tief = durchbruchTiefe(d, wirt);
      const schlitz = tief ? schlitzImKoerper(tief, imWirt.koerperQuer_m, wirt.wand.dicke_m) : null;
      const sill = z - h / 2 - wirt.wand.unterkante_m;
      const fit = oeffnungPasst({ w: b, h, sill }, wirt.wand.laenge_m, wirt.wand.hoehe_m);
      if (fit.ok) {
        const ref = addOpening(wirt.schluessel, { kind: "oeffnung", u: wirt.u ?? imWirt.u, width: b, height: h, sill, name: `Durchbruch ${nr}` }, `Durchbruch ${nr}`,
          { rund, sheet, zusatz, quer: schlitz?.quer_m ?? null, tiefe: schlitz?.tiefe_m ?? null });
        if (ref) return;
      } else melde(`${fit.text} — als Vormerkung (Proxy) statt als Öffnung exportiert.`);
    } else if (d.status === "ausgefuehrt") {
      melde(wirt ? `liegt nicht im Wirt (${imWirt?.grund}) — als Vormerkung (Proxy) statt als Öffnung exportiert.` : "kein Wirt gefunden (bauteil_guid) — als Vormerkung (Proxy) statt als Öffnung exportiert.");
    }
    // provision for void: free-standing proxy, oriented along the host wall when there is one
    const ang = wirt ? Math.atan2(wirt.wand.b.z - wirt.wand.a.z, wirt.wand.b.x - wirt.wand.a.x) : 0;
    const tiefe = Number(d.t) > 0 ? Number(d.t) : wirt ? wirt.wand.dicke_m + 0.04 : DURCHBRUCH_TIEFE_OHNE_WIRT_M;
    const solid = rund ? zylSolid(b / 2, tiefe) : rectSolid(b, tiefe, h);
    const pl = placement(x, y, rund ? z : z - h / 2, ang);
    // the proxy is ALWAYS a provision for void, also for an executed one that misses its host: the sheet of the requested state (same GUID)
    const vormerkung = durchbruchSteckbriefe({ ...d, status: "beantragt" }, { projektId: sbOpt?.projektId ?? null }).durchbruch;
    const proxy = E("IFCBUILDINGELEMENTPROXY", `${sguid(vormerkung)},$,${S(`Durchbruch ${nr}`)},$,${S("Durchbruch")},${pl},${shape(solid)},${S(nr)},.${vormerkung.ifc.typ}.`);
    contain(wirt ? wirt.wand.level : geschossBei(z), proxy);
    const masse = [[rund ? "Durchmesser" : "Breite", b], ["Hoehe", h], ...(Number(d.t) > 0 ? [["Tiefe", Number(d.t)]] : []), ...zusatz];
    datenblatt(proxy, vormerkung, masse);
    if (!wirt) melde("kein Wirt gefunden (bauteil_guid) — Vormerkung ohne Bauteilbezug exportiert.");
  });

  // ---- 89-03: Werkstatt-Bauteile (Psets, Türen mit Void in ihrer Wand, Räume) ----
  if (werkstatt) {
    wtWaende.forEach((w) => {
      const reg = wallByKey.get(`wt:${w.guid}`);
      if (!reg?.ref) return;
      // 97-02: with the data sheet the workshop wall gets the same Pset as every element (its GUID stays).
      if (sbOpt) {
        const wtSb = sb({ ...w, height: w.hoehe_m }, typFuerWand(w).typ, "werkstatt");
        // 107-03: the workshop class is a real build-up too (schichtdetails: LayerSetUsage like the drawn walls; workshop walls are "center")
        datenblatt(reg.ref, wtSb, [["Klasse", w.klasse], ["LichteLaenge", w.lichteLaenge_m], ["Rohbaulaenge", w.rohbauLaenge_m], ["Dicke", w.dicke_m]], schichtDetail && wtSb.aufbau?.quelle === "klasse" ? {} : null);
      }
      else pset(reg.ref, "Pset_BIT_Bauteil", [...bauteilProps(w), ["Klasse", w.klasse], ["LichteLaenge", w.lichteLaenge_m], ["Rohbaulaenge", w.rohbauLaenge_m], ["Dicke", w.dicke_m]]);
      pset(reg.ref, "Pset_WallCommon", [["IsExternal", false], ["LoadBearing", !!w.tragend], ...(sbOpt ? [["Status", statusEnum(w)]] : [])]);
    });
    // Door height: DIN 18100 Rohbaurichtmaß 2,01 m [ASSUMED, the workshop has no door height].
    const TUER_HOEHE_M = 2.01;
    (werkstatt.tueren || []).filter((t) => !t.huelle).forEach((t) => {
      // 107-04: the wall of a workshop door is found by wirtVon() (axis through the door middle within 1 cm), u is the projection of the middle
      const wirt = wirtVon({ kind: "door", a: t.a, b: t.b, level: t.level }, wirtModell);
      if (!wirt) { warn(`Werkstatt-Tür ${t.zone}: keine Innenwand an der Türstelle — nicht exportiert.`); return; }
      const ref = addOpening(wirt.schluessel, { kind: "door", width: t.breite_m, height: TUER_HOEHE_M, sill: 0, u: wirt.u, guid: t.guid, name: t.art === "wohnung" ? "Wohnungseingangstür" : "Innentür" }, `Werkstatt-Tür ${t.zone}`);
      if (ref && sbOpt) datenblatt(ref, sb(t, "tuer-innen", "werkstatt"), [["Art", t.art], ["Raum", t.zone], ["Nach", t.nach ?? "—"]]);
      else if (ref) pset(ref, "Pset_BIT_Bauteil", [...bauteilProps(t), ["Art", t.art], ["Raum", t.zone], ["Nach", t.nach ?? "—"]]);
    });
    // 107-11 review: the drawn columns are deducted here too (same rule as the drawn zones and the storey spaces)
    const wtNetto = raumGrenzen ? raeumeMitNetto(werkstatt.raeume || [], { stuetzen: customColumns }) : [];
    (werkstatt.raeume || []).forEach((r, ri) => {
      if (!Array.isArray(r.points) || r.points.length < 3) return;
      const sp = E("IFCSPACE", `'${r.guid}',$,${S(r.name.replace(/ ·WT$/, ""))},$,$,${placement(0, 0, elevationOf(r.level || 0, gs))},${shape(polySolid(r.points, geschosshoehe(r.level || 0, gs) * 0.98))},$,.ELEMENT.,.INTERNAL.,$`);
      contain(r.level || 0, sp);
      pset(sp, "Pset_BIT_Bauteil", [["Status", r.status ?? "ohne Status"], ["WE", r.we ?? "—"], ["Raumart", r.raumart ?? "—"], ["FlaecheLicht", r.flaeche_m2], ["GUID_Quelle", "Wohnungs-Werkstatt (stabil über Re-Tesselierung)"]]);
      raumListe.push({ ref: sp, punkte: r.points, level: r.level || 0, netto: () => wtNetto[ri]?.flaeche_netto_m2 ?? r.flaeche_m2 });
    });
  }

  // ---- TGA-Leitungen (Phase 41, NETZ-05) ----
  // Je Kante des Konzeptnetzes ein Segment-Element mit Achse als 3D-Polylinie
  // (Representation 'Axis'/'Curve3D') in Storey-Koordinaten, z = NETZ_ACHSHOEHE_M.
  // Kein Querschnittskörper: die Nennweite steht in Name/Tag (Konzeptstufe). Knoten
  // (IfcFlowTerminal/-Fitting) sind Folgeaufgabe. Ohne Netz entsteht keine Zeile.
  if (netz) {
    const n = netzHardened(netz);
    n.kanten.forEach((k) => {
      const [klasse, typ] = NETZ_IFC_KLASSE[k.gewerk] || ["IFCPIPESEGMENT", ".NOTDEFINED."];
      const g = GEWERKE_TGA[k.gewerk];
      const dnText = k.dn != null ? (k.gewerk === "elektro" ? `${k.dn} mm²` : `DN ${k.dn}`) : "DN offen";
      const pts = k.points.map((p) => E("IFCCARTESIANPOINT", `(${f(p.x)},${f(p.z)},${f(NETZ_ACHSHOEHE_M)})`));
      const poly = E("IFCPOLYLINE", `(${pts.join(",")})`);
      const sr = E("IFCSHAPEREPRESENTATION", `${ctx},'Axis','Curve3D',(${poly})`);
      const pds = E("IFCPRODUCTDEFINITIONSHAPE", `$,$,(${sr})`);
      // Attribute IFC4: GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement,
      // Representation, Tag, PredefinedType.
      // 97-02a: with the data sheet the class comes from the type registry (waste water is a pipe
      // RIGIDSEGMENT, not GUTTER = roof gutter) and the GUID is stable.
      const kSb = sbOpt ? sb(k, typFuerNetz(k), "netz-kante") : null;
      const seg = kSb
        ? E(kSb.ifc.klasse.toUpperCase(), `${sguid(kSb)},$,${S(`${g?.label || "Leitung"} ${dnText}`)},${S(g?.medium || "")},$,${placement(0, 0, elevationOf(k.level, gs))},${pds},${S(k.id)},.${kSb.ifc.typ}.`)
        : E(klasse, `${G()},$,${S(`${g?.label || "Leitung"} ${dnText}`)},${S(g?.medium || "")},$,${placement(0, 0, elevationOf(k.level, gs))},${pds},${S(k.id)},${typ}`);
      contain(k.level, seg);
      if (kSb) datenblatt(seg, kSb, [["System", g?.label || "—"], ["Medium", g?.medium || "—"], ["Nennweite", dnText]]);
    });
    // 97-02a: nodes (plant, distributors, terminals, connections) as their IFC4 distribution
    // elements, placed at their point without body (concept stage). All of them share the IFC4
    // attribute list GlobalId … Tag, PredefinedType (9 attributes).
    if (sbOpt) n.knoten.forEach((kn) => {
      const nSb = sb(kn, typFuerNetz(kn), "netz-knoten", { netzGewerk: kn.gewerk });
      const g = GEWERKE_TGA[kn.gewerk];
      const el = E(nSb.ifc.klasse.toUpperCase(), `${sguid(nSb)},$,${S(kn.name || nSb.label)},${S(g?.label || "")},$,${placement(kn.x, kn.z, elevationOf(kn.level || 0, gs) + NETZ_ACHSHOEHE_M)},$,${S(kn.id)},.${nSb.ifc.typ}.`);
      contain(kn.level || 0, el);
      datenblatt(el, nSb, [["System", g?.label || "—"], ["Knotenart", kn.art]]);
    });
  }

  // ---- 97-02a: beams of the structure layer (phase 40) ----
  // Box section width × depth; depth from the pre-dimensioning of tragwerkPlan (L-ratio, [ASSUMED]
  // there). Placed under the ceiling of its storey.
  if (sbOpt && tragwerk) {
    statikHardened(tragwerk).traeger.forEach((t) => {
      const len = Math.hypot(t.b.x - t.a.x, t.b.z - t.a.z);
      const h = traegerVordim({ L: len }).h_m || 0.4;
      const tSb = sb(t, "traeger", "statik-traeger");
      const z0 = elevationOf(t.level + 1, gs) - h;
      // 107-01: a beam may carry the optional reference line like a wall (section width = thickness); default center.
      // Interface without a writer: no screen of the app sets `refLine` on a beam and the plan/3D of beams ignore it, so
      // today the value moves the beam only in the IFC. Whoever adds a beam reference to the UI must draw plan and 3D
      // through wandGeometrie() as well (107-01 review: noted, not widened).
      const bm = wandGeometrie({ a: t.a, b: t.b, refLine: t.refLine }, { dicke_m: t.breite_m }).koerperMitte;
      const pl = placement(bm.x, bm.z, z0, Math.atan2(t.b.z - t.a.z, t.b.x - t.a.x));
      const beam = E("IFCBEAM", `${sguid(tSb)},$,${S(tSb.label)},$,$,${pl},${shape(rectSolid(len, t.breite_m, h))},$,.${tSb.ifc.typ}.`);
      contain(t.level, beam);
      datenblatt(beam, tSb, [["Breite", t.breite_m], ["Hoehe", h], ["Spannweite", len]]);
      pset(beam, "Pset_BeamCommon", [["LoadBearing", true], ["Span", len], ["Status", statusEnum(tSb)]]);
    });
  }

  // ---- 98-05: bodies of the Massing Studio (proxies) and their groups (assemblies) ----
  if (massing && Array.isArray(massing.koerper) && massing.koerper.length) {
    const bz = massing.bezug || { x: 0, y: 0 };
    const gruppenRefs = new Map();
    // 107-08 review: bodies taken over as BIM elements ("Als Bauteil übernehmen", quelle_koerper on the drawn elements). Their walls,
    // columns and slabs are written above as the real building elements; the body itself must not be a second IfcWall/IfcColumn/
    // IfcSlab with its cost group (quantities and KG sums would double) — it stays a proxy without a data sheet, marked as taken over.
    const uebernommen = new Set([...(customWalls || []), ...(customColumns || []), ...(customSlabs || [])].map((e) => e?.quelle_koerper).filter(Boolean));
    /**
     * 107-08: data sheet of a typed body — the body seen as an element (koerperElement: centre line, thickness, outline) with the type
     * it carries; the GUID source stays "massing" + body id, so typing a body never changes its GlobalId. Null (= proxy) for a type
     * whose IFC class does not share the nine attributes of IfcBuildingElement.
     * @param {any} k body
     * @returns {any|null}
     */
    const massingSteckbrief = (k) => {
      const s = steckbrief(massingElement(massing, k, bz), k.bauteil_typ, { projektId, quelle: "massing", storeyHeight, geschosse: gs });
      if (TYPEN_9.has(s.ifc.klasse)) return s;
      warn(`Massing-Körper ${k.name || k.id}: Bauteiltyp „${s.label}“ hat im IFC eine andere Attributliste — als Proxy exportiert.`, WARNART_MASSING, { id: k.id, name: k.name || k.id, grund: "typ", text: s.label });
      return null;
    };
    // 107-08 (D-BK-17, last and separable task): with the option `instanzTypen` every group number becomes ONE
    // IfcBuildingElementProxyType with an IfcRepresentationMap of its definition, and each untyped instance an IfcMappedItem with a
    // transformation operator (mirror as a reversed Axis1, scale per axis). Without the option nothing here runs (byte-identical).
    /** @type {Map<string, {typRef: string, map: string}>} */
    const typen = new Map();
    const mapTyp = instanzTypen ? (/** @type {any} */ k) => {
      const def = massing.gruppen?.[k.gruppe];
      if (!def || !Array.isArray(def.profil) || def.profil.length < 3) return null;
      if (!typen.has(k.gruppe)) {
        // the definition in its own frame, normalised like geometrie() does (outer ring positive, inner rings negative)
        const ring = profilNormieren(def.profil, "aussen").map((p) => ({ x: p.x, z: p.y }));
        const lo = Array.isArray(def.loecher) && def.loecher.length ? def.loecher.map((r) => profilNormieren(r, "innen").map((p) => ({ x: p.x, z: p.y }))) : null;
        const sr = E("IFCSHAPEREPRESENTATION", `${ctx},'Body','SweptSolid',(${polySolid(ring, def.hoehe, lo)})`);
        const map = E("IFCREPRESENTATIONMAP", `${E("IFCAXIS2PLACEMENT3D", `${p0},${dirZ},${dirX}`)},${sr}`);
        // IfcBuildingElementProxyType (IFC4): GlobalId, OwnerHistory, Name, Description, ApplicableOccurrence, HasPropertySets,
        // RepresentationMaps, Tag, ElementType, PredefinedType
        const typRef = E("IFCBUILDINGELEMENTPROXYTYPE", `'${bauteilGuid(projektId, "massing-typ", { id: k.gruppe })}',$,${S(`Gruppe ${k.gruppe}`)},$,$,$,(${map}),${S(String(k.gruppe))},${S("Massing-Gruppe")},.ELEMENT.`);
        typen.set(k.gruppe, { typRef, map });
      }
      const t = /** @type {{typRef: string, map: string}} */ (typen.get(k.gruppe));
      const m = instanzMassstab(k);
      // IfcCartesianTransformationOperator3DnonUniform: Axis1, Axis2, LocalOrigin, Scale, Axis3, Scale2, Scale3 — the mirror flips Axis1
      const op = E("IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM",
        `${E("IFCDIRECTION", k.spiegel ? "(-1.,0.,0.)" : "(1.,0.,0.)")},${E("IFCDIRECTION", "(0.,1.,0.)")},${p0},${f(m.x)},${dirZ},${f(m.y)},${f(m.z)}`);
      const item = E("IFCMAPPEDITEM", `${t.map},${op}`);
      const sr = E("IFCSHAPEREPRESENTATION", `${ctx},'Body','MappedRepresentation',(${item})`);
      const pl = placement((k.pos?.x || 0) - bz.x, (k.pos?.y || 0) - bz.y, k.basis || 0, ((k.drehung || 0) * Math.PI) / 180);
      return { pl, shape: E("IFCPRODUCTDEFINITIONSHAPE", `$,$,(${sr})`), typRef: t.typRef };
    } : null;
    for (const k of massing.koerper) {
      // geometrie() hands the rings over in the orientation convention of massingModell.js (profilNormieren, 107-05)
      const g = massingGeometrie(massing, k);
      if (!g.profil || g.profil.length < 3 || !(g.hoehe > 0)) continue;
      // 107-05: an invalid profile (self-intersection, double point, no area, inner ring not free) would be a broken solid in
      // the file — it is left out and reported, like an opening that does not fit its wall (warn, the export goes on)
      const pruefung = profilGueltig(g.profil, { loecher: g.loecher || null });
      if (!pruefung.ok) { warn(`Massing-Körper ${k.name || k.id}: ${pruefung.text} — nicht exportiert.`, WARNART_MASSING, { id: k.id, name: k.name || k.id, grund: pruefung.grund, text: pruefung.text }); continue; }
      const pts = g.profil.map((p) => ({ x: p.x - bz.x, z: p.y - bz.y }));
      const loecher = g.loecher ? g.loecher.map((r) => r.map((p) => ({ x: p.x - bz.x, z: p.y - bz.y }))) : null;
      // 107-08: a stored guid wins (lazily written, never copied); without one the derived GUID of the body id as before
      const guidK = bauteilGuid(sbOpt?.projektId ?? null, "massing", { id: k.id, guid: k.guid });
      // 107-08: a typed body (bauteil_typ, set by the box automatic or by hand) is written as the class of its type with the data sheet
      // of that type; an untyped body stays a proxy exactly as before (golden byte-identical). A type whose IFC class has another
      // attribute list than the nine of IfcBuildingElement (window, door, space …) stays a proxy and is reported.
      const typSb = k.bauteil_typ && !uebernommen.has(k.id) ? massingSteckbrief(k) : null;
      const gemappt = !typSb && mapTyp && k.gruppe != null ? mapTyp(k) : null;
      // the placement is created before the shape, exactly in the order the template literal used to evaluate (golden byte-identical)
      const proxyPl = gemappt ? gemappt.pl : placement(0, 0, g.basis || 0);
      const form = gemappt ? gemappt.shape : shape(polySolid(pts, g.hoehe, loecher));
      // IfcBuildingElementProxy (IFC4): GlobalId … Representation, Tag, PredefinedType. The classes of TYPEN_9 share that list.
      const ref = typSb
        ? E(typSb.ifc.klasse.toUpperCase(), `'${guidK}',$,${S(k.name || typSb.label)},$,${S(k.gruppe != null ? `Gruppe ${k.gruppe}` : "Massing")},${proxyPl},${form},${S(k.id)},.${typSb.ifc.typ}.`)
        : E("IFCBUILDINGELEMENTPROXY", `'${guidK}',$,${S(k.name || "Baukörper")},$,${S(k.gruppe != null ? `Gruppe ${k.gruppe}` : "Massing")},${proxyPl},${form},${S(k.id)},.ELEMENT.`);
      const massingZeilen = [["Hoehe", g.hoehe], ["Basis", g.basis || 0], ["Gruppe", k.gruppe ?? "—"], ["GUID_Quelle", "Massing-Studio (stabil je Körper-ID)"]];
      if (typSb) {
        datenblatt(ref, typSb, [...massingZeilen, ["Bauteiltyp_Herkunft", k.bauteil_typ_quelle === "automatisch" ? TYP_ABGELEITET_TEXT : "gesetzt"]]);
        if (typSb.ifc.klasse === "IfcWall") pset(ref, "Pset_WallCommon", [["IsExternal", typSb.typ === "wand-aussen"], ["LoadBearing", !!typSb.tragend], ["Status", statusEnum(typSb)], ...kennwertRows(typSb)]);
      } else {
        // review 107-08: the status of an untyped body (set in the inspector) and the takeover mark — each only when present, so a
        // body without them is written byte-identically
        pset(ref, "Pset_BIT_Bauteil", [["Bauteiltyp", "Massing-Körper"], ...massingZeilen, ...(k.status ? [["Status", k.status]] : []),
          ...(uebernommen.has(k.id) ? [["Uebernommen_als_Bauteil", true]] : [])]);
        if (k.status) pset(ref, "Pset_BuildingElementProxyCommon", [["Status", statusEnum({ status: k.status })]]);
        if (gemappt) E("IFCRELDEFINESBYTYPE", `${G()},$,$,$,(${ref}),${gemappt.typRef}`);
      }
      // 107-06: openings pushed through a wall-like body (massing_layer v3) — the void pattern of the wall openings: a box through the
      // whole body depth + 2 cm on each face, placed relative to the proxy, IfcRelVoidsElement to it. Bodies without `oeffnungen`
      // write nothing here (golden byte-identical). An opening that no longer fits is left out and reported like a wall opening.
      if (g.oeffnungen) {
        for (const pr of massingOeffnungenPruefen(massing, k)) {
          if (!pr.ok) { warn(`Öffnung ${pr.index + 1} in Massing-Körper ${k.name || k.id}: ${pr.text} — nicht exportiert.`, WARNART_MASSING, { id: k.id, name: k.name || k.id, grund: pr.grund, text: pr.text, oeffnung: pr.index }); continue; }
          const ex = (pr.b.x - pr.a.x) / pr.laenge, ey = (pr.b.y - pr.a.y) / pr.laenge;
          const tiefe = pr.durchgang.tiefe;
          // middle of the void: on the entry edge at `mitte`, half the depth inwards (inward normal = (−ey, ex) in the plan frame)
          const cx = pr.a.x + ex * pr.mitte - ey * (tiefe / 2) - bz.x, cy = pr.a.y + ey * pr.mitte + ex * (tiefe / 2) - bz.y;
          // 107-08: a mapped instance is placed at its own position and rotation — its voids hang on a plain base placement like before
          const voidPl = placement(cx, cy, pr.masse.sill, Math.atan2(ey, ex), gemappt ? placement(0, 0, g.basis || 0) : proxyPl);
          const oGuid = bauteilGuid(sbOpt?.projektId ?? null, "massing-oeffnung", { id: `${k.id}|${pr.index}` });
          const op = E("IFCOPENINGELEMENT", `'${oGuid}',$,${S("Öffnung")},$,$,${voidPl},${shape(rectSolid(pr.masse.w, tiefe + 0.04, pr.masse.h))},$,.OPENING.`);
          E("IFCRELVOIDSELEMENT", `${G()},$,$,$,${ref},${op}`);
          pset(op, "Pset_BIT_Bauteil", [["Bauteiltyp", "Öffnung"], ["Breite", pr.masse.w], ["Hoehe", pr.masse.h], ["Bruestung", pr.masse.sill], ["Tiefe", tiefe], ["Wirt", k.id]]);
        }
      }
      if (k.gruppe != null) { const l = gruppenRefs.get(k.gruppe) || []; l.push(ref); gruppenRefs.set(k.gruppe, l); } else contain(0, ref);
      // 107-10: a body with `dach` (massing_layer v6) gets an IfcRoof of inclined plates on its top (roof library); a flat roof writes
      // nothing (the body top is the roof); a body without `dach` writes nothing here (golden byte-identical)
      if (g.dach && g.dach.form && g.dach.form !== "flach") {
        const dd = dachBerechnen(pts, g.dach, { traufhoehe_m: 0 });
        if (!dd.ok) warn(`Massing-Körper ${k.name || k.id}: Dachform „${g.dach.form}“ wird nicht berechnet (nur ebene Dachflächen) — nicht exportiert.`, WARNART_DACH, { id: k.id, name: String(k.name || k.id), form: String(g.dach.form) });
        else if (dd.anstieg_m > 0.005) {
          const dRef = E("IFCROOF", `'${bauteilGuid(sbOpt?.projektId ?? null, "massing-dach", { id: k.id })}',$,${S(`Dach ${k.name || k.id}`)},$,$,${placement(0, 0, (g.basis || 0) + g.hoehe)},${shape(dachPlatten(dd, DECKEN_STANDARD.dach.dicke_m))},$,.${DACHTYP[dd.form]}.`);
          contain(0, dRef);
          pset(dRef, "Pset_BIT_Bauteil", [["Bauteiltyp", "Dach (Massing)"], ["Dachform", dd.form], ["Neigung", dd.neigung_grad], ["Firsthoehe", dd.anstieg_m], ["Wirt", k.id]]);
        }
      }
    }
    for (const [nr, refs] of gruppenRefs) {
      // IfcElementAssembly (IFC4): … Tag, AssemblyPlace, PredefinedType — one per group number.
      const asm = E("IFCELEMENTASSEMBLY", `'${bauteilGuid(sbOpt?.projektId ?? null, "massing-gruppe", { id: nr })}',$,${S(`Gruppe ${nr}`)},$,${S("Massing-Gruppe")},${placement(0, 0, 0)},$,$,.NOTDEFINED.,.USERDEFINED.`);
      E("IFCRELAGGREGATES", `${G()},$,$,$,${asm},(${refs.join(",")})`);
      contain(0, asm);
    }
  }

  // 107-10 (D-BK-20, D-BK-08b): the basement walls and slabs are in the file (107-13); the terrain subtraction (excavation pit, ground
  // after the excavation, earth contact) exists only in the Massing studio's 3D view and the quantities — said, not silently left out
  if (Number(model.untergeschosse) > 0 && massing && massing.gelaende && Array.isArray(massing.gelaende.h) && massing.gelaende.h.length) {
    warn("Untergeschoss: der Geländeabzug (Baugrube, Gelände nach dem Aushub) steht nur in der 3D-Ansicht und in den Mengen, nicht im IFC.", WARNART_SEO, { art: "gelaende" });
  }

  // ---- 97-02a: materials (layer sets for walls) and DIN 276 classification ----
  if (sbOpt) {
    const materialRef = new Map();
    /** 107-03: material property sets (IfcMaterialProperties: Name, Description, Properties, Material) — density and conductivity of the catalogue */
    const materialPsets = (/** @type {string} */ ref, /** @type {string|null|undefined} */ katalogId) => {
      const m = materialById(katalogId);
      if (!m) return;
      const prop = (/** @type {string} */ k, /** @type {string} */ typ, /** @type {number} */ v) => E("IFCPROPERTYSINGLEVALUE", `${S(k)},$,${typ}(${f(v)}),$`);
      if (Number.isFinite(m.dichte)) E("IFCMATERIALPROPERTIES", `${S("Pset_MaterialCommon")},$,(${prop("MassDensity", "IFCMASSDENSITYMEASURE", /** @type {number} */ (m.dichte))}),${ref}`);
      if (Number.isFinite(m.lambda)) E("IFCMATERIALPROPERTIES", `${S("Pset_MaterialThermal")},$,(${prop("ThermalConductivity", "IFCTHERMALCONDUCTIVITYMEASURE", /** @type {number} */ (m.lambda))}),${ref}`);
    };
    const mat = (name, katalogId = null) => {
      if (!materialRef.has(name)) { const r = E("IFCMATERIAL", `${S(name)},$,$`); materialRef.set(name, r); if (schichtDetail) materialPsets(r, katalogId); }
      return materialRef.get(name);
    };
    // IfcMaterialLayer.Category per layer function (free IfcLabel in IFC4). [ASSUMED] the English words Core / Finish / Other: IFC4 knows no
    // fixed list for this attribute (checked from memory of the schema, not against the buildingSMART page — not reachable here); a way to a
    // proven value: the IDS/MVD of the receiving party. Priority: IFC4 constrains it to 0-100 (same memory), the table runs 0-999, so /10.
    const KATEGORIE = { kern: "Core", bekleidung: "Finish", sonstig: "Other" };
    const schichtSets = new Map();
    mitMaterial.forEach(({ ref, s, wand }) => {
      let rel;
      if (s.aufbau?.schichten?.length) {
        const key = `${s.aufbau.name}|${s.aufbau.schichten.map((l) => `${l.name}:${l.dicke_m}${schichtDetail ? `:${l.funktion}:${l.prioritaet}` : ""}`).join("/")}`;
        if (!schichtSets.has(key)) {
          // IfcMaterialLayer: Material, LayerThickness (m), IsVentilated, Name, Description, Category, Priority.
          const layers = s.aufbau.schichten.map((l) => E("IFCMATERIALLAYER", `${mat(l.material ? `${l.name} (${l.material})` : l.name, l.material)},${f(l.dicke_m)},${l.material === "luftbel" ? ".T." : ".F."},${S(l.name)},$,${schichtDetail ? S(KATEGORIE[l.funktion]) : "$"},${schichtDetail ? Math.round(l.prioritaet / 10) : "$"}`));
          schichtSets.set(key, E("IFCMATERIALLAYERSET", `(${layers.join(",")}),${S(s.aufbau.name)},$`));
        }
        rel = schichtSets.get(key);
        if (wand) {
          // IfcMaterialLayerSetUsage: ForLayerSet, LayerSetDirection, DirectionSense, OffsetFromReferenceLine (m), ReferenceExtent.
          // The layers stack along the local Y axis of the wall placement (= the plan normal n, 107-01): outside → inside runs along −n, so
          // AXIS2 with DirectionSense NEGATIVE; the first layer starts at the +n face of the body, d/2 from the placement axis (the placement sits
          // on the body centre line, not on the reference line — openings and voids hang on it). Offset = +d/2 [ASSUMED: sign measured along the
          // axis, not along the sense; not verified against a viewer that evaluates the usage]. The reference line itself is in the data sheet
          // (Pset_BIT_Bauteil Referenzlinie, Referenzlinie_Versatz).
          rel = E("IFCMATERIALLAYERSETUSAGE", `${rel},.AXIS2.,.NEGATIVE.,${f(s.aufbau.dicke_m / 2)},$`);
        }
      } else rel = mat(s.material);
      E("IFCRELASSOCIATESMATERIAL", `${G()},$,$,$,(${ref}),${rel}`);
    });
    if (nachKg.size) {
      // IfcClassification: Source, Edition, EditionDate, Name, Description, Location, ReferenceTokens.
      const din = E("IFCCLASSIFICATION", `'DIN','2018-12',$,${S("DIN 276")},${S("Kosten im Bauwesen")},$,$`);
      [...nachKg.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([kg, refs]) => {
        const cref = E("IFCCLASSIFICATIONREFERENCE", `$,${S(kg)},${S(`KG ${kg}`)},${din},$,$`);
        E("IFCRELASSOCIATESCLASSIFICATION", `${G()},$,$,$,(${refs.join(",")}),${cref}`);
      });
    }
  }

  // ---- 107-11 (BK-55, D-BK-13): room boundaries, only with the option `raumGrenzen` ----
  // IfcRelSpaceBoundary (IFC4: GlobalId, OwnerHistory, Name, Description, RelatingSpace, RelatedBuildingElement, ConnectionGeometry,
  // PhysicalOrVirtualBoundary, InternalOrExternalBoundary) between each space and every wall of its storey that bounds it
  // (raeume.js grenzWaende: an edge of the room runs along the wall body); no connection geometry (optional in IFC4). Hull walls are
  // EXTERNAL, all others INTERNAL. Each space also gets Qto_SpaceBaseQuantities with GrossFloorArea (polygon) and NetFloorArea
  // (raeume.js: minus columns and stair/lift shafts, with messregel "referenzlinie" also minus the wall bodies; the storey spaces always
  // with "referenzlinie", see above), m². Workshop interior walls (`wt:`) are never outer walls (the workshop's outer walls are not
  // exported, the hull walls stand for them), so INTERNAL is right for them.
  if (raumGrenzen) {
    const waendeMitRef = wallList.filter((w) => w.ref);
    for (const r of raumListe) {
      const kandidaten = waendeMitRef.filter((w) => (w.level || 0) === r.level)
        .map((w) => ({ schluessel: w.key, a: w.a, b: w.b, dicke_m: w.th, versatz_m: w.versatz || 0 }));
      for (const g of grenzWaende(r.punkte, kandidaten)) {
        const w = wallByKey.get(g.schluessel);
        if (!w?.ref) continue;
        E("IFCRELSPACEBOUNDARY", `${G()},$,$,$,${r.ref},${w.ref},$,.PHYSICAL.,.${w.quelle === "huelle" ? "EXTERNAL" : "INTERNAL"}.`);
      }
      const brutto = E("IFCQUANTITYAREA", `'GrossFloorArea',$,$,${f(polyAreaXZ(r.punkte))},$`);
      const netto = E("IFCQUANTITYAREA", `'NetFloorArea',$,$,${f(r.netto())},$`);
      const qto = E("IFCELEMENTQUANTITY", `${G()},$,'Qto_SpaceBaseQuantities',$,$,(${brutto},${netto})`);
      E("IFCRELDEFINESBYPROPERTIES", `${G()},$,$,$,(${r.ref}),${qto}`);
    }
  }

  // ---- Containment-Relationen ----
  Object.entries(contained).forEach(([st, els]) => {
    if (els.length) E("IFCRELCONTAINEDINSPATIALSTRUCTURE", `${G()},$,$,$,(${els.join(",")}),${st}`);
  });

  // ---- STEP-Datei zusammensetzen ----
  const stamp = "1970-01-01T00:00:00"; // deterministisch (kein Date in der Laufzeit)
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
    `FILE_NAME(${S(`${projectName}.ifc`)},'${stamp}',(''),(''),'BIT-Atelier','BIT-Atelier','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
  ].join("\n");
  return `${header}\n${rows.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
