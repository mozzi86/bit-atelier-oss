import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { bitApi } from "@core/api/bitApi";
import { toast } from "sonner";
import { useBimModelSync } from "@core/lib/useBimModelSync";
import { buildingProgram } from "@core/lib/useBuildingProgram";
import { footprintToMeters } from "@core/lib/buildingModel";
import { polygonAreaM2, DEFAULT_METERS_PER_PIXEL } from "@core/lib/geo";
// 75-06 Task 2: convex hull as the union approximation of imported parcels.
import { konvexeHuelle } from "@core/lib/polygonInnen";
import { buildSiteParcel, parcelBbox, bboxIntersects, reanchorParcel, reanchorPoints } from "@designer/lib/siteParcel";
import { istGeneriert } from "@designer/lib/apartments";
// 72-02: Struktur der 30 Reiter als Daten — siehe config/designerNavigation.js.
import { DESIGNER_BEREICHE, aufloesen, bereichFuerTab, reiterFuerTab, reiterImBereich } from "@designer/config/designerNavigation";
import PanelHeader from "@designer/components/PanelHeader";
import { istWerkstattZone } from "@designer/lib/tesselierung";
// MSB-9 (75-06 Task 0): regenerates the workshop ·WT zones from the layer
// after a reload — mounted here so the Massing gets rooms even when the
// workshop tab was never opened.
import { useWerkstattRehydrate } from "@designer/lib/useWerkstattRehydrate";
import { Card, CardContent } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { MapPin, Building, Calculator, Droplets, CheckSquare, Sofa, Boxes, Sparkles, Sun, Plug, CalendarRange, LifeBuoy, ClipboardList, ShieldCheck, Mountain, Frame, Trees, Thermometer, Flame, Accessibility, ClipboardCheck, HandCoins, LayoutTemplate, Volume2, ThermometerSnowflake, Layers, ThermometerSun, Puzzle } from "lucide-react";
import { motion } from "framer-motion";

import { useProject } from "@core/lib/ProjectContext";
import MassingStudio from "../components/MassingStudio";
import SpaceProgram from "../components/SpaceProgram";
import UnitMixCompliance from "../components/UnitMixCompliance";
import LocationSelector from "../components/LocationSelector";
import SiteDesigner from "../components/SiteDesigner";
import BuildingConfig from "../components/BuildingConfig";
import EnergyPlanner from "../components/EnergyPlanner";
import CostCalculator from "../components/CostCalculator";
import FloodRiskAnalyzer from "../components/FloodRiskAnalyzer";
import ProjectPlanner from "../components/ProjectPlanner";
import InteriorDesigner from "../components/InteriorDesigner";
import GenerativeLayout from "../components/GenerativeLayout";
import TerrainView3D from "../components/TerrainView3D";
import BitBimStudio from "../components/BitBimStudio";
import IntegrationsPanel from "../components/IntegrationsPanel";
import SupportPanel from "../components/SupportPanel";
import ClimaAnalysis from "../components/ClimaAnalysis";
import StaticsPlanner from "../components/StaticsPlanner";
import LandscapePlanner from "../components/LandscapePlanner";
import HaustechnikPlanner from "../components/HaustechnikPlanner";
import BrandschutzPlanner from "../components/BrandschutzPlanner";
import AsrRaumdatenblatt from "../components/AsrRaumdatenblatt";
import BarrierefreiheitPlanner from "../components/BarrierefreiheitPlanner";
import SchallschutzPlanner from "../components/SchallschutzPlanner";
import WaermebrueckenPlanner from "../components/WaermebrueckenPlanner";
import BauphysikStudio from "../components/BauphysikStudio";
import RaumklimaPlanner from "../components/RaumklimaPlanner";
import FoerderPlanner from "../components/FoerderPlanner";
import ApartmentPlanner from "../components/ApartmentPlanner";
import WohnungsWerkstatt from "../components/WohnungsWerkstatt";

