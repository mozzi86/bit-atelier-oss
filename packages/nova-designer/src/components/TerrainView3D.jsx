// TerrainView3D — 3D terrain study of the project site (phase 103) plus earthworks.
//
// Phase 103 rebuilt the view part: the camera orbits around the site and never goes below the
// terrain (before it sat ~35° BELOW the surface and the map was north–south mirrored), the plot
// outline and the building bodies stand on the terrain, a north arrow, a scale bar, spot heights
// and the data source sit on the view, the vertical exaggeration is a slider (1× = true scale)
// instead of a hidden automatic stretch, and a water level slider floods the terrain
// ("bathtub" study, 103-03). The maths lives in @designer/lib/gelaendeStudie (pure, tested),
// the three.js objects in @designer/lib/gelaendeSzene.
//
// Scene axes: x = east, z = south, y = up, 1 unit = 1 m; heights y = (h − bezug) · exaggeration,
// bezug = floor(lowest shown terrain point). The earthworks part (computeErdmassen …) is
// unchanged on purpose — its sampling still uses the old mirrored convention, see
// .planning/BEFUNDE-103.md B-103-01.
//
// In:  complexData (location, site_parcel, buildings, hochwasser) from ComplexDesigner, the
//      shared building program (footprint, storey height), elevation grids (useElevationGrid).
// Out: rendering only; nothing is saved from here.
import React, { useRef, useEffect, useState, useMemo } from "react";
import * as THREE from "three";
import { Card, CardContent } from "@core/components/ui/card";
import { Mountain, Footprints, Camera, Info } from "lucide-react";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { useElevationGrid, DEM_RESOLUTION_M } from "@designer/lib/useElevationGrid";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { exportExposePng } from "@designer/components/MassingView3D";
import SplatSteuerung from "@designer/components/SplatSteuerung";
import GelaendeSteuerung from "@designer/components/GelaendeSteuerung";
import { SplatWolke, beispielSplats } from "@designer/lib/splats/SplatWolke";
import { splatsLesen, splatHuelle } from "@designer/lib/splats/splatLesen";
import { nordpfeilWinkel } from "@designer/lib/isoKamera";
import {
  demRaster, hoeheAn, grundstueckM, baukoerperListe, startUeberhoehung, kameraPose, pitchKlemmen,
  hoehenKoten, massstabsLeiste, mJePxBildmitte, flutKurve, ueberfluteteFlaeche, flutReihenfolge, pegelBereich,
  hqMarken, minHoeheInPolygon, okffNHN, hoeheText, START_YAW, START_PITCH, AUGENHOEHE_M,
} from "@designer/lib/gelaendeStudie";
import {
  terrainGeometrie, schuerzeGeometrie, terrainMaterial, wasserEbene, grundstuecksLinie, baukoerperMesh, gruppeLeeren,
} from "@designer/lib/gelaendeSzene";

/** [ASSUMED] largest scan file read in the browser (MB) — beyond that the tab may run out of memory. */
const SPLAT_MAX_MB = 400;
/** Vertical field of view of the orbit camera, degrees. */
const FOV_GRAD = 50;
/** Zoom range of the orbit camera as a multiple of the shown edge length [ASSUMED]. */
const ABSTAND_MIN_FAKTOR = 0.15;
const ABSTAND_MAX_FAKTOR = 4;
/** Start distance as a multiple of the edge length — the whole cut-out fits at fov 50° [ASSUMED]. */
const ABSTAND_START_FAKTOR = 1.15;
/** Edge length of the calculation raster (flood figures, earthworks), km. */
const SPAN_CALC = 0.3;
/** Sky colour of the scene (three.js clear colour, not a UI colour). */
const HIMMEL = 0xbcd8f2;
/** Label placement of the spot heights relative to their dot (Tailwind offsets, CSS px). */
const KOTE_LAGE = { tief: "right-2 top-1", hoch: "left-2 bottom-1", mitte: "bottom-2 left-1/2 -translate-x-1/2" };

/**
 * Scene height function for the current terrain: (h − bezug) · exaggeration.
 * @param {any} tr three.current.terrain ({ r, bezug }) @param {number} ue exaggeration
 * @returns {(x: number, z: number) => number}
 */
function hoeheSzene(tr, ue) {
  return (x, z) => (hoeheAn(tr.r, x, z) - tr.bezug) * ue;
}

// Punkt-in-Polygon (Ray-Casting) gegen ein zentriertes Meter-Polygon [{x,z}].
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

// Geländehöhe an einer Stelle (zentrierte Meter) per bilinearer Interpolation.
// Das Raster ist size×size über spanKm·1000 m, um den Ursprung zentriert.
function sampleElev(grid, size, cellM, x, z) {
  const gi = z / cellM + (size - 1) / 2; // Zeilen-Index (z)
  const gj = x / cellM + (size - 1) / 2; // Spalten-Index (x)
  const ci = Math.max(0, Math.min(size - 1, gi));
  const cj = Math.max(0, Math.min(size - 1, gj));
  const i0 = Math.floor(ci), j0 = Math.floor(cj);
  const i1 = Math.min(size - 1, i0 + 1), j1 = Math.min(size - 1, j0 + 1);
  const fi = ci - i0, fj = cj - j0;
  const top = grid[i0][j0] + (grid[i0][j1] - grid[i0][j0]) * fj;
  const bot = grid[i1][j0] + (grid[i1][j1] - grid[i1][j0]) * fj;
  return top + (bot - top) * fi;
}

