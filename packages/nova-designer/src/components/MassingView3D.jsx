import React, { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Camera } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { lichtrichtung } from "@designer/lib/sonnenstand";
import { mittelklickZaehler } from "@core/lib/mittelklick";
import { ZEIGE_ZUSTAENDE } from "@core/lib/zeigen/zustaende.js"; // 107-05: error token of invalid modelled bodies
import { lochImWand } from "@core/lib/bauteil/oeffnungen.js"; // 107-06: hole rectangle of a body opening (rule of the wall openings)
import { dachBerechnen, dachDreiecke } from "@core/lib/bauteil/dachGeometrie.js"; // 107-10: roof on a body (massing_layer v6 `dach`)
import { ugStatusText } from "@designer/lib/ugStatus.js"; // 107-10 review: visible basement state
import {
  ISO_PITCH_GRAD, ISO_START_YAW, ISO_ZOOMSTUFEN, KAMERA_ABSTAND_M, RAD_SCHWELLE,
  RAND_VERWEIL_MS, PAN_PX_JE_S,
  pxJeMeter, frustumFuer, kameraPosition, einpassenStufe,
  bodenpunktUnterCursor, zoomAufPunkt, verschiebeZiel,
  zoomEinrasten, naechsteZoomstufe, yawDrehen, yawInterpol,
  tweenFortschritt, tweenDauer, nordpfeilWinkel, randScrollRichtung, zugEntlangNormale,
} from "@designer/lib/isoKamera";

/** 101-09: horizontal pixels of Shift + middle drag per 90° orbit detent. [ASSUMED] */
const ORBIT_PX = 80;

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
//   pushPull (98-03, 107-06): { aktiv, tippziel, waehlen(id, punkt, normale, {unten}) → face or null, anwenden(id, meter, strg, face) } —
//             punkt in site m (x/y plan, z up), normale (x/y plan, z up), unten = Alt held; the drag counts along the face normal;
//             a null face (hit on an opening reveal) starts no drag; tippziel = something to type a distance for ("-" then types).
//   flaecheMarke (107-06): { art, kennung, punkte[{x,y,z}], mitte, normale{x,y,z}, teil? } — the picked face (site m),
//             drawn as an outline with a normal arrow; null = none.
//   hauptdach (108-11): { form, traufhoehe_m, firsthoehe_m, flaechen[{art, punkte3d[{x,y,z}]}], wandFlaechen?[same], geschossEbenen_m[] }
//             — the global roof of the building model on the main body (massing/hauptdach.js; faces in site m: x plan, z = plan y,
//             y height); wandFlaechen = wall infill above the eaves (shed roof: high wall and side triangles), drawn as body.
//             The body is extruded to the eaves, the roof faces sit on it, thin lines mark the storey planes; `height` is then the
//             ridge (camera fit). null (default) = the box of `height` exactly as before.
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
// B-103-04: the HTML overlays (source, exaggeration, scale) are not part of the WebGL canvas —
// `fusszeile` lines are burnt into a white footer so an exported image says what it shows.
/**
 * @param {Record<string, any>} three three.js handles (renderer, scene, camera)
 * @param {{fusszeile?: string[]}} [opt] footer lines (already translated); none = plain image
 */
