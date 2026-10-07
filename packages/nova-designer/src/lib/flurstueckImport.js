// Cadastral parcel (Flurstueck) import from GeoJSON WITHOUT any new dependency
// (75-06 Task 2, D-P75-04: GeoJSON first; DXF/ALKIS would need a parser =
// new dependency + UTM-to-local projection = separate research).
//
// In:  raw file TEXT (untrusted user input), reference location lat/lng.
// Out: { flurstuecke: [{ id, nummer, gemarkung, polygon }], warnungen: [string] }
//      — polygon in CANVAS PX like site_parcel/designated_areas, so
//      metersPerPixel/polygonAreaM2 keep working unchanged. NEVER throws;
//      every failure mode becomes a plain-language warning.
//
// Pure module (no React, no network): JSON.parse in try/catch, geometry via
// geoJsonToFootprint from maplibreStyles (ONE conversion source, KD-16).
import { geoJsonToFootprint } from "@designer/lib/maplibreStyles";

/**
 * Tool limits for the import path. [ASSUMED] rationale: a cadastral file
 * bigger than this is not a case for this quick path but for the
 * DXF/ALKIS research (D-P75-04) — reject loudly instead of freezing the UI.
 * @type {{maxBytes:number, maxPunkte:number, maxFlurstuecke:number}}
 */
export const GRENZEN = {
  maxBytes: 2_000_000,   // ~2 MB text [ASSUMED]
  maxPunkte: 5000,       // points per ring [ASSUMED]
  maxFlurstuecke: 50,    // parcels per file [ASSUMED]
};

/** Coordinate sanity: GeoJSON is [lng, lat]; swapped axes are the classic error. */
function koordinatenOk(ring) {
  return ring.every((ll) =>
    Array.isArray(ll) && ll.length >= 2 &&
    Number.isFinite(Number(ll[0])) && Number.isFinite(Number(ll[1])) &&
    Math.abs(Number(ll[0])) <= 180 && Math.abs(Number(ll[1])) <= 90);
}

/**
 * Read a parcel number/name from the GeoJSON properties — known keys only,
 * NEVER guessed (a wrong cadastral number on a plan is a liability issue).
 * @param {object|null|undefined} props GeoJSON feature properties
 * @param {number} index 0-based feature index (fallback label "Flurstück N")
 * @returns {{nummer:string, gemarkung:string}} both strings ('' when absent)
 */
function namenAusProperties(props, index) {
  const p = props && typeof props === "object" ? props : {};
  const nummer = p.flurstueck ?? p.flstnr ?? p.nummer ?? p.name;
  const gemarkung = p.gemarkung ?? p.gemarkungsname;
  return {
    nummer: nummer == null ? `Flurstück ${index + 1}` : String(nummer),
    gemarkung: gemarkung == null ? "" : String(gemarkung),
  };
}

/**
 * Parse a GeoJSON text into cadastral parcels.
 * Accepts FeatureCollection, a single Feature, or a bare Polygon/MultiPolygon
 * geometry. Inner rings (holes) are DROPPED with a warning — silently
 * swallowing a hole would fake a too-large parcel area.
 *
 * @param {string} text raw file content (untrusted input)
 * @param {number} lat reference latitude, degrees (project location)
 * @param {number} lng reference longitude, degrees (project location)
 * @returns {{flurstuecke: Array<{id:string, nummer:string, gemarkung:string,
 *   polygon:Array<{x:number,y:number}>}>, warnungen: string[]}}
 *   parcels with polygon in canvas px; warnings in plain German; never throws
 */
