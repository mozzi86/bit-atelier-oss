// Wiederverwendbarer MapLibre-Lifecycle (Phase 36, KARTE-02) — extrahiert aus
// LocationSelector.jsx. Kapselt die dort erarbeiteten Muster:
//   - Remount-per-key: Stilwechsel = neuer Container + neue Map (setStyle
//     verwirft eigene Sources/Layers — Kommentar im Original).
//   - Style-Fallback-Kette: Vektor-Style → OSM_RASTER_FALLBACK (einmalig).
//   - "bit:layers-ready": synthetisches Event nach den Basis-Layern; Daten-
//     Effekte der Aufrufer nutzen whenLayersReady() statt Timing-Raterei.
//   - ResizeObserver (Radix-Tabs mounten gern mit 0 px) + map.remove()-Cleanup
//     (WebGL-Kontext-Limit).
// Aufrufer erreichen die Map über ref.getMap() und spielen GeoJSON per
// getSource(id).setData() ein. Phase 46 (Hochwasser-Karte) baut hierauf auf.

import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { resolveStyle, OSM_RASTER_FALLBACK } from "@designer/lib/maplibreStyles";

// RTL-Text-Plugin (Arabisch/Hebräisch): ohne dieses Plugin rendert MapLibre
// RTL-Beschriftungen rückwärts und mit unverbundenen Buchstaben (Nutzer-Befund
// Kairo, 2026-08-11). Die Datei liegt als ROHE Kopie unter public/ (Quelle:
// @mapbox/mapbox-gl-rtl-text@0.3.0, BSD-2-Clause, kein CDN — Keyfrei-Konvention);
// ein Vite-?url-Import scheitert, weil der Map-Worker sie per importScripts lädt
// und der Dev-Server sie dann als ES-Modul transformiert. lazy = lädt erst,
// wenn wirklich RTL-Text auf der Karte auftaucht.
try {
  if (maplibregl.getRTLTextPluginStatus?.() === "unavailable") {
    // BASE_URL statt "/": im Demo-Build liegt die App unter /demo/ (GitHub Pages).
    maplibregl.setRTLTextPlugin(`${import.meta.env.BASE_URL}mapbox-gl-rtl-text.js`, true);
  }
} catch {
  /* schon gesetzt (HMR/Doppel-Import) — unkritisch */
}

const clampLat = (v) => Math.min(90, Math.max(-90, v));
const clampLng = (v) => Math.min(180, Math.max(-180, v));

/** Callback ausführen, sobald die Basis-Layer stehen; liefert Cleanup. */
export function whenLayersReady(map, fn) {
  if (map.getSource("footprint")) fn();
  else map.once("bit:layers-ready", fn);
  return () => map.off("bit:layers-ready", fn);
}

