import { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

/**
 * Echte OSM-Gebäude-Grundrisse um {lat,lng}, umgerechnet in lokale Meter
 * relativ zum Standort-Mittelpunkt. Liefert { buildings:[{points:[{x,z}],height}],
 * rawBuildings (unveränderte Overpass-Daten mit lat/lon-coords), offline, loading }.
 */
export function useOsmBuildings(location, radius = 350) {
  const lat = location?.lat;
  const lng = location?.lng;
  const [state, setState] = useState({ buildings: [], rawBuildings: [], offline: false, loading: false });

  useEffect(() => {
    if (lat == null || lng == null) { setState({ buildings: [], rawBuildings: [], offline: false, loading: false }); return; }
    // Debounce (HI-02): beim Tippen einer Koordinate oder Marker-Drag entsteht
    // sonst pro Tastendruck ein Overpass-Request (30 s Timeout serverseitig,
    // Rate-Limit-Risiko). Erst nach ~500 ms Ruhe feuern; laufende Requests
    // werden per AbortController abgebrochen.
    let cancelled = false;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));

    const mPerLat = 111320;
    const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);

    const timer = setTimeout(async () => {
      try {
        const r = await bitApi.apiFetch(
          `${API_BASE}/osm-buildings?lat=${lat}&lng=${lng}&radius=${radius}`,
          { signal: controller.signal },
        );
        const d = await r.json();
        if (cancelled) return;
        if (d.offline || !Array.isArray(d.buildings)) {
          setState({ buildings: [], rawBuildings: [], offline: true, loading: false });
          return;
        }
        const buildings = d.buildings.map((b) => ({
          points: b.coords.map((c) => ({
            x: (c.lon - lng) * mPerLon,
            z: -(c.lat - lat) * mPerLat,
          })),
          height: b.height || (b.levels ? b.levels * 3 : 9),
        })).filter((b) => b.points.length >= 3);
        setState({ buildings, rawBuildings: d.buildings, offline: false, loading: false });
      } catch (err) {
        // Abbruch durch neuere Koordinate ist kein Offline-Zustand.
        if (!cancelled && err?.name !== "AbortError") {
          setState({ buildings: [], rawBuildings: [], offline: true, loading: false });
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [lat, lng, radius]);

  return state;
}
