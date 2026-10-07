import React, { useRef, useEffect, useState, useMemo } from "react";
import * as THREE from "three";
import { Card, CardContent } from "@core/components/ui/card";
import { Mountain, WifiOff, Footprints, Camera, Info } from "lucide-react";
import { useProject } from "@core/lib/ProjectContext";
import { useElevationGrid, DEM_RESOLUTION_M } from "@designer/lib/useElevationGrid";
import { useBuildingProgram, polygonAreaM } from "@core/lib/useBuildingProgram";
import { exportExposePng } from "@designer/components/MassingView3D";

// Punkt-in-Polygon (Ray-Casting) gegen ein zentriertes Meter-Polygon [{x,z}].
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

// Farbverlauf nach normierter Höhe (0..1): Grün → Ocker → Fels → Schnee.
function heightColor(t) {
  const stops = [
    [0.0, [34, 102, 51]],
    [0.4, [120, 130, 60]],
    [0.7, [150, 120, 90]],
    [0.9, [130, 130, 135]],
    [1.0, [240, 240, 245]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return c0.map((c, k) => (c + (c1[k] - c) * f) / 255);
    }
  }
  return [1, 1, 1];
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

// Augenhöhe in Szenen-Einheiten: 1,7 m im (überhöhten) Höhenmaßstab des
// Terrains, begrenzt, damit sehr flaches Gelände (kleine Höhen-Range → großer
// Überhöhungsfaktor) die Kamera nicht unnatürlich hoch schiebt.
function eyeUnits(tr) {
  return Math.min(5, Math.max(0.6, 1.7 * (tr.RELIEF / tr.range)));
}

export default function TerrainView3D() {
  const { project } = useProject();
  const { footprintM } = useBuildingProgram();
  const hasFootprint = Array.isArray(footprintM) && footprintM.length >= 3;
  const spanKm = 1;
  // Anzeige-Raster: 1 km Ausschnitt für die 3D-Ansicht (10×10 = 100 Punkte,
  // das Maximum je Open-Meteo-Abfrage) ⇒ ~111 m Rasterweite.
  const { grid, min, max, offline, loading } = useElevationGrid(project?.location, 10, spanKm);
  // Rechen-Raster für Erdmassen/Planum: derselbe Punktvorrat, aber auf 300 m
  // um den Standort konzentriert ⇒ ~33 m Rasterweite. Damit werden die real
  // vorhandenen DEM-Zellen unter dem Baufeld tatsächlich abgetastet, statt
  // innerhalb EINER 111-m-Zelle zu interpolieren. Feiner als DEM_RESOLUTION_M
  // (~90 m) bringt keine zusätzliche Information — die Werte wiederholen sich.
  const SPAN_CALC = 0.3;
  const { grid: calcGrid, min: calcMin, max: calcMax, offline: calcOffline } =
    useElevationGrid(project?.location, 10, SPAN_CALC);
  const synthetic = offline || calcOffline;
  const calcCellM = (SPAN_CALC * 1000) / 9;
  const mountRef = useRef(null);
  const three = useRef({});
  // rotX nahe der oberen Klammergrenze (-1.4) => Start in Vogelperspektive (steile Aufsicht).
  const drag = useRef({ on: false, x: 0, y: 0, rotY: 0.6, rotX: -1.25 });

  // --- Begehungs-Modus (Ego-Kamera, WASD + Maus-Drag) ------------------------
  // Position in zentrierten Metern (xM/zM), Blick per yaw/pitch; saved = exakte
  // Orbit-Pose für die Wiederherstellung beim Beenden. exitFn wird pro Render
  // aktualisiert, damit der Esc-Handler (im Setup-Effect) immer aktuell ist.
  const [walking, setWalking] = useState(false);
  const walk = useRef({ active: false, on: false, px: 0, py: 0, yaw: 0, pitch: 0, keys: {}, xM: 0, zM: 0, eyeY: 0, saved: null, exitFn: null });

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

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth || 600;
    const H = mount.clientHeight || 480;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const SKY = 0xbcd8f2; // heller Tageshimmel statt dunklem Nebel
    renderer.setClearColor(SKY, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    // sanfter, heller Dunst am Horizont (kein „dunkler Nebel" mehr)
    scene.fog = new THREE.Fog(SKY, 700, 1700);
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 2000);
    camera.position.set(0, 180, 240);
    camera.lookAt(0, 0, 0);

    // Himmel-/Bodenlicht für eine natürliche, gut sichtbare Tagesszene
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8a9a78, 1.0));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xfff4e0, 1.25);
    dir.position.set(120, 220, 80);
    scene.add(dir);

    const group = new THREE.Group();
    scene.add(group);

    Object.assign(three.current, { renderer, scene, camera, group });

    let raf;
    let lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000); // s, gekappt (Tab-Wechsel)
      lastT = now;
      const wk = walk.current;
      const tr = three.current.terrain;
      if (wk.active && tr) {
        // --- Begehung: Gruppe unrotiert, Ego-Kamera folgt Gelände -----------
        group.rotation.y = 0;
        group.rotation.x = 0;
        const fast = wk.keys.ShiftLeft || wk.keys.ShiftRight;
        const speed = fast ? 8 : 4; // m/s
        const fx = -Math.sin(wk.yaw), fz = -Math.cos(wk.yaw); // vorwärts (Yaw)
        const rx = Math.cos(wk.yaw), rz = -Math.sin(wk.yaw);  // rechts
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
        // Boden folgt Gelände, geglättet (Augenhöhe ~1,7 m im Terrain-Maßstab)
        const elev = sampleElev(tr.grid, tr.size, tr.cellM, wk.xM, wk.zM);
        const targetY = ((elev - tr.min) / tr.range) * tr.RELIEF + eyeUnits(tr);
        wk.eyeY += (targetY - wk.eyeY) * Math.min(1, dt * 8);
        camera.position.set(wk.xM * tr.S, wk.eyeY, wk.zM * tr.S);
        camera.rotation.order = "YXZ";
        camera.rotation.set(wk.pitch, wk.yaw, 0);
      } else {
        group.rotation.y = drag.current.rotY;
        group.rotation.x = drag.current.rotX;
        if (!drag.current.on) drag.current.rotY += 0.0015; // sanftes Auto-Rotate
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    const down = (e) => {
      if (walk.current.active) { // Begehung: Drag = Umsehen (Yaw/Pitch)
        walk.current.on = true;
        walk.current.px = e.clientX;
        walk.current.py = e.clientY;
        return;
      }
      drag.current.on = true; drag.current.x = e.clientX; drag.current.y = e.clientY;
    };
    const move = (e) => {
      if (walk.current.active) {
        const wk = walk.current;
        if (!wk.on) return;
        wk.yaw -= (e.clientX - wk.px) * 0.005;
        wk.pitch = Math.max(-1.396, Math.min(1.396, wk.pitch - (e.clientY - wk.py) * 0.005)); // ±80°
        wk.px = e.clientX; wk.py = e.clientY;
        return;
      }
      if (!drag.current.on) return;
      drag.current.rotY += (e.clientX - drag.current.x) * 0.01;
      drag.current.rotX = Math.max(-1.4, Math.min(-0.1, drag.current.rotX + (e.clientY - drag.current.y) * 0.005));
      drag.current.x = e.clientX; drag.current.y = e.clientY;
    };
    const up = () => { drag.current.on = false; walk.current.on = false; };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    // Begehung: WASD/Shift per e.code (layout-unabhängig), Esc beendet.
    const onKeyDown = (e) => {
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
    const onKeyUp = (e) => { walk.current.keys[e.code] = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onResize = () => {
      const nw = mount.clientWidth, nh = mount.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    };
  }, []);

  // (Re)build the terrain mesh whenever the grid changes.
  useEffect(() => {
    const t = three.current;
    if (!t.group || !grid || grid.length < 2) return;
    while (t.group.children.length) {
      const c = t.group.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    const size = grid.length;
    const PLANE = 220;
    const RELIEF = 60;
    const range = (max - min) || 1;
    const geo = new THREE.PlaneGeometry(PLANE, PLANE, size - 1, size - 1);
    const pos = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const idx = i * size + j;
        const norm = (grid[i][j] - min) / range;
        pos.setZ(idx, norm * RELIEF);
        const [r, g, b] = heightColor(norm);
        colors[idx * 3] = r; colors[idx * 3 + 1] = g; colors[idx * 3 + 2] = b;
      }
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // Plane in XY → flach legen, Höhe nach oben
    t.group.add(mesh);
    // dünnes Drahtgitter für Lesbarkeit
    const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0x0d9488, wireframe: true, transparent: true, opacity: 0.12 }));
    wire.rotation.x = -Math.PI / 2;
    t.group.add(wire);

    // Terrain-Parameter für die Begehung (Meter ↔ Szenen-Einheiten):
    // S = Einheiten pro Meter (PLANE deckt spanKm·1000 m ab), limM = Laufgrenze.
    t.terrain = {
      grid, min, max, size, RELIEF,
      range,
      cellM: (spanKm * 1000) / (size - 1),
      S: PLANE / (spanKm * 1000),
      limM: spanKm * 500 - 20,
    };
  }, [grid, min, max]);

  // --- Begehung starten: Orbit-Pose exakt sichern, Ego-Kamera an den Rand ----
  const enterWalk = () => {
    const t = three.current;
    const tr = t.terrain;
    if (!t.camera || !tr) return;
    walk.current.saved = {
      rotY: drag.current.rotY,
      rotX: drag.current.rotX,
      pos: t.camera.position.clone(),
      quat: t.camera.quaternion.clone(),
    };
    const wk = walk.current;
    wk.xM = 0;
    wk.zM = Math.min(tr.limM, 350); // Start am südlichen Rand des Ausschnitts
    wk.yaw = 0;                     // Blick Richtung Geländemitte (-z)
    wk.pitch = 0;
    wk.keys = {};
    const elev = sampleElev(tr.grid, tr.size, tr.cellM, wk.xM, wk.zM);
    wk.eyeY = ((elev - tr.min) / tr.range) * tr.RELIEF + eyeUnits(tr);
    wk.active = true;
    setWalking(true);
  };

  // --- Begehung beenden: gesicherte Orbit-Pose exakt wiederherstellen --------
  const exitWalk = () => {
    const t = three.current;
    const s = walk.current.saved;
    walk.current.active = false;
    walk.current.on = false;
    walk.current.keys = {};
    if (t.camera && s) {
      drag.current.rotY = s.rotY;
      drag.current.rotX = s.rotX;
      t.camera.rotation.order = "XYZ";
      t.camera.position.copy(s.pos);
      t.camera.quaternion.copy(s.quat);
    }
    setWalking(false);
  };

  // Esc-Handler (Setup-Effect) soll immer die aktuelle exit-Funktion sehen.
  useEffect(() => { walk.current.exitFn = exitWalk; });

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Mountain className="w-4 h-4 text-emerald-600" /> Gelände 3D
            {project?.location?.address && <span className="text-slate-400 font-normal">· {project.location.address}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {loading && <span className="text-slate-400">lädt…</span>}
            {synthetic ? (
              <span className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-medium text-amber-800">
                <WifiOff className="w-3.5 h-3.5" /> Synthetisches Gelände — keine Mengen
              </span>
            ) : (
              <span className="text-emerald-600">Open-Meteo Elevation</span>
            )}
            <span className="text-slate-500">{Math.round(min)}–{Math.round(max)} m ü. NN</span>
            {/* Begehung: Ego-Kamera auf Augenhöhe (WASD + Maus-Drag) */}
            <button
              type="button"
              onClick={() => (walking ? exitWalk() : enterWalk())}
              disabled={!grid || grid.length < 2}
              title={walking ? "Begehung beenden (Esc)" : "Begehung auf Augenhöhe starten"}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 transition-colors disabled:opacity-40 ${walking ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <Footprints className="w-3.5 h-3.5" /> {walking ? "Begehung beenden" : "Begehung"}
            </button>
            {/* Exposé-Bild: aktuelle Ansicht hochauflösend als PNG exportieren */}
            <button
              type="button"
              onClick={() => exportExposePng(three.current)}
              title="Aktuelle Ansicht hochauflösend als PNG exportieren"
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" /> Exposé-Bild
            </button>
          </div>
        </div>

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

        <div className="relative">
          <div ref={mountRef} className="w-full" style={{ height: 480 }} />
          {/* Begehung-Badge mit Kurzanleitung */}
          {walking && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1.5 text-[11px] text-white shadow-lg pointer-events-none whitespace-nowrap">
              WASD bewegen · Maus ziehen: umsehen · Shift: schnell · Esc: beenden
            </div>
          )}
        </div>
        <div className="px-4 py-2 text-xs text-slate-400 border-t">
          {walking ? "Begehung aktiv — Esc oder Button beendet und stellt die Orbit-Ansicht wieder her" : "Ziehen zum Drehen · Höhe 5× überhöht dargestellt"}
        </div>
      </CardContent>
    </Card>
  );
}
