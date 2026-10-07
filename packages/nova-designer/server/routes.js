// nova-designer Server-Routen: Geo-/Klima-/OSM-Proxies (Open-Meteo, Overpass).
// Extrahiert 1:1 aus server/index.js (Phase 31). Pfade OHNE /api-Präfix.
import express from 'express';

// --- Koordinaten-Sanitizer (ME-07) ------------------------------------------
// lat/lng NIE roh in Outbound-URLs interpolieren (Query-Parameter-Injection,
// z. B. ?lat=49%26daily=...). Einzelwert bzw. kommaseparierte Liste (Elevation-Grid).
const cleanCoord = (v, fallback, min, max) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanCoordList = (v, fallback, min, max) => {
  const parts = String(v ?? "")
    .split(",")
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.min(max, Math.max(min, n)));
  return parts.length ? parts.join(",") : String(fallback);
};

// --- Weather (Open-Meteo, no API key) with offline fallback ----------------
const WMO = {
  0: "Klar", 1: "Heiter", 2: "Wolkig", 3: "Bedeckt", 45: "Nebel", 48: "Reifnebel",
  51: "Niesel", 61: "Regen", 63: "Regen", 65: "Starkregen", 71: "Schnee", 80: "Schauer",
  95: "Gewitter", 96: "Gewitter (Hagel)", 99: "Schweres Gewitter",
};

