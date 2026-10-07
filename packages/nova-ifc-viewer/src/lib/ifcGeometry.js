// Geometrie-Extraktion aus web-ifc — Phase-30-Spike (VIEW-01-Vorstufe).
//
// parseIfcModel(arrayBuffer, { onProgress, api }) → EIN OpenModel-Pass:
//   Semantik (extractSemantics aus ifcImport) + GlobalId-Map + Geometrie-Stream,
//   gemergt in EIN Buffer-Set (positions/normals/colors/index) mit Range-Tabelle
//   [{ eid, start, count }] (start/count in Index-Einheiten, aufsteigend sortiert).
//   Statusfarben als Vertex-Colors; Auswahl/Highlight = Color-Buffer je Range umfärben.
//
// Bewusst three-frei (nur TypedArrays) — nutzbar aus Seite, Worker oder Node.
//
// Koordinaten-Konvention (KONST: IFC_TO_SCENE, empirisch verifiziert 2026-07-30 am
// Referenzmodell): web-ifc liefert die flatTransformation BEREITS in three.js-Konvention
// (Y-up — Höhenachse des transformierten Referenzmodells: Y = 25,6 m, Grundriss X/Z ≈ 350 m).
// Transformierte Koordinaten werden daher 1:1 übernommen — KEINE zusätzliche Rotation
// (eine frühere (x,z,−y)-Abbildung legte das Modell auf die Seite).
// OpenModel mit COORDINATE_TO_ORIGIN: georeferenzierte Archicad-Modelle (UTM-
// Millionenkoordinaten) werden an den Ursprung verschoben — sonst Float32-Jitter.

import * as WebIFC from "web-ifc";
// Portierung 2026-08-26 (aus JBs Rückgabe 260821): getApi()-Singleton gibt es hier
// nicht mehr (Phase 33/W2, Node-Importierbarkeit) — WASM lädt dynamisch über ifcWasm.js.
// extractSemantics heißt bei uns extractFromModel (Phase 33, liefert zusätzlich
// warnungen/kennzahlen und Elemente mit `guid` statt `globalId` — unten geshimt).
import { extractFromModel } from "./ifcImport.js";

// Statusfarben (RGB 0..1): Abbruch rot, Neubau grün, Bestand grau, unbekannt hellgrau.
export const STATUS_COLORS = {
  abbruch: [0.937, 0.267, 0.267],
  neubau: [0.133, 0.773, 0.369],
  bestand: [0.58, 0.639, 0.722],
  unbekannt: [0.784, 0.816, 0.859],
};
export const HIGHLIGHT_COLOR = [1.0, 0.62, 0.04]; // Amber — markierte Bauteile (Filter/GUIDs)
export const SELECT_COLOR = [0.23, 0.51, 0.96]; // Blau — per Klick ausgewähltes Bauteil
export const DIM_COLOR = [0.88, 0.9, 0.93]; // zurückgenommene Umgebung

const yieldToPaint = () => new Promise((r) => setTimeout(r, 0));

