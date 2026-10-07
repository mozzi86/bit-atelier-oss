import React, { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { Camera } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { lichtrichtung } from "@designer/lib/sonnenstand";
import {
  ISO_PITCH_GRAD, ISO_START_YAW, ISO_ZOOMSTUFEN, KAMERA_ABSTAND_M, RAD_SCHWELLE,
  RAND_VERWEIL_MS, PAN_PX_JE_S,
  pxJeMeter, frustumFuer, kameraPosition, einpassenStufe,
  bodenpunktUnterCursor, zoomAufPunkt, verschiebeZiel,
  zoomEinrasten, naechsteZoomstufe, yawDrehen, yawInterpol,
  tweenFortschritt, tweenDauer, nordpfeilWinkel, randScrollRichtung,
} from "@designer/lib/isoKamera";

// MassingView3D — iso window of the massing studio (Phase 75-08, MS-08).
// True 3D of the free-polygon body incl. setback strips on the ground, drawn
// with an ORTHOGRAPHIC iso camera (pitch 30°, yaw detents 45/135/225/315°)
// on the convention in lib/isoKamera.js — engine-independent, also reused by
// 75-09 (iso of the dwelling unit). Render-on-demand: no rAF loop while idle
// (data-iso-schleife="aus" on the wrapper); the loop runs only during a tween,
// while pan keys are held or while edge-scrolling is active.
//
// Input layer (Task 3): ALL keyboard handlers sit on the focused wrapper — no
// window/document listeners (the 2D corner handles need the arrow keys and
// MassingStudio's Ctrl+Z keeps working: modifier keys are passed through
// without preventDefault/stopPropagation). Pointer handlers live on the canvas
// with pointer capture instead of window listeners.
//
// Props (contract, all additive — every default keeps a bare call working):
//   poly:     [{x,y}] site coordinates in metres (y = depth), >= 3 points
//   siteW/D:  site dimensions in m
//   height:   building height in m
//   setbacks: [{ pts: [{x,y} x4], conflict: bool }] setback strip per facade
//   sonne:    { elevation, azimuth } degrees, GEOGRAPHIC (from sunPosition) —
//             null keeps the legacy fixed light (60, 100, 40)
//   schatten: bool, shadow casting on/off (follows "Schatten anzeigen")
//   nordwinkel: geographic azimuth of plan-up, degrees (nordwinkel.js convention)
//   nachbarn: [{ points: [{x,z}], height }] OSM neighbours in metres relative
//             to the SITE CENTRE (same reference as the 2D plan)
//   massstab: scale denominator or null — a change AFTER mount tweens the iso
//             zoom to that ladder level (the iso never writes back to the chip)
//   info:     { name, geschosse, bgfM2 } tooltip content (bgfM2 in m²)
//   kameraRef: React ref — camera state survives remounts (mode switch 2D ↔
//             Iso ↔ Split mounts this component at different tree positions)
//   fokusZonen (75-09): [{ points: [{x,y}], level }] — rooms of ONE dwelling
//             unit in the SAME site frame as `poly` (see isoSzeneAusModell);
//             each zone extrudes one storey tall as a teal volume, and the
//             building body turns semi-transparent so the unit stays readable.
//             null/empty (default) ⇒ rendering byte-identical to 75-08.
//   geschossHoehe (75-09): storey height in metres (default 3) — vertical
//             extent of each focus-zone volume (level · geschossHoehe).
//
// Scene = plan axes (isoKamera convention): x = plan right (east at north
// angle 0), z = plan down (south), y = up; origin = site centre.
function toX3d(p, siteW) { return p.x - siteW / 2; }
function toZ3d(p, siteD) { return p.y - siteD / 2; }

// Centre of the body's bounding box in SCENE metres — the initial camera
// target so the image centre always sits on the building (the headless
// tooltip test hovers the canvas centre). Invalid input → scene origin.
function bboxMitte(poly, siteW, siteD) {
  if (!Array.isArray(poly) || poly.length < 3) return { x: 0, z: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, z: 0 };
  return { x: (minX + maxX) / 2 - siteW / 2, z: (minY + maxY) / 2 - siteD / 2 };
}

// Exposé-Export: aktuellen WebGL-Canvas hochauflösend (2×) als PNG herunterladen.
// toDataURL MUSS direkt nach dem synchronen render() gelesen werden (kein
// preserveDrawingBuffer nötig); danach Pixel-Ratio zurücksetzen + neu rendern.
export function exportExposePng(three) {
  const t = three || {};
  if (!t.renderer || !t.scene || !t.camera) return;
  const prev = t.renderer.getPixelRatio();
  try {
    t.renderer.setPixelRatio(2);
    t.renderer.render(t.scene, t.camera);
    const url = t.renderer.domElement.toDataURL("image/png");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `Expose_${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error("Exposé-Export fehlgeschlagen:", err);
  } finally {
    t.renderer.setPixelRatio(prev);
    t.renderer.render(t.scene, t.camera);
  }
}

// Gruppe vollstaendig leeren und Ressourcen freigeben (wie Terrain-Rebuild).
// A shared material disposed by several meshes is safe: three.js dispose is
// idempotent (the neighbours group uses ONE shared material, Task 4 E).
function clearGroup(group) {
  while (group.children.length) {
    const c = group.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
  }
}

/** Keys that pan the view; arrows map onto the WASD set (QWERTZ keeps WASD in
 *  the same physical positions). Values are the pan directions used below. */
const PAN_TASTEN = {
  w: "w", a: "a", s: "s", d: "d",
  ArrowUp: "w", ArrowLeft: "a", ArrowDown: "s", ArrowRight: "d",
};

/** Neighbour polygon point cap — DoS guard against malformed OSM data
 *  (T-75-08-02) [ASSUMED]: a real building outline never needs 400 points. */
const NACHBAR_MAX_PUNKTE = 400;
/** Neighbour extrusion height bounds, metres (T-75-08-02) [ASSUMED]. */
const NACHBAR_HOEHE_MIN_M = 0; // exclusive
const NACHBAR_HOEHE_MAX_M = 300; // inclusive
/** Fallback neighbour height, metres — same default as useOsmBuildings. */
const NACHBAR_HOEHE_DEFAULT_M = 9;
/** Edge highlight colour on hover [ASSUMED Kantenlicht] — amber reads as
 *  "selected" against the blue body edges (0x1d4ed8). */
const KANTEN_FARBE = 0x1d4ed8;
const KANTEN_FARBE_HOVER = 0xf59e0b;
/** Neighbour grey [ASSUMED] — slate-400, same family as the 2D plan's
 *  neighbour fill (#94a3b8) but opaque for readable 3D shading. */
const NACHBAR_FARBE = 0x9ca3af;
/** Focus-zone teal (75-09) [ASSUMED] — 0x0f766e is the colour of the focus
 *  room outline in the 2D plan (WohnungsFokus), so the iso highlight matches. */
const FOKUS_FARBE = 0x0f766e;
/** Body opacity when focus zones are shown (75-09) [ASSUMED 0.25] — the
 *  building turns glassy so the unit volume inside stays readable; WITHOUT
 *  fokusZonen the body keeps its 75-08 opacity 0.92 (byte-identical). */
const FOKUS_BODY_OPACITY = 0.25;
/** Vertical offset/shrink of focus volumes, metres (75-09) [ASSUMED] — the
 *  2 cm gap at floor and ceiling avoids z-fighting with the body's surfaces. */
const FOKUS_Z_OFFSET_M = 0.02;
/** 75-13: slab thickness of a balcony zone in the iso, m [ASSUMED 0,20 — reinforced-concrete slab]. */
const BALKON_PLATTE_M = 0.2;
/** Tooltip offset from the pointer, CSS px [ASSUMED]. */
const TOOLTIP_VERSATZ_PX = 12;
/** Sun light distance from the origin, metres — far enough that the ±120 m
 *  shadow camera covers the site, inside the light's far plane (400 m). */
const LICHT_ABSTAND_M = 200;

export default function MassingView3D({
  poly, siteW, siteD, height, setbacks,
  sonne = null, schatten = true, nordwinkel = 0, nachbarn = [],
  massstab = null, info = null, kameraRef = null,
  fokusZonen = null, geschossHoehe = 3,
}) {
  const { t } = useI18n();
  const mountRef = useRef(null);
  const wrapperRef = useRef(null);
  const tooltipRef = useRef(null);
  const nordRef = useRef(null);
  /** three.js handles + closures, filled by the setup effect. Mutable bag —
   *  typed as any-map so checkJs does not flag every `.camera` access (the
   *  bag's shape changes between effects; a rigid type would be a lie). */
  /** @type {React.MutableRefObject<{[k: string]: any}>} */
  const three = useRef({});
  // Latest props for handlers created once in the setup effect (avoids stale
  // closures without re-running the scene setup).
  /** @type {React.MutableRefObject<{[k: string]: any}>} */
  const propsRef = useRef({});
  propsRef.current = { poly, siteW, siteD, height, sonne, nordwinkel, info, geschossHoehe };
  // 75-09: focus mode is active when at least one zone volume was passed —
  // the body turns semi-transparent (mesh effect dependency) and the wrapper
  // carries data-iso-fokus-zonen. Derived from the PROP only (not from GL
  // state) so e2e specs can assert it without WebGL.
  const fokusAktiv = Array.isArray(fokusZonen) && fokusZonen.length > 0;
  // Input layer state (Task 3): pressed pan keys, drag, edge-scroll dwell,
  // the single active tween and the wheel accumulator.
  /** Input-layer state. `tween` is null between tweens — typed as any so the
   *  effect may fill it without a cast at every use. */
  /** @type {React.MutableRefObject<{panKeys: Set<string>, drag: {on: boolean, x: number, y: number, id: number|null}, edge: {dx: number, dy: number, seit: number}, tween: any, radAccum: number, letzteZeit: number, loopGeplant?: boolean, loopRaf?: number}>} */
  const eingabe = useRef({ panKeys: new Set(), drag: { on: false, x: 0, y: 0, id: null }, edge: { dx: 0, dy: 0, seit: 0 }, tween: null, radAccum: 0, letzteZeit: 0 });
  // Camera state (isoKamera convention): yaw/pitch degrees, ziel = ground
  // target in scene metres, massstab = ladder denominator (fractional during
  // a zoom tween), zielYaw/zielMassstab = tween TARGETS (shown in the wrapper
  // dataset immediately, requirement "data-iso-yaw shows the target value").
  const kam = useRef({
    yaw: ISO_START_YAW, zielYaw: ISO_START_YAW, pitch: ISO_PITCH_GRAD,
    ziel: { x: 0, z: 0 }, massstab: 500, zielMassstab: 500, pxJeM: pxJeMeter(500),
  });
  // null = WebGL ok; "kein-webgl" = creation failed; "verloren" = context lost.
  const [glFehler, setGlFehler] = useState(null);
  const glFehlerRef = useRef(null);
  glFehlerRef.current = glFehler;
  // Tooltip content — React state changes ONLY on hit change (enter/leave);
  // the position updates directly via ref (no re-render per mousemove).
  const [hoverInfo, setHoverInfo] = useState(null);
  // Previous massstab PROP value; null = the first run (skipped, Task 3 I).
  const prevMassstab = useRef(null);

  // Scene setup ONCE: renderer, orthographic camera, light, groups,
  // render-on-demand, input layer, ResizeObserver, WebGL-context guards.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth || 600;
    const H = mount.clientHeight || 420;
    // Snapshot of the mutable input ref for the cleanup function (react-hooks
    // lint: eingabe.current may have changed by unmount; the object identity
    // is stable across the component's life, so one snapshot is correct).
    const eingabeSnapshot = eingabe.current;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      if (!renderer.getContext()) throw new Error("WebGL context is null");
    } catch (err) {
      // Headless/old browsers without WebGL: plain-text fallback instead of a
      // crash or a blank canvas (requirement mv-fallback). console.error text
      // contains "WebGL" → the e2e console guard (ERLAUBT_OFFLINE) allows it.
      console.error("WebGL nicht verfügbar:", err);
      setGlFehler("kein-webgl");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0xf8fafc, 1); // heller Hintergrund
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(60, 100, 40); // legacy fixed light — replaced by the sun effect when the sonne prop arrives
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -120;
    dir.shadow.camera.right = 120;
    dir.shadow.camera.top = 120;
    dir.shadow.camera.bottom = -120;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 400;
    // The light target is the SCENE ORIGIN (site centre), NOT the camera
    // target: the ±120 m shadow camera must stay on the site while panning.
    scene.add(dir.target);
    scene.add(dir);

    // Static scene: the body group does NOT rotate any more (old group-orbit)
    // — the CAMERA moves, on the isoKamera convention. Neighbours live in
    // their OWN group so a polygon drag never rebuilds them (Task 4 E).
    const group = new THREE.Group();
    scene.add(group);
    const nbGroup = new THREE.Group();
    scene.add(nbGroup);
    // 75-09: third group for the focus-zone volumes — own group, own effect
    // (pattern from the neighbours, Task 4 E); EMPTY without the prop, so the
    // scene graph and the rendered image stay byte-identical to 75-08.
    const fzGroup = new THREE.Group();
    scene.add(fzGroup);

    // Orthographic camera: near/far only clip (0.1…2000 m covers the 500-m
    // camera distance); image size comes from the frustum = scale ladder.
    const f0 = frustumFuer(500, W, H);
    const camera = new THREE.OrthographicCamera(f0.links, f0.rechts, f0.oben, f0.unten, 0.1, 2000);

    // Start state: yaw 45° (camera south-west), target = body bbox centre,
    // level = finest ladder rung that fits the whole site + height. A valid
    // kameraRef (surviving a mode-switch remount, Task 3 H) wins.
    const startZiel = bboxMitte(propsRef.current.poly, propsRef.current.siteW, propsRef.current.siteD);
    const startStufe = einpassenStufe(
      { breiteM: propsRef.current.siteW, tiefeM: propsRef.current.siteD, hoeheM: propsRef.current.height }, W, H);
    const refState = kameraRef?.current;
    const refOk = refState && Number.isFinite(refState.yaw)
      && Number.isFinite(refState.ziel?.x) && Number.isFinite(refState.ziel?.z)
      && Number.isFinite(refState.massstab);
    kam.current = {
      yaw: refOk ? refState.yaw : ISO_START_YAW,
      zielYaw: refOk ? refState.yaw : ISO_START_YAW,
      pitch: ISO_PITCH_GRAD,
      ziel: refOk ? { x: refState.ziel.x, z: refState.ziel.z } : startZiel,
      massstab: refOk ? zoomEinrasten(refState.massstab) : startStufe,
      zielMassstab: refOk ? zoomEinrasten(refState.massstab) : startStufe,
      pxJeM: 0, // set by anwenden()
    };
    kam.current.pxJeM = pxJeMeter(kam.current.massstab);

    // --- Render-on-demand: exactly ONE scheduled rAF per change burst ------
    const requestRender = () => {
      const tt = three.current;
      if (tt.renderGeplant || glFehlerRef.current) return;
      tt.renderGeplant = true;
      tt.renderRaf = requestAnimationFrame(() => {
        tt.renderGeplant = false;
        if (tt.renderer && tt.scene && tt.camera && !glFehlerRef.current) tt.renderer.render(tt.scene, tt.camera);
      });
    };

    // --- Apply the camera state (Task 1): frustum, position, lookAt, state
    // anchors in the wrapper dataset (no React re-render per frame), north
    // arrow, kameraRef write-back.
    const anwenden = () => {
      const tt = three.current;
      const wrap = wrapperRef.current;
      if (!tt.camera || !mountRef.current) return;
      const k = kam.current;
      const nw = mountRef.current.clientWidth || 600;
      const nh = mountRef.current.clientHeight || 420;
      const f = frustumFuer(k.massstab, nw, nh);
      tt.camera.left = f.links;
      tt.camera.right = f.rechts;
      tt.camera.top = f.oben;
      tt.camera.bottom = f.unten;
      const pos = kameraPosition({ yaw: k.yaw, pitch: k.pitch, abstand: KAMERA_ABSTAND_M }, k.ziel);
      tt.camera.position.set(pos.x, pos.y, pos.z);
      tt.camera.lookAt(k.ziel.x, 0, k.ziel.z);
      tt.camera.updateProjectionMatrix();
      k.pxJeM = f.pxJeM;
      if (wrap) {
        // Dataset shows the TARGET values (requirement: data-iso-yaw = target).
        wrap.dataset.isoYaw = String(k.zielYaw);
        wrap.dataset.isoMassstab = String(k.zielMassstab);
      }
      // North arrow (Task 3 G): rotate to where geographic north points.
      if (nordRef.current) {
        nordRef.current.style.transform = `rotate(${nordpfeilWinkel(k.yaw, k.pitch, Number(propsRef.current.nordwinkel) || 0)}deg)`;
      }
      // Camera state survives remounts (Task 3 H): write back the targets.
      if (kameraRef) kameraRef.current = { yaw: k.zielYaw, ziel: { x: k.ziel.x, z: k.ziel.z }, massstab: k.zielMassstab };
      requestRender();
    };

    // --- prefers-reduced-motion → tween duration 0 (jump) -------------------
    const reduziert = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // --- The ONE loop (Task 3 F): tween + pan, self-scheduling only while
    // active; stops and reports data-iso-schleife="aus" when idle.
    const startLoop = () => {
      const e = eingabe.current;
      if (e.loopGeplant) return;
      e.loopGeplant = true;
      e.letzteZeit = 0;
      if (wrapperRef.current) wrapperRef.current.dataset.isoSchleife = "an";
      e.loopRaf = requestAnimationFrame(schritt);
    };
    const schritt = (jetzt) => {
      const e = eingabe.current;
      const k = kam.current;
      e.loopGeplant = false;
      const dt = e.letzteZeit ? Math.min(100, jetzt - e.letzteZeit) : 0; // ms; capped after tab sleep
      e.letzteZeit = jetzt;
      let aktiv = false;

      // 1) Tween (yaw via shortest arc, zoom via log-space scale interp with
      //    the ground point under the cursor held fixed EVERY frame).
      if (e.tween) {
        const tw = e.tween;
        const x = tweenFortschritt(jetzt - tw.start, tw.dauer);
        if (tw.yaw) k.yaw = yawInterpol(tw.yaw.von, tw.yaw.bis, x);
        if (tw.zoom) {
          const logM = Math.log(tw.zoom.vonM) + (Math.log(tw.zoom.bisM) - Math.log(tw.zoom.vonM)) * x;
          k.massstab = Math.exp(logM);
          k.pxJeM = pxJeMeter(k.massstab);
          k.ziel = zoomAufPunkt(tw.zoom.ziel0, tw.zoom.G, tw.zoom.pxJeM0, k.pxJeM);
        }
        if (x < 1) aktiv = true;
        else tweenBeenden();
      }

      // 2) Pan from held keys and/or edge-scroll (dt-based, screen px/s).
      let dxPx = 0, dyPx = 0;
      if (e.panKeys.has("a")) dxPx -= PAN_PX_JE_S * (dt / 1000);
      if (e.panKeys.has("d")) dxPx += PAN_PX_JE_S * (dt / 1000);
      if (e.panKeys.has("w")) dyPx -= PAN_PX_JE_S * (dt / 1000);
      if (e.panKeys.has("s")) dyPx += PAN_PX_JE_S * (dt / 1000);
      // Edge-scroll: the dwell timer must keep the loop ALIVE while the
      // pointer rests inside the band (no further pointermove events) — pan
      // starts only after RAND_VERWEIL_MS (moving through the band shifts
      // nothing).
      if (e.edge.seit) {
        if (jetzt - e.edge.seit >= RAND_VERWEIL_MS && !e.drag.on) {
          dxPx += e.edge.dx * PAN_PX_JE_S * (dt / 1000);
          dyPx += e.edge.dy * PAN_PX_JE_S * (dt / 1000);
        }
        aktiv = true;
      }
      if (e.panKeys.size) aktiv = true;
      if (dxPx || dyPx) {
        k.ziel = verschiebeZiel({ yaw: k.yaw, pitch: k.pitch, ziel: k.ziel, pxJeM: k.pxJeM }, dxPx, dyPx);
      }

      anwenden();
      if (aktiv) startLoop();
      else if (wrapperRef.current) wrapperRef.current.dataset.isoSchleife = "aus";
    };

    // Snap the running tween to its target (used when a new detent starts —
    // "further detents during a tween start from the running tween's target").
    const tweenBeenden = () => {
      const e = eingabe.current;
      const k = kam.current;
      const tw = e.tween;
      if (!tw) return;
      if (tw.yaw) k.yaw = tw.yaw.bis;
      if (tw.zoom) {
        k.massstab = tw.zoom.bisM;
        k.pxJeM = pxJeMeter(tw.zoom.bisM);
        k.ziel = zoomAufPunkt(tw.zoom.ziel0, tw.zoom.G, tw.zoom.pxJeM0, k.pxJeM);
      }
      e.tween = null;
    };

    // Start/extend a yaw tween by one 90° detent (Q/E).
    const starteYaw = (richtung) => {
      const e = eingabe.current;
      const k = kam.current;
      tweenBeenden();
      const von = k.zielYaw;
      const bis = yawDrehen(von, richtung);
      k.zielYaw = bis;
      const dauer = tweenDauer(reduziert());
      if (dauer === 0) { k.yaw = bis; anwenden(); return; }
      e.tween = Object.assign(e.tween || { start: performance.now(), dauer }, { start: performance.now(), dauer, yaw: { von, bis } });
      startLoop();
    };

    // Zoom tween to a ladder level around a fixed ground point G (cursor or
    // image centre). Unified: for centre zooms G = target, which zoomAufPunkt
    // keeps invariant.
    const starteZoom = (bisM, G) => {
      const e = eingabe.current;
      const k = kam.current;
      tweenBeenden();
      const zielM = zoomEinrasten(bisM);
      const dauer = tweenDauer(reduziert());
      const zoom = { vonM: k.massstab, bisM: zielM, ziel0: { x: k.ziel.x, z: k.ziel.z }, pxJeM0: k.pxJeM, G };
      k.zielMassstab = zielM;
      if (dauer === 0) {
        e.tween = { start: performance.now(), dauer: 0, zoom };
        tweenBeenden();
        anwenden();
        return;
      }
      e.tween = Object.assign(e.tween || {}, { start: performance.now(), dauer, zoom });
      startLoop();
    };

    // Home: start view (yaw 45, fit level, target = body bbox centre) as tween.
    const starteHome = () => {
      const e = eingabe.current;
      const k = kam.current;
      const p = propsRef.current;
      tweenBeenden();
      const nw = mountRef.current?.clientWidth || 600;
      const nh = mountRef.current?.clientHeight || 420;
      const stufe = einpassenStufe({ breiteM: p.siteW, tiefeM: p.siteD, hoeheM: p.height }, nw, nh);
      k.ziel = bboxMitte(p.poly, p.siteW, p.siteD);
      k.zielYaw = ISO_START_YAW;
      k.zielMassstab = stufe;
      const dauer = tweenDauer(reduziert());
      if (dauer === 0) {
        k.yaw = ISO_START_YAW;
        k.massstab = stufe;
        k.pxJeM = pxJeMeter(stufe);
        anwenden();
        return;
      }
      // Zoom part fixes the NEW centre (G = ziel0 → target never drifts).
      e.tween = {
        start: performance.now(), dauer,
        yaw: { von: k.yaw, bis: ISO_START_YAW },
        zoom: { vonM: k.massstab, bisM: stufe, ziel0: { x: k.ziel.x, z: k.ziel.z }, pxJeM0: k.pxJeM, G: { x: k.ziel.x, z: k.ziel.z } },
      };
      startLoop();
    };

    // Zoom one detent (or to an explicit ladder level) around the IMAGE
    // CENTRE (+/− keys, massstab prop).
    const zoomMitte = (zielOderRichtung) => {
      const k = kam.current;
      const nw = mountRef.current?.clientWidth || 600;
      const nh = mountRef.current?.clientHeight || 420;
      const G = bodenpunktUnterCursor(nw / 2, nh / 2, { yaw: k.yaw, pitch: k.pitch, ziel: k.ziel, pxJeM: k.pxJeM, breitePx: nw, hoehePx: nh });
      // An explicit ladder level (massstab prop) wins; otherwise one detent
      // step from the current TARGET level (+1 = finer, −1 = coarser).
      const bis = ISO_ZOOMSTUFEN.includes(zielOderRichtung)
        ? zielOderRichtung
        : naechsteZoomstufe(k.zielMassstab, zielOderRichtung);
      starteZoom(bis, G);
    };

    Object.assign(three.current, { renderer, scene, camera, group, nbGroup, fzGroup, dir, requestRender, anwenden, startLoop, starteYaw, starteZoom, starteHome, zoomMitte, tweenBeenden, reduziert });
    anwenden();

    // --- Keyboard (Task 3 B) — handlers are wired to the WRAPPER via React
    // props (onKeyDown/onKeyUp/onBlur); no window/document listener here.
    const steuerung = {
      keydown(ev) {
        const e = eingabe.current;
        // Modifiers pass through WITHOUT preventDefault/stopPropagation:
        // Ctrl+Z/Ctrl+Y must bubble to MassingStudio's undo handler, Ctrl+S
        // stays the browser's.
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const key = ev.key;
        const lower = typeof key === "string" ? key.toLowerCase() : "";
        if (lower === "q" || lower === "e") {
          if (!ev.repeat) { ev.preventDefault(); three.current.starteYaw(lower === "e" ? 1 : -1); }
          return;
        }
        const pan = PAN_TASTEN[key];
        if (pan) {
          ev.preventDefault(); // arrows would scroll the page
          e.panKeys.add(pan);
          startLoop();
          return;
        }
        if (lower === "+" || lower === "=") { if (!ev.repeat) { ev.preventDefault(); zoomMitte(1); } return; }
        if (lower === "-") { if (!ev.repeat) { ev.preventDefault(); zoomMitte(-1); } return; }
        if (key === "Home") { if (!ev.repeat) { ev.preventDefault(); starteHome(); } return; }
        if (key === "Escape") { wrapperRef.current?.blur(); return; }
      },
      keyup(ev) {
        const pan = PAN_TASTEN[ev.key];
        if (pan) eingabe.current.panKeys.delete(pan);
      },
      blur() {
        // No stuck keys: leaving the wrapper clears pan state and edge-scroll.
        const e = eingabe.current;
        e.panKeys.clear();
        e.edge = { dx: 0, dy: 0, seit: 0 };
      },
    };
    three.current.steuerung = steuerung;

    // --- Pointer + wheel on the canvas (Tasks 3 C/D/E, 4 B) -----------------
    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    three.current.ray = ray;

    // Hover test (Task 4 B): ONLY on mouse move, ONLY the body mesh.
    const hoverTest = (clientX, clientY) => {
      const tt = three.current;
      const e = eingabe.current;
      if (e.drag.on || !tt.bodyMesh || glFehlerRef.current) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, tt.camera);
      const hits = ray.intersectObject(tt.bodyMesh, false);
      const getroffen = hits.length > 0;
      if (getroffen !== tt.hoverAktiv) {
        tt.hoverAktiv = getroffen;
        if (tt.edgesMesh?.material?.color) tt.edgesMesh.material.color.setHex(getroffen ? KANTEN_FARBE_HOVER : KANTEN_FARBE);
        setHoverInfo(getroffen ? tooltipInhalt(propsRef.current.info, t) : null);
        tt.requestRender?.();
      }
      if (getroffen && tooltipRef.current) {
        // Position via ref (no re-render): 12 px right/below the pointer,
        // clamped inside the wrapper [ASSUMED offset].
        const wrap = wrapperRef.current;
        const tw2 = tooltipRef.current.offsetWidth || 160;
        const th = tooltipRef.current.offsetHeight || 60;
        const px2 = Math.max(0, Math.min(clientX - rect.left + TOOLTIP_VERSATZ_PX, (wrap?.clientWidth || rect.width) - tw2));
        const py = Math.max(0, Math.min(clientY - rect.top + TOOLTIP_VERSATZ_PX, (wrap?.clientHeight || rect.height) - th));
        tooltipRef.current.style.transform = `translate(${px2}px, ${py}px)`;
      }
    };

    const onPointerDown = (ev) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      // Middle button: preventDefault against the browser autoscroll glyph
      // (same pattern as the 2D plan, MassingStudio.jsx middle-drag).
      if (ev.button === 1) ev.preventDefault();
      wrapperRef.current?.focus({ preventScroll: true });
      const e = eingabe.current;
      e.drag = { on: true, x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      try { el.setPointerCapture(ev.pointerId); } catch { /* capture unsupported */ }
      el.style.cursor = "grabbing";
    };
    const onPointerMove = (ev) => {
      const e = eingabe.current;
      const k = kam.current;
      if (e.drag.on) {
        // Pan: the grabbed ground point sticks to the cursor — the VIEW moves
        // by (−mdx, −mdy), hence verschiebeZiel with negated deltas.
        const mdx = ev.clientX - e.drag.x;
        const mdy = ev.clientY - e.drag.y;
        e.drag.x = ev.clientX;
        e.drag.y = ev.clientY;
        if (mdx || mdy) {
          k.ziel = verschiebeZiel({ yaw: k.yaw, pitch: k.pitch, ziel: k.ziel, pxJeM: k.pxJeM }, -mdx, -mdy);
          anwenden();
        }
        return; // no hover test while dragging (Task 3 D)
      }
      hoverTest(ev.clientX, ev.clientY);
      // Edge-scroll (Task 3 E): only while the wrapper has focus.
      if (document.activeElement === wrapperRef.current) {
        const rect = el.getBoundingClientRect();
        const r = randScrollRichtung(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height);
        if (r.dx || r.dy) {
          if (!e.edge.seit || e.edge.dx !== r.dx || e.edge.dy !== r.dy) e.edge = { dx: r.dx, dy: r.dy, seit: performance.now() };
          startLoop();
        } else {
          e.edge = { dx: 0, dy: 0, seit: 0 };
        }
      }
    };
    const onPointerUp = (ev) => {
      const e = eingabe.current;
      if (!e.drag.on) return;
      e.drag.on = false;
      try { el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      el.style.cursor = "grab";
    };
    const onPointerLeave = () => {
      const e = eingabe.current;
      e.edge = { dx: 0, dy: 0, seit: 0 };
      const tt = three.current;
      if (tt.hoverAktiv) {
        tt.hoverAktiv = false;
        if (tt.edgesMesh?.material?.color) tt.edgesMesh.material.color.setHex(KANTEN_FARBE);
        setHoverInfo(null);
        tt.requestRender?.();
      }
    };
    const onWheel = (ev) => {
      ev.preventDefault();
      const e = eingabe.current;
      const k = kam.current;
      // deltaMode 1 = lines (×33 px [ASSUMED]), 2 = pages (× canvas height).
      const faktor = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? (mount.clientHeight || 420) : 1;
      e.radAccum += ev.deltaY * faktor;
      if (Math.abs(e.radAccum) < RAD_SCHWELLE) return; // below one notch — accumulate
      const schritte = Math.trunc(e.radAccum / RAD_SCHWELLE); // may exceed 1 on trackpad flings
      e.radAccum -= schritte * RAD_SCHWELLE;
      // deltaY > 0 (scroll down) = coarser, deltaY < 0 (scroll up) = finer.
      let bisM = k.zielMassstab;
      for (let i = 0; i < Math.abs(schritte); i += 1) bisM = naechsteZoomstufe(bisM, schritte > 0 ? -1 : 1);
      if (bisM === k.zielMassstab) return; // clamped at a ladder end
      // Ground point under the cursor at the START of the detent step; a
      // detent during a running tween starts from that tween's TARGET
      // (tweenBeenden), so snap first, then measure G.
      three.current.tweenBeenden();
      const rect = el.getBoundingClientRect();
      const G = bodenpunktUnterCursor(
        ev.clientX - rect.left, ev.clientY - rect.top,
        { yaw: k.yaw, pitch: k.pitch, ziel: k.ziel, pxJeM: k.pxJeM, breitePx: rect.width || 1, hoehePx: rect.height || 1 });
      three.current.starteZoom(bisM, G);
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("wheel", onWheel, { passive: false });

    // ResizeObserver instead of a window resize listener: the frame changes
    // size when the view mode switches (split!) without the window resizing.
    // The SCALE stays (frustum grows with the canvas) — same pxJeM, wider view.
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        const tt = three.current;
        const nw = mount.clientWidth, nh = mount.clientHeight;
        if (!nw || !nh || !tt.renderer) return;
        tt.renderer.setSize(nw, nh);
        tt.anwenden();
      });
      ro.observe(mount);
    }
    // Without ResizeObserver (every target browser has one): no resize handling.

    // WebGL context guards: plain text instead of a frozen canvas.
    const onLost = (ev) => {
      ev.preventDefault(); // allow the browser to fire webglcontextrestored
      // NO synchronous canvas removal here: removing it before React swaps the
      // branch would leave a moment with neither canvas nor fallback (seen as
      // an e2e flake under headless SwiftShader). The re-render below unmounts
      // the canvas together with its mount div — one atomic swap.
      setGlFehler("verloren");
    };
    const onRestored = () => {
      // three.js re-initialises its programs/textures on restore internally;
      // the glFehler effect below re-attaches the canvas after the re-render.
      setGlFehler(null);
    };
    el.addEventListener("webglcontextlost", onLost);
    el.addEventListener("webglcontextrestored", onRestored);

    return () => {
      const e = eingabeSnapshot;
      if (ro) ro.disconnect();
      cancelAnimationFrame(three.current.renderRaf || 0);
      cancelAnimationFrame(e.loopRaf || 0);
      // Context listeners off BEFORE forceContextLoss — a forced loss must
      // not flip the UI into the fallback while unmounting.
      el.removeEventListener("webglcontextlost", onLost);
      el.removeEventListener("webglcontextrestored", onRestored);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("wheel", onWheel);
      try { renderer.forceContextLoss(); } catch { /* context already gone */ }
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      three.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Massstab PROP change after mount (Task 3 I): tween the iso zoom to that
  // ladder level around the image centre. The first run is skipped (the mount
  // state comes from einpassenStufe/kameraRef); the iso NEVER writes back to
  // the chip — the chip is detail level, the zoom stays free (like the 2D).
  useEffect(() => {
    if (prevMassstab.current === null) { prevMassstab.current = massstab; return; }
    if (prevMassstab.current === massstab) return;
    prevMassstab.current = massstab;
    const tt = three.current;
    if (!tt.zoomMitte || massstab == null || !Number.isFinite(massstab)) return;
    tt.zoomMitte(zoomEinrasten(massstab));
  }, [massstab]);

  // Mesh-Gruppe bei Prop-Aenderung NEU aufbauen — OHNE Scene-Neuaufbau.
  useEffect(() => {
    const t3 = three.current;
    if (!t3.group) return;
    clearGroup(t3.group);
    t3.bodyMesh = null;
    t3.edgesMesh = null;
    t3.hoverAktiv = false;

    // Defensive Guards: ohne gueltiges Polygon nichts rendern
    if (!Array.isArray(poly) || poly.length < 3) { t3.requestRender?.(); return; }
    if (!(siteW > 0) || !(siteD > 0) || !(height > 0)) { t3.requestRender?.(); return; }

    // --- Grundstück: flache Plane, hellgrau, empfängt Schatten ---
    const groundGeo = new THREE.PlaneGeometry(siteW, siteD);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    t3.group.add(ground);

    // Gestrichelte Grundstücks-Grenze auf y=0.02
    const w2 = siteW / 2, d2 = siteD / 2;
    const borderPts = [
      new THREE.Vector3(-w2, 0.02, -d2),
      new THREE.Vector3(w2, 0.02, -d2),
      new THREE.Vector3(w2, 0.02, d2),
      new THREE.Vector3(-w2, 0.02, d2),
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const border = new THREE.LineLoop(
      borderGeo,
      new THREE.LineDashedMaterial({ color: 0x0f172a, dashSize: 1.2, gapSize: 0.8 })
    );
    border.computeLineDistances();
    t3.group.add(border);

    // --- Abstandsflächen: flache Streifen je Fassade auf y=0.05 ---
    (Array.isArray(setbacks) ? setbacks : []).forEach((sb) => {
      const pts = sb && Array.isArray(sb.pts) ? sb.pts : null;
      if (!pts || pts.length < 3) return;
      const shape = new THREE.Shape();
      pts.forEach((p, i) => {
        const sx = toX3d(p, siteW);
        const sy = -toZ3d(p, siteD); // Vorzeichen wie beim Baukörper-Shape
        if (i === 0) shape.moveTo(sx, sy);
        else shape.lineTo(sx, sy);
      });
      shape.closePath();
      const sbGeo = new THREE.ShapeGeometry(shape);
      sbGeo.rotateX(-Math.PI / 2);
      const sbMat = new THREE.MeshBasicMaterial({
        color: sb.conflict ? 0xef4444 : 0x10b981,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const sbMesh = new THREE.Mesh(sbGeo, sbMat);
      sbMesh.position.y = 0.05;
      t3.group.add(sbMesh);

      // Konflikt-Streifen: kräftigere rote Umrandung
      if (sb.conflict) {
        const linePts = pts.map((p) => new THREE.Vector3(toX3d(p, siteW), 0.07, toZ3d(p, siteD)));
        const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
        const line = new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({ color: 0xdc2626 }));
        t3.group.add(line);
      }
    });

    // --- Baukörper: Polygon-Shape extrudieren ---
    const shape = new THREE.Shape();
    poly.forEach((p, i) => {
      const sx = toX3d(p, siteW);
      const sy = -toZ3d(p, siteD); // Vorzeichen wie in BIT-Atelier üblich
      if (i === 0) shape.moveTo(sx, sy);
      else shape.lineTo(sx, sy);
    });
    shape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    bodyGeo.rotateX(-Math.PI / 2); // Extrusion (z) → Höhe (y)
    // DoubleSide + hohe Deckkraft: sonst blickt man durch die Dachflaeche in einen
    // scheinbar offenen Kasten, statt ein lesbares Volumen zu sehen.
    // 75-09: mit Fokus-Zonen wird der Körper halbtransparent (Glas-Effekt), damit
    // das hervorgehobene WE-Volumen im Gebäude lesbar bleibt [ASSUMED 0.25];
    // ohne Prop gilt exakt die 75-08-Deckkraft 0,92.
    const bodyMat = new THREE.MeshLambertMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: fokusAktiv ? FOKUS_BODY_OPACITY : 0.92,
      side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    body.userData.art = "baukoerper"; // hover raycast target marker (Task 4 B)
    t3.group.add(body);

    // Kanten des Baukörpers für Lesbarkeit — the body's edges; the ONLY OTHER
    // EdgesGeometry lives in the focus-zone effect (75-09, zone outlines).
    // Neighbours deliberately have none (Task 4 E).
    const edgesGeo = new THREE.EdgesGeometry(bodyGeo);
    const edges = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: KANTEN_FARBE }));
    t3.group.add(edges);

    // Hover refs for the input layer (Task 4 B): body = raycast target,
    // edges = the highlight that lights up on hover.
    t3.bodyMesh = body;
    t3.edgesMesh = edges;

    t3.requestRender?.();
  }, [poly, siteW, siteD, height, setbacks, fokusAktiv]);

  // 75-09 (Task 3): focus-zone volumes — the rooms of ONE dwelling unit, each
  // extruded one storey tall at its level, teal like the 2D focus outline.
  // Own group + own effect (neighbour pattern): a polygon drag never rebuilds
  // the zones. Guards like T-75-08-02: >= 3 and <= 400 finite points per zone.
  // WITHOUT the prop the group stays empty — the 75-08 image is untouched.
  useEffect(() => {
    const tt = three.current;
    if (!tt.fzGroup) return;
    clearGroup(tt.fzGroup);
    const liste = Array.isArray(fokusZonen) ? fokusZonen : [];
    if (liste.length) {
      const gh = Number(propsRef.current.geschossHoehe) > 0 ? Number(propsRef.current.geschossHoehe) : 3;
      // Cast materials to any: the bundled three typings are outdated
      // (MeshLambertMaterial not assignable to the Mesh ctor parameter — the
      // SAME legacy class as the pre-existing errors at the setback/body/
      // neighbour meshes); casting here keeps the per-file tsc count at the
      // 75-08 baseline of 8 instead of adding new ones (gate: ≤ baseline).
      const mat = /** @type {any} */ (new THREE.MeshLambertMaterial({ color: FOKUS_FARBE, side: THREE.DoubleSide }));
      const kantenMat = new THREE.LineBasicMaterial({ color: FOKUS_FARBE });
      for (const zone of liste) {
        const pts = Array.isArray(zone?.points) ? zone.points : null;
        if (!pts || pts.length < 3 || pts.length > NACHBAR_MAX_PUNKTE) continue;
        let gueltig = true;
        for (const p of pts) if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) { gueltig = false; break; }
        if (!gueltig) continue;
        const lvl = Number.isFinite(zone.level) ? zone.level : 0;
        const shape = new THREE.Shape();
        pts.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x, -p.y);
          else shape.lineTo(p.x, -p.y);
        });
        shape.closePath();
        // Bottom at level·gh + 2 cm, height gh − 4 cm — the gap avoids
        // z-fighting with the body's floor/ceiling surfaces [ASSUMED].
        // 75-13: a balcony is a flat slab (BALKON_PLATTE_M) in front of the facade, not a room volume.
        const tiefe = zone.raumart === "balkon" ? BALKON_PLATTE_M : Math.max(0.05, gh - 2 * FOKUS_Z_OFFSET_M);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: tiefe, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // extrusion (z) → height (y), like the body
        // Cast to any: the bundled three typings are outdated (MeshLambertMaterial
        // not assignable, .position missing) — same legacy class as the 8
        // pre-existing errors in this file; casting keeps the per-file tsc
        // budget at the baseline instead of adding 4 more (75-08 pattern).
        const mesh = /** @type {any} */ (new THREE.Mesh(geo, mat));
        mesh.position.y = lvl * gh + FOKUS_Z_OFFSET_M;
        tt.fzGroup.add(mesh);
        const kanten = /** @type {any} */ (new THREE.LineSegments(new THREE.EdgesGeometry(geo), kantenMat));
        kanten.position.y = mesh.position.y;
        tt.fzGroup.add(kanten);
      }
    }
    tt.requestRender?.();
  }, [fokusZonen, geschossHoehe]);

  // Sun light (Task 4 D): DirectionalLight follows sunPosition via
  // lichtrichtung(az, elev, nordwinkel) — geographic sun → plan/scene axes.
  // Below the horizon: intensity 0, no shadow (ambient 0.65 stays, the night
  // view remains readable). Without the sonne prop the legacy fixed position
  // (60, 100, 40) is kept — backwards compatibility for bare calls.
  useEffect(() => {
    const tt = three.current;
    if (!tt.dir || !tt.scene) return;
    const dirLight = tt.dir;
    if (sonne && Number.isFinite(sonne.elevation) && Number.isFinite(sonne.azimuth)) {
      const L = lichtrichtung(sonne.azimuth, sonne.elevation, Number(nordwinkel) || 0);
      if (L.ueberHorizont) {
        dirLight.position.set(L.x * LICHT_ABSTAND_M, L.y * LICHT_ABSTAND_M, L.z * LICHT_ABSTAND_M);
        dirLight.intensity = 0.9;
        dirLight.castShadow = schatten !== false;
      } else {
        dirLight.intensity = 0;
        dirLight.castShadow = false;
      }
    } else {
      dirLight.position.set(60, 100, 40);
      dirLight.intensity = 0.9;
      dirLight.castShadow = schatten !== false;
    }
    // Target = scene origin (site centre): the ±120 m shadow camera stays on
    // the site while panning (deliberately NOT the moving camera target).
    dirLight.target.position.set(0, 0, 0);
    dirLight.target.updateMatrixWorld();
    tt.requestRender?.();
  }, [sonne, nordwinkel, schatten]);

  // OSM neighbours (Task 4 E): OWN group, effect only on [nachbarn] — a
  // polygon drag never rebuilds them. Same site reference as the 2D plan
  // (scene x = p.x, z = p.z; the 2D draws mx(site.w/2 + p.x), my(site.d/2 +
  // p.z)). ONE shared grey Lambert material, NO edges — the own body stays
  // the only line drawing. DoS guards (T-75-08-02): >= 3 and <= 400 finite
  // points, height clamped to (0, 300] m, fallback 9 m like useOsmBuildings.
  useEffect(() => {
    const tt = three.current;
    if (!tt.nbGroup) return;
    clearGroup(tt.nbGroup);
    let anzahl = 0;
    const liste = Array.isArray(nachbarn) ? nachbarn : [];
    if (liste.length) {
      const mat = new THREE.MeshLambertMaterial({ color: NACHBAR_FARBE });
      for (const nb of liste) {
        const pts = Array.isArray(nb?.points) ? nb.points : null;
        if (!pts || pts.length < 3 || pts.length > NACHBAR_MAX_PUNKTE) continue;
        let gueltig = true;
        for (const p of pts) if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) { gueltig = false; break; }
        if (!gueltig) continue;
        const h = Number(nb.height);
        const tiefe = Number.isFinite(h) && h > NACHBAR_HOEHE_MIN_M
          ? Math.min(h, NACHBAR_HOEHE_MAX_M)
          : NACHBAR_HOEHE_DEFAULT_M;
        const shape = new THREE.Shape();
        pts.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x, -p.z);
          else shape.lineTo(p.x, -p.z);
        });
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: tiefe, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // extrusion (z) → height (y), like the body
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        tt.nbGroup.add(mesh);
        anzahl += 1;
      }
    }
    if (wrapperRef.current) wrapperRef.current.dataset.isoNachbarn = String(anzahl);
    tt.requestRender?.();
  }, [nachbarn]);

  // After webglcontextrestored (glFehler → null) React re-rendered the canvas
  // branch with a FRESH mount div; re-attach the existing canvas and render.
  useEffect(() => {
    const tt = three.current;
    const mount = mountRef.current;
    if (glFehler || !tt.renderer || !mount) return;
    const el = tt.renderer.domElement;
    if (el && el.parentNode !== mount) mount.appendChild(el);
    tt.requestRender?.();
  }, [glFehler]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      data-testid="mv-3d"
      data-iso-schleife="aus"
      data-iso-yaw={String(kam.current.zielYaw)}
      data-iso-massstab={String(kam.current.zielMassstab)}
      // 75-09: number of focus zones, ONLY when the prop is set — undefined
      // leaves the attribute off the DOM (React omits it), so the default path
      // stays byte-identical to the 75-08 spec.
      data-iso-fokus-zonen={fokusAktiv ? String(fokusZonen.length) : undefined}
      tabIndex={0}
      aria-label={t("Iso-Ansicht — Q/E drehen, WASD oder Pfeile verschieben, Rad zoomt")}
      onKeyDown={(ev) => three.current.steuerung?.keydown(ev)}
      onKeyUp={(ev) => three.current.steuerung?.keyup(ev)}
      onBlur={() => three.current.steuerung?.blur()}
    >
      {glFehler ? (
        // Klartext statt Crash/leerem Canvas — beide Fälle (kein WebGL,
        // Kontext verloren) mit eigener Meldung.
        <div
          data-testid="mv-fallback"
          role="status"
          className="flex h-full w-full items-center justify-center bg-slate-50 p-4 text-center text-sm text-slate-600"
        >
          {glFehler === "verloren"
            ? t("3D-Kontext verloren — Ansicht neu laden.")
            : t("3D-Ansicht nicht verfügbar — dieser Browser stellt kein WebGL bereit.")}
        </div>
      ) : (
        <>
          <div ref={mountRef} className="w-full" style={{ height: "100%" }} />
          {/* North arrow (Task 3 G): orientation after Q/E — the 2D arrow is
              not visible in iso mode. Rotated in anwenden() via ref. */}
          <div
            ref={nordRef}
            data-testid="mv-nord"
            aria-hidden="true"
            title={t("Norden")}
            className="absolute top-2 left-2 h-7 w-7 rounded-md border border-slate-200 bg-white/85 shadow-sm"
            style={{ transform: "rotate(0deg)" }}
          >
            <svg viewBox="-12 -12 24 24" className="h-full w-full">
              <line x1="0" y1="8" x2="0" y2="-8" stroke="#0f172a" strokeWidth="1.6" />
              <path d="M0 -9 L3.4 -2.5 L-3.4 -2.5 Z" fill="#0f172a" />
            </svg>
          </div>
          {/* Exposé-Bild: aktuelle Ansicht hochauflösend als PNG exportieren */}
          <button
            type="button"
            onClick={() => exportExposePng(three.current)}
            title={t("Aktuelle Ansicht hochauflösend als PNG exportieren")}
            className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow-sm hover:bg-white"
          >
            <Camera className="w-3.5 h-3.5" /> {t("Exposé-Bild")}
          </button>
          {/* Hover tooltip (Task 4 C): text nodes ONLY (React escapes the
              project name — no HTML string, T-75-08-01). Position via ref. */}
          <div
            ref={tooltipRef}
            data-testid="mv-tooltip"
            role="tooltip"
            hidden={!hoverInfo}
            className="pointer-events-none absolute left-0 top-0 z-10 rounded-md border border-slate-300 bg-white/95 px-2 py-1 text-[11px] leading-tight text-slate-700 shadow-md"
          >
            {hoverInfo && (
              <>
                <div className="font-semibold">{hoverInfo.name}</div>
                <div>{hoverInfo.geschosse}</div>
                <div>{hoverInfo.bgf}</div>
              </>
            )}
          </div>
          {/* Hinweis-Overlay unten links (Task 3 J) */}
          <div className="absolute bottom-1 left-2 text-[10px] text-slate-500 pointer-events-none">
            {t("Q/E drehen · WASD/Pfeile/Rand schieben · Rad zoomt zum Cursor · Ziehen/Mitteltaste schieben · grün = Abstandsfläche ok · rot = Konflikt")}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Tooltip content built ONLY on hit change (React state), never per move.
 * Text only: name, storey count and the BGF number — identical to the KPI
 * tile "BGF" (one computation path, MS-03; the tile value arrives via info).
 * @param {{ name?: string, geschosse?: number, bgfM2?: number } | null} info
 * @param {(s: string) => string} t i18n translate
 * @returns {{ name: string, geschosse: string, bgf: string }}
 */
function tooltipInhalt(info, t) {
  const name = info?.name || t("Baukörper");
  const geschosse = `${t("Geschosse")}: ${Number.isFinite(info?.geschosse) ? info.geschosse : "—"}`;
  const bgf = `BGF ${Number.isFinite(info?.bgfM2) ? Math.round(info.bgfM2).toLocaleString("de-DE") : "—"} m²`;
  return { name, geschosse, bgf };
}
