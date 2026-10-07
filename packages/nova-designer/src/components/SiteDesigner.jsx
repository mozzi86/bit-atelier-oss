import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Building, Trash2, MousePointerClick, PenTool, Check, Undo2 } from "lucide-react";
import { polygonAreaM2, centroid, pxAreaToM2, pxToM, mToPx, pointInPolygon } from "@core/lib/geo";
import { useI18n } from "@core/lib/i18n";
import { baukoerperDefaults } from "@designer/lib/siteParcel";
// 75-06 Task 2 (D-P75-04): GeoJSON parcel import — pure parse, no dependency.
import { flurstueckeAusGeoJson } from "@designer/lib/flurstueckImport";
import {
  footprintToGeoJson,
  geoJsonToFootprint,
  canvasPointToLngLat,
  lngLatToCanvasPoint,
} from "@designer/lib/maplibreStyles";
import {
  areasToGeoJson,
  buildingsToGeoJson,
  elevationToGeoJson,
  draftToGeoJson,
  ringBounds,
  elevColor,
} from "@designer/lib/mapDraw";
import MapLibreMap from "./MapLibreMap";

// Kreis-Handle für Vertex-Marker (Karten-Modus). stopPropagation, damit ein
// Klick auf den Handle nicht zusätzlich als Karten-Klick zeichnet/platziert.
function vertexElement({ filled = false, cursor = "grab" } = {}) {
  const el = document.createElement("div");
  el.style.cssText =
    `width:15px;height:15px;border-radius:50%;background:${filled ? "#0d9488" : "#ffffff"};` +
    `border:3px solid #0d9488;cursor:${cursor};box-sizing:border-box;`;
  el.addEventListener("click", (ev) => ev.stopPropagation());
  return el;
}

