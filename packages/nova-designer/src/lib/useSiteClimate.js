import { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Deterministischer Offline-Fallback (breitengrad-abhängige Sinuskurve, kein Zufall).
// Seit Phase 45 auch tMax/tMin (±5 K um das Monatsmittel) und Globalstrahlung
// (kWh/m² je Monat, Sommer-Peak) — dieselben Felder wie der /climate-Proxy.
function syntheticMonths(lat) {
  const base = 24 - Math.abs(lat) * 0.35;
  const amp = 8 + Math.abs(lat) * 0.12;
  return MONTHS_DE.map((m, i) => {
    const temp = +(base + amp * Math.sin(((i - 3) / 12) * 2 * Math.PI)).toFixed(1);
    return {
      month: m,
      temp,
      tMax: +(temp + 5).toFixed(1),
      tMin: +(temp - 5).toFixed(1),
      precip: Math.round(45 + 30 * Math.cos(((i - 6) / 12) * 2 * Math.PI) + (i % 3) * 5),
      rad: Math.max(10, Math.round(95 + 80 * Math.sin(((i - 3) / 12) * 2 * Math.PI) - Math.abs(lat))),
    };
  });
}

/**
 * Klima-Normalen + Geländehöhe für einen Standort {lat,lng} aus echten
 * Open-Meteo-Daten (Archive-Mehrjahresmittel + Elevation, via Backend-Proxy,
 * kein Key). Liefert
 *   { months:[{month,temp,tMax,tMin,precip,rad}×12], annualPrecip, annualRad,
 *     avgTemp, elevation, years, offline, loading }.
 * temp/tMax/tMin = Monatsmittel (°C, tMax/tMin über die Tageswerte gemittelt),
 * precip = mm/Monat, rad = Globalstrahlung kWh/m² je Monat.
 * Offline/Fehler → deterministischer Fallback, offline:true.
 */
// Modul-Cache je Koordinate (nur echte Online-Ergebnisse): 4 Reiter nutzen den
// Hook je Mount — ohne Cache refetcht jeder Tab-Wechsel und flackert kurz in
// den Offline-Fallback. Die Archivdaten 2019–2023 sind statisch.
const climateCache = new Map();

export function useSiteClimate(location) {
  const lat = location?.lat;
  const lng = location?.lng;
  const [state, setState] = useState({
    months: [], annualPrecip: 0, annualRad: 0, avgTemp: 0, elevation: null, years: null, offline: true, loading: false,
  });

  useEffect(() => {
    const la = lat ?? 49.45, ln = lng ?? 11.08;
    const cacheKey = `${la},${ln}`;
    if (climateCache.has(cacheKey)) {
      setState(climateCache.get(cacheKey));
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    const finish = (months, offline, elevation, years) => {
      if (cancelled) return;
      const valid = months.filter((m) => typeof m.temp === "number");
      const avgTemp = valid.length ? +(valid.reduce((s, m) => s + m.temp, 0) / valid.length).toFixed(1) : 0;
      const annualPrecip = months.reduce((s, m) => s + (m.precip || 0), 0);
      const annualRad = months.reduce((s, m) => s + (m.rad || 0), 0);
      const result = { months, annualPrecip, annualRad, avgTemp, elevation, years, offline, loading: false };
      if (!offline) climateCache.set(cacheKey, result);
      setState(result);
    };

    (async () => {
      let elevation = null;
      try {
        const re = await bitApi.apiFetch(`${API_BASE}/elevation?lat=${la}&lng=${ln}`);
        const de = await re.json();
        if (!de.offline && Array.isArray(de.elevation) && de.elevation.length) elevation = de.elevation[0];
      } catch { /* Höhe optional — Klima läuft auch ohne */ }
      try {
        const r = await bitApi.apiFetch(`${API_BASE}/climate?lat=${la}&lng=${ln}`);
        const d = await r.json();
        if (d.offline || !Array.isArray(d.months) || d.months.length !== 12) {
          finish(syntheticMonths(la), true, elevation, null);
          return;
        }
        finish(
          d.months.map((m, i) => ({
            month: MONTHS_DE[i], temp: m.temp, tMax: m.tMax ?? null, tMin: m.tMin ?? null,
            precip: m.precip, rad: m.rad ?? null,
          })),
          false, elevation, d.years || null,
        );
      } catch {
        finish(syntheticMonths(la), true, elevation, null);
      }
    })();

    return () => { cancelled = true; };
  }, [lat, lng]);

  return state;
}