export function geoRouter() {
  const r = express.Router();

  r.get("/weather", async (req, res) => {
    const lat = cleanCoord(req.query.lat, 49.45, -90, 90);
    const lng = cleanCoord(req.query.lng, 11.08, -180, 180);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
      const d = await resp.json();
      const c = d.current || {};
      res.json({
        source: "open-meteo",
        temperature: c.temperature_2m,
        precipitation: c.precipitation,
        wind_speed: c.wind_speed_10m,
        wind_gusts: c.wind_gusts_10m,
        weather_code: c.weather_code,
        condition: WMO[c.weather_code] || "—",
      });
    } catch {
      // Deterministic-ish offline fallback so the UI still works.
      res.json({
        source: "fallback",
        temperature: 14,
        precipitation: 0,
        wind_speed: 18,
        wind_gusts: 28,
        weather_code: 2,
        condition: "Wolkig (offline)",
      });
    }
  });

  // --- Terrain elevation (Open-Meteo Elevation API, no key) -------------------
  // Accepts single point (lat,lng) or grids via comma-separated lists.
  r.get("/elevation", async (req, res) => {
    const lat = cleanCoordList(req.query.lat, "49.45", -90, 90);
    const lng = cleanCoordList(req.query.lng, "11.08", -180, 180);
    try {
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!resp.ok) throw new Error(`open-meteo elevation ${resp.status}`);
      const d = await resp.json();
      const elevation = Array.isArray(d.elevation) ? d.elevation : [];
      res.json({ source: "open-meteo", elevation });
    } catch {
      res.json({ offline: true, elevation: [] });
    }
  });

  // --- Klima-Normalen (Open-Meteo Archive API, no key) ------------------------
  // Mehrjahres-Monatsmittel (Phase 45, KLIMA-01) statt fix 2023: Temperatur-
  // Mittel/Max/Min, Niederschlags-Summe und Globalstrahlung (kWh/m² je Monat,
  // shortwave_radiation_sum liefert MJ/m² je Tag -> /3,6). Max/Min sind
  // MONATSMITTEL der Tageswerte (nicht Absolutwerte) — passend zur
  // Klimaregion-Definition der DIN 4108-2 (mittlere Monatstemperatur).
  // Fehler/Offline -> 200 { offline:true }.
  const CLIMATE_YEARS = { from: 2019, to: 2023 };
  // In-Memory-Cache je Koordinate: das Archiv 2019–2023 ist statisch, und
  // useSiteClimate wird von 4 Reitern je Mount aufgerufen — ohne Cache löst
  // jeder Tab-Wechsel eine neue 5-Jahres-Abfrage (~9.100 Tageswerte) aus.
  // Nur Erfolgsantworten cachen, Offline-Fallback nie.
  const climateCache = new Map();
  r.get("/climate", async (req, res) => {
    const lat = cleanCoord(req.query.lat, 49.45, -90, 90);
    const lng = cleanCoord(req.query.lng, 11.08, -180, 180);
    const cacheKey = `${lat},${lng}`;
    if (climateCache.has(cacheKey)) return res.json(climateCache.get(cacheKey));
    try {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${CLIMATE_YEARS.from}-01-01&end_date=${CLIMATE_YEARS.to}-12-31&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum&timezone=UTC`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`open-meteo archive ${resp.status}`);
      const d = await resp.json();
      const days = d.daily?.time || [];
      const temps = d.daily?.temperature_2m_mean || [];
      const tmax = d.daily?.temperature_2m_max || [];
      const tmin = d.daily?.temperature_2m_min || [];
      const prec = d.daily?.precipitation_sum || [];
      const rad = d.daily?.shortwave_radiation_sum || [];
      if (!days.length) throw new Error("empty climate response");
      const nYears = CLIMATE_YEARS.to - CLIMATE_YEARS.from + 1;
      // Tageswerte -> 12 Monatswerte über alle Jahre (Summen je Jahr gemittelt)
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
      const r1 = (v) => Math.round(v * 10) / 10;
      const payload = {
        source: "open-meteo",
        years: `${CLIMATE_YEARS.from}–${CLIMATE_YEARS.to}`,
        months: months.map((m, i) => ({
          month: i + 1,
          temp: m.tCount ? r1(m.tSum / m.tCount) : null,
          tMax: m.maxCount ? r1(m.maxSum / m.maxCount) : null,
          tMin: m.minCount ? r1(m.minSum / m.minCount) : null,
          precip: Math.round(m.pSum / nYears),
          rad: Math.round(m.rSum / 3.6 / nYears), // kWh/m² je Monat
        })),
      };
      climateCache.set(cacheKey, payload);
      res.json(payload);
    } catch {
      res.json({ offline: true, months: [] });
    }
  });

  // --- Archicad-Status (Tapir-Add-on, quick 260731-arc) ----------------------
  // Probt die lokale Archicad-JSON-API (http://127.0.0.1:<port>, Default 19723).
  // NUR localhost — kein fremder Host zulässig. Offline-Konvention: IMMER HTTP 200,
  // bei Nichterreichbarkeit { connected:false, offline:true }. Nur Reads (Produktinfo,
  // Tapir-Add-on-Version) — keine Schreiboperationen Richtung Archicad.
  r.get("/archicad/status", async (req, res) => {
    const p = parseInt(req.query.port ?? "19723", 10);
    const port = Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 19723;
    const url = `http://127.0.0.1:${port}`;
    const post = async (body, timeoutMs = 3000) => {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) throw new Error(`archicad ${resp.status}`);
      return resp.json();
    };
    try {
      // 1) Produktinfo (Basis-API, ohne Add-on)
      const info = await post({ command: "API.GetProductInfo" });
      const v = info?.result?.version ?? null;
      const build = info?.result?.buildNumber ?? null;
      const out = {
        connected: true,
        product: v ? `Archicad ${v}` : "Archicad",
        version: v,
        build,
        port,
      };
      // Archicad antwortet auch ohne offenes Projekt (succeeded:false, Code 4001) —
      // Prozess erreichbar, aber keine Produktinfo abrufbar. Hinweis mitgeben.
      if (info?.succeeded === false) {
        out.hinweis = info?.error?.message || "Archicad erreichbar, aber keine Antwort (Projekt geöffnet?)";
      }
      // 2) Tapir-Add-on (Namespace „TapirCommand", Singular!)
      try {
        const tapir = await post({
          command: "API.ExecuteAddOnCommand",
          parameters: {
            addOnCommandId: { commandNamespace: "TapirCommand", commandName: "GetAddOnVersion" },
            addOnCommandParameters: {},
          },
        });
        const tv = tapir?.result?.addOnCommandResponse?.version ?? null;
        out.tapir = tapir?.succeeded === false || tv == null
          ? { verfuegbar: false }
          : { verfuegbar: true, version: tv };
      } catch {
        out.tapir = { verfuegbar: false };
      }
      res.json(out);
    } catch {
      res.json({ connected: false, offline: true, port });
    }
  });

  // --- OSM building footprints (Overpass API, no key) -------------------------
  // Liefert echte Gebäude-Grundrisse um einen Punkt für das 3D-Stadtmodell.
  r.get("/osm-buildings", async (req, res) => {
    const lat = cleanCoord(req.query.lat, 50.12, -90, 90);
    const lng = cleanCoord(req.query.lng, 8.65, -180, 180);
    const radius = Math.min(800, parseInt(req.query.radius ?? "350", 10) || 350);
    const query = `[out:json][timeout:25];(way["building"](around:${radius},${lat},${lng}););out geom 250;`;
    try {
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass weist Anfragen ohne sinnvollen User-Agent/Accept mit 406 ab.
          "User-Agent": "BIT-Atelier/1.0 (local AEC dev tool)",
          "Accept": "application/json",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`overpass ${resp.status}`);
      const d = await resp.json();
      const buildings = (d.elements || [])
        .filter((e) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 3)
        .map((e) => {
          const t = e.tags || {};
          const levels = parseFloat(t["building:levels"]) || null;
          const height = parseFloat(t.height) || (levels ? levels * 3 : null);
          return { coords: e.geometry.map((g) => ({ lat: g.lat, lon: g.lon })), height, levels };
        });
      res.json({ source: "overpass", center: { lat, lng }, buildings });
    } catch {
      res.json({ offline: true, center: { lat, lng }, buildings: [] });
    }
  });

  // --- OSM environment (Overpass API, no key) ---------------------------------
  // Liefert Strassen, Gehwege, Baeume und Gruenflaechen um einen Punkt
  // fuer die Umgebungsdarstellung im 3D-Stadtmodell.
  r.get("/osm-environment", async (req, res) => {
    const lat = cleanCoord(req.query.lat, 50.12, -90, 90);
    const lng = cleanCoord(req.query.lng, 8.65, -180, 180);
    const radius = Math.min(800, parseInt(req.query.radius ?? "300", 10) || 300);
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
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass weist Anfragen ohne sinnvollen User-Agent/Accept mit 406 ab.
          "User-Agent": "BIT-Atelier/1.0 (local AEC dev tool)",
          "Accept": "application/json",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`overpass ${resp.status}`);
      const d = await resp.json();
      const streets = [];
      const paths = [];
      const trees = [];
      const greens = [];
      for (const e of d.elements || []) {
        if (e.type === "node") {
          // Einzelner Baum als Punkt
          if ((e.tags || {}).natural === "tree" && e.lat != null && e.lon != null) {
            trees.push({ lat: e.lat, lon: e.lon });
          }
          continue;
        }
        if (e.type !== "way" || !Array.isArray(e.geometry)) continue;
        const t = e.tags || {};
        const coords = e.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
        if (t.highway && STREET_KINDS.includes(t.highway) && coords.length >= 2) {
          streets.push({ coords, kind: t.highway });
        } else if (t.highway && PATH_KINDS.includes(t.highway) && coords.length >= 2) {
          paths.push({ coords, kind: t.highway });
        } else if ((t.landuse || t.leisure) && coords.length >= 3) {
          // Gruenflaechen nur als geschlossene Flaechen (>= 3 Punkte)
          greens.push({ coords });
        }
      }
      res.json({ source: "osm", center: { lat, lng }, streets, paths, trees, greens });
    } catch {
      res.json({ offline: true, streets: [], paths: [], trees: [], greens: [] });
    }
  });

  return r;
}
