import React, { useRef, useEffect, useState, useMemo } from "react";
import * as THREE from "three";
import { Card, CardContent } from "@core/components/ui/card";
import {
  Boxes, WifiOff, Layers, Box, Grid2x2, Scissors,
  MousePointer2, RectangleHorizontal, Columns3, Square, Triangle,
  DoorOpen, AppWindow, Frame, Eye, EyeOff, Lock, LockOpen, Ruler, Type, PenLine, Trash2, Undo2,
  Sparkles, Sun, Focus, Keyboard, Camera, Copy, Star, RotateCcw,
} from "lucide-react";
import { FACADE_PRESETS, facadeMaterial, sunFromHour, createCityLife, updateCityLife } from "@designer/components/renderModeAssets";

// ---- Ebenen (Layers, ArchiCAD-Stil) — getrennt von Geschossen (Storeys) ----
const DEFAULT_LAYERS = [
  { id: "terrain", name: "Gelände", visible: true, locked: false },
  { id: "context", name: "Umgebung", visible: true, locked: false },
  { id: "shell", name: "Gebäudehülle", visible: true, locked: false },
  { id: "attika", name: "Attika", visible: true, locked: false },
  { id: "walls", name: "Wände", visible: true, locked: false },
  { id: "columns", name: "Stützen", visible: true, locked: false },
  { id: "zones", name: "Räume/Zonen", visible: true, locked: false },
  { id: "openings", name: "Fenster/Türen", visible: true, locked: false },
  { id: "dimensions", name: "Bemaßung", visible: true, locked: false },
  { id: "labels", name: "Beschriftung", visible: true, locked: false },
];

// Layer-Kombinationen: welche Ebenen je Kombination sichtbar sind.
const LAYER_COMBOS = {
  "Alle zeigen": ["terrain", "context", "shell", "attika", "walls", "columns", "zones", "openings", "dimensions", "labels"],
  "Architektur 1:100": ["shell", "attika", "walls", "columns", "zones", "openings", "dimensions", "labels"],
  "Lageplan": ["terrain", "context", "shell", "attika"],
  "Rohbau": ["shell", "attika", "walls", "columns"],
  "Plan-Ausgabe": ["shell", "attika", "walls", "columns", "zones", "openings", "dimensions", "labels"],
};

// ---- Tastaturkürzel (BIM-D): zentrale Map — Quelle für Handler UND Hilfe-Popover ----
const SHORTCUTS = [
  { keys: "V", desc: "Pfeil (Auswahl)" },
  { keys: "W", desc: "Werkzeug Wand" },
  { keys: "S", desc: "Werkzeug Stütze" },
  { keys: "D", desc: "Werkzeug Decke" },
  { keys: "F", desc: "Zoom auf Auswahl" },
  { keys: "Strg+D", desc: "Auswahl duplizieren (+1 m)" },
  { keys: "Pfeiltasten", desc: "Auswahl verschieben (0,1 m)" },
  { keys: "Shift+Pfeil", desc: "Auswahl verschieben (1 m)" },
  { keys: "Shift+Klick", desc: "Auswahl erweitern/reduzieren" },
  { keys: "Entf", desc: "Auswahl löschen" },
  { keys: "Esc", desc: "Auswahl aufheben · Pfeil-Werkzeug" },
];

// Deutsche Werkzeugnamen (Favoriten-Labels, BIM-F)
const TOOL_NAMES = { wall: "Wand", column: "Stütze", window: "Fenster", door: "Tür", zone: "Zone", slab: "Decke", roof: "Dach" };
import { useProject } from "@core/lib/ProjectContext";
import { useElevationGrid } from "@designer/lib/useElevationGrid";
import { useOsmBuildings } from "@designer/lib/useOsmBuildings";
import { useOsmEnvironment } from "@designer/lib/useOsmEnvironment";
import { createBuildingModel, footprintToMeters, modelBBox, WALL_COMPOSITES, compositeById, compositeTotalM, WINDOW_TYPES, windowTypeById, DOOR_TYPES, doorTypeById, openingTypeById, DEFAULT_FOOTPRINT } from "@core/lib/buildingModel";
import { Link } from "react-router-dom";
import { Sketch } from "@sketch/lib/sketchModel.js";
import { runSolve } from "@sketch/lib/solveCore.js";
import SketchGeometry from "@sketch/components/SketchGeometry.jsx";
import SketchEditOverlay from "./SketchEditOverlay.jsx";
import { autoEnvOpenings, ENTRANCE_DEFAULT } from "@designer/lib/autoOpenings";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import BimPlan2D from "@designer/components/BimPlan2D";
import { exportExposePng } from "@designer/components/MassingView3D";
import { exportIFC } from "@designer/lib/ifcExport";
import { useBuildingProgram, buildingProgram, fmtLen } from "@core/lib/useBuildingProgram";
import { istGeneriert } from "@designer/lib/apartments";
import { istWerkstattZone } from "@designer/lib/tesselierung";

// Effektive Wanddicke (Composite-Gesamtdicke oder Einzeldicke).
function effThicknessM(w) {
  const tot = compositeTotalM(w.composite);
  return tot || w.thickness || 0.3;
}

// Eckfüller: wo sich gezeichnete Wände an einem Endpunkt berühren, wird die Ecke
// mit einem kleinen Pfeiler aufgefüllt (Wand-Cleanup, dependency-frei).
function cornerFillers(walls) {
  const tol = 0.3;
  const pts = [];
  walls.forEach((w) => { pts.push({ x: w.a.x, z: w.a.z, w }); pts.push({ x: w.b.x, z: w.b.z, w }); });
  const used = new Array(pts.length).fill(false);
  const fillers = [];
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const group = [i]; used[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < tol && pts[i].w.level === pts[j].w.level) { group.push(j); used[j] = true; }
    }
    // unterschiedliche Wände? -> echte Ecke
    const wallsHere = [...new Set(group.map((g) => pts[g].w._idx))];
    if (wallsHere.length >= 2) {
      const x = group.reduce((s, g) => s + pts[g].x, 0) / group.length;
      const z = group.reduce((s, g) => s + pts[g].z, 0) / group.length;
      const thk = Math.max(...group.map((g) => effThicknessM(pts[g].w)));
      const h = Math.max(...group.map((g) => pts[g].w.height || 3));
      const level = pts[group[0]].w.level;
      fillers.push({ x, z, thk, h, level });
    }
  }
  return fillers;
}

// Strahl o+t·d gegen Segment a-b: kleinstes t>0 oder Infinity.
function raySegT(o, d, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z;
  const det = ex * d.z - d.x * ez;
  if (Math.abs(det) < 1e-9) return Infinity;
  const wx = a.x - o.x, wz = a.z - o.z;
  const t = (-wx * ez + ex * wz) / det;
  const s = (d.x * wz - d.z * wx) / det;
  return (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) ? t : Infinity;
}
function polyAreaXZ(pts) {
  return Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
}
// Raum um Punkt p aus Wandsegmenten erkennen (Strahlen rundum, dann vereinfachen).
function detectRoom(p, segments, maxR = 80) {
  const N = 120, raw = []; let openHits = 0;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const d = { x: Math.cos(ang), z: Math.sin(ang) };
    let best = maxR;
    for (const [a, b] of segments) { const t = raySegT(p, d, a, b); if (t < best) best = t; }
    if (best >= maxR - 1e-3) openHits++;
    const pull = Math.min(0.12, best * 0.04); // leicht nach innen (in die Wand)
    raw.push({ x: p.x + d.x * (best - pull), z: p.z + d.z * (best - pull) });
  }
  if (openHits > N * 0.12) return null; // nicht geschlossen
  // Kollineare/zu nahe Punkte entfernen → saubere Ecken
  let pts = raw.filter((q, i) => { const r = raw[(i + 1) % raw.length]; return Math.hypot(q.x - r.x, q.z - r.z) > 0.08; });
  const keep = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 0.05) keep.push({ x: Math.round(b.x / 0.05) * 0.05, z: Math.round(b.z / 0.05) * 0.05 });
  }
  return keep.length >= 3 ? keep : null;
}

// Projiziert Punkt p auf Segment a-b. Liefert {t (0..1), dist, len}.
function projectPointToSeg(p, a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + dx * len * t, pz = a.z + dz * len * t;
  return { t, len, dist: Math.hypot(p.x - px, p.z - pz) };
}

// Verglasung/Türblatt + Sprossen für einen Öffnungstyp, lokal in der Wandebene.
// Wand-Local-Frame: X=Länge, Y=Höhe, Z=Dicke. kind: "window" | "door".
function buildGlazing(type, u, glassMat, frameMat, kind, leafMat) {
  const g = new THREE.Group();
  const { w, h, sill, cols, rows } = type;
  const x0 = u - w / 2, y0 = sill;
  // Füllung: Türblatt (massiv) bei Türen ohne Glas, sonst Glas
  const fill = (kind === "door" && !type.glass) ? leafMat : glassMat;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fill);
  panel.position.set(u, sill + h / 2, 0);
  g.add(panel);
  const bar = 0.05; // Sprossenbreite
  // Rahmen + vertikale Sprossen
  for (let c = 0; c <= cols; c++) {
    const x = x0 + (w / cols) * c;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bar, h, 0.12), frameMat);
    m.position.set(x, sill + h / 2, 0); g.add(m);
  }
  // horizontale Sprossen
  for (let r = 0; r <= rows; r++) {
    const y = y0 + (h / rows) * r;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + bar, bar, 0.12), frameMat);
    m.position.set(u, y, 0); g.add(m);
  }
  return g;
}

// Setzt die Sichtbarkeit aller getaggten Meshes anhand der Ebenen-Liste.
function applyLayerVisibility(t, layers) {
  if (!t) return;
  const vis = Object.fromEntries((layers || []).map((l) => [l.id, l.visible]));
  [t.terrainGroup, t.buildingGroup, t.contextGroup, t.customGroup].forEach((g) => {
    g?.children.forEach((m) => {
      const id = m.userData?.layer;
      if (id && id in vis) m.visible = vis[id];
    });
  });
}

// Sichtbare Markierungs-Aura für die 3D-Auswahl: emissive Färbung nur dort, wo ein
// Mesh ein eigenes Material hat, plus pulsierende Kontur (EdgesGeometry) für ALLE
// Treffer — auch Hüllwand/Geschossdecke/Verglasung, die sich ein Material teilen
// und deshalb nicht gefärbt werden dürfen. Mehrfachauswahl (Marquee) wird mitgeführt.
const AURA_COLOR = 0x0d9488; // Teal — dieselbe sel-Farbe wie im 2D-Grundriss (BimPlan2D)

// Kinds mit eigenem Material je Mesh — nur dort ist emissive gefahrlos.
const EMISSIVE_KINDS = new Set(["wall", "column", "zone", "cslab", "croof"]);

// Trifft die Auswahl (Objekt aus setSelected bzw. ein multiSel-Eintrag) dieses Mesh?
function auraMatches(m, sel) {
  if (!sel) return false;
  const u = m.userData || {};
  switch (sel.type) {
    case "wall": return u.kind === "wall" && u.id === sel.index;
    case "column": return u.kind === "column" && u.id === sel.index;
    case "opening": return (u.kind === "window" || u.kind === "door") && u.scope !== "auto" && u.id === sel.index;
    case "zone": return u.kind === "zone" && u.id === sel.index;
    case "slab": return u.kind === "cslab" && u.id === sel.index;
    case "roof": return u.kind === "croof" && u.id === sel.index;
    case "hullwall": return u.kind === "wallShell" && (u.level ?? 0) === sel.level && (u.edge ?? 0) === sel.edge;
    case "autowin": return u.kind === sel.kind && u.scope === "auto" && (u.level ?? 0) === sel.level && (u.edge ?? 0) === sel.edge;
    default: return false;
  }
}

function applyPickHighlight(t, selected, multi) {
  if (!t?.customGroup) return;
  // Alte Konturen restlos entfernen (Gruppen-Rebuilds leeren sie ohnehin mit).
  (t.auraList || []).forEach((line) => {
    line.parent?.remove(line);
    line.geometry?.dispose();
    line.material?.dispose();
  });
  t.auraList = [];
  const sels = multi && multi.length ? multi : selected ? [selected] : [];
  [t.customGroup, t.buildingGroup].forEach((g) => {
    g?.traverse((m) => {
      if (!m.isMesh) return;
      const isSel = sels.some((s) => auraMatches(m, s));
      if (m.material?.emissive && EMISSIVE_KINDS.has(m.userData?.kind)) {
        m.material.emissive.setHex(isSel ? 0x0b7d74 : 0x000000);
      }
      if (isSel) {
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(m.geometry),
          new THREE.LineBasicMaterial({ color: AURA_COLOR, transparent: true, opacity: 1, depthTest: false }),
        );
        line.renderOrder = 999;
        m.add(line); // erbt Position/Rotation des Meshes
        t.auraList.push(line);
      }
    });
  });
}

// Satteldach über der Bounding-Box eines Polygons (First entlang der längeren Achse).
function buildGableRoof(points, baseY, height, material) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, hY = baseY + height;
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  if ((maxX - minX) >= (maxZ - minZ)) {
    const A = [minX, baseY, minZ], B = [maxX, baseY, minZ], C = [maxX, baseY, maxZ], D = [minX, baseY, maxZ];
    const R1 = [minX, hY, cz], R2 = [maxX, hY, cz];
    tri(A, B, R2); tri(A, R2, R1); tri(R1, R2, C); tri(R1, C, D); tri(A, R1, D); tri(B, C, R2);
  } else {
    const A = [minX, baseY, minZ], B = [maxX, baseY, minZ], C = [maxX, baseY, maxZ], D = [minX, baseY, maxZ];
    const R1 = [cx, hY, minZ], R2 = [cx, hY, maxZ];
    tri(A, D, R2); tri(A, R2, R1); tri(B, R1, R2); tri(B, R2, C); tri(A, B, R1); tri(D, R2, C);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Walmdach (Hip): allseitig geneigte Flächen über der Bounding-Box, First entlang der längeren Achse verkürzt.
function buildHipRoof(points, baseY, height, material) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, hY = baseY + height;
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  const inset = Math.min(spanX, spanZ) * 0.25; // First um 1/4 der kürzeren Seite einrücken
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const A = [minX, baseY, minZ], B = [maxX, baseY, minZ], C = [maxX, baseY, maxZ], D = [minX, baseY, maxZ];
  let R1, R2;
  if (spanX >= spanZ) { R1 = [minX + inset, hY, cz]; R2 = [maxX - inset, hY, cz]; }
  else { R1 = [cx, hY, minZ + inset]; R2 = [cx, hY, maxZ - inset]; }
  // 2 trapezförmige Hauptflächen (je 2 Dreiecke) + 2 dreieckige Walmflächen
  if (spanX >= spanZ) {
    tri(A, B, R2); tri(A, R2, R1);          // vordere Schräge (minZ)
    tri(D, R1, R2); tri(D, R2, C);          // hintere Schräge (maxZ)
    tri(A, R1, D);                          // linker Walm (minX)
    tri(B, C, R2);                          // rechter Walm (maxX)
  } else {
    tri(A, R1, D); tri(D, R1, R2);          // linke Schräge (minX)  — Reihenfolge gemäß Normalen
    tri(B, R2, R1); tri(B, C, R2);          // rechte Schräge (maxX)
    tri(A, B, R1);                          // vorderer Walm (minZ)
    tri(D, R2, C);                          // hinterer Walm (maxZ)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Pultdach (Shed): einseitig geneigte Fläche, ansteigend entlang der kürzeren Achse.
function buildShedRoof(points, baseY, height, material) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const hY = baseY + height;
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  // Anstieg quer zur längeren Achse, damit die geneigte Fläche möglichst breit ist
  let A, B, C, D;
  if (spanX >= spanZ) {
    A = [minX, baseY, minZ]; B = [maxX, baseY, minZ];   // tiefe Kante (minZ)
    C = [maxX, hY, maxZ]; D = [minX, hY, maxZ];          // hohe Kante (maxZ)
  } else {
    A = [minX, baseY, minZ]; B = [minX, baseY, maxZ];   // tiefe Kante (minX)
    C = [maxX, hY, maxZ]; D = [maxX, hY, minZ];          // hohe Kante (maxX)
  }
  tri(A, B, C); tri(A, C, D); // geneigte Dachfläche
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Dachhöhe (First/Traufe-Differenz) aus Footprint-BBox und Neigung in Grad.
function roofRiseFromPitch(points, form, pitchDeg) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
  const t = Math.tan(Math.max(1, Math.min(60, pitchDeg || 30)) * Math.PI / 180);
  if (form === "pult") {
    const run = Math.max(spanX, spanZ);            // Anstieg über die ganze Breite
    return Math.max(0.3, Math.min(run * t, run));  // Höhe begrenzen
  }
  // Sattel/Walm: First über die halbe kürzere Spannweite
  const halfRun = Math.max(0.1, Math.min(spanX, spanZ) / 2);
  return Math.max(0.3, Math.min(halfRun * t, Math.min(spanX, spanZ)));
}

// Footprint-Polygon [{x,z}] zu extrudiertem Mesh (Höhe in m).
function extrudeFootprint(points, height, material) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // in XZ-Ebene legen, Höhe nach +Y
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Wand als Profil (Länge × Höhe) mit echten Öffnungen -> ExtrudeGeometry.
// Das ist die boolesche Subtraktion: die Löcher (openings:[{u,sill,width,height}])
// werden aus der Wand ausgeschnitten. thicknessOverride für Composite-Gesamtdicke.
function buildWallMeshWithHoles(w, material, openings, thicknessOverride, normalOffset) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
  const th = thicknessOverride || w.thickness || 0.3, H = w.height;
  const dirx = (w.b.x - w.a.x) / len, dirz = (w.b.z - w.a.z) / len;
  const nx = -dirz, nz = dirx;
  const off = normalOffset != null ? normalOffset : (w.refLine === "outside" ? th / 2 : w.refLine === "inside" ? -th / 2 : 0);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, H); shape.lineTo(0, H); shape.closePath();
  (openings || []).forEach(({ u, sill, width, height }) => {
    const x0 = Math.max(0.05, u - width / 2), x1 = Math.min(len - 0.05, u + width / 2);
    const y0 = Math.max(0.02, sill), y1 = Math.min(H - 0.02, sill + height);
    if (x1 <= x0 || y1 <= y0) return;
    const p = new THREE.Path();
    p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath();
    shape.holes.push(p);
  });
  const geo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
  geo.translate(0, 0, -th / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  m.position.set(w.a.x + nx * off, w.elevation, w.a.z + nz * off);
  m.rotation.y = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
  return m;
}

