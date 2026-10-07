// supabase/functions/geo/index.ts — geo/climate/OSM proxies as an Edge Function
// (Phase 57-04, Task 3). Port of packages/nova-designer/server/routes.js
// WITHOUT archicad (stays local/Express — must-have #5).
//
// GET ?dienst=weather|elevation|climate|osm-buildings|osm-environment
//     &lat=&lng=&radius=   (parameter names as today; `lon` accepted as an
//     alias for `lng` per the 57-04 plan interface)
//
// Response shapes are UNCHANGED from the Express routes so the consuming hooks
// (useWeather, useElevationGrid, useSiteClimate, useOsmBuildings,
// useOsmEnvironment) need no branch on the data path. Offline convention
// unchanged too: always 200 with the route's own fallback payload — except
// auth failures (401/403), which are the ONE new failure mode the Express
// routes never had (must-have: anonymous calls → 401).
//
// Coordinate sanitizer (ME-07) ported 1:1: lat/lng NEVER go raw into outbound
// URLs (query-parameter injection), single value or comma-separated list.
//
// Deno notes: no node: imports; AbortSignal.timeout is standard in Deno.

import { nutzerAusRequest } from "../_shared/auth.ts";
import { optionsAntwort, jsonAntwort, fehlerAntwort } from "../_shared/cors.ts";

// --- Coordinate sanitizer (designer/routes.js:8-19, ME-07) -------------------

/** Clamps one coordinate into [min,max]; non-finite → fallback. */
function cleanCoord(v: string | null, fallback: number, min: number, max: number): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Clamps a comma-separated coordinate list (elevation grids). */
function cleanCoordList(v: string | null, fallback: string, min: number, max: number): string {
  const parts = String(v ?? "")
    .split(",")
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.min(max, Math.max(min, n)));
  return parts.length ? parts.join(",") : String(fallback);
}

// --- Weather (Open-Meteo, no API key) with offline fallback ------------------
const WMO: Record<number, string> = {
  0: "Klar", 1: "Heiter", 2: "Wolkig", 3: "Bedeckt", 45: "Nebel", 48: "Reifnebel",
  51: "Niesel", 61: "Regen", 63: "Regen", 65: "Starkregen", 71: "Schnee", 80: "Schauer",
  95: "Gewitter", 96: "Gewitter (Hagel)", 99: "Schweres Gewitter",
};

/** GET /weather — routes.js:31-61. Fallback keeps the UI usable offline. */
async function weather(q: URLSearchParams): Promise<unknown> {
  const lat = cleanCoord(q.get("lat"), 49.45, -90, 90);
  const lng = cleanCoord(q.get("lng") ?? q.get("lon"), 11.08, -180, 180);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
    // deno-lint-ignore no-explicit-any
    const d = await resp.json() as any;
    const c = d.current || {};
    return {
      source: "open-meteo",
      temperature: c.temperature_2m,
      precipitation: c.precipitation,
      wind_speed: c.wind_speed_10m,
      wind_gusts: c.wind_gusts_10m,
      weather_code: c.weather_code,
      condition: WMO[c.weather_code as number] || "—",
    };
  } catch {
    // Deterministic-ish offline fallback so the UI still works (routes.js:50).
    return {
      source: "fallback",
      temperature: 14,
      precipitation: 0,
      wind_speed: 18,
      wind_gusts: 28,
      weather_code: 2,
      condition: "Wolkig (offline)",
    };
  }
}

// --- Terrain elevation (Open-Meteo Elevation API, no key) ---------------------
/** GET /elevation — routes.js:65-78. Single point or comma-separated grids. */
async function elevation(q: URLSearchParams): Promise<unknown> {
  const lat = cleanCoordList(q.get("lat"), "49.45", -90, 90);
  const lng = cleanCoordList(q.get("lng") ?? q.get("lon"), "11.08", -180, 180);
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) throw new Error(`open-meteo elevation ${resp.status}`);
    // deno-lint-ignore no-explicit-any
    const d = await resp.json() as any;
    const elevationArr = Array.isArray(d.elevation) ? d.elevation : [];
    return { source: "open-meteo", elevation: elevationArr };
  } catch {
    return { offline: true, elevation: [] };
  }
}

// --- Klima-Normalen (Open-Meteo Archive API, no key) ---------------------------
// Multi-year monthly means (Phase 45, KLIMA-01): temp mean/max/min, precip sum,
// shortwave radiation (MJ/m²/day → kWh/m²/month via /3.6). Max/min are MONTHLY
// MEANS of daily values (not absolutes) — matches DIN 4108-2 climate regions.
const CLIMATE_YEARS = { from: 2019, to: 2023 };

