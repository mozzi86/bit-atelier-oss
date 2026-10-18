import React, { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Building, Trash2, MousePointerClick, MousePointer2, PenTool, Check, Undo2, Redo2 } from "lucide-react";
import { polygonAreaM2, centroid, pxAreaToM2, pxToM, mToPx, pointInPolygon, metersPerPixel } from "@core/lib/geo";
// 95-04…06: blocks as objects in metres — selection, move/copy/rotate, snapping, checks.
import { alsBlock, ecken } from "@core/lib/massing/bloecke";
import { useBlockBearbeitung } from "@designer/lib/useBlockBearbeitung";
import { mittelklickZaehler } from "@core/lib/mittelklick";
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

/** Rotate handle distance above the selection, screen px. [ASSUMED] */
const GRIFF_PX = 28;

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
  bb = null,
  mSite = 1.25,
  zeigeHoehen = false,
}) {
  // 95-02: metres per canvas unit of THIS parcel (generic parcels have their own scale).
  const mpp = Number(parcel?.m_per_px) > 0 ? Number(parcel.m_per_px) : undefined;
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
    ["sd-parcel", "sd-elev", "sd-areas", "sd-draft", "sd-abstand", "sd-buildings"].forEach(addSrc);
    map.addLayer({ id: "sd-parcel-fill", type: "fill", source: "sd-parcel", paint: { "fill-color": "#10b981", "fill-opacity": 0.06 } });
    map.addLayer({ id: "sd-parcel-line", type: "line", source: "sd-parcel", paint: { "line-color": "#10b981", "line-width": 3, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "sd-elev-circle", type: "circle", source: "sd-elev", paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-opacity": 0.8 } });
    map.addLayer({ id: "sd-areas-fill", type: "fill", source: "sd-areas", paint: { "fill-color": "#0d9488", "fill-opacity": 0.28 } });
    map.addLayer({ id: "sd-areas-line", type: "line", source: "sd-areas", paint: { "line-color": "#0d9488", "line-width": 2.5 } });
    map.addLayer({ id: "sd-draft-line", type: "line", source: "sd-draft", paint: { "line-color": "#14b8a6", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    // 95-06: setback strips (study) under the blocks — green = fine, red = conflict.
    map.addLayer({ id: "sd-abstand-fill", type: "fill", source: "sd-abstand", paint: { "fill-color": ["case", ["get", "konflikt"], "#ef4444", "#22c55e"], "fill-opacity": 0.16 } });
    map.addLayer({ id: "sd-abstand-line", type: "line", source: "sd-abstand", paint: { "line-color": ["case", ["get", "konflikt"], "#dc2626", "#16a34a"], "line-width": 1, "line-dasharray": [2, 2] } });
    // 95-04: selected blocks amber outline, blocks with a conflict red fill.
    map.addLayer({ id: "sd-buildings-fill", type: "fill", source: "sd-buildings", paint: { "fill-color": ["case", ["get", "konflikt"], "#ef4444", "#3b82f6"], "fill-opacity": 0.75 } });
    map.addLayer({ id: "sd-buildings-line", type: "line", source: "sd-buildings", paint: { "line-color": ["case", ["get", "sel"], "#f59e0b", "#1e3a8a"], "line-width": ["case", ["get", "sel"], 4, 2] } });
    // Parzelle voll ins Bild — einmal je Map-Instanz.
    const ring = footprintToGeoJson(parcel.points, loc.lat, loc.lng, mpp).features[0]?.geometry
      ?.coordinates?.[0];
    const bounds = ringBounds(ring);
    if (bounds) map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 18 });
    setMapReady((n) => n + 1);
  };

  // --- Daten → Sources -----------------------------------------------------
  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-parcel")?.setData(footprintToGeoJson(parcel.points, loc.lat, loc.lng, mpp));
  }, [mapReady, parcel, loc.lat, loc.lng]);

  useEffect(() => {
    const map = getMap();
    // 101-01: the synthetic demo heights are hidden unless switched on (user 18.10.: "bunte Pünktchen").
    map?.getSource("sd-elev")?.setData(elevationToGeoJson(zeigeHoehen ? elevation : [], loc.lat, loc.lng, mpp));
  }, [mapReady, elevation, loc.lat, loc.lng, mpp, zeigeHoehen]);

  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-areas")?.setData(areasToGeoJson(areas, loc.lat, loc.lng, mpp));
  }, [mapReady, areas, loc.lat, loc.lng, mpp]);

  useEffect(() => {
    const map = getMap();
    map?.getSource("sd-draft")?.setData(draftToGeoJson(draftGeo));
  }, [mapReady, draftGeo]);

  const auswahlSet = useMemo(() => new Set(bb?.auswahl || []), [bb?.auswahl]);
  const pruefJe = bb?.pruefung?.je;
  useEffect(() => {
    const map = getMap();
    const konflikt = (id) => {
      const j = pruefJe?.[id];
      return !!j && (j.ausserhalb || j.grenzKonflikt || j.ueberlappt.length > 0 || j.abstandZu.length > 0);
    };
    map?.getSource("sd-buildings")?.setData(buildingsToGeoJson(buildings, loc.lat, loc.lng, mpp,
      (b) => ({ sel: auswahlSet.has(b.id), konflikt: konflikt(b.id) })));
  }, [mapReady, buildings, loc.lat, loc.lng, mpp, auswahlSet, pruefJe]);

  // 95-06: setback strips of every block while the selection tool is active.
  useEffect(() => {
    const map = getMap();
    const features = [];
    if (mode === "auswahl" && pruefJe) {
      for (const j of Object.values(pruefJe)) {
        for (const st of j.streifen) {
          const f = footprintToGeoJson(st.pts.map((q) => ({ x: q.x / mSite, y: q.y / mSite })), loc.lat, loc.lng, mpp).features[0];
          if (f) features.push({ ...f, properties: { konflikt: st.conflict === true } });
        }
      }
    }
    map?.getSource("sd-abstand")?.setData({ type: "FeatureCollection", features });
  }, [mapReady, mode, pruefJe, loc.lat, loc.lng, mpp, mSite]);

  // --- 95-04/05: selection tool on the map ---------------------------------------------
  // Map pan is off while selecting (a drag draws a frame or moves blocks); space held = pan,
  // wheel zoom stays. Points: map → canvas units → site metres (× mSite).
  const altRef = useRef(false);
  // The controller object changes on every render; the map listeners read it through this ref so
  // they are not re-subscribed mid-drag (which reset the "button down" state).
  const bbRef = useRef(bb);
  bbRef.current = bb;
  const hatBb = !!bb;
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    const auswahl = mode === "auswahl" && hatBb;
    if (auswahl) { map.dragPan.disable(); map.boxZoom.disable(); map.getCanvas().style.cursor = "default"; }
    else { map.dragPan.enable(); map.boxZoom.enable(); map.getCanvas().style.cursor = ""; }
    if (!auswahl) return undefined;
    const zuM = (/** @type {any} */ lngLat) => {
      const c = lngLatToCanvasPoint([lngLat.lng, lngLat.lat], loc.lat, loc.lng, mpp);
      return { x: c.x * mSite, y: c.y * mSite };
    };
    const mProPx = (/** @type {any} */ pt) => {
      const a = zuM(map.unproject([pt.x, pt.y])), b = zuM(map.unproject([pt.x + 10, pt.y]));
      return Math.hypot(b.x - a.x, b.y - a.y) / 10;
    };
    const tasten = (/** @type {any} */ e) => ({ umschalt: e.shiftKey, strg: e.ctrlKey || e.metaKey, alt: e.altKey });
    let leer = false, gedrueckt = false;
    const down = (/** @type {any} */ e) => {
      const oe = e.originalEvent;
      if (leer || oe.button !== 0) return;
      gedrueckt = true;
      bbRef.current?.runter(zuM(e.lngLat), { x: e.point.x, y: e.point.y }, tasten(oe), mProPx(e.point));
    };
    const move = (/** @type {any} */ e) => { if (gedrueckt) bbRef.current?.bewegen(zuM(e.lngLat), { x: e.point.x, y: e.point.y }, tasten(e.originalEvent)); };
    const up = (/** @type {any} */ e) => { if (!gedrueckt) return; gedrueckt = false; bbRef.current?.hoch(tasten(e)); };
    const taste = (/** @type {KeyboardEvent} */ e) => {
      altRef.current = e.altKey;
      if (e.code !== "Space" || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(/** @type {any} */ (e.target)?.tagName || "")) return;
      leer = e.type === "keydown";
      if (leer) { map.dragPan.enable(); e.preventDefault(); } else map.dragPan.disable();
    };
    map.on("mousedown", down);
    map.on("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", taste);
    window.addEventListener("keyup", taste);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", taste);
      window.removeEventListener("keyup", taste);
    };
  }, [mapReady, mode, hatBb, loc.lat, loc.lng, mpp, mSite]);

  // Rotate handle as a draggable marker above the selection.
  const griffRef = useRef(/** @type {any} */ (null));
  const griff = bb?.griff;
  useEffect(() => {
    const map = getMap();
    griffRef.current?.remove();
    griffRef.current = null;
    if (!map || !mapReady || !griff || !hatBb) return undefined;
    const el = document.createElement("div");
    el.dataset.testid = "sd-drehgriff";
    el.title = "Drehen (15°-Schritte, Alt = frei)";
    el.style.cssText = "width:16px;height:16px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 1px #92400e;cursor:grab;box-sizing:border-box;";
    const zuLl = (/** @type {{x:number,y:number}} */ q) => /** @type {[number, number]} */ (canvasPointToLngLat({ x: q.x / mSite, y: q.y / mSite }, loc.lat, loc.lng, mpp));
    const zuM = () => {
      const ll = m.getLngLat();
      const c = lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng, mpp);
      return { x: c.x * mSite, y: c.y * mSite };
    };
    // GRIFF_PX above the selection's top edge (screen offset, see useBlockBearbeitung).
    const m = new maplibregl.Marker({ element: el, draggable: true, offset: [0, -GRIFF_PX] }).setLngLat(zuLl(griff)).addTo(map);
    m.on("dragstart", () => bbRef.current?.griffRunter(zuM()));
    m.on("drag", () => bbRef.current?.bewegen(zuM(), { x: 0, y: 0 }, { alt: altRef.current }));
    m.on("dragend", () => bbRef.current?.hoch());
    griffRef.current = m;
    return () => { m.remove(); if (griffRef.current === m) griffRef.current = null; };
    // the marker is rebuilt when the handle position changes (after each commit, not per drag frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, griff?.x, griff?.y, hatBb, loc.lat, loc.lng, mpp, mSite]);

  // --- Klick zeichnet / platziert (Pan/Zoom bleibt frei) --------------------
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    const onClick = (e) => {
      // Zweitklick eines Doppelklicks verwerfen (Review-Fix: platzierte sonst
      // zwei identische Baukörper übereinander bzw. doppelte Draft-Punkte).
      if (e.originalEvent?.detail > 1) return;
      if (mode === "auswahl") return; // 95-04: the selection tool handles mousedown/up itself
      const lngLat = [e.lngLat.lng, e.lngLat.lat];
      const cpt = lngLatToCanvasPoint(lngLat, loc.lat, loc.lng, mpp);
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
  }, [mapReady, mode, draftGeo, insideParcel, onAddBuilding, onCloseDraft, setDraftGeo, loc.lat, loc.lng, mpp]);

  // 101-01: two/three clicks on the mouse wheel = zoom extents (whole parcel), CAD convention.
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    const mehrfach = mittelklickZaehler();
    const el = map.getCanvasContainer();
    const onMitte = (/** @type {MouseEvent} */ e) => {
      if (!mehrfach(e)) return;
      e.preventDefault();
      const ring = footprintToGeoJson(parcel.points, loc.lat, loc.lng, mpp).features[0]?.geometry?.coordinates?.[0];
      const bounds = ringBounds(ring);
      if (bounds) map.fitBounds(bounds, { padding: 60, duration: 300, maxZoom: 19 });
    };
    el.addEventListener("mousedown", onMitte);
    const ohneMenue = (/** @type {Event} */ e) => e.preventDefault(); // 101-07: no browser menu
    el.addEventListener("contextmenu", ohneMenue);
    return () => { el.removeEventListener("mousedown", onMitte); el.removeEventListener("contextmenu", ohneMenue); };
  }, [mapReady, parcel, loc.lat, loc.lng, mpp]);

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
          .setLngLat(/** @type {[number, number]} */ (canvasPointToLngLat(p, loc.lat, loc.lng, mpp)))
          .addTo(map);
        m.on("drag", () => {
          // Live-Vorschau direkt in der Source — Commit erst am Drag-Ende.
          const ll = m.getLngLat();
          const moved = lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng, mpp);
          const live = areas.map((ar) =>
            ar.id !== a.id ? ar : { ...ar, points: ar.points.map((q, i) => (i === idx ? moved : q)) }
          );
          map.getSource("sd-areas")?.setData(areasToGeoJson(live, loc.lat, loc.lng, mpp));
        });
        m.on("dragend", () => {
          const ll = m.getLngLat();
          onVertexCommit(a.id, idx, lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng, mpp));
        });
        areaMarkersRef.current.push(m);
      });
    }
    return () => clearMarkers(areaMarkersRef);
  }, [mapReady, areas, onVertexCommit, loc.lat, loc.lng, mpp]);

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
        canvasPointToLngLat(centroid(a.points), loc.lat, loc.lng, mpp),
        `${polygonAreaM2(a.points, parcel).toLocaleString("de-DE")} m²`,
        areaCss
      );
    }
    if (draftGeo.length >= 3) {
      const pts = draftGeo.map((q) => lngLatToCanvasPoint(q, loc.lat, loc.lng, mpp));
      addLabel(
        canvasPointToLngLat(centroid(pts), loc.lat, loc.lng, mpp),
        `${polygonAreaM2(pts, parcel).toLocaleString("de-DE")} m²`,
        areaCss
      );
    }
    for (const b of buildings) {
      addLabel(
        canvasPointToLngLat(
          { x: b.x + (b.width || 0) / 2, y: b.y + (b.height || 0) / 2 },
          loc.lat,
          loc.lng,
          mpp
        ),
        `${b.floors || 1}G`,
        "font:700 12px system-ui;color:#fff;text-shadow:0 0 3px #1e3a8a,0 0 5px #1e3a8a;"
      );
    }
    return () => clearMarkers(labelMarkersRef);
  }, [mapReady, areas, buildings, draftGeo, parcel, loc.lat, loc.lng, mpp]);

  return (
    <div
      className="relative w-full rounded-lg border overflow-hidden"
      // 72-01 A-1 (finding N-01): FIXED height instead of aspectRatio - inside
      // a hidden Radix tab the width is 0 and the ratio collapsed the frame to
      // 0 px, leaving the map a white box. [ASSUMED] 560 px map height, 420 px
      // floor (review sec.3 A-1: "feste Höhe").
      // 101-01: fills the window below the header and toolbar (was a fixed 560 px).
      style={{ height: "calc(100dvh - 190px)", minHeight: 460 }}
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
      {bb?.rahmen && (
        <div
          data-testid="sd-rahmen"
          data-modus={bb.rahmen.modus}
          className="pointer-events-none absolute"
          style={{
            left: Math.min(bb.rahmen.sa.x, bb.rahmen.sb.x), top: Math.min(bb.rahmen.sa.y, bb.rahmen.sb.y),
            width: Math.abs(bb.rahmen.sb.x - bb.rahmen.sa.x), height: Math.abs(bb.rahmen.sb.y - bb.rahmen.sa.y),
            border: `1.5px ${bb.rahmen.modus === "fenster" ? "solid" : "dashed"} #2563eb`,
            background: bb.rahmen.modus === "fenster" ? "rgba(37,99,235,0.08)" : "rgba(34,197,94,0.08)",
          }}
        />
      )}
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
  // 95-02: metres per canvas unit of THIS parcel — map, areas, buildings and map clicks all use it.
  const mpp = Number(parcel?.m_per_px) > 0 ? Number(parcel.m_per_px) : undefined;
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

  const [mode, setMode] = useState("building"); // building | polygon | auswahl (95-04)
  const [zeigeHoehen, setZeigeHoehen] = useState(false); // 101-01: demo heights hidden by default
  const [draft, setDraft] = useState([]);        // SVG-Fallback: {x,y}-Punkte
  const [draftGeo, setDraftGeo] = useState([]);  // Karten-Modus: [lng,lat]-Punkte
  // 75-06 Task 3 (MSB-3): role of the drawn polygon — "footprint" (default,
  // the existing behaviour: feeds the massing body) or "baufeld" (the building
  // envelope the Massing checks against). Legacy records all carry "footprint",
  // so no migration is needed. MUST sit above the !parcel early return
  // (rules of hooks).
  const [areaTyp, setAreaTyp] = useState("footprint");
  // 95-04…06: blocks in metres. mSite = metres per canvas unit (same scale as every area
  // figure here); the plot and the "baufeld" envelopes in metres are the snap targets and the
  // basis of the checks. Hooks above the !parcel early return (rules of hooks).
  const planRef = useRef(null);
  const mSite = metersPerPixel(parcel);
  const grenzeM = useMemo(
    () => (Array.isArray(parcel?.points) && parcel.points.length >= 3 ? parcel.points.map((q) => ({ x: q.x * mSite, y: q.y * mSite })) : null),
    [parcel?.points, mSite],
  );
  const baufelderM = useMemo(
    () => areas.filter((a) => a.type === "baufeld").map((a) => a.points.map((q) => ({ x: q.x * mSite, y: q.y * mSite }))),
    [areas, mSite],
  );
  const bb = useBlockBearbeitung({
    buildings, mpp: mSite, onChange: (next) => onBuildingsChange?.(next), aktiv: mode === "auswahl",
    grenzeM, baufelderM, containerRef: planRef,
  });
  const nummer = useMemo(() => Object.fromEntries(buildings.map((b, i) => [b.id, i + 1])), [buildings]);

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
    bb.commit([
      ...buildings,
      { id: `bld_${Date.now()}`, x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h, floors: defaults.geschosse },
    ]);
  };

  // 95-05: every building edit is one undo step (bb.commit).
  const removeBuilding = (id) => bb.commit(buildings.filter((b) => b.id !== id));
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
    const cpts = geoJsonToFootprint(draftGeo, loc.lat, loc.lng, mpp);
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
    if (mode === "auswahl") return; // 95-04: handled by the pointer handlers
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

  // 95-04/05: selection tool in the SVG fallback — view units × mSite = site metres.
  const tastenVon = (e) => ({ umschalt: e.shiftKey, strg: e.ctrlKey || e.metaKey, alt: e.altKey });
  const zuMeter = (e) => { const v = toView(e); return { x: v.x * mSite, y: v.y * mSite }; };
  const onSvgPointerDown = (e) => {
    if (mode !== "auswahl" || e.button !== 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    try { svgRef.current.setPointerCapture?.(e.pointerId); } catch (_) { /* noop */ }
    bb.runter(zuMeter(e), { x: e.clientX, y: e.clientY }, tastenVon(e), (VIEW_W / rect.width) * mSite);
  };

  const onPointerMove = (e) => {
    if (mode === "auswahl") { bb.bewegen(zuMeter(e), { x: e.clientX, y: e.clientY }, tastenVon(e)); return; }
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

  const endDrag = (e) => {
    dragRef.current = null;
    if (mode === "auswahl" && e?.type === "pointerup") bb.hoch(tastenVon(e));
  };

  const elevColorSvg = elevColor;
  // View units per screen pixel of the SVG plan (rotate handle in screen pixels); 1 before layout.
  const vjp = svgRef.current?.clientWidth ? VIEW_W / svgRef.current.clientWidth : 1;

  // BGF ≈ Grundfläche (px² → m² über den zentralen Maßstab) × Geschosse.
  const gfaApprox = bb.anzeige.reduce(
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
    <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-3">
      <Card className="border-0 shadow-none bg-transparent">
        <CardHeader className="p-0 pb-1.5 space-y-0">
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
              <Button size="sm" variant={mode === "auswahl" ? "default" : "outline"} data-testid="sd-modus-auswahl"
                onClick={() => { setMode("auswahl"); setDraft([]); setDraftGeo([]); }} aria-label={t("Auswahl-Modus")}>
                <MousePointer2 className="w-4 h-4 mr-1" /> {t("Auswahl")}
              </Button>
              <Button size="sm" variant="ghost" onClick={bb.rueckgaengig} disabled={!bb.kannZurueck} aria-label={t("Rückgängig")} title={t("Rückgängig") + " (Strg+Z)"} data-testid="sd-undo">
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={bb.wiederholen} disabled={!bb.kannVor} aria-label={t("Wiederholen")} title={t("Wiederholen") + " (Strg+Y)"} data-testid="sd-redo">
                <Redo2 className="w-4 h-4" />
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
              : mode === "auswahl" ? t("Klick wählt, Umschalt+Klick ergänzt; Rahmen nach rechts = ganz drin, nach links = berührt. Ziehen verschiebt (Strg = Kopie, Alt = ohne Fang), oranger Griff dreht, Pfeile 0,1 m (Umschalt 1 m), Entf löscht.")
              : "Klicke Stützpunkte; mit „Schließen\" oder Klick auf den Startpunkt abschließen. Eckpunkte ziehbar."}
            {hatKarte && (mode === "auswahl" ? ` ${t("Karte: Leertaste + Ziehen verschiebt die Ansicht, Scrollen zoomt.")}` : " Karte: Ziehen verschiebt, Scrollen zoomt — auch während des Zeichnens.")}
            {(bb.fangZiel || bb.winkel != null) && (
              <span className="ml-1 font-medium text-warnung" data-testid="sd-fang">
                {bb.winkel != null ? `${bb.winkel}°` : `${t("Fang")}: ${fangText(bb.fangZiel, t)}`}
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="p-0" ref={planRef} data-testid="sd-plan" data-auswahl={bb.auswahl.join(",")}>
          {hatKarte ? (
            <LageplanKarte
              loc={loc}
              styleKey={mapCtx?.style || "normal"}
              parcel={parcel}
              areas={areas}
              buildings={bb.anzeige}
              elevation={elevation}
              mode={mode}
              draftGeo={draftGeo}
              setDraftGeo={setDraftGeo}
              insideParcel={insideParcel}
              onAddBuilding={addBuilding}
              onCloseDraft={closeDraftGeo}
              onVertexCommit={commitVertex}
              bb={bb}
              mSite={mSite}
              zeigeHoehen={zeigeHoehen}
            />
          ) : (
          <div className="relative w-full rounded-lg border overflow-hidden" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className={`absolute inset-0 w-full h-full bg-slate-50 ${mode === "auswahl" ? "cursor-default" : "cursor-crosshair"}`}
            onClick={handleSvgClick}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <polygon
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(16,185,129,0.06)" stroke="#10b981" strokeWidth="3" strokeDasharray="8 6"
            />
            {zeigeHoehen && elevation.map((e) => (
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

            {/* 95-06: setback strips (study) while selecting */}
            {mode === "auswahl" && Object.values(bb.pruefung.je).flatMap((j, i) => j.streifen.map((st, k) => (
              <polygon key={`${i}-${k}`} points={st.pts.map((q) => `${q.x / mSite},${q.y / mSite}`).join(" ")}
                fill={st.conflict ? "rgba(239,68,68,0.16)" : "rgba(34,197,94,0.14)"} stroke={st.conflict ? "#dc2626" : "#16a34a"} strokeWidth="1" strokeDasharray="4 4" pointerEvents="none" />
            )))}

            {/* placed buildings — 95-04: rotated polygons, selection amber, conflict red */}
            {bb.anzeige.filter((b) => b.width > 0 && b.height > 0).map((b) => {
              const k = alsBlock(b, mSite);
              const j = bb.pruefung.je[b.id];
              const konflikt = !!j && (j.ausserhalb || j.grenzKonflikt || j.ueberlappt.length > 0 || j.abstandZu.length > 0);
              const sel = bb.auswahl.includes(b.id);
              return (
                <g key={b.id} data-testid="sd-block" data-id={b.id} data-sel={sel ? "1" : "0"} data-mitte={`${k.cx.toFixed(2)},${k.cy.toFixed(2)}`} data-drehung={Math.round(k.drehung)}>
                  <polygon points={ecken(k).map((q) => `${q.x / mSite},${q.y / mSite}`).join(" ")}
                    fill={konflikt ? "#ef4444" : "#3b82f6"} fillOpacity="0.75" stroke={sel ? "#f59e0b" : "#1e3a8a"} strokeWidth={sel ? 4 : 2} />
                  <text x={k.cx / mSite} y={k.cy / mSite} textAnchor="middle" dominantBaseline="middle" fontSize="20" fill="white" pointerEvents="none">
                    {b.floors}G
                  </text>
                </g>
              );
            })}
            {bb.rahmen && (
              <rect data-testid="sd-rahmen" data-modus={bb.rahmen.modus}
                x={Math.min(bb.rahmen.a.x, bb.rahmen.b.x) / mSite} y={Math.min(bb.rahmen.a.y, bb.rahmen.b.y) / mSite}
                width={Math.abs(bb.rahmen.b.x - bb.rahmen.a.x) / mSite} height={Math.abs(bb.rahmen.b.y - bb.rahmen.a.y) / mSite}
                fill={bb.rahmen.modus === "fenster" ? "rgba(37,99,235,0.08)" : "rgba(34,197,94,0.08)"} stroke="#2563eb" strokeWidth="1.5"
                strokeDasharray={bb.rahmen.modus === "fenster" ? undefined : "6 4"} pointerEvents="none" />
            )}
            {bb.griff && (
              <line x1={bb.griff.x / mSite} y1={bb.griff.y / mSite} x2={bb.griff.x / mSite} y2={bb.griff.y / mSite - GRIFF_PX * vjp}
                stroke="#f59e0b" strokeWidth={1.5 * vjp} pointerEvents="none" />
            )}
            {bb.griff && (
              <circle data-testid="sd-drehgriff" cx={bb.griff.x / mSite} cy={bb.griff.y / mSite - GRIFF_PX * vjp} r={8 * vjp} fill="#f59e0b" stroke="#fff" strokeWidth={2.5 * vjp} style={{ cursor: "grab" }}
                onPointerDown={(e) => { e.stopPropagation(); try { svgRef.current.setPointerCapture?.(e.pointerId); } catch (_) { /* noop */ } bb.griffRunter(zuMeter(e)); }}>
                <title>{t("Drehen (15°-Schritte, Alt = frei)")}</title>
              </circle>
            )}
          </svg>
          </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3 text-sm">
        <Card className="shadow-none">
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
            {elevation.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={zeigeHoehen} onChange={(e) => setZeigeHoehen(e.target.checked)} data-testid="sd-hoehen" />
                {t("Demo-Höhenpunkte zeigen")} ({elevation.length})
              </label>
            )}
            <BlockPruefung pruefung={bb.pruefung} nummer={nummer} t={t} />
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
            {t("Wird automatisch gespeichert, sobald Projektname und Standort gesetzt sind.")}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Baukörper</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {buildings.length === 0 && <p className="text-sm text-slate-500">Noch keine. Klicke in den Plan.</p>}
            {buildings.map((b, i) => (
              <div key={b.id} className={`flex items-center justify-between text-sm border rounded px-2 py-1 ${bb.auswahl.includes(b.id) ? "border-warnung-rand bg-warnung-flaeche" : ""}`}>
                <button type="button" className="text-left flex-1" data-testid="sd-block-eintrag"
                  onClick={(e) => { setMode("auswahl"); bb.setAuswahl(e.shiftKey ? [...new Set([...bb.auswahl, b.id])] : [b.id]); }}>
                  Baukörper {i + 1} · {b.floors} Gesch.{b.drehung_grad ? ` · ${Math.round(b.drehung_grad)}°` : ""}
                </button>
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

/** Snap target name → short German label (UI). */
function fangText(ziel, t) {
  const teil = { grenze: t("Grenze"), abstand: t("Abstandsfläche"), baufeld: t("Baufeld"), block: t("anderer Block"), kante: t("Kante"), ecke: t("Ecke") };
  return String(ziel || "").split("+").map((z) => teil[z] || z).join(" + ");
}

/**
 * 95-06: check after each move — GRZ/GFZ over all blocks and the conflicts per block. Study:
 * storey height 3.0 m, setback 0.4 H / min. 3 m [ASSUMED], same functions as the Massing-Studio.
 * `warn` look only (amber/red text), never a legal "ok": without a plot nothing is checkable.
 */
function BlockPruefung({ pruefung, nummer, t }) {
  if (!pruefung || !Object.keys(pruefung.je).length) return null;
  const meldungen = [];
  for (const [id, j] of Object.entries(pruefung.je)) {
    const n = nummer[id] ?? "?";
    if (j.ausserhalb) meldungen.push(`${t("Baukörper")} ${n}: ${t("liegt nicht ganz auf dem Grundstück")}`);
    if (j.grenzKonflikt) meldungen.push(`${t("Baukörper")} ${n}: ${t("Abstandsfläche reicht über die Grenze")}`);
    if (j.ueberlappt.length) meldungen.push(`${t("Baukörper")} ${n}: ${t("überlappt")} ${j.ueberlappt.map((o) => nummer[o] ?? "?").join(", ")}`);
    if (j.abstandZu.length) meldungen.push(`${t("Baukörper")} ${n}: ${t("Abstandsfläche trifft")} ${j.abstandZu.map((o) => nummer[o] ?? "?").join(", ")}`);
  }
  return (
    <div className="mt-2 space-y-1 rounded border border-border p-2 text-xs" data-testid="sd-pruefung">
      <div className="font-semibold text-foreground">{t("Prüfung (Studie)")}</div>
      {pruefung.pruefbar ? (
        <div className="text-muted-foreground">
          GRZ <b className={pruefung.grzUeber ? "text-fehler" : ""}>{pruefung.grz.toFixed(2)}</b>
          {" · "}GFZ <b className={pruefung.gfzHoch ? "text-warnung" : ""}>{pruefung.gfz.toFixed(2)}</b>
          <span className="text-muted-foreground"> · {t("Richtwerte 0,4 / 1,2")}</span>
        </div>
      ) : (
        <div className="text-warnung">{t("Ohne Grundstück nicht prüfbar.")}</div>
      )}
      {meldungen.length > 0 ? (
        <details open={meldungen.length <= 3} className="text-fehler">
          <summary className="cursor-pointer font-medium">{meldungen.length} {t("Konflikte")}</summary>
          <ul className="mt-1 space-y-0.5" data-testid="sd-konflikte">
            {meldungen.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </details>
      ) : pruefung.pruefbar && (
        <div className="text-muted-foreground">{t("Keine Konflikte gefunden — Abstandsflächen 0,4 H, mind. 3 m, Geschoss 3,0 m [Annahme].")}</div>
      )}
    </div>
  );
}
