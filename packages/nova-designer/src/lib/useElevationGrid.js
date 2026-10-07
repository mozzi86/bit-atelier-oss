import { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// Deterministisches, GLATTES Offline-Heightfield aus lat/lng.
// Nur zwei breite Sinuswellen (1 Periode über das gesamte Raster) → keine Zacken,
// reproduzierbar für denselben Standort, kein Math.random / Date.now.
// `spanKm` skaliert das Relief mit der abgedeckten Fläche, damit ein kleinerer
// Ausschnitt nicht künstlich steiler wird als ein großer (sonst würden feinere
// Abfragen im Offline-Fall überhöhte Erdmassen liefern).
function syntheticGrid(lat, lng, size, spanKm = 1) {
  const base = 100 + ((Math.abs(lat) * 7) % 80);
  const s = spanKm > 0 ? spanKm : 1;
  // Flache Neigung (leichte Hanglage nach Süd-Ost) + zwei sanfte Wellen
  const tiltX = 8 * s;  // m Höhenunterschied über gesamte X-Ausdehnung
  const tiltY = 5 * s;  // m Höhenunterschied über gesamte Y-Ausdehnung
  const grid = [];
  for (let i = 0; i < size; i++) {
    const row = [];
    const u = size > 1 ? i / (size - 1) : 0; // 0…1
    for (let j = 0; j < size; j++) {
      const v = size > 1 ? j / (size - 1) : 0; // 0…1
      const h =
        base +
        tiltX * u +
        tiltY * v +
        6 * s * Math.sin(u * Math.PI + lat) +  // 1 sanfte Welle in Längsrichtung
        4 * s * Math.cos(v * Math.PI + lng);   // 1 sanfte Welle in Querrichtung
      row.push(Math.round(h * 10) / 10);
    }
    grid.push(row);
  }
  return grid;
}

// --- Herkunft von Höhenpunkten (Topografie) ---------------------------------
// Belegte Quellen: Werte, die aus einer Vermessung, einem amtlichen DGM oder
// einem Datenimport stammen. Alles andere (insbesondere im Werkzeug erzeugte
// Demo-/Platzhalterpunkte) gilt als SYNTHETISCH — bewusst als Whitelist, damit
// nicht gekennzeichnete Punkte niemals als belegt durchgehen.
export const SURVEYED_TOPO_SOURCES = ["vermessung", "survey", "dgm", "kataster", "import", "ifc", "gnss"];

export function isSurveyedTopoPoint(p) {
  if (!p || typeof p !== "object") return false;
  if (p.measured === true || p.vermessen === true) return true;
  const src = typeof p.source === "string" ? p.source.toLowerCase() : "";
  return SURVEYED_TOPO_SOURCES.includes(src);
}

/**
 * Herkunft einer Punktwolke aus `project.topography.elevation_points`.
 * Liefert { count, surveyedCount, surveyed } — `surveyed` nur dann true,
 * wenn ALLE vorhandenen Punkte eine belegte Quelle tragen.
 */
export function topoProvenance(points) {
  const pts = Array.isArray(points) ? points : [];
  const surveyedCount = pts.filter(isSurveyedTopoPoint).length;
  return { count: pts.length, surveyedCount, surveyed: pts.length > 0 && surveyedCount === pts.length };
}

// Native Rasterweite der Höhenquelle hinter Open-Meteo Elevation
// (Copernicus DEM GLO-90). Empirisch bestätigt: Abfragen im Abstand von ~15 m
// liefern identische Werte, im Abstand von ~100 m unterschiedliche. Feiner als
// dieser Wert abzutasten erzeugt KEINE zusätzliche Information.
export const DEM_RESOLUTION_M = 90;

function stats(grid) {
  let min = Infinity, max = -Infinity;
  grid.forEach((r) => r.forEach((v) => { if (v < min) min = v; if (v > max) max = v; }));
  return { min, max };
}

/**
 * Höhenraster (size×size) über ~spanKm km um {lat,lng}.
 * Liefert { grid, min, max, offline, loading }. Bei fehlendem Netz deterministischer Fallback.
 */
export function useElevationGrid(location, size = 10, spanKm = 1) {
  const lat = location?.lat;
  const lng = location?.lng;
  const [state, setState] = useState({ grid: [], min: 0, max: 0, offline: false, loading: false });

  useEffect(() => {
    if (lat == null || lng == null) {
      const g = syntheticGrid(49.45, 11.08, size, spanKm);
      setState({ grid: g, ...stats(g), offline: true, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    const dLat = (spanKm / 111) ;                 // ~km → deg lat
    const dLng = spanKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
    const lats = [], lngs = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        lats.push((lat - dLat / 2 + (dLat * i) / (size - 1)).toFixed(5));
        lngs.push((lng - dLng / 2 + (dLng * j) / (size - 1)).toFixed(5));
      }
    }

    (async () => {
      try {
        const r = await bitApi.apiFetch(`${API_BASE}/elevation?lat=${lats.join(",")}&lng=${lngs.join(",")}`);
        const d = await r.json();
        if (cancelled) return;
        if (d.offline || !Array.isArray(d.elevation) || d.elevation.length !== size * size) {
          const g = syntheticGrid(lat, lng, size, spanKm);
          setState({ grid: g, ...stats(g), offline: true, loading: false });
          return;
        }
        const grid = [];
        for (let i = 0; i < size; i++) grid.push(d.elevation.slice(i * size, (i + 1) * size));
        setState({ grid, ...stats(grid), offline: false, loading: false });
      } catch {
        if (cancelled) return;
        const g = syntheticGrid(lat, lng, size, spanKm);
        setState({ grid: g, ...stats(g), offline: true, loading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [lat, lng, size, spanKm]);

  return state;
}
