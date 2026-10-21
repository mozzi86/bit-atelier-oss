import React, { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Building, Trash2, MousePointerClick, MousePointer2, PenTool, Check, Undo2, Redo2, Route, Download } from "lucide-react";
import { polygonAreaM2, centroid, pxAreaToM2, pxToM, mToPx, pointInPolygon, metersPerPixel } from "@core/lib/geo";
// 95-04…06: blocks as objects in metres — selection, move/copy/rotate, snapping, checks.
import { alsBlock, ecken } from "@core/lib/massing/bloecke";
import { riegelLayout, WOHNUNGSTYPEN, MIX_VORLAGEN, RIEGEL_STANDARD } from "@core/lib/massing/riegel";
import { useBlockBearbeitung } from "@designer/lib/useBlockBearbeitung";
import Befehlszeile from "@core/components/Befehlszeile";
import { eckeVerschieben, eckeEinfuegen, eckeLoeschen, kanteVerschieben, kantenMitten } from "@core/lib/polygonBearbeiten";
import { useKontextmenue, KontextmenueAnzeige } from "@core/components/Kontextmenue";
// 104-05: object snap — the same core and switches as the Massing modeller.
import FangGlyphe, { strahlEnden } from "@core/components/FangGlyphe";
import { fangIndex, fangPunkt } from "@core/lib/objektfang.js";
import { useFangEinstellungen, useFangTasten, fangEinstellungen, fangKontextEintraege, fangSchalter } from "@core/lib/fangEinstellungen.js";
import { lageplanFangSegmente, LAGEPLAN_FANG_PX, QUELLE_GRUNDSTUECK, QUELLE_ENTWURF } from "@designer/lib/lageplanFang";
import { baufeldAufforderung } from "@core/lib/befehlszeile";
import { mittelklickZaehler } from "@core/lib/mittelklick";
import { useI18n } from "@core/lib/i18n";
import { baukoerperDefaults, baukoerperAusZug, baukoerperKennwerte } from "@designer/lib/siteParcel";
// 75-06 Task 2 (D-P75-04): GeoJSON parcel import — pure parse, no dependency.
// 101-03: DXF parcels (own reader) and the union of several parcels into one plot boundary.
import { flurstueckeAusGeoJson, flurstueckeAusDxf, grundstueckAusFlurstuecken } from "@designer/lib/flurstueckImport";
// 104-06: site plan as DXF R12 (own writer, no dependency).
import { lageplanDxfDaten, dxfDatei, dxfDateiname, DXF_MIME } from "@designer/lib/dxfPlaene";
import { dateiAnbieten } from "@core/lib/tabellenExport";
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

/**
 * 101-02: official parcel boundaries of Bavaria as a map layer — WMS "ALKIS-Parzellarkarte", layer
 * "Umring, Schwarz" (lines only), OpenData CC BY 4.0 (geodatenonline.bayern.de, checked 18.10.2026).
 * Boundaries only as an image (no parcel numbers); vector parcels need the paid ALKIS products.
 */
const KATASTER_BY_URL = "https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
  + "&LAYERS=by_alkis_parzellarkarte_umr_schwarz&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256"
  + "&BBOX={bbox-epsg-3857}";
const KATASTER_BY_QUELLE = "Flurstücke: © Bayerische Vermessungsverwaltung (CC BY 4.0)";
/**
 * Rough bounding box of Bavaria (WGS84) — the cadastral layer is offered there. [ASSUMED] box, not the border.
 * @param {{lat?: number|null, lng?: number|null}|null|undefined} l
 */
export function inBayern(l) {
  return l?.lat != null && l?.lng != null && l.lat >= 47.2 && l.lat <= 50.6 && l.lng >= 8.9 && l.lng <= 13.9;
}

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

/**
 * 101-04: building label on the site plan, two lines: "3 Geschosse" / "900 m² BGF" (was "3G").
 * @param {any} b building (canvas units)
 * @param {any} parcel site_parcel (scale)
 * @param {(s: string) => string} t i18n
 */
function baukoerperText(b, parcel, t) {
  const k = baukoerperKennwerte(b, parcel);
  return `${k.geschosse} ${t(k.geschosse === 1 ? "Geschoss" : "Geschosse")}\n${k.bgfM2.toLocaleString("de-DE")} m² ${t("BGF")}`;
}

/**
 * 101-04: label of a bar / perimeter block, two lines: "Blockrand · 5 Geschosse" / "48 WE · 3.450 m² BGF".
 * @param {{geschlossen?: boolean}} r stored bar
 * @param {{geschosse: number, wohnungen: number, bgf: number}} k key figures of riegelLayout
 * @param {(s: string) => string} t i18n
 */
function riegelText(r, k, t) {
  return `${t(r.geschlossen ? "Blockrand" : "Riegel")} · ${k.geschosse} ${t("Geschosse")}\n${k.wohnungen} ${t("WE")} · ${Math.round(k.bgf).toLocaleString("de-DE")} m² ${t("BGF")}`;
}

/** Mean of the path points (label position; for a ring the middle of the courtyard). */
function punktMitte(/** @type {Array<{x:number,y:number}>} */ pts) {
  return { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length };
}

