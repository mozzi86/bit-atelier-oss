import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TERRAIN_SOURCE, footprintToGeoJson, osmBuildingsToGeoJson } from "@designer/lib/maplibreStyles";
import { draftToGeoJson } from "@designer/lib/mapDraw";
import { buildSiteParcel } from "@designer/lib/siteParcel";
import { polygonAreaM2 } from "@core/lib/geo";
import { useOsmBuildings } from "@designer/lib/useOsmBuildings";
import MapLibreMap from "./MapLibreMap";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { MapPin, ArrowRight, PenTool, Check, X, Undo2 } from "lucide-react";

const PRESETS = [
  { label: "Nürnberg", lat: 49.4521, lng: 11.0767 },
  { label: "München", lat: 48.1351, lng: 11.582 },
  { label: "Hamburg", lat: 53.5511, lng: 9.9937 },
  { label: "Berlin", lat: 52.52, lng: 13.405 },
];

/** Footprint-Punkte aus complexData: site_parcel bevorzugt, sonst erste designated_area. */
function pickFootprintPoints(complexData) {
  const parcel = complexData?.site_parcel?.points;
  if (Array.isArray(parcel) && parcel.length >= 3) return parcel;
  const area = (complexData?.designated_areas || []).find(
    (a) => Array.isArray(a?.points) && a.points.length >= 3
  );
  return area?.points || null;
}