// Interaktiver Lageplan auf der echten Karte (Phase 36, KARTE-03): Zeichnen,
// Vertex-Drag und Baukörper-Setzen laufen direkt in Karten-Koordinaten,
// Pan/Zoom bleibt dabei frei (MapLibre feuert "click" nur ohne Drag).
// Persistiert wird unverändert das Canvas-Px-Bestandsformat — Übersetzung
// über canvasPointToLngLat/lngLatToCanvasPoint je Interaktion.
function LageplanKarte({
  loc,
  styleKey,
  parcel,
  areas,
  buildings,
  elevation,
  mode,
  draftGeo,
  setDraftGeo,
  insideParcel,
  onAddBuilding,
  onCloseDraft,
  onVertexCommit,
}) {
  const mapComp = useRef(null);
  const [mapReady, setMapReady] = useState(0); // Zähler: zählt je Map-Instanz (Stilwechsel = Remount) hoch
  const areaMarkersRef = useRef([]);
  const draftMarkersRef = useRef([]);
  const labelMarkersRef = useRef([]);
  const getMap = () => mapComp.current?.getMap() ?? null;

  const clearMarkers = (ref) => {
    ref.current.forEach((m) => m.remove());
    ref.current = [];
  };

  // Layer-Fundament je Map-Instanz; Reihenfolge wie im alten SVG:
  // Parzelle → Höhenpunkte → Baufelder → Draft → Baukörper.
  const onLayersReady = (map) => {
    const addSrc = (id) =>
      map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    ["sd-parcel", "sd-elev", "sd-areas", "sd-draft", "sd-buildings"].forEach(addSrc);
    map.addLayer({ id: "sd-parcel-fill", type: "fill", source: "sd-parcel", paint: { "fill-color": "#10b981", "fill-opacity": 0.06 } });
    map.addLayer({ id: "sd-parcel-line", type: "line", source: "sd-parcel", paint: { "line-color": "#10b981", "line-width": 3, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "sd-elev-circle", type: "circle", source: "sd-elev", paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-opacity": 0.8 } });
    map.addLayer({ id: "sd-areas-fill", type: "fill", source: "sd-areas", paint: { "fill-color": "#0d9488", "fill-opacity": 0.28 } });
    map.addLayer({ id: "sd-areas-line", type: "line", source: "sd-areas", paint: { "line-color": "#0d9488", "line-width": 2.5 } });
    map.addLayer({ id: "sd-draft-line", type: "line", source: "sd-draft", paint: { "line-color": "#14b8a6", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "sd-buildings-fill", type: "fill", source: "sd-buildings", paint: { "fill-color": "#3b82f6", "fill-opacity": 0.75 } });
    map.addLayer({ id: "sd-buildings-line", type: "line", source: "sd-buildings", paint: { "line-color": "#1e3a8a", "line-width": 2 } });
    // Parzelle voll ins Bild — einmal je Map-Instanz.
    const ring = footprintToGeoJson(parcel.points, loc.lat, loc.lng).features[0]?.geometry
      ?.coordinates?.[0];
    const bounds = ringBounds(ring);
    if (bounds) map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 18 });
    setMapReady((n) => n + 1);
  };

  // --- Daten → Sources -----------------------------------------------------
  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-parcel")?.setData(footprintToGeoJson(parcel.points, loc.lat, loc.lng));
  }, [mapReady, parcel, loc.lat, loc.lng]);

  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-elev")?.setData(elevationToGeoJson(elevation, loc.lat, loc.lng));
  }, [mapReady, elevation, loc.lat, loc.lng]);

  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-areas")?.setData(areasToGeoJson(areas, loc.lat, loc.lng));
  }, [mapReady, areas, loc.lat, loc.lng]);

  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-draft")?.setData(draftToGeoJson(draftGeo));
  }, [mapReady, draftGeo]);

  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-buildings")?.setData(buildingsToGeoJson(buildings, loc.lat, loc.lng));
  }, [mapReady, buildings, loc.lat, loc.lng]);

  // --- Klick zeichnet / platziert (Pan/Zoom bleibt frei) --------------------
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    const onClick = (e) => {
      // Zweitklick eines Doppelklicks verwerfen (Review-Fix: platzierte sonst
      // zwei identische Baukörper übereinander bzw. doppelte Draft-Punkte).
      if (e.originalEvent?.detail > 1) return;
      const lngLat = [e.lngLat.lng, e.lngLat.lat];
      const cpt = lngLatToCanvasPoint(lngLat, loc.lat, loc.lng);
      if (mode === "polygon") {
        // Klick nahe am Startpunkt (Screen-Px) schließt das Polygon.
        if (draftGeo.length >= 3) {
          const p0 = map.project(draftGeo[0]);
          if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 14) {
            onCloseDraft();
            return;
          }
        }
        if (!insideParcel(cpt.x, cpt.y)) return;
        setDraftGeo((d) => [...d, lngLat]);
      } else {
        if (!insideParcel(cpt.x, cpt.y)) return;
        onAddBuilding(cpt.x, cpt.y);
      }
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [mapReady, mode, draftGeo, insideParcel, onAddBuilding, onCloseDraft, setDraftGeo, loc.lat, loc.lng]);

  // Der Lageplan ist eine Zeichenfläche: Doppelklick-Zoom bleibt in BEIDEN
  // Modi aus (Review-Fix: zoomte sonst beim Baukörper-Setzen; Zoomen geht
  // weiter per Scrollrad und NavigationControl).
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return;
    map.doubleClickZoom.disable();
  }, [mapReady]);

  // 72-01 A-1 rework: explicit map.resize() after the tab became visible.
  // MapLibreMap already has a ResizeObserver, but Radix tab switches can keep
  // the container at 0x0 for a frame - one forced resize after paint makes the
  // inner map box pick up the frame height reliably (acceptance: >= 420 px).
  useEffect(() => {
    if (!mapReady) return undefined;
    const raf = requestAnimationFrame(() => getMap()?.resize());
    return () => cancelAnimationFrame(raf);
  }, [mapReady]);

  // --- Vertex-Drag der gespeicherten Baufelder ------------------------------
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    clearMarkers(areaMarkersRef);
    for (const a of areas) {
      a.points.forEach((p, idx) => {
        const m = new maplibregl.Marker({ element: vertexElement(), draggable: true })
          .setLngLat(canvasPointToLngLat(p, loc.lat, loc.lng))
          .addTo(map);
        m.on("drag", () => {
          // Live-Vorschau direkt in der Source — Commit erst am Drag-Ende.
          const ll = m.getLngLat();
          const moved = lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng);
          const live = areas.map((ar) =>
            ar.id !== a.id ? ar : { ...ar, points: ar.points.map((q, i) => (i === idx ? moved : q)) }
          );
          map.getSource("sd-areas")?.setData(areasToGeoJson(live, loc.lat, loc.lng));
        });
        m.on("dragend", () => {
          const ll = m.getLngLat();
          onVertexCommit(a.id, idx, lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng));
        });
        areaMarkersRef.current.push(m);
      });
    }
    return () => clearMarkers(areaMarkersRef);
  }, [mapReady, areas, onVertexCommit, loc.lat, loc.lng]);

  // --- Draft-Punkte: erster Punkt schließt, alle nachjustierbar -------------
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    clearMarkers(draftMarkersRef);
    draftGeo.forEach((p, idx) => {
      const isFirst = idx === 0;
      const el = vertexElement({
        filled: isFirst,
        cursor: isFirst && draftGeo.length >= 3 ? "pointer" : "grab",
      });
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
      let dragged = false; // nach einem Drag feuert der Browser noch ein click auf dem Element
      m.on("dragstart", () => {
        dragged = true;
      });
      if (isFirst) {
        el.title = "Klick: Polygon schließen";
        el.addEventListener("click", () => {
          if (dragged) {
            dragged = false;
            return;
          }
          if (draftGeo.length >= 3) onCloseDraft();
        });
      }
      m.on("drag", () => {
        const ll = m.getLngLat();
        map
          .getSource("sd-draft")
          ?.setData(draftToGeoJson(draftGeo.map((q, i) => (i === idx ? [ll.lng, ll.lat] : q))));
      });
      m.on("dragend", () => {
        const ll = m.getLngLat();
        setDraftGeo((d) => d.map((q, i) => (i === idx ? [ll.lng, ll.lat] : q)));
      });
      draftMarkersRef.current.push(m);
    });
    return () => clearMarkers(draftMarkersRef);
  }, [mapReady, draftGeo, onCloseDraft, setDraftGeo]);

  // --- m²-/Geschoss-Labels als DOM-Marker (unabhängig von Style-Glyphs) -----
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    clearMarkers(labelMarkersRef);
    const addLabel = (lngLat, text, css) => {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = `${css}pointer-events:none;white-space:nowrap;`;
      labelMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
      );
    };
    const areaCss =
      "font:700 13px system-ui;color:#0f766e;text-shadow:0 0 3px #fff,0 0 6px #fff;";
    for (const a of areas) {
      addLabel(
        canvasPointToLngLat(centroid(a.points), loc.lat, loc.lng),
        `${polygonAreaM2(a.points, parcel).toLocaleString("de-DE")} m²`,
        areaCss
      );
    }
    if (draftGeo.length >= 3) {
      const pts = draftGeo.map((q) => lngLatToCanvasPoint(q, loc.lat, loc.lng));
      addLabel(
        canvasPointToLngLat(centroid(pts), loc.lat, loc.lng),
        `${polygonAreaM2(pts, parcel).toLocaleString("de-DE")} m²`,
        areaCss
      );
    }
    for (const b of buildings) {
      addLabel(
        canvasPointToLngLat(
          { x: b.x + (b.width || 0) / 2, y: b.y + (b.height || 0) / 2 },
          loc.lat,
          loc.lng
        ),
        `${b.floors || 1}G`,
        "font:700 12px system-ui;color:#fff;text-shadow:0 0 3px #1e3a8a,0 0 5px #1e3a8a;"
      );
    }
    return () => clearMarkers(labelMarkersRef);
  }, [mapReady, areas, buildings, draftGeo, parcel, loc.lat, loc.lng]);

  return (
    <div
      className="relative w-full rounded-lg border overflow-hidden"
      // 72-01 A-1 (finding N-01): FIXED height instead of aspectRatio - inside
      // a hidden Radix tab the width is 0 and the ratio collapsed the frame to
      // 0 px, leaving the map a white box. [ASSUMED] 560 px map height, 420 px
      // floor (review sec.3 A-1: "feste Höhe").
      style={{ height: 560, minHeight: 420 }}
    >
      {/* 72-01 A-1 rework: the map container gets h-full w-full, NOT
          "absolute inset-0" - maplibre-gl.css sets position:relative on
          .maplibregl-map itself, which overrode Tailwind's absolute and made
          inset-0 ineffective (inner box stayed 0 px tall inside the frame). */}
      <MapLibreMap
        ref={mapComp}
        center={{ lat: loc.lat, lng: loc.lng }}
        zoom={15}
        styleKey={styleKey}
        pitch={0}
        bearing={0}
        baseLayers={false}
        onLayersReady={onLayersReady}
        className="h-full w-full"
      />
    </div>
  );
}