export function flurstueckeAusGeoJson(text, lat, lng) {
  const warnungen = [];
  const flurstuecke = [];

  if (typeof text !== "string" || !text.trim()) {
    return { flurstuecke, warnungen: ["Datei ist leer."] };
  }
  // Byte length (UTF-8 aware enough via string length for the guard) — files
  // beyond maxBytes are rejected before parsing, not after freezing the tab.
  if (text.length > GRENZEN.maxBytes) {
    return {
      flurstuecke,
      warnungen: [`Datei zu groß (${Math.round(text.length / 1024).toLocaleString("de-DE")} kB > ${Math.round(GRENZEN.maxBytes / 1024).toLocaleString("de-DE")} kB). Für große Katasterdateien ist der DXF/ALKIS-Weg vorgesehen (offen).`],
    };
  }

  let geo;
  try {
    geo = JSON.parse(text);
  } catch (err) {
    return { flurstuecke, warnungen: [`GeoJSON konnte nicht gelesen werden: ${err?.message || "ungültiges JSON"}`] };
  }
  if (!geo || typeof geo !== "object") {
    return { flurstuecke, warnungen: ["GeoJSON enthält kein Objekt."] };
  }

  // Normalise every accepted shape to a list of {properties, geometry}.
  let features = [];
  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    features = geo.features.filter((f) => f && typeof f === "object");
  } else if (geo.type === "Feature") {
    features = [geo];
  } else if (geo.type === "Polygon" || geo.type === "MultiPolygon") {
    features = [{ type: "Feature", properties: {}, geometry: geo }];
  } else {
    return { flurstuecke, warnungen: [`GeoJSON-Typ „${String(geo.type)}" wird nicht unterstützt — erwartet: FeatureCollection, Feature, Polygon oder MultiPolygon.`] };
  }
  if (!features.length) {
    return { flurstuecke, warnungen: ["GeoJSON enthält kein Feature."] };
  }

  const ts = Date.now();
  let n = 0; // running index for stable ids and fallback names
  for (const f of features) {
    const geoTyp = f?.geometry?.type;
    const rings = []; // outer rings as [lng, lat][]
    if (geoTyp === "Polygon" && Array.isArray(f.geometry.coordinates?.[0])) {
      rings.push(...(f.geometry.coordinates[0] ? [f.geometry.coordinates] : []));
    } else if (geoTyp === "MultiPolygon") {
      // One parcel per part — a MultiPolygon of three parts is three parcels
      // of the same cadastral number in practice (Flurstückszerlegung).
      if (Array.isArray(f.geometry.coordinates)) {
        for (const poly of f.geometry.coordinates) {
          if (Array.isArray(poly?.[0])) rings.push(poly);
        }
      }
      if (rings.length > 1) warnungen.push("MultiPolygon in Einzelflächen zerlegt.");
    } else {
      warnungen.push(`Feature ${n + 1}: Geometrie „${String(geoTyp ?? "fehlt")}" übersprungen (nur Polygon/MultiPolygon).`);
      n += 1;
      continue;
    }

    for (const poly of rings) {
      if (n >= GRENZEN.maxFlurstuecke) {
        warnungen.push(`Mehr als ${GRENZEN.maxFlurstuecke} Flurstücke — Rest ignoriert.`);
        return { flurstuecke, warnungen };
      }
      const outer = poly?.[0];
      const holes = poly?.slice?.(1) || [];
      // Plan criterion: ring < 3 positions is rejected. GeoJSON rings are
      // normally CLOSED (triangle = 4 positions); geoJsonToFootprint opens a
      // closed ring, an open one passes through as-is.
      if (!Array.isArray(outer) || outer.length < 3) {
        warnungen.push(`Fläche ${n + 1}: Ring hat weniger als 3 Punkte — übersprungen.`);
        n += 1;
        continue;
      }
      if (holes.length) {
        warnungen.push(`Fläche ${n + 1}: ${holes.length} Lochfläche(n) verworfen — die importierte Fläche ist dadurch GRÖSSER als das echte Flurstück.`);
      }
      if (outer.length > GRENZEN.maxPunkte) {
        warnungen.push(`Fläche ${n + 1}: ${outer.length} Punkte > Limit ${GRENZEN.maxPunkte} — übersprungen (zu detailliert für diesen Weg).`);
        n += 1;
        continue;
      }
      if (!koordinatenOk(outer)) {
        warnungen.push(`Fläche ${n + 1}: Koordinaten außerhalb von ±180/±90 — lat/lng vertauscht? Fläche übersprungen.`);
        n += 1;
        continue;
      }
      const polygon = geoJsonToFootprint(outer, lat, lng);
      if (!Array.isArray(polygon) || polygon.length < 3) {
        warnungen.push(`Fläche ${n + 1}: Umrechnung in den Lageplan fehlgeschlagen — übersprungen.`);
        n += 1;
        continue;
      }
      const { nummer, gemarkung } = namenAusProperties(f.properties, n);
      flurstuecke.push({
        id: `flst_${n}_${ts}`,
        nummer,
        gemarkung,
        // Canvas px like site_parcel/designated_areas (1,25 m/px convention),
        // rounded like the drawing tools do (SiteDesigner closeDraft).
        polygon: polygon.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      });
      n += 1;
    }
  }

  if (!flurstuecke.length && !warnungen.length) {
    warnungen.push("Kein importierbares Flurstück gefunden.");
  }
  return { flurstuecke, warnungen };
}