export default function ComplexDesigner() {
  const [complexData, setComplexData] = useState({
    name: "",
    location: null,
    // 72-01 A-2: kein 1-km²-Werkzeugwert mehr — die Startfläche wird beim
    // Standort-Übernehmen aus dem Projekt abgeleitet (buildSiteParcel). Bis
    // dahin 0: „noch keine Fläche" statt einer falschen Zahl (Befund N-02).
    site_area: 0,
    site_parcel: null,
    // 75-06 Task 2 (MS-06): cadastral parcels, ADDITIVE next to site_parcel.
    // site_parcel stays the ONE reference boundary (union approximation);
    // grundstueck = { flurstuecke: [{ id, nummer, gemarkung, polygon }] } with
    // polygon in canvas px like designated_areas. Old records simply load with
    // grundstueck: null — no migration, no renamed field.
    grundstueck: null,
    // 75-06 Task 6 (D-P75-05): ONE project north angle in degrees (azimuth of
    // the plan's "up" direction, clockwise). Layer values (raumklima/
    // schallschutz/werkstatt) win when set — see @designer/lib/nordwinkel.
    nordwinkel: 0,
    context_buildings: [],
    designated_areas: [],
    buildings: [],
    unit_types: [],
    parking: { total_spaces: 0, parking_key: 1.0, barrier_free_spaces: 0, ev_charging_stations: 0 },
    energy_systems: [],
    topography: { elevation_points: [], slope_analysis: {}, drainage_plan: [] },
    cost_estimate: { construction_cost: 0, infrastructure_cost: 0, energy_system_cost: 0, site_preparation_cost: 0, total_cost: 0, cost_per_m2: 0 },
    interior_designs: [],
    // Raum-Möblierung: { [roomKey]: [{id, typ, x, y, rot}] } — siehe @designer/lib/moebel
    moeblierung: {},
    // Eigene Möbeltypen des Projekts (Phase 43): [{ id, name, b, t, kategorie, benutzerseite }]
    moebel_eigene: [],
    map_context: { center: [51.1657, 10.4515], zoom: 6, style: 'normal' } // Add map_context
  });

  const { project } = useProject();
  // 72-01 A-13: Deep-Link ?tab=<reiter> setzt den Start-Tab (z. B. Redirect
  // von /EnergyAnalysis auf ?tab=energie). Unbekannter Wert → Standard.
  const [searchParams] = useSearchParams();
  // 72-02: Schlüssel, Alias und Bereichszuordnung kommen aus der Registry —
  // in dieser Datei steht keine zweite Reiter-Liste mehr.
  const tabParam = aufloesen(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState(tabParam ?? "site");
  // Nach-Navigation auf denselben Reiter (z. B. zweiter Klick auf die
  // umgeleitete Route) folgt dem Parameter.
  useEffect(() => {
    if (tabParam) setActiveTab(tabParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, searchParams]);
  // Aktiver Arbeitsbereich folgt dem Reiter (Ebene 1 der Navigation).
  const [bereich, setBereich] = useState(() => bereichFuerTab(tabParam ?? "site") ?? "standort");
  useEffect(() => {
    const b = bereichFuerTab(activeTab);
    if (b) setBereich(b);
  }, [activeTab]);
  const [isSaving, setIsSaving] = useState(false);
  // Sprungbrett aus der Wohnungs-Fokusansicht (Phase 61-05): „Zum Innenausbau"
  // dispatcht ein CustomEvent, hier wechselt der Tab auf den Innenausbau-Reiter.
  useEffect(() => {
    const onGoto = () => setActiveTab("interiors");
    window.addEventListener("werkstatt:goto-innenausbau", onGoto);
    return () => window.removeEventListener("werkstatt:goto-innenausbau", onGoto);
  }, []);
  // ID des bestehenden BuildingComplex-Datensatzes je Projekt — speichern
  // aktualisiert dann (update) statt bei jedem Klick ein Duplikat anzulegen.
  const complexRecordId = useRef(null);

  // Beim Mount / Projektwechsel: vorhandenen Entwurf aus der DB rehydrieren,
  // damit Standort, Baufelder, Gebäude & Kosten einen Reload überleben.
  useEffect(() => {
    if (!project?.id) return;
    complexRecordId.current = null;
    let cancelled = false;
    (async () => {
      try {
        const rows = await bitApi.entities.BuildingComplex.filter({ project_id: project.id });
        if (cancelled || !rows?.length) return;
        const { id, ...rest } = rows[0];
        complexRecordId.current = id;
        setComplexData((prev) => ({ ...prev, ...rest }));
      } catch (error) {
        console.error("BuildingComplex laden fehlgeschlagen:", error);
        if (!cancelled) toast.error("Gespeicherter Entwurf konnte nicht geladen werden");
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  // Zentrale Synchronisation: gemeinsame Quelle <-> persistiertes BimModel je
  // Projekt — wirkt für ALLE Tabs, egal welcher zuerst geöffnet wird.
  // I-02 (externe Review Phase 61): a re-mount of this route (navigate away and
  // back) reloads the persisted zones but keeps the session-only zones of the
  // Wohnungsplaner (·W) and the Wohnungs-Werkstatt (·WT) — the same markers as
  // the KD-18 merge in BitBimStudio. On a real project switch nothing survives.
  useBimModelSync(project?.id, { zonenBehalten: (z) => istGeneriert(z) || istWerkstattZone(z) });
  // MSB-9 (D-P75-08): zones live only in the store — regenerate them from the
  // layer after a reload, also when the workshop tab was never mounted.
  useWerkstattRehydrate(project?.id);

  // Baufeld-Planung -> Footprint: 75-06 Task 3 (MSB-3/MS-06): designated_areas
  // now carries TWO roles — type "footprint" feeds the massing body (the
  // existing behaviour, every legacy record has it) and type "baufeld" is the
  // building-envelope reference for the Massing checks. Filtering on
  // "footprint" keeps body and envelope distinct; without the filter the body
  // would equal the envelope by construction and "outside" could never be > 0.
  useEffect(() => {
    const drawn = (complexData.designated_areas || []).find(
      (a) => Array.isArray(a?.points) && a.points.length >= 3 && a?.type === "footprint"
    );
    if (!drawn) return;
    const fp = footprintToMeters(drawn.points, complexData.site_parcel);
    if (fp) buildingProgram.set({ footprintM: fp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexData.designated_areas]);

  // KD-11 + 72-01 A-2: echter Grundstücksbezug für alle Dichtekennwerte.
  // Null nur, solange GAR keine Parzelle da ist. Das generische Startquadrat
  // trägt seit A-2 einen expliziten m_per_px aus der Projektableitung — seine
  // Fläche ist eine gekennzeichnete Schätzung (assumed:true bleibt sichtbar),
  // aber keine 1.000.000-m²-Falschzahl mehr; die Panels zeigen den Hinweis.
  const siteAreaM2 =
    complexData.site_parcel && Number.isFinite(Number(complexData.site_parcel.m_per_px))
      ? Number(complexData.site_area) || null
      : null;

  const updateComplexData = (section, data) => {
    setComplexData(prev => ({
      ...prev,
      [section]: data
    }));
  };

  // 72-01 A-2 rework: "Neu schätzen" re-derives the generic parcel from the
  // building area - for legacy records that still carry the old 1.000.000-m2
  // parcel. Impossible without a location (the parcel is geographically
  // anchored), then a plain-text hint instead.
  const reestimateParcel = () => {
    const loc = complexData.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      toast.info("Erst im Tab „Standort & Karte“ einen Standort übernehmen — dann lässt sich die Parzelle neu schätzen.");
      return;
    }
    const fresh = buildSiteParcel(null, loc.lat, loc.lng, project);
    setComplexData((prev) => ({
      ...prev,
      site_parcel: fresh,
      site_area: polygonAreaM2(fresh.points, fresh),
      // Old (possibly huge) buildings/footprints fitted the 1-km parcel and now
      // lie far outside - discard them like on a location change.
      designated_areas: [],
      buildings: [],
    }));
    toast.success("Parzelle neu geschätzt (Gebäudefläche × 3 [ASSUMED]).");
  };

  const handleLocationUpdate = (location, zoom, style, parcelRing = null) => {
    // This function now orchestrates the automatic data generation
    // 1. Parzelle (KARTE-04a): auf der Karte gezeichneter Ring → echte Parzelle
    // (assumed:false, m_per_px); ohne Ring das Startquadrat aus dem Projekt
    // (72-01 A-2: Gebäudefläche × 3 [ASSUMED], statt des 1-km²-Werkzeugwerts).
    const siteParcel = buildSiteParcel(parcelRing, location.lat, location.lng, project);
    const parcelDrawn = siteParcel.source === "gezeichnet";

    // 2. KD-06: synthetische Topografie (Sinus/Kosinus aus lat/lng + Rauschen).
    // Das sind ausdrücklich KEINE Vermessungs- oder DGM-Daten. Sie werden mit
    // source: "synthetisch" markiert, damit jede Auswertung darauf hinweisen
    // kann, statt sie wie ein Höhenmodell aussehen zu lassen. Gestreut wird
    // über die Bbox der TATSÄCHLICHEN Parzelle (generisch wie gezeichnet) —
    // als Funktion, weil die endgültige Parzelle erst im Updater feststeht
    // (Re-Anchor-Fall). Math.random im Updater ist ok: nur Demo-Streuung.
    const makeTopography = (bbox) => {
      const elevationPoints = [];
      for (let i = 0; i < 15; i++) {
        elevationPoints.push({
          id: `elev_${i}`,
          x: bbox.minX + Math.random() * (bbox.maxX - bbox.minX),
          y: bbox.minY + Math.random() * (bbox.maxY - bbox.minY),
          elevation: parseFloat(((Math.sin(location.lat * i) * 5) + (Math.cos(location.lng * i) * 5) + (Math.random() * 4 - 2)).toFixed(1)),
        });
      }
      return {
        elevation_points: elevationPoints,
        slope_analysis: {},
        drainage_plan: [],
        source: "synthetisch",
        hinweis: "Demo-Topografie aus den Koordinaten erzeugt — keine Vermessungs-/DGM-Daten.",
      };
    };

    // 3. KD-06: vier fest verdrahtete Nachbargebäude — reine Kulisse,
    // ebenfalls standortunabhängig.
    const context_buildings = [
      { x: 50, y: 50, width: 120, height: 80 },
      { x: 700, y: 80, width: 200, height: 150 },
      { x: 950, y: 500, width: 150, height: 100 },
      { x: 100, y: 650, width: 180, height: 120 },
    ];

    setComplexData(prev => {
      // KARTE-04: gezeichnete Baufelder nur verwerfen, wenn sich der Standort
      // WIRKLICH geändert hat — erneutes Übernehmen (z.B. nur Stilwechsel)
      // löschte sonst grundlos die Arbeit des Nutzers.
      const coordsChanged =
        prev.location?.lat !== location.lat || prev.location?.lng !== location.lng;

      // Parzelle bestimmen (KARTE-04a + Review-Fixes 36-02):
      // - frisch gezeichneter Ring ersetzt IMMER (auch bei gleichen Koordinaten)
      // - Standortwechsel: eine gezeichnete Parzelle ist GEOGRAFISCH verankert
      //   und wandert per Re-Anchor mit, statt still zum generischen Quadrat
      //   zu werden; nur außer Reichweite (> ~6 km) fällt sie zurück.
      let nextParcel;
      let nextAreas = prev.designated_areas || [];
      let nextBuildings = prev.buildings || [];
      if (parcelDrawn || !prev.site_parcel) {
        nextParcel = siteParcel;
        if (coordsChanged) nextAreas = [];
      } else if (!coordsChanged) {
        nextParcel = prev.site_parcel;
      } else {
        nextParcel =
          prev.site_parcel.source === "gezeichnet"
            ? reanchorParcel(prev.site_parcel, prev.location, location)
            : null;
        if (nextParcel) {
          // Parzelle wandert mit → Baufelder/Baukörper (ebenfalls geografisch
          // gemeinte Zeichnungen) mit demselben Transform umankern.
          nextAreas = nextAreas.map((a) => {
            if (!Array.isArray(a?.points) || a.points.length < 3) return a;
            const moved = reanchorPoints(a.points, prev.location, location);
            return moved ? { ...a, points: moved } : a;
          });
          nextBuildings = nextBuildings.map((b) => {
            const moved = reanchorPoints([{ x: b.x, y: b.y }], prev.location, location);
            return moved ? { ...b, x: moved[0].x, y: moved[0].y } : b;
          });
        } else {
          nextParcel = siteParcel;
          nextAreas = [];
        }
      }
      const parcelChanged = nextParcel !== prev.site_parcel;

      // Review-Fix: Zeichnungen, die KOMPLETT außerhalb der (neuen) Parzelle
      // liegen, speisten sonst unsichtbar weiter die Kennwerte (BGF, Polygon-
      // Fläche, Footprint der gemeinsamen Quelle).
      if (parcelChanged) {
        const pBB = parcelBbox(nextParcel.points);
        nextAreas = nextAreas.filter(
          (a) =>
            !Array.isArray(a?.points) ||
            a.points.length < 3 ||
            bboxIntersects(parcelBbox(a.points), pBB)
        );
        nextBuildings = nextBuildings.filter((b) =>
          bboxIntersects(
            {
              minX: Number(b?.x) || 0,
              minY: Number(b?.y) || 0,
              maxX: (Number(b?.x) || 0) + (Number(b?.width) || 0),
              maxY: (Number(b?.y) || 0) + (Number(b?.height) || 0),
            },
            pBB
          )
        );
      }

      return {
        ...prev,
        location,
        name: prev.name || `Projekt ${location.address}`,
        site_parcel: nextParcel,
        // 72-01 A-2: JEDE neue Parzelle liefert eine echte Fläche — gezeichnet
        // wie generisch (das Startquadrat trägt jetzt einen expliziten
        // m_per_px aus der Projektableitung, polygonAreaM2 rechnet korrekt).
        site_area: parcelChanged
          ? polygonAreaM2(nextParcel.points, nextParcel)
          : prev.site_area,
        context_buildings: coordsChanged || !prev.context_buildings?.length ? context_buildings : prev.context_buildings,
        context_buildings_source: "synthetisch",
        topography:
          parcelChanged || !prev.topography?.elevation_points?.length
            ? makeTopography(parcelBbox(nextParcel.points))
            : prev.topography,
        designated_areas: nextAreas,
        buildings: nextBuildings,
        map_context: { center: [location.lat, location.lng], zoom: zoom, style: style } // Save map context
      };
    });

    // Switch to massing tab to show the result
    setActiveTab("massing");
  };

  const saveComplex = async () => {
    if (!complexData.name || !complexData.location) return;
    
    setIsSaving(true);
    try {
      const payload = { ...complexData, project_id: project?.id ?? null };
      if (complexRecordId.current) {
        await bitApi.entities.BuildingComplex.update(complexRecordId.current, payload);
      } else {
        const created = await bitApi.entities.BuildingComplex.create(payload);
        complexRecordId.current = created?.id ?? null;
      }
      toast.success("Entwurf gespeichert");
    } catch (error) {
      console.error("Error saving complex:", error);
      toast.error("Speichern fehlgeschlagen — bitte erneut versuchen");
    } finally {
      setIsSaving(false);
    }
  };

  // 75-06 Task 2 (D-P75-04): GeoJSON parcel import — pure parse in
  // @designer/lib/flurstueckImport, this handler owns the data-model write.
  // grundstueck.flurstuecke is ADDITIVE; site_parcel is only replaced when no
  // DRAWN parcel exists yet (a hand-drawn boundary wins over an import).
  // Union approximation: the convex hull of all parcel points — NOT a true
  // polygon union ([ASSUMED], needs a boolean library = new dependency).
  const handleFlurstueckImport = (flurstuecke) => {
    if (!Array.isArray(flurstuecke)) return;
    setComplexData((prev) => {
      // Empty list = the user deleted the last parcel row: clear the model
      // field, but keep any derived site_parcel (additive, no migration).
      if (!flurstuecke.length) {
        return { ...prev, grundstueck: { ...(prev.grundstueck || {}), flurstuecke: [] } };
      }
      const next = { ...prev, grundstueck: { ...(prev.grundstueck || {}), flurstuecke } };
      const hatGezeichneteParzelle = prev.site_parcel?.source === "gezeichnet";
      if (!hatGezeichneteParzelle) {
        // Derive the reference boundary from the imported parcels: convex hull
        // of every point, area via polygonAreaM2 on the SAME canvas px.
        const allePunkte = flurstuecke.flatMap((f) => f.polygon || []);
        const huelle = konvexeHuelle(allePunkte);
        if (huelle.length >= 3) {
          const mPerPx = Number(prev.site_parcel?.m_per_px) || DEFAULT_METERS_PER_PIXEL;
          next.site_parcel = {
            id: prev.site_parcel?.id || "site_parcel_main",
            type: "site_boundary",
            // Mehr als ein Flurstück → die Hülle ist eine Näherung der
            // Vereinigung, deshalb assumed:true (sichtbar in den Panels).
            assumed: flurstuecke.length > 1,
            source: "flurstuecke",
            m_per_px: mPerPx,
            points: huelle.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
          };
          next.site_area = Math.round(polygonAreaM2(huelle, { m_per_px: mPerPx }));
        }
      }
      return next;
    });
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"
        >
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              Komplex-Designer
            </h1>
            <p className="text-slate-600 mt-1">
              Städtebauliches Massing-Studio mit Kennzahlen, Verschattung und Standortanalyse
              {project && <> · <span className="font-medium text-slate-700">{project.name}</span></>}
            </p>
          </div>
          <Button
            onClick={saveComplex}
            disabled={isSaving || !complexData.name || !complexData.location}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg"
          >
            {isSaving ? "Speichern…" : "Entwurf speichern"}
          </Button>
        </motion.div>

        {/* Testlauf 26.08. (Referenzprojekt): Der Designer startet mit Werkzeug-Voreinstellungen
            (Zeichenfeld 3.500 m², Massing-Rechteck, WE-Schätzung …). Ohne erfassten
            Entwurf sahen diese Defaults wie ein Projektstand aus. Ein Banner an der
            Wurzel statt 27 Banner in den Reitern. */}
        {!(complexData.site_parcel || complexData.buildings?.length || complexData.designated_areas?.length || complexData.unit_types?.length) && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-4 py-2.5 text-sm flex flex-wrap items-center gap-3">
            {/* 72-02 (Befund N-10): ein Satz und ein Knopf statt sechs Zeilen
                Warntext. Die ausführliche Erklärung steht im Reiter „Hilfe";
                der Stand je Reiter steht jetzt im PanelHeader. */}
            <span>
              <strong>Noch keine Geometrie für dieses Projekt.</strong> Alle Kennzahlen sind
              Werkzeug-Voreinstellungen, kein Projektstand.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-900 hover:bg-amber-100"
              onClick={() => { setBereich("standort"); setActiveTab("site"); }}
            >
              Parzelle zeichnen
            </Button>
            <button
              type="button"
              className="text-amber-800 underline underline-offset-2 hover:text-amber-900"
              onClick={() => { setBereich("ergebnis"); setActiveTab("support"); }}
            >
              Was heißt das?
            </button>
          </div>
        )}

        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <div className="border-b border-slate-200 p-3">
                {/* Ebene 1: die fünf Arbeitsbereiche (72-02, Befund N-09). */}
                <div className="flex flex-wrap gap-1 mb-2" role="tablist" aria-label="Arbeitsbereiche">
                  {DESIGNER_BEREICHE.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => { setBereich(b.id); const erste = reiterImBereich(b.id)[0]; if (erste) setActiveTab(erste.key); }}
                      aria-current={bereich === b.id ? "true" : undefined}
                      className={
                        bereich === b.id
                          ? "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-emerald-600 text-white shadow-sm"
                          : "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }
                    >
                      {b.titel}
                    </button>
                  ))}
                </div>
                {/* Ebene 2: die Reiter des aktiven Bereichs. */}
                <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100">
                  {reiterImBereich(bereich).map((r) => {
                    const Icon = r.icon;
                    return (
                      <TabsTrigger key={r.key} value={r.key} className="flex items-center gap-2">
                        <Icon className="w-4 h-4" /> {r.label}
                      </TabsTrigger>
                    );
                  })}                </TabsList>
              </div>

              {/* 72-02: eine Zeile statt Textwand — braucht / liefert / Stand. */}
              <PanelHeader reiter={reiterFuerTab(activeTab)} bereichTitel={DESIGNER_BEREICHE.find((b) => b.id === bereich)?.titel} />

              <TabsContent value="studio" className="p-6">
                <MassingStudio
                  lat={project?.location?.lat || complexData.location?.lat || 50.1}
                  projectName={project?.name || complexData.name}
                  parcel={complexData.site_parcel}
                  /* 75-06 Task 3 (MSB-3): the three site levels as props;
                     baufeld/grundstueck edits flow back into complexData. */
                  baufelder={complexData.designated_areas}
                  grundstueck={complexData.grundstueck}
                  nordwinkel={complexData.nordwinkel}
                  onBaufeldChange={(points) => {
                    // Replace the points of the FIRST "baufeld" polygon (the
                    // Massing check reference); keep every other area intact.
                    const areas = complexData.designated_areas || [];
                    const idx = areas.findIndex((a) => a?.type === "baufeld");
                    if (idx < 0) return;
                    const next = areas.map((a, i) => (i === idx ? { ...a, points } : a));
                    updateComplexData("designated_areas", next);
                  }}
                  onGrundstueckChange={(points) => {
                    // Single-parcel editing only (the Massing exposes the hull
                    // display-only when several parcels exist).
                    const liste = complexData.grundstueck?.flurstuecke;
                    if (!Array.isArray(liste) || liste.length !== 1) return;
                    updateComplexData("grundstueck", {
                      ...complexData.grundstueck,
                      flurstuecke: [{ ...liste[0], polygon: points }],
                    });
                  }}
                  onNordwinkelChange={(winkel) => updateComplexData("nordwinkel", winkel)}
                />
              </TabsContent>

              <TabsContent value="program" className="p-6">
                <SpaceProgram siteArea={siteAreaM2} />
              </TabsContent>

              <TabsContent value="compliance" className="p-6">
                <UnitMixCompliance siteArea={siteAreaM2} parking={complexData.parking} />
              </TabsContent>

              <TabsContent value="site" className="p-6">
                <LocationSelector 
                  complexData={complexData}
                  projekt={project}
                  onLocationChange={handleLocationUpdate}
                  onNameChange={(name) => updateComplexData('name', name)}
                />
              </TabsContent>

              <TabsContent value="massing" className="p-6">
                <SiteDesigner 
                  complexData={complexData}
                  projektTyp={project?.type ?? null}
                  onReestimateParcel={reestimateParcel}
                  onAreasChange={(areas) => updateComplexData('designated_areas', areas)}
                  onSiteAreaChange={(area) => updateComplexData('site_area', area)}
                  onBuildingsChange={(buildings) => updateComplexData('buildings', buildings)}
                  onFlurstueckImport={handleFlurstueckImport}
                />
              </TabsContent>

              <TabsContent value="terrain" className="p-6">
                <TerrainView3D />
              </TabsContent>

              <TabsContent value="bim" className="p-6">
                <BitBimStudio complexData={complexData} />
              </TabsContent>

              <TabsContent value="buildings" className="p-6">
                <BuildingConfig 
                  complexData={complexData}
                  onBuildingsChange={(buildings) => updateComplexData('buildings', buildings)}
                  onUnitsChange={(units) => updateComplexData('unit_types', units)}
                  onParkingChange={(parking) => updateComplexData('parking', parking)}
                />
              </TabsContent>

              <TabsContent value="statics" className="p-6">
                <StaticsPlanner />
              </TabsContent>

              <TabsContent value="landscape" className="p-6">
                <LandscapePlanner complexData={complexData} />
              </TabsContent>

              <TabsContent value="haustechnik" className="p-6">
                <HaustechnikPlanner complexData={complexData} />
              </TabsContent>

              <TabsContent value="brandschutz" className="p-6">
                <BrandschutzPlanner />
              </TabsContent>

              <TabsContent value="asr" className="p-6">
                <AsrRaumdatenblatt complexData={complexData} />
              </TabsContent>

              <TabsContent value="barrierefreiheit" className="p-6">
                <BarrierefreiheitPlanner />
              </TabsContent>

              <TabsContent value="acoustics" className="p-6">
                <SchallschutzPlanner />
              </TabsContent>

              <TabsContent value="waermebruecken" className="p-6">
                <WaermebrueckenPlanner />
              </TabsContent>

              <TabsContent value="bauphysik" className="p-6">
                <BauphysikStudio />
              </TabsContent>

              <TabsContent value="raumklima" className="p-6">
                <RaumklimaPlanner />
              </TabsContent>

              <TabsContent value="funding" className="p-6">
                <FoerderPlanner />
              </TabsContent>

              <TabsContent value="apartments" className="p-6">
                <ApartmentPlanner />
              </TabsContent>

              <TabsContent value="werkstatt" className="p-6">
                {/* 75-09 Task 6: furniture wiring — the focus writes ONLY through
                    the callback into complexData.moeblierung (same path as
                    InteriorDesigner below, never a store write). speicherbar
                    mirrors saveComplex's guard (needs name + location). */}
                <WohnungsWerkstatt
                  moeblierung={complexData.moeblierung}
                  moebelEigene={complexData.moebel_eigene}
                  onMoeblierungChange={(m) => updateComplexData('moeblierung', m)}
                  speicherbar={!!complexData.name && !!complexData.location}
                />
              </TabsContent>

              <TabsContent value="interiors" className="p-6">
                <InteriorDesigner 
                  complexData={complexData}
                  onInteriorDesignsChange={(designs) => updateComplexData('interior_designs', designs)}
                  onMoeblierungChange={(moeblierung) => updateComplexData('moeblierung', moeblierung)}
                  onMoebelEigeneChange={(liste) => updateComplexData('moebel_eigene', liste)}
                />
              </TabsContent>

              <TabsContent value="analysis" className="p-6">
                <ClimaAnalysis complexData={complexData} />
              </TabsContent>
              
              <TabsContent value="generative" className="p-6">
                <GenerativeLayout complexData={complexData} siteArea={siteAreaM2} />
              </TabsContent>

              <TabsContent value="energy" className="p-6">
                <EnergyPlanner 
                  complexData={complexData}
                  onEnergySystemsChange={(systems) => updateComplexData('energy_systems', systems)}
                />
              </TabsContent>

              <TabsContent value="costs" className="p-6">
                <CostCalculator 
                  complexData={complexData}
                  onCostUpdate={(costs) => updateComplexData('cost_estimate', costs)}
                />
              </TabsContent>

              <TabsContent value="integrations" className="p-6">
                <IntegrationsPanel />
              </TabsContent>
              
              <TabsContent value="planner" className="p-6">
                <ProjectPlanner 
                  selectedProject={complexData}
                />
              </TabsContent>
              
              <TabsContent value="flood_risk" className="p-6">
                <FloodRiskAnalyzer 
                  selectedProject={complexData}
                />
              </TabsContent>
              
              <TabsContent value="support" className="p-6">
                <SupportPanel />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}