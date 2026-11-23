import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { bitApi } from "@core/api/bitApi";
import { toast } from "sonner";
import { leereKomplexHistorie, aufzeichnen, gesteStart, gesteEnde, gesteAbbrechen, schrittZurueck, schrittVor, verlaufNummern } from "@core/lib/komplexHistorie.js";
import { useBimModelSync, storeGehoertZu, loadBimModel, wertKurz } from "@core/lib/useBimModelSync";
// 115-05a (A-4, K6): the design record is written as a patch of the changed fields on its strict base, merged three ways on a 409
import { komplexPatch, komplexFremdUebernehmen, komplexDatensatzWaehlen, KOMPLEX_VERWALTUNG, KOMPLEX_LAGE_GRUPPE, KOMPLEX_ABGELEITET, KOMPLEX_FELDNAMEN, LAGE } from "@core/lib/abgleich/komplexAbgleich.js";
import { abgleichStand } from "@core/lib/abgleich/abgleichStand";
import { gleichWert } from "@core/lib/abgleich/dreiWege";
import { EN as EN_STANDSCHUTZ } from "@core/lib/i18nTeile/standschutz-115-05.js"; // 115-05a: lazy part (entry chunk budget)
import { buildingProgram, useBuildingProgram } from "@core/lib/useBuildingProgram";
import { footprintToMeters } from "@core/lib/buildingModel";
import { polygonAreaM2, metersPerPixel } from "@core/lib/geo";
// 101-03: true union of imported parcels (replaces the 75-06 convex-hull approximation).
import { grundstueckAusFlurstuecken } from "@designer/lib/flurstueckImport";
import { buildSiteParcel, parcelBbox, bboxIntersects, reanchorParcel, reanchorPoints } from "@designer/lib/siteParcel";
import { istGeneriert } from "@designer/lib/apartments";
// 72-02: Struktur der 30 Reiter als Daten — siehe config/designerNavigation.js.
// 115-03: tabs per kind of project (reiterFuerProjektart) and the direct views of the building model come from there too.
import {
  DESIGNER_BEREICHE, aufloesen, bereichFuerTab, reiterFuerTab, reiterFuerProjektart, projektartVon, ausgeblendeteReiter,
  PROJEKTARTEN, BIM_ANSICHTEN, GEBAEUDEMODELL_TAB, ANSICHT_PARAMETER, bimAnsichtAusParam,
} from "@designer/config/designerNavigation";
import { wohnungsmixAnzahl } from "@designer/lib/kennzahlen";
import PanelHeader from "@designer/components/PanelHeader";
import { istWerkstattZone } from "@designer/lib/tesselierung";
// MSB-9 (75-06 Task 0): regenerates the workshop ·WT zones from the layer
// after a reload — mounted here so the Massing gets rooms even when the
// workshop tab was never opened.
import { useWerkstattRehydrate } from "@designer/lib/useWerkstattRehydrate";
// W-1118-02: furniture keys follow the room GUID — migration on open (already in this chunk through InteriorDesigner)
import { migriereMoeblierung } from "@designer/lib/moebel";
// W-1118-02 review R-3: the GUID the studio pins per room _idx (steckbrief.js is in this chunk already through BitBimStudio)
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { Button } from "@core/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { MapPin, Building, Calculator, Droplets, CheckSquare, Sofa, Boxes, Sparkles, Sun, Plug, CalendarRange, LifeBuoy, ClipboardList, ShieldCheck, Mountain, Frame, Trees, Thermometer, Flame, Accessibility, ClipboardCheck, HandCoins, LayoutTemplate, Volume2, ThermometerSnowflake, Layers, ThermometerSun, Puzzle } from "lucide-react";

import { useProject } from "@core/lib/ProjectContext";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { bauartVon, herkunftZeile } from "@core/lib/bauart";
import { aufbauGrundlage } from "@core/lib/bimClassification";
import { footprintQuelleText, footprintQuelleBaufeldPlanung, footprintUebernahme, flaechenHash } from "@core/lib/footprintQuelle";
import { EN as EN_EFH_108 } from "@core/lib/i18nTeile/efh-108.js"; // 108-01: lazy part (footprint note); 115-03: navigation texts
import MassingStudio from "../components/MassingStudio";
import LocationSelector from "../components/LocationSelector";
import SiteDesigner from "../components/SiteDesigner";
import BuildingConfig from "../components/BuildingConfig";
import BauaufnahmePanel from "../components/BauaufnahmePanel";
import TerrainView3D from "../components/TerrainView3D";
import BitBimStudio from "../components/BitBimStudio";
// 107-10 (size budget): rarely used tab panels load on demand — the designer chunk was at 100 % of chunk_max after 107-09.
// Only the active TabsContent mounts, so each panel's chunk is fetched when its tab is opened; the tab bar stays usable meanwhile.
// 115-05c (size): tab panels that are only shown on their tab load lazily (the designer chunk was at its size budget; the draft
// mode and the parallel stair work need room) - rendered inside ReiterLaden like the other lazy panels
const SpaceProgram = React.lazy(() => import("../components/SpaceProgram"));
const UnitMixCompliance = React.lazy(() => import("../components/UnitMixCompliance"));
const InteriorDesigner = React.lazy(() => import("../components/InteriorDesigner"));
const BrandschutzPlanner = React.lazy(() => import("../components/BrandschutzPlanner"));
const ApartmentPlanner = React.lazy(() => import("../components/ApartmentPlanner"));
const WohnungsWerkstatt = React.lazy(() => import("../components/WohnungsWerkstatt"));
const FoerderPlanner = React.lazy(() => import("../components/FoerderPlanner"));
const FloodRiskAnalyzer = React.lazy(() => import("../components/FloodRiskAnalyzer"));
const SupportPanel = React.lazy(() => import("../components/SupportPanel"));
const IntegrationsPanel = React.lazy(() => import("../components/IntegrationsPanel"));
const ProjectPlanner = React.lazy(() => import("../components/ProjectPlanner"));
const WaermebrueckenPlanner = React.lazy(() => import("../components/WaermebrueckenPlanner"));
const BauphysikStudio = React.lazy(() => import("../components/BauphysikStudio"));
const RaumklimaPlanner = React.lazy(() => import("../components/RaumklimaPlanner"));
const AsrRaumdatenblatt = React.lazy(() => import("../components/AsrRaumdatenblatt"));
const LandscapePlanner = React.lazy(() => import("../components/LandscapePlanner"));
const ClimaAnalysis = React.lazy(() => import("../components/ClimaAnalysis"));
const StaticsPlanner = React.lazy(() => import("../components/StaticsPlanner"));
const BarrierefreiheitPlanner = React.lazy(() => import("../components/BarrierefreiheitPlanner"));
const SchallschutzPlanner = React.lazy(() => import("../components/SchallschutzPlanner"));
const HaustechnikPlanner = React.lazy(() => import("../components/HaustechnikPlanner"));
const GenerativeLayout = React.lazy(() => import("../components/GenerativeLayout"));
const EnergyPlanner = React.lazy(() => import("../components/EnergyPlanner"));
const NachhaltigkeitKarte = React.lazy(() => import("../components/NachhaltigkeitKarte"));
// Wave 1 (KD-09): the cost tab loads like its siblings — its flat cost model and assumption texts grew the
// ComplexDesigner chunk, which is the largest JS chunk of the build (budget chunk_max). Radix tabs mount only the
// active panel, so the tab's effects (costEstimate mirror, onCostUpdate) run exactly when they ran before.
const CostCalculator = React.lazy(() => import("../components/CostCalculator"));
// 115-05b part 2 (A-5): the focus check and its banner - lazy (size budget of this chunk); a failed load shows nothing, never an error
// 115-05c (D-115-12): the draft bar (state, "Speichern", "Verwerfen", leave dialog, one tab per project) and the draft module, lazily
const EntwurfLeiste = React.lazy(() => import("../components/EntwurfLeiste.jsx"));
const entwurfModul = () => import("@core/lib/entwurf/entwurfStand.js");
const StandWaechterHinweis = React.lazy(() => import("../components/StandWaechterHinweis.jsx").catch(() => ({ default: () => null })));

englischErgaenzen(EN_EFH_108); // 108-01: lazy i18n part of phase 108
englischErgaenzen(EN_STANDSCHUTZ); // 115-05a: the conflict card of the design record and its notes

/**
 * Suspense boundary of one lazy tab panel (107-10): a quiet status line while the panel's chunk is on the wire.
 * @param {{children: React.ReactNode}} props
 */
function ReiterLaden({ children }) {
  const { t } = useI18n();
  return (
    <React.Suspense fallback={<div role="status" aria-live="polite" className="py-8 text-sm text-muted-foreground">{t("Wird geladen …")}</div>}>
      {children}
    </React.Suspense>
  );
}

/** 115-03: browser key of the switch "Alle Reiter zeigen" — a view preference per browser, never project data. */
const ALLE_REITER_SCHLUESSEL = "bit.designer.alle-reiter";

/**
 * 115-03: reads the remembered switch "Alle Reiter zeigen". Storage may be blocked (private window): then off.
 * @returns {boolean} true when the user asked to see every tab
 */
function alleReiterGemerkt() {
  try { return window.localStorage.getItem(ALLE_REITER_SCHLUESSEL) === "1"; } catch { return false; }
}

/**
 * 115-03: remembers the switch "Alle Reiter zeigen" for this browser.
 * @param {boolean} an new state of the switch
 * @returns {void} writes localStorage; a blocked storage is ignored — the switch then holds for this visit only
 */
function alleReiterMerken(an) {
  try {
    if (an) window.localStorage.setItem(ALLE_REITER_SCHLUESSEL, "1");
    else window.localStorage.removeItem(ALLE_REITER_SCHLUESSEL);
  } catch { /* storage blocked: nothing to remember, the state in memory still works */ }
}

/**
 * 115-03 (W-1115-02): direct way to the views of the building model — "Grundriss" first, then section and 3D. Sits at the
 * right end of the tab row (same place in every area), so it is a shortcut inside the existing navigation, not a second
 * one. No pressed state on purpose: which view is open is shown by the studio's own switcher; these buttons only open.
 * The accessible names start with "Gebäudemodell:" — they must not read "Ansicht Grundriss" (the studio's switcher).
 * @param {{ onWahl: (ansicht: string) => void }} props onWahl gets the view id of BIM_ANSICHTEN
 */
