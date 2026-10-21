// Cadastral parcel (Flurstueck) import from GeoJSON and DXF WITHOUT any new dependency
// (75-06 Task 2: GeoJSON; 101-03: DXF through the own reader @core/lib/plan/dxfLesen, ETRS89/UTM
// through @core/lib/utmEtrs89, several parcels united into ONE plot boundary through
// @core/lib/polygonVereinigung).
//
// In:  raw file TEXT (untrusted user input), reference location lat/lng, the scale of the
//      current site plan (metres per canvas unit).
// Out: { flurstuecke: [{ id, nummer, gemarkung, polygon, m_per_px }], warnungen: [string] }
//      — polygon in CANVAS PX like site_parcel/designated_areas (centre 600/400 = project
//      location), so metersPerPixel/polygonAreaM2 keep working unchanged. NEVER throws;
//      every failure mode becomes a plain-language warning.
//      grundstueckAusFlurstuecken() → the united boundary or an honest reason why not.
//
// Pure module (no React, no network): JSON.parse in try/catch, geometry via
// geoJsonToFootprint / lngLatToCanvasPoint from maplibreStyles (ONE conversion source, KD-16).
import { geoJsonToFootprint, lngLatToCanvasPoint, canvasPointToLngLat, CANVAS_CENTER_X, CANVAS_CENTER_Y } from "@designer/lib/maplibreStyles";
import { BEZUG_KENNUNG } from "@designer/lib/dxfPlaene";
import { dxfLesen, meldungText, DXF_MELDUNGEN } from "@core/lib/plan/dxfLesen.js";
import { vonUtm } from "@core/lib/utmEtrs89.js";
import { vereinigePolygone } from "@core/lib/polygonVereinigung.js";
import { DEFAULT_METERS_PER_PIXEL, pointInPolygon } from "@core/lib/geo";

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

/**
 * One imported parcel. polygon in canvas units (centre 600/400 = project location); m_per_px =
 * the scale the polygon was projected with (101-03, additive field — older records lack it).
 * @typedef {{id: string, nummer: string, gemarkung: string, polygon: Array<{x: number, y: number}>, m_per_px?: number}} Flurstueck
 */

/** Canvas point rounded to 0.01 canvas units (1.25 cm at 1.25 m/px). */
const rundePx = (/** @type {{x: number, y: number}} */ p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

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
 * @param {number} [mPerPx] metres per canvas unit of the site plan (site_parcel scale, default 1.25)
 * @returns {{flurstuecke: Array<Flurstueck>, warnungen: string[]}}
 *   parcels with polygon in canvas px (2 decimals); warnings in plain German; never throws
 */
export function flurstueckeAusGeoJson(text, lat, lng, mPerPx = DEFAULT_METERS_PER_PIXEL) {
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
      const polygon = geoJsonToFootprint(outer, lat, lng, mPerPx);
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
        // Canvas px like site_parcel/designated_areas, 2 decimals like the plot edit
        // (SiteDesigner parcelSetzen). 101-03: integer px were up to 0.6 m off at 1.25 m/px.
        polygon: polygon.map(rundePx),
        m_per_px: mPerPx,
      });
      n += 1;
    }
  }

  if (!flurstuecke.length && !warnungen.length) {
    warnungen.push("Kein importierbares Flurstück gefunden.");
  }
  return { flurstuecke, warnungen };
}

// ---------------------------------------------------------------------------------------------
// 101-03: DXF parcels and the union into ONE plot boundary
// ---------------------------------------------------------------------------------------------

/**
 * German message templates of the DXF import and the union ({name} = placeholder). English in
 * i18nTeile/dxf-104.js; filled through meldungText(m, t).
 * @type {Readonly<Record<string, string>>}
 */
