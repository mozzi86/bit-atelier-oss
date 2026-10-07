// Open data exchange + versioning helpers (Speckle-style, BIM 2.0).
import { bitApi } from "@core/api/bitApi";
import { modelDims } from "@core/lib/bimElements";

// Gather all project-related data into one portable object.
export async function gatherProjectData(projectId) {
  const [project, buildings, issues, comments, lv, tenders, bids, measurements, tasks, programs] = await Promise.all([
    bitApi.entities.Project.get(projectId).catch(() => null),
    bitApi.entities.Building.filter({ project_id: projectId }),
    bitApi.entities.Issue.filter({ project_id: projectId }),
    bitApi.entities.Comment.filter({ project_id: projectId }),
    bitApi.entities.LVPosition.filter({ project_id: projectId }),
    bitApi.entities.Tender.filter({ project_id: projectId }),
    bitApi.entities.Bid.filter({ project_id: projectId }),
    bitApi.entities.Measurement.filter({ project_id: projectId }),
    bitApi.entities.ScheduleTask.filter({ project_id: projectId }),
    bitApi.entities.SpaceProgram.filter({ project_id: projectId }),
  ]);
  return { project, buildings, issues, comments, lv, tenders, bids, measurements, tasks, programs };
}

// Compact metric snapshot for version diffs.
export function snapshotMetrics(d) {
  const open = (d.issues || []).filter((i) => i.status !== "resolved" && i.status !== "closed").length;
  const kostenanschlag = (d.lv || []).reduce((s, p) => s + (p.quantity || 0) * (p.unit_price || 0), 0);
  const vergeben = (d.tenders || []).filter((t) => t.status === "awarded").length;
  const bgf = (d.programs?.[0]?.items || []).reduce((s, it) => s + (it.area || 0) * (it.count || 0), 0) / (d.programs?.[0]?.efficiency || 0.8);
  return {
    gebaeude: (d.buildings || []).length,
    offene_tickets: open,
    kommentare: (d.comments || []).length,
    lv_positionen: (d.lv || []).length,
    kostenanschlag_eur: Math.round(kostenanschlag),
    ausschreibungen: (d.tenders || []).length,
    vergeben,
    vorgaenge: (d.tasks || []).length,
    bgf_m2: Math.round(bgf),
  };
}

export const SNAPSHOT_LABELS = {
  gebaeude: "Gebäude",
  offene_tickets: "Offene Tickets",
  kommentare: "Kommentare",
  lv_positionen: "LV-Positionen",
  kostenanschlag_eur: "Kostenanschlag (€)",
  ausschreibungen: "Ausschreibungen",
  vergeben: "Vergeben",
  vorgaenge: "Vorgänge",
  bgf_m2: "BGF (m²)",
};

// Minimal, schematic IFC (STEP) text from the building dimensions.
export function toIfcText(project, building) {
  const { floors, w, d, floorH } = modelDims(building || { floors: 6, area_net: 1800 });
  const lines = [];
  let id = 100;
  const ref = () => `#${id++}`;
  lines.push("ISO-10303-21;");
  lines.push("HEADER;");
  lines.push(`FILE_DESCRIPTION(('BIT-Atelier schematic export'),'2;1');`);
  lines.push(`FILE_NAME('${(project?.name || "model").replace(/'/g, "")}.ifc','',(''),(''),'BIT-Atelier','BIT-Atelier','');`);
  lines.push("FILE_SCHEMA(('IFC4'));");
  lines.push("ENDSEC;");
  lines.push("DATA;");
  lines.push(`${ref()}=IFCPROJECT('${project?.id || "proj"}',$,'${project?.name || "Projekt"}',$,$,$,$,$,$);`);
  lines.push(`${ref()}=IFCBUILDING('bldg',$,'${building?.name || "Gebäude"}',$,$,$,$,$,$,$,$,$);`);
  for (let i = 0; i < floors; i++) {
    lines.push(`${ref()}=IFCBUILDINGSTOREY('storey-${i}',$,'Geschoss ${i + 1}',$,$,$,$,$,.ELEMENT.,${(i * floorH).toFixed(2)});`);
    lines.push(`/* slab ${i}: ${w.toFixed(1)}m x ${d.toFixed(1)}m, h=${floorH}m */`);
  }
  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");
  return lines.join("\n");
}

export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(r.result)); } catch (e) { reject(e); } };
    r.onerror = reject;
    r.readAsText(file);
  });
}

// IFC-STEP-Text parsen: Geschosse (Name + Höhe) und Elementanzahlen.
export function parseIfcText(text) {
  const emptyCounts = { walls: 0, slabs: 0, spaces: 0, windows: 0, doors: 0, roofs: 0, columns: 0 };
  if (!text || typeof text !== "string") {
    return { name: "", schema: "", storeys: [], counts: { ...emptyCounts }, totalElements: 0 };
  }

  // Schema aus dem Header, z. B. FILE_SCHEMA(('IFC4'));
  const schemaMatch = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i);
  const schema = schemaMatch ? schemaMatch[1] : "";

  // Projektname aus IFCPROJECT: 2. gequoteter String (1. ist der GUID).
  let name = "";
  const projMatch = text.match(/=\s*IFCPROJECT\s*\(([^;]*)\)\s*;/i);
  if (projMatch) {
    const strs = [...projMatch[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    name = strs[1] || "";
  }

  // Geschosse: Name (2. gequoteter String) + Elevation (letzte Zahl der Parameterliste).
  const storeys = [];
  const storeyRe = /=\s*IFCBUILDINGSTOREY\s*\(([^;]*)\)\s*;/gi;
  let m;
  let idx = 0;
  while ((m = storeyRe.exec(text)) !== null) {
    const params = m[1];
    const strs = [...params.matchAll(/'((?:[^']|'')*)'/g)].map((s) => s[1]);
    const storeyName = strs[1] || strs[0] || `Geschoss ${idx + 1}`;
    const nums = [...params.matchAll(/(-?\d+(?:\.\d*)?)(?=[,)]|\s*$)/g)].map((n) => parseFloat(n[1]));
    const elevation = nums.length ? nums[nums.length - 1] : idx * 3;
    storeys.push({ name: storeyName, elevation });
    idx += 1;
  }
  storeys.sort((a, b) => a.elevation - b.elevation);

  // Elementtypen zählen (Vorkommen von "=IFCXXX(").
  const countOf = (re) => (text.match(re) || []).length;
  const counts = {
    walls: countOf(/=\s*IFCWALL(?:STANDARDCASE)?\s*\(/gi),
    slabs: countOf(/=\s*IFCSLAB\s*\(/gi),
    spaces: countOf(/=\s*IFCSPACE\s*\(/gi),
    windows: countOf(/=\s*IFCWINDOW\s*\(/gi),
    doors: countOf(/=\s*IFCDOOR\s*\(/gi),
    roofs: countOf(/=\s*IFCROOF\s*\(/gi),
    columns: countOf(/=\s*IFCCOLUMN\s*\(/gi),
  };
  const totalElements = Object.values(counts).reduce((s, n) => s + n, 0);

  return { name, schema, storeys, counts, totalElements };
}