// Interactive 2D site plan. Modus "Baukörper" (Klick setzt Rechteck) oder
// "Polygon" (frei zeichnen, Eckpunkte ziehen, Live-Fläche in m²).
// Mit Standort (Phase 36, KARTE-03): direkt auf der MapLibre-Karte; ohne
// Standort bleibt der bisherige SVG-Canvas als Fallback.
export default function SiteDesigner({ complexData, onBuildingsChange, onAreasChange, onSiteAreaChange, projektTyp = null, onReestimateParcel = null, onFlurstueckImport = null }) {
  const { t } = useI18n();
  const svgRef = useRef(null);
  const dragRef = useRef(null);   // { areaId, idx }
  const movedRef = useRef(false);
  const parcel = complexData?.site_parcel;
  const loc = complexData?.location;
  const elevation = complexData?.topography?.elevation_points || [];
  const buildings = complexData?.buildings || [];
  const areas = useMemo(
    () => (complexData?.designated_areas || []).filter((a) => Array.isArray(a?.points)),
    [complexData?.designated_areas]
  );
  // KD-06: Topografie & Nachbarbebauung sind generiert, nicht erhoben.
  const isSynthetic = complexData?.topography?.source === "synthetisch"
    || complexData?.context_buildings_source === "synthetisch";

  const [mode, setMode] = useState("building"); // building | polygon
  const [draft, setDraft] = useState([]);        // SVG-Fallback: {x,y}-Punkte
  const [draftGeo, setDraftGeo] = useState([]);  // Karten-Modus: [lng,lat]-Punkte
  // 75-06 Task 3 (MSB-3): role of the drawn polygon — "footprint" (default,
  // the existing behaviour: feeds the massing body) or "baufeld" (the building
  // envelope the Massing checks against). Legacy records all carry "footprint",
  // so no migration is needed. MUST sit above the !parcel early return
  // (rules of hooks).
  const [areaTyp, setAreaTyp] = useState("footprint");
  // 75-06 Task 2: imported cadastral parcels + last-import warnings (UI-only,
  // the data model write lives in ComplexDesigner.handleFlurstueckImport).
  const [geoWarnungen, setGeoWarnungen] = useState([]);

  // GeoJSON file → pure parse → hand the parcels to ComplexDesigner. Native
  // <input type=file> (no shadcn <Input>: tsc legacy). Needs a location as the
  // projection reference — without it, a plain hint, never a silent fallback.
  const flurstuecke = complexData?.grundstueck?.flurstuecke || [];
  const onGeojsonDatei = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (loc?.lat == null || loc?.lng == null) {
      setGeoWarnungen([t("Erst im Tab „Standort & Karte“ einen Standort übernehmen — ohne Standort fehlt der Bezugspunkt für den Import.")]);
      return;
    }
    try {
      const text = await file.text();
      const { flurstuecke: liste, warnungen } = flurstueckeAusGeoJson(text, loc.lat, loc.lng);
      setGeoWarnungen(warnungen);
      if (liste.length) onFlurstueckImport?.(liste);
    } catch (err) {
      setGeoWarnungen([`${t("Import fehlgeschlagen")}: ${err?.message || err}`]);
    }
  };
  const flurstueckLoeschen = (id) => {
    const rest = flurstuecke.filter((f) => f.id !== id);
    // Empty list back to ComplexDesigner clears grundstueck.flurstuecke too.
    onFlurstueckImport?.(rest);
    if (!rest.length) setGeoWarnungen([]);
  };

  const VIEW_W = 1200;
  const VIEW_H = 800;

  // KD-11: die Grundstücksfläche der gezeichneten Parzelle nach oben melden.
  // Ohne diesen Rückkanal rechneten Raumprogramm, Compliance und Generativ
  // dauerhaft mit ihrem 3.500-m²-Default statt mit dem echten Grundstück.
  const parcelAreaM2 = parcel ? Math.round(polygonAreaM2(parcel.points, parcel)) : 0;
  useEffect(() => {
    if (parcelAreaM2 > 0) onSiteAreaChange?.(parcelAreaM2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelAreaM2]);

  if (!parcel) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 text-center text-slate-500">
          <MousePointerClick className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          Wähle zuerst im Tab „Standort & Karte" einen Standort — danach erscheint hier der Lageplan.
        </CardContent>
      </Card>
    );
  }

  const pts = parcel.points;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  // Echter Punkt-im-Polygon-Test (Review-Fix 36-02): der frühere Bbox-Check
  // ließ bei gezeichneten (nicht-rechteckigen) Parzellen Punkte/Baukörper
  // außerhalb des Grundstücks zu. Beim generischen Quadrat identisch.
  const insideParcel = (x, y) => pointInPolygon(pts, x, y);

  const hatKarte = loc?.lat != null && loc?.lng != null;
  const mapCtx = complexData?.map_context;

  const toView = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
    };
  };

  const addBuilding = (x, y) => {
    if (!insideParcel(x, y)) return;
    // 72-01 A-3 (Befund N-03): Standard in METERN (20 × 15 m [ASSUMED]) über
    // den Parzellen-Maßstab in Canvas-Px umgerechnet — vorher feste 120×90 px,
    // das waren auf der 1-km-Parzelle ~100.000 m² BGF je Klick. Geschosse aus
    // dem Projekttyp (Gewerbe 4 / Wohnen 3 / Öffentlich 2 [ASSUMED]).
    const defaults = baukoerperDefaults(projektTyp);
    const w = Math.max(2, Math.round(mToPx(defaults.breiteM, parcel)));
    const h = Math.max(2, Math.round(mToPx(defaults.tiefeM, parcel)));
    onBuildingsChange?.([
      ...buildings,
      { id: `bld_${Date.now()}`, x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h, floors: defaults.geschosse },
    ]);
  };

  const removeBuilding = (id) => onBuildingsChange?.(buildings.filter((b) => b.id !== id));
  const removeArea = (id) => onAreasChange?.((complexData?.designated_areas || []).filter((a) => a.id !== id));

  const closeDraft = () => {
    if (draft.length < 3) return;
    onAreasChange?.([
      ...(complexData?.designated_areas || []),
      { id: `poly_${Date.now()}`, type: areaTyp, points: draft.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) },
    ]);
    setDraft([]);
  };

  // Karten-Draft ([lng,lat]) → Canvas-Px-Bestandsformat (KARTE-03).
  const closeDraftGeo = () => {
    if (draftGeo.length < 3) return;
    const cpts = geoJsonToFootprint(draftGeo, loc.lat, loc.lng);
    if (!cpts) return;
    onAreasChange?.([
      ...(complexData?.designated_areas || []),
      { id: `poly_${Date.now()}`, type: areaTyp, points: cpts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) },
    ]);
    setDraftGeo([]);
  };

  // Vertex-Commit aus dem Karten-Modus (Live-Vorschau macht LageplanKarte).
  const commitVertex = (areaId, idx, pt) => {
    const next = (complexData?.designated_areas || []).map((a) => {
      if (a.id !== areaId || !Array.isArray(a.points)) return a;
      const p = a.points.slice();
      p[idx] = { x: Math.round(pt.x), y: Math.round(pt.y) };
      return { ...a, points: p };
    });
    onAreasChange?.(next);
  };

  const handleSvgClick = (e) => {
    if (movedRef.current) { movedRef.current = false; return; } // ignore click after a drag
    const { x, y } = toView(e);
    if (mode === "building") { addBuilding(x, y); return; }
    // polygon mode
    if (!insideParcel(x, y)) return;
    if (draft.length >= 3) {
      const first = draft[0];
      const near = Math.hypot(first.x - x, first.y - y) < 20;
      if (near) { closeDraft(); return; }
    }
    setDraft((d) => [...d, { x, y }]);
  };

  const startDrag = (e, areaId, idx) => {
    e.stopPropagation();
    dragRef.current = { areaId, idx };
    movedRef.current = false;
    try { e.target.setPointerCapture?.(e.pointerId); } catch (_) { /* noop */ }
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    movedRef.current = true;
    const { x, y } = toView(e);
    const { areaId, idx } = dragRef.current;
    const next = (complexData?.designated_areas || []).map((a) => {
      if (a.id !== areaId || !Array.isArray(a.points)) return a;
      const p = a.points.slice();
      p[idx] = { x: Math.round(x), y: Math.round(y) };
      return { ...a, points: p };
    });
    onAreasChange?.(next);
  };

  const endDrag = () => { dragRef.current = null; };

  const elevColorSvg = elevColor;

  // BGF ≈ Grundfläche (px² → m² über den zentralen Maßstab) × Geschosse.
  const gfaApprox = buildings.reduce(
    (s, b) => s + pxAreaToM2((b.width || 0) * (b.height || 0), parcel) * (b.floors || 1), 0,
  );
  const polyTotalM2 = areas.reduce((s, a) => s + polygonAreaM2(a.points, parcel), 0);
  const draftM2 = draft.length >= 3 ? polygonAreaM2(draft, parcel) : 0;

  // Toolbar wirkt je Modus auf den passenden Draft (Karte vs. SVG-Fallback).
  const draftLen = hatKarte ? draftGeo.length : draft.length;
  const undoDraftPoint = () =>
    hatKarte ? setDraftGeo((d) => d.slice(0, -1)) : setDraft((d) => d.slice(0, -1));
  const doCloseDraft = hatKarte ? closeDraftGeo : closeDraft;

  // KARTE-04a: echte Parzelle → echte Kantenlängen statt „~1000 × 1000 m".
  // 72-01 A-2: das generische Startquadrat hat jetzt eine Projektableitung —
  // seine Kantenlänge (m) folgt aus m_per_px × SITE_EDGE_PX.
  const parcelIstGezeichnet = parcel && parcel.assumed === false;
  const bboxWm = Math.round(pxToM(maxX - minX, parcel));
  const bboxHm = Math.round(pxToM(maxY - minY, parcel));

  return (
    <div className="grid lg:grid-cols-[3fr_1fr] gap-6">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building className="w-4 h-4" /> Lageplan
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button size="sm" variant={mode === "building" ? "default" : "outline"}
                onClick={() => { setMode("building"); setDraft([]); setDraftGeo([]); }} aria-label="Baukörper-Modus">
                <Building className="w-4 h-4 mr-1" /> Baukörper
              </Button>
              <Button size="sm" variant={mode === "polygon" ? "default" : "outline"}
                onClick={() => setMode("polygon")} aria-label="Polygon-Zeichenmodus">
                <PenTool className="w-4 h-4 mr-1" /> Polygon
              </Button>
              {mode === "polygon" && (
                <>
                  {/* 75-06 Task 3 (MSB-3): role of the drawn polygon — native
                      select (shadcn <Select> would add tsc legacy errors). */}
                  <select
                    value={areaTyp}
                    onChange={(e) => setAreaTyp(e.target.value)}
                    aria-label={t("Rolle des gezeichneten Polygons")}
                    data-testid="sd-area-typ"
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700"
                  >
                    <option value="footprint">{t("Baukörper")}</option>
                    <option value="baufeld">{t("Baufeld")}</option>
                  </select>
                  <Button size="sm" variant="ghost" onClick={undoDraftPoint} disabled={!draftLen} aria-label="Letzten Punkt entfernen">
                    <Undo2 className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-emerald-700" onClick={doCloseDraft} disabled={draftLen < 3} aria-label="Polygon schließen">
                    <Check className="w-4 h-4 mr-1" /> Schließen
                  </Button>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {mode === "building" ? "Klicke in die Parzelle, um einen Baukörper zu setzen."
              : "Klicke Stützpunkte; mit „Schließen\" oder Klick auf den Startpunkt abschließen. Eckpunkte ziehbar."}
            {hatKarte && " Karte: Ziehen verschiebt, Scrollen zoomt — auch während des Zeichnens."}
          </p>
        </CardHeader>
        <CardContent>
          {hatKarte ? (
            <LageplanKarte
              loc={loc}
              styleKey={mapCtx?.style || "normal"}
              parcel={parcel}
              areas={areas}
              buildings={buildings}
              elevation={elevation}
              mode={mode}
              draftGeo={draftGeo}
              setDraftGeo={setDraftGeo}
              insideParcel={insideParcel}
              onAddBuilding={addBuilding}
              onCloseDraft={closeDraftGeo}
              onVertexCommit={commitVertex}
            />
          ) : (
          <div className="relative w-full rounded-lg border overflow-hidden" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="absolute inset-0 w-full h-full cursor-crosshair bg-slate-50"
            onClick={handleSvgClick}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <polygon
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(16,185,129,0.06)" stroke="#10b981" strokeWidth="3" strokeDasharray="8 6"
            />
            {elevation.map((e) => (
              <circle key={e.id} cx={e.x} cy={e.y} r="6" fill={elevColorSvg(e.elevation)} opacity="0.8">
                <title>{`${e.elevation} m`}</title>
              </circle>
            ))}

            {/* saved footprint polygons */}
            {areas.map((a) => {
              const c = centroid(a.points);
              return (
                <g key={a.id}>
                  <polygon points={a.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="rgba(13,148,136,0.28)" stroke="#0d9488" strokeWidth="2.5" />
                  <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" fontSize="22" fontWeight="bold" fill="#0f766e">
                    {polygonAreaM2(a.points, parcel).toLocaleString("de-DE")} m²
                  </text>
                  {a.points.map((p, idx) => (
                    <circle key={idx} cx={p.x} cy={p.y} r="9" fill="#ffffff" stroke="#0d9488" strokeWidth="3"
                      style={{ cursor: "grab" }} onPointerDown={(e) => startDrag(e, a.id, idx)} />
                  ))}
                </g>
              );
            })}

            {/* in-progress draft */}
            {draft.length > 0 && (
              <g>
                <polyline points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeDasharray="6 4" />
                {draft.length >= 3 && (
                  <text x={centroid(draft).x} y={centroid(draft).y} textAnchor="middle" dominantBaseline="middle" fontSize="20" fontWeight="bold" fill="#0d9488">
                    {draftM2.toLocaleString("de-DE")} m²
                  </text>
                )}
                {draft.map((p, idx) => (
                  <circle key={idx} cx={p.x} cy={p.y} r="8" fill={idx === 0 ? "#0d9488" : "#ffffff"} stroke="#0d9488" strokeWidth="3" />
                ))}
              </g>
            )}

            {/* placed buildings */}
            {buildings.map((b) => (
              <g key={b.id}>
                <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="#3b82f6" fillOpacity="0.75" stroke="#1e3a8a" strokeWidth="2" />
                <text x={b.x + b.width / 2} y={b.y + b.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize="20" fill="white">
                  {b.floors}G
                </text>
              </g>
            ))}
          </svg>
          </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 space-y-2">
            <Badge className="bg-emerald-100 text-emerald-800">
              {parcelIstGezeichnet
                ? `Grundstück ~${bboxWm.toLocaleString("de-DE")} × ${bboxHm.toLocaleString("de-DE")} m (gezeichnet)`
                : `Grundstück ~${bboxWm.toLocaleString("de-DE")} × ${bboxHm.toLocaleString("de-DE")} m (geschätzt)`}
            </Badge>
            <div className="text-sm text-slate-600">
              Grundstücksfläche: <b>{parcelAreaM2.toLocaleString("de-DE")} m²</b>
            </div>
            <div className="text-[11px] text-slate-400">
              Bezug für GRZ/GFZ und Dichte in Raumprogramm, Compliance und Generativ.
            </div>
            <div className="text-sm text-slate-600">Baukörper: <b>{buildings.length}</b></div>
            <div className="text-sm text-slate-600">Footprint-Polygone: <b>{areas.length}</b></div>
            <div className="text-sm text-slate-600">Polygon-Fläche gesamt: <b>{polyTotalM2.toLocaleString("de-DE")} m²</b></div>
            <div className="text-sm text-slate-600">≈ BGF (Baukörper): <b>{Math.round(gfaApprox).toLocaleString("de-DE")} m²</b></div>
            <div className="text-xs text-slate-400">Topografie: {elevation.length} Höhenpunkte</div>
            {/* KD-06: keine Nachweis-Optik für Demo-Daten. */}
            {isSynthetic && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                <b>Demo-Daten:</b> {complexData?.topography?.hinweis
                  || "Topografie aus den Koordinaten erzeugt — keine Vermessungs-/DGM-Daten."}
                {" "}Nachbarbebauung ist Kulisse. Nicht für Nachweise verwenden.
              </div>
            )}
            {parcel?.assumed && (
              <div className="text-[11px] text-amber-700">
                {/* 72-01 A-2 rework: "aus der Gebäudefläche × 3" only when the
                    parcel was ACTUALLY derived (buildSiteParcel stamps
                    geschaetzte_flaeche_m2). A SAVED legacy parcel (e.g. the old
                    1.000.000-m2 record) says "gespeicherte Parzelle" and offers
                    re-derivation instead of lying about its origin. */}
                {Number.isFinite(parcel.geschaetzte_flaeche_m2)
                  ? <>Parzelle ist ein geschätztes Startquadrat ({bboxWm.toLocaleString("de-DE")} × {bboxHm.toLocaleString("de-DE")} m
                      aus der Gebäudefläche × 3 [ASSUMED]) — kein Katasterzuschnitt.</>
                  : <>Gespeicherte Parzelle ({bboxWm.toLocaleString("de-DE")} × {bboxHm.toLocaleString("de-DE")} m) aus älteren Daten —
                      kein Katasterzuschnitt{onReestimateParcel && (
                        <button
                          type="button"
                          onClick={onReestimateParcel}
                          className="ml-1 underline font-medium hover:text-amber-900"
                        >
                          Neu schätzen
                        </button>
                      )}.</>}
                {hatKarte && ' Im Tab „Standort & Karte" kannst du die echte Parzelle zeichnen.'}
              </div>
            )}
          </CardContent>
        </Card>

        {areas.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Footprint-Polygone</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-48 overflow-y-auto">
              {areas.map((a, i) => (
                <div key={a.id} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                  <span>
                    Polygon {i + 1} · {a.type === "baufeld" ? t("Baufeld") : t("Baukörper")} · {polygonAreaM2(a.points, parcel).toLocaleString("de-DE")} m²
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeArea(a.id)} aria-label="Polygon löschen">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* 75-06 Task 2 (D-P75-04): cadastral parcel import from GeoJSON —
            no new dependency, pure parse in flurstueckImport.js. NATIVE
            elements on purpose: every new shadcn instance (Card/Button/Input)
            counts as a tsc legacy error in this file (night-run rule 22.09.),
            so the block mirrors the card look with Tailwind classes only. */}
        <div className="rounded-lg border bg-card p-4 space-y-2" data-testid="sd-geojson-block">
          <div className="text-sm font-semibold">{t("Flurstücke (GeoJSON)")}</div>
          <input
            type="file"
            accept=".geojson,.json"
            data-testid="sd-geojson"
            onChange={onGeojsonDatei}
            className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
          />
          {geoWarnungen.length > 0 && (
            <div data-testid="sd-geojson-warnung" className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 space-y-1">
              {geoWarnungen.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}
          {flurstuecke.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto" data-testid="sd-flurstuecke">
              {flurstuecke.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                  <span>
                    {f.nummer}{f.gemarkung ? ` · ${f.gemarkung}` : ""} ·{" "}
                    <b>{polygonAreaM2(f.polygon, parcel).toLocaleString("de-DE")} m²</b>
                  </span>
                  <button
                    type="button"
                    className="text-red-500 hover:text-red-700 p-1"
                    onClick={() => flurstueckLoeschen(f.id)}
                    aria-label={t("Flurstück löschen")}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            {t("Der Import wird erst mit „Entwurf speichern“ dauerhaft (Pflichtfelder: Name + Standort).")}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Baukörper</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {buildings.length === 0 && <p className="text-sm text-slate-500">Noch keine. Klicke in den Plan.</p>}
            {buildings.map((b, i) => (
              <div key={b.id} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                <span>Baukörper {i + 1} · {b.floors} Gesch.</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeBuilding(b.id)} aria-label="Baukörper löschen">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