export default function LocationSelector({ complexData, onLocationChange, onNameChange, projekt = null }) {
  const init = complexData?.location;
  // 72-01 A-10 (Befund N-11): Projektdaten vorbefüllen, damit der Nutzer
  // Name/Standort nicht doppelt tippt. Projekt-Location ist Freitext („Stadt,
  // Land") oder Objekt {address, city, lat, lng} — Koordinaten werden NUR aus
  // einem Objekt übernommen (keine Geokodierung, kein Netzaufruf).
  const projektStandort = typeof projekt?.location === "string"
    ? projekt.location
    : (projekt?.location?.address || projekt?.location?.city || "");
  const [name, setName] = useState(complexData?.name || projekt?.name || "");
  const [lat, setLat] = useState(init?.lat ?? (typeof projekt?.location === "object" ? projekt?.location?.lat : null) ?? 49.4521);
  const [lng, setLng] = useState(init?.lng ?? (typeof projekt?.location === "object" ? projekt?.location?.lng : null) ?? 11.0767);
  const [address, setAddress] = useState(init?.address || projektStandort);
  const [style, setStyle] = useState(complexData?.map_context?.style || "normal");
  const [show3d, setShow3d] = useState(true);
  // Testlauf 26.08.: useState liest Props nur beim ERSTEN Mount — der gespeicherte
  // Standort kommt aber asynchron aus der DB und kam deshalb nie an (Karte blieb
  // auf dem Nürnberg-Default). Nachladen hier synchronisieren; Wert-Vergleich
  // verhindert Überschreiben laufender Eingaben durch den eigenen Rückfluss.
  useEffect(() => {
    const l = complexData?.location;
    if (!l || typeof l.lat !== "number") return;
    setLat((cur) => (cur === l.lat ? cur : l.lat));
    setLng((cur) => (cur === l.lng ? cur : l.lng));
    const adr = l.address ?? l.name ?? "";
    if (adr) setAddress((cur) => (cur === adr ? cur : adr));
  }, [complexData?.location]);
  useEffect(() => {
    if (complexData?.name) setName((cur) => (cur === complexData.name ? cur : complexData.name));
  }, [complexData?.name]);
  // 72-01 A-10: Projekt folgt nach (asynchrone Projektliste) — nur LEERE
  // Felder vorbefüllen, nie Nutzereingaben überschreiben.
  useEffect(() => {
    if (projekt?.name) setName((cur) => (cur ? cur : projekt.name));
    if (projektStandort) setAddress((cur) => (cur ? cur : projektStandort));
  }, [projekt?.name, projektStandort]);
  const [terrainOn, setTerrainOn] = useState(false);
  const [terrainBroken, setTerrainBroken] = useState(false);
  // KARTE-04a: echte Parzelle auf der Karte zeichnen — [lng,lat]-Ring (offen).
  const [parcelRing, setParcelRing] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  drawingRef.current = drawing;
  const ringMarkersRef = useRef([]);

  // Map-Lifecycle lebt jetzt in MapLibreMap (Phase 36, KARTE-02) —
  // hier bleiben nur die Standort-spezifischen Daten-Effekte.
  const mapComp = useRef(null);
  const getMap = () => mapComp.current?.getMap() ?? null;

  const { rawBuildings, offline } = useOsmBuildings(
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  );

  // Footprint-Daten in die Source spielen (initial im load-Handler, sonst direkt).
  useEffect(() => {
    const map = getMap();
    if (!map) return undefined;
    const update = () => {
      const points = pickFootprintPoints(complexData);
      const fc = points
        ? footprintToGeoJson(points, lat, lng)
        : { type: "FeatureCollection", features: [] };
      map.getSource("footprint")?.setData(fc);
    };
    if (map.getSource("footprint")) update();
    else map.once("bit:layers-ready", update);
    return () => map.off("bit:layers-ready", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexData, style]);

  // KARTE-04a: Parzellen-Zeichnung — eigene Source/Layers (amber, damit sie
  // sich vom grünen footprint-Overlay der übernommenen Parzelle abhebt).
  useEffect(() => {
    const map = getMap();
    if (!map) return undefined;
    const update = () => {
      if (!map.getSource("parcel-draft")) {
        map.addSource("parcel-draft", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "parcel-draft-fill",
          type: "fill",
          source: "parcel-draft",
          paint: { "fill-color": "#f59e0b", "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: "parcel-draft-line",
          type: "line",
          source: "parcel-draft",
          paint: { "line-color": "#d97706", "line-width": 3, "line-dasharray": [2, 1.5] },
        });
      }
      // Während des Zeichnens offene Linie, danach geschlossenes Polygon.
      const fc =
        !drawing && parcelRing.length >= 3
          ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "Polygon", coordinates: [[...parcelRing, parcelRing[0]]] },
                },
              ],
            }
          : draftToGeoJson(parcelRing);
      map.getSource("parcel-draft").setData(fc);
    };
    if (map.getSource("footprint")) update();
    else map.once("bit:layers-ready", update);
    return () => map.off("bit:layers-ready", update);
  }, [parcelRing, drawing, style]);

  // Review-Fix 36-02: der [lng,lat]-Ring ist geografisch am Zeichenort
  // verankert. Ändert sich der Standort (Preset, Eingabefeld, Karten-Klick),
  // würde die Übernahme ihn mit dem NEUEN Zentrum konvertieren — Fläche
  // cos(lat)-verzerrt, Canvas-Punkte zehntausende px neben der Konvention,
  // Ring nach easeTo unsichtbar. Deshalb: Zeichnung verwerfen.
  useEffect(() => {
    setParcelRing([]);
    setDrawing(false);
  }, [lat, lng]);

  // Zeichen-Klicks (volle Präzision über das Map-Event; onPick ist derweil stumm).
  // detail>1 verwirft den Zweitklick eines Doppelklicks (sonst doppelte Ecke).
  useEffect(() => {
    const map = getMap();
    if (!map || !drawing) return undefined;
    const onClick = (e) => {
      if (e.originalEvent?.detail > 1) return;
      setParcelRing((r) => [...r, [e.lngLat.lng, e.lngLat.lat]]);
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [drawing, style]);

  // Beim Zeichnen stört der Doppelklick-Zoom (Review-Fix, analog SiteDesigner).
  useEffect(() => {
    const map = getMap();
    if (!map) return;
    if (drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [drawing, style]);

  // Vertex-Handles der Parzelle (draggable; Klick fügt KEINEN Punkt hinzu).
  useEffect(() => {
    const map = getMap();
    if (!map) return undefined;
    ringMarkersRef.current.forEach((m) => m.remove());
    ringMarkersRef.current = [];
    parcelRing.forEach((p, idx) => {
      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #d97706;cursor:grab;box-sizing:border-box;";
      el.addEventListener("click", (ev) => ev.stopPropagation());
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        setParcelRing((r) => r.map((q, i) => (i === idx ? [ll.lng, ll.lat] : q)));
      });
      ringMarkersRef.current.push(m);
    });
    return () => {
      ringMarkersRef.current.forEach((m) => m.remove());
      ringMarkersRef.current = [];
    };
  }, [parcelRing, style]);

  // OSM-Gebäude-Daten + Sichtbarkeits-Toggle.
  useEffect(() => {
    const map = getMap();
    if (!map) return undefined;
    const update = () => {
      map.getSource("osm-bld")?.setData(osmBuildingsToGeoJson(rawBuildings));
      if (map.getLayer("osm-bld-3d")) {
        map.setLayoutProperty("osm-bld-3d", "visibility", show3d ? "visible" : "none");
      }
    };
    if (map.getSource("osm-bld")) update();
    else map.once("bit:layers-ready", update);
    return () => map.off("bit:layers-ready", update);
     
  }, [rawBuildings, show3d, style]);

  // Terrain + Hillshade (AWS terrarium raster-dem, Tile-URL per curl verifiziert).
  useEffect(() => {
    const map = getMap();
    if (!map) return undefined;
    const onDemError = (e) => {
      if (e?.sourceId === "dem") {
        setTerrainBroken(true);
        setTerrainOn(false);
        try {
          map.setTerrain(null);
          if (map.getLayer("hillshade")) map.removeLayer("hillshade");
        } catch {
          /* Map ggf. schon entsorgt */
        }
      }
    };
    const apply = () => {
      try {
        if (terrainOn && !terrainBroken) {
          // Tile-URL per curl verifiziert (HTTP 200, 2026-07-27) — [ASSUMED A1] bestätigt.
          if (!map.getSource("dem")) map.addSource("dem", TERRAIN_SOURCE);
          map.setTerrain({ source: "dem", exaggeration: 1.2 });
          if (!map.getLayer("hillshade")) {
            map.addLayer({
              id: "hillshade",
              type: "hillshade",
              source: "dem",
              paint: { "hillshade-exaggeration": 0.4 },
            });
          }
          map.on("error", onDemError);
        } else {
          map.setTerrain(null);
          if (map.getLayer("hillshade")) map.removeLayer("hillshade");
        }
      } catch {
        setTerrainBroken(true);
        setTerrainOn(false);
      }
    };
    // Review-Fix 36-02 (vorbestehend): "bit:layers-ready" feuert nur EINMAL
    // pro Map-Instanz — war es schon durch und ist der Style transient nicht
    // geladen, lief apply() nie. "idle" feuert nach jedem Settle zuverlässig.
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
    return () => {
      map.off("error", onDemError);
      map.off("idle", apply);
    };
     
  }, [terrainOn, terrainBroken, style]);

  // Fertig gezeichnete Parzelle (offener [lng,lat]-Ring) — null solange gezeichnet wird.
  const fertigeParzelle = !drawing && parcelRing.length >= 3 ? parcelRing : null;
  // m²-Vorschau über dieselbe Fabrik, die auch die Übernahme nutzt (Maßstab m_per_px).
  const parzelleM2 = fertigeParzelle
    ? (() => {
        const p = buildSiteParcel(fertigeParzelle, lat, lng);
        return polygonAreaM2(p.points, p);
      })()
    : 0;

  const apply = () => {
    onNameChange?.(name);
    // KARTE-01: echten Karten-Zoom in den map_context übernehmen (vorher hart 15).
    const zoom = getMap()?.getZoom() ?? 15;
    // KARTE-04a: gezeichnete Parzelle mitgeben — ComplexDesigner macht daraus
    // das echte site_parcel statt des generischen Quadrats.
    onLocationChange?.(
      { lat, lng, address: address || `${lat}, ${lng}` },
      +zoom.toFixed(2),
      style,
      fertigeParzelle
    );
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4" /> Standort & Projekt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pname">Projektname</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Quartier Nordstern" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="addr">Adresse</Label>
            <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Straße, Stadt" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Breite (lat)</Label>
              {/* 72-01 A-12 (Befund N-20): echte geografische Grenzen — ohne
                  max meldet die Barrierefreiheits-Baum valuemax=0 und der
                  Screenreader liest „Maximum 0". lat ∈ [-90, 90] (Grad). */}
              <Input type="number" step="any" min={-90} max={90} value={Number.isFinite(lat) ? lat : ""} onChange={(e) => setLat(e.target.value === "" ? NaN : Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label>Länge (lng)</Label>
              {/* 72-01 A-12: lng ∈ [-180, 180] (Grad). */}
              <Input type="number" step="any" min={-180} max={180} value={Number.isFinite(lng) ? lng : ""} onChange={(e) => setLng(e.target.value === "" ? NaN : Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Kartenstil</Label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="satellite">Satellit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={show3d}
                onChange={(e) => setShow3d(e.target.checked)}
                className="accent-emerald-600"
              />
              Nachbargebäude 3D
              {offline && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                  OSM offline
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={terrainOn}
                disabled={terrainBroken}
                onChange={(e) => setTerrainOn(e.target.checked)}
                className="accent-emerald-600"
              />
              Gelände (3D)
              {terrainBroken && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                  Geländedaten nicht erreichbar
                </span>
              )}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => { setLat(p.lat); setLng(p.lng); setAddress(p.label); }}>
                {p.label}
              </Button>
            ))}
          </div>
          <Button onClick={apply} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600">
            Standort übernehmen & Gelände generieren <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
          <p className="text-xs text-slate-400">
            Tipp: in die Karte klicken, um Koordinaten zu setzen. Rechtsklick ziehen: Karte drehen/neigen.
            Danach werden Grundstück, Topografie und Umgebungsbebauung automatisch erzeugt.
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="relative h-[460px]">
          <MapLibreMap
            ref={mapComp}
            center={{ lat, lng }}
            zoom={14}
            styleKey={style}
            marker
            markerDraggable={!drawing}
            onPick={(la, ln) => {
              // Während des Parzellen-Zeichnens setzen Klicks Eckpunkte,
              // nicht den Standort (eigener click-Handler oben).
              if (drawingRef.current) return;
              setLat(la);
              setLng(ln);
            }}
          />
          {/* KARTE-04a: Zeichen-Werkzeuge als Overlay auf der Karte */}
          <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1">
            {!drawing && (
              <Button
                size="sm"
                variant={parcelRing.length ? "default" : "secondary"}
                className="shadow"
                onClick={() => {
                  setParcelRing([]);
                  setDrawing(true);
                }}
              >
                <PenTool className="w-4 h-4 mr-1" />
                {parcelRing.length ? "Parzelle neu zeichnen" : "Parzelle zeichnen"}
              </Button>
            )}
            {drawing && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shadow"
                  onClick={() => setParcelRing((r) => r.slice(0, -1))}
                  disabled={!parcelRing.length}
                  aria-label="Letzten Punkt entfernen"
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  className="shadow bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => setDrawing(false)}
                  disabled={parcelRing.length < 3}
                >
                  <Check className="w-4 h-4 mr-1" /> Fertig ({parcelRing.length})
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shadow"
                  onClick={() => {
                    setParcelRing([]);
                    setDrawing(false);
                  }}
                  aria-label="Zeichnung verwerfen"
                >
                  <X className="w-4 h-4" />
                </Button>
              </>
            )}
            {!drawing && parcelRing.length >= 3 && (
              <Button
                size="sm"
                variant="secondary"
                className="shadow"
                onClick={() => setParcelRing([])}
                aria-label="Gezeichnete Parzelle verwerfen"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
          {drawing && (
            <div className="absolute bottom-2 left-2 right-2 z-10 rounded bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow">
              Klicke die Grundstücksecken auf der Karte an (mind. 3). Karte ziehen/zoomen bleibt möglich,
              Eckpunkte sind nachziehbar. Mit „Fertig" abschließen.
            </div>
          )}
          {fertigeParzelle && (
            <div className="absolute bottom-2 left-2 z-10 rounded bg-amber-50/95 border border-amber-200 px-2 py-1 text-[11px] text-amber-800 shadow">
              Gezeichnete Parzelle: <b>{parzelleM2.toLocaleString("de-DE")} m²</b> — wird mit
              „Standort übernehmen" als echtes Grundstück gesetzt (statt 1.000-m-Quadrat).
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