export const IMPORT_MELDUNGEN = Object.freeze({
  keineFlaechen: "DXF enthält auf den gewählten Ebenen keine geschlossene Fläche.",
  ebenenAuto: "Ebene(n) automatisch gewählt: {ebenen} — andere Ebenen unten wählbar.",
  gaussKrueger: "Gauß-Krüger-Koordinaten (DHDN) werden nicht umgerechnet — bitte als ETRS89/UTM (EPSG:25832/25833) ausgeben. Nichts übernommen.",
  ohneBezug: "DXF ohne Georeferenz (weder UTM noch BIT-Atelier-Bezug) — Flurstücke um den Projektstandort zentriert; Lage bitte prüfen.",
  zuWeit: "Flurstücke liegen {km} km vom Projektstandort entfernt — Standort oder Koordinatensystem prüfen. Nichts übernommen.",
  einheitUnbekannt: "Zeichnungseinheit {code} unbekannt — als Meter gelesen.",
  zuViele: "Mehr als {max} Flurstücke — Rest ignoriert.",
  zuVielePunkte: "Fläche {n}: {punkte} Punkte > Limit {max} — übersprungen.",
  vereinigt: "{n} Flurstücke zu einer Grundstücksgrenze vereinigt ({flaeche} m²).",
  einzeln: "Grundstücksgrenze aus 1 Flurstück übernommen ({flaeche} m²).",
  luecke: "Flurstücke hängen nicht zusammen ({teile} Teile, kleinster Abstand {abstand} m) — keine gemeinsame Grenze gebildet.",
  ueberlappung: "Flurstücke überlappen sich oder sind doppelt enthalten — keine gemeinsame Grenze gebildet.",
  punktberuehrung: "Flurstücke berühren sich nur an einer Ecke — keine zusammenhängende Grenze gebildet.",
  loch: "Flurstücke umschließen eine Lücke (fremdes Flurstück oder Hof) — eine Grenze mit Loch wird nicht unterstützt.",
  ungueltig: "Flurstück {nr} ist keine gültige Fläche — keine Grenze gebildet.",
  leer: "Keine Flurstücke zum Vereinigen.",
});

/** Distance from the project location beyond which a georeferenced import is refused, km. [ASSUMED] a plot is never 20 km from its project. */
const MAX_ENTFERNUNG_KM = 20;
/** Gap/overlap tolerance of the union, metres. [ASSUMED] 2 cm ≈ cadastral coordinate precision (cm). */
const VEREINIGUNG_TOL_M = 0.02;
/** Metres per drawing unit for $INSUNITS (1 inch, 2 feet, 4 mm, 5 cm, 6 m; 0 = unitless → metres). */
const EINHEIT_M = /** @type {Readonly<Record<number, number>>} */ (Object.freeze({ 0: 1, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 }));
/** Parcel number as written in the cadastre ("123", "1234/5"); other texts are never taken as numbers. */
const NUMMER_MUSTER = /^\d{1,6}(\/\d{1,4})?$/;
/** Layer name groups for the automatic choice: parcels first, then plot boundaries. */
const EBENEN_VORRANG = [/flurst|flst|ax_flur/i, /grundst|parzel|grenze/i];
/** Georeference comment of the own export: "<BEZUG_KENNUNG> <lat> <lng>". */
const BEZUG_MUSTER = new RegExp(`${BEZUG_KENNUNG}\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)`);

