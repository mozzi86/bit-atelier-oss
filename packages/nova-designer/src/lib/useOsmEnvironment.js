import { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// Straßenbreite in Metern nach OSM-highway-Klasse
const STREET_WIDTHS = {
  motorway: 12,
  trunk: 12,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  residential: 5.5,
  unclassified: 5.5,
  living_street: 5.5,
  service: 4,
};

const EMPTY = { streets: [], paths: [], trees: [], greens: [], offline: false, loading: false };

/**
 * Echte OSM-Umgebungsdaten (Straßen, Gehwege, Bäume, Grünflächen) um {lat,lng},
 * umgerechnet in lokale Meter relativ zum Standort-Mittelpunkt.
 * Liefert { streets:[{pts:[{x,z}],width,kind}], paths:[{pts,width,kind}],
 *           trees:[{x,z}], greens:[[{x,z}]], offline, loading }.
 */
export function useOsmEnvironment(location, radius = 300) {
  const lat = location?.lat;
  const lng = location?.lng;
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (lat == null || lng == null) { setState(EMPTY); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    // Umrechnung Grad -> lokale Meter (wie useOsmBuildings)
    const mPerLat = 111320;
    const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
    const toLocal = (c) => ({
      x: (c.lon - lng) * mPerLon,
      z: -(c.lat - lat) * mPerLat,
    });

    (async () => {
      try {
        const r = await bitApi.apiFetch(`${API_BASE}/osm-environment?lat=${lat}&lng=${lng}&radius=${radius}`);
        const d = await r.json();
        if (cancelled) return;
        if (d.offline) {
          setState({ ...EMPTY, offline: true });
          return;
        }
        // Straßen: Linienzüge mit Breite je Klasse
        const streets = (Array.isArray(d.streets) ? d.streets : [])
          .map((s) => ({
            pts: (s.coords || []).map(toLocal),
            width: STREET_WIDTHS[s.kind] || 5.5,
            kind: s.kind,
          }))
          .filter((s) => s.pts.length >= 2);
        // Gehwege/Pfade: feste Breite 1,8 m
        const paths = (Array.isArray(d.paths) ? d.paths : [])
          .map((p) => ({
            pts: (p.coords || []).map(toLocal),
            width: 1.8,
            kind: p.kind,
          }))
          .filter((p) => p.pts.length >= 2);
        // Einzelbäume als Punkte
        const trees = (Array.isArray(d.trees) ? d.trees : [])
          .filter((t) => t.lat != null && t.lon != null)
          .map(toLocal);
        // Grünflächen als Polygone (>= 3 Punkte)
        const greens = (Array.isArray(d.greens) ? d.greens : [])
          .map((g) => (g.coords || []).map(toLocal))
          .filter((g) => g.length >= 3);
        setState({ streets, paths, trees, greens, offline: false, loading: false });
      } catch {
        if (!cancelled) setState({ ...EMPTY, offline: true });
      }
    })();

    return () => { cancelled = true; };
  }, [lat, lng, radius]);

  return state;
}
