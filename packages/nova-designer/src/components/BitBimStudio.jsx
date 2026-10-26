// 107-01 rule (spec VI.3): the stored model (a, b, thickness or build-up, refLine, openings …) is the BASE
// GEOMETRY; every mesh in this studio, the plan, the PDF plan and the IFC are derived from it again on each
// change (the 3D effects clear their group and rebuild). A mesh is never the source and may at most later lie
// as a discardable intermediate store (D-BK-08a, plan 107-14). The wall offset against the reference line has
// ONE derivation: @core/lib/bauteil/referenz.js.
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as THREE from "three";
import { Card, CardContent } from "@core/components/ui/card";
import {
  Boxes, WifiOff, Layers, Box, Grid2x2, Scissors,
  MousePointer2, RectangleHorizontal, Columns3, Square, Triangle,
  DoorOpen, AppWindow, Frame, Eye, EyeOff, Lock, LockOpen, Ruler, Type, PenLine, Trash2, Undo2,
  Sparkles, Sun, Focus, Keyboard, Camera, Copy, Star, RotateCcw, SquareDashed,
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
const TOOL_NAMES = { wall: "Wand", column: "Stütze", window: "Fenster", door: "Tür", oeffnung: "Öffnung", zone: "Zone", slab: "Decke", roof: "Dach" };
import { useProject } from "@core/lib/ProjectContext";
import { bauartVon } from "@core/lib/bauart";
import { useI18n } from "@core/lib/i18n";
import { zustandFelder } from "@designer/components/ZustandFelder";
import { steckbriefFelder } from "@designer/components/SteckbriefFelder";
import { aufbauEditorFelder, AUFBAUTEN_LEER } from "@designer/components/AufbauEditor";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { setzeProjektAufbauten, gibProjektAufbautenFrei, overridesNachEntfernen } from "@core/lib/bauteil/aufbauten.js";
import { steckbrief, typFuerWand } from "@core/lib/bauteil/steckbrief.js";
import { attributeVon, attributPatch, mitAttributen, werkstattMitAttributen } from "@core/lib/bauteil/attribute.js";
import { statusFarbe } from "@core/lib/plan/statusDarstellung.js";
import { wandGeometrie, wandDicke_m, eckfueller } from "@core/lib/bauteil/referenz.js";
// 107-02: every storey elevation, wall/column height, slab thickness and roof slope comes from this one file (no own level × storeyHeight here)
import { elevationOf, unterkante, wandHoehe, stuetzenHoehe, geschosshoehe, gesamtHoehe, deckenLage, oberkanteFolgtGeschoss, dachFirsthoehe_m, dachNeigung_grad, dachMigrieren, firsthoeheAusNeigung, geschosseAus, MAX_NEIGUNG_GRAD, FLACHDACH_BIS_GRAD, DECKEN_STANDARD } from "@core/lib/bauteil/hoehen.js";
import { brilleVon, sichtbarUnter, zeigtStatus, STANDARD_BRILLE } from "@core/lib/plan/brillen.js";
import BrillenLeiste from "@designer/components/BrillenLeiste";
import FehlplanungHinweise from "@designer/components/FehlplanungHinweise";
import { planGrafik, vektorPlanPdf, schnittGrafik } from "@designer/lib/vektorPlan";
import { objektFreigeben } from "@core/lib/threeFreigeben";
// 106-01: one ray pick and one highlighter for every viewer (hover, click, later VR controllers).
import { identitaetAus, pickDrossel, zeigerPick, zeigerArt, TIPP_TOLERANZ_PX } from "@core/lib/zeigen/strahlPick.js";
import { zweiFingerGeste } from "@core/lib/zeigen/zweiFinger.js";
import { useZeigerArt, TABLETT_PLATZ } from "@core/lib/zeigen/useZeigerArt.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { ansichtAlsPng } from "@core/lib/zeigen/ansichtBild.js";
import { hervorhebung } from "@core/lib/zeigen/hervorheben.js";
import { ZEIGE_ZUSTAENDE, ZEIGE_CSS_RAND } from "@core/lib/zeigen/zustaende.js";
import { bauteilInfoAus, bauteilSchluessel } from "@designer/lib/bauteilInfo.js";
import { auswahlBefehleRegistrieren } from "@core/lib/zeigen/auswahlBefehle.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
// 106-03: change tools - proposal, check, preview in words and at the model, confirmation, origin, undo per step.
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import PlanVorschau from "@core/components/zeigen/PlanVorschau.jsx";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { bauteilImModell, naechsteFreieIdx, transformZentrum } from "@core/lib/zeigen/aenderungen.js";
import { geisterMatrix, geisterKlon, schnittMarke, geisterEntsorgen } from "@core/lib/zeigen/geisterVorschau.js";
import { umrissLinie } from "@core/lib/zeigen/hervorheben.js";
import { AenderungsFeld } from "@core/components/zeigen/AenderungsVorschau.jsx";
// 106-05: speech and typed sentences at the model (grammar first, model fallback, confirmation only by the person).
import SprechFeld from "@core/components/zeigen/SprechFeld.jsx";
import { eingabeBefehlRegistrieren } from "@core/lib/zeigen/eingabe.js";
import { ANSICHT_GRUNDRISS, ansichtAusKamera } from "@core/lib/zeigen/ansichtRichtung.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import { bimBauteil, bimPerGuid, bimModellUebersicht, bimAuswahlKontext } from "@designer/lib/auswahlBim.js";
// 104-06: floor plan as DXF R12 (own writer, no dependency).
import { grundrissDxfDaten, dxfDatei, dxfDateiname, DXF_MIME } from "@designer/lib/dxfPlaene";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { fehlplanungPruefen } from "@core/lib/bauteil/pruefregeln.js";
// 107-04: sizes, host and height anchor of an opening come from this one file (3D hole, plan symbol, room module and IFC read the same numbers);
// the click in the plan and the click on a wall face in 3D create the record through the same function (neueOeffnung).
import { oeffnungsMasse, oeffnungMitte_m, oeffnungPasst, lochImWand, ankerFuerWand, wirtVon, neueOeffnung, wandPunkt, rechteckAufWand, deckenLochRechteck, durchbruchImWirt, durchbruchTiefe, lochInDecke, lochUeberlappt, istOeffnungOhneFuellung, BRUESTUNG_BEZUEGE, DURCHBRUCH_TIEFE_OHNE_WIRT_M } from "@core/lib/bauteil/oeffnungen.js";
import { bitApi } from "@core/api/bitApi";
import { useElevationGrid } from "@designer/lib/useElevationGrid";
import { useOsmBuildings } from "@designer/lib/useOsmBuildings";
import { useOsmEnvironment } from "@designer/lib/useOsmEnvironment";
import { createBuildingModel, footprintToMeters, modelBBox, aufbautenListe, compositeById, WINDOW_TYPES, windowTypeById, DOOR_TYPES, doorTypeById, openingTypeById, DEFAULT_FOOTPRINT } from "@core/lib/buildingModel";
import { Link } from "react-router-dom";
import { Sketch } from "@sketch/lib/sketchModel.js";
import { runSolve } from "@sketch/lib/solveCore.js";
import SketchGeometry from "@sketch/components/SketchGeometry.jsx";
import SketchEditOverlay from "./SketchEditOverlay.jsx";
import { autoEnvOpenings, ENTRANCE_DEFAULT } from "@designer/lib/autoOpenings";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import BimPlan2D from "@designer/components/BimPlan2D";
import { exportExposePng } from "@designer/components/MassingView3D";
import { exportIFC, WARNART_GESCHOSS, WARNART_DURCHBRUCH } from "@designer/lib/ifcExport";
import { useBuildingProgram, buildingProgram, fmtLen } from "@core/lib/useBuildingProgram";
import { werkstattBauteile } from "@core/lib/werkstattBauteile";
import { istGeneriert } from "@designer/lib/apartments";
import { istWerkstattZone } from "@designer/lib/tesselierung";

// 107-01: effective wall thickness, reference-line offset and corner fillers come from @core
// (bauteil/referenz.js: wandDicke_m, wandGeometrie, eckfueller) — one derivation for 3D, plan, PDF and IFC.

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
// 106-01: the selection is drawn in the 'auswahl' look of the state table (blue, solid outline), so
// it differs from the hover state 'fokus' (teal, dotted outline) in hue AND form. (Before: both teal.)
// The 2D plan (BimPlan2D) still draws its selection teal [open: unify with the 3D view].
const AURA_COLOR = parseInt(ZEIGE_ZUSTAENDE.auswahl.hex.slice(1), 16);
// Emissive fill of a selected mesh: the selection blue at 72 % [ASSUMED]: strong enough to read, weak enough to keep shading.
const AUSWAHL_EMISSIV = new THREE.Color(ZEIGE_ZUSTAENDE.auswahl.hex).multiplyScalar(0.72).getHex();

/** Pointer travel (px) below which hover does not pick again [ASSUMED]: sub-pixel jitter picks the same element. */
const HOVER_MIN_PX = 2;
/** Pause (ms) after the last wheel tick before hover looks again [ASSUMED]. */
const WHEEL_PAUSE_MS = 180;

// Kinds mit eigenem Material je Mesh — nur dort ist emissive gefahrlos.
const EMISSIVE_KINDS = new Set(["wall", "column", "zone", "cslab", "croof"]);

/** Layer a selection type lives on (a locked layer refuses the selection, by mouse and by command). */
const EBENE_VON_TYP = { wall: "walls", zone: "zones", slab: "shell", roof: "attika", hullwall: "shell", autowin: "openings", opening: "openings", column: "columns" };

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
  // 106-01: the hover tint lives on private material clones; give the originals back first,
  // otherwise the emissive written below would land on the clone and vanish with the hover.
  t.hoverLoeschen?.();
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
        m.material.emissive.setHex(isSel ? AUSWAHL_EMISSIV : 0x000000);
      }
      if (isSel) {
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(m.geometry),
          new THREE.LineBasicMaterial({ color: AURA_COLOR, transparent: true, opacity: 1, depthTest: false }),
        );
        line.renderOrder = 999;
        line.userData.zeigeHilfe = true; // 106-01: helper geometry, never a pick target
        line.userData.zeigeZustand = "auswahl";
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

/**
 * 107-03 (user decision 25.10.2026, naming of the reference line): the choices of a reference-line select, labelled by where the
 * LINE lies. The stored values stay (center / outside / inside / coreOutside / coreInside / coreCenter, old projects unchanged).
 * Drawn wall: "outside" = the body lies on the outer side of the line, so the line is on the INNER face of the whole layer stack;
 * "inside" = the other way round (107-01 summary, finding 1). Hull (`huelle_bezug`): "outside" = the footprint line is the
 * OUTER face of the hull wall, "inside" = the INNER face. The core values name the face of the core layer (the layer with the function
 * "kern", e.g. the concrete wall behind the insulation). The label texts go through `tz` (German source = key, EN in bauteilkern-107.js).
 * @param {(s: string) => string} tz translate function of the studio
 * @param {boolean} [huelle] true for the hull select (no core values; "outside"/"inside" mean the hull wall against the footprint line)
 * @returns {Array<[string, string, string]>} [stored value, label, tooltip]
 */
function bezugWahl(tz, huelle = false) {
  const linieInnen = [tz("Linie innen · Körper außen"), tz("Referenzlinie auf der Innenfläche des Schichtaufbaus, die Wand liegt auf der Außenseite der Linie")];
  const linieAussen = [tz("Linie außen · Körper innen"), tz("Referenzlinie auf der Außenfläche des Schichtaufbaus, die Wand liegt auf der Innenseite der Linie")];
  /** @type {Array<[string, string, string]>} */
  const wahl = [
    ["center", tz("Linie Mitte"), tz("Referenzlinie in der Mitte der Wand")],
    /** @type {[string, string, string]} */ (["outside", ...(huelle ? linieAussen : linieInnen)]),
    /** @type {[string, string, string]} */ (["inside", ...(huelle ? linieInnen : linieAussen)]),
  ];
  if (!huelle) wahl.push(
    ["coreOutside", tz("Kern außen"), tz("Referenzlinie auf der Außenfläche der Kernschicht")],
    ["coreInside", tz("Kern innen"), tz("Referenzlinie auf der Innenfläche der Kernschicht")],
    ["coreCenter", tz("Kern Mitte"), tz("Referenzlinie in der Mitte der Kernschicht")],
  );
  return wahl;
}

// Wand als Profil (Länge × Höhe) mit echten Öffnungen -> ExtrudeGeometry.
// Das ist die boolesche Subtraktion: die Löcher (openings:[{u,sill,width,height}])
// werden aus der Wand ausgeschnitten. thicknessOverride für Composite-Gesamtdicke.
function buildWallMeshWithHoles(w, material, openings, thicknessOverride, normalOffset) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
  const th = thicknessOverride || w.thickness || 0.3, H = w.height;
  // 107-01: normal and body offset from the one derivation (normalOffset = offset of one build-up layer)
  const g = wandGeometrie(w, { dicke_m: th });
  const nx = g.normale.x, nz = g.normale.z;
  const off = normalOffset != null ? normalOffset : g.versatz_m;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, H); shape.lineTo(0, H); shape.closePath();
  // 107-04: the hole of an opening has ONE rule (lochImWand: position kept in the wall like the IFC export, edge clearance at the sides and
  // 2 cm at bottom and top). An opening that does not fit is reported by the studio (oeffnungsProblemText), no longer clamped in silence.
  (openings || []).forEach(({ u, sill, width, height, rund }) => {
    const loch = lochImWand({ w: width, h: height, sill }, u, len, H);
    if (!loch) return;
    const p = new THREE.Path();
    // a round penetration (core drilling) is a circle in the wall plane, everything else a rectangle
    if (rund) p.absarc((loch.x0 + loch.x1) / 2, (loch.y0 + loch.y1) / 2, Math.min(loch.x1 - loch.x0, loch.y1 - loch.y0) / 2, 0, Math.PI * 2, false);
    else { p.moveTo(loch.x0, loch.y0); p.lineTo(loch.x1, loch.y0); p.lineTo(loch.x1, loch.y1); p.lineTo(loch.x0, loch.y1); p.closePath(); }
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

/**
 * 107-04: a wall as its build-up layers — one body per layer, the holes of the openings cut through ALL layers (spec I.4 Cut-Opening-Bridge).
 * One function for the drawn wall and, new, the hull wall (before, the hull was ONE body coloured by layer 1 only). The layers run from layer 1
 * along −n starting at the +n side of the body, the same convention as the plan (BimPlan2D wallSkinBands). [ASSUMED] "+n side = layer 1 = outer
 * face": true for a drawn wall by convention, but for the hull of the standard footprint n points INTO the building (buildingModel.js), so layer 1
 * lies on the inside there — plan and 3D agree, the order for the hull is open (107-04 review, noted in the SUMMARY, not changed here).
 * @param {any} w wall: a, b, height (m), elevation (m, lower edge), thickness/composite/refLine or the stored fields of a drawn wall
 * @param {{skins: Array<{thickness: number, color: string}>}} comp build-up (thickness in mm)
 * @param {Array<{u: number, sill: number, width: number, height: number}>} ops holes in m
 * @returns {THREE.Mesh[]} one mesh per layer (userData is set by the caller)
 */
function buildSchichtWand(w, comp, ops) {
  const g = wandGeometrie(w);
  let cur = g.versatz_m + g.dicke_m / 2;
  return comp.skins.map((sk) => {
    const tk = sk.thickness / 1000; const mid = cur - tk / 2; cur -= tk;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(sk.color), roughness: 0.9 });
    return buildWallMeshWithHoles(w, mat, ops, Math.max(0.01, tk), mid);
  });
}