// parseIfcModel(arrayBuffer, { onProgress?, api? }) — api injizierbar (Worker/Node).
export async function parseIfcModel(arrayBuffer, { onProgress, api: injectedApi } = {}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const t0 = performance.now();
  const api = injectedApi || (await (await import("./ifcWasm.js")).loadIfcApi());

  progress("Öffne IFC-Modell (Koordinaten → Ursprung)…");
  await yieldToPaint(); // Paint-Chance vor dem blockierenden OpenModel
  let modelID = -1;
  try {
    modelID = api.OpenModel(new Uint8Array(arrayBuffer), { COORDINATE_TO_ORIGIN: true });
  } catch {
    throw new Error("Die Datei konnte nicht als IFC-Modell geöffnet werden.");
  }
  if (typeof modelID !== "number" || modelID < 0) {
    throw new Error("Die Datei konnte nicht als IFC-Modell geöffnet werden.");
  }

  try {
    const semantics = extractFromModel(api, modelID, { onProgress: progress });
    // Shim: unsere Elemente führen die IFC-GUID als `guid` (Identität, L1) — JBs
    // Code erwartet `globalId`. Beides bereitstellen, statt 900 Zeilen anzufassen.
    for (const e of semantics.elements) if (e.globalId == null) e.globalId = e.guid ?? "";
    const elementByExpressId = new Map(semantics.elements.map((e) => [e.expressId, e]));

    // --- 1) Geometrie streamen: Rohteile sammeln (synchron, WASM-blockierend) ---
    progress("Lese Geometrie…");
    const parts = [];
    let totalVerts = 0;
    let totalIdx = 0;
    api.StreamAllMeshes(modelID, (mesh, i, total) => {
      const eid = mesh.expressID;
      try {
        if (api.GetLineType(modelID, eid) === WebIFC.IFCSPACE) return; // Räume nicht rendern
      } catch { /* Typ unbestimmbar → rendern */ }
      const geoms = mesh.geometries;
      const n = geoms.size();
      for (let k = 0; k < n; k++) {
        const pg = geoms.get(k);
        const g = api.GetGeometry(modelID, pg.geometryExpressID);
        // .slice(): Kopie statt WASM-Heap-View (View wird beim nächsten Call ungültig)
        const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize()).slice();
        const index = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()).slice();
        if (typeof g.delete === "function") g.delete(); // WASM-Leak über zehntausende Meshes
        parts.push({ eid, verts, index, mat: pg.flatTransformation });
        totalVerts += verts.length / 6; // interleaved [x,y,z,nx,ny,nz]
        totalIdx += index.length;
      }
      if (i % 500 === 0 && total) progress(`Geometrie ${i}/${total}…`);
    });

    // --- 2) GlobalId-Map: ALLE Semantik-Elemente (auch ohne eigene Geometrie — z. B.
    // IfcCurtainWall, dessen Geometrie auf aggregierten Kindern liegt) + gestreamte Extras.
    progress("Lese GUIDs…");
    const guidByExpressId = new Map();
    for (const el of semantics.elements) {
      if (el.globalId) guidByExpressId.set(el.expressId, el.globalId);
    }
    const uniqueEids = new Set(parts.map((p) => p.eid));
    for (const eid of uniqueEids) {
      if (guidByExpressId.has(eid)) continue;
      try {
        const line = api.GetLine(modelID, eid);
        const raw = line?.GlobalId;
        const v = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
        if (v) guidByExpressId.set(eid, String(v));
      } catch { /* Element ohne lesbare GUID */ }
    }

    // --- 2b) Aggregations-Hierarchie (IfcRelAggregates): Eltern ohne eigene Geometrie
    // (CurtainWall → Plates/Members, Treppen-Container, …) → Kinder fürs Highlight.
    const childrenByExpressId = new Map();
    try {
      const relIds = api.GetLineIDsWithType(modelID, WebIFC.IFCRELAGGREGATES);
      for (let i = 0; i < relIds.size(); i++) {
        try {
          const rel = api.GetLine(modelID, relIds.get(i));
          const parent = rel?.RelatingObject?.value;
          if (parent == null) continue;
          const kids = (rel?.RelatedObjects || []).map((h) => h?.value).filter((v) => v != null);
          if (!kids.length) continue;
          const cur = childrenByExpressId.get(parent) || [];
          childrenByExpressId.set(parent, cur.concat(kids));
        } catch { /* defekte Relation überspringen */ }
      }
    } catch { /* Typ nicht vorhanden */ }

    // --- 3) Merge in EIN Buffer-Set (chunkweise, mit Paint-Yields) ---
    progress("Baue 3D-Geometrie…");
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const index = new Uint32Array(totalIdx);
    const ranges = []; // { eid, start, count } — start/count in Index-Einheiten
    const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

    const colorFor = (eid) =>
      STATUS_COLORS[elementByExpressId.get(eid)?.status] || STATUS_COLORS.unbekannt;

    let vOff = 0; // Vertex-Offset
    let iOff = 0; // Index-Offset
    for (let p = 0; p < parts.length; p++) {
      const { eid, verts, index: pIdx, mat: m } = parts[p];
      const col = colorFor(eid);
      const nVerts = verts.length / 6;
      for (let v = 0; v < nVerts; v++) {
        const x = verts[v * 6], y = verts[v * 6 + 1], z = verts[v * 6 + 2];
        const nx = verts[v * 6 + 3], ny = verts[v * 6 + 4], nz = verts[v * 6 + 5];
        // flatTransformation: 16 Werte, spaltenweise (column-major)
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
        const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
        const tnx = m[0] * nx + m[4] * ny + m[8] * nz;
        const tny = m[1] * nx + m[5] * ny + m[9] * nz;
        const tnz = m[2] * nx + m[6] * ny + m[10] * nz;
        // IFC_TO_SCENE: web-ifc ist bereits Y-up → 1:1 übernehmen
        const o = (vOff + v) * 3;
        positions[o] = tx; positions[o + 1] = ty; positions[o + 2] = tz;
        normals[o] = tnx; normals[o + 1] = tny; normals[o + 2] = tnz;
        colors[o] = col[0]; colors[o + 1] = col[1]; colors[o + 2] = col[2];
        if (tx < bbox.min[0]) bbox.min[0] = tx; if (tx > bbox.max[0]) bbox.max[0] = tx;
        if (ty < bbox.min[1]) bbox.min[1] = ty; if (ty > bbox.max[1]) bbox.max[1] = ty;
        if (tz < bbox.min[2]) bbox.min[2] = tz; if (tz > bbox.max[2]) bbox.max[2] = tz;
      }
      for (let ii = 0; ii < pIdx.length; ii++) index[iOff + ii] = pIdx[ii] + vOff;
      // Ranges: aufeinanderfolgende Parts desselben Elements zusammenfassen
      const last = ranges[ranges.length - 1];
      if (last && last.eid === eid && last.start + last.count === iOff) {
        last.count += pIdx.length;
      } else {
        ranges.push({ eid, start: iOff, count: pIdx.length });
      }
      vOff += nVerts;
      iOff += pIdx.length;
      parts[p] = null; // Rohdaten freigeben
      if (p % 400 === 399) {
        progress(`Baue 3D-Geometrie… ${Math.round((p / parts.length) * 100)} %`);
        await yieldToPaint();
      }
    }

    progress(`Fertig: ${uniqueEids.size} Bauteile, ${(totalIdx / 3).toLocaleString("de-DE")} Dreiecke.`);
    return {
      schema: semantics.schema,
      storeys: semantics.storeys,
      elements: semantics.elements,
      guidByExpressId,
      childrenByExpressId,
      merged: { positions, normals, colors, index, ranges, bbox },
      stats: {
        parseMs: Math.round(performance.now() - t0),
        elementsWithGeometry: uniqueEids.size,
        triangles: totalIdx / 3,
        vertices: totalVerts,
      },
    };
  } finally {
    try { if (modelID >= 0) api.CloseModel(modelID); } catch { /* bereits geschlossen */ }
  }
}