/**
 * Parse an ASCII DXF into cadastral parcels (closed LWPOLYLINE / POLYLINE / LINE rings).
 * Coordinate frame, in this order: the own export (comment BEZUG_KENNUNG: metres around a
 * known lat/lng), ETRS89/UTM (with or without zone prefix, zone else from the project
 * longitude), Gauß-Krüger (refused with a message), otherwise local coordinates centred on
 * the project location with a warning. Parcel numbers come from TEXT/MTEXT inside the ring
 * that look like a cadastral number — never guessed otherwise.
 * @param {string} text raw DXF content (untrusted input)
 * @param {number} lat project latitude, degrees
 * @param {number} lng project longitude, degrees
 * @param {number} [mPerPx] metres per canvas unit of the site plan (default 1.25)
 * @param {{ebenen?: string[]|null, t?: (s: string) => string}} [opt] ebenen = layers to read
 *   (null = automatic choice); t = translator for the warnings
 * @returns {{flurstuecke: Array<Flurstueck>, warnungen: string[], ebenen: Array<{name: string, anzahl: number}>, gewaehlt: string[], unvollstaendig?: boolean}}
 *   parcels (canvas px, 2 decimals), translated warnings, every layer with geometry and the layers used;
 *   unvollstaendig = true when parcels may be missing (file unreadable from some line on, object or
 *   parcel limit hit, ring over the point limit) — a union of the rest is then too small; never throws
 */