export function exportExposePng(three, { fusszeile = [] } = {}) {
  const t = three || {};
  if (!t.renderer || !t.scene || !t.camera) return;
  const prev = t.renderer.getPixelRatio();
  let url = null;
  try {
    t.renderer.setPixelRatio(2);
    t.renderer.render(t.scene, t.camera);
    url = t.renderer.domElement.toDataURL("image/png");
  } catch (err) {
    console.error("Exposé-Export fehlgeschlagen:", err);
  } finally {
    t.renderer.setPixelRatio(prev);
    t.renderer.render(t.scene, t.camera);
  }
  if (!url) return;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const laden = (/** @type {string} */ href) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = `Expose_${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const zeilen = (Array.isArray(fusszeile) ? fusszeile : []).filter(Boolean);
  if (!zeilen.length) { laden(url); return; }
  const bild = new Image();
  bild.onload = () => {
    try {
      const zh = Math.max(18, Math.round(bild.width / 70)); // line height, px [ASSUMED readable at 2×]
      const c = document.createElement("canvas");
      c.width = bild.width;
      c.height = bild.height + zeilen.length * zh + Math.round(zh * 0.8);
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bild, 0, 0);
      ctx.fillStyle = "#18181b";
      ctx.font = `${Math.round(zh * 0.62)}px sans-serif`;
      ctx.textBaseline = "middle";
      zeilen.forEach((z, i) => ctx.fillText(z, Math.round(zh * 0.6), bild.height + Math.round(zh * 0.4) + zh * i + zh / 2));
      laden(c.toDataURL("image/png"));
    } catch (err) {
      console.error("Exposé-Fußzeile fehlgeschlagen:", err);
      laden(url);
    }
  };
  bild.onerror = () => laden(url);
  bild.src = url;
}

// Gruppe vollstaendig leeren und Ressourcen freigeben (wie Terrain-Rebuild).
// A shared material disposed by several meshes is safe: three.js dispose is
// idempotent (the neighbours group uses ONE shared material, Task 4 E).
function clearGroup(group) {
  while (group.children.length) {
    const c = group.children.pop();
    // a THREE.Sprite shares ONE module-level geometry with every other sprite (three/src/objects/Sprite.js) — disposing it
    // would drop the shared quad on every rebuild; only its material and texture are its own (review 107-05)
    if (c.geometry && !c.isSprite) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else { c.material.map?.dispose?.(); c.material.dispose(); } // 107-05: the "!" sprite carries a canvas texture
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
/** 98-02: modelled bodies (massing layer) — warm grey like a working model; group instances darker. */
const MODELL_FARBE = 0xd6d3d1;
const MODELL_GRUPPE_FARBE = 0xa8a29e;
/** 107-10: roof on a modelled body — the roof colour of the BIM studio's drawn roofs (0xb45309), so both studios read alike. */
const MODELL_DACH_FARBE = 0xb45309;
/** 108-11: global roof of the main body — the roof colour of the BIM studio's global roof form (BitBimStudio roofMat 0xb05a3c), so the
 *  massing iso and the building model show the same roof alike. Display colour only. */
const HAUPTDACH_FARBE = 0xb05a3c;
/** 107-10: basement body below ±0.00 — concrete grey, darker than the bodies above ground. [ASSUMED] display colour only. */
const UG_FARBE = 0x78716c;

/**
 * 107-10 review: counters of the modelled bodies for headless checks — computed WITHOUT WebGL by the same rules as the draw loop of the
 * body effect (valid outline, height > 0; openings that fit; a pitched roof the library computes or not), so a check never depends on
 * a canvas.
 * @param {any[]} liste bodies (weitereKoerper)
 * @returns {{ungueltig: number, loecher: number, oeffnungen: number, daecher: number, dachOffen: number}}
 */
function koerperZaehler(liste) {
  let oeffnungen = 0, daecher = 0, dachOffen = 0;
  for (const k of liste) {
    const pts = Array.isArray(k?.profil) ? k.profil : null;
    if (!pts || pts.length < 3 || pts.length > NACHBAR_MAX_PUNKTE || !(k.hoehe > 0)) continue;
    if (pts.some((/** @type {any} */ p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) continue;
    oeffnungen += Array.isArray(k.oeffnungenGeprueft) ? k.oeffnungenGeprueft.filter((/** @type {any} */ o) => o?.ok).length : 0;
    const ungueltig = k.gueltig && k.gueltig.ok === false;
    if (k.dach && k.dach.form && k.dach.form !== "flach" && !ungueltig) {
      // the outline in the plan frame {x, z} (the translation of the 3D frame does not change whether the library computes the form)
      const dd = dachBerechnen(pts.map((/** @type {any} */ p) => ({ x: p.x, z: p.y })), k.dach, { traufhoehe_m: 0 });
      if (dd.ok) daecher += 1; else dachOffen += 1;
    }
  }
  return {
    ungueltig: liste.filter((k) => k?.gueltig && k.gueltig.ok === false).length,
    loecher: liste.reduce((n, k) => n + (Array.isArray(k?.loecher) ? k.loecher.length : 0), 0),
    oeffnungen, daecher, dachOffen,
  };
}
/** 107-05: an invalid modelled body (self-intersecting or degenerate profile) — the "fehler" pointing state of 106-01
 *  (zustaende.js: colour = --fehler of the light theme, outline SOLID, symbol "!"): error-coloured edges and a "!" sprite,
 *  colour is never the only cue. Dashed edges are reserved for "warnung" (review 107-05). */
const MODELL_FEHLER_FARBE = parseInt(ZEIGE_ZUSTAENDE.fehler.hex.slice(1), 16);
/** Size of the "!" marker above an invalid body, m [ASSUMED]. */
const MODELL_FEHLER_SYMBOL_M = 1.6;

/**
 * "!" marker as a sprite (canvas texture, white glyph on the error colour) — the shape cue of an invalid body.
 * @returns {any} THREE.Sprite, or null where no canvas exists
 */
function fehlerSymbol() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = ZEIGE_ZUSTAENDE.fehler.hex;
  g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffffff"; g.font = "bold 44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(ZEIGE_ZUSTAENDE.fehler.symbol || "!", 32, 34);
  const sprite = /** @type {any} */ (new THREE.Sprite(/** @type {any} */ (new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))));
  sprite.scale.set(MODELL_FEHLER_SYMBOL_M, MODELL_FEHLER_SYMBOL_M, 1);
  sprite.renderOrder = 10;
  return sprite;
}
/** 107-06: colour of the face picked for push/pull — the "auswahl" pointing state of 106-01 (zustaende.js); the form cue is the
 *  normal arrow next to the outline, so colour is never the only cue. */
const FLAECHE_FARBE = parseInt(ZEIGE_ZUSTAENDE.auswahl.hex.slice(1), 16);
/** Length of the normal arrow at a picked face, m [ASSUMED: readable at the default iso scales 1:200–1:500]. */
const FLAECHE_PFEIL_M = 1.2;
/** Outline of a picked face lies this far in front of it (no z-fighting with the face), m [ASSUMED]. */
const FLAECHE_ABSTAND_M = 0.02;

/**
 * 107-06: a body with openings (massing_layer v3) as its own faces — the extrusion has no way to cut a hole through a side, and
 * the CSG core comes only with 107-14. Top and bottom are the plan shape (with its courtyards), every side face is a rectangle
 * edge length × height with the holes of the openings that enter or leave through it (Shape.holes, the pattern of the wall
 * openings in BitBimStudio, hole rectangle by lochImWand), and each opening gets four reveal faces through the body depth.
 * Geometry in the mesh frame: scene x/z, y from 0 (body bottom) to the height.
 * @param {any} k resolved body (profil, loecher, hoehe; site m)
 * @param {any} shape THREE.Shape of the plan outline with holes (x, −z), as for the extrusion
 * @param {Array<any>} gute ok entries of oeffnungenPruefen (a, b, laenge, masse, oeffnung, durchgang)
 * @param {number} sw site width, m
 * @param {number} sd site depth, m
 * @returns {any} THREE.BufferGeometry (non-indexed, with normals)
 */
function koerperMitOeffnungenGeo(k, shape, gute, sw, sd) {
  const H = k.hoehe;
  /** @type {any[]} */
  const teile = [];
  const nurPosition = (/** @type {any} */ g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== "position") n.deleteAttribute(name);
    return n;
  };
  for (const y of [0, H]) {
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // (x, −z) → scene x/z, like the extrusion
    g.translate(0, y, 0);
    teile.push(nurPosition(g));
  }
  // hole rectangles per face: key "<ring>|<edge>" → [{u0, u1, v0, v1}] in m along the face from its start corner
  /** @type {Map<string, Array<{u0: number, u1: number, v0: number, v1: number}>>} */
  const loecherJeSeite = new Map();
  const dazu = (/** @type {string} */ key, /** @type {{u0: number, u1: number, v0: number, v1: number}} */ r) => { const l = loecherJeSeite.get(key) || []; l.push(r); loecherJeSeite.set(key, l); };
  const ringe = [k.profil, ...(Array.isArray(k.loecher) ? k.loecher : [])];
  /** @type {number[]} */
  const laibung = [];
  for (const o of gute) {
    const rect = lochImWand(o.masse, o.oeffnung.u, o.laenge, H);
    if (!rect) continue;
    const ex = (o.b.x - o.a.x) / o.laenge, ey = (o.b.y - o.a.y) / o.laenge, nx = ey, ny = -ex; // outward normal in plan
    const t = o.durchgang.tiefe;
    dazu(`aussen|${o.oeffnung.kante}`, { u0: rect.x0, u1: rect.x1, v0: rect.y0, v1: rect.y1 });
    // exit: the entry rectangle moved by the depth against the normal, measured along the exit edge
    const ring = o.durchgang.austritt.ring === "aussen" ? k.profil : k.loecher[o.durchgang.austritt.ring];
    const p = ring[o.durchgang.austritt.kante], q = ring[(o.durchgang.austritt.kante + 1) % ring.length];
    const lq = Math.hypot(q.x - p.x, q.y - p.y) || 1, fx = (q.x - p.x) / lq, fy = (q.y - p.y) / lq;
    const aufAustritt = (/** @type {number} */ u) => (o.a.x + ex * u - nx * t - p.x) * fx + (o.a.y + ey * u - ny * t - p.y) * fy;
    const w0 = aufAustritt(rect.x0), w1 = aufAustritt(rect.x1);
    dazu(`${o.durchgang.austritt.ring}|${o.durchgang.austritt.kante}`, { u0: Math.min(w0, w1), u1: Math.max(w0, w1), v0: rect.y0, v1: rect.y1 });
    // four reveals: corners of the entry rectangle and the same corners at the exit (scene x/y/z)
    const E = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ s) => {
      const pt = { x: o.a.x + ex * u - nx * s, y: o.a.y + ey * u - ny * s };
      return [toX3d(pt, sw), v, toZ3d(pt, sd)];
    };
    const ecken = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]];
    for (let i = 0; i < 4; i++) {
      const [u1, v1] = ecken[i], [u2, v2] = ecken[(i + 1) % 4];
      const a1 = E(u1, v1, 0), a2 = E(u2, v2, 0), b2 = E(u2, v2, t), b1 = E(u1, v1, t);
      laibung.push(...a1, ...a2, ...b2, ...a1, ...b2, ...b1);
    }
  }
  ringe.forEach((ring, r) => {
    const name = r === 0 ? "aussen" : String(r - 1);
    ring.forEach((/** @type {any} */ a, /** @type {number} */ j) => {
      const b = ring[(j + 1) % ring.length], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(L > 0)) return;
      const s = new THREE.Shape();
      s.moveTo(0, 0); s.lineTo(L, 0); s.lineTo(L, H); s.lineTo(0, H); s.closePath();
      for (const l of loecherJeSeite.get(`${name}|${j}`) || []) {
        const h = new THREE.Path();
        h.moveTo(l.u0, l.v0); h.lineTo(l.u1, l.v0); h.lineTo(l.u1, l.v1); h.lineTo(l.u0, l.v1); h.closePath();
        s.holes.push(h);
      }
      const g = nurPosition(new THREE.ShapeGeometry(s));
      const pos = g.attributes.position;
      const ex = (b.x - a.x) / L, ey = (b.y - a.y) / L;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), v = pos.getY(i);
        const pt = { x: a.x + ex * u, y: a.y + ey * u };
        pos.setXYZ(i, toX3d(pt, sw), v, toZ3d(pt, sd));
      }
      teile.push(g);
    });
  });
  if (laibung.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(laibung, 3));
    teile.push(g);
  }
  const geo = mergeGeometries(teile, false);
  teile.forEach((g) => g.dispose());
  geo.computeVertexNormals();
  return geo;
}

/** 98-09: unit-type colours of the residential bar (same as WOHNUNGSTYPEN in @core/lib/massing/riegel). */
const RIEGEL_FARBEN = { "1-Zi": 0x22d3ee, "2-Zi": 0xfacc15, "3-Zi": 0xec4899, "4-Zi": 0x6366f1, Ecke: 0xa855f7 };
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
  fokusZonen = null, geschossHoehe = 3, weitereKoerper = null, gelaende = null, pushPull = null, riegel3d = null,
  flaecheMarke = null, untergeschoss = null, hauptdach = null,
}) {
  const { t, lang } = useI18n();
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
  propsRef.current = { poly, siteW, siteD, height, sonne, nordwinkel, info, geschossHoehe, pushPull };
  // 75-09: focus mode is active when at least one zone volume was passed —
  // the body turns semi-transparent (mesh effect dependency) and the wrapper
  // carries data-iso-fokus-zonen. Derived from the PROP only (not from GL
  // state) so e2e specs can assert it without WebGL.
  const fokusAktiv = Array.isArray(fokusZonen) && fokusZonen.length > 0;
  // Input layer state (Task 3): pressed pan keys, drag, edge-scroll dwell,
  // the single active tween and the wheel accumulator.
  /** Input-layer state. `tween` is null between tweens — typed as any so the
   *  effect may fill it without a cast at every use. */
  /** @type {React.MutableRefObject<{panKeys: Set<string>, drag: {on: boolean, x: number, y: number, id: number|null, orbit?: boolean, acc?: number}, edge: {dx: number, dy: number, seit: number}, tween: any, radAccum: number, letzteZeit: number, loopGeplant?: boolean, loopRaf?: number, pp: {id: string, x: number, y: number, strg: boolean, normale: {x: number, y: number, z: number}, wahl: any}|null}>} */
  const eingabe = useRef(({ panKeys: new Set(), drag: { on: false, x: 0, y: 0, id: null }, edge: { dx: 0, dy: 0, seit: 0 }, tween: null, radAccum: 0, letzteZeit: 0, pp: null }));
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
    const wrapperSnapshot = wrapperRef.current;

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
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is deprecated for WebGLRenderer since r182
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
    const mkGroup = new THREE.Group(); // 98-02: modelled bodies of the massing layer
    scene.add(mkGroup);
    const glGroup = new THREE.Group(); // 98-06: sandbox terrain
    scene.add(glGroup);
    const ugGroup = new THREE.Group(); // 107-10: basement body (below ±0.00, seen through the excavation pit)
    scene.add(ugGroup);
    const rgGroup = new THREE.Group(); // 98-09: residential bars (unit boxes per storey)
    scene.add(rgGroup);
    const fmGroup = new THREE.Group(); // 107-06: outline + normal arrow of the face picked for push/pull
    scene.add(fmGroup);

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

    Object.assign(three.current, { renderer, scene, camera, group, nbGroup, fzGroup, mkGroup, glGroup, ugGroup, rgGroup, fmGroup, dir, requestRender, anwenden, startLoop, starteYaw, starteZoom, starteHome, zoomMitte, tweenBeenden, reduziert });
    anwenden();
    // 107-06: read-only hook for headless checks (e2e): where a site point (m; x/y plan, z height) appears on the canvas (CSS px
    // from the canvas' top left), through the real camera — the same way a pointer would hit it. Not part of the UI.
    if (wrapperRef.current) {
      /** @type {any} */ (wrapperRef.current).__planZuBildschirm = (/** @type {{x: number, y: number, z?: number}} */ p) => {
        const { siteW: sw, siteD: sd } = propsRef.current;
        camera.updateMatrixWorld();
        const v = new THREE.Vector3(toX3d(p, sw), Number(p.z) || 0, toZ3d(p, sd)).project(camera);
        const r = renderer.domElement.getBoundingClientRect();
        return { sx: ((v.x + 1) / 2) * r.width, sy: ((1 - v.y) / 2) * r.height };
      };
      // 108-11: read-only hook for headless checks — the `userData.art` of the first mesh of the main group (body, roof of the main body)
      // under a canvas point (CSS px from the canvas' top left), through the real camera; "" = nothing hit. Not part of the UI.
      // 108-11 review: with `teil` true the `userData.teil` of that mesh when it has one (the gable/wall infill above the eaves:
      // "wand-ueber-traufe"), so a check can tell the infill from the top face of the wall body.
      /** @type {any} */ (wrapperRef.current).__artUnter = (/** @type {number} */ sx, /** @type {number} */ sy, /** @type {boolean} */ teil = false) => {
        const r = renderer.domElement.getBoundingClientRect();
        if (!r.width || !r.height) return "";
        camera.updateMatrixWorld();
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1), camera);
        const treffer = rc.intersectObjects(group.children, false).find((h) => h.object?.userData?.art);
        if (!treffer) return "";
        return String((teil && treffer.object.userData.teil) || treffer.object.userData.art);
      };
    }

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
        // 107-06: while push/pull runs and there is something to type for (a selection or a running input), "-" starts a typed
        // depth ("-0,3" = push in) and goes to the typed input; otherwise it zooms as always (review 107-06)
        if (lower === "-" && propsRef.current.pushPull?.aktiv && propsRef.current.pushPull?.tippziel) return;
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

    // Hover test (Task 4 B): ONLY on mouse move, ONLY the main body (108-11 review: with a roof also its gable/wall infill and roof).
    const hoverTest = (clientX, clientY) => {
      const tt = three.current;
      const e = eingabe.current;
      if (e.drag.on || !tt.bodyMesh || glFehlerRef.current) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, tt.camera);
      const hits = ray.intersectObjects(Array.isArray(tt.hoverMeshes) && tt.hoverMeshes.length ? tt.hoverMeshes : [tt.bodyMesh], false);
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

    const mittelMehrfach = mittelklickZaehler();
    const onPointerDown = (ev) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      // 98-03: with the push/pull tool, dragging a modelled body changes its height (Ctrl = stack).
      // 107-06: the hit carries its FACE: the triangle normal in world axes (turned towards the viewer — the material is
      // double-sided, a triangle may be wound either way) goes with the hit point to the modeller, which resolves the face from
      // the derived faces of the core (flaecheWaehlen); Alt picks the bottom face, which the iso view never shows.
      const pp = propsRef.current.pushPull;
      if (ev.button === 0 && pp?.aktiv && three.current.mkGroup) {
        const rect = el.getBoundingClientRect();
        ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(ndc, three.current.camera);
        const treffer = ray.intersectObjects(three.current.mkGroup.children.filter((o) => o.userData?.art === "modellkoerper"), false)[0];
        if (treffer) {
          const { siteW: sw, siteD: sd } = propsRef.current;
          const n = treffer.face ? treffer.face.normal.clone().transformDirection(treffer.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          if (n.dot(ray.ray.direction) > 0) n.negate();
          if (ev.altKey) n.set(0, -1, 0);
          const punkt = { x: treffer.point.x + sw / 2, y: treffer.point.z + sd / 2, z: treffer.point.y };
          const wahl = pp.waehlen ? pp.waehlen(treffer.object.userData.id, punkt, { x: n.x, y: n.z, z: n.y }, { unten: ev.altKey }) : null;
          // review 107-06: a hit on no body face (reveal, sill or lintel of a body opening) starts no push/pull — before, it fell
          // back to the top face and a drag in the opening changed the body height
          if (pp.waehlen && !wahl) { wrapperRef.current?.focus({ preventScroll: true }); return; }
          // scene normal of the picked face for the drag projection: top/bottom vertical, a side horizontal (plan x → x, plan y → z)
          const sn = wahl?.art === "seite" ? { x: wahl.normale.x, y: 0, z: wahl.normale.y } : { x: 0, y: wahl?.art === "unten" ? -1 : 1, z: 0 };
          eingabe.current.pp = { id: treffer.object.userData.id, x: ev.clientX, y: ev.clientY, strg: ev.ctrlKey || ev.metaKey, normale: sn, wahl };
          try { el.setPointerCapture(ev.pointerId); } catch { /* capture unsupported */ }
          el.style.cursor = wahl?.art === "seite" ? "move" : "ns-resize";
          return;
        }
      }
      // 101-09 (user 18.10.2026): CAD mouse — the LEFT button belongs to the tools (push/pull, select),
      // it never pans. Middle button = pan, Shift + middle = orbit (90° detents like Q/E),
      // 2–3 clicks on the wheel = start view fitted (zoom extents).
      if (ev.button === 0) { wrapperRef.current?.focus({ preventScroll: true }); return; }
      ev.preventDefault(); // middle button: no browser autoscroll glyph
      wrapperRef.current?.focus({ preventScroll: true });
      if (mittelMehrfach(ev)) { three.current.starteHome?.(); return; }
      const e = eingabe.current;
      e.drag = { on: true, x: ev.clientX, y: ev.clientY, id: ev.pointerId, orbit: ev.shiftKey, acc: 0 };
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
        if (e.drag.orbit) {
          // Shift + middle drag: one 90° detent per ORBIT_PX of horizontal movement [ASSUMED 80 px].
          e.drag.acc += mdx;
          while (Math.abs(e.drag.acc) >= ORBIT_PX) {
            const r = Math.sign(e.drag.acc);
            three.current.starteYaw?.(r);
            e.drag.acc -= r * ORBIT_PX;
          }
          return;
        }
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
      if (e.pp) {
        // 107-06: screen px → metres ALONG THE FACE NORMAL (its screen projection, isoKamera.zugEntlangNormale); for the top face
        // this is the old rule (a vertical metre shows as pxJeM · cos(pitch) pixels).
        const k = kam.current;
        const meter = zugEntlangNormale(ev.clientX - e.pp.x, ev.clientY - e.pp.y, e.pp.normale, { yaw: k.yaw, pitch: k.pitch, pxJeM: k.pxJeM });
        const ziel = e.pp;
        e.pp = null;
        try { el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
        el.style.cursor = "grab";
        // Rounded to 5 cm [ASSUMED] — a free mouse drag is not a measured input (type it for exact values).
        propsRef.current.pushPull?.anwenden(ziel.id, Math.round(meter * 20) / 20, ziel.strg, ziel.wahl);
        return;
      }
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
    // 101-07: no browser context menu ("Bild speichern unter …") on the drawing surface.
    const ohneMenue = (/** @type {Event} */ ev) => ev.preventDefault();
    el.addEventListener("contextmenu", ohneMenue);

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
      if (wrapperSnapshot) delete /** @type {any} */ (wrapperSnapshot).__planZuBildschirm; // the read-only e2e hook goes with the scene
      if (ro) ro.disconnect();
      cancelAnimationFrame(three.current.renderRaf || 0);
      cancelAnimationFrame(e.loopRaf || 0);
      // Context listeners off BEFORE forceContextLoss — a forced loss must
      // not flip the UI into the fallback while unmounting.
      el.removeEventListener("webglcontextlost", onLost);
      el.removeEventListener("webglcontextrestored", onRestored);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("contextmenu", ohneMenue);
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
    // 108-11: roof of the main body for headless checks — set from the PROP (readable without WebGL), empty without a roof
    const hd = hauptdach && Array.isArray(hauptdach.flaechen) && hauptdach.flaechen.length && hauptdach.traufhoehe_m > 0 ? hauptdach : null;
    if (wrapperRef.current) {
      wrapperRef.current.dataset.hauptdach = hd ? String(hd.form || "") : "";
      wrapperRef.current.dataset.traufeM = hd ? Number(hd.traufhoehe_m).toFixed(2) : "";
      wrapperRef.current.dataset.firstM = hd ? Number(hd.firsthoehe_m).toFixed(2) : "";
    }
    if (!t3.group) return;
    clearGroup(t3.group);
    t3.bodyMesh = null;
    t3.hoverMeshes = [];
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
    // 108-11: with the roof of the building model the walls end at the eaves; the roof faces sit on top (below)
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: hd ? hd.traufhoehe_m : height, bevelEnabled: false });
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
    t3.hoverMeshes = [body];

    // 108-11: the global roof (faces of dachGeometrie.globalesDach, site m → scene) and thin storey lines on the walls
    if (hd) {
      // site m → scene: x − siteW/2, z − siteD/2 (y = height stays)
      const szene = (/** @type {number[]} */ roh) => roh.map((v, i) => (i % 3 === 0 ? v - siteW / 2 : i % 3 === 2 ? v - siteD / 2 : v));
      // the gable triangles belong to the gable WALL (D-EFH-02: the gable walls reach the roof contour) — body material, not roof colour
      // 108-11 review: plus the wall infill above the eaves (shed roof: high-side wall and side triangles; the body ends at the low eaves)
      const giebel = szene(dachDreiecke([
        ...hd.flaechen.filter((/** @type {any} */ f) => f.art === "giebel"),
        ...(Array.isArray(hd.wandFlaechen) ? hd.wandFlaechen : []),
      ]));
      if (giebel.length) {
        const ggeo = new THREE.BufferGeometry();
        ggeo.setAttribute("position", new THREE.Float32BufferAttribute(giebel, 3));
        ggeo.computeVertexNormals();
        const gmesh = /** @type {any} */ (new THREE.Mesh(ggeo, bodyMat));
        gmesh.castShadow = true;
        gmesh.userData.art = "baukoerper";
        gmesh.userData.teil = "wand-ueber-traufe"; // for the headless hook __artUnter(…, true) only
        t3.group.add(gmesh);
        t3.hoverMeshes.push(gmesh);
      }
      const pos = szene(dachDreiecke(hd.flaechen.filter((/** @type {any} */ f) => f.art !== "giebel")));
      if (pos.length) {
        const dgeo = new THREE.BufferGeometry();
        dgeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        dgeo.computeVertexNormals();
        const dmesh = /** @type {any} */ (new THREE.Mesh(dgeo, /** @type {any} */ (new THREE.MeshLambertMaterial({
          color: HAUPTDACH_FARBE, side: THREE.DoubleSide,
          ...(fokusAktiv ? { transparent: true, opacity: FOKUS_BODY_OPACITY } : {}),
        }))));
        dmesh.castShadow = true;
        dmesh.userData.art = "hauptdach";
        t3.group.add(dmesh);
        t3.hoverMeshes.push(dmesh);
        t3.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(dgeo), new THREE.LineBasicMaterial({ color: KANTEN_FARBE })));
      }
      for (const z of Array.isArray(hd.geschossEbenen_m) ? hd.geschossEbenen_m : []) {
        if (!(z > 0) || !(z < hd.traufhoehe_m)) continue;
        const linie = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(poly.map((p) => new THREE.Vector3(toX3d(p, siteW), z, toZ3d(p, siteD)))),
          new THREE.LineBasicMaterial({ color: KANTEN_FARBE, transparent: true, opacity: 0.45 }),
        );
        t3.group.add(linie);
      }
    }

    t3.requestRender?.();
  }, [poly, siteW, siteD, height, setbacks, fokusAktiv, hauptdach]);

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

  // 98-02: bodies drawn with the modelling tools (massing_layer), each extruded from its base to
  // base + height in the SAME site frame as `poly` (toX3d/toZ3d). Own group + own effect — the
  // main body, neighbours and focus zones are untouched; without the prop nothing is drawn.
  useEffect(() => {
    const tt = three.current;
    const liste = Array.isArray(weitereKoerper) ? weitereKoerper : [];
    // 107-05/06/10: counts for headless checks FIRST — readable without WebGL (review 107-10: before, they were set only after drawing)
    if (wrapperRef.current) {
      const z = koerperZaehler(liste);
      wrapperRef.current.dataset.mkUngueltig = String(z.ungueltig);
      wrapperRef.current.dataset.mkLoecher = String(z.loecher);
      wrapperRef.current.dataset.mkOeffnungen = String(z.oeffnungen); // 107-06: openings drawn as holes
      wrapperRef.current.dataset.mkDaecher = String(z.daecher); // 107-10: roofs drawn on bodies
      wrapperRef.current.dataset.mkDachOffen = String(z.dachOffen); // 107-10: roof forms the library does not compute (curved)
    }
    if (!tt.mkGroup) return;
    clearGroup(tt.mkGroup);
    const { siteW: sw, siteD: sd } = propsRef.current;
    for (const k of liste) {
      const pts = Array.isArray(k?.profil) ? k.profil : null;
      if (!pts || pts.length < 3 || pts.length > NACHBAR_MAX_PUNKTE || !(k.hoehe > 0)) continue;
      if (pts.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) continue;
      const shape = new THREE.Shape();
      pts.forEach((p, i) => (i === 0 ? shape.moveTo(toX3d(p, sw), -toZ3d(p, sd)) : shape.lineTo(toX3d(p, sw), -toZ3d(p, sd))));
      shape.closePath();
      // 107-05: inner rings (courtyards) as Shape.holes — the pattern of the slab openings in BitBimStudio; three.js fixes
      // the winding itself, the core already hands them over opposite to the outer ring (profilNormieren)
      for (const ring of Array.isArray(k.loecher) ? k.loecher : []) {
        if (!Array.isArray(ring) || ring.length < 3 || ring.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) continue;
        const loch = new THREE.Path();
        ring.forEach((p, i) => (i === 0 ? loch.moveTo(toX3d(p, sw), -toZ3d(p, sd)) : loch.lineTo(toX3d(p, sw), -toZ3d(p, sd))));
        loch.closePath();
        shape.holes.push(loch);
      }
      // 107-06: a body with openings that fit is built face by face with the holes; all others stay the plain extrusion
      const gute = Array.isArray(k.oeffnungenGeprueft) ? k.oeffnungenGeprueft.filter((o) => o?.ok) : [];
      /** @type {any} */
      let geo;
      if (gute.length) {
        geo = koerperMitOeffnungenGeo(k, shape, gute, sw, sd);
      } else {
        geo = new THREE.ExtrudeGeometry(shape, { depth: k.hoehe, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
      }
      const ungueltig = k.gueltig && k.gueltig.ok === false;
      const farbe = ungueltig ? MODELL_FEHLER_FARBE : k.gruppe != null ? MODELL_GRUPPE_FARBE : MODELL_FARBE;
      const mesh = /** @type {any} */ (new THREE.Mesh(geo, /** @type {any} */ (new THREE.MeshLambertMaterial({ color: farbe, side: THREE.DoubleSide, ...(ungueltig ? { transparent: true, opacity: 0.55 } : {}) }))));
      mesh.position.y = k.basis || 0;
      mesh.castShadow = true;
      mesh.userData.art = "modellkoerper";
      mesh.userData.id = k.id;
      if (ungueltig) mesh.userData.ungueltig = k.gueltig.grund;
      tt.mkGroup.add(mesh);
      const kanten = /** @type {any} */ (new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: ungueltig ? MODELL_FEHLER_FARBE : 0x44403c })));
      kanten.position.y = mesh.position.y;
      tt.mkGroup.add(kanten);
      // 107-10: an optional roof on the body top (roof library: the same faces as the IFC export); a curved/unknown form is counted as open
      if (k.dach && k.dach.form && k.dach.form !== "flach" && !ungueltig) {
        const dd = dachBerechnen(pts.map((p) => ({ x: toX3d(p, sw), z: toZ3d(p, sd) })), k.dach, { traufhoehe_m: (k.basis || 0) + k.hoehe });
        if (dd.ok) {
          const dgeo = new THREE.BufferGeometry();
          dgeo.setAttribute("position", new THREE.Float32BufferAttribute(dachDreiecke(dd.flaechen), 3));
          dgeo.computeVertexNormals();
          const dmesh = /** @type {any} */ (new THREE.Mesh(dgeo, /** @type {any} */ (new THREE.MeshLambertMaterial({ color: MODELL_DACH_FARBE, side: THREE.DoubleSide }))));
          dmesh.castShadow = true;
          dmesh.userData.art = "modelldach";
          dmesh.userData.id = k.id;
          tt.mkGroup.add(dmesh);
        }
      }
      if (ungueltig) {
        const sym = fehlerSymbol();
        if (sym) {
          const mitte = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
          sym.position.set(toX3d(mitte, sw), (k.basis || 0) + k.hoehe + MODELL_FEHLER_SYMBOL_M, toZ3d(mitte, sd));
          tt.mkGroup.add(sym);
        }
      }
    }
    tt.requestRender?.();
  }, [weitereKoerper, siteW, siteD]);

  // 107-06: the face picked for push/pull stays marked until the next hit — outline slightly in front of the face plus an arrow
  // along its normal (colour of the "auswahl" state + the arrow as form cue); a part rectangle is outlined too. Own group.
  useEffect(() => {
    const tt = three.current;
    if (!tt.fmGroup) return;
    clearGroup(tt.fmGroup);
    const m = flaecheMarke;
    if (wrapperRef.current) wrapperRef.current.dataset.mkFlaeche = m ? m.kennung || m.art || "" : "";
    if (m && Array.isArray(m.punkte) && m.punkte.length >= 3) {
      const { siteW: sw, siteD: sd } = propsRef.current;
      const n = m.normale || { x: 0, y: 0, z: 1 };
      const v3 = (/** @type {{x: number, y: number, z?: number}} */ p, /** @type {number} */ s = 0) => new THREE.Vector3(toX3d({ x: p.x + n.x * s, y: p.y + n.y * s }, sw), (Number(p.z) || 0) + n.z * s, toZ3d({ x: p.x + n.x * s, y: p.y + n.y * s }, sd));
      const mat = new THREE.LineBasicMaterial({ color: FLAECHE_FARBE, depthTest: false });
      const umriss = /** @type {any} */ (new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(m.punkte.map((p) => v3(p, FLAECHE_ABSTAND_M))), mat));
      umriss.renderOrder = 11;
      tt.fmGroup.add(umriss);
      if (Array.isArray(m.teil) && m.teil.length >= 3) {
        const teil = /** @type {any} */ (new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(m.teil.map((p) => v3(p, FLAECHE_ABSTAND_M))), new THREE.LineBasicMaterial({ color: FLAECHE_FARBE, depthTest: false })));
        teil.renderOrder = 11;
        tt.fmGroup.add(teil);
      }
      // arrow: shaft along the normal and two head strokes (perpendicular helper: up for a side, scene x for top/bottom)
      const mitte = m.mitte || m.punkte[0];
      const fuss = v3(mitte, FLAECHE_ABSTAND_M), spitze = v3(mitte, FLAECHE_PFEIL_M);
      const richtung = spitze.clone().sub(fuss).normalize();
      const quer = Math.abs(n.z) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const kopf = (/** @type {number} */ sgn) => spitze.clone().addScaledVector(richtung, -0.3).addScaledVector(quer, 0.15 * sgn);
      const pfeil = /** @type {any} */ (new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([fuss, spitze, spitze, kopf(1), spitze, kopf(-1)]), new THREE.LineBasicMaterial({ color: FLAECHE_FARBE, depthTest: false })));
      pfeil.renderOrder = 11;
      tt.fmGroup.add(pfeil);
    }
    tt.requestRender?.();
  }, [flaecheMarke, siteW, siteD]);

  // 107-10 (task 6, D-BK-20): basement with the terrain subtraction. The basement body (footprint × [fusshoehe_m, 0]) is drawn at once as an
  // extrusion; with a terrain grid the CSG derivation (@core/lib/bauteil/gelaendeSolid.js, loaded lazily with the csg chunk) gives the
  // terrain AFTER the excavation, which replaces the terrain mesh below, and the excavation volume. Without `untergeschoss` nothing of
  // this runs and the view renders exactly as before.
  const [ugErgebnis, setUgErgebnis] = useState(/** @type {any} */ (null));
  const [ugFehler, setUgFehler] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    setUgErgebnis(null);
    setUgFehler(null);
    const ug = untergeschoss;
    const g = gelaende;
    if (!ug || !Array.isArray(ug.profil) || ug.profil.length < 3 || !(ug.fusshoehe_m < 0)) return undefined;
    if (!(g && g.nx >= 2 && g.ny >= 2 && Array.isArray(g.h) && g.h.length === g.nx * g.ny)) return undefined;
    let ab = false;
    import("@core/lib/bauteil/gelaendeSolid.js")
      .then((m) => m.untergeschossMitGelaende({ gelaende: g, profil: ug.profil, fusshoehe_m: ug.fusshoehe_m, waende: ug.waende || [], bezug: ug.bezug || null, geschosse: ug.geschosse || null }))
      .then((r) => {
        if (ab) { r.ug.geometrie.dispose(); r.aushub.geometrie?.dispose(); r.gelaendeNach.geometrie?.dispose(); return; }
        setUgErgebnis(r);
      })
      .catch((e) => { if (!ab) setUgFehler(String(e?.message || e)); });
    return () => { ab = true; };
  }, [untergeschoss, gelaende]);
  useEffect(() => () => {
    if (!ugErgebnis) return;
    ugErgebnis.ug.geometrie.dispose(); ugErgebnis.aushub.geometrie?.dispose(); ugErgebnis.gelaendeNach.geometrie?.dispose();
  }, [ugErgebnis]);
  // 107-10 review: the visible state of the basement (quantity, source, warning, earth contact, "nicht verfügbar") — shown below the view
  const gelaendeOk = !!(gelaende && gelaende.nx >= 2 && gelaende.ny >= 2 && Array.isArray(gelaende.h) && gelaende.h.length === gelaende.nx * gelaende.ny);
  const ugStatus = ugStatusText({ ug: untergeschoss, gelaende: gelaendeOk ? gelaende : null, gelaendeGueltig: gelaendeOk, ergebnis: ugErgebnis, fehler: ugFehler, t, lang });
  useEffect(() => {
    const tt = three.current;
    const ug = untergeschoss;
    const w = wrapperRef.current;
    // counters for headless checks first (readable without WebGL); review 107-10: without a grid the quantity is footprint × depth
    if (w) {
      w.dataset.ug = ug ? "1" : "";
      w.dataset.ugAushubM3 = ugStatus?.aushub_m3 != null ? String(Math.round(ugStatus.aushub_m3 * 1000) / 1000) : "";
      w.dataset.ugQuelle = ugStatus?.quelle || "";
      w.dataset.ugFehler = ugFehler || (ugErgebnis?.fehler ? String(ugErgebnis.fehler.code) : "");
      w.dataset.gelaendeAbzug = ugErgebnis?.gelaendeNach?.geometrie ? "1" : "";
    }
    if (!tt.ugGroup) return;
    clearGroup(tt.ugGroup);
    if (ug && Array.isArray(ug.profil) && ug.profil.length >= 3 && ug.fusshoehe_m < 0) {
      const { siteW: sw, siteD: sd } = propsRef.current;
      const shape = new THREE.Shape();
      ug.profil.forEach((p, i) => (i === 0 ? shape.moveTo(toX3d(p, sw), -toZ3d(p, sd)) : shape.lineTo(toX3d(p, sw), -toZ3d(p, sd))));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: -ug.fusshoehe_m, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = /** @type {any} */ (new THREE.Mesh(geo, /** @type {any} */ (new THREE.MeshLambertMaterial({ color: UG_FARBE }))));
      mesh.position.y = ug.fusshoehe_m;
      mesh.userData.art = "untergeschoss";
      tt.ugGroup.add(mesh);
    }
    tt.requestRender?.();
  }, [untergeschoss, ugErgebnis, ugFehler, siteW, siteD, ugStatus?.aushub_m3, ugStatus?.quelle]);

  // 98-06: sandbox terrain as a height mesh in the site frame (only once it exists — untouched
  // projects render exactly as before).
  useEffect(() => {
    const tt = three.current;
    if (!tt.glGroup) return;
    clearGroup(tt.glGroup);
    const g = gelaende;
    // 107-10: with a basement the terrain AFTER the excavation (local frame around the grid middle, shifted into the site frame)
    if (ugErgebnis?.gelaendeNach?.geometrie) {
      const { siteW: sw, siteD: sd } = propsRef.current;
      const mesh = /** @type {any} */ (new THREE.Mesh(ugErgebnis.gelaendeNach.geometrie.clone(), /** @type {any} */ (new THREE.MeshLambertMaterial({ color: 0x9caf88, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }))));
      mesh.position.set(ugErgebnis.mitte.x - sw / 2, 0, ugErgebnis.mitte.y - sd / 2);
      mesh.receiveShadow = true;
      mesh.userData.art = "gelaende";
      mesh.userData.abzug = true;
      tt.glGroup.add(mesh);
    } else if (g && g.nx >= 2 && g.ny >= 2 && Array.isArray(g.h) && g.h.length === g.nx * g.ny) {
      const { siteW: sw, siteD: sd } = propsRef.current;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(g.nx * g.ny * 3);
      for (let k = 0; k < g.h.length; k++) {
        const p = { x: g.x0 + (k % g.nx) * g.zelle, y: g.y0 + Math.floor(k / g.nx) * g.zelle };
        pos[k * 3] = toX3d(p, sw); pos[k * 3 + 1] = Number(g.h[k]) || 0; pos[k * 3 + 2] = toZ3d(p, sd);
      }
      const idx = [];
      for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
        const a = j * g.nx + i, b = a + 1, c = a + g.nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = /** @type {any} */ (new THREE.Mesh(geo, /** @type {any} */ (new THREE.MeshLambertMaterial({ color: 0x9caf88, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }))));
      mesh.receiveShadow = true;
      mesh.userData.art = "gelaende";
      tt.glGroup.add(mesh);
    }
    tt.requestRender?.();
  }, [gelaende, siteW, siteD, ugErgebnis]);

  // 98-09: residential bars — one extruded box per unit and storey in the unit-type colour (a 15 cm
  // gap between storeys keeps the floors readable, like the reference video). One material per type.
  useEffect(() => {
    const tt = three.current;
    if (!tt.rgGroup) return;
    clearGroup(tt.rgGroup);
    const liste = Array.isArray(riegel3d) ? riegel3d : [];
    const { siteW: sw, siteD: sd } = propsRef.current;
    // One merged geometry per unit-type colour (a few draw calls instead of hundreds of meshes —
    // an 8-storey bar has ~500 unit boxes).
    /** @type {Record<number, any[]>} */
    const jeFarbe = {};
    for (const u of liste) {
      const pts = u.profil;
      if (!Array.isArray(pts) || pts.length < 3 || !(u.hoehe > 0)) continue;
      const shape = new THREE.Shape();
      pts.forEach((p, i) => (i === 0 ? shape.moveTo(toX3d(p, sw), -toZ3d(p, sd)) : shape.lineTo(toX3d(p, sw), -toZ3d(p, sd))));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: u.hoehe, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, u.basis || 0, 0);
      const farbe = RIEGEL_FARBEN[u.farbe] ?? 0xd6d3d1;
      (jeFarbe[farbe] = jeFarbe[farbe] || []).push(geo);
    }
    for (const [farbe, geos] of Object.entries(jeFarbe)) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = /** @type {any} */ (new THREE.Mesh(merged, /** @type {any} */ (new THREE.MeshLambertMaterial({ color: Number(farbe) }))));
      mesh.castShadow = true;
      tt.rgGroup.add(mesh);
    }
    tt.requestRender?.();
  }, [riegel3d, siteW, siteD]);

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
      {/* 107-10 review: basement state as text (also without WebGL) — the quantity, its source and every warning stand on the view */}
      {ugStatus && (
        <div data-testid="mv-ug-status" role="status" className="absolute bottom-6 left-2 z-10 max-w-[24rem] rounded-md border border-border bg-card px-2 py-1 text-[11px] leading-snug text-foreground shadow-sm">
          {ugStatus.zeilen.map((z) => <div key={z}>{z}</div>)}
          {ugStatus.warnungen.map((w) => <div key={w} className="flex items-start gap-1 text-warnung" data-testid="mv-ug-warnung"><span aria-hidden="true">▲</span><span>{w}</span></div>)}
        </div>
      )}
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
