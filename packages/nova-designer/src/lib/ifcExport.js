// Minimaler, abhängigkeitsfreier IFC4-Export (STEP) aus dem BIT-BIM-Modell.
// Erzeugt Projekt-/Site-/Building-/Storey-Struktur + Wände/Decken/Stützen/Räume
// und Fenster/Türen mit extrudierter Box-Geometrie. Koordinaten: IFC X=Modell-x,
// IFC Y=Modell-z (Plan), IFC Z=Höhe.
// Öffnungen werden als echte Voids exportiert (IfcOpeningElement +
// IfcRelVoidsElement je Fenster/Tür, IfcRelFillsElement zum Bauteil), damit die
// Wandmengen um die Öffnungen reduziert sind (Mengengrundlage/AVA-Kopplung).
// Öffnungen, die nicht in ihre Wand passen, werden NICHT exportiert, sondern über
// den optionalen onWarn-Callback gemeldet (keine stillen Falschmengen).
// STEP-Syntax: E() erwartet die Attributliste OHNE äußere Klammern; nur echte
// Listen-Attribute (IfcCartesianPoint.Coordinates, IfcDirection.DirectionRatios,
// IfcPolyline.Points, IfcUnitAssignment.Units …) klammern selbst. Strings gehen
// durch S() (Apostroph-Verdopplung + ISO-10303-21-Kodierung von Umlauten).
import { compositeTotalM, openingTypeById } from "@core/lib/buildingModel";
import { GEWERKE_TGA, netzHardened } from "@designer/lib/tgaNetz";
import { layerHardened as statikHardened, traegerVordim } from "@designer/lib/tragwerkPlan";
import { steckbrief, typFuerWand, typFuerNetz } from "@core/lib/bauteil/steckbrief.js";
import { attributeVon, mitAttributen, werkstattMitAttributen } from "@core/lib/bauteil/attribute.js";

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
 * IFC4-STEP-Export des Gebäudemodells plus gezeichneter Elemente.
 * @param {object} model createBuildingModel-Ergebnis
 * @param {{ customWalls?: Array<object>, customColumns?: Array<object>, customWindows?: Array<object>,
 *   envOpenings?: Array<object>, autoOpenings?: Array<object>, customZones?: Array<object>,
 *   customSlabs?: Array<object>, customRoofs?: Array<object>, storeyHeight?: number, projectName?: string,
 *   timestamp?: number, onWarn?: ((msg: string) => void)|null, netz?: object|null, werkstatt?: any,
 *   steckbrief?: {projektId?: string|number|null}|null, tragwerk?: object|null, bauteilAttribute?: object|null }} [opts]
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
 *   tragwerk (97-02a, needs steckbrief): `statik_layer` — beams as IfcBeam.
 *   bauteilAttribute (97-02): `bauteil_attribute_layer` — decisions on workshop and hull elements
 *   (status, KG, trade, section) by stable id; without it nothing changes.
 * @returns {string} STEP-Text
 */