// In-memory cache per coordinate: the 2019–2023 archive is static and
// useSiteClimate is called by 4 tabs per mount. On Edge Functions the cache
// lives per isolate — warm while the isolate is warm, cold after evictions.
// That is strictly worse than the Express process cache but never WRONG
// (payloads are deterministic); no cache for offline fallbacks, as before.
const climateCache = new Map<string, unknown>();

/** GET /climate — routes.js:93-142. */
async function climate(q: URLSearchParams): Promise<unknown> {
  const lat = cleanCoord(q.get("lat"), 49.45, -90, 90);
  const lng = cleanCoord(q.get("lng") ?? q.get("lon"), 11.08, -180, 180);
  const cacheKey = `${lat},${lng}`;
  if (climateCache.has(cacheKey)) return climateCache.get(cacheKey);
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${CLIMATE_YEARS.from}-01-01&end_date=${CLIMATE_YEARS.to}-12-31&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum&timezone=UTC`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`open-meteo archive ${resp.status}`);
    // deno-lint-ignore no-explicit-any
    const d = await resp.json() as any;
    const days: string[] = d.daily?.time || [];
    const temps: number[] = d.daily?.temperature_2m_mean || [];
    const tmax: number[] = d.daily?.temperature_2m_max || [];
    const tmin: number[] = d.daily?.temperature_2m_min || [];
    const prec: number[] = d.daily?.precipitation_sum || [];
    const rad: number[] = d.daily?.shortwave_radiation_sum || [];
    if (!days.length) throw new Error("empty climate response");
    const nYears = CLIMATE_YEARS.to - CLIMATE_YEARS.from + 1;
    // Daily values → 12 monthly values over all years (sums averaged per year)
    const months = Array.from({ length: 12 }, () => ({
      tSum: 0, tCount: 0, maxSum: 0, maxCount: 0, minSum: 0, minCount: 0, pSum: 0, rSum: 0,
    }));
    days.forEach((iso, i) => {
      const m = parseInt(iso.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) return;
      if (typeof temps[i] === "number") { months[m].tSum += temps[i]; months[m].tCount++; }
      if (typeof tmax[i] === "number") { months[m].maxSum += tmax[i]; months[m].maxCount++; }
      if (typeof tmin[i] === "number") { months[m].minSum += tmin[i]; months[m].minCount++; }
      if (typeof prec[i] === "number") months[m].pSum += prec[i];
      if (typeof rad[i] === "number") months[m].rSum += rad[i];
    });
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const payload = {
      source: "open-meteo",
      years: `${CLIMATE_YEARS.from}–${CLIMATE_YEARS.to}`,
      months: months.map((m, i) => ({
        month: i + 1,
        temp: m.tCount ? r1(m.tSum / m.tCount) : null,
        tMax: m.maxCount ? r1(m.maxSum / m.maxCount) : null,
        tMin: m.minCount ? r1(m.minSum / m.minCount) : null,
        precip: Math.round(m.pSum / nYears),
        rad: Math.round(m.rSum / 3.6 / nYears), // kWh/m² per month
      })),
    };
    climateCache.set(cacheKey, payload);
    return payload;
  } catch {
    return { offline: true, months: [] };
  }
}

// --- OSM building footprints (Overpass API, no key) ---------------------------
/** Overpass rejects requests without a sane User-Agent/Accept with 406. */
const OVERPASS_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "BIT-Atelier/1.0 (local AEC dev tool)",
  "Accept": "application/json",
};

/** One Overpass query → parsed JSON; throws on !ok/timeout. */
async function overpass(query: string, timeoutMs: number): Promise<{ elements?: Array<Record<string, unknown>> }> {
  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: OVERPASS_HEADERS,
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`overpass ${resp.status}`);
  // deno-lint-ignore no-explicit-any
  return await resp.json() as any;
}

/** GET /osm-buildings — routes.js:204-235. */
async function osmBuildings(q: URLSearchParams): Promise<unknown> {
  const lat = cleanCoord(q.get("lat"), 50.12, -90, 90);
  const lng = cleanCoord(q.get("lng") ?? q.get("lon"), 8.65, -180, 180);
  const radius = Math.min(800, parseInt(q.get("radius") ?? "350", 10) || 350);
  const query = `[out:json][timeout:25];(way["building"](around:${radius},${lat},${lng}););out geom 250;`;
  try {
    const d = await overpass(query, 30000);
    // deno-lint-ignore no-explicit-any
    const buildings = (d.elements || []).filter((e: any) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 3)
      // deno-lint-ignore no-explicit-any
      .map((e: any) => {
        // deno-lint-ignore no-explicit-any
        const t = (e.tags || {}) as any;
        const levels = parseFloat(t["building:levels"]) || null;
        const height = parseFloat(t.height) || (levels ? levels * 3 : null);
        // deno-lint-ignore no-explicit-any
        return { coords: e.geometry.map((g: any) => ({ lat: g.lat, lon: g.lon })), height, levels };
      });
    return { source: "overpass", center: { lat, lng }, buildings };
  } catch {
    return { offline: true, center: { lat, lng }, buildings: [] };
  }
}

/** GET /osm-environment — routes.js:240-295. */
async function osmEnvironment(q: URLSearchParams): Promise<unknown> {
  const lat = cleanCoord(q.get("lat"), 50.12, -90, 90);
  const lng = cleanCoord(q.get("lng") ?? q.get("lon"), 8.65, -180, 180);
  const radius = Math.min(800, parseInt(q.get("radius") ?? "300", 10) || 300);
  const STREET_KINDS = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service", "living_street"];
  const PATH_KINDS = ["footway", "path", "cycleway", "pedestrian"];
  const query = `[out:json][timeout:10];(
  way(around:${radius},${lat},${lng})["highway"~"^(${STREET_KINDS.join("|")})$"];
  way(around:${radius},${lat},${lng})["highway"~"^(${PATH_KINDS.join("|")})$"];
  node(around:${radius},${lat},${lng})["natural"="tree"];
  way(around:${radius},${lat},${lng})["landuse"~"^(grass|meadow|village_green)$"];
  way(around:${radius},${lat},${lng})["leisure"~"^(park|garden|playground)$"];
);out geom;`;
  try {
    const d = await overpass(query, 10000);
    const streets: Array<{ coords: unknown; kind: string }> = [];
    const paths: Array<{ coords: unknown; kind: string }> = [];
    const trees: Array<{ lat: number; lon: number }> = [];
    const greens: Array<{ coords: unknown }> = [];
    // deno-lint-ignore no-explicit-any
    for (const e of (d.elements || []) as any[]) {
      if (e.type === "node") {
        // A single tree as a point
        if ((e.tags || {}).natural === "tree" && e.lat != null && e.lon != null) {
          trees.push({ lat: e.lat, lon: e.lon });
        }
        continue;
      }
      if (e.type !== "way" || !Array.isArray(e.geometry)) continue;
      const t = e.tags || {};
      // deno-lint-ignore no-explicit-any
      const coords = e.geometry.map((g: any) => ({ lat: g.lat, lon: g.lon }));
      if (t.highway && STREET_KINDS.includes(t.highway) && coords.length >= 2) {
        streets.push({ coords, kind: t.highway });
      } else if (t.highway && PATH_KINDS.includes(t.highway) && coords.length >= 2) {
        paths.push({ coords, kind: t.highway });
      } else if ((t.landuse || t.leisure) && coords.length >= 3) {
        // Green areas only as closed polygons (>= 3 points)
        greens.push({ coords });
      }
    }
    return { source: "osm", center: { lat, lng }, streets, paths, trees, greens };
  } catch {
    return { offline: true, streets: [], paths: [], trees: [], greens: [] };
  }
}

// --- Handler ------------------------------------------------------------------

/** The five services — archicad deliberately absent (stays local, Task 3). */
const DIENSTE: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  weather,
  elevation,
  climate,
  "osm-buildings": osmBuildings,
  "osm-environment": osmEnvironment,
};

/**
 * Entry point. GET only (the Express routes are GET); OPTIONS → preflight.
 * Auth FIRST (must-have: anonymous → 401), then dispatch on ?dienst=.
 */
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return optionsAntwort(req);
  try {
    if (req.method !== "GET") {
      const err = new Error("Nur GET unterstützt") as Error & { status: number };
      err.status = 405;
      throw err;
    }
    const url = new URL(req.url);
    const dienst = url.searchParams.get("dienst") || "";
    const handler = DIENSTE[dienst];
    if (!handler) {
      const err = new Error(
        `Unbekannter Dienst: ${dienst || "(leer)"} — verfügbar: ${Object.keys(DIENSTE).join(", ")}`,
      ) as Error & { status: number };
      err.status = 400;
      throw err;
    }
    // Valid user JWT + membership required — geo data is org work data
    // (project coordinates leak through the weather panel otherwise).
    await nutzerAusRequest(req);
    return jsonAntwort(req, await handler(url.searchParams));
  } catch (err) {
    return fehlerAntwort(req, err, "geo");
  }
});