// Menge von Element-IDs um aggregierte Nachkommen erweitern (max. Tiefe 4) —
// für Highlights auf Eltern ohne eigene Geometrie (CurtainWall, Treppen-Container).
export function expandWithDescendants(eids, childrenByExpressId) {
  const out = new Set(eids);
  const queue = [...eids].map((e) => [e, 0]);
  while (queue.length) {
    const [eid, depth] = queue.pop();
    if (depth >= 4) continue;
    for (const kid of childrenByExpressId.get(eid) || []) {
      if (!out.has(kid)) {
        out.add(kid);
        queue.push([kid, depth + 1]);
      }
    }
  }
  return out;
}

// Sub-Geometrie der markierten Elemente extrahieren (non-indexed) — für ein
// separates Highlight-Mesh im Ghost-Modus (Rest transparent, Treffer solid).
export function extractSubGeometry(merged, eidSet) {
  const { positions, normals, index, ranges } = merged;
  let count = 0;
  for (const r of ranges) if (eidSet.has(r.eid)) count += r.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const r of ranges) {
    if (!eidSet.has(r.eid)) continue;
    for (let i = r.start; i < r.start + r.count; i++) {
      const v = index[i] * 3;
      pos[o] = positions[v]; pos[o + 1] = positions[v + 1]; pos[o + 2] = positions[v + 2];
      nor[o] = normals[v]; nor[o + 1] = normals[v + 1]; nor[o + 2] = normals[v + 2];
      o += 3;
    }
  }
  return { positions: pos, normals: nor, vertices: count };
}

// Raycast-Hit → Element: faceIndex (three) → Index-Offset → Binärsuche in ranges.
export function expressIdAtFaceIndex(ranges, faceIndex) {
  const off = faceIndex * 3;
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (off < r.start) hi = mid - 1;
    else if (off >= r.start + r.count) lo = mid + 1;
    else return r.eid;
  }
  return null;
}

// Vertex-Bereich je Element (für Umfärben): Map eid → [{ start, count }] in INDEX-Einheiten.
// Umgefärbt werden die referenzierten VERTICES — dazu Index-Werte der Range durchlaufen.
export function recolorElements(merged, colorForEid) {
  const { colors, index, ranges } = merged;
  for (const r of ranges) {
    const col = colorForEid(r.eid);
    if (!col) continue;
    for (let i = r.start; i < r.start + r.count; i++) {
      const v = index[i] * 3;
      colors[v] = col[0]; colors[v + 1] = col[1]; colors[v + 2] = col[2];
    }
  }
}
