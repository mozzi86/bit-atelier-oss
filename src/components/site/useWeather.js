import { useCallback, useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// Operational thresholds (km/h gusts).
const DRONE_LIMIT = 35;
const CRANE_LIMIT = 50;
const STORM_CODES = [95, 96, 99];

export function deriveRestrictions(w) {
  if (!w) return { droneGround: false, craneStop: false, outdoorWarn: false, reason: "" };
  const gust = w.wind_gusts ?? w.wind_speed ?? 0;
  const storm = STORM_CODES.includes(w.weather_code);
  const droneGround = gust >= DRONE_LIMIT || storm;
  const craneStop = gust >= CRANE_LIMIT || storm;
  const outdoorWarn = (w.precipitation || 0) > 0.5 || storm;
  const reason = storm ? "Gewitter" : gust >= DRONE_LIMIT ? `Wind ${Math.round(gust)} km/h` : "";
  return { droneGround, craneStop, outdoorWarn, reason };
}

export function useWeather(lat, lng) {
  const [fetched, setFetched] = useState(null);
  const [override, setOverride] = useState(null); // manual simulation
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (lat == null || lng == null) return;
    setLoading(true);
    try {
      const r = await bitApi.apiFetch(`${API_BASE}/weather?lat=${lat}&lng=${lng}`);
      setFetched(await r.json());
    } catch {
      /* keep last */
    }
    setLoading(false);
  }, [lat, lng]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const weather = override || fetched;
  return {
    weather,
    restrictions: deriveRestrictions(weather),
    loading,
    refresh,
    override,
    setOverride,
    isSimulated: !!override,
  };
}