// Interaktiver Lageplan auf der echten Karte (Phase 36, KARTE-03): Zeichnen,
// Vertex-Drag und Baukörper-Setzen laufen direkt in Karten-Koordinaten.
// 101-04: CAD navigation — the left button only draws/places/selects; pressed wheel or
// space + drag pans, the wheel zooms.
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
  onKontext = null,
  zeigeKataster = false,
  onParcelPunkte = null,
  onAufziehen = null,
  riegelGeo = null,
  onRiegelPunkt = null,
  onRiegelFertig = null,
  parcelSichtbar = true,
  fangen = null,
}) {
  const { t } = useI18n();
  const onKontextRef = useRef(onKontext);
  onKontextRef.current = onKontext;
  // 104-05: object snap on the map — `fangen` (site metres in → snap result in metres) through a ref, so the
  // marker effects are not rebuilt when the snap geometry changes; the glyph is an SVG overlay in screen pixels.
  const fangenRef = useRef(fangen);
  fangenRef.current = fangen;
  const [fangKarte, setFangKarte] = useState(/** @type {{x:number,y:number,art:string,strahl:any}|null} */ (null));
  const altFangRef = useRef(false);
  useEffect(() => {
    const h = (/** @type {KeyboardEvent} */ e) => { altFangRef.current = e.altKey; };
    window.addEventListener("keydown", h);
    window.addEventListener("keyup", h);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("keyup", h); };
  }, []);
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

  /**
   * 104-05: snap a map position. Map → canvas units → site metres (× mSite) → snap core → back. The capture
   * distance follows the zoom (LAGEPLAN_FANG_PX screen pixels in metres at that point).
   * @param {any} map MapLibre map
   * @param {{lng: number, lat: number}} lngLat raw position
   * @param {{basisLl?: [number, number]|null, ausser?: string[]|null, alt?: boolean}} [o] base point of polar /
   *   ortho tracking (lng/lat), snap sources to ignore, alt = no snapping
   * @returns {{c: {x:number,y:number}, ll: [number, number], anz: {x:number,y:number,art:string,strahl:any}|null}}
   *   c canvas units, ll lng/lat, anz glyph in screen pixels (null = nothing to show)
   */
  const kartenFang = (map, lngLat, { basisLl = null, ausser = null, alt = false } = {}) => {
    const zuC = (/** @type {[number, number]} */ ll) => lngLatToCanvasPoint(ll, loc.lat, loc.lng, mpp);
    const c = zuC([lngLat.lng, lngLat.lat]);
    const roh = { c, ll: /** @type {[number, number]} */ ([lngLat.lng, lngLat.lat]), anz: null };
    const f = fangenRef.current;
    if (!f) return roh;
    const pt = map.project([lngLat.lng, lngLat.lat]);
    const ll10 = map.unproject([pt.x + 10, pt.y]);
    const c10 = zuC([ll10.lng, ll10.lat]);
    const mProPx = (Math.hypot(c10.x - c.x, c10.y - c.y) * mSite) / 10;
    const b = basisLl ? zuC(basisLl) : null;
    const r = f({ x: c.x * mSite, y: c.y * mSite }, { basis: b ? { x: b.x * mSite, y: b.y * mSite } : null, ausser, aus: alt, mProPx });
    if (!r) return roh;
    const c2 = { x: r.punkt.x / mSite, y: r.punkt.y / mSite };
    const ll2 = /** @type {[number, number]} */ (canvasPointToLngLat(c2, loc.lat, loc.lng, mpp));
    const p2 = map.project(ll2);
    let strahl = null;
    if (r.strahl) {
      const v = map.project(canvasPointToLngLat({ x: r.strahl.von.x / mSite, y: r.strahl.von.y / mSite }, loc.lat, loc.lng, mpp));
      strahl = strahlEnden({ x: v.x, y: v.y }, { x: p2.x, y: p2.y }, 40, r.strahl.winkel_grad);
    }
    return { c: c2, ll: ll2, anz: { x: p2.x, y: p2.y, art: r.art, strahl } };
  };

  // Layer-Fundament je Map-Instanz; Reihenfolge wie im alten SVG:
  // Parzelle → Höhenpunkte → Baufelder → Draft → Baukörper.
  const onLayersReady = (map) => {
    const addSrc = (id) =>
      map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // 101-02: official parcel boundaries (Bavaria) under everything we draw.
    map.addSource("sd-kataster", { type: "raster", tiles: [KATASTER_BY_URL], tileSize: 256, attribution: KATASTER_BY_QUELLE, maxzoom: 20 });
    map.addLayer({ id: "sd-kataster", type: "raster", source: "sd-kataster", minzoom: 14, layout: { visibility: zeigeKataster ? "visible" : "none" }, paint: { "raster-opacity": 0.85 } });
    ["sd-parcel", "sd-elev", "sd-areas", "sd-draft", "sd-abstand", "sd-riegel", "sd-buildings"].forEach(addSrc);
    map.addLayer({ id: "sd-parcel-fill", type: "fill", source: "sd-parcel", paint: { "fill-color": "#10b981", "fill-opacity": 0.06 } });
    map.addLayer({ id: "sd-parcel-line", type: "line", source: "sd-parcel", paint: { "line-color": "#10b981", "line-width": 3, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "sd-elev-circle", type: "circle", source: "sd-elev", paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-opacity": 0.8 } });
    map.addLayer({ id: "sd-areas-fill", type: "fill", source: "sd-areas", paint: { "fill-color": "#0d9488", "fill-opacity": 0.28 } });
    map.addLayer({ id: "sd-areas-line", type: "line", source: "sd-areas", paint: { "line-color": "#0d9488", "line-width": 2.5 } });
    map.addLayer({ id: "sd-draft-line", type: "line", source: "sd-draft", paint: { "line-color": "#14b8a6", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    // 95-06: setback strips (study) under the blocks — green = fine, red = conflict.
    map.addLayer({ id: "sd-abstand-fill", type: "fill", source: "sd-abstand", paint: { "fill-color": ["case", ["get", "konflikt"], "#ef4444", "#22c55e"], "fill-opacity": 0.16 } });
    map.addLayer({ id: "sd-abstand-line", type: "line", source: "sd-abstand", paint: { "line-color": ["case", ["get", "konflikt"], "#dc2626", "#16a34a"], "line-width": 1, "line-dasharray": [2, 2] } });
    // 101-04: bars / perimeter blocks — units coloured by type (WOHNUNGSTYPEN), corridor grey.
    map.addLayer({ id: "sd-riegel-fill", type: "fill", source: "sd-riegel", paint: { "fill-color": ["get", "farbe"], "fill-opacity": 0.85 } });
    map.addLayer({ id: "sd-riegel-line", type: "line", source: "sd-riegel", paint: { "line-color": "#334155", "line-width": 0.6 } });
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
    // Nutzer 19.10.: the estimated start square is not drawn ("Quadrat weg") — only a drawn / imported plot.
    map?.getSource("sd-parcel")?.setData(parcelSichtbar ? footprintToGeoJson(parcel.points, loc.lat, loc.lng, mpp) : { type: "FeatureCollection", features: [] });
  }, [mapReady, parcel, loc.lat, loc.lng, parcelSichtbar]);

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

  // --- 101-04: bars / perimeter blocks: areas → source, path points as draggable markers ----------
  const riegelMarkerRef = useRef(/** @type {any[]} */ ([]));
  const onRiegelPunktRef = useRef(onRiegelPunkt);
  onRiegelPunktRef.current = onRiegelPunkt;
  const onRiegelFertigRef = useRef(onRiegelFertig);
  onRiegelFertigRef.current = onRiegelFertig;
  useEffect(() => {
    const map = getMap();
    const features = (riegelGeo?.flaechen || []).map((f) => {
      const g = footprintToGeoJson(f.pts, loc.lat, loc.lng, mpp).features[0];
      return g ? { ...g, properties: { farbe: f.farbe } } : null;
    }).filter(Boolean);
    map?.getSource("sd-riegel")?.setData({ type: "FeatureCollection", features });
  }, [mapReady, riegelGeo, loc.lat, loc.lng, mpp]);
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady || !onRiegelPunktRef.current) return undefined;
    clearMarkers(riegelMarkerRef);
    for (const q of riegelGeo?.punkte || []) {
      const el = vertexElement();
      el.style.borderColor = "#7c3aed";
      el.dataset.testid = "sd-riegel-punkt";
      el.title = "Punkt ziehen";
      const m = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(/** @type {[number, number]} */ (canvasPointToLngLat(q.p, loc.lat, loc.lng, mpp))).addTo(map);
      // 104-05: the dragged point snaps (outlines of everything except its own bar)
      m.on("drag", () => { const f = kartenFang(map, m.getLngLat(), { ausser: [q.id], alt: altFangRef.current }); m.setLngLat(f.ll); setFangKarte(f.anz); });
      m.on("dragend", () => {
        setFangKarte(null);
        const ll = m.getLngLat();
        onRiegelPunktRef.current?.(q.id, q.idx, lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng, mpp));
      });
      riegelMarkerRef.current.push(m);
    }
    return () => clearMarkers(riegelMarkerRef);
  }, [mapReady, riegelGeo, loc.lat, loc.lng, mpp]);

  // --- 101-04: CAD navigation in every tool ------------------------------------------------
  // The left button never pans (it draws, places or selects). Pressed wheel + drag = pan,
  // space held + drag = pan (as in the 2D plans), wheel = zoom. User 18.10.2026: "Pan über
  // gedrücktes Mausrad".
  const leerRef = useRef(false);
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    map.dragPan.disable();
    map.boxZoom.disable();
    const canvas = map.getCanvas();
    const zeiger = () => { canvas.style.cursor = leerRef.current ? "grab" : mode === "auswahl" ? "default" : "crosshair"; };
    zeiger();
    const el = map.getCanvasContainer();
    let mitte = /** @type {{x:number,y:number}|null} */ (null);
    const runter = (/** @type {MouseEvent} */ e) => {
      if (e.button !== 1) return;
      e.preventDefault(); // no browser auto-scroll
      mitte = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
    };
    const bewegen = (/** @type {MouseEvent} */ e) => {
      if (!mitte) return;
      map.panBy([mitte.x - e.clientX, mitte.y - e.clientY], { duration: 0 });
      mitte = { x: e.clientX, y: e.clientY };
    };
    const hoch = (/** @type {MouseEvent} */ e) => { if (mitte && e.button === 1) { mitte = null; zeiger(); } };
    const taste = (/** @type {KeyboardEvent} */ e) => {
      if (e.code !== "Space" || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(/** @type {any} */ (e.target)?.tagName || "")) return;
      const an = e.type === "keydown";
      if (an) e.preventDefault();
      if (an === leerRef.current) return;
      leerRef.current = an;
      if (an) map.dragPan.enable(); else map.dragPan.disable();
      zeiger();
    };
    el.addEventListener("mousedown", runter);
    window.addEventListener("mousemove", bewegen);
    window.addEventListener("mouseup", hoch);
    window.addEventListener("keydown", taste);
    window.addEventListener("keyup", taste);
    return () => {
      el.removeEventListener("mousedown", runter);
      window.removeEventListener("mousemove", bewegen);
      window.removeEventListener("mouseup", hoch);
      window.removeEventListener("keydown", taste);
      window.removeEventListener("keyup", taste);
      leerRef.current = false;
    };
  }, [mapReady, mode]);

  // --- 95-04/05: selection tool on the map ---------------------------------------------
  // A drag draws a frame or moves blocks (navigation: see above). Points: map → canvas units →
  // site metres (× mSite).
  const altRef = useRef(false);
  // The controller object changes on every render; the map listeners read it through this ref so
  // they are not re-subscribed mid-drag (which reset the "button down" state).
  const bbRef = useRef(bb);
  bbRef.current = bb;
  const hatBb = !!bb;
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    if (mode !== "auswahl" || !hatBb) return undefined;
    const zuM = (/** @type {any} */ lngLat) => {
      const c = lngLatToCanvasPoint([lngLat.lng, lngLat.lat], loc.lat, loc.lng, mpp);
      return { x: c.x * mSite, y: c.y * mSite };
    };
    const mProPx = (/** @type {any} */ pt) => {
      const a = zuM(map.unproject([pt.x, pt.y])), b = zuM(map.unproject([pt.x + 10, pt.y]));
      return Math.hypot(b.x - a.x, b.y - a.y) / 10;
    };
    const tasten = (/** @type {any} */ e) => ({ umschalt: e.shiftKey, strg: e.ctrlKey || e.metaKey, alt: e.altKey });
    let gedrueckt = false;
    const down = (/** @type {any} */ e) => {
      const oe = e.originalEvent;
      if (leerRef.current || oe.button !== 0) return;
      gedrueckt = true;
      bbRef.current?.runter(zuM(e.lngLat), { x: e.point.x, y: e.point.y }, tasten(oe), mProPx(e.point));
    };
    const move = (/** @type {any} */ e) => { if (gedrueckt) bbRef.current?.bewegen(zuM(e.lngLat), { x: e.point.x, y: e.point.y }, tasten(e.originalEvent)); };
    const up = (/** @type {any} */ e) => { if (!gedrueckt) return; gedrueckt = false; bbRef.current?.hoch(tasten(e)); };
    const taste = (/** @type {KeyboardEvent} */ e) => { altRef.current = e.altKey; };
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

  // --- 101-04: building tool — a drag pulls a building open --------------------------------
  // A plain click keeps the standard size (click handler below): MapLibre fires "click" only
  // below its click tolerance of 3 px, the drag here only from 3 px on — never both.
  const aufziehenRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const onAufziehenRef = useRef(onAufziehen);
  onAufziehenRef.current = onAufziehen;
  const insideRef = useRef(insideParcel);
  insideRef.current = insideParcel;
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady || mode !== "building") return undefined;
    const zuCanvas = (/** @type {any} */ ll) => lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng, mpp);
    const punkt = (/** @type {MouseEvent} */ e) => {
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    let start = /** @type {{c:{x:number,y:number}, p:{x:number,y:number}}|null} */ (null);
    const down = (/** @type {any} */ e) => {
      const oe = e.originalEvent;
      if (leerRef.current || oe.button !== 0 || oe.target !== map.getCanvas()) return;
      const c = zuCanvas(e.lngLat);
      if (!insideRef.current(c.x, c.y)) return;
      start = { c, p: { x: e.point.x, y: e.point.y } };
    };
    const move = (/** @type {MouseEvent} */ e) => {
      const box = aufziehenRef.current;
      if (!start || !box) return;
      const p = punkt(e);
      const dx = p.x - start.p.x, dy = p.y - start.p.y;
      if (Math.hypot(dx, dy) < 3) { box.style.display = "none"; return; }
      const c = zuCanvas(map.unproject([p.x, p.y]));
      const m = (/** @type {number} */ v) => (Math.abs(v) * mSite).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      Object.assign(box.style, {
        display: "flex", left: `${Math.min(p.x, start.p.x)}px`, top: `${Math.min(p.y, start.p.y)}px`,
        width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px`,
      });
      box.textContent = `${m(c.x - start.c.x)} × ${m(c.y - start.c.y)} m`;
    };
    const up = (/** @type {MouseEvent} */ e) => {
      if (!start) return;
      const s0 = start;
      start = null;
      if (aufziehenRef.current) aufziehenRef.current.style.display = "none";
      const p = punkt(e);
      if (Math.hypot(p.x - s0.p.x, p.y - s0.p.y) < 3) return; // a click: standard size via the click handler
      onAufziehenRef.current?.(s0.c, zuCanvas(map.unproject([p.x, p.y])));
    };
    map.on("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      map.off("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [mapReady, mode, loc.lat, loc.lng, mpp, mSite]);

  // --- Klick zeichnet / platziert ------------------------------------------------
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady) return undefined;
    const onClick = (e) => {
      // Zweitklick eines Doppelklicks verwerfen (Review-Fix: platzierte sonst
      // zwei identische Baukörper übereinander bzw. doppelte Draft-Punkte).
      if (e.originalEvent?.detail > 1) return;
      if (mode === "auswahl") return; // 95-04: the selection tool handles mousedown/up itself
      if (mode === "polygon" || mode === "riegel") {
        // Klick nahe am Startpunkt (Screen-Px) schließt das Polygon (101-04: beim Riegel = Blockrand).
        if (draftGeo.length >= 3) {
          const p0 = map.project(draftGeo[0]);
          if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 14) {
            onCloseDraft();
            return;
          }
        }
        // 104-05: the set point snaps (object snap, polar tracking from the previous point, grid; Alt = free)
        const f = kartenFang(map, e.lngLat, { basisLl: draftGeo[draftGeo.length - 1] || null, alt: !!e.originalEvent?.altKey });
        if (!insideParcel(f.c.x, f.c.y)) return;
        setDraftGeo((d) => [...d, f.ll]);
      } else {
        const cpt = lngLatToCanvasPoint([e.lngLat.lng, e.lngLat.lat], loc.lat, loc.lng, mpp);
        if (!insideParcel(cpt.x, cpt.y)) return;
        onAddBuilding(cpt.x, cpt.y);
      }
    };
    // 101-04: a double-click finishes an open bar (its first click already set the last point).
    const onDoppel = () => { if (mode === "riegel") onRiegelFertigRef.current?.(false); };
    map.on("click", onClick);
    map.on("dblclick", onDoppel);
    // 104-05: the click handler only exists once the style has loaded (with blocked tiles via the fallback
    // style, i.e. late). Mark the map container while it is attached, so tests can wait for it instead of
    // clicking into a map that does not listen yet.
    const behaelter = map.getContainer();
    behaelter.dataset.klickBereit = "1";
    return () => { map.off("click", onClick); map.off("dblclick", onDoppel); delete behaelter.dataset.klickBereit; };
    // kartenFang reads the snap function through a ref and the scale from these deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, draftGeo, insideParcel, onAddBuilding, onCloseDraft, setDraftGeo, loc.lat, loc.lng, mpp, mSite]);

  // 104-05: snap glyph while drawing a polygon / bar (hover = where the next click goes).
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady || (mode !== "polygon" && mode !== "riegel")) { setFangKarte(null); return undefined; }
    const move = (/** @type {any} */ e) => {
      const f = kartenFang(map, e.lngLat, { basisLl: draftGeo[draftGeo.length - 1] || null, alt: !!e.originalEvent?.altKey });
      setFangKarte(f.anz);
    };
    const raus = () => setFangKarte(null);
    map.on("mousemove", move);
    map.on("mouseout", raus);
    return () => { map.off("mousemove", move); map.off("mouseout", raus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, draftGeo, loc.lat, loc.lng, mpp, mSite]);

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
    return () => el.removeEventListener("mousedown", onMitte);
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

  // 101-02: cadastral layer on/off.
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady || !map.getLayer("sd-kataster")) return;
    map.setLayoutProperty("sd-kataster", "visibility", zeigeKataster ? "visible" : "none");
  }, [mapReady, zeigeKataster]);

  // 101-02: the plot boundary is editable — one draggable handle per corner (live preview, commit on drop).
  // 101-02(b): the plot boundary is fully editable — corners (drag = move, double-click = delete) and edge
  // handles "+" (click = insert a corner, drag = move the edge parallel). Live preview, commit on drop.
  const parcelMarkerRef = useRef(/** @type {any[]} */ ([]));
  // Latest callback through a ref: the markers are rebuilt only when the plot changes, not on every render
  // (a rebuild during a drag would drop the grabbed handle).
  const onParcelPunkteRef = useRef(onParcelPunkte);
  onParcelPunkteRef.current = onParcelPunkte;
  const parcelEditierbar = !!onParcelPunkte;
  useEffect(() => {
    const map = getMap();
    if (!map || !mapReady || !parcelEditierbar) return undefined;
    clearMarkers(parcelMarkerRef);
    const pts = parcel.points;
    const zuLl = (/** @type {{x:number,y:number}} */ q) => /** @type {[number, number]} */ (canvasPointToLngLat(q, loc.lat, loc.lng, mpp));
    const zuCanvas = (/** @type {any} */ ll) => lngLatToCanvasPoint([ll.lng, ll.lat], loc.lat, loc.lng, mpp);
    const vorschau = (/** @type {Array<{x:number,y:number}>} */ neu) => map.getSource("sd-parcel")?.setData(footprintToGeoJson(neu, loc.lat, loc.lng, mpp));
    const setzen = (/** @type {Array<{x:number,y:number}>} */ neu) => onParcelPunkteRef.current?.(neu);
    pts.forEach((p, idx) => {
      const el = vertexElement();
      el.style.borderColor = "#059669";
      el.title = "Ecke ziehen · Doppelklick löscht";
      el.dataset.testid = "sd-parcel-ecke";
      el.addEventListener("dblclick", (ev) => { ev.stopPropagation(); ev.preventDefault(); setzen(eckeLoeschen(pts, idx)); });
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(zuLl(p)).addTo(map);
      // 104-05: the corner snaps to the other outlines (not to the plot's own edges)
      m.on("drag", () => {
        const f = kartenFang(map, m.getLngLat(), { ausser: [QUELLE_GRUNDSTUECK], alt: altFangRef.current });
        m.setLngLat(f.ll);
        setFangKarte(f.anz);
        vorschau(eckeVerschieben(pts, idx, f.c));
      });
      m.on("dragend", () => { setFangKarte(null); setzen(eckeVerschieben(pts, idx, zuCanvas(m.getLngLat()))); });
      parcelMarkerRef.current.push(m);
    });
    kantenMitten(pts).forEach((mitte, idx) => {
      const el = document.createElement("div");
      el.textContent = "+";
      el.title = "Klick: Ecke einfügen · Ziehen: Kante verschieben";
      el.dataset.testid = "sd-parcel-kante";
      el.style.cssText = "width:16px;height:16px;border-radius:4px;background:#ecfdf5;border:2px solid #059669;color:#047857;"
        + "font:700 13px/12px system-ui;text-align:center;cursor:move;box-sizing:border-box;user-select:none;";
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(zuLl(mitte)).addTo(map);
      let gezogen = false;
      m.on("dragstart", () => { gezogen = true; });
      const delta = () => { const c = zuCanvas(m.getLngLat()); return { x: c.x - mitte.x, y: c.y - mitte.y }; };
      m.on("drag", () => vorschau(kanteVerschieben(pts, idx, delta())));
      m.on("dragend", () => setzen(kanteVerschieben(pts, idx, delta())));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (gezogen) { gezogen = false; return; } // the browser still fires a click after a drag
        setzen(eckeEinfuegen(pts, idx));
      });
      parcelMarkerRef.current.push(m);
    });
    return () => clearMarkers(parcelMarkerRef);
  }, [mapReady, parcel, parcelEditierbar, loc.lat, loc.lng, mpp]);

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
          // 104-05: the corner snaps to the other outlines (not to its own area)
          const f = kartenFang(map, m.getLngLat(), { ausser: [a.id], alt: altFangRef.current });
          m.setLngLat(f.ll);
          setFangKarte(f.anz);
          const moved = f.c;
          const live = areas.map((ar) =>
            ar.id !== a.id ? ar : { ...ar, points: ar.points.map((q, i) => (i === idx ? moved : q)) }
          );
          map.getSource("sd-areas")?.setData(areasToGeoJson(live, loc.lat, loc.lng, mpp));
        });
        m.on("dragend", () => {
          setFangKarte(null);
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
        // 104-05: a draft point snaps like a clicked one (not to the draft itself)
        const f = kartenFang(map, m.getLngLat(), { ausser: [QUELLE_ENTWURF], alt: altFangRef.current });
        m.setLngLat(f.ll);
        setFangKarte(f.anz);
        map
          .getSource("sd-draft")
          ?.setData(draftToGeoJson(draftGeo.map((q, i) => (i === idx ? f.ll : q))));
      });
      m.on("dragend", () => {
        setFangKarte(null);
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
      el.style.cssText = `pointer-events:none;white-space:nowrap;${css}`;
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
        baukoerperText(b, parcel, t),
        "font:700 11px/1.2 system-ui;color:#fff;text-align:center;white-space:pre;text-shadow:0 0 3px #1e3a8a,0 0 5px #1e3a8a;"
      );
    }
    for (const l of riegelGeo?.labels || []) {
      addLabel(canvasPointToLngLat(l.p, loc.lat, loc.lng, mpp), l.text,
        "font:700 11px/1.2 system-ui;color:#4c1d95;text-align:center;white-space:pre;text-shadow:0 0 3px #fff,0 0 6px #fff;");
    }
    return () => clearMarkers(labelMarkersRef);
  }, [mapReady, areas, buildings, draftGeo, parcel, loc.lat, loc.lng, mpp, t, riegelGeo]);

  return (
    <div
      className="relative w-full rounded-lg border overflow-hidden h-[560px] ws:h-full"
      // 72-01 A-1 (finding N-01): FIXED height instead of aspectRatio - inside
      // a hidden Radix tab the width is 0 and the ratio collapsed the frame to
      // 0 px, leaving the map a white box. [ASSUMED] 560 px map height, 420 px
      // floor (review sec.3 A-1: "feste Höhe").
      // 101-05: fills the remaining height of the work surface (lg up); below lg a fixed 560 px.
      style={{ minHeight: 360 }}
      // 101-07: own menu instead of the browser menu — on the frame, so it works from the first frame
      // on (a listener on the map container only existed after the style had loaded; an early
      // right-click then showed nothing, seen in E2E).
      onContextMenu={(e) => {
        e.preventDefault();
        const map = getMap();
        const ring = footprintToGeoJson(parcel.points, loc.lat, loc.lng, mpp).features[0]?.geometry?.coordinates?.[0];
        const b = ringBounds(ring);
        onKontextRef.current?.(e, map && b ? () => map.fitBounds(b, { padding: 60, duration: 300, maxZoom: 19 }) : null);
      }}
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
      {/* 101-04: rectangle while a building is pulled open (positioned by the drag handler) */}
      <div ref={aufziehenRef} data-testid="sd-aufziehen" style={{ display: "none" }}
        className="pointer-events-none absolute items-end justify-end border-2 border-primary bg-primary/10 p-0.5 font-mono text-[11px] text-primary" />
      {/* 104-05: snap glyph over the map (screen pixels) */}
      {fangKarte && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <FangGlyphe x={fangKarte.x} y={fangKarte.y} s={1} art={fangKarte.art} strahl={fangKarte.strahl} testid="sd-objektfang" />
        </svg>
      )}
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

// Interactive 2D site plan. Modus "Baukörper" (Klick setzt Standard-Rechteck, Ziehen spannt es auf — 101-04) oder
// "Polygon" (frei zeichnen, Eckpunkte ziehen, Live-Fläche in m²).
// Mit Standort (Phase 36, KARTE-03): direkt auf der MapLibre-Karte; ohne
// Standort bleibt der bisherige SVG-Canvas als Fallback.
export default function SiteDesigner({ complexData, onBuildingsChange, onAreasChange, onSiteAreaChange, projektTyp = null, onReestimateParcel = null, onFlurstueckImport = null, onParcelChange = null, onRiegelChange = null }) {
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
  // 101-02: official parcel boundaries — on by default inside Bavaria (the only state with the free WMS here).
  const [zeigeKataster, setZeigeKataster] = useState(() => inBayern(complexData?.location));
  // The location arrives after the first render: decide once per location (the user's switch wins afterwards).
  const katasterFuer = useRef(/** @type {string|null} */ (null));
  useEffect(() => {
    const l = complexData?.location;
    if (l?.lat == null || l?.lng == null) return;
    const schluessel = `${l.lat},${l.lng}`;
    if (katasterFuer.current === schluessel) return;
    katasterFuer.current = schluessel;
    setZeigeKataster(inBayern(l));
  }, [complexData?.location?.lat, complexData?.location?.lng]);
  const [draft, setDraft] = useState([]);        // SVG-Fallback: {x,y}-Punkte
  const [draftGeo, setDraftGeo] = useState([]);  // Karten-Modus: [lng,lat]-Punkte
  // 75-06 Task 3 (MSB-3): role of the drawn polygon — "footprint" (default,
  // the existing behaviour: feeds the massing body) or "baufeld" (the building
  // envelope the Massing checks against). Legacy records all carry "footprint",
  // so no migration is needed. MUST sit above the !parcel early return
  // (rules of hooks).
  const [areaTyp, setAreaTyp] = useState("footprint");
  // 101-04: building pulled open in the SVG fallback (start point + screen position; preview rectangle).
  const zugRef = useRef(/** @type {{a:{x:number,y:number}, sx:number, sy:number}|null} */ (null));
  const [zugSvg, setZugSvg] = useState(/** @type {{a:{x:number,y:number}, b:{x:number,y:number}}|null} */ (null));
  // 95-04…06: blocks in metres. mSite = metres per canvas unit (same scale as every area
  // figure here); the plot and the "baufeld" envelopes in metres are the snap targets and the
  // basis of the checks. Hooks above the !parcel early return (rules of hooks).
  const planRef = useRef(null);
  const mSite = metersPerPixel(parcel);
  // 101-04: bars / perimeter blocks — stored path in canvas units (like every site drawing), laid out in
  // site metres with the core of the Massing modeller (riegelLayout, one engine for both editors).
  const riegelDaten = complexData?.riegel;
  const riegelLayouts = useMemo(() => (Array.isArray(riegelDaten) ? riegelDaten : [])
    .filter((x) => Array.isArray(x?.punkte) && x.punkte.length >= 2)
    .map((x) => {
      try {
        return { r: x, l: riegelLayout(x.punkte.map((q) => ({ x: q.x * mSite, y: q.y * mSite })), { ...x.opt, geschlossen: !!x.geschlossen }) };
      } catch { return null; } // e.g. a ring with < 3 points: not drawn, kept in the data
    })
    .filter(Boolean), [riegelDaten, mSite]);
  const riegelSumme = useMemo(() => riegelLayouts.reduce((a, { l }) => ({
    grundflaeche: a.grundflaeche + l.kennzahlen.grundflaeche, bgf: a.bgf + l.kennzahlen.bgf, wohnungen: a.wohnungen + l.kennzahlen.wohnungen,
  }), { grundflaeche: 0, bgf: 0, wohnungen: 0 }), [riegelLayouts]);
  const riegelGeo = useMemo(() => {
    /** @type {Array<{pts: Array<{x:number,y:number}>, farbe: string}>} */
    const flaechen = [];
    /** @type {Array<{id: string, idx: number, p: {x:number,y:number}}>} */
    const punkte = [];
    /** @type {Array<{p: {x:number,y:number}, text: string}>} */
    const labels = [];
    const zuC = (/** @type {{x:number,y:number}} */ q) => ({ x: q.x / mSite, y: q.y / mSite });
    for (const { r, l } of riegelLayouts) {
      for (const f of l.flur) flaechen.push({ pts: f.map(zuC), farbe: "#cbd5e1" });
      for (const e of l.einheiten) flaechen.push({ pts: e.profil.map(zuC), farbe: WOHNUNGSTYPEN[e.typ]?.farbe || "#94a3b8" });
      r.punkte.forEach((q, idx) => punkte.push({ id: r.id, idx, p: q }));
      labels.push({ p: punktMitte(r.punkte), text: riegelText(r, l.kennzahlen, t) });
    }
    return { flaechen, punkte, labels };
  }, [riegelLayouts, mSite, t]);
  // Enter / Esc of the bar tool — the handler is set after the early return below (needs the draft helpers).
  const riegelTasteRef = useRef(/** @type {((e: KeyboardEvent) => void)|null} */ (null));
  useEffect(() => {
    const h = (/** @type {KeyboardEvent} */ e) => riegelTasteRef.current?.(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  // Nutzer 19.10.2026 ("Quadrat weg"): an estimated plot (assumed: true, the generic start square) is not drawn,
  // not editable, does not limit where things go and is no basis of the plot checks — its area only feeds the
  // estimates elsewhere (site_area, marked "geschätzt"). The real plot is drawn with the polygon tool, role
  // "Grundstück", on the official parcel map.
  const parcelGeschaetzt = parcel?.assumed === true;
  const grenzeM = useMemo(
    () => (!parcelGeschaetzt && Array.isArray(parcel?.points) && parcel.points.length >= 3 ? parcel.points.map((q) => ({ x: q.x * mSite, y: q.y * mSite })) : null),
    [parcel?.points, mSite, parcelGeschaetzt],
  );
  const baufelderM = useMemo(
    () => areas.filter((a) => a.type === "baufeld").map((a) => a.points.map((q) => ({ x: q.x * mSite, y: q.y * mSite }))),
    [areas, mSite],
  );
  const bb = useBlockBearbeitung({
    buildings, mpp: mSite, onChange: (next) => onBuildingsChange?.(next), aktiv: mode === "auswahl",
    grenzeM, baufelderM, containerRef: planRef, zusatzDichte: riegelSumme,
  });
  const nummer = useMemo(() => Object.fromEntries(buildings.map((b, i) => [b.id, i + 1])), [buildings]);
  // 104-06: the site plan as DXF R12 (metres around the project location, y north; the
  // location travels in a comment so the own parcel import can read the boundary back).
  const [dxfHinweis, setDxfHinweis] = useState(/** @type {string|null} */ (null));
  const lageplanDxf = () => {
    try {
      const daten = lageplanDxfDaten(complexData, { projekt: complexData?.name || "", t });
      if (daten.leer) { setDxfHinweis(t("Nichts zu exportieren — weder gezeichnetes Grundstück noch Flächen oder Baukörper.")); return; }
      const { bytes, uebersprungen } = dxfDatei(daten);
      dateiAnbieten(bytes, dxfDateiname(complexData?.name || "", "Lageplan"), DXF_MIME);
      setDxfHinweis(uebersprungen
        ? t("Lageplan als DXF exportiert — {n} Objekt(e) ohne gültige Koordinaten ausgelassen.").replace("{n}", String(uebersprungen))
        : t("Lageplan als DXF exportiert (R12, Meter, Ursprung = Projektstandort)."));
    } catch (err) {
      setDxfHinweis(`${t("DXF-Export fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || err}`);
    }
  };
  // 101-07: right-click menu of the site plan (CAD-like).
  const kontext = useKontextmenue();
  const baufeldKontext = (/** @type {(() => void)|null} */ einpassen) => [
    mode === "riegel" && { label: t("Riegel fertig"), taste: "Enter", onClick: () => riegelFertig(false) },
    mode === "riegel" && { label: t("Blockrand schließen"), onClick: () => riegelFertig(true), trenner: true },
    { label: t("Befehl beenden"), taste: "Esc", onClick: () => { setDraft([]); setDraftGeo([]); bb.abbrechen(); setMode("auswahl"); } },
    { label: t("Rückgängig"), taste: "Strg+Z", onClick: bb.rueckgaengig, disabled: !bb.kannZurueck, trenner: true },
    { label: t("Wiederholen"), taste: "Strg+Y", onClick: bb.wiederholen, disabled: !bb.kannVor },
    { label: t("Auswahl aufheben"), onClick: () => bb.setAuswahl([]), disabled: !bb.auswahl.length, trenner: true },
    { label: t("Löschen"), taste: "Entf", onClick: bb.loeschen, disabled: !bb.auswahl.length, gefahr: true },
    einpassen && { label: t("Alles einpassen"), taste: t("2× Mausrad"), onClick: einpassen, trenner: true },
    { label: t("Lageplan als DXF exportieren"), onClick: lageplanDxf, trenner: !einpassen },
    // 104-05: snap switches (checkbox entries), shared with the Massing modeller
    ...fangKontextEintraege(fangEinstellungen(), t),
  ].filter(Boolean);

  // 104-05: object snap of the site plan — snap geometry in site metres (plot, areas, buildings, bars, the running
  // draft), one index per geometry change; the same switches as the modeller (F3/F8/F9/F10, menu, chips).
  const fangEinst = useFangEinstellungen();
  useFangTasten();
  /** Snap glyph of the SVG plan: point in view units + the core result (null = none). */
  const [fangSvg, setFangSvg] = useState(/** @type {{x:number,y:number,r:any}|null} */ (null));
  const mitStandort = loc?.lat != null && loc?.lng != null;
  const entwurfC = useMemo(
    () => (mitStandort ? draftGeo.map((q) => lngLatToCanvasPoint(q, loc.lat, loc.lng, mpp)) : draft),
    [mitStandort, draftGeo, draft, loc?.lat, loc?.lng, mpp],
  );
  const fangIdx = useMemo(() => fangIndex(lageplanFangSegmente({
    parcel, parcelGeschaetzt, areas, buildings: bb.anzeige, riegel: Array.isArray(riegelDaten) ? riegelDaten : [], entwurf: entwurfC, mSite,
  })), [parcel, parcelGeschaetzt, areas, bb.anzeige, riegelDaten, entwurfC, mSite]);
  /**
   * Snap a point of the site plan (site metres in and out).
   * @param {{x:number,y:number}} roh raw point, site metres
   * @param {{basis?: {x:number,y:number}|null, ausser?: string[]|null, aus?: boolean, mProPx?: number}} [o]
   *   basis = previous point (polar / ortho / perpendicular), ausser = snap sources to ignore, aus = Alt (free),
   *   mProPx = metres per screen pixel (capture distance LAGEPLAN_FANG_PX on screen)
   */
  const fangeM = (roh, { basis = null, ausser = null, aus = false, mProPx = 1 } = {}) =>
    fangPunkt(roh, fangIdx, { toleranz_m: LAGEPLAN_FANG_PX * mProPx, modi: fangEinst, basis, ausser, aus });

  // 75-06 Task 2: imported cadastral parcels + last-import warnings (UI-only,
  // the data model write lives in ComplexDesigner.handleFlurstueckImport).
  const [geoWarnungen, setGeoWarnungen] = useState([]);

  // GeoJSON file → pure parse → hand the parcels to ComplexDesigner. Native
  // <input type=file> (no shadcn <Input>: tsc legacy). Needs a location as the
  // projection reference — without it, a plain hint, never a silent fallback.
  const flurstuecke = complexData?.grundstueck?.flurstuecke || [];
  // 101-03: last DXF file (text + its layers) so another layer choice re-reads it without a new upload.
  const [dxfQuelle, setDxfQuelle] = useState(/** @type {{text: string, ebenen: Array<{name: string, anzahl: number}>, gewaehlt: string[]}|null} */ (null));
  // 101-03: outcome of the union (united boundary or the honest reason why not).
  const [grenzMeldung, setGrenzMeldung] = useState(/** @type {{ok: boolean, text: string}|null} */ (null));
  const parcelGezeichnet = parcel?.source === "gezeichnet";
  /**
   * Hand the parcels over; ComplexDesigner derives the boundary unless a drawn plot exists. Report the union here.
   * unvollstaendig = the file was only partly read, so a "successful" union may still be too small (warning colour).
   */
  const flurstueckeUebernehmen = (/** @type {any[]} */ liste, unvollstaendig = false) => {
    onFlurstueckImport?.(liste);
    const g = grundstueckAusFlurstuecken(liste, { mPerPx: mSite, t });
    const zusatz = [
      g.ok && parcelGezeichnet ? t("Das gezeichnete Grundstück bleibt — „Als Grundstück übernehmen“ ersetzt es.") : "",
      g.ok && unvollstaendig ? t("Datei nur teilweise übernommen — die Grenze kann zu klein sein, bitte prüfen.") : "",
    ].filter(Boolean).join(" ");
    setGrenzMeldung({ ok: g.ok && !unvollstaendig, text: zusatz ? `${g.meldung} ${zusatz}` : g.meldung });
  };
  const dxfEinlesen = (/** @type {string} */ text, /** @type {string[]|null} */ ebenen) => {
    const r = flurstueckeAusDxf(text, loc.lat, loc.lng, mSite, { ebenen, t });
    setGeoWarnungen(r.warnungen);
    setDxfQuelle(r.ebenen.length ? { text, ebenen: r.ebenen, gewaehlt: r.gewaehlt } : null);
    if (r.flurstuecke.length) flurstueckeUebernehmen(r.flurstuecke, !!r.unvollstaendig);
    else setGrenzMeldung(null);
  };
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
      // DXF by extension, or any file that is not JSON (cadastral exports often carry odd extensions).
      if (/\.dxf$/i.test(file.name) || !/^\s*[[{]/.test(text)) { dxfEinlesen(text, null); return; }
      setDxfQuelle(null);
      // The polygons are projected with the scale of THIS plot, so buildings and areas keep their size.
      const { flurstuecke: liste, warnungen } = flurstueckeAusGeoJson(text, loc.lat, loc.lng, mSite);
      setGeoWarnungen(warnungen);
      if (liste.length) flurstueckeUebernehmen(liste);
      else setGrenzMeldung(null);
    } catch (err) {
      setGeoWarnungen([`${t("Import fehlgeschlagen")}: ${err?.message || err}`]);
    }
  };
  const flurstueckLoeschen = (id) => {
    const rest = flurstuecke.filter((f) => f.id !== id);
    // Empty list back to ComplexDesigner clears grundstueck.flurstuecke too.
    onFlurstueckImport?.(rest);
    setGrenzMeldung(null);
    if (!rest.length) setGeoWarnungen([]);
  };
  /** Explicit user action: the united parcels become the plot — also over a drawn one. */
  const flurstueckeAlsGrundstueck = () => {
    const g = grundstueckAusFlurstuecken(flurstuecke, { mPerPx: mSite, t });
    setGrenzMeldung({ ok: g.ok, text: g.meldung });
    if (!g.ok || !onParcelChange || !parcel) return;
    const { geschaetzte_flaeche_m2: _g, ...rest } = parcel;
    onParcelChange({ ...rest, points: g.punkte, assumed: false, source: "flurstuecke", m_per_px: mSite });
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
  const insideParcel = (x, y) => parcelGeschaetzt || pointInPolygon(pts, x, y);

  const hatKarte = loc?.lat != null && loc?.lng != null;
  const mapCtx = complexData?.map_context;

  // 101-05: screen → view units through the SVG's own screen matrix. The plan now fits the work surface
  // (letterboxed, preserveAspectRatio "meet"), so the plain rule of three on the bounding box no longer holds.
  const toView = (e) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const v = pt.matrixTransform(ctm.inverse());
      return { x: v.x, y: v.y };
    }
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * VIEW_W, y: ((e.clientY - rect.top) / rect.height) * VIEW_H };
  };
  /** View units per screen pixel of the SVG plan (1 before layout). */
  const einheitJePx = () => { const a = svgRef.current?.getScreenCTM?.()?.a; return a > 0 ? 1 / a : 1; };
  /**
   * 104-05: snap a point of the SVG plan (view units = canvas units in and out).
   * @param {{x:number,y:number}} v raw point, view units
   * @param {{basis?: {x:number,y:number}|null, ausser?: string[]|null, alt?: boolean}} [o] previous point (view
   *   units), snap sources to ignore, Alt = free
   * @returns {{x:number, y:number, r: any}} snapped point (view units) and the core result (null for NaN)
   */
  const fangeView = (v, { basis = null, ausser = null, alt = false } = {}) => {
    const r = fangeM({ x: v.x * mSite, y: v.y * mSite }, {
      basis: basis ? { x: basis.x * mSite, y: basis.y * mSite } : null, ausser, aus: alt, mProPx: einheitJePx() * mSite,
    });
    return r ? { x: r.punkt.x / mSite, y: r.punkt.y / mSite, r } : { x: v.x, y: v.y, r: null };
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

  // 101-04: building pulled open on the plan (two opposite corners, canvas units); storeys from the
  // project type as for the click. Too small (< 3 m a side) = ignored.
  const addBuildingZug = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => {
    const r = baukoerperAusZug(a, b, parcel, baukoerperDefaults(projektTyp).geschosse);
    if (r) bb.commit([...buildings, { id: `bld_${Date.now()}`, ...r }]);
  };

  // 101-04: bars / perimeter blocks. Open path ≥ 2 points = bar, closed ring ≥ 3 points = perimeter block.
  // Parameters start at the Massing-modeller defaults (RIEGEL_STANDARD); edits go straight to the data
  // (no undo history yet — that is phase 102).
  const riegelListe = Array.isArray(complexData?.riegel) ? complexData.riegel : [];
  // 1/100 canvas unit; 104-05: also for areas (were whole units — a snapped corner moved up to half a unit away)
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  const riegelFertig = (/** @type {boolean} */ geschlossen) => {
    const punkte = hatKarte ? draftGeo.map((q) => lngLatToCanvasPoint(q, loc.lat, loc.lng, mpp)) : draft;
    if (!onRiegelChange || punkte.length < (geschlossen ? 3 : 2)) return;
    const { geschosse, tiefe, flur, art, mix } = RIEGEL_STANDARD;
    onRiegelChange([...riegelListe, {
      id: `riegel_${Date.now()}`, punkte: punkte.map((q) => ({ x: r2(q.x), y: r2(q.y) })), geschlossen,
      opt: { geschosse, tiefe, flur, art, mix },
    }]);
    setDraft([]);
    setDraftGeo([]);
  };
  const riegelAendern = (/** @type {string} */ id, /** @type {(r: any) => any} */ f) => onRiegelChange?.(riegelListe.map((x) => (x.id === id ? f(x) : x)));
  const riegelPunkt = (/** @type {string} */ id, /** @type {number} */ idx, /** @type {{x:number,y:number}} */ p) =>
    riegelAendern(id, (x) => ({ ...x, punkte: x.punkte.map((q, i) => (i === idx ? { x: r2(p.x), y: r2(p.y) } : q)) }));
  const riegelLoeschen = (/** @type {string} */ id) => onRiegelChange?.(riegelListe.filter((x) => x.id !== id));
  riegelTasteRef.current = (e) => {
    if (mode !== "riegel" || /^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {any} */ (e.target)?.tagName || "")) return;
    if (e.key === "Enter") { e.preventDefault(); riegelFertig(false); }
    else if (e.key === "Escape") { setDraft([]); setDraftGeo([]); }
  };

  // 95-05: every building edit is one undo step (bb.commit).
  const removeBuilding = (id) => bb.commit(buildings.filter((b) => b.id !== id));
  // 101-02: every edit makes the plot a drawn one (no longer the estimated start square).
  const parcelSetzen = (/** @type {Array<{x:number,y:number}>} */ points) => {
    if (!onParcelChange || !parcel || points.length < 3) return;
    const { geschaetzte_flaeche_m2: _g, ...rest } = parcel;
    onParcelChange({ ...rest, points: points.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 })), assumed: false, source: "gezeichnet" });
  };

  const removeArea = (id) => onAreasChange?.((complexData?.designated_areas || []).filter((a) => a.id !== id));

  const closeDraft = () => {
    if (draft.length < 3) return;
    if (areaTyp === "grundstueck") { parcelSetzen(draft); setDraft([]); setAreaTyp("footprint"); return; }
    onAreasChange?.([
      ...(complexData?.designated_areas || []),
      { id: `poly_${Date.now()}`, type: areaTyp, points: draft.map((p) => ({ x: r2(p.x), y: r2(p.y) })) },
    ]);
    setDraft([]);
  };

  // Karten-Draft ([lng,lat]) → Canvas-Px-Bestandsformat (KARTE-03).
  const closeDraftGeo = () => {
    if (draftGeo.length < 3) return;
    const cpts = geoJsonToFootprint(draftGeo, loc.lat, loc.lng, mpp);
    if (!cpts) return;
    if (areaTyp === "grundstueck") { parcelSetzen(cpts); setDraftGeo([]); setAreaTyp("footprint"); return; }
    onAreasChange?.([
      ...(complexData?.designated_areas || []),
      { id: `poly_${Date.now()}`, type: areaTyp, points: cpts.map((p) => ({ x: r2(p.x), y: r2(p.y) })) },
    ]);
    setDraftGeo([]);
  };

  // Vertex-Commit aus dem Karten-Modus (Live-Vorschau macht LageplanKarte).
  const commitVertex = (areaId, idx, pt) => {
    const next = (complexData?.designated_areas || []).map((a) => {
      if (a.id !== areaId || !Array.isArray(a.points)) return a;
      const p = a.points.slice();
      p[idx] = { x: r2(pt.x), y: r2(pt.y) };
      return { ...a, points: p };
    });
    onAreasChange?.(next);
  };

  const handleSvgClick = (e) => {
    if (movedRef.current) { movedRef.current = false; return; } // ignore click after a drag
    if (mode === "auswahl") return; // 95-04: handled by the pointer handlers
    if (mode === "building") { const v = toView(e); addBuilding(v.x, v.y); return; }
    // 101-04: second click of a double-click finishes an open bar (the first one set the last point)
    if (mode === "riegel" && e.detail >= 2) { riegelFertig(false); return; }
    // polygon / bar mode — 104-05: the point snaps (object snap, polar from the previous point, grid; Alt = free)
    const { x, y } = fangeView(toView(e), { basis: draft[draft.length - 1] || null, alt: e.altKey });
    if (!insideParcel(x, y)) return;
    if (draft.length >= 3) {
      const first = draft[0];
      const near = Math.hypot(first.x - x, first.y - y) < 20;
      if (near) { if (mode === "riegel") riegelFertig(true); else closeDraft(); return; }
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
  // 101-04: building tool in the SVG fallback — drag pulls a building open (3 px threshold like the map).
  const onSvgPointerDown = (e) => {
    if (mode === "building" && e.button === 0) {
      const a = toView(e);
      if (!insideParcel(a.x, a.y)) return;
      zugRef.current = { a, sx: e.clientX, sy: e.clientY };
      try { svgRef.current.setPointerCapture?.(e.pointerId); } catch (_) { /* noop */ }
      return;
    }
    if (mode !== "auswahl" || e.button !== 0) return;
    try { svgRef.current.setPointerCapture?.(e.pointerId); } catch (_) { /* noop */ }
    bb.runter(zuMeter(e), { x: e.clientX, y: e.clientY }, tastenVon(e), einheitJePx() * mSite);
  };

  const onPointerMove = (e) => {
    if (dragRef.current?.areaId === "__riegel__") {
      movedRef.current = true;
      // 104-05: a dragged bar point snaps to everything except its own bar
      const f = fangeView(toView(e), { ausser: [dragRef.current.rid], alt: e.altKey });
      setFangSvg(f);
      riegelPunkt(dragRef.current.rid, dragRef.current.idx, f);
      return;
    }
    if (dragRef.current?.areaId === "__grundstueck__" || dragRef.current?.areaId === "__kante__") {
      movedRef.current = true;
      const v = toView(e);
      const d = dragRef.current;
      if (d.areaId === "__kante__") { parcelSetzen(kanteVerschieben(d.start, d.idx, { x: v.x - d.von.x, y: v.y - d.von.y })); return; }
      // 104-05: a dragged plot corner snaps to the other outlines (not to the plot's own edges)
      const f = fangeView(v, { ausser: [QUELLE_GRUNDSTUECK], alt: e.altKey });
      setFangSvg(f);
      parcelSetzen(eckeVerschieben(pts, d.idx, f));
      return;
    }
    if (mode === "auswahl") { bb.bewegen(zuMeter(e), { x: e.clientX, y: e.clientY }, tastenVon(e)); return; }
    const z = zugRef.current;
    if (z) {
      if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) < 3) return;
      movedRef.current = true; // suppresses the click (standard size) after the drag
      setZugSvg({ a: z.a, b: toView(e) });
      return;
    }
    if (!dragRef.current) {
      // 104-05: hover glyph while drawing — where the next click goes
      if (mode === "polygon" || mode === "riegel") setFangSvg(fangeView(toView(e), { basis: draft[draft.length - 1] || null, alt: e.altKey }));
      return;
    }
    movedRef.current = true;
    const { areaId, idx } = dragRef.current;
    // 104-05: a dragged area corner snaps to the other outlines (not to its own area)
    const f = fangeView(toView(e), { ausser: [areaId], alt: e.altKey });
    setFangSvg(f);
    const next = (complexData?.designated_areas || []).map((a) => {
      if (a.id !== areaId || !Array.isArray(a.points)) return a;
      const p = a.points.slice();
      // 104-05: 2 decimals (1/100 canvas unit) instead of whole units — a snapped corner must stay on its target
      p[idx] = { x: r2(f.x), y: r2(f.y) };
      return { ...a, points: p };
    });
    onAreasChange?.(next);
  };

  const endDrag = (e) => {
    // 101-02b: an edge handle released without movement inserts a corner on that edge.
    if (dragRef.current?.areaId === "__kante__" && !movedRef.current && e?.type === "pointerup") parcelSetzen(eckeEinfuegen(dragRef.current.start, dragRef.current.idx));
    // 104-05: a drag's snap glyph ends with the drag; the hover glyph leaves with the pointer
    if (dragRef.current || e?.type === "pointerleave") setFangSvg(null);
    dragRef.current = null;
    const z = zugRef.current;
    zugRef.current = null;
    if (z) {
      setZugSvg(null);
      if (movedRef.current && e?.type === "pointerup") addBuildingZug(z.a, toView(e));
    }
    if (mode === "auswahl" && e?.type === "pointerup") bb.hoch(tastenVon(e));
  };

  const elevColorSvg = elevColor;
  // View units per screen pixel of the SVG plan (rotate handle in screen pixels); 1 before layout.
  const vjp = einheitJePx();

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
    <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-3 ws:h-full ws:min-h-0 ws:grid-rows-[minmax(0,1fr)]">
      <Card className="border-0 shadow-none bg-transparent ws:flex ws:flex-col ws:min-h-0">
        <CardHeader className="p-0 pb-1.5 space-y-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building className="w-4 h-4" /> Lageplan
            </CardTitle>
            {/* flex-wrap: with the polygon / bar extras the tools no longer fit at 1280 px — wrap, never clip */}
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant={mode === "building" ? "default" : "outline"}
                onClick={() => { setMode("building"); setDraft([]); setDraftGeo([]); }} aria-label="Baukörper-Modus">
                <Building className="w-4 h-4 mr-1" /> Baukörper
              </Button>
              <Button size="sm" variant={mode === "polygon" ? "default" : "outline"}
                onClick={() => setMode("polygon")} aria-label="Polygon-Zeichenmodus">
                <PenTool className="w-4 h-4 mr-1" /> Polygon
              </Button>
              <Button size="sm" variant={mode === "riegel" ? "default" : "outline"} data-testid="sd-modus-riegel"
                onClick={() => { setMode("riegel"); setDraft([]); setDraftGeo([]); }} aria-label={t("Riegel-Modus")}
                title={t("Pfad klicken: offen = Riegel, Startpunkt = Blockrand mit Hof")}>
                <Route className="w-4 h-4 mr-1" /> {t("Riegel")}
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
              <Button size="sm" variant="ghost" onClick={lageplanDxf} aria-label={t("Lageplan als DXF exportieren")} title={t("Lageplan als DXF exportieren")} data-testid="sd-dxf">
                <Download className="w-4 h-4 mr-1" /> DXF
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
                    {onParcelChange && <option value="grundstueck">{t("Grundstück")}</option>}
                  </select>
                  <Button size="sm" variant="ghost" onClick={undoDraftPoint} disabled={!draftLen} aria-label="Letzten Punkt entfernen">
                    <Undo2 className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-emerald-700" onClick={doCloseDraft} disabled={draftLen < 3} aria-label="Polygon schließen">
                    <Check className="w-4 h-4 mr-1" /> Schließen
                  </Button>
                </>
              )}
              {mode === "riegel" && (
                <>
                  <Button size="sm" variant="ghost" onClick={undoDraftPoint} disabled={!draftLen} aria-label={t("Letzten Punkt entfernen")}>
                    <Undo2 className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-erfolg" onClick={() => riegelFertig(false)} disabled={draftLen < 2} data-testid="sd-riegel-fertig">
                    <Check className="w-4 h-4 mr-1" /> {t("Riegel fertig")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => riegelFertig(true)} disabled={draftLen < 3} data-testid="sd-riegel-blockrand">
                    {t("Blockrand schließen")}
                  </Button>
                </>
              )}
            </div>
          </div>
          {dxfHinweis && (
            <div className="pt-1 text-[11px] text-muted-foreground" data-testid="sd-dxf-hinweis" role="status">{dxfHinweis}</div>
          )}
        </CardHeader>
        <CardContent className="p-0 ws:flex-1 ws:min-h-0" ref={planRef} data-testid="sd-plan" data-auswahl={bb.auswahl.join(",")}>
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
              onAufziehen={addBuildingZug}
              onCloseDraft={mode === "riegel" ? () => riegelFertig(true) : closeDraftGeo}
              riegelGeo={riegelGeo}
              onRiegelPunkt={onRiegelChange ? riegelPunkt : null}
              onRiegelFertig={riegelFertig}
              onVertexCommit={commitVertex}
              bb={bb}
              mSite={mSite}
              zeigeHoehen={zeigeHoehen}
              zeigeKataster={zeigeKataster}
              onParcelPunkte={onParcelChange && !parcelGeschaetzt ? parcelSetzen : null}
              parcelSichtbar={!parcelGeschaetzt}
              onKontext={(e, einpassen) => kontext.oeffnen(e, baufeldKontext(einpassen))}
              fangen={fangeM}
            />
          ) : (
          <div className="relative w-full rounded-lg border overflow-hidden aspect-[3/2] ws:aspect-auto ws:h-full">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            // select-none + no native drag: a frame drag selected the labels, the next block drag then started
            // the browser's drag-and-drop and the pointer was cancelled mid-move (pointercancel, 101-04).
            className={`absolute inset-0 w-full h-full select-none touch-none bg-slate-50 ${mode === "auswahl" ? "cursor-default" : "cursor-crosshair"}`}
            onDragStart={(e) => e.preventDefault()}
            onClick={handleSvgClick}
            onPointerDown={onSvgPointerDown}
            onContextMenu={(e) => kontext.oeffnen(e, baufeldKontext(null))}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {!parcelGeschaetzt && (
              <polygon
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="rgba(16,185,129,0.06)" stroke="#10b981" strokeWidth="3" strokeDasharray="8 6"
              />
            )}
            {/* 101-02: corners of the plot boundary are draggable */}
            {onParcelChange && !parcelGeschaetzt && pts.map((p, idx) => (
              <circle key={`gr-${idx}`} data-testid="sd-parcel-ecke" cx={p.x} cy={p.y} r={7 * vjp} fill="#ffffff" stroke="#059669" strokeWidth={3 * vjp}
                style={{ cursor: "grab" }} onPointerDown={(e) => startDrag(e, "__grundstueck__", idx)}
                onDoubleClick={(e) => { e.stopPropagation(); parcelSetzen(eckeLoeschen(pts, idx)); }}>
                <title>{t("Ecke ziehen · Doppelklick löscht")}</title>
              </circle>
            ))}
            {onParcelChange && !parcelGeschaetzt && kantenMitten(pts).map((m, idx) => (
              <g key={`kante-${idx}`} data-testid="sd-parcel-kante" style={{ cursor: "move" }}
                onPointerDown={(e) => { startDrag(e, "__kante__", idx); dragRef.current = { areaId: "__kante__", idx, start: pts, von: toView(e) }; }}>
                <rect x={m.x - 7 * vjp} y={m.y - 7 * vjp} width={14 * vjp} height={14 * vjp} rx={3 * vjp} fill="#ecfdf5" stroke="#059669" strokeWidth={2 * vjp} />
                <text x={m.x} y={m.y} textAnchor="middle" dominantBaseline="central" fontSize={12 * vjp} fontWeight="700" fill="#047857" pointerEvents="none">+</text>
                <title>{t("Klick: Ecke einfügen · Ziehen: Kante verschieben")}</title>
              </g>
            ))}
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
                  <polygon points={a.points.map((p) => `${p.x},${p.y}`).join(" ")} data-testid="sd-area" data-id={a.id}
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
                {draft.length >= 3 && mode === "polygon" && (
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

            {/* 101-04: bars / perimeter blocks — units coloured by type, corridor grey; path points draggable */}
            {riegelGeo.flaechen.map((f, i) => (
              <polygon key={`rg-${i}`} data-testid="sd-riegel-flaeche" points={f.pts.map((q) => `${q.x},${q.y}`).join(" ")}
                fill={f.farbe} fillOpacity="0.85" stroke="#334155" strokeWidth={0.6 * vjp} pointerEvents="none" />
            ))}
            {riegelGeo.labels.map((l, i) => (
              <text key={`rl-${i}`} data-testid="sd-riegel-label" x={l.p.x} y={l.p.y} textAnchor="middle" fontSize={11 * vjp} fontWeight="700" fill="#4c1d95" pointerEvents="none">
                {l.text.split("\n").map((zeile, k) => <tspan key={k} x={l.p.x} dy={k === 0 ? "-0.2em" : "1.2em"}>{zeile}</tspan>)}
              </text>
            ))}
            {onRiegelChange && riegelGeo.punkte.map((q) => (
              <circle key={`rp-${q.id}-${q.idx}`} data-testid="sd-riegel-punkt" cx={q.p.x} cy={q.p.y} r={6 * vjp} fill="#ffffff" stroke="#7c3aed" strokeWidth={2.5 * vjp}
                style={{ cursor: "grab" }} onPointerDown={(e) => { startDrag(e, "__riegel__", q.idx); dragRef.current = { areaId: "__riegel__", idx: q.idx, rid: q.id }; }}>
                <title>{t("Punkt ziehen")}</title>
              </circle>
            ))}

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
                  <text x={k.cx / mSite} y={k.cy / mSite} textAnchor="middle" fontSize={11 * vjp} fontWeight="700" fill="white" pointerEvents="none">
                    {baukoerperText(b, parcel, t).split("\n").map((zeile, i) => (
                      <tspan key={i} x={k.cx / mSite} dy={i === 0 ? "-0.2em" : "1.2em"}>{zeile}</tspan>
                    ))}
                  </text>
                </g>
              );
            })}
            {zugSvg && (
              <rect data-testid="sd-aufziehen" x={Math.min(zugSvg.a.x, zugSvg.b.x)} y={Math.min(zugSvg.a.y, zugSvg.b.y)}
                width={Math.abs(zugSvg.b.x - zugSvg.a.x)} height={Math.abs(zugSvg.b.y - zugSvg.a.y)}
                fill="rgba(59,130,246,0.15)" stroke="#2563eb" strokeWidth={2 * vjp} pointerEvents="none" />
            )}
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
            {/* 104-05: snap glyph (hover while drawing, or the dragged corner) */}
            {fangSvg?.r && (
              <FangGlyphe x={fangSvg.x} y={fangSvg.y} s={vjp} art={fangSvg.r.art} testid="sd-objektfang"
                strahl={fangSvg.r.strahl ? strahlEnden({ x: fangSvg.r.strahl.von.x / mSite, y: fangSvg.r.strahl.von.y / mSite }, fangSvg, 40 * vjp, fangSvg.r.strahl.winkel_grad) : null} />
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
        {/* 101-06: command line — which command runs and what the next input expects */}
        {(() => {
          const b = baufeldAufforderung(/** @type {any} */ (mode), { entwurf: hatKarte ? draftGeo.length : draft.length, gewaehlt: bb.auswahl.length, karte: hatKarte });
          const meldung = bb.winkel != null ? `${bb.winkel}°` : bb.fangZiel ? `${t("Fang")}: ${fangText(bb.fangZiel, t)}` : "";
          return <Befehlszeile befehl={t(b.befehl)} aufforderung={t(b.aufforderung)} meldung={meldung} meldungTestid="sd-fang" testid="sd-befehlszeile"
            schalter={fangSchalter(fangEinst, t)} schalterTestid="sd-schalter" />;
        })()}
        <KontextmenueAnzeige menue={kontext.menue} schliessen={kontext.schliessen} testid="sd-kontextmenue" />
      </Card>

      <div className="space-y-3 text-sm ws:min-h-0 ws:overflow-y-auto ws:pr-1">
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
            {riegelLayouts.length > 0 && (
              <div className="text-sm text-muted-foreground" data-testid="sd-riegel-summe">
                ≈ BGF ({t("Riegel/Blockrand")}): <b>{Math.round(riegelSumme.bgf).toLocaleString("de-DE")} m²</b> · {riegelSumme.wohnungen} {t("WE")}
              </div>
            )}
            {hatKarte && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground" title={KATASTER_BY_QUELLE}>
                <input type="checkbox" checked={zeigeKataster} onChange={(e) => setZeigeKataster(e.target.checked)} data-testid="sd-kataster" />
                {t("Flurstücke Bayern (amtlich)")}
              </label>
            )}
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
                {onParcelChange ? ` ${t("Im Plan nicht gezeichnet. „Grundstück zeichnen“ und die Ecken entlang der Flurstücksgrenze klicken — danach gilt das Grundstück als gezeichnet und lässt sich bearbeiten.")}`
                  : hatKarte && ' Im Tab „Standort & Karte" kannst du die echte Parzelle zeichnen.'}
                {onParcelChange && (
                  <button type="button" data-testid="sd-grundstueck-zeichnen"
                    className="mt-1.5 block rounded border border-warnung-rand bg-warnung-flaeche px-2 py-1 text-xs font-medium text-warnung hover:opacity-90"
                    onClick={() => { setMode("polygon"); setAreaTyp("grundstueck"); setDraft([]); setDraftGeo([]); }}>
                    {t("Grundstück zeichnen")}
                  </button>
                )}
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
          <div className="text-sm font-semibold">{t("Flurstücke (GeoJSON/DXF)")}</div>
          <input
            type="file"
            accept=".geojson,.json,.dxf"
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
          {/* 101-03: layer choice of the last DXF — re-reads the same file with the ticked layers. */}
          {dxfQuelle && (
            <fieldset className="space-y-1 rounded border border-border px-2 py-1.5 text-xs" data-testid="sd-dxf-ebenen">
              <legend className="px-1 text-[11px] text-muted-foreground">{t("DXF-Ebenen")}</legend>
              {dxfQuelle.ebenen.map((e) => (
                <label key={e.name} className="flex items-center gap-1.5">
                  <input type="checkbox" data-testid="sd-dxf-ebene" value={e.name}
                    checked={dxfQuelle.gewaehlt.some((g) => g.toUpperCase() === e.name.toUpperCase())}
                    onChange={(ev) => setDxfQuelle({ ...dxfQuelle, gewaehlt: ev.target.checked
                      ? [...dxfQuelle.gewaehlt, e.name] : dxfQuelle.gewaehlt.filter((g) => g.toUpperCase() !== e.name.toUpperCase()) })} />
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto text-muted-foreground">{e.anzahl}</span>
                </label>
              ))}
              <button type="button" data-testid="sd-dxf-neu" disabled={!dxfQuelle.gewaehlt.length}
                className="mt-1 rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                onClick={() => dxfEinlesen(dxfQuelle.text, dxfQuelle.gewaehlt)}>
                {t("Mit gewählten Ebenen neu einlesen")}
              </button>
            </fieldset>
          )}
          {grenzMeldung && (
            <div data-testid="sd-grenze-meldung" data-ok={grenzMeldung.ok ? "1" : "0"}
              className={`rounded border px-2 py-1.5 text-[11px] ${grenzMeldung.ok ? "border-erfolg-rand bg-erfolg-flaeche text-erfolg" : "border-warnung-rand bg-warnung-flaeche text-warnung"}`}>
              {grenzMeldung.text}
            </div>
          )}
          {flurstuecke.length > 0 && onParcelChange && (
            <button type="button" data-testid="sd-flurstuecke-grenze" onClick={flurstueckeAlsGrundstueck}
              title={t("Alle Flurstücke zu einer Grenze vereinigen und als gezeichnetes Grundstück setzen")}
              className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
              {t("Als Grundstück übernehmen")}
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t("Wird automatisch gespeichert, sobald Projektname und Standort gesetzt sind.")}
          </p>
        </div>

        {riegelLayouts.length > 0 && (
          <div className="rounded-lg border bg-card p-4 space-y-2" data-testid="sd-riegel-liste">
            <div className="text-sm font-semibold">{t("Riegel und Blockränder")}</div>
            {riegelLayouts.map(({ r, l }, i) => (
              <div key={r.id} className="space-y-1 rounded border px-2 py-1.5 text-xs" data-testid="sd-riegel-eintrag">
                <div className="flex items-center justify-between gap-2">
                  <span><b>{t(r.geschlossen ? "Blockrand" : "Riegel")} {i + 1}</b> · {l.kennzahlen.wohnungen} {t("WE")} · {Math.round(l.kennzahlen.bgf).toLocaleString("de-DE")} m² {t("BGF")}</span>
                  <button type="button" className="p-1 text-fehler hover:opacity-80" onClick={() => riegelLoeschen(r.id)} aria-label={t("Riegel löschen")} data-testid="sd-riegel-loeschen">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="flex items-center gap-1">
                    {t("Geschosse")}
                    <input type="number" min={1} max={30} value={r.opt?.geschosse ?? RIEGEL_STANDARD.geschosse} data-testid="sd-riegel-geschosse"
                      onChange={(e) => { const g = Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))); riegelAendern(r.id, (x) => ({ ...x, opt: { ...x.opt, geschosse: g } })); }}
                      className="w-12 rounded border bg-background px-1 py-0.5" />
                  </label>
                  <select value={r.opt?.art ?? RIEGEL_STANDARD.art} aria-label={t("Erschließung")} className="rounded border bg-background px-1 py-0.5"
                    onChange={(e) => riegelAendern(r.id, (x) => ({ ...x, opt: { ...x.opt, art: e.target.value } }))}>
                    <option value="mittelflur">{t("Mittelflur (zweibündig)")}</option>
                    <option value="einhueftig">{t("einhüftig")}</option>
                  </select>
                  <select value={typeof r.opt?.mix === "string" ? r.opt.mix : RIEGEL_STANDARD.mix} aria-label={t("Wohnungsmix")} className="rounded border bg-background px-1 py-0.5"
                    onChange={(e) => riegelAendern(r.id, (x) => ({ ...x, opt: { ...x.opt, mix: e.target.value } }))}>
                    {Object.keys(MIX_VORLAGEN).map((k) => <option key={k} value={k}>{t(`Mix ${k}`)}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

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
