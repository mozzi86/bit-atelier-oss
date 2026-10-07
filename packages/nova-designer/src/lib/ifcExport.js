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
 *   timestamp?: number, onWarn?: ((msg: string) => void)|null, netz?: object|null }} [opts]
 *   netz (Phase 41): TGA-Netz (`netz_layer`) — je Kante ein IfcPipe-/Duct-/CableSegment mit
 *   Polylinien-Achse; ohne Netz ist die Datei byte-identisch zu vorher.
 * @returns {string} STEP-Text
 */
export function exportIFC(model, { customWalls = [], customColumns = [], customWindows = [], envOpenings = [], autoOpenings = [], customZones = [], customSlabs = [], customRoofs = [], storeyHeight = 3, projectName = "BIT-Atelier", timestamp = 0, onWarn = null, netz = null } = {}) {
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

  // ---- Wände (Hülle + gezeichnet) ----
  // Registry: Schlüssel -> IFC-Referenz + Geometrie. Nötig, damit jede Öffnung
  // per IfcRelVoidsElement genau EINER Wand zugeordnet werden kann (KD-15).
  // Schlüssel: Hüllwand = `env:<level>:<edge>`, gezeichnete Wand = `cw:<_idx>`.
  const wallList = [];
  (model.walls || []).forEach((w) => wallList.push({ key: `env:${w.level}:${w.edge}`, a: w.a, b: w.b, th: w.thickness, h: w.height, elev: w.elevation, level: w.level }));
  customWalls.forEach((w) => wallList.push({ key: `cw:${w._idx}`, a: w.a, b: w.b, th: compositeTotalM(w.composite) || w.thickness || 0.3, h: w.height || storeyHeight, elev: (w.level || 0) * storeyHeight, level: w.level || 0 }));
  const wallByKey = new Map();
  wallList.forEach((w) => {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.05) return;
    const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
    const ang = Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
    const solid = rectSolid(len, w.th, w.h);
    const pl = placement(mx, mz, w.elev, ang);
    const wall = E("IFCWALL", `${G()},$,'Wand',$,$,${pl},${shape(solid)},$,.STANDARD.`);
    contain(w.level, wall);
    // Geometrie für die Öffnungs-Platzierung merken (lokales System der Wand:
    // X entlang a→b ab Wandmitte, Y quer, Z nach oben).
    w.ref = wall; w.pl = pl; w.len = len; w.ang = ang;
    w.dx = (w.b.x - w.a.x) / len; w.dz = (w.b.z - w.a.z) / len;
    if (!wallByKey.has(w.key)) wallByKey.set(w.key, w);
  });

  // ---- Stützen ----
  customColumns.forEach((c) => {
    const s = c.size || 0.4; const solid = rectSolid(s, s, storeyHeight);
    const col = E("IFCCOLUMN", `${G()},$,${S("Stütze")},$,$,${placement(c.x, c.z, (c.level || 0) * storeyHeight)},${shape(solid)},$,.COLUMN.`);
    contain(c.level || 0, col);
  });

  // ---- Decken (Slabs) ----
  (model.slabs || []).forEach((s) => {
    const solid = polySolid(s.polygon, 0.25);
    const slab = E("IFCSLAB", `${G()},$,'Decke',$,$,${placement(0, 0, s.elevation)},${shape(solid)},$,.FLOOR.`);
    contain(Math.max(0, s.level), slab);
  });

  // ---- Gezeichnete Decken + Dächer ----
  (customSlabs || []).forEach((s) => {
    if (!s.points || s.points.length < 3) return;
    const solid = polySolid(s.points, 0.22);
    const slab = E("IFCSLAB", `${G()},$,'Decke',$,$,${placement(0, 0, (s.level || 0) * storeyHeight + storeyHeight - 0.22)},${shape(solid)},$,.FLOOR.`);
    contain(s.level || 0, slab);
  });
  (customRoofs || []).forEach((rf) => {
    if (!rf.points || rf.points.length < 3) return;
    // vereinfacht als flache Dachplatte (IfcRoof) auf Trauf-Höhe
    const solid = polySolid(rf.points, 0.2);
    const roof = E("IFCROOF", `${G()},$,'Dach',$,$,${placement(0, 0, (rf.level || 0) * storeyHeight + storeyHeight)},${shape(solid)},$,.GABLE_ROOF.`);
    contain(rf.level || 0, roof);
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
    const sp = E("IFCSPACE", `${G()},$,${S(z.name || "Raum")},$,$,${placement(0, 0, (z.level || 0) * storeyHeight)},${shape(solid)},$,.ELEMENT.,.INTERNAL.,$`);
    contain(z.level || 0, sp);
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
    const ref = E(ent, `${G()},$,${S(isDoor ? "Tür" : "Fenster")},$,$,${pl},${shape(rectSolid(d.w, 0.12, d.h))},$,${f(d.h)},${f(d.w)},$,$,$`);
    E("IFCRELFILLSELEMENT", `${G()},$,$,$,${op},${ref}`);
    contain(w.level, ref);
  };
  customWindows.forEach((o) => addOpening(`cw:${o.wallIdx}`, o, `${o.kind === "door" ? "Tür" : "Fenster"} auf gezeichneter Wand ${o.wallIdx}`));
  envOpenings.forEach((o) => addOpening(`env:${o.level}:${o.edge}`, o, `${o.kind === "door" ? "Tür" : "Fenster"} auf Hüllwand ${o.level}/${o.edge}`));
  // Regel-Öffnungen der Hülle (Auto-Fenster + Eingangstür aus autoOpenings.js).
  // Sie sind in 3D, Grundriss und Maßketten sichtbar und müssen deshalb auch im
  // IFC stehen — sonst gehen Plan und Export auseinander (KD-16). Maße kommen
  // explizit mit (width/height/sill), nicht aus der Typ-Bibliothek.
  autoOpenings.forEach((o) => addOpening(`env:${o.level}:${o.edge}`, o, `${o.kind === "door" ? "Eingangstür" : "Auto-Fenster"} auf Hüllwand ${o.level}/${o.edge}`));

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
      const seg = E(klasse, `${G()},$,${S(`${g?.label || "Leitung"} ${dnText}`)},${S(g?.medium || "")},$,${placement(0, 0, k.level * storeyHeight)},${pds},${S(k.id)},${typ}`);
      contain(k.level, seg);
    });
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
