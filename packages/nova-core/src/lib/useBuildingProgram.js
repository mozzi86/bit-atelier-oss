// Gemeinsame Quelle der Wahrheit für das Bauprogramm: Footprint, Geschosse,
// Geschosshöhe und Einheit. Massing-Studio, Gebäudemodell (BIT-BIM), Kennzahlen,
// Raumprogramm, Machbarkeit und Kosten lesen/schreiben hier — „alles ist verbunden".
import { useSyncExternalStore } from "react";

// footprintM: zentriertes Meter-Polygon [{x,z}] oder null (=> Default 20×14).
// zones: gespiegelte Räume aus dem Gebäudemodell [{points:[{x,z}],level,name}].
// costEstimate: Kostenschätzung aus dem Kosten-Tab { total, bgf, perM2 } oder null
//   — wird von der AVA-Kostenkontrolle als Budget-Referenz gelesen.
let state = { footprintM: null, storeys: 4, storeyHeight: 3, unit: "m", zones: [], costEstimate: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export const buildingProgram = {
  get: () => state,
  set: (patch) => { state = { ...state, ...patch }; emit(); },
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
};

export function useBuildingProgram() {
  const s = useSyncExternalStore(buildingProgram.subscribe, buildingProgram.get, buildingProgram.get);
  return { ...s, set: buildingProgram.set };
}

// Rechteck-Footprint (zentriert) aus Breite/Tiefe in Metern.
export function rectFootprint(w, d) {
  const hw = w / 2, hd = d / 2;
  return [{ x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd }];
}

// Bounding-Box (Breite/Tiefe in m) eines Footprint-Polygons.
export function footprintWD(fp) {
  if (!fp || fp.length < 2) return { w: 20, d: 14 };
  const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
}

// Fläche eines (zentrierten) Meter-Polygons [{x,z}] in m² (Shoelace).
export function polygonAreaM(pts) {
  if (!pts || pts.length < 3) return 0;
  return Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
}
// Grundfläche (Footprint) in m²; 0 wenn kein Footprint gesetzt.
export function footprintAreaM(fp) { return polygonAreaM(fp); }

// Abgeleitete Kennzahlen aus dem Bauprogramm — EINE Quelle für Kennzahlen,
// Raumprogramm, Machbarkeit und Kosten. footArea=0 => kein Footprint gesetzt.
export function programMetrics(s) {
  const footArea = footprintAreaM(s?.footprintM);
  const storeys = Math.max(0, Math.round(s?.storeys || 0));
  const storeyHeight = s?.storeyHeight || 3;
  const bgf = footArea * storeys;          // Bruttogrundfläche (alle Geschosse)
  const ngf = bgf * 0.8;                    // Nettogrundfläche ~80 % BGF
  const height = storeys * storeyHeight;    // Gebäudehöhe (m)
  return { footArea, storeys, storeyHeight, bgf, ngf, height };
}

// Einheiten (Längen). Faktor von Metern + Nachkommastellen + Suffix.
export const LENGTH_UNITS = {
  m: { factor: 1, decimals: 2, suffix: "m" },
  cm: { factor: 100, decimals: 0, suffix: "cm" },
  mm: { factor: 1000, decimals: 0, suffix: "mm" },
};
// Meter -> formatierter String in der gewählten Einheit.
export function fmtLen(meters, unit = "m", withSuffix = true) {
  const u = LENGTH_UNITS[unit] || LENGTH_UNITS.m;
  const v = (meters * u.factor).toFixed(u.decimals);
  return withSuffix ? `${v} ${u.suffix}` : v;
}