// Bounding-Box (zentrierte Meter) eines Footprint-Polygons.
function bboxOf(poly) {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

// Erdmassen-Berechnung für ein Planum auf dem Geländemodell.
// Begrenzt auf das Baufeld (Footprint-Polygon in zentrierten Metern). Da das
// Baufeld i.d.R. kleiner als eine Rasterzelle ist, wird die Geländehöhe über ein
// FEINES Teilraster über der Footprint-Bounding-Box bilinear abgetastet (statt
// roher Rasterzellen). Ohne Footprint: gesamter Geländeausschnitt (rasterbasiert).
// Gibt { cut, fill, net, area } in m³ bzw. m² zurück (gerundet auf ganze Zahlen).
function computeErdmassen(grid, planum, spanKm, footprintM) {
  if (!grid || grid.length < 2) return { cut: 0, fill: 0, net: 0, area: 0 };
  const size = grid.length;
  const cellM = (spanKm * 1000) / (size - 1);
  const hasFootprint = Array.isArray(footprintM) && footprintM.length >= 3;
  let cut = 0, fill = 0;

  if (hasFootprint) {
    const bb = bboxOf(footprintM);
    const N = 48; // Teilraster-Auflösung über die Footprint-BBox
    const stepX = (bb.maxX - bb.minX) / N, stepZ = (bb.maxZ - bb.minZ) / N;
    const subArea = stepX * stepZ;
    let inside = 0;
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const x = bb.minX + (a + 0.5) * stepX;
        const z = bb.minZ + (b + 0.5) * stepZ;
        if (!pointInPoly(x, z, footprintM)) continue;
        inside++;
        const diff = sampleElev(grid, size, cellM, x, z) - planum;
        if (diff > 0) cut += diff * subArea;
        else fill += (-diff) * subArea;
      }
    }
    const area = inside * subArea;
    return { cut: Math.round(cut), fill: Math.round(fill), net: Math.round(fill - cut), area: Math.round(area) };
  }

  const cellArea = cellM * cellM;
  let cells = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      cells++;
      const diff = grid[i][j] - planum;
      if (diff > 0) cut += diff * cellArea;
      else fill += (-diff) * cellArea;
    }
  }
  return { cut: Math.round(cut), fill: Math.round(fill), net: Math.round(fill - cut), area: Math.round(cells * cellArea) };
}

// Mittleres Geländeniveau UNTER dem Footprint (bilinear über Teilraster) — als
// ausgeglichenes Standard-Planum. Liefert null, wenn kein Footprint vorliegt.
function footprintMeanElev(grid, spanKm, footprintM) {
  if (!grid || grid.length < 2) return null;
  if (!Array.isArray(footprintM) || footprintM.length < 3) return null;
  const size = grid.length;
  const cellM = (spanKm * 1000) / (size - 1);
  const bb = bboxOf(footprintM);
  const N = 48;
  const stepX = (bb.maxX - bb.minX) / N, stepZ = (bb.maxZ - bb.minZ) / N;
  let sum = 0, count = 0;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const x = bb.minX + (a + 0.5) * stepX;
      const z = bb.minZ + (b + 0.5) * stepZ;
      if (!pointInPoly(x, z, footprintM)) continue;
      sum += sampleElev(grid, size, cellM, x, z);
      count++;
    }
  }
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

// Baugruben-Berechnung (Aushub unter Planum) mit Arbeitsraum und Böschung.
// Bewusst einfache, transparente Näherung: Statt das Footprint-Polygon exakt
// nach außen zu versetzen, wird seine Bounding-Box um den Arbeitsraum je Seite
// erweitert → rechteckige Baugrubensohle (wB × dB). Die Böschung weitet die
// Grube nach oben auf (offsetTop = Tiefe / tan(Böschungswinkel)). Das Volumen
// wird als Pyramidenstumpf (Prismatoid) berechnet.
// Gibt { volume, topArea, bottomArea, offsetTop } in m³/m²/m zurück (gerundet).
function computeBaugrube(footprintM, depth, slopeDeg, workspace) {
  const empty = { volume: 0, topArea: 0, bottomArea: 0, offsetTop: 0 };
  if (!Array.isArray(footprintM) || footprintM.length < 3) return empty;
  if (!(depth > 0)) return empty;
  const bb = bboxOf(footprintM);
  // Sohle: Footprint-BBox + Arbeitsraum umlaufend (vereinfachtes Rechteck)
  const wB = (bb.maxX - bb.minX) + 2 * workspace;
  const dB = (bb.maxZ - bb.minZ) + 2 * workspace;
  if (!(wB > 0) || !(dB > 0)) return empty;
  // Böschungsversatz oben: horizontale Aufweitung je Seite
  const offsetTop = depth / Math.tan((slopeDeg * Math.PI) / 180);
  const bottomArea = wB * dB;
  const topArea = (wB + 2 * offsetTop) * (dB + 2 * offsetTop);
  // Pyramidenstumpf-Formel (Prismatoid)
  const volume = (depth / 3) * (bottomArea + topArea + Math.sqrt(bottomArea * topArea));
  return {
    volume: Math.round(volume),
    topArea: Math.round(topArea),
    bottomArea: Math.round(bottomArea),
    offsetTop: Math.round(offsetTop * 10) / 10,
  };
}

/**
 * 3D terrain study with earthworks.
 * @param {{ complexData?: any }} props complexData of ComplexDesigner (location, site_parcel, buildings, hochwasser)
 */