function DirektAnsichten({ onWahl }) {
  const { t } = useI18n();
  return (
    <div className="ml-auto flex items-center gap-2" role="group" aria-label={t("Gebäudemodell direkt öffnen")} data-testid="designer-direkt">
      <span className="hidden xl:inline text-xs text-muted-foreground whitespace-nowrap" aria-hidden="true">{t("Gebäudemodell")}</span>
      <div className="flex items-center rounded-md border border-border overflow-hidden">
        {BIM_ANSICHTEN.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onWahl(a.id)}
            data-testid={`designer-direkt-${a.id}`}
            aria-label={`${t("Gebäudemodell")}: ${t(a.label)}`}
            title={`${t("Gebäudemodell")}: ${t(a.label)}`}
            className={"flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" + (i > 0 ? " border-l border-border" : "")}
          >
            <a.icon className="w-4 h-4" aria-hidden="true" /> {t(a.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 115-03: status and switch for the tabs hidden for this kind of project — the ONE place that says what is hidden, with one
 * button to show everything (115-DESIGN §6). Renders nothing when the kind of project hides no tab.
 * @param {{ projektart: string|null, anzahl: number, namen: string[], alle: boolean, onAlle: (an: boolean) => void }} props
 *   projektart = key of PROJEKTARTEN, anzahl = number of hidden tabs (pieces), namen = their labels,
 *   alle = switch state, onAlle = called with the new state
 */
function ReiterUmschalter({ projektart, anzahl, namen, alle, onAlle }) {
  const { t } = useI18n();
  if (!projektart || anzahl < 1) return null;
  const art = t(PROJEKTARTEN[projektart]?.titel || "");
  const stand = alle
    ? t("{art}: alle Reiter sichtbar").replace("{art}", art)
    : t("{art}: {n} Reiter ausgeblendet").replace("{art}", art).replace("{n}", String(anzahl));
  return (
    <button
      type="button"
      aria-pressed={alle}
      onClick={() => onAlle(!alle)}
      data-testid="designer-alle-reiter"
      title={`${stand} — ${namen.join(", ")}`}
      className={"px-2 py-1 rounded-md text-xs whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " + (alle ? "bg-muted text-foreground" : "text-muted-foreground")}
    >
      <span className="sr-only">{stand}. </span>
      <span className="hidden xl:inline" aria-hidden="true">{art} · </span>
      {t("Alle Reiter zeigen")}{!alle && <span aria-hidden="true"> (+{anzahl})</span>}
    </button>
  );
}

/** 101-05: tabs that work as a full-height drawing surface (no page scroll from lg up). */
const ARBEITSFLAECHE_REITER = new Set(["site", "massing", "studio", "bim"]);

/** 73-04: tabs that compute on the build-up (Bauteilaufbau) and show its provenance in an existing building. */
const AUFBAU_REITER = new Set(["acoustics", "waermebruecken", "bauphysik", "energy"]);
/** 73-05: tabs that work on the building outline and show its provenance. */
const UMRISS_REITER = new Set(["studio", "massing", "bim", "buildings", "program"]);

/**
 * Start values of the design record (BuildingComplex) — the state of a project without a stored record. 108-01 review: also the
 * state a project switch resets to, so no area (or anything else) of the previous project stays in the new one.
 * @returns start values, a new object on every call (type inferred from the literal, as the useState initialiser before)
 */
function komplexStart() {
  return {
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
    // 101-04: bars / perimeter blocks of the site plan: [{ id, punkte (canvas px), geschlossen, opt }]
    riegel: [],
    unit_types: [],
    parking: { total_spaces: 0, parking_key: 1.0, barrier_free_spaces: 0, ev_charging_stations: 0 },
    // 108-12 (finding 15a): dwellings / parking spaces typed in by hand in the massing studio, ADDITIVE
    // ({ wohneinheiten: number|null, stellplaetze: number|null }); null = automatic (unit mix, parking key, estimate). Old records load with null.
    kennzahlen_hand: null,
    energy_systems: [],
    topography: { elevation_points: [], slope_analysis: {}, drainage_plan: [] },
    // 103-03: design flood levels typed in the flood tab, ADDITIVE ({ hq: [{ id, name, pegelNHN, quelle }] });
    // marks on the water level slider of the 3D terrain view. Old records load with null.
    hochwasser: null,
    cost_estimate: { construction_cost: 0, infrastructure_cost: 0, energy_system_cost: 0, site_preparation_cost: 0, total_cost: 0, cost_per_m2: 0 },
    interior_designs: [],
    // Raum-Möblierung: { [zoneKey]: [{id, typ, x, y, rot}] } — keys guid:/id:/level:name, see @designer/lib/moebel
    moeblierung: {},
    // Eigene Möbeltypen des Projekts (Phase 43): [{ id, name, b, t, kategorie, benutzerseite }]
    moebel_eigene: [],
    map_context: { center: [51.1657, 10.4515], zoom: 6, style: 'normal' } // Add map_context
  };
}

// ---- 115-05a (A-4, K6): stand protection of the design record (BuildingComplex) ----
// Before, the autosave wrote the WHOLE record without `?stand` (the server let the last writer win), the updated_date of the load
// rode along in the body (every later save got the hint "changed meanwhile", also without another writer), "Entwurf speichern"
// bypassed the queue and complexRecordId was read only when the save ran. Now: only the changed fields leave the page, on the
// strict base; pid, id and stand are frozen when the save is planned; a 409 is merged per field (komplexAbgleich.js) - the
// site/location fields as ONE unit (K6c); a field with an open conflict card is held back from every save (K6a) and what only the
// other writer changed is taken over at once (K6b). The card is the page-wide one of the Layout (no viewer shows source "komplex").

/** Fields held back per project while their conflict card is open (K6a). @type {Map<string, Set<string>>} */
const komplexSperren = new Map();
/** The page's own version of each open design-record card, kept when the designer unmounts (card id → field values). @type {Map<string, Record<string, any>>} */
const komplexMeinStand = new Map();
/**
 * The designer mounted now — a card's resolver acts on it, never on the closures of an unmounted one (pattern studioHalter).
 * @type {{current: {pid: string, zustand: () => Record<string, any>, setzen: (w: Record<string, any>) => void,
 *   basis: () => ({id: string|null, updated_date: string|null, felder: Record<string, any>}|undefined),
 *   schreiben: (werte: Record<string, any>) => Promise<boolean>}|null}}
 */
const komplexHalter = { current: null };
/** A writer whose name is not known (a refused save tells only that someone was faster). */
const UNBEKANNT_GERAET = Object.freeze({ name: "", unbekannt: true });

/** @param {string} einheit "lage" or a field name @returns {ReadonlyArray<string>} the fields a card of this unit holds back */
const einheitFelder = (einheit) => (einheit === LAGE ? KOMPLEX_LAGE_GRUPPE : [einheit]);

/** 115-05c: draft fields of the design record (the site group as one unit + the cost estimate derived from it, entwurfRegeln.js). */
const ENTWURF_KOMPLEX = Object.freeze([...KOMPLEX_LAGE_GRUPPE, "cost_estimate"]);
/** 115-05d: what an undo step of the site data is called in the hint "Rückgängig: …", by the first field that changed. */
const KOMPLEX_SCHRITT_NAME = Object.freeze({ site_parcel: "Grundstück", grundstueck: "Grundstück", designated_areas: "Baufeld", buildings: "Baukörper", riegel: "Baukörper",
  location: "Standort", map_context: "Standort", nordwinkel: "Nordwinkel", topography: "Gelände", context_buildings: "Umgebung", context_buildings_source: "Umgebung" });
/** @param {Record<string, any>} patch @returns {Record<string, any>} the patch without draft fields (they wait for "Speichern") */
const ohneEntwurf = (patch) => Object.fromEntries(Object.entries(patch).filter(([k]) => !ENTWURF_KOMPLEX.includes(k)));

/** @param {string} pid @returns {Set<string>} fields of the project held back by an open card (a copy) */
function komplexGesperrt(pid) {
  return new Set(komplexSperren.get(pid) || []);
}

/** @param {string} pid @param {ReadonlyArray<string>} felder */
function komplexFreigeben(pid, felder) {
  const m = komplexSperren.get(pid);
  if (!m) return;
  for (const f of felder) m.delete(f);
  if (!m.size) komplexSperren.delete(pid);
}

// a lock lives exactly as long as its card (decided, or dropped with another project) - pattern useBimModelSync.js
abgleichStand.abonnieren(() => {
  if (!komplexSperren.size && !komplexMeinStand.size) return;
  const offen = abgleichStand.stand().konflikte.filter((k) => k.quelle === "komplex");
  for (const [pid, felder] of [...komplexSperren]) {
    const noch = new Set(offen.filter((k) => k.projektId === pid).flatMap((k) => einheitFelder(k.feld)));
    komplexFreigeben(pid, [...felder].filter((f) => !noch.has(f)));
  }
  for (const id of [...komplexMeinStand.keys()]) if (!offen.some((k) => k.id === id)) komplexMeinStand.delete(id);
});

/**
 * The fields of a design record in the normal form the comparison uses: start values + record, without administration fields
 * (so start values never count as a change, ComplexDesigner komplexStart).
 * @param {Record<string, any>|null|undefined} rec stored record or the page's complexData
 * @returns {Record<string, any>}
 */
function komplexNormal(rec) {
  return Object.fromEntries(Object.entries({ ...komplexStart(), ...(rec || {}) }).filter(([k]) => !KOMPLEX_VERWALTUNG.includes(k)));
}

/** @param {Record<string, any>|null|undefined} o @param {ReadonlyArray<string>} felder @returns {Record<string, any>} */
const auswahl = (o, felder) => Object.fromEntries(felder.map((k) => [k, o?.[k]]));

/** @param {any} rec an answer of the API @returns {Record<string, any>} its fields without administration (no start values added) */
const komplexOhneVerwaltung = (rec) => (rec && typeof rec === "object"
  ? Object.fromEntries(Object.entries(rec).filter(([k]) => !KOMPLEX_VERWALTUNG.includes(k))) : {});

/**
 * A planned write of the design record (115-05a): pid, record id and stand frozen when planned.
 * @typedef {{pid: string, id: string|null, stand: string|null, basisFelder: Record<string, any>, patch: Record<string, any>,
 *   voll?: Record<string, any>}} KomplexPlan
 *   basisFelder = the base the patch was computed against; voll = the whole state (normal form) for a create without a record
 */

/**
 * Both versions of a design-record conflict as short text (data text of the card; field keys like konfliktZeilen does).
 * @param {import("@core/lib/abgleich/komplexAbgleich.js").KomplexKonflikt} k
 * @returns {Array<{schluessel: null, name: string, mein: string, fremd: string}>}
 */
function komplexZeilen(k) {
  const name = KOMPLEX_FELDNAMEN[k.einheit] ?? k.einheit;
  if (k.einheit !== LAGE) return [{ schluessel: null, name, mein: wertKurz(k.mein), fremd: wertKurz(k.fremd) }];
  /** the fields one side changed against the base, scalars with their value @param {Record<string, any>} seite */
  const text = (seite) => k.felder.filter((f) => !gleichWert(seite?.[f], k.basis?.[f]))
    .map((f) => (seite?.[f] !== null && typeof seite?.[f] === "object" ? f : `${f} ${wertKurz(seite?.[f])}`)).join(", ") || "—";
  return [{ schluessel: null, name, mein: text(k.mein), fremd: text(k.fremd) }];
}

/**
 * "Meine Fassung behalten" of a design-record card: the lock goes and the own values are written at once on the current stand —
 * through the mounted designer, or (none mounted) as a partial PUT on a freshly read record with its stand (a write in between
 * answers 409 and the card stays).
 * @param {string} pid @param {string} einheit
 */
async function komplexMeinBehalten(pid, einheit) {
  const id = `komplex:${einheit}`;
  const felder = einheitFelder(einheit);
  const h = komplexHalter.current?.pid === pid ? komplexHalter.current : null;
  const werte = h ? auswahl(h.zustand(), felder) : komplexMeinStand.get(id);
  komplexFreigeben(pid, felder);
  komplexMeinStand.delete(id);
  if (!werte) return;
  // 115-05c: the site group is a draft field - with the designer mounted "keep mine" stays in the draft ("Speichern" writes it)
  if (h && einheit === LAGE) return;
  if (h) { await h.schreiben(werte); return; }
  const frisch = /** @type {any} */ (komplexDatensatzWaehlen(await bitApi.entities.BuildingComplex.filter({ project_id: pid })).datensatz);
  if (frisch?.id) await bitApi.entities.BuildingComplex.update(frisch.id, werte, { stand: frisch.updated_date ?? null });
}

/**
 * "Fassung des anderen Geräts übernehmen": the fields go back to the stored state (the base after the 409), the lock goes; nothing
 * is written.
 * @param {string} pid @param {string} einheit
 */
function komplexFremdNehmen(pid, einheit) {
  const felder = einheitFelder(einheit);
  const h = komplexHalter.current?.pid === pid ? komplexHalter.current : null;
  komplexFreigeben(pid, felder);
  komplexMeinStand.delete(`komplex:${einheit}`);
  const b = h?.basis();
  if (h && b) h.setzen(auswahl(b.felder, felder));
}

/**
 * Reports one design-record conflict (page-wide card) and holds its fields back until the person decides (K6a).
 * @param {string} pid @param {import("@core/lib/abgleich/komplexAbgleich.js").KomplexKonflikt} k
 */
function komplexKonfliktMelden(pid, k) {
  const sperre = komplexSperren.get(pid) || new Set();
  for (const f of einheitFelder(k.einheit)) sperre.add(f);
  komplexSperren.set(pid, sperre);
  abgleichStand.konfliktMelden({
    quelle: "komplex", projektId: pid, feld: k.einheit, titel: KOMPLEX_FELDNAMEN[k.einheit] ?? k.einheit, geraet: UNBEKANNT_GERAET,
    zeilen: komplexZeilen(k),
    loesen: { mein: () => komplexMeinBehalten(pid, k.einheit), fremd: () => komplexFremdNehmen(pid, k.einheit) },
  });
}

/**
 * 115-05c: the site group of a draft goes onto the freshly loaded design record - on its own base as it is, on another state of the
 * same record three ways (the group as ONE unit, entwurfRebase); a draft made on another record / a record gone is never continued
 * automatically (it waits, offenSetzen).
 * @param {typeof import("@core/lib/entwurf/entwurfStand.js")} E @param {string} pid
 * @param {import("@core/lib/entwurf/modellEntwurf.js").ModellEntwurf|null} entwurf @param {any} datensatz the stored record (null = none)
 * @returns {{werte: Record<string, any>, konflikte: any[]}} werte = fields to put into complexData; konflikte = cards to show
 */
function komplexEntwurfEinspielen(E, pid, entwurf, datensatz) {
  const mein = entwurf?.aenderungen.komplex || {};
  if (!Object.keys(mein).length) return { werte: {}, konflikte: [] };
  const basis = entwurf?.basis.komplex;
  const wahl = E.entwurfEntscheiden(basis, datensatz);
  if (wahl === "ersetzt" || wahl === "geloescht") { E.offenSetzen(pid, wahl); return { werte: {}, konflikte: [] }; }
  if (wahl === "gleich") return { werte: mein, konflikte: [] };
  const r = E.entwurfRebase({ teil: "komplex", basis: basis?.felder || {}, mein, server: komplexNormal(datensatz) });
  return { werte: r.werte, konflikte: r.konflikte };
}

export default function ComplexDesigner() {
  const [complexData, setComplexData] = useState(komplexStart);
  // 115-05d: set inside the updater of a write that is not the person's — "leeren" (load, foreign state, conflict, discard) or
  // "anwenden" (the undo itself); read and cleared by the history effect below
  const komplexStillRef = useRef(/** @type {"leeren"|"anwenden"|null} */ (null));

  const { project } = useProject();
  // 72-01 A-13: Deep-Link ?tab=<reiter> setzt den Start-Tab (z. B. Redirect
  // von /EnergyAnalysis auf ?tab=energie). Unbekannter Wert → Standard.
  const [searchParams] = useSearchParams();
  // 72-02: Schlüssel, Alias und Bereichszuordnung kommen aus der Registry —
  // in dieser Datei steht keine zweite Reiter-Liste mehr.
  const tabParam = aufloesen(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState(tabParam ?? "site");
  // 73-02: second reading of the registry for existing buildings — braucht/stand per kind of work, the
  // "Gemessen" badge carries the survey's provenance (latest BimSnapshot of the project). Without a survey
  // the measured tabs say "Offen" instead of pretending measured data.
  const bauart = bauartVon(project).bauart;
  const programmStand = /** @type {{footprintQuelle?: any}} */ (useBuildingProgram());
  const [bestandSnap, setBestandSnap] = useState(null);
  useEffect(() => {
    if (bauart !== "bestand" || !project?.id) { setBestandSnap(null); return undefined; }
    let weg = false;
    bitApi.entities.BimSnapshot.filter({ project_id: project.id })
      .then((r) => { if (!weg) setBestandSnap((r || [])[0] || null); })
      .catch(() => { if (!weg) setBestandSnap(null); });
    return () => { weg = true; };
  }, [bauart, project?.id]);
  // Nach-Navigation auf denselben Reiter (z. B. zweiter Klick auf die
  // umgeleitete Route) folgt dem Parameter.
  // 115-03: `?tab=bim&ansicht=grundriss|schnitt|3d` opens the building model in that view. The wish is handed to the studio
  // as a prop ({ ansicht, n } — n counts, so the same view can be asked for twice); the direct buttons of the header use
  // the same path. It is dropped when another tab opens, so coming back by the tab row starts the studio as usual.
  const ansichtParam = bimAnsichtAusParam(searchParams.get(ANSICHT_PARAMETER));
  const [bimAnsicht, setBimAnsicht] = useState(/** @type {{ansicht: string|null, n: number}} */ ({ ansicht: null, n: 0 }));
  useEffect(() => {
    if (tabParam) setActiveTab(tabParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, searchParams]);
  // Follows the VALUES of the two parameters only — an unrelated change of the query string must not force the view again.
  useEffect(() => {
    if (tabParam === GEBAEUDEMODELL_TAB && ansichtParam) setBimAnsicht((w) => ({ ansicht: ansichtParam, n: w.n + 1 }));
  }, [tabParam, ansichtParam]);
  useEffect(() => {
    if (activeTab !== GEBAEUDEMODELL_TAB) setBimAnsicht((w) => (w.ansicht ? { ...w, ansicht: null } : w));
  }, [activeTab]);
  // Aktiver Arbeitsbereich folgt dem Reiter (Ebene 1 der Navigation).
  const [bereich, setBereich] = useState(() => bereichFuerTab(tabParam ?? "site") ?? "standort");
  useEffect(() => {
    const b = bereichFuerTab(activeTab);
    if (b) setBereich(b);
  }, [activeTab]);
  // 115-03: tabs per kind of project. The kind comes from what the project says about its use (projektartVon): Project.type,
  // the typology of the dwelling workshop (werkstatt_layer.typ, read once per project through the shared loadBimModel cache —
  // read only, no second writer on that layer) and the unit mix of the design record (complexData.unit_types, live). A failed
  // load leaves the kind unknown = every tab visible, the safe side; the load error itself is reported by useBimModelSync
  // (SyncHinweis). "Alle Reiter zeigen" is remembered per browser.
  const [werkstattTyp, setWerkstattTyp] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    setWerkstattTyp(null);
    if (!project?.id) return undefined;
    let weg = false;
    loadBimModel(project.id)
      .then((m) => { if (!weg) setWerkstattTyp(m?.werkstatt_layer?.typ ?? null); })
      .catch(() => { if (!weg) setWerkstattTyp(null); });
    return () => { weg = true; };
  }, [project?.id]);
  const [alleReiter, setAlleReiter] = useState(alleReiterGemerkt);
  const projektart = projektartVon({ projektTyp: project?.type ?? null, werkstattTyp, wohneinheiten: wohnungsmixAnzahl(complexData.unit_types) });
  const reiterJeBereich = reiterFuerProjektart(projektart, { alle: alleReiter, aktiv: activeTab });
  const ausgeblendet = ausgeblendeteReiter(projektart);
  /** Opens the building model in one view (direct buttons): area 3, tab `bim`, the wish goes to the studio as a prop. */
  const oeffneGebaeudemodell = (/** @type {string} */ ansicht) => {
    setBimAnsicht((w) => ({ ansicht, n: w.n + 1 }));
    setBereich("gebaeude");
    setActiveTab(GEBAEUDEMODELL_TAB);
  };
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
  // 95-01: autosave state — only after the record was loaded (never overwrite unread data), only when
  // something changed since the load, serialised (two overlapping saves would create two records).
  const geladenAls = useRef(/** @type {string|null} */ (null));
  const speichertGerade = useRef(Promise.resolve());
  // 115-05a (A-4): the stored base per project (record id, updated_date = the strict `stand`, fields in the normal form komplexNormal)
  // — the load, every successful write (its answer) and every 409 (the stored record) set it; the autosave sends what differs from it
  const komplexBasisJe = useRef(/** @type {Map<string, {id: string|null, updated_date: string|null, felder: Record<string, any>}>} */ (new Map()));
  // the save planned and not yet sent (flushed on a project switch / unmount); pid, id and stand frozen when planned
  const ausstehendKomplexRef = useRef(/** @type {KomplexPlan|null} */ (null));
  const complexDataRef = useRef(complexData);
  complexDataRef.current = complexData;
  const projektIdRef = useRef(/** @type {string|null} */ (project?.id ?? null));
  projektIdRef.current = project?.id ?? null;
  const gemountetRef = useRef(false);
  useEffect(() => { gemountetRef.current = true; return () => { gemountetRef.current = false; }; }, []);

  // 108-01 review: the project whose BuildingComplex record (or the knowledge that it has none) is in complexData — the footprint takeover
  // below waits for it, so the areas of the previous project can never be taken over into the next one
  const [complexGeladenFuer, setComplexGeladenFuer] = useState(/** @type {string|null} */ (null));
  const komplexProjekt = useRef(/** @type {string|null} */ (null));

  // Beim Mount / Projektwechsel: vorhandenen Entwurf aus der DB rehydrieren,
  // damit Standort, Baufelder, Gebäude & Kosten einen Reload überleben.
  useEffect(() => {
    // 115-05a (A-4): what the autosave still had pending for the previous project is written now, with its frozen pid / id / stand
    const pend = ausstehendKomplexRef.current;
    if (pend && pend.pid !== project?.id) {
      ausstehendKomplexRef.current = null;
      komplexSchreibenRef.current(pend).catch((error) => console.error("Entwurf beim Projektwechsel nicht gespeichert:", error));
    }
    if (!project?.id) return;
    complexRecordId.current = null;
    geladenAls.current = null;
    setComplexGeladenFuer(null);
    // 108-01 review: a real project switch inside the mounted designer starts from the start values (before, everything of the previous
    // project stayed when the new one has no record, and a record without a field kept the previous project's value). The autosave
    // stays quiet on them (no name / location), like on a fresh mount.
    if (komplexProjekt.current && komplexProjekt.current !== project.id) setComplexData(() => { komplexStillRef.current = "leeren"; return komplexStart(); });
    komplexProjekt.current = project.id;
    const pid = project.id;
    let cancelled = false;
    (async () => {
      try {
        // 115-05c: the draft of this project (this page, or the browser after a reload) is read beside the record (no extra wait
        // before the record goes on screen - an input made in between would be overwritten by the late load)
        const [rows, [E, start]] = await Promise.all([bitApi.entities.BuildingComplex.filter({ project_id: pid }),
          entwurfModul().then(async (m) => /** @type {const} */ ([m, await m.starten(pid)]))]);
        if (cancelled) return;
        // 115-05b (E-3): old data may hold two records of one project (two tabs created one each before the server refused a
        // second create) - the newest is the design, none is deleted, the person is told
        const wahl = komplexDatensatzWaehlen(rows);
        if (wahl.anzahl > 1) {
          console.warn(`[BuildingComplex] ${wahl.anzahl} Datensätze für Projekt ${pid} — der neueste (${wahl.datensatz?.id}) wird verwendet`);
          toast.warning(tf("Für dieses Projekt sind {{n}} Entwürfe gespeichert — der neueste wird verwendet, keiner wurde gelöscht.").replace("{{n}}", String(wahl.anzahl)));
        }
        const entwurf = komplexEntwurfEinspielen(E, pid, start.entwurf, wahl.datensatz);
        if (!wahl.datensatz) {
          komplexBasisJe.current.set(pid, { id: null, updated_date: null, felder: komplexNormal({}) });
          if (Object.keys(entwurf.werte).length) setComplexData((prev) => { komplexStillRef.current = "leeren"; return { ...prev, ...entwurf.werte }; });
          geladenAls.current = "leer"; setComplexGeladenFuer(pid); return;
        }
        const { id, ...rest } = wahl.datensatz;
        complexRecordId.current = id;
        // 115-05a (A-4): the base of the strict writes — the loaded state as complexData holds it (start values + record)
        komplexBasisJe.current.set(pid, { id, updated_date: wahl.datensatz.updated_date ?? null, felder: komplexNormal(wahl.datensatz) });
        setComplexData((prev) => {
          komplexStillRef.current = "leeren"; // 115-05d: a load is no undo step
          const neu = { ...prev, ...rest };
          geladenAls.current = JSON.stringify(neu);
          return { ...neu, ...entwurf.werte };
        });
        for (const k of entwurf.konflikte) komplexKonfliktMelden(pid, k);
        setComplexGeladenFuer(pid);
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
  const bimGeladen = useBimModelSync(project?.id, { zonenBehalten: (z) => istGeneriert(z) || istWerkstattZone(z) }); // 108-01: reactive load flag
  // MSB-9 (D-P75-08): zones live only in the store — regenerate them from the
  // layer after a reload, also when the workshop tab was never mounted.
  useWerkstattRehydrate(project?.id);

  // Baufeld-Planung -> Footprint: 75-06 Task 3 (MSB-3/MS-06): designated_areas
  // now carries TWO roles — type "footprint" feeds the massing body (the
  // existing behaviour, every legacy record has it) and type "baufeld" is the
  // building-envelope reference for the Massing checks. Filtering on
  // "footprint" keeps body and envelope distinct; without the filter the body
  // would equal the envelope by construction and "outside" could never be > 0.
  // 108-01 (D-EFH-05): the area overwrites footprintM only after the project's BimModel record is loaded (before, the load order decided by
  // chance) and only when the outline has no provenance or came from the site planning itself and the area changed (hash); an outline
  // drawn or measured in the model is kept and a note offers "Übernehmen" (footprintQuelle.footprintUebernahme). Asked once per area.
  // 108-01 review: BOTH records must belong to the open project — the BimModel (bimGeladen, useBimModelSync) and the BuildingComplex
  // (complexGeladenFuer); with only the first one, a switch let the previous project's area overwrite the new outline. The note's
  // "Übernehmen" checks again on click that the same project is still open (storeGehoertZu), it can stay on screen for 20 s.
  const gefragtFuer = useRef(/** @type {string|null} */ (null));
  useEffect(() => { gefragtFuer.current = null; }, [project?.id]);
  const { t: tf } = useI18n();
  useEffect(() => {
    const pid = project?.id || null;
    if (!bimGeladen || !pid || complexGeladenFuer !== pid) return;
    const drawn = (complexData.designated_areas || []).find(
      (a) => Array.isArray(a?.points) && a.points.length >= 3 && a?.type === "footprint"
    );
    if (!drawn) return;
    const fp = footprintToMeters(drawn.points, complexData.site_parcel);
    if (!fp) return;
    const mpp = metersPerPixel(complexData.site_parcel);
    const hash = flaechenHash(drawn.points, mpp);
    const stand = buildingProgram.get();
    const uebernehmen = () => buildingProgram.set({ footprintM: fp, footprintQuelle: footprintQuelleBaufeldPlanung(drawn.points, new Date(), mpp) });
    const regel = footprintUebernahme(stand.footprintQuelle, hash, stand.footprintM, fp);
    if (regel === "uebernehmen") uebernehmen();
    else if (regel === "rueckfrage" && gefragtFuer.current !== hash) {
      gefragtFuer.current = hash;
      toast(tf("Umriss der Baufeld-Planung weicht ab"), {
        description: tf("Das Gebäudemodell hat einen eigenen Umriss ({{quelle}}). Die Fläche der Baufeld-Planung wird erst nach „Übernehmen“ verwendet.")
          .replace("{{quelle}}", footprintQuelleText(stand.footprintQuelle) || "—"),
        action: { label: tf("Übernehmen"), onClick: () => {
          if (storeGehoertZu(pid)) uebernehmen();
          else toast.error(tf("Projekt gewechselt — der Umriss wurde nicht übernommen."));
        } },
        duration: 20000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexData.designated_areas, bimGeladen, complexGeladenFuer, project?.id]);

  // W-1118-02: furniture follows the room GUID. On open — once BOTH records of THIS project are loaded (the store zones of the
  // BimModel and complexData of the BuildingComplex) — old keys are moved by migriereMoeblierung (`id:<_idx>` only when the
  // furniture provably lies in that room, else it stays and the Innenausbau tab lists it as "Möbel ohne Raum"). Runs here, not in
  // the Innenausbau tab, so every reader (ASR data sheet, apartment focus) sees the moved keys without opening that tab. It also
  // runs again when the rooms change (own studio save writing the GUIDs back, or another device's save through the stream).
  // Final review F1: a change that is ONLY this migration (the state equals what was loaded / last saved) must not go through the
  // 95-01 autosave — that writes the WHOLE complexData, and a tab opened long ago and left alone would put its old copy over what
  // other tabs stored since, without anybody touching it. Such a change is marked as saved and only the field moeblierung is
  // stored, migrated from the FRESH record (moeblierungMigrierenSpeichern). With unsaved changes of the person the autosave
  // stores everything anyway, the migration included (unchanged).
  const zonenImStore = /** @type {{zones?: any[]}} */ (programmStand).zones;
  /**
   * Final review F1: stores ONLY the migrated furniture field of the project's BuildingComplex. Reads the fresh record (another tab
   * may have stored furniture or anything else since this tab loaded it), migrates ITS furniture with the same rooms and writes
   * this one field on the strict base (106-09 `stand`): a write in between answers 409 and nothing is overwritten — the next open
   * migrates again. Queued behind the autosaves (speichertGerade). Side effect: one GET and at most one PUT.
   * @param {string} pid project the migration ran for @param {any[]} zonen store zones it ran with
   * @param {import("@designer/lib/moebel").IdPruefOptionen} opts the same GUID evidence
   */
  const moeblierungMigrierenSpeichern = (pid, zonen, opts) => {
    speichertGerade.current = speichertGerade.current.then(async () => {
      try {
        const id = complexRecordId.current;
        if (!id) return;
        // 115-05b (E-4): the answer goes into the three-way path with the base (komplexStandNehmen) - a field both this tab and the
        // other writer changed gets its card and lock, never dropped; without the designer of this project mounted the base stays.
        // Part 2: the write lives in a lazily loaded module (size budget of this chunk; unit test moebelMigration-11505b).
        const { moeblierungMigrationSchreiben } = await import("../lib/moebelMigrationSpeichern.js");
        await moeblierungMigrationSchreiben({ api: bitApi.entities.BuildingComplex, pid, id, zonen, opts,
          aktiv: () => komplexBasisJe.current.has(pid) && gemountetRef.current && projektIdRef.current === pid,
          nehmen: (gespeichert) => komplexStandNehmen(pid, gespeichert) });
      } catch (error) {
        if (/** @type {any} */ (error)?.status === 409) return; // written in between: not overwritten, the next open migrates again
        console.error("Möbel-Schlüssel konnten nicht gespeichert werden:", error);
      }
    });
  };
  useEffect(() => {
    const pid = project?.id || null;
    // storeGehoertZu: the shared store still holds THIS project's rooms (a switch must never re-key with the previous rooms)
    if (!bimGeladen || !pid || complexGeladenFuer !== pid || !storeGehoertZu(pid)) return;
    // review R-3: the GUID the studio's save pins for a room record with this _idx (BitBimStudio guidsAnheften, same project id) —
    // a room still carrying it was never renumbered, so its stacked copies on other storeys do not make its id: entry ambiguous
    const opts = { guidAusIdx: (/** @type {number|string} */ idx) => bauteilGuid(pid, "customZones", { _idx: /** @type {any} */ (idx) }) };
    const zonen = zonenImStore || [];
    const r = migriereMoeblierung(complexData.moeblierung, zonen, opts);
    if (!r.verschoben) return;
    const neu = { ...complexData, moeblierung: r.moeblierung };
    // 115-05a: "the state equals what was loaded / last saved" is now "no field differs from the stored base"; the migrated field
    // counts as stored for the autosave (its patch leaves it out) while the fresh record is migrated and written on its own
    const basis = komplexBasisJe.current.get(pid);
    if (geladenAls.current != null && basis && !Object.keys(komplexPatch(basis.felder, complexData)).length) {
      komplexBasisJe.current.set(pid, { ...basis, felder: { ...basis.felder, moeblierung: r.moeblierung } });
      moeblierungMigrierenSpeichern(pid, zonen, opts);
    }
    // another update queued in between: skip — the effect runs again with that state
    setComplexData((prev) => (prev === complexData ? neu : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bimGeladen, complexGeladenFuer, project?.id, zonenImStore, complexData]);

  // KD-11 + 72-01 A-2: echter Grundstücksbezug für alle Dichtekennwerte.
  // Null nur, solange GAR keine Parzelle da ist. Das generische Startquadrat
  // trägt seit A-2 einen expliziten m_per_px aus der Projektableitung — seine
  // Fläche ist eine gekennzeichnete Schätzung (assumed:true bleibt sichtbar),
  // aber keine 1.000.000-m²-Falschzahl mehr; die Panels zeigen den Hinweis.
  const siteAreaM2 =
    complexData.site_parcel && Number.isFinite(Number(complexData.site_parcel.m_per_px))
      ? Number(complexData.site_area) || null
      : null;

  // ---- 115-05d (C-2 … C-4): ONE undo history of the site data (plot, envelopes, blocks, bars, location) on the page ----
  // The page outlives its tabs, so the history outlives a tab switch. It OBSERVES the site group: whatever writer changed it (plan,
  // map, parcel import, "Neu schätzen", the massing page) lands in the same order of steps. Writes that are not the person's
  // (load, a foreign state taken over, a conflict decided, discard, the undo itself) set komplexStillRef in their updater and are
  // not recorded; all but the undo itself start a fresh history (a snapshot from before would bring old elements back).
  // A pointer held down is one gesture = one step (window listeners below); Esc inside it takes the step off again when the editor
  // has written the state of the press back.
  const komplexHistorieRef = useRef(leereKomplexHistorie());
  const komplexVorherRef = useRef(/** @type {{pid: string|null, werte: Record<string, any>, bild: string}|null} */ (null));
  const [komplexVerlaufStand, setKomplexVerlaufStand] = useState({ zurueck: 0, vor: 0 });
  const komplexVerlaufMelden = () => setKomplexVerlaufStand({ zurueck: komplexHistorieRef.current.past.length, vor: komplexHistorieRef.current.future.length });
  useEffect(() => {
    const pid = project?.id ?? null;
    const werte = Object.fromEntries(KOMPLEX_LAGE_GRUPPE.map((k) => [k, complexData[k]]));
    const bild = JSON.stringify(KOMPLEX_LAGE_GRUPPE.filter((k) => !KOMPLEX_ABGELEITET.includes(k)).map((k) => complexData[k] ?? null));
    const v = komplexVorherRef.current;
    const still = komplexStillRef.current;
    komplexStillRef.current = null;
    const jetzt = { pid, werte, bild };
    if (!v || v.pid !== pid || complexGeladenFuer !== pid || still === "leeren") {
      komplexVorherRef.current = jetzt;
      if (komplexHistorieRef.current.past.length || komplexHistorieRef.current.future.length) { komplexHistorieRef.current = leereKomplexHistorie(); komplexVerlaufMelden(); }
      return;
    }
    komplexVorherRef.current = jetzt;
    if (v.bild === bild || still === "anwenden") return;
    const feld = KOMPLEX_LAGE_GRUPPE.find((k) => !KOMPLEX_ABGELEITET.includes(k) && JSON.stringify(v.werte[k] ?? null) !== JSON.stringify(werte[k] ?? null));
    komplexHistorieRef.current = aufzeichnen(komplexHistorieRef.current, v.werte, { label: KOMPLEX_SCHRITT_NAME[feld] || "Lage" });
    komplexVerlaufMelden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexData, project?.id, complexGeladenFuer]);
  useEffect(() => {
    /** @type {ReturnType<typeof setTimeout>|null} */
    let ende = null;
    const runter = () => { if (ende) { clearTimeout(ende); ende = null; } komplexHistorieRef.current = gesteStart(komplexHistorieRef.current); };
    // the release closes the gesture a moment later: the change of the last pointer move is recorded in an effect after this event
    const hoch = () => { if (ende) clearTimeout(ende); ende = setTimeout(() => { ende = null; komplexHistorieRef.current = gesteEnde(komplexHistorieRef.current); }, 80); };
    const taste = (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Escape" || !komplexHistorieRef.current.ziehe) return;
      setTimeout(() => {
        const vorher = komplexHistorieRef.current;
        komplexHistorieRef.current = gesteAbbrechen(vorher, komplexVorherRef.current?.werte);
        if (komplexHistorieRef.current !== vorher) komplexVerlaufMelden();
      }, 60);
    };
    window.addEventListener("pointerdown", runter, true);
    window.addEventListener("pointerup", hoch, true);
    window.addEventListener("pointercancel", hoch, true);
    window.addEventListener("keydown", taste, true);
    return () => {
      if (ende) clearTimeout(ende);
      window.removeEventListener("pointerdown", runter, true);
      window.removeEventListener("pointerup", hoch, true);
      window.removeEventListener("pointercancel", hoch, true);
      window.removeEventListener("keydown", taste, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const komplexSchritt = (/** @type {"zurueck"|"vor"} */ richtung) => {
    const jetzt = Object.fromEntries(KOMPLEX_LAGE_GRUPPE.map((k) => [k, complexDataRef.current[k]]));
    const r = richtung === "vor" ? schrittVor(komplexHistorieRef.current, jetzt) : schrittZurueck(komplexHistorieRef.current, jetzt);
    if (!r) return false;
    komplexHistorieRef.current = r.historie;
    komplexVerlaufMelden();
    complexDataRef.current = { ...complexDataRef.current, ...r.werte };
    setComplexData((prev) => { komplexStillRef.current = "anwenden"; return { ...prev, ...r.werte }; });
    toast.info(`${richtung === "vor" ? tf("Wiederholt") : tf("Rückgängig")}: ${tf(r.label)}`, { id: "komplex-verlauf", duration: 1800 });
    return true;
  };
  const komplexVerlauf = { rueckgaengig: () => komplexSchritt("zurueck"), wiederholen: () => komplexSchritt("vor"),
    kannZurueck: komplexVerlaufStand.zurueck > 0, kannVor: komplexVerlaufStand.vor > 0, schritte: komplexVerlaufStand.zurueck,
    nummern: () => verlaufNummern(komplexHistorieRef.current) }; // for one order with other histories of the page (neuesterVerlauf)

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
      riegel: [],
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
      let nextRiegel = Array.isArray(prev.riegel) ? prev.riegel : [];
      if (parcelDrawn || !prev.site_parcel) {
        nextParcel = siteParcel;
        if (coordsChanged) { nextAreas = []; nextRiegel = []; }
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
          nextRiegel = nextRiegel.map((x) => {
            const moved = Array.isArray(x?.punkte) ? reanchorPoints(x.punkte, prev.location, location) : null;
            return moved ? { ...x, punkte: moved } : x;
          });
          // 95-04: the metre mirror (mitte_m) moves by the same offset, otherwise it would
          // contradict x/y after the re-anchor.
          const mpp = metersPerPixel(prev.site_parcel);
          nextBuildings = nextBuildings.map((b) => {
            const moved = reanchorPoints([{ x: b.x, y: b.y }], prev.location, location);
            if (!moved) return b;
            const neu = { ...b, x: moved[0].x, y: moved[0].y };
            if (b.mitte_m) {
              neu.mitte_m = {
                x: Math.round((b.mitte_m.x + (moved[0].x - b.x) * mpp) * 1000) / 1000,
                y: Math.round((b.mitte_m.y + (moved[0].y - b.y) * mpp) * 1000) / 1000,
              };
            }
            return neu;
          });
        } else {
          nextParcel = siteParcel;
          nextAreas = [];
          nextRiegel = [];
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
        nextRiegel = nextRiegel.filter((x) => !Array.isArray(x?.punkte) || x.punkte.length < 2 || bboxIntersects(parcelBbox(x.punkte), pBB));
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
        riegel: nextRiegel,
        map_context: { center: [location.lat, location.lng], zoom: zoom, style: style } // Save map context
      };
    });

    // Switch to massing tab to show the result
    setActiveTab("massing");
  };

  // 95-01: save automatically 1.5 s after a change once name and location are set — before, the drawn
  // parcel and everything else lived only until the page was left, unless "Entwurf speichern" was pressed.
  // 115-05a (A-4): only the fields that differ from the stored base, without the fields of an open card (K6a); the plan (pid, id,
  // stand frozen) waits in ausstehendKomplexRef until its timer fires, so a project switch / unmount can flush it.
  useEffect(() => {
    const pid = project?.id;
    // 115-05c: the site group is reported to the draft (written with "Speichern"), the other fields keep their autosave
    if (pid) void komplexMeldenRef.current(pid);
    if (!pid || geladenAls.current == null || !complexData.name || !complexData.location) return undefined;
    const basis = komplexBasisJe.current.get(pid);
    if (!basis) return undefined;
    const patch = ohneEntwurf(komplexPatch(basis.felder, complexData, komplexGesperrt(pid)));
    if (!Object.keys(patch).length) {
      if (ausstehendKomplexRef.current?.pid === pid) ausstehendKomplexRef.current = null;
      return undefined;
    }
    /** @type {KomplexPlan} */
    // 115-05c: a create by the autosave carries the STORED values of the draft fields (start values) - the site group of an unsaved
    // draft never reaches the record without "Speichern"
    const plan = { pid, id: basis.id, stand: basis.updated_date, basisFelder: basis.felder, patch,
      voll: { ...komplexNormal(complexData), ...Object.fromEntries(ENTWURF_KOMPLEX.map((k) => [k, basis.felder?.[k]])) } };
    ausstehendKomplexRef.current = plan;
    const t = setTimeout(() => {
      // review 115-05a (R-11505a-01): "Entwurf speichern" or a flush took this plan over meanwhile - writing it again created a
      // second record when the project had none yet (its id was frozen as null)
      if (ausstehendKomplexRef.current !== plan) return;
      ausstehendKomplexRef.current = null;
      komplexSchreiben(plan).catch((error) => {
        console.error("Automatisches Speichern fehlgeschlagen:", error);
        toast.error(tf("Automatisches Speichern fehlgeschlagen — bitte „Entwurf speichern“"));
      });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- komplexSchreiben / tf read refs and stable setters at call time
  }, [complexData, project?.id]);

  /**
   * 115-05b part 2: another stored state of the design record comes in - a 409 of its write, the furniture migration's answer (E-4),
   * the focus check (StandWaechterHinweis). Merged three ways (komplexFremdUebernehmen); the base moves with the merge. With the
   * designer of `pid` mounted, what only the other writer changed comes into the state (K6b) and each conflict gets its card and
   * lock (K6a); otherwise only the base moves (the caller decides, see the 409 path).
   * @param {string} pid @param {any} gespeichert the stored record
   * @param {{id: string|null, updated_date: string|null, felder: Record<string, any>}} [basis] the base it is compared with
   * @param {Record<string, any>} [mein] the own state (default: the page's state now)
   * @returns {ReturnType<typeof komplexFremdUebernehmen>}
   */
  const komplexStandNehmen = (pid, gespeichert, basis = komplexBasisJe.current.get(pid), mein = komplexNormal(complexDataRef.current)) => {
    const r = komplexFremdUebernehmen({ basis, mein, gespeichert, gesperrt: komplexGesperrt(pid), normal: komplexNormal });
    komplexBasisJe.current.set(pid, r.basis);
    if (!gemountetRef.current || projektIdRef.current !== pid) return r;
    if (r.basis.id) complexRecordId.current = r.basis.id;
    if (Object.keys(r.setzen).length) {
      complexDataRef.current = { ...complexDataRef.current, ...r.setzen };
      setComplexData((prev) => { komplexStillRef.current = "leeren"; return { ...prev, ...r.setzen }; });
    }
    for (const k of r.konflikte) komplexKonfliktMelden(pid, k);
    return r;
  };

  /**
   * 115-05a (A-4): THE write path of the design record (autosave, "Entwurf speichern", flush, "keep mine") — queued behind every
   * other write of it (speichertGerade), so two writes never overlap and never create two records.
   * @param {KomplexPlan} plan
   * @returns {Promise<boolean>} true = written (or nothing to write); false = refused (a toast said why)
   */
  const komplexSchreiben = (plan) => {
    const lauf = speichertGerade.current.then(() => komplexSchreibenJetzt(plan));
    speichertGerade.current = lauf.then(() => undefined, () => undefined);
    return lauf;
  };
  const komplexSchreibenRef = useRef(komplexSchreiben);
  komplexSchreibenRef.current = komplexSchreiben;

  /**
   * One strict write of the design record. Without a stored record: create (the answer becomes the base). Else a PUT of the patch
   * on `?stand` (the body carries no updated_date: no false "changed meanwhile" hint). On 409: merge three ways against the stored
   * record (komplexAbgleich.js) — what only the other writer changed comes into the state (K6b), each conflict gets a card and its
   * fields are held back (K6a), the own changes are written again on the new stand; at most three attempts, then a toast.
   * The base it builds on is the newest one of its project and record (an own write queued before it moved the stand; a plan made
   * before the record existed takes the record an own write queued before it created), else the frozen one of the plan.
   * @param {KomplexPlan} start
   * @returns {Promise<boolean>}
   */
  const komplexSchreibenJetzt = async (start) => {
    let plan = start;
    for (let versuch = 1; versuch <= 3; versuch += 1) {
      const b = komplexBasisJe.current.get(plan.pid);
      // review 115-05a (R-11505a-01): plan.id null and a record created meanwhile → update it (before: a second create)
      const basis = b && (b.id === plan.id || (plan.id == null && b.id)) ? b : { id: plan.id, updated_date: plan.stand, felder: plan.basisFelder };
      const offen = komplexGesperrt(plan.pid);
      const patch = Object.fromEntries(Object.entries(plan.patch).filter(([k, v]) => !offen.has(k) && !gleichWert(v, basis.felder?.[k])));
      const aktuell = () => gemountetRef.current && projektIdRef.current === plan.pid;
      if (basis.id && !Object.keys(patch).length) { if (aktuell()) geladenAls.current = "gespeichert"; return true; }
      try {
        /** @type {any} */
        let antwort;
        if (!basis.id) {
          // 115-05b (E-3): one record per project - another tab may have created it since this one loaded "none". Its record is
          // taken over like the stored record of a 409 (three ways below); the server refuses a second create the same way.
          const da = komplexDatensatzWaehlen(await bitApi.entities.BuildingComplex.filter({ project_id: plan.pid })).datensatz;
          if (da) throw Object.assign(new Error("BuildingComplex vorhanden"), { status: 409, data: { gespeichert: da } });
          antwort = await bitApi.entities.BuildingComplex.create({ ...(plan.voll || { ...basis.felder, ...patch }), project_id: plan.pid });
        }
        else antwort = await bitApi.entities.BuildingComplex.update(basis.id, patch, { stand: basis.updated_date ?? null });
        const neueId = antwort?.id ?? basis.id;
        const felder = basis.id ? { ...basis.felder, ...patch, ...komplexOhneVerwaltung(antwort) } : komplexNormal({ ...(plan.voll || {}), ...(antwort || {}) });
        komplexBasisJe.current.set(plan.pid, { id: neueId, updated_date: antwort?.updated_date ?? basis.updated_date ?? null, felder });
        if (aktuell()) { complexRecordId.current = neueId; geladenAls.current = "gespeichert"; }
        return true;
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (e?.status !== 409 || !e?.data?.gespeichert) throw err;
        // 115-05b part 2: the same merge as the furniture migration and the focus check (komplexStandNehmen)
        const r = komplexStandNehmen(plan.pid, e.data.gespeichert, basis, aktuell() ? undefined : { ...basis.felder, ...plan.patch });
        if (!aktuell() && r.konflikte.length) {
          // a flush of a project that is no longer open: nothing mixed, the person is told (D-115-50)
          toast.error(tf("Entwurf nicht gespeichert — er wird gerade an anderer Stelle geändert. Bitte neu laden."));
          return false;
        }
        plan = { ...plan, id: r.basis.id, stand: r.basis.updated_date, basisFelder: r.basis.felder, patch: r.schreiben };
      }
    }
    toast.error(tf("Entwurf nicht gespeichert — er wird gerade an anderer Stelle geändert. Bitte neu laden."));
    return false;
  };

  // 115-05a (A-4): the designer of this project for the cards' resolvers; on unmount the own version of each open card stays
  // (komplexMeinStand) and a pending save goes out (flush)
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return undefined;
    const halter = {
      pid,
      zustand: () => komplexNormal(complexDataRef.current),
      setzen: (/** @type {Record<string, any>} */ w) => {
        complexDataRef.current = { ...complexDataRef.current, ...w };
        setComplexData((prev) => { komplexStillRef.current = "leeren"; return { ...prev, ...w }; });
      },
      basis: () => komplexBasisJe.current.get(pid),
      schreiben: (/** @type {Record<string, any>} */ werte) => {
        const b = komplexBasisJe.current.get(pid);
        if (!b) return Promise.resolve(false);
        return komplexSchreibenRef.current({ pid, id: b.id, stand: b.updated_date, basisFelder: b.felder, patch: werte, voll: komplexNormal(complexDataRef.current) });
      },
    };
    komplexHalter.current = halter;
    return () => {
      for (const k of abgleichStand.stand().konflikte) {
        if (k.quelle === "komplex" && k.projektId === pid) komplexMeinStand.set(k.id, auswahl(halter.zustand(), einheitFelder(k.feld)));
      }
      if (komplexHalter.current === halter) komplexHalter.current = null;
    };
  }, [project?.id]);
  useEffect(() => () => {
    const pend = ausstehendKomplexRef.current;
    if (!pend) return;
    ausstehendKomplexRef.current = null;
    komplexSchreibenRef.current(pend).catch((error) => console.error("Entwurf beim Verlassen nicht gespeichert:", error));
  }, []);

  /**
   * 115-05c: the design record as a source of the draft - its site group (ENTWURF_KOMPLEX) against the stored base, reported to the
   * draft module (the other fields keep their autosave). Read through a ref, so the autosave effect and the save call the newest.
   */
  const komplexMeldenRef = useRef((/** @type {string} */ pid) => { void pid; return Promise.resolve(); });
  komplexMeldenRef.current = (pid) => {
    const basis = komplexBasisJe.current.get(pid);
    if (!basis || geladenAls.current == null || projektIdRef.current !== pid) return Promise.resolve();
    const werte = komplexNormal(complexDataRef.current);
    return entwurfModul().then((E) => E.melden(pid, "komplex", { stand: { id: basis.id, updated_date: basis.updated_date }, basis: basis.felder, werte, felder: ENTWURF_KOMPLEX }));
  };
  // 115-05c: the designer registers its save (the site group, K5: first) and its "Verwerfen" with the draft of its project
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return undefined;
    /** @type {Array<() => void>} */ let ab = [];
    let weg = false;
    void entwurfModul().then((E) => {
      if (weg) return;
      ab = [
        E.speichererSetzen(pid, "komplex", async () => {
          const basis = komplexBasisJe.current.get(pid);
          if (!basis) throw new Error(tf("Speichern fehlgeschlagen — bitte erneut versuchen"));
          const jetzt = komplexNormal(complexDataRef.current);
          const patch = Object.fromEntries(Object.entries(komplexPatch(basis.felder, jetzt, komplexGesperrt(pid))).filter(([k]) => ENTWURF_KOMPLEX.includes(k)));
          // derived values (site area, cost estimate) ride along with a real change only - alone they are no unsaved work
          if (!Object.keys(patch).some((k) => k !== "site_area" && k !== "cost_estimate")) return komplexGesperrt(pid).size ? "konflikt" : "leer";
          // a design record is created only with a name and a location (as before); the building model is saved anyway (K5)
          if (!basis.id && (!jetzt.name || !jetzt.location)) { toast.info(tf("Grundstück und Lage werden erst gespeichert, wenn Name und Standort gesetzt sind.")); return "teilweise"; }
          if (ausstehendKomplexRef.current?.pid === pid) ausstehendKomplexRef.current = null;
          const ok = await komplexSchreiben({ pid, id: basis.id, stand: basis.updated_date, basisFelder: basis.felder, patch, voll: jetzt });
          await komplexMeldenRef.current(pid);
          return !ok ? "teilweise" : komplexGesperrt(pid).size ? "konflikt" : "ok";
        }),
        E.zuruecksetzerSetzen(pid, "komplex", () => {
          const basis = komplexBasisJe.current.get(pid);
          if (!basis || projektIdRef.current !== pid) return;
          const zurueck = Object.fromEntries(ENTWURF_KOMPLEX.map((k) => [k, basis.felder?.[k]]));
          complexDataRef.current = { ...complexDataRef.current, ...zurueck };
          setComplexData((prev) => { komplexStillRef.current = "leeren"; return { ...prev, ...zurueck }; });
        }),
      ];
    });
    return () => { weg = true; ab.forEach((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and stable setters are read at call time
  }, [project?.id]);

  // 75-06 Task 2 (D-P75-04): GeoJSON parcel import — pure parse in
  // @designer/lib/flurstueckImport, this handler owns the data-model write.
  // grundstueck.flurstuecke is ADDITIVE; site_parcel is only replaced when no
  // DRAWN parcel exists yet (a hand-drawn boundary wins over an import).
  // 101-03: the boundary is the true UNION of the parcels (own edge-cancellation
  // union, @core/lib/polygonVereinigung) and counts as drawn (assumed:false). When
  // the parcels do not form one simple area (gap, overlap, corner contact, hole)
  // site_parcel stays as it is — SiteDesigner shows the reason (no convex-hull guess).
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
        // The parcels were projected with the scale of the current plot (SiteDesigner passes
        // metersPerPixel(site_parcel)); keep exactly that scale so buildings and areas stay put.
        const mPerPx = Number(flurstuecke[0]?.m_per_px) > 0 ? Number(flurstuecke[0].m_per_px) : metersPerPixel(prev.site_parcel);
        const grenze = grundstueckAusFlurstuecken(flurstuecke, { mPerPx });
        if (grenze.ok) {
          const { geschaetzte_flaeche_m2: _g, ...alt } = prev.site_parcel || {};
          next.site_parcel = {
            ...alt,
            id: prev.site_parcel?.id || "site_parcel_main",
            type: "site_boundary",
            assumed: false,
            source: "flurstuecke",
            m_per_px: mPerPx,
            points: grenze.punkte,
          };
          next.site_area = grenze.flaeche_m2;
        }
      }
      return next;
    });
  };

  // 101-05 (user 18.10.2026): drawing tabs behave like an application window — from lg up the page is
  // exactly the window height and only the columns inside scroll, so the mouse wheel over a plan zooms
  // and never scrolls the page. Other tabs keep normal page scrolling.
  const arbeitsflaeche = ARBEITSFLAECHE_REITER.has(activeTab);
  const af = (klassen) => (arbeitsflaeche ? ` ${klassen}` : "");
  return (
    <div className={seitenWurzel + af("ws:h-full ws:flex ws:flex-col ws:overflow-hidden")} data-arbeitsflaeche={arbeitsflaeche ? "1" : undefined}>
      <div className={"max-w-7xl mx-auto space-y-2" + af("ws:w-full ws:flex-1 ws:min-h-0 ws:flex ws:flex-col")}>
        
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
        <SyncHinweis />
        {project?.id && (
          <React.Suspense fallback={null}>
            <StandWaechterHinweis projectId={project.id} komplex={{
              pid: project.id,
              basis: () => (geladenAls.current == null ? undefined : komplexBasisJe.current.get(project.id)),
              // review 115-05b part 2 (finding 1): the designer left or another project open → nothing taken, the base stays (as the
              // furniture migration with aktiv() false); a flush of this project then meets the 409 and its refusal note
              nehmen: (/** @type {any} */ g) => {
                if (!gemountetRef.current || projektIdRef.current !== project.id) return false;
                komplexStandNehmen(project.id, g);
                return true;
              },
              einreihen: (/** @type {() => Promise<any>} */ f) => { const l = speichertGerade.current.then(f); speichertGerade.current = l.then(() => undefined, () => undefined); return l; },
            }} />
          </React.Suspense>
        )}

        {/* 101-01 (user 18.10.2026, "Stufenpyramide"): one flat header row — title, the five areas,
            the tabs of the active area and the save state — instead of title block + card + two tab rows. */}
        <div className={af("ws:flex-1 ws:min-h-0 ws:flex ws:flex-col").trim() || undefined}>
          <div className={af("ws:flex-1 ws:min-h-0 ws:flex ws:flex-col").trim() || undefined}>
            <Tabs value={activeTab} onValueChange={setActiveTab} className={"w-full" + af("ws:flex-1 ws:min-h-0 ws:flex ws:flex-col")}>
              {/* 115-03: two fixed lines inside the one header — line 1: title, the five areas, save; line 2: the tabs of the
                  active area, the switch for hidden tabs and the direct views of the building model. Line 1 never changes and
                  line 2 keeps its height, so nothing below jumps when a tab is switched (D-115-41). */}
              <div className="border-b border-border pb-2 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* h1 = menu name exactly (navigation test); the project name stands next to it. */}
                <h1 className="text-base font-semibold text-foreground whitespace-nowrap">Komplex-Designer</h1>
                {project && <span className="-ml-2 text-base text-muted-foreground whitespace-nowrap">· {project.name}</span>}
                {/* Ebene 1: die fünf Arbeitsbereiche (72-02, Befund N-09). role=group, not tablist:
                    the buttons switch area via aria-current, they are no ARIA tabs (72-03). */}
                <div className="flex flex-wrap gap-1" role="group" aria-label="Arbeitsbereiche">
                  {DESIGNER_BEREICHE.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => { setBereich(b.id); const erste = reiterJeBereich[b.id]?.[0]; if (erste) setActiveTab(erste.key); }}
                      aria-current={bereich === b.id ? "true" : undefined}
                      className={
                        bereich === b.id
                          ? "px-2.5 py-1 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 bg-primary text-primary-foreground"
                          : "px-2.5 py-1 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 text-muted-foreground hover:bg-muted"
                      }
                    >
                      {b.titel}
                    </button>
                  ))}
                </div>
                {project?.id ? (
                  <React.Suspense fallback={null}>
                    <EntwurfLeiste projectId={project.id} />
                  </React.Suspense>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-h-9">
                {/* Ebene 2: die Reiter des aktiven Bereichs (115-03: je Projektart, der offene Reiter bleibt immer in der Zeile).
                    The active tab carries aria-selected (Radix) and the filled state; the line below names area › tab. */}
                <TabsList className="flex flex-wrap h-auto gap-0.5 bg-muted p-0.5">
                  {(reiterJeBereich[bereich] || []).map((r) => {
                    const Icon = r.icon;
                    return (
                      <TabsTrigger key={r.key} value={r.key} className="flex items-center gap-2">
                        <Icon className="w-4 h-4" /> {r.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <ReiterUmschalter
                  projektart={projektart}
                  anzahl={ausgeblendet.length}
                  namen={ausgeblendet.map((k) => reiterFuerTab(k)?.label).filter(Boolean)}
                  alle={alleReiter}
                  onAlle={(an) => { setAlleReiter(an); alleReiterMerken(an); }}
                />
                <DirektAnsichten onWahl={oeffneGebaeudemodell} />
              </div>
              </div>

              {/* 72-02: eine Zeile statt Textwand — braucht / liefert / Stand. */}
              {(() => {
                const reiter = reiterFuerTab(activeTab, bauart);
                const gemessen = reiter?.stand === "gemessen";
                // 73-04 (BEST-09): build-up based tabs name their basis in an existing building.
                const aufbau = AUFBAU_REITER.has(activeTab) ? aufbauGrundlage(bauart, project?.aufbau_herkunft).text : null;
                // 73-05: tabs that work on the outline say whether it is drawn or measured.
                const umriss = UMRISS_REITER.has(activeTab) ? footprintQuelleText(programmStand.footprintQuelle) : null;
                return (
                  <PanelHeader reiter={reiter} bereichTitel={DESIGNER_BEREICHE.find((b) => b.id === bereich)?.titel}
                    standOverride={gemessen && !bestandSnap ? "offen" : undefined}
                    herkunft={[gemessen ? (herkunftZeile(bestandSnap) || "Noch keine Bauaufnahme geladen — IFC-Viewer › Modell laden") : aufbau, umriss].filter(Boolean).join(" · ") || null} />
                );
              })()}

              <TabsContent value="bauaufnahme" className="px-0 py-2">
                <BauaufnahmePanel />
              </TabsContent>

              <TabsContent value="studio" className="px-0 py-2 ws:flex-1 ws:min-h-0 ws:overflow-y-auto">
                <MassingStudio
                  verlauf={komplexVerlauf}
                  lat={project?.location?.lat || complexData.location?.lat || 50.1}
                  projectName={project?.name || complexData.name}
                  parcel={complexData.site_parcel}
                  /* 75-06 Task 3 (MSB-3): the three site levels as props;
                     baufeld/grundstueck edits flow back into complexData. */
                  baufelder={complexData.designated_areas}
                  /* 108-08 (D-EFH-09): blocks of the site planning = fallback start position of the body */
                  buildings={complexData.buildings}
                  /* 108-12 (finding 15a): use of the project for the dwelling / parking figures, hand values saved with the design */
                  wohnungsmix={complexData.unit_types}
                  stellplatzPlanung={complexData.parking}
                  kennzahlenHand={complexData.kennzahlen_hand ?? null}
                  onKennzahlenHandChange={(werte) => updateComplexData("kennzahlen_hand", werte)}
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

              <TabsContent value="program" className="px-0 py-2">
                <ReiterLaden><SpaceProgram siteArea={siteAreaM2} /></ReiterLaden>
              </TabsContent>

              <TabsContent value="compliance" className="px-0 py-2">
                <ReiterLaden><UnitMixCompliance siteArea={siteAreaM2} parking={complexData.parking} /></ReiterLaden>
              </TabsContent>

              <TabsContent value="site" className="px-0 py-2 ws:flex-1 ws:min-h-0 ws:overflow-y-auto">
                <LocationSelector 
                  complexData={complexData}
                  projekt={project}
                  onLocationChange={handleLocationUpdate}
                  onNameChange={(name) => updateComplexData('name', name)}
                />
              </TabsContent>

              <TabsContent value="massing" className="px-0 py-2 ws:flex-1 ws:min-h-0 ws:overflow-y-auto">
                <SiteDesigner 
                  complexData={complexData}
                  projektTyp={project?.type ?? null}
                  onReestimateParcel={reestimateParcel}
                  onAreasChange={(areas) => updateComplexData('designated_areas', areas)}
                  onSiteAreaChange={(area) => updateComplexData('site_area', area)}
                  onBuildingsChange={(buildings) => updateComplexData('buildings', buildings)}
                  onFlurstueckImport={handleFlurstueckImport}
                  onParcelChange={(parcel) => updateComplexData('site_parcel', parcel)}
                  onRiegelChange={(riegel) => updateComplexData('riegel', riegel)}
                  verlauf={komplexVerlauf}
                />
              </TabsContent>

              <TabsContent value="terrain" className="px-0 py-2">
                <TerrainView3D complexData={complexData} />
              </TabsContent>

              <TabsContent value="bim" className="px-0 py-2 ws:flex-1 ws:min-h-0 ws:overflow-y-auto">
                <BitBimStudio complexData={complexData} startAnsicht={bimAnsicht} />
              </TabsContent>

              <TabsContent value="buildings" className="px-0 py-2">
                <BuildingConfig 
                  complexData={complexData}
                  onBuildingsChange={(buildings) => updateComplexData('buildings', buildings)}
                  onUnitsChange={(units) => updateComplexData('unit_types', units)}
                  onParkingChange={(parking) => updateComplexData('parking', parking)}
                />
              </TabsContent>

              <TabsContent value="statics" className="px-0 py-2">
                <ReiterLaden><StaticsPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="landscape" className="px-0 py-2">
                <ReiterLaden><LandscapePlanner complexData={complexData} /></ReiterLaden>
              </TabsContent>

              <TabsContent value="haustechnik" className="px-0 py-2">
                <ReiterLaden><HaustechnikPlanner complexData={complexData} /></ReiterLaden>
              </TabsContent>

              <TabsContent value="brandschutz" className="px-0 py-2">
                <ReiterLaden><BrandschutzPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="asr" className="px-0 py-2">
                <ReiterLaden><AsrRaumdatenblatt complexData={complexData} /></ReiterLaden>
              </TabsContent>

              <TabsContent value="barrierefreiheit" className="px-0 py-2">
                <ReiterLaden><BarrierefreiheitPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="acoustics" className="px-0 py-2">
                <ReiterLaden><SchallschutzPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="waermebruecken" className="px-0 py-2">
                <ReiterLaden><WaermebrueckenPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="bauphysik" className="px-0 py-2">
                <ReiterLaden><BauphysikStudio /></ReiterLaden>
              </TabsContent>

              <TabsContent value="raumklima" className="px-0 py-2">
                <ReiterLaden><RaumklimaPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="funding" className="px-0 py-2">
                <ReiterLaden><FoerderPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="apartments" className="px-0 py-2">
                <ReiterLaden><ApartmentPlanner /></ReiterLaden>
              </TabsContent>

              <TabsContent value="werkstatt" className="px-0 py-2">
                {/* 75-09 Task 6: furniture wiring — the focus writes ONLY through
                    the callback into complexData.moeblierung (same path as
                    InteriorDesigner below, never a store write). speicherbar
                    mirrors the create guard of the design record (needs name + location). */}
                <ReiterLaden><WohnungsWerkstatt
                  moeblierung={complexData.moeblierung}
                  moebelEigene={complexData.moebel_eigene}
                  onMoeblierungChange={(m) => updateComplexData('moeblierung', m)}
                  speicherbar={!!complexData.name && !!complexData.location}
                  standort={complexData.location || null}
                /></ReiterLaden>
              </TabsContent>

              <TabsContent value="interiors" className="px-0 py-2">
                <ReiterLaden><InteriorDesigner 
                  complexData={complexData}
                  onInteriorDesignsChange={(designs) => updateComplexData('interior_designs', designs)}
                  onMoeblierungChange={(moeblierung) => updateComplexData('moeblierung', moeblierung)}
                  onMoebelEigeneChange={(liste) => updateComplexData('moebel_eigene', liste)}
                /></ReiterLaden>
              </TabsContent>

              <TabsContent value="analysis" className="px-0 py-2">
                <ReiterLaden><ClimaAnalysis complexData={complexData} /></ReiterLaden>
              </TabsContent>
              
              <TabsContent value="generative" className="px-0 py-2">
                <ReiterLaden><GenerativeLayout complexData={complexData} siteArea={siteAreaM2} /></ReiterLaden>
              </TabsContent>

              <TabsContent value="energy" className="px-0 py-2">
                <ReiterLaden><EnergyPlanner 
                  complexData={complexData}
                  onEnergySystemsChange={(systems) => updateComplexData('energy_systems', systems)}
                /></ReiterLaden>
                <div className="mt-6"><ReiterLaden><NachhaltigkeitKarte complexData={complexData} /></ReiterLaden></div>
              </TabsContent>

              <TabsContent value="costs" className="px-0 py-2">
                <ReiterLaden><CostCalculator
                  complexData={complexData}
                  onCostUpdate={(costs) => updateComplexData('cost_estimate', costs)}
                /></ReiterLaden>
              </TabsContent>

              <TabsContent value="integrations" className="px-0 py-2">
                <ReiterLaden><IntegrationsPanel /></ReiterLaden>
              </TabsContent>
              
              <TabsContent value="planner" className="px-0 py-2">
                <ReiterLaden><ProjectPlanner 
                  selectedProject={complexData}
                /></ReiterLaden>
              </TabsContent>
              
              <TabsContent value="flood_risk" className="px-0 py-2">
                <ReiterLaden><FloodRiskAnalyzer
                  selectedProject={complexData}
                  onHochwasserChange={(hw) => updateComplexData('hochwasser', hw)}
                /></ReiterLaden>
              </TabsContent>
              
              <TabsContent value="support" className="px-0 py-2">
                <ReiterLaden><SupportPanel /></ReiterLaden>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
/**
 * 87-02: the BimModel sync could not load or save this project's geometry (useBimModelSync
 * sets `syncFehler`). Before, a failed load was silent and the 1,5 s write-back could push
 * the store's defaults over the real footprint; now the write-back stays locked and the
 * user sees why the plan shows defaults. Native element on purpose (tsc legacy count).
 */
function SyncHinweis() {
  // The store type is the initial state; syncFehler is an optional field (useBimModelSync).
  const { syncFehler } = /** @type {{syncFehler?: string|null}} */ (useBuildingProgram());
  if (!syncFehler) return null;
  const laden = syncFehler === "laden";
  return (
    <div data-testid="bm-sync-fehler" role="status" className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-4 py-2.5 text-sm">
      <strong>{laden ? "Geometrie konnte nicht geladen werden." : "Geometrie konnte nicht gespeichert werden."}</strong>{" "}
      {laden
        ? "Der Plan zeigt Werkzeug-Voreinstellungen; der gespeicherte Stand wird nicht überschrieben. Verbindung prüfen und die Seite neu laden."
        : "Drei Versuche sind fehlgeschlagen; die Änderung wird beim nächsten Bearbeiten erneut gesendet. Verbindung prüfen."}
    </div>
  );
}