export function flurstueckeAusDxf(text, lat, lng, mPerPx = DEFAULT_METERS_PER_PIXEL, { ebenen = null, t = (s) => s } = {}) {
  /** @type {string[]} */
  const warnungen = [];
  /** @type {Array<Flurstueck>} */
  const flurstuecke = [];
  const mpp = Number(mPerPx) > 0 ? Number(mPerPx) : DEFAULT_METERS_PER_PIXEL;
  const w = (/** @type {string} */ vorlage, /** @type {Record<string, string|number>} */ werte = {}) => { warnungen.push(meldungText({ text: vorlage, werte }, t)); };

  const alle = dxfLesen(text);
  if (alle.fehler) return { flurstuecke, warnungen: [meldungText(alle.fehler, t)], ebenen: alle.ebenen, gewaehlt: [] };
  const mitFlaeche = [...new Set(alle.polylinien.filter((p) => p.geschlossen && p.punkte.length >= 3).map((p) => p.ebene))];

  /** @type {string[]} */
  let gewaehlt;
  if (Array.isArray(ebenen) && ebenen.length) gewaehlt = ebenen.map(String);
  else {
    gewaehlt = mitFlaeche;
    for (const muster of EBENEN_VORRANG) {
      const treffer = mitFlaeche.filter((n) => muster.test(n));
      if (treffer.length) { gewaehlt = treffer; break; }
    }
    if (gewaehlt.length && gewaehlt.length < mitFlaeche.length) w(IMPORT_MELDUNGEN.ebenenAuto, { ebenen: gewaehlt.join(", ") });
  }
  const r = gewaehlt.length ? dxfLesen(text, { ebenen: gewaehlt }) : alle;
  for (const m of r.warnungen) warnungen.push(meldungText(m, t));
  const ringe = r.polylinien.filter((p) => p.geschlossen && p.punkte.length >= 3);
  const offen = r.polylinien.length - ringe.length;
  if (offen) w(DXF_MELDUNGEN.offeneLinien, { n: offen });
  if (!ringe.length) { w(IMPORT_MELDUNGEN.keineFlaechen); return { flurstuecke, warnungen, ebenen: alle.ebenen, gewaehlt }; }

  // ---- unit → metres ----
  let f = 1;
  if (alle.einheit != null) {
    if (EINHEIT_M[alle.einheit] != null) f = EINHEIT_M[alle.einheit];
    else w(IMPORT_MELDUNGEN.einheitUnbekannt, { code: alle.einheit });
  }
  const ringeM = ringe.map((p) => p.punkte.map((q) => ({ x: q.x * f, y: q.y * f })));

  // ---- coordinate frame ----
  // Plain loop, not Math.min(...xs): spreading >~100 000 points overflows the call stack.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ri of ringeM) {
    for (const q of ri) {
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const projektZone = Math.floor((Number(lng) + 180) / 6) + 1;
  const bezug = alle.kommentare.map((k) => k.match(BEZUG_MUSTER)).find(Boolean);
  /** @type {((q: {x: number, y: number}) => {lat: number, lng: number})|null} */
  let geo = null;
  const nordOk = cy >= 1e6 && cy <= 9.4e6; // UTM northing of the northern hemisphere outside the tropics
  if (bezug) {
    const lat0 = Number(bezug[1]), lng0 = Number(bezug[2]);
    // Metres around (lat0, lng0) → lat/lng with the SAME local projection the export used
    // (a canvas point at 1 m per unit around the origin), so the round trip is exact.
    geo = (q) => { const [g, b] = canvasPointToLngLat({ x: CANVAS_CENTER_X + q.x, y: CANVAS_CENTER_Y - q.y }, lat0, lng0, 1); return { lat: b, lng: g }; };
  } else if (cx >= 100000 && cx <= 900000 && nordOk) {
    geo = (q) => vonUtm(q.x, q.y, projektZone);
  } else if (cx >= 1e6 && nordOk) {
    const zp = Math.floor(cx / 1e6), rest = cx - zp * 1e6;
    // Gauß-Krüger eastings carry the strip number 2–5 in front (DHDN, Germany) — a different
    // datum (~100 m shift) this module does not transform; UTM zones 2–5 lie in the Pacific.
    if (zp >= 2 && zp <= 5 && zp !== projektZone) {
      w(IMPORT_MELDUNGEN.gaussKrueger);
      return { flurstuecke, warnungen, ebenen: alle.ebenen, gewaehlt };
    }
    if (zp >= 1 && zp <= 60 && rest >= 100000 && rest <= 900000) geo = (q) => vonUtm(q.x - zp * 1e6, q.y, zp);
  }

  /** @type {(q: {x: number, y: number}) => {x: number, y: number}} */
  let zuPx;
  if (!geo) {
    // Warn, not refuse: the outline itself is right, only its position is unknown.
    w(IMPORT_MELDUNGEN.ohneBezug);
    zuPx = (q) => ({ x: CANVAS_CENTER_X + (q.x - cx) / mpp, y: CANVAS_CENTER_Y - (q.y - cy) / mpp });
  } else {
    const g0 = geo;
    const mitte = g0({ x: cx, y: cy });
    const km = Math.hypot((mitte.lat - lat) * 111.32, (mitte.lng - lng) * 111.32 * Math.cos((lat * Math.PI) / 180));
    if (!(km <= MAX_ENTFERNUNG_KM)) {
      w(IMPORT_MELDUNGEN.zuWeit, { km: Number.isFinite(km) ? Math.round(km).toLocaleString("de-DE") : "?" });
      return { flurstuecke, warnungen, ebenen: alle.ebenen, gewaehlt };
    }
    zuPx = (q) => { const g = g0(q); return lngLatToCanvasPoint([g.lng, g.lat], lat, lng, mpp); };
  }

  const ts = Date.now();
  // Reader stopped early or cut objects: the parcels after that point are missing.
  let unvollstaendig = r.warnungen.some((m) => m.text === DXF_MELDUNGEN.abgebrochen || m.text === DXF_MELDUNGEN.zuVieleEntitaeten);
  for (let i = 0; i < ringe.length; i++) {
    if (flurstuecke.length >= GRENZEN.maxFlurstuecke) { w(IMPORT_MELDUNGEN.zuViele, { max: GRENZEN.maxFlurstuecke }); unvollstaendig = true; break; }
    const ring = ringe[i];
    if (ring.punkte.length > GRENZEN.maxPunkte) { w(IMPORT_MELDUNGEN.zuVielePunkte, { n: i + 1, punkte: ring.punkte.length, max: GRENZEN.maxPunkte }); unvollstaendig = true; continue; }
    // Number: a text inside the ring (drawing units) that looks like a cadastral number.
    const nr = alle.texte.find((x) => NUMMER_MUSTER.test(x.text) && pointInPolygon(ring.punkte, x.x, x.y));
    flurstuecke.push({
      id: `flst_dxf_${i}_${ts}`,
      nummer: nr ? nr.text : `Flurstück ${flurstuecke.length + 1}`,
      gemarkung: "",
      polygon: ringeM[i].map(zuPx).map(rundePx),
      m_per_px: mpp,
    });
  }
  return { flurstuecke, warnungen, ebenen: alle.ebenen, gewaehlt, unvollstaendig };
}

/**
 * Unite the imported parcels into ONE plot boundary (101-03). Parcels that do not form one
 * simple area (gap, overlap, corner contact, enclosed hole) give an honest reason instead of
 * a guessed outline — a wrong plot boundary carries into every planning-law check.
 * @param {Array<Flurstueck>} flurstuecke parcels in canvas px
 * @param {{mPerPx?: number, t?: (s: string) => string}} [opt] mPerPx = metres per canvas unit of
 *   the site plan (parcels with another m_per_px are rescaled around the canvas centre); t = translator
 * @returns {{ok: true, punkte: Array<{x: number, y: number}>, flaeche_m2: number, anzahl: number, meldung: string}
 *   | {ok: false, grund: string, meldung: string}}
 *   punkte in canvas px (2 decimals), flaeche_m2 in m² (rounded); meldung translated
 */
export function grundstueckAusFlurstuecken(flurstuecke, { mPerPx = DEFAULT_METERS_PER_PIXEL, t = (s) => s } = {}) {
  const mpp = Number(mPerPx) > 0 ? Number(mPerPx) : DEFAULT_METERS_PER_PIXEL;
  const liste = (Array.isArray(flurstuecke) ? flurstuecke : []).filter((x) => Array.isArray(x?.polygon));
  const m = (/** @type {string} */ v, /** @type {Record<string, string|number>} */ werte = {}) => meldungText({ text: v, werte }, t);
  if (!liste.length) return { ok: false, grund: "leer", meldung: m(IMPORT_MELDUNGEN.leer) };
  const polygone = liste.map((x) => {
    const k = Number(x.m_per_px) > 0 ? Number(x.m_per_px) / mpp : 1;
    return x.polygon.map((p) => ({ x: CANVAS_CENTER_X + (Number(p.x) - CANVAS_CENTER_X) * k, y: CANVAS_CENTER_Y + (Number(p.y) - CANVAS_CENTER_Y) * k }));
  });
  // Tolerance in canvas px; at least the 0.01-px rounding of the stored points.
  const tol = Math.max(VEREINIGUNG_TOL_M / mpp, 0.015);
  const r = vereinigePolygone(polygone, { toleranz: tol });
  if (!r.ok) {
    // The union's failure branch (tsc does not narrow the boolean discriminant in this project setup).
    const f = /** @type {{grund: string, teile?: number, abstand?: number|null, index?: number}} */ (/** @type {any} */ (r));
    /** @type {Record<string, string|number>} */
    let werte = {};
    if (f.grund === "luecke") werte = { teile: f.teile ?? "?", abstand: f.abstand != null ? (f.abstand * mpp).toLocaleString("de-DE", { maximumFractionDigits: 2 }) : "?" };
    else if (f.grund === "ungueltig") werte = { nr: liste[f.index ?? 0]?.nummer || String((f.index ?? 0) + 1) };
    return { ok: false, grund: f.grund, meldung: m(IMPORT_MELDUNGEN[f.grund] || IMPORT_MELDUNGEN.ueberlappung, werte) };
  }
  const flaeche_m2 = Math.round(r.flaeche * mpp * mpp);
  const zahl = flaeche_m2.toLocaleString("de-DE");
  return {
    ok: true, punkte: r.polygon.map(rundePx), flaeche_m2, anzahl: liste.length,
    meldung: liste.length > 1 ? m(IMPORT_MELDUNGEN.vereinigt, { n: liste.length, flaeche: zahl }) : m(IMPORT_MELDUNGEN.einzeln, { flaeche: zahl }),
  };
}