export default function TerrainView3D({ complexData = null }) {
  const { project } = useProject();
  const { t } = useI18n();
  const programm = /** @type {any} */ (useBuildingProgram());
  const footprintM = programm.footprintM;
  const hasFootprint = Array.isArray(footprintM) && footprintM.length >= 3;
  // 103-01: the site plan's location wins (a project may carry none), else the project's.
  const ort = complexData?.location ?? project?.location ?? null;
  // Display rasters: 1 km (10×10 = 100 points, the maximum per Open-Meteo request ⇒ ~111 m spacing)
  // and 300 m (~33 m spacing, the calculation raster). Finer than DEM_RESOLUTION_M (~90 m) adds no
  // information — the values repeat — but it puts the real DEM cells under the plot.
  const gross = useElevationGrid(ort, 10, 1);
  const { grid: calcGrid, min: calcMin, max: calcMax, offline: calcOffline, loading: calcLaedt } = useElevationGrid(ort, 10, SPAN_CALC);
  const synthetic = gross.offline || calcOffline;
  const calcCellM = (SPAN_CALC * 1000) / 9;
  const [ausschnitt, setAusschnitt] = useState(300); // m, shown edge length (103-03: default 300 m)
  const spanKm = ausschnitt / 1000; // km, shown edge length (read by the data source note below)
  const anzeigeGrid = ausschnitt === 300 ? calcGrid : gross.grid;
  const rAnzeige = useMemo(() => demRaster(anzeigeGrid, ausschnitt), [anzeigeGrid, ausschnitt]);
  const rCalc = useMemo(() => demRaster(calcGrid, SPAN_CALC * 1000), [calcGrid]);
  const bezug = rAnzeige ? Math.floor(rAnzeige.minNHN) : 0;
  const laedt = gross.loading || calcLaedt;

  const mountRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const ansichtRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const nordRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const massstabBalkenRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const massstabTextRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const massstabRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const kotenRefs = useRef(/** @type {Record<string, HTMLDivElement|null>} */ ({}));
  const three = useRef(/** @type {Record<string, any>} */ ({})); // three.js handles (87-09)
  // Orbit camera (isoKamera convention): yaw clockwise from north, pitch above the horizon (degrees),
  // abstand = distance to the target (scene metres, set when the terrain is built).
  const kam = useRef({ yaw: START_YAW, pitch: START_PITCH, abstand: 0, ziehen: false, px: 0, py: 0 });
  const [glFehler, setGlFehler] = useState(/** @type {string|null} */ (null));

  // --- 103-02: vertical exaggeration — sensible start value, the user's value wins -----------
  const [ueNutzer, setUeNutzer] = useState(/** @type {number|null} */ (null));
  const ueStart = rAnzeige ? startUeberhoehung(rAnzeige.maxNHN - rAnzeige.minNHN, ausschnitt) : 1;
  const ue = ueNutzer ?? ueStart;

  // --- 103-01: plot, bodies, spot heights --------------------------------------------------------
  const grundstueck = useMemo(() => grundstueckM(complexData), [complexData]);
  // An estimated parcel (generic start square) is no boundary: not drawn, not counted (1.8.0 rule).
  const plot = grundstueck && !grundstueck.geschaetzt ? grundstueck.poly : null;
  const storeyHeight = Number(programm.storeyHeight) > 0 ? Number(programm.storeyHeight) : 3;
  const koerper = useMemo(() => baukoerperListe(complexData, { storeyHeight }), [complexData, storeyHeight]);
  const koten = useMemo(() => (rAnzeige ? hoehenKoten(rAnzeige, plot) : null), [rAnzeige, plot]);

  // --- 103-03: water level ------------------------------------------------------------------------
  const [wasserAn, setWasserAn] = useState(false);
  const bereich = useMemo(() => {
    const a = pegelBereich(rCalc), b = pegelBereich(rAnzeige);
    return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max), schritt: a.schritt };
  }, [rCalc, rAnzeige]);
  const [pegelNutzer, setPegel] = useState(/** @type {number|null} */ (null));
  // Default level = lowest terrain point of the calculation raster: nothing is wet yet.
  const pegel = pegelNutzer ?? (rCalc ? Math.round(rCalc.minNHN * 20) / 20 : bereich.min);
  const marken = useMemo(() => hqMarken(complexData?.hochwasser, bereich), [complexData?.hochwasser, bereich]);
  // Flood figures always from the 300-m raster (finer than the 1-km display raster).
  const kurve = useMemo(() => (rCalc && plot ? flutKurve(rCalc, plot) : null), [rCalc, plot]);
  const flaeche = kurve ? ueberfluteteFlaeche(kurve, pegel) : null;
  const reihenfolge = useMemo(
    () => (rCalc ? flutReihenfolge(rCalc, { grundstueck: plot, baukoerper: koerper }) : []),
    [rCalc, plot, koerper],
  );

  // --- 104-16: drone scan as gaussian splats ----------------------------------------------------
  // Own group in the scene, OUTSIDE the height group: the scan keeps its true proportions and only
  // its base follows the exaggerated terrain. Scan units are taken as metres, scaled by `massstab`.
  const [splatInfo, setSplatInfo] = useState(/** @type {{name: string, anzahl: number}|null} */ (null));
  const [splatLage, setSplatLage] = useState({ massstab: 1, drehung: 0, hoehe: 0, umkehren: false });
  const [splatFehler, setSplatFehler] = useState("");
  const [splatLaedt, setSplatLaedt] = useState(false);
  const splatDaten = useRef(/** @type {any} */ (null));

  // --- Walk mode (eye camera, WASD + mouse drag) -------------------------------------------------
  // Position in plan metres (xM east, zM south), view by yaw/pitch (radians, yaw 0 = looking north);
  // exitFn is refreshed every render so the Esc handler (setup effect) always sees the current one.
  const [walking, setWalking] = useState(false);
  const walk = useRef({ active: false, on: false, px: 0, py: 0, yaw: 0, pitch: 0, keys: {}, xM: 0, zM: 0, eyeY: 0, exitFn: null });

  // Planum: Mittelwert der gesamten Geländehöhen als Standard (Rechen-Raster)
  const meanElev = useMemo(() => {
    if (!calcGrid || calcGrid.length === 0) return 0;
    let sum = 0, count = 0;
    calcGrid.forEach((row) => row.forEach((v) => { sum += v; count++; }));
    return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
  }, [calcGrid]);

  // Standard-Planum: mittleres Geländeniveau unter dem Footprint (ausgeglichen).
  // Ohne Footprint → Mittelwert des gesamten Geländes (meanElev).
  // ACHTUNG: Ein ausgeglichenes Planum erzeugt zwangsläufig Abtrag ≈ Auftrag —
  // das ist eine Setzung, kein Ergebnis. Deshalb unten so gekennzeichnet.
  const defaultPlanum = useMemo(() => {
    const fpMean = footprintMeanElev(calcGrid, SPAN_CALC, footprintM);
    return fpMean !== null ? fpMean : meanElev;
  }, [calcGrid, footprintM, meanElev]);

  // --- Auflösung ehrlich ausweisen (KD-08) -----------------------------------
  // „Echte Stützstellen" = Anzahl unterscheidbarer DEM-Zellen (~90 m) unter der
  // Footprint-Bounding-Box. Alles darunter ist Interpolation, keine Messung.
  const resolution = useMemo(() => {
    if (!Array.isArray(footprintM) || footprintM.length < 3) return null;
    const bb = bboxOf(footprintM);
    const w = bb.maxX - bb.minX, d = bb.maxZ - bb.minZ;
    const nx = Math.floor(w / DEM_RESOLUTION_M) + 1;
    const nz = Math.floor(d / DEM_RESOLUTION_M) + 1;
    return { w, d, support: nx * nz };
  }, [footprintM]);
  // Weniger als ~4 unterscheidbare Stützstellen ⇒ nur Größenordnung.
  const roughOnly = synthetic || !resolution || resolution.support < 4;
  const m3 = (v) => `${roughOnly ? "≈ " : ""}${Math.round(v).toLocaleString("de-DE")} m³`;

  const [planum, setPlanum] = useState(null); // null → wird auf defaultPlanum gesetzt
  const planumVal = planum !== null ? planum : defaultPlanum;

  // Planum-Wert zurücksetzen, wenn sich das Standard-Planum ändert (Grid/Footprint)
  useEffect(() => {
    setPlanum(null);
  }, [defaultPlanum]);

  const erdmassen = useMemo(
    () => computeErdmassen(calcGrid, planumVal, SPAN_CALC, footprintM),
    [calcGrid, planumVal, footprintM]
  );

  // Baugrube: Aushubtiefe unter Planum, Arbeitsraum umlaufend, Böschungswinkel
  const WORKSPACE = 0.5; // m Arbeitsraum umlaufend
  const [basementDepth, setBasementDepth] = useState(3); // m unter Planum
  const [slopeAngle, setSlopeAngle] = useState(45); // Grad

  const baugrube = useMemo(
    () => computeBaugrube(footprintM, basementDepth, slopeAngle, WORKSPACE),
    [footprintM, basementDepth, slopeAngle]
  );

  // --- Scene setup ONCE: renderer, camera, lights, groups, render loop, input --------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const W = mount.clientWidth || 600;
    const H = mount.clientHeight || 480;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    } catch (err) {
      console.warn("Gelände 3D: WebGL nicht verfügbar", err);
      setGlFehler("kein-webgl");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(HIMMEL, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(HIMMEL);
    scene.fog = new THREE.Fog(HIMMEL, 750, 1800); // set per cut-out in the terrain effect
    const camera = new THREE.PerspectiveCamera(FOV_GRAD, W / H, 0.5, 20000);
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8a9a78, 1.0));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sonne = new THREE.DirectionalLight(0xfff4e0, 1.25);
    sonne.position.set(-300, 600, 400); // from the south-west, high
    scene.add(sonne);

    // Height group: scale.y = vertical exaggeration (terrain, plot, bodies, water — all in real metres).
    const hoehenGruppe = new THREE.Group();
    scene.add(hoehenGruppe);
    const splatGruppe = new THREE.Group();
    scene.add(splatGruppe);
    Object.assign(three.current, { renderer, scene, camera, hoehenGruppe, splatGruppe, ue: 1, W, H });

    const ziel = new THREE.Vector3();
    const v = new THREE.Vector3();
    const setzeData = (/** @type {string} */ k, /** @type {string} */ wert) => {
      const el = ansichtRef.current;
      if (el && el.dataset[k] !== wert) el.dataset[k] = wert;
    };

    let raf;
    let lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000); // s, capped (tab switch)
      lastT = now;
      const tt = three.current;
      const tr = tt.terrain;
      const wk = walk.current;
      if (tr) {
        const hs = hoeheSzene(tr, tt.ue);
        let yawGrad, pitchGrad;
        if (wk.active) {
          // --- Walk: eye camera follows the (exaggerated) terrain at 1.7 m ---------------------
          const fast = wk.keys.ShiftLeft || wk.keys.ShiftRight;
          const speed = fast ? 8 : 4; // m/s
          const fx = -Math.sin(wk.yaw), fz = -Math.cos(wk.yaw); // forward (yaw 0 = north = −z)
          const rx = Math.cos(wk.yaw), rz = -Math.sin(wk.yaw);  // right
          let mvx = 0, mvz = 0;
          if (wk.keys.KeyW) { mvx += fx; mvz += fz; }
          if (wk.keys.KeyS) { mvx -= fx; mvz -= fz; }
          if (wk.keys.KeyA) { mvx -= rx; mvz -= rz; }
          if (wk.keys.KeyD) { mvx += rx; mvz += rz; }
          const len = Math.hypot(mvx, mvz);
          if (len > 0) {
            wk.xM = Math.max(-tr.limM, Math.min(tr.limM, wk.xM + (mvx / len) * speed * dt));
            wk.zM = Math.max(-tr.limM, Math.min(tr.limM, wk.zM + (mvz / len) * speed * dt));
          }
          const zielY = hs(wk.xM, wk.zM) + AUGENHOEHE_M;
          wk.eyeY += (zielY - wk.eyeY) * Math.min(1, dt * 8);
          camera.position.set(wk.xM, wk.eyeY, wk.zM);
          camera.rotation.order = "YXZ";
          camera.rotation.set(wk.pitch, wk.yaw, 0);
          yawGrad = (-wk.yaw * 180) / Math.PI;
          pitchGrad = 60; // the arrow lies on the ground; a steep virtual pitch keeps it readable
        } else {
          // --- Orbit: the camera circles the target and is lifted above the terrain -------------
          const k = kam.current;
          ziel.set(0, hs(0, 0), 0);
          const p = kameraPose({ yaw: k.yaw, pitch: k.pitch, abstand: k.abstand }, ziel, hs);
          camera.position.set(p.x, p.y, p.z);
          camera.rotation.order = "XYZ";
          camera.lookAt(ziel);
          yawGrad = k.yaw;
          pitchGrad = k.pitch;
        }
        // Overlays (direct DOM writes — no React render per frame)
        if (nordRef.current) nordRef.current.style.transform = `rotate(${nordpfeilWinkel(yawGrad, pitchGrad, 0).toFixed(1)}deg)`;
        const leiste = wk.active ? null : massstabsLeiste(mJePxBildmitte(camera.position.distanceTo(ziel), FOV_GRAD, tt.H), 120);
        if (massstabRef.current) massstabRef.current.style.visibility = leiste ? "visible" : "hidden";
        if (leiste && massstabBalkenRef.current && massstabTextRef.current) {
          massstabBalkenRef.current.style.width = `${leiste.px.toFixed(1)}px`;
          const txt = `${leiste.m.toLocaleString("de-DE")} m`;
          if (massstabTextRef.current.textContent !== txt) massstabTextRef.current.textContent = txt;
        }
        const kt = tt.koten;
        for (const art of ["tief", "hoch", "mitte"]) {
          const el = kotenRefs.current[art];
          if (!el) continue;
          const q = kt?.[art];
          if (!q) { el.style.visibility = "hidden"; continue; }
          v.set(q.x, (q.h - tr.bezug) * tt.ue, q.z).project(camera);
          const sicht = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
          el.style.visibility = sicht ? "visible" : "hidden";
          el.style.transform = `translate(${(((v.x + 1) / 2) * tt.W).toFixed(1)}px, ${(((1 - v.y) / 2) * tt.H).toFixed(1)}px)`;
        }
        setzeData("kameraUeberGelaende", (camera.position.y - hs(camera.position.x, camera.position.z)).toFixed(2));
        setzeData("pitch", pitchGrad.toFixed(1));
        setzeData("yaw", (((yawGrad % 360) + 360) % 360).toFixed(1));
        setzeData("kameraZ", camera.position.z.toFixed(1));
      }
      tt.splat?.aktualisieren(camera, renderer);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    const down = (/** @type {PointerEvent} */ e) => {
      if (walk.current.active) { // walk: drag = look around (yaw/pitch)
        walk.current.on = true;
        walk.current.px = e.clientX;
        walk.current.py = e.clientY;
        return;
      }
      Object.assign(kam.current, { ziehen: true, px: e.clientX, py: e.clientY });
    };
    const move = (/** @type {PointerEvent} */ e) => {
      if (walk.current.active) {
        const wk = walk.current;
        if (!wk.on) return;
        wk.yaw -= (e.clientX - wk.px) * 0.005;
        wk.pitch = Math.max(-1.396, Math.min(1.396, wk.pitch - (e.clientY - wk.py) * 0.005)); // ±80°
        wk.px = e.clientX; wk.py = e.clientY;
        return;
      }
      const k = kam.current;
      if (!k.ziehen) return;
      // Drag right = the site turns right (camera walks left around it); drag down = view from higher up.
      k.yaw = (k.yaw - (e.clientX - k.px) * 0.3 + 360) % 360;
      k.pitch = pitchKlemmen(k.pitch + (e.clientY - k.py) * 0.25);
      k.px = e.clientX; k.py = e.clientY;
    };
    const up = () => { kam.current.ziehen = false; walk.current.on = false; };
    const rad = (/** @type {WheelEvent} */ e) => {
      if (walk.current.active) return;
      e.preventDefault();
      const tr = three.current.terrain;
      const span = tr ? tr.spanM : 1000;
      const k = kam.current;
      k.abstand = Math.max(ABSTAND_MIN_FAKTOR * span, Math.min(ABSTAND_MAX_FAKTOR * span, k.abstand * Math.exp(e.deltaY * 0.001)));
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("wheel", rad, { passive: false });
    const verloren = (/** @type {Event} */ e) => { e.preventDefault(); setGlFehler("verloren"); };
    el.addEventListener("webglcontextlost", verloren);

    // Walk: WASD/Shift by e.code (layout-independent), Esc ends.
    const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
      if (!walk.current.active) return;
      if (e.code === "Escape") {
        if (typeof walk.current.exitFn === "function") walk.current.exitFn();
        return;
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        walk.current.keys[e.code] = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (/** @type {KeyboardEvent} */ e) => { walk.current.keys[e.code] = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const groesse = () => {
      const nw = mount.clientWidth, nh = mount.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
      Object.assign(three.current, { W: nw, H: nh });
      three.current.linie?.material?.resolution?.set(nw, nh);
    };
    window.addEventListener("resize", groesse);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(groesse) : null;
    ro?.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", rad);
      el.removeEventListener("webglcontextlost", verloren);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", groesse);
      ro?.disconnect();
      three.current.splat?.entsorgen();
      three.current.splat = null;
      three.current.terrain = null;
      gruppeLeeren(hoehenGruppe);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      scene.traverse((/** @type {any} */ o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    };
  }, []);

  // (Re)build terrain, skirt, water, plot line and bodies whenever the shown raster or the site changes.
  useEffect(() => {
    const tt = three.current;
    if (!tt.hoehenGruppe || !rAnzeige) return;
    gruppeLeeren(tt.hoehenGruppe);
    const mat = terrainMaterial();
    tt.hoehenGruppe.add(new THREE.Mesh(terrainGeometrie(rAnzeige, bezug), mat));
    tt.hoehenGruppe.add(new THREE.Mesh(schuerzeGeometrie(rAnzeige, bezug), new THREE.MeshLambertMaterial({ color: 0x8a7a62 })));
    const wasser = wasserEbene(ausschnitt);
    tt.hoehenGruppe.add(wasser);
    tt.linie = null;
    if (plot) {
      const linie = grundstuecksLinie(rAnzeige, plot, bezug, { farbe: 0xffffff, breitePx: 3 });
      linie.material.resolution.set(tt.W || 600, tt.H || 480);
      tt.hoehenGruppe.add(linie);
      tt.linie = linie;
    }
    for (const b of koerper) {
      const tief = minHoeheInPolygon(rAnzeige, b.ecken);
      const okff = okffNHN(rAnzeige, b.ecken);
      if (tief == null || okff == null) continue;
      // Base 0.5 m below the lowest terrain point so the body never floats on a slope.
      tt.hoehenGruppe.add(baukoerperMesh(b.ecken, tief - 0.5, okff + b.geschosse * b.geschossHoeheM, bezug));
    }
    Object.assign(tt, { terrainMat: mat, wasser });
    const neuerAusschnitt = !tt.terrain || tt.terrain.spanM !== ausschnitt;
    tt.terrain = { r: rAnzeige, bezug, spanM: ausschnitt, limM: rAnzeige.halbM - 5 };
    if (neuerAusschnitt) kam.current.abstand = ABSTAND_START_FAKTOR * ausschnitt;
    tt.camera.far = 20 * ausschnitt;
    tt.camera.updateProjectionMatrix();
    tt.scene.fog.near = 2.5 * ausschnitt;
    tt.scene.fog.far = 6 * ausschnitt;
    tt.wasserStand = null; // force the water effect to re-apply
    setWasserStand(tt, wasserAn, pegel, bezug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rAnzeige, bezug, plot, koerper, ausschnitt]);

  // Spot heights → read by the render loop.
  useEffect(() => { three.current.koten = koten; }, [koten]);

  // 103-02: exaggeration = scale.y of the height group.
  useEffect(() => {
    const tt = three.current;
    tt.ue = ue;
    tt.hoehenGruppe?.scale.set(1, ue, 1);
  }, [ue]);

  // 103-03: water plane and flood tint.
  useEffect(() => { setWasserStand(three.current, wasserAn, pegel, bezug); }, [wasserAn, pegel, bezug]);

  // --- Walk start: eye camera at the SOUTH edge of the cut-out, looking north ------------------
  const enterWalk = () => {
    const tt = three.current;
    const tr = tt.terrain;
    if (!tt.camera || !tr) return;
    const wk = walk.current;
    wk.xM = 0;
    wk.zM = tr.limM; // +z = south
    wk.yaw = 0;      // looking north (−z), towards the centre
    wk.pitch = 0;
    wk.keys = {};
    wk.eyeY = hoeheSzene(tr, tt.ue)(wk.xM, wk.zM) + AUGENHOEHE_M;
    wk.active = true;
    setWalking(true);
  };

  // --- Walk end: the orbit camera takes over again (its yaw/pitch/distance were never touched) --
  const exitWalk = () => {
    walk.current.active = false;
    walk.current.on = false;
    walk.current.keys = {};
    setWalking(false);
  };

  // 104-16: (re)place the scan — new splat set, terrain, exaggeration or placement changed.
  useEffect(() => {
    const tt = three.current;
    if (!tt.splatGruppe) return;
    const d = splatDaten.current;
    if (!d || !splatInfo) return;
    // sits on the terrain in the middle of the view; the scan itself stays undistorted (outside the height group)
    const boden = tt.terrain ? hoeheSzene(tt.terrain, ue)(0, 0) : 0;
    const { aussen, innen, wolke, huelle } = d;
    aussen.position.set(0, boden + splatLage.hoehe, 0);
    aussen.rotation.set(0, (splatLage.drehung * Math.PI) / 180, 0);
    aussen.scale.setScalar(splatLage.massstab);
    innen.rotation.set(splatLage.umkehren ? Math.PI : 0, 0, 0);
    wolke.mesh.position.set(-huelle.mitte[0], -(splatLage.umkehren ? huelle.max[1] : huelle.min[1]), -huelle.mitte[2]);
  }, [splatInfo, splatLage, rAnzeige, bezug, ue]);

  const splatsZeigen = (/** @type {any} */ splats, /** @type {string} */ name, /** @type {number} */ massstab) => {
    const tt = three.current;
    if (!tt.splatGruppe) return;
    splatEntfernen();
    const wolke = new SplatWolke(splats);
    const innen = new THREE.Group();
    innen.add(wolke.mesh);
    const aussen = new THREE.Group();
    aussen.add(innen);
    tt.splatGruppe.add(aussen);
    tt.splat = wolke;
    splatDaten.current = { wolke, innen, aussen, huelle: splatHuelle(splats) };
    setSplatLage({ massstab, drehung: 0, hoehe: 0, umkehren: false });
    setSplatInfo({ name, anzahl: splats.anzahl });
  };
  const splatEntfernen = () => {
    const tt = three.current;
    tt.splat?.entsorgen();
    tt.splat = null;
    if (splatDaten.current) tt.splatGruppe?.remove(splatDaten.current.aussen);
    splatDaten.current = null;
    setSplatInfo(null);
  };
  const splatDatei = async (/** @type {File} */ f) => {
    setSplatFehler("");
    if (f.size > SPLAT_MAX_MB * 1024 * 1024) { setSplatFehler(`Datei zu groß (${Math.round(f.size / 1048576)} MB, höchstens ${SPLAT_MAX_MB} MB) — Scan vorher ausdünnen`); return; }
    setSplatLaedt(true);
    try {
      splatsZeigen(splatsLesen(await f.arrayBuffer(), f.name), f.name, 1);
    } catch (err) {
      setSplatFehler(`Scan nicht lesbar: ${err?.message || err}`);
    } finally {
      setSplatLaedt(false);
    }
  };

  // Esc handler (setup effect) must always see the current exit function.
  useEffect(() => { walk.current.exitFn = exitWalk; });

  const ueText = `${t("Überhöhung {n}×").replace("{n}", String(ue))}${ue === 1 ? ` ${t("(echt)")}` : ""}`;
  const kotenTitel = { tief: t("tiefster Punkt"), hoch: t("höchster Punkt"), mitte: plot ? t("Grundstücksmitte") : t("Standort") };

  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Mountain className="h-4 w-4 text-erfolg" /> {t("Gelände 3D")}
            {ort?.address && <span className="font-normal text-muted-foreground">· {ort.address}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {laedt && <span className="text-muted-foreground">{t("lädt…")}</span>}
            {/* Walk: eye camera at eye level (WASD + mouse drag) */}
            <button
              type="button"
              onClick={() => (walking ? exitWalk() : enterWalk())}
              disabled={!rAnzeige || !!glFehler}
              title={walking ? t("Begehung beenden (Esc)") : t("Begehung auf Augenhöhe starten")}
              data-testid="gelaende-begehung"
              className={`flex items-center gap-1 rounded-md border px-2 py-1 transition-colors disabled:opacity-40 ${walking ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              <Footprints className="h-3.5 w-3.5" /> {walking ? t("Begehung beenden") : t("Begehung")}
            </button>
            {/* Exposé image: the current view as high-resolution PNG (without the HTML overlays) */}
            <button
              type="button"
              onClick={() => exportExposePng(three.current)}
              title={t("Aktuelle Ansicht hochauflösend als PNG exportieren")}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-muted"
            >
              <Camera className="h-3.5 w-3.5" /> {t("Exposé-Bild")}
            </button>
          </div>
        </div>

        {/* Drawing first: the view leads, the controls follow in a narrow strip. */}
        <div ref={ansichtRef} className="relative" data-testid="gelaende-ansicht"
          data-ueberhoehung={ue} data-pegel={wasserAn ? pegel.toFixed(2) : ""} data-ausschnitt={ausschnitt}
          style={{ height: "clamp(420px, 62vh, 760px)" }}>
          <div ref={mountRef} className="h-full w-full" />
          {glFehler && (
            <div className="absolute inset-0 flex items-center justify-center bg-card p-6 text-center text-sm text-muted-foreground" data-testid="gelaende-glfehler">
              {glFehler === "verloren"
                ? t("Die 3D-Ansicht hat den Grafikkontext verloren — Seite neu laden.")
                : t("3D-Ansicht nicht verfügbar — WebGL fehlt oder ist abgeschaltet. Höhen, Pegel und Erdmassen unten gelten trotzdem.")}
            </div>
          )}
          {/* Data source: a demo terrain must never look like a terrain model */}
          <div className="pointer-events-none absolute left-3 top-3 max-w-[70%]" data-testid="gelaende-quelle" data-synthetisch={synthetic ? "ja" : "nein"}>
            {synthetic ? (
              <div className="rounded-md border-2 border-warnung-rand bg-warnung-flaeche px-3 py-1.5 text-sm font-semibold text-warnung shadow">
                {t("Demo-Gelände — erfundene Höhen")}
                <div className="text-[11px] font-normal">{t("Keine Höhendaten für diesen Standort erreichbar — Form, Koten und Pegel sind Rechenbeispiele.")}</div>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
                {t("Copernicus DEM GLO-90 (~90 m, Oberflächenmodell)")}
                {rAnzeige && <> · {hoeheText(rAnzeige.minNHN)}–{hoeheText(rAnzeige.maxNHN)} {t("m ü. NHN (näherungsweise)")}</>}
              </div>
            )}
          </div>
          {/* North arrow */}
          <div className="pointer-events-none absolute right-3 top-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card/90 shadow-sm" aria-label={t("Nordpfeil")} role="img">
            <div ref={nordRef} data-testid="gelaende-nord" className="flex flex-col items-center leading-none text-foreground">
              <span className="text-[11px] font-bold">N</span>
              <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="M6 0 L12 20 L6 15 L0 20 Z" fill="currentColor" /></svg>
            </div>
          </div>
          {/* Scale bar (perspective: valid at the image centre) */}
          <div ref={massstabRef} className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-foreground shadow-sm" data-testid="gelaende-massstab">
            <div ref={massstabBalkenRef} className="h-1.5 border-x-2 border-b-2 border-foreground" style={{ width: 100 }} />
            <span ref={massstabTextRef}>—</span> <span className="text-muted-foreground">{t("≈ in Bildmitte")}</span>
          </div>
          {/* Exaggeration badge — always visible on the drawing */}
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-foreground shadow-sm" data-testid="gelaende-ueberhoehung-badge">
            {ueText}
          </div>
          {/* Spot heights, positioned by the render loop */}
          {/* A dot on the point, the label beside it (low: lower left, high: upper right, centre: above) —
              so the labels do not cover the plot they describe. */}
          {koten && ["tief", "hoch", "mitte"].map((art) => (
            <div key={art} ref={(el) => { kotenRefs.current[art] = el; }} className="pointer-events-none absolute left-0 top-0 h-0 w-0" style={{ visibility: "hidden" }}>
              <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-card bg-foreground" />
              <div data-testid={`gelaende-kote-${art}`}
                className={`absolute whitespace-nowrap rounded border border-border bg-card/90 px-1.5 py-0.5 text-[11px] leading-tight text-foreground shadow-sm ${KOTE_LAGE[art]}`}>
                <span className="text-muted-foreground">{kotenTitel[art]} </span>{hoeheText(koten[art].h)} {t("m ü. NHN")}
              </div>
            </div>
          ))}
          {walking && (
            <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground/80 px-3 py-1.5 text-[11px] text-background shadow-lg">
              {t("WASD bewegen · Maus ziehen: umsehen · Shift: schnell · Esc: beenden")}
            </div>
          )}
        </div>

        <GelaendeSteuerung ueberhoehung={ue} onUeberhoehung={setUeNutzer} ausschnitt={ausschnitt} onAusschnitt={setAusschnitt}
          wasserAn={wasserAn} onWasserAn={setWasserAn} pegel={pegel} onPegel={(p) => { setPegel(p); setWasserAn(true); }}
          bereich={bereich} marken={marken} flaeche={flaeche} reihenfolge={reihenfolge} />

        <SplatSteuerung info={splatInfo} lage={splatLage} fehler={splatFehler} laedt={splatLaedt}
          onDatei={splatDatei} onBeispiel={() => { setSplatFehler(""); splatsZeigen(beispielSplats(), "Beispiel", 5); }}
          onEntfernen={splatEntfernen} onLage={setSplatLage} />
        {splatInfo && ue !== 1 && (
          <div className="border-b border-border px-4 py-1 text-[11px] text-muted-foreground" data-testid="splat-ueberhoehung-hinweis">
            {t("Der Scan bleibt unverzerrt — nur das Gelände ist {n}× überhöht.").replace("{n}", String(ue))}
          </div>
        )}

        {/* Datengrundlage & Auflösung (KD-08) — steht ÜBER den Kubikmetern */}
        {calcGrid && calcGrid.length >= 2 && (
          <div
            className={`flex gap-2 px-4 py-2 border-b text-[11px] leading-snug ${
              synthetic ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-slate-50 text-slate-500"
            }`}
          >
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {synthetic && (
                <div>
                  <strong>Synthetisches Gelände (Offline-Fallback).</strong> Die Höhen sind aus dem
                  Standort errechnet — eine glatte Fläche mit fester Neigung, kein Geländemodell. Die
                  folgenden Kubikmeter sind ein Rechenbeispiel und <strong>keine Mengen</strong>.
                </div>
              )}
              <div>
                Rechen-Raster {Math.round(calcCellM)} m über {Math.round(SPAN_CALC * 1000)} m
                {" · "}Anzeige-Raster {Math.round((spanKm * 1000) / 9)} m über {spanKm * 1000} m
                {!synthetic && ` · Quelle Copernicus DEM GLO-90 (~${DEM_RESOLUTION_M} m native Rasterweite)`}
                {resolution
                  ? ` · unterscheidbare Stützstellen unter dem Baufeld (${Math.round(resolution.w)}×${Math.round(resolution.d)} m): ${resolution.support}`
                  : " · kein Baufeld — ganzer Geländeausschnitt"}
              </div>
              {roughOnly && (
                <div>
                  Damit sind die Volumen nur eine <strong>Größenordnung</strong>: Das Baufeld ist
                  kleiner als das Höhenraster, die Geländeform darunter ist interpoliert. Für
                  Aushubmengen ist eine Vermessung bzw. ein amtliches DGM erforderlich.
                </div>
              )}
              <div>
                Standard-Planum = mittlere Geländehöhe unter dem Baufeld. Abtrag ≈ Auftrag ist dann
                rechnerisch vorgegeben und keine Aussage über den Standort.
              </div>
            </div>
          </div>
        )}

        {/* Erdmassen-Panel */}
        {calcGrid && calcGrid.length >= 2 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 border-b bg-slate-50 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Erdmassen{roughOnly ? " (Größenordnung)" : ""}</span>
            <span className="text-slate-400">{hasFootprint ? "auf Baufeld begrenzt" : "ganzer Geländeausschnitt"}</span>
            {hasFootprint && (
              <span>Baufeld: <strong className="text-emerald-700">{erdmassen.area.toLocaleString("de-DE")} m²</strong></span>
            )}
            <span>Abtrag: <strong className={roughOnly ? "text-slate-600" : "text-orange-600"}>{m3(erdmassen.cut)}</strong></span>
            <span>Auftrag: <strong className={roughOnly ? "text-slate-600" : "text-sky-600"}>{m3(erdmassen.fill)}</strong></span>
            <span>
              Netto:{" "}
              <strong className={roughOnly ? "text-slate-600" : erdmassen.net > 0 ? "text-sky-600" : erdmassen.net < 0 ? "text-orange-600" : "text-slate-500"}>
                {roughOnly ? "≈ " : ""}{erdmassen.net > 0 ? "+" : ""}{Math.round(erdmassen.net).toLocaleString("de-DE")} m³
              </strong>
            </span>
            <span className="flex items-center gap-2 ml-auto">
              <span className="text-slate-500">Planum {planumVal.toFixed(1)} m ü. NN</span>
              <input
                type="range"
                min={calcMin}
                max={calcMax}
                step={0.1}
                value={planumVal}
                onChange={(e) => setPlanum(parseFloat(e.target.value))}
                className="w-28 accent-emerald-600"
                title="Planum-Höhe anpassen"
              />
            </span>
          </div>
        )}

        {/* Baugruben-Panel (nur mit Baufeld) */}
        {calcGrid && calcGrid.length >= 2 && hasFootprint && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 border-b bg-slate-50 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Baugrube{roughOnly ? " (Größenordnung)" : ""}</span>
            <span className="flex items-center gap-2">
              <span className="text-slate-500">Tiefe {basementDepth.toLocaleString("de-DE")} m</span>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={basementDepth}
                onChange={(e) => setBasementDepth(parseFloat(e.target.value))}
                className="w-24 accent-orange-600"
                title="Aushubtiefe unter Planum"
              />
            </span>
            <span className="flex items-center gap-2">
              <span className="text-slate-500">Böschung {slopeAngle}°</span>
              <input
                type="range"
                min={30}
                max={80}
                step={5}
                value={slopeAngle}
                onChange={(e) => setSlopeAngle(parseInt(e.target.value, 10))}
                className="w-24 accent-orange-600"
                title="Böschungswinkel"
              />
            </span>
            <span>Aushub: <strong className={roughOnly ? "text-slate-600" : "text-orange-600"}>{m3(baugrube.volume)}</strong></span>
            <span>Sohle: <strong className="text-slate-700">{baugrube.bottomArea.toLocaleString("de-DE")} m²</strong></span>
            <span>Krone: <strong className="text-slate-700">{baugrube.topArea.toLocaleString("de-DE")} m²</strong></span>
            <span className="text-slate-400">Arbeitsraum 0,5 m</span>
            <span className="ml-auto">
              Gesamt:{" "}
              <strong className={roughOnly ? "text-slate-700" : "text-orange-700"}>
                {m3(erdmassen.cut + baugrube.volume)} Abtrag
              </strong>
            </span>
          </div>
        )}

        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {walking
            ? t("Begehung aktiv — Esc oder Button beendet und stellt die Orbit-Ansicht wieder her")
            : `${t("Ziehen: drehen und neigen · Rad: zoomen")} · ${ueText}`}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Apply the water state to the scene: water plane height/visibility and the flood tint uniforms.
 * Skips work when nothing changed (called from the terrain rebuild and the water effect).
 * @param {Record<string, any>} tt three.current
 * @param {boolean} an water on
 * @param {number} pegel water level, m a.s.l.
 * @param {number} bezug reference height, m a.s.l.
 */
function setWasserStand(tt, an, pegel, bezug) {
  const schluessel = `${an}|${pegel}|${bezug}`;
  if (tt.wasserStand === schluessel) return;
  tt.wasserStand = schluessel;
  const u = tt.terrainMat?.userData?.u;
  if (u) {
    u.uPegel.value = pegel;
    u.uBezug.value = bezug;
    u.uWasserAn.value = an ? 1 : 0;
  }
  if (tt.wasser) {
    tt.wasser.visible = !!an;
    tt.wasser.position.y = pegel - bezug;
  }
}