// Öffnungstyp (für buildGlazing) aus einer Regel-Öffnung mit expliziten Maßen.
function autoOpeningType(o) {
  return o.kind === "door"
    ? { w: o.width, h: o.height, sill: 0, cols: 1, rows: 2, glass: false }
    : { w: o.width, h: o.height, sill: o.sill, cols: 2, rows: 2 };
}

/**
 * BIT-BIM-Studio (Welle B1): EIN 3D-Fenster, das Gelände + Entwurfsgebäude
 * gemeinsam und maßstäblich (1 Einheit = 1 m) aus einem gemeinsamen Modell zeigt.
 */
export default function BitBimStudio({ complexData }) {
  const { project } = useProject();
  const { grid, min, max, offline } = useElevationGrid(project?.location, 10, 0.2); // 200 m-Patch (≤100 Punkte = Open-Meteo-Limit)
  const osm = useOsmBuildings(project?.location, 350);
  const env = useOsmEnvironment(project?.location, 300);
  const [showContext, setShowContext] = useState(true);
  // ---- Render-Modus: anschauliche Echtzeit-Darstellung (Himmel, Sonne, Fassade, belebte Stadt) ----
  const [renderMode, setRenderMode] = useState(false);
  const [facadePreset, setFacadePreset] = useState("putz"); // Fassaden-Preset der Hüllwände
  const [sunHour, setSunHour] = useState(14); // Sonnenstand (Uhrzeit 0-24)
  const animRef = useRef([]); // bewegte Stadt-Objekte für den tick()-Loop: [{mesh,pts,cum,total,d,speed}]
  const mountRef = useRef(null);
  const three = useRef({});
  const orbit = useRef({ on: false, x: 0, y: 0, theta: 0.7, phi: 1.0, radius: 70 });

  // Gemeinsame Quelle (Massing-Studio ↔ Gebäudemodell ↔ Kennzahlen): Footprint/Geschosse/Höhe/Einheit
  const bp = useBuildingProgram();
  const storeys = bp.storeys, setStoreys = (v) => bp.set({ storeys: v });
  const storeyHeight = bp.storeyHeight, setStoreyHeight = (v) => bp.set({ storeyHeight: v });
  const unit = bp.unit || "m", setUnit = (u) => bp.set({ unit: u });
  const [view, setView] = useState("3d"); // 3d | grundriss | schnitt
  const [planLevel, setPlanLevel] = useState(0);
  const [wallRef, setWallRef] = useState("center"); // Referenzlinie: center | outside | inside
  const [parapet, setParapet] = useState({ enabled: true, height: 1.0 }); // Attika
  const [dachform, setDachform] = useState("flach"); // flach | sattel | walm | pult
  const [dachneigung, setDachneigung] = useState(30); // Grad (für geneigte Dächer)
  const footprintEdit = bp.footprintM; // editierbarer Grundriss-Umriss (Meter) aus gemeinsamer Quelle
  const setFootprintEdit = (fp) => bp.set({ footprintM: typeof fp === "function" ? fp(bp.footprintM) : fp });
  // Eingangstür: Vorgabe 1,20 x 2,10 m mittig auf der ersten EG-Kante, per UI
  // änderbar (Breite/Höhe/Lage/Kante) und mit dem Modell gespeichert (KD-19).
  const [entranceCfg, setEntranceCfg] = useState(ENTRANCE_DEFAULT);
  const [envComposite, setEnvComposite] = useState(null); // Hüllwand-Aufbau (Composite) oder null=einschichtig
  const [envThickness, setEnvThickness] = useState(0.3); // Hüllwand-Dicke (einschichtig)
  // ---- Navigator / Mappen (ArchiCAD-Stil) ----
  const [scale, setScale] = useState(100); // Maßstab-Nenner (1:scale)
  const [cutHeight, setCutHeight] = useState(1.1); // Schnitthöhe (Grundriss-Schnittebene)
  const [views, setViews] = useState([]); // Ausschnitte: [{id,name,type,level,scale,combo,cutHeight}]
  const [showMappe, setShowMappe] = useState(false);

  // ---- Editor-Zustand (ArchiCAD-Stil) ----
  const [tool, setTool] = useState("arrow"); // arrow | wall | column | window
  const [customWalls, setCustomWalls] = useState([]); // [{a,b,level,thickness,height,_idx}]
  const [customColumns, setCustomColumns] = useState([]); // [{x,z,level,size,_idx}]
  const [customWindows, setCustomWindows] = useState([]); // Öffnungen: [{wallIdx,u,typeId,kind,_idx}]
  const [envOpenings, setEnvOpenings] = useState([]); // Hüllwand-Öffnungen: [{level,edge,u,typeId,kind,_idx}]
  const [customZones, setCustomZones] = useState([]); // Räume: [{points:[{x,z}],level,name,_idx}]
  const [netzLayer, setNetzLayer] = useState(null); // Phase 41: TGA-Netz (netz_layer) read-only für den IFC-Export
  const [customSlabs, setCustomSlabs] = useState([]); // Decken: [{points,level,_idx}]
  const [customRoofs, setCustomRoofs] = useState([]); // Dächer: [{points,level,pitch,_idx}]
  const [sketchJson, setSketchJson] = useState(null); // PW-05: Sketch aus dem BIT Sketcher (read-only Overlay)
  const [winType, setWinType] = useState("double"); // aktueller Fenstertyp
  const [doorType, setDoorType] = useState("single"); // aktueller Türtyp
  const [draft, setDraft] = useState([]); // aktuelle Wand-Kette (Meter-Punkte)
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null); // {type,index}
  const [multiSel, setMultiSel] = useState([]); // Mehrfachauswahl aus Markierungsrahmen: [{type,index,...}]
  const [hint, setHint] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null); // {x,y,hit:{kind,id}}
  const [wallComp, setWallComp] = useState("single24"); // Standard-Aufbau für neue Wände
  const idRef = useRef(1);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const multiSelRef = useRef(multiSel); multiSelRef.current = multiSel;
  const [showShortcuts, setShowShortcuts] = useState(false); // Hilfe-Popover „Tastaturkürzel" (BIM-D)
  const [attrHidden, setAttrHidden] = useState(false); // Attribute-Panel per ✕ ausgeblendet (bis zur nächsten Auswahl)
  useEffect(() => { setAttrHidden(false); }, [selected, multiSel]);
  const [focus2d, setFocus2d] = useState(null); // Zoom-auf-Auswahl im 2D (BIM-C): {bbox,nonce} | {reset,nonce}
  // ---- Favoriten (BIM-F): Werkzeug+Aufbau/Typ-Kombis, lokal in localStorage (max 6, FIFO) ----
  const [favs, setFavs] = useState(() => { try { return JSON.parse(localStorage.getItem("nc-bim-favs") || "[]"); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem("nc-bim-favs", JSON.stringify(favs)); } catch { /* localStorage gesperrt/voll */ } }, [favs]);

  // ---- BIM 2.0: Modell-Persistenz je Projekt (Entität BimModel) ----
  // Laden beim Projektwechsel; Auto-Save (debounced) bei jeder Modelländerung.
  // Datensatz-Autorität ist useBimModelSync (KD-17): loadBimModel teilt EINEN
  // Request mit dem Hook, saveBimModel ist der einzige Schreibpfad. Dieser
  // Effekt schreibt ausschließlich die Elementfelder — die Programmfelder
  // (footprintM/storeys/storeyHeight/unit) schreibt allein der Hook.
  const [saveState, setSaveState] = useState("idle"); // idle | loading | saving | saved | error
  // Testlauf 26.08. (Referenzprojekt): Projekte OHNE gespeichertes Modell zeigten das
  // prozedurale Default-Klötzchen in Realitäts-Optik. Der Banner unten sagt
  // ehrlich, dass es Editor-Defaults sind, bis der Nutzer speichert.
  const [hatGespeichertesModell, setHatGespeichertesModell] = useState(true);
  const loadingRef = useRef(false);
  const projectId = project?.id || null;
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    loadingRef.current = true;
    setSaveState("loading");
    (async () => {
      try {
        const m = await loadBimModel(projectId);
        if (cancelled) return;
        setHatGespeichertesModell(!!m);
        if (m) {
          setCustomWalls(m.customWalls || []);
          setCustomColumns(m.customColumns || []);
          setCustomWindows(m.customWindows || []);
          setEnvOpenings(m.envOpenings || []);
          setCustomZones(m.customZones || []);
          setCustomSlabs(m.customSlabs || []);
          setCustomRoofs(m.customRoofs || []);
          if (m.envComposite !== undefined) setEnvComposite(m.envComposite);
          if (m.envThickness) setEnvThickness(m.envThickness);
          if (m.parapet) setParapet(m.parapet);
          if (m.dachform) setDachform(m.dachform);
          if (m.dachneigung != null) setDachneigung(m.dachneigung);
          if (m.entranceCfg) setEntranceCfg({ ...ENTRANCE_DEFAULT, ...m.entranceCfg });
          // PW-05: Sketch des Projekts (BIT Sketcher, Feld sketch_layer) —
          // read-only Anzeige im Grundriss; geschrieben wird NUR im Sketcher.
          setSketchJson(m.sketch_layer || null);
          // Phase 41: TGA-Netz für den IFC-Export (IfcPipe-/Duct-/CableSegment) — geschrieben wird es nur im Haustechnik-Reiter.
          setNetzLayer(m.netz_layer || null);
          // Programmfelder (footprintM/storeys/storeyHeight/unit) setzt der Hook
          // useBimModelSync in die gemeinsame Quelle — hier NICHT doppelt.
          // _idx-Zähler hinter die geladenen Elemente setzen (keine Kollisionen)
          const maxIdx = Math.max(0, ...[...(m.customWalls || []), ...(m.customColumns || []), ...(m.customWindows || []), ...(m.envOpenings || []), ...(m.customZones || []), ...(m.customSlabs || []), ...(m.customRoofs || [])].map((x) => x._idx || 0));
          idRef.current = maxIdx + 1;
        } else {
          // Neues Projekt ohne Modell: Editor leeren (kein Übertrag vom Vorprojekt)
          setCustomWalls([]); setCustomColumns([]); setCustomWindows([]); setEnvOpenings([]); setNetzLayer(null);
          setCustomZones([]); setCustomSlabs([]); setCustomRoofs([]);
          setSketchJson(null);
        }
        setSaveState("idle");
      } catch {
        if (!cancelled) setSaveState("error");
      } finally {
        // erst nach dem Render-Zyklus wieder speichern erlauben
        setTimeout(() => { loadingRef.current = false; }, 50);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId || loadingRef.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        // Nur Elementfelder — Programmfelder gehören dem Hook (EIN Schreiber je Feld).
        await saveBimModel(projectId, {
          envComposite, envThickness, parapet, dachform, dachneigung, entranceCfg,
          customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs,
        });
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 1200);
    return () => clearTimeout(t);
  }, [projectId, envComposite, envThickness, parapet, dachform, dachneigung, entranceCfg, customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs]);

  // ---- Ebenen (Layers) ----
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [combo, setCombo] = useState("Alle zeigen");
  const [showLayers, setShowLayers] = useState(true);
  const layersRef = useRef(layers); layersRef.current = layers;
  const layerVis = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.visible])), [layers]);
  const layerLocked = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.locked])), [layers]);
  const toggleLayer = (id, key) => { setLayers((ls) => ls.map((l) => l.id === id ? { ...l, [key]: !l[key] } : l)); setCombo("Eigene"); };
  const applyCombo = (name) => {
    setCombo(name);
    const on = new Set(LAYER_COMBOS[name] || []);
    setLayers((ls) => ls.map((l) => ({ ...l, visible: on.has(l.id) })));
  };

  // Footprint: gezeichnetes Polygon (designated_areas) → Meter, sonst Default.
  const drawn = (complexData?.designated_areas || []).find((a) => Array.isArray(a?.points) && a.points.length >= 3);
  const footprintM = drawn ? footprintToMeters(drawn.points, complexData?.site_parcel) : null;

  // Effektiver Grundriss: editiert > gezeichnet > Default.
  const footprint = footprintEdit || footprintM;
  // Gemeinsames Modell — Single Source of Truth für 3D UND 2D (Grundriss/Schnitt).
  const model = useMemo(
    () => createBuildingModel({ footprintM: footprint, storeys, storeyHeight, parapet, wallThickness: envThickness, wallComposite: envComposite }),
    [footprint, storeys, storeyHeight, parapet, envThickness, envComposite],
  );

  // PW-05: Sketch des Projekts (BIT Sketcher) als read-only Grundriss-Overlay.
  // Kein Solver nötig — nur Anzeige der gespeicherten Geometrie.
  const sketchObj = useMemo(() => {
    if (!sketchJson) return null;
    try {
      const s = Sketch.deserialize(sketchJson);
      return s.points.size || s.circles.size ? s : null;
    } catch {
      return null; // korrupter Stand → Overlay weglassen statt crashen
    }
  }, [sketchJson]);
  // Sketch-Punkte in Plan-Koordinaten (Y-Flip) für die BBox-Erweiterung.
  const sketchBounds = useMemo(
    () => (sketchObj ? [...sketchObj.points.values()].map((p) => ({ x: p.x, z: -p.y })) : undefined),
    [sketchObj]
  );

  // ---- Sketch-Editing direkt im Grundriss (Phase 34-05, PW-05 Ausbau) ----
  // Mutable Sketch-Instanz + Solver nur im Edit-Modus; geschrieben wird über
  // saveBimModel ins Feld sketch_layer — derselbe Pfad wie der BIT Sketcher
  // (nie gleichzeitig gemountet: eigene Route vs. dieser Tab). runSolve ist
  // synchron, daher keine Solver-Reentranz; solver.js NUR lazy (LGPL-Chunk).
  const [sketchEdit, setSketchEdit] = useState(false);
  const [sketchTool, setSketchTool] = useState("line"); // line | select
  const [sketchDraft, setSketchDraft] = useState(null); // Linienzug-Draft (Sketch-Koord.)
  const [sketchVersion, setSketchVersion] = useState(0);
  const [sketchSolve, setSketchSolve] = useState(null);
  const [sketchSolverStatus, setSketchSolverStatus] = useState("aus");
  const sketchEditRef = useRef(null);
  const sketchSolverRef = useRef(null);
  // Review-Fixes 34-05: die Instanz gehört zu GENAU EINEM Projekt, und
  // geschrieben wird nur, was sich gegenüber dem geladenen Stand geändert hat.
  const sketchProjektRef = useRef(null); // projectId, zu dem sketchEditRef gehört
  const lastSavedSketchRef = useRef(null); // JSON-String des zuletzt geladenen/gespeicherten Stands

  const resolveSketch = (extra = []) => {
    if (sketchSolverRef.current && sketchEditRef.current) {
      setSketchSolve(runSolve(sketchSolverRef.current, sketchEditRef.current, { extraConstraints: extra }));
    }
    setSketchVersion((v) => v + 1);
  };

  // Ungespeicherte Sketch-Änderungen JETZT schreiben (Modus-Ende, Tab-Wechsel,
  // Projektwechsel) — nur bei echter Änderung gegenüber lastSaved (Review-Fix:
  // das bloße Betreten des Modus darf keinen Write auslösen).
  const flushSketch = (pid) => {
    if (!pid || !sketchEditRef.current || sketchProjektRef.current !== pid) return;
    const json = sketchEditRef.current.serialize();
    const sig = JSON.stringify(json);
    if (sig === lastSavedSketchRef.current) return;
    lastSavedSketchRef.current = sig;
    saveBimModel(pid, { sketch_layer: json }).catch(() => {
      /* offline: nächster Flush/Persist versucht es erneut */
    });
    if (pid === projectId) setSketchJson(json);
  };
  const flushSketchRef = useRef(null);
  flushSketchRef.current = flushSketch;

  const startSketchEdit = async () => {
    // Review-Fix (Race): Instanz IMMER aus dem GELADENEN Stand des aktuellen
    // Projekts aufbauen (loadBimModel ist gecacht und save-kohärent) — nie aus
    // einem evtl. noch nicht geladenen sketchJson oder einer Fremd-Instanz.
    if (!sketchEditRef.current || sketchProjektRef.current !== projectId) {
      let quelle = null;
      try {
        const m = projectId ? await loadBimModel(projectId) : null;
        quelle = m?.sketch_layer || null;
      } catch {
        quelle = sketchJson; // offline: bester bekannter Stand
      }
      try {
        sketchEditRef.current = quelle ? Sketch.deserialize(quelle) : new Sketch();
      } catch {
        sketchEditRef.current = new Sketch();
      }
      sketchProjektRef.current = projectId;
      lastSavedSketchRef.current = JSON.stringify(sketchEditRef.current.serialize());
    }
    setSketchEdit(true);
    setView("grundriss");
    setSketchDraft(null);
    if (!sketchSolverRef.current) {
      setSketchSolverStatus("lädt…");
      try {
        const m = await import("@sketch/lib/solver.js"); // lazy — LGPL-Chunk-Trennung!
        sketchSolverRef.current = await m.getSolver();
        setSketchSolverStatus("bereit");
      } catch (e) {
        setSketchSolverStatus(`Fehler: ${e.message}`);
      }
    }
    resolveSketch();
  };
  const stopSketchEdit = () => {
    flushSketch(projectId); // Review-Fix: letzter Stand darf nicht im Debounce sterben
    setSketchEdit(false);
    setSketchDraft(null);
  };

  // Projektwechsel/Unmount: erst den ALTEN Stand flushen (Closure hält die
  // alte projectId), dann die Instanz verwerfen — sonst schriebe der Debounce
  // den Sketch von Projekt A nach Projekt B (Review-Befund, critical).
  useEffect(() => {
    return () => {
      flushSketchRef.current?.(projectId);
      sketchEditRef.current = null;
      sketchProjektRef.current = null;
      lastSavedSketchRef.current = null;
      setSketchEdit(false);
      setSketchVersion(0);
      setSketchSolve(null);
      setSketchDraft(null);
    };
  }, [projectId]);

  // Mutationen (Muster SketchStudio): Linienzug + Solver-Drag.
  const sketchEndpunkt = (spec) =>
    spec.pointId ? spec.pointId : sketchEditRef.current.addPoint(spec.x, spec.y).id;
  const sketchAddSegment = (startSpec, endSpec, autoConstraint) => {
    const sk = sketchEditRef.current;
    const p1 = sketchEndpunkt(startSpec);
    if (endSpec.pointId === p1) return p1;
    const start = sk.points.get(p1);
    if (endSpec.pointId == null && start && endSpec.x === start.x && endSpec.y === start.y) return p1;
    const p2 = sketchEndpunkt(endSpec);
    if (autoConstraint === "horizontal") sk.points.get(p2).y = sk.points.get(p1).y;
    if (autoConstraint === "vertical") sk.points.get(p2).x = sk.points.get(p1).x;
    const { id } = sk.addLine(p1, p2);
    if (autoConstraint) sk.addConstraint({ type: autoConstraint, line: id });
    resolveSketch();
    return p2;
  };
  const sketchDragPoint = (pointId, x, y) => {
    if (!sketchSolverRef.current) {
      const p = sketchEditRef.current.points.get(pointId);
      if (p) {
        p.x = x;
        p.y = y;
      }
      setSketchVersion((v) => v + 1);
      return;
    }
    resolveSketch([{ type: "drag", point: pointId, x, y }]);
  };

  // Persistenz: debounced über saveBimModel (Feld sketch_layer) + lokalen
  // sketchJson-Stand nachziehen, damit die read-only Anzeige aktuell bleibt.
  // Guards (Review-Fixes): nur für die Projekt-eigene Instanz, nur bei echter
  // Änderung gegenüber lastSaved (Modus-Eintritt allein schreibt nichts).
  useEffect(() => {
    if (!sketchEdit || sketchVersion === 0 || !projectId) return undefined;
    if (!sketchEditRef.current || sketchProjektRef.current !== projectId) return undefined;
    const t = setTimeout(async () => {
      try {
        const json = sketchEditRef.current.serialize();
        const sig = JSON.stringify(json);
        if (sig === lastSavedSketchRef.current) return;
        await saveBimModel(projectId, { sketch_layer: json });
        lastSavedSketchRef.current = sig;
        setSketchJson(json);
      } catch {
        /* offline: nächste Änderung versucht es erneut */
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchVersion, sketchEdit, projectId]);

  // Edit-Modus: Bounds live aus der editierten Instanz.
  const sketchEditBounds = useMemo(() => {
    if (!sketchEdit || !sketchEditRef.current) return undefined;
    return [...sketchEditRef.current.points.values()].map((p) => ({ x: p.x, z: -p.y }));
  }, [sketchEdit, sketchVersion]);

  // Regel-Öffnungen der Hülle (Auto-Fenster je ~3,5 m + Eingangstür) — EINE
  // Quelle für 3D und IFC-Export, damit Modell und Export nicht auseinandergehen
  // (KD-16). Benutzerplatzierte Öffnungen verdrängen das Auto-Fenster an
  // derselben Stelle (keine überlappenden Löcher/Voids).
  const placedEnv = useMemo(
    () => envOpenings.map((o) => ({ level: o.level, edge: o.edge, u: o.u, width: openingTypeById(o.kind, o.typeId).w })),
    [envOpenings],
  );
  const autoOpenings = useMemo(
    () => autoEnvOpenings(model.walls, { entrance: entranceCfg }, placedEnv),
    [model, entranceCfg, placedEnv],
  );

  // ---- Werkzeug wählen ----
  const FUNCTIONAL = ["arrow", "wall", "column", "window", "door", "zone", "slab", "roof", "section"]; // bereits aktiv
  const selectTool = (id) => {
    setSelected(null); setMultiSel([]); setDraft([]); setHover(null); setHint("");
    if (id === "section") { setView("schnitt"); setTool("arrow"); return; }
    if (!FUNCTIONAL.includes(id)) { setHint(`Werkzeug „${id}" kommt in einer späteren Welle.`); return; }
    setTool(id);
    if (id !== "arrow" && view === "3d") setView("grundriss"); // Zeichnen passiert im Grundriss
  };

  // Werkzeugpalette (ArchiCAD-Stil)
  const PALETTE = [
    { group: null, items: [{ id: "arrow", label: "Pfeil", icon: MousePointer2 }] },
    { group: "Design", items: [
      { id: "wall", label: "Wand", icon: RectangleHorizontal },
      { id: "column", label: "Stütze", icon: Columns3 },
      { id: "slab", label: "Decke", icon: Square },
      { id: "roof", label: "Dach", icon: Triangle },
      { id: "door", label: "Tür", icon: DoorOpen },
      { id: "window", label: "Fenster", icon: AppWindow },
      { id: "zone", label: "Zone", icon: Frame },
    ] },
    { group: "Viewpoint", items: [
      { id: "section", label: "Schnitt", icon: Scissors },
      { id: "elevation", label: "Ansicht", icon: Eye },
    ] },
    { group: "Document", items: [
      { id: "dimension", label: "Bemaßung", icon: Ruler },
      { id: "text", label: "Text", icon: Type },
      { id: "line", label: "Linie", icon: PenLine },
    ] },
  ];

  // ---- Zeichen-Interaktion aus dem Grundriss ----
  const onPoint = (p) => {
    if (!p) return;
    if (tool === "wall" && layerLocked.walls) { setHint("Ebene Wände ist gesperrt."); return; }
    if (tool === "column" && layerLocked.columns) { setHint("Ebene Stützen ist gesperrt."); return; }
    if (tool === "wall") {
      setDraft((d) => {
        if (d.length === 0) return [p];
        const a = d[d.length - 1];
        if (Math.hypot(p.x - a.x, p.z - a.z) < 0.05) return d; // Doppelklick-Schutz
        setCustomWalls((ws) => [...ws, { a, b: p, level: Math.min(planLevel, storeys - 1), thickness: 0.3, height: storeyHeight, refLine: wallRef, composite: wallComp, _idx: idRef.current++ }]);
        return [...d, p];
      });
    } else if (tool === "column") {
      setCustomColumns((cs) => [...cs, { x: p.x, z: p.z, level: Math.min(planLevel, storeys - 1), size: 0.4, _idx: idRef.current++ }]);
    } else if (tool === "zone") {
      // Raum automatisch aus den umgebenden Wänden erkennen (ein Klick hinein)
      const lvl = Math.min(planLevel, storeys - 1);
      const segs = [];
      model.walls.filter((w) => w.level === lvl).forEach((w) => segs.push([w.a, w.b]));
      customWalls.filter((w) => w.level === lvl).forEach((w) => segs.push([w.a, w.b]));
      const poly = detectRoom(p, segs);
      if (poly && polyAreaXZ(poly) > 0.5) {
        setCustomZones((zs) => [...zs, { points: poly, level: lvl, name: `Raum ${zs.length + 1}`, _idx: idRef.current++ }]);
      } else {
        setHint("Kein geschlossener Raum erkannt — in eine von Wänden umschlossene Fläche klicken.");
      }
    } else if (tool === "slab" || tool === "roof") {
      // Polygon: Punkte sammeln (Abschluss per Doppelklick → onFinish)
      setDraft((d) => (d.length && Math.hypot(p.x - d[d.length - 1].x, p.z - d[d.length - 1].z) < 0.05 ? d : [...d, p]));
    } else if (tool === "window" || tool === "door") {
      // Fenster/Tür auf das nächstgelegene Wandsegment setzen
      const kind = tool;
      const typeId = kind === "door" ? doorType : winType;
      const ty = openingTypeById(kind, typeId);
      const lvl = Math.min(planLevel, storeys - 1);
      let best = null, bestD = 1e9;
      // gezeichnete Wände
      customWalls.forEach((w) => {
        const pr = projectPointToSeg(p, w.a, w.b);
        if (pr.dist < bestD) { bestD = pr.dist; best = { scope: "custom", w, u: pr.t * pr.len, len: pr.len }; }
      });
      // Hüllwände des aktuellen Geschosses
      model.walls.filter((w) => w.level === lvl).forEach((w) => {
        const pr = projectPointToSeg(p, w.a, w.b);
        if (pr.dist < bestD) { bestD = pr.dist; best = { scope: "env", w, u: pr.t * pr.len, len: pr.len }; }
      });
      if (best && bestD < 1.2) {
        const half = ty.w / 2;
        const u = Math.max(half + 0.1, Math.min(best.u, best.len - half - 0.1));
        if (best.scope === "custom") setCustomWindows((ws) => [...ws, { wallIdx: best.w._idx, u, typeId, kind, _idx: idRef.current++ }]);
        else setEnvOpenings((es) => [...es, { level: best.w.level, edge: best.w.edge, u, typeId, kind, _idx: idRef.current++ }]);
      } else { setHint("Kein Wandsegment in der Nähe."); }
    }
  };
  const onFinish = () => {
    const lvl = Math.min(planLevel, storeys - 1);
    if (draft.length >= 3) {
      const pts = draft.map((p) => ({ x: p.x, z: p.z }));
      if (tool === "zone") setCustomZones((zs) => [...zs, { points: pts, level: lvl, name: `Raum ${zs.length + 1}`, _idx: idRef.current++ }]);
      else if (tool === "slab") setCustomSlabs((ss) => [...ss, { points: pts, level: lvl, _idx: idRef.current++ }]);
      else if (tool === "roof") setCustomRoofs((rs) => [...rs, { points: pts, level: lvl, pitch: 2.5, _idx: idRef.current++ }]);
    }
    setDraft([]); setHover(null);
  };
  // Elementtypen der Custom-Arrays (mehrfachauswahl-, dupliziert- und nudgefähig)
  const CUSTOM_TYPES = ["wall", "column", "opening", "zone", "slab", "roof"];
  // Aktuelle Auswahl als Liste (Marquee/Shift-Mehrfachauswahl ODER Einzelauswahl)
  const currentSelection = () =>
    multiSel.length ? multiSel : (selected && CUSTOM_TYPES.includes(selected.type) ? [selected] : []);
  // Auswahl anwenden: Einzel-Klick ersetzt, Shift+Klick (additive) toggelt in der Mehrfachauswahl (BIM-B)
  const applySelection = (sel, additive) => {
    if (additive && sel && CUSTOM_TYPES.includes(sel.type)) {
      const cur = [...currentSelection()];
      const i = cur.findIndex((m) => m.type === sel.type && m.index === sel.index);
      if (i >= 0) cur.splice(i, 1); else cur.push({ type: sel.type, index: sel.index, scope: sel.scope });
      if (cur.length === 1) { setSelected(cur[0]); setMultiSel([]); }
      else { setSelected(null); setMultiSel(cur); }
      setHint(cur.length > 1 ? `${cur.length} ausgewählt — Shift+Klick erweitert/reduziert` : "");
      return;
    }
    setMultiSel([]); setSelected(sel);
  };
  const onPick = (sel, additive) => {
    const layerId = { wall: "walls", zone: "zones", slab: "shell", roof: "attika", hullwall: "shell", autowin: "openings", opening: "openings", column: "columns" }[sel.type] || "walls";
    if (layerLocked[layerId]) { setHint(`Ebene gesperrt — Auswahl nicht möglich.`); return; }
    applySelection(sel, additive);
  };
  // Markierungsrahmen-Auswahl (mehrere Custom-Elemente)
  const onMarquee = (list) => { setSelected(null); setMultiSel(list); setHint(list.length ? `${list.length} Objekt(e) ausgewählt — Entf löscht` : "Nichts im Rahmen"); };
  const onClear = () => { setSelected(null); setMultiSel([]); setHint(""); };
  const deleteMany = (list) => {
    const ids = (t) => new Set(list.filter((m) => m.type === t).map((m) => m.index));
    const w = ids("wall"); if (w.size) setCustomWalls((a) => a.filter((x) => !w.has(x._idx)));
    const c = ids("column"); if (c.size) setCustomColumns((a) => a.filter((x) => !c.has(x._idx)));
    const o = new Set(list.filter((m) => m.type === "opening").map((m) => m.index));
    if (o.size) { setCustomWindows((a) => a.filter((x) => !o.has(x._idx))); setEnvOpenings((a) => a.filter((x) => !o.has(x._idx))); }
    const z = ids("zone"); if (z.size) setCustomZones((a) => a.filter((x) => !z.has(x._idx)));
    const s = ids("slab"); if (s.size) setCustomSlabs((a) => a.filter((x) => !s.has(x._idx)));
    const r = ids("roof"); if (r.size) setCustomRoofs((a) => a.filter((x) => !r.has(x._idx)));
    setMultiSel([]);
  };
  // Polygon-Eckpunkt verschieben (Zone/Decke/Dach) — „alles hat Griffe"
  const onMovePolyVert = (which, idx, vi, p) => {
    const sn = { x: snap(p.x), z: snap(p.z) };
    const upd = (arr) => arr.map((o) => o._idx === idx ? { ...o, points: o.points.map((pt, i) => (i === vi ? sn : pt)) } : o);
    if (which === "zone") setCustomZones(upd);
    else if (which === "slab") setCustomSlabs(upd);
    else if (which === "roof") setCustomRoofs(upd);
  };
  // Hüllwand-Griffe: Footprint-Eckpunkt verschieben bzw. ganze Kante (alle Geschosse).
  const onMoveFootVert = (vi, p) => {
    const base = footprintEdit || model.footprint;
    setFootprintEdit(base.map((q, i) => (i === vi ? { x: snap(p.x), z: snap(p.z) } : { x: q.x, z: q.z })));
  };
  const onMoveFootEdge = (edge, dpt) => {
    const base = footprintEdit || model.footprint; const n = base.length;
    const i1 = edge, i2 = (edge + 1) % n;
    setFootprintEdit(base.map((q, i) => (i === i1 || i === i2) ? { x: snap(q.x + dpt.x), z: snap(q.z + dpt.z) } : { x: q.x, z: q.z }));
  };
  // Footprint-Eckpunkt einfügen (Doppelklick Kantengriff) bzw. löschen (Doppelklick Eckgriff).
  const onInsertFootVert = (edge) => {
    const base = footprintEdit || model.footprint; const n = base.length;
    const a = base[edge], b = base[(edge + 1) % n];
    const next = base.map((q) => ({ x: q.x, z: q.z }));
    next.splice(edge + 1, 0, { x: snap((a.x + b.x) / 2), z: snap((a.z + b.z) / 2) });
    setFootprintEdit(next);
    setHint("Eckpunkt eingefügt — Griffe ziehen für freie Form");
  };
  const onDeleteFootVert = (vi) => {
    const base = footprintEdit || model.footprint;
    if (base.length <= 3) { setHint("Mindestens 3 Eckpunkte nötig"); return; }
    setFootprintEdit(base.filter((_, i) => i !== vi).map((q) => ({ x: q.x, z: q.z })));
    setHint("Eckpunkt gelöscht");
  };
  // ---- Griffe: Elemente per Ziehen verschieben ----
  const snap = (v) => Math.round(v / 0.25) * 0.25;
  const onMoveWallPt = (idx, end, p) => setCustomWalls((ws) => ws.map((w) => w._idx === idx ? { ...w, [end]: { x: snap(p.x), z: snap(p.z) } } : w));
  const onMoveWall = (idx, dpt) => setCustomWalls((ws) => ws.map((w) => w._idx === idx ? { ...w, a: { x: snap(w.a.x + dpt.x), z: snap(w.a.z + dpt.z) }, b: { x: snap(w.b.x + dpt.x), z: snap(w.b.z + dpt.z) } } : w));
  const onMoveColumn = (idx, p) => setCustomColumns((cs) => cs.map((c) => c._idx === idx ? { ...c, x: snap(p.x), z: snap(p.z) } : c));
  // Referenzlinie ändern (für Auswahl bzw. neue Wände)
  const setWallRefLine = (rl) => {
    setWallRef(rl);
    if (selected?.type === "wall") setCustomWalls((ws) => ws.map((w) => w._idx === selected.index ? { ...w, refLine: rl } : w));
  };
  // Wand-Aufbau (Composite) ändern (für Auswahl bzw. neue Wände)
  const setWallComposite = (cid, idx) => {
    if (idx == null) setWallComp(cid);
    const target = idx != null ? idx : (selected?.type === "wall" ? selected.index : null);
    if (target != null) setCustomWalls((ws) => ws.map((w) => w._idx === target ? { ...w, composite: cid } : w));
  };
  // Aktion aus dem 3D-Kontextmenü
  const ctxDelete = () => {
    const h = ctxMenu?.hit; if (!h) return;
    if (h.kind === "wall") setCustomWalls((ws) => ws.filter((w) => w._idx !== h.id));
    if (h.kind === "column") setCustomColumns((cs) => cs.filter((c) => c._idx !== h.id));
    if ((h.kind === "window" || h.kind === "door") && h.id != null) {
      if (h.scope === "env") setEnvOpenings((os) => os.filter((o) => o._idx !== h.id));
      else setCustomWindows((os) => os.filter((o) => o._idx !== h.id));
    }
    if (h.kind === "zone" && h.id != null) setCustomZones((zs) => zs.filter((z) => z._idx !== h.id));
    if (h.kind === "cslab" && h.id != null) setCustomSlabs((ss) => ss.filter((s) => s._idx !== h.id));
    if (h.kind === "croof" && h.id != null) setCustomRoofs((rs) => rs.filter((r) => r._idx !== h.id));
    setSelected(null); setCtxMenu(null);
  };
  const deleteSelected = () => {
    if (!selected) return;
    if (selected.type === "wall") setCustomWalls((ws) => ws.filter((w) => w._idx !== selected.index));
    if (selected.type === "column") setCustomColumns((cs) => cs.filter((c) => c._idx !== selected.index));
    if (selected.type === "opening") {
      if (selected.scope === "env") setEnvOpenings((os) => os.filter((o) => o._idx !== selected.index));
      else setCustomWindows((os) => os.filter((o) => o._idx !== selected.index));
    }
    if (selected.type === "zone") setCustomZones((zs) => zs.filter((z) => z._idx !== selected.index));
    if (selected.type === "slab") setCustomSlabs((ss) => ss.filter((s) => s._idx !== selected.index));
    if (selected.type === "roof") setCustomRoofs((rs) => rs.filter((r) => r._idx !== selected.index));
    setSelected(null);
  };
  // ---- Properties: Felder des ausgewählten Objekts ändern ----
  const patchWall = (idx, p) => setCustomWalls((ws) => ws.map((w) => w._idx === idx ? { ...w, ...p } : w));
  const patchColumn = (idx, p) => setCustomColumns((cs) => cs.map((c) => c._idx === idx ? { ...c, ...p } : c));
  const patchZone = (idx, p) => setCustomZones((zs) => zs.map((z) => z._idx === idx ? { ...z, ...p } : z));
  const patchSlab = (idx, p) => setCustomSlabs((ss) => ss.map((s) => s._idx === idx ? { ...s, ...p } : s));
  const patchRoof = (idx, p) => setCustomRoofs((rs) => rs.map((r) => r._idx === idx ? { ...r, ...p } : r));
  const patchOpening = (idx, scope, p) => {
    const set = scope === "env" ? setEnvOpenings : setCustomWindows;
    set((os) => os.map((o) => o._idx === idx ? { ...o, ...p } : o));
  };

  // Öffnung entlang ihrer Wand verschieben (u aktualisieren)
  const onMoveOpening = (idx, p) => setCustomWindows((os) => os.map((o) => {
    if (o._idx !== idx) return o;
    const w = customWalls.find((x) => x._idx === o.wallIdx); if (!w) return o;
    const pr = projectPointToSeg(p, w.a, w.b);
    const ty = openingTypeById(o.kind, o.typeId); const half = ty.w / 2;
    const u = Math.max(half + 0.1, Math.min(pr.t * pr.len, pr.len - half - 0.1));
    return { ...o, u };
  }));
  const undoLast = () => {
    // letzte gezeichnete Wand bzw. Stütze entfernen (nach _idx)
    const lastW = customWalls[customWalls.length - 1];
    const lastC = customColumns[customColumns.length - 1];
    if ((lastW?._idx || 0) >= (lastC?._idx || 0) && lastW) setCustomWalls((ws) => ws.slice(0, -1));
    else if (lastC) setCustomColumns((cs) => cs.slice(0, -1));
  };
  const clearCustom = () => { setCustomWalls([]); setCustomColumns([]); setCustomWindows([]); setEnvOpenings([]); setCustomZones([]); setCustomSlabs([]); setCustomRoofs([]); setDraft([]); setSelected(null); setMultiSel([]); };

  // ---- BIM-A: Duplizieren (+1 m Versatz) — neue _idx via idRef, Auto-Save greift über die Setter ----
  const duplicateItems = (list) => {
    if (!list.length) return;
    const OFF = 1; // Versatz in Metern
    const newSel = [];
    const wallMap = new Map(); // alte Wand-_idx -> neue _idx (Öffnungen wandern mit)
    const newWalls = [], newCols = [], newZones = [], newSlabs = [], newRoofs = [], newWins = [], newEnvs = [];
    const shiftPts = (pts) => pts.map((p) => ({ x: p.x + OFF, z: p.z + OFF }));
    list.forEach((m) => {
      if (m.type === "wall") {
        const w = customWalls.find((x) => x._idx === m.index); if (!w) return;
        const nIdx = idRef.current++; wallMap.set(w._idx, nIdx);
        newWalls.push({ ...w, a: { x: w.a.x + OFF, z: w.a.z + OFF }, b: { x: w.b.x + OFF, z: w.b.z + OFF }, _idx: nIdx });
        newSel.push({ type: "wall", index: nIdx });
      } else if (m.type === "column") {
        const c = customColumns.find((x) => x._idx === m.index); if (!c) return;
        const nIdx = idRef.current++;
        newCols.push({ ...c, x: c.x + OFF, z: c.z + OFF, _idx: nIdx });
        newSel.push({ type: "column", index: nIdx });
      } else if (m.type === "zone" || m.type === "slab" || m.type === "roof") {
        const arr = m.type === "zone" ? customZones : m.type === "slab" ? customSlabs : customRoofs;
        const o = arr.find((x) => x._idx === m.index); if (!o?.points) return;
        const nIdx = idRef.current++;
        const copy = { ...o, points: shiftPts(o.points), _idx: nIdx };
        if (m.type === "zone") { copy.name = `${o.name || "Raum"} (Kopie)`; newZones.push(copy); }
        else if (m.type === "slab") newSlabs.push(copy);
        else newRoofs.push(copy);
        newSel.push({ type: m.type, index: nIdx });
      }
    });
    // Öffnungen: einzeln ausgewählte kopieren (u+1 m auf derselben Wand, geklemmt)
    list.filter((m) => m.type === "opening").forEach((m) => {
      const scope = m.scope || "custom";
      if (scope === "env") {
        const o = envOpenings.find((x) => x._idx === m.index); if (!o) return;
        const nIdx = idRef.current++;
        newEnvs.push({ ...o, u: o.u + OFF, _idx: nIdx });
        newSel.push({ type: "opening", index: nIdx, scope: "env" });
      } else {
        const o = customWindows.find((x) => x._idx === m.index); if (!o) return;
        const nIdx = idRef.current++;
        const onCopiedWall = wallMap.has(o.wallIdx);
        const w = customWalls.find((x) => x._idx === o.wallIdx);
        const len = w ? Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) : 0;
        const half = (openingTypeById(o.kind, o.typeId)?.w || 1) / 2;
        const u = onCopiedWall ? o.u : Math.max(half + 0.1, Math.min(o.u + OFF, Math.max(half + 0.1, len - half - 0.1)));
        newWins.push({ ...o, wallIdx: onCopiedWall ? wallMap.get(o.wallIdx) : o.wallIdx, u, _idx: nIdx });
        newSel.push({ type: "opening", index: nIdx, scope: "custom" });
      }
    });
    // Öffnungen auf duplizierten Wänden mitkopieren (auch wenn nicht einzeln ausgewählt)
    if (wallMap.size) customWindows.forEach((o) => {
      if (wallMap.has(o.wallIdx) && !list.some((m) => m.type === "opening" && (m.scope || "custom") === "custom" && m.index === o._idx)) {
        newWins.push({ ...o, wallIdx: wallMap.get(o.wallIdx), _idx: idRef.current++ });
      }
    });
    if (newWalls.length) setCustomWalls((a) => [...a, ...newWalls]);
    if (newCols.length) setCustomColumns((a) => [...a, ...newCols]);
    if (newZones.length) setCustomZones((a) => [...a, ...newZones]);
    if (newSlabs.length) setCustomSlabs((a) => [...a, ...newSlabs]);
    if (newRoofs.length) setCustomRoofs((a) => [...a, ...newRoofs]);
    if (newWins.length) setCustomWindows((a) => [...a, ...newWins]);
    if (newEnvs.length) setEnvOpenings((a) => [...a, ...newEnvs]);
    if (newSel.length === 1) { setSelected(newSel[0]); setMultiSel([]); }
    else if (newSel.length) { setSelected(null); setMultiSel(newSel); }
    if (newSel.length) setHint(`${newSel.length} Objekt(e) dupliziert (+1 m) — Pfeiltasten verschieben`);
  };
  const duplicateSelection = () => duplicateItems(currentSelection());
  // Duplizieren aus dem 3D-Kontextmenü
  const ctxDuplicate = () => {
    const h = ctxMenu?.hit;
    const type = h ? { wall: "wall", column: "column", zone: "zone", cslab: "slab", croof: "roof", window: "opening", door: "opening" }[h.kind] : null;
    if (type && h.id != null) duplicateItems([{ type, index: h.id, scope: h.scope || "custom" }]);
    setCtxMenu(null);
  };

  // ---- BIM-A: Nudge — Auswahl per Pfeiltasten verschieben (0,1 m; Shift = 1 m) ----
  const nudgeSelection = (dx, dz) => {
    const list = currentSelection(); if (!list.length) return false;
    const rnd = (v) => Math.round(v * 1000) / 1000; // FP-Drift bei 0,1er-Schritten vermeiden
    const ids = (t) => new Set(list.filter((m) => m.type === t).map((m) => m.index));
    let moved = false;
    const w = ids("wall"); if (w.size) { moved = true; setCustomWalls((a) => a.map((x) => w.has(x._idx) ? { ...x, a: { x: rnd(x.a.x + dx), z: rnd(x.a.z + dz) }, b: { x: rnd(x.b.x + dx), z: rnd(x.b.z + dz) } } : x)); }
    const c = ids("column"); if (c.size) { moved = true; setCustomColumns((a) => a.map((x) => c.has(x._idx) ? { ...x, x: rnd(x.x + dx), z: rnd(x.z + dz) } : x)); }
    const movePts = (setter, set) => setter((a) => a.map((x) => set.has(x._idx) ? { ...x, points: x.points.map((p) => ({ x: rnd(p.x + dx), z: rnd(p.z + dz) })) } : x));
    const z = ids("zone"); if (z.size) { moved = true; movePts(setCustomZones, z); }
    const s = ids("slab"); if (s.size) { moved = true; movePts(setCustomSlabs, s); }
    const r = ids("roof"); if (r.size) { moved = true; movePts(setCustomRoofs, r); }
    return moved;
  };

  // ---- BIM-C: BBox der Auswahl (Meter, inkl. Höhen für das 3D-Target) ----
  const selectionBBox = () => {
    const list = currentSelection(); if (!list.length) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    const add = (x, z, y0 = 0, y1 = 0) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
    };
    list.forEach((m) => {
      if (m.type === "wall") {
        const w = customWalls.find((x) => x._idx === m.index); if (!w) return;
        const y0 = (w.level || 0) * storeyHeight;
        add(w.a.x, w.a.z, y0, y0 + (w.height || storeyHeight)); add(w.b.x, w.b.z, y0, y0 + (w.height || storeyHeight));
      } else if (m.type === "column") {
        const cc = customColumns.find((x) => x._idx === m.index); if (!cc) return;
        const y0 = (cc.level || 0) * storeyHeight, h = (cc.size || 0.4) / 2;
        add(cc.x - h, cc.z - h, y0, y0 + storeyHeight); add(cc.x + h, cc.z + h, y0, y0 + storeyHeight);
      } else if (m.type === "opening") {
        const scope = m.scope || "custom";
        const o = (scope === "env" ? envOpenings : customWindows).find((x) => x._idx === m.index); if (!o) return;
        const w = scope === "env" ? model.walls.find((x) => x.level === o.level && x.edge === o.edge) : customWalls.find((x) => x._idx === o.wallIdx);
        if (!w) return;
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const y0 = (w.level || 0) * storeyHeight;
        add(w.a.x + ((w.b.x - w.a.x) / len) * o.u, w.a.z + ((w.b.z - w.a.z) / len) * o.u, y0, y0 + storeyHeight);
      } else {
        const arr = m.type === "zone" ? customZones : m.type === "slab" ? customSlabs : customRoofs;
        const o = arr.find((x) => x._idx === m.index); if (!o?.points) return;
        const y0 = (o.level || 0) * storeyHeight;
        const y1 = m.type === "roof" ? y0 + storeyHeight + (o.pitch || 2.5) : y0 + storeyHeight;
        o.points.forEach((p) => add(p.x, p.z, y0, y1));
      }
    });
    return isFinite(minX) ? { minX, maxX, minZ, maxZ, minY, maxY } : null;
  };
  // ---- BIM-C: Zoom auf Auswahl (F) — 2D via Fokus-Prop, 3D via Orbit-Target ----
  const zoomToSelection = () => {
    const bbSel = selectionBBox();
    if (!bbSel) { resetViewAll(); return; }
    if (view === "3d") {
      const t = three.current; if (!t.target) return;
      t.target.set((bbSel.minX + bbSel.maxX) / 2, (bbSel.minY + bbSel.maxY) / 2, (bbSel.minZ + bbSel.maxZ) / 2);
      const span = Math.max(bbSel.maxX - bbSel.minX, bbSel.maxZ - bbSel.minZ, bbSel.maxY - bbSel.minY, 4);
      orbit.current.radius = Math.max(20, Math.min(220, span * 2.5));
      orbit.current.touched = true;
    } else {
      setFocus2d({ bbox: { minX: bbSel.minX, maxX: bbSel.maxX, minZ: bbSel.minZ, maxZ: bbSel.maxZ }, nonce: Date.now() });
    }
  };
  // Ansicht zurücksetzen: 3D-Kamera aufs Gesamtmodell, 2D-Zoom/Pan auf 100 %
  const resetViewAll = () => {
    if (view === "3d") {
      const t = three.current; if (!t.target) return;
      const b = modelBBox(model);
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, b.height);
      t.target.set((b.minX + b.maxX) / 2, b.height / 2, (b.minZ + b.maxZ) / 2);
      orbit.current.radius = Math.max(35, span * 2.2);
    } else {
      setFocus2d({ reset: true, nonce: Date.now() });
    }
  };

  // ---- BIM-F: Exposé-Render (PNG 2×, Muster Phase 22 — synchron rendern → toDataURL → zurücksetzen) ----
  const exportExpose = () => { exportExposePng(three.current); setHint("Exposé-PNG (2×) heruntergeladen."); };

  // ---- BIM-F: Favoriten — {tool, composite, typeId} in localStorage nc-bim-favs (max 6, FIFO) ----
  // Ohne Argument: aktuelles Werkzeug (+ Aufbau/Typ); mit spec: vom Attribute-Panel (Stern) abgeleitet.
  const addFavorite = (spec) => {
    const t = spec?.tool || tool;
    if (!TOOL_NAMES[t]) { setHint("Erst ein Zeichen-Werkzeug wählen (z. B. Wand), dann ★ Favorit speichern."); return; }
    const composite = t === "wall" ? (spec ? (spec.composite || null) : wallComp) : null;
    const typeId = (t === "window" || t === "door") ? (spec ? (spec.typeId || null) : (t === "window" ? winType : doorType)) : null;
    const detail = composite ? (WALL_COMPOSITES.find((cp) => cp.id === composite)?.name || "")
      : typeId ? (openingTypeById(t, typeId)?.name || "") : "";
    const label = detail ? `${TOOL_NAMES[t]} · ${detail}` : TOOL_NAMES[t];
    setFavs((fs) => {
      const next = fs.filter((f) => !(f.tool === t && f.composite === composite && f.typeId === typeId));
      next.push({ tool: t, composite, typeId, label });
      while (next.length > 6) next.shift(); // max 6, ältester fliegt (FIFO)
      return next;
    });
    setHint(`Favorit gespeichert: ${label}`);
  };
  const applyFavorite = (f) => {
    selectTool(f.tool);
    if (f.tool === "wall" && f.composite) setWallComp(f.composite);
    if (f.tool === "window" && f.typeId) setWinType(f.typeId);
    if (f.tool === "door" && f.typeId) setDoorType(f.typeId);
    setHint(`Favorit aktiv: ${f.label}`);
  };

  // ---- BIM-E: Ziel der Attribute-Anzeige (Einzelauswahl bzw. letztes Element der Mehrfachauswahl) ----
  const attrSel = selected && CUSTOM_TYPES.includes(selected.type) ? selected : (multiSel.length ? multiSel[multiSel.length - 1] : null);
  // ---- BIM-B: Auswahl-Zähler für das „N ausgewählt"-Badge in der Statuszeile ----
  const selCount = multiSel.length || (selected && CUSTOM_TYPES.includes(selected.type) ? 1 : 0);

  // IFC-Export: gemeinsames Modell + gezeichnete Elemente -> .ifc herunterladen.
  // autoOpenings (Auto-Fenster + Eingangstür) gehen mit — 3D, Grundriss und IFC
  // zeigen dieselben Öffnungen (KD-16).
  const downloadIFC = () => {
    const meldungen = [];
    const ifc = exportIFC(model, {
      customWalls, customColumns, customWindows, envOpenings, autoOpenings,
      customZones, customSlabs, customRoofs, storeyHeight,
      netz: netzLayer, // Phase 41 (NETZ-05): Leitungen als Segment-Elemente
      projectName: project?.name || "BIT-Atelier",
      onWarn: (msg) => meldungen.push(msg),
    });
    // Nicht exportierbare Öffnungen offen benennen statt still zu schlucken.
    setHint(meldungen.length
      ? `IFC exportiert — ${meldungen.length} Öffnung(en) NICHT enthalten: ${meldungen[0]}${meldungen.length > 1 ? " …" : ""}`
      : "");
    const blob = new Blob([ifc], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(project?.name || "modell").replace(/[^\w-]+/g, "_")}.ifc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- Ausschnitt-Mappe (gespeicherte Ansichten) ----
  const applyView = (v) => {
    setView(v.type); if (v.type === "grundriss" && v.level != null) setPlanLevel(v.level);
    if (v.scale) setScale(v.scale);
    if (v.combo) applyCombo(v.combo);
    if (v.cutHeight != null) setCutHeight(v.cutHeight);
    setSelected(null);
  };
  const saveView = () => {
    const lvlName = model.storeys[Math.min(planLevel, storeys - 1)]?.name || "EG";
    const typeName = view === "schnitt" ? "Schnitt" : view === "3d" ? "3D" : `Grundriss ${lvlName}`;
    const name = `${typeName} · 1:${scale}`;
    setViews((vs) => [...vs, { id: idRef.current++, name, type: view, level: planLevel, scale, combo, cutHeight }]);
  };
  const deleteView = (id) => setViews((vs) => vs.filter((v) => v.id !== id));

  // ---- Plan-Output: aktuellen 2D-Plan als PDF ----
  const exportPlanPDF = async () => {
    if (view === "3d") { setHint("PDF-Plan nur aus Grundriss/Schnitt — bitte 2D-Ansicht wählen."); return; }
    const wrap = mountRef.current?.parentElement?.querySelector("svg");
    const svgEl = [...document.querySelectorAll("div")].find((d) => d.style.height === "520px" && d.className.includes("bg-slate-50"))?.querySelector("svg");
    const target = svgEl || wrap; if (!target) { setHint("Keine 2D-Zeichnung gefunden."); return; }
    try {
      const { jsPDF } = await import("jspdf");
      const xml = new XMLSerializer().serializeToString(target);
      const svg64 = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
      const vb = (target.getAttribute("viewBox") || "0 0 800 600").split(/\s+/).map(Number);
      const W = vb[2] || 800, H = vb[3] || 600;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = svg64; });
      const SCALE_PX = 2;
      const canvas = document.createElement("canvas"); canvas.width = W * SCALE_PX; canvas.height = H * SCALE_PX;
      const ctx2 = canvas.getContext("2d"); ctx2.fillStyle = "#ffffff"; ctx2.fillRect(0, 0, canvas.width, canvas.height);
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png");
      const landscape = W >= H;
      const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a3" });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const margin = 12, titleH = 16;
      const availW = pw - margin * 2, availH = ph - margin * 2 - titleH;
      const ar = W / H; let dw = availW, dh = dw / ar; if (dh > availH) { dh = availH; dw = dh * ar; }
      pdf.addImage(png, "PNG", (pw - dw) / 2, margin, dw, dh);
      // Schriftfeld
      pdf.setDrawColor(120); pdf.rect(margin, ph - margin - titleH, availW, titleH);
      pdf.setFontSize(12); pdf.setTextColor(20);
      pdf.text(`${project?.name || "BIT-Atelier"} — ${view === "schnitt" ? "Schnitt" : "Grundriss " + (model.storeys[Math.min(planLevel, storeys - 1)]?.name || "")}`, margin + 3, ph - margin - titleH + 7);
      pdf.setFontSize(9); pdf.setTextColor(80);
      pdf.text(`Maßstab 1:${scale}   ·   Ebenen: ${combo}   ·   BIT-Atelier`, margin + 3, ph - margin - titleH + 12);
      pdf.save(`${(project?.name || "plan").replace(/[^\w-]+/g, "_")}_${view}.pdf`);
    } catch (e) { setHint("PDF-Export fehlgeschlagen: " + (e?.message || e)); }
  };

  // ---- BIM-D: zentrale Tastaturkürzel — EIN keydown-Handler, gespeist aus der SHORTCUTS-Map ----
  // Läuft ohne Dependency-Array (Listener wird je Render frisch gebunden) → keine veralteten Closures.
  useEffect(() => {
    const onKey = (e) => {
      // Input-Guard: Kürzel feuern nicht, solange ein Eingabefeld fokussiert ist
      if (e.target?.closest?.("input,textarea,select,[contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); duplicateSelection(); return; } // Strg+D duplizieren
      if (e.ctrlKey || e.metaKey || e.altKey) return; // andere Browser-Kürzel nicht kapern
      if (e.key === "Escape") { setDraft([]); setHover(null); setSelected(null); setMultiSel([]); setTool("arrow"); setHint(""); }
      else if (e.key === "Delete" || e.key === "Backspace") { if (multiSel.length) { e.preventDefault(); deleteMany(multiSel); } else if (selected) { e.preventDefault(); deleteSelected(); } }
      else if (e.key === "v" || e.key === "V") selectTool("arrow");
      else if (e.key === "w" || e.key === "W") selectTool("wall");
      else if (e.key === "s" || e.key === "S") selectTool("column");
      else if (e.key === "d" || e.key === "D") selectTool("slab");
      else if (e.key === "f" || e.key === "F") zoomToSelection();
      else if (e.key.startsWith("Arrow")) {
        // Pfeiltasten: Auswahl verschieben — 0,1 m, mit Shift 1 m (BIM-A)
        const step = e.shiftKey ? 1 : 0.1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d && nudgeSelection(d[0], d[1])) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Scene init (once) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth || 700, H = mount.clientHeight || 520;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0xcfe1f0, 1); // heller Tageshimmel statt Dunkelblau
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe1f0);
    scene.fog = new THREE.Fog(0xcfe1f0, 600, 1800); // heller, weiter Dunst (kein dunkler Nebel)
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const baseHemi = new THREE.HemisphereLight(0xeaf4ff, 0x8a9a78, 0.7); // Himmel/Boden-Grundlicht
    scene.add(baseHemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(60, 120, 40); sun.castShadow = true;
    scene.add(sun);

    // Meter-Gitter (10 m Raster) + Achsen-Hinweis
    const grid10 = new THREE.GridHelper(200, 20, 0x1f6f63, 0x14302c);
    grid10.position.y = 0.02;
    scene.add(grid10);
    // XYZ-Achsen am Ursprung (X rot, Y grün=oben, Z blau), 8 m
    const axes = new THREE.AxesHelper(8);
    axes.position.y = 0.05;
    scene.add(axes);

    const terrainGroup = new THREE.Group();
    const buildingGroup = new THREE.Group();
    const contextGroup = new THREE.Group();
    const customGroup = new THREE.Group();
    scene.add(terrainGroup, buildingGroup, contextGroup, customGroup);

    Object.assign(three.current, { renderer, scene, camera, terrainGroup, buildingGroup, contextGroup, customGroup, ambient, sun, grid10, axes, target: new THREE.Vector3(0, 6, 0) });

    let raf;
    let lastT = performance.now(); // Delta-Zeit für die Stadt-Animation (Render-Modus)
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const o = orbit.current;
      if (!o.on && !o.touched) o.theta += 0.0012;
      const t = three.current.target;
      camera.position.set(
        t.x + o.radius * Math.sin(o.phi) * Math.cos(o.theta),
        t.y + o.radius * Math.cos(o.phi),
        t.z + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      );
      camera.lookAt(t);
      // Belebte Stadt (Autos/Fußgänger) entlang vorberechneter Polylinien bewegen
      if (animRef.current.length) updateCityLife(animRef.current, dt);
      // Auswahl-Aura pulsiert („atmet"), damit die Markierung ins Auge fällt
      if (three.current.auraList?.length) {
        const puls = 0.55 + 0.45 * Math.sin(now * 0.006);
        three.current.auraList.forEach((l) => { l.material.opacity = puls; });
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const el = renderer.domElement;
    el.style.touchAction = "none"; el.style.cursor = "default";
    const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

    // Raycasting: getroffenes pickbares Objekt unter (clientX,clientY)
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickAt = (clientX, clientY) => {
      const rect = el.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const objs = [];
      [three.current.buildingGroup, three.current.customGroup, three.current.contextGroup]
        .forEach((g) => g?.children.forEach((c) => { if (c.visible) objs.push(c); }));
      const hits = ray.intersectObjects(objs, false);
      return hits.length ? hits[0].object : null;
    };

    // ArchiCAD-Maus: links = wählen, rechts = Kontextmenü, mittlere = Pan, Shift+mittlere = drehen
    const down = (e) => {
      const o = orbit.current; o.touched = true;
      if (e.button === 1) { o.on = true; o.mode = e.shiftKey ? "rotate" : "pan"; el.style.cursor = o.mode === "pan" ? "move" : "grabbing"; e.preventDefault(); }
      else if (e.button === 0) { o.on = true; o.mode = "select"; o.moved = false; }
      else { o.on = false; o.mode = null; }
      o.x = e.clientX; o.y = e.clientY;
    };
    // Mittelklick-Autoscroll des Browsers verhindern
    const mdown = (e) => { if (e.button === 1) e.preventDefault(); };
    const move = (e) => {
      const o = orbit.current; if (!o.on) return;
      const dx = e.clientX - o.x, dy = e.clientY - o.y;
      if (o.mode === "select") { if (Math.abs(dx) + Math.abs(dy) > 3) o.moved = true; o.x = e.clientX; o.y = e.clientY; return; }
      if (o.mode === "pan") {
        _f.subVectors(three.current.target, camera.position).normalize();
        _r.crossVectors(_f, _up).normalize();
        _u.crossVectors(_r, _f).normalize();
        const k = o.radius * 0.0016;
        three.current.target.addScaledVector(_r, -dx * k);
        three.current.target.addScaledVector(_u, dy * k);
      } else if (o.mode === "rotate") {
        o.theta -= dx * 0.008;
        o.phi = Math.max(0.25, Math.min(1.45, o.phi - dy * 0.005));
      }
      o.x = e.clientX; o.y = e.clientY;
    };
    const up = (e) => {
      const o = orbit.current;
      if (o.mode === "select" && !o.moved) {
        const obj = pickAt(e.clientX, e.clientY);
        three.current.cb?.select?.(obj ? obj.userData : null);
      }
      o.on = false; o.mode = null; el.style.cursor = "default";
    };
    const wheel = (e) => { e.preventDefault(); orbit.current.touched = true; orbit.current.radius = Math.max(20, Math.min(220, orbit.current.radius + e.deltaY * 0.05)); };
    // Rechtsklick = Kontextmenü für getroffenes Objekt (Standardmenü unterdrückt)
    const ctx = (e) => {
      e.preventDefault();
      const obj = pickAt(e.clientX, e.clientY);
      const rect = el.getBoundingClientRect();
      three.current.cb?.context?.(obj ? obj.userData : null, e.clientX - rect.left, e.clientY - rect.top);
    };
    // Hover-Feedback: Zeiger-Cursor über pickbaren Bauteilen (gedrosselt; nie während Orbit/Pan)
    let lastHover = 0;
    const hoverMove = (e) => {
      if (orbit.current.on) return;
      const now = performance.now();
      if (now - lastHover < 90) return;
      lastHover = now;
      el.style.cursor = pickAt(e.clientX, e.clientY) ? "pointer" : "default";
    };
    el.addEventListener("pointermove", hoverMove);
    el.addEventListener("pointerdown", down);
    el.addEventListener("mousedown", mdown);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", ctx);

    const onResize = () => { const nw = mount.clientWidth, nh = mount.clientHeight; if (!nw || !nh) return; camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", hoverMove);
      el.removeEventListener("pointerdown", down); el.removeEventListener("mousedown", mdown);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", ctx);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    };
  }, []);

  // ---- Terrain patch from real elevation (200 m) ----
  useEffect(() => {
    const t = three.current; if (!t.terrainGroup || !grid || grid.length < 2) return;
    while (t.terrainGroup.children.length) { const c = t.terrainGroup.children.pop(); c.geometry?.dispose(); c.material?.dispose(); }
    const size = grid.length;
    const PATCH = 200;
    const relief = 12; // gedämpfte Überhöhung für Lesbarkeit
    const range = (max - min) || 1;
    const geo = new THREE.PlaneGeometry(PATCH, PATCH, size - 1, size - 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
      const idx = i * size + j;
      pos.setZ(idx, ((grid[i][j] - min) / range) * relief - relief / 2);
    }
    geo.computeVertexNormals();
    // Im Render-Modus helles Wiesengrün (dunkles Editor-Grün wirkt unter hellem Himmel schwarz)
    const mat = renderMode
      ? new THREE.MeshStandardMaterial({ color: 0x86a05c, roughness: 0.95, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: 0x223524, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = -0.05; mesh.receiveShadow = true;
    mesh.userData.layer = "terrain"; mesh.visible = layersRef.current.find((l) => l.id === "terrain")?.visible ?? true;
    t.terrainGroup.add(mesh);
  }, [grid, min, max, renderMode]);

  // ---- Building from shared model ----
  useEffect(() => {
    const t = three.current; if (!t.buildingGroup) return;
    while (t.buildingGroup.children.length) { const c = t.buildingGroup.children.pop(); c.geometry?.dispose(); c.material?.dispose(); }

    const envComp = compositeById(envComposite);
    // Render-Modus: Fassaden-Preset ersetzt das Standard-Hüllwandmaterial (auch Attika)
    const wallMat = renderMode
      ? facadeMaterial(facadePreset)
      : new THREE.MeshStandardMaterial({ color: envComp ? new THREE.Color(envComp.skins[0].color) : 0xeef2f6, roughness: 0.9, metalness: 0.0 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb6d6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4654, roughness: 0.6 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.7 });

    // Regel-Öffnungen (Auto-Fenster + Eingangstür) kommen aus autoOpenings —
    // derselben Liste, die auch der IFC-Export bekommt (KD-16).
    model.walls.forEach((w) => {
      const autos = autoOpenings.filter((o) => o.level === w.level && o.edge === w.edge);
      const ops = autos.map((o) => ({ u: o.u, sill: o.sill, width: o.width, height: o.height }));
      // benutzerplatzierte Öffnungen auf dieser Hüllwand
      const myEnv = envOpenings.filter((e) => e.level === w.level && e.edge === w.edge);
      myEnv.forEach((e) => { const ty = openingTypeById(e.kind, e.typeId); ops.push({ u: e.u, sill: ty.sill, width: ty.w, height: ty.h }); });
      const m = buildWallMeshWithHoles(w, wallMat, ops);
      m.userData.layer = "shell"; m.userData.kind = "wallShell"; m.userData.level = w.level; m.userData.edge = w.edge;
      t.buildingGroup.add(m);
      const rotY = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
      // Verglasung/Türblatt der Regel-Öffnungen (gleiche Quelle wie die Löcher)
      autos.forEach((o) => {
        const g = buildGlazing(autoOpeningType(o), o.u, glassMat, frameMat, o.kind, leafMat);
        g.position.set(w.a.x, w.elevation, w.a.z); g.rotation.y = rotY;
        g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = o.kind; c.userData.scope = "auto"; c.userData.level = w.level; c.userData.edge = w.edge; } });
        t.buildingGroup.add(g);
      });
      // Verglasung/Türblatt für platzierte Hüllwand-Öffnungen
      myEnv.forEach((e) => {
        const ty = openingTypeById(e.kind, e.typeId);
        const g = buildGlazing(ty, e.u, glassMat, frameMat, e.kind, leafMat);
        g.position.set(w.a.x, w.elevation, w.a.z); g.rotation.y = rotY;
        g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = e.kind; c.userData.id = e._idx; c.userData.scope = "env"; } });
        t.buildingGroup.add(g);
      });
    });

    model.slabs.forEach((s) => {
      const shape = new THREE.Shape();
      s.polygon.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
      const m = new THREE.Mesh(geo, slabMat); m.castShadow = true; m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = s.elevation;
      m.userData.layer = "shell"; m.userData.kind = "slab";
      t.buildingGroup.add(m);
    });

    // Attika (Brüstung) oben auf dem Dach — nur beim Flachdach
    if (dachform === "flach") {
      (model.parapets || []).forEach((p) => {
        const len = Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z); if (len < 0.05) return;
        const geo = new THREE.BoxGeometry(len, p.height, p.thickness);
        const m = new THREE.Mesh(geo, wallMat); m.castShadow = true; m.receiveShadow = true;
        m.position.set((p.a.x + p.b.x) / 2, p.elevation + p.height / 2, (p.a.z + p.b.z) / 2);
        m.rotation.y = -Math.atan2(p.b.z - p.a.z, p.b.x - p.a.x);
        m.userData.layer = "attika"; m.userData.kind = "parapet";
        t.buildingGroup.add(m);
      });
    }

    // Globale Dachform über dem Footprint (Sattel/Walm/Pult) auf der obersten Decke
    if (dachform && dachform !== "flach") {
      const baseY = model.totalHeight || (model.storeys?.length || 1) * (model.storeyHeight || 3);
      const rise = roofRiseFromPitch(model.footprint, dachform, dachneigung);
      const roofMat = renderMode
        ? new THREE.MeshStandardMaterial({ color: 0x8a5a44, roughness: 0.85, side: THREE.DoubleSide }) // Ziegelrot im Render
        : new THREE.MeshStandardMaterial({ color: 0xb05a3c, roughness: 0.85, side: THREE.DoubleSide });
      let roof = null;
      if (dachform === "sattel") roof = buildGableRoof(model.footprint, baseY, rise, roofMat);
      else if (dachform === "walm") roof = buildHipRoof(model.footprint, baseY, rise, roofMat);
      else if (dachform === "pult") roof = buildShedRoof(model.footprint, baseY, rise, roofMat);
      if (roof) {
        roof.userData.layer = "attika"; roof.userData.kind = "globalroof";
        t.buildingGroup.add(roof);
      }
    }

    applyLayerVisibility(t, layersRef.current);
    // Hülle wurde neu gebaut — Aura auf Hüllwand/Auto-Fenster wiederherstellen
    applyPickHighlight(t, selectedRef.current, multiSelRef.current);
  }, [model, envOpenings, autoOpenings, renderMode, facadePreset, dachform, dachneigung]);

  // Kamera nur bei Modelländerung neu ausrichten (nicht bei jeder Öffnung)
  useEffect(() => {
    const t = three.current; if (!t.target) return;
    const bb = modelBBox(model);
    const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, bb.height);
    t.target.set((bb.minX + bb.maxX) / 2, bb.height / 2, (bb.minZ + bb.maxZ) / 2);
    orbit.current.radius = Math.max(35, span * 2.2);
  }, [model]);

  // ---- Custom-Elemente (gezeichnete Wände/Stützen) in 3D ----
  useEffect(() => {
    const t = three.current; if (!t.customGroup) return;
    while (t.customGroup.children.length) { const c = t.customGroup.children.pop(); c.geometry?.dispose(); c.material?.dispose(); }
    customWalls.forEach((w) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.05) return;
      const h = w.height || storeyHeight, elev = w.level * storeyHeight;
      const dirx = (w.b.x - w.a.x) / len, dirz = (w.b.z - w.a.z) / len;
      const nx = -dirz, nz = dirx;
      const comp = compositeById(w.composite);
      const total = comp ? compositeTotalM(w.composite) : (w.thickness || 0.3);
      const o = w.refLine === "outside" ? total / 2 : w.refLine === "inside" ? -total / 2 : 0;
      const cx = (w.a.x + w.b.x) / 2, cz = (w.a.z + w.b.z) / 2;
      const rotY = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
      const myWins = customWindows.filter((cw) => cw.wallIdx === w._idx);
      if (myWins.length) {
        // Wand mit echten Öffnungen (einschichtig dargestellt) + Verglasung/Türblatt je Öffnung
        const ops = myWins.map((cw) => { const ty = openingTypeById(cw.kind, cw.typeId); return { u: cw.u, sill: ty.sill, width: ty.w, height: ty.h }; });
        if (comp) {
          // Loch durch jede Schicht schneiden (mehrschichtig + Öffnung)
          let cur = o + total / 2;
          comp.skins.forEach((sk) => {
            const tk = sk.thickness / 1000; const mid = cur - tk / 2; cur -= tk;
            const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(sk.color), roughness: 0.9 });
            const m = buildWallMeshWithHoles({ ...w, height: h }, mat, ops, Math.max(0.01, tk), mid);
            m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
            t.customGroup.add(m);
          });
        } else {
          const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
          const m = buildWallMeshWithHoles({ ...w, height: h }, wallMat, ops, total);
          m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
          t.customGroup.add(m);
        }
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb6d6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4654, roughness: 0.6 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.7 });
        myWins.forEach((cw) => {
          const ty = openingTypeById(cw.kind, cw.typeId);
          const g = buildGlazing(ty, cw.u, glassMat, frameMat, cw.kind, leafMat);
          g.position.set(w.a.x + nx * o, elev, w.a.z + nz * o);
          g.rotation.y = rotY;
          g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = cw.kind; c.userData.id = cw._idx; } });
          t.customGroup.add(g);
        });
      } else if (comp) {
        // Schichten von außen (+n) nach innen stapeln
        let cur = o + total / 2;
        comp.skins.forEach((sk) => {
          const tk = sk.thickness / 1000; const mid = cur - tk / 2;
          const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(sk.color), roughness: 0.9 });
          const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, Math.max(0.005, tk)), mat);
          m.castShadow = true; m.receiveShadow = true;
          m.position.set(cx + nx * mid, elev + h / 2, cz + nz * mid);
          m.rotation.y = rotY;
          m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
          t.customGroup.add(m);
          cur -= tk;
        });
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, total), mat);
        m.castShadow = true; m.receiveShadow = true;
        m.position.set(cx + nx * o, elev + h / 2, cz + nz * o);
        m.rotation.y = rotY;
        m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
        t.customGroup.add(m);
      }
    });
    // Eckfüller (Wand-Cleanup an Berührungspunkten)
    cornerFillers(customWalls).forEach((f) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(f.thk, f.h, f.thk), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(f.x, f.level * storeyHeight + f.h / 2, f.z);
      m.userData.layer = "walls"; m.userData.kind = "wall";
      t.customGroup.add(m);
    });
    customColumns.forEach((c) => {
      const elev = c.level * storeyHeight, s = c.size || 0.4;
      const mat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, storeyHeight, s), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(c.x, elev + storeyHeight / 2, c.z);
      m.userData.layer = "columns"; m.userData.kind = "column"; m.userData.id = c._idx;
      t.customGroup.add(m);
    });
    // Decken (gezeichnete Slabs) — Polygon extrudiert, 0,22 m, an Geschossdecke
    customSlabs.forEach((s) => {
      if (!s.points || s.points.length < 3) return;
      const shape = new THREE.Shape();
      s.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.85 });
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = (s.level || 0) * storeyHeight + storeyHeight - 0.22;
      m.userData.layer = "shell"; m.userData.kind = "cslab"; m.userData.id = s._idx;
      t.customGroup.add(m);
    });
    // Dächer (Satteldach über Polygon-BBox)
    customRoofs.forEach((rf) => {
      if (!rf.points || rf.points.length < 3) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.9, side: THREE.DoubleSide });
      const m = buildGableRoof(rf.points, (rf.level || 0) * storeyHeight + storeyHeight, rf.pitch || 2.5, mat);
      m.userData.layer = "attika"; m.userData.kind = "croof"; m.userData.id = rf._idx;
      t.customGroup.add(m);
    });
    // Räume/Zonen als Bodenfläche (dünne Extrusion) je Geschoss
    customZones.forEach((z) => {
      if (!z.points || z.points.length < 3) return;
      const shape = new THREE.Shape();
      z.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.9, transparent: true, opacity: 0.35 });
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = (z.level || 0) * storeyHeight + 0.04;
      m.userData.layer = "zones"; m.userData.kind = "zone"; m.userData.id = z._idx;
      t.customGroup.add(m);
    });
    applyLayerVisibility(t, layersRef.current);
    applyPickHighlight(t, selectedRef.current, multiSelRef.current);
  }, [customWalls, customColumns, customWindows, customZones, customSlabs, customRoofs, storeyHeight]);

  // 3D-Auswahl hervorheben (Aura: emissive + pulsierende Kontur, inkl. Mehrfachauswahl)
  useEffect(() => { applyPickHighlight(three.current, selected, multiSel); }, [selected, multiSel]);

  // Räume in die gemeinsame Quelle spiegeln (Massing-Studio zeigt sie dann mit an).
  // KD-18: NICHT unkonditional überschreiben. Der Store enthält auch die Zonen des
  // Wohnungsplaners (Marker „ ·W", siehe apartments.js) und der Wohnungs-Werkstatt
  // (Marker „ ·WT", siehe tesselierung.js, Phase 61) — die bleiben erhalten und
  // werden mit den eigenen Zonen zusammengeführt. Vorher wären sie nach einem
  // Wechsel in den BIM-Reiter still verworfen (beim Mount ist customZones leer).
  useEffect(() => {
    // Solange das Modell noch lädt, ist customZones leer — dann nicht spiegeln,
    // sonst verschwinden die eigenen Zonen kurz aus dem Store.
    if (loadingRef.current && !customZones.length) return;
    // Phase 43: id = persistentes _idx — stabiler Raumschlüssel (Möblierung überlebt das Umbenennen).
    const eigene = customZones.map((z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx }));
    const fremde = (buildingProgram.get().zones || []).filter((z) => istGeneriert(z) || istWerkstattZone(z));
    const naechste = [...eigene, ...fremde];
    // Store nur schreiben, wenn sich wirklich etwas ändert (kein Ping-Pong).
    const alt = buildingProgram.get().zones || [];
    if (JSON.stringify(alt) === JSON.stringify(naechste)) return;
    bp.set({ zones: naechste });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customZones]);

  // Callbacks aus den 3D-Maus-Handlern (links = wählen, rechts = Kontextmenü)
  three.current.cb = {
    select: (hit) => {
      setCtxMenu(null);
      if (hit && hit.kind === "wall") setSelected({ type: "wall", index: hit.id });
      else if (hit && hit.kind === "column") setSelected({ type: "column", index: hit.id });
      else if (hit && (hit.kind === "window" || hit.kind === "door") && hit.id != null) setSelected({ type: "opening", index: hit.id, scope: hit.scope || "custom" });
      else if (hit && hit.kind === "zone" && hit.id != null) setSelected({ type: "zone", index: hit.id });
      else if (hit && hit.kind === "cslab" && hit.id != null) setSelected({ type: "slab", index: hit.id });
      else if (hit && hit.kind === "croof" && hit.id != null) setSelected({ type: "roof", index: hit.id });
      else if (hit && hit.kind === "wallShell") setSelected({ type: "hullwall", level: hit.level ?? 0, edge: hit.edge ?? 0 });
      else if (hit && (hit.kind === "window" || hit.kind === "door") && hit.scope === "auto") setSelected({ type: "autowin", kind: hit.kind, level: hit.level ?? 0, edge: hit.edge ?? 0 });
      else setSelected(null);
    },
    context: (hit, x, y) => setCtxMenu(hit ? { x, y, hit } : null),
  };

  // ---- Context buildings (echte OSM-Umgebung, extrudiert) ----
  useEffect(() => {
    const t = three.current; if (!t.contextGroup) return;
    while (t.contextGroup.children.length) { const c = t.contextGroup.children.pop(); c.geometry?.dispose(); c.material?.dispose(); }
    if (!showContext) return;
    if (osm.buildings?.length) {
      const ctxMat = new THREE.MeshStandardMaterial({ color: 0x6b7785, roughness: 0.95 });
      osm.buildings.forEach((b) => {
        try { const mesh = extrudeFootprint(b.points, b.height || 9, ctxMat); mesh.userData.layer = "context"; t.contextGroup.add(mesh); } catch (_) { /* skip kaputte Polygone */ }
      });
    }

    // ---- Echte Umgebung: Grünflächen, Straßen, Wege, Bäume (alles Ebene "context") ----
    // Grünflächen (flache Polygone, y=0.015)
    if (env.greens?.length) {
      const greenMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 1, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      env.greens.forEach((poly) => {
        if (!poly || poly.length < 3) return;
        try {
          const shape = new THREE.Shape();
          poly.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
          shape.closePath();
          const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), greenMat);
          m.rotation.x = -Math.PI / 2; m.position.y = 0.015;
          m.receiveShadow = true; m.userData.layer = "context";
          t.contextGroup.add(m);
        } catch (_) { /* kaputtes Polygon überspringen */ }
      });
    }

    // Straßen + Gehwege als flache Segment-Bänder (max. ~800 Segmente gesamt)
    const streetMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95 });
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.95 });
    let segBudget = 800;
    const addRibbon = (lines, mat, y, defWidth) => {
      (lines || []).forEach((line) => {
        const pts = line?.pts; if (!pts || pts.length < 2) return;
        const width = Math.max(0.5, line.width || defWidth);
        for (let i = 0; i < pts.length - 1 && segBudget > 0; i++) {
          const a = pts[i], b = pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len < 0.1) continue;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), mat);
          // Rotationsreihenfolge YXZ: erst Gieren (Welt-Y) ausrichten, dann flach in die XZ-Ebene kippen
          m.rotation.order = "YXZ";
          m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
          m.rotation.x = -Math.PI / 2;
          m.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
          m.receiveShadow = true; m.userData.layer = "context";
          t.contextGroup.add(m);
          segBudget--;
        }
      });
    };
    addRibbon(env.streets, streetMat, 0.03, 6);
    addRibbon(env.paths, pathMat, 0.045, 2);

    // Bäume (max. 150): Stamm + Krone
    if (env.trees?.length) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c5a3a, roughness: 1 });
      const crownMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 1, transparent: true, opacity: 0.95 });
      const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.2);
      const crownGeo = new THREE.SphereGeometry(1.6, 8, 6);
      env.trees.slice(0, 150).forEach((tr) => {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(tr.x, 1.1, tr.z);
        trunk.castShadow = true; trunk.userData.layer = "context";
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.set(tr.x, 3.2, tr.z);
        crown.castShadow = true; crown.userData.layer = "context";
        t.contextGroup.add(trunk, crown);
      });
    }

    applyLayerVisibility(t, layersRef.current);
  }, [osm.buildings, showContext, env.streets, env.paths, env.trees, env.greens]);

  // ---- Render-Modus: Atmosphaere (Himmel, Nebel, Hemisphaere, Sonnenstand) ----
  useEffect(() => {
    const t = three.current; if (!t.scene || !t.sun) return;
    if (renderMode) {
      t.scene.background = new THREE.Color(0x87ceeb); // hellblauer Himmel
      t.scene.fog = new THREE.Fog(0xcfe8f5, 260, 1100); // weiche Tiefe
      if (!t.hemi) { t.hemi = new THREE.HemisphereLight(0xbfdcff, 0xcdb89a, 0.75); t.scene.add(t.hemi); }
      t.ambient.intensity = 0.2;
      const s = sunFromHour(sunHour);
      t.sun.position.set(s.pos.x, s.pos.y, s.pos.z);
      t.sun.color.copy(s.color);
      t.sun.intensity = s.intensity;
      // Konstruktionshilfen im Praesentationsmodus ausblenden
      if (t.grid10) t.grid10.visible = false;
      if (t.axes) t.axes.visible = false;
    } else {
      // Editor-Standard wiederherstellen (heller Tageshimmel)
      t.scene.background = new THREE.Color(0xcfe1f0);
      t.scene.fog = new THREE.Fog(0xcfe1f0, 600, 1800);
      if (t.hemi) { t.scene.remove(t.hemi); t.hemi.dispose?.(); t.hemi = null; }
      t.ambient.intensity = 0.55;
      t.sun.color.set(0xfff4e0); t.sun.intensity = 1.1;
      t.sun.position.set(60, 120, 40);
      if (t.grid10) t.grid10.visible = true;
      if (t.axes) t.axes.visible = true;
    }
  }, [renderMode, sunHour]);

  // ---- Render-Modus: belebte Stadt (Autos auf Straßen, Fußgänger auf Wegen) ----
  useEffect(() => {
    const t = three.current; if (!t.scene || !renderMode) return;
    if (!(env.streets?.length || env.paths?.length)) return;
    const city = createCityLife(env.streets, env.paths, { cars: 16, peds: 16 });
    if (!city.items.length) { city.dispose(); return; }
    t.scene.add(city.group);
    animRef.current = city.items; // tick() bewegt die Figuren (dt-basiert)
    return () => {
      animRef.current = [];
      t.scene.remove(city.group);
      city.dispose();
    };
  }, [renderMode, env.streets, env.paths]);

  // ---- Ebenen-Sichtbarkeit live anwenden ----
  useEffect(() => { applyLayerVisibility(three.current, layers); }, [layers]);

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Boxes className="w-4 h-4 text-emerald-600" /> Gebäudemodell
            <span className="text-slate-400 font-normal">· 1 Einheit = 1 m · ein Modell</span>
            {/* BIM 2.0: Persistenz-Status (Auto-Save je Projekt) */}
            <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full border ${
              saveState === "saved" ? "text-emerald-600 border-emerald-200 bg-emerald-50"
              : saveState === "saving" || saveState === "loading" ? "text-amber-600 border-amber-200 bg-amber-50"
              : saveState === "error" ? "text-rose-600 border-rose-200 bg-rose-50"
              : "text-slate-400 border-slate-200"}`}
              title="Modell wird automatisch je Projekt gespeichert (BimModel)">
              {saveState === "saved" ? "✓ gespeichert" : saveState === "saving" ? "speichert…" : saveState === "loading" ? "lädt…" : saveState === "error" ? "Speicherfehler" : "Auto-Save"}
            </span>
            {!hatGespeichertesModell && saveState !== "loading" && (
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full border text-amber-700 border-amber-300 bg-amber-50"
                title="Für dieses Projekt existiert kein gespeichertes Gebäudemodell. Die Ansicht zeigt die Editor-Voreinstellungen (Geschosse/Höhe/Dach) — KEIN erfasster Bestand. Erst eine Änderung speichert.">
                ⚠ kein gespeichertes Modell — Ansicht zeigt Editor-Defaults
              </span>
            )}
          </div>
          {/* Ansicht-Umschalter: 3D · Grundriss · Schnitt (alle aus demselben Modell) */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden text-xs">
            {[
              { id: "3d", label: "3D", icon: Box },
              { id: "grundriss", label: "Grundriss", icon: Grid2x2 },
              { id: "schnitt", label: "Schnitt", icon: Scissors },
            ].map((v) => (
              <button key={v.id} onClick={() => setView(v.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 ${view === v.id ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                aria-pressed={view === v.id} aria-label={`Ansicht ${v.label}`}>
                <v.icon className="w-3.5 h-3.5" /> {v.label}
              </button>
            ))}
            {/* 34-05: parametrisches Zeichnen direkt im Grundriss (BIT Sketcher) */}
            <button onClick={() => (sketchEdit ? stopSketchEdit() : startSketchEdit())}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 border-l border-slate-200 ${sketchEdit ? "bg-teal-600 text-white" : "text-teal-700 hover:bg-teal-50"}`}
              aria-pressed={sketchEdit} aria-label="Sketch bearbeiten" title="Parametrisches Zeichnen (Constraint-Zeichner) im Grundriss">
              ✏ Sketch
            </button>
          </div>
          {sketchEdit && (
            <div className="flex items-center gap-1.5 text-xs">
              <button onClick={() => { setSketchTool("line"); setSketchDraft(null); }}
                className={`px-2 py-1 rounded border ${sketchTool === "line" ? "bg-teal-600 text-white border-teal-600" : "border-slate-300 text-slate-600"}`}
                aria-label="Sketch-Werkzeug Linienzug">Linienzug</button>
              <button onClick={() => { setSketchTool("select"); setSketchDraft(null); }}
                className={`px-2 py-1 rounded border ${sketchTool === "select" ? "bg-teal-600 text-white border-teal-600" : "border-slate-300 text-slate-600"}`}
                aria-label="Sketch-Werkzeug Ziehen">Ziehen</button>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                sketchSolve == null ? "bg-slate-100 text-slate-500"
                : sketchSolve.conflicting.length ? "bg-rose-100 text-rose-700"
                : sketchSolve.dof === 0 ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"}`}>
                {sketchSolverStatus !== "bereit" ? `Solver ${sketchSolverStatus}`
                  : sketchSolve == null ? "—"
                  : sketchSolve.conflicting.length ? "Konflikt"
                  : sketchSolve.dof === 0 ? "voll bestimmt"
                  : `${sketchSolve.dof} DOF offen`}
              </span>
              <Link to="/SketchStudio" className="text-teal-700 underline text-[11px]"
                title="Constraints, Maße und Parameter im Constraint-Zeichner pflegen">Im Constraint-Zeichner öffnen</Link>
            </div>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <Layers className="w-3.5 h-3.5" /> Geschosse
              <select value={storeys} onChange={(e) => setStoreys(+e.target.value)}
                className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschosse">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Höhe
              <input type="number" min="2.5" max="6" step="0.1" value={storeyHeight}
                onChange={(e) => setStoreyHeight(+e.target.value)}
                className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschosshöhe" />
              <span className="text-slate-400">m</span>
            </label>
            {/* Dachform */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Dach
              <select value={dachform} onChange={(e) => setDachform(e.target.value)}
                className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Dachform">
                <option value="flach">Flachdach</option>
                <option value="sattel">Satteldach</option>
                <option value="walm">Walmdach</option>
                <option value="pult">Pultdach</option>
              </select>
              {dachform !== "flach" && (
                <>
                  <input type="number" min="5" max="60" step="1" value={dachneigung}
                    onChange={(e) => setDachneigung(+e.target.value)}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Dachneigung" />
                  <span className="text-slate-400">°</span>
                </>
              )}
            </label>
            {/* Attika (Brüstung) — nur beim Flachdach sinnvoll */}
            {dachform === "flach" && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={parapet.enabled} onChange={(e) => setParapet((p) => ({ ...p, enabled: e.target.checked }))} className="accent-emerald-600" aria-label="Attika" />
                Attika
                {parapet.enabled && (
                  <>
                    <input type="number" min="0.1" max="2" step="0.1" value={parapet.height}
                      onChange={(e) => setParapet((p) => ({ ...p, height: +e.target.value }))}
                      className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Attika-Höhe" />
                    <span className="text-slate-400">m</span>
                  </>
                )}
              </label>
            )}
            {/* Eingangstür — Vorgabe, aber konfigurierbar (KD-19) */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600"
              title="Eingangstür der Gebäudehülle. Vorgabe: 1,20 × 2,10 m, mittig (50 %) auf der ersten EG-Kante.">
              <input type="checkbox" checked={entranceCfg.enabled !== false}
                onChange={(e) => setEntranceCfg((c) => ({ ...c, enabled: e.target.checked }))}
                className="accent-emerald-600" aria-label="Eingangstür" />
              Eingang
              {entranceCfg.enabled !== false && (
                <>
                  <input type="number" min="0.8" max="3" step="0.05" value={entranceCfg.width}
                    onChange={(e) => setEntranceCfg((c) => ({ ...c, width: Math.max(0.8, Math.min(3, +e.target.value || 0.8)) }))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Breite" />
                  <span className="text-slate-400">×</span>
                  <input type="number" min="1.9" max="3" step="0.05" value={entranceCfg.height}
                    onChange={(e) => setEntranceCfg((c) => ({ ...c, height: Math.max(1.9, Math.min(3, +e.target.value || 1.9)) }))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Höhe" />
                  <span className="text-slate-400">m</span>
                  <select value={entranceCfg.edge ?? ""}
                    onChange={(e) => setEntranceCfg((c) => ({ ...c, edge: e.target.value === "" ? null : +e.target.value }))}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Kante">
                    <option value="">erste Kante</option>
                    {model.walls.filter((w) => w.level === 0).map((w) => (
                      <option key={w.edge} value={w.edge}>Kante {w.edge + 1}</option>
                    ))}
                  </select>
                  <input type="number" min="0" max="100" step="1" value={Math.round((entranceCfg.uRel ?? 0.5) * 100)}
                    onChange={(e) => setEntranceCfg((c) => ({ ...c, uRel: Math.max(0, Math.min(100, +e.target.value || 0)) / 100 }))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Lage" />
                  <span className="text-slate-400">%</span>
                  {entranceCfg.width === ENTRANCE_DEFAULT.width && entranceCfg.height === ENTRANCE_DEFAULT.height
                    && (entranceCfg.uRel ?? 0.5) === ENTRANCE_DEFAULT.uRel && entranceCfg.edge == null
                    && <span className="text-slate-400 italic">Vorgabe</span>}
                </>
              )}
            </label>
            {/* Wand-Referenzlinie + Aufbau — beim Zeichnen oder für ausgewählte Wand */}
            {(tool === "wall" || selected?.type === "wall") && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Bezug
                  <select value={selected?.type === "wall" ? (customWalls.find((w) => w._idx === selected.index)?.refLine || "center") : wallRef}
                    onChange={(e) => setWallRefLine(e.target.value)}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Wand-Referenzlinie">
                    <option value="center">Mitte</option>
                    <option value="outside">Außen</option>
                    <option value="inside">Innen</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Aufbau
                  <select value={selected?.type === "wall" ? (customWalls.find((w) => w._idx === selected.index)?.composite || "single24") : wallComp}
                    onChange={(e) => setWallComposite(e.target.value)}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Wand-Aufbau">
                    {WALL_COMPOSITES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </>
            )}
            {view === "grundriss" && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Geschoss
                <select value={Math.min(planLevel, storeys - 1)} onChange={(e) => setPlanLevel(+e.target.value)}
                  className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschoss wählen">
                  {model.storeys.map((s) => <option key={s.level} value={s.level}>{s.name}</option>)}
                </select>
              </label>
            )}
            {view === "3d" && (
              <button
                onClick={() => setShowContext((s) => !s)}
                className={`text-xs rounded-md px-2 py-1 border ${showContext ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300"}`}
                aria-label="Umgebungsgebäude ein-/ausblenden">
                Umgebung {osm.loading ? "…" : osm.offline ? "(offline)" : `(${osm.buildings.length})`}
              </button>
            )}
            {/* Render-Modus: Echtzeit-Darstellung mit Himmel, Sonne, Fassade, belebter Stadt */}
            {view === "3d" && (
              <button
                onClick={() => setRenderMode((r) => !r)}
                className={`flex items-center gap-1 text-xs rounded-md px-2 py-1 border ${renderMode ? "bg-sky-600 text-white border-sky-600" : "text-slate-500 border-slate-300"}`}
                aria-pressed={renderMode} aria-label="Render-Modus umschalten"
                title="Render-Modus: Himmel + Sonne, Fassaden-Presets, fahrende Autos und Fußgänger">
                <Sparkles className="w-3.5 h-3.5" /> Render
              </button>
            )}
            {/* BIM-F: Exposé-Render — aktuelle 3D-Ansicht hochauflösend (2×) als PNG (Muster Phase 22) */}
            {view === "3d" && (
              <button onClick={exportExpose}
                className="flex items-center gap-1 text-xs rounded-md px-2 py-1 border border-slate-300 text-slate-500 hover:bg-slate-50"
                aria-label="Exposé-PNG exportieren" title="Exposé-Bild: aktuelle 3D-Ansicht hochauflösend (2×) als PNG herunterladen">
                <Camera className="w-3.5 h-3.5" /> Exposé
              </button>
            )}
            {view === "3d" && (offline
              ? <span className="flex items-center gap-1 text-amber-600 text-xs"><WifiOff className="w-3.5 h-3.5" /> Gelände offline</span>
              : <span className="text-emerald-600 text-xs">Gelände: Open-Meteo</span>)}
            {/* Layer-Kombination (wie ArchiCAD-Statusbar) */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <Layers className="w-3.5 h-3.5" />
              <select value={combo} onChange={(e) => applyCombo(e.target.value)}
                className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Layer-Kombination">
                {Object.keys(LAYER_COMBOS).map((k) => <option key={k} value={k}>{k}</option>)}
                {combo === "Eigene" && <option value="Eigene">Eigene</option>}
              </select>
            </label>
            <button onClick={() => setShowLayers((s) => !s)}
              className={`text-xs rounded-md px-2 py-1 border ${showLayers ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300"}`}
              aria-pressed={showLayers} aria-label="Ebenen-Panel ein-/ausblenden">Ebenen</button>
            {/* Maßstab */}
            <label className="flex items-center gap-1 text-xs text-slate-600">M
              <select value={scale} onChange={(e) => setScale(+e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Maßstab">
                <option value={50}>1:50</option><option value={100}>1:100</option><option value={200}>1:200</option><option value={500}>1:500</option>
              </select>
            </label>
            {/* Einheit (länderabhängig: m/cm/mm) */}
            <label className="flex items-center gap-1 text-xs text-slate-600">Einheit
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Maßeinheit">
                <option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option>
              </select>
            </label>
            <button onClick={() => setShowMappe((s) => !s)}
              className={`text-xs rounded-md px-2 py-1 border ${showMappe ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300"}`}
              aria-pressed={showMappe} aria-label="Mappe ein-/ausblenden" title="Navigator: Zeichen-/Ausschnittmappe + Plan-Output">Mappe</button>
            <button onClick={downloadIFC}
              className="text-xs rounded-md px-2 py-1 border border-slate-300 text-slate-600 hover:bg-slate-50"
              aria-label="Als IFC exportieren" title="Gebäudemodell als IFC (.ifc) exportieren">IFC-Export</button>
            {/* BIM-D: Hilfe-Popover „Tastaturkürzel" — gespeist aus derselben SHORTCUTS-Map wie der Handler */}
            <span className="relative">
              <button onClick={() => setShowShortcuts((s) => !s)}
                className={`flex items-center gap-1 text-xs rounded-md px-2 py-1 border ${showShortcuts ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300 hover:bg-slate-50"}`}
                aria-pressed={showShortcuts} aria-label="Tastaturkürzel anzeigen" title="Tastaturkürzel">
                <Keyboard className="w-3.5 h-3.5" />
              </button>
              {showShortcuts && (
                <div className="absolute right-0 top-full mt-1 z-30 w-[260px] rounded-lg border border-slate-200 bg-white shadow-lg text-xs">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b bg-slate-50 rounded-t-lg">
                    <span className="font-semibold text-slate-700 flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> Tastaturkürzel</span>
                    <button onClick={() => setShowShortcuts(false)} className="text-slate-400 hover:text-slate-700" aria-label="Schließen">✕</button>
                  </div>
                  <div className="py-1">
                    {SHORTCUTS.map((s) => (
                      <div key={s.keys} className="flex items-center justify-between gap-2 px-3 py-1">
                        <kbd className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{s.keys}</kbd>
                        <span className="text-right text-slate-500">{s.desc}</span>
                      </div>
                    ))}
                    <div className="px-3 pt-1.5 pb-1.5 mt-1 text-[10px] text-slate-400 border-t">Kürzel pausieren, solange ein Eingabefeld fokussiert ist.</div>
                  </div>
                </div>
              )}
            </span>
          </div>
        </div>
        <div className="flex">
          {/* ---- Werkzeugkasten (ArchiCAD-Stil) ---- */}
          <div className="w-[120px] shrink-0 border-r bg-slate-50/70 py-1 overflow-y-auto" style={{ maxHeight: 520 }}>
            {/* ---- BIM-F: Favoriten-Chips über der Werkzeugleiste (localStorage nc-bim-favs, max 6) ---- */}
            <div className="px-1.5 pt-1 pb-1.5 mb-1 border-b border-slate-200">
              <div className="flex items-center justify-between px-0.5 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Favoriten</span>
                <button onClick={() => addFavorite()} className="text-amber-400 hover:text-amber-600"
                  title="Aktuelles Werkzeug (+ Aufbau/Typ) als Favorit speichern (max 6)" aria-label="Favorit speichern">
                  <Star className="w-3.5 h-3.5" />
                </button>
              </div>
              {favs.length === 0
                ? <div className="px-0.5 text-[9px] leading-tight text-slate-400">Werkzeug wählen, dann ★ — oder ★ am Attribute-Panel.</div>
                : <div className="flex flex-wrap gap-1">
                    {favs.map((f, i) => (
                      <button key={`${f.tool}-${f.composite || f.typeId || i}`} onClick={() => applyFavorite(f)}
                        className="max-w-full truncate rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100"
                        title={`Favorit anwenden: ${f.label}`}>{f.label}</button>
                    ))}
                  </div>}
            </div>
            {PALETTE.map((cat, ci) => (
              <div key={ci} className="mb-1">
                {cat.group && <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{cat.group}</div>}
                {cat.items.map((it) => {
                  const active = tool === it.id;
                  const usable = FUNCTIONAL.includes(it.id);
                  return (
                    <button key={it.id} onClick={() => selectTool(it.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left transition-colors
                        ${active ? "bg-emerald-600 text-white" : usable ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100"}`}
                      title={usable ? it.label : `${it.label} (geplant)`} aria-pressed={active}>
                      <it.icon className="w-4 h-4 shrink-0" /> <span className="truncate">{it.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* ---- Zeichenfläche ---- */}
          <div className="flex-1 min-w-0 relative">
            <div ref={mountRef} className="w-full" style={{ height: 520, display: view === "3d" ? "block" : "none" }} />
            {/* ---- Render-Modus: Fassaden-Presets + Sonnenstand (klein, unten links) ---- */}
            {view === "3d" && renderMode && (
              <div className="absolute z-10 left-2 bottom-2 w-[180px] rounded-lg border border-slate-200 bg-white/90 backdrop-blur shadow-lg text-xs p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 pb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Fassade
                </div>
                <div className="flex flex-col gap-1">
                  {FACADE_PRESETS.map((p) => (
                    <button key={p.id} onClick={() => setFacadePreset(p.id)}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1 text-left ${facadePreset === p.id ? "border-sky-500 bg-sky-50 text-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      aria-pressed={facadePreset === p.id} title={p.name}>
                      <span className="w-3.5 h-3.5 rounded-sm border border-slate-300 shrink-0"
                        style={{ backgroundColor: `#${p.color.toString(16).padStart(6, "0")}` }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 pt-2 text-[11px] text-slate-600">
                  <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="w-12 shrink-0">{sunHour % 1 ? sunHour.toFixed(1) : sunHour} Uhr</span>
                  <input type="range" min="0" max="24" step="0.5" value={sunHour}
                    onChange={(e) => setSunHour(+e.target.value)}
                    className="accent-amber-500 min-w-0 flex-1" aria-label="Sonnenstand (Uhrzeit)" />
                </label>
              </div>
            )}
            {view !== "3d" && (
              <BimPlan2D
                model={model} mode={view} level={Math.min(planLevel, storeys - 1)} storeyHeight={storeyHeight}
                layerVis={layerVis} envOpenings={envOpenings} customZones={customZones} customSlabs={customSlabs} customRoofs={customRoofs} unit={unit}
                edit={view === "grundriss" && !sketchEdit ? { tool, draft, hover, customWalls, customColumns, customWindows, selected, multiSel, onPoint, onHover: setHover, onFinish, onPick, onMarquee, onClear, onMoveWallPt, onMoveWall, onMoveColumn, onMoveOpening, onMovePolyVert, onMoveFootVert, onMoveFootEdge, onInsertFootVert, onDeleteFootVert } : undefined}
                focus={focus2d}
                overlayBounds={sketchEdit ? sketchEditBounds : sketchBounds}
                overlay={
                  sketchEdit && sketchEditRef.current
                    ? ({ X, Z, SCALE, toMeters, bounds }) => (
                        // 34-05: parametrisches Zeichnen/Ziehen direkt im Plan.
                        // BIM-Editierung ist derweil aus (edit=undefined oben).
                        <SketchEditOverlay
                          sketch={sketchEditRef.current}
                          version={sketchVersion}
                          lastSolve={sketchSolve}
                          tool={sketchTool}
                          draft={sketchDraft}
                          setDraft={setSketchDraft}
                          onAddSegment={sketchAddSegment}
                          onDragPoint={sketchDragPoint}
                          onDragEnd={() => resolveSketch()}
                          X={X}
                          Z={Z}
                          SCALE={SCALE}
                          toMeters={toMeters}
                          bounds={bounds}
                        />
                      )
                    : sketchObj
                      ? ({ X, Z, SCALE }) => (
                          // PW-05: Sketch aus dem BIT Sketcher, read-only. Y-Flip
                          // Sketch (+y oben) ↔ Plan (Z nach unten): Y(wy) = Z(−wy).
                          <g style={{ pointerEvents: "none" }} opacity="0.9">
                            <SketchGeometry sketch={sketchObj} X={X} Y={(wy) => Z(-wy)} scale={SCALE} masstab={0.6} />
                          </g>
                        )
                      : undefined
                }
              />
            )}
            {/* 3D-Kontextmenü (Rechtsklick) */}
            {view === "3d" && ctxMenu && (
              <div className="absolute z-20 min-w-[180px] rounded-lg border border-slate-200 bg-white shadow-lg text-xs py-1"
                style={{ left: Math.min(ctxMenu.x, 520), top: ctxMenu.y }} onMouseLeave={() => setCtxMenu(null)}>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 border-b">
                  {{ wall: "Wand", column: "Stütze", zone: "Raum", cslab: "Decke", croof: "Dach", wallShell: "Hüllwand", window: "Fenster", door: "Tür", slab: "Decke", parapet: "Attika", context: "Umgebungsgebäude" }[ctxMenu.hit.kind] || "Objekt"}
                </div>
                {ctxMenu.hit.kind === "wall" && (
                  <>
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-400">Aufbau</div>
                    {WALL_COMPOSITES.map((c) => (
                      <button key={c.id} onClick={() => { setWallComposite(c.id, ctxMenu.hit.id); setCtxMenu(null); }}
                        className="w-full text-left px-3 py-1 hover:bg-slate-50 text-slate-700">{c.name}</button>
                    ))}
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-400 border-t">Referenzlinie</div>
                    {[["center", "Mitte"], ["outside", "Außen"], ["inside", "Innen"]].map(([v, l]) => (
                      <button key={v} onClick={() => { setCustomWalls((ws) => ws.map((w) => w._idx === ctxMenu.hit.id ? { ...w, refLine: v } : w)); setCtxMenu(null); }}
                        className="w-full text-left px-3 py-1 hover:bg-slate-50 text-slate-700">{l}</button>
                    ))}
                    <button onClick={ctxDuplicate} className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 mt-1 border-t text-slate-700 hover:bg-slate-50"><Copy className="w-3 h-3" /> Duplizieren (+1 m)</button>
                    <button onClick={ctxDelete} className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50">Löschen</button>
                  </>
                )}
                {(["column", "zone", "cslab", "croof"].includes(ctxMenu.hit.kind) || ((ctxMenu.hit.kind === "window" || ctxMenu.hit.kind === "door") && ctxMenu.hit.id != null)) && (
                  <>
                    <button onClick={ctxDuplicate} className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 text-slate-700 hover:bg-slate-50"><Copy className="w-3 h-3" /> Duplizieren (+1 m)</button>
                    <button onClick={ctxDelete} className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50">Löschen</button>
                  </>
                )}
                {!["wall", "column", "zone", "cslab", "croof"].includes(ctxMenu.hit.kind) && !((ctxMenu.hit.kind === "window" || ctxMenu.hit.kind === "door") && ctxMenu.hit.id != null) && (
                  <div className="px-3 py-1.5 text-slate-400">Keine Optionen (Hüllen-/Umgebungselement)</div>
                )}
              </div>
            )}

            {/* ---- BIM-E: Attribute-Panel der Auswahl (Einzel- bzw. letztes Element der Mehrfachauswahl) ---- */}
            {(() => {
              if (attrHidden) return null;
              const panelSel = selected || attrSel; // Einzelauswahl hat Vorrang, sonst letztes Element der Mehrfachauswahl
              if (!panelSel) return null;
              const numCls = "w-20 rounded border border-slate-300 px-1 py-0.5 text-right bg-white";
              const selCls = "rounded border border-slate-300 px-1 py-0.5 bg-white max-w-[120px]";
              // Plain-Funktion (kein Komponententyp!) -> Inputs verlieren beim Tippen nicht den Fokus.
              const field = (label, child) => (
                <label key={label} className="flex items-center justify-between gap-2 px-3 py-1 text-[11px] text-slate-600">
                  <span className="text-slate-500">{label}</span>{child}
                </label>
              );
              const storeyOpts = model.storeys.map((s) => <option key={s.level} value={s.level}>{s.name}</option>);
              let title = "Objekt", body = null, readOnly = false, favSpec = null; // favSpec: ★-Favorit aus der Auswahl (BIM-F)

              if (panelSel.type === "wall") {
                const w = customWalls.find((x) => x._idx === panelSel.index); if (!w) return null;
                const hasComp = !!compositeById(w.composite);
                title = "Wand"; favSpec = { tool: "wall", composite: w.composite || null };
                body = [
                  field("Geschoss", <select className={selCls} value={w.level} onChange={(e) => patchWall(w._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Höhe (m)", <input type="number" className={numCls} step="0.1" min="2" max="8" value={w.height ?? storeyHeight} onChange={(e) => patchWall(w._idx, { height: +e.target.value })} />),
                  field("Aufbau", <select className={selCls} value={w.composite || "single24"} onChange={(e) => patchWall(w._idx, { composite: e.target.value })}>{WALL_COMPOSITES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>),
                  !hasComp && field("Dicke (m)", <input type="number" className={numCls} step="0.05" min="0.1" max="0.6" value={w.thickness ?? 0.3} onChange={(e) => patchWall(w._idx, { thickness: +e.target.value })} />),
                  field("Bezug", <select className={selCls} value={w.refLine || "center"} onChange={(e) => patchWall(w._idx, { refLine: e.target.value })}><option value="center">Mitte</option><option value="outside">Außen</option><option value="inside">Innen</option></select>),
                ];
              } else if (panelSel.type === "column") {
                const c = customColumns.find((x) => x._idx === panelSel.index); if (!c) return null;
                title = "Stütze";
                body = [
                  field("Geschoss", <select className={selCls} value={c.level} onChange={(e) => patchColumn(c._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Größe (m)", <input type="number" className={numCls} step="0.05" min="0.2" max="1.2" value={c.size ?? 0.4} onChange={(e) => patchColumn(c._idx, { size: +e.target.value })} />),
                ];
              } else if (panelSel.type === "opening") {
                const scope = panelSel.scope || "custom";
                const o = (scope === "env" ? envOpenings : customWindows).find((x) => x._idx === panelSel.index); if (!o) return null;
                const types = o.kind === "door" ? DOOR_TYPES : WINDOW_TYPES;
                title = o.kind === "door" ? "Tür" : "Fenster"; favSpec = { tool: o.kind, typeId: o.typeId };
                body = [
                  field("Art", <select className={selCls} value={o.kind} onChange={(e) => { const k = e.target.value; const def = (k === "door" ? DOOR_TYPES : WINDOW_TYPES)[0].id; patchOpening(o._idx, scope, { kind: k, typeId: def }); }}><option value="window">Fenster</option><option value="door">Tür</option></select>),
                  field("Typ", <select className={selCls} value={o.typeId} onChange={(e) => patchOpening(o._idx, scope, { typeId: e.target.value })}>{types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}</select>),
                  field("Position (m)", <input type="number" className={numCls} step="0.25" value={+o.u.toFixed(2)} onChange={(e) => patchOpening(o._idx, scope, { u: Math.max(0.2, +e.target.value) })} />),
                  field("Lage", <span className="text-slate-400">{scope === "env" ? "Hüllwand" : "Innenwand"}</span>),
                ];
              } else if (panelSel.type === "zone") {
                const z = customZones.find((x) => x._idx === panelSel.index); if (!z) return null;
                const area = Math.abs(z.points.reduce((a, p, i) => { const q = z.points[(i + 1) % z.points.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
                title = "Raum";
                body = [
                  field("Name", <input type="text" className="w-28 rounded border border-slate-300 px-1 py-0.5 bg-white" value={z.name} onChange={(e) => patchZone(z._idx, { name: e.target.value })} />),
                  field("Geschoss", <select className={selCls} value={z.level} onChange={(e) => patchZone(z._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Fläche", <span className="text-slate-500">{area.toFixed(1)} m²</span>),
                ];
              } else if (panelSel.type === "slab") {
                const s = customSlabs.find((x) => x._idx === panelSel.index); if (!s) return null;
                title = "Decke";
                body = [field("Geschoss", <select className={selCls} value={s.level} onChange={(e) => patchSlab(s._idx, { level: +e.target.value })}>{storeyOpts}</select>)];
              } else if (panelSel.type === "roof") {
                const rf = customRoofs.find((x) => x._idx === panelSel.index); if (!rf) return null;
                title = "Dach";
                body = [
                  field("Geschoss", <select className={selCls} value={rf.level} onChange={(e) => patchRoof(rf._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Firsthöhe (m)", <input type="number" className={numCls} step="0.25" min="0.5" max="6" value={rf.pitch ?? 2.5} onChange={(e) => patchRoof(rf._idx, { pitch: +e.target.value })} />),
                ];
              } else if (panelSel.type === "hullwall") {
                const w = model.walls.find((x) => x.level === panelSel.level && x.edge === panelSel.edge); if (!w) return null;
                const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
                const hasComp = !!compositeById(envComposite);
                title = "Hüllwand"; readOnly = true; // generiert → kein Löschen, aber Aufbau/Dicke editierbar (ganze Hülle)
                body = [
                  field("Geschoss", <span className="text-slate-500">{model.storeys.find((s) => s.level === w.level)?.name}</span>),
                  field("Länge", <span className="text-slate-500">{len.toFixed(2)} m</span>),
                  field("Aufbau", <select className={selCls} value={envComposite || "single"} onChange={(e) => setEnvComposite(e.target.value === "single" ? null : e.target.value)}><option value="single">Einschichtig</option>{WALL_COMPOSITES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>),
                  !hasComp && field("Dicke (m)", <input type="number" className={numCls} step="0.05" min="0.1" max="0.6" value={envThickness} onChange={(e) => setEnvThickness(+e.target.value)} />),
                  field("Hinweis", <span className="text-slate-400 text-[10px]">Griffe ziehen verformt den Grundriss (alle Geschosse)</span>),
                ];
              } else if (panelSel.type === "autowin") {
                title = panelSel.kind === "door" ? "Tür (Hülle)" : "Fenster (Hülle)"; readOnly = true;
                body = [
                  field("Geschoss", <span className="text-slate-500">{model.storeys.find((s) => s.level === panelSel.level)?.name}</span>),
                  field("Typ", <span className="text-slate-400">automatisch</span>),
                  field("Hinweis", <span className="text-slate-400 text-[10px]">eigenes Fenster mit dem Fenster-Werkzeug setzen</span>),
                ];
              } else return null;

              return (
                <div className="absolute z-20 top-2 right-2 w-[230px] rounded-lg border border-slate-200 bg-white shadow-lg text-xs">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b bg-slate-50 rounded-t-lg">
                    <span className="font-semibold text-slate-700">{title} · Attribute{multiSel.length > 1 ? ` (1 von ${multiSel.length})` : ""}</span>
                    <span className="flex items-center gap-1.5">
                      {favSpec && (
                        <button onClick={() => addFavorite(favSpec)} className="text-amber-400 hover:text-amber-600"
                          title="Als Favorit speichern (Werkzeug + Aufbau/Typ)" aria-label="Als Favorit speichern">
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setAttrHidden(true)} className="text-slate-400 hover:text-slate-700" aria-label="Schließen">✕</button>
                    </span>
                  </div>
                  <div className="py-1 divide-y divide-slate-100">{body}</div>
                  {!readOnly && (
                    <div className="px-3 py-1.5 border-t">
                      <button onClick={() => { if (selected) deleteSelected(); else deleteMany([panelSel]); }} className="flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="w-3 h-3" /> Löschen (Entf)</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ---- Bibliothek (Fenster/Türen) — sichtbar bei aktivem Fenster-/Tür-Werkzeug ---- */}
          {(tool === "window" || tool === "door") && (() => {
            const isDoor = tool === "door";
            const types = isDoor ? DOOR_TYPES : WINDOW_TYPES;
            const cur = isDoor ? doorType : winType;
            const setCur = isDoor ? setDoorType : setWinType;
            return (
              <div className="w-[180px] shrink-0 border-l bg-slate-50/70 overflow-y-auto" style={{ maxHeight: 520 }}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                  {isDoor ? <DoorOpen className="w-3 h-3" /> : <AppWindow className="w-3 h-3" />} {isDoor ? "Tür-Bibliothek" : "Fenster-Bibliothek"}
                </div>
                <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                  {types.map((ty) => (
                    <button key={ty.id} onClick={() => setCur(ty.id)}
                      className={`rounded-md border p-1 flex flex-col items-center gap-1 ${cur === ty.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-100"}`}
                      title={ty.name}>
                      <svg viewBox="0 0 40 44" className="w-full h-12">
                        <rect x="3" y="2" width="34" height="40" fill={isDoor && !ty.glass ? "#cbb89c" : "#dbeafe"} stroke="#64748b" strokeWidth="2" />
                        {Array.from({ length: ty.cols - 1 }).map((_, i) => <line key={`v${i}`} x1={3 + (34 / ty.cols) * (i + 1)} y1="2" x2={3 + (34 / ty.cols) * (i + 1)} y2="42" stroke="#64748b" strokeWidth="2" />)}
                        {Array.from({ length: ty.rows - 1 }).map((_, i) => <line key={`h${i}`} x1="3" y1={2 + (40 / ty.rows) * (i + 1)} x2="37" y2={2 + (40 / ty.rows) * (i + 1)} stroke="#64748b" strokeWidth="2" />)}
                      </svg>
                      <span className="text-[9px] leading-tight text-center text-slate-600">{ty.name}</span>
                    </button>
                  ))}
                </div>
                <div className="px-2 py-2 border-t text-[10px] text-slate-400">In den Grundriss auf eine Wand klicken, um {isDoor ? "die Tür" : "das Fenster"} zu setzen.</div>
              </div>
            );
          })()}

          {/* ---- Mappe / Navigator (Zeichenmappe → Ausschnitte → Plan-Output) ---- */}
          {showMappe && (
            <div className="w-[200px] shrink-0 border-l bg-slate-50/70 overflow-y-auto text-xs" style={{ maxHeight: 520 }}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                <Boxes className="w-3 h-3" /> Mappe · ein Modell
              </div>
              {/* Zeichenmappe (Modell) */}
              <div className="px-2 pb-1">
                <div className="text-[10px] uppercase text-slate-400 px-1 py-0.5">Zeichenmappe</div>
                {model.storeys.map((s) => (
                  <button key={`gr${s.level}`} onClick={() => { setView("grundriss"); setPlanLevel(s.level); }}
                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${view === "grundriss" && planLevel === s.level ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                    <Grid2x2 className="w-3.5 h-3.5" /> Grundriss {s.name}
                  </button>
                ))}
                <button onClick={() => setView("schnitt")} className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${view === "schnitt" ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}><Scissors className="w-3.5 h-3.5" /> Schnitt</button>
                <button onClick={() => setView("3d")} className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${view === "3d" ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}><Box className="w-3.5 h-3.5" /> 3D / IFC-Modell</button>
              </div>
              {/* Ausschnittmappe */}
              <div className="px-2 py-1 border-t">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[10px] uppercase text-slate-400">Ausschnitte</span>
                  <button onClick={saveView} className="text-emerald-600 hover:underline text-[11px]">+ speichern</button>
                </div>
                {views.length === 0 && <div className="px-1 text-[10px] text-slate-400">Aktuelle Ansicht (Maßstab + Ebenen-Kombi) als Ausschnitt sichern.</div>}
                {views.map((v) => (
                  <div key={v.id} className="flex items-center gap-1 px-1 py-0.5">
                    <button onClick={() => applyView(v)} className="flex-1 text-left px-1 py-0.5 rounded text-slate-700 hover:bg-slate-100 truncate" title={`${v.name} · ${v.combo}`}>{v.name}</button>
                    <button onClick={() => deleteView(v.id)} className="text-slate-300 hover:text-rose-500" aria-label="Ausschnitt löschen"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
              {/* Schnitthöhe (Schnittebene) */}
              <div className="px-3 py-1 border-t text-[11px] text-slate-600">
                <label className="flex items-center justify-between gap-2">Schnitthöhe
                  <input type="number" step="0.1" min="0.5" max="2.5" value={cutHeight} onChange={(e) => setCutHeight(+e.target.value)} className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right bg-white" /></label>
              </div>
              {/* Plan-Output */}
              <div className="px-2 py-2 border-t">
                <div className="text-[10px] uppercase text-slate-400 px-1 pb-1">Pläne / Output</div>
                <button onClick={exportPlanPDF} className="w-full rounded-md bg-emerald-600 text-white px-2 py-1.5 hover:bg-emerald-700">Aktuellen Plan als PDF</button>
                <button onClick={downloadIFC} className="w-full mt-1 rounded-md border border-slate-300 text-slate-600 px-2 py-1.5 hover:bg-slate-50">Modell als IFC</button>
                <div className="px-1 pt-1 text-[10px] text-slate-400">PDF im A3 mit Schriftfeld (Maßstab + Ebenen). Grundriss/Schnitt.</div>
              </div>
            </div>
          )}

          {/* ---- Ebenen-Panel (Layers, ArchiCAD-Stil) ---- */}
          {tool !== "window" && showLayers && (
            <div className="w-[180px] shrink-0 border-l bg-slate-50/70 overflow-y-auto" style={{ maxHeight: 520 }}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Ebenen
              </div>
              <div className="px-2 text-[11px] text-slate-400 pb-1">Kombination: <b className="text-slate-600">{combo}</b></div>
              {layers.map((l) => (
                <div key={l.id} className={`flex items-center gap-1.5 px-2 py-1 text-xs ${l.visible ? "text-slate-700" : "text-slate-400"}`}>
                  <button onClick={() => toggleLayer(l.id, "visible")} title={l.visible ? "Sichtbar" : "Ausgeblendet"} aria-label={`Sichtbarkeit ${l.name}`}>
                    {l.visible ? <Eye className="w-3.5 h-3.5 text-emerald-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                  <button onClick={() => toggleLayer(l.id, "locked")} title={l.locked ? "Gesperrt" : "Entsperrt"} aria-label={`Sperre ${l.name}`}>
                    {l.locked ? <Lock className="w-3.5 h-3.5 text-rose-500" /> : <LockOpen className="w-3.5 h-3.5 text-slate-300" />}
                  </button>
                  <span className="truncate flex-1">{l.name}</span>
                </div>
              ))}
              <div className="px-2 py-2 mt-1 border-t text-[10px] text-slate-400">
                Geschosse ≠ Ebenen: Geschosse sind Stockwerke, Ebenen sortieren Bauteile.
              </div>
            </div>
          )}
        </div>

        {/* ---- Statusleiste (ArchiCAD-Stil) ---- */}
        <div className="px-4 py-1.5 text-[11px] text-slate-500 border-t bg-slate-50/60 flex items-center gap-4 flex-wrap">
          <span className="font-medium text-slate-600">Maßstab 1:{scale}</span>
          <span>Geschoss: <b className="text-slate-700">{model.storeys[Math.min(planLevel, storeys - 1)]?.name}</b></span>
          <span>Werkzeug: <b className="text-slate-700">{PALETTE.flatMap((c) => c.items).find((i) => i.id === tool)?.label || "Pfeil"}</b></span>
          <span>Wände: <b className="text-slate-700">{customWalls.length}</b> · Stützen: <b className="text-slate-700">{customColumns.length}</b> · Fenster: <b className="text-slate-700">{[...customWindows, ...envOpenings].filter((o) => o.kind !== "door").length}</b> · Türen: <b className="text-slate-700">{[...customWindows, ...envOpenings].filter((o) => o.kind === "door").length}</b> · Räume: <b className="text-slate-700">{customZones.length}</b> · Decken: <b className="text-slate-700">{customSlabs.length}</b> · Dächer: <b className="text-slate-700">{customRoofs.length}</b></span>
          {/* BIM-B: Auswahl-Zähler-Badge + BIM-A/C: Kontextaktionen der Auswahl */}
          {selCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold" title="Anzahl ausgewählter Elemente (Shift+Klick erweitert)">{selCount} ausgewählt</span>
          )}
          {selCount > 0 && (
            <button onClick={zoomToSelection} className="flex items-center gap-1 text-slate-600 hover:underline" title="Zoom auf Auswahl (Taste F) — 2D-Ausschnitt bzw. 3D-Kamera"><Focus className="w-3 h-3" /> Zoom (F)</button>
          )}
          {selCount > 0 && (
            <button onClick={duplicateSelection} className="flex items-center gap-1 text-slate-600 hover:underline" title="Auswahl duplizieren, +1 m versetzt (Strg+D)"><Copy className="w-3 h-3" /> Duplizieren (Strg+D)</button>
          )}
          <button onClick={resetViewAll} className="flex items-center gap-1 text-slate-500 hover:underline" title="Ansicht zurücksetzen: 3D-Kamera aufs Gesamtmodell bzw. 2D-Zoom 100 %"><RotateCcw className="w-3 h-3" /> Ansicht zurücksetzen</button>
          {selected && <button onClick={deleteSelected} className="flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="w-3 h-3" /> Auswahl löschen (Entf)</button>}
          {multiSel.length > 0 && <button onClick={() => deleteMany(multiSel)} className="flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="w-3 h-3" /> {multiSel.length} ausgewählt löschen (Entf)</button>}
          {(customWalls.length > 0 || customColumns.length > 0) && (
            <>
              <button onClick={undoLast} className="flex items-center gap-1 text-slate-500 hover:underline"><Undo2 className="w-3 h-3" /> Rückgängig</button>
              <button onClick={clearCustom} className="flex items-center gap-1 text-slate-500 hover:underline"><Trash2 className="w-3 h-3" /> Leeren</button>
            </>
          )}
          <span className="ml-auto text-slate-400">
            {hint
              ? <span className="text-amber-600">{hint}</span>
              : tool === "wall" ? "Wand: klicken für Punkte · Doppelklick beendet · Esc bricht ab"
              : tool === "column" ? "Stütze: klicken zum Platzieren"
              : tool === "window" ? "Fenster: Typ links wählen, dann auf eine Wand klicken"
              : tool === "door" ? "Tür: Typ links wählen, dann auf eine Wand klicken"
              : tool === "zone" ? "Raum: in eine von Wänden umschlossene Fläche klicken — wird automatisch erkannt"
              : tool === "slab" ? "Decke: Eckpunkte klicken, Doppelklick schließt das Polygon"
              : tool === "roof" ? "Dach: Eckpunkte klicken, Doppelklick → Satteldach über der Fläche"
              : view === "3d" ? "Links = wählen · Rechts = Optionen · Mittlere Taste = verschieben · Shift+Mitte = drehen · Mausrad = zoom"
              : "Pfeil: anklicken wählt · Rahmen ziehen → (umschließt) bzw. ← (berührt) · Mausrad = zoom · Mittel-Taste = verschieben · Entf löscht · Dppl-Klick Griff: Ecke +/-"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