export function exportIFC(model, { customWalls = [], customColumns = [], customWindows = [], envOpenings = [], autoOpenings = [], customZones = [], customSlabs = [], customRoofs = [], storeyHeight = 3, projectName = "BIT-Atelier", timestamp = 0, onWarn = null, netz = null, werkstatt = null, steckbrief: sbOpt = null, tragwerk = null, bauteilAttribute = null } = {}) {
  // 97-02: workshop walls/doors carry the attribute table's decisions (status, KG, trade …).
  if (werkstatt && bauteilAttribute) werkstatt = werkstattMitAttributen(werkstatt, bauteilAttribute);
  const rows = []; let nid = 0; let gid = 1;
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
  const polySolid = (poly, h) => {
    const pts = poly.map((p) => E("IFCCARTESIANPOINT", `(${f(p.x)},${f(p.z)})`));
    const line = E("IFCPOLYLINE", `(${[...pts, pts[0]].join(",")})`);
    const prof = E("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${line}`);
    const pos3 = E("IFCAXIS2PLACEMENT3D", `${p0},${dirZ},${dirX}`);
    return E("IFCEXTRUDEDAREASOLID", `${prof},${pos3},${dirZ},${f(h)}`);
  };
  const shape = (solid) => {
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
  if (storeyRefs.length) E("IFCRELAGGREGATES", `${G()},$,$,$,${building},(${storeyRefs.map((x) => x.ref).join(",")})`);
  const storeyOf = (lvl) => (storeyRefs.find((x) => x.s.level === lvl) || storeyRefs[0])?.ref;
  const contained = {}; // storeyRef -> [elementRefs]
  const contain = (lvl, ref) => { const st = storeyOf(lvl) || storeyRefs[0]?.ref; if (!st) return; (contained[st] = contained[st] || []).push(ref); };

  // 89-03: property sets (IfcPropertySingleValue: text → IfcLabel, boolean → IfcBoolean, number →
  // IfcReal; null → "ohne Status"/"—" as text, D-BW-03 no default) attached via IfcRelDefinesByProperties.
  const pset = (ref, name, props) => {
    const werte = props.map(([k, v]) => {
      const nominal = typeof v === "boolean" ? `IFCBOOLEAN(${v ? ".T." : ".F."})` : typeof v === "number" && Number.isFinite(v) ? `IFCREAL(${f(v)})` : `IFCLABEL(${S(v ?? "—")})`;
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
  /** @type {Map<string, string[]>} KG → element refs (one classification relation per KG) */
  const nachKg = new Map();
  /** @type {Array<{ref: string, s: any}>} elements with material */
  const mitMaterial = [];
  const sb = (el, typ, quelle, extra = {}) => steckbrief(el, typ, { projektId, quelle, storeyHeight, ...extra });
  const herkunft = (s) => Object.entries(s.quelle).map(([k, v]) => `${k}:${v}`).join(", ");
  // 97-08: IFC4 PEnum_ElementStatus in the standard Pset_<Element>Common (NEW/EXISTING/DEMOLISH/
  // TEMPORARY; no status = NOTKNOWN, never NEW). Walls and beams add it to their own Common pset
  // below; Pset_BIT_Bauteil.Status stays as the fallback for IFC2x3 readers.
  const STATUS_ENUM = { neubau: "NEW", bestand: "EXISTING", abbruch: "DEMOLISH", temporaer: "TEMPORARY" };
  const statusEnum = (s) => STATUS_ENUM[s?.status] || "NOTKNOWN";
  const COMMON_PSET = { IfcSlab: "Pset_SlabCommon", IfcColumn: "Pset_ColumnCommon", IfcRoof: "Pset_RoofCommon", IfcWindow: "Pset_WindowCommon",
    IfcDoor: "Pset_DoorCommon", IfcStair: "Pset_StairCommon", IfcRailing: "Pset_RailingCommon", IfcCovering: "Pset_CoveringCommon",
    IfcFooting: "Pset_FootingCommon", IfcPile: "Pset_PileCommon", IfcBuildingElementProxy: "Pset_BuildingElementProxyCommon" };
  const datenblatt = (ref, s, zusatz = []) => {
    pset(ref, "Pset_BIT_Bauteil", [
      ["Bauteiltyp", s.label], ["Status", s.status ?? "ohne Status"], ["KG", s.kg ?? "offen"],
      ["Gewerk_LB", s.gewerk ? `${s.gewerk.lb} ${s.gewerk.name}` : "offen"], ["Gewerk", s.gewerkGrob ?? "—"],
      ["Material", s.material ?? "offen"], ["Menge", s.menge.wert], ["Einheit", s.menge.einheit],
      ["Bauabschnitt", s.bauabschnitt ?? "offen"], ["Ablauf_Folge", s.gewerk ? s.gewerk.folge : "offen"],
      ["Tragend", !!s.tragend], ["Herkunft", herkunft(s)], ["Offen", s.offen.join(", ") || "—"],
      ...zusatz,
    ]);
    if (COMMON_PSET[s.ifc.klasse]) pset(ref, COMMON_PSET[s.ifc.klasse], [["Status", statusEnum(s)], ...(s.tragend ? [["LoadBearing", true]] : [])]);
    if (s.kg) { const l = nachKg.get(s.kg) || []; l.push(ref); nachKg.set(s.kg, l); }
    if (s.aufbau?.schichten?.length || s.material) mitMaterial.push({ ref, s });
  };
  const sguid = (s) => `'${s.guid}'`;

  // ---- Wände (Hülle + gezeichnet) ----
  // Registry: Schlüssel -> IFC-Referenz + Geometrie. Nötig, damit jede Öffnung
  // per IfcRelVoidsElement genau EINER Wand zugeordnet werden kann (KD-15).
  // Schlüssel: Hüllwand = `env:<level>:<edge>`, gezeichnete Wand = `cw:<_idx>`.
  const wallList = [];
  (model.walls || []).forEach((w) => wallList.push({ key: `env:${w.level}:${w.edge}`, a: w.a, b: w.b, th: w.thickness, h: w.height, elev: w.elevation, level: w.level, roh: mitAttributen({ ...w, huelle: true, id: `${w.level}:${w.edge}` }, attributeVon(bauteilAttribute, "hull-wall")), quelle: "huelle" }));
  customWalls.forEach((w) => wallList.push({ key: `cw:${w._idx}`, a: w.a, b: w.b, th: compositeTotalM(w.composite) || w.thickness || 0.3, h: w.height || storeyHeight, elev: (w.level || 0) * storeyHeight, level: w.level || 0, roh: w, quelle: "customWalls" }));
  // 89-03: workshop interior walls (stable GUID, name, property sets) — envelope pieces skipped.
  const wtWaende = (werkstatt?.waende || []).filter((w) => !w.huelle);
  wtWaende.forEach((w) => wallList.push({ key: `wt:${w.guid}`, a: w.a, b: w.b, th: w.dicke_m, h: w.hoehe_m || storeyHeight, elev: (w.level || 0) * storeyHeight, level: w.level || 0, guid: w.guid, name: w.klasse === "tragend" ? "Trennwand" : "Innenwand", bauteil: w }));
  const wallByKey = new Map();
  wallList.forEach((w) => {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.05) return;
    const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
    const ang = Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
    const solid = rectSolid(len, w.th, w.h);
    const pl = placement(mx, mz, w.elev, ang);
    // 97-02a: hull and drawn walls carry their data sheet (workshop walls keep their own psets below).
    const wTyp = sbOpt && w.roh ? typFuerWand(w.roh) : null;
    const wSb = wTyp ? sb(w.roh, wTyp.typ, w.quelle, { typAbgeleitet: wTyp.abgeleitet }) : null;
    const wall = wSb
      ? E("IFCWALL", `${sguid(wSb)},$,${S(wSb.label)},$,$,${pl},${shape(solid)},$,.${wSb.ifc.typ}.`)
      : E("IFCWALL", `${w.guid ? `'${w.guid}'` : G()},$,${w.name ? S(w.name) : "'Wand'"},$,$,${pl},${shape(solid)},$,.STANDARD.`);
    contain(w.level, wall);
    if (wSb) {
      datenblatt(wall, wSb, [["Dicke", w.th]]);
      pset(wall, "Pset_WallCommon", [["IsExternal", wTyp.typ === "wand-aussen"], ["LoadBearing", !!wSb.tragend], ["Status", statusEnum(wSb)]]);
    }
    // Geometrie für die Öffnungs-Platzierung merken (lokales System der Wand:
    // X entlang a→b ab Wandmitte, Y quer, Z nach oben).
    w.ref = wall; w.pl = pl; w.len = len; w.ang = ang;
    w.dx = (w.b.x - w.a.x) / len; w.dz = (w.b.z - w.a.z) / len;
    if (!wallByKey.has(w.key)) wallByKey.set(w.key, w);
  });

  // ---- Stützen ----
  customColumns.forEach((c) => {
    const s = c.size || 0.4; const solid = rectSolid(s, s, storeyHeight);
    const cSb = sbOpt ? sb(c, "stuetze", "customColumns") : null;
    const col = E("IFCCOLUMN", `${cSb ? sguid(cSb) : G()},$,${S("Stütze")},$,$,${placement(c.x, c.z, (c.level || 0) * storeyHeight)},${shape(solid)},$,.COLUMN.`);
    contain(c.level || 0, col);
    if (cSb) datenblatt(col, cSb, [["Querschnitt", s]]);
  });

  // ---- Decken (Slabs) ----
  (model.slabs || []).forEach((s) => {
    const solid = polySolid(s.polygon, 0.25);
    // 97-02a: the lowest hull slab is the base slab (level < 0 or elevation 0 on level 0).
    const hTyp = s.level <= 0 && !(s.elevation > 0) ? "bodenplatte" : "decke";
    const hSb = sbOpt ? sb(mitAttributen({ ...s, id: `${s.level}`, points: s.polygon }, attributeVon(bauteilAttribute, hTyp === "bodenplatte" ? "hull-floor" : "hull-slab")), hTyp, "huelle-decke") : null;
    const slab = hSb
      ? E("IFCSLAB", `${sguid(hSb)},$,${S(hSb.label)},$,$,${placement(0, 0, s.elevation)},${shape(solid)},$,.${hSb.ifc.typ}.`)
      : E("IFCSLAB", `${G()},$,'Decke',$,$,${placement(0, 0, s.elevation)},${shape(solid)},$,.FLOOR.`);
    contain(Math.max(0, s.level), slab);
    if (hSb) datenblatt(slab, hSb, [["Dicke", 0.25]]);
  });

  // ---- Gezeichnete Decken + Dächer ----
  (customSlabs || []).forEach((s) => {
    if (!s.points || s.points.length < 3) return;
    const solid = polySolid(s.points, 0.22);
    const dSb = sbOpt ? sb(s, "decke", "customSlabs") : null;
    const slab = E("IFCSLAB", `${dSb ? sguid(dSb) : G()},$,'Decke',$,$,${placement(0, 0, (s.level || 0) * storeyHeight + storeyHeight - 0.22)},${shape(solid)},$,.FLOOR.`);
    contain(s.level || 0, slab);
    if (dSb) datenblatt(slab, dSb, [["Dicke", 0.22]]);
  });
  (customRoofs || []).forEach((rf) => {
    if (!rf.points || rf.points.length < 3) return;
    // vereinfacht als flache Dachplatte (IfcRoof) auf Trauf-Höhe
    const solid = polySolid(rf.points, 0.2);
    // 97-02a: up to 10° [ASSUMED] is a flat roof (FLAT_ROOF, LB 021), steeper a pitched one.
    const rSb = sbOpt ? sb(rf, (Number(rf.pitch) || 0) <= 10 ? "dach-flach" : "dach-geneigt", "customRoofs") : null;
    const roof = rSb
      ? E("IFCROOF", `${sguid(rSb)},$,${S(rSb.label)},$,$,${placement(0, 0, (rf.level || 0) * storeyHeight + storeyHeight)},${shape(solid)},$,.${rSb.ifc.typ}.`)
      : E("IFCROOF", `${G()},$,'Dach',$,$,${placement(0, 0, (rf.level || 0) * storeyHeight + storeyHeight)},${shape(solid)},$,.GABLE_ROOF.`);
    contain(rf.level || 0, roof);
    if (rSb) datenblatt(roof, rSb, [["Neigung", Number(rf.pitch) || 0]]);
  });

  // ---- Räume (Spaces) — Modell-Spaces + gezeichnete Zonen ----
  (model.spaces || []).forEach((s) => {
    const solid = polySolid(s.polygon, storeyHeight * 0.98);
    const sp = E("IFCSPACE", `${G()},$,${S(s.name)},$,$,${placement(0, 0, s.elevation)},${shape(solid)},$,.ELEMENT.,.INTERNAL.,$`);
    contain(s.level, sp);
  });
  (customZones || []).forEach((z) => {
    if (!z.points || z.points.length < 3) return;
    const solid = polySolid(z.points, storeyHeight * 0.98);
    const zSb = sbOpt ? sb(z, "raum", "customZones") : null;
    const sp = E("IFCSPACE", `${zSb ? sguid(zSb) : G()},$,${S(z.name || "Raum")},$,$,${placement(0, 0, (z.level || 0) * storeyHeight)},${shape(solid)},$,.ELEMENT.,.INTERNAL.,$`);
    contain(z.level || 0, sp);
    if (zSb) datenblatt(sp, zSb);
  });

  // ---- Fenster/Türen mit ECHTEN Voids (KD-15) ----
  // Je Öffnung: IfcOpeningElement (Void über die volle Wanddicke) +
  // IfcRelVoidsElement zur Wand -> die Wandmenge ist um die Öffnung reduziert,
  // damit ist der Export Mengengrundlage. IfcRelFillsElement verbindet den Void
  // mit dem Bauteil (Fenster/Tür). Platzierung relativ zur Wand-Platzierung:
  // lokal X = u - len/2 (entlang der Wand), Y = 0 (mittig in der Dicke),
  // Z = Brüstungshöhe (sill).
  const warn = (msg) => { if (typeof onWarn === "function") onWarn(msg); };
  // Maße einer Öffnung: explizit (width/height/sill) oder aus der Typ-Bibliothek.
  const dimsOf = (o) => {
    if (o.width != null && o.height != null) return { w: o.width, h: o.height, sill: o.sill || 0 };
    const ty = openingTypeById(o.kind, o.typeId);
    return { w: ty.w, h: ty.h, sill: ty.sill };
  };

  const addOpening = (wallKey, o, label) => {
    const w = wallByKey.get(wallKey);
    if (!w) { warn(`${label}: keine zugehörige Wand (${wallKey}) — nicht exportiert.`); return; }
    const d = dimsOf(o);
    // Passt die Öffnung überhaupt in die Wand? Sonst NICHT exportieren (ein zu
    // großer Void würde die Wandmenge falsch reduzieren) — mit Meldung.
    if (!(d.w > 0) || !(d.h > 0) || d.w + 0.1 > w.len || d.sill + d.h > w.h + 1e-6) {
      warn(`${label}: ${d.w.toFixed(2)}×${d.h.toFixed(2)} m (Brüstung ${d.sill.toFixed(2)} m) passt nicht in die Wand (${w.len.toFixed(2)}×${w.h.toFixed(2)} m) — nicht exportiert.`);
      return;
    }
    // Position entlang der Wand in den gültigen Bereich legen (Öffnung bleibt
    // vollständig in der Wand; ohne Randabstand gäbe es Nullkanten-Booleans).
    const u = Math.min(Math.max(o.u ?? w.len / 2, d.w / 2 + 0.05), w.len - d.w / 2 - 0.05);
    const isDoor = o.kind === "door";
    // Void: volle Wanddicke + 2 cm Überstand je Seite (robuste Subtraktion).
    const voidPl = placement(u - w.len / 2, 0, d.sill, 0, w.pl);
    const op = E("IFCOPENINGELEMENT", `${G()},$,${S(isDoor ? "Türöffnung" : "Fensteröffnung")},$,$,${voidPl},${shape(rectSolid(d.w, w.th + 0.04, d.h))},$,.OPENING.`);
    E("IFCRELVOIDSELEMENT", `${G()},$,$,$,${w.ref},${op}`);
    // Bauteil im Void (12 cm Ansichtsdicke), Platzierung relativ zum Void.
    const pl = placement(0, 0, 0, 0, voidPl);
    const ent = isDoor ? "IFCDOOR" : "IFCWINDOW";
    // IFC4-Attributreihenfolge: …,Tag,OverallHeight,OverallWidth,PredefinedType,
    // OperationType/PartitioningType,UserDefined… (die letzten drei offen).
    // 97-02a: a door in a hull wall is an exterior door, in a drawn/workshop wall [ASSUMED] interior.
    const oSb = sbOpt && !o.guid ? sb(o, isDoor ? (wallKey.startsWith("env:") ? "tuer-aussen" : "tuer-innen") : "fenster", `oeffnung|${wallKey}|${o.kind}|${o._idx ?? o.u ?? 0}`) : null;
    const ref = E(ent, `${oSb ? sguid(oSb) : o.guid ? `'${o.guid}'` : G()},$,${S(o.name || (isDoor ? "Tür" : "Fenster"))},$,$,${pl},${shape(rectSolid(d.w, 0.12, d.h))},$,${f(d.h)},${f(d.w)},$,$,$`);
    E("IFCRELFILLSELEMENT", `${G()},$,$,$,${op},${ref}`);
    contain(w.level, ref);
    if (oSb) datenblatt(ref, oSb, [["Breite", d.w], ["Hoehe", d.h], ["Bruestung", d.sill]]);
    return ref;
  };
  customWindows.forEach((o) => addOpening(`cw:${o.wallIdx}`, o, `${o.kind === "door" ? "Tür" : "Fenster"} auf gezeichneter Wand ${o.wallIdx}`));
  envOpenings.forEach((o) => addOpening(`env:${o.level}:${o.edge}`, o, `${o.kind === "door" ? "Tür" : "Fenster"} auf Hüllwand ${o.level}/${o.edge}`));
  // Regel-Öffnungen der Hülle (Auto-Fenster + Eingangstür aus autoOpenings.js).
  // Sie sind in 3D, Grundriss und Maßketten sichtbar und müssen deshalb auch im
  // IFC stehen — sonst gehen Plan und Export auseinander (KD-16). Maße kommen
  // explizit mit (width/height/sill), nicht aus der Typ-Bibliothek.
  autoOpenings.forEach((o) => addOpening(`env:${o.level}:${o.edge}`, o, `${o.kind === "door" ? "Eingangstür" : "Auto-Fenster"} auf Hüllwand ${o.level}/${o.edge}`));

  // ---- 89-03: Werkstatt-Bauteile (Psets, Türen mit Void in ihrer Wand, Räume) ----
  if (werkstatt) {
    wtWaende.forEach((w) => {
      const reg = wallByKey.get(`wt:${w.guid}`);
      if (!reg?.ref) return;
      // 97-02: with the data sheet the workshop wall gets the same Pset as every element (its GUID stays).
      if (sbOpt) datenblatt(reg.ref, sb({ ...w, height: w.hoehe_m }, typFuerWand(w).typ, "werkstatt"), [["Klasse", w.klasse], ["LichteLaenge", w.lichteLaenge_m], ["Rohbaulaenge", w.rohbauLaenge_m], ["Dicke", w.dicke_m]]);
      else pset(reg.ref, "Pset_BIT_Bauteil", [...bauteilProps(w), ["Klasse", w.klasse], ["LichteLaenge", w.lichteLaenge_m], ["Rohbaulaenge", w.rohbauLaenge_m], ["Dicke", w.dicke_m]]);
      pset(reg.ref, "Pset_WallCommon", [["IsExternal", false], ["LoadBearing", !!w.tragend], ...(sbOpt ? [["Status", statusEnum(w)]] : [])]);
    });
    // Door height: DIN 18100 Rohbaurichtmaß 2,01 m [ASSUMED, the workshop has no door height].
    const TUER_HOEHE_M = 2.01;
    (werkstatt.tueren || []).filter((t) => !t.huelle).forEach((t) => {
      const mx = (t.a.x + t.b.x) / 2, mz = (t.a.z + t.b.z) / 2;
      const wand = wtWaende.find((w) => {
        if (w.level !== t.level) return false;
        const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, l = Math.hypot(dx, dz) || 1;
        const s = ((mx - w.a.x) * dx + (mz - w.a.z) * dz) / l;
        return Math.abs(((mx - w.a.x) * dz - (mz - w.a.z) * dx) / l) < 0.01 && s >= -1e-6 && s <= l + 1e-6;
      });
      if (!wand) { warn(`Werkstatt-Tür ${t.zone}: keine Innenwand an der Türstelle — nicht exportiert.`); return; }
      const l = Math.hypot(wand.b.x - wand.a.x, wand.b.z - wand.a.z) || 1;
      const u = ((mx - wand.a.x) * (wand.b.x - wand.a.x) + (mz - wand.a.z) * (wand.b.z - wand.a.z)) / l;
      const ref = addOpening(`wt:${wand.guid}`, { kind: "door", width: t.breite_m, height: TUER_HOEHE_M, sill: 0, u, guid: t.guid, name: t.art === "wohnung" ? "Wohnungseingangstür" : "Innentür" }, `Werkstatt-Tür ${t.zone}`);
      if (ref && sbOpt) datenblatt(ref, sb(t, "tuer-innen", "werkstatt"), [["Art", t.art], ["Raum", t.zone], ["Nach", t.nach ?? "—"]]);
      else if (ref) pset(ref, "Pset_BIT_Bauteil", [...bauteilProps(t), ["Art", t.art], ["Raum", t.zone], ["Nach", t.nach ?? "—"]]);
    });
    (werkstatt.raeume || []).forEach((r) => {
      if (!Array.isArray(r.points) || r.points.length < 3) return;
      const sp = E("IFCSPACE", `'${r.guid}',$,${S(r.name.replace(/ ·WT$/, ""))},$,$,${placement(0, 0, (r.level || 0) * storeyHeight)},${shape(polySolid(r.points, storeyHeight * 0.98))},$,.ELEMENT.,.INTERNAL.,$`);
      contain(r.level || 0, sp);
      pset(sp, "Pset_BIT_Bauteil", [["Status", r.status ?? "ohne Status"], ["WE", r.we ?? "—"], ["Raumart", r.raumart ?? "—"], ["FlaecheLicht", r.flaeche_m2], ["GUID_Quelle", "Wohnungs-Werkstatt (stabil über Re-Tesselierung)"]]);
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
        ? E(kSb.ifc.klasse.toUpperCase(), `${sguid(kSb)},$,${S(`${g?.label || "Leitung"} ${dnText}`)},${S(g?.medium || "")},$,${placement(0, 0, k.level * storeyHeight)},${pds},${S(k.id)},.${kSb.ifc.typ}.`)
        : E(klasse, `${G()},$,${S(`${g?.label || "Leitung"} ${dnText}`)},${S(g?.medium || "")},$,${placement(0, 0, k.level * storeyHeight)},${pds},${S(k.id)},${typ}`);
      contain(k.level, seg);
      if (kSb) datenblatt(seg, kSb, [["System", g?.label || "—"], ["Medium", g?.medium || "—"], ["Nennweite", dnText]]);
    });
    // 97-02a: nodes (plant, distributors, terminals, connections) as their IFC4 distribution
    // elements, placed at their point without body (concept stage). All of them share the IFC4
    // attribute list GlobalId … Tag, PredefinedType (9 attributes).
    if (sbOpt) n.knoten.forEach((kn) => {
      const nSb = sb(kn, typFuerNetz(kn), "netz-knoten", { netzGewerk: kn.gewerk });
      const g = GEWERKE_TGA[kn.gewerk];
      const el = E(nSb.ifc.klasse.toUpperCase(), `${sguid(nSb)},$,${S(kn.name || nSb.label)},${S(g?.label || "")},$,${placement(kn.x, kn.z, (kn.level || 0) * storeyHeight + NETZ_ACHSHOEHE_M)},$,${S(kn.id)},.${nSb.ifc.typ}.`);
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
      const z0 = (t.level + 1) * storeyHeight - h;
      const pl = placement((t.a.x + t.b.x) / 2, (t.a.z + t.b.z) / 2, z0, Math.atan2(t.b.z - t.a.z, t.b.x - t.a.x));
      const beam = E("IFCBEAM", `${sguid(tSb)},$,${S(tSb.label)},$,$,${pl},${shape(rectSolid(len, t.breite_m, h))},$,.${tSb.ifc.typ}.`);
      contain(t.level, beam);
      datenblatt(beam, tSb, [["Breite", t.breite_m], ["Hoehe", h], ["Spannweite", len]]);
      pset(beam, "Pset_BeamCommon", [["LoadBearing", true], ["Span", len], ["Status", statusEnum(tSb)]]);
    });
  }

  // ---- 97-02a: materials (layer sets for walls) and DIN 276 classification ----
  if (sbOpt) {
    const materialRef = new Map();
    const mat = (name) => { if (!materialRef.has(name)) materialRef.set(name, E("IFCMATERIAL", `${S(name)},$,$`)); return materialRef.get(name); };
    const schichtSets = new Map();
    mitMaterial.forEach(({ ref, s }) => {
      let rel;
      if (s.aufbau?.schichten?.length) {
        const key = `${s.aufbau.name}|${s.aufbau.schichten.map((l) => `${l.name}:${l.dicke_m}`).join("/")}`;
        if (!schichtSets.has(key)) {
          // IfcMaterialLayer: Material, LayerThickness (m), IsVentilated, Name, Description, Category, Priority.
          const layers = s.aufbau.schichten.map((l) => E("IFCMATERIALLAYER", `${mat(l.material ? `${l.name} (${l.material})` : l.name)},${f(l.dicke_m)},${l.material === "luftbel" ? ".T." : ".F."},${S(l.name)},$,$,$`));
          schichtSets.set(key, E("IFCMATERIALLAYERSET", `(${layers.join(",")}),${S(s.aufbau.name)},$`));
        }
        rel = schichtSets.get(key);
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