const MapLibreMap = forwardRef(function MapLibreMap(
  {
    center, // {lat, lng} — Pflicht; Änderungen folgen per easeTo (kein Remount)
    zoom = 14,
    styleKey = "normal", // "normal" | "satellite" — Wechsel remountet
    pitch = 45,
    bearing = 0,
    interactive = true,
    navControl = true,
    marker = false, // draggable Standort-Marker (Emerald-Kreis wie bisher)
    markerDraggable = true, // Review-Fix 36-02: beim Parzellen-Zeichnen sperren — ein verschlucktes dragend desynct den Marker sonst vom lat/lng-State
    onPick, // (lat, lng) — Karten-Klick UND Marker-dragend (Closure-sicher via Ref)
    onLayersReady, // (map) — nach den Basis-Layern (zusätzlich zum Event)
    baseLayers = true, // footprint- + osm-bld-Sources/Layers anlegen
    className = "h-full w-full",
  },
  ref
) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const fallbackTriedRef = useRef(false);
  const onPickRef = useRef(null);
  onPickRef.current = onPick;
  const onLayersReadyRef = useRef(null);
  onLayersReadyRef.current = onLayersReady;

  useImperativeHandle(ref, () => ({ getMap: () => mapRef.current }), []);

  // Map-Lifecycle: einmal pro Stil-Mount erstellen; Stilwechsel = Remount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const safeLat = Number.isFinite(center?.lat) ? clampLat(center.lat) : 49.4521;
    const safeLng = Number.isFinite(center?.lng) ? clampLng(center.lng) : 11.0767;

    const map = new maplibregl.Map({
      container,
      style: resolveStyle(styleKey),
      center: [safeLng, safeLat], // MapLibre/GeoJSON: [lng, lat]!
      zoom,
      pitch,
      bearing,
      interactive,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    fallbackTriedRef.current = false;

    if (navControl && interactive) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    }
    map.on("webglcontextlost", () => console.warn("MapLibre: WebGL-Kontext verloren"));

    // 72-01 A-12 (Befund N-21): „Image … could not be loaded" ×8 beim Öffnen
    // des Designers — der Remote-Style (OpenFreeMap Liberty) referenziert
    // Sprite-Bilder, die einzelne Tiles/Features anfordern und die nicht alle
    // erreichbar sind. Ein leeres 1×1-Transparentbild registrieren statt des
    // Warnrückschlags: die Karte bleibt voll nutzbar, die Konsole leer.
    map.on("styleimagemissing", (e) => {
      if (map.hasImage(e.id)) return;
      try {
        map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
      } catch {
        /* Bild schon von anderer Stelle registriert — unkritisch */
      }
    });

    // Style-Fallback: schlägt der Vektor-Style fehl, einmalig auf OSM-Raster umschalten.
    map.on("error", (e) => {
      if (fallbackTriedRef.current) return;
      const msg = String(e?.error?.message || "");
      if (!map.isStyleLoaded() && (msg.includes("style") || e?.sourceId == null)) {
        fallbackTriedRef.current = true;
        map.setStyle(OSM_RASTER_FALLBACK);
      }
    });

    // Klick-Picker (Handler einmal, onPick über Ref — Closure-Falle).
    map.on("click", (e) => {
      onPickRef.current?.(+e.lngLat.lat.toFixed(5), +e.lngLat.lng.toFixed(5));
    });

    if (marker) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:20px;height:20px;border-radius:50%;background:#10b981;border:3px solid #0d9488;cursor:grab;";
      const m = new maplibregl.Marker({ element: el, draggable: !!markerDraggable })
        .setLngLat([safeLng, safeLat])
        .addTo(map);
      m.on("dragend", () => {
        const p = m.getLngLat();
        onPickRef.current?.(+p.lat.toFixed(5), +p.lng.toFixed(5));
      });
      markerRef.current = m;
    }

    map.on("load", () => {
      if (baseLayers) {
        // Footprint-Overlay (site_parcel/designated_areas).
        map.addSource("footprint", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "footprint-fill", type: "fill", source: "footprint", paint: { "fill-color": "#10b981", "fill-opacity": 0.25 } });
        map.addLayer({ id: "footprint-line", type: "line", source: "footprint", paint: { "line-color": "#0d9488", "line-width": 2 } });
        // 3D-Nachbargebäude (fill-extrusion aus OSM-Daten).
        map.addSource("osm-bld", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "osm-bld-3d",
          type: "fill-extrusion",
          source: "osm-bld",
          paint: {
            "fill-extrusion-color": "#cbd5e1",
            // 72-01 A-12 (Befund N-21): „Expected value to be of type number,
            // but found null" — ein Feature ohne height (null) ließ den
            // Ausdruck platzen. coalesce fängt null ab (Default 9 m wie der
            // GeoJSON-Builder).
            "fill-extrusion-height": ["coalesce", ["get", "height"], 9],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.85,
          },
        });
      }
      map.fire("bit:layers-ready");
      onLayersReadyRef.current?.(map);
    });

    // Resize-Handling (Radix-Tab kann mit 0 px mounten).
    requestAnimationFrame(() => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    return () => {
      ro.disconnect();
      markerRef.current = null;
      mapRef.current = null;
      map.remove(); // WebGL-Kontext freigeben (Pflicht, Kontext-Limit)
    };
    // Remount nur bei Stilwechsel; center-Folgen laufen über den easeTo-Effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  // draggable-Umschalter des Standort-Markers (Map bleibt bestehen).
  useEffect(() => {
    markerRef.current?.setDraggable(!!markerDraggable);
  }, [markerDraggable]);

  // Marker + Kamera folgen center — Map NICHT neu erstellen.
  useEffect(() => {
    if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)) return;
    const la = clampLat(center.lat);
    const ln = clampLng(center.lng);
    markerRef.current?.setLngLat([ln, la]);
    mapRef.current?.easeTo({ center: [ln, la] });
  }, [center?.lat, center?.lng]);

  return <div key={styleKey} ref={containerRef} className={className} />;
});

export default MapLibreMap;