// Öffnungstyp (für buildGlazing) aus einer Regel-Öffnung mit expliziten Maßen.
/** Copy of an opening record without its host GUID: a copy that moves to a duplicated wall must not keep the GUID of the ORIGINAL wall (107-04 review). */
const ohneWirtGuid = (/** @type {any} */ o) => { const { wirt_guid: _weg, ...rest } = o; return rest; };

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
  const { t: tz } = useI18n(); // 73-07: inspector rows for condition / Erfassungsgrad
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
  // 106-01 hover: refs only — no React render per frame, the overlay DOM is written directly.
  const hoverRef = useRef(/** @type {Record<string, any>|null} */ (null)); // identity under the pointer
  const hoverBoxRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const hoverTextRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const hoverZustandRef = useRef(/** @type {HTMLSpanElement|null} */ (null)); // overlay state line (words)
  const hoverSymbolRef = useRef(/** @type {HTMLSpanElement|null} */ (null)); // overlay swatch (colour AND outline form)
  // The 2D plan for the raster section export (was found by scraping divs for height 520 px).
  const planWrapRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  // Mutable three.js handle bag (scene, camera, groups, callbacks) — filled in the
  // mount effect, never a render dependency. Keys are open on purpose (87-09).
  const three = useRef(/** @type {Record<string, any>} */ ({}));
  const orbit = useRef(/** @type {Record<string, any>} */ ({ on: false, x: 0, y: 0, theta: 0.7, phi: 1.0, radius: 70 }));
  // 106-07: kind of the last pointer on the canvas and the two-finger steps seen (for the test hook)
  const zeigerArtRef = useRef(/** @type {"mouse"|"pen"|"touch"|null} */ (null));
  const gestenSummeRef = useRef({ schritte: 0, drehungRad: 0, faktor: 1 });
  // 106-07: tablet layout (finger or pen in use) and the right to change the model (rechte.js, module "modell")
  const { grob } = useZeigerArt();
  const darfAendern = useZugriff().darf("modell", "voll");

  // Gemeinsame Quelle (Massing-Studio ↔ Gebäudemodell ↔ Kennzahlen): Footprint/Geschosse/Höhe/Einheit
  const bp = useBuildingProgram();
  const storeys = bp.storeys, setStoreys = (v) => bp.set({ storeys: v });
  const storeyHeight = bp.storeyHeight;
  // 107-02 (D-BK-05): optional storey table [{level, name, hoehe_m}] (programme field `geschosse`, null = one height for all storeys) and the
  // storey source `gs` that every elevation and wall height below is read through. The single height input sets ALL storeys.
  const geschosse = bp.geschosse || null;
  const gs = useMemo(() => geschosseAus({ geschosse, storeyHeight }), [geschosse, storeyHeight]);
  // One writer for both studios (107-02 review fix): the number and the table rows can never disagree, and a storey that is not a table row yet
  // (the user raised the storey count after the table was made) gets a row instead of snapping back (see hoehen.js patchGeschosshoehe).
  const setStoreyHeight = (v) => bp.setAlleGeschosshoehen(v);
  /** Sets the height of ONE storey (m); the first call creates the table from storeys × storeyHeight. */
  const setGeschossHoehe = (level, v) => bp.setGeschosshoehe(level, v);
  const unit = bp.unit || "m", setUnit = (u) => bp.set({ unit: u });
  const [view, setView] = useState("3d"); // 3d | grundriss | schnitt
  // 97-03: lens per view (plan, section), remembered per viewer in the browser — a view setting,
  // never part of the model. Storage may be blocked (private window): then the input lens.
  const [brillen, setBrillen] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("bit.brillen") || "{}") || {}; } catch { return {}; }
  });
  const brilleId = brillen[view] || STANDARD_BRILLE;
  const swPlan = !!brillen.sw; // 97-04b: S/W variant of the permit lens (same storage entry)
  const setSwPlan = (v) => setBrillen((alt) => {
    const neu = { ...alt, sw: v };
    try { window.localStorage.setItem("bit.brillen", JSON.stringify(neu)); } catch { /* storage blocked: keep in memory */ }
    return neu;
  });
  const setBrille = (id) => setBrillen((alt) => {
    const neu = { ...alt, [view]: id };
    try { window.localStorage.setItem("bit.brillen", JSON.stringify(neu)); } catch { /* storage blocked: keep in memory */ }
    return neu;
  });
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
  // 107-02 review: thickness (m) and reference side of the HULL slabs (fields `huelle_decke_dicke_m` / `huelle_decke_bezug`; defaults 0.25 m "unten" = as before)
  const [huelleDeckeDicke, setHuelleDeckeDicke] = useState(/** @type {number} */ (DECKEN_STANDARD.huelle.dicke_m));
  const [huelleDeckeBezug, setHuelleDeckeBezug] = useState(/** @type {"oben"|"unten"} */ (DECKEN_STANDARD.huelle.bezug));
  const [huelleBezug, setHuelleBezug] = useState("center"); // 107-01 (D-BK-02): Referenzlinie der Hüllwände center | outside | inside, Feld `huelle_bezug`
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
  const [statikLayer, setStatikLayer] = useState(null); // 97-02a: beams (statik_layer) read-only for the IFC export
  const [attributLayer, setAttributLayer] = useState(null); // 97-02: decisions on hull/workshop elements (bauteil_attribute_layer)
  const [massingLayer, setMassingLayer] = useState(null); // 98-05: bodies of the Massing Studio, read only for the IFC export
  const [durchbrueche, setDurchbrueche] = useState(/** @type {any[]} */ ([])); // 97-06: openings planning, read only for the checks
  const [customSlabs, setCustomSlabs] = useState([]); // Decken: [{points,level,_idx}]
  const [customRoofs, setCustomRoofs] = useState([]); // Dächer: [{points,level,pitch,_idx}]
  const [sketchJson, setSketchJson] = useState(null); // PW-05: Sketch aus dem BIT Sketcher (read-only Overlay)
  const [winType, setWinType] = useState("double"); // aktueller Fenstertyp
  const [doorType, setDoorType] = useState("single"); // aktueller Türtyp
  const [draft, setDraft] = useState([]); // aktuelle Wand-Kette (Meter-Punkte)
  const [hover, setHover] = useState(null);
  const [selected, setSelectedState] = useState(null); // {type,index}
  const [multiSel, setMultiSelState] = useState([]); // Mehrfachauswahl aus Markierungsrahmen: [{type,index,...}]
  // 106-02: synchronous mirror of the selection. React state lands one render later, so two commands in the same
  // tick ("auswahl-guid", then "ansicht-auf-auswahl") would otherwise read the old selection; every write goes
  // through these two setters (stable like state setters), the commands read the ref.
  const auswahlRef = useRef(/** @type {{selected: any, multiSel: any[]}} */ ({ selected: null, multiSel: [] }));
  const setSelected = useCallback((/** @type {any} */ v) => {
    auswahlRef.current.selected = typeof v === "function" ? v(auswahlRef.current.selected) : v;
    setSelectedState(v);
  }, []);
  const setMultiSel = useCallback((/** @type {any} */ v) => {
    auswahlRef.current.multiSel = typeof v === "function" ? v(auswahlRef.current.multiSel) : v;
    setMultiSelState(v);
  }, []);
  const [hint, setHint] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null); // {x,y,hit:{kind,id}}
  const [wallComp, setWallComp] = useState("single24"); // Standard-Aufbau für neue Wände
  const idRef = useRef(1);
  // 107-04: first corner of a rectangle drawn on a wall face or slab in 3D (tool "oeffnung"): { schluessel, p: {u, v} | {x, z}, art }
  const ecke3dRef = useRef(/** @type {any} */ (null));
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
  // 107-03 (D-BK-22): build-ups of the project (fachlayer aufbauten_layer, Version 1). compositeById/aufbauVon ask this registry first, so it is
  // handed over on every render (idempotent, module-level state outside React); `aufbautenKey` lets the memos and 3D effects that depend on layer
  // thicknesses rebuild when a project build-up is edited.
  const [aufbautenLayer, setAufbautenLayer] = useFachlayer(projectId, "aufbauten_layer", AUFBAUTEN_LEER);
  // set while rendering (before the children read it), once per layer value; released again on unmount so the ids "p-1" … of this project
  // never resolve in the next one (the effect also re-sets it: React StrictMode runs effect cleanups once on mount)
  useMemo(() => setzeProjektAufbauten(aufbautenLayer), [aufbautenLayer]);
  useEffect(() => { setzeProjektAufbauten(aufbautenLayer); return () => gibProjektAufbautenFrei(aufbautenLayer); }, [aufbautenLayer]);
  const aufbautenKey = useMemo(() => JSON.stringify(aufbautenLayer?.aufbauten || {}), [aufbautenLayer]);
  // 97-06: openings of the project for the checks (read only; written in Werkplanung › Durchbrüche).
  useEffect(() => {
    let aktiv = true;
    if (!projectId) { setDurchbrueche([]); return undefined; }
    bitApi.entities.Durchbruch.filter({ project_id: projectId })
      .then((rows) => { if (aktiv) setDurchbrueche(Array.isArray(rows) ? rows : []); })
      .catch((err) => { if (aktiv) { setDurchbrueche([]); setHint(`Durchbrüche für die Prüfregeln nicht geladen: ${err?.message || err}`); } });
    return () => { aktiv = false; };
  }, [projectId]);
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
          setCustomRoofs((m.customRoofs || []).map(dachMigrieren)); // 107-02: old roofs (only `pitch`, metres) get firsthoehe_m
          if (m.envComposite !== undefined) setEnvComposite(m.envComposite);
          if (m.envThickness) setEnvThickness(m.envThickness);
          setHuelleBezug(m.huelle_bezug === "outside" || m.huelle_bezug === "inside" ? m.huelle_bezug : "center");
          setHuelleDeckeDicke(Number(m.huelle_decke_dicke_m) > 0 ? Number(m.huelle_decke_dicke_m) : DECKEN_STANDARD.huelle.dicke_m);
          setHuelleDeckeBezug(m.huelle_decke_bezug === "oben" ? "oben" : DECKEN_STANDARD.huelle.bezug);
          if (m.parapet) setParapet(m.parapet);
          if (m.dachform) setDachform(m.dachform);
          if (m.dachneigung != null) setDachneigung(m.dachneigung);
          if (m.entranceCfg) setEntranceCfg({ ...ENTRANCE_DEFAULT, ...m.entranceCfg });
          // PW-05: Sketch des Projekts (BIT Sketcher, Feld sketch_layer) —
          // read-only Anzeige im Grundriss; geschrieben wird NUR im Sketcher.
          setSketchJson(m.sketch_layer || null);
          // Phase 41: TGA-Netz für den IFC-Export (IfcPipe-/Duct-/CableSegment) — geschrieben wird es nur im Haustechnik-Reiter.
          setNetzLayer(m.netz_layer || null);
          setStatikLayer(m.statik_layer || null);
          setAttributLayer(m.bauteil_attribute_layer || null);
          setMassingLayer(m.massing_layer || null);
          // Programmfelder (footprintM/storeys/storeyHeight/unit) setzt der Hook
          // useBimModelSync in die gemeinsame Quelle — hier NICHT doppelt.
          // _idx-Zähler hinter die geladenen Elemente setzen (keine Kollisionen)
          const maxIdx = Math.max(0, ...[...(m.customWalls || []), ...(m.customColumns || []), ...(m.customWindows || []), ...(m.envOpenings || []), ...(m.customZones || []), ...(m.customSlabs || []), ...(m.customRoofs || [])].map((x) => x._idx || 0));
          idRef.current = maxIdx + 1;
        } else {
          // Neues Projekt ohne Modell: Editor leeren (kein Übertrag vom Vorprojekt)
          setCustomWalls([]); setCustomColumns([]); setCustomWindows([]); setEnvOpenings([]); setNetzLayer(null); setStatikLayer(null); setAttributLayer(null); setMassingLayer(null);
          setCustomZones([]); setCustomSlabs([]); setCustomRoofs([]);
          setHuelleBezug("center");
          setHuelleDeckeDicke(DECKEN_STANDARD.huelle.dicke_m); setHuelleDeckeBezug(DECKEN_STANDARD.huelle.bezug);
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
          envComposite, envThickness, huelle_bezug: huelleBezug, huelle_decke_dicke_m: huelleDeckeDicke, huelle_decke_bezug: huelleDeckeBezug, parapet, dachform, dachneigung, entranceCfg,
          customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs,
        });
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 1200);
    return () => clearTimeout(t);
  }, [projectId, envComposite, envThickness, huelleBezug, huelleDeckeDicke, huelleDeckeBezug, parapet, dachform, dachneigung, entranceCfg, customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs]);

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
    () => createBuildingModel({ footprintM: footprint, storeys, storeyHeight, parapet, wallThickness: envThickness, wallComposite: envComposite, huelleBezug, geschosse, deckenDicke: huelleDeckeDicke, deckenBezug: huelleDeckeBezug }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [footprint, storeys, storeyHeight, parapet, envThickness, envComposite, huelleBezug, geschosse, huelleDeckeDicke, huelleDeckeBezug, aufbautenKey],
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
    () => envOpenings.map((o) => ({ level: o.level, edge: o.edge, u: o.u, width: oeffnungsMasse(o).w })), // 107-04: own width of the opening first
    [envOpenings],
  );
  const autoOpenings = useMemo(
    () => autoEnvOpenings(model.walls, { entrance: entranceCfg }, placedEnv),
    [model, entranceCfg, placedEnv],
  );

  // ---- 107-04: opening chain (host, sizes, height anchor, new opening) ----
  // The walls an opening can sit in (drawn + hull walls), for wirtVon() — the ONE host resolver (also used by the IFC export).
  const wirtModell = useMemo(() => ({ customWalls, huelle: model.walls, werkstatt: null, projektId: projectId || null, geschosse: gs }), [customWalls, model, projectId, gs]);
  /** Stores a record made by neueOeffnung() in its array (the plan click and the 3D click both end here). */
  const oeffnungSetzen = ({ scope, satz }) => (scope === "env" ? setEnvOpenings : setCustomWindows)((os) => [...os, satz]);
  /**
   * Sizes of an opening on its wall (own width/height/sill first, then the type), the sill converted to the wall bottom when the opening names
   * another height anchor (bruestung_bezug okrd/okff: the floor slab of the storey below is looked up). 3D, plan and checks read this.
   * @param {any} o opening record
   * @param {{a: {x: number, z: number}, b: {x: number, z: number}, level?: number}} w its wall
   * @param {number} unterkante_m bottom edge of the wall in m
   */
  const masseAmWand = (o, w, unterkante_m) => {
    if (o.bruestung_bezug !== "okrd" && o.bruestung_bezug !== "okff") return oeffnungsMasse(o);
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1, u = o.u ?? len / 2;
    const punkt = { x: w.a.x + ((w.b.x - w.a.x) / len) * u, z: w.a.z + ((w.b.z - w.a.z) / len) * u };
    return oeffnungsMasse(o, ankerFuerWand({ level: w.level || 0, unterkante_m }, gs, { huelle: model.slabs, gezeichnet: customSlabs }, punkt));
  };
  /** The type object of an opening with its own sizes laid over it (columns, rows, glass from the type) — what buildGlazing needs. */
  const typAmWand = (o, w, unterkante_m) => ({ ...openingTypeById(o.kind, o.typeId), ...masseAmWand(o, w, unterkante_m) });
  // Executed penetrations of the openings planning that lie IN their host wall (drawn or hull): a hole through all layers, like an opening without a filling.
  // The host is found by its GUID (bauteil_guid); u = x/y projected on the wall axis, the sill from z (middle) minus half the height.
  const durchbruchLoecher = useMemo(() => durchbrueche.flatMap((d) => {
    if (d?.status !== "ausgefuehrt") return [];
    const wirt = wirtVon(d, wirtModell);
    if (!wirt || (wirt.familie !== "gezeichnet" && wirt.familie !== "huelle")) return [];
    if (!durchbruchImWirt(d, wirt).innen) return []; // like the IFC export: one that misses its host stays a provision (marker) and is named by check 12
    if (durchbruchTiefe(d, wirt)) return []; // a slot (t < wall thickness) is a recess, not a hole through every layer: shown as a marker (durchbruchVormerkungen)
    const rund = d.form === "rund", b = Number(rund ? d.d : d.b), h = Number(rund ? d.d : d.h);
    if (!(b > 0) || !(h > 0) || wirt.u == null || !Number.isFinite(Number(d.z))) return [];
    return [{ schluessel: wirt.schluessel, u: wirt.u, sill: Number(d.z) - h / 2 - wirt.wand.unterkante_m, width: b, height: h, rund }];
  }), [durchbrueche, wirtModell]);
  // Planned penetrations (and executed ones that miss their host): translucent boxes at their place, so they can be seen against the wall (no hole).
  const durchbruchVormerkungen = useMemo(() => durchbrueche.flatMap((d) => {
    if (!d || d.status === "abgelehnt") return [];
    const rund = d.form === "rund", b = Number(rund ? d.d : d.b), h = Number(rund ? d.d : d.h);
    if (!(b > 0) || !(h > 0) || ![d.x, d.y, d.z].every((v) => v != null && Number.isFinite(Number(v)))) return [];
    const wirt = wirtVon(d, wirtModell);
    if (d.status === "ausgefuehrt" && wirt && (wirt.familie === "gezeichnet" || wirt.familie === "huelle") && durchbruchImWirt(d, wirt).innen && !durchbruchTiefe(d, wirt)) return []; // that one is a hole (durchbruchLoecher)
    const tiefe = Number(d.t) > 0 ? Number(d.t) : wirt ? wirt.wand.dicke_m + 0.04 : DURCHBRUCH_TIEFE_OHNE_WIRT_M;
    const ang = wirt ? Math.atan2(wirt.wand.b.z - wirt.wand.a.z, wirt.wand.b.x - wirt.wand.a.x) : 0;
    return [{ nr: d.nr || d.id, x: Number(d.x), y: Number(d.z), z: Number(d.y), b, h, tiefe, ang, rund }];
  }), [durchbrueche, wirtModell]);
  // Openings that do not fit their wall (the IFC export leaves them out, with this very text): the 3D hole is clamped to the wall and the user is told —
  // no silent clamp any more (107-04). The hint is cleared again only when it is still ours.
  const oeffnungsProblemText = useMemo(() => {
    /** @type {string[]} */
    const out = [];
    const f2 = (/** @type {number} */ v) => v.toFixed(2);
    const pruefe = (/** @type {any} */ o, /** @type {any} */ wirt, /** @type {string} */ ort) => {
      if (!wirt) return;
      const r = oeffnungPasst(masseAmWand(o, wirt.wand, wirt.wand.unterkante_m), wirt.wand.laenge_m, wirt.wand.hoehe_m);
      if (r.ok) return;
      const wo = tz(o.kind === "door" ? "Tür auf {{ort}}" : o.kind === "oeffnung" ? "Öffnung auf {{ort}}" : "Fenster auf {{ort}}").replace("{{ort}}", ort);
      out.push(tz("{{wo}}: {{b}}×{{h}} m (Brüstung {{sill}} m) passt nicht in die Wand ({{l}}×{{hw}} m)").replace("{{wo}}", wo)
        .replace("{{b}}", f2(r.daten.w)).replace("{{h}}", f2(r.daten.h)).replace("{{sill}}", f2(r.daten.sill)).replace("{{l}}", f2(r.daten.laenge)).replace("{{hw}}", f2(r.daten.hoehe)));
    };
    customWindows.forEach((o) => pruefe(o, wirtVon(o, wirtModell), tz("Wand {{wand}}").replace("{{wand}}", String(o.wallIdx))));
    envOpenings.forEach((o) => pruefe(o, wirtVon(o, wirtModell), tz("Hüllwand {{ebene}}/{{kante}}").replace("{{ebene}}", String(o.level)).replace("{{kante}}", String(o.edge))));
    return out.length ? `${out[0]}${out.length > 1 ? ` (+${out.length - 1})` : ""} — ${tz("im 3D auf die Wand begrenzt, im IFC nicht enthalten")}` : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWindows, envOpenings, wirtModell, model, customSlabs, gs, tz]);
  // The text is the memo result (a string), so the effect fires only when the TEXT changes — not on every recompute of the model. The old value
  // is read into a local before the ref is overwritten: the state updater may run later (render phase, StrictMode) and must compare with it.
  const problemHinweisRef = useRef("");
  useEffect(() => {
    const vorher = problemHinweisRef.current;
    problemHinweisRef.current = oeffnungsProblemText;
    setHint((h) => (oeffnungsProblemText ? oeffnungsProblemText : h && h === vorher ? "" : h));
  }, [oeffnungsProblemText]);

  // ---- Werkzeug wählen ----
  const FUNCTIONAL = ["arrow", "wall", "column", "window", "door", "oeffnung", "zone", "slab", "roof", "section"]; // bereits aktiv
  const selectTool = (id) => {
    setSelected(null); setMultiSel([]); setDraft([]); setHover(null); setHint("");
    ecke3dRef.current = null; // 107-04: a half-drawn 3D rectangle is dropped with the tool
    if (id === "section") { setView("schnitt"); setTool("arrow"); return; }
    if (!FUNCTIONAL.includes(id)) { setHint(`Werkzeug „${id}" kommt in einer späteren Welle.`); return; }
    setTool(id);
    // Zeichnen passiert im Grundriss — except windows, doors and wall openings: they also go onto a wall face in 3D (107-04, Glue-To)
    if (id !== "arrow" && view === "3d" && id !== "window" && id !== "door" && id !== "oeffnung") setView("grundriss");
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
      { id: "oeffnung", label: "Öffnung", icon: SquareDashed },
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
        setCustomWalls((ws) => [...ws, { a, b: p, level: Math.min(planLevel, storeys - 1), thickness: 0.3, height: storeyHeight, oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: 0, refLine: wallRef, composite: wallComp, _idx: idRef.current++ }]);
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
    } else if (tool === "window" || tool === "door" || tool === "oeffnung") {
      // Fenster/Tür/Öffnung auf das nächstgelegene Wandsegment setzen (107-04: the record comes from neueOeffnung, like the click on a wall face in 3D)
      const kind = tool;
      const typeId = kind === "door" ? doorType : kind === "window" ? winType : "oeffnung";
      const lvl = Math.min(planLevel, storeys - 1);
      let best = /** @type {{scope: string, w: any, u: number, len: number}|null} */ (null), bestD = 1e9;
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
        const wirt = wirtVon(best.scope === "custom" ? { wallIdx: best.w._idx } : { level: best.w.level, edge: best.w.edge }, wirtModell);
        if (wirt) oeffnungSetzen(neueOeffnung({ wirt, u: best.u, kind, typeId, idx: idRef.current++ }));
      } else { setHint("Kein Wandsegment in der Nähe."); }
    }
  };
  const onFinish = () => {
    const lvl = Math.min(planLevel, storeys - 1);
    if (draft.length >= 3) {
      const pts = draft.map((p) => ({ x: p.x, z: p.z }));
      if (tool === "zone") setCustomZones((zs) => [...zs, { points: pts, level: lvl, name: `Raum ${zs.length + 1}`, _idx: idRef.current++ }]);
      else if (tool === "slab") setCustomSlabs((ss) => [...ss, { points: pts, level: lvl, _idx: idRef.current++ }]);
      else if (tool === "roof") setCustomRoofs((rs) => [...rs, { points: pts, level: lvl, pitch: 2.5, firsthoehe_m: 2.5, _idx: idRef.current++ }]);
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
    const layerId = EBENE_VON_TYP[sel.type] || "walls";
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
    const half = oeffnungsMasse(o).w / 2; // 107-04: own width first
    const u = Math.max(half + 0.1, Math.min(pr.t * pr.len, pr.len - half - 0.1));
    return { ...o, u };
  }));
  const undoLast = () => {
    // letzte gezeichnete Wand bzw. Stütze entfernen (nach _idx)
    const lastW = customWalls[customWalls.length - 1];
    const lastC = customColumns[customColumns.length - 1];
    // 106-03: an element a change step made or changed carries the step's mark (geaendert_durch). Removing it here would
    // undo a split only halfway (part B gone, part A stays short) while the change history still lists the step as active.
    const ziel = (lastW?._idx || 0) >= (lastC?._idx || 0) && lastW ? lastW : lastC;
    if (ziel?.geaendert_durch) { setHint(tz("Dieses Bauteil gehört zu einem Änderungsschritt — im Änderungsverlauf zurücknehmen")); return; }
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
        if (Array.isArray(o.oeffnungen)) copy.oeffnungen = o.oeffnungen.map((l) => ({ ...l, points: shiftPts(l.points || []) })); // 107-04: the holes of a slab move with its copy
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
        const half = (oeffnungsMasse(o).w || 1) / 2;
        const u = onCopiedWall ? o.u : Math.max(half + 0.1, Math.min(o.u + OFF, Math.max(half + 0.1, len - half - 0.1)));
        newWins.push({ ...(onCopiedWall ? ohneWirtGuid(o) : o), wallIdx: onCopiedWall ? wallMap.get(o.wallIdx) : o.wallIdx, u, _idx: nIdx });
        newSel.push({ type: "opening", index: nIdx, scope: "custom" });
      }
    });
    // Öffnungen auf duplizierten Wänden mitkopieren (auch wenn nicht einzeln ausgewählt)
    if (wallMap.size) customWindows.forEach((o) => {
      if (wallMap.has(o.wallIdx) && !list.some((m) => m.type === "opening" && (m.scope || "custom") === "custom" && m.index === o._idx)) {
        newWins.push({ ...ohneWirtGuid(o), wallIdx: wallMap.get(o.wallIdx), _idx: idRef.current++ });
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
    // 107-04: the holes of a slab (`oeffnungen`) move with it
    const movePts = (setter, set) => setter((a) => a.map((x) => set.has(x._idx) ? { ...x, points: x.points.map((p) => ({ x: rnd(p.x + dx), z: rnd(p.z + dz) })), ...(Array.isArray(x.oeffnungen) ? { oeffnungen: x.oeffnungen.map((l) => ({ ...l, points: (l.points || []).map((p) => ({ x: rnd(p.x + dx), z: rnd(p.z + dz) })) })) } : {}) } : x));
    const z = ids("zone"); if (z.size) { moved = true; movePts(setCustomZones, z); }
    const s = ids("slab"); if (s.size) { moved = true; movePts(setCustomSlabs, s); }
    const r = ids("roof"); if (r.size) { moved = true; movePts(setCustomRoofs, r); }
    return moved;
  };

  // ---- BIM-C: BBox der Auswahl (Meter, inkl. Höhen für das 3D-Target) ----
  const selectionBBox = (liste) => {
    const list = Array.isArray(liste) ? liste : currentSelection(); if (!list.length) return null; // onClick passes an event: only a real list counts
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    const add = (x, z, y0 = 0, y1 = 0) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
    };
    list.forEach((m) => {
      if (m.type === "wall") {
        const w = customWalls.find((x) => x._idx === m.index); if (!w) return;
        const y0 = unterkante(w, gs), h = wandHoehe(w, gs);
        add(w.a.x, w.a.z, y0, y0 + h); add(w.b.x, w.b.z, y0, y0 + h);
      } else if (m.type === "column") {
        const cc = customColumns.find((x) => x._idx === m.index); if (!cc) return;
        const y0 = unterkante(cc, gs), h = (cc.size || 0.4) / 2, hs = stuetzenHoehe(cc, gs);
        add(cc.x - h, cc.z - h, y0, y0 + hs); add(cc.x + h, cc.z + h, y0, y0 + hs);
      } else if (m.type === "hullwall") {
        // 106-02: a generated hull wall is addressable by GUID, so the view can frame it too
        const w = model.walls.find((x) => x.level === m.level && x.edge === m.edge); if (!w) return;
        const y0 = w.elevation ?? elevationOf(w.level || 0, gs);
        add(w.a.x, w.a.z, y0, y0 + (w.height || geschosshoehe(w.level || 0, gs))); add(w.b.x, w.b.z, y0, y0 + (w.height || geschosshoehe(w.level || 0, gs)));
      } else if (m.type === "opening") {
        const scope = m.scope || "custom";
        const o = (scope === "env" ? envOpenings : customWindows).find((x) => x._idx === m.index); if (!o) return;
        const w = scope === "env" ? model.walls.find((x) => x.level === o.level && x.edge === o.edge) : customWalls.find((x) => x._idx === o.wallIdx);
        if (!w) return;
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const y0 = elevationOf(w.level || 0, gs);
        add(w.a.x + ((w.b.x - w.a.x) / len) * o.u, w.a.z + ((w.b.z - w.a.z) / len) * o.u, y0, y0 + geschosshoehe(w.level || 0, gs));
      } else {
        const arr = m.type === "zone" ? customZones : m.type === "slab" ? customSlabs : customRoofs;
        const o = arr.find((x) => x._idx === m.index); if (!o?.points) return;
        const y0 = elevationOf(o.level || 0, gs);
        const y1 = m.type === "roof" ? elevationOf((o.level || 0) + 1, gs) + dachFirsthoehe_m(o) : y0 + geschosshoehe(o.level || 0, gs);
        o.points.forEach((p) => add(p.x, p.z, y0, y1));
      }
    });
    return isFinite(minX) ? { minX, maxX, minZ, maxZ, minY, maxY } : null;
  };
  // ---- BIM-C: Zoom auf Auswahl (F) — 2D via Fokus-Prop, 3D via Orbit-Target ----
  const zoomToSelection = (liste) => {
    const bbSel = selectionBBox(liste);
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
    const detail = composite ? (compositeById(composite)?.name || "")
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
      customZones, customSlabs, customRoofs: customRoofs.map(dachMigrieren), storeyHeight, geschosse, // 107-02: a roof with only `pitch` is read as ridge rise in m, whatever path created it
      netz: netzLayer, // Phase 41 (NETZ-05): Leitungen als Segment-Elemente
      // 97-02a: every element with its data sheet (stable GUID, Pset_BIT_Bauteil, material, DIN 276); beams from statik_layer.
      // 107-03: schichtdetails = layer Category/Priority, LayerSetUsage, material psets
      steckbrief: { projektId: projectId || null, schichtdetails: true }, tragwerk: statikLayer, bauteilAttribute: attributLayer,
      massing: massingLayer, // 98-05: Massing-Studio bodies (proxies) and groups (assemblies)
      durchbrueche, // 107-04: penetrations of the openings planning (provision proxies / voids in the host wall)
      // 89-03: workshop walls/doors/rooms with stable GUIDs and Pset_BIT_Bauteil (store zones).
      werkstatt: werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }),
      projectName: project?.name || "BIT-Atelier",
      onWarn: (msg, art, daten) => meldungen.push({ msg, art, daten }),
    });
    // Nicht exportierbare Öffnungen offen benennen statt still zu schlucken.
    // 107-02: the export also warns about elements on a storey the model does not have; those are no missing openings, so they are
    // named separately. The kind comes from the structured `art` of onWarn (not from the wording) and the text is built here through tz().
    const geschossHinweise = meldungen.filter((m) => m.art === WARNART_GESCHOSS)
      .map((m) => tz("Element auf Geschoss {{level}}: das Modell hat dieses Geschoss nicht — im {{ziel}} abgelegt.").replace("{{level}}", String(m.daten?.level)).replace("{{ziel}}", String(m.daten?.ziel)));
    const durchbruchHinweise = meldungen.filter((m) => m.art === WARNART_DURCHBRUCH).map((m) => m.msg);
    const oeffnungen = meldungen.filter((m) => m.art !== WARNART_GESCHOSS && m.art !== WARNART_DURCHBRUCH).map((m) => m.msg);
    setHint([
      oeffnungen.length ? `IFC exportiert — ${oeffnungen.length} Öffnung(en) NICHT enthalten: ${oeffnungen[0]}${oeffnungen.length > 1 ? " …" : ""}` : "",
      geschossHinweise.length ? `${geschossHinweise[0]}${geschossHinweise.length > 1 ? " …" : ""}` : "",
      durchbruchHinweise.length ? `${durchbruchHinweise[0]}${durchbruchHinweise.length > 1 ? " …" : ""}` : "",
    ].filter(Boolean).join(" · "));
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
  // One source for the vector PDF (97-09) and the DXF (104-06): the plan primitives of the
  // current storey with the lens applied.
  const aktuelleGrafik = () => {
    const brille = brilleVon(brilleId);
    const lvl = Math.min(planLevel, storeys - 1);
    const grafik = planGrafik({ model, level: lvl, customWalls: sichtbarUnter(brille, customWalls), customColumns: sichtbarUnter(brille, customColumns),
      customSlabs: sichtbarUnter(brille, customSlabs), customRoofs: sichtbarUnter(brille, customRoofs), customZones, brille,
      huelleStatus: zeigtStatus(brille, attributeVon(attributLayer, "hull-wall")?.status) ? attributeVon(attributLayer, "hull-wall")?.status ?? null : null, massstab: scale, sw: swPlan,
      // Print what the plan shows: the layer switches and the workshop walls (same inputs as BimPlan2D).
      layerVis: zeigtStatus(brille, attributeVon(attributLayer, "hull-wall")?.status) ? layerVis : { ...layerVis, shell: false },
      werkstattWaende: attributLayer?.attribute ? sichtbarUnter(brille, werkstattMitAttributen(werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }), attributLayer).waende || []) : null });
    return { grafik, brille, lvl };
  };
  // 104-06: the current floor plan as DXF R12 (layers A_WAND, A_STUETZE, A_DECKE …, metres).
  const exportPlanDXF = () => {
    if (view !== "grundriss") { setHint(tz("DXF nur aus dem Grundriss — bitte Ansicht Grundriss wählen.")); return; }
    try {
      const { grafik, lvl } = aktuelleGrafik();
      const geschoss = model.storeys[lvl]?.name || `${lvl}`;
      const daten = grundrissDxfDaten(grafik, { massstab: scale, geschoss, projekt: project?.name || "" });
      if (daten.leer) { setHint(tz("Keine Zeichnung auf diesem Geschoss.")); return; }
      const { bytes, uebersprungen } = dxfDatei(daten);
      dateiAnbieten(bytes, dxfDateiname(project?.name || "", `Grundriss_${geschoss}`), DXF_MIME);
      setHint(tz("Grundriss als DXF erstellt (R12, Meter, Ebenen je Bauteil).") + (uebersprungen ? ` ${uebersprungen} ${tz("Objekt(e) ohne gültige Koordinaten ausgelassen.")}` : ""));
    } catch (e) { setHint(`${tz("DXF-Export fehlgeschlagen")}: ${e?.message || e}`); }
  };
  const exportPlanPDF = async () => {
    if (view === "3d") { setHint("PDF-Plan nur aus Grundriss/Schnitt — bitte 2D-Ansicht wählen."); return; }
    // 97-09 floor plan / 100-01 section: VECTOR at true scale from the model data (lens applied, status
    // colours, ISO 128 line weights, title block with lens and legend; the section with level marks).
    // Before 100-01 the section was a stretched screen image stamped "nicht maßstäblich".
    try {
      const { grafik, brille, lvl } = aktuelleGrafik();
      const huelleStatus = attributeVon(attributLayer, "hull-wall")?.status ?? null;
      const g = view === "schnitt"
        // same layer choice as the screen: a lens that hides the hull hides the shell (BimPlan2D planLayerVis)
        ? schnittGrafik({ model, storeyHeight, layerVis: zeigtStatus(brille, huelleStatus) ? layerVis : { ...layerVis, shell: false }, brille,
          huelleStatus: zeigtStatus(brille, huelleStatus) ? huelleStatus : null, sw: swPlan, massstab: scale })
        : grafik;
      const planinhalt = view === "schnitt" ? "Schnitt" : `Grundriss ${model.storeys[lvl]?.name || ""}`.trim();
      const { bytes, format } = await vektorPlanPdf(g, { massstab: scale, projekt: project?.name || "", planinhalt, brille, datum: new Date().toLocaleDateString("de-DE") });
      const url = URL.createObjectURL(new Blob([/** @type {any} */ (bytes)], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${(project?.name || "plan").replace(/[^\w-]+/g, "_")}_${planinhalt.replace(/[^\w-]+/g, "_")}_1-${scale}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      // Rule 7 (concept §5): the lens has its own scale — say so when the sheet differs.
      setHint(brille.massstab !== scale
        ? `PDF 1:${scale} (${format}) erstellt — Hinweis: die Brille „${brille.label}“ ist für 1:${brille.massstab} gedacht.`
        : `PDF 1:${scale} (${format}) erstellt — maßstäblich, Vektor.`);
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
      if (e.key === "Escape") { setDraft([]); setHover(null); setSelected(null); setMultiSel([]); setTool("arrow"); setHint(""); ecke3dRef.current = null; }
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

  // 106-01: test and agent hook while the studio is mounted, under window.__bitZeigen.bim (the IFC
  // viewer uses .ifc, so two mounted viewers never overwrite each other): what is under the pointer,
  // the state table (colour AND form), and what is really drawn. Plain data only (no three.js objects).
  // Only the hover state 'fokus' and the selection are drawn here; warnung/fehler are not wired in
  // the studio yet (they are in the IFC viewer, see IfcViewer.jsx zustandSetzen).
  useEffect(() => {
    const w = /** @type {any} */ (window);
    /** Helper objects (hover outlines, selection aura) below the element meshes, as plain data. */
    const hilfsobjekte = () => {
      const out = [];
      [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.traverse((o) => {
        if (o.userData?.zeigeHilfe) out.push({ typ: o.type, material: o.material?.type ?? null, zustand: o.userData.zeigeZustand ?? null, farbe: o.material?.color?.getHex?.() ?? null });
      }));
      return out;
    };
    const api = {
      hover: () => (hoverRef.current ? { ...hoverRef.current, userData: undefined } : null),
      zustaende: () => ZEIGE_ZUSTAENDE,
      /** Active hover highlight layers (one per mesh of the element); `zustand` counts only that state. */
      markiert: (zustand) => (three.current.zeigen?.aktive() ?? []).filter((x) => !zustand || x.zustand === zustand).length,
      formen: () => (three.current.zeigen?.aktive() ?? []).map((x) => ({ zustand: x.zustand, umriss: x.umriss, symbol: x.symbol })),
      hilfsobjekte,
      /** The selection as drawn: aura lines (solid, selection blue) and the emissive tint of tinted meshes. */
      auswahl: () => ({
        aura: (three.current.auraList || []).map((l) => ({ material: l.material.type, farbe: l.material.color.getHex() })),
        emissiv: (() => {
          const out = [];
          [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.traverse((m) => {
            if (m.isMesh && m.material?.emissive && m.material.emissive.getHex() === AUSWAHL_EMISSIV) out.push(m.userData?.kind ?? null);
          }));
          return out;
        })(),
      }),
      /**
       * 106-07: the orbit camera - studio angles theta and polar phi (rad), distance radius (m); review fix: azimutRad = world azimuth of
       * the camera around the target, atan2(x, z) as in the IFC viewer's hook (common reference for the twist direction).
       */
      kamera: () => ({
        theta: orbit.current.theta, phi: orbit.current.phi, radius: orbit.current.radius,
        azimutRad: Math.atan2(Math.cos(orbit.current.theta), Math.sin(orbit.current.theta)),
      }),
      /** 106-07: kind of the last pointer on the canvas and the sum of two-finger steps seen (count, twist rad, pinch factor). */
      zeiger: () => ({ art: zeigerArtRef.current, geste: { ...gestenSummeRef.current } }),
    };
    w.__bitZeigen = { ...(w.__bitZeigen || {}), bim: api };
    return () => { if (w.__bitZeigen?.bim === api) delete w.__bitZeigen.bim; };
  }, []);

  // 106-02: ONE command register for this studio (same pattern as the Massing modeller, 104-03): the
  // selection as context for speech and agents. Built once; the commands read the latest state through
  // `aktuell` (re-assigned every render).
  const aktuell = useRef(/** @type {Record<string, any>} */ ({}));
  // 106-03: synchronous mirror of the drawn elements, like `auswahlRef` for the selection: a confirmed change writes the new
  // model here at once (and into the React state), so the next command in the same tick (auswahl-lesen, a second
  // proposal) already sees it. Every render re-assigns it from the state, which by then holds the same arrays.
  const modellRef = useRef(/** @type {any} */ (null));
  modellRef.current = { customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs,
    bauteil_attribute_layer: attributLayer, netz_layer: netzLayer };
  /** Everything the element resolvers need, as of this render. */
  const bimDaten = () => ({ ...modellRef.current,
    model, storeyHeight, geschosse, huelleAttribute: attributeVon(attributLayer, "hull-wall"),
    huelleDeckenAttribute: attributeVon(attributLayer, "hull-slab"), huelleBodenAttribute: attributeVon(attributLayer, "hull-floor") });
  /** Selection entries right now (read from the synchronous mirror): the multi selection, else the single one. Generated auto openings have no GUID and are counted as `ohneGuid`. */
  const auswahlEintraege = () => {
    const a = auswahlRef.current;
    return a.multiSel.length ? a.multiSel : a.selected ? [a.selected] : [];
  };
  const bimKontext = (eintraege) => {
    const t3 = three.current;
    const dom = t3.renderer?.domElement;
    return bimAuswahlKontext(eintraege, bimDaten(), { projektId: projectId || null,
      kamera: view === "3d" ? t3.camera : null, breite: dom?.clientWidth, hoehe: dom?.clientHeight }); // pixels only mean something in the 3D view
  };
  aktuell.current = {
    kontext: () => bimKontext(auswahlEintraege()),
    waehleGuid: (/** @type {string} */ guid) => {
      const treffer = bimPerGuid(guid, bimDaten(), { projektId: projectId || null });
      if (!treffer) return null;
      // what a mouse pick cannot select, a command does not select either: refused with the reason, not guessed
      if (!treffer.bauteil.waehlbar) throw new Error(`Bauteil nicht wählbar: ${guid} (${treffer.bauteil.klasse} ohne Auswahl im BIM-Studio, nur lesbar über „modell“)`);
      const ebene = EBENE_VON_TYP[treffer.sel.type] || "walls";
      if (layerLocked[ebene]) throw new Error("Ebene gesperrt — Auswahl nicht möglich.");
      if (layerVis[ebene] === false) throw new Error("Ebene ausgeblendet — Auswahl nicht möglich.");
      setCtxMenu(null);
      setMultiSel([]); setSelected(treffer.sel); // the same state a click sets
      return bimKontext([treffer.sel]); // from the element itself: the React state lands one render later
    },
    aufheben: () => { setSelected(null); setMultiSel([]); setHint(""); },
    ansichtAufAuswahl: () => zoomToSelection(auswahlEintraege().filter((e) => bimBauteil(e, bimDaten(), { projektId: projectId || null }))),
    modell: (/** @type {{klasse?: string}} */ opt) => bimModellUebersicht(bimDaten(), { projektId: projectId || null }, opt),
    // 106-04: one PNG of the 3D view (the canvas is hidden in plan and section: refused with the reason, not drawn blank)
    ansichtBild: (/** @type {{breite?: any}} */ opt) => {
      if (view !== "3d") throw new Error(`Ein Bild gibt es nur in der 3D-Ansicht — erst auf 3D wechseln (jetzt: ${view})`);
      return ansichtAlsPng(three.current, opt);
    },
    // 106-06: the open project for the image rules (an NDA project never sends an image; the id lets the MCP server check the consent)
    projekt: () => ({ id: project?.id ?? null, nda: project?.nda === true }),
  };
  // ---- 106-03: change tools (proposal -> check -> preview -> confirmation -> origin) ----
  const vorschlaege = useMemo(() => vorschlagSpeicher(), []);
  /** Helper objects of the preview per proposal id (ghost group, outlines, cut marker), so exactly those are removed again. */
  const vorschauRef = useRef(/** @type {Map<string, any[]>} */ (new Map()));
  /** Group for ghosts in the scene root: the element group is rebuilt on every model change, the ghosts must survive that. */
  const geisterGruppe = () => {
    const t3 = three.current;
    if (!t3.scene) return null;
    if (!t3.geister) { t3.geister = new THREE.Group(); t3.geister.userData.zeigeHilfe = true; t3.scene.add(t3.geister); }
    return t3.geister;
  };
  /** The meshes of one drawn element in the scene (a composite wall has one per skin; its openings' glazing moves with it). */
  const meshesDesBauteils = (/** @type {any} */ fund) => {
    const kind = /** @type {Record<string, string>} */ ({ wand: "wall", stuetze: "column", decke: "cslab", dach: "croof", zone: "zone" })[fund.art];
    const idx = fund.element._idx;
    const oeff = new Set(fund.art === "wand" ? (modellRef.current.customWindows || []).filter((/** @type {any} */ o) => o.wallIdx === idx).map((/** @type {any} */ o) => o._idx) : []);
    /** @type {any[]} */
    const out = [];
    three.current.customGroup?.traverse((/** @type {any} */ m) => {
      const u = m.userData || {};
      if (!m.isMesh || u.zeigeHilfe) return;
      if ((u.kind === kind && u.id === idx) || (oeff.size && (u.kind === "window" || u.kind === "door") && oeff.has(u.id))) out.push(m);
    });
    return out;
  };
  const vorschauEntfernen = (/** @type {string} */ id) => {
    (vorschauRef.current.get(id) || []).forEach((o) => geisterEntsorgen(o));
    vorschauRef.current.delete(id);
  };
  /** Draws what a proposal would do: ghost (transformieren), cut marker (teilen), warning outline (eigenschaft). 3D view only. */
  const vorschauZeigen = (/** @type {any} */ v) => {
    vorschauEntfernen(v.id);
    const g = geisterGruppe();
    const fund = v.ziel.quelle === "ifc" ? null : bauteilImModell(modellRef.current, v.ziel.guid, { projektId: projectId || null });
    if (!g || !fund) return;
    /** @type {any[]} */
    const objs = [];
    try {
      const el = fund.element, sh = geschosshoehe(el.level || 0, gs), lvl = unterkante(el, gs);
      if (v.art === "transformieren") {
        const m = geisterMatrix({ zentrum: transformZentrum(el, v.params.zentrum), verschiebung_m: v.params.verschiebung_m, drehung_grad: v.params.drehung_grad, faktor: v.params.faktor });
        const klon = geisterKlon(meshesDesBauteils(fund), m, v.id);
        g.add(klon); objs.push(klon);
      } else if (v.art === "eigenschaft") {
        const zustand = v.pruefung?.stufe === "fehler" ? "fehler" : "warnung";
        for (const m of meshesDesBauteils(fund)) {
          const l = umrissLinie(new THREE.EdgesGeometry(m.geometry, 30), zustand);
          l.userData.geisterId = v.id; m.add(l); objs.push(l);
        }
      } else if (v.art === "teilen" && fund.art === "wand" && v.params.punkt_m) {
        const dx = el.b.x - el.a.x, dz = el.b.z - el.a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((v.params.punkt_m.x - el.a.x) * dx + (v.params.punkt_m.z - el.a.z) * dz) / l2));
        const c = { x: el.a.x + dx * t, z: el.a.z + dz * t }, len = Math.sqrt(l2);
        const h = wandDicke_m(el) / 2 + 0.3, nx = (-dz / len) * h, nz = (dx / len) * h;
        const marke = schnittMarke({ x: c.x + nx, z: c.z + nz }, { x: c.x - nx, z: c.z - nz }, lvl, lvl + wandHoehe(el, gs), v.id);
        g.add(marke); objs.push(marke);
      } else if (v.art === "teilen" && v.params.linie) {
        const top = elevationOf((el.level || 0) + 1, gs);
        const marke = schnittMarke(v.params.linie.a, v.params.linie.b, top - deckenLage(el, gs, "decke").dicke_m, top + 0.6, v.id);
        g.add(marke); objs.push(marke);
      }
    } catch (err) { console.warn("[BIM] preview failed: " + (/** @type {any} */ (err)?.message || err)); }
    vorschauRef.current.set(v.id, objs);
  };
  /** After the element group was rebuilt: draw the previews of all open proposals again. */
  const vorschauAlleNeu = () => {
    [...vorschauRef.current.keys()].forEach(vorschauEntfernen);
    vorschlaege.offen().forEach(vorschauZeigen);
  };
  /** Writes a new model record into the React state of the seven element arrays (only the arrays that changed) and into the mirror. */
  const modellAnwenden = (/** @type {any} */ neu) => {
    const alt = modellRef.current;
    const setter = { customWalls: setCustomWalls, customColumns: setCustomColumns, customWindows: setCustomWindows, envOpenings: setEnvOpenings,
      customZones: setCustomZones, customSlabs: setCustomSlabs, customRoofs: setCustomRoofs };
    const stand = { ...alt };
    for (const [k, set] of Object.entries(setter)) if (neu[k] !== alt[k]) {
      // 107-02: roofs from an agent or an undo may only carry the old `pitch`; they get the split fields here like at load, so editor and export read one meaning
      const wert = k === "customRoofs" && Array.isArray(neu[k]) ? neu[k].map(dachMigrieren) : neu[k];
      set(wert); stand[k] = wert;
    }
    modellRef.current = stand;
    idRef.current = Math.max(idRef.current, naechsteFreieIdx(stand)); // a split took the counter's number
  };
  const aenderung = useRef(/** @type {Record<string, any>} */ ({}));
  aenderung.current = {
    kontext: () => bimKontext(auswahlEintraege()),
    modell: () => modellRef.current,
    optionen: () => ({ projektId: projectId || null, bauart: bauartVon(project).bauart,
      werkstatt: werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }), durchbrueche, huelle: model.walls, geschosshoehe_m: storeyHeight, geschosse,
      attributPruefung: pruefeAttributeVorUebernahme, naechsteIdx: idRef.current }),
    // 106-05: view directions for "nach links" (3D: from the camera, plan: fixed, section: none) and the spot last pointed at on the SELECTED element ("teile hier")
    ansicht: () => (view === "3d" ? ansichtAusKamera(three.current.camera) : view === "grundriss" ? ANSICHT_GRUNDRISS : null),
    zeigepunkt: () => {
      // only in the view it was pointed in (the 3D view): a click in the plan sets no spot, an older 3D spot must not stand in for it
      const z = three.current.letzterZeigepunkt;
      return z && view === "3d" && bimKontext(auswahlEintraege()).bauteile.some((/** @type {any} */ b) => b.guid === z.guid) ? { x: z.x, z: z.z } : null;
    },
    speicher: vorschlaege,
    uebernehmen: (/** @type {any} */ _v, /** @type {any} */ r) => modellAnwenden(r.modell),
    zuruecknehmen: (/** @type {any} */ _e, /** @type {any} */ r) => modellAnwenden(r.modell),
    t: tz,
    vorschauZeigen, vorschauEntfernen,
    darfAendern: () => darfAendern, // 106-07: bestaetigen / rueckgaengig only for a role that may change the model
  };
  const befehle = useMemo(() => {
    const reg = befehlsRegister();
    auswahlBefehleRegistrieren(reg, () => /** @type {any} */ (aktuell.current));
    aenderungsBefehleRegistrieren(reg, () => /** @type {any} */ (aenderung.current));
    eingabeBefehlRegistrieren(reg, () => /** @type {any} */ (aenderung.current)); // 106-05: a sentence as a command, the caller's ctx goes on
    return reg;
  }, []);
  // test and agent hook next to the 106-01 one (window.__bitZeigen.bim): the previews as drawn and the element arrays as they are.
  // Plain data only, so it serialises.
  useEffect(() => {
    const w = /** @type {any} */ (window);
    const api = {
      vorschau: () => [...vorschauRef.current.entries()].map(([id, objs]) => ({ id, objekte: objs.map((/** @type {any} */ o) => ({
        typ: o.type, geist: !!o.userData.geisterId && o.isGroup === true,
        // outline form of the preview (dashed 'warnung' / solid 'fehler'): on the object itself, or on the meshes of a ghost
        umriss: (o.isGroup ? o.children.flatMap((/** @type {any} */ c) => c.children) : [o]).filter((/** @type {any} */ x) => x.userData?.zeigeZustand)
          .map((/** @type {any} */ x) => ({ zustand: x.userData.zeigeZustand, material: x.material.type })),
      })) })),
      modell: () => JSON.parse(JSON.stringify(modellRef.current)),
      // 106-05: screen right / into the screen of the current view as plan unit vectors (what "nach links" is measured against)
      ansicht: () => aenderung.current.ansicht(),
      // 107-01: world box (m) of the drawn wall's 3D meshes (all layers of a build-up joined), per wall _idx — proves 3D = plan = IFC
      waende3d: () => {
        const g = three.current.customGroup;
        /** @type {Record<string, {min: number[], max: number[]}>} */
        const out = {};
        for (const m of g ? g.children : []) {
          if (m.userData?.kind !== "wall" || m.userData.id == null) continue;
          const b = new THREE.Box3().setFromObject(m);
          const alt = out[m.userData.id];
          out[m.userData.id] = alt ? { min: [Math.min(alt.min[0], b.min.x), Math.min(alt.min[1], b.min.y), Math.min(alt.min[2], b.min.z)], max: [Math.max(alt.max[0], b.max.x), Math.max(alt.max[1], b.max.y), Math.max(alt.max[2], b.max.z)] } : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
        }
        return out;
      },
      // 107-02 review: world box (m) of the drawn roofs' 3D meshes, per roof _idx — proves a roof of slope 0° is a flat plate, not a 2.5 m gable
      daecher3d: () => {
        const g = three.current.customGroup;
        /** @type {Record<string, {min: number[], max: number[]}>} */
        const out = {};
        for (const m of g ? g.children : []) {
          if (m.userData?.kind !== "croof" || m.userData.id == null) continue;
          const b = new THREE.Box3().setFromObject(m);
          out[m.userData.id] = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
        }
        return out;
      },
      // 107-01 review: the same for the HULL wall meshes (userData kind "wallShell"), keyed "<level>:<edge>" — proves hull plan = 3D = IFC
      // 107-04: a hull wall with a build-up is one mesh per layer, the boxes are joined like for the drawn walls
      huellwaende3d: () => {
        const g = three.current.buildingGroup;
        /** @type {Record<string, {min: number[], max: number[]}>} */
        const out = {};
        for (const m of g ? g.children : []) {
          if (m.userData?.kind !== "wallShell") continue;
          const b = new THREE.Box3().setFromObject(m);
          const k = `${m.userData.level}:${m.userData.edge}`, alt = out[k];
          out[k] = alt ? { min: [Math.min(alt.min[0], b.min.x), Math.min(alt.min[1], b.min.y), Math.min(alt.min[2], b.min.z)], max: [Math.max(alt.max[0], b.max.x), Math.max(alt.max[1], b.max.y), Math.max(alt.max[2], b.max.z)] } : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
        }
        return out;
      },
      // 107-04: number of layer meshes of the hull wall "<level>:<edge>" (a hull wall with a build-up is shown layer by layer)
      huellwandSchichten3d: () => {
        const g = three.current.buildingGroup;
        /** @type {Record<string, number>} */
        const out = {};
        for (const m of g ? g.children : []) if (m.userData?.kind === "wallShell") { const k = `${m.userData.level}:${m.userData.edge}`; out[k] = (out[k] || 0) + 1; }
        return out;
      },
      // 107-04: number of holes (Shape.holes) per drawn wall (by _idx), hull wall ("<level>:<edge>") and drawn slab (by _idx), summed over the layers of a
      // wall — proves a hole is cut through every layer; plus the number of planned-penetration markers in the scene
      loecher3d: () => {
        const t3 = three.current;
        /** @type {{wand: Record<string, number[]>, huelle: Record<string, number[]>, decke: Record<string, number>, vormerkungen: number}} */
        const out = { wand: {}, huelle: {}, decke: {}, vormerkungen: 0 };
        const holes = (/** @type {any} */ m) => (m.geometry?.parameters?.shapes?.holes || []).length;
        for (const m of t3.customGroup ? t3.customGroup.children : []) {
          const u = m.userData || {};
          if (u.kind === "wall" && u.id != null) (out.wand[u.id] = out.wand[u.id] || []).push(holes(m));
          else if (u.kind === "cslab" && u.id != null) out.decke[u.id] = holes(m);
          else if (u.kind === "durchbruch") out.vormerkungen += 1;
        }
        for (const m of t3.buildingGroup ? t3.buildingGroup.children : []) {
          const u = m.userData || {};
          if (u.kind === "wallShell") { const k = `${u.level}:${u.edge}`; (out.huelle[k] = out.huelle[k] || []).push(holes(m)); }
        }
        return out;
      },
      // 107-04: test hook — select an opening (a 3D glazing group is not pickable; the plan symbol is, by mouse)
      oeffnungWaehlen: (/** @type {number} */ index, /** @type {string} */ scope = "custom") => setSelected({ type: "opening", index, scope }),
      // 107-04: test hook — put the camera (orbit angles in rad, radius in m, target point in m) and read the pixel of a world point, so a test can
      // click ON a wall face in 3D. The camera is set at once (the render loop would do it one frame later).
      kamera: (/** @type {{theta?: number, phi?: number, radius?: number, ziel?: {x: number, y: number, z: number}}} */ opt) => {
        const o = orbit.current, t3 = three.current;
        o.touched = true;
        if (opt.theta != null) o.theta = opt.theta;
        if (opt.phi != null) o.phi = opt.phi;
        if (opt.radius != null) o.radius = opt.radius;
        if (opt.ziel && t3.target) t3.target.set(opt.ziel.x, opt.ziel.y, opt.ziel.z);
        if (t3.camera && t3.target) {
          t3.camera.position.set(t3.target.x + o.radius * Math.sin(o.phi) * Math.cos(o.theta), t3.target.y + o.radius * Math.cos(o.phi), t3.target.z + o.radius * Math.sin(o.phi) * Math.sin(o.theta));
          t3.camera.lookAt(t3.target);
          t3.camera.updateMatrixWorld();
        }
      },
      bildpunkt3d: (/** @type {{x: number, y: number, z: number}} */ pt) => {
        const t3 = three.current, dom = t3.renderer?.domElement;
        if (!dom || !t3.camera) return null;
        t3.camera.updateMatrixWorld();
        const v = new THREE.Vector3(pt.x, pt.y, pt.z).project(t3.camera), r = dom.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    w.__bitZeigen = { ...(w.__bitZeigen || {}), bimAenderung: api };
    return () => { if (w.__bitZeigen?.bimAenderung === api) delete w.__bitZeigen.bimAenderung; };
  }, []);
  // the buttons of the preview take the same road as the commands (one path, one check); a refusal is shown in words
  const aenderungBefehl = (/** @type {string} */ id, /** @type {any} */ p) => {
    const r = befehle.ausfuehren(id, p);
    setHint(r.ok ? "" : /** @type {{ok: false, error: string}} */ (r).error);
  };
  // reachable for local agents / tests while the studio is open (window.__bitBefehle.zeileBearbeiten(...))
  // and through the local control channel (server/steuerungRouter.js); the global is deleted only if it is still ours.
  useEffect(() => {
    /** @type {any} */ (window).__bitBefehle = befehle;
    const stopp = starteSteuerungsBruecke(befehle);
    return () => {
      stopp();
      if (/** @type {any} */ (window).__bitBefehle === befehle) delete /** @type {any} */ (window).__bitBefehle;
    };
  }, [befehle]);

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

    // Raycasting (106-01: strahlPick, the same core as the IFC viewer): the pickable object under
    // (clientX,clientY). Only the DIRECT children of the groups (glazing and door leaves are Groups
    // and stay out, as before); helper geometry (outline, aura) is never a direct child of a group.
    // 106-07: with the capture radius of the pointer kind (mouse exact as before, pen 8 px, finger 18 px): when the exact ray
    // finds no element of the studio (sky, ground, a context building), the rings around it are tried, nearest first.
    // Review fix 106-07: guidPflicht (hover) = the rings accept only elements that resolve to a GUID, the test the hover applies to the
    // result; a tap keeps accepting every element with a key (as the click always did).
    /** @type {(clientX: number, clientY: number, art?: import("@core/lib/zeigen/strahlPick.js").ZeigerArt, guidPflicht?: boolean) => any} */
    const treffenBei = (clientX, clientY, art = /** @type {import("@core/lib/zeigen/strahlPick.js").ZeigerArt} */ ("mouse"), guidPflicht = false) => {
      const objs = [];
      [three.current.buildingGroup, three.current.customGroup, three.current.contextGroup]
        .forEach((g) => g?.children.forEach((c) => { if (c.visible) objs.push(c); }));
      const annehmen = guidPflicht
        ? (/** @type {any} */ tr) => !!bauteilSchluessel(tr.objekt.userData) && !!identitaetAus(tr, (x) => three.current.cb?.bauteilInfo?.(x.objekt.userData), { guidPflicht: true })
        : (/** @type {any} */ tr) => !!bauteilSchluessel(tr.objekt.userData);
      return zeigerPick(objs, camera, el, clientX, clientY, { art, kamera: camera, annehmen });
    };
    const pickAt = (clientX, clientY) => treffenBei(clientX, clientY)?.objekt ?? null;

    // Hover highlight 'fokus' (106-01): outline + tint on private material clones.
    const zeigen = hervorhebung();
    const handles = three.current; // never reassigned (Object.assign), safe to use in the cleanup
    handles.zeigen = zeigen;
    const hoverLoeschen = () => {
      zeigen.alleLoeschen();
      hoverRef.current = null;
      if (hoverBoxRef.current) hoverBoxRef.current.style.display = "none";
    };
    handles.hoverLoeschen = hoverLoeschen;
    const gleichesBauteil = (a, b) => ["kind", "id", "scope", "level", "edge"].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
    // All meshes of one element (a composite wall has one mesh per skin, all with the same userData).
    const meshesVon = (ud) => {
      const out = [];
      [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.children.forEach((m) => {
        if (m.isMesh && m.visible && gleichesBauteil(m.userData, ud)) out.push(m);
      }));
      return out;
    };

    // 106-07: finger and pen. One contact: tap = select (tolerance per kind), drag = orbit (the mouse keeps its CAD buttons);
    // two fingers: pinch = closer/further, twist = turn around the vertical axis, shift of their middle = pan. The last finger
    // lifting after a two-finger gesture never selects.
    const geste = zweiFingerGeste();
    const gesteSchritt = (/** @type {import("@core/lib/zeigen/zweiFinger.js").FingerSchritt} */ sch) => {
      const o = orbit.current;
      o.radius = Math.max(20, Math.min(220, o.radius / sch.faktor)); // same limits as the wheel
      // fingers clockwise on screen = model clockwise seen from above [ASSUMED direction, as on map apps]. The camera sits at
      // (cos theta, sin theta) in x/z, so its world azimuth atan2(x, z) is PI/2 - theta: theta must DEcrease for the camera to go the
      // way the IFC viewer turns it (azimuth + drehungRad) - review fix 106-07, the sign was the other way round before.
      o.theta -= sch.drehungRad;
      _f.subVectors(three.current.target, camera.position).normalize();
      _r.crossVectors(_f, _up).normalize();
      _u.crossVectors(_r, _f).normalize();
      const k = o.radius * 0.0016; // same scale as the middle-button pan
      three.current.target.addScaledVector(_r, -sch.dx * k);
      three.current.target.addScaledVector(_u, sch.dy * k);
      gestenSummeRef.current = {
        schritte: gestenSummeRef.current.schritte + 1,
        drehungRad: gestenSummeRef.current.drehungRad + sch.drehungRad,
        faktor: gestenSummeRef.current.faktor * sch.faktor,
      };
    };

    // ArchiCAD-Maus: links = wählen, rechts = Kontextmenü, mittlere = Pan, Shift+mittlere = drehen
    const down = (e) => {
      const o = orbit.current; o.touched = true;
      const art = zeigerArt(e);
      zeigerArtRef.current = art;
      const anzahl = geste.runter(e.pointerId, e.clientX, e.clientY);
      if (anzahl >= 2) { o.on = true; o.mode = "geste"; hoverLoeschen(); return; }
      o.art = art; o.zeigerId = e.pointerId; o.startX = e.clientX; o.startY = e.clientY;
      if (e.button === 1) { o.on = true; o.mode = e.shiftKey ? "rotate" : "pan"; el.style.cursor = o.mode === "pan" ? "move" : "grabbing"; e.preventDefault(); }
      else if (e.button === 0) { o.on = true; o.mode = "select"; o.moved = false; }
      else { o.on = false; o.mode = null; }
      o.x = e.clientX; o.y = e.clientY;
    };
    // Mittelklick-Autoscroll des Browsers verhindern
    const mdown = (e) => { if (e.button === 1) e.preventDefault(); };
    const move = (e) => {
      const o = orbit.current; if (!o.on) return;
      if (o.mode === "geste") { const sch = geste.bewegt(e.pointerId, e.clientX, e.clientY); if (sch) gesteSchritt(sch); return; }
      geste.bewegt(e.pointerId, e.clientX, e.clientY);
      if (e.pointerId !== o.zeigerId && o.zeigerId != null) return;
      const dx = e.clientX - o.x, dy = e.clientY - o.y;
      if (o.mode === "select") {
        if (o.art !== "mouse") {
          // finger / pen: beyond the tap tolerance the contact orbits instead (there is no middle button on glass)
          if (Math.hypot(e.clientX - o.startX, e.clientY - o.startY) > TIPP_TOLERANZ_PX[o.art]) { o.moved = true; o.mode = "rotate"; }
          else return;
        } else { if (Math.abs(dx) + Math.abs(dy) > 3) o.moved = true; o.x = e.clientX; o.y = e.clientY; return; }
      }
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
      const warGeste = geste.warGeste();
      const rest = geste.hoch(e.pointerId);
      if (warGeste || o.mode === "geste") {
        // two-finger gesture: nothing is selected; when the last finger lifts the canvas is free again
        if (rest === 0) { o.on = false; o.mode = null; el.style.cursor = "default"; }
        return;
      }
      if (o.zeigerId != null && e.pointerId !== o.zeigerId) return;
      if (o.mode === "select" && !o.moved) {
        const treffer = treffenBei(e.clientX, e.clientY, o.art ?? "mouse");
        const obj = treffer?.objekt ?? null;
        // 106-05: remember the hit point (plan x/z, m) with the element's GUID - "teile hier" cuts there, and only while that element is selected
        const zeigeId = treffer ? identitaetAus(treffer, (tr) => three.current.cb?.bauteilInfo?.(tr.objekt.userData), { guidPflicht: true }) : null;
        three.current.letzterZeigepunkt = zeigeId ? { x: treffer.punkt[0], z: treffer.punkt[2], guid: zeigeId.guid } : null;
        // 107-04: with an opening tool the click places an opening on the face instead of selecting
        if (!three.current.cb?.platziere?.(treffer)) three.current.cb?.select?.(obj ? obj.userData : null);
      }
      o.on = false; o.mode = null; el.style.cursor = "default";
    };
    // Zooming moves the scene under a resting pointer: drop the hover, look again once the wheel settled.
    let radTimer = 0;
    const wheel = (e) => {
      e.preventDefault(); orbit.current.touched = true; orbit.current.radius = Math.max(20, Math.min(220, orbit.current.radius + e.deltaY * 0.05));
      hoverLoeschen();
      letzterPick = null;
      clearTimeout(radTimer);
      radTimer = window.setTimeout(() => { if (zeiger && !hoverRaf) hoverRaf = requestAnimationFrame(hoverTick); }, WHEEL_PAUSE_MS);
    };
    // Rechtsklick = Kontextmenü für getroffenes Objekt (Standardmenü unterdrückt)
    const ctx = (e) => {
      e.preventDefault();
      const obj = pickAt(e.clientX, e.clientY);
      const rect = el.getBoundingClientRect();
      three.current.cb?.context?.(obj ? obj.userData : null, e.clientX - rect.left, e.clientY - rect.top);
    };
    // Hover (106-01): the last pointer is remembered, ONE pick per animation frame, never faster than
    // the pick budget allows, and no new pick for sub-pixel jitter. A hit is shown in words and as
    // 'fokus' only if the studio knows the element and it has a GUID (unknown hit, e.g. context
    // buildings: nothing is shown, nothing is guessed).
    let zeiger = null;
    let letzterPick = null;
    let hoverRaf = 0;
    const drossel = pickDrossel();
    const hoverTick = () => {
      hoverRaf = 0;
      if (!zeiger) return;
      if (orbit.current.on) { hoverLoeschen(); return; } // never while orbiting / panning
      const jetzt = performance.now();
      if (!drossel.darf(jetzt)) { hoverRaf = requestAnimationFrame(hoverTick); return; }
      const bewegt = !letzterPick || Math.hypot(zeiger.x - letzterPick.x, zeiger.y - letzterPick.y) >= HOVER_MIN_PX;
      if (bewegt || !hoverRef.current) {
        letzterPick = { x: zeiger.x, y: zeiger.y };
        const treffer = treffenBei(zeiger.x, zeiger.y, zeiger.art, true); // 106-07: a hovering pen gets its capture radius (GUID elements only)
        drossel.messen(performance.now() - jetzt, performance.now());
        el.style.cursor = treffer ? "pointer" : "default";
        // cheap key first: the GUID is derived only when the element under the pointer changed
        const schluessel = treffer ? bauteilSchluessel(treffer.objekt.userData) : "";
        if (!schluessel) { hoverLoeschen(); return; }
        if (hoverRef.current?.schluessel !== schluessel) {
          const id = identitaetAus(treffer, (tr) => three.current.cb?.bauteilInfo?.(tr.objekt.userData), { guidPflicht: true });
          if (!id) { hoverLoeschen(); return; }
          zeigen.alleLoeschen();
          const meshes = meshesVon(id.userData);
          const sels = multiSelRef.current?.length ? multiSelRef.current : selectedRef.current ? [selectedRef.current] : [];
          const gewaehlt = meshes.some((m) => sels.some((s) => auraMatches(m, s)));
          const name = gewaehlt ? "auswahl" : "fokus";
          if (!gewaehlt) { // a selected element keeps its aura, hover never paints over it
            try { meshes.forEach((m) => zeigen.setzen({ mesh: m }, "fokus")); }
            catch (err) { console.warn(`[BIM] hover highlight failed: ${err?.message || err}`); }
          }
          hoverRef.current = { quelle: "bim", guid: id.guid, kind: id.kind, id: id.bauteilId, schluessel: id.schluessel, typ: id.label, name: id.name, zustand: name };
          if (hoverTextRef.current) hoverTextRef.current.textContent = id.name ? `${id.label} · ${id.name}` : id.label;
          // the overlay says the state the picture shows: words, colour and outline form
          const look = ZEIGE_ZUSTAENDE[name];
          if (hoverZustandRef.current) hoverZustandRef.current.textContent = tz(look.label);
          if (hoverSymbolRef.current) {
            hoverSymbolRef.current.style.borderColor = look.hex;
            hoverSymbolRef.current.style.borderStyle = ZEIGE_CSS_RAND[look.umriss];
          }
        }
      }
      const box = hoverBoxRef.current;
      if (box) {
        box.style.display = ""; // visible first, otherwise offsetWidth is 0 and the clamp below is skipped
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(zeiger.x - r.left + 14, r.width - box.offsetWidth - 4));
        const y = Math.max(0, Math.min(zeiger.y - r.top + 14, r.height - box.offsetHeight - 4));
        box.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const hoverMove = (e) => {
      // 106-07: a finger has no hover (it only moves while on the glass); a pen above the glass hovers like the mouse
      const art = zeigerArt(e);
      if (art === "touch") return;
      if (art === "pen" && !e.buttons) zeigerArtRef.current = "pen";
      zeiger = { x: e.clientX, y: e.clientY, art };
      if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverTick);
    };
    // a cancelled contact (the browser took over the gesture) must not leave a finger counted
    const abbruch = (e) => { if (geste.hoch(e.pointerId) === 0) { const o = orbit.current; o.on = false; o.mode = null; } };
    const hoverLeave = () => { zeiger = null; hoverLoeschen(); };
    el.addEventListener("pointermove", hoverMove, { passive: true });
    el.addEventListener("pointerleave", hoverLeave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("mousedown", mdown);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abbruch);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", ctx);

    const onResize = () => { const nw = mount.clientWidth, nh = mount.clientHeight; if (!nw || !nh) return; camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", hoverMove);
      el.removeEventListener("pointerleave", hoverLeave);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      clearTimeout(radTimer);
      hoverLoeschen();
      zeigen.verwerfen(); // cached outline geometries
      handles.zeigen = null; handles.hoverLoeschen = null;
      el.removeEventListener("pointerdown", down); el.removeEventListener("mousedown", mdown);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); el.removeEventListener("wheel", wheel);
      window.removeEventListener("pointercancel", abbruch);
      el.removeEventListener("contextmenu", ctx);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      scene.traverse(objektFreigeben);
    };
  }, []);

  // ---- Terrain patch from real elevation (200 m) ----
  useEffect(() => {
    const t = three.current; if (!t.terrainGroup || !grid || grid.length < 2) return;
    while (t.terrainGroup.children.length) { const c = t.terrainGroup.children.pop(); objektFreigeben(c); }
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
    t.hoverLoeschen?.(); // 106-01: material clones of the hover must not outlive their meshes
    while (t.buildingGroup.children.length) { const c = t.buildingGroup.children.pop(); objektFreigeben(c); }

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
      const ops = /** @type {Array<{u: number, sill: number, width: number, height: number, rund?: boolean}>} */ (autos.map((o) => ({ u: o.u, sill: o.sill, width: o.width, height: o.height })));
      // benutzerplatzierte Öffnungen auf dieser Hüllwand
      const myEnv = envOpenings.filter((e) => e.level === w.level && e.edge === w.edge);
      myEnv.forEach((e) => { const ty = masseAmWand(e, w, w.elevation); ops.push({ u: e.u, sill: ty.sill, width: ty.w, height: ty.h }); });
      // 107-04: executed penetrations of the openings planning in this wall are holes like openings without a filling
      durchbruchLoecher.filter((l) => l.schluessel === `env:${w.level}:${w.edge}`).forEach((l) => ops.push({ u: l.u, sill: l.sill, width: l.width, height: l.height, rund: l.rund }));
      // 107-04: with a build-up (not in render mode: the facade preset replaces the material) the hull wall is shown layer by layer, the holes cut
      // through ALL layers — before it was one body coloured by layer 1 only
      const hComp = !renderMode && w.composite ? compositeById(w.composite) : null;
      const huellMeshes = hComp ? buildSchichtWand(w, hComp, ops) : [buildWallMeshWithHoles(w, wallMat, ops)];
      huellMeshes.forEach((m) => {
        m.userData.layer = "shell"; m.userData.kind = "wallShell"; m.userData.level = w.level; m.userData.edge = w.edge;
        t.buildingGroup.add(m);
      });
      const rotY = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
      // 107-01: glazing sits in the wall BODY — shifted by the hull reference line (0 for "center")
      const hg = wandGeometrie(w), hx = w.a.x + hg.normale.x * hg.versatz_m, hz = w.a.z + hg.normale.z * hg.versatz_m;
      // Verglasung/Türblatt der Regel-Öffnungen (gleiche Quelle wie die Löcher)
      autos.forEach((o) => {
        const g = buildGlazing(autoOpeningType(o), o.u, glassMat, frameMat, o.kind, leafMat);
        g.position.set(hx, w.elevation, hz); g.rotation.y = rotY;
        g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = o.kind; c.userData.scope = "auto"; c.userData.level = w.level; c.userData.edge = w.edge; } });
        t.buildingGroup.add(g);
      });
      // Verglasung/Türblatt für platzierte Hüllwand-Öffnungen
      myEnv.forEach((e) => {
        if (istOeffnungOhneFuellung(e)) return; // 107-04: an opening without a filling is only the hole
        const ty = typAmWand(e, w, w.elevation);
        const hlen = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const g = buildGlazing(ty, oeffnungMitte_m(e.u, ty.w, hlen), glassMat, frameMat, e.kind, leafMat); // position kept in the wall like the hole and the IFC
        g.position.set(hx, w.elevation, hz); g.rotation.y = rotY;
        g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = e.kind; c.userData.id = e._idx; c.userData.scope = "env"; } });
        t.buildingGroup.add(g);
      });
    });

    model.slabs.forEach((s) => {
      const shape = new THREE.Shape();
      s.polygon.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      const lage = deckenLage(s, undefined, "huelle"); // 107-02: thickness/side from the slab (default 0.25 m on its plane)
      const geo = new THREE.ExtrudeGeometry(shape, { depth: lage.dicke_m, bevelEnabled: false });
      const m = new THREE.Mesh(geo, slabMat); m.castShadow = true; m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = lage.unterkante_m;
      m.userData.layer = "shell"; m.userData.kind = "slab";
      t.buildingGroup.add(m);
    });

    // Attika (Brüstung) oben auf dem Dach — nur beim Flachdach
    if (dachform === "flach") {
      (model.parapets || []).forEach((p) => {
        const len = Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z); if (len < 0.05) return;
        const geo = new THREE.BoxGeometry(len, p.height, p.thickness);
        const m = new THREE.Mesh(geo, wallMat); m.castShadow = true; m.receiveShadow = true;
        const pm = wandGeometrie(p).koerperMitte; // 107-01: parapet follows the hull reference line
        m.position.set(pm.x, p.elevation + p.height / 2, pm.z);
        m.rotation.y = -Math.atan2(p.b.z - p.a.z, p.b.x - p.a.x);
        m.userData.layer = "attika"; m.userData.kind = "parapet";
        t.buildingGroup.add(m);
      });
    }

    // Globale Dachform über dem Footprint (Sattel/Walm/Pult) auf der obersten Decke
    if (dachform && dachform !== "flach") {
      const baseY = model.totalHeight || gesamtHoehe(model.storeys?.length || 1, gs); // 107-02: from the storey source, no own multiplication
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
  }, [model, envOpenings, autoOpenings, renderMode, facadePreset, dachform, dachneigung, customSlabs, gs, durchbruchLoecher]);

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
    t.hoverLoeschen?.(); // 106-01: see above
    while (t.customGroup.children.length) { const c = t.customGroup.children.pop(); objektFreigeben(c); }
    customWalls.forEach((w) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.05) return;
      const h = wandHoehe(w, gs), elev = unterkante(w, gs);
      // 107-01: normal, thickness, offset and middle from the one derivation (bauteil/referenz.js)
      const g = wandGeometrie(w);
      const nx = g.normale.x, nz = g.normale.z;
      const comp = compositeById(w.composite);
      const total = g.dicke_m;
      const o = g.versatz_m;
      const cx = g.mitte.x, cz = g.mitte.z;
      const rotY = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
      const myWins = customWindows.filter((cw) => cw.wallIdx === w._idx);
      const meineLoecher = durchbruchLoecher.filter((l) => l.schluessel === `cw:${w._idx}`);
      if (myWins.length || meineLoecher.length) {
        // Wand mit echten Öffnungen (einschichtig dargestellt) + Verglasung/Türblatt je Öffnung
        // 107-04: sizes of the record (own width/height/sill first), plus the executed penetrations of the openings planning in this wall
        const ops = [...myWins.map((cw) => { const ty = masseAmWand(cw, w, elev); return { u: cw.u, sill: ty.sill, width: ty.w, height: ty.h }; }),
          ...meineLoecher.map((l) => ({ u: l.u, sill: l.sill, width: l.width, height: l.height, rund: l.rund }))];
        if (comp) {
          // Loch durch jede Schicht schneiden (mehrschichtig + Öffnung) — 107-04: one function for drawn and hull walls
          // 107-02: elevation = lower edge (storey + offset); a drawn wall has none stored
          buildSchichtWand({ ...w, height: h, elevation: elev }, comp, ops).forEach((m) => {
            m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
            t.customGroup.add(m);
          });
        } else {
          const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
          const m = buildWallMeshWithHoles({ ...w, height: h, elevation: elev }, wallMat, ops, total);
          m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
          t.customGroup.add(m);
        }
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb6d6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4654, roughness: 0.6 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.7 });
        myWins.forEach((cw) => {
          if (istOeffnungOhneFuellung(cw)) return; // 107-04: an opening without a filling is only the hole
          const ty = typAmWand(cw, w, elev);
          const g = buildGlazing(ty, oeffnungMitte_m(cw.u, ty.w, len), glassMat, frameMat, cw.kind, leafMat); // position kept in the wall like the hole and the IFC
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
    // Eckfüller (Wand-Cleanup an Berührungspunkten) — 107-01: sits on the body corner, not on the line end
    eckfueller(customWalls, undefined, gs).forEach((f) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(f.dicke_m, f.hoehe_m, f.dicke_m), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(f.x, f.unterkante_m + f.hoehe_m / 2, f.z);
      m.userData.layer = "walls"; m.userData.kind = "wall";
      t.customGroup.add(m);
    });
    customColumns.forEach((c) => {
      const elev = unterkante(c, gs), s = c.size || 0.4, hc = stuetzenHoehe(c, gs);
      const mat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, hc, s), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(c.x, elev + hc / 2, c.z);
      m.userData.layer = "columns"; m.userData.kind = "column"; m.userData.id = c._idx;
      t.customGroup.add(m);
    });
    // Decken (gezeichnete Slabs) — Polygon extrudiert, 107-02: Dicke/Bezug aus dicke_m/bezug (Standard 0,22 m, Oberkante = Geschossdecke)
    customSlabs.forEach((s) => {
      if (!s.points || s.points.length < 3) return;
      const shape = new THREE.Shape();
      s.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      // 107-04: holes of the slab (`oeffnungen: [{points}]`, plan polygon in m), non-destructive like the wall holes (Shape.holes, no CSG)
      (Array.isArray(s.oeffnungen) ? s.oeffnungen : []).forEach((loch) => {
        if (!Array.isArray(loch?.points) || loch.points.length < 3) return;
        const path = new THREE.Path();
        loch.points.forEach((p, i) => (i ? path.lineTo(p.x, -p.z) : path.moveTo(p.x, -p.z)));
        path.closePath();
        shape.holes.push(path);
      });
      const lage = deckenLage(s, gs, "decke");
      const geo = new THREE.ExtrudeGeometry(shape, { depth: lage.dicke_m, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.85 });
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = lage.unterkante_m;
      m.userData.layer = "shell"; m.userData.kind = "cslab"; m.userData.id = s._idx;
      t.customGroup.add(m);
    });
    // Dächer (Satteldach über Polygon-BBox)
    customRoofs.forEach((rf) => {
      if (!rf.points || rf.points.length < 3) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.9, side: THREE.DoubleSide });
      // 107-02: eaves = elevation of level + 1 (+ bezug/dicke_m of the roof plate), ridge rise from firsthoehe_m / neigung_grad
      // A slope of 0° (or rise 0) is a FLAT roof, as the data sheet and the IFC say: no `|| 2.5` fallback any more (dachFirsthoehe_m already
      // defaults to 2.5 m when the roof has no field at all) — a flat roof is drawn as a plate of the roof thickness, not as a gable.
      const lage = deckenLage(rf, gs, "dach"), rise = dachFirsthoehe_m(rf);
      let m;
      if (rise > 0.005) m = buildGableRoof(rf.points, lage.unterkante_m, rise, mat);
      else {
        const shape = new THREE.Shape();
        rf.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
        shape.closePath();
        m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: lage.dicke_m, bevelEnabled: false }), mat);
        m.rotation.x = -Math.PI / 2; m.position.y = lage.unterkante_m;
        m.castShadow = true; m.receiveShadow = true;
      }
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
      m.rotation.x = -Math.PI / 2; m.position.y = unterkante(z, gs) + 0.04;
      m.userData.layer = "zones"; m.userData.kind = "zone"; m.userData.id = z._idx;
      t.customGroup.add(m);
    });
    // 107-04: planned penetrations (not yet executed) as translucent boxes / cylinders at their place; not pickable (they sit in the wall surface)
    durchbruchVormerkungen.forEach((v) => {
      const geo = v.rund ? new THREE.CylinderGeometry(v.b / 2, v.b / 2, v.tiefe, 24) : new THREE.BoxGeometry(v.b, v.h, v.tiefe);
      if (v.rund) geo.rotateX(Math.PI / 2); // cylinder axis across the wall
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.8, transparent: true, opacity: 0.45 }));
      m.position.set(v.x, v.y, v.z); m.rotation.y = -v.ang;
      m.raycast = () => {};
      m.userData.layer = "openings"; m.userData.kind = "durchbruch"; m.userData.id = v.nr;
      t.customGroup.add(m);
    });
    // 97-04b: in 3D, walls and columns with a decided status take its colour (one table:
    // Bestand grey, Neubau red, Abbruch yellow); elements without status keep their material.
    // Selection still highlights through the emissive channel.
    t.customGroup.children.forEach((m) => {
      const el = m.userData?.kind === "wall" ? customWalls.find((w) => w._idx === m.userData.id)
        : m.userData?.kind === "column" ? customColumns.find((c) => c._idx === m.userData.id) : null;
      const st = el?.status;
      if ((st === "bestand" || st === "abbruch" || st === "neubau" || st === "temporaer") && m.material?.color) {
        m.material.color.set(statusFarbe(st));
        m.userData.status = st;
      }
    });
    applyLayerVisibility(t, layersRef.current);
    applyPickHighlight(t, selectedRef.current, multiSelRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWalls, customColumns, customWindows, customZones, customSlabs, customRoofs, storeyHeight, gs, aufbautenKey, model, durchbruchLoecher, durchbruchVormerkungen]);

  // 3D-Auswahl hervorheben (Aura: emissive + pulsierende Kontur, inkl. Mehrfachauswahl)
  useEffect(() => { applyPickHighlight(three.current, selected, multiSel); }, [selected, multiSel]);
  // 106-03: the element group was rebuilt above - draw the previews of open proposals again (before the next frame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { vorschauAlleNeu(); }, [customWalls, customColumns, customWindows, customZones, customSlabs, customRoofs, storeyHeight, gs, view]);

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
    // 107-04 (spec I.4 Glue-To, part IV "push a rectangle through"): with the tool window / door / oeffnung a click on a wall face in 3D places the
    // opening through the same function as the plan click (neueOeffnung). Window and door take the type size at the clicked position; the tool
    // "oeffnung" takes TWO clicks on the same wall face (rectangle: position, sill, width, height from the corners in wall coordinates) or on a
    // slab (a hole of the slab, no CSG). Returns true when the click was consumed — the studio then does not select.
    platziere: (/** @type {any} */ treffer) => {
      if (view !== "3d" || !(tool === "window" || tool === "door" || tool === "oeffnung")) return false;
      const ud = treffer?.objekt?.userData || null, p = treffer?.punkt;
      if (!ud || !p) { ecke3dRef.current = null; setHint(tz("Keine Fläche getroffen — Fenster, Türen und Öffnungen brauchen eine Wandfläche")); return true; }
      if (ud.kind === "wall" || ud.kind === "wallShell") {
        const wirt = wirtVon(ud.kind === "wall" ? { wallIdx: ud.id } : { level: ud.level, edge: ud.edge }, wirtModell);
        if (!wirt) { setHint(tz("Wand nicht gefunden")); return true; }
        const wp = wandPunkt(wirt.wand.a, wirt.wand.b, wirt.wand.unterkante_m, p);
        if (tool !== "oeffnung") {
          const typeId = tool === "door" ? doorType : winType;
          oeffnungSetzen(neueOeffnung({ wirt, u: wp.u, kind: tool, typeId, idx: idRef.current++ }));
          setHint("");
          return true;
        }
        const e = ecke3dRef.current;
        if (!e || e.art !== "wand" || e.schluessel !== wirt.schluessel) {
          ecke3dRef.current = { art: "wand", schluessel: wirt.schluessel, p: wp };
          setHint(tz("Öffnung: zweite Ecke auf derselben Wandfläche klicken"));
          return true;
        }
        ecke3dRef.current = null;
        const r = rechteckAufWand(e.p, wp, wirt.wand.laenge_m, wirt.wand.hoehe_m);
        if (!r) { setHint(tz("Rechteck zu klein (mindestens 10 cm je Seite)")); return true; }
        oeffnungSetzen(neueOeffnung({ wirt, u: r.u, kind: "oeffnung", typeId: "oeffnung", masse: { width: r.width, height: r.height, sill: r.sill }, idx: idRef.current++ }));
        setHint("");
        return true;
      }
      if (ud.kind === "cslab" && tool === "oeffnung") {
        const punkt = { x: p[0], z: p[2] };
        const e = ecke3dRef.current;
        if (!e || e.art !== "decke" || e.schluessel !== ud.id) {
          ecke3dRef.current = { art: "decke", schluessel: ud.id, p: punkt };
          setHint(tz("Deckenöffnung: zweite Ecke auf derselben Decke klicken"));
          return true;
        }
        ecke3dRef.current = null;
        const loch = deckenLochRechteck(e.p, punkt);
        if (!loch) { setHint(tz("Rechteck zu klein (mindestens 10 cm je Seite)")); return true; }
        const decke = customSlabs.find((s) => s._idx === ud.id);
        if (!decke || !lochInDecke(loch, decke.points)) { setHint(tz("Deckenöffnung: das Rechteck muss ganz auf der Decke liegen")); return true; }
        const alt = Array.isArray(decke.oeffnungen) ? decke.oeffnungen : [];
        if (lochUeberlappt(loch, alt)) { setHint(tz("Deckenöffnung: das Rechteck überschneidet eine andere Öffnung der Decke")); return true; }
        // own id per hole (unique within the slab): the IFC GUID hangs on it, not on the list position
        const lochId = alt.reduce((m, l) => Math.max(m, Number(l?.id) || 0), 0) + 1;
        setCustomSlabs((ss) => ss.map((s) => (s._idx === ud.id ? { ...s, oeffnungen: [...(Array.isArray(s.oeffnungen) ? s.oeffnungen : []), { points: loch, id: lochId }] } : s)));
        setHint("");
        return true;
      }
      ecke3dRef.current = null;
      setHint(tz(tool === "oeffnung" ? "Öffnungen gehören in eine Wand oder eine gezeichnete Decke" : "Fenster und Türen gehören in eine Wand"));
      return true;
    },
    // 106-01: which element is this mesh? Reads the userData tags and the element arrays (bauteilInfoAus,
    // unit-tested); null for anything that is no element of the model (context buildings, parapet,
    // corner fillers): refused. Hull walls carry the GUID the IFC export gives them.
    bauteilInfo: (ud) => bauteilInfoAus(ud, { customWalls, customColumns, customZones, customSlabs, customRoofs }, { projektId: projectId || null, uebersetze: tz }),
  };

  // ---- Context buildings (echte OSM-Umgebung, extrudiert) ----
  useEffect(() => {
    const t = three.current; if (!t.contextGroup) return;
    while (t.contextGroup.children.length) { const c = t.contextGroup.children.pop(); objektFreigeben(c); }
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
              aria-pressed={sketchEdit} aria-label="Sketch bearbeiten" title="Parametrisches Zeichnen (Skizze, Constraint-Modus) im Grundriss">
              ✏ Sketch
            </button>
          </div>
          {view !== "3d" && <BrillenLeiste wert={brilleId} onChange={setBrille} t={tz} sw={swPlan} onSw={setSwPlan} />}
          {view !== "3d" && (
            // 97-06: checks against wrong planning on the current state (drawn, workshop, hull, network, openings).
            <FehlplanungHinweise t={tz} befunde={fehlplanungPruefen({
              modell: { customWalls, customColumns, customWindows, envOpenings, customSlabs, customRoofs, netz_layer: netzLayer, bauteil_attribute_layer: attributLayer },
              werkstatt: werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }),
              durchbrueche, projektId: projectId || null, bauart: bauartVon(project).bauart,
              huelle: model.walls, geschosse: gs, // 107-04: check 12 (penetration in its host) also finds hull walls and tests the height
            })} />
          )}
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
              <Link to="/SketchStudio?modus=constraint" className="text-teal-700 underline text-[11px]"
                title="Constraints, Maße und Parameter in der Skizze (Constraint-Modus) pflegen">In der Skizze öffnen</Link>
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
              {/* range 2–8 m like the per-storey inputs; with a storey table whose heights differ the field still shows the uniform `storeyHeight` and says "uneinheitlich" */}
              <input type="number" min="2" max="8" step="0.1" value={storeyHeight}
                onChange={(e) => setStoreyHeight(+e.target.value)}
                className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschosshöhe" />
              <span className="text-slate-400">m</span>
              {geschosse && new Set(geschosse.map((g) => g.hoehe_m)).size > 1 && (
                <span className="text-muted-foreground underline decoration-dotted" data-testid="geschosshoehe-abweichend" title={tz("Die Geschosse haben verschiedene Höhen (siehe Geschosshöhen); eine Eingabe hier setzt alle Geschosse gleich")}>{tz("uneinheitlich")}</span>
              )}
            </label>
            {/* 107-02 (D-BK-05): own height per storey; the first edit creates the table, "alle gleich" removes it */}
            <details className="relative text-xs text-muted-foreground" data-testid="geschosshoehen">
              <summary className="cursor-pointer select-none rounded-md border border-border px-1.5 py-0.5 bg-card">{tz("Geschosshöhen")}{geschosse ? " ●" : ""}</summary>
              <div className="absolute z-20 mt-1 w-56 rounded-md border border-border bg-card p-2 shadow-lg">
                {model.storeys.map((st) => (
                  <label key={st.level} className="flex items-center justify-between gap-2 py-0.5">
                    <span>{st.name}</span>
                    <input type="number" min="2" max="8" step="0.05" value={+geschosshoehe(st.level, gs).toFixed(3)} data-testid={`geschosshoehe-${st.level}`}
                      onChange={(e) => setGeschossHoehe(st.level, +e.target.value)} className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" aria-label={`${tz("Geschosshöhe")} ${st.name}`} />
                  </label>
                ))}
                {geschosse && <button type="button" className="mt-1 text-[11px] underline" onClick={() => {
                  // the individual heights are lost by the reset: ask first when they differ (107-02 review)
                  if (new Set(geschosse.map((g) => g.hoehe_m)).size > 1 && !window.confirm(tz("Die einzelnen Geschosshöhen gehen verloren. Alle Geschosse gleich setzen?"))) return;
                  bp.set({ geschosse: null });
                }}>{tz("alle gleich (zurücksetzen)")}</button>}
              </div>
            </details>
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
                    {bezugWahl(tz).map(([v, l, h]) => <option key={v} value={v} title={h}>{l}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Aufbau
                  <select value={selected?.type === "wall" ? (customWalls.find((w) => w._idx === selected.index)?.composite || "single24") : wallComp}
                    onChange={(e) => setWallComposite(e.target.value)}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Wand-Aufbau">
                    {aufbautenListe().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            {/* 106-01: what is under the pointer, in words; the form (dotted outline) matches the 3D highlight. */}
            <div ref={hoverBoxRef} data-testid="zeigen-hover" style={{ display: "none" }}
              className="pointer-events-none absolute left-0 top-0 z-20 max-w-[16rem] rounded bg-card px-2 py-1 text-xs text-foreground shadow">
              <div ref={hoverTextRef} data-testid="zeigen-hover-text" className="truncate font-medium" />
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span ref={hoverSymbolRef} className="inline-block h-2.5 w-2.5 border-2" style={{ borderColor: ZEIGE_ZUSTAENDE.fokus.hex, borderStyle: ZEIGE_CSS_RAND[ZEIGE_ZUSTAENDE.fokus.umriss] }} />
                <span ref={hoverZustandRef}>{tz(ZEIGE_ZUSTAENDE.fokus.label)}</span>
              </div>
            </div>
            {/* 106-03: proposed changes in words with check and origin, Übernehmen / Verwerfen, and the history of steps. */}
            {/* 106-05: speech and typed sentences; what is understood becomes a proposal card, a change runs only after "ja" by the person. */}
            {/* review 106-07: in the tablet layout both stand FIXED at the bottom of the screen (speech right = thumb, cards left), so they */}
            {/* are reachable without scrolling even when the 520 px view reaches below the visible part of the page (TABLETT_PLATZ, @core). */}
            <SprechFeld register={befehle} kontext={() => bimKontext(auswahlEintraege())} ansicht={() => aenderung.current.ansicht()} zeigepunkt={() => aenderung.current.zeigepunkt()} nda={project?.nda === true} t={tz}
              projektId={project?.id ?? null} bild={(o) => /** @type {any} */ (aktuell.current).ansichtBild(o)} grob={grob}
              className={grob ? TABLETT_PLATZ.sprechen : "absolute bottom-2 right-2 z-30 w-[22rem] max-w-[40%]"} />
            <AenderungsFeld speicher={vorschlaege} t={tz} darfUebernehmen={darfAendern} grob={grob} className={grob ? TABLETT_PLATZ.karten : `absolute bottom-2 z-30 w-[22rem] max-w-[60%] max-h-[480px] overflow-y-auto ${renderMode ? "left-[200px]" : "left-2"}`}
              onUebernehmen={(v) => aenderungBefehl("bestaetigen", { vorschlag_id: v.id, durch: "hand" })}
              onVerwerfen={(v) => aenderungBefehl("verwerfen", { vorschlag_id: v.id })}
              onZuruecknehmen={(sch) => aenderungBefehl("rueckgaengig", { vorschlag_id: sch.vorschlag_id })} />
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
            {view !== "3d" && (() => {
              // 97-03: the lens hides statuses (never elements without status); openings go with
              // their wall. The input lens returns the same arrays — plan unchanged.
              const brille = brilleVon(brilleId);
              const planWalls = sichtbarUnter(brille, customWalls);
              const wandDa = new Set(planWalls.map((w) => w._idx));
              const planWindows = sichtbarUnter(brille, customWindows).filter((o) => planWalls === customWalls || wandDa.has(o.wallIdx));
              const huelleSichtbar = zeigtStatus(brille, attributeVon(attributLayer, "hull-wall")?.status);
              const planLayerVis = huelleSichtbar ? layerVis : { ...layerVis, shell: false };
              return (
              <div ref={planWrapRef} className="contents">
              <BimPlan2D
                model={model} mode={/** @type {"grundriss"|"schnitt"} */ (view)} level={Math.min(planLevel, storeys - 1)} storeyHeight={storeyHeight}
                brille={brille} huelleStatus={attributeVon(attributLayer, "hull-wall")?.status ?? null} sw={swPlan}
                werkstattWaende={attributLayer?.attribute ? sichtbarUnter(brille, werkstattMitAttributen(werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }), attributLayer).waende || []) : null}
                layerVis={planLayerVis} envOpenings={huelleSichtbar ? sichtbarUnter(brille, envOpenings) : []} customZones={customZones} customSlabs={sichtbarUnter(brille, customSlabs)} customRoofs={sichtbarUnter(brille, customRoofs)} unit={unit}
                edit={view === "grundriss" && !sketchEdit ? { tool, draft, hover, customWalls: planWalls, customColumns: sichtbarUnter(brille, customColumns), customWindows: planWindows, selected, multiSel, onPoint, onHover: setHover, onFinish, onPick, onMarquee, onClear, onMoveWallPt, onMoveWall, onMoveColumn, onMoveOpening, onMovePolyVert, onMoveFootVert, onMoveFootEdge, onInsertFootVert, onDeleteFootVert } : undefined}
                focus={focus2d}
                overlayBounds={sketchEdit ? sketchEditBounds : sketchBounds}
                overlay={(ovArgs) => (<>{(
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
                )?.(ovArgs)}
                {/* 106-03: the open proposals in the plan (dashed outline; blocked: solid) - the plan is the main view */}
                <PlanVorschau speicher={vorschlaege} modell={() => modellRef.current} projektId={projectId || null} geschosshoehe_m={storeyHeight}
                  level={ovArgs.level} X={ovArgs.X} Z={ovArgs.Z} SCALE={ovArgs.SCALE} /></>)}
              />
              </div>
              );
            })()}
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
                    {aufbautenListe().map((c) => (
                      <button key={c.id} onClick={() => { setWallComposite(c.id, ctxMenu.hit.id); setCtxMenu(null); }}
                        className="w-full text-left px-3 py-1 hover:bg-slate-50 text-slate-700">{c.name}</button>
                    ))}
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-400 border-t">Referenzlinie</div>
                    {bezugWahl(tz).map(([v, l, h]) => (
                      <button key={v} title={h} onClick={() => { setCustomWalls((ws) => ws.map((w) => w._idx === ctxMenu.hit.id ? { ...w, refLine: v } : w)); setCtxMenu(null); }}
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
              // 73-07: condition + Erfassungsgrad rows, only in an existing-building project.
              const zfOpts = { bauart: bauartVon(project).bauart, field, selCls, t: tz };
              // 97-02a: data sheet rows under the attributes (same element object, optional fields).
              const sbCtx = { projektId: projectId || null, storeyHeight, geschosse: gs };
              const sbFelder = (el, typ, quelle, patch, extra = {}) => steckbriefFelder(steckbrief(el, typ, { ...sbCtx, quelle, ...extra }), patch,
                { field, selCls, t: tz, schichtStatus: zfOpts.bauart === "bestand" ? { wert: el?.schicht_status || null } : null,
                  schichtDetail: { funktion: el?.schicht_funktion || null, prioritaet: el?.schicht_prioritaet || null } }); // 107-03: layer function/priority rows
              let title = "Objekt", body = null, readOnly = false, favSpec = null; // favSpec: ★-Favorit aus der Auswahl (BIM-F)

              if (panelSel.type === "wall") {
                const w = customWalls.find((x) => x._idx === panelSel.index); if (!w) return null;
                const hasComp = !!compositeById(w.composite);
                title = "Wand"; favSpec = { tool: "wall", composite: w.composite || null };
                body = [
                  field("Geschoss", <select className={selCls} value={w.level} onChange={(e) => patchWall(w._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  // 107-02 (D-BK-04): the top edge either stays absolute (`height`) or follows a storey (`oberkante_bezug: "geschoss"`, + offset)
                  field(tz("Oberkante"), <select className={selCls} value={oberkanteFolgtGeschoss(w) ? "geschoss" : "absolut"} aria-label={tz("Oberkante")}
                    onChange={(e) => patchWall(w._idx, e.target.value === "geschoss"
                      ? { oberkante_bezug: "geschoss", oberkante_geschosse: w.oberkante_geschosse ?? 1, oberkante_versatz_m: w.oberkante_versatz_m ?? 0 }
                      : { oberkante_bezug: "absolut", height: Math.round(wandHoehe(w, gs) * 100) / 100 })}>
                    <option value="absolut">{tz("absolut")}</option><option value="geschoss">{tz("bis Geschoss (+Versatz)")}</option></select>),
                  ...(oberkanteFolgtGeschoss(w) ? [
                    // 107-02 review fix: how many storeys the wall reaches up (default 1 = the storey above; 2 = a wall over two storeys)
                    field(tz("Geschosse bis Oberkante"), <input type="number" className={numCls} step="1" min="1" max={Math.max(1, model.storeys.length - w.level)} value={Math.max(1, Math.round(w.oberkante_geschosse ?? 1))} onChange={(e) => patchWall(w._idx, { oberkante_geschosse: Math.max(1, Math.round(+e.target.value) || 1) })} aria-label={tz("Geschosse bis Oberkante")} data-testid="wand-oberkante-geschosse" />),
                    field(tz("Versatz Oberkante (m)"), <input type="number" className={numCls} step="0.05" min="-2" max="2" value={w.oberkante_versatz_m ?? 0} onChange={(e) => patchWall(w._idx, { oberkante_versatz_m: +e.target.value })} aria-label={tz("Versatz Oberkante (m)")} />),
                    field("Höhe (m)", <span className="text-muted-foreground" data-testid="wand-hoehe-abgeleitet">{wandHoehe(w, gs).toFixed(2)}</span>),
                  ] : [
                    field("Höhe (m)", <input type="number" className={numCls} step="0.1" min="2" max="8" value={w.height ?? storeyHeight} onChange={(e) => patchWall(w._idx, { height: +e.target.value })} />),
                  ]),
                  field(tz("Versatz Unterkante (m)"), <input type="number" className={numCls} step="0.05" min="-2" max="2" value={w.unterkante_versatz_m ?? 0} onChange={(e) => patchWall(w._idx, { unterkante_versatz_m: +e.target.value })} aria-label={tz("Versatz Unterkante (m)")} />),
                  field("Aufbau", <select className={selCls} value={w.composite || "single24"} onChange={(e) => patchWall(w._idx, { composite: e.target.value })} data-testid="wand-aufbau">{aufbautenListe().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>),
                  // 107-03 task 5: copy the build-up into the project / edit a project build-up (fachlayer aufbauten_layer)
                  ...aufbauEditorFelder({ layer: aufbautenLayer, setLayer: setAufbautenLayer, composite: w.composite || null, dicke_m: w.thickness,
                    // id = null: the build-up was deleted, the wall keeps its thickness (m)
                    waehlen: (id, d) => patchWall(w._idx, id ? { composite: id } : { composite: undefined, thickness: d }),
                    // per-layer settings are stored by layer index: they move with the layers behind a removed one (walls and slabs of this build-up)
                    schichtEntfernt: (id, i) => { const neu = (/** @type {any[]} */ liste) => liste.map((el) => (el.composite === id ? { ...el, ...(overridesNachEntfernen(el, i) || {}) } : el)); setCustomWalls(neu); setCustomSlabs(neu); },
                    geloescht: (id) => { setWallComp((c) => (c === id ? "single24" : c)); setFavs((fs) => fs.filter((f) => f.composite !== id)); },
                    verwendet: (id) => customWalls.filter((x) => x.composite === id).length + customSlabs.filter((x) => x.composite === id).length + (envComposite === id ? 1 : 0), field, selCls, numCls, t: tz }),
                  !hasComp && field("Dicke (m)", <input type="number" className={numCls} step="0.05" min="0.1" max="0.6" value={w.thickness ?? 0.3} onChange={(e) => patchWall(w._idx, { thickness: +e.target.value })} />),
                  field("Bezug", <select className={selCls} value={w.refLine || "center"} onChange={(e) => patchWall(w._idx, { refLine: e.target.value })} data-testid="wand-bezug">{bezugWahl(tz).map(([v, l, h]) => <option key={v} value={v} title={h}>{l}</option>)}</select>),
                  ...zustandFelder(w, (p) => patchWall(w._idx, p), zfOpts),
                  ...(() => { const ty = typFuerWand(w); return sbFelder(w, ty.typ, "customWalls", (p) => patchWall(w._idx, p), { typAbgeleitet: ty.abgeleitet }); })(),
                ];
              } else if (panelSel.type === "column") {
                const c = customColumns.find((x) => x._idx === panelSel.index); if (!c) return null;
                title = "Stütze";
                body = [
                  field("Geschoss", <select className={selCls} value={c.level} onChange={(e) => patchColumn(c._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Größe (m)", <input type="number" className={numCls} step="0.05" min="0.2" max="1.2" value={c.size ?? 0.4} onChange={(e) => patchColumn(c._idx, { size: +e.target.value })} />),
                  ...zustandFelder(c, (p) => patchColumn(c._idx, p), zfOpts),
                  ...sbFelder(c, "stuetze", "customColumns", (p) => patchColumn(c._idx, p)),
                ];
              } else if (panelSel.type === "opening") {
                const scope = panelSel.scope || "custom";
                const o = (scope === "env" ? envOpenings : customWindows).find((x) => x._idx === panelSel.index); if (!o) return null;
                const types = o.kind === "door" ? DOOR_TYPES : WINDOW_TYPES;
                const ohneFuellung = istOeffnungOhneFuellung(o); // 107-04: opening without a filling (IfcOpeningElement only)
                title = o.kind === "door" ? "Tür" : ohneFuellung ? tz("Öffnung") : "Fenster"; favSpec = ohneFuellung ? null : { tool: o.kind, typeId: o.typeId };
                // 107-04: own sizes (empty = the size of the type) and the height anchor of the sill; the lintel is shown, not stored
                const wirtO = wirtVon(o, wirtModell);
                const mO = wirtO ? masseAmWand(o, wirtO.wand, wirtO.wand.unterkante_m) : oeffnungsMasse(o);
                const typ0 = openingTypeById(o.kind, o.typeId);
                const masseFeld = (feld, platz, label, min) => field(label, <input type="number" className={numCls} step="0.05" min={min} placeholder={String(platz)} title={tz("leer = Maß des Typs")}
                  value={o[feld] ?? ""} aria-label={label} data-testid={`oeffnung-${feld}`} onChange={(e) => patchOpening(o._idx, scope, { [feld]: e.target.value === "" ? undefined : +e.target.value })} />);
                body = [
                  field("Art", <select className={selCls} value={o.kind} onChange={(e) => { const k = e.target.value; const def = k === "door" ? DOOR_TYPES[0].id : k === "oeffnung" ? "oeffnung" : WINDOW_TYPES[0].id; patchOpening(o._idx, scope, { kind: k, typeId: def }); }}><option value="window">Fenster</option><option value="door">Tür</option><option value="oeffnung">{tz("Öffnung (ohne Füllung)")}</option></select>),
                  ...(ohneFuellung ? [] : [field("Typ", <select className={selCls} value={o.typeId} onChange={(e) => patchOpening(o._idx, scope, { typeId: e.target.value })}>{types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}</select>)]),
                  field("Position (m)", <input type="number" className={numCls} step="0.25" value={+o.u.toFixed(2)} onChange={(e) => patchOpening(o._idx, scope, { u: Math.max(0.2, +e.target.value) })} />),
                  masseFeld("width", typ0.w, tz("Breite (m)"), "0.1"),
                  masseFeld("height", typ0.h, tz("Höhe (m)"), "0.1"),
                  masseFeld("sill", typ0.sill, tz("Brüstung (m)"), "0"),
                  field(tz("Brüstung ab"), <select className={selCls} value={BRUESTUNG_BEZUEGE.includes(o.bruestung_bezug) ? o.bruestung_bezug : "wand_uk"} data-testid="oeffnung-bezug" aria-label={tz("Höhenbezug der Brüstung")}
                    title={tz("Woher die Brüstung gemessen wird: Wand-Unterkante, Oberkante Rohdecke (OKRD) oder Oberkante Fertigfußboden (OKFF)")}
                    onChange={(e) => patchOpening(o._idx, scope, { bruestung_bezug: e.target.value === "wand_uk" ? undefined : e.target.value })}>
                    <option value="wand_uk">{tz("Wand-Unterkante")}</option><option value="okrd">{tz("OK Rohdecke (OKRD)")}</option><option value="okff">{tz("OK Fertigfußboden (OKFF)")}</option></select>),
                  field(tz("Sturz (m)"), <span className="text-muted-foreground" data-testid="oeffnung-sturz">{mO.sturz.toFixed(2)}</span>),
                  field("Lage", <span className="text-slate-400">{scope === "env" ? "Hüllwand" : "Innenwand"}</span>),
                  ...zustandFelder(o, (p) => patchOpening(o._idx, scope, p), zfOpts),
                  ...sbFelder(o, o.kind === "door" ? (scope === "env" ? "tuer-aussen" : "tuer-innen") : ohneFuellung ? "oeffnung" : "fenster", `oeffnung|${scope === "env" ? `env:${o.level}:${o.edge}` : `cw:${o.wallIdx}`}|${o.kind}|${o._idx}`, (p) => patchOpening(o._idx, scope, p)),
                ];
              } else if (panelSel.type === "zone") {
                const z = customZones.find((x) => x._idx === panelSel.index); if (!z) return null;
                const area = Math.abs(z.points.reduce((a, p, i) => { const q = z.points[(i + 1) % z.points.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
                title = "Raum";
                body = [
                  field("Name", <input type="text" className="w-28 rounded border border-slate-300 px-1 py-0.5 bg-white" value={z.name} onChange={(e) => patchZone(z._idx, { name: e.target.value })} />),
                  field("Geschoss", <select className={selCls} value={z.level} onChange={(e) => patchZone(z._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Fläche", <span className="text-slate-500">{area.toFixed(1)} m²</span>),
                  ...sbFelder(z, "raum", "customZones", (p) => patchZone(z._idx, p)),
                ];
              } else if (panelSel.type === "slab") {
                const s = customSlabs.find((x) => x._idx === panelSel.index); if (!s) return null;
                title = "Decke";
                const sLage = deckenLage(s, gs, "decke");
                body = [field("Geschoss", <select className={selCls} value={s.level} onChange={(e) => patchSlab(s._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  // 107-02: thickness and reference side of the slab (default 0.22 m, upper edge on the storey ceiling = today)
                  field(tz("Dicke (m)"), <input type="number" className={numCls} step="0.01" min="0.05" max="1" value={+sLage.dicke_m.toFixed(3)} onChange={(e) => patchSlab(s._idx, { dicke_m: +e.target.value })} aria-label={tz("Dicke (m)")} />),
                  field(tz("Bezug"), <select className={selCls} value={s.bezug === "unten" ? "unten" : "oben"} title={tz("Welche Kante der Decke auf der Geschossebene liegt")} aria-label={tz("Bezug der Decke")} onChange={(e) => patchSlab(s._idx, { bezug: e.target.value })}><option value="oben">{tz("Oberkante auf Geschossebene")}</option><option value="unten">{tz("Unterkante auf Geschossebene")}</option></select>),
                  // 107-04: holes of the slab (`oeffnungen`), drawn with the tool "Öffnung" on the slab in 3D
                  ...((s.oeffnungen || []).length ? [field(tz("Öffnungen"), <span className="flex items-center gap-1"><span data-testid="decke-oeffnungen">{s.oeffnungen.length}</span>
                    <button type="button" className="text-destructive hover:underline" onClick={() => patchSlab(s._idx, { oeffnungen: s.oeffnungen.length > 1 ? s.oeffnungen.slice(0, -1) : undefined })}>{tz("letzte entfernen")}</button></span>)] : []),
                  // 107-03 task 5: optional build-up of the slab from the project build-ups (data and data sheet only; the thickness above still leads the geometry)
                  ...(Object.keys(aufbautenLayer?.aufbauten || {}).length ? [field("Aufbau", <select className={selCls} value={s.composite || ""} data-testid="decke-aufbau" aria-label={tz("Projektaufbau")}
                    onChange={(e) => patchSlab(s._idx, { composite: e.target.value || undefined })}><option value="">—</option>{aufbautenListe().filter((c) => aufbautenLayer?.aufbauten?.[c.id]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)] : []),
                  ...zustandFelder(s, (p) => patchSlab(s._idx, p), zfOpts), ...sbFelder(s, "decke", "customSlabs", (p) => patchSlab(s._idx, p))];
              } else if (panelSel.type === "roof") {
                const rf = customRoofs.find((x) => x._idx === panelSel.index); if (!rf) return null;
                title = "Dach";
                body = [
                  field("Geschoss", <select className={selCls} value={rf.level} onChange={(e) => patchRoof(rf._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  // 107-02: ridge rise (m) and slope (°) are two fields; the one typed last leads, the other follows (old field `pitch` mirrors the rise)
                  field("Firsthöhe (m)", <input type="number" className={numCls} step="0.25" min="0.5" max="6" value={+dachFirsthoehe_m(rf).toFixed(2)} onChange={(e) => patchRoof(rf._idx, { firsthoehe_m: +e.target.value, pitch: +e.target.value, neigung_grad: undefined })} />),
                  field(tz("Neigung (°)"), <input type="number" className={numCls} step="1" min="0" max={MAX_NEIGUNG_GRAD} value={+dachNeigung_grad(rf).toFixed(1)} aria-label={tz("Neigung (°)")} onChange={(e) => { const g = +e.target.value; const h = Math.round(firsthoeheAusNeigung(rf.points, g) * 100) / 100; patchRoof(rf._idx, { neigung_grad: g, firsthoehe_m: h, pitch: h }); }} />),
                  field(tz("Dicke (m)"), <input type="number" className={numCls} step="0.01" min="0.05" max="1" value={+deckenLage(rf, gs, "dach").dicke_m.toFixed(3)} onChange={(e) => patchRoof(rf._idx, { dicke_m: +e.target.value })} aria-label={tz("Dicke (m)")} />),
                  field(tz("Bezug"), <select className={selCls} value={rf.bezug === "oben" ? "oben" : "unten"} aria-label={tz("Bezug des Dachs")} onChange={(e) => patchRoof(rf._idx, { bezug: e.target.value })}><option value="unten">{tz("Unterkante auf Traufe")}</option><option value="oben">{tz("Oberkante auf Traufe")}</option></select>),
                  ...zustandFelder(rf, (p) => patchRoof(rf._idx, p), zfOpts),
                  ...sbFelder(rf, dachNeigung_grad(rf) <= FLACHDACH_BIS_GRAD ? "dach-flach" : "dach-geneigt", "customRoofs", (p) => patchRoof(rf._idx, p)),
                ];
              } else if (panelSel.type === "hullwall") {
                const w = model.walls.find((x) => x.level === panelSel.level && x.edge === panelSel.edge); if (!w) return null;
                const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
                const hasComp = !!compositeById(envComposite);
                title = "Hüllwand"; readOnly = true; // generiert → kein Löschen, aber Aufbau/Dicke editierbar (ganze Hülle)
                body = [
                  field("Geschoss", <span className="text-slate-500">{model.storeys.find((s) => s.level === w.level)?.name}</span>),
                  field("Länge", <span className="text-slate-500">{len.toFixed(2)} m</span>),
                  field("Aufbau", <select className={selCls} value={envComposite || "single"} onChange={(e) => setEnvComposite(e.target.value === "single" ? null : e.target.value)}><option value="single">Einschichtig</option>{aufbautenListe().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>),
                  !hasComp && field("Dicke (m)", <input type="number" className={numCls} step="0.05" min="0.1" max="0.6" value={envThickness} onChange={(e) => setEnvThickness(+e.target.value)} />),
                  // 107-01 (D-BK-02): where the hull wall lies against the footprint line; footprint, slabs and zones never move
                  field(tz("Bezug der Hülle"), <select className={selCls} value={huelleBezug} onChange={(e) => setHuelleBezug(e.target.value)} title={tz("Nur die Wandkörper verschieben sich; Grundrisslinie, Decken und Räume bleiben")} aria-label={tz("Bezug der Hülle")}>{bezugWahl(tz, true).map(([v, l, h]) => <option key={v} value={v} title={h}>{l}</option>)}</select>),
                  // 107-02 review: the hull slabs (all storeys and the base plate) get a thickness and a reference side like drawn slabs
                  field(tz("Dicke der Hüllplatten (m)"), <input type="number" className={numCls} step="0.01" min="0.05" max="1" value={huelleDeckeDicke} onChange={(e) => { const v = +e.target.value; if (v > 0) setHuelleDeckeDicke(v); }} aria-label={tz("Dicke der Hüllplatten (m)")} data-testid="huelle-decke-dicke" />),
                  field(tz("Bezug der Hüllplatten"), <select className={selCls} value={huelleDeckeBezug} aria-label={tz("Bezug der Hüllplatten")} onChange={(e) => setHuelleDeckeBezug(e.target.value === "oben" ? "oben" : "unten")}><option value="unten">{tz("Unterkante auf Geschossebene")}</option><option value="oben">{tz("Oberkante auf Geschossebene")}</option></select>),
                  field("Hinweis", <span className="text-slate-400 text-[10px]">Griffe ziehen verformt den Grundriss (alle Geschosse)</span>),
                  // 97-02: the hull's decisions live in the attribute table ("hull-wall" — one entry for the
                  // whole generated envelope, as the AVA classifies it); written at once, not with the debounce.
                  ...(() => {
                    const huellPatch = (p) => {
                      const neu = attributPatch(attributLayer, "hull-wall", p);
                      setAttributLayer(neu);
                      saveBimModel(projectId, { bauteil_attribute_layer: neu }).catch((err) => setHint(`Speichern fehlgeschlagen: ${err?.message || err}`));
                    };
                    const huelle = mitAttributen({ ...w, huelle: true, composite: envComposite || undefined, thickness: envThickness, id: `${w.level}:${w.edge}` }, attributeVon(attributLayer, "hull-wall"));
                    return [...zustandFelder(/** @type {{status?: string, erfassung?: string}} */ (huelle), huellPatch, zfOpts), ...sbFelder(huelle, "wand-aussen", "huelle", huellPatch)];
                  })(),
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
                <button onClick={exportPlanDXF} data-testid="bim-plan-dxf" className="w-full mt-1 rounded-md border border-border text-muted-foreground px-2 py-1.5 hover:bg-muted">{tz("Aktuellen Plan als DXF")}</button>
                <button onClick={downloadIFC} className="w-full mt-1 rounded-md border border-slate-300 text-slate-600 px-2 py-1.5 hover:bg-slate-50">Modell als IFC</button>
                <div className="px-1 pt-1 text-[10px] text-slate-400">Grundriss und Schnitt: Vektor-PDF im gewählten Maßstab mit Plankopf und Brille (Blatt A3–A0 nach Größe), Schnitt mit Höhenkoten.</div>
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
          <span>Wände: <b className="text-slate-700">{customWalls.length}</b> · Stützen: <b className="text-slate-700">{customColumns.length}</b> · Fenster: <b className="text-slate-700">{[...customWindows, ...envOpenings].filter((o) => o.kind !== "door" && o.kind !== "oeffnung").length}</b> · Türen: <b className="text-slate-700">{[...customWindows, ...envOpenings].filter((o) => o.kind === "door").length}</b>{[...customWindows, ...envOpenings].some((o) => o.kind === "oeffnung") && <> · {tz("Öffnungen")}: <b className="text-foreground">{[...customWindows, ...envOpenings].filter((o) => o.kind === "oeffnung").length}</b></>} · Räume: <b className="text-slate-700">{customZones.length}</b> · Decken: <b className="text-slate-700">{customSlabs.length}</b> · Dächer: <b className="text-slate-700">{customRoofs.length}</b></span>
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
              : tool === "oeffnung" ? tz("Öffnung: im Grundriss auf eine Wand klicken — oder in 3D zwei Ecken auf einer Wand- oder Deckenfläche")
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
