// Render-Modus (BitBimStudio): Fassaden-Presets, Sonnenstand und belebte Stadt
// (Autos/Fußgänger auf OSM-Straßen/-Wegen). Reine three.js-Helfer, kein React.
import * as THREE from "three";

// ---- Fassaden-Presets (MeshStandardMaterial-Parameter für die Hüllwände) ----
export const FACADE_PRESETS = [
  { id: "putz", name: "Putz weiß", color: 0xf5f0e8, roughness: 0.9, metalness: 0.0 },
  { id: "klinker", name: "Klinker", color: 0x9c4a32, roughness: 0.95, metalness: 0.0 },
  { id: "glas", name: "Glasfassade", color: 0x7aa6c2, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.55 },
  { id: "holz", name: "Holz", color: 0xa97c50, roughness: 0.85, metalness: 0.0 },
  { id: "beton", name: "Sichtbeton", color: 0xb0ada6, roughness: 0.8, metalness: 0.0 },
];

export function facadePresetById(id) {
  return FACADE_PRESETS.find((p) => p.id === id) || FACADE_PRESETS[0];
}

// Neues Material für das gewählte Preset (der Rebuild-Effekt disposed Altes selbst).
export function facadeMaterial(id) {
  const p = facadePresetById(id);
  return new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: p.roughness,
    metalness: p.metalness || 0,
    transparent: !!p.transparent,
    opacity: p.opacity != null ? p.opacity : 1,
  });
}

// ---- Sonnenstand: Stunde (0-24) -> Position auf einem Bogen + warme Randfarben ----
// Sichtbarer Bogen 6-18 Uhr (Ost -> West), morgens/abends wärmeres Licht.
export function sunFromHour(hour, radius = 220) {
  const t = Math.max(0, Math.min(1, (hour - 6) / 12)); // 0 = 6 Uhr, 1 = 18 Uhr
  const az = Math.PI * (1 - t); // Azimut: Ost (t=0) -> West (t=1)
  const alt = 0.12 + Math.sin(Math.PI * t) * 1.0; // Höhenwinkel (rad), nie ganz am Horizont
  const pos = {
    x: Math.cos(az) * Math.cos(alt) * radius,
    y: Math.sin(alt) * radius,
    z: Math.abs(Math.sin(az)) * Math.cos(alt) * radius * 0.6 + 40, // leicht von Süden
  };
  const warm = 1 - Math.sin(Math.PI * t); // 1 an den Tagesrändern, 0 mittags
  const color = new THREE.Color(0xfff4e2).lerp(new THREE.Color(0xffb36b), warm * 0.85);
  const intensity = 1.05 + Math.sin(Math.PI * t) * 0.55;
  return { pos, color, intensity };
}

// ---- Polylinien-Helfer (kumulative Segmentlängen, Punkt bei Distanz d) ----
export function polylineLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { cum, total: cum[cum.length - 1] || 0 };
}

export function pointOnPolyline(pts, cum, d) {
  let k = 1;
  while (k < cum.length - 1 && cum[k] < d) k++;
  const a = pts[k - 1], b = pts[k];
  const seg = (cum[k] - cum[k - 1]) || 1;
  const t = Math.max(0, Math.min(1, (d - cum[k - 1]) / seg));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: b.x - a.x, dz: b.z - a.z };
}

// Polylinie seitlich versetzen (z. B. Gehweg am Straßenrand als Fallback).
export function offsetPolyline(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    return { x: p.x + nx * off, z: p.z + nz * off };
  });
}

// ---- Belebte Stadt: einfache Autos + Fußgänger ----
const CAR_COLORS = [0x9aa5b1, 0xb04a3e, 0x44607a, 0xd8d3c6, 0x55694f, 0x32363d, 0x8c6d4f, 0xc2c7cc];
const PED_COLORS = [0x6b7280, 0x9a6a4f, 0x4f6b8a, 0x7a5a78, 0x5f7a5a, 0xa08a5a];

function buildCar(shared, bodyMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(shared.carBody, bodyMat);
  body.position.y = 0.75;
  const top = new THREE.Mesh(shared.carTop, shared.carTopMat);
  top.position.set(-0.3, 1.8, 0);
  g.add(body, top);
  return g;
}

function buildPedestrian(shared, bodyMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(shared.pedBody, bodyMat);
  body.position.y = 0.7;
  const head = new THREE.Mesh(shared.pedHead, shared.pedHeadMat);
  head.position.y = 1.55;
  g.add(body, head);
  return g;
}

/**
 * Baut die "cityLife"-Gruppe: Autos auf den längsten Straßen, Fußgänger auf
 * Wegen (Fallback: Straßenränder). Liefert { group, items, dispose() }.
 * items: [{ mesh, pts, cum, total, d, speed }] für den tick()-Loop.
 */
export function createCityLife(streets, paths, counts = { cars: 16, peds: 16 }) {
  const group = new THREE.Group();
  group.name = "cityLife";
  const items = [];
  const shared = {
    carBody: new THREE.BoxGeometry(4, 1.4, 1.8),
    carTop: new THREE.BoxGeometry(2.0, 0.7, 1.6),
    pedBody: new THREE.CylinderGeometry(0.2, 0.22, 1.4, 8),
    pedHead: new THREE.SphereGeometry(0.17, 8, 6),
    carTopMat: new THREE.MeshStandardMaterial({ color: 0x2d3640, roughness: 0.3, metalness: 0.35 }),
    pedHeadMat: new THREE.MeshStandardMaterial({ color: 0xd9b89a, roughness: 0.9 }),
  };
  const bodyMats = []; // alle Karosserie-/Körper-Materialien für dispose()

  // Polylinien vorbereiten: kumulative Längen EINMAL berechnen, längste zuerst.
  const prepLines = (lines, minLen) => (lines || [])
    .filter((l) => Array.isArray(l?.pts) && l.pts.length >= 2)
    .map((l) => ({ pts: l.pts, width: l.width, ...polylineLengths(l.pts) }))
    .filter((l) => l.total > minLen)
    .sort((a, b) => b.total - a.total);

  const carLines = prepLines(streets, 25).slice(0, 8);
  let pedLines = prepLines(paths, 12).slice(0, 10);
  if (!pedLines.length && carLines.length) {
    // Fallback: Gehweg am Straßenrand (seitlich versetzt)
    pedLines = carLines.map((l) => {
      const pts = offsetPolyline(l.pts, (l.width || 6) / 2 + 0.8);
      return { pts, ...polylineLengths(pts) };
    }).filter((l) => l.total > 10);
  }

  if (carLines.length) {
    for (let i = 0; i < counts.cars; i++) {
      const line = carLines[i % carLines.length];
      const mat = new THREE.MeshStandardMaterial({ color: CAR_COLORS[i % CAR_COLORS.length], roughness: 0.45, metalness: 0.25 });
      bodyMats.push(mat);
      const mesh = buildCar(shared, mat);
      group.add(mesh);
      items.push({ mesh, pts: line.pts, cum: line.cum, total: line.total, d: Math.random() * line.total, speed: 6 + Math.random() * 4 });
    }
  }
  if (pedLines.length) {
    for (let i = 0; i < counts.peds; i++) {
      const line = pedLines[i % pedLines.length];
      const mat = new THREE.MeshStandardMaterial({ color: PED_COLORS[i % PED_COLORS.length], roughness: 0.9 });
      bodyMats.push(mat);
      const mesh = buildPedestrian(shared, mat);
      group.add(mesh);
      items.push({ mesh, pts: line.pts, cum: line.cum, total: line.total, d: Math.random() * line.total, speed: 1.1 + Math.random() * 0.7 });
    }
  }

  const dispose = () => {
    shared.carBody.dispose(); shared.carTop.dispose();
    shared.pedBody.dispose(); shared.pedHead.dispose();
    shared.carTopMat.dispose(); shared.pedHeadMat.dispose();
    bodyMats.forEach((m) => m.dispose());
  };
  return { group, items, dispose };
}

// Bewegung im Renderloop: Distanz fortschreiben, auf Polylinie interpolieren, ausrichten.
export function updateCityLife(items, dt) {
  for (const it of items) {
    if (!it.total) continue;
    it.d = (it.d + it.speed * dt) % it.total;
    const p = pointOnPolyline(it.pts, it.cum, it.d);
    it.mesh.position.set(p.x, 0, p.z);
    if (p.dx || p.dz) it.mesh.rotation.y = -Math.atan2(p.dz, p.dx);
  }
}
