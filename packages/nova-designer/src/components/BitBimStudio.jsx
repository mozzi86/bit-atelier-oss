// 107-01 rule (spec VI.3): the stored model (a, b, thickness or build-up, refLine, openings …) is the BASE
// GEOMETRY; every mesh in this studio, the plan, the PDF plan and the IFC are derived from it again on each
// change (the 3D effects clear their group and rebuild); a computed mesh lies at most as a discardable intermediate
// store with a hash of the base inputs (csg_cache_layer, 107-14, D-BK-08a), never as the source. The wall offset against the reference line has
// ONE derivation: @core/lib/bauteil/referenz.js.
// 107-09 (D-BK-07/08/08a/08b/15): switch "Wände verschneiden" (element field `verschneidung`, written by this studio like envThickness;
// absent = off = today's behaviour). On: the cleaned layer bands (@core/lib/bauteil/verschneidung.js) and the CSG solids
// (solidAbleitung.js) are loaded LAZILY (own chunk; the csg chunk only when the first solid is computed); plan, section, 3D and quantities
// of walls with a build-up come from the solid when its volume comparison passed, else from the bands, while today's meshes stay the
// preview; the IFC gets the extruded bands. The mesh cache is useCsgCache (first caller of 107-14). Off: nothing of it is loaded.
// 107-12 (view state, D-BK-21): saved views ("Ausschnitte") live in the fachlayer ansicht_layer (this studio is the one writer) with
// the six parameters of @core/lib/plan/ansichtszustand.js — layers/combination, scale, structure display, lens, options, rules —
// and never with geometry (D-BK-08a). PDF and DXF are built from the SAVED view while the studio shows it (else from the state as
// before), wait for the solid derivation (time limit, fallback to the bands with a note on the sheet), and saving / deleting a
// view is one step of the drawing undo (bimHistorie).
import React, { useRef, useEffect, useState, useMemo, useCallback, useSyncExternalStore } from "react";
import * as THREE from "three";
import { Card, CardContent } from "@core/components/ui/card";
import {
  Boxes, WifiOff, Layers, Box, Grid2x2, Scissors,
  MousePointer2, RectangleHorizontal, Columns3, Square, Triangle,
  DoorOpen, AppWindow, Frame, Eye, EyeOff, Lock, LockOpen, Ruler, Type, PenLine, Trash2, Undo2, Redo2,
  Sparkles, Sun, Focus, Keyboard, Camera, Copy, Star, RotateCcw, SquareDashed,
} from "lucide-react";
import { FACADE_PRESETS, facadeMaterial, sunFromHour, createCityLife, updateCityLife } from "@designer/components/renderModeAssets";
import { bodenBelag, wandOberflaechen, rahmenBaustoffe, glasBaustoffe, bodenBelaege } from "@core/lib/bauteil/erscheinung.js";
import { materialFuerSchluessel } from "@designer/lib/erscheinungTextur.js";
import { huellMeshWeg } from "@designer/lib/huellErscheinung.js";
import { EN as ERSCHEINUNG_EN } from "@core/lib/i18nTeile/erscheinung-material.js";

// ---- Ebenen (Layers, ArchiCAD-Stil) — getrennt von Geschossen (Storeys) ----
/**
 * 110-05: pause after opening the studio / the last saved model change before the client's 3D file is rewritten, in ms
 * [ASSUMED: long enough for a scene rebuild with CSG solids, short enough that the client sees a change within seconds].
 */
const BAUHERR_NACHZIEHEN_MS = 4000;

const DEFAULT_LAYERS = [
  { id: "terrain", name: "Gelände", visible: true, locked: false },
  { id: "context", name: "Umgebung", visible: true, locked: false },
  { id: "shell", name: "Gebäudehülle", visible: true, locked: false },
  { id: "attika", name: "Attika", visible: true, locked: false },
  { id: "walls", name: "Wände", visible: true, locked: false },
  { id: "columns", name: "Stützen", visible: true, locked: false },
  { id: "zones", name: "Räume/Zonen", visible: true, locked: false },
  { id: "openings", name: "Fenster/Türen", visible: true, locked: false },
  { id: "dimensions", name: "Bemaßung", visible: true, locked: false },
  { id: "labels", name: "Beschriftung", visible: true, locked: false },
];

// Layer-Kombinationen: welche Ebenen je Kombination sichtbar sind.
const LAYER_COMBOS = {
  "Alle zeigen": ["terrain", "context", "shell", "attika", "walls", "columns", "zones", "openings", "dimensions", "labels"],
  "Architektur 1:100": ["shell", "attika", "walls", "columns", "zones", "openings", "dimensions", "labels"],
  "Lageplan": ["terrain", "context", "shell", "attika"],
  "Rohbau": ["shell", "attika", "walls", "columns"],
  "Plan-Ausgabe": ["shell", "attika", "walls", "columns", "zones", "openings", "dimensions", "labels"],
};

// ---- Tastaturkürzel (BIM-D): zentrale Map — Quelle für Handler UND Hilfe-Popover ----
const SHORTCUTS = [
  { keys: "V", desc: "Pfeil (Auswahl)" },
  { keys: "W", desc: "Werkzeug Wand" },
  { keys: "S", desc: "Werkzeug Stütze" },
  { keys: "D", desc: "Werkzeug Decke" },
  { keys: "F", desc: "Zoom auf Auswahl" },
  { keys: "Strg+D", desc: "Auswahl duplizieren (+1 m)" },
  { keys: "Strg+Z", desc: "Rückgängig" },
  { keys: "Strg+Y", desc: "Wiederholen" },
  { keys: "Pfeiltasten", desc: "Auswahl verschieben (0,1 m)" },
  { keys: "Shift+Pfeil", desc: "Auswahl verschieben (1 m)" },
  { keys: "Shift+Klick", desc: "Auswahl erweitern/reduzieren" },
  { keys: "Entf", desc: "Auswahl löschen" },
  { keys: "Esc", desc: "Auswahl aufheben · Pfeil-Werkzeug" },
];

/** 108-08 (finding 12): programme fields of the drawing-history snapshot that follow a change of another device (historieUmbasieren). */
const HISTORIE_PROGRAMM_FELDER = Object.freeze(["storeys", "untergeschosse", "geschosse", "storeyHeight", "footprintM", "footprintQuelle"]);
// Deutsche Werkzeugnamen (Favoriten-Labels, BIM-F)
const TOOL_NAMES = { wall: "Wand", column: "Stütze", window: "Fenster", door: "Tür", oeffnung: "Öffnung", zone: "Zone", slab: "Decke", roof: "Dach" };
import { useProject } from "@core/lib/ProjectContext";
import { bauartVon } from "@core/lib/bauart";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
englischErgaenzen(ERSCHEINUNG_EN);
import { zustandFelder } from "@designer/components/ZustandFelder";
import { steckbriefFelder } from "@designer/components/SteckbriefFelder";
import { aufbauEditorFelder, AUFBAUTEN_LEER } from "@designer/components/AufbauEditor";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { leereHistorie, vorAenderung, zieheStart, zieheEnde, schrittZurueck, schrittVor, historieUmbasieren } from "@designer/lib/bimHistorie";
import { setzeProjektAufbauten, gibProjektAufbautenFrei, overridesNachEntfernen } from "@core/lib/bauteil/aufbauten.js";
import { steckbrief, typFuerWand, guidsAnheften, bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { useCsgCache } from "@designer/lib/useCsgCache"; // 107-09: mesh cache of the CSG solids (cache modules load lazily)
import { attributeVon, attributPatch, mitAttributen, werkstattMitAttributen } from "@core/lib/bauteil/attribute.js";
import { statusFarbe } from "@core/lib/plan/statusDarstellung.js";
import { wandGeometrie, wandDicke_m, eckfueller } from "@core/lib/bauteil/referenz.js";
// 107-02: every storey elevation, wall/column height, slab thickness and roof slope comes from this one file (no own level × storeyHeight here)
import { elevationOf, unterkante, wandHoehe, stuetzenHoehe, geschosshoehe, deckenLage, oberkanteFolgtGeschoss, dachFirsthoehe_m, dachNeigung_grad, dachMigrieren, geschosseAus, MAX_NEIGUNG_GRAD, FLACHDACH_BIS_GRAD, DECKEN_STANDARD, kniestockAus, kniestockVerwaist, patchKniestock, MAX_KNIESTOCK_M } from "@core/lib/bauteil/hoehen.js";
import { vollgeschossAusDach } from "@core/lib/bauteil/vollgeschoss.js"; // 108-02: full-storey rule of the attic from the roof geometry
import { dachBerechnen, dachDreiecke, dachVonDachelement, globalesDach, schnittAchseQuerZumFirst, dachEbenen } from "@core/lib/bauteil/dachGeometrie.js"; // 107-10: one roof library for 3D, IFC and solid relations
import { treppeBerechnen, mitTreppenLoechern, treppeKoerper, treppenText, neueTreppe, deckeUeber, treppenLoch } from "@core/lib/bauteil/treppe.js"; // 108-06: stairs as elements, derived slab openings
import { gaubeBerechnen, gaubenDreiecke, neueGaube, GAUBE_STANDARD } from "@core/lib/bauteil/gauben.js"; // 108-13: dormers on the global roof
import { mitGiebelProfilen } from "@core/lib/bauteil/giebel.js"; // 108-03: hull walls of the top storey up to the roof contour
import { SOLIDRELATIONEN_LEER, relationenVon, relationAnlegen, relationAktivSetzen, aktiveRelationenFuer, relationWirkt, istSeoCacheSchluessel } from "@core/lib/bauteil/seoRelationen.js"; // 107-10: stored solid relations (pure; seo.js loads lazily)
import { csgWarnungText } from "@core/lib/bauteil/csgWarnung.js";
import { brilleVon, sichtbarUnter, zeigtStatus, STANDARD_BRILLE } from "@core/lib/plan/brillen.js";
import BrillenLeiste from "@designer/components/BrillenLeiste";
import FehlplanungHinweise from "@designer/components/FehlplanungHinweise";
import { planGrafik, vektorPlanPdf, schnittGrafik } from "@designer/lib/vektorPlan";
import { objektFreigeben } from "@core/lib/threeFreigeben";
// 106-01: one ray pick and one highlighter for every viewer (hover, click, later VR controllers).
import { identitaetAus, pickDrossel, zeigerPick, zeigerArt, TIPP_TOLERANZ_PX, strahlPick, weltNormale } from "@core/lib/zeigen/strahlPick.js";
import { zweiFingerGeste } from "@core/lib/zeigen/zweiFinger.js";
import { useZeigerArt, TABLETT_PLATZ } from "@core/lib/zeigen/useZeigerArt.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { useAuth } from "@core/lib/AuthContext";
import { protokollAnbinden } from "@core/lib/zeigen/aenderungsProtokollSpeicher.js";
import { ansichtAlsPng, xrZeigtGerade } from "@core/lib/zeigen/ansichtBild.js";
import { hervorhebung } from "@core/lib/zeigen/hervorheben.js";
import { ZEIGE_ZUSTAENDE, ZEIGE_CSS_RAND } from "@core/lib/zeigen/zustaende.js";
import { bauteilInfoAus, bauteilSchluessel, huellwandGuid } from "@designer/lib/bauteilInfo.js";
import { auswahlBefehleRegistrieren } from "@core/lib/zeigen/auswahlBefehle.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
// 107-07: plan clicks go through the shared snap core first (no second snap mechanism), and duplicate knows typed "*n" / "/n"
// through the shared array core of the massing modeller.
import { fangIndex, fangPunkt, segmenteAusRingen, QUELLE_URSPRUNG } from "@core/lib/objektfang.js";
import { useFangEinstellungen } from "@core/lib/fangEinstellungen.js";
import { reihenFaktoren, eingabeLesen } from "@core/lib/massing/massingModell.js";
// 106-03: change tools - proposal, check, preview in words and at the model, confirmation, origin, undo per step.
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import PlanVorschau from "@core/components/zeigen/PlanVorschau.jsx";
import KiVermerkHinweis from "@core/components/zeigen/KiVermerkHinweis.jsx";
import KiVermerkPlan from "@core/components/zeigen/KiVermerkPlan.jsx";
import { aktuellenModellStandLaden, modellstandAusPdf } from "@core/lib/zeigen/planStandLaden.js";
import { dokumentAblegen } from "@core/lib/ablage";
import { planWahlText, passenderPlan, planPdfDateiname, pdfDataUrl } from "../lib/planAblage.js";
import { KENNUNG_FELDER, kiMarkierungen, modellStandUnbekannt, ungespeicherteFelder, vermerkNoetig } from "@core/lib/zeigen/planStand.js";
// 107-12: view state (saved views, structure display, options, rules) and the export derivation with time limit
import {
  ANSICHT_LEER, ANSICHT_MASSSTAEBE, EIGENE_KOMBINATION, MAX_AUSSCHNITTE, STANDARD_REGELN, RUECKFALL_VERMERK, ableitungFuerAusgabe, ausschnitteWiederherstellen,
  ebenenSichtbarkeit, optionenOhneStandard, strukturAufMeshAnwenden, ansichtLayerNormalisieren, ausschnittGleich, ausschnittNormalisieren,
  ebenenAnwenden, naechsteAusschnittId, optionenFuer, tragendVon, wandFunktionen,
} from "@core/lib/plan/ansichtszustand.js";
import { detailgradFuer } from "@core/lib/plan/massstab.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { bauteilImModell, naechsteFreieIdx, transformZentrum } from "@core/lib/zeigen/aenderungen.js";
import { geisterMatrix, geisterKlon, schnittMarke, geisterEntsorgen } from "@core/lib/zeigen/geisterVorschau.js";
import { umrissLinie } from "@core/lib/zeigen/hervorheben.js";
import { AenderungsFeld } from "@core/components/zeigen/AenderungsVorschau.jsx";
/** 106-09: notes and conflicts of the sync between devices - loaded only when there is something to show. */
const AbgleichHinweise = React.lazy(() => import("@core/components/abgleich/AbgleichHinweise.jsx"));
// 107-12: the view-parameter block of the navigator, lazy so the studio chunk does not grow
const AnsichtOptionen = React.lazy(() => import("@designer/components/AnsichtOptionen.jsx"));
// 106-05: speech and typed sentences at the model (grammar first, model fallback, confirmation only by the person).
import SprechFeld from "@core/components/zeigen/SprechFeld.jsx";
// 106-08: "In VR ansehen" (only with a WebXR device; the session code loads on demand)
import XrKnopf from "@core/components/zeigen/XrKnopf.jsx";
import { eingabeBefehlRegistrieren } from "@core/lib/zeigen/eingabe.js";
import { bibliothekLaden } from "@core/lib/zeigen/befehlsBibliothekLaden.js";
import { personName } from "@core/lib/zeigen/aenderungsProtokoll.js";
import { ANSICHT_GRUNDRISS, ansichtAusKamera } from "@core/lib/zeigen/ansichtRichtung.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import { bimBauteil, bimPerGuid, bimModellUebersicht, bimAuswahlKontext } from "@designer/lib/auswahlBim.js";
// 104-06: floor plan as DXF R12 (own writer, no dependency).
import { grundrissDxfDaten, dxfDatei, dxfDateiname, DXF_MIME } from "@designer/lib/dxfPlaene";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { fehlplanungPruefen } from "@core/lib/bauteil/pruefregeln.js";
// 107-04: sizes, host and height anchor of an opening come from this one file (3D hole, plan symbol, room module and IFC read the same numbers);
// the click in the plan and the click on a wall face in 3D create the record through the same function (neueOeffnung).
import { oeffnungsMasse, oeffnungMitte_m, oeffnungPasst, lochImWand, ankerFuerWand, wirtVon, neueOeffnung, wandPunkt, rechteckAufWand, deckenLochRechteck, durchbruchImWirt, durchbruchTiefe, lochInDecke, lochUeberlappt, istOeffnungOhneFuellung, BRUESTUNG_BEZUEGE, DURCHBRUCH_TIEFE_OHNE_WIRT_M } from "@core/lib/bauteil/oeffnungen.js";
import { bitApi } from "@core/api/bitApi";
import { useElevationGrid } from "@designer/lib/useElevationGrid";
import { useOsmBuildings } from "@designer/lib/useOsmBuildings";
import { useOsmEnvironment } from "@designer/lib/useOsmEnvironment";
import { ebenenListe, ebeneKlemmen, ebenenGrenzen, ebeneName, untergeschosseAnzahl, huellwandDaten, MAX_UNTERGESCHOSSE } from "@core/lib/bauteil/ebenen.js"; // 107-13: storey levels incl. basements
// 107-11: the ONE room detection (click and proposal per storey), measuring rule, net area, DIN 277 group; English texts of this plan
import { raumBeiKlick, raeumeAusWaenden, zoneAusVorschlag, vorschlagVorhanden, meldungText, nettoFlaeche_m2, messregelVon, din277Gruppe, din277Flaechen, DIN277_ZU_NUTZUNG } from "@core/lib/bauteil/raeume.js";
import { EN as EN_RAEUME_10711 } from "@core/lib/i18nTeile/raeume-107-11.js";
import { EN as EN_ANSICHT_10712 } from "@core/lib/i18nTeile/ansicht-107-12.js"; // 107-12: lazy part like 107-11 (entry chunk budget)
import { EN as EN_EFH_108 } from "@core/lib/i18nTeile/efh-108.js"; // 108-01: lazy part of phase 108 (entry chunk budget)
import { createBuildingModel, footprintToMeters, flaecheImModellrahmen, modelBBox, aufbautenListe, compositeById, WINDOW_TYPES, windowTypeById, DOOR_TYPES, doorTypeById, openingTypeById, DEFAULT_FOOTPRINT } from "@core/lib/buildingModel";
import { Link } from "react-router-dom";
import { Sketch } from "@sketch/lib/sketchModel.js";
import { runSolve } from "@sketch/lib/solveCore.js";
import SketchGeometry from "@sketch/components/SketchGeometry.jsx";
import SketchEditOverlay from "./SketchEditOverlay.jsx";
import { autoEnvOpenings, entranceOpening, ENTRANCE_DEFAULT, ENTRANCE_START, eingangWirksam, eigeneEgTuer } from "@designer/lib/autoOpenings"; // 108-01: entrance in effect (D-EFH-04)
import { loadBimModel, saveBimModel, aufFremdenStand, aufBimModelAenderung, feldSperren, feldFreigeben, feldGesperrt, storeGehoertZu } from "@core/lib/useBimModelSync";
// 106-09: changes of other devices (three-way per element, conflicts with both versions, note with origin)
import { abgleichStand, abgleichZeigen } from "@core/lib/abgleich/abgleichStand";
import { ELEMENT_FELDER, STUDIO_WERTE, fremdeElementeAbgleichen, konfliktZeilen, konfliktAufloesen, aenderungsZeilen, vorschlaegeNeuPruefen, neueKollisionenUmnummern } from "@core/lib/abgleich/modellAbgleich";
import { gleichWert } from "@core/lib/abgleich/dreiWege";
import BimPlan2D from "@designer/components/BimPlan2D";
import { usePlanHoehe } from "@designer/lib/usePlanHoehe";
import { exportExposePng } from "@designer/components/MassingView3D";
import { exportIFC, WARNART_GESCHOSS, WARNART_DURCHBRUCH, WARNART_MASSING, WARNART_VERSCHNEIDUNG, WARNART_DACH, WARNART_SEO } from "@designer/lib/ifcExport";
import { useBuildingProgram, buildingProgram, fmtLen } from "@core/lib/useBuildingProgram";
import { werkstattBauteile } from "@core/lib/werkstattBauteile";
import { istGeneriert } from "@designer/lib/apartments";
import { istWerkstattZone } from "@designer/lib/tesselierung";

// 107-11: English texts of the room plan, merged once when this chunk loads (not on the start path)
englischErgaenzen(EN_RAEUME_10711);
englischErgaenzen(EN_ANSICHT_10712);
englischErgaenzen(EN_EFH_108);

// 107-01: effective wall thickness, reference-line offset and corner fillers come from @core
// (bauteil/referenz.js: wandDicke_m, wandGeometrie, eckfueller) — one derivation for 3D, plan, PDF and IFC.

// 107-11 (D-BK-13): the room detection of the zone tool (detectRoom, raySegT, polyAreaXZ) moved unchanged to
// @core/lib/bauteil/raeume.js (raumErkennen / raumBeiKlick) and gained the proposal of all rooms of a storey (raeumeAusWaenden).

// Projiziert Punkt p auf Segment a-b. Liefert {t (0..1), dist, len}.
function projectPointToSeg(p, a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + dx * len * t, pz = a.z + dz * len * t;
  return { t, len, dist: Math.hypot(p.x - px, p.z - pz) };
}

// Verglasung/Türblatt + Sprossen für einen Öffnungstyp, lokal in der Wandebene.
// Wand-Local-Frame: X=Länge, Y=Höhe, Z=Dicke. kind: "window" | "door".
function buildGlazing(type, u, glassMat, frameMat, kind, leafMat) {
  const g = new THREE.Group();
  const { w, h, sill, cols, rows } = type;
  const x0 = u - w / 2, y0 = sill;
  // Füllung: Türblatt (massiv) bei Türen ohne Glas, sonst Glas
  const fill = (kind === "door" && !type.glass) ? leafMat : glassMat;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fill);
  panel.position.set(u, sill + h / 2, 0);
  g.add(panel);
  const bar = 0.05; // Sprossenbreite
  // Rahmen + vertikale Sprossen
  for (let c = 0; c <= cols; c++) {
    const x = x0 + (w / cols) * c;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bar, h, 0.12), frameMat);
    m.position.set(x, sill + h / 2, 0); g.add(m);
  }
  // horizontale Sprossen
  for (let r = 0; r <= rows; r++) {
    const y = y0 + (h / rows) * r;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + bar, bar, 0.12), frameMat);
    m.position.set(u, y, 0); g.add(m);
  }
  return g;
}

// Setzt die Sichtbarkeit aller getaggten Meshes anhand der Ebenen-Liste.
function applyLayerVisibility(t, layers) {
  if (!t) return;
  const vis = Object.fromEntries((layers || []).map((l) => [l.id, l.visible]));
  [t.terrainGroup, t.buildingGroup, t.contextGroup, t.customGroup].forEach((g) => {
    g?.children.forEach((m) => {
      const id = m.userData?.layer;
      if (id && id in vis) m.visible = vis[id];
    });
  });
}

// Sichtbare Markierungs-Aura für die 3D-Auswahl: emissive Färbung nur dort, wo ein
// Mesh ein eigenes Material hat, plus pulsierende Kontur (EdgesGeometry) für ALLE
// Treffer — auch Hüllwand/Geschossdecke/Verglasung, die sich ein Material teilen
// und deshalb nicht gefärbt werden dürfen. Mehrfachauswahl (Marquee) wird mitgeführt.
// 106-01: the selection is drawn in the 'auswahl' look of the state table (blue, solid outline), so
// it differs from the hover state 'fokus' (teal, dotted outline) in hue AND form. (Before: both teal.)
// The 2D plan (BimPlan2D) still draws its selection teal [open: unify with the 3D view].
const AURA_COLOR = parseInt(ZEIGE_ZUSTAENDE.auswahl.hex.slice(1), 16);
// Emissive fill of a selected mesh: the selection blue at 72 % [ASSUMED]: strong enough to read, weak enough to keep shading.
const AUSWAHL_EMISSIV = new THREE.Color(ZEIGE_ZUSTAENDE.auswahl.hex).multiplyScalar(0.72).getHex();

/** Pointer travel (px) below which hover does not pick again [ASSUMED]: sub-pixel jitter picks the same element. */
const HOVER_MIN_PX = 2;
/** Pause (ms) after the last wheel tick before hover looks again [ASSUMED]. */
const WHEEL_PAUSE_MS = 180;

// Kinds mit eigenem Material je Mesh — nur dort ist emissive gefahrlos.
const EMISSIVE_KINDS = new Set(["wall", "column", "zone", "cslab", "croof", "stair", "gaube"]);

/** Layer a selection type lives on (a locked layer refuses the selection, by mouse and by command). */
const EBENE_VON_TYP = { wall: "walls", zone: "zones", slab: "shell", roof: "attika", hullwall: "shell", autowin: "openings", opening: "openings", column: "columns" };

// Trifft die Auswahl (Objekt aus setSelected bzw. ein multiSel-Eintrag) dieses Mesh?
function auraMatches(m, sel) {
  if (!sel) return false;
  const u = m.userData || {};
  switch (sel.type) {
    case "wall": return u.kind === "wall" && u.id === sel.index;
    case "column": return u.kind === "column" && u.id === sel.index;
    case "opening": return (u.kind === "window" || u.kind === "door") && u.scope !== "auto" && u.id === sel.index;
    case "zone": return u.kind === "zone" && u.id === sel.index;
    case "slab": return u.kind === "cslab" && u.id === sel.index;
    case "roof": return u.kind === "croof" && u.id === sel.index;
    case "stair": return u.kind === "stair" && u.id === sel.index; // 108-06
    case "gaube": return u.kind === "gaube" && u.id === sel.index; // 108-13
    case "hullwall": return u.kind === "wallShell" && (u.level ?? 0) === sel.level && (u.edge ?? 0) === sel.edge;
    case "autowin": return u.kind === sel.kind && u.scope === "auto" && (u.level ?? 0) === sel.level && (u.edge ?? 0) === sel.edge;
    default: return false;
  }
}

function applyPickHighlight(t, selected, multi) {
  if (!t?.customGroup) return;
  // 106-01: the hover tint lives on private material clones; give the originals back first,
  // otherwise the emissive written below would land on the clone and vanish with the hover.
  t.hoverLoeschen?.();
  // Alte Konturen restlos entfernen (Gruppen-Rebuilds leeren sie ohnehin mit).
  (t.auraList || []).forEach((line) => {
    line.parent?.remove(line);
    line.geometry?.dispose();
    line.material?.dispose();
  });
  t.auraList = [];
  const sels = multi && multi.length ? multi : selected ? [selected] : [];
  [t.customGroup, t.buildingGroup].forEach((g) => {
    g?.traverse((m) => {
      if (!m.isMesh) return;
      const isSel = sels.some((s) => auraMatches(m, s));
      if (m.material?.emissive && EMISSIVE_KINDS.has(m.userData?.kind)) {
        m.material.emissive.setHex(isSel ? AUSWAHL_EMISSIV : 0x000000);
      }
      if (isSel) {
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(m.geometry),
          new THREE.LineBasicMaterial({ color: AURA_COLOR, transparent: true, opacity: 1, depthTest: false }),
        );
        line.renderOrder = 999;
        line.userData.zeigeHilfe = true; // 106-01: helper geometry, never a pick target
        line.userData.zeigeZustand = "auswahl";
        m.add(line); // erbt Position/Rotation des Meshes
        t.auraList.push(line);
      }
    });
  });
}

/**
 * 107-10: mesh of a pitched roof from the roof library (@core/lib/bauteil/dachGeometrie.js) — the faces the IFC export and the
 * solid relations read as well (until 107-10 three builders here drew the gable, hip and shed over the bounding box; the library
 * reproduces their faces, test seo-10710).
 * @param {import("@core/lib/bauteil/dachGeometrie.js").DachErgebnis} dach result of dachBerechnen (m)
 * @param {THREE.Material} material
 * @returns {THREE.Mesh}
 */
function dachMesh(dach, material, giebelMaterial = null, ohneGiebel = false) {
  // 108-03 (user 08.11.2026: "die Giebelseiten sind nicht rot, sie sind Hauswand"): the vertical gable triangles are wall, not roof —
  // with `giebelMaterial` they become their own mesh in the facade material; `ohneGiebel` leaves them out entirely (the hull walls carry
  // the gable as a profile wall, mitGiebelProfilen); without either the old single mesh (drawn roofs, massing)
  const teile = giebelMaterial || ohneGiebel ? dach.flaechen.filter((f) => f.art !== "giebel") : dach.flaechen;
  if (ohneGiebel) giebelMaterial = null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(dachDreiecke(teile), 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (!giebelMaterial) return mesh;
  const giebel = dach.flaechen.filter((f) => f.art === "giebel");
  if (!giebel.length) return mesh;
  const grp = new THREE.Group();
  grp.add(mesh);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.Float32BufferAttribute(dachDreiecke(giebel), 3));
  gg.computeVertexNormals();
  const gm = new THREE.Mesh(gg, giebelMaterial); gm.castShadow = true; gm.receiveShadow = true;
  gm.userData.teil = "giebel";
  grp.add(gm);
  return grp;
}

// Footprint-Polygon [{x,z}] zu extrudiertem Mesh (Höhe in m).
function extrudeFootprint(points, height, material) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // in XZ-Ebene legen, Höhe nach +Y
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/**
 * 107-03 (user decision 25.10.2026, naming of the reference line): the choices of a reference-line select, labelled by where the
 * LINE lies. The stored values stay (center / outside / inside / coreOutside / coreInside / coreCenter, old projects unchanged).
 * Drawn wall: "outside" = the body lies on the outer side of the line, so the line is on the INNER face of the whole layer stack;
 * "inside" = the other way round (107-01 summary, finding 1). Hull (`huelle_bezug`): "outside" = the footprint line is the
 * OUTER face of the hull wall, "inside" = the INNER face. The core values name the face of the core layer (the layer with the function
 * "kern", e.g. the concrete wall behind the insulation). The label texts go through `tz` (German source = key, EN in bauteilkern-107.js).
 * @param {(s: string) => string} tz translate function of the studio
 * @param {boolean} [huelle] true for the hull select (no core values; "outside"/"inside" mean the hull wall against the footprint line)
 * @returns {Array<[string, string, string]>} [stored value, label, tooltip]
 */
function bezugWahl(tz, huelle = false) {
  const linieInnen = [tz("Linie innen · Körper außen"), tz("Referenzlinie auf der Innenfläche des Schichtaufbaus, die Wand liegt auf der Außenseite der Linie")];
  const linieAussen = [tz("Linie außen · Körper innen"), tz("Referenzlinie auf der Außenfläche des Schichtaufbaus, die Wand liegt auf der Innenseite der Linie")];
  /** @type {Array<[string, string, string]>} */
  const wahl = [
    ["center", tz("Linie Mitte"), tz("Referenzlinie in der Mitte der Wand")],
    /** @type {[string, string, string]} */ (["outside", ...(huelle ? linieAussen : linieInnen)]),
    /** @type {[string, string, string]} */ (["inside", ...(huelle ? linieInnen : linieAussen)]),
  ];
  if (!huelle) wahl.push(
    ["coreOutside", tz("Kern außen"), tz("Referenzlinie auf der Außenfläche der Kernschicht")],
    ["coreInside", tz("Kern innen"), tz("Referenzlinie auf der Innenfläche der Kernschicht")],
    ["coreCenter", tz("Kern Mitte"), tz("Referenzlinie in der Mitte der Kernschicht")],
  );
  return wahl;
}

// Wand als Profil (Länge × Höhe) mit echten Öffnungen -> ExtrudeGeometry.
// Das ist die boolesche Subtraktion: die Löcher (openings:[{u,sill,width,height}])
// werden aus der Wand ausgeschnitten. thicknessOverride für Composite-Gesamtdicke.
function buildWallMeshWithHoles(w, material, openings, thicknessOverride, normalOffset) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
  const th = thicknessOverride || w.thickness || 0.3, H = w.height;
  // 107-01: normal and body offset from the one derivation (normalOffset = offset of one build-up layer)
  const g = wandGeometrie(w, { dicke_m: th });
  const nx = g.normale.x, nz = g.normale.z;
  const off = normalOffset != null ? normalOffset : g.versatz_m;
  const shape = new THREE.Shape();
  // 108-03: a hull wall under the roof (w.profil, bauteil/giebel.js) is its profile polygon in the wall plane; else the rectangle
  const prof = w.profil && Array.isArray(w.profil.punkte) && w.profil.punkte.length >= 3 ? w.profil : null;
  const Hp = prof ? prof.hoehe_max_m : H;
  if (prof) { prof.punkte.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y))); shape.closePath(); }
  else { shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, H); shape.lineTo(0, H); shape.closePath(); }
  // 107-04: the hole of an opening has ONE rule (lochImWand: position kept in the wall like the IFC export, edge clearance at the sides and
  // 2 cm at bottom and top). An opening that does not fit is reported by the studio (oeffnungsProblemText), no longer clamped in silence.
  (openings || []).forEach(({ u, sill, width, height, rund }) => {
    const loch = lochImWand({ w: width, h: height, sill }, u, len, Hp, prof ? { profil: prof } : undefined);
    if (!loch) return;
    const p = new THREE.Path();
    // a round penetration (core drilling) is a circle in the wall plane, everything else a rectangle
    if (rund) p.absarc((loch.x0 + loch.x1) / 2, (loch.y0 + loch.y1) / 2, Math.min(loch.x1 - loch.x0, loch.y1 - loch.y0) / 2, 0, Math.PI * 2, false);
    else { p.moveTo(loch.x0, loch.y0); p.lineTo(loch.x1, loch.y0); p.lineTo(loch.x1, loch.y1); p.lineTo(loch.x0, loch.y1); p.closePath(); }
    shape.holes.push(p);
  });
  const geo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
  geo.translate(0, 0, -th / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  m.position.set(w.a.x + nx * off, w.elevation, w.a.z + nz * off);
  m.rotation.y = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
  return m;
}

/**
 * 107-04: a wall as its build-up layers — one body per layer, the holes of the openings cut through ALL layers (spec I.4 Cut-Opening-Bridge).
 * One function for the drawn wall and, new, the hull wall (before, the hull was ONE body coloured by layer 1 only). The layers run from layer 1
 * along −n starting at the +n side of the body, the same convention as the plan (BimPlan2D wallSkinBands). [ASSUMED] "+n side = layer 1 = outer
 * face": true for a drawn wall by convention, but for the hull of the standard footprint n points INTO the building (buildingModel.js), so layer 1
 * lies on the inside there — plan and 3D agree, the order for the hull is open (107-04 review, noted in the SUMMARY, not changed here).
 * @param {any} w wall: a, b, height (m), elevation (m, lower edge), thickness/composite/refLine or the stored fields of a drawn wall
 * @param {{skins: Array<{thickness: number, color: string}>}} comp build-up (thickness in mm)
 * @param {Array<{u: number, sill: number, width: number, height: number}>} ops holes in m
 * @param {THREE.Material|null} [aussen] assigned surface for layer 0; other layers keep the build-up colour
 * @returns {THREE.Mesh[]} one mesh per layer (userData is set by the caller)
 */
function buildSchichtWand(w, comp, ops, aussen = null) {
  const g = wandGeometrie(w);
  let cur = g.versatz_m + g.dicke_m / 2;
  return comp.skins.map((sk, i) => {
    const tk = sk.thickness / 1000; const mid = cur - tk / 2; cur -= tk;
    const mat = (i === 0 && aussen) || new THREE.MeshStandardMaterial({ color: new THREE.Color(sk.color), roughness: 0.9 });
    const m = buildWallMeshWithHoles(w, mat, ops, Math.max(0.01, tk), mid);
    // review 107-12: layer index and own material, so the structure display can hide this layer without "Wände verschneiden"
    m.userData.schicht = i; m.userData.eigenesMaterial = true;
    return m;
  });
}

/**
 * 107-09: mesh of an intersected solid (solidAbleitung.js): a clone of its local geometry (the result object keeps the original for the
 * plan cut), one material per layer group in the colours of the build-up, placed by translation (the solids are computed around the middle
 * of their bands, no rotation).
 * @param {{geometrie: THREE.BufferGeometry, platzierung: {ursprung: {x: number, y: number, z: number}, drehung_y?: number}}} vs solid entry (107-10: rotation about +y)
 * @param {{skins: Array<{color: string}>}|null} comp build-up
 * @param {THREE.Material|null} [einMaterial] one material for all layer groups (render mode), null = colours of the build-up
 * @param {THREE.Material|null} [aussen] assigned surface for group 0 only; ignored when einMaterial is set
 * @returns {THREE.Mesh}
 */
function solidMesh(vs, comp, einMaterial = null, aussen = null) {
  // one material (render mode: the facade preset) draws every layer group with it; else one material per layer (skin colour).
  // An assigned surface replaces only group 0 (the outer band, same index as buildSchichtWand).
  const mats = einMaterial || (comp?.skins || [{ color: "#94a3b8" }]).map((sk, i) => (i === 0 && aussen) || new THREE.MeshStandardMaterial({ color: new THREE.Color(sk.color), roughness: 0.9 }));
  const m = new THREE.Mesh(vs.geometrie.clone(), mats);
  if (!einMaterial && comp) m.userData.mitSchichtMaterial = true; // 107-12: one material per layer group (structure display can hide groups)
  m.castShadow = true; m.receiveShadow = true;
  m.position.set(vs.platzierung.ursprung.x, vs.platzierung.ursprung.y, vs.platzierung.ursprung.z);
  m.rotation.y = vs.platzierung.drehung_y || 0; // 107-10: wall solids of seo.js carry the wall direction (107-09 solids: 0)
  m.userData.verschnitten = true;
  return m;
}

/**
 * 107-12: structure display in 3D (the same rule as plan and PDF, schichtSichtbar) — review 107-12: on the material groups of an
 * intersected wall solid AND on the layer boxes / plain walls built without "Wände verschneiden" (userData.schicht, own material);
 * shared materials (render mode, hull walls without build-up) stay whole. Logic in @core (strukturAufMeshAnwenden, unit-tested).
 * @param {THREE.Object3D} m mesh with userData.schichtFunktionen / userData.tragend
 * @param {string} sd structure display
 */
function strukturAufMesh(m, sd) {
  strukturAufMeshAnwenden(/** @type {any} */ (m), sd);
}

/**
 * 107-12 review: prepares a wall mesh for the structure display (layer functions of the wall, load-bearing) and applies the current one.
 * @param {THREE.Object3D} m wall mesh (solid, layer box or plain body)
 * @param {any} w wall record
 * @param {boolean} tragend the wall is load-bearing
 * @param {string} sd current structure display
 */
function strukturVorbereiten(m, w, tragend, sd) {
  const u = /** @type {any} */ (m).userData;
  if (!u.mitSchichtMaterial && !u.eigenesMaterial) return;
  u.schichtFunktionen = wandFunktionen(w); u.tragend = tragend;
  strukturAufMesh(m, sd);
}

// Öffnungstyp (für buildGlazing) aus einer Regel-Öffnung mit expliziten Maßen.
/** Copy of an opening record without its host GUID: a copy that moves to a duplicated wall must not keep the GUID of the ORIGINAL wall (107-04 review). */
const ohneWirtGuid = (/** @type {any} */ o) => { const { wirt_guid: _weg, ...rest } = o; return rest; };
/**
 * 107-08: what a duplicate never takes along — the stored GUID (every copy gets its own GlobalId from its new _idx; spec IV "*5 → new
 * GUIDs") and the takeover note quelle_koerper (a copy is not part of the takeover, "Übernahme zurücknehmen" must not remove it).
 * @param {any} o element record
 * @returns {any} a shallow copy without guid / quelle_koerper
 */
const alsKopie = (/** @type {any} */ o) => { const { guid: _g, quelle_koerper: _q, ...rest } = o; return rest; };

// ---- 106-09 review: conflicts of the studio outlive one mount of it ----
// Radix tabs unmount the studio on a tab switch inside the designer, while the sync module (and the conflict card) stays.
// The resolvers therefore act on the studio that is mounted NOW (studioHalter), never on the closures of an unmounted
// one. When the studio unmounts with open conflicts, its own version of each conflicting field is kept here
// (studioMeinStand, conflict id → value); the next mount shows that version again (the card says "here: ...") and a
// decision made while no studio is mounted writes it directly.
/** @type {{current: {projectId: string, lokalWert: (k: string) => any, anwenden: (w: Record<string, any>) => void}|null}} */
const studioHalter = { current: null };
/** @type {Map<string, any>} */
const studioMeinStand = new Map();
/** Sources of the conflict cards the studio shows in its view (the page-wide card shows the others). */
const STUDIO_QUELLEN = Object.freeze(["bim", "programm", "modell"]);
/** Fields the studio's autosave writes (a held-back one turns "saved" into "waiting for a decision"). */
const STUDIO_SPEICHER_FELDER = Object.freeze([...Object.keys(ELEMENT_FELDER), ...Object.keys(STUDIO_WERTE)]);
/** Layers the studio only shows (written elsewhere): they follow another device live, the field is not claimed. */
const STUDIO_LESE_LAYER = Object.freeze(["netz_layer", "statik_layer", "massing_layer", "sketch_layer"]);
/** 107-10 review: German names (i18n keys) of the roof forms of the roof library, for the IFC notes. */
const DACHFORM_NAME = Object.freeze(/** @type {Record<string, string>} */ ({ flach: "Flachdach", sattel: "Satteldach", walm: "Walmdach", pult: "Pultdach" }));

function autoOpeningType(o) {
  return o.kind === "door"
    ? { w: o.width, h: o.height, sill: 0, cols: 1, rows: 2, glass: false }
    : { w: o.width, h: o.height, sill: o.sill, cols: 2, rows: 2 };
}

/** 108-01: the old fixed height of plan, 3D view and side panels in px — the drawing area never gets smaller than this. */
const PLAN_MIN_HOEHE_PX = 520;

/**
 * 108-01 (9a): free height in px below the top of `el` inside its nearest scrolling ancestor (the work-area tab of the designer), else
 * inside the window; independent of the current scroll position. 8 px stay free at the bottom.
 * @param {HTMLElement} el
 * @returns {number} px (may be ≤ 0)
 */
function freieHoeheUnter(el) {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.clientHeight > 0) break;
    p = p.parentElement;
  }
  const oben = el.getBoundingClientRect().top;
  if (!p || p === document.body || p === document.documentElement) return Math.floor(window.innerHeight - (oben + window.scrollY) - 8);
  const r = p.getBoundingClientRect();
  return Math.floor(p.clientHeight - (oben - r.top + p.scrollTop) - 8);
}

/**
 * BIT-BIM-Studio (Welle B1): EIN 3D-Fenster, das Gelände + Entwurfsgebäude
 * gemeinsam und maßstäblich (1 Einheit = 1 m) aus einem gemeinsamen Modell zeigt.
 */
export default function BitBimStudio({ complexData }) {
  const { project } = useProject();
  const { t: tz } = useI18n(); // 73-07: inspector rows for condition / Erfassungsgrad
  const { grid, min, max, offline } = useElevationGrid(project?.location, 10, 0.2); // 200 m-Patch (≤100 Punkte = Open-Meteo-Limit)
  const osm = useOsmBuildings(project?.location, 350);
  const env = useOsmEnvironment(project?.location, 300);
  const [showContext, setShowContext] = useState(true);
  // ---- Render-Modus: anschauliche Echtzeit-Darstellung (Himmel, Sonne, Fassade, belebte Stadt) ----
  const [renderMode, setRenderMode] = useState(false);
  const [facadePreset, setFacadePreset] = useState("putz"); // Fassaden-Preset der Hüllwände
  const [sunHour, setSunHour] = useState(14); // Sonnenstand (Uhrzeit 0-24)
  const animRef = useRef([]); // bewegte Stadt-Objekte für den tick()-Loop: [{mesh,pts,cum,total,d,speed}]
  const mountRef = useRef(null);
  // 106-01 hover: refs only — no React render per frame, the overlay DOM is written directly.
  const hoverRef = useRef(/** @type {Record<string, any>|null} */ (null)); // identity under the pointer
  const hoverBoxRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const hoverTextRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const hoverZustandRef = useRef(/** @type {HTMLSpanElement|null} */ (null)); // overlay state line (words)
  const hoverSymbolRef = useRef(/** @type {HTMLSpanElement|null} */ (null)); // overlay swatch (colour AND outline form)
  // The 2D plan for the raster section export (was found by scraping divs for height 520 px).
  const planWrapRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  // Mutable three.js handle bag (scene, camera, groups, callbacks) — filled in the
  // mount effect, never a render dependency. Keys are open on purpose (87-09).
  const three = useRef(/** @type {Record<string, any>} */ ({}));
  const orbit = useRef(/** @type {Record<string, any>} */ ({ on: false, x: 0, y: 0, theta: 0.7, phi: 1.0, radius: 70 }));
  // 106-07: kind of the last pointer on the canvas and the two-finger steps seen (for the test hook)
  const zeigerArtRef = useRef(/** @type {"mouse"|"pen"|"touch"|null} */ (null));
  const gestenSummeRef = useRef({ schritte: 0, drehungRad: 0, faktor: 1 });
  // 106-07: tablet layout (finger or pen in use) and the right to change the model (rechte.js, module "modell")
  const { grob } = useZeigerArt();
  const zugriff = useZugriff();
  const darfAendern = zugriff.darf("modell", "voll");
  // 106-10: the name of the person who confirms a step goes into the change log (review workplace "Modellfreigabe")
  const { user } = useAuth();
  const autorRef = useRef(/** @type {string|null} */ (null));
  // review 106-10: the active office person (Nutzer & Rechte), not the local sign-in stand-in
  autorRef.current = personName(zugriff, user) || null;

  // Gemeinsame Quelle (Massing-Studio ↔ Gebäudemodell ↔ Kennzahlen): Footprint/Geschosse/Höhe/Einheit
  const bp = useBuildingProgram();
  const storeys = bp.storeys, setStoreysDirekt = (v) => bp.set({ storeys: v });
  // 107-13 (D-BK-20): basements on the levels −1 … −U (programme field `untergeschosse`, 0 … 3 [ASSUMED] in bauteil/ebenen.js); `storeys`
  // stays the count above ground. Every level choice below reads ebenenListe/ebeneKlemmen(model, …) instead of 0 … storeys − 1.
  const untergeschosse = untergeschosseAnzahl(bp.untergeschosse);
  const setUntergeschosseDirekt = (v) => bp.set({ untergeschosse: untergeschosseAnzahl(v) });
  const storeyHeight = bp.storeyHeight;
  // 107-02 (D-BK-05): optional storey table [{level, name, hoehe_m}] (programme field `geschosse`, null = one height for all storeys) and the
  // storey source `gs` that every elevation and wall height below is read through. The single height input sets ALL storeys.
  const geschosse = bp.geschosse || null;
  const gs = useMemo(() => geschosseAus({ geschosse, storeyHeight }), [geschosse, storeyHeight]);
  // 108-01 (9a): height of plan, 3D view and side panels = the free height below the studio header inside the scrolling work area of
  // the designer (measured, so the drawing ends at the visible edge), capped by usePlanHoehe (window height − 300 px) and never below
  // the old fixed 520 px — small windows (and the 1280 × 720 test default) keep today's size. Measuring instead of the window rule
  // alone: in the designer the chrome above and below the studio is about 550 px, the window rule would let the drawing (and points
  // clicked in it) run below the visible edge of the work area.
  const zeichenZeileRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const fensterHoehe = usePlanHoehe({ min: PLAN_MIN_HOEHE_PX });
  const [freieHoehe, setFreieHoehe] = useState(0);
  useEffect(() => {
    const zeile = zeichenZeileRef.current;
    if (!zeile) return undefined;
    const messen = () => setFreieHoehe(freieHoeheUnter(zeile));
    messen();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(messen);
    const kopf = zeile.previousElementSibling;
    if (ro && kopf) ro.observe(kopf); // the header wraps into more rows → the drawing starts lower
    window.addEventListener("resize", messen);
    return () => { ro?.disconnect(); window.removeEventListener("resize", messen); };
  }, []);
  const planHoehe = Math.max(PLAN_MIN_HOEHE_PX, Math.min(fensterHoehe, freieHoehe || PLAN_MIN_HOEHE_PX));
  useEffect(() => { three.current.groesseAnpassen?.(); }, [planHoehe]);
  // One writer for both studios (107-02 review fix): the number and the table rows can never disagree, and a storey that is not a table row yet
  // (the user raised the storey count after the table was made) gets a row instead of snapping back (see hoehen.js patchGeschosshoehe).
  const setStoreyHeightDirekt = (v) => bp.setAlleGeschosshoehen(v);
  /** Sets the height of ONE storey (m); the first call creates the table from storeys × storeyHeight. */
  const setGeschossHoeheDirekt = (level, v) => bp.setGeschosshoehe(level, v);
  const unit = bp.unit || "m", setUnit = (u) => bp.set({ unit: u });
  const [view, setView] = useState("3d"); // 3d | grundriss | schnitt
  // 97-03: lens per view (plan, section), remembered per viewer in the browser — a view setting,
  // never part of the model. Storage may be blocked (private window): then the input lens.
  const [brillen, setBrillen] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("bit.brillen") || "{}") || {}; } catch { return {}; }
  });
  const brilleId = brillen[view] || STANDARD_BRILLE;
  const swPlan = !!brillen.sw; // 97-04b: S/W variant of the permit lens (same storage entry)
  const setSwPlan = (v) => setBrillen((alt) => {
    const neu = { ...alt, sw: v };
    try { window.localStorage.setItem("bit.brillen", JSON.stringify(neu)); } catch { /* storage blocked: keep in memory */ }
    return neu;
  });
  const setBrille = (id) => setBrillen((alt) => {
    const neu = { ...alt, [view]: id };
    try { window.localStorage.setItem("bit.brillen", JSON.stringify(neu)); } catch { /* storage blocked: keep in memory */ }
    return neu;
  });
  const [planLevel, setPlanLevel] = useState(0);
  const [wallRef, setWallRef] = useState("center"); // Referenzlinie: center | outside | inside
  const [parapet, setParapet] = useState({ enabled: true, height: 1.0 }); // Attika
  const [dachform, setDachform] = useState("flach"); // flach | sattel | walm | pult
  const [dachneigung, setDachneigung] = useState(30); // Grad (für geneigte Dächer)
  // 108-01: chosen section axis "x" (A-A) / "z" (B-B); null = automatic (across the ridge with a pitched roof, else A-A). UI state only,
  // not saved [ASSUMED: a per-session choice; a saved view (107-12) could carry it later].
  const [schnittAchseWahl, setSchnittAchseWahl] = useState(/** @type {"x"|"z"|null} */ (null));
  // 107-10 review: the global roof form goes into the IFC (inclined IfcRoof plates) only when switched on — new optional studio field
  // `dachform_ifc`, written only once used (old projects export byte-identical, like `verschneidung`). Default off until the user decides.
  const [dachIfc, setDachIfc] = useState(false);
  const hatteDachIfcRef = useRef(false);
  const footprintEdit = bp.footprintM; // editierbarer Grundriss-Umriss (Meter) aus gemeinsamer Quelle
  const setFootprintEditDirekt = (fp) => bp.set({ footprintM: typeof fp === "function" ? fp(bp.footprintM) : fp });
  // Eingangstür: Vorgabe 1,20 x 2,10 m mittig auf der ersten EG-Kante, per UI
  // änderbar (Breite/Höhe/Lage/Kante) und mit dem Modell gespeichert (KD-19).
  // 108-01 (D-EFH-04): the start value has no `enabled` — "not set" is decided by eingangWirksam (off with an own ground-floor door)
  const [entranceCfg, setEntranceCfg] = useState(/** @type {{width: number, height: number, uRel: number, edge: number|null, enabled?: boolean}} */ (ENTRANCE_START));
  const [envComposite, setEnvComposite] = useState(null); // Hüllwand-Aufbau (Composite) oder null=einschichtig
  // Optional envelope surface from the appearance catalogue (baustoff key). Absent = today's preset / first skin.
  const [huelleErscheinung, setHuelleErscheinungRoh] = useState(/** @type {string|null} */ (null));
  const [envThickness, setEnvThickness] = useState(0.3); // Hüllwand-Dicke (einschichtig)
  // 107-02 review: thickness (m) and reference side of the HULL slabs (fields `huelle_decke_dicke_m` / `huelle_decke_bezug`; defaults 0.25 m "unten" = as before)
  const [huelleDeckeDicke, setHuelleDeckeDicke] = useState(/** @type {number} */ (DECKEN_STANDARD.huelle.dicke_m));
  const [huelleDeckeBezug, setHuelleDeckeBezug] = useState(/** @type {"oben"|"unten"} */ (DECKEN_STANDARD.huelle.bezug));
  const [huelleBezug, setHuelleBezug] = useState("center"); // 107-01 (D-BK-02): Referenzlinie der Hüllwände center | outside | inside, Feld `huelle_bezug`
  // 107-09 (D-BK-07): switch "Wände verschneiden", element field `verschneidung` (absent = off); written only when on or when the record had it
  const [verschneidung, setVerschneidung] = useState(false);
  const hatteVerschneidungRef = useRef(false);
  // ---- Navigator / Mappen (ArchiCAD-Stil) ----
  const [scale, setScale] = useState(100); // Maßstab-Nenner (1:scale)
  const [cutHeight, setCutHeight] = useState(1.1); // Schnitthöhe (Grundriss-Schnittebene)
  // 107-12: views ("Ausschnitte") are stored in the fachlayer ansicht_layer (below, `views`); the three new view parameters of the state:
  const [strukturdarstellung, setStrukturdarstellung] = useState("gesamt"); // gesamt | ohne-bekleidung | nur-kern | nur-kern-tragend
  const [ansichtOptionen, setAnsichtOptionen] = useState(/** @type {Partial<Record<string, boolean>>|null} */ (null)); // null = from the level of detail
  const [ansichtRegeln, setAnsichtRegeln] = useState(/** @type {any[]|null} */ (null)); // null = no graphic rules
  const strukturRef = useRef("gesamt");
  strukturRef.current = strukturdarstellung;
  const [aktiverAusschnittId, setAktiverAusschnittId] = useState(/** @type {string|null} */ (null));
  const [ausschnittName, setAusschnittName] = useState("");
  const [ausgabeLaeuft, setAusgabeLaeuft] = useState(false); // PDF/DXF export waits for the derivation: buttons locked
  // "PDF" at a saved view: applied first, exported once the studio shows exactly it; `runden` = renders waited (review 107-12: dropped
  // with a message when the view does not become active, never left pending)
  const [ausgabeWunsch, setAusgabeWunsch] = useState(/** @type {{id: string, art: "pdf"|"dxf", runden?: number}|null} */ (null));
  // review 107-12: ids of views saved or deleted by a local step of this session — only these follow an undo / redo snapshot
  const eigeneAusschnittIdsRef = useRef(/** @type {Set<string>} */ (new Set()));
  const [showMappe, setShowMappe] = useState(false);

  // ---- Editor-Zustand (ArchiCAD-Stil) ----
  const [tool, setTool] = useState("arrow"); // arrow | wall | column | window
  const [customWalls, setCustomWallsRoh] = useState([]); // [{a,b,level,thickness,height,_idx}]
  const [customColumns, setCustomColumnsRoh] = useState([]); // [{x,z,level,size,_idx}]
  const [customWindows, setCustomWindowsRoh] = useState([]); // Öffnungen: [{wallIdx,u,typeId,kind,_idx}]
  const [envOpenings, setEnvOpeningsRoh] = useState([]); // Hüllwand-Öffnungen: [{level,edge,u,typeId,kind,_idx}]
  const [customZones, setCustomZonesRoh] = useState([]); // Räume: [{points:[{x,z}],level,name,_idx}]
  const [netzLayer, setNetzLayer] = useState(null); // Phase 41: TGA-Netz (netz_layer) read-only für den IFC-Export
  const [statikLayer, setStatikLayer] = useState(null); // 97-02a: beams (statik_layer) read-only for the IFC export
  const [attributLayer, setAttributLayer] = useState(null); // 97-02: decisions on hull/workshop elements (bauteil_attribute_layer)
  const [massingLayer, setMassingLayer] = useState(null); // 98-05: bodies of the Massing Studio, read only for the IFC export
  const [durchbrueche, setDurchbrueche] = useState(/** @type {any[]} */ ([])); // 97-06: openings planning, read only for the checks
  const [customSlabs, setCustomSlabsRoh] = useState([]); // Decken: [{points,level,_idx}]
  const [customRoofs, setCustomRoofsRoh] = useState([]); // Dächer: [{points,level,pitch,_idx}]
  const [customStairs, setCustomStairsRoh] = useState(/** @type {any[]} */ ([])); // 108-06 Treppen: [{start,richtung_grad,breite_m,level,_idx}] (bauteil/treppe.js)
  const [gauben, setGaubenRoh] = useState(/** @type {any[]} */ ([])); // 108-13 Gauben auf dem Gebäudedach: [{edge,u_von_m,u_bis_m,…,_idx}] (bauteil/gauben.js)
  // additive fields: a record that never had them is not given them (pattern verschneidung/dachform_ifc) — set once a list was loaded or filled
  const hatteTreppenRef = useRef(false);
  const hatteGaubenRef = useRef(false);
  const [sketchJson, setSketchJson] = useState(null); // PW-05: Sketch aus dem BIT Sketcher (read-only Overlay)
  const [winType, setWinType] = useState("double"); // aktueller Fenstertyp
  const [doorType, setDoorType] = useState("single"); // aktueller Türtyp
  const [draft, setDraft] = useState([]); // aktuelle Wand-Kette (Meter-Punkte)
  const [hover, setHover] = useState(null);
  const [selected, setSelectedState] = useState(null); // {type,index}
  const [multiSel, setMultiSelState] = useState([]); // Mehrfachauswahl aus Markierungsrahmen: [{type,index,...}]
  // 106-02: synchronous mirror of the selection. React state lands one render later, so two commands in the same
  // tick ("auswahl-guid", then "ansicht-auf-auswahl") would otherwise read the old selection; every write goes
  // through these two setters (stable like state setters), the commands read the ref.
  const auswahlRef = useRef(/** @type {{selected: any, multiSel: any[]}} */ ({ selected: null, multiSel: [] }));
  const setSelected = useCallback((/** @type {any} */ v) => {
    auswahlRef.current.selected = typeof v === "function" ? v(auswahlRef.current.selected) : v;
    setSelectedState(v);
  }, []);
  const setMultiSel = useCallback((/** @type {any} */ v) => {
    auswahlRef.current.multiSel = typeof v === "function" ? v(auswahlRef.current.multiSel) : v;
    setMultiSelState(v);
  }, []);
  const [hint, setHint] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null); // {x,y,hit:{kind,id}}
  const [wallComp, setWallComp] = useState("single24"); // Standard-Aufbau für neue Wände
  const idRef = useRef(1);
  // 107-11 (D-BK-13): room proposals of the current storey (raeume.js raeumeAusWaenden) — shown, never stored until the user takes one
  // over. Only the open/closed state is kept; the list itself is derived from the CURRENT walls and storey (review: never stale).
  const [vorschlaegeOffen, setVorschlaegeOffen] = useState(false);
  const [din277Offen, setDin277Offen] = useState(false); // 107-11 review: DIN 277 table of the storeys (session only)
  const [vorschlagRegel, setVorschlagRegel] = useState("innenkante"); // measuring rule of a taken-over proposal
  const [raumGrenzenIfc, setRaumGrenzenIfc] = useState(false); // 107-11: IFC option IfcRelSpaceBoundary + Qto (session only)
  // 107-04: first corner of a rectangle drawn on a wall face or slab in 3D (tool "oeffnung"): { schluessel, p: {u, v} | {x, z}, art }
  const ecke3dRef = useRef(/** @type {any} */ (null));
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const multiSelRef = useRef(multiSel); multiSelRef.current = multiSel;
  const [showShortcuts, setShowShortcuts] = useState(false); // Hilfe-Popover „Tastaturkürzel" (BIM-D)
  const [attrHidden, setAttrHidden] = useState(false); // Attribute-Panel per ✕ ausgeblendet (bis zur nächsten Auswahl)
  useEffect(() => { setAttrHidden(false); }, [selected, multiSel]);
  const [focus2d, setFocus2d] = useState(null); // Zoom-auf-Auswahl im 2D (BIM-C): {bbox,nonce} | {reset,nonce}
  // ---- Favoriten (BIM-F): Werkzeug+Aufbau/Typ-Kombis, lokal in localStorage (max 6, FIFO) ----
  const [favs, setFavs] = useState(() => { try { return JSON.parse(localStorage.getItem("nc-bim-favs") || "[]"); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem("nc-bim-favs", JSON.stringify(favs)); } catch { /* localStorage gesperrt/voll */ } }, [favs]);

  // ---- BIM 2.0: Modell-Persistenz je Projekt (Entität BimModel) ----
  // Laden beim Projektwechsel; Auto-Save (debounced) bei jeder Modelländerung.
  // Datensatz-Autorität ist useBimModelSync (KD-17): loadBimModel teilt EINEN
  // Request mit dem Hook, saveBimModel ist der einzige Schreibpfad. Dieser
  // Effekt schreibt ausschließlich die Elementfelder — die Programmfelder
  // (footprintM/storeys/storeyHeight/unit) schreibt allein der Hook.
  const [saveState, setSaveState] = useState("idle"); // idle | loading | saving | saved | error
  // Testlauf 26.08. (Referenzprojekt): Projekte OHNE gespeichertes Modell zeigten das
  // prozedurale Default-Klötzchen in Realitäts-Optik. Der Banner unten sagt
  // ehrlich, dass es Editor-Defaults sind, bis der Nutzer speichert.
  const [hatGespeichertesModell, setHatGespeichertesModell] = useState(true);
  const loadingRef = useRef(false);
  // Drawing undo (walls, openings, storeys, footprint). One step per completed
  // change; a grip drag is one step. Load and the change-step writer stay out of it.
  const historieRef = useRef(leereHistorie());
  const modellStandRef = useRef(/** @type {any} */ (null));
  const historieStillRef = useRef(false);
  const historieApiRef = useRef(/** @type {{ zurueck: () => void, vor: () => void }} */ ({ zurueck: () => {}, vor: () => {} }));
  const [historieTick, setHistorieTick] = useState(0);
  // 107-12 (D-BK-21): saved views and layer properties of the project (fachlayer ansicht_layer, Version 1; this studio is the one writer)
  const [ansichtLayer, setAnsichtLayer] = useFachlayer(project?.id || null, "ansicht_layer", ANSICHT_LEER);
  const ansichtDaten = useMemo(() => ansichtLayerNormalisieren(ansichtLayer), [ansichtLayer]);
  const views = ansichtDaten.ausschnitte;
  modellStandRef.current = {
    customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs, customStairs, gauben,
    storeys, untergeschosse, footprintM: footprintEdit, footprintQuelle: bp.footprintQuelle,
    storeyHeight, geschosse,
    ausschnitte: views, // 107-12: saving / deleting a view is a step of the drawing undo
    entranceCfg, // 108-01 review: the automatic entrance (on/off, size, position) is a stored model field → one undo step per change
    huelle_erscheinung: huelleErscheinung, // appearance key of the envelope; absent on older snapshots
  };
  const setHuelleErscheinung = (/** @type {string|null} */ v) => { merken(); setHuelleErscheinungRoh(v || null); };
  const merken = useCallback(() => {
    const next = vorAenderung(historieRef.current, modellStandRef.current, {
      still: loadingRef.current || historieStillRef.current,
    });
    if (next !== historieRef.current) {
      historieRef.current = next;
      setHistorieTick((n) => n + 1);
    }
  }, []);
  const setCustomWalls = useCallback((/** @type {any} */ v) => { merken(); setCustomWallsRoh(v); }, [merken]);
  const setCustomColumns = useCallback((/** @type {any} */ v) => { merken(); setCustomColumnsRoh(v); }, [merken]);
  const setCustomWindows = useCallback((/** @type {any} */ v) => { merken(); setCustomWindowsRoh(v); }, [merken]);
  const setEnvOpenings = useCallback((/** @type {any} */ v) => { merken(); setEnvOpeningsRoh(v); }, [merken]);
  const setCustomZones = useCallback((/** @type {any} */ v) => { merken(); setCustomZonesRoh(v); }, [merken]);
  const setCustomSlabs = useCallback((/** @type {any} */ v) => { merken(); setCustomSlabsRoh(v); }, [merken]);
  const setCustomRoofs = useCallback((/** @type {any} */ v) => { merken(); setCustomRoofsRoh(v); }, [merken]);
  const setCustomStairs = useCallback((/** @type {any} */ v) => { merken(); hatteTreppenRef.current = true; setCustomStairsRoh(v); }, [merken]); // 108-06
  const setGauben = useCallback((/** @type {any} */ v) => { merken(); hatteGaubenRef.current = true; setGaubenRoh(v); }, [merken]); // 108-13
  const setStoreys = useCallback((/** @type {number} */ v) => { merken(); setStoreysDirekt(v); }, [merken]);
  const setUntergeschosse = useCallback((/** @type {number} */ v) => { merken(); setUntergeschosseDirekt(v); }, [merken]);
  const setStoreyHeight = useCallback((/** @type {number} */ v) => { merken(); setStoreyHeightDirekt(v); }, [merken]);
  const setGeschossHoehe = useCallback((/** @type {number} */ level, /** @type {number} */ v) => { merken(); setGeschossHoeheDirekt(level, v); }, [merken]);
  const setFootprintEdit = useCallback((/** @type {any} */ fp) => { merken(); setFootprintEditDirekt(fp); }, [merken]);
  /** 108-02: knee wall of the top storey (m, null = remove) — one undo step like a storey height (`geschosse` is in the snapshot). */
  const setKniestock = (/** @type {number|null} */ v) => { merken(); bp.set(patchKniestock(bp, v)); };
  // 108-01 review: edits of the entrance in the panel (checkbox, hint button, size, position) go through the drawing undo; load and the
  // change stream of other devices keep the plain setter (they record nothing, like the other fields)
  const setEntranceCfgSchritt = useCallback((/** @type {any} */ v) => { merken(); setEntranceCfg(v); }, [merken]);
  const griffStart = useCallback(() => { historieRef.current = zieheStart(historieRef.current); }, []);
  const griffEnde = useCallback(() => { historieRef.current = zieheEnde(historieRef.current); }, []);
  const projectId = project?.id || null;
  // 108-01 review: the entrance checkbox was used in this session → the hint "abschalten?" is not shown again (a deliberate "on" cannot
  // be told from an old stored default otherwise); UI state, not saved, cleared on a project switch
  const [eingangSchalterBenutzt, setEingangSchalterBenutzt] = useState(false);
  useEffect(() => { setEingangSchalterBenutzt(false); }, [projectId]);
  // 107-03 (D-BK-22): build-ups of the project (fachlayer aufbauten_layer, Version 1). compositeById/aufbauVon ask this registry first, so it is
  // handed over on every render (idempotent, module-level state outside React); `aufbautenKey` lets the memos and 3D effects that depend on layer
  // thicknesses rebuild when a project build-up is edited.
  const [aufbautenLayer, setAufbautenLayer] = useFachlayer(projectId, "aufbauten_layer", AUFBAUTEN_LEER);
  // set while rendering (before the children read it), once per layer value; released again on unmount so the ids "p-1" … of this project
  // never resolve in the next one (the effect also re-sets it: React StrictMode runs effect cleanups once on mount)
  useMemo(() => setzeProjektAufbauten(aufbautenLayer), [aufbautenLayer]);
  useEffect(() => { setzeProjektAufbauten(aufbautenLayer); return () => gibProjektAufbautenFrei(aufbautenLayer); }, [aufbautenLayer]);
  const aufbautenKey = useMemo(() => JSON.stringify(aufbautenLayer?.aufbauten || {}), [aufbautenLayer]);
  // 97-06: openings of the project for the checks (read only; written in Werkplanung › Durchbrüche).
  useEffect(() => {
    let aktiv = true;
    if (!projectId) { setDurchbrueche([]); return undefined; }
    bitApi.entities.Durchbruch.filter({ project_id: projectId })
      .then((rows) => { if (aktiv) setDurchbrueche(Array.isArray(rows) ? rows : []); })
      .catch((err) => { if (aktiv) { setDurchbrueche([]); setHint(`Durchbrüche für die Prüfregeln nicht geladen: ${err?.message || err}`); } });
    return () => { aktiv = false; };
  }, [projectId]);
  useEffect(() => {
    // A project switch must not undo into the previous model's elements.
    historieRef.current = leereHistorie();
    setHistorieTick((n) => n + 1);
    if (!projectId) return;
    let cancelled = false;
    loadingRef.current = true;
    setSaveState("loading");
    (async () => {
      try {
        const geladen = await loadBimModel(projectId);
        if (cancelled) return;
        // 106-09 review: a field with an open conflict shows this studio's own version again (kept when it unmounted);
        // versions of conflicts that are gone meanwhile (decided, dropped with another project) are forgotten
        for (const id of [...studioMeinStand.keys()]) if (!abgleichStand.konflikt(id)) studioMeinStand.delete(id);
        const eigene = Object.fromEntries(abgleichStand.stand().konflikte
          .filter((k) => k.quelle === "bim" && k.projektId === projectId && studioMeinStand.has(k.id))
          .map((k) => [k.feld, studioMeinStand.get(k.id)]));
        const m = geladen ? { ...geladen, ...eigene } : geladen;
        setHatGespeichertesModell(!!m);
        if (m) {
          setCustomWalls(m.customWalls || []);
          setCustomColumns(m.customColumns || []);
          setCustomWindows(m.customWindows || []);
          setEnvOpenings(m.envOpenings || []);
          setCustomZones(m.customZones || []);
          setCustomSlabs(m.customSlabs || []);
          setCustomRoofs((m.customRoofs || []).map(dachMigrieren)); // 107-02: old roofs (only `pitch`, metres) get firsthoehe_m
          // 108-06 / 108-13: additive lists — a record without them stays without them until one is inserted
          setCustomStairsRoh(Array.isArray(m.customStairs) ? m.customStairs : []); hatteTreppenRef.current = m.customStairs !== undefined;
          setGaubenRoh(Array.isArray(m.gauben) ? m.gauben : []); hatteGaubenRef.current = m.gauben !== undefined;
          if (m.envComposite !== undefined) setEnvComposite(m.envComposite);
          setHuelleErscheinungRoh(typeof m.huelle_erscheinung === "string" && m.huelle_erscheinung ? m.huelle_erscheinung : null);
          if (m.envThickness) setEnvThickness(m.envThickness);
          setHuelleBezug(m.huelle_bezug === "outside" || m.huelle_bezug === "inside" ? m.huelle_bezug : "center");
          setVerschneidung(m.verschneidung === true); hatteVerschneidungRef.current = m.verschneidung !== undefined; // 107-09
          setHuelleDeckeDicke(Number(m.huelle_decke_dicke_m) > 0 ? Number(m.huelle_decke_dicke_m) : DECKEN_STANDARD.huelle.dicke_m);
          setHuelleDeckeBezug(m.huelle_decke_bezug === "oben" ? "oben" : DECKEN_STANDARD.huelle.bezug);
          if (m.parapet) setParapet(m.parapet);
          if (m.dachform) setDachform(m.dachform);
          if (m.dachneigung != null) setDachneigung(m.dachneigung);
          setDachIfc(m.dachform_ifc === true); hatteDachIfcRef.current = m.dachform_ifc !== undefined; // 107-10 review
          if (m.entranceCfg) setEntranceCfg({ ...ENTRANCE_START, ...m.entranceCfg }); // 108-01: a stored `enabled` stays, none is added
          // PW-05: Sketch des Projekts (BIT Sketcher, Feld sketch_layer) —
          // read-only Anzeige im Grundriss; geschrieben wird NUR im Sketcher.
          setSketchJson(m.sketch_layer || null);
          // Phase 41: TGA-Netz für den IFC-Export (IfcPipe-/Duct-/CableSegment) — geschrieben wird es nur im Haustechnik-Reiter.
          setNetzLayer(m.netz_layer || null);
          setStatikLayer(m.statik_layer || null);
          setAttributLayer(m.bauteil_attribute_layer || null);
          setMassingLayer(m.massing_layer || null);
          // Programmfelder (footprintM/storeys/storeyHeight/unit) setzt der Hook
          // useBimModelSync in die gemeinsame Quelle — hier NICHT doppelt.
          // _idx-Zähler hinter die geladenen Elemente setzen (keine Kollisionen)
          const maxIdx = Math.max(0, ...[...(m.customWalls || []), ...(m.customColumns || []), ...(m.customWindows || []), ...(m.envOpenings || []), ...(m.customZones || []), ...(m.customSlabs || []), ...(m.customRoofs || []), ...(m.customStairs || []), ...(m.gauben || [])].map((x) => x._idx || 0));
          idRef.current = maxIdx + 1;
        } else {
          // Neues Projekt ohne Modell: Editor leeren (kein Übertrag vom Vorprojekt)
          setCustomWalls([]); setCustomColumns([]); setCustomWindows([]); setEnvOpenings([]); setNetzLayer(null); setStatikLayer(null); setAttributLayer(null); setMassingLayer(null);
          setCustomZones([]); setCustomSlabs([]); setCustomRoofs([]);
          setCustomStairsRoh([]); setGaubenRoh([]); hatteTreppenRef.current = false; hatteGaubenRef.current = false; // 108-06 / 108-13
          setHuelleBezug("center");
          setVerschneidung(false); hatteVerschneidungRef.current = false; // 107-09
          setDachIfc(false); hatteDachIfcRef.current = false; // 107-10 review
          setHuelleDeckeDicke(DECKEN_STANDARD.huelle.dicke_m); setHuelleDeckeBezug(DECKEN_STANDARD.huelle.bezug);
          setSketchJson(null);
        }
        setSaveState("idle");
      } catch {
        if (!cancelled) setSaveState("error");
      } finally {
        // erst nach dem Render-Zyklus wieder speichern erlauben
        setTimeout(() => { loadingRef.current = false; }, 50);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId || loadingRef.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        // Nur Elementfelder — Programmfelder gehören dem Hook (EIN Schreiber je Feld).
        // 107-08 review (lazy GUID): a real save pins the GlobalId of every wall, column, room, slab and roof in the stored lists
        // (guidsAnheften = the derived value, the IFC export stays byte-identical). Selecting or looking at an element writes nothing.
        const pid = projectId || null;
        await saveBimModel(projectId, {
          envComposite, envThickness, huelle_bezug: huelleBezug, huelle_erscheinung: huelleErscheinung || null, huelle_decke_dicke_m: huelleDeckeDicke, huelle_decke_bezug: huelleDeckeBezug, parapet, dachform, dachneigung, entranceCfg,
          // 107-09: a record without the field stays without it until the switch is used (old projects load and save unchanged)
          ...(verschneidung || hatteVerschneidungRef.current ? { verschneidung } : {}),
          // 107-10 review: the same rule for the switch "Gebäudedach ins IFC"
          ...(dachIfc || hatteDachIfcRef.current ? { dachform_ifc: dachIfc } : {}),
          customWalls: guidsAnheften(customWalls, pid, "customWalls"), customColumns: guidsAnheften(customColumns, pid, "customColumns"), customWindows, envOpenings,
          customZones: guidsAnheften(customZones, pid, "customZones"), customSlabs: guidsAnheften(customSlabs, pid, "customSlabs"), customRoofs: guidsAnheften(customRoofs, pid, "customRoofs"),
          // 108-06 / 108-13: additive — written only once the record had or got the list (an emptied list is written as [] so a deletion sticks)
          ...(hatteTreppenRef.current ? { customStairs: guidsAnheften(customStairs, pid, "customStairs") } : {}),
          ...(hatteGaubenRef.current ? { gauben: guidsAnheften(gauben, pid, "gauben") } : {}),
        });
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 1200);
    return () => clearTimeout(t);
  }, [projectId, envComposite, envThickness, huelleBezug, huelleErscheinung, huelleDeckeDicke, huelleDeckeBezug, parapet, dachform, dachneigung, entranceCfg, customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs, customStairs, gauben, verschneidung, dachIfc]);

  // ---- Ebenen (Layers) ----
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [combo, setCombo] = useState("Alle zeigen");
  const [showLayers, setShowLayers] = useState(true);
  const layersRef = useRef(layers); layersRef.current = layers;
  const layerVis = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.visible])), [layers]);
  const layerLocked = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l.locked])), [layers]);
  /** 107-12: writes the layer switches into ansicht_layer.ebenen (they survive a reload; existing names visible / locked). */
  const ebenenSpeichern = (/** @type {typeof DEFAULT_LAYERS} */ ls) => setAnsichtLayer((alt) => ({ ...(alt || {}), ebenen: ls.map((l) => ({ id: l.id, visible: l.visible, locked: l.locked })) }));
  const toggleLayer = (id, key) => {
    const neu = layersRef.current.map((l) => l.id === id ? { ...l, [key]: !l[key] } : l);
    setLayers(neu); setCombo("Eigene"); ebenenSpeichern(neu);
  };
  const applyCombo = (name, speichern = true) => {
    setCombo(name);
    const on = new Set(LAYER_COMBOS[name] || []);
    const neu = layersRef.current.map((l) => ({ ...l, visible: on.has(l.id) }));
    setLayers(neu);
    if (speichern) ebenenSpeichern(neu);
  };
  // 107-12: stored layer properties of the project (loaded / changed by another device) — the combination is the one whose set matches
  const ebenenSchluessel = JSON.stringify(ansichtDaten.ebenen);
  // review 107-12: the studio stays mounted on a project switch — the view parameters of the previous project must not carry over
  // (else a view "a1" of the new project with equal parameters would count as applied)
  useEffect(() => {
    setStrukturdarstellung("gesamt"); setAnsichtOptionen(null); setAnsichtRegeln(null);
    setAktiverAusschnittId(null); setAusgabeWunsch(null);
    eigeneAusschnittIdsRef.current = new Set();
  }, [projectId]);
  useEffect(() => {
    // a project without stored layer properties starts from the defaults (review 107-12: before, the previous project's switches stayed)
    const neu = ansichtDaten.ebenen.length ? ebenenAnwenden(DEFAULT_LAYERS, ansichtDaten.ebenen) : DEFAULT_LAYERS;
    if (JSON.stringify(neu) === JSON.stringify(layersRef.current)) return;
    setLayers(neu);
    const an = neu.filter((l) => l.visible).map((l) => l.id).sort().join(",");
    setCombo(Object.keys(LAYER_COMBOS).find((k) => [...LAYER_COMBOS[k]].sort().join(",") === an) || "Eigene");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ebenenSchluessel, projectId]);

  // Footprint: gezeichnetes Polygon (designated_areas) → Meter, sonst Default.
  // 108-01 (D-EFH-05): only an area of type "footprint" (older areas without a type count as one) — before, the first area of ANY type
  // was taken, so a building envelope ("baufeld") could become the outline.
  const drawn = (complexData?.designated_areas || []).find((a) => Array.isArray(a?.points) && a.points.length >= 3 && (a.type ?? "footprint") === "footprint");
  const footprintM = drawn ? footprintToMeters(drawn.points, complexData?.site_parcel) : null;
  // 108-01: the building envelope of the site planning in model metres (same frame as the footprint area), dashed in the floor plan.
  // 108-01 review: without a footprint area the envelope is drawn in its own frame (centred on its vertex mean, like footprintToMeters)
  // and labelled as such — before it vanished; the same label when the outline is a measured one (another frame than the areas).
  const baufeldUmriss = useMemo(() => {
    const bf = (complexData?.designated_areas || []).find((a) => Array.isArray(a?.points) && a.points.length >= 3 && a.type === "baufeld");
    return bf ? flaecheImModellrahmen(bf.points, drawn ? drawn.points : bf.points, complexData?.site_parcel) : null;
  }, [complexData, drawn]);
  const baufeldMittig = !!baufeldUmriss && (!drawn || bp.footprintQuelle?.art === "gemessen");

  // Effektiver Grundriss: editiert > gezeichnet > Default.
  const footprint = footprintEdit || footprintM;
  // Gemeinsames Modell — Single Source of Truth für 3D UND 2D (Grundriss/Schnitt).
  const model = useMemo(
    // 108-02 (D-EFH-01): roof form and slope go in for the knee wall (eaves, top-storey walls, collar-beam floor); without a knee wall unused
    () => createBuildingModel({ footprintM: footprint, storeys, storeyHeight, parapet, wallThickness: envThickness, wallComposite: envComposite, huelleBezug, geschosse, deckenDicke: huelleDeckeDicke, deckenBezug: huelleDeckeBezug, untergeschosse, dachform, dachneigung }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [footprint, storeys, storeyHeight, parapet, envThickness, envComposite, huelleBezug, geschosse, huelleDeckeDicke, huelleDeckeBezug, aufbautenKey, untergeschosse, dachform, dachneigung],
  );

  // PW-05: Sketch des Projekts (BIT Sketcher) als read-only Grundriss-Overlay.
  // Kein Solver nötig — nur Anzeige der gespeicherten Geometrie.
  const sketchObj = useMemo(() => {
    if (!sketchJson) return null;
    try {
      const s = Sketch.deserialize(sketchJson);
      return s.points.size || s.circles.size ? s : null;
    } catch {
      return null; // korrupter Stand → Overlay weglassen statt crashen
    }
  }, [sketchJson]);
  // Sketch-Punkte in Plan-Koordinaten (Y-Flip) für die BBox-Erweiterung.
  const sketchBounds = useMemo(
    () => (sketchObj ? [...sketchObj.points.values()].map((p) => ({ x: p.x, z: -p.y })) : undefined),
    [sketchObj]
  );

  // ---- Sketch-Editing direkt im Grundriss (Phase 34-05, PW-05 Ausbau) ----
  // Mutable Sketch-Instanz + Solver nur im Edit-Modus; geschrieben wird über
  // saveBimModel ins Feld sketch_layer — derselbe Pfad wie der BIT Sketcher
  // (nie gleichzeitig gemountet: eigene Route vs. dieser Tab). runSolve ist
  // synchron, daher keine Solver-Reentranz; solver.js NUR lazy (LGPL-Chunk).
  const [sketchEdit, setSketchEdit] = useState(false);
  const [sketchTool, setSketchTool] = useState("line"); // line | select
  const [sketchDraft, setSketchDraft] = useState(null); // Linienzug-Draft (Sketch-Koord.)
  const [sketchVersion, setSketchVersion] = useState(0);
  const [sketchSolve, setSketchSolve] = useState(null);
  const [sketchSolverStatus, setSketchSolverStatus] = useState("aus");
  const sketchEditRef = useRef(null);
  const sketchSolverRef = useRef(null);
  // Review-Fixes 34-05: die Instanz gehört zu GENAU EINEM Projekt, und
  // geschrieben wird nur, was sich gegenüber dem geladenen Stand geändert hat.
  const sketchProjektRef = useRef(null); // projectId, zu dem sketchEditRef gehört
  const lastSavedSketchRef = useRef(null); // JSON-String des zuletzt geladenen/gespeicherten Stands

  const resolveSketch = (extra = []) => {
    if (sketchSolverRef.current && sketchEditRef.current) {
      setSketchSolve(runSolve(sketchSolverRef.current, sketchEditRef.current, { extraConstraints: extra }));
    }
    setSketchVersion((v) => v + 1);
  };

  // Ungespeicherte Sketch-Änderungen JETZT schreiben (Modus-Ende, Tab-Wechsel,
  // Projektwechsel) — nur bei echter Änderung gegenüber lastSaved (Review-Fix:
  // das bloße Betreten des Modus darf keinen Write auslösen).
  const flushSketch = (pid) => {
    if (!pid || !sketchEditRef.current || sketchProjektRef.current !== pid) return;
    const json = sketchEditRef.current.serialize();
    const sig = JSON.stringify(json);
    if (sig === lastSavedSketchRef.current) return;
    lastSavedSketchRef.current = sig;
    saveBimModel(pid, { sketch_layer: json }).catch(() => {
      /* offline: nächster Flush/Persist versucht es erneut */
    });
    if (pid === projectId) setSketchJson(json);
  };
  const flushSketchRef = useRef(null);
  flushSketchRef.current = flushSketch;

  const startSketchEdit = async () => {
    // Review-Fix (Race): Instanz IMMER aus dem GELADENEN Stand des aktuellen
    // Projekts aufbauen (loadBimModel ist gecacht und save-kohärent) — nie aus
    // einem evtl. noch nicht geladenen sketchJson oder einer Fremd-Instanz.
    if (!sketchEditRef.current || sketchProjektRef.current !== projectId) {
      let quelle = null;
      try {
        const m = projectId ? await loadBimModel(projectId) : null;
        quelle = m?.sketch_layer || null;
      } catch {
        quelle = sketchJson; // offline: bester bekannter Stand
      }
      try {
        sketchEditRef.current = quelle ? Sketch.deserialize(quelle) : new Sketch();
      } catch {
        sketchEditRef.current = new Sketch();
      }
      sketchProjektRef.current = projectId;
      lastSavedSketchRef.current = JSON.stringify(sketchEditRef.current.serialize());
    }
    setSketchEdit(true);
    setView("grundriss");
    setSketchDraft(null);
    if (!sketchSolverRef.current) {
      setSketchSolverStatus("lädt…");
      try {
        const m = await import("@sketch/lib/solver.js"); // lazy — LGPL-Chunk-Trennung!
        sketchSolverRef.current = await m.getSolver();
        setSketchSolverStatus("bereit");
      } catch (e) {
        setSketchSolverStatus(`Fehler: ${e.message}`);
      }
    }
    resolveSketch();
  };
  const stopSketchEdit = () => {
    flushSketch(projectId); // Review-Fix: letzter Stand darf nicht im Debounce sterben
    setSketchEdit(false);
    setSketchDraft(null);
  };

  // Projektwechsel/Unmount: erst den ALTEN Stand flushen (Closure hält die
  // alte projectId), dann die Instanz verwerfen — sonst schriebe der Debounce
  // den Sketch von Projekt A nach Projekt B (Review-Befund, critical).
  useEffect(() => {
    return () => {
      flushSketchRef.current?.(projectId);
      sketchEditRef.current = null;
      sketchProjektRef.current = null;
      lastSavedSketchRef.current = null;
      setSketchEdit(false);
      setSketchVersion(0);
      setSketchSolve(null);
      setSketchDraft(null);
    };
  }, [projectId]);

  // Mutationen (Muster SketchStudio): Linienzug + Solver-Drag.
  const sketchEndpunkt = (spec) =>
    spec.pointId ? spec.pointId : sketchEditRef.current.addPoint(spec.x, spec.y).id;
  const sketchAddSegment = (startSpec, endSpec, autoConstraint) => {
    const sk = sketchEditRef.current;
    const p1 = sketchEndpunkt(startSpec);
    if (endSpec.pointId === p1) return p1;
    const start = sk.points.get(p1);
    if (endSpec.pointId == null && start && endSpec.x === start.x && endSpec.y === start.y) return p1;
    const p2 = sketchEndpunkt(endSpec);
    if (autoConstraint === "horizontal") sk.points.get(p2).y = sk.points.get(p1).y;
    if (autoConstraint === "vertical") sk.points.get(p2).x = sk.points.get(p1).x;
    const { id } = sk.addLine(p1, p2);
    if (autoConstraint) sk.addConstraint({ type: autoConstraint, line: id });
    resolveSketch();
    return p2;
  };
  const sketchDragPoint = (pointId, x, y) => {
    if (!sketchSolverRef.current) {
      const p = sketchEditRef.current.points.get(pointId);
      if (p) {
        p.x = x;
        p.y = y;
      }
      setSketchVersion((v) => v + 1);
      return;
    }
    resolveSketch([{ type: "drag", point: pointId, x, y }]);
  };

  // Persistenz: debounced über saveBimModel (Feld sketch_layer) + lokalen
  // sketchJson-Stand nachziehen, damit die read-only Anzeige aktuell bleibt.
  // Guards (Review-Fixes): nur für die Projekt-eigene Instanz, nur bei echter
  // Änderung gegenüber lastSaved (Modus-Eintritt allein schreibt nichts).
  useEffect(() => {
    if (!sketchEdit || sketchVersion === 0 || !projectId) return undefined;
    if (!sketchEditRef.current || sketchProjektRef.current !== projectId) return undefined;
    const t = setTimeout(async () => {
      try {
        const json = sketchEditRef.current.serialize();
        const sig = JSON.stringify(json);
        if (sig === lastSavedSketchRef.current) return;
        await saveBimModel(projectId, { sketch_layer: json });
        lastSavedSketchRef.current = sig;
        setSketchJson(json);
      } catch {
        /* offline: nächste Änderung versucht es erneut */
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchVersion, sketchEdit, projectId]);

  // Edit-Modus: Bounds live aus der editierten Instanz.
  const sketchEditBounds = useMemo(() => {
    if (!sketchEdit || !sketchEditRef.current) return undefined;
    return [...sketchEditRef.current.points.values()].map((p) => ({ x: p.x, z: -p.y }));
  }, [sketchEdit, sketchVersion]);

  // Regel-Öffnungen der Hülle (Auto-Fenster je ~3,5 m + Eingangstür) — EINE
  // Quelle für 3D und IFC-Export, damit Modell und Export nicht auseinandergehen
  // (KD-16). Benutzerplatzierte Öffnungen verdrängen das Auto-Fenster an
  // derselben Stelle (keine überlappenden Löcher/Voids).
  const placedEnv = useMemo(
    () => envOpenings.map((o) => ({ level: o.level, edge: o.edge, u: o.u, width: oeffnungsMasse(o).w })), // 107-04: own width of the opening first
    [envOpenings],
  );
  // 108-01 (D-EFH-04): the entrance in effect — a stored choice wins, "not set" is off with an own hull door on the ground floor
  const eingangAn = eingangWirksam(entranceCfg, envOpenings);
  const entranceWirksam = useMemo(() => ({ ...entranceCfg, enabled: eingangAn }), [entranceCfg, eingangAn]);
  const autoOpenings = useMemo(
    () => autoEnvOpenings(model.walls, { entrance: entranceWirksam }, placedEnv),
    [model, entranceWirksam, placedEnv],
  );
  /** 108-01: the effective entrance opening for plan and PDF (null = off: no door symbol, no dimension cut). */
  const eingangOeffnung = useMemo(() => entranceOpening(model.walls, entranceWirksam), [model, entranceWirksam]);
  // 108-01: the global roof form once (globalesDach) — section, 3D and solid relations read the same roof; the section axis across the ridge
  const globalDach = useMemo(() => globalesDach(model, dachform, dachneigung, gs), [model, dachform, dachneigung, gs]);
  // 108-03: the hull walls of the top storey with their profile under that roof (gable walls up to the ridge); same model object without a pitched roof
  const giebel = useMemo(() => mitGiebelProfilen(model, globalDach), [model, globalDach]);
  // 108-02 (D-EFH-01): full-storey rule of the attic storey (the top storey with a knee wall) from the same roof: floor = top of the
  // structural slab under it (eaves − knee wall) [ASSUMED: no floor build-up], area = the footprint. A hint, never a block (vollgeschoss.js).
  const vollgeschossDg = useMemo(() => {
    if (model.kniestock_m == null || !globalDach || !globalDach.ok) return null;
    return vollgeschossAusDach({ grundriss: model.footprint, dachEbenen: dachEbenen(globalDach), boden_m: Number(model.traufhoehe_m) - Number(model.kniestock_m) });
  }, [model, globalDach]);
  /** @type {"x"|"z"} */
  const schnittAchse = schnittAchseWahl ?? schnittAchseQuerZumFirst(globalDach) ?? "x";

  // ---- 107-04: opening chain (host, sizes, height anchor, new opening) ----
  // The walls an opening can sit in (drawn + hull walls), for wirtVon() — the ONE host resolver (also used by the IFC export).
  const wirtModell = useMemo(() => ({ customWalls, huelle: giebel.model.walls, werkstatt: null, projektId: projectId || null, geschosse: gs }), [customWalls, giebel, projectId, gs]); // 108-03: hull walls with their roof profile
  /** Stores a record made by neueOeffnung() in its array (the plan click and the 3D click both end here). */
  const oeffnungSetzen = ({ scope, satz }) => (scope === "env" ? setEnvOpenings : setCustomWindows)((os) => [...os, satz]);
  /**
   * Sizes of an opening on its wall (own width/height/sill first, then the type), the sill converted to the wall bottom when the opening names
   * another height anchor (bruestung_bezug okrd/okff: the floor slab of the storey below is looked up). 3D, plan and checks read this.
   * @param {any} o opening record
   * @param {{a: {x: number, z: number}, b: {x: number, z: number}, level?: number}} w its wall
   * @param {number} unterkante_m bottom edge of the wall in m
   */
  const masseAmWand = (o, w, unterkante_m) => {
    if (o.bruestung_bezug !== "okrd" && o.bruestung_bezug !== "okff") return oeffnungsMasse(o);
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1, u = o.u ?? len / 2;
    const punkt = { x: w.a.x + ((w.b.x - w.a.x) / len) * u, z: w.a.z + ((w.b.z - w.a.z) / len) * u };
    return oeffnungsMasse(o, ankerFuerWand({ level: w.level || 0, unterkante_m }, gs, { huelle: model.slabs, gezeichnet: customSlabs }, punkt));
  };
  /** The type object of an opening with its own sizes laid over it (columns, rows, glass from the type) — what buildGlazing needs. */
  const typAmWand = (o, w, unterkante_m) => ({ ...openingTypeById(o.kind, o.typeId), ...masseAmWand(o, w, unterkante_m) });
  // Executed penetrations of the openings planning that lie IN their host wall (drawn or hull): a hole through all layers, like an opening without a filling.
  // The host is found by its GUID (bauteil_guid); u = x/y projected on the wall axis, the sill from z (middle) minus half the height.
  const durchbruchLoecher = useMemo(() => durchbrueche.flatMap((d) => {
    if (d?.status !== "ausgefuehrt") return [];
    const wirt = wirtVon(d, wirtModell);
    if (!wirt || (wirt.familie !== "gezeichnet" && wirt.familie !== "huelle")) return [];
    if (!durchbruchImWirt(d, wirt).innen) return []; // like the IFC export: one that misses its host stays a provision (marker) and is named by check 12
    if (durchbruchTiefe(d, wirt)) return []; // a slot (t < wall thickness) is a recess, not a hole through every layer: shown as a marker (durchbruchVormerkungen)
    const rund = d.form === "rund", b = Number(rund ? d.d : d.b), h = Number(rund ? d.d : d.h);
    if (!(b > 0) || !(h > 0) || wirt.u == null || !Number.isFinite(Number(d.z))) return [];
    return [{ schluessel: wirt.schluessel, u: wirt.u, sill: Number(d.z) - h / 2 - wirt.wand.unterkante_m, width: b, height: h, rund }];
  }), [durchbrueche, wirtModell]);
  // Planned penetrations (and executed ones that miss their host): translucent boxes at their place, so they can be seen against the wall (no hole).
  const durchbruchVormerkungen = useMemo(() => durchbrueche.flatMap((d) => {
    if (!d || d.status === "abgelehnt") return [];
    const rund = d.form === "rund", b = Number(rund ? d.d : d.b), h = Number(rund ? d.d : d.h);
    if (!(b > 0) || !(h > 0) || ![d.x, d.y, d.z].every((v) => v != null && Number.isFinite(Number(v)))) return [];
    const wirt = wirtVon(d, wirtModell);
    if (d.status === "ausgefuehrt" && wirt && (wirt.familie === "gezeichnet" || wirt.familie === "huelle") && durchbruchImWirt(d, wirt).innen && !durchbruchTiefe(d, wirt)) return []; // that one is a hole (durchbruchLoecher)
    const tiefe = Number(d.t) > 0 ? Number(d.t) : wirt ? wirt.wand.dicke_m + 0.04 : DURCHBRUCH_TIEFE_OHNE_WIRT_M;
    const ang = wirt ? Math.atan2(wirt.wand.b.z - wirt.wand.a.z, wirt.wand.b.x - wirt.wand.a.x) : 0;
    return [{ nr: d.nr || d.id, x: Number(d.x), y: Number(d.z), z: Number(d.y), b, h, tiefe, ang, rund }];
  }), [durchbrueche, wirtModell]);
  // ---- 107-10: stored solid relations (Fachlayer solidrelationen_layer, version 1) — "Wand abschrägen gegen Dach" ----
  const [seoLayer, setSeoLayer] = useFachlayer(projectId, "solidrelationen_layer", SOLIDRELATIONEN_LEER);
  const seoAktiv = useMemo(() => relationenVon(seoLayer).some((r) => r.aktiv), [seoLayer]);
  // ---- 107-09: priority-based connections (switch "Wände verschneiden") ----
  // Lazy module (bands + solids + plan/section outlines); never loaded while the switch is off, so the csg chunk is not either.
  const csgCache = useCsgCache(projectId);
  const csgCacheRef = useRef(csgCache);
  csgCacheRef.current = csgCache;
  const [vModul, setVModul] = useState(/** @type {typeof import("@core/lib/bauteil/solidAbleitung.js")|null} */ (null));
  const [vFehler, setVFehler] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    if (!verschneidung || vModul) return undefined;
    let aktiv = true;
    import("@core/lib/bauteil/solidAbleitung.js").then((m) => { if (aktiv) { setVModul(m); setVFehler(null); } })
      .catch((e) => { if (aktiv) setVFehler(String(e?.message || e)); });
    return () => { aktiv = false; };
  }, [verschneidung, vModul]);
  // resolved opening sizes per wall key — the same holes as the 3D build-up (rule openings, placed ones, executed penetrations)
  const vOeffnungen = useMemo(() => {
    if (!verschneidung && !seoAktiv) return null; // 107-10: the wall-under-roof solids need the same holes
    /** @type {Map<string, Array<{u: number, width: number, height: number, sill: number}>>} */
    const m = new Map();
    for (const w of model.walls) {
      const k = `env:${w.level}:${w.edge}`;
      const ops = autoOpenings.filter((o) => o.level === w.level && o.edge === w.edge).map((o) => ({ u: o.u, sill: o.sill, width: o.width, height: o.height }));
      envOpenings.filter((e) => e.level === w.level && e.edge === w.edge).forEach((e) => { const ty = masseAmWand(e, w, w.elevation); ops.push({ u: e.u, sill: ty.sill, width: ty.w, height: ty.h }); });
      m.set(k, ops);
    }
    for (const w of customWalls) {
      const elev = unterkante(w, gs);
      m.set(`cw:${w._idx}`, customWindows.filter((cw) => cw.wallIdx === w._idx).map((cw) => { const ty = masseAmWand(cw, w, elev); return { u: cw.u, sill: ty.sill, width: ty.w, height: ty.h }; }));
    }
    // [ASSUMED] a round penetration is cut as its bounding rectangle (rule of the CSG core 107-14, wandSolid)
    for (const l of durchbruchLoecher) m.get(l.schluessel)?.push({ u: l.u, sill: l.sill, width: l.width, height: l.height });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verschneidung, seoAktiv, model, customWalls, customWindows, envOpenings, autoOpenings, durchbruchLoecher, gs]);
  const vGuids = useMemo(() => {
    /** @type {Map<string, string>} */
    const m = new Map();
    for (const w of model.walls) m.set(`env:${w.level}:${w.edge}`, huellwandGuid(projectId || null, w.level, w.edge));
    for (const w of customWalls) m.set(`cw:${w._idx}`, bauteilGuid(projectId || null, "customWalls", w));
    return m;
  }, [model, customWalls, projectId]);
  // the cleaned bands of every storey (synchronous, cheap) — the analytic reference and the fallback of plan and section
  const vBaender = useMemo(() => (verschneidung && vModul && vOeffnungen
    ? vModul.modellBaender(vModul.verschneidungsWaende(model, customWalls, { geschosse: gs, oeffnungen: vOeffnungen, guids: vGuids }), { geschosse: gs })
    : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [verschneidung, vModul, vOeffnungen, vGuids, model, customWalls, gs, aufbautenKey]);
  // the bands the solids are built from: plus the drawn slabs of a higher priority the wall layers lose (review 107-09, mitDeckenAbzuegen)
  const vBaenderSolid = useMemo(() => (vBaender && vModul ? vModul.mitDeckenAbzuegen([...vBaender.jeSchluessel.values()].flat(), customSlabs, { geschosse: gs }) : null),
    [vBaender, vModul, customSlabs, gs]);
  const [vSolids, setVSolids] = useState(/** @type {{waende: Map<string, any>, decken: Map<string, any>}|null} */ (null));
  const [vRechnet, setVRechnet] = useState(false);
  /** promise of the running derivation (a PDF/DXF export waits for it, so the sheet never depends on the moment) */
  const vLaufRef = useRef(/** @type {Promise<{waende: Map<string, any>, decken: Map<string, any>}|null>|null} */ (null));
  useEffect(() => {
    if (!vBaenderSolid || !vModul) { setVSolids(null); setVRechnet(false); vLaufRef.current = null; return undefined; }
    let abgebrochen = false;
    setVRechnet(true);
    const lauf = (async () => {
      const alle = vBaenderSolid;
      const ctx = { cache: csgCacheRef.current, abbruch: () => abgebrochen, geschosse: gs };
      const waende = await vModul.wandSolids(alle, vGuids, ctx);
      const kerne = vModul.wandKerne(alle);
      const decken = new Map();
      for (const sl of customSlabs) {
        if (abgebrochen) break;
        const r = await vModul.deckenSolid(sl, kerne, { ...ctx, guid: bauteilGuid(projectId || null, "customSlabs", sl) });
        if (r) decken.set(r.schluessel, r);
      }
      if (abgebrochen) {
        for (const e of [...waende.values(), ...decken.values()]) e.geometrie?.dispose();
        return null;
      }
      // the cache keeps only today's components with today's hashes (D-BK-08a: stale meshes are discarded)
      // review 107-10: only the keys of this derivation — the solid relations below clean their own "|seo:" keys (shared layer)
      csgCacheRef.current.bereinigen(new Map([...waende.values(), ...decken.values()].map((e) => [e.cache.schluessel, e.cache.hash])), (k) => !istSeoCacheSchluessel(k));
      return { waende, decken };
    })();
    vLaufRef.current = lauf;
    lauf.then((r) => { if (r && !abgebrochen) { setVSolids(r); setVRechnet(false); } })
      .catch((e) => { if (!abgebrochen) { setVFehler(String(e?.message || e)); setVRechnet(false); } });
    return () => { abgebrochen = true; };
  }, [vBaenderSolid, vModul, vGuids, customSlabs, gs, projectId]);
  // Review 107-09: only the entries that still belong to TODAY's bands are drawn — while a new derivation runs (dragging a wall), the
  // last result belongs to the old geometry; plan, section, 3D and data sheet fall back to the bands for every changed component.
  const vSolidsAktuell = useMemo(() => (vBaenderSolid && vModul && vSolids
    ? { waende: vModul.aktuelleSolids(vBaenderSolid, vSolids.waende), decken: vModul.aktuelleDecken(customSlabs, vModul.wandKerne(vBaenderSolid), vSolids.decken, { geschosse: gs }) }
    : null), [vBaenderSolid, vModul, vSolids, customSlabs, gs]);
  // geometries of a replaced result are released (the meshes in the scene hold clones)
  useEffect(() => () => { for (const e of [...(vSolids?.waende.values() || []), ...(vSolids?.decken.values() || [])]) e.geometrie?.dispose(); }, [vSolids]);
  /** Colour, hatch and name of a layer of a wall key (skins of its build-up). @param {string} k @param {number} i */
  const vSchicht = (k, i) => {
    const w = k.startsWith("env:") ? model.walls.find((x) => `env:${x.level}:${x.edge}` === k) : customWalls.find((x) => `cw:${x._idx}` === k);
    const sk = compositeById(w?.composite)?.skins?.[i];
    return { color: sk?.color || "#94a3b8", hatch: sk?.hatch, name: sk?.name || "" };
  };
  /**
   * Plan outlines of one storey for BimPlan2D and the PDF/DXF plan (solid cut at the cut height, else the bands).
   * @param {number} lvl storey level @param {Map<string, any>|null} waende solids
   */
  const vPlanFlaechenFuer = (lvl, waende) => {
    const r = vBaender?.jeGeschoss.get(lvl);
    if (!r || !vModul) return null;
    const pf = vModul.planFlaechen(r.baender, waende, elevationOf(lvl, gs) + cutHeight);
    return new Map([...pf.entries()].map(([k, v]) => [k, { quelle: v.quelle, baender: v.schichten.map((x) => ({ schicht: x.schicht, ringe: x.ringe, ...vSchicht(k, x.schicht) })) }]));
  };
  const vPlanFlaechen = useMemo(() => vPlanFlaechenFuer(ebeneKlemmen(model, planLevel), vSolidsAktuell?.waende || null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vBaender, vSolidsAktuell, vModul, planLevel, cutHeight, model, gs]);
  /** Section outlines (hull walls along z = 0, like the section of BimPlan2D and vektorPlan). @param {Map<string, any>|null} waende */
  const vSchnittFlaechenFuer = (waende) => {
    if (!vBaender || !vModul) return null;
    const fp = model.footprint || [];
    const x0 = Math.min(...fp.map((q) => q.x)) - 50, x1 = Math.max(...fp.map((q) => q.x)) + 50;
    const huelle = [...vBaender.jeSchluessel.entries()].filter(([k]) => k.startsWith("env:")).flatMap(([, b]) => b);
    return vModul.schnittFlaechen(huelle, waende, { a: { x: x0, z: 0 }, b: { x: x1, z: 0 } }).map((f) => ({ ...f, color: vSchicht(f.schluessel, f.schicht).color }));
  };
  const vSchnittFlaechen = useMemo(() => vSchnittFlaechenFuer(vSolidsAktuell?.waende || null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vBaender, vSolidsAktuell, vModul, model]);
  /**
   * Data-sheet entry of an intersected component: quantity and source, warning of the volume comparison (null = none yet / not intersected).
   * @param {string} k component key ("env:…", "cw:…", "decke:<_idx>")
   */
  const vInfo = (k) => {
    const e = k.startsWith("decke:") ? vSolidsAktuell?.decken.get(k) : vSolidsAktuell?.waende.get(k);
    if (!verschneidung || !e) return null;
    // review 107-09 (plan task 5): the volume per layer goes along — from the solid when the comparison passed, else the hand rule
    const jeSchicht = k.startsWith("decke:") ? [] : e.volumen.jeSchicht.map((/** @type {any} */ x) => ({
      name: vSchicht(k, x.index).name || `${x.index + 1}`, material: x.material, menge_m3: e.quelle === "solid" && x.solid_m3 != null ? x.solid_m3 : x.analytisch_m3 }));
    return { quelle: e.quelle, menge_m3: e.menge_m3, warnung: e.warnung, jeSchicht };
  };
  /** Readable name of a wall key for the status messages ("env:0:2" → hull wall of the storey, edge 3; "cw:4" → wall 4). @param {string} k */
  const vWandName = (k) => {
    const m = /^env:(-?\d+):(\d+)$/.exec(String(k));
    if (m) return tz("Hüllwand {{geschoss}}, Kante {{n}}").replace("{{geschoss}}", ebeneName(model, Number(m[1]))).replace("{{n}}", String(Number(m[2]) + 1));
    const c = /^cw:(\d+)$/.exec(String(k));
    return c ? tz("Wand {{n}}").replace("{{n}}", c[1]) : String(k);
  };
  // messages of the intersection (groups that overlap without intersecting, acute joints) — named, never silent
  const vMeldungText = useMemo(() => (vBaender?.meldungen || []).map((m) => (m.code === "gruppen-ueberlappung"
    ? tz("Wände {{a}} und {{b}}: keine Verschneidung trotz Überlappung (Gruppen {{ga}} und {{gb}})").replace("{{a}}", vWandName(String(m.a))).replace("{{b}}", vWandName(String(m.b))).replace("{{ga}}", String(m.gruppen?.[0])).replace("{{gb}}", String(m.gruppen?.[1]))
    : tz("Spitzer Winkel ({{grad}}°) am Stoß von {{wand}}: verschnitten, bitte prüfen").replace("{{grad}}", String(m.winkel_grad)).replace("{{wand}}", vWandName(String(m.schluessel))))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [vBaender, model]);

  // ---- 107-10: solid relations resolved (bauteil/seo.js, lazily; the csg chunk loads only with an ACTIVE relation) ----
  // Operators: the drawn roofs and the global roof form, by their GUIDs (107-08); targets: hull and drawn walls. The target is never
  // changed (VI.3); the cut wall is a derived solid drawn instead of the wall body once its comparison passed (D-BK-08a/08b). Same
  // pattern as the intersection above (one effect, the cache is useCsgCache); while a new result is computed today's wall shows.
  const seoDaecher = useMemo(() => {
    /** @type {Map<string, {art: "dach", element: any, name: string, dach: any}>} */
    const m = new Map();
    for (const rf of customRoofs) {
      if (!Array.isArray(rf.points) || rf.points.length < 3) continue;
      const { dach, anstieg_m } = dachVonDachelement(rf);
      m.set(bauteilGuid(projectId || null, "customRoofs", rf), { art: "dach", element: rf, name: tz("Dach {{n}}").replace("{{n}}", String(rf._idx)),
        dach: dachBerechnen(rf.points, dach, { traufhoehe_m: deckenLage(rf, gs, "dach").unterkante_m, anstieg_m: dach.form === "flach" ? 0 : anstieg_m }) });
    }
    if (dachform && dachform !== "flach" && Array.isArray(model.footprint) && model.footprint.length >= 3) {
      // 108-01: eaves from the one function globaleTraufhoehe_m (via globalesDach), the same roof as 3D, IFC and section
      m.set(bauteilGuid(projectId || null, "dach-global", { id: "global" }), { art: "dach", element: {}, name: tz("Gebäudedach"),
        dach: globalesDach(model, dachform, dachneigung, gs) });
    }
    return m;
  }, [customRoofs, gs, projectId, dachform, dachneigung, model, tz]);
  /** wall key ("env:…" / "cw:…") ↔ GUID of every wall (cheap; also for the IFC option without the lazy module) */
  const seoWandGuids = useMemo(() => {
    /** @type {Map<string, string>} */ const zuGuid = new Map();
    /** @type {Map<string, string>} */ const zuSchluessel = new Map();
    for (const w of model.walls) { const g = huellwandGuid(projectId || null, w.level, w.edge), k = `env:${w.level}:${w.edge}`; zuGuid.set(k, g); zuSchluessel.set(g, k); }
    for (const w of customWalls) { const g = bauteilGuid(projectId || null, "customWalls", w), k = `cw:${w._idx}`; zuGuid.set(k, g); zuSchluessel.set(g, k); }
    return { zuGuid, zuSchluessel };
  }, [model, customWalls, projectId]);
  const seoBauteile = useMemo(() => {
    if (!seoAktiv || !vOeffnungen) return null;
    /** @type {Map<string, any>} */
    const m = new Map(seoDaecher);
    // the generated hull walls have no record: intersection group 1 (as in 107-09)
    for (const w of model.walls) { const k = `env:${w.level}:${w.edge}`; m.set(seoWandGuids.zuGuid.get(k), { art: "wand", element: { verschneidungsgruppe: 1 }, schluessel: k, wand: w, oeffnungen: vOeffnungen.get(k) || [] }); }
    for (const w of customWalls) { const k = `cw:${w._idx}`; m.set(seoWandGuids.zuGuid.get(k), { art: "wand", element: w, schluessel: k, wand: { ...w, level: Number(w.level) || 0 }, oeffnungen: vOeffnungen.get(k) || [] }); }
    return m;
  }, [seoAktiv, vOeffnungen, seoDaecher, seoWandGuids, model, customWalls]);
  const [seoModul, setSeoModul] = useState(/** @type {typeof import("@core/lib/bauteil/seo.js")|null} */ (null));
  const [seoFehler, setSeoFehler] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    if (!seoAktiv || seoModul) return undefined;
    let aktiv = true;
    import("@core/lib/bauteil/seo.js").then((m) => { if (aktiv) { setSeoModul(m); setSeoFehler(null); } })
      .catch((e) => { if (aktiv) setSeoFehler(String(e?.message || e)); });
    return () => { aktiv = false; };
  }, [seoAktiv, seoModul]);
  const [seoErgebnisse, setSeoErgebnisse] = useState(/** @type {Map<string, any>|null} */ (null));
  const [seoRechnet, setSeoRechnet] = useState(false);
  /** promise of the running resolution — a PDF/DXF export waits for it (review 107-10, the pattern of vLaufRef) */
  const seoLaufRef = useRef(/** @type {Promise<Map<string, any>|null>|null} */ (null));
  useEffect(() => {
    setSeoErgebnisse(null); // a stale result never stands at an old place: today's wall shows until the new one is there
    if (!seoModul || !seoBauteile) {
      setSeoRechnet(false); seoLaufRef.current = null;
      // review 107-10: every relation switched off in this session — the "|seo:" entries of the shared cache are stale now
      if (seoModul) csgCacheRef.current.bereinigen(new Map(), istSeoCacheSchluessel);
      return undefined;
    }
    let ab = false;
    setSeoRechnet(true);
    const lauf = seoModul.aufgeloesteGeometrie({ bauteile: seoBauteile }, seoLayer, { cache: csgCacheRef.current, geschosse: gs, abbruch: () => ab })
      .then((r) => {
        if (ab) { for (const e of r.values()) e.geometrie?.dispose(); return null; }
        // review 107-10: the relations clean their own keys of the shared cache (today's results with today's hashes); the keys of the
        // intersection of 107-09 stay untouched (and that derivation leaves these alone) — no write/delete cycle between the two
        csgCacheRef.current.bereinigen(new Map([...r.values()].filter((e) => e.cache).map((e) => [e.cache.schluessel, e.cache.hash])), istSeoCacheSchluessel);
        setSeoErgebnisse(r); setSeoRechnet(false);
        return r;
      })
      .catch((e) => { if (!ab) { setSeoFehler(String(e?.message || e)); setSeoRechnet(false); } return null; });
    seoLaufRef.current = lauf;
    return () => { ab = true; };
  }, [seoModul, seoBauteile, seoLayer, gs]);
  useEffect(() => () => { for (const e of seoErgebnisse?.values() || []) e.geometrie?.dispose(); }, [seoErgebnisse]);
  /** results by wall key ("env:…" / "cw:…"); only those whose comparison passed carry a drawn solid @param {Map<string, any>|null} ergebnisse */
  const seoNachSchluessel = (ergebnisse) => {
    /** @type {Map<string, any>} */
    const m = new Map();
    for (const [g, r] of ergebnisse || []) { const k = seoWandGuids.zuSchluessel.get(g); if (k) m.set(k, r); }
    return m;
  };
  const seoJeSchluessel = useMemo(() => seoNachSchluessel(seoErgebnisse),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seoErgebnisse, seoWandGuids]);
  /** @param {string} k wall key @returns {any|null} the cut solid of a wall, when it may be drawn */
  const seoSolid = (k) => { const r = seoJeSchluessel.get(k); return r?.ok && r.geometrie ? r : null; };
  /**
   * Review 107-10: the finished relation results for an export — waits for the running resolution (the sheet must not depend on the
   * moment); null without an active relation. With relations but the module not loaded yet (or failed) the export is refused with a
   * message instead of printing the walls without their bevel (the rule of vSolidsFertig).
   * @returns {Promise<Map<string, any>|null>} results by wall key
   * @throws {Error} with a German message when the bevel is not available yet
   */
  const seoFertig = async () => {
    if (!seoAktiv) return null;
    if (!seoModul || !seoBauteile) throw new Error(seoFehler ? tz("Abschrägung nicht verfügbar: {{text}}").replace("{{text}}", seoFehler) : tz("Abschrägung wird noch geladen — Export bitte gleich wiederholen."));
    /** @type {Map<string, any>|null} */
    let r = null;
    for (let lauf = seoLaufRef.current, n = 0; lauf && n < 10; lauf = seoLaufRef.current, n += 1) {
      r = await lauf.catch(() => null);
      if (lauf === seoLaufRef.current) break;
    }
    return seoNachSchluessel(r || seoErgebnisse);
  };
  /** storey level of a wall key (hull "env:<level>:<edge>", drawn "cw:<_idx>"), null when unknown @param {string} k */
  const wandEbeneVon = (k) => {
    const m = /^env:(-?\d+):/.exec(k);
    if (m) return Number(m[1]);
    const c = /^cw:(\d+)$/.exec(k);
    const w = c ? customWalls.find((x) => String(x._idx) === c[1]) : null;
    return w ? Number(w.level) || 0 : null;
  };
  /**
   * Review 107-10 (truth "Schnitt, Plan und Mengen aus diesem Solid"): plan outlines of the walls cut under a roof on one storey, from
   * the horizontal cut of their solid at the cut height (seo.js seoPlanFlaechen) — the format of vPlanFlaechenFuer, so BimPlan2D and
   * the PDF/DXF plan draw them like intersected walls. A wall the cut misses keeps today's drawing.
   * @param {number} lvl storey level @param {Map<string, any>|null} jeSchluessel results by wall key
   * @returns {Map<string, any>|null}
   */
  const seoPlanFuer = (lvl, jeSchluessel) => {
    if (!seoModul || !jeSchluessel?.size) return null;
    const auswahl = new Map([...jeSchluessel].filter(([k, r]) => r?.ok && wandEbeneVon(k) === lvl));
    if (!auswahl.size) return null;
    const pf = seoModul.seoPlanFlaechen(auswahl, elevationOf(lvl, gs) + cutHeight);
    return pf.size ? new Map([...pf].map(([k, v]) => [k, { quelle: v.quelle, baender: v.schichten.map((x) => ({ schicht: x.schicht, ringe: x.ringe, ...vSchicht(k, x.schicht) })) }])) : null;
  };
  /** the bevelled walls win over the intersected ones (as in the 3D view) @param {Map<string, any>|null} vMap @param {Map<string, any>|null} sMap */
  const planMitSeo = (vMap, sMap) => (sMap && sMap.size ? new Map([...(vMap || []), ...sMap]) : vMap);
  const seoPlan = useMemo(() => seoPlanFuer(ebeneKlemmen(model, planLevel), seoJeSchluessel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seoModul, seoJeSchluessel, model, planLevel, cutHeight, gs, customWalls]);
  const planFlaechenMitSeo = useMemo(() => planMitSeo(vPlanFlaechen, seoPlan), [vPlanFlaechen, seoPlan]);
  /**
   * Section of the walls cut under a roof (same line as the intersection's section: z = 0). Review 107-10: hull AND drawn walls — a
   * drawn wall appears in the section once it is cut under a roof (other drawn walls stay out of the section, as before 107-10).
   * @param {Map<string, any>|null} jeSchluessel results by wall key @param {any[]|null} vSchnitt the intersection's section outlines
   */
  const seoSchnittFuer = (jeSchluessel, vSchnitt) => {
    if (!seoModul || !jeSchluessel?.size) return null;
    const fp = model.footprint || [];
    const linie = { a: { x: Math.min(...fp.map((q) => q.x)) - 50, z: 0 }, b: { x: Math.max(...fp.map((q) => q.x)) + 50, z: 0 } };
    const auswahl = new Map([...jeSchluessel].filter(([, r]) => r?.ok));
    /** @type {Array<{schluessel: string, schicht: number, quelle: "solid"|"rechteck", ringe: Array<Array<{x: number, h: number}>>, color: string}>} */
    const geschnitten = seoModul.seoSchnittFlaechen(auswahl, linie).map((f) => ({ ...f, color: vSchicht(f.schluessel, f.schicht).color }));
    if (!geschnitten.length) return null;
    // a hull entry replaces a whole side (schnittErsetzt): every other above-ground hull wall the line crosses goes along as its plain
    // rectangle (body polygon ∩ z = 0, lower to upper edge), so the storeys below the cut wall stay drawn. Drawn walls replace nothing.
    if (!geschnitten.some((f) => f.schluessel.startsWith("env:"))) return geschnitten;
    const fertig = new Set([...geschnitten.map((f) => f.schluessel), ...(vSchnitt || []).map((/** @type {any} */ f) => f.schluessel)]);
    for (const w of model.walls) {
      const k = `env:${w.level}:${w.edge}`;
      if (w.level < 0 || fertig.has(k)) continue;
      const poly = wandGeometrie(w).polygon;
      /** @type {number[]} */
      const xs = [];
      poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; if ((p.z <= 0 && q.z >= 0) || (p.z >= 0 && q.z <= 0)) { if (p.z === q.z) xs.push(p.x, q.x); else xs.push(p.x + ((0 - p.z) / (q.z - p.z)) * (q.x - p.x)); } });
      if (xs.length < 2 || Math.max(...xs) - Math.min(...xs) < 1e-9) continue;
      const x0 = Math.min(...xs), x1 = Math.max(...xs), h0 = w.elevation, h1 = w.elevation + w.height;
      geschnitten.push({ schluessel: k, schicht: 0, quelle: "rechteck", ringe: [[{ x: x0, h: h0 }, { x: x1, h: h0 }, { x: x1, h: h1 }, { x: x0, h: h1 }]], color: vSchicht(k, 0).color });
    }
    return geschnitten;
  };
  /** @param {any[]|null} seoS @param {any[]|null} vS */
  const schnittMitSeoFuer = (seoS, vS) => (seoS && seoS.length ? [...(vS || []).filter((f) => !seoS.some((x) => x.schluessel === f.schluessel)), ...seoS] : vS);
  const schnittMitSeo = useMemo(() => schnittMitSeoFuer(seoSchnittFuer(seoJeSchluessel, vSchnittFlaechen), vSchnittFlaechen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seoModul, seoJeSchluessel, model, vSchnittFlaechen]);
  /**
   * Review 107-10 (truth "Mengen aus dem Solid"): data-sheet entry of a wall cut under a roof — the volume from its solid (or the hand
   * rule / open), per layer; null without an acting relation. The quantity source of the component like vInfo of 107-09.
   * @param {string} k wall key
   */
  const seoInfo = (k) => {
    const r = seoJeSchluessel.get(k);
    if (!r || !r.relationen?.length || r.status === "gruppe-0") return null;
    const jeSchicht = (r.volumen?.jeSchicht || []).map((/** @type {any} */ x) => ({ name: vSchicht(k, x.index).name || `${x.index + 1}`,
      menge_m3: r.quelle === "solid" && x.solid_m3 != null ? x.solid_m3 : x.analytisch_m3 }));
    return { quelle: r.quelle, menge_m3: r.menge_m3, warnung: r.warnung, jeSchicht };
  };
  /** IFC option: active "wall under roof" relations of acting pairs (group 0 never), by wall key — pure, no lazy module needed */
  const seoExportWaende = () => {
    /** @type {Map<string, any[]>} */
    const m = new Map();
    for (const r of relationenVon(seoLayer)) {
      if (!r.aktiv || r.operation !== "abzug_nach_oben") continue;
      const d = seoDaecher.get(r.operator_guid), k = seoWandGuids.zuSchluessel.get(r.ziel_guid);
      if (!d?.dach?.ok || !k) continue;
      const ziel = k.startsWith("cw:") ? customWalls.find((x) => `cw:${x._idx}` === k) : { verschneidungsgruppe: 1 };
      if (!relationWirkt(ziel, d.element).wirkt) continue;
      m.set(k, [...(m.get(k) || []), d.dach]);
    }
    return m;
  };
  /**
   * Inspector rows "Wand abschrägen gegen Dach" of one wall: choose a roof (creates or re-activates the relation), the acting relations
   * with "Entfernen" (sets aktiv: false — the relation stays stored, the wall is shown unchanged again) and the state of the solid.
   * @param {string} k wall key
   * @param {(label: string, child: any) => any} field row helper of the panel
   * @param {string} selCls
   */
  const seoFelder = (k, field, selCls) => {
    const guid = seoWandGuids.zuGuid.get(k);
    if (!guid) return [];
    const rels = aktiveRelationenFuer(seoLayer, guid);
    const r = seoJeSchluessel.get(k);
    const zeilen = [];
    zeilen.push(field(tz("Wand abschrägen gegen Dach"), <select className={selCls} value="" data-testid="seo-dach-wahl" aria-label={tz("Wand abschrägen gegen Dach")}
      onChange={(e) => { if (e.target.value) setSeoLayer(relationAnlegen(seoLayer, { ziel_guid: guid, operator_guid: e.target.value, operation: "abzug_nach_oben" }).layer); }}>
      <option value="">{seoDaecher.size ? tz("Dach wählen …") : tz("Kein Dach im Modell")}</option>
      {[...seoDaecher].filter(([g]) => !rels.some((x) => x.operator_guid === g)).map(([g, d]) => <option key={g} value={g}>{d.name}</option>)}
    </select>));
    // row labels are the React keys of the panel: unique per relation, never a label the panel already uses ("Hinweis")
    rels.forEach((rel, i) => {
      zeilen.push(field(rels.length > 1 ? `${tz("Abgeschrägt gegen")} ${i + 1}` : tz("Abgeschrägt gegen"), <span className="flex items-center gap-2" data-testid="seo-relation" data-relation={rel.id}>
        <span>{seoDaecher.get(rel.operator_guid)?.name || tz("Dach fehlt")}</span>
        <button type="button" className="text-[10px] underline text-muted-foreground" data-testid="seo-entfernen" onClick={() => setSeoLayer(relationAktivSetzen(seoLayer, rel.id, false))}>{tz("Entfernen")}</button>
      </span>));
    });
    if (rels.length) {
      const text = seoFehler ? tz("Abschrägung nicht verfügbar: {{text}}").replace("{{text}}", seoFehler)
        : !r ? tz("Abschrägung wird berechnet …")
          : r.hinweise?.includes("gruppe-0") && !r.relationen?.length ? tz("Bauteil verschneidet nie (Gruppe 0)")
            : r.warnung ? csgWarnungText(r.warnung, tz) : "";
      if (text || seoRechnet) zeilen.push(field(tz("Stand der Abschrägung"), <span className="text-[10px] leading-snug text-warnung" role="status" data-testid="seo-status" data-rechnet={seoRechnet ? "1" : undefined}>{text}</span>));
    }
    return zeilen;
  };

  // Openings that do not fit their wall (the IFC export leaves them out, with this very text): the 3D hole is clamped to the wall and the user is told —
  // no silent clamp any more (107-04). The hint is cleared again only when it is still ours.
  const oeffnungsProblemText = useMemo(() => {
    /** @type {string[]} */
    const out = [];
    const f2 = (/** @type {number} */ v) => v.toFixed(2);
    const pruefe = (/** @type {any} */ o, /** @type {any} */ wirt, /** @type {string} */ ort) => {
      if (!wirt) return;
      // 108-03: against the roof profile of a hull wall (lowest height over the opening's span)
      const r = oeffnungPasst(masseAmWand(o, wirt.wand, wirt.wand.unterkante_m), wirt.wand.laenge_m, wirt.wand.hoehe_m, { profil: wirt.wand.profil || null, u: o.u ?? null });
      if (r.ok) return;
      const wo = tz(o.kind === "door" ? "Tür auf {{ort}}" : o.kind === "oeffnung" ? "Öffnung auf {{ort}}" : "Fenster auf {{ort}}").replace("{{ort}}", ort);
      const satz = r.daten.hoehe_an_stelle != null && r.daten.sill + r.daten.h > r.daten.hoehe_an_stelle + 1e-6
        ? tz("{{wo}}: {{b}}×{{h}} m (Brüstung {{sill}} m) ragt über die Dachkontur: an dieser Stelle nur {{hw}} m Wandhöhe")
        : tz("{{wo}}: {{b}}×{{h}} m (Brüstung {{sill}} m) passt nicht in die Wand ({{l}}×{{hw}} m)");
      out.push(satz.replace("{{wo}}", wo)
        .replace("{{b}}", f2(r.daten.w)).replace("{{h}}", f2(r.daten.h)).replace("{{sill}}", f2(r.daten.sill)).replace("{{l}}", f2(r.daten.laenge)).replace("{{hw}}", f2(r.daten.hoehe)));
    };
    customWindows.forEach((o) => pruefe(o, wirtVon(o, wirtModell), tz("Wand {{wand}}").replace("{{wand}}", String(o.wallIdx))));
    envOpenings.forEach((o) => pruefe(o, wirtVon(o, wirtModell), tz("Hüllwand {{ebene}}/{{kante}}").replace("{{ebene}}", String(o.level)).replace("{{kante}}", String(o.edge))));
    return out.length ? `${out[0]}${out.length > 1 ? ` (+${out.length - 1})` : ""} — ${tz("im 3D auf die Wand begrenzt, im IFC nicht enthalten")}` : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWindows, envOpenings, wirtModell, model, customSlabs, gs, tz]);
  // The text is the memo result (a string), so the effect fires only when the TEXT changes — not on every recompute of the model. The old value
  // is read into a local before the ref is overwritten: the state updater may run later (render phase, StrictMode) and must compare with it.
  const problemHinweisRef = useRef("");
  useEffect(() => {
    const vorher = problemHinweisRef.current;
    problemHinweisRef.current = oeffnungsProblemText;
    setHint((h) => (oeffnungsProblemText ? oeffnungsProblemText : h && h === vorher ? "" : h));
  }, [oeffnungsProblemText]);

  // ---- Werkzeug wählen ----
  const FUNCTIONAL = ["arrow", "wall", "column", "window", "door", "oeffnung", "zone", "slab", "roof", "section"]; // bereits aktiv
  const selectTool = (id) => {
    setSelected(null); setMultiSel([]); setDraft([]); setHover(null); setHint("");
    ecke3dRef.current = null; // 107-04: a half-drawn 3D rectangle is dropped with the tool
    if (id === "section") { setView("schnitt"); setTool("arrow"); return; }
    if (!FUNCTIONAL.includes(id)) { setHint(`Werkzeug „${id}" kommt in einer späteren Welle.`); return; }
    setTool(id);
    // Zeichnen passiert im Grundriss — except windows, doors and wall openings: they also go onto a wall face in 3D (107-04, Glue-To)
    if (id !== "arrow" && view === "3d" && id !== "window" && id !== "door" && id !== "oeffnung") setView("grundriss");
  };

  // Werkzeugpalette (ArchiCAD-Stil)
  const PALETTE = [
    { group: null, items: [{ id: "arrow", label: "Pfeil", icon: MousePointer2 }] },
    { group: "Design", items: [
      { id: "wall", label: "Wand", icon: RectangleHorizontal },
      { id: "column", label: "Stütze", icon: Columns3 },
      { id: "slab", label: "Decke", icon: Square },
      { id: "roof", label: "Dach", icon: Triangle },
      { id: "door", label: "Tür", icon: DoorOpen },
      { id: "window", label: "Fenster", icon: AppWindow },
      { id: "oeffnung", label: "Öffnung", icon: SquareDashed },
      { id: "zone", label: "Zone", icon: Frame },
    ] },
    { group: "Viewpoint", items: [
      { id: "section", label: "Schnitt", icon: Scissors },
      { id: "elevation", label: "Ansicht", icon: Eye },
    ] },
    { group: "Document", items: [
      { id: "dimension", label: "Bemaßung", icon: Ruler },
      { id: "text", label: "Text", icon: Type },
      { id: "line", label: "Linie", icon: PenLine },
    ] },
  ];

  // ---- 107-07: object snap before a plan click (shared core objektfang.js, settings of the shared store) ----
  // Snap geometry of the current storey in plan metres (x, y = z of the studio): drawn walls, hull walls, rooms, slabs, roofs
  // and the origin; one index per model change. Only a pre-step: the click handlers below stay as they were.
  const fangEinstBim = useFangEinstellungen();
  const bimFangIdx = useMemo(() => {
    const lvl = ebeneKlemmen(model, planLevel);
    const xy = (/** @type {any} */ q) => ({ x: q.x, y: q.z });
    /** @type {any[]} */
    const ringe = [{ punkte: [{ x: 0, y: 0 }], quelle: QUELLE_URSPRUNG }];
    for (const w of customWalls) if (w.level === lvl) ringe.push({ punkte: [xy(w.a), xy(w.b)], quelle: `w${w._idx}`, geschlossen: false });
    for (const w of model.walls || []) if (w.level === lvl) ringe.push({ punkte: [xy(w.a), xy(w.b)], quelle: "huelle", geschlossen: false });
    for (const liste of [customZones, customSlabs, customRoofs]) for (const z of liste) if (z.level === lvl && Array.isArray(z.points)) ringe.push({ punkte: z.points.map(xy), quelle: `p${z._idx}` });
    return fangIndex(segmenteAusRingen(ringe));
  }, [customWalls, customZones, customSlabs, customRoofs, model.walls, planLevel, storeys]);
  /** Snap capture distance of the BIM plan, m [ASSUMED: 0.3 m, a little under the 0.4 m of the modeller — the plan is denser]. */
  const BIM_FANG_M = 0.3;
  /**
   * The point a plan click / hover stands for: the raw pointer through the shared snap core (grid, polar from the last draft
   * point, object snaps), Alt = free. Review 107-07: openings (window, door, opening) snap too — the snapped point is then
   * projected onto the nearest wall as before, so a wall midpoint centres the opening; endpoints are left out for them (an
   * opening at the very wall end never fits). The zone tool keeps the plan's own point: it is a click INTO a room (room
   * detection), no point of a geometry, so a snap would add nothing there.
   * @param {{x: number, z: number}|null} p point of the plan (0.25 m grid of BimPlan2D)
   * @param {{x: number, z: number}|null|undefined} roh raw pointer point, m
   * @param {{altKey?: boolean}|null|undefined} e pointer event (hover passes it too, so the preview honours Alt like the click)
   * @returns {{x: number, z: number}|null}
   */
  const planFang = (p, roh, e) => {
    const oeffnung = tool === "window" || tool === "door" || tool === "oeffnung";
    if (!p || !roh || !(oeffnung || ["wall", "column", "slab", "roof"].includes(tool))) return p;
    const letzter = !oeffnung && draft.length ? draft[draft.length - 1] : null;
    const modi = oeffnung ? { ...fangEinstBim, endpunkt: false } : fangEinstBim;
    const r = fangPunkt({ x: roh.x, y: roh.z }, bimFangIdx, { toleranz_m: BIM_FANG_M, modi, basis: letzter ? { x: letzter.x, y: letzter.z } : null, aus: !!e?.altKey });
    if (!r) return p;
    const rnd = (/** @type {number} */ v) => Math.round(v * 1000) / 1000; // mm, no float noise in the stored walls
    return { x: rnd(r.punkt.x), z: rnd(r.punkt.y) };
  };

  // ---- 107-11 (D-BK-13): room proposals from the drawn and hull walls of the current storey ----
  // wall entries {schluessel, wand} of all storeys (hull `env:<level>:<edge>`, drawn `cw:<_idx>`), shared by proposals and DIN 277
  const raumWandEintraege = useMemo(() => [
    ...model.walls.map((/** @type {any} */ w) => ({ schluessel: `env:${w.level}:${w.edge}`, wand: w })),
    ...customWalls.map((w) => ({ schluessel: `cw:${w._idx}`, wand: { ...w, level: Number(w.level) || 0 } })),
  ], [model.walls, customWalls]);
  // derived while the panel is open: walls, deletions and a storey change are followed at once, a stale polygon cannot be taken over
  const raumVorschlaege = useMemo(() => {
    if (!vorschlaegeOffen) return null;
    const lvl = ebeneKlemmen(model, planLevel);
    return { level: lvl, ...raeumeAusWaenden(raumWandEintraege, lvl) };
  }, [vorschlaegeOffen, model, planLevel, raumWandEintraege]);
  const raeumeVorschlagen = () => setVorschlaegeOffen(true);
  /** @param {import("@core/lib/bauteil/raeume.js").RaumVorschlag[]} liste proposals the user takes over as customZones */
  const raeumeUebernehmen = (liste) => {
    if (!liste.length) return;
    // ids and names are given BEFORE the state update: an updater runs twice under StrictMode and must not count idRef up twice
    const basis = customZones.length;
    const neu = liste.map((v, i) => ({ ...zoneAusVorschlag(v, { messregel: vorschlagRegel }), name: `Raum ${basis + i + 1}`, _idx: idRef.current++ }));
    setCustomZones((zs) => [...zs, ...neu]);
  };
  // 107-11 review (BK-54, D-BK-20): DIN 277 per level of ebenenListe(model) incl. basements, from the hull and drawn walls, the drawn
  // columns and the drawn zones of this studio (workshop zones are not included: their shell is counted in the massing NUF). Bands of
  // 107-09 are not used here (that module stays lazy): walls as body rectangles plus corner fillers.
  const din277 = useMemo(() => {
    if (!din277Offen) return null;
    return din277Flaechen({ zonen: customZones, waende: raumWandEintraege, stuetzen: customColumns, footprint: model.footprint || [], ebenen: ebenenListe(model) });
  }, [din277Offen, customZones, raumWandEintraege, customColumns, model]);

  // ---- Zeichen-Interaktion aus dem Grundriss ----
  const onPoint = (p0, e = null, roh = null) => {
    const p = planFang(p0, roh, e);
    if (!p) return;
    letztesDuplikat.current = null; // 107-07: drawing ends the typed row of the last duplicate
    if (tool === "wall" && layerLocked.walls) { setHint("Ebene Wände ist gesperrt."); return; }
    if (tool === "column" && layerLocked.columns) { setHint("Ebene Stützen ist gesperrt."); return; }
    if (tool === "wall") {
      setDraft((d) => {
        if (d.length === 0) return [p];
        const a = d[d.length - 1];
        if (Math.hypot(p.x - a.x, p.z - a.z) < 0.05) return d; // Doppelklick-Schutz
        setCustomWalls((ws) => [...ws, { a, b: p, level: ebeneKlemmen(model, planLevel), thickness: 0.3, height: storeyHeight, oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: 0, refLine: wallRef, composite: wallComp, _idx: idRef.current++ }]);
        return [...d, p];
      });
    } else if (tool === "column") {
      setCustomColumns((cs) => [...cs, { x: p.x, z: p.z, level: ebeneKlemmen(model, planLevel), size: 0.4, _idx: idRef.current++ }]);
    } else if (tool === "zone") {
      // Raum automatisch aus den umgebenden Wänden erkennen (ein Klick hinein)
      const lvl = ebeneKlemmen(model, planLevel);
      const segs = [];
      model.walls.filter((w) => w.level === lvl).forEach((w) => segs.push([w.a, w.b]));
      // 107-11: the one detection in @core (raeume.js); walls marked "nicht raumbegrenzend" do not bound a room here either
      customWalls.filter((w) => w.level === lvl && w.raumbegrenzend !== false).forEach((w) => segs.push([w.a, w.b]));
      const { punkte: poly, meldung } = raumBeiKlick(p, segs);
      if (poly) {
        setCustomZones((zs) => [...zs, { points: poly, level: lvl, name: `Raum ${zs.length + 1}`, _idx: idRef.current++ }]);
      } else {
        setHint(tz(meldung || ""));
      }
    } else if (tool === "slab" || tool === "roof") {
      // Polygon: Punkte sammeln (Abschluss per Doppelklick → onFinish)
      setDraft((d) => (d.length && Math.hypot(p.x - d[d.length - 1].x, p.z - d[d.length - 1].z) < 0.05 ? d : [...d, p]));
    } else if (tool === "window" || tool === "door" || tool === "oeffnung") {
      // Fenster/Tür/Öffnung auf das nächstgelegene Wandsegment setzen (107-04: the record comes from neueOeffnung, like the click on a wall face in 3D)
      const kind = tool;
      const typeId = kind === "door" ? doorType : kind === "window" ? winType : "oeffnung";
      const lvl = ebeneKlemmen(model, planLevel);
      let best = /** @type {{scope: string, w: any, u: number, len: number}|null} */ (null), bestD = 1e9;
      // gezeichnete Wände
      customWalls.forEach((w) => {
        const pr = projectPointToSeg(p, w.a, w.b);
        if (pr.dist < bestD) { bestD = pr.dist; best = { scope: "custom", w, u: pr.t * pr.len, len: pr.len }; }
      });
      // Hüllwände des aktuellen Geschosses
      model.walls.filter((w) => w.level === lvl).forEach((w) => {
        const pr = projectPointToSeg(p, w.a, w.b);
        if (pr.dist < bestD) { bestD = pr.dist; best = { scope: "env", w, u: pr.t * pr.len, len: pr.len }; }
      });
      if (best && bestD < 1.2) {
        const wirt = wirtVon(best.scope === "custom" ? { wallIdx: best.w._idx } : { level: best.w.level, edge: best.w.edge }, wirtModell);
        if (wirt) oeffnungSetzen(neueOeffnung({ wirt, u: best.u, kind, typeId, idx: idRef.current++ }));
      } else { setHint("Kein Wandsegment in der Nähe."); }
    }
  };
  const onFinish = () => {
    const lvl = ebeneKlemmen(model, planLevel);
    if (draft.length >= 3) {
      const pts = draft.map((p) => ({ x: p.x, z: p.z }));
      if (tool === "zone") setCustomZones((zs) => [...zs, { points: pts, level: lvl, name: `Raum ${zs.length + 1}`, _idx: idRef.current++ }]);
      else if (tool === "slab") setCustomSlabs((ss) => [...ss, { points: pts, level: lvl, _idx: idRef.current++ }]);
      // review 107-10: a new roof carries its form (the gable the 3D view draws) — so the IFC writes it as inclined plates, not as the flat
      // plate of an old roof without `form` (old roofs stay as they are, golden byte-identical)
      else if (tool === "roof") setCustomRoofs((rs) => [...rs, { points: pts, level: lvl, pitch: 2.5, firsthoehe_m: 2.5, form: "sattel", _idx: idRef.current++ }]);
    }
    setDraft([]); setHover(null);
  };
  // Elementtypen der Custom-Arrays (mehrfachauswahl-, dupliziert- und nudgefähig)
  const CUSTOM_TYPES = ["wall", "column", "opening", "zone", "slab", "roof"];
  // Aktuelle Auswahl als Liste (Marquee/Shift-Mehrfachauswahl ODER Einzelauswahl)
  const currentSelection = () =>
    multiSel.length ? multiSel : (selected && CUSTOM_TYPES.includes(selected.type) ? [selected] : []);
  // Auswahl anwenden: Einzel-Klick ersetzt, Shift+Klick (additive) toggelt in der Mehrfachauswahl (BIM-B)
  const applySelection = (sel, additive) => {
    if (additive && sel && CUSTOM_TYPES.includes(sel.type)) {
      const cur = [...currentSelection()];
      const i = cur.findIndex((m) => m.type === sel.type && m.index === sel.index);
      if (i >= 0) cur.splice(i, 1); else cur.push({ type: sel.type, index: sel.index, scope: sel.scope });
      if (cur.length === 1) { setSelected(cur[0]); setMultiSel([]); }
      else { setSelected(null); setMultiSel(cur); }
      setHint(cur.length > 1 ? `${cur.length} ausgewählt — Shift+Klick erweitert/reduziert` : "");
      return;
    }
    setMultiSel([]); setSelected(sel);
  };
  const onPick = (sel, additive) => {
    const layerId = EBENE_VON_TYP[sel.type] || "walls";
    if (layerLocked[layerId]) { setHint(`Ebene gesperrt — Auswahl nicht möglich.`); return; }
    applySelection(sel, additive);
  };
  // Markierungsrahmen-Auswahl (mehrere Custom-Elemente)
  const onMarquee = (list) => { setSelected(null); setMultiSel(list); setHint(list.length ? `${list.length} Objekt(e) ausgewählt — Entf löscht` : "Nichts im Rahmen"); };
  const onClear = () => { setSelected(null); setMultiSel([]); setHint(""); };
  const deleteMany = (list) => {
    const ids = (t) => new Set(list.filter((m) => m.type === t).map((m) => m.index));
    const w = ids("wall"); if (w.size) setCustomWalls((a) => a.filter((x) => !w.has(x._idx)));
    const c = ids("column"); if (c.size) setCustomColumns((a) => a.filter((x) => !c.has(x._idx)));
    const o = new Set(list.filter((m) => m.type === "opening").map((m) => m.index));
    if (o.size) { setCustomWindows((a) => a.filter((x) => !o.has(x._idx))); setEnvOpenings((a) => a.filter((x) => !o.has(x._idx))); }
    const z = ids("zone"); if (z.size) setCustomZones((a) => a.filter((x) => !z.has(x._idx)));
    const s = ids("slab"); if (s.size) setCustomSlabs((a) => a.filter((x) => !s.has(x._idx)));
    const r = ids("roof"); if (r.size) setCustomRoofs((a) => a.filter((x) => !r.has(x._idx)));
    const st = ids("stair"); if (st.size) setCustomStairs((a) => a.filter((x) => !st.has(x._idx))); // 108-06
    const ga = ids("gaube"); if (ga.size) setGauben((a) => a.filter((x) => !ga.has(x._idx))); // 108-13
    setMultiSel([]);
  };
  // Polygon-Eckpunkt verschieben (Zone/Decke/Dach) — „alles hat Griffe"
  const onMovePolyVert = (which, idx, vi, p) => {
    const sn = { x: snap(p.x), z: snap(p.z) };
    const upd = (arr) => arr.map((o) => o._idx === idx ? { ...o, points: o.points.map((pt, i) => (i === vi ? sn : pt)) } : o);
    if (which === "zone") setCustomZones(upd);
    else if (which === "slab") setCustomSlabs(upd);
    else if (which === "roof") setCustomRoofs(upd);
  };
  // Hüllwand-Griffe: Footprint-Eckpunkt verschieben bzw. ganze Kante (alle Geschosse).
  const onMoveFootVert = (vi, p) => {
    const base = footprintEdit || model.footprint;
    setFootprintEdit(base.map((q, i) => (i === vi ? { x: snap(p.x), z: snap(p.z) } : { x: q.x, z: q.z })));
  };
  const onMoveFootEdge = (edge, dpt) => {
    const base = footprintEdit || model.footprint; const n = base.length;
    const i1 = edge, i2 = (edge + 1) % n;
    setFootprintEdit(base.map((q, i) => (i === i1 || i === i2) ? { x: snap(q.x + dpt.x), z: snap(q.z + dpt.z) } : { x: q.x, z: q.z }));
  };
  // Footprint-Eckpunkt einfügen (Doppelklick Kantengriff) bzw. löschen (Doppelklick Eckgriff).
  const onInsertFootVert = (edge) => {
    const base = footprintEdit || model.footprint; const n = base.length;
    const a = base[edge], b = base[(edge + 1) % n];
    const next = base.map((q) => ({ x: q.x, z: q.z }));
    next.splice(edge + 1, 0, { x: snap((a.x + b.x) / 2), z: snap((a.z + b.z) / 2) });
    setFootprintEdit(next);
    setHint("Eckpunkt eingefügt — Griffe ziehen für freie Form");
  };
  const onDeleteFootVert = (vi) => {
    const base = footprintEdit || model.footprint;
    if (base.length <= 3) { setHint("Mindestens 3 Eckpunkte nötig"); return; }
    setFootprintEdit(base.filter((_, i) => i !== vi).map((q) => ({ x: q.x, z: q.z })));
    setHint("Eckpunkt gelöscht");
  };
  // ---- Griffe: Elemente per Ziehen verschieben ----
  const snap = (v) => Math.round(v / 0.25) * 0.25;
  const onMoveWallPt = (idx, end, p) => setCustomWalls((ws) => ws.map((w) => w._idx === idx ? { ...w, [end]: { x: snap(p.x), z: snap(p.z) } } : w));
  const onMoveWall = (idx, dpt) => setCustomWalls((ws) => ws.map((w) => w._idx === idx ? { ...w, a: { x: snap(w.a.x + dpt.x), z: snap(w.a.z + dpt.z) }, b: { x: snap(w.b.x + dpt.x), z: snap(w.b.z + dpt.z) } } : w));
  const onMoveColumn = (idx, p) => setCustomColumns((cs) => cs.map((c) => c._idx === idx ? { ...c, x: snap(p.x), z: snap(p.z) } : c));
  // Referenzlinie ändern (für Auswahl bzw. neue Wände)
  const setWallRefLine = (rl) => {
    setWallRef(rl);
    if (selected?.type === "wall") setCustomWalls((ws) => ws.map((w) => w._idx === selected.index ? { ...w, refLine: rl } : w));
  };
  // Wand-Aufbau (Composite) ändern (für Auswahl bzw. neue Wände)
  const setWallComposite = (cid, idx) => {
    if (idx == null) setWallComp(cid);
    const target = idx != null ? idx : (selected?.type === "wall" ? selected.index : null);
    if (target != null) setCustomWalls((ws) => ws.map((w) => w._idx === target ? { ...w, composite: cid } : w));
  };
  // Aktion aus dem 3D-Kontextmenü
  const ctxDelete = () => {
    const h = ctxMenu?.hit; if (!h) return;
    if (h.kind === "wall") setCustomWalls((ws) => ws.filter((w) => w._idx !== h.id));
    if (h.kind === "column") setCustomColumns((cs) => cs.filter((c) => c._idx !== h.id));
    if ((h.kind === "window" || h.kind === "door") && h.id != null) {
      if (h.scope === "env") setEnvOpenings((os) => os.filter((o) => o._idx !== h.id));
      else setCustomWindows((os) => os.filter((o) => o._idx !== h.id));
    }
    if (h.kind === "zone" && h.id != null) setCustomZones((zs) => zs.filter((z) => z._idx !== h.id));
    if (h.kind === "cslab" && h.id != null) setCustomSlabs((ss) => ss.filter((s) => s._idx !== h.id));
    if (h.kind === "croof" && h.id != null) setCustomRoofs((rs) => rs.filter((r) => r._idx !== h.id));
    if (h.kind === "stair" && h.id != null) setCustomStairs((ts) => ts.filter((t) => t._idx !== h.id)); // 108-06
    if (h.kind === "gaube" && h.id != null) setGauben((gs2) => gs2.filter((g) => g._idx !== h.id)); // 108-13
    setSelected(null); setCtxMenu(null);
  };
  const deleteSelected = () => {
    if (!selected) return;
    if (selected.type === "wall") setCustomWalls((ws) => ws.filter((w) => w._idx !== selected.index));
    if (selected.type === "column") setCustomColumns((cs) => cs.filter((c) => c._idx !== selected.index));
    if (selected.type === "opening") {
      if (selected.scope === "env") setEnvOpenings((os) => os.filter((o) => o._idx !== selected.index));
      else setCustomWindows((os) => os.filter((o) => o._idx !== selected.index));
    }
    if (selected.type === "zone") setCustomZones((zs) => zs.filter((z) => z._idx !== selected.index));
    if (selected.type === "slab") setCustomSlabs((ss) => ss.filter((s) => s._idx !== selected.index));
    if (selected.type === "roof") setCustomRoofs((rs) => rs.filter((r) => r._idx !== selected.index));
    if (selected.type === "stair") setCustomStairs((ts) => ts.filter((t) => t._idx !== selected.index)); // 108-06
    if (selected.type === "gaube") setGauben((gs2) => gs2.filter((g) => g._idx !== selected.index)); // 108-13
    setSelected(null);
  };
  // 108-06 / 108-13: field patches of a stair / dormer (one undo step each, through the wrapped setters)
  const patchStair = (/** @type {number} */ idx, /** @type {Record<string, any>} */ p) => setCustomStairs((ts) => ts.map((t) => (t._idx === idx ? { ...t, ...p } : t)));
  const patchGaube = (/** @type {number} */ idx, /** @type {Record<string, any>} */ p) => setGauben((gs2) => gs2.map((g) => (g._idx === idx ? { ...g, ...p } : g)));
  // ---- Properties: Felder des ausgewählten Objekts ändern ----
  const patchWall = (idx, p) => setCustomWalls((ws) => ws.map((w) => w._idx === idx ? { ...w, ...p } : w));
  const patchColumn = (idx, p) => setCustomColumns((cs) => cs.map((c) => c._idx === idx ? { ...c, ...p } : c));
  const patchZone = (idx, p) => setCustomZones((zs) => zs.map((z) => z._idx === idx ? { ...z, ...p } : z));
  const patchSlab = (idx, p) => setCustomSlabs((ss) => ss.map((s) => s._idx === idx ? { ...s, ...p } : s));
  const patchRoof = (idx, p) => setCustomRoofs((rs) => rs.map((r) => r._idx === idx ? { ...r, ...p } : r));
  const patchOpening = (idx, scope, p) => {
    const set = scope === "env" ? setEnvOpenings : setCustomWindows;
    set((os) => os.map((o) => o._idx === idx ? { ...o, ...p } : o));
  };

  // Öffnung entlang ihrer Wand verschieben (u aktualisieren)
  const onMoveOpening = (idx, p) => setCustomWindows((os) => os.map((o) => {
    if (o._idx !== idx) return o;
    const w = customWalls.find((x) => x._idx === o.wallIdx); if (!w) return o;
    const pr = projectPointToSeg(p, w.a, w.b);
    const half = oeffnungsMasse(o).w / 2; // 107-04: own width first
    const u = Math.max(half + 0.1, Math.min(pr.t * pr.len, pr.len - half - 0.1));
    return { ...o, u };
  }));
  const clearCustom = () => { setCustomWalls([]); setCustomColumns([]); setCustomWindows([]); setEnvOpenings([]); setCustomZones([]); setCustomSlabs([]); setCustomRoofs([]); setDraft([]); setSelected(null); setMultiSel([]); };

  // ---- BIM-A: Duplizieren (+1 m Versatz) — neue _idx via idRef, Auto-Save greift über die Setter ----
  // 107-07: `anzahl` / `modus` = typed "*n" (n copies, each one step further) or "/n" (n copies dividing the step) through the shared
  // array core reihenFaktoren(); every copy gets a new _idx (its GUID derives from it, so the copies stay unique).
  // Review 107-07: the step is a parameter (`schritt`, default 1 m in x and z and 1 m along the wall for an opening) — a row repeats
  // where the user put the first copy (arrow nudges included). An opening copy stays on its wall: past the wall end it is clamped,
  // and a copy that would then overlap another opening of that wall is left out (counted in the hint) — never stacked.
  /** Default step of a duplicate in m (x, z and along the wall). */
  const DUP_SCHRITT_M = 1;
  /**
   * @param {Array<{type: string, index: number, scope?: string}>} list elements to copy
   * @param {{anzahl?: number, modus?: 'mal'|'teilen', schritt?: {dx: number, dz: number, du: number}|null,
   *   paare?: Array<{orig: any, kopie: any}>|null, ohne?: {custom: Set<number>, env: Set<number>}|null}} [opt]
   *   schritt = step in m per factor (x, z, along the wall); paare = filled with original → copy of the FIRST factor;
   *   ohne = opening _idx (custom / env) that do not count for the overlap test (the copies a row is about to replace)
   * @returns {Array<{type: string, index: number, scope?: string}>} the new elements
   */
  const duplicateItems = (list, { anzahl = 1, modus = "mal", schritt = null, paare = null, ohne = null } = {}) => {
    if (!list.length) return [];
    const S = schritt || { dx: DUP_SCHRITT_M, dz: DUP_SCHRITT_M, du: DUP_SCHRITT_M };
    const newSel = [];
    const newWalls = [], newCols = [], newZones = [], newSlabs = [], newRoofs = [], newWins = [], newEnvs = [];
    let ausgelassen = 0;
    // openings already on a wall (key "c:<wallIdx>" / "e:<level>:<edge>"): middle and half width in m, for the overlap test
    /** @type {Map<string, Array<{u: number, half: number}>>} */
    const belegt = new Map();
    const belegen = (/** @type {string} */ k, /** @type {number} */ u, /** @type {number} */ half) => { if (!belegt.has(k)) belegt.set(k, []); belegt.get(k)?.push({ u, half }); };
    customWindows.forEach((o) => { if (!ohne?.custom.has(o._idx)) belegen(`c:${o.wallIdx}`, o.u ?? 0, (oeffnungsMasse(o).w || 1) / 2); });
    envOpenings.forEach((o) => { if (!ohne?.env.has(o._idx)) belegen(`e:${o.level}:${o.edge}`, o.u ?? 0, (oeffnungsMasse(o).w || 1) / 2); });
    /** Opening middle on its wall: clamped into the wall, null when it would overlap another opening there (it is left out). */
    const platz = (/** @type {string} */ k, /** @type {number} */ u, /** @type {number} */ half, /** @type {number} */ len) => {
      const uk = Math.max(half + 0.1, Math.min(u, Math.max(half + 0.1, len - half - 0.1)));
      if ((belegt.get(k) || []).some((b) => Math.abs(b.u - uk) < b.half + half - 1e-6)) return null;
      belegen(k, uk, half);
      return uk;
    };
    const faktoren = reihenFaktoren(anzahl, modus);
    for (const faktor of faktoren) {
    const DX = S.dx * faktor, DZ = S.dz * faktor, DU = S.du * faktor;
    const erste = faktor === faktoren[0];
    const merk = (/** @type {any} */ m, /** @type {any} */ sel) => { newSel.push(sel); if (erste && paare) paare.push({ orig: m, kopie: sel }); };
    const wallMap = new Map(); // alte Wand-_idx -> neue _idx (Öffnungen wandern mit)
    const shiftPts = (pts) => pts.map((p) => ({ x: p.x + DX, z: p.z + DZ }));
    list.forEach((m) => {
      if (m.type === "wall") {
        const w = customWalls.find((x) => x._idx === m.index); if (!w) return;
        const nIdx = idRef.current++; wallMap.set(w._idx, nIdx);
        newWalls.push({ ...alsKopie(w), a: { x: w.a.x + DX, z: w.a.z + DZ }, b: { x: w.b.x + DX, z: w.b.z + DZ }, _idx: nIdx });
        merk(m, { type: "wall", index: nIdx });
      } else if (m.type === "column") {
        const c = customColumns.find((x) => x._idx === m.index); if (!c) return;
        const nIdx = idRef.current++;
        newCols.push({ ...alsKopie(c), x: c.x + DX, z: c.z + DZ, _idx: nIdx });
        merk(m, { type: "column", index: nIdx });
      } else if (m.type === "zone" || m.type === "slab" || m.type === "roof") {
        const arr = m.type === "zone" ? customZones : m.type === "slab" ? customSlabs : customRoofs;
        const o = arr.find((x) => x._idx === m.index); if (!o?.points) return;
        const nIdx = idRef.current++;
        const copy = { ...alsKopie(o), points: shiftPts(o.points), _idx: nIdx };
        if (Array.isArray(o.oeffnungen)) copy.oeffnungen = o.oeffnungen.map((l) => ({ ...l, points: shiftPts(l.points || []) })); // 107-04: the holes of a slab move with its copy
        if (m.type === "zone") { copy.name = `${o.name || "Raum"} (Kopie)`; newZones.push(copy); }
        else if (m.type === "slab") newSlabs.push(copy);
        else newRoofs.push(copy);
        merk(m, { type: m.type, index: nIdx });
      }
    });
    // Öffnungen: einzeln ausgewählte kopieren (u + Schritt auf derselben Wand, geklemmt; überlappend = ausgelassen)
    list.filter((m) => m.type === "opening").forEach((m) => {
      const scope = m.scope || "custom";
      if (scope === "env") {
        const o = envOpenings.find((x) => x._idx === m.index); if (!o) return;
        // review 107-07: a hull-wall opening is clamped to its hull wall like a drawn one (it used to run past the wall end)
        const hw = (model.walls || []).find((x) => x.level === o.level && x.edge === o.edge);
        const len = hw ? Math.hypot(hw.b.x - hw.a.x, hw.b.z - hw.a.z) : (o.u ?? 0) + DU + 1;
        const u = platz(`e:${o.level}:${o.edge}`, (o.u ?? 0) + DU, (oeffnungsMasse(o).w || 1) / 2, len);
        if (u == null) { ausgelassen++; return; }
        const nIdx = idRef.current++;
        newEnvs.push({ ...alsKopie(o), u, _idx: nIdx });
        merk(m, { type: "opening", index: nIdx, scope: "env" });
      } else {
        const o = customWindows.find((x) => x._idx === m.index); if (!o) return;
        const onCopiedWall = wallMap.has(o.wallIdx);
        let u = o.u;
        if (!onCopiedWall) {
          const w = customWalls.find((x) => x._idx === o.wallIdx);
          const len = w ? Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) : 0;
          const p = platz(`c:${o.wallIdx}`, (o.u ?? 0) + DU, (oeffnungsMasse(o).w || 1) / 2, len);
          if (p == null) { ausgelassen++; return; }
          u = p;
        }
        const nIdx = idRef.current++;
        newWins.push({ ...alsKopie(onCopiedWall ? ohneWirtGuid(o) : o), wallIdx: onCopiedWall ? wallMap.get(o.wallIdx) : o.wallIdx, u, _idx: nIdx });
        merk(m, { type: "opening", index: nIdx, scope: "custom" });
      }
    });
    // Öffnungen auf duplizierten Wänden mitkopieren (auch wenn nicht einzeln ausgewählt)
    if (wallMap.size) customWindows.forEach((o) => {
      if (wallMap.has(o.wallIdx) && !list.some((m) => m.type === "opening" && (m.scope || "custom") === "custom" && m.index === o._idx)) {
        newWins.push({ ...alsKopie(ohneWirtGuid(o)), wallIdx: wallMap.get(o.wallIdx), _idx: idRef.current++ });
      }
    });
    }
    if (newWalls.length) setCustomWalls((a) => [...a, ...newWalls]);
    if (newCols.length) setCustomColumns((a) => [...a, ...newCols]);
    if (newZones.length) setCustomZones((a) => [...a, ...newZones]);
    if (newSlabs.length) setCustomSlabs((a) => [...a, ...newSlabs]);
    if (newRoofs.length) setCustomRoofs((a) => [...a, ...newRoofs]);
    if (newWins.length) setCustomWindows((a) => [...a, ...newWins]);
    if (newEnvs.length) setEnvOpenings((a) => [...a, ...newEnvs]);
    if (newSel.length === 1) { setSelected(newSel[0]); setMultiSel([]); }
    else if (newSel.length) { setSelected(null); setMultiSel(newSel); }
    const rest = ausgelassen ? ` · ${ausgelassen} ${tz("Öffnung(en) ausgelassen — Reihe passt nicht auf die Wand")}` : "";
    if (newSel.length) setHint((anzahl > 1 || modus === "teilen"
      ? `${newSel.length} ${tz("Objekt(e) als Reihe dupliziert")} (${modus === "teilen" ? "/" : "*"}${anzahl})`
      : `${newSel.length} ${tz("Objekt(e) dupliziert")} — ${tz("Pfeiltasten verschieben · *3 oder /3 tippen = Reihe")}`) + rest);
    else if (ausgelassen) setHint(`${ausgelassen} ${tz("Öffnung(en) ausgelassen — Reihe passt nicht auf die Wand")}`);
    return newSel;
  };
  // 107-07: the last duplicate is remembered; typed "*n" / "/n" right after it replaces it by a row (one array core)
  // Review 107-07: with the original → copy pairs of its first factor and that factor, so the row reads the copy's real offset.
  const letztesDuplikat = useRef(/** @type {{list: any[], neu: any[], paare: Array<{orig: any, kopie: any}>, faktor0: number}|null} */ (null));
  const [dupEingabe, setDupEingabe] = useState("");
  /**
   * Strg+D / command "duplizieren": one copy 1 m away, or with `reihe` ("*3", "/3") at once a row of that kind.
   * @param {string} [reihe] typed row for agents (the command's parameter)
   * @returns {boolean} false when the row text was not understood
   */
  const duplicateSelection = (reihe) => {
    const list = currentSelection();
    let anzahl = 1, modus = /** @type {'mal'|'teilen'} */ ("mal");
    if (reihe) {
      const e = eingabeLesen(reihe);
      if (!e || (e.art !== "mal" && e.art !== "teilen")) { setHint(`${tz("Eingabe nicht verstanden")}: „${reihe}“ — *3 ${tz("oder")} /3`); return false; }
      anzahl = e.n; modus = e.art;
    }
    /** @type {Array<{orig: any, kopie: any}>} */
    const paare = [];
    const neu = duplicateItems(list, { anzahl, modus, paare });
    letztesDuplikat.current = neu.length ? { list, neu, paare, faktor0: reihenFaktoren(anzahl, modus)[0] } : null;
    setDupEingabe("");
    return true;
  };
  /** Current record of a selection entry (null = gone). @param {{type: string, index: number, scope?: string}} m */
  const elementVon = (m) => {
    if (m.type === "wall") return customWalls.find((x) => x._idx === m.index) || null;
    if (m.type === "column") return customColumns.find((x) => x._idx === m.index) || null;
    if (m.type === "zone") return customZones.find((x) => x._idx === m.index) || null;
    if (m.type === "slab") return customSlabs.find((x) => x._idx === m.index) || null;
    if (m.type === "roof") return customRoofs.find((x) => x._idx === m.index) || null;
    if (m.type === "opening") return ((m.scope || "custom") === "env" ? envOpenings : customWindows).find((x) => x._idx === m.index) || null;
    return null;
  };
  /**
   * Review 107-07: the step of a row = where the first copy stands now relative to its original, divided by its factor — an arrow
   * nudge of the copy (or of the original) counts. x/z from the first non-opening pair, along the wall from the first opening pair on
   * the same wall; what has no pair keeps the 1 m default.
   * @param {{paare: Array<{orig: any, kopie: any}>, faktor0: number}} ld
   * @returns {{dx: number, dz: number, du: number}} m per factor
   */
  const dupSchritt = (ld) => {
    const S = { dx: DUP_SCHRITT_M, dz: DUP_SCHRITT_M, du: DUP_SCHRITT_M };
    const f = ld.faktor0 > 0 ? ld.faktor0 : 1;
    const rnd = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
    const lage = ld.paare.find((p) => p.orig.type !== "opening");
    if (lage) {
      const o = elementVon(lage.orig), k = elementVon(lage.kopie);
      const pt = (/** @type {any} */ x) => (lage.orig.type === "wall" ? x.a : lage.orig.type === "column" ? { x: x.x, z: x.z } : x.points?.[0]);
      const po = o && pt(o), pk = k && pt(k);
      if (po && pk) { S.dx = rnd((pk.x - po.x) / f); S.dz = rnd((pk.z - po.z) / f); }
    }
    const oe = ld.paare.find((p) => p.orig.type === "opening");
    if (oe) {
      const o = elementVon(oe.orig), k = elementVon(oe.kopie);
      const gleicheWand = o && k && ((oe.orig.scope || "custom") === "env" ? o.level === k.level && o.edge === k.edge : o.wallIdx === k.wallIdx);
      if (gleicheWand) S.du = rnd(((k.u ?? 0) - (o.u ?? 0)) / f);
    }
    return S;
  };
  /**
   * Replace the last duplicate by a row: typed "*n" = n copies one step, two steps … apart, "/n" = n copies dividing the step.
   * Review 107-07: the step is the copy's real offset (dupSchritt); refused with a hint when an original or a copy is gone (deleted,
   * undone), and the old copies are only removed once the new row exists.
   * @param {string} text typed text
   * @returns {boolean} true when applied
   */
  const duplikatReihe = (text) => {
    const e = eingabeLesen(text);
    const ld = letztesDuplikat.current;
    if (!e || (e.art !== "mal" && e.art !== "teilen")) { setHint(`${tz("Eingabe nicht verstanden")}: „${text}“ — *3 ${tz("oder")} /3`); return false; }
    if (!ld) { setHint(tz("Erst duplizieren (Strg+D), dann *3 oder /3")); return false; }
    if (!ld.list.every((m) => elementVon(m)) || !ld.neu.every((m) => elementVon(m))) {
      letztesDuplikat.current = null;
      setHint(tz("Duplikat oder Original gibt es nicht mehr — erst neu duplizieren (Strg+D)"));
      return false;
    }
    const weg = (/** @type {string} */ typ) => new Set(ld.neu.filter((m) => m.type === typ).map((m) => m.index));
    const W = weg("wall"), C = weg("column"), Z = weg("zone"), S = weg("slab"), R = weg("roof");
    const O = new Set(ld.neu.filter((m) => m.type === "opening" && (m.scope || "custom") === "custom").map((m) => m.index));
    const E = new Set(ld.neu.filter((m) => m.type === "opening" && m.scope === "env").map((m) => m.index));
    // the openings that came along on the copied walls do not block the new row either
    const mitgekommen = new Set(customWindows.filter((x) => W.has(x.wallIdx)).map((x) => x._idx));
    /** @type {Array<{orig: any, kopie: any}>} */
    const paare = [];
    const neu = duplicateItems(ld.list, { anzahl: e.n, modus: e.art, schritt: dupSchritt(ld), paare, ohne: { custom: new Set([...O, ...mitgekommen]), env: E } });
    if (!neu.length) return false; // nothing fitted: the single copy stays, duplicateItems said why
    // the old copies go (with the openings that came along on their walls) — after the row exists, the functional setters run in order
    setCustomWalls((a) => a.filter((x) => !W.has(x._idx)));
    setCustomColumns((a) => a.filter((x) => !C.has(x._idx)));
    setCustomZones((a) => a.filter((x) => !Z.has(x._idx)));
    setCustomSlabs((a) => a.filter((x) => !S.has(x._idx)));
    setCustomRoofs((a) => a.filter((x) => !R.has(x._idx)));
    setCustomWindows((a) => a.filter((x) => !O.has(x._idx) && !W.has(x.wallIdx)));
    setEnvOpenings((a) => a.filter((x) => !E.has(x._idx)));
    letztesDuplikat.current = { list: ld.list, neu, paare, faktor0: reihenFaktoren(e.n, e.art)[0] };
    return true;
  };
  const dupRef = useRef(/** @type {{reihe: (t: string) => boolean, duplizieren: (reihe?: string) => boolean}} */ ({ reihe: () => false, duplizieren: () => false }));
  dupRef.current = { reihe: duplikatReihe, duplizieren: duplicateSelection };
  // Duplizieren aus dem 3D-Kontextmenü
  const ctxDuplicate = () => {
    const h = ctxMenu?.hit;
    const type = h ? { wall: "wall", column: "column", zone: "zone", cslab: "slab", croof: "roof", window: "opening", door: "opening" }[h.kind] : null;
    if (type && h.id != null) duplicateItems([{ type, index: h.id, scope: h.scope || "custom" }]);
    setCtxMenu(null);
  };

  // ---- BIM-A: Nudge — Auswahl per Pfeiltasten verschieben (0,1 m; Shift = 1 m) ----
  const nudgeSelection = (dx, dz) => {
    const list = currentSelection(); if (!list.length) return false;
    const rnd = (v) => Math.round(v * 1000) / 1000; // FP-Drift bei 0,1er-Schritten vermeiden
    const ids = (t) => new Set(list.filter((m) => m.type === t).map((m) => m.index));
    let moved = false;
    const w = ids("wall"); if (w.size) { moved = true; setCustomWalls((a) => a.map((x) => w.has(x._idx) ? { ...x, a: { x: rnd(x.a.x + dx), z: rnd(x.a.z + dz) }, b: { x: rnd(x.b.x + dx), z: rnd(x.b.z + dz) } } : x)); }
    const c = ids("column"); if (c.size) { moved = true; setCustomColumns((a) => a.map((x) => c.has(x._idx) ? { ...x, x: rnd(x.x + dx), z: rnd(x.z + dz) } : x)); }
    // 107-04: the holes of a slab (`oeffnungen`) move with it
    const movePts = (setter, set) => setter((a) => a.map((x) => set.has(x._idx) ? { ...x, points: x.points.map((p) => ({ x: rnd(p.x + dx), z: rnd(p.z + dz) })), ...(Array.isArray(x.oeffnungen) ? { oeffnungen: x.oeffnungen.map((l) => ({ ...l, points: (l.points || []).map((p) => ({ x: rnd(p.x + dx), z: rnd(p.z + dz) })) })) } : {}) } : x));
    const z = ids("zone"); if (z.size) { moved = true; movePts(setCustomZones, z); }
    const s = ids("slab"); if (s.size) { moved = true; movePts(setCustomSlabs, s); }
    const r = ids("roof"); if (r.size) { moved = true; movePts(setCustomRoofs, r); }
    return moved;
  };

  // ---- BIM-C: BBox der Auswahl (Meter, inkl. Höhen für das 3D-Target) ----
  const selectionBBox = (liste) => {
    const list = Array.isArray(liste) ? liste : currentSelection(); if (!list.length) return null; // onClick passes an event: only a real list counts
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    const add = (x, z, y0 = 0, y1 = 0) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
    };
    list.forEach((m) => {
      if (m.type === "wall") {
        const w = customWalls.find((x) => x._idx === m.index); if (!w) return;
        const y0 = unterkante(w, gs), h = wandHoehe(w, gs);
        add(w.a.x, w.a.z, y0, y0 + h); add(w.b.x, w.b.z, y0, y0 + h);
      } else if (m.type === "column") {
        const cc = customColumns.find((x) => x._idx === m.index); if (!cc) return;
        const y0 = unterkante(cc, gs), h = (cc.size || 0.4) / 2, hs = stuetzenHoehe(cc, gs);
        add(cc.x - h, cc.z - h, y0, y0 + hs); add(cc.x + h, cc.z + h, y0, y0 + hs);
      } else if (m.type === "hullwall") {
        // 106-02: a generated hull wall is addressable by GUID, so the view can frame it too
        const w = model.walls.find((x) => x.level === m.level && x.edge === m.edge); if (!w) return;
        const y0 = w.elevation ?? elevationOf(w.level || 0, gs);
        add(w.a.x, w.a.z, y0, y0 + (w.height || geschosshoehe(w.level || 0, gs))); add(w.b.x, w.b.z, y0, y0 + (w.height || geschosshoehe(w.level || 0, gs)));
      } else if (m.type === "opening") {
        const scope = m.scope || "custom";
        const o = (scope === "env" ? envOpenings : customWindows).find((x) => x._idx === m.index); if (!o) return;
        const w = scope === "env" ? model.walls.find((x) => x.level === o.level && x.edge === o.edge) : customWalls.find((x) => x._idx === o.wallIdx);
        if (!w) return;
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const y0 = elevationOf(w.level || 0, gs);
        add(w.a.x + ((w.b.x - w.a.x) / len) * o.u, w.a.z + ((w.b.z - w.a.z) / len) * o.u, y0, y0 + geschosshoehe(w.level || 0, gs));
      } else {
        const arr = m.type === "zone" ? customZones : m.type === "slab" ? customSlabs : customRoofs;
        const o = arr.find((x) => x._idx === m.index); if (!o?.points) return;
        const y0 = elevationOf(o.level || 0, gs);
        const y1 = m.type === "roof" ? elevationOf((o.level || 0) + 1, gs) + dachFirsthoehe_m(o) : y0 + geschosshoehe(o.level || 0, gs);
        o.points.forEach((p) => add(p.x, p.z, y0, y1));
      }
    });
    return isFinite(minX) ? { minX, maxX, minZ, maxZ, minY, maxY } : null;
  };
  // ---- BIM-C: Zoom auf Auswahl (F) — 2D via Fokus-Prop, 3D via Orbit-Target ----
  const zoomToSelection = (liste) => {
    const bbSel = selectionBBox(liste);
    if (!bbSel) { resetViewAll(); return; }
    if (view === "3d") {
      const t = three.current; if (!t.target) return;
      t.target.set((bbSel.minX + bbSel.maxX) / 2, (bbSel.minY + bbSel.maxY) / 2, (bbSel.minZ + bbSel.maxZ) / 2);
      const span = Math.max(bbSel.maxX - bbSel.minX, bbSel.maxZ - bbSel.minZ, bbSel.maxY - bbSel.minY, 4);
      orbit.current.radius = Math.max(20, Math.min(220, span * 2.5));
      orbit.current.touched = true;
    } else {
      setFocus2d({ bbox: { minX: bbSel.minX, maxX: bbSel.maxX, minZ: bbSel.minZ, maxZ: bbSel.maxZ }, nonce: Date.now() });
    }
  };
  // Ansicht zurücksetzen: 3D-Kamera aufs Gesamtmodell, 2D-Zoom/Pan auf 100 %
  const resetViewAll = () => {
    if (view === "3d") {
      const t = three.current; if (!t.target) return;
      const b = modelBBox(model);
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, b.height);
      t.target.set((b.minX + b.maxX) / 2, b.height / 2, (b.minZ + b.maxZ) / 2);
      orbit.current.radius = Math.max(35, span * 2.2);
    } else {
      setFocus2d({ reset: true, nonce: Date.now() });
    }
  };

  // ---- BIM-F: Exposé-Render (PNG 2×, Muster Phase 22 — synchron rendern → toDataURL → zurücksetzen) ----
  const exportExpose = () => { exportExposePng(three.current); setHint("Exposé-PNG (2×) heruntergeladen."); };

  // ---- BIM-F: Favoriten — {tool, composite, typeId} in localStorage nc-bim-favs (max 6, FIFO) ----
  // Ohne Argument: aktuelles Werkzeug (+ Aufbau/Typ); mit spec: vom Attribute-Panel (Stern) abgeleitet.
  const addFavorite = (spec) => {
    const t = spec?.tool || tool;
    if (!TOOL_NAMES[t]) { setHint("Erst ein Zeichen-Werkzeug wählen (z. B. Wand), dann ★ Favorit speichern."); return; }
    const composite = t === "wall" ? (spec ? (spec.composite || null) : wallComp) : null;
    const typeId = (t === "window" || t === "door") ? (spec ? (spec.typeId || null) : (t === "window" ? winType : doorType)) : null;
    const detail = composite ? (compositeById(composite)?.name || "")
      : typeId ? (openingTypeById(t, typeId)?.name || "") : "";
    const label = detail ? `${TOOL_NAMES[t]} · ${detail}` : TOOL_NAMES[t];
    setFavs((fs) => {
      const next = fs.filter((f) => !(f.tool === t && f.composite === composite && f.typeId === typeId));
      next.push({ tool: t, composite, typeId, label });
      while (next.length > 6) next.shift(); // max 6, ältester fliegt (FIFO)
      return next;
    });
    setHint(`Favorit gespeichert: ${label}`);
  };
  const applyFavorite = (f) => {
    selectTool(f.tool);
    if (f.tool === "wall" && f.composite) setWallComp(f.composite);
    if (f.tool === "window" && f.typeId) setWinType(f.typeId);
    if (f.tool === "door" && f.typeId) setDoorType(f.typeId);
    setHint(`Favorit aktiv: ${f.label}`);
  };

  // ---- BIM-E: Ziel der Attribute-Anzeige (Einzelauswahl bzw. letztes Element der Mehrfachauswahl) ----
  const attrSel = selected && CUSTOM_TYPES.includes(selected.type) ? selected : (multiSel.length ? multiSel[multiSel.length - 1] : null);
  // ---- BIM-B: Auswahl-Zähler für das „N ausgewählt"-Badge in der Statuszeile ----
  const selCount = multiSel.length || (selected && CUSTOM_TYPES.includes(selected.type) ? 1 : 0);

  /**
   * 107-08: pins the GlobalIds of the element lists (guidsAnheften, the export source names) and stores the lists that changed.
   * @param {((type: string, el: any) => boolean)|null} [nur] only these elements (default: all; the IFC export pins all)
   * @returns {{customWalls: any[], customColumns: any[], customZones: any[], customSlabs: any[], customRoofs: any[], customStairs: any[], gauben: any[]}} the pinned lists
   */
  const alleGuidsAnheften = (nur = null) => {
    const pid = projectId || null;
    const f = (/** @type {string} */ typ) => (nur ? (/** @type {any} */ el) => nur(typ, el) : null);
    const r = {
      customWalls: guidsAnheften(customWalls, pid, "customWalls", f("wall")), customColumns: guidsAnheften(customColumns, pid, "customColumns", f("column")),
      customZones: guidsAnheften(customZones, pid, "customZones", f("zone")), customSlabs: guidsAnheften(customSlabs, pid, "customSlabs", f("slab")),
      customRoofs: guidsAnheften(customRoofs, pid, "customRoofs", f("roof")),
      customStairs: guidsAnheften(customStairs, pid, "customStairs", f("stair")), gauben: guidsAnheften(gauben, pid, "gauben", f("gaube")), // 108-06 / 108-13
    };
    if (r.customWalls !== customWalls) setCustomWalls(r.customWalls);
    if (r.customColumns !== customColumns) setCustomColumns(r.customColumns);
    if (r.customZones !== customZones) setCustomZones(r.customZones);
    if (r.customSlabs !== customSlabs) setCustomSlabs(r.customSlabs);
    if (r.customRoofs !== customRoofs) setCustomRoofs(r.customRoofs);
    if (r.customStairs !== customStairs) setCustomStairs(r.customStairs);
    if (r.gauben !== gauben) setGauben(r.gauben);
    return r;
  };
  // 107-08 review: selecting an element no longer pins its GUID (that turned a mere look into a save and a sync event on other
  // devices); the data sheet shows the derived GUID, the next real save (see the save effect) or the IFC export pins it.

  // IFC-Export: gemeinsames Modell + gezeichnete Elemente -> .ifc herunterladen.
  // autoOpenings (Auto-Fenster + Eingangstür) gehen mit — 3D, Grundriss und IFC
  // zeigen dieselben Öffnungen (KD-16).
  const downloadIFC = async () => {
    const meldungen = [];
    // 107-09: with the switch the walls with a build-up go out as their cleaned bands (extruded, D-BK-08b); the module is loaded if needed
    let vIfc = null;
    /** @type {Map<number, {kerne: boolean, waende: string[]}>|null} */
    let vDecken = null;
    if (verschneidung) {
      try {
        const vm = vModul || await import("@core/lib/bauteil/solidAbleitung.js");
        vIfc = vBaender || vm.modellBaender(vm.verschneidungsWaende(model, customWalls, { geschosse: gs }), { geschosse: gs });
        // review 107-09: the IFC note names only slabs that are really cut (wall cores) or that cut walls (lower priority)
        vDecken = vm.deckenKuerzungen(vm.mitDeckenAbzuegen([...vIfc.jeSchluessel.values()].flat(), customSlabs, { geschosse: gs }), customSlabs, { geschosse: gs });
      } catch (e) { setHint(tz("Verschneidung nicht verfügbar: {{text}}").replace("{{text}}", String(/** @type {any} */ (e)?.message || e))); return; }
    }
    // 107-08 (lazy GUID): the first export pins the GlobalIds of walls, columns, slabs, roofs and rooms onto the elements (the same
    // derived values, so this file is unchanged); from then on they survive a project copy. Openings keep the derived ones.
    const gepinnt = /** @type {{customWalls: any[], customColumns: any[], customZones: any[], customSlabs: any[], customRoofs: any[], customStairs: any[], gauben: any[]}} */ (projectId ? alleGuidsAnheften() : { customWalls, customColumns, customZones, customSlabs, customRoofs, customStairs, gauben });
    const ifc = exportIFC(model, {
      customWalls: gepinnt.customWalls, customColumns: gepinnt.customColumns, customWindows, envOpenings, autoOpenings,
      customZones: gepinnt.customZones, customSlabs: gepinnt.customSlabs, customRoofs: gepinnt.customRoofs.map(dachMigrieren), storeyHeight, geschosse, // 107-02: a roof with only `pitch` is read as ridge rise in m, whatever path created it
      customStairs: gepinnt.customStairs, gauben: gepinnt.gauben, // 108-06: IfcStair + derived slab openings; 108-13: dormers on the global roof (need dachGlobal)
      netz: netzLayer, // Phase 41 (NETZ-05): Leitungen als Segment-Elemente
      // 97-02a: every element with its data sheet (stable GUID, Pset_BIT_Bauteil, material, DIN 276); beams from statik_layer.
      // 107-03: schichtdetails = layer Category/Priority, LayerSetUsage, material psets
      steckbrief: { projektId: projectId || null, schichtdetails: true }, tragwerk: statikLayer, bauteilAttribute: attributLayer,
      massing: massingLayer, // 98-05: Massing-Studio bodies (proxies) and groups (assemblies)
      durchbrueche, // 107-04: penetrations of the openings planning (provision proxies / voids in the host wall)
      // 89-03: workshop walls/doors/rooms with stable GUIDs and Pset_BIT_Bauteil (store zones).
      werkstatt: werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }),
      projectName: project?.name || "BIT-Atelier",
      verschneidung: vIfc ? { jeSchluessel: vIfc.jeSchluessel, decken: vDecken } : null,
      // 107-10: the global roof form as inclined plates (until 107-10 missing from the file) and the walls cut under a roof (analytic profile)
      // review 107-10: only with the switch "Gebäudedach ins IFC" (field dachform_ifc) — an existing project with a pitched global form
      // exports byte-identical until the user switches it on (the hint below names the missing roof)
      dachGlobal: dachIfc && dachform && dachform !== "flach" ? { form: dachform, neigung_grad: dachneigung } : null,
      seo: seoAktiv ? { waende: seoExportWaende() } : null,
      raumGrenzen: raumGrenzenIfc, // 107-11: IfcRelSpaceBoundary + Qto_SpaceBaseQuantities only on request (else byte-identical)
      onWarn: (msg, art, daten) => meldungen.push({ msg, art, daten }),
    });
    // Nicht exportierbare Öffnungen offen benennen statt still zu schlucken.
    // 107-02: the export also warns about elements on a storey the model does not have; those are no missing openings, so they are
    // named separately. The kind comes from the structured `art` of onWarn (not from the wording) and the text is built here through tz().
    const geschossHinweise = meldungen.filter((m) => m.art === WARNART_GESCHOSS)
      .map((m) => tz("Element auf Geschoss {{level}}: das Modell hat dieses Geschoss nicht — im {{ziel}} abgelegt.").replace("{{level}}", String(m.daten?.level)).replace("{{ziel}}", String(m.daten?.ziel)));
    const durchbruchHinweise = meldungen.filter((m) => m.art === WARNART_DURCHBRUCH).map((m) => m.msg);
    // 107-05: a Massing body with an invalid profile is left out — named on its own, not counted as a missing opening
    // 107-06: an opening of a body that no longer fits is left out while the body itself is written (`daten.oeffnung` = its index)
    const massingHinweise = meldungen.filter((m) => m.art === WARNART_MASSING)
      // 107-08: a typed body whose class the export cannot write as such stays a proxy (it IS exported) — its own text
      .map((m) => (m.daten?.grund === "typ" ? tz("Massing-Körper {{name}}: Bauteiltyp „{{grund}}“ im IFC als Proxy exportiert") : m.daten?.oeffnung != null
        ? tz("Öffnung {{n}} in Massing-Körper {{name}} nicht exportiert: {{grund}}").replace("{{n}}", String(m.daten.oeffnung + 1))
        : tz("Massing-Körper {{name}} nicht exportiert: {{grund}}")).replace("{{name}}", String(m.daten?.name)).replace("{{grund}}", tz(String(m.daten?.text || ""))));
    // 107-09: a slab shortened by the wall cores, or walls shortened by a slab, only in 3D and in the quantities (bewusste Grenze D-BK-08b);
    // review 107-09: a wall whose bands keep no area is written as its rectangle, named as well
    const verschneidungHinweise = meldungen.filter((m) => m.art === WARNART_VERSCHNEIDUNG).map((m) => (m.daten?.leer
      ? tz("Wand {{wand}}: nach der Verschneidung ohne Fläche, im IFC als ganzer Wandkörper").replace("{{wand}}", vWandName(String(m.daten?.schluessel)))
      : (m.daten?.waende ? tz("Decke {{nr}}: kürzt Wände niedrigerer Priorität nur im 3D und in den Mengen, im IFC ungekürzt") : tz("Decke {{nr}}: Kürzung an den Wandkernen nur im 3D und in den Mengen, im IFC ungekürzt")).replace("{{nr}}", String(m.daten?.nr))));
    // 107-10: roof forms the library does not compute and what only the solid shows (wall bevel across the thickness, terrain subtraction)
    // review 107-10: the text is built here through tz() from the structured data (as for the intersection above), never the raw German
    // message of the export, and a wall is named by vWandName instead of its internal key
    const dachSeoHinweise = meldungen.filter((m) => m.art === WARNART_DACH || m.art === WARNART_SEO).map((m) => {
      const d = m.daten || {};
      if (m.art === WARNART_SEO) {
        if (d.art === "gelaende") return tz("Untergeschoss: der Geländeabzug (Baugrube, Gelände nach dem Aushub) steht nur im Massing-Studio (3D und Mengen), nicht im IFC");
        const wand = vWandName(String(d.schluessel));
        if (d.grund === "verschnitten") return tz("Wand {{wand}}: verschnitten und gegen ein Dach abgeschrägt — die Abschrägung steht nur im 3D und in den Mengen").replace("{{wand}}", wand);
        if (d.grund === "mehrere") return tz("Wand {{wand}}: gegen mehrere Dächer abgeschrägt — im IFC als ganzer Wandkörper, die Abschrägung steht nur im 3D").replace("{{wand}}", wand);
        return tz("Wand {{wand}}: der geneigte Abschluss quer zur Dicke steht nur im 3D und in den Mengen — im IFC bis zur niedrigsten Höhe").replace("{{wand}}", wand);
      }
      const form = tz(DACHFORM_NAME[String(d.form)] || String(d.form ?? ""));
      if (d.global) return tz("Gebäudedach: Dachform „{{form}}“ wird nicht berechnet (nur ebene Dachflächen) — nicht exportiert").replace("{{form}}", form);
      if (d.id != null) return tz("Massing-Körper {{name}}: Dachform „{{form}}“ wird nicht berechnet (nur ebene Dachflächen) — nicht exportiert").replace("{{name}}", String(d.name ?? d.id)).replace("{{form}}", form);
      return tz("Dach {{nr}}: Dachform „{{form}}“ wird nicht berechnet (nur ebene Dachflächen) — im IFC als flache Platte").replace("{{nr}}", String(d.nr ?? "")).replace("{{form}}", form);
    });
    // review 107-10: a pitched global roof form without the switch is named (it is not in the file)
    if (!dachIfc && dachform && dachform !== "flach") dachSeoHinweise.push(tz("Gebäudedach ({{form}}) nicht im IFC — dafür am Dach „ins IFC“ einschalten").replace("{{form}}", tz(DACHFORM_NAME[dachform] || dachform)));
    const oeffnungen = meldungen.filter((m) => m.art !== WARNART_GESCHOSS && m.art !== WARNART_DURCHBRUCH && m.art !== WARNART_MASSING && m.art !== WARNART_VERSCHNEIDUNG && m.art !== WARNART_DACH && m.art !== WARNART_SEO).map((m) => m.msg);
    setHint([
      oeffnungen.length ? `IFC exportiert — ${oeffnungen.length} Öffnung(en) NICHT enthalten: ${oeffnungen[0]}${oeffnungen.length > 1 ? " …" : ""}` : "",
      geschossHinweise.length ? `${geschossHinweise[0]}${geschossHinweise.length > 1 ? " …" : ""}` : "",
      durchbruchHinweise.length ? `${durchbruchHinweise[0]}${durchbruchHinweise.length > 1 ? " …" : ""}` : "",
      massingHinweise.length ? `${massingHinweise[0]}${massingHinweise.length > 1 ? " …" : ""}` : "",
      verschneidungHinweise.length ? `${verschneidungHinweise[0]}${verschneidungHinweise.length > 1 ? " …" : ""}` : "",
      dachSeoHinweise.length ? `${dachSeoHinweise[0]}${dachSeoHinweise.length > 1 ? " …" : ""}` : "",
    ].filter(Boolean).join(" · "));
    const blob = new Blob([ifc], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(project?.name || "modell").replace(/[^\w-]+/g, "_")}.ifc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- Ausschnitt-Mappe (gespeicherte Ansichten) ----
  // 107-12: the view state of the studio right now (the six parameters, normalised like a stored view)
  // review 107-12: an own combination ("Eigene") carries its visible layers — a named one is a fixed set
  const ebenenSichtbarJetzt = combo === EIGENE_KOMBINATION ? layers.filter((l) => l.visible).map((l) => l.id).sort().join(",") : "";
  const zustandJetzt = useMemo(() => ausschnittNormalisieren({ type: view, level: planLevel, scale, combo,
    ebenen_sichtbar: ebenenSichtbarJetzt ? ebenenSichtbarJetzt.split(",") : combo === EIGENE_KOMBINATION ? [] : null, cutHeight, brille: brilleId, sw: swPlan,
    strukturdarstellung, optionen: ansichtOptionen, regeln: ansichtRegeln }),
  [view, planLevel, scale, combo, ebenenSichtbarJetzt, cutHeight, brilleId, swPlan, strukturdarstellung, ansichtOptionen, ansichtRegeln]);
  // the applied saved view while the state still equals it — PDF and DXF are then built from THIS stored object
  const aktiverAusschnitt = views.find((v) => v.id === aktiverAusschnittId && ausschnittGleich(v, zustandJetzt)) || null;
  /**
   * The view parameters a plan is drawn with: the saved view while it is applied, the state when it differs from the defaults, else null
   * (no saved view and nothing set = the plan, PDF and DXF exactly as before 107-12).
   * @param {any} aus normalised view @param {boolean} gespeichert it is a stored view
   */
  const ansichtVon = (aus, gespeichert) => (gespeichert || aus.strukturdarstellung !== "gesamt" || aus.optionen || aus.regeln
    ? { strukturdarstellung: aus.strukturdarstellung, optionen: aus.optionen, regeln: aus.regeln } : null);
  /**
   * Review 107-12: the special rule of truth 8 said out loud — without a saved view and with every view parameter on its default the
   * sheet stays byte-identical to before 107-12, i.e. without the opening symbols a saved view prints. Options equal to their
   * default are kept as null (optionenOhneStandard), so switching a box on and off again does not change that.
   */
  const ohneAusschnittHinweis = () => tz("Ohne gespeicherten Ausschnitt: Blatt wie bisher, ohne Öffnungssymbole.");
  const ansichtAktiv = ansichtVon(aktiverAusschnitt || zustandJetzt, !!aktiverAusschnitt);
  const applyView = (v) => {
    const a = ausschnittNormalisieren(v);
    // a section / 3D view does not move the plan storey (ausschnittGleich ignores its level, review 107-12)
    setView(a.type); if (a.type === "grundriss") setPlanLevel(a.level);
    setScale(a.scale);
    if (LAYER_COMBOS[a.combo]) applyCombo(a.combo, false);
    else if (a.combo === EIGENE_KOMBINATION && a.ebenen_sichtbar) {
      // review 107-12: an own combination brings back its stored layers (not written into ansicht_layer.ebenen, like a named one)
      const an = new Set(a.ebenen_sichtbar);
      setLayers(layersRef.current.map((l) => ({ ...l, visible: an.has(l.id) })));
      setCombo(EIGENE_KOMBINATION);
    }
    setCutHeight(a.cutHeight);
    setAusgabeWunsch(null); // a pending export of another view is replaced (the PDF button sets its own wish after this call)
    // the lens of the view; localStorage keeps it only as the last used value (97-03)
    setBrillen((alt) => {
      const neu = { ...alt, [a.type]: a.brille, sw: a.sw };
      try { window.localStorage.setItem("bit.brillen", JSON.stringify(neu)); } catch { /* storage blocked: keep in memory */ }
      return neu;
    });
    setStrukturdarstellung(a.strukturdarstellung); setAnsichtOptionen(a.optionen); setAnsichtRegeln(a.regeln);
    setAktiverAusschnittId(a.id || null);
    setSelected(null);
  };
  const saveView = () => {
    // review 107-12: the normaliser keeps at most MAX_AUSSCHNITTE — a further view would vanish without a word, so refuse it here
    if (views.length >= MAX_AUSSCHNITTE) { setHint(tz("Höchstens {{n}} Ausschnitte – bitte einen löschen.").replace("{{n}}", String(MAX_AUSSCHNITTE))); return; }
    const lvlName = ebeneName(model, ebeneKlemmen(model, planLevel)); // 107-13: by level, basements are appended to the list
    const typeName = view === "schnitt" ? "Schnitt" : view === "3d" ? "3D" : `Grundriss ${lvlName}`;
    const name = ausschnittName.trim() || `${typeName} · 1:${scale}`;
    // 106-11 (reused, no second helper): the note "enthält ungeprüfte KI-Änderungen" as it stands when the view is saved — a field without logic
    const v = ausschnittNormalisieren({ ...zustandJetzt, id: naechsteAusschnittId(views), name, ki_vermerk: kiStand ? vermerkNoetig(kiStand) : null });
    merken();
    eigeneAusschnittIdsRef.current.add(v.id); // undo / redo moves only views of local steps (ausschnitteWiederherstellen)
    setAnsichtLayer((alt) => ({ ...(alt || {}), ausschnitte: [...ansichtLayerNormalisieren(alt).ausschnitte, v] }));
    setAktiverAusschnittId(v.id);
    setAusschnittName("");
  };
  const deleteView = (id) => {
    merken();
    eigeneAusschnittIdsRef.current.add(id);
    setAnsichtLayer((alt) => ({ ...(alt || {}), ausschnitte: ansichtLayerNormalisieren(alt).ausschnitte.filter((v) => v.id !== id) }));
    if (aktiverAusschnittId === id) setAktiverAusschnittId(null);
  };

  // ---- 106-11: model state of the plans (unreleased AI changes stand on the sheet and in the plan view) ----
  // Read from the STORED model (shared loadBimModel cache) and the change log; reloaded on project switch, after every save,
  // after a confirmed / reversed step, and when the window gets the focus back (a release in the review workplace of another tab).
  const [kiStand, setKiStand] = useState(/** @type {import("@core/lib/zeigen/planStand.js").ModellStand|null} */ (null));
  const kiProjektRef = useRef(/** @type {string|null} */ (null));
  kiProjektRef.current = projectId || null;
  // review 106-11: loads run concurrently (save, focus, confirmed step) - only the newest answer of the current project is shown,
  // and the previous project's note goes away at once on a switch (null = loading: the note shows nothing until the answer)
  const kiAnfrageRef = useRef(0);
  useEffect(() => { setKiStand(null); }, [projectId]);
  const kiStandLaden = useCallback(async () => {
    const nr = ++kiAnfrageRef.current;
    if (!projectId) { setKiStand(null); return null; }
    const st = await aktuellenModellStandLaden(projectId, { modell: () => loadBimModel(projectId) });
    if (kiProjektRef.current === projectId && nr === kiAnfrageRef.current) setKiStand(st);
    return st;
  }, [projectId]);
  const gespeichert = saveState === "saved" || saveState === "idle";
  useEffect(() => { if (gespeichert) kiStandLaden(); }, [kiStandLaden, gespeichert]);
  useEffect(() => {
    const neu = () => { if (document.visibilityState !== "hidden") kiStandLaden(); };
    window.addEventListener("focus", neu);
    document.addEventListener("visibilitychange", neu);
    return () => { window.removeEventListener("focus", neu); document.removeEventListener("visibilitychange", neu); };
  }, [kiStandLaden]);
  /**
   * The state a sheet is printed with: fresh from storage. The sheet draws the studio's LIVE state, the state comes from the
   * STORED record - they must match, else the plan list would call the sheet "aktuell" for content that was never stored:
   *  - element save running -> refused with a sentence (print again in a moment),
   *  - element save failed, the program fields' save failed (syncFehler), the program store holds another project, a conflict
   *    holds back a drawn field (106-09), or a drawn program/layer field differs from the stored record (a debounced write of
   *    useBimModelSync / useFachlayer still pending or lost) -> "nicht ermittelt" with the reason: the sheet carries the note.
   * @returns {Promise<{st: import("@core/lib/zeigen/planStand.js").ModellStand}|null>}  null = refused (hint set).
   */
  const ausgabeStand = async () => {
    if (saveState === "saving" || saveState === "loading") { setHint(tz("Modell wird gerade gespeichert — Plan gleich noch einmal ausgeben.")); return null; }
    if (saveState === "error") return { st: modellStandUnbekannt("Modell nicht gespeichert") };
    if (!projectId) return { st: modellStandUnbekannt("kein Projekt") };
    const bp = buildingProgram.get();
    if (bp.syncFehler === "speichern") return { st: modellStandUnbekannt("Programmfelder nicht gespeichert") };
    if (!storeGehoertZu(projectId)) return { st: modellStandUnbekannt("Programmfelder nicht geladen") };
    if (abgleichStand.stand().konflikte.some((k) => k.projektId === projectId && KENNUNG_FELDER.includes(k.feld))) {
      return { st: modellStandUnbekannt("Konflikt offen — Modell nicht vollständig gespeichert") };
    }
    const st = (await kiStandLaden()) || modellStandUnbekannt("kein Projekt");
    if (!st.ermittelt) return { st };
    let gespeichert = null;
    try { gespeichert = await loadBimModel(projectId); } catch { return { st: modellStandUnbekannt("Modell nicht gespeichert") }; }
    // the fields the studio draws from but does not save itself (program fields of the hook, attribute and build-up layers)
    const offen = ungespeicherteFelder(gespeichert, {
      footprintM: bp.footprintM, achseM: bp.achseM, storeys: bp.storeys, storeyHeight: bp.storeyHeight, geschosse: bp.geschosse,
      untergeschosse: bp.untergeschosse, // 107-13 review: a basement count still in the debounce draws a section the record does not hold
      bauteil_attribute_layer: attributLayer, aufbauten_layer: aufbautenLayer,
    });
    if (offen.length) return { st: modellStandUnbekannt("Modell nicht vollständig gespeichert", offen.join(", ")) };
    return { st };
  };

  // ---- Plan-Output: aktuellen 2D-Plan als PDF ----
  // One source for the vector PDF (97-09) and the DXF (104-06): the plan primitives of the
  // current storey with the lens applied; 106-11: plus the marks of unreleased AI changes.
  // 107-12: built from a VIEW (the applied saved one or the state), not from loose state: lens, level, scale, S/W, layers and the
  // view parameters come from `aus`.
  const aktuelleGrafik = (/** @type {any} */ aus, /** @type {import("@core/lib/zeigen/planStand.js").ModellStand|null} */ st = null, /** @type {Map<string, any>|null} */ schichtFlaechen = null) => {
    const brille = brilleVon(aus.brille);
    const lvl = ebeneKlemmen(model, aus.level);
    // named combination = its set, "Eigene" = the layers stored with the view (review 107-12); only a state without either reads the switches
    const vis = ebenenSichtbarkeit(aus, DEFAULT_LAYERS, LAYER_COMBOS) || layerVis;
    const grafik = planGrafik({ model, level: lvl, customWalls: sichtbarUnter(brille, customWalls), customColumns: sichtbarUnter(brille, customColumns),
      customSlabs: sichtbarUnter(brille, customSlabs), customRoofs: sichtbarUnter(brille, customRoofs), customZones, brille,
      customStairs, gauben, dach: globalDach, geschosse: gs, // 108-06 / 108-13: stair symbol and dormer outline on the sheet
      // 106-11 review: openings only locate the mark of a changed opening on its drawn host wall (the sheet draws no openings)
      customWindows, envOpenings,
      huelleStatus: zeigtStatus(brille, attributeVon(attributLayer, "hull-wall")?.status) ? attributeVon(attributLayer, "hull-wall")?.status ?? null : null, massstab: aus.scale, sw: aus.sw,
      // Print what the plan shows: the layer switches and the workshop walls (same inputs as BimPlan2D).
      layerVis: zeigtStatus(brille, attributeVon(attributLayer, "hull-wall")?.status) ? vis : { ...vis, shell: false },
      werkstattWaende: attributLayer?.attribute ? sichtbarUnter(brille, werkstattMitAttributen(werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }), attributLayer).waende || []) : null,
      kiMarken: st?.guids?.length ? { guids: st.guids, projektId: projectId || null } : null, schichtFlaechen,
      ansicht: ansichtVon(aus, aus === aktiverAusschnitt),
      eingang: eingangOeffnung }); // 108-01: no entrance symbol when the automatic entrance is off (D-EFH-04)
    return { grafik, brille, lvl, vis };
  };
  /**
   * 107-09: the finished solids for an export — waits for the running derivation (the sheet must not depend on the moment of the
   * export, plan task 3); null when the switch is off. Review 107-09: with the switch on but the module not loaded yet (just switched
   * on, or the import failed) the export is refused with a message instead of silently printing the plan without intersection; a run
   * replaced meanwhile is waited for as well, and only solids of these very bands are used (aktuelleSolids).
   * @returns {Promise<Map<string, any>|null>}
   * @throws {Error} with a German message when the intersection is on but not available
   */
  const vSolidsFertig = async () => {
    if (!verschneidung) return null;
    if (!vBaender || !vBaenderSolid || !vModul) {
      throw new Error(vFehler ? tz("Verschneidung nicht verfügbar: {{text}}").replace("{{text}}", vFehler) : tz("Verschneidung wird noch geladen — Export bitte gleich wiederholen."));
    }
    /** @type {{waende: Map<string, any>, decken: Map<string, any>}|null} */
    let r = null;
    for (let lauf = vLaufRef.current, n = 0; lauf && n < 10; lauf = vLaufRef.current, n += 1) {
      r = await lauf.catch(() => null);
      if (lauf === vLaufRef.current) break;
    }
    return vModul.aktuelleSolids(vBaenderSolid, r?.waende || vSolids?.waende || null);
  };
  // 104-06: the current floor plan as DXF R12 (layers A_WAND, A_STUETZE, A_DECKE …, metres).
  const exportPlanDXF = async () => {
    if (view !== "grundriss") { setHint(tz("DXF nur aus dem Grundriss — bitte Ansicht Grundriss wählen.")); return; }
    if (ausgabeLaeuft) return;
    setAusgabeLaeuft(true);
    try {
      const aus = aktiverAusschnitt || zustandJetzt; // 107-12: the saved view while it is applied
      const a = await ausgabeStand();
      if (!a) return;
      const lvlPlan = ebeneKlemmen(model, aus.level);
      // 107-12: waits for the solids (time limit), then the outlines; a fallback to the bands is written into the drawing
      const abl = await ableitungFuerAusgabe(() => vSolidsFertig(), (vw) => (vBaender ? vPlanFlaechenFuer(lvlPlan, vw) : null));
      const sw = await seoFertig(); // review 107-10: the walls cut under a roof, from their solid (as on the screen)
      const { grafik, lvl } = aktuelleGrafik(aus, a.st, planMitSeo(abl.flaechen, seoPlanFuer(lvlPlan, sw)));
      const geschoss = ebeneName(model, lvl); // 107-13: "1. UG" → file name Grundriss_1_UG (dxfDateiname)
      // 106-11: the model state always goes along (the visible note follows from it, no switch to leave it out)
      const daten = grundrissDxfDaten(grafik, { massstab: aus.scale, geschoss, projekt: project?.name || "", modellstand: a.st, ableitungsVermerk: abl.rueckfall ? RUECKFALL_VERMERK : null });
      if (daten.leer) { setHint(tz("Keine Zeichnung auf diesem Geschoss.")); return; }
      const { bytes, uebersprungen } = dxfDatei(daten);
      dateiAnbieten(bytes, dxfDateiname(project?.name || "", `Grundriss_${geschoss}`), DXF_MIME);
      setHint(tz("Grundriss als DXF erstellt (R12, Meter, Ebenen je Bauteil).") + (uebersprungen ? ` ${uebersprungen} ${tz("Objekt(e) ohne gültige Koordinaten ausgelassen.")}` : "")
        + (daten.vermerk ? ` ${tz("Mit Vermerk „enthält ungeprüfte KI-Änderungen“.")}` : "")
        + (abl.rueckfall ? ` ${tz("Mit Vermerk „Wände aus Bändern abgeleitet“.")}` : "")
        + (!ansichtVon(aus, aus === aktiverAusschnitt) ? ` ${ohneAusschnittHinweis()}` : ""));
    } catch (e) { setHint(`${tz("DXF-Export fehlgeschlagen")}: ${e?.message || e}`); } finally { setAusgabeLaeuft(false); }
  };
  // 97-09 floor plan / 100-01 section: VECTOR at true scale from the model data (lens applied, status
  // colours, ISO 128 line weights, title block with lens and legend; the section with level marks).
  // Before 100-01 the section was a stretched screen image stamped "nicht maßstäblich".
  // 110 follow-up: one builder for both the download and "An Plan ablegen" (null = the state check stopped it, hint already set).
  const planPdfErstellen = async () => {
    const ansicht = aktiverAusschnitt || zustandJetzt; // 107-12: the saved view while it is applied
    const aus = await ausgabeStand();
    if (!aus) return null;
    const lvlPlan = ebeneKlemmen(model, ansicht.level);
    // 107-12: waits for the solids (time limit), then plan and section outlines from the same solids; a fallback is printed on the sheet
    const abl = await ableitungFuerAusgabe(() => vSolidsFertig(), (vw) => ({ plan: vBaender ? vPlanFlaechenFuer(lvlPlan, vw) : null, schnitt: vBaender ? vSchnittFlaechenFuer(vw) : null }),
      { flaechenVon: (f) => (view === "schnitt" ? f.schnitt : f.plan) });
    const sw = await seoFertig(); // review 107-10: the walls cut under a roof, from their solid (plan and section as on the screen)
    const { grafik, brille, lvl, vis } = aktuelleGrafik(ansicht, aus.st, planMitSeo(abl.flaechen.plan, seoPlanFuer(lvlPlan, sw)));
    const huelleStatus = attributeVon(attributLayer, "hull-wall")?.status ?? null;
    const vSchnittExport = abl.flaechen.schnitt;
    const g = view === "schnitt"
      // same layer choice as the screen: a lens that hides the hull hides the shell (BimPlan2D planLayerVis)
      ? schnittGrafik({ model, storeyHeight, layerVis: zeigtStatus(brille, huelleStatus) ? vis : { ...vis, shell: false }, brille,
        huelleStatus: zeigtStatus(brille, huelleStatus) ? huelleStatus : null, sw: ansicht.sw, massstab: ansicht.scale,
        // 108-01: the cut layers exist for A-A only; B-B falls back to the wall rectangles (as on the screen)
        schnittFlaechen: schnittAchse === "x" ? schnittMitSeoFuer(seoSchnittFuer(sw, vSchnittExport), vSchnittExport) : null,
        ansicht: ansichtVon(ansicht, ansicht === aktiverAusschnitt), dach: globalDach, achse: schnittAchse })
      : grafik;
    // 107-13: name by level; 108-01: the section names its axis ("Schnitt A-A" / "Schnitt B-B")
    const planinhalt = view === "schnitt" ? `Schnitt ${schnittAchse === "z" ? "B-B" : "A-A"}` : `Grundriss ${ebeneName(model, lvl)}`.trim();
    const scale = ansicht.scale;
    // 106-11: model state in the title block and the keywords; the note follows from it (no switch to leave it out)
    const { bytes, format, vermerk } = await vektorPlanPdf(g, { massstab: scale, projekt: project?.name || "", planinhalt, brille, datum: new Date().toLocaleDateString("de-DE"), modellstand: aus.st,
      ableitungsVermerk: abl.rueckfall ? RUECKFALL_VERMERK : null });
    // Rule 7 (concept §5): the lens has its own scale — say so when the sheet differs.
    const zusatz = (vermerk ? ` ${tz("Mit Vermerk „enthält ungeprüfte KI-Änderungen“.")}` : "")
      + (abl.rueckfall ? ` ${tz("Mit Vermerk „Wände aus Bändern abgeleitet“.")}` : "")
      + (view === "grundriss" && !ansichtVon(ansicht, ansicht === aktiverAusschnitt) ? ` ${ohneAusschnittHinweis()}` : "");
    const brilleHinweis = brille.massstab !== scale ? ` — Hinweis: die Brille „${brille.label}“ ist für 1:${brille.massstab} gedacht.` : "";
    return { bytes, format, planinhalt, scale, zusatz, brilleHinweis };
  };
  const exportPlanPDF = async () => {
    if (view === "3d") { setHint("PDF-Plan nur aus Grundriss/Schnitt — bitte 2D-Ansicht wählen."); return; }
    if (ausgabeLaeuft) return;
    setAusgabeLaeuft(true);
    try {
      const pdf = await planPdfErstellen();
      if (!pdf) return;
      const url = URL.createObjectURL(new Blob([/** @type {any} */ (pdf.bytes)], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = planPdfDateiname(project?.name || "", pdf.planinhalt, pdf.scale);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setHint(`PDF 1:${pdf.scale} (${pdf.format}) erstellt${pdf.brilleHinweis || " — maßstäblich, Vektor."}${pdf.zusatz}`);
    } catch (e) { setHint("PDF-Export fehlgeschlagen: " + (e?.message || e)); } finally { setAusgabeLaeuft(false); }
  };
  // 110 follow-up "An Plan ablegen": the plans of the project for the picker; the sheet is filed exactly like the plan list's
  // "PDF ablegen" (dokumentAblegen with typ "Plan-PDF", then Plan.datei_ref + Plan.modellstand read back from the PDF keywords),
  // so the plan list, the model state column and the client release (BauherrPlan) see no difference.
  const [ablagePlaene, setAblagePlaene] = useState(/** @type {import("../lib/planAblage.js").PlanZeile[]} */ ([]));
  const [ablagePlanId, setAblagePlanId] = useState("");
  const ablagePlaeneLaden = useCallback(async () => {
    if (!projectId) { setAblagePlaene([]); return; }
    try {
      const liste = await bitApi.entities.Plan.filter({ project_id: projectId });
      setAblagePlaene((Array.isArray(liste) ? liste : []).slice().sort((a, b) => planWahlText(a).localeCompare(planWahlText(b), "de", { numeric: true })));
    } catch (e) { setAblagePlaene([]); setHint(`${tz("Pläne konnten nicht geladen werden")}: ${e?.message || e}`); }
  }, [projectId, tz]);
  useEffect(() => { setAblagePlanId(""); ablagePlaeneLaden(); }, [ablagePlaeneLaden]);
  // Default plan: the one whose title matches the current sheet ("Grundriss EG" ↔ "Grundriss Erdgeschoss"); a manual pick stays.
  const ablageVorschlag = useMemo(() => {
    if (view === "3d") return null;
    const inhalt = view === "schnitt" ? `Schnitt ${schnittAchse === "z" ? "B-B" : "A-A"}` : `Grundriss ${ebeneName(model, ebeneKlemmen(model, (aktiverAusschnitt || zustandJetzt).level))}`;
    return passenderPlan(ablagePlaene, inhalt);
  }, [view, schnittAchse, model, aktiverAusschnitt, zustandJetzt, ablagePlaene]);
  const ablageZiel = ablagePlaene.find((p) => p.id === (ablagePlanId || ablageVorschlag?.id)) || null;
  const planPdfAblegen = async () => {
    if (view === "3d") { setHint("PDF-Plan nur aus Grundriss/Schnitt — bitte 2D-Ansicht wählen."); return; }
    if (!ablageZiel) { setHint(tz("Bitte zuerst einen Plan aus der Planliste wählen.")); return; }
    if (ausgabeLaeuft) return;
    setAusgabeLaeuft(true);
    try {
      const pdf = await planPdfErstellen();
      if (!pdf) return;
      const modellstand = await modellstandAusPdf(pdf.bytes);
      const r = await dokumentAblegen({ projectId, name: planPdfDateiname(project?.name || "", pdf.planinhalt, pdf.scale), typ: "Plan-PDF",
        daten: pdfDataUrl(pdf.bytes), notiz: `Plan ${planWahlText(ablageZiel)}` });
      if (!r.ok) throw new Error(r.grund || "Ablage fehlgeschlagen");
      await bitApi.entities.Plan.update(ablageZiel.id, { datei_ref: r.dokument?.id || null, modellstand });
      await ablagePlaeneLaden();
      setHint(tz("PDF 1:{{massstab}} an Plan „{{plan}}“ abgelegt.").replace("{{massstab}}", String(pdf.scale)).replace("{{plan}}", planWahlText(ablageZiel)) + pdf.zusatz);
    } catch (e) { setHint(`${tz("Plandatei konnte nicht abgelegt werden")}: ${e?.message || e}`); } finally { setAusgabeLaeuft(false); }
  };
  // 107-12: "PDF"/"DXF" at a saved view applies it first; the export starts once the studio shows exactly that view (deterministic:
  // the sheet is built from the stored object, never from a half-applied state)
  useEffect(() => {
    if (!ausgabeWunsch) return;
    if (aktiverAusschnitt?.id === ausgabeWunsch.id) {
      setAusgabeWunsch(null);
      if (ausgabeWunsch.art === "dxf") exportPlanDXF(); else exportPlanPDF();
      return;
    }
    // review 107-12: applying a view takes one render; when it is still not the active view two renders later (e.g. an own
    // combination saved without its layers) the wish is dropped with a message — never left pending to fire a download later
    const runden = ausgabeWunsch.runden ?? 0;
    if (runden >= 2) { setAusgabeWunsch(null); setHint(tz("Ausschnitt konnte nicht angewendet werden – keine Ausgabe erstellt.")); return; }
    setAusgabeWunsch({ ...ausgabeWunsch, runden: runden + 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ausgabeWunsch, aktiverAusschnitt]);
  // 107-12: structure display in 3D on the meshes already in the scene (new meshes read strukturRef when they are built)
  useEffect(() => {
    [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.traverse((/** @type {any} */ o) => strukturAufMesh(o, strukturdarstellung)));
  }, [strukturdarstellung]);

  // ---- BIM-D: zentrale Tastaturkürzel — EIN keydown-Handler, gespeist aus der SHORTCUTS-Map ----
  // Läuft ohne Dependency-Array (Listener wird je Render frisch gebunden) → keine veralteten Closures.
  useEffect(() => {
    const onKey = (e) => {
      // Input-Guard: Kürzel feuern nicht, solange ein Eingabefeld fokussiert ist
      if (e.target?.closest?.("input,textarea,select,[contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); duplicateSelection(); return; } // Strg+D duplizieren
      // Strg+Z / Strg+Y (Strg+Shift+Z = redo). Text fields keep the browser's own undo (guard above).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) historieApiRef.current.vor(); else historieApiRef.current.zurueck();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        historieApiRef.current.vor();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // andere Browser-Kürzel nicht kapern
      // 107-07: after a duplicate "*" or "/" starts the typed row, digits follow, Enter applies, Esc drops the input
      if ((letztesDuplikat.current && (e.key === "*" || e.key === "/")) || (dupEingabe && /^[0-9]$/.test(e.key))) {
        e.preventDefault(); const neu = dupEingabe + e.key; setDupEingabe(neu); setHint(`${tz("Reihe")}: ${neu} — Enter`); return;
      }
      if (dupEingabe && e.key === "Enter") { e.preventDefault(); setDupEingabe(""); duplikatReihe(dupEingabe); return; }
      if (dupEingabe && e.key === "Backspace") { e.preventDefault(); setDupEingabe(dupEingabe.slice(0, -1)); return; }
      if (dupEingabe && e.key === "Escape") { e.preventDefault(); setDupEingabe(""); setHint(""); return; }
      if (e.key === "Escape") { letztesDuplikat.current = null; setDraft([]); setHover(null); setSelected(null); setMultiSel([]); setTool("arrow"); setHint(""); ecke3dRef.current = null; }
      else if (e.key === "Delete" || e.key === "Backspace") { if (multiSel.length) { e.preventDefault(); deleteMany(multiSel); } else if (selected) { e.preventDefault(); deleteSelected(); } }
      else if (e.key === "v" || e.key === "V") selectTool("arrow");
      else if (e.key === "w" || e.key === "W") selectTool("wall");
      else if (e.key === "s" || e.key === "S") selectTool("column");
      else if (e.key === "d" || e.key === "D") selectTool("slab");
      else if (e.key === "f" || e.key === "F") zoomToSelection();
      else if (e.key.startsWith("Arrow")) {
        // Pfeiltasten: Auswahl verschieben — 0,1 m, mit Shift 1 m (BIM-A)
        const step = e.shiftKey ? 1 : 0.1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d && nudgeSelection(d[0], d[1])) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 106-01: test and agent hook while the studio is mounted, under window.__bitZeigen.bim (the IFC
  // viewer uses .ifc, so two mounted viewers never overwrite each other): what is under the pointer,
  // the state table (colour AND form), and what is really drawn. Plain data only (no three.js objects).
  // Only the hover state 'fokus' and the selection are drawn here; warnung/fehler are not wired in
  // the studio yet (they are in the IFC viewer, see IfcViewer.jsx zustandSetzen).
  useEffect(() => {
    const w = /** @type {any} */ (window);
    /** Helper objects (hover outlines, selection aura) below the element meshes, as plain data. */
    const hilfsobjekte = () => {
      const out = [];
      [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.traverse((o) => {
        if (o.userData?.zeigeHilfe) out.push({ typ: o.type, material: o.material?.type ?? null, zustand: o.userData.zeigeZustand ?? null, farbe: o.material?.color?.getHex?.() ?? null });
      }));
      return out;
    };
    const api = {
      hover: () => (hoverRef.current ? { ...hoverRef.current, userData: undefined } : null),
      zustaende: () => ZEIGE_ZUSTAENDE,
      /** Active hover highlight layers (one per mesh of the element); `zustand` counts only that state. */
      markiert: (zustand) => (three.current.zeigen?.aktive() ?? []).filter((x) => !zustand || x.zustand === zustand).length,
      formen: () => (three.current.zeigen?.aktive() ?? []).map((x) => ({ zustand: x.zustand, umriss: x.umriss, symbol: x.symbol })),
      hilfsobjekte,
      /** The selection as drawn: aura lines (solid, selection blue) and the emissive tint of tinted meshes. */
      auswahl: () => ({
        aura: (three.current.auraList || []).map((l) => ({ material: l.material.type, farbe: l.material.color.getHex() })),
        emissiv: (() => {
          const out = [];
          [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.traverse((m) => {
            if (m.isMesh && m.material?.emissive && m.material.emissive.getHex() === AUSWAHL_EMISSIV) out.push(m.userData?.kind ?? null);
          }));
          return out;
        })(),
      }),
      /**
       * 106-07: the orbit camera - studio angles theta and polar phi (rad), distance radius (m); review fix: azimutRad = world azimuth of
       * the camera around the target, atan2(x, z) as in the IFC viewer's hook (common reference for the twist direction).
       */
      kamera: () => ({
        theta: orbit.current.theta, phi: orbit.current.phi, radius: orbit.current.radius,
        azimutRad: Math.atan2(Math.cos(orbit.current.theta), Math.sin(orbit.current.theta)),
      }),
      /** 106-07: kind of the last pointer on the canvas and the sum of two-finger steps seen (count, twist rad, pinch factor). */
      zeiger: () => ({ art: zeigerArtRef.current, geste: { ...gestenSummeRef.current } }),
    };
    w.__bitZeigen = { ...(w.__bitZeigen || {}), bim: api };
    return () => { if (w.__bitZeigen?.bim === api) delete w.__bitZeigen.bim; };
  }, []);

  // 106-02: ONE command register for this studio (same pattern as the Massing modeller, 104-03): the
  // selection as context for speech and agents. Built once; the commands read the latest state through
  // `aktuell` (re-assigned every render).
  const aktuell = useRef(/** @type {Record<string, any>} */ ({}));
  // 106-03: synchronous mirror of the drawn elements, like `auswahlRef` for the selection: a confirmed change writes the new
  // model here at once (and into the React state), so the next command in the same tick (auswahl-lesen, a second
  // proposal) already sees it. Every render re-assigns it from the state, which by then holds the same arrays.
  const modellRef = useRef(/** @type {any} */ (null));
  modellRef.current = { customWalls, customColumns, customWindows, envOpenings, customZones, customSlabs, customRoofs, customStairs, gauben,
    bauteil_attribute_layer: attributLayer, netz_layer: netzLayer };
  /** Restore one drawing-undo snapshot. Raw setters: the wrapped ones would record the restore. */
  const historieAnwenden = (/** @type {any} */ s) => {
    historieStillRef.current = true;
    try {
      setCustomWallsRoh(s.customWalls);
      setCustomColumnsRoh(s.customColumns);
      setCustomWindowsRoh(s.customWindows);
      setEnvOpeningsRoh(s.envOpenings);
      setCustomZonesRoh(s.customZones);
      setCustomSlabsRoh(s.customSlabs);
      setCustomRoofsRoh(s.customRoofs);
      if (Array.isArray(s.customStairs)) setCustomStairsRoh(s.customStairs); // 108-06 (older snapshots have none: the stairs stay)
      if (Array.isArray(s.gauben)) setGaubenRoh(s.gauben); // 108-13
      if (s.entranceCfg) setEntranceCfg(s.entranceCfg); // 108-01 review (snapshots from before have none: the entrance stays)
      if ("huelle_erscheinung" in s) setHuelleErscheinungRoh(s.huelle_erscheinung || null);
      bp.set({
        storeys: s.storeys, untergeschosse: s.untergeschosse, footprintM: s.footprintM,
        footprintQuelle: s.footprintQuelle, storeyHeight: s.storeyHeight, geschosse: s.geschosse,
      });
      // 107-12: the saved views of that step (snapshots from before 107-12 have none: the views stay as they are)
      // review 107-12: only views saved / deleted by a local step follow the snapshot; views from another device meanwhile stay
      if (Array.isArray(s.ausschnitte) && eigeneAusschnittIdsRef.current.size) {
        setAnsichtLayer((alt) => {
          const jetzt = ansichtLayerNormalisieren(alt).ausschnitte;
          const neu = ausschnitteWiederherstellen(jetzt, s.ausschnitte, eigeneAusschnittIdsRef.current);
          return JSON.stringify(neu) === JSON.stringify(jetzt) ? alt : { ...(alt || {}), ausschnitte: neu };
        });
      }
      modellStandRef.current = s;
      modellRef.current = {
        ...(modellRef.current || {}),
        customWalls: s.customWalls, customColumns: s.customColumns, customWindows: s.customWindows,
        envOpenings: s.envOpenings, customZones: s.customZones, customSlabs: s.customSlabs, customRoofs: s.customRoofs,
        ...(Array.isArray(s.customStairs) ? { customStairs: s.customStairs } : {}), ...(Array.isArray(s.gauben) ? { gauben: s.gauben } : {}),
      };
    } finally {
      historieStillRef.current = false;
    }
  };
  const historieZurueck = () => {
    const r = schrittZurueck(historieRef.current, modellStandRef.current);
    if (!r) return;
    historieRef.current = r.historie;
    historieAnwenden(r.snapshot);
    setHistorieTick((n) => n + 1);
  };
  const historieVor = () => {
    const r = schrittVor(historieRef.current, modellStandRef.current);
    if (!r) return;
    historieRef.current = r.historie;
    historieAnwenden(r.snapshot);
    setHistorieTick((n) => n + 1);
  };
  historieApiRef.current = { zurueck: historieZurueck, vor: historieVor };
  // 108-08 (finding 12): a programme value another device changed and this page took over (useBimModelSync merges three ways and
  // tells the readers afterwards) goes into every snapshot of the drawing history — undoing a local step must not write the old
  // storey count, basements or storey table back over the other device's change. A field with an open conflict stays as it is.
  useEffect(() => {
    if (!projectId) return undefined;
    return aufBimModelAenderung((pid, patch, meta) => {
      if (!meta?.fremd || pid !== projectId) return;
      const stand = /** @type {Record<string, any>} */ (buildingProgram.get());
      const werte = Object.fromEntries(HISTORIE_PROGRAMM_FELDER.filter((k) => k in patch && !feldGesperrt(pid, k)).map((k) => [k, stand[k] ?? null]));
      const next = historieUmbasieren(historieRef.current, werte);
      if (next !== historieRef.current) historieRef.current = next;
    });
  }, [projectId]);
  // 110-05 (one truth): while the model is released to the client, the client's 3D file is THIS scene. On opening the studio
  // (catches changes saved elsewhere) and after every saved model change, the file is rewritten when it is behind the model —
  // after a pause, so the scene (and the lazy CSG solids) are rebuilt first. Without a release nothing is written.
  useEffect(() => {
    if (!projectId) return undefined;
    let aus = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let uhr;
    const planen = () => {
      clearTimeout(uhr);
      uhr = setTimeout(async () => {
        if (aus) return;
        const t3 = three.current;
        t3.hoverLoeschen?.(); // hover tints live on material clones — the client gets the originals
        try {
          const { bauherrModellNachziehen } = await import("@designer/lib/bauherrModellAbgleich");
          const r = await bauherrModellNachziehen({ projektId: projectId, gruppen: [t3.buildingGroup, t3.customGroup] });
          if (!aus && r === "erneuert") setHint(tz("3D-Ansicht für den Bauherrn aktualisiert."));
        } catch (err) {
          if (!aus) setHint(`${tz("3D-Ansicht für den Bauherrn nicht aktualisiert")}: ${/** @type {any} */ (err)?.message || err}`);
        }
      }, BAUHERR_NACHZIEHEN_MS);
    };
    planen();
    const abmelden = aufBimModelAenderung((pid) => { if (pid === projectId) planen(); });
    return () => { aus = true; clearTimeout(uhr); abmelden(); };
  }, [projectId]);
  /** Everything the element resolvers need, as of this render. */
  const bimDaten = () => ({ ...modellRef.current,
    model, storeyHeight, geschosse, huelleAttribute: attributeVon(attributLayer, "hull-wall"),
    huelleDeckenAttribute: attributeVon(attributLayer, "hull-slab"), huelleBodenAttribute: attributeVon(attributLayer, "hull-floor") });
  /** Selection entries right now (read from the synchronous mirror): the multi selection, else the single one. Generated auto openings have no GUID and are counted as `ohneGuid`. */
  const auswahlEintraege = () => {
    const a = auswahlRef.current;
    return a.multiSel.length ? a.multiSel : a.selected ? [a.selected] : [];
  };
  const bimKontext = (eintraege) => {
    const t3 = three.current;
    const dom = t3.renderer?.domElement;
    return bimAuswahlKontext(eintraege, bimDaten(), { projektId: projectId || null,
      kamera: view === "3d" ? t3.camera : null, breite: dom?.clientWidth, hoehe: dom?.clientHeight }); // pixels only mean something in the 3D view
  };
  aktuell.current = {
    kontext: () => bimKontext(auswahlEintraege()),
    waehleGuid: (/** @type {string} */ guid) => {
      const treffer = bimPerGuid(guid, bimDaten(), { projektId: projectId || null });
      if (!treffer) return null;
      // what a mouse pick cannot select, a command does not select either: refused with the reason, not guessed
      if (!treffer.bauteil.waehlbar) throw new Error(`Bauteil nicht wählbar: ${guid} (${treffer.bauteil.klasse} ohne Auswahl im BIM-Studio, nur lesbar über „modell“)`);
      const ebene = EBENE_VON_TYP[treffer.sel.type] || "walls";
      if (layerLocked[ebene]) throw new Error("Ebene gesperrt — Auswahl nicht möglich.");
      if (layerVis[ebene] === false) throw new Error("Ebene ausgeblendet — Auswahl nicht möglich.");
      setCtxMenu(null);
      setMultiSel([]); setSelected(treffer.sel); // the same state a click sets
      return bimKontext([treffer.sel]); // from the element itself: the React state lands one render later
    },
    aufheben: () => { setSelected(null); setMultiSel([]); setHint(""); },
    ansichtAufAuswahl: () => zoomToSelection(auswahlEintraege().filter((e) => bimBauteil(e, bimDaten(), { projektId: projectId || null }))),
    modell: (/** @type {{klasse?: string}} */ opt) => bimModellUebersicht(bimDaten(), { projektId: projectId || null }, opt),
    // 106-04: one PNG of the 3D view (the canvas is hidden in plan and section: refused with the reason, not drawn blank)
    ansichtBild: (/** @type {{breite?: any}} */ opt) => {
      if (view !== "3d") throw new Error(`Ein Bild gibt es nur in der 3D-Ansicht — erst auf 3D wechseln (jetzt: ${view})`);
      return ansichtAlsPng(three.current, opt);
    },
    // 106-06: the open project for the image rules (an NDA project never sends an image; the id lets the MCP server check the consent)
    projekt: () => ({ id: project?.id ?? null, nda: project?.nda === true }),
  };
  // ---- 106-08: what a VR session needs from this studio (XrKnopf loads the session code only on demand) ----
  const sprechFernRef = useRef(/** @type {any} */ (null)); // the speech field's handle: grip = speech button, panel = its answers
  /** the selection in words, computed again only when the selection changed (the VR panel asks every frame) */
  const xrAuswahlCache = useRef(/** @type {{selected: any, multiSel: any, text: string|null}} */ ({ selected: undefined, multiSel: undefined, text: null }));
  const xrQuelle = () => {
    const t3 = three.current;
    if (!t3?.xrZeigen || view !== "3d") return null;
    // review 106-08: delegates that read the CURRENT pick handles at every call (the pick effect may run again during a session)
    const xz = () => three.current?.xrZeigen ?? null;
    return {
      renderer: t3.renderer, szene: t3.scene, kamera: t3.camera,
      quelle: {
        treffen: (/** @type {any} */ s) => xz()?.treffen(s) ?? null,
        rohTreffen: (/** @type {any} */ s) => xz()?.rohTreffen(s) ?? null,
        hover: (/** @type {any} */ x) => { xz()?.hover(x); },
        waehlen: (/** @type {any} */ x) => { xz()?.waehlen(x); },
        auswahlText: () => {
          const a = auswahlRef.current;
          const c = xrAuswahlCache.current;
          if (c.selected !== a.selected || c.multiSel !== a.multiSel) {
            const eintraege = auswahlEintraege();
            const k = eintraege.length ? bimKontext(eintraege) : null;
            const b = k?.bauteile?.[0];
            c.text = !k || !k.anzahl ? null : k.anzahl > 1 ? `${k.anzahl} ${tz("Bauteile")}` : b ? `${b.klasse ?? ""}${b.name ? ` · ${b.name}` : ""}` : null;
            c.selected = a.selected; c.multiSel = a.multiSel;
          }
          return c.text;
        },
        box: () => {
          const box = new THREE.Box3();
          [t3.buildingGroup, t3.customGroup].forEach((g) => g?.children.forEach((m) => { if (m.visible && m.isMesh) box.expandByObject(m); }));
          return box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
        },
      },
      sprechen: () => sprechFernRef.current,
      befehle,
      darfAendern: () => aenderung.current.darfAendern(), // 106-07 rights: the same gate as the button on the screen
    };
  };
  // ---- 106-03: change tools (proposal -> check -> preview -> confirmation -> origin) ----
  const vorschlaege = useMemo(() => vorschlagSpeicher(), []);
  /** Helper objects of the preview per proposal id (ghost group, outlines, cut marker), so exactly those are removed again. */
  const vorschauRef = useRef(/** @type {Map<string, any[]>} */ (new Map()));
  /** Group for ghosts in the scene root: the element group is rebuilt on every model change, the ghosts must survive that. */
  const geisterGruppe = () => {
    const t3 = three.current;
    if (!t3.scene) return null;
    if (!t3.geister) { t3.geister = new THREE.Group(); t3.geister.userData.zeigeHilfe = true; t3.scene.add(t3.geister); }
    return t3.geister;
  };
  /** The meshes of one drawn element in the scene (a composite wall has one per skin; its openings' glazing moves with it). */
  const meshesDesBauteils = (/** @type {any} */ fund) => {
    const kind = /** @type {Record<string, string>} */ ({ wand: "wall", stuetze: "column", decke: "cslab", dach: "croof", zone: "zone" })[fund.art];
    const idx = fund.element._idx;
    const oeff = new Set(fund.art === "wand" ? (modellRef.current.customWindows || []).filter((/** @type {any} */ o) => o.wallIdx === idx).map((/** @type {any} */ o) => o._idx) : []);
    /** @type {any[]} */
    const out = [];
    three.current.customGroup?.traverse((/** @type {any} */ m) => {
      const u = m.userData || {};
      if (!m.isMesh || u.zeigeHilfe) return;
      if ((u.kind === kind && u.id === idx) || (oeff.size && (u.kind === "window" || u.kind === "door") && oeff.has(u.id))) out.push(m);
    });
    return out;
  };
  const vorschauEntfernen = (/** @type {string} */ id) => {
    (vorschauRef.current.get(id) || []).forEach((o) => geisterEntsorgen(o));
    vorschauRef.current.delete(id);
  };
  /** Draws what a proposal would do: ghost (transformieren), cut marker (teilen), warning outline (eigenschaft). 3D view only. */
  const vorschauZeigen = (/** @type {any} */ v) => {
    vorschauEntfernen(v.id);
    const g = geisterGruppe();
    const fund = v.ziel.quelle === "ifc" ? null : bauteilImModell(modellRef.current, v.ziel.guid, { projektId: projectId || null });
    if (!g || !fund) return;
    /** @type {any[]} */
    const objs = [];
    try {
      const el = fund.element, sh = geschosshoehe(el.level || 0, gs), lvl = unterkante(el, gs);
      if (v.art === "transformieren") {
        const m = geisterMatrix({ zentrum: transformZentrum(el, v.params.zentrum), verschiebung_m: v.params.verschiebung_m, drehung_grad: v.params.drehung_grad, faktor: v.params.faktor });
        const klon = geisterKlon(meshesDesBauteils(fund), m, v.id);
        g.add(klon); objs.push(klon);
      } else if (v.art === "eigenschaft") {
        const zustand = v.pruefung?.stufe === "fehler" ? "fehler" : "warnung";
        for (const m of meshesDesBauteils(fund)) {
          const l = umrissLinie(new THREE.EdgesGeometry(m.geometry, 30), zustand);
          l.userData.geisterId = v.id; m.add(l); objs.push(l);
        }
      } else if (v.art === "teilen" && fund.art === "wand" && v.params.punkt_m) {
        const dx = el.b.x - el.a.x, dz = el.b.z - el.a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((v.params.punkt_m.x - el.a.x) * dx + (v.params.punkt_m.z - el.a.z) * dz) / l2));
        const c = { x: el.a.x + dx * t, z: el.a.z + dz * t }, len = Math.sqrt(l2);
        const h = wandDicke_m(el) / 2 + 0.3, nx = (-dz / len) * h, nz = (dx / len) * h;
        const marke = schnittMarke({ x: c.x + nx, z: c.z + nz }, { x: c.x - nx, z: c.z - nz }, lvl, lvl + wandHoehe(el, gs), v.id);
        g.add(marke); objs.push(marke);
      } else if (v.art === "teilen" && v.params.linie) {
        const top = elevationOf((el.level || 0) + 1, gs);
        const marke = schnittMarke(v.params.linie.a, v.params.linie.b, top - deckenLage(el, gs, "decke").dicke_m, top + 0.6, v.id);
        g.add(marke); objs.push(marke);
      }
    } catch (err) { console.warn("[BIM] preview failed: " + (/** @type {any} */ (err)?.message || err)); }
    vorschauRef.current.set(v.id, objs);
  };
  /** After the element group was rebuilt: draw the previews of all open proposals again. */
  const vorschauAlleNeu = () => {
    [...vorschauRef.current.keys()].forEach(vorschauEntfernen);
    vorschlaege.offen().forEach(vorschauZeigen);
  };
  /** Writes a new model record into the React state of the seven element arrays (only the arrays that changed) and into the mirror.
   *  Change steps and remote sync use this path and must NOT enter the drawing undo (they have their own history). */
  const modellAnwenden = (/** @type {any} */ neu) => {
    historieStillRef.current = true;
    try {
      const alt = modellRef.current;
      const setter = { customWalls: setCustomWalls, customColumns: setCustomColumns, customWindows: setCustomWindows, envOpenings: setEnvOpenings,
        customZones: setCustomZones, customSlabs: setCustomSlabs, customRoofs: setCustomRoofs, customStairs: setCustomStairs, gauben: setGauben };
      const stand = { ...alt };
      for (const [k, set] of Object.entries(setter)) if (neu[k] !== alt[k]) {
        // 107-02: roofs from an agent or an undo may only carry the old `pitch`; they get the split fields here like at load, so editor and export read one meaning
        const wert = k === "customRoofs" && Array.isArray(neu[k]) ? neu[k].map(dachMigrieren) : neu[k];
        set(wert); stand[k] = wert;
      }
      modellRef.current = stand;
      idRef.current = Math.max(idRef.current, naechsteFreieIdx(stand)); // a split took the counter's number
    } finally {
      historieStillRef.current = false;
    }
  };
  const aenderung = useRef(/** @type {Record<string, any>} */ ({}));
  // 106-10: confirmed and reversed steps go into the project's change log (entity AenderungsSchritt); a failed write is said in the hint line
  const projektIdRef = useRef(/** @type {string|null} */ (null));
  projektIdRef.current = projectId || null;
  const protokoll = useMemo(() => protokollAnbinden({ quelle: "bim", projektId: () => projektIdRef.current, autor: () => autorRef.current,
    onFehler: (was, detail) => setHint(`${tz(was)}: ${detail}`) }), []); // eslint-disable-line react-hooks/exhaustive-deps -- reads refs
  aenderung.current = {
    kontext: () => bimKontext(auswahlEintraege()),
    modell: () => modellRef.current,
    optionen: () => ({ projektId: projectId || null, bauart: bauartVon(project).bauart,
      werkstatt: werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }), durchbrueche, huelle: model.walls, geschosshoehe_m: storeyHeight, geschosse,
      attributPruefung: pruefeAttributeVorUebernahme, naechsteIdx: idRef.current }),
    // 106-05: view directions for "nach links" (3D: from the camera, plan: fixed, section: none) and the spot last pointed at on the SELECTED element ("teile hier")
    ansicht: () => (view === "3d" ? ansichtAusKamera(three.current.camera) : view === "grundriss" ? ANSICHT_GRUNDRISS : null),
    zeigepunkt: () => {
      // only in the view it was pointed in (the 3D view): a click in the plan sets no spot, an older 3D spot must not stand in for it
      const z = three.current.letzterZeigepunkt;
      return z && view === "3d" && bimKontext(auswahlEintraege()).bauteile.some((/** @type {any} */ b) => b.guid === z.guid) ? { x: z.x, z: z.z } : null;
    },
    speicher: vorschlaege,
    uebernehmen: (/** @type {any} */ _v, /** @type {any} */ r) => modellAnwenden(r.modell),
    zuruecknehmen: (/** @type {any} */ _e, /** @type {any} */ r) => modellAnwenden(r.modell),
    t: tz,
    vorschauZeigen, vorschauEntfernen,
    darfAendern: () => darfAendern, // 106-07: bestaetigen / rueckgaengig only for a role that may change the model
    // 106-10 change log; 106-11: the plan state follows each stored step
    schrittBestaetigt: (/** @type {any} */ v, /** @type {any} */ e) => protokoll.schrittBestaetigt(v, e).then((r) => { kiStandLaden(); return r; }),
    schrittZurueckgenommen: (/** @type {any} */ e, /** @type {any} */ o) => protokoll.schrittZurueckgenommen(e, o).then((r) => { kiStandLaden(); return r; }),
  };
  const befehle = useMemo(() => {
    const reg = befehlsRegister();
    auswahlBefehleRegistrieren(reg, () => /** @type {any} */ (aktuell.current));
    aenderungsBefehleRegistrieren(reg, () => /** @type {any} */ (aenderung.current));
    // 106-05: a sentence as a command, the caller's ctx goes on; review 106-10: the office library is loaded here, not only by the speech field
    eingabeBefehlRegistrieren(reg, () => /** @type {any} */ (aenderung.current), { bibliothekVorladen: () => bibliothekLaden() });
    // 107-07: duplicate the selection, optionally as a row ("*3", "/3") — the same path as Strg+D and the typed input
    reg.registrieren({ id: "duplizieren", label: "Duplizieren", menue: "Bearbeiten", taste: "Strg+D", parameter: { reihe: "text" },
      ausfuehren: (/** @type {any} */ p) => dupRef.current.duplizieren(p?.reihe ? String(p.reihe) : undefined) }); // review 107-07: a row at once (the state of a fresh copy is not rendered yet)
    return reg;
  }, []);
  // 106-10: jump from the review workplace (?tab=bim&auswahl=<GUID>): select that element once it is in the loaded model, through the same
  // command a person or agent uses (106-02), then frame it. Tried again on every model change until it is found.
  const sprungRef = useRef(/** @type {string|null} */ (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("auswahl") : null));
  useEffect(() => {
    const guid = sprungRef.current;
    if (!guid) return;
    const r = befehle.ausfuehren("auswahl-guid", { guid });
    if (!r.ok) return;
    sprungRef.current = null;
    befehle.ausfuehren("ansicht-auf-auswahl", {});
  }, [befehle, customWalls, customColumns, customZones, customSlabs, customRoofs]);
  // ---- 106-09: changes another device saved (change stream, useBimModelSync) ----
  // Three ways per field against what this studio holds right now: taken over where only the other device changed
  // something, kept where only this one did, a conflict (both versions, held back from saving) where both changed the
  // same element. Open proposals are checked again - one on a changed element is now "Veraltet" and blocked. Nothing is
  // confirmed here: the change arrives as confirmed by the person on the other device, with its origin (D-IM-04).
  const studioWerteRef = useRef(/** @type {Record<string, any>} */ ({}));
  studioWerteRef.current = { envComposite, envThickness, huelle_bezug: huelleBezug, huelle_decke_dicke_m: huelleDeckeDicke, huelle_decke_bezug: huelleDeckeBezug,
    parapet, dachform, dachneigung, entranceCfg, verschneidung, dachform_ifc: dachIfc };
  // 106-09 review: the attribute layer and the sketch mode as they are now (read inside the holder callback)
  const attributRef = useRef(attributLayer);
  attributRef.current = attributLayer;
  const sketchEditAktivRef = useRef(false);
  sketchEditAktivRef.current = !!sketchEdit;
  useEffect(() => {
    if (!projectId) return undefined;
    /** @type {Record<string, (v: any) => void>} */
    const wertSetzer = { envComposite: setEnvComposite, envThickness: setEnvThickness, huelle_bezug: setHuelleBezug, huelle_decke_dicke_m: setHuelleDeckeDicke,
      huelle_decke_bezug: setHuelleDeckeBezug, parapet: setParapet, dachform: setDachform, dachneigung: setDachneigung, entranceCfg: setEntranceCfg,
      verschneidung: (/** @type {any} */ v) => { setVerschneidung(v === true); hatteVerschneidungRef.current = true; },
      dachform_ifc: (/** @type {any} */ v) => { setDachIfc(v === true); hatteDachIfcRef.current = true; } }; // 107-10 review
    /** @type {Record<string, (v: any) => void>} */
    const leseSetzer = { netz_layer: setNetzLayer, statik_layer: setStatikLayer, massing_layer: setMassingLayer, sketch_layer: setSketchJson };
    const felder = [...STUDIO_SPEICHER_FELDER];
    /** Writes new field values into the studio (lists through the synchronous mirror, single values through their setters). @param {Record<string, any>} werte */
    const anwenden = (werte) => {
      const listen = Object.fromEntries(Object.entries(werte).filter(([k]) => k in ELEMENT_FELDER));
      if (Object.keys(listen).length) modellAnwenden({ ...modellRef.current, ...listen });
      for (const [k, v] of Object.entries(werte)) if (wertSetzer[k]) { wertSetzer[k](v); studioWerteRef.current = { ...studioWerteRef.current, [k]: v }; }
    };
    const lokalWert = (/** @type {string} */ k) => (k in ELEMENT_FELDER ? modellRef.current[k] : studioWerteRef.current[k]);
    const halter = { projectId, lokalWert, anwenden };
    studioHalter.current = halter;
    /** The studio mounted now for this project, or null (resolvers act on it, never on an unmounted one). */
    const aktuell = () => (studioHalter.current?.projectId === projectId ? studioHalter.current : null);
    const abmelden = aufFremdenStand((pid, f) => {
      if (pid !== projectId || loadingRef.current) return [];
      /** @type {string[]} */
      const genommen = [];
      // layers the studio only shows follow live (written by their editors, not claimed); the sketch not while it is edited here
      for (const k of STUDIO_LESE_LAYER) {
        if (k in f.patch && !(k === "sketch_layer" && sketchEditAktivRef.current)) leseSetzer[k](f.patch[k] ?? null);
      }
      // the attribute layer is written here too: taken over while unchanged here, else the next save shows a conflict
      if ("bauteil_attribute_layer" in f.patch) {
        const lokalA = attributRef.current;
        if (gleichWert(lokalA, f.vorher.bauteil_attribute_layer) || gleichWert(lokalA, f.patch.bauteil_attribute_layer)) {
          setAttributLayer(f.patch.bauteil_attribute_layer ?? null);
          attributRef.current = f.patch.bauteil_attribute_layer ?? null;
          genommen.push("bauteil_attribute_layer");
        }
      }
      const betroffen = felder.filter((k) => k in f.patch);
      if (!betroffen.length) return genommen;
      // two devices drew a new element with the same number: this studio's one gets a free number first, so both stay
      const kollision = neueKollisionenUmnummern({ vorher: f.vorher, lokal: modellRef.current, patch: f.patch });
      if (kollision.umbenannt.length) {
        modellAnwenden({ ...modellRef.current, ...Object.fromEntries(kollision.geaendert.map((k) => [k, kollision.lokal[k]])) });
      }
      const lokal = Object.fromEntries(betroffen.map((k) => [k, lokalWert(k)]));
      const r = fremdeElementeAbgleichen({ patch: f.patch, vorher: f.vorher, lokal, felder: betroffen });
      anwenden(r.setzen);
      for (const [feld, konflikte] of Object.entries(r.konflikte)) {
        const id = `bim:${feld}`;
        studioMeinStand.delete(id);
        feldSperren(projectId, feld);
        abgleichStand.konfliktMelden({
          quelle: "bim", projektId: projectId, feld, geraet: f.geraet,
          titel: tz(/** @type {any} */ (ELEMENT_FELDER)[feld] ?? /** @type {any} */ (STUDIO_WERTE)[feld] ?? feld),
          zeilen: konfliktZeilen(feld, konflikte, tz),
          loesen: {
            mein: async () => {
              const h = aktuell();
              const wert = h ? h.lokalWert(feld) : studioMeinStand.get(id);
              studioMeinStand.delete(id);
              feldFreigeben(projectId, feld);
              await saveBimModel(projectId, { [feld]: wert });
            },
            fremd: async () => {
              const h = aktuell();
              const neu = konfliktAufloesen(h ? h.lokalWert(feld) : studioMeinStand.get(id), konflikte, "fremd");
              studioMeinStand.delete(id);
              feldFreigeben(projectId, feld);
              if (h) h.anwenden({ [feld]: neu });
              await saveBimModel(projectId, { [feld]: neu });
            },
          },
        });
      }
      if (!f.entscheidung) {
        const veraltet = vorschlaegeNeuPruefen(befehle);
        abgleichStand.hinweisHinzu({ geraet: f.geraet, zeilen: aenderungsZeilen(r.geaendert, r.einzel, tz), veraltet });
      }
      return [...genommen, ...betroffen];
    });
    return () => {
      abmelden();
      // the own version of every open conflict stays for the next mount and for a decision made without a studio
      for (const k of abgleichStand.stand().konflikte) {
        if (k.quelle === "bim" && k.projektId === projectId) studioMeinStand.set(k.id, lokalWert(k.feld));
      }
      if (studioHalter.current === halter) studioHalter.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; modellAnwenden/tz are read at call time through refs and closures of this mount
  }, [projectId]);
  const abgleich = useSyncExternalStore(abgleichStand.abonnieren, abgleichStand.stand);
  // 106-09 review: the studio shows the cards of its sources in its view; the page-wide card shows the rest
  useEffect(() => {
    const ab = STUDIO_QUELLEN.map((q) => abgleichStand.anzeigeMelden(q));
    return () => { ab.forEach((f) => f()); };
  }, []);
  // a field of the autosave held back by an open conflict: "waiting for a decision" instead of "saved"
  const speichernWartet = Boolean(projectId) && abgleich.konflikte.some((k) => k.projektId === projectId && STUDIO_SPEICHER_FELDER.includes(k.feld));
  // test and agent hook next to the 106-01 one (window.__bitZeigen.bim): the previews as drawn and the element arrays as they are.
  // Plain data only, so it serialises.
  useEffect(() => {
    const w = /** @type {any} */ (window);
    const api = {
      vorschau: () => [...vorschauRef.current.entries()].map(([id, objs]) => ({ id, objekte: objs.map((/** @type {any} */ o) => ({
        typ: o.type, geist: !!o.userData.geisterId && o.isGroup === true,
        // outline form of the preview (dashed 'warnung' / solid 'fehler'): on the object itself, or on the meshes of a ghost
        umriss: (o.isGroup ? o.children.flatMap((/** @type {any} */ c) => c.children) : [o]).filter((/** @type {any} */ x) => x.userData?.zeigeZustand)
          .map((/** @type {any} */ x) => ({ zustand: x.userData.zeigeZustand, material: x.material.type })),
      })) })),
      modell: () => JSON.parse(JSON.stringify(modellRef.current)),
      // 106-05: screen right / into the screen of the current view as plan unit vectors (what "nach links" is measured against)
      ansicht: () => aenderung.current.ansicht(),
      // 107-01: world box (m) of the drawn wall's 3D meshes (all layers of a build-up joined), per wall _idx — proves 3D = plan = IFC
      waende3d: () => {
        const g = three.current.customGroup;
        /** @type {Record<string, {min: number[], max: number[]}>} */
        const out = {};
        for (const m of g ? g.children : []) {
          if (m.userData?.kind !== "wall" || m.userData.id == null) continue;
          const b = new THREE.Box3().setFromObject(m);
          const alt = out[m.userData.id];
          out[m.userData.id] = alt ? { min: [Math.min(alt.min[0], b.min.x), Math.min(alt.min[1], b.min.y), Math.min(alt.min[2], b.min.z)], max: [Math.max(alt.max[0], b.max.x), Math.max(alt.max[1], b.max.y), Math.max(alt.max[2], b.max.z)] } : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
        }
        return out;
      },
      // 107-02 review: world box (m) of the drawn roofs' 3D meshes, per roof _idx — proves a roof of slope 0° is a flat plate, not a 2.5 m gable
      daecher3d: () => {
        const g = three.current.customGroup;
        /** @type {Record<string, {min: number[], max: number[]}>} */
        const out = {};
        for (const m of g ? g.children : []) {
          if (m.userData?.kind !== "croof" || m.userData.id == null) continue;
          const b = new THREE.Box3().setFromObject(m);
          out[m.userData.id] = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
        }
        return out;
      },
      // 107-01 review: the same for the HULL wall meshes (userData kind "wallShell"), keyed "<level>:<edge>" — proves hull plan = 3D = IFC
      // 107-04: a hull wall with a build-up is one mesh per layer, the boxes are joined like for the drawn walls
      huellwaende3d: () => {
        const g = three.current.buildingGroup;
        /** @type {Record<string, {min: number[], max: number[]}>} */
        const out = {};
        for (const m of g ? g.children : []) {
          if (m.userData?.kind !== "wallShell") continue;
          const b = new THREE.Box3().setFromObject(m);
          const k = `${m.userData.level}:${m.userData.edge}`, alt = out[k];
          out[k] = alt ? { min: [Math.min(alt.min[0], b.min.x), Math.min(alt.min[1], b.min.y), Math.min(alt.min[2], b.min.z)], max: [Math.max(alt.max[0], b.max.x), Math.max(alt.max[1], b.max.y), Math.max(alt.max[2], b.max.z)] } : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
        }
        return out;
      },
      // 107-04: number of layer meshes of the hull wall "<level>:<edge>" (a hull wall with a build-up is shown layer by layer)
      huellwandSchichten3d: () => {
        const g = three.current.buildingGroup;
        /** @type {Record<string, number>} */
        const out = {};
        for (const m of g ? g.children : []) if (m.userData?.kind === "wallShell") { const k = `${m.userData.level}:${m.userData.edge}`; out[k] = (out[k] || 0) + 1; }
        return out;
      },
      // 107-04: number of holes (Shape.holes) per drawn wall (by _idx), hull wall ("<level>:<edge>") and drawn slab (by _idx), summed over the layers of a
      // wall — proves a hole is cut through every layer; plus the number of planned-penetration markers in the scene
      loecher3d: () => {
        const t3 = three.current;
        /** @type {{wand: Record<string, number[]>, huelle: Record<string, number[]>, decke: Record<string, number>, vormerkungen: number}} */
        const out = { wand: {}, huelle: {}, decke: {}, vormerkungen: 0 };
        const holes = (/** @type {any} */ m) => (m.geometry?.parameters?.shapes?.holes || []).length;
        for (const m of t3.customGroup ? t3.customGroup.children : []) {
          const u = m.userData || {};
          if (u.kind === "wall" && u.id != null) (out.wand[u.id] = out.wand[u.id] || []).push(holes(m));
          else if (u.kind === "cslab" && u.id != null) out.decke[u.id] = holes(m);
          else if (u.kind === "durchbruch") out.vormerkungen += 1;
        }
        for (const m of t3.buildingGroup ? t3.buildingGroup.children : []) {
          const u = m.userData || {};
          if (u.kind === "wallShell") { const k = `${u.level}:${u.edge}`; (out.huelle[k] = out.huelle[k] || []).push(holes(m)); }
        }
        return out;
      },
      // 107-04: test hook — select an opening (a 3D glazing group is not pickable; the plan symbol is, by mouse)
      oeffnungWaehlen: (/** @type {number} */ index, /** @type {string} */ scope = "custom") => setSelected({ type: "opening", index, scope }),
      // 107-04: test hook — put the camera (orbit angles in rad, radius in m, target point in m) and read the pixel of a world point, so a test can
      // click ON a wall face in 3D. The camera is set at once (the render loop would do it one frame later).
      kamera: (/** @type {{theta?: number, phi?: number, radius?: number, ziel?: {x: number, y: number, z: number}}} */ opt) => {
        const o = orbit.current, t3 = three.current;
        o.touched = true;
        if (opt.theta != null) o.theta = opt.theta;
        if (opt.phi != null) o.phi = opt.phi;
        if (opt.radius != null) o.radius = opt.radius;
        if (opt.ziel && t3.target) t3.target.set(opt.ziel.x, opt.ziel.y, opt.ziel.z);
        if (t3.camera && t3.target) {
          t3.camera.position.set(t3.target.x + o.radius * Math.sin(o.phi) * Math.cos(o.theta), t3.target.y + o.radius * Math.cos(o.phi), t3.target.z + o.radius * Math.sin(o.phi) * Math.sin(o.theta));
          t3.camera.lookAt(t3.target);
          t3.camera.updateMatrixWorld();
        }
      },
      bildpunkt3d: (/** @type {{x: number, y: number, z: number}} */ pt) => {
        const t3 = three.current, dom = t3.renderer?.domElement;
        if (!dom || !t3.camera) return null;
        t3.camera.updateMatrixWorld();
        const v = new THREE.Vector3(pt.x, pt.y, pt.z).project(t3.camera), r = dom.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    w.__bitZeigen = { ...(w.__bitZeigen || {}), bimAenderung: api };
    return () => { if (w.__bitZeigen?.bimAenderung === api) delete w.__bitZeigen.bimAenderung; };
  }, []);
  // the buttons of the preview take the same road as the commands (one path, one check); a refusal is shown in words
  const aenderungBefehl = (/** @type {string} */ id, /** @type {any} */ p) => {
    const r = befehle.ausfuehren(id, p);
    setHint(r.ok ? "" : /** @type {{ok: false, error: string}} */ (r).error);
  };
  // reachable for local agents / tests while the studio is open (window.__bitBefehle.zeileBearbeiten(...))
  // and through the local control channel (server/steuerungRouter.js); the global is deleted only if it is still ours.
  useEffect(() => {
    /** @type {any} */ (window).__bitBefehle = befehle;
    const stopp = starteSteuerungsBruecke(befehle);
    return () => {
      stopp();
      if (/** @type {any} */ (window).__bitBefehle === befehle) delete /** @type {any} */ (window).__bitBefehle;
    };
  }, [befehle]);

  // ---- Scene init (once) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth || 700, H = mount.clientHeight || 520;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0xcfe1f0, 1); // heller Tageshimmel statt Dunkelblau
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe1f0);
    scene.fog = new THREE.Fog(0xcfe1f0, 600, 1800); // heller, weiter Dunst (kein dunkler Nebel)
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const baseHemi = new THREE.HemisphereLight(0xeaf4ff, 0x8a9a78, 0.7); // Himmel/Boden-Grundlicht
    scene.add(baseHemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(60, 120, 40); sun.castShadow = true;
    scene.add(sun);

    // Meter-Gitter (10 m Raster) + Achsen-Hinweis
    const grid10 = new THREE.GridHelper(200, 20, 0x1f6f63, 0x14302c);
    grid10.position.y = 0.02;
    scene.add(grid10);
    // XYZ-Achsen am Ursprung (X rot, Y grün=oben, Z blau), 8 m
    const axes = new THREE.AxesHelper(8);
    axes.position.y = 0.05;
    scene.add(axes);

    const terrainGroup = new THREE.Group();
    const buildingGroup = new THREE.Group();
    const contextGroup = new THREE.Group();
    const customGroup = new THREE.Group();
    scene.add(terrainGroup, buildingGroup, contextGroup, customGroup);

    Object.assign(three.current, { renderer, scene, camera, terrainGroup, buildingGroup, contextGroup, customGroup, ambient, sun, grid10, axes, target: new THREE.Vector3(0, 6, 0) });

    let raf;
    let lastT = performance.now(); // Delta-Zeit für die Stadt-Animation (Render-Modus)
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      // 106-08: while a VR session presents, the session renders (renderer.setAnimationLoop) and owns the camera
      if (renderer.xr.isPresenting) { raf = requestAnimationFrame(tick); return; }
      const o = orbit.current;
      if (!o.on && !o.touched) o.theta += 0.0012;
      const t = three.current.target;
      camera.position.set(
        t.x + o.radius * Math.sin(o.phi) * Math.cos(o.theta),
        t.y + o.radius * Math.cos(o.phi),
        t.z + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      );
      camera.lookAt(t);
      // Belebte Stadt (Autos/Fußgänger) entlang vorberechneter Polylinien bewegen
      if (animRef.current.length) updateCityLife(animRef.current, dt);
      // Auswahl-Aura pulsiert („atmet"), damit die Markierung ins Auge fällt
      if (three.current.auraList?.length) {
        const puls = 0.55 + 0.45 * Math.sin(now * 0.006);
        three.current.auraList.forEach((l) => { l.material.opacity = puls; });
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const el = renderer.domElement;
    el.style.touchAction = "none"; el.style.cursor = "default";
    const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

    // Raycasting (106-01: strahlPick, the same core as the IFC viewer): the pickable object under
    // (clientX,clientY). Only the DIRECT children of the groups (glazing and door leaves are Groups
    // and stay out, as before); helper geometry (outline, aura) is never a direct child of a group.
    // 106-07: with the capture radius of the pointer kind (mouse exact as before, pen 8 px, finger 18 px): when the exact ray
    // finds no element of the studio (sky, ground, a context building), the rings around it are tried, nearest first.
    // Review fix 106-07: guidPflicht (hover) = the rings accept only elements that resolve to a GUID, the test the hover applies to the
    // result; a tap keeps accepting every element with a key (as the click always did).
    /** @type {(clientX: number, clientY: number, art?: import("@core/lib/zeigen/strahlPick.js").ZeigerArt, guidPflicht?: boolean) => any} */
    const treffenBei = (clientX, clientY, art = /** @type {import("@core/lib/zeigen/strahlPick.js").ZeigerArt} */ ("mouse"), guidPflicht = false) => {
      const objs = [];
      [three.current.buildingGroup, three.current.customGroup, three.current.contextGroup]
        .forEach((g) => g?.children.forEach((c) => { if (c.visible) objs.push(c); }));
      const annehmen = guidPflicht
        ? (/** @type {any} */ tr) => !!bauteilSchluessel(tr.objekt.userData) && !!identitaetAus(tr, (x) => three.current.cb?.bauteilInfo?.(x.objekt.userData), { guidPflicht: true })
        : (/** @type {any} */ tr) => !!bauteilSchluessel(tr.objekt.userData);
      return zeigerPick(objs, camera, el, clientX, clientY, { art, kamera: camera, annehmen });
    };
    const pickAt = (clientX, clientY) => treffenBei(clientX, clientY)?.objekt ?? null;

    // Hover highlight 'fokus' (106-01): outline + tint on private material clones.
    const zeigen = hervorhebung();
    const handles = three.current; // never reassigned (Object.assign), safe to use in the cleanup
    handles.zeigen = zeigen;
    const hoverLoeschen = () => {
      zeigen.alleLoeschen();
      hoverRef.current = null;
      if (hoverBoxRef.current) hoverBoxRef.current.style.display = "none";
    };
    handles.hoverLoeschen = hoverLoeschen;
    const gleichesBauteil = (a, b) => ["kind", "id", "scope", "level", "edge"].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
    // All meshes of one element (a composite wall has one mesh per skin, all with the same userData).
    const meshesVon = (ud) => {
      const out = [];
      [three.current.customGroup, three.current.buildingGroup].forEach((g) => g?.children.forEach((m) => {
        if (m.isMesh && m.visible && gleichesBauteil(m.userData, ud)) out.push(m);
      }));
      return out;
    };

    // 106-07: finger and pen. One contact: tap = select (tolerance per kind), drag = orbit (the mouse keeps its CAD buttons);
    // two fingers: pinch = closer/further, twist = turn around the vertical axis, shift of their middle = pan. The last finger
    // lifting after a two-finger gesture never selects.
    const geste = zweiFingerGeste();
    const gesteSchritt = (/** @type {import("@core/lib/zeigen/zweiFinger.js").FingerSchritt} */ sch) => {
      const o = orbit.current;
      o.radius = Math.max(20, Math.min(220, o.radius / sch.faktor)); // same limits as the wheel
      // fingers clockwise on screen = model clockwise seen from above [ASSUMED direction, as on map apps]. The camera sits at
      // (cos theta, sin theta) in x/z, so its world azimuth atan2(x, z) is PI/2 - theta: theta must DEcrease for the camera to go the
      // way the IFC viewer turns it (azimuth + drehungRad) - review fix 106-07, the sign was the other way round before.
      o.theta -= sch.drehungRad;
      _f.subVectors(three.current.target, camera.position).normalize();
      _r.crossVectors(_f, _up).normalize();
      _u.crossVectors(_r, _f).normalize();
      const k = o.radius * 0.0016; // same scale as the middle-button pan
      three.current.target.addScaledVector(_r, -sch.dx * k);
      three.current.target.addScaledVector(_u, sch.dy * k);
      gestenSummeRef.current = {
        schritte: gestenSummeRef.current.schritte + 1,
        drehungRad: gestenSummeRef.current.drehungRad + sch.drehungRad,
        faktor: gestenSummeRef.current.faktor * sch.faktor,
      };
    };

    // ArchiCAD-Maus: links = wählen, rechts = Kontextmenü, mittlere = Pan, Shift+mittlere = drehen
    const down = (e) => {
      const o = orbit.current; o.touched = true;
      const art = zeigerArt(e);
      zeigerArtRef.current = art;
      const anzahl = geste.runter(e.pointerId, e.clientX, e.clientY);
      if (anzahl >= 2) { o.on = true; o.mode = "geste"; hoverLoeschen(); return; }
      o.art = art; o.zeigerId = e.pointerId; o.startX = e.clientX; o.startY = e.clientY;
      if (e.button === 1) { o.on = true; o.mode = e.shiftKey ? "rotate" : "pan"; el.style.cursor = o.mode === "pan" ? "move" : "grabbing"; e.preventDefault(); }
      else if (e.button === 0) { o.on = true; o.mode = "select"; o.moved = false; }
      else { o.on = false; o.mode = null; }
      o.x = e.clientX; o.y = e.clientY;
    };
    // Mittelklick-Autoscroll des Browsers verhindern
    const mdown = (e) => { if (e.button === 1) e.preventDefault(); };
    const move = (e) => {
      const o = orbit.current; if (!o.on) return;
      if (o.mode === "geste") { const sch = geste.bewegt(e.pointerId, e.clientX, e.clientY); if (sch) gesteSchritt(sch); return; }
      geste.bewegt(e.pointerId, e.clientX, e.clientY);
      if (e.pointerId !== o.zeigerId && o.zeigerId != null) return;
      const dx = e.clientX - o.x, dy = e.clientY - o.y;
      if (o.mode === "select") {
        if (o.art !== "mouse") {
          // finger / pen: beyond the tap tolerance the contact orbits instead (there is no middle button on glass)
          if (Math.hypot(e.clientX - o.startX, e.clientY - o.startY) > TIPP_TOLERANZ_PX[o.art]) { o.moved = true; o.mode = "rotate"; }
          else return;
        } else { if (Math.abs(dx) + Math.abs(dy) > 3) o.moved = true; o.x = e.clientX; o.y = e.clientY; return; }
      }
      if (o.mode === "pan") {
        _f.subVectors(three.current.target, camera.position).normalize();
        _r.crossVectors(_f, _up).normalize();
        _u.crossVectors(_r, _f).normalize();
        const k = o.radius * 0.0016;
        three.current.target.addScaledVector(_r, -dx * k);
        three.current.target.addScaledVector(_u, dy * k);
      } else if (o.mode === "rotate") {
        o.theta -= dx * 0.008;
        o.phi = Math.max(0.25, Math.min(1.45, o.phi - dy * 0.005));
      }
      o.x = e.clientX; o.y = e.clientY;
    };
    const up = (e) => {
      const o = orbit.current;
      const warGeste = geste.warGeste();
      const rest = geste.hoch(e.pointerId);
      if (warGeste || o.mode === "geste") {
        // two-finger gesture: nothing is selected; when the last finger lifts the canvas is free again
        if (rest === 0) { o.on = false; o.mode = null; el.style.cursor = "default"; }
        return;
      }
      if (o.zeigerId != null && e.pointerId !== o.zeigerId) return;
      if (o.mode === "select" && !o.moved) {
        const treffer = treffenBei(e.clientX, e.clientY, o.art ?? "mouse");
        const obj = treffer?.objekt ?? null;
        // 106-05: remember the hit point (plan x/z, m) with the element's GUID - "teile hier" cuts there, and only while that element is selected
        const zeigeId = treffer ? identitaetAus(treffer, (tr) => three.current.cb?.bauteilInfo?.(tr.objekt.userData), { guidPflicht: true }) : null;
        three.current.letzterZeigepunkt = zeigeId ? { x: treffer.punkt[0], z: treffer.punkt[2], guid: zeigeId.guid } : null;
        // 107-04: with an opening tool the click places an opening on the face instead of selecting
        if (!three.current.cb?.platziere?.(treffer)) three.current.cb?.select?.(obj ? obj.userData : null);
      }
      o.on = false; o.mode = null; el.style.cursor = "default";
    };
    // Zooming moves the scene under a resting pointer: drop the hover, look again once the wheel settled.
    let radTimer = 0;
    const wheel = (e) => {
      e.preventDefault(); orbit.current.touched = true; orbit.current.radius = Math.max(20, Math.min(220, orbit.current.radius + e.deltaY * 0.05));
      hoverLoeschen();
      letzterPick = null;
      clearTimeout(radTimer);
      radTimer = window.setTimeout(() => { if (zeiger && !hoverRaf) hoverRaf = requestAnimationFrame(hoverTick); }, WHEEL_PAUSE_MS);
    };
    // Rechtsklick = Kontextmenü für getroffenes Objekt (Standardmenü unterdrückt)
    const ctx = (e) => {
      e.preventDefault();
      const obj = pickAt(e.clientX, e.clientY);
      const rect = el.getBoundingClientRect();
      three.current.cb?.context?.(obj ? obj.userData : null, e.clientX - rect.left, e.clientY - rect.top);
    };
    // Hover (106-01): the last pointer is remembered, ONE pick per animation frame, never faster than
    // the pick budget allows, and no new pick for sub-pixel jitter. A hit is shown in words and as
    // 'fokus' only if the studio knows the element and it has a GUID (unknown hit, e.g. context
    // buildings: nothing is shown, nothing is guessed).
    let zeiger = null;
    let letzterPick = null;
    let hoverRaf = 0;
    const drossel = pickDrossel();
    // Shows an identity (with GUID) as hovered: 'fokus' on all meshes of the element, or "Ausgewählt" when it is selected.
    // The mouse/pen hover and the VR controller ray (106-08) take this same road.
    const hoverAnzeigen = (/** @type {any} */ id) => {
      zeigen.alleLoeschen();
      const meshes = meshesVon(id.userData);
      const sels = multiSelRef.current?.length ? multiSelRef.current : selectedRef.current ? [selectedRef.current] : [];
      const gewaehlt = meshes.some((m) => sels.some((s) => auraMatches(m, s)));
      const name = gewaehlt ? "auswahl" : "fokus";
      if (!gewaehlt) { // a selected element keeps its aura, hover never paints over it
        try { meshes.forEach((m) => zeigen.setzen({ mesh: m }, "fokus")); }
        catch (err) { console.warn(`[BIM] hover highlight failed: ${err?.message || err}`); }
      }
      hoverRef.current = { quelle: "bim", guid: id.guid, kind: id.kind, id: id.bauteilId, schluessel: id.schluessel, typ: id.label, name: id.name, zustand: name };
      if (hoverTextRef.current) hoverTextRef.current.textContent = id.name ? `${id.label} · ${id.name}` : id.label;
      // the overlay says the state the picture shows: words, colour and outline form
      const look = ZEIGE_ZUSTAENDE[name];
      if (hoverZustandRef.current) hoverZustandRef.current.textContent = tz(look.label);
      if (hoverSymbolRef.current) {
        hoverSymbolRef.current.style.borderColor = look.hex;
        hoverSymbolRef.current.style.borderStyle = ZEIGE_CSS_RAND[look.umriss];
      }
    };
    // 106-08: the VR controller ray. The exact ray (no capture radius, like the mouse) against the same objects, the same resolver
    // (bauteilInfo -> GUID) as click and hover; the first hit counts. Select = the click's road (cb.select).
    handles.xrZeigen = {
      treffen: (/** @type {any} */ strahl) => {
        const objs = [];
        [three.current.buildingGroup, three.current.customGroup, three.current.contextGroup]
          .forEach((g) => g?.children.forEach((c) => { if (c.visible) objs.push(c); }));
        const tr = strahlPick(objs, strahl, { kamera: camera });
        if (!tr || !bauteilSchluessel(tr.objekt.userData)) return null;
        const id = identitaetAus(tr, (x) => three.current.cb?.bauteilInfo?.(x.objekt.userData));
        if (!id) return null;
        return { guid: id.guid || null, text: id.name ? `${id.label} · ${id.name}` : id.label, punkt: id.punkt, abstand: id.abstand, normal: weltNormale(tr), id };
      },
      // review 106-08: the raw first hit of the same objects (context buildings included) - a teleport must not go through them
      rohTreffen: (/** @type {any} */ strahl) => {
        const objs = [];
        [three.current.buildingGroup, three.current.customGroup, three.current.contextGroup]
          .forEach((g) => g?.children.forEach((c) => { if (c.visible) objs.push(c); }));
        const tr = strahlPick(objs, strahl, { kamera: camera });
        return tr ? { punkt: tr.punkt, abstand: tr.abstand, normal: weltNormale(tr) } : null;
      },
      hover: (/** @type {any} */ x) => {
        if (!x?.id || !x.guid) { hoverLoeschen(); return; }
        if (hoverRef.current?.schluessel !== x.id.schluessel) hoverAnzeigen(x.id);
      },
      waehlen: (/** @type {any} */ x) => {
        three.current.letzterZeigepunkt = x?.guid ? { x: x.punkt[0], z: x.punkt[2], guid: x.guid } : null;
        three.current.cb?.select?.(x?.id ? x.id.objekt.userData : null);
      },
    };
    const hoverTick = () => {
      hoverRaf = 0;
      if (!zeiger) return;
      if (orbit.current.on) { hoverLoeschen(); return; } // never while orbiting / panning
      const jetzt = performance.now();
      if (!drossel.darf(jetzt)) { hoverRaf = requestAnimationFrame(hoverTick); return; }
      const bewegt = !letzterPick || Math.hypot(zeiger.x - letzterPick.x, zeiger.y - letzterPick.y) >= HOVER_MIN_PX;
      if (bewegt || !hoverRef.current) {
        letzterPick = { x: zeiger.x, y: zeiger.y };
        const treffer = treffenBei(zeiger.x, zeiger.y, zeiger.art, true); // 106-07: a hovering pen gets its capture radius (GUID elements only)
        drossel.messen(performance.now() - jetzt, performance.now());
        el.style.cursor = treffer ? "pointer" : "default";
        // cheap key first: the GUID is derived only when the element under the pointer changed
        const schluessel = treffer ? bauteilSchluessel(treffer.objekt.userData) : "";
        if (!schluessel) { hoverLoeschen(); return; }
        if (hoverRef.current?.schluessel !== schluessel) {
          const id = identitaetAus(treffer, (tr) => three.current.cb?.bauteilInfo?.(tr.objekt.userData), { guidPflicht: true });
          if (!id) { hoverLoeschen(); return; }
          hoverAnzeigen(id);
        }
      }
      const box = hoverBoxRef.current;
      if (box) {
        box.style.display = ""; // visible first, otherwise offsetWidth is 0 and the clamp below is skipped
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(zeiger.x - r.left + 14, r.width - box.offsetWidth - 4));
        const y = Math.max(0, Math.min(zeiger.y - r.top + 14, r.height - box.offsetHeight - 4));
        box.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const hoverMove = (e) => {
      // 106-07: a finger has no hover (it only moves while on the glass); a pen above the glass hovers like the mouse
      const art = zeigerArt(e);
      if (art === "touch") return;
      if (art === "pen" && !e.buttons) zeigerArtRef.current = "pen";
      zeiger = { x: e.clientX, y: e.clientY, art };
      if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverTick);
    };
    // a cancelled contact (the browser took over the gesture) must not leave a finger counted
    const abbruch = (e) => { if (geste.hoch(e.pointerId) === 0) { const o = orbit.current; o.on = false; o.mode = null; } };
    const hoverLeave = () => { zeiger = null; hoverLoeschen(); };
    el.addEventListener("pointermove", hoverMove, { passive: true });
    el.addEventListener("pointerleave", hoverLeave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("mousedown", mdown);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abbruch);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", ctx);

    const onResize = () => { const nw = mount.clientWidth, nh = mount.clientHeight; if (!nw || !nh) return; camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh); };
    window.addEventListener("resize", onResize);
    handles.groesseAnpassen = onResize; // 108-01: the panel height follows the window (usePlanHoehe) after React rendered it

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", hoverMove);
      el.removeEventListener("pointerleave", hoverLeave);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      clearTimeout(radTimer);
      hoverLoeschen();
      zeigen.verwerfen(); // cached outline geometries
      handles.zeigen = null; handles.hoverLoeschen = null; handles.xrZeigen = null; handles.groesseAnpassen = null;
      el.removeEventListener("pointerdown", down); el.removeEventListener("mousedown", mdown);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); el.removeEventListener("wheel", wheel);
      window.removeEventListener("pointercancel", abbruch);
      el.removeEventListener("contextmenu", ctx);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      scene.traverse(objektFreigeben);
    };
  }, []);

  // ---- Terrain patch from real elevation (200 m) ----
  useEffect(() => {
    const t = three.current; if (!t.terrainGroup || !grid || grid.length < 2) return;
    while (t.terrainGroup.children.length) { const c = t.terrainGroup.children.pop(); objektFreigeben(c); }
    const size = grid.length;
    const PATCH = 200;
    const relief = 12; // gedämpfte Überhöhung für Lesbarkeit
    const range = (max - min) || 1;
    const geo = new THREE.PlaneGeometry(PATCH, PATCH, size - 1, size - 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
      const idx = i * size + j;
      pos.setZ(idx, ((grid[i][j] - min) / range) * relief - relief / 2);
    }
    geo.computeVertexNormals();
    // Im Render-Modus helles Wiesengrün (dunkles Editor-Grün wirkt unter hellem Himmel schwarz)
    const mat = renderMode
      ? new THREE.MeshStandardMaterial({ color: 0x86a05c, roughness: 0.95, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: 0x223524, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = -0.05; mesh.receiveShadow = true;
    mesh.userData.layer = "terrain"; mesh.visible = layersRef.current.find((l) => l.id === "terrain")?.visible ?? true;
    t.terrainGroup.add(mesh);
  }, [grid, min, max, renderMode]);

  // ---- Building from shared model ----
  useEffect(() => {
    const t = three.current; if (!t.buildingGroup) return;
    t.hoverLoeschen?.(); // 106-01: material clones of the hover must not outlive their meshes
    while (t.buildingGroup.children.length) { const c = t.buildingGroup.children.pop(); objektFreigeben(c); }

    const envComp = compositeById(envComposite);
    // An assigned envelope surface wins over the render preset. The preset stays
    // the view for an envelope that has no catalogue surface (today's behaviour).
    const huelleZugewiesen = materialFuerSchluessel(huelleErscheinung, 8);
    const wallMat = huelleZugewiesen
      || (renderMode
        ? facadeMaterial(facadePreset)
        : new THREE.MeshStandardMaterial({ color: envComp ? new THREE.Color(envComp.skins[0].color) : 0xeef2f6, roughness: 0.9, metalness: 0.0 }));
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb6d6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4654, roughness: 0.6 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.7 });

    // Regel-Öffnungen (Auto-Fenster + Eingangstür) kommen aus autoOpenings —
    // derselben Liste, die auch der IFC-Export bekommt (KD-16).
    giebel.model.walls.forEach((w) => { // 108-03: top-storey hull walls carry `profil` (gable up to the roof)
      const autos = autoOpenings.filter((o) => o.level === w.level && o.edge === w.edge);
      const ops = /** @type {Array<{u: number, sill: number, width: number, height: number, rund?: boolean}>} */ (autos.map((o) => ({ u: o.u, sill: o.sill, width: o.width, height: o.height })));
      // benutzerplatzierte Öffnungen auf dieser Hüllwand
      const myEnv = envOpenings.filter((e) => e.level === w.level && e.edge === w.edge);
      myEnv.forEach((e) => { const ty = masseAmWand(e, w, w.elevation); ops.push({ u: e.u, sill: ty.sill, width: ty.w, height: ty.h }); });
      // 107-04: executed penetrations of the openings planning in this wall are holes like openings without a filling
      durchbruchLoecher.filter((l) => l.schluessel === `env:${w.level}:${w.edge}`).forEach((l) => ops.push({ u: l.u, sill: l.sill, width: l.width, height: l.height, rund: l.rund }));
      // 107-04: with a build-up (not in render mode: the facade preset replaces the material) the hull wall is shown layer by layer, the holes cut
      // through ALL layers — before it was one body coloured by layer 1 only
      const hComp = !renderMode && w.composite ? compositeById(w.composite) : null;
      // 107-09: the intersected solid (layers as material groups) once its volume comparison passed; until then and as the fallback the layers below.
      // Review 107-09: in render mode too (one facade material over all layer groups), so 3D and plan show the same joint
      // 108-03: a profile wall (gable) is drawn from its profile polygon — the intersected solids know the stored knee-wall height only
      const vs = w.profil ? null : seoSolid(`env:${w.level}:${w.edge}`) || (w.composite ? vSolidsAktuell?.waende.get(`env:${w.level}:${w.edge}`) : null); // 107-10: a wall cut under a roof first
      // 107-13 review: in render mode a basement wall gets concrete (slabMat), not the facade preset - clinker below ground is wrong (A2)
      const weg = huellMeshWeg({ hatSolid: !!vs?.geometrie, hatAufbau: !!hComp, kellerImRender: renderMode && w.level < 0 });
      const ganz = weg.beton ? slabMat : wallMat;
      const huellMeshes = weg.weg === "solid"
        ? [solidMesh(vs, weg.aussen ? hComp : null, weg.einMaterial ? ganz : null, weg.aussen ? huelleZugewiesen : null)]
        : weg.weg === "schichten"
          ? buildSchichtWand(w, hComp, ops, huelleZugewiesen)
          : [buildWallMeshWithHoles(w, ganz, ops)];
      huellMeshes.forEach((m) => {
        m.userData.layer = "shell"; m.userData.kind = "wallShell"; m.userData.level = w.level; m.userData.edge = w.edge;
        strukturVorbereiten(m, w, true, strukturRef.current); // 107-12 (review: layer boxes without intersection too; hull = load-bearing)
        t.buildingGroup.add(m);
      });
      const rotY = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
      // 107-01: glazing sits in the wall BODY — shifted by the hull reference line (0 for "center")
      const hg = wandGeometrie(w), hx = w.a.x + hg.normale.x * hg.versatz_m, hz = w.a.z + hg.normale.z * hg.versatz_m;
      // Verglasung/Türblatt der Regel-Öffnungen (gleiche Quelle wie die Löcher)
      autos.forEach((o) => {
        const g = buildGlazing(autoOpeningType(o), o.u, glassMat, frameMat, o.kind, leafMat);
        g.position.set(hx, w.elevation, hz); g.rotation.y = rotY;
        g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = o.kind; c.userData.scope = "auto"; c.userData.level = w.level; c.userData.edge = w.edge; } });
        t.buildingGroup.add(g);
      });
      // Verglasung/Türblatt für platzierte Hüllwand-Öffnungen
      myEnv.forEach((e) => {
        if (istOeffnungOhneFuellung(e)) return; // 107-04: an opening without a filling is only the hole
        const ty = typAmWand(e, w, w.elevation);
        const hlen = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const g = buildGlazing(ty, oeffnungMitte_m(e.u, ty.w, hlen), materialFuerSchluessel(e.glas, ty.w, true) || glassMat, materialFuerSchluessel(e.rahmen, ty.w) || frameMat, e.kind, leafMat);
        g.position.set(hx, w.elevation, hz); g.rotation.y = rotY;
        g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = e.kind; c.userData.id = e._idx; c.userData.scope = "env"; } });
        t.buildingGroup.add(g);
      });
    });

    // 108-06: the hull slabs with the derived stair openings (`oeffnungen_abgeleitet`, Shape.holes like the drawn slabs — no CSG)
    mitTreppenLoechern(model, customStairs, gs).model.slabs.forEach((s) => {
      const shape = new THREE.Shape();
      s.polygon.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      (Array.isArray(s.oeffnungen_abgeleitet) ? s.oeffnungen_abgeleitet : []).forEach((loch) => {
        const path = new THREE.Path();
        loch.points.forEach((p, i) => (i ? path.lineTo(p.x, -p.z) : path.moveTo(p.x, -p.z)));
        path.closePath();
        shape.holes.push(path);
      });
      const lage = deckenLage(s, undefined, "huelle"); // 107-02: thickness/side from the slab (default 0.25 m on its plane)
      const geo = new THREE.ExtrudeGeometry(shape, { depth: lage.dicke_m, bevelEnabled: false });
      const m = new THREE.Mesh(geo, slabMat); m.castShadow = true; m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = lage.unterkante_m;
      m.userData.layer = "shell"; m.userData.kind = "slab";
      t.buildingGroup.add(m);
    });

    // Attika (Brüstung) oben auf dem Dach — nur beim Flachdach
    if (dachform === "flach") {
      (model.parapets || []).forEach((p) => {
        const len = Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z); if (len < 0.05) return;
        const geo = new THREE.BoxGeometry(len, p.height, p.thickness);
        const m = new THREE.Mesh(geo, wallMat); m.castShadow = true; m.receiveShadow = true;
        const pm = wandGeometrie(p).koerperMitte; // 107-01: parapet follows the hull reference line
        m.position.set(pm.x, p.elevation + p.height / 2, pm.z);
        m.rotation.y = -Math.atan2(p.b.z - p.a.z, p.b.x - p.a.x);
        m.userData.layer = "attika"; m.userData.kind = "parapet";
        t.buildingGroup.add(m);
      });
    }

    // Globale Dachform über dem Footprint (Sattel/Walm/Pult) auf der obersten Decke
    if (dachform && dachform !== "flach") {
      const roofMat = renderMode
        ? new THREE.MeshStandardMaterial({ color: 0x8a5a44, roughness: 0.85, side: THREE.DoubleSide }) // Ziegelrot im Render
        : new THREE.MeshStandardMaterial({ color: 0xb05a3c, roughness: 0.85, side: THREE.DoubleSide });
      // 107-10: roof library (shed: slope as set, see there); 108-01: eaves from globaleTraufhoehe_m (one function for 3D, IFC, section)
      const dd = globalesDach(model, dachform, dachneigung, gs);
      const roof = dd && dd.ok ? dachMesh(dd, roofMat, wallMat, giebel.profile.size > 0) : null; // 108-03: gable = the hull wall itself (profile); without profiles the triangle in the facade material
      if (roof) {
        roof.traverse((c) => { c.userData.layer = "attika"; c.userData.kind = "globalroof"; });
        t.buildingGroup.add(roof);
      }
      // 108-13: dormers on the global roof — faces from gauben.js (front, cheeks, dormer roof), window as a dark pane on the front; an
      // overlay on the roof faces (no CSG cut). A dormer the library refuses (gable edge, front under the roof) is left out; the inspector says why.
      const wandMat = new THREE.MeshStandardMaterial({ color: renderMode ? 0xe7e2d6 : 0xd9d4c7, roughness: 0.9, side: THREE.DoubleSide });
      const glasMat = new THREE.MeshStandardMaterial({ color: 0x5b7f9a, roughness: 0.2, metalness: 0.3, side: THREE.DoubleSide });
      gauben.forEach((g) => {
        const erg = gaubeBerechnen(g, model, dd, gs);
        if (!erg.ok) return;
        const grp = new THREE.Group();
        for (const fl of erg.flaechen) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(gaubenDreiecke({ ...erg, flaechen: [fl] }), 3));
          geo.computeVertexNormals();
          const m = new THREE.Mesh(geo, fl.id === "dach" ? roofMat : wandMat); m.castShadow = true; m.receiveShadow = true;
          m.userData.layer = "attika"; m.userData.kind = "gaube"; m.userData.id = g._idx; m.userData.teil = fl.id;
          grp.add(m);
        }
        if (erg.fenster) {
          const geo = new THREE.BufferGeometry();
          // the pane 2 cm in front of the dormer front (towards the outside = away from the ridge line)
          const n = { x: erg.frontLinie[0].x - erg.grundriss[3].x, z: erg.frontLinie[0].z - erg.grundriss[3].z };
          const nl = Math.hypot(n.x, n.z) || 1;
          const pts = erg.fenster.punkte3d.map((p) => ({ x: p.x + (n.x / nl) * 0.02, y: p.y, z: p.z + (n.z / nl) * 0.02 }));
          geo.setAttribute("position", new THREE.Float32BufferAttribute(gaubenDreiecke({ ...erg, flaechen: [{ id: "front", punkte3d: pts }] }), 3));
          geo.computeVertexNormals();
          const m = new THREE.Mesh(geo, glasMat);
          m.userData.layer = "openings"; m.userData.kind = "gaube"; m.userData.id = g._idx; m.userData.teil = "fenster";
          grp.add(m);
        }
        t.buildingGroup.add(grp);
      });
    }

    applyLayerVisibility(t, layersRef.current);
    // Hülle wurde neu gebaut — Aura auf Hüllwand/Auto-Fenster wiederherstellen
    applyPickHighlight(t, selectedRef.current, multiSelRef.current);
  }, [model, giebel, envOpenings, autoOpenings, renderMode, facadePreset, huelleErscheinung, dachform, dachneigung, customSlabs, customStairs, gauben, gs, durchbruchLoecher, vSolidsAktuell, seoJeSchluessel]);

  // Kamera nur bei Modelländerung neu ausrichten (nicht bei jeder Öffnung)
  useEffect(() => {
    const t = three.current; if (!t.target) return;
    const bb = modelBBox(model);
    const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, bb.height);
    t.target.set((bb.minX + bb.maxX) / 2, bb.height / 2, (bb.minZ + bb.maxZ) / 2);
    orbit.current.radius = Math.max(35, span * 2.2);
  }, [model]);

  // ---- Custom-Elemente (gezeichnete Wände/Stützen) in 3D ----
  useEffect(() => {
    const t = three.current; if (!t.customGroup) return;
    t.hoverLoeschen?.(); // 106-01: see above
    while (t.customGroup.children.length) { const c = t.customGroup.children.pop(); objektFreigeben(c); }
    customWalls.forEach((w) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.05) return;
      const h = wandHoehe(w, gs), elev = unterkante(w, gs);
      // 107-01: normal, thickness, offset and middle from the one derivation (bauteil/referenz.js)
      const g = wandGeometrie(w);
      const nx = g.normale.x, nz = g.normale.z;
      const comp = compositeById(w.composite);
      const total = g.dicke_m;
      const o = g.versatz_m;
      const cx = g.mitte.x, cz = g.mitte.z;
      const rotY = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
      const myWins = customWindows.filter((cw) => cw.wallIdx === w._idx);
      const meineLoecher = durchbruchLoecher.filter((l) => l.schluessel === `cw:${w._idx}`);
      // 107-09: the intersected solid replaces the wall body (the glazing below stays); today's body is the preview and the fallback
      const vs = seoSolid(`cw:${w._idx}`) || (comp ? vSolidsAktuell?.waende.get(`cw:${w._idx}`) : null); // 107-10: a wall cut under a roof first
      if (vs?.geometrie) {
        const zugewiesen = materialFuerSchluessel(w.erscheinung, len);
        const m = zugewiesen
          ? solidMesh(vs, null, zugewiesen)
          : comp ? solidMesh(vs, comp) : solidMesh(vs, null, new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 }));
        m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
        if (!comp) m.userData.eigenesMaterial = true; // review 107-12: one own material (a wall without build-up = one core layer)
        strukturVorbereiten(m, w, tragendVon(w), strukturRef.current); // 107-12
        t.customGroup.add(m);
      }
      if (myWins.length || meineLoecher.length) {
        // Wand mit echten Öffnungen (einschichtig dargestellt) + Verglasung/Türblatt je Öffnung
        // 107-04: sizes of the record (own width/height/sill first), plus the executed penetrations of the openings planning in this wall
        const ops = [...myWins.map((cw) => { const ty = masseAmWand(cw, w, elev); return { u: cw.u, sill: ty.sill, width: ty.w, height: ty.h }; }),
          ...meineLoecher.map((l) => ({ u: l.u, sill: l.sill, width: l.width, height: l.height, rund: l.rund }))];
        if (vs?.geometrie) { /* 107-09: body from the solid above */ } else if (comp) {
          // Loch durch jede Schicht schneiden (mehrschichtig + Öffnung) — 107-04: one function for drawn and hull walls
          // 107-02: elevation = lower edge (storey + offset); a drawn wall has none stored
          buildSchichtWand({ ...w, height: h, elevation: elev }, comp, ops, materialFuerSchluessel(w.erscheinung, len)).forEach((m) => {
            m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
            strukturVorbereiten(m, w, tragendVon(w), strukturRef.current); // review 107-12
            t.customGroup.add(m);
          });
        } else {
          const wallMat = materialFuerSchluessel(w.erscheinung, len) || new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
          const m = buildWallMeshWithHoles({ ...w, height: h, elevation: elev }, wallMat, ops, total);
          m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
          m.userData.eigenesMaterial = true; strukturVorbereiten(m, w, tragendVon(w), strukturRef.current); // review 107-12
          t.customGroup.add(m);
        }
        const glassStd = new THREE.MeshStandardMaterial({ color: 0x7fb6d6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
        const frameStd = new THREE.MeshStandardMaterial({ color: 0x3b4654, roughness: 0.6 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.7 });
        myWins.forEach((cw) => {
          if (istOeffnungOhneFuellung(cw)) return; // 107-04: an opening without a filling is only the hole
          const ty = typAmWand(cw, w, elev);
          const glassMat = materialFuerSchluessel(cw.glas, ty.w, true) || glassStd;
          const frameMat = materialFuerSchluessel(cw.rahmen, ty.w) || frameStd;
          const g = buildGlazing(ty, oeffnungMitte_m(cw.u, ty.w, len), glassMat, frameMat, cw.kind, leafMat); // position kept in the wall like the hole and the IFC
          g.position.set(w.a.x + nx * o, elev, w.a.z + nz * o);
          g.rotation.y = rotY;
          g.traverse((c) => { if (c.isMesh) { c.userData.layer = "openings"; c.userData.kind = cw.kind; c.userData.id = cw._idx; } });
          t.customGroup.add(g);
        });
      } else if (vs?.geometrie) {
        // 107-09: body from the solid above
      } else if (comp) {
        // Schichten von außen (+n) nach innen stapeln
        let cur = o + total / 2;
        comp.skins.forEach((sk, si) => {
          const tk = sk.thickness / 1000; const mid = cur - tk / 2;
          const aussen = si === 0 ? materialFuerSchluessel(w.erscheinung, len) : null;
          const mat = aussen || new THREE.MeshStandardMaterial({ color: new THREE.Color(sk.color), roughness: 0.9 });
          const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, Math.max(0.005, tk)), mat);
          m.castShadow = true; m.receiveShadow = true;
          m.position.set(cx + nx * mid, elev + h / 2, cz + nz * mid);
          m.rotation.y = rotY;
          m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
          m.userData.schicht = si; m.userData.eigenesMaterial = true; strukturVorbereiten(m, w, tragendVon(w), strukturRef.current); // review 107-12
          t.customGroup.add(m);
          cur -= tk;
        });
      } else {
        const mat = materialFuerSchluessel(w.erscheinung, len) || new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, total), mat);
        m.castShadow = true; m.receiveShadow = true;
        m.position.set(cx + nx * o, elev + h / 2, cz + nz * o);
        m.rotation.y = rotY;
        m.userData.layer = "walls"; m.userData.kind = "wall"; m.userData.id = w._idx;
        m.userData.eigenesMaterial = true; strukturVorbereiten(m, w, tragendVon(w), strukturRef.current); // review 107-12: a plain wall = one core layer
        t.customGroup.add(m);
      }
    });
    // Eckfüller (Wand-Cleanup an Berührungspunkten) — 107-01: sits on the body corner, not on the line end
    // 107-09: with the switch the corners of walls drawn from their solid are closed by it — no filler there. Review 107-09: only walls
    // whose solid is really drawn; while it is computed or after a failed comparison the layer boxes come back and keep their filler
    eckfueller(vSolidsAktuell ? customWalls.filter((w) => !vSolidsAktuell.waende.get(`cw:${w._idx}`)?.geometrie) : customWalls, undefined, gs).forEach((f) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.85 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(f.dicke_m, f.hoehe_m, f.dicke_m), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(f.x, f.unterkante_m + f.hoehe_m / 2, f.z);
      m.userData.layer = "walls"; m.userData.kind = "wall";
      t.customGroup.add(m);
    });
    customColumns.forEach((c) => {
      const elev = unterkante(c, gs), s = c.size || 0.4, hc = stuetzenHoehe(c, gs);
      const mat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, hc, s), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(c.x, elev + hc / 2, c.z);
      m.userData.layer = "columns"; m.userData.kind = "column"; m.userData.id = c._idx;
      t.customGroup.add(m);
    });
    // Decken (gezeichnete Slabs) — Polygon extrudiert, 107-02: Dicke/Bezug aus dicke_m/bezug (Standard 0,22 m, Oberkante = Geschossdecke)
    customSlabs.forEach((s) => {
      if (!s.points || s.points.length < 3) return;
      const shape = new THREE.Shape();
      s.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      // 107-04: holes of the slab (`oeffnungen: [{points}]`, plan polygon in m), non-destructive like the wall holes (Shape.holes, no CSG)
      (Array.isArray(s.oeffnungen) ? s.oeffnungen : []).forEach((loch) => {
        if (!Array.isArray(loch?.points) || loch.points.length < 3) return;
        const path = new THREE.Path();
        loch.points.forEach((p, i) => (i ? path.lineTo(p.x, -p.z) : path.moveTo(p.x, -p.z)));
        path.closePath();
        shape.holes.push(path);
      });
      const lage = deckenLage(s, gs, "decke");
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.85 });
      // 107-09: a slab with a build-up shortened by the wall cores (solid of solidAbleitung.deckenSolid) once its comparison passed
      const ds = vSolidsAktuell?.decken.get(`decke:${s._idx}`);
      let m;
      if (ds?.geometrie) {
        m = new THREE.Mesh(ds.geometrie.clone(), mat); m.castShadow = true; m.receiveShadow = true;
        m.position.set(ds.platzierung.ursprung.x, ds.platzierung.ursprung.y, ds.platzierung.ursprung.z);
      } else {
        const geo = new THREE.ExtrudeGeometry(shape, { depth: lage.dicke_m, bevelEnabled: false });
        m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
        m.rotation.x = -Math.PI / 2; m.position.y = lage.unterkante_m;
      }
      m.userData.layer = "shell"; m.userData.kind = "cslab"; m.userData.id = s._idx;
      t.customGroup.add(m);
    });
    // 108-06: stairs — one box per tread (treppeKoerper: tread width × depth, massive down to the flight plate [ASSUMED]), placed along the
    // direction of ascent from the antritt on the floor of `level`; picked as one element (kind "stair")
    const stairMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a7, roughness: 0.8 });
    customStairs.forEach((st) => {
      if (!st?.start) return;
      const lvl = Math.round(Number(st.level) || 0);
      const erg = treppeBerechnen(st, geschosshoehe(lvl, gs));
      const y0 = elevationOf(lvl, gs);
      const ang = -Math.atan2(erg.richtung.z, erg.richtung.x);
      const b = Math.max(0.1, Number(st.breite_m) || 1);
      treppeKoerper(erg).forEach((k) => {
        const geo = new THREE.BoxGeometry(k.d1_m - k.d0_m, k.oben_m - k.unten_m, b);
        const m = new THREE.Mesh(geo, stairMat); m.castShadow = true; m.receiveShadow = true;
        const dm = (k.d0_m + k.d1_m) / 2;
        m.position.set(st.start.x + erg.richtung.x * dm, y0 + (k.unten_m + k.oben_m) / 2, st.start.z + erg.richtung.z * dm);
        m.rotation.y = ang;
        m.userData.layer = "walls"; m.userData.kind = "stair"; m.userData.id = st._idx;
        t.customGroup.add(m);
      });
    });
    // Dächer (Satteldach über Polygon-BBox)
    customRoofs.forEach((rf) => {
      if (!rf.points || rf.points.length < 3) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.9, side: THREE.DoubleSide });
      // 107-02: eaves = elevation of level + 1 (+ bezug/dicke_m of the roof plate), ridge rise from firsthoehe_m / neigung_grad
      // A slope of 0° (or rise 0) is a FLAT roof, as the data sheet and the IFC say: no `|| 2.5` fallback any more (dachFirsthoehe_m already
      // defaults to 2.5 m when the roof has no field at all) — a flat roof is drawn as a plate of the roof thickness, not as a gable.
      // 107-10: form from the optional field `form` (absent = the gable drawn since phase 14), faces from the roof library
      const lage = deckenLage(rf, gs, "dach"), { dach: rdach, anstieg_m: rise } = dachVonDachelement(rf);
      const dd = rdach.form !== "flach" && rise > 0.005 ? dachBerechnen(rf.points, rdach, { traufhoehe_m: lage.unterkante_m, anstieg_m: rise }) : null;
      let m;
      if (dd && dd.ok) m = dachMesh(dd, mat);
      else {
        const shape = new THREE.Shape();
        rf.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
        shape.closePath();
        m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: lage.dicke_m, bevelEnabled: false }), mat);
        m.rotation.x = -Math.PI / 2; m.position.y = lage.unterkante_m;
        m.castShadow = true; m.receiveShadow = true;
      }
      m.userData.layer = "attika"; m.userData.kind = "croof"; m.userData.id = rf._idx;
      t.customGroup.add(m);
    });
    // Räume/Zonen als Bodenfläche (dünne Extrusion) je Geschoss
    customZones.forEach((z) => {
      if (!z.points || z.points.length < 3) return;
      const shape = new THREE.Shape();
      z.points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      const belag = bodenBelag(z.belag);
      const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
      const breite = Math.max(...xs) - Math.min(...xs);
      // ExtrudeGeometry writes the cap UV in shape metres, not 0–1. The repeat is one catalogue span.
      const mat = (belag?.sicht && materialFuerSchluessel(belag.sicht.schluessel, breite, false, "meter"))
        || new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.9, transparent: true, opacity: 0.35 });
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true;
      m.rotation.x = -Math.PI / 2; m.position.y = unterkante(z, gs) + 0.04;
      m.userData.layer = "zones"; m.userData.kind = "zone"; m.userData.id = z._idx;
      t.customGroup.add(m);
    });
    // 107-04: planned penetrations (not yet executed) as translucent boxes / cylinders at their place; not pickable (they sit in the wall surface)
    durchbruchVormerkungen.forEach((v) => {
      const geo = v.rund ? new THREE.CylinderGeometry(v.b / 2, v.b / 2, v.tiefe, 24) : new THREE.BoxGeometry(v.b, v.h, v.tiefe);
      if (v.rund) geo.rotateX(Math.PI / 2); // cylinder axis across the wall
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.8, transparent: true, opacity: 0.45 }));
      m.position.set(v.x, v.y, v.z); m.rotation.y = -v.ang;
      m.raycast = () => {};
      m.userData.layer = "openings"; m.userData.kind = "durchbruch"; m.userData.id = v.nr;
      t.customGroup.add(m);
    });
    // 97-04b: in 3D, walls and columns with a decided status take its colour (one table:
    // Bestand grey, Neubau red, Abbruch yellow); elements without status keep their material.
    // Selection still highlights through the emissive channel.
    t.customGroup.children.forEach((m) => {
      const el = m.userData?.kind === "wall" ? customWalls.find((w) => w._idx === m.userData.id)
        : m.userData?.kind === "column" ? customColumns.find((c) => c._idx === m.userData.id) : null;
      const st = el?.status;
      // An assigned appearance stays visible. Status colour remains the view for
      // elements that have no catalogue surface (today's behaviour).
      if ((st === "bestand" || st === "abbruch" || st === "neubau" || st === "temporaer") && m.material?.color && !el?.erscheinung) {
        m.material.color.set(statusFarbe(st));
        m.userData.status = st;
      } else if (st) m.userData.status = st;
    });
    applyLayerVisibility(t, layersRef.current);
    applyPickHighlight(t, selectedRef.current, multiSelRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWalls, customColumns, customWindows, customZones, customSlabs, customRoofs, customStairs, storeyHeight, gs, aufbautenKey, model, durchbruchLoecher, durchbruchVormerkungen, vSolidsAktuell, seoJeSchluessel]);

  // 3D-Auswahl hervorheben (Aura: emissive + pulsierende Kontur, inkl. Mehrfachauswahl)
  useEffect(() => { applyPickHighlight(three.current, selected, multiSel); }, [selected, multiSel]);
  // 106-03: the element group was rebuilt above - draw the previews of open proposals again (before the next frame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { vorschauAlleNeu(); }, [customWalls, customColumns, customWindows, customZones, customSlabs, customRoofs, customStairs, gauben, storeyHeight, gs, view]);

  // Räume in die gemeinsame Quelle spiegeln (Massing-Studio zeigt sie dann mit an).
  // KD-18: NICHT unkonditional überschreiben. Der Store enthält auch die Zonen des
  // Wohnungsplaners (Marker „ ·W", siehe apartments.js) und der Wohnungs-Werkstatt
  // (Marker „ ·WT", siehe tesselierung.js, Phase 61) — die bleiben erhalten und
  // werden mit den eigenen Zonen zusammengeführt. Vorher wären sie nach einem
  // Wechsel in den BIM-Reiter still verworfen (beim Mount ist customZones leer).
  useEffect(() => {
    // Solange das Modell noch lädt, ist customZones leer — dann nicht spiegeln,
    // sonst verschwinden die eigenen Zonen kurz aus dem Store.
    if (loadingRef.current && !customZones.length) return;
    // Phase 43: id = persistentes _idx — stabiler Raumschlüssel (Möblierung überlebt das Umbenennen).
    const eigene = customZones.map((z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx }));
    const fremde = (buildingProgram.get().zones || []).filter((z) => istGeneriert(z) || istWerkstattZone(z));
    const naechste = [...eigene, ...fremde];
    // Store nur schreiben, wenn sich wirklich etwas ändert (kein Ping-Pong).
    const alt = buildingProgram.get().zones || [];
    if (JSON.stringify(alt) === JSON.stringify(naechste)) return;
    bp.set({ zones: naechste });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customZones]);

  // Callbacks aus den 3D-Maus-Handlern (links = wählen, rechts = Kontextmenü)
  three.current.cb = {
    select: (hit) => {
      setCtxMenu(null);
      if (hit && hit.kind === "wall") setSelected({ type: "wall", index: hit.id });
      else if (hit && hit.kind === "column") setSelected({ type: "column", index: hit.id });
      else if (hit && (hit.kind === "window" || hit.kind === "door") && hit.id != null) setSelected({ type: "opening", index: hit.id, scope: hit.scope || "custom" });
      else if (hit && hit.kind === "zone" && hit.id != null) setSelected({ type: "zone", index: hit.id });
      else if (hit && hit.kind === "cslab" && hit.id != null) setSelected({ type: "slab", index: hit.id });
      else if (hit && hit.kind === "croof" && hit.id != null) setSelected({ type: "roof", index: hit.id });
      else if (hit && hit.kind === "stair" && hit.id != null) setSelected({ type: "stair", index: hit.id }); // 108-06
      else if (hit && hit.kind === "gaube" && hit.id != null) setSelected({ type: "gaube", index: hit.id }); // 108-13
      else if (hit && hit.kind === "wallShell") setSelected({ type: "hullwall", level: hit.level ?? 0, edge: hit.edge ?? 0 });
      else if (hit && (hit.kind === "window" || hit.kind === "door") && hit.scope === "auto") setSelected({ type: "autowin", kind: hit.kind, level: hit.level ?? 0, edge: hit.edge ?? 0 });
      else setSelected(null);
    },
    context: (hit, x, y) => setCtxMenu(hit ? { x, y, hit } : null),
    // 107-04 (spec I.4 Glue-To, part IV "push a rectangle through"): with the tool window / door / oeffnung a click on a wall face in 3D places the
    // opening through the same function as the plan click (neueOeffnung). Window and door take the type size at the clicked position; the tool
    // "oeffnung" takes TWO clicks on the same wall face (rectangle: position, sill, width, height from the corners in wall coordinates) or on a
    // slab (a hole of the slab, no CSG). Returns true when the click was consumed — the studio then does not select.
    platziere: (/** @type {any} */ treffer) => {
      if (view !== "3d" || !(tool === "window" || tool === "door" || tool === "oeffnung")) return false;
      const ud = treffer?.objekt?.userData || null, p = treffer?.punkt;
      if (!ud || !p) { ecke3dRef.current = null; setHint(tz("Keine Fläche getroffen — Fenster, Türen und Öffnungen brauchen eine Wandfläche")); return true; }
      if (ud.kind === "wall" || ud.kind === "wallShell") {
        const wirt = wirtVon(ud.kind === "wall" ? { wallIdx: ud.id } : { level: ud.level, edge: ud.edge }, wirtModell);
        if (!wirt) { setHint(tz("Wand nicht gefunden")); return true; }
        const wp = wandPunkt(wirt.wand.a, wirt.wand.b, wirt.wand.unterkante_m, p);
        if (tool !== "oeffnung") {
          const typeId = tool === "door" ? doorType : winType;
          oeffnungSetzen(neueOeffnung({ wirt, u: wp.u, kind: tool, typeId, idx: idRef.current++ }));
          setHint("");
          return true;
        }
        const e = ecke3dRef.current;
        if (!e || e.art !== "wand" || e.schluessel !== wirt.schluessel) {
          ecke3dRef.current = { art: "wand", schluessel: wirt.schluessel, p: wp };
          setHint(tz("Öffnung: zweite Ecke auf derselben Wandfläche klicken"));
          return true;
        }
        ecke3dRef.current = null;
        const r = rechteckAufWand(e.p, wp, wirt.wand.laenge_m, wirt.wand.hoehe_m);
        if (!r) { setHint(tz("Rechteck zu klein (mindestens 10 cm je Seite)")); return true; }
        oeffnungSetzen(neueOeffnung({ wirt, u: r.u, kind: "oeffnung", typeId: "oeffnung", masse: { width: r.width, height: r.height, sill: r.sill }, idx: idRef.current++ }));
        setHint("");
        return true;
      }
      if (ud.kind === "cslab" && tool === "oeffnung") {
        const punkt = { x: p[0], z: p[2] };
        const e = ecke3dRef.current;
        if (!e || e.art !== "decke" || e.schluessel !== ud.id) {
          ecke3dRef.current = { art: "decke", schluessel: ud.id, p: punkt };
          setHint(tz("Deckenöffnung: zweite Ecke auf derselben Decke klicken"));
          return true;
        }
        ecke3dRef.current = null;
        const loch = deckenLochRechteck(e.p, punkt);
        if (!loch) { setHint(tz("Rechteck zu klein (mindestens 10 cm je Seite)")); return true; }
        const decke = customSlabs.find((s) => s._idx === ud.id);
        if (!decke || !lochInDecke(loch, decke.points)) { setHint(tz("Deckenöffnung: das Rechteck muss ganz auf der Decke liegen")); return true; }
        const alt = Array.isArray(decke.oeffnungen) ? decke.oeffnungen : [];
        if (lochUeberlappt(loch, alt)) { setHint(tz("Deckenöffnung: das Rechteck überschneidet eine andere Öffnung der Decke")); return true; }
        // own id per hole (unique within the slab): the IFC GUID hangs on it, not on the list position
        const lochId = alt.reduce((m, l) => Math.max(m, Number(l?.id) || 0), 0) + 1;
        setCustomSlabs((ss) => ss.map((s) => (s._idx === ud.id ? { ...s, oeffnungen: [...(Array.isArray(s.oeffnungen) ? s.oeffnungen : []), { points: loch, id: lochId }] } : s)));
        setHint("");
        return true;
      }
      ecke3dRef.current = null;
      setHint(tz(tool === "oeffnung" ? "Öffnungen gehören in eine Wand oder eine gezeichnete Decke" : "Fenster und Türen gehören in eine Wand"));
      return true;
    },
    // 106-01: which element is this mesh? Reads the userData tags and the element arrays (bauteilInfoAus,
    // unit-tested); null for anything that is no element of the model (context buildings, parapet,
    // corner fillers): refused. Hull walls carry the GUID the IFC export gives them.
    bauteilInfo: (ud) => bauteilInfoAus(ud, { customWalls, customColumns, customZones, customSlabs, customRoofs, customStairs, gauben }, { projektId: projectId || null, uebersetze: tz }),
  };

  // ---- Context buildings (echte OSM-Umgebung, extrudiert) ----
  useEffect(() => {
    const t = three.current; if (!t.contextGroup) return;
    while (t.contextGroup.children.length) { const c = t.contextGroup.children.pop(); objektFreigeben(c); }
    if (!showContext) return;
    if (osm.buildings?.length) {
      const ctxMat = new THREE.MeshStandardMaterial({ color: 0x6b7785, roughness: 0.95 });
      osm.buildings.forEach((b) => {
        try { const mesh = extrudeFootprint(b.points, b.height || 9, ctxMat); mesh.userData.layer = "context"; t.contextGroup.add(mesh); } catch (_) { /* skip kaputte Polygone */ }
      });
    }

    // ---- Echte Umgebung: Grünflächen, Straßen, Wege, Bäume (alles Ebene "context") ----
    // Grünflächen (flache Polygone, y=0.015)
    if (env.greens?.length) {
      const greenMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 1, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      env.greens.forEach((poly) => {
        if (!poly || poly.length < 3) return;
        try {
          const shape = new THREE.Shape();
          poly.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
          shape.closePath();
          const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), greenMat);
          m.rotation.x = -Math.PI / 2; m.position.y = 0.015;
          m.receiveShadow = true; m.userData.layer = "context";
          t.contextGroup.add(m);
        } catch (_) { /* kaputtes Polygon überspringen */ }
      });
    }

    // Straßen + Gehwege als flache Segment-Bänder (max. ~800 Segmente gesamt)
    const streetMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95 });
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.95 });
    let segBudget = 800;
    const addRibbon = (lines, mat, y, defWidth) => {
      (lines || []).forEach((line) => {
        const pts = line?.pts; if (!pts || pts.length < 2) return;
        const width = Math.max(0.5, line.width || defWidth);
        for (let i = 0; i < pts.length - 1 && segBudget > 0; i++) {
          const a = pts[i], b = pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len < 0.1) continue;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), mat);
          // Rotationsreihenfolge YXZ: erst Gieren (Welt-Y) ausrichten, dann flach in die XZ-Ebene kippen
          m.rotation.order = "YXZ";
          m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
          m.rotation.x = -Math.PI / 2;
          m.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
          m.receiveShadow = true; m.userData.layer = "context";
          t.contextGroup.add(m);
          segBudget--;
        }
      });
    };
    addRibbon(env.streets, streetMat, 0.03, 6);
    addRibbon(env.paths, pathMat, 0.045, 2);

    // Bäume (max. 150): Stamm + Krone
    if (env.trees?.length) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c5a3a, roughness: 1 });
      const crownMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 1, transparent: true, opacity: 0.95 });
      const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.2);
      const crownGeo = new THREE.SphereGeometry(1.6, 8, 6);
      env.trees.slice(0, 150).forEach((tr) => {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(tr.x, 1.1, tr.z);
        trunk.castShadow = true; trunk.userData.layer = "context";
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.set(tr.x, 3.2, tr.z);
        crown.castShadow = true; crown.userData.layer = "context";
        t.contextGroup.add(trunk, crown);
      });
    }

    applyLayerVisibility(t, layersRef.current);
  }, [osm.buildings, showContext, env.streets, env.paths, env.trees, env.greens]);

  // ---- Render-Modus: Atmosphaere (Himmel, Nebel, Hemisphaere, Sonnenstand) ----
  useEffect(() => {
    const t = three.current; if (!t.scene || !t.sun) return;
    if (renderMode) {
      t.scene.background = new THREE.Color(0x87ceeb); // hellblauer Himmel
      t.scene.fog = new THREE.Fog(0xcfe8f5, 260, 1100); // weiche Tiefe
      if (!t.hemi) { t.hemi = new THREE.HemisphereLight(0xbfdcff, 0xcdb89a, 0.75); t.scene.add(t.hemi); }
      t.ambient.intensity = 0.2;
      const s = sunFromHour(sunHour);
      t.sun.position.set(s.pos.x, s.pos.y, s.pos.z);
      t.sun.color.copy(s.color);
      t.sun.intensity = s.intensity;
      // Konstruktionshilfen im Praesentationsmodus ausblenden
      if (t.grid10) t.grid10.visible = false;
      if (t.axes) t.axes.visible = false;
    } else {
      // Editor-Standard wiederherstellen (heller Tageshimmel)
      t.scene.background = new THREE.Color(0xcfe1f0);
      t.scene.fog = new THREE.Fog(0xcfe1f0, 600, 1800);
      if (t.hemi) { t.scene.remove(t.hemi); t.hemi.dispose?.(); t.hemi = null; }
      t.ambient.intensity = 0.55;
      t.sun.color.set(0xfff4e0); t.sun.intensity = 1.1;
      t.sun.position.set(60, 120, 40);
      if (t.grid10) t.grid10.visible = true;
      if (t.axes) t.axes.visible = true;
    }
  }, [renderMode, sunHour]);

  // ---- Render-Modus: belebte Stadt (Autos auf Straßen, Fußgänger auf Wegen) ----
  useEffect(() => {
    const t = three.current; if (!t.scene || !renderMode) return;
    if (!(env.streets?.length || env.paths?.length)) return;
    const city = createCityLife(env.streets, env.paths, { cars: 16, peds: 16 });
    if (!city.items.length) { city.dispose(); return; }
    t.scene.add(city.group);
    animRef.current = city.items; // tick() bewegt die Figuren (dt-basiert)
    return () => {
      animRef.current = [];
      t.scene.remove(city.group);
      city.dispose();
    };
  }, [renderMode, env.streets, env.paths]);

  // ---- Ebenen-Sichtbarkeit live anwenden ----
  useEffect(() => { applyLayerVisibility(three.current, layers); }, [layers]);

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Boxes className="w-4 h-4 text-emerald-600" /> Gebäudemodell
            <span className="text-slate-400 font-normal">· 1 Einheit = 1 m · ein Modell</span>
            {/* BIM 2.0: Persistenz-Status (Auto-Save je Projekt) */}
            {speichernWartet && saveState !== "loading" ? (
              <span data-testid="speichern-wartet" className="text-[10px] font-normal px-1.5 py-0.5 rounded-full border border-dashed border-warnung bg-warnung-flaeche text-warnung"
                title={tz("Ein Teil des Modells wird erst nach Ihrer Entscheidung im Konflikt gespeichert")}>
                ▲ {tz("wartet auf Entscheidung")}
              </span>
            ) : null}
            <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full border ${
              saveState === "saved" ? "text-emerald-600 border-emerald-200 bg-emerald-50"
              : saveState === "saving" || saveState === "loading" ? "text-amber-600 border-amber-200 bg-amber-50"
              : saveState === "error" ? "text-rose-600 border-rose-200 bg-rose-50"
              : "text-slate-400 border-slate-200"}`}
              title="Modell wird automatisch je Projekt gespeichert (BimModel)">
              {saveState === "saved" ? "✓ gespeichert" : saveState === "saving" ? "speichert…" : saveState === "loading" ? "lädt…" : saveState === "error" ? "Speicherfehler" : "Auto-Save"}
            </span>
            {!hatGespeichertesModell && saveState !== "loading" && (
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full border text-amber-700 border-amber-300 bg-amber-50"
                title="Für dieses Projekt existiert kein gespeichertes Gebäudemodell. Die Ansicht zeigt die Editor-Voreinstellungen (Geschosse/Höhe/Dach) — KEIN erfasster Bestand. Erst eine Änderung speichert.">
                ⚠ kein gespeichertes Modell — Ansicht zeigt Editor-Defaults
              </span>
            )}
          </div>
          {/* Ansicht-Umschalter: 3D · Grundriss · Schnitt (alle aus demselben Modell) */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden text-xs">
            {[
              { id: "3d", label: "3D", icon: Box },
              { id: "grundriss", label: "Grundriss", icon: Grid2x2 },
              { id: "schnitt", label: "Schnitt", icon: Scissors },
            ].map((v) => (
              <button key={v.id} onClick={() => setView(v.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 ${view === v.id ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                aria-pressed={view === v.id} aria-label={`Ansicht ${v.label}`}>
                <v.icon className="w-3.5 h-3.5" /> {v.label}
              </button>
            ))}
            {/* 34-05: parametrisches Zeichnen direkt im Grundriss (BIT Sketcher) */}
            <button onClick={() => (sketchEdit ? stopSketchEdit() : startSketchEdit())}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 border-l border-slate-200 ${sketchEdit ? "bg-teal-600 text-white" : "text-teal-700 hover:bg-teal-50"}`}
              aria-pressed={sketchEdit} aria-label="Sketch bearbeiten" title="Parametrisches Zeichnen (Skizze, Constraint-Modus) im Grundriss">
              ✏ Sketch
            </button>
          </div>
          {/* 108-01: section A-A (along x, as before) / B-B (along z); default across the ridge of a pitched roof, not saved */}
          {view === "schnitt" && (
            <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs" role="group" aria-label={tz("Schnittachse")} data-testid="schnitt-achse">
              {/** @type {Array<["x"|"z", string]>} */ ([["x", "A-A"], ["z", "B-B"]]).map(([a, name]) => (
                <button key={a} type="button" onClick={() => setSchnittAchseWahl(a)} aria-pressed={schnittAchse === a} data-achse={a}
                  title={a === "x" ? tz("Schnitt A-A: entlang x durch die Gebäudemitte") : tz("Schnitt B-B: entlang z durch die Gebäudemitte")}
                  className={`px-2 py-1.5 ${schnittAchse === a ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {tz("Schnitt")} {name}
                </button>
              ))}
            </div>
          )}
          {view !== "3d" && <BrillenLeiste wert={brilleId} onChange={setBrille} t={tz} sw={swPlan} onSw={setSwPlan} />}
          {view !== "3d" && (
            // 97-06: checks against wrong planning on the current state (drawn, workshop, hull, network, openings).
            <FehlplanungHinweise t={tz} befunde={fehlplanungPruefen({
              modell: { customWalls, customColumns, customWindows, envOpenings, customSlabs, customRoofs, netz_layer: netzLayer, bauteil_attribute_layer: attributLayer },
              werkstatt: werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }),
              durchbrueche, projektId: projectId || null, bauart: bauartVon(project).bauart,
              huelle: model.walls, geschosse: gs, // 107-04: check 12 (penetration in its host) also finds hull walls and tests the height
            })} />
          )}
          {sketchEdit && (
            <div className="flex items-center gap-1.5 text-xs">
              <button onClick={() => { setSketchTool("line"); setSketchDraft(null); }}
                className={`px-2 py-1 rounded border ${sketchTool === "line" ? "bg-teal-600 text-white border-teal-600" : "border-slate-300 text-slate-600"}`}
                aria-label="Sketch-Werkzeug Linienzug">Linienzug</button>
              <button onClick={() => { setSketchTool("select"); setSketchDraft(null); }}
                className={`px-2 py-1 rounded border ${sketchTool === "select" ? "bg-teal-600 text-white border-teal-600" : "border-slate-300 text-slate-600"}`}
                aria-label="Sketch-Werkzeug Ziehen">Ziehen</button>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                sketchSolve == null ? "bg-slate-100 text-slate-500"
                : sketchSolve.conflicting.length ? "bg-rose-100 text-rose-700"
                : sketchSolve.dof === 0 ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"}`}>
                {sketchSolverStatus !== "bereit" ? `Solver ${sketchSolverStatus}`
                  : sketchSolve == null ? "—"
                  : sketchSolve.conflicting.length ? "Konflikt"
                  : sketchSolve.dof === 0 ? "voll bestimmt"
                  : `${sketchSolve.dof} DOF offen`}
              </span>
              <Link to="/SketchStudio?modus=constraint" className="text-teal-700 underline text-[11px]"
                title="Constraints, Maße und Parameter in der Skizze (Constraint-Modus) pflegen">In der Skizze öffnen</Link>
            </div>
          )}
          {/* 108-01 (9a): the right group wraps as well — at 1400 px it ran out of the card (overflow-hidden cut the controls off) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0" data-testid="bim-kopf-rechts">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <Layers className="w-3.5 h-3.5" /> Geschosse
              <select value={storeys} onChange={(e) => setStoreys(+e.target.value)}
                className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschosse">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {/* 107-13 (D-BK-20): basements as model storeys (levels −1 … −U); 0 = none, the record never gets the field */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {tz("Untergeschosse")}
              <select value={untergeschosse} onChange={(e) => setUntergeschosse(+e.target.value)} data-testid="untergeschosse"
                className="rounded-md border border-border px-1.5 py-0.5 bg-card" aria-label={tz("Untergeschosse")}>
                {Array.from({ length: MAX_UNTERGESCHOSSE + 1 }, (_, i) => i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Höhe
              {/* range 2–8 m like the per-storey inputs; with a storey table whose heights differ the field still shows the uniform `storeyHeight` and says "uneinheitlich" */}
              <input type="number" min="2" max="8" step="0.1" value={storeyHeight}
                onChange={(e) => setStoreyHeight(+e.target.value)}
                className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschosshöhe" />
              <span className="text-slate-400">m</span>
              {geschosse && new Set(geschosse.map((g) => g.hoehe_m)).size > 1 && (
                <span className="text-muted-foreground underline decoration-dotted" data-testid="geschosshoehe-abweichend" title={tz("Die Geschosse haben verschiedene Höhen (siehe Geschosshöhen); eine Eingabe hier setzt alle Geschosse gleich")}>{tz("uneinheitlich")}</span>
              )}
            </label>
            {/* 107-02 (D-BK-05): own height per storey; the first edit creates the table, "alle gleich" removes it */}
            <details className="relative text-xs text-muted-foreground" data-testid="geschosshoehen">
              <summary className="cursor-pointer select-none rounded-md border border-border px-1.5 py-0.5 bg-card">{tz("Geschosshöhen")}{geschosse ? " ●" : ""}</summary>
              <div className="absolute z-20 mt-1 w-56 rounded-md border border-border bg-card p-2 shadow-lg">
                {ebenenListe(model).map((st) => (
                  <React.Fragment key={st.level}>
                    <label className="flex items-center justify-between gap-2 py-0.5">
                      <span>{st.name}</span>
                      <input type="number" min="2" max="8" step="0.05" value={+geschosshoehe(st.level, gs).toFixed(3)} data-testid={`geschosshoehe-${st.level}`}
                        onChange={(e) => setGeschossHoehe(st.level, +e.target.value)} className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" aria-label={`${tz("Geschosshöhe")} ${st.name}`} />
                    </label>
                    {/* 108-02 (D-EFH-01): knee wall only at the top storey and only under a pitched roof; empty = no knee wall */}
                    {st.level === storeys - 1 && dachform && dachform !== "flach" && (
                      <label className="flex items-center justify-between gap-2 py-0.5 pl-2">
                        <span>{tz("Kniestock")}</span>
                        <input type="number" min="0" max={MAX_KNIESTOCK_M} step="0.05" value={kniestockAus(gs, storeys) ?? ""} data-testid="kniestock"
                          onChange={(e) => setKniestock(e.target.value === "" ? null : Math.max(0, Math.min(MAX_KNIESTOCK_M, +e.target.value)))}
                          className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" aria-label={`${tz("Kniestock")} ${st.name}`} />
                      </label>
                    )}
                  </React.Fragment>
                ))}
                {/* review fix: a stored knee wall does nothing under a flat roof — say so instead of hiding it (it applies again under a pitched roof) */}
                {dachform === "flach" && kniestockAus(gs, storeys) != null && <div className="mt-1 text-[11px] text-muted-foreground" data-testid="kniestock-flachdach">{tz("Kniestock gespeichert, wirkt nur bei geneigtem Dach")}</div>}
                {kniestockVerwaist(geschosse, storeys) && <div className="mt-1 text-[11px] text-warnung" data-testid="kniestock-verwaist">{tz("Kniestock gilt nur für das oberste Geschoss — neu setzen")}</div>}
                {model.kehlbalkenlage_entfallen && <div className="mt-1 text-[11px] text-warnung" data-testid="kehlbalkenlage-entfallen">{tz("Kehlbalkenlage liegt über dem First — entfällt")}</div>}
                {geschosse && <button type="button" className="mt-1 text-[11px] underline" onClick={() => {
                  // 108-02: a knee wall survives the reset — the table becomes storeys × storeyHeight plus the knee wall on the top row
                  const knie = kniestockAus(gs, storeys);
                  if (knie != null) {
                    if (!window.confirm(tz("Der Kniestock bleibt erhalten, die einzelnen Geschosshöhen gehen verloren. Alle Geschosse gleich setzen?"))) return;
                    merken(); bp.set(patchKniestock({ storeys, storeyHeight, geschosse: null }, knie));
                    return;
                  }
                  // the individual heights are lost by the reset: ask first when they differ (107-02 review)
                  if (new Set(geschosse.map((g) => g.hoehe_m)).size > 1 && !window.confirm(tz("Die einzelnen Geschosshöhen gehen verloren. Alle Geschosse gleich setzen?"))) return;
                  merken(); bp.set({ geschosse: null }); // 108-02: one undo step like the storey heights
                }}>{tz("alle gleich (zurücksetzen)")}</button>}
              </div>
            </details>
            {/* 108-02: full-storey rule of the attic storey from the roof geometry (warning only, see vollgeschoss.js) */}
            {vollgeschossDg && vollgeschossDg.voll != null && (
              <span className="text-xs text-muted-foreground" data-testid="vollgeschoss" data-voll={vollgeschossDg.voll ? "ja" : "nein"}
                title={tz("Fläche mit mindestens 2,30 m lichter Höhe bis zu den Dachebenen (ohne Dachaufbau, ab Oberkante Rohdecke), bezogen auf den Umriss. 2/3-Regel nach Landesbauordnung, Werte je Land verschieden (Annahme); die 1,40-m-Regel über Gelände ist nicht geprüft. Hinweis, keine Rechtsauskunft.")}>
                {ebeneName(model, storeys - 1)} · {tz("Vollgeschoss: {{jaNein}} ({{p}} % ≥ 2,30 m)").replace("{{jaNein}}", tz(vollgeschossDg.voll ? "ja" : "nein")).replace("{{p}}", String(Math.round(vollgeschossDg.anteil * 1000) / 10).replace(".", ","))}
              </span>
            )}
            {/* Dachform */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Dach
              <select value={dachform} onChange={(e) => setDachform(e.target.value)}
                className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Dachform">
                <option value="flach">Flachdach</option>
                <option value="sattel">Satteldach</option>
                <option value="walm">Walmdach</option>
                <option value="pult">Pultdach</option>
              </select>
              {dachform !== "flach" && (
                <>
                  <input type="number" min="5" max="60" step="1" value={dachneigung}
                    onChange={(e) => setDachneigung(+e.target.value)}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Dachneigung" />
                  <span className="text-slate-400">°</span>
                  {/* 107-10 review: the global roof goes into the IFC only when switched on (field dachform_ifc, default off) */}
                  <label className="flex items-center gap-1" title={tz("Gebäudedach als geneigte Dachplatten ins IFC schreiben")}>
                    <input type="checkbox" checked={dachIfc} onChange={(e) => { setDachIfc(e.target.checked); hatteDachIfcRef.current = true; }} className="accent-primary" data-testid="dach-ifc" aria-label={tz("Gebäudedach ins IFC")} />
                    {tz("ins IFC")}
                  </label>
                  {/* 108-13: a new Schleppgaube on the first eave edge (gauben.js picks the roof face; a gable edge is refused in the inspector) */}
                  <button type="button" className="rounded-md border border-border px-1.5 py-0.5 bg-card hover:bg-muted" data-testid="gaube-einfuegen" title={tz("Schleppgaube auf dem Gebäudedach einfügen")}
                    onClick={() => {
                      const fp = model.footprint || [];
                      // the first edge that is an eave (its roof face exists); else edge 0 and the inspector says why
                      const kante = fp.map((_, i) => i).find((i) => gaubeBerechnen({ edge: i, u_von_m: 0, u_bis_m: 1 }, model, globalDach, gs).ok) ?? 0;
                      const g = neueGaube(fp, kante, idRef.current++);
                      setGauben((alt) => [...alt, g]);
                      setSelected({ type: "gaube", index: g._idx });
                    }}>{tz("Gaube einfügen")}</button>
                </>
              )}
            </label>
            {/* 108-06: a new straight flight in the current storey (neueTreppe: in the largest room of the level, else the footprint; the user moves it) */}
            <button type="button" className="rounded-md border border-border px-1.5 py-0.5 bg-card text-xs text-muted-foreground hover:bg-muted" data-testid="treppe-einfuegen" title={tz("Gerade Treppe im aktuellen Geschoss einfügen")}
              onClick={() => {
                const lvl = ebeneKlemmen(model, planLevel);
                const raeume = customZones.filter((z) => z.level === lvl && Array.isArray(z.points) && z.points.length >= 3);
                const flaeche = (/** @type {Array<{x: number, z: number}>} */ pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.z - q.x * p.z; }, 0)) / 2;
                const groesster = raeume.sort((a, b) => flaeche(b.points) - flaeche(a.points))[0];
                const t = neueTreppe(groesster ? groesster.points : model.footprint, lvl, geschosshoehe(lvl, gs), idRef.current++);
                setCustomStairs((alt) => [...alt, t]);
                setSelected({ type: "stair", index: t._idx });
              }}>{tz("Treppe einfügen")}</button>
            {/* Attika (Brüstung) — nur beim Flachdach sinnvoll */}
            {dachform === "flach" && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={parapet.enabled} onChange={(e) => setParapet((p) => ({ ...p, enabled: e.target.checked }))} className="accent-emerald-600" aria-label="Attika" />
                Attika
                {parapet.enabled && (
                  <>
                    <input type="number" min="0.1" max="2" step="0.1" value={parapet.height}
                      onChange={(e) => setParapet((p) => ({ ...p, height: +e.target.value }))}
                      className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Attika-Höhe" />
                    <span className="text-slate-400">m</span>
                  </>
                )}
              </label>
            )}
            {/* Eingangstür — Vorgabe, aber konfigurierbar (KD-19) */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600"
              title="Eingangstür der Gebäudehülle. Vorgabe: 1,20 × 2,10 m, mittig (50 %) auf der ersten EG-Kante.">
              {/* 108-01: shows the entrance in effect; using the checkbox stores `enabled` explicitly */}
              <input type="checkbox" checked={eingangAn} data-testid="eingang-auto"
                onChange={(e) => { setEingangSchalterBenutzt(true); setEntranceCfgSchritt((c) => ({ ...c, enabled: e.target.checked })); }}
                className="accent-emerald-600" aria-label="Eingangstür" />
              Eingang
              {eingangAn && (
                <>
                  <input type="number" min="0.8" max="3" step="0.05" value={entranceCfg.width}
                    onChange={(e) => setEntranceCfgSchritt((c) => ({ ...c, width: Math.max(0.8, Math.min(3, +e.target.value || 0.8)) }))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Breite" />
                  <span className="text-slate-400">×</span>
                  <input type="number" min="1.9" max="3" step="0.05" value={entranceCfg.height}
                    onChange={(e) => setEntranceCfgSchritt((c) => ({ ...c, height: Math.max(1.9, Math.min(3, +e.target.value || 1.9)) }))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Höhe" />
                  <span className="text-slate-400">m</span>
                  <select value={entranceCfg.edge ?? ""}
                    onChange={(e) => setEntranceCfgSchritt((c) => ({ ...c, edge: e.target.value === "" ? null : +e.target.value }))}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Kante">
                    <option value="">erste Kante</option>
                    {model.walls.filter((w) => w.level === 0).map((w) => (
                      <option key={w.edge} value={w.edge}>Kante {w.edge + 1}</option>
                    ))}
                  </select>
                  <input type="number" min="0" max="100" step="1" value={Math.round((entranceCfg.uRel ?? 0.5) * 100)}
                    onChange={(e) => setEntranceCfgSchritt((c) => ({ ...c, uRel: Math.max(0, Math.min(100, +e.target.value || 0)) / 100 }))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Eingangstür-Lage" />
                  <span className="text-slate-400">%</span>
                  {entranceCfg.width === ENTRANCE_DEFAULT.width && entranceCfg.height === ENTRANCE_DEFAULT.height
                    && (entranceCfg.uRel ?? 0.5) === ENTRANCE_DEFAULT.uRel && entranceCfg.edge == null
                    && <span className="text-slate-400 italic">Vorgabe</span>}
                </>
              )}
            </label>
            {/* 108-01 (D-EFH-04): stored "on" (old projects) plus an own ground-floor door — a hint, no silent migration; review: hidden once the
                checkbox was used in this session (a deliberate "on" is not asked again) */}
            {entranceCfg.enabled === true && !eingangSchalterBenutzt && eigeneEgTuer(envOpenings) && (
              <span className="flex items-center gap-1.5 text-[11px] text-warnung" data-testid="eingang-hinweis">
                {tz("Eigene Eingangstür vorhanden — automatischen Eingang abschalten?")}
                <button type="button" onClick={() => setEntranceCfgSchritt((c) => ({ ...c, enabled: false }))}
                  className="rounded border border-warnung px-1.5 py-0.5 hover:bg-warnung-flaeche">{tz("Abschalten")}</button>
              </span>
            )}
            {/* Wand-Referenzlinie + Aufbau — beim Zeichnen oder für ausgewählte Wand */}
            {(tool === "wall" || selected?.type === "wall") && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Bezug
                  <select value={selected?.type === "wall" ? (customWalls.find((w) => w._idx === selected.index)?.refLine || "center") : wallRef}
                    onChange={(e) => setWallRefLine(e.target.value)}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Wand-Referenzlinie">
                    {bezugWahl(tz).map(([v, l, h]) => <option key={v} value={v} title={h}>{l}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Aufbau
                  <select value={selected?.type === "wall" ? (customWalls.find((w) => w._idx === selected.index)?.composite || "single24") : wallComp}
                    onChange={(e) => setWallComposite(e.target.value)}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Wand-Aufbau">
                    {aufbautenListe().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </>
            )}
            {view === "grundriss" && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Geschoss
                <select value={ebeneKlemmen(model, planLevel)} onChange={(e) => setPlanLevel(+e.target.value)}
                  className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Geschoss wählen">
                  {ebenenListe(model).map((s) => <option key={s.level} value={s.level}>{s.name}</option>)}
                </select>
              </label>
            )}
            {view === "3d" && (
              <button
                onClick={() => setShowContext((s) => !s)}
                className={`text-xs rounded-md px-2 py-1 border ${showContext ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300"}`}
                aria-label="Umgebungsgebäude ein-/ausblenden">
                Umgebung {osm.loading ? "…" : osm.offline ? "(offline)" : `(${osm.buildings.length})`}
              </button>
            )}
            {/* Render-Modus: Echtzeit-Darstellung mit Himmel, Sonne, Fassade, belebter Stadt */}
            {view === "3d" && (
              <button
                onClick={() => setRenderMode((r) => !r)}
                className={`flex items-center gap-1 text-xs rounded-md px-2 py-1 border ${renderMode ? "bg-sky-600 text-white border-sky-600" : "text-slate-500 border-slate-300"}`}
                aria-pressed={renderMode} aria-label="Render-Modus umschalten"
                title="Render-Modus: Himmel + Sonne, Fassaden-Presets, fahrende Autos und Fußgänger">
                <Sparkles className="w-3.5 h-3.5" /> Render
              </button>
            )}
            {/* BIM-F: Exposé-Render — aktuelle 3D-Ansicht hochauflösend (2×) als PNG (Muster Phase 22) */}
            {view === "3d" && (
              <button onClick={exportExpose}
                className="flex items-center gap-1 text-xs rounded-md px-2 py-1 border border-slate-300 text-slate-500 hover:bg-slate-50"
                aria-label="Exposé-PNG exportieren" title="Exposé-Bild: aktuelle 3D-Ansicht hochauflösend (2×) als PNG herunterladen">
                <Camera className="w-3.5 h-3.5" /> Exposé
              </button>
            )}
            {view === "3d" && (offline
              ? <span className="flex items-center gap-1 text-amber-600 text-xs"><WifiOff className="w-3.5 h-3.5" /> Gelände offline</span>
              : <span className="text-emerald-600 text-xs">Gelände: Open-Meteo</span>)}
            {/* Layer-Kombination (wie ArchiCAD-Statusbar) */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <Layers className="w-3.5 h-3.5" />
              <select value={combo} onChange={(e) => applyCombo(e.target.value)}
                className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Layer-Kombination">
                {Object.keys(LAYER_COMBOS).map((k) => <option key={k} value={k}>{k}</option>)}
                {combo === "Eigene" && <option value="Eigene">Eigene</option>}
              </select>
            </label>
            <button onClick={() => setShowLayers((s) => !s)}
              className={`text-xs rounded-md px-2 py-1 border ${showLayers ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300"}`}
              aria-pressed={showLayers} aria-label="Ebenen-Panel ein-/ausblenden">Ebenen</button>
            {/* Maßstab */}
            <label className="flex items-center gap-1 text-xs text-slate-600">M
              <select value={scale} onChange={(e) => setScale(+e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Maßstab">
                {/* review 107-12: the stages of the one level-of-detail function, 1:20 (detail, door frame, line group 1.0) included */}
                {[...ANSICHT_MASSSTAEBE].reverse().concat(ANSICHT_MASSSTAEBE.includes(scale) ? [] : [scale]).map((m) => <option key={m} value={m}>1:{m}</option>)}
              </select>
            </label>
            {/* Einheit (länderabhängig: m/cm/mm) */}
            <label className="flex items-center gap-1 text-xs text-slate-600">Einheit
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 bg-white" aria-label="Maßeinheit">
                <option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option>
              </select>
            </label>
            <button onClick={() => setShowMappe((s) => !s)}
              className={`text-xs rounded-md px-2 py-1 border ${showMappe ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300"}`}
              aria-pressed={showMappe} aria-label="Mappe ein-/ausblenden" title="Navigator: Zeichen-/Ausschnittmappe + Plan-Output">Mappe</button>
            <button onClick={downloadIFC}
              className="text-xs rounded-md px-2 py-1 border border-slate-300 text-slate-600 hover:bg-slate-50"
              aria-label="Als IFC exportieren" title="Gebäudemodell als IFC (.ifc) exportieren">IFC-Export</button>
            <label className="flex items-center gap-1 text-xs text-muted-foreground" title={tz("IfcRelSpaceBoundary zwischen Räumen und Wänden sowie Brutto- und Netto-Fläche je Raum")}>
              <input type="checkbox" className="accent-primary" checked={raumGrenzenIfc} onChange={(e) => setRaumGrenzenIfc(e.target.checked)} data-testid="ifc-raumgrenzen" aria-label={tz("Raumgrenzen ins IFC")} />
              {tz("Raumgrenzen")}
            </label>
            {/* BIM-D: Hilfe-Popover „Tastaturkürzel" — gespeist aus derselben SHORTCUTS-Map wie der Handler */}
            <span className="relative">
              <button onClick={() => setShowShortcuts((s) => !s)}
                className={`flex items-center gap-1 text-xs rounded-md px-2 py-1 border ${showShortcuts ? "bg-emerald-600 text-white border-emerald-600" : "text-slate-500 border-slate-300 hover:bg-slate-50"}`}
                aria-pressed={showShortcuts} aria-label="Tastaturkürzel anzeigen" title="Tastaturkürzel">
                <Keyboard className="w-3.5 h-3.5" />
              </button>
              {showShortcuts && (
                <div className="absolute right-0 top-full mt-1 z-30 w-[260px] rounded-lg border border-slate-200 bg-white shadow-lg text-xs">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b bg-slate-50 rounded-t-lg">
                    <span className="font-semibold text-slate-700 flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> Tastaturkürzel</span>
                    <button onClick={() => setShowShortcuts(false)} className="text-slate-400 hover:text-slate-700" aria-label="Schließen">✕</button>
                  </div>
                  <div className="py-1">
                    {SHORTCUTS.map((s) => (
                      <div key={s.keys} className="flex items-center justify-between gap-2 px-3 py-1">
                        <kbd className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{s.keys}</kbd>
                        <span className="text-right text-slate-500">{s.desc}</span>
                      </div>
                    ))}
                    <div className="px-3 pt-1.5 pb-1.5 mt-1 text-[10px] text-slate-400 border-t">Kürzel pausieren, solange ein Eingabefeld fokussiert ist.</div>
                  </div>
                </div>
              )}
            </span>
          </div>
        </div>
        <div className="flex" ref={zeichenZeileRef}>
          {/* ---- Werkzeugkasten (ArchiCAD-Stil) ---- */}
          <div className="w-[120px] shrink-0 border-r bg-slate-50/70 py-1 overflow-y-auto" style={{ maxHeight: planHoehe }}>
            {/* ---- BIM-F: Favoriten-Chips über der Werkzeugleiste (localStorage nc-bim-favs, max 6) ---- */}
            <div className="px-1.5 pt-1 pb-1.5 mb-1 border-b border-slate-200">
              <div className="flex items-center justify-between px-0.5 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Favoriten</span>
                <button onClick={() => addFavorite()} className="text-amber-400 hover:text-amber-600"
                  title="Aktuelles Werkzeug (+ Aufbau/Typ) als Favorit speichern (max 6)" aria-label="Favorit speichern">
                  <Star className="w-3.5 h-3.5" />
                </button>
              </div>
              {favs.length === 0
                ? <div className="px-0.5 text-[9px] leading-tight text-slate-400">Werkzeug wählen, dann ★ — oder ★ am Attribute-Panel.</div>
                : <div className="flex flex-wrap gap-1">
                    {favs.map((f, i) => (
                      <button key={`${f.tool}-${f.composite || f.typeId || i}`} onClick={() => applyFavorite(f)}
                        className="max-w-full truncate rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100"
                        title={`Favorit anwenden: ${f.label}`}>{f.label}</button>
                    ))}
                  </div>}
            </div>
            {PALETTE.map((cat, ci) => (
              <div key={ci} className="mb-1">
                {cat.group && <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{cat.group}</div>}
                {cat.items.map((it) => {
                  const active = tool === it.id;
                  const usable = FUNCTIONAL.includes(it.id);
                  return (
                    <button key={it.id} onClick={() => selectTool(it.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left transition-colors
                        ${active ? "bg-emerald-600 text-white" : usable ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100"}`}
                      title={usable ? it.label : `${it.label} (geplant)`} aria-pressed={active}>
                      <it.icon className="w-4 h-4 shrink-0" /> <span className="truncate">{it.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* ---- Zeichenfläche ---- */}
          <div className="flex-1 min-w-0 relative">
            <div ref={mountRef} className="w-full" style={{ height: planHoehe, display: view === "3d" ? "block" : "none" }} />
            {/* 106-01: what is under the pointer, in words; the form (dotted outline) matches the 3D highlight. */}
            <div ref={hoverBoxRef} data-testid="zeigen-hover" style={{ display: "none" }}
              className="pointer-events-none absolute left-0 top-0 z-20 max-w-[16rem] rounded bg-card px-2 py-1 text-xs text-foreground shadow">
              <div ref={hoverTextRef} data-testid="zeigen-hover-text" className="truncate font-medium" />
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span ref={hoverSymbolRef} className="inline-block h-2.5 w-2.5 border-2" style={{ borderColor: ZEIGE_ZUSTAENDE.fokus.hex, borderStyle: ZEIGE_CSS_RAND[ZEIGE_ZUSTAENDE.fokus.umriss] }} />
                <span ref={hoverZustandRef}>{tz(ZEIGE_ZUSTAENDE.fokus.label)}</span>
              </div>
            </div>
            {/* 106-03: proposed changes in words with check and origin, Übernehmen / Verwerfen, and the history of steps. */}
            {/* 106-05: speech and typed sentences; what is understood becomes a proposal card, a change runs only after "ja" by the person. */}
            {/* review 106-07: in the tablet layout both stand FIXED at the bottom of the screen (speech right = thumb, cards left), so they */}
            {/* are reachable without scrolling even when the 520 px view reaches below the visible part of the page (TABLETT_PLATZ, @core). */}
            <SprechFeld register={befehle} kontext={() => bimKontext(auswahlEintraege())} ansicht={() => aenderung.current.ansicht()} zeigepunkt={() => aenderung.current.zeigepunkt()} nda={project?.nda === true} t={tz}
              projektId={project?.id ?? null} bild={(o) => /** @type {any} */ (aktuell.current).ansichtBild(o)} grob={grob} fernRef={sprechFernRef}
              bildSperre={() => xrZeigtGerade(three.current)}
              className={grob ? TABLETT_PLATZ.sprechen : "absolute bottom-2 right-2 z-30 w-[22rem] max-w-[40%]"} />
            {/* 106-08: VR - only with a WebXR device and only from the 3D view; ray, hover, selection, speech and confirmation as here. */}
            {/* Review 106-08: top LEFT of the 3D view - the attribute panel of a selection sits top right and was covered when centred. */}
            {view === "3d" ? <XrKnopf quelle={xrQuelle} t={tz} hook="bimXr" className="absolute left-2 top-2 z-30" /> : null}
            {/* 106-09: what arrived from another device (note with origin) and conflicts (both versions), top centre of the view. */}
            {abgleichZeigen(abgleich, STUDIO_QUELLEN) ? (
              <React.Suspense fallback={null}>
                <AbgleichHinweise t={tz} darfAendern={darfAendern} grob={grob} quellen={STUDIO_QUELLEN} className="absolute left-1/2 top-2 z-30 w-[24rem] max-w-[60%] -translate-x-1/2 max-h-[60%] overflow-y-auto" />
              </React.Suspense>
            ) : null}
            <AenderungsFeld speicher={vorschlaege} t={tz} darfUebernehmen={darfAendern} grob={grob} className={grob ? TABLETT_PLATZ.karten : `absolute bottom-2 z-30 w-[22rem] max-w-[60%] max-h-[480px] overflow-y-auto ${renderMode ? "left-[200px]" : "left-2"}`}
              onUebernehmen={(v) => aenderungBefehl("bestaetigen", { vorschlag_id: v.id, durch: "hand" })}
              onVerwerfen={(v) => aenderungBefehl("verwerfen", { vorschlag_id: v.id })}
              onZuruecknehmen={(sch) => aenderungBefehl("rueckgaengig", { vorschlag_id: sch.vorschlag_id })} />
            {/* ---- Render-Modus: Fassaden-Presets + Sonnenstand (klein, unten links) ---- */}
            {view === "3d" && renderMode && (
              <div className="absolute z-10 left-2 bottom-2 w-[180px] rounded-lg border border-slate-200 bg-white/90 backdrop-blur shadow-lg text-xs p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 pb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Fassade
                </div>
                <div className="flex flex-col gap-1">
                  {FACADE_PRESETS.map((p) => (
                    <button key={p.id} onClick={() => setFacadePreset(p.id)}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1 text-left ${facadePreset === p.id ? "border-sky-500 bg-sky-50 text-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      aria-pressed={facadePreset === p.id} title={p.name}>
                      <span className="w-3.5 h-3.5 rounded-sm border border-slate-300 shrink-0"
                        style={{ backgroundColor: `#${p.color.toString(16).padStart(6, "0")}` }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
                {huelleErscheinung && <p className="pt-1 text-[10px] text-muted-foreground" data-testid="render-oberflaeche">{tz("Gesetzte Oberfläche bleibt im Render sichtbar.")}</p>}
                <label className="flex items-center gap-1.5 pt-2 text-[11px] text-slate-600">
                  <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="w-12 shrink-0">{sunHour % 1 ? sunHour.toFixed(1) : sunHour} Uhr</span>
                  <input type="range" min="0" max="24" step="0.5" value={sunHour}
                    onChange={(e) => setSunHour(+e.target.value)}
                    className="accent-amber-500 min-w-0 flex-1" aria-label="Sonnenstand (Uhrzeit)" />
                </label>
              </div>
            )}
            {view !== "3d" && (() => {
              // 97-03: the lens hides statuses (never elements without status); openings go with
              // their wall. The input lens returns the same arrays — plan unchanged.
              const brille = brilleVon(brilleId);
              const planWalls = sichtbarUnter(brille, customWalls);
              const wandDa = new Set(planWalls.map((w) => w._idx));
              const planWindows = sichtbarUnter(brille, customWindows).filter((o) => planWalls === customWalls || wandDa.has(o.wallIdx));
              const huelleSichtbar = zeigtStatus(brille, attributeVon(attributLayer, "hull-wall")?.status);
              const planLayerVis = huelleSichtbar ? layerVis : { ...layerVis, shell: false };
              return (
              <div ref={planWrapRef} className="contents">
              {/* 106-11: the note of unreleased AI changes over the plan views - no close button, it ends with the release */}
              <KiVermerkHinweis stand={kiStand} t={tz} className="absolute left-2 top-2 z-20 max-w-[45%]"
                // review 106-11: say how many affected elements carry a mark in THIS view (the section and other storeys: fewer or none)
                markiert={kiStand?.guids?.length ? (view === "grundriss" ? kiMarkierungen(modellRef.current, kiStand.guids, { projektId: projectId || null, huellWaende: huelleSichtbar ? model.walls : [] })
                  .filter((m) => m.level === ebeneKlemmen(model, planLevel)).length : 0) : undefined} />
              <BimPlan2D
                fuellen height={planHoehe} // 108-01 (9a): the plan fills the panel height (usePlanHoehe, fill mode 75-16) instead of 460 px
                model={model} mode={/** @type {"grundriss"|"schnitt"} */ (view)} level={ebeneKlemmen(model, planLevel)} storeyHeight={storeyHeight}
                brille={brille} huelleStatus={attributeVon(attributLayer, "hull-wall")?.status ?? null} sw={swPlan}
                werkstattWaende={attributLayer?.attribute ? sichtbarUnter(brille, werkstattMitAttributen(werkstattBauteile(buildingProgram.get().zones || [], { storeyHeight, geschosse }), attributLayer).waende || []) : null}
                ansicht={ansichtAktiv} // 107-12: structure display, options and rules of the applied view (null = the plan as before)
                detailMassstab={scale} // review 107-12: level of detail from the chosen scale, like the PDF and the option boxes
                schichtFlaechen={planFlaechenMitSeo} schnittFlaechen={schnittAchse === "x" ? schnittMitSeo : null} // 107-10: plus the walls cut under a roof (plan and section, review); 107-09: intersected layers (solid cut or bands), null = today's plan; 108-01: the cut layers exist for A-A only
                dach={globalDach} achse={schnittAchse} eingang={eingangOeffnung} baufeldUmriss={baufeldUmriss} baufeldMittig={baufeldMittig} // 108-01: roof in the section, section axis, entrance in effect, building envelope
                layerVis={planLayerVis} envOpenings={huelleSichtbar ? sichtbarUnter(brille, envOpenings) : []} customZones={customZones} customSlabs={sichtbarUnter(brille, customSlabs)} customRoofs={sichtbarUnter(brille, customRoofs)} unit={unit}
                customStairs={customStairs} gauben={gauben} geschosse={gs} // 108-06 / 108-13: stair symbol (this storey and the one above), dormer outline in the top storey
                edit={view === "grundriss" && !sketchEdit ? { tool, draft, hover, customWalls: planWalls, customColumns: sichtbarUnter(brille, customColumns), customWindows: planWindows, selected, multiSel, onPoint, onHover: (/** @type {any} */ q, /** @type {any} */ roh, /** @type {any} */ e) => setHover(planFang(q, roh, e)), onFinish, onPick, onMarquee, onClear, onMoveWallPt, onMoveWall, onMoveColumn, onMoveOpening, onMovePolyVert, onMoveFootVert, onMoveFootEdge, onInsertFootVert, onDeleteFootVert, onGriffStart: griffStart, onGriffEnde: griffEnde } : undefined}
                focus={focus2d}
                overlayBounds={sketchEdit ? sketchEditBounds : sketchBounds}
                overlay={(ovArgs) => (<>{(
                  sketchEdit && sketchEditRef.current
                    ? ({ X, Z, SCALE, toMeters, bounds }) => (
                        // 34-05: parametrisches Zeichnen/Ziehen direkt im Plan.
                        // BIM-Editierung ist derweil aus (edit=undefined oben).
                        <SketchEditOverlay
                          sketch={sketchEditRef.current}
                          version={sketchVersion}
                          lastSolve={sketchSolve}
                          tool={sketchTool}
                          draft={sketchDraft}
                          setDraft={setSketchDraft}
                          onAddSegment={sketchAddSegment}
                          onDragPoint={sketchDragPoint}
                          onDragEnd={() => resolveSketch()}
                          X={X}
                          Z={Z}
                          SCALE={SCALE}
                          toMeters={toMeters}
                          bounds={bounds}
                        />
                      )
                    : sketchObj
                      ? ({ X, Z, SCALE }) => (
                          // PW-05: Sketch aus dem BIT Sketcher, read-only. Y-Flip
                          // Sketch (+y oben) ↔ Plan (Z nach unten): Y(wy) = Z(−wy).
                          <g style={{ pointerEvents: "none" }} opacity="0.9">
                            <SketchGeometry sketch={sketchObj} X={X} Y={(wy) => Z(-wy)} scale={SCALE} masstab={0.6} />
                          </g>
                        )
                      : undefined
                )?.(ovArgs)}
                {/* 106-11: marks of unreleased AI changes (dashed frame + "?"), the plan counterpart of the marks on the sheet */}
                {view === "grundriss" && <KiVermerkPlan modell={() => modellRef.current} guids={kiStand?.guids || []} projektId={projectId || null} huellWaende={huelleSichtbar ? model.walls : []}
                  level={ovArgs.level} X={ovArgs.X} Z={ovArgs.Z} SCALE={ovArgs.SCALE} />}
                {/* 106-03: the open proposals in the plan (dashed outline; blocked: solid) - the plan is the main view */}
                <PlanVorschau speicher={vorschlaege} modell={() => modellRef.current} projektId={projectId || null} geschosshoehe_m={storeyHeight}
                  level={ovArgs.level} X={ovArgs.X} Z={ovArgs.Z} SCALE={ovArgs.SCALE} /></>)}
              />
              {/* 108-01: the cut layers of the intersection exist for A-A only (bewusste Grenze) — B-B draws the wall rectangles */}
              {view === "schnitt" && schnittAchse === "z" && Array.isArray(schnittMitSeo) && schnittMitSeo.length > 0 && (
                <div className="absolute bottom-9 left-1/2 -translate-x-1/2 z-10 rounded bg-card/90 px-2 py-0.5 text-[11px] text-muted-foreground" data-testid="schnitt-bb-hinweis">
                  {tz("Schnitt B-B zeigt die Wände als Rechtecke — die verschnittenen Schichten gibt es nur im Schnitt A-A.")}
                </div>
              )}
              </div>
              );
            })()}
            {/* 3D-Kontextmenü (Rechtsklick) */}
            {view === "3d" && ctxMenu && (
              <div className="absolute z-20 min-w-[180px] rounded-lg border border-slate-200 bg-white shadow-lg text-xs py-1"
                style={{ left: Math.min(ctxMenu.x, 520), top: ctxMenu.y }} onMouseLeave={() => setCtxMenu(null)}>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 border-b">
                  {{ wall: "Wand", column: "Stütze", zone: "Raum", cslab: "Decke", croof: "Dach", wallShell: "Hüllwand", window: "Fenster", door: "Tür", slab: "Decke", parapet: "Attika", context: "Umgebungsgebäude" }[ctxMenu.hit.kind] || "Objekt"}
                </div>
                {ctxMenu.hit.kind === "wall" && (
                  <>
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-400">Aufbau</div>
                    {aufbautenListe().map((c) => (
                      <button key={c.id} onClick={() => { setWallComposite(c.id, ctxMenu.hit.id); setCtxMenu(null); }}
                        className="w-full text-left px-3 py-1 hover:bg-slate-50 text-slate-700">{c.name}</button>
                    ))}
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-400 border-t">Referenzlinie</div>
                    {bezugWahl(tz).map(([v, l, h]) => (
                      <button key={v} title={h} onClick={() => { setCustomWalls((ws) => ws.map((w) => w._idx === ctxMenu.hit.id ? { ...w, refLine: v } : w)); setCtxMenu(null); }}
                        className="w-full text-left px-3 py-1 hover:bg-slate-50 text-slate-700">{l}</button>
                    ))}
                    <button onClick={ctxDuplicate} className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 mt-1 border-t text-slate-700 hover:bg-slate-50"><Copy className="w-3 h-3" /> Duplizieren (+1 m)</button>
                    <button onClick={ctxDelete} className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50">Löschen</button>
                  </>
                )}
                {(["column", "zone", "cslab", "croof"].includes(ctxMenu.hit.kind) || ((ctxMenu.hit.kind === "window" || ctxMenu.hit.kind === "door") && ctxMenu.hit.id != null)) && (
                  <>
                    <button onClick={ctxDuplicate} className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 text-slate-700 hover:bg-slate-50"><Copy className="w-3 h-3" /> Duplizieren (+1 m)</button>
                    <button onClick={ctxDelete} className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50">Löschen</button>
                  </>
                )}
                {/* 108-06 / 108-13: stairs and dormers — delete only (no +1 m copy: a dormer lives on its edge, a stair in its room) */}
                {["stair", "gaube"].includes(ctxMenu.hit.kind) && ctxMenu.hit.id != null && (
                  <button onClick={ctxDelete} className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50">Löschen</button>
                )}
                {!["wall", "column", "zone", "cslab", "croof", "stair", "gaube"].includes(ctxMenu.hit.kind) && !((ctxMenu.hit.kind === "window" || ctxMenu.hit.kind === "door") && ctxMenu.hit.id != null) && (
                  <div className="px-3 py-1.5 text-slate-400">Keine Optionen (Hüllen-/Umgebungselement)</div>
                )}
              </div>
            )}

            {/* ---- BIM-E: Attribute-Panel der Auswahl (Einzel- bzw. letztes Element der Mehrfachauswahl) ---- */}
            {(() => {
              if (attrHidden) return null;
              const panelSel = selected || attrSel; // Einzelauswahl hat Vorrang, sonst letztes Element der Mehrfachauswahl
              if (!panelSel) return null;
              const numCls = "w-20 rounded border border-slate-300 px-1 py-0.5 text-right bg-white";
              const selCls = "rounded border border-slate-300 px-1 py-0.5 bg-white max-w-[120px]";
              // Plain-Funktion (kein Komponententyp!) -> Inputs verlieren beim Tippen nicht den Fokus.
              const field = (label, child) => (
                <label key={label} className="flex items-center justify-between gap-2 px-3 py-1 text-[11px] text-slate-600">
                  <span className="text-slate-500">{label}</span>{child}
                </label>
              );
              const storeyOpts = ebenenListe(model).map((s) => <option key={s.level} value={s.level}>{s.name}</option>); // 107-13: basements included, ascending
              // 73-07: condition + Erfassungsgrad rows, only in an existing-building project.
              const zfOpts = { bauart: bauartVon(project).bauart, field, selCls, t: tz };
              // 97-02a: data sheet rows under the attributes (same element object, optional fields).
              const sbCtx = { projektId: projectId || null, storeyHeight, geschosse: gs };
              const sbFelder = (el, typ, quelle, patch, extra = {}, felderOpt = {}) => steckbriefFelder(steckbrief(el, typ, { ...sbCtx, quelle, ...extra }), patch,
                { field, selCls, t: tz, schichtStatus: zfOpts.bauart === "bestand" ? { wert: el?.schicht_status || null } : null,
                  schichtDetail: { funktion: el?.schicht_funktion || null, prioritaet: el?.schicht_prioritaet || null }, ...felderOpt }); // 107-03: layer function/priority rows
              let title = "Objekt", body = null, readOnly = false, favSpec = null; // favSpec: ★-Favorit aus der Auswahl (BIM-F)

              if (panelSel.type === "wall") {
                const w = customWalls.find((x) => x._idx === panelSel.index); if (!w) return null;
                const hasComp = !!compositeById(w.composite);
                title = "Wand"; favSpec = { tool: "wall", composite: w.composite || null };
                body = [
                  field("Geschoss", <select className={selCls} value={w.level} onChange={(e) => patchWall(w._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  // 107-02 (D-BK-04): the top edge either stays absolute (`height`) or follows a storey (`oberkante_bezug: "geschoss"`, + offset)
                  field(tz("Oberkante"), <select className={selCls} value={oberkanteFolgtGeschoss(w) ? "geschoss" : "absolut"} aria-label={tz("Oberkante")}
                    onChange={(e) => patchWall(w._idx, e.target.value === "geschoss"
                      ? { oberkante_bezug: "geschoss", oberkante_geschosse: w.oberkante_geschosse ?? 1, oberkante_versatz_m: w.oberkante_versatz_m ?? 0 }
                      : { oberkante_bezug: "absolut", height: Math.round(wandHoehe(w, gs) * 100) / 100 })}>
                    <option value="absolut">{tz("absolut")}</option><option value="geschoss">{tz("bis Geschoss (+Versatz)")}</option></select>),
                  ...(oberkanteFolgtGeschoss(w) ? [
                    // 107-02 review fix: how many storeys the wall reaches up (default 1 = the storey above; 2 = a wall over two storeys)
                    field(tz("Geschosse bis Oberkante"), <input type="number" className={numCls} step="1" min="1" max={Math.max(1, ebenenGrenzen(model).max + 1 - w.level)} value={Math.max(1, Math.round(w.oberkante_geschosse ?? 1))} onChange={(e) => patchWall(w._idx, { oberkante_geschosse: Math.max(1, Math.round(+e.target.value) || 1) })} aria-label={tz("Geschosse bis Oberkante")} data-testid="wand-oberkante-geschosse" />),
                    field(tz("Versatz Oberkante (m)"), <input type="number" className={numCls} step="0.05" min="-2" max="2" value={w.oberkante_versatz_m ?? 0} onChange={(e) => patchWall(w._idx, { oberkante_versatz_m: +e.target.value })} aria-label={tz("Versatz Oberkante (m)")} />),
                    field("Höhe (m)", <span className="text-muted-foreground" data-testid="wand-hoehe-abgeleitet">{wandHoehe(w, gs).toFixed(2)}</span>),
                  ] : [
                    field("Höhe (m)", <input type="number" className={numCls} step="0.1" min="2" max="8" value={w.height ?? storeyHeight} onChange={(e) => patchWall(w._idx, { height: +e.target.value })} />),
                  ]),
                  field(tz("Versatz Unterkante (m)"), <input type="number" className={numCls} step="0.05" min="-2" max="2" value={w.unterkante_versatz_m ?? 0} onChange={(e) => patchWall(w._idx, { unterkante_versatz_m: +e.target.value })} aria-label={tz("Versatz Unterkante (m)")} />),
                  field("Aufbau", <select className={selCls} value={w.composite || "single24"} onChange={(e) => patchWall(w._idx, { composite: e.target.value })} data-testid="wand-aufbau">{aufbautenListe().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>),
                  field(tz("Oberfläche aus dem Katalog"), <select className={selCls} value={w.erscheinung || ""} data-testid="wand-erscheinung" aria-label={tz("Oberfläche aus dem Katalog")}
                    onChange={(e) => patchWall(w._idx, { erscheinung: e.target.value || undefined })}>
                    <option value="">{tz("Aufbau oder Standard")}</option>
                    {wandOberflaechen().map((s) => <option key={s.schluessel} value={s.schluessel}>{s.name}</option>)}
                  </select>),
                  // 107-03 task 5: copy the build-up into the project / edit a project build-up (fachlayer aufbauten_layer)
                  ...aufbauEditorFelder({ layer: aufbautenLayer, setLayer: setAufbautenLayer, composite: w.composite || null, dicke_m: w.thickness,
                    // id = null: the build-up was deleted, the wall keeps its thickness (m)
                    waehlen: (id, d) => patchWall(w._idx, id ? { composite: id } : { composite: undefined, thickness: d }),
                    // per-layer settings are stored by layer index: they move with the layers behind a removed one (walls and slabs of this build-up)
                    schichtEntfernt: (id, i) => { const neu = (/** @type {any[]} */ liste) => liste.map((el) => (el.composite === id ? { ...el, ...(overridesNachEntfernen(el, i) || {}) } : el)); setCustomWalls(neu); setCustomSlabs(neu); },
                    geloescht: (id) => { setWallComp((c) => (c === id ? "single24" : c)); setFavs((fs) => fs.filter((f) => f.composite !== id)); },
                    verwendet: (id) => customWalls.filter((x) => x.composite === id).length + customSlabs.filter((x) => x.composite === id).length + (envComposite === id ? 1 : 0), field, selCls, numCls, t: tz }),
                  !hasComp && field("Dicke (m)", <input type="number" className={numCls} step="0.05" min="0.1" max="0.6" value={w.thickness ?? 0.3} onChange={(e) => patchWall(w._idx, { thickness: +e.target.value })} />),
                  field("Bezug", <select className={selCls} value={w.refLine || "center"} onChange={(e) => patchWall(w._idx, { refLine: e.target.value })} data-testid="wand-bezug">{bezugWahl(tz).map(([v, l, h]) => <option key={v} value={v} title={h}>{l}</option>)}</select>),
                  // 107-11: a wall that does not bound rooms (free-standing partition) is left out of the room detection; stored only when false
                  field(tz("Raumbegrenzend"), <input type="checkbox" className="accent-primary" checked={w.raumbegrenzend !== false} data-testid="wand-raumbegrenzend" aria-label={tz("Raumbegrenzend")}
                    onChange={(e) => patchWall(w._idx, { raumbegrenzend: e.target.checked ? undefined : false })} />),
                  ...zustandFelder(w, (p) => patchWall(w._idx, p), zfOpts),
                  ...(() => { const ty = typFuerWand(w); return sbFelder(w, ty.typ, "customWalls", (p) => patchWall(w._idx, p), { typAbgeleitet: ty.abgeleitet, verschneidung: vInfo(`cw:${w._idx}`), abschraegung: seoInfo(`cw:${w._idx}`) }); })(),
                  ...seoFelder(`cw:${w._idx}`, field, selCls), // 107-10
                ];
              } else if (panelSel.type === "column") {
                const c = customColumns.find((x) => x._idx === panelSel.index); if (!c) return null;
                title = "Stütze";
                body = [
                  field("Geschoss", <select className={selCls} value={c.level} onChange={(e) => patchColumn(c._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Größe (m)", <input type="number" className={numCls} step="0.05" min="0.2" max="1.2" value={c.size ?? 0.4} onChange={(e) => patchColumn(c._idx, { size: +e.target.value })} />),
                  ...zustandFelder(c, (p) => patchColumn(c._idx, p), zfOpts),
                  ...sbFelder(c, "stuetze", "customColumns", (p) => patchColumn(c._idx, p)),
                ];
              } else if (panelSel.type === "opening") {
                const scope = panelSel.scope || "custom";
                const o = (scope === "env" ? envOpenings : customWindows).find((x) => x._idx === panelSel.index); if (!o) return null;
                const types = o.kind === "door" ? DOOR_TYPES : WINDOW_TYPES;
                const ohneFuellung = istOeffnungOhneFuellung(o); // 107-04: opening without a filling (IfcOpeningElement only)
                title = o.kind === "door" ? "Tür" : ohneFuellung ? tz("Öffnung") : "Fenster"; favSpec = ohneFuellung ? null : { tool: o.kind, typeId: o.typeId };
                // 107-04: own sizes (empty = the size of the type) and the height anchor of the sill; the lintel is shown, not stored
                const wirtO = wirtVon(o, wirtModell);
                const mO = wirtO ? masseAmWand(o, wirtO.wand, wirtO.wand.unterkante_m) : oeffnungsMasse(o);
                const typ0 = openingTypeById(o.kind, o.typeId);
                const masseFeld = (feld, platz, label, min) => field(label, <input type="number" className={numCls} step="0.05" min={min} placeholder={String(platz)} title={tz("leer = Maß des Typs")}
                  value={o[feld] ?? ""} aria-label={label} data-testid={`oeffnung-${feld}`} onChange={(e) => patchOpening(o._idx, scope, { [feld]: e.target.value === "" ? undefined : +e.target.value })} />);
                body = [
                  field("Art", <select className={selCls} value={o.kind} onChange={(e) => { const k = e.target.value; const def = k === "door" ? DOOR_TYPES[0].id : k === "oeffnung" ? "oeffnung" : WINDOW_TYPES[0].id; patchOpening(o._idx, scope, { kind: k, typeId: def }); }}><option value="window">Fenster</option><option value="door">Tür</option><option value="oeffnung">{tz("Öffnung (ohne Füllung)")}</option></select>),
                  ...(ohneFuellung ? [] : [field("Typ", <select className={selCls} value={o.typeId} onChange={(e) => patchOpening(o._idx, scope, { typeId: e.target.value })}>{types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}</select>)]),
                  field("Position (m)", <input type="number" className={numCls} step="0.25" value={+o.u.toFixed(2)} onChange={(e) => patchOpening(o._idx, scope, { u: Math.max(0.2, +e.target.value) })} />),
                  masseFeld("width", typ0.w, tz("Breite (m)"), "0.1"),
                  masseFeld("height", typ0.h, tz("Höhe (m)"), "0.1"),
                  masseFeld("sill", typ0.sill, tz("Brüstung (m)"), "0"),
                  field(tz("Brüstung ab"), <select className={selCls} value={BRUESTUNG_BEZUEGE.includes(o.bruestung_bezug) ? o.bruestung_bezug : "wand_uk"} data-testid="oeffnung-bezug" aria-label={tz("Höhenbezug der Brüstung")}
                    title={tz("Woher die Brüstung gemessen wird: Wand-Unterkante, Oberkante Rohdecke (OKRD) oder Oberkante Fertigfußboden (OKFF)")}
                    onChange={(e) => patchOpening(o._idx, scope, { bruestung_bezug: e.target.value === "wand_uk" ? undefined : e.target.value })}>
                    <option value="wand_uk">{tz("Wand-Unterkante")}</option><option value="okrd">{tz("OK Rohdecke (OKRD)")}</option><option value="okff">{tz("OK Fertigfußboden (OKFF)")}</option></select>),
                  field(tz("Sturz (m)"), <span className="text-muted-foreground" data-testid="oeffnung-sturz">{mO.sturz.toFixed(2)}</span>),
                  field(tz("Rahmenbaustoff"), <select className={selCls} value={o.rahmen || ""} data-testid="oeffnung-rahmen" aria-label={tz("Rahmenbaustoff")}
                    onChange={(e) => patchOpening(o._idx, scope, { rahmen: e.target.value || undefined })}>
                    <option value="">{tz("wie bisher")}</option>
                    {rahmenBaustoffe().map((s) => <option key={s.schluessel} value={s.schluessel}>{s.name}</option>)}
                  </select>),
                  field(tz("Glasbaustoff"), <select className={selCls} value={o.glas || ""} data-testid="oeffnung-glas" aria-label={tz("Glasbaustoff")}
                    onChange={(e) => patchOpening(o._idx, scope, { glas: e.target.value || undefined })}>
                    <option value="">{tz("wie bisher")}</option>
                    {glasBaustoffe().map((s) => <option key={s.schluessel} value={s.schluessel}>{s.name}</option>)}
                  </select>),
                  // 108-05: hinge and swing of a door (additive fields; defaults links/innen = the picture before 108-05), "Spiegeln" flips the hinge
                  ...(o.kind === "door" && o.typeId !== "sliding" ? [
                    field(tz("Anschlag"), <span className="flex items-center gap-1">
                      <select className={selCls} value={o.anschlag === "rechts" ? "rechts" : "links"} data-testid="tuer-anschlag" aria-label={tz("Anschlag")} onChange={(e) => patchOpening(o._idx, scope, { anschlag: e.target.value === "rechts" ? "rechts" : undefined })}>
                        <option value="links">{tz("links")}</option><option value="rechts">{tz("rechts")}</option></select>
                      <button type="button" className="underline" data-testid="tuer-spiegeln" onClick={() => patchOpening(o._idx, scope, { anschlag: o.anschlag === "rechts" ? undefined : "rechts" })}>{tz("Spiegeln")}</button></span>),
                    field(tz("Aufschlag"), <select className={selCls} value={o.aufschlag === "aussen" ? "aussen" : "innen"} data-testid="tuer-aufschlag" aria-label={tz("Aufschlag")} onChange={(e) => patchOpening(o._idx, scope, { aufschlag: e.target.value === "aussen" ? "aussen" : undefined })}>
                      <option value="innen">{tz("innen")}</option><option value="aussen">{tz("außen")}</option></select>),
                  ] : []),
                  field("Lage", <span className="text-slate-400">{scope === "env" ? "Hüllwand" : "Innenwand"}</span>),
                  ...zustandFelder(o, (p) => patchOpening(o._idx, scope, p), zfOpts),
                  ...sbFelder(o, o.kind === "door" ? (scope === "env" ? "tuer-aussen" : "tuer-innen") : ohneFuellung ? "oeffnung" : "fenster", `oeffnung|${scope === "env" ? `env:${o.level}:${o.edge}` : `cw:${o.wallIdx}`}|${o.kind}|${o._idx}`, (p) => patchOpening(o._idx, scope, p)),
                ];
              } else if (panelSel.type === "zone") {
                const z = customZones.find((x) => x._idx === panelSel.index); if (!z) return null;
                const area = Math.abs(z.points.reduce((a, p, i) => { const q = z.points[(i + 1) % z.points.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
                title = "Raum";
                body = [
                  field("Name", <input type="text" className="w-28 rounded border border-slate-300 px-1 py-0.5 bg-white" value={z.name} onChange={(e) => patchZone(z._idx, { name: e.target.value })} />),
                  field(tz("Bodenbelag"), <select className={selCls} value={z.belag || ""} data-testid="zone-belag" aria-label={tz("Bodenbelag")}
                    onChange={(e) => patchZone(z._idx, { belag: e.target.value || undefined })}>
                    <option value="">{tz("Markierung, kein Belag")}</option>
                    {bodenBelaege().map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>),
                  field("Geschoss", <select className={selCls} value={z.level} onChange={(e) => patchZone(z._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field("Fläche", <span className="text-slate-500">{area.toFixed(1)} m²</span>),
                  // 107-11 (BK-53/54): measuring rule, net area (columns, shafts, with "referenzlinie" the wall bodies deducted) and DIN 277 group
                  field(tz("Messregel"), <select className={selCls} value={messregelVon(z)} data-testid="raum-messregel" aria-label={tz("Messregel")}
                    onChange={(e) => patchZone(z._idx, { messregel: e.target.value === "referenzlinie" ? "referenzlinie" : undefined })}>
                    <option value="innenkante">{tz("Innenkante")}</option><option value="referenzlinie">{tz("Referenzlinie")}</option></select>),
                  field(tz("Netto-Fläche"), <span className="text-muted-foreground" data-testid="raum-netto">{nettoFlaeche_m2(z, { stuetzen: customColumns, zonen: customZones, waende: [...model.walls, ...customWalls] }).toFixed(2)} m²</span>),
                  field(tz("DIN 277"), <select className={selCls} value={z.din277_gruppe || ""} data-testid="raum-din277" aria-label={tz("DIN-277-Gruppe")}
                    onChange={(e) => patchZone(z._idx, { din277_gruppe: e.target.value || undefined })}>
                    <option value="">{tz("abgeleitet: {{gruppe}}").replace("{{gruppe}}", tz(DIN277_ZU_NUTZUNG[din277Gruppe({ ...z, din277_gruppe: undefined }).gruppe]?.label || ""))}</option>
                    {Object.entries(DIN277_ZU_NUTZUNG).map(([k, v]) => <option key={k} value={k}>{tz(v.label)}</option>)}</select>),
                  ...sbFelder(z, "raum", "customZones", (p) => patchZone(z._idx, p)),
                ];
              } else if (panelSel.type === "slab") {
                const s = customSlabs.find((x) => x._idx === panelSel.index); if (!s) return null;
                title = "Decke";
                const sLage = deckenLage(s, gs, "decke");
                body = [field("Geschoss", <select className={selCls} value={s.level} onChange={(e) => patchSlab(s._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  // 107-02: thickness and reference side of the slab (default 0.22 m, upper edge on the storey ceiling = today)
                  field(tz("Dicke (m)"), <input type="number" className={numCls} step="0.01" min="0.05" max="1" value={+sLage.dicke_m.toFixed(3)} onChange={(e) => patchSlab(s._idx, { dicke_m: +e.target.value })} aria-label={tz("Dicke (m)")} />),
                  field(tz("Bezug"), <select className={selCls} value={s.bezug === "unten" ? "unten" : "oben"} title={tz("Welche Kante der Decke auf der Geschossebene liegt")} aria-label={tz("Bezug der Decke")} onChange={(e) => patchSlab(s._idx, { bezug: e.target.value })}><option value="oben">{tz("Oberkante auf Geschossebene")}</option><option value="unten">{tz("Unterkante auf Geschossebene")}</option></select>),
                  // 107-04: holes of the slab (`oeffnungen`), drawn with the tool "Öffnung" on the slab in 3D
                  ...((s.oeffnungen || []).length ? [field(tz("Öffnungen"), <span className="flex items-center gap-1"><span data-testid="decke-oeffnungen">{s.oeffnungen.length}</span>
                    <button type="button" className="text-destructive hover:underline" onClick={() => patchSlab(s._idx, { oeffnungen: s.oeffnungen.length > 1 ? s.oeffnungen.slice(0, -1) : undefined })}>{tz("letzte entfernen")}</button></span>)] : []),
                  // 107-03 task 5: optional build-up of the slab from the project build-ups (data and data sheet only; the thickness above still leads the geometry)
                  ...(Object.keys(aufbautenLayer?.aufbauten || {}).length ? [field("Aufbau", <select className={selCls} value={s.composite || ""} data-testid="decke-aufbau" aria-label={tz("Projektaufbau")}
                    onChange={(e) => patchSlab(s._idx, { composite: e.target.value || undefined })}><option value="">—</option>{aufbautenListe().filter((c) => aufbautenLayer?.aufbauten?.[c.id]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)] : []),
                  ...zustandFelder(s, (p) => patchSlab(s._idx, p), zfOpts), ...sbFelder(s, "decke", "customSlabs", (p) => patchSlab(s._idx, p), { verschneidung: vInfo(`decke:${s._idx}`) })];
              } else if (panelSel.type === "stair") {
                // 108-06: straight flight — storey, antritt, direction, width, overrides; the derived values and the DIN 18065 warnings (never a block)
                const st = customStairs.find((x) => x._idx === panelSel.index); if (!st) return null;
                const lvl = Math.round(Number(st.level) || 0);
                const erg = treppeBerechnen(st, geschosshoehe(lvl, gs));
                const decke = deckeUeber(model, lvl, gs);
                const loch = decke ? treppenLoch(st, erg, deckenLage(decke, gs, "huelle").unterkante_m - elevationOf(lvl, gs)) : null;
                const warnungen = [...erg.warnungen, ...(loch?.warnung ? [loch.warnung] : [])];
                title = tz("Treppe");
                body = [
                  field("Geschoss", <select className={selCls} value={lvl} data-testid="treppe-geschoss" onChange={(e) => patchStair(st._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  field(tz("Antritt x / z (m)"), <span className="flex gap-1"><input type="number" className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" value={st.start.x} aria-label={tz("Antritt x (m)")} onChange={(e) => patchStair(st._idx, { start: { ...st.start, x: +e.target.value } })} />
                    <input type="number" className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" value={st.start.z} aria-label={tz("Antritt z (m)")} onChange={(e) => patchStair(st._idx, { start: { ...st.start, z: +e.target.value } })} /></span>),
                  field(tz("Richtung (°)"), <input type="number" className={numCls} step="15" value={Number(st.richtung_grad) || 0} data-testid="treppe-richtung" aria-label={tz("Richtung (°)")} onChange={(e) => patchStair(st._idx, { richtung_grad: ((+e.target.value % 360) + 360) % 360 })} />),
                  field(tz("Laufbreite (m)"), <input type="number" className={numCls} step="0.05" min="0.5" max="3" value={Number(st.breite_m) || 1} data-testid="treppe-breite" aria-label={tz("Laufbreite (m)")} onChange={(e) => patchStair(st._idx, { breite_m: +e.target.value })} />),
                  field(tz("Steigungen"), <input type="number" className={numCls} step="1" min="2" max="30" value={st.steigungen ?? ""} placeholder={String(erg.n)} data-testid="treppe-steigungen" aria-label={tz("Steigungen")} onChange={(e) => patchStair(st._idx, { steigungen: e.target.value === "" ? undefined : +e.target.value })} />),
                  field(tz("Auftritt (m)"), <input type="number" className={numCls} step="0.01" min="0.15" max="0.5" value={st.auftritt_m ?? ""} placeholder={erg.a_m.toFixed(3)} aria-label={tz("Auftritt (m)")} onChange={(e) => patchStair(st._idx, { auftritt_m: e.target.value === "" ? undefined : +e.target.value })} />),
                  field(tz("Deckenloch Breite (m)"), <input type="number" className={numCls} step="0.01" min="0.5" max="4" value={st.loch_breite_m ?? ""} placeholder={(Number(st.breite_m) || 1).toFixed(2)} aria-label={tz("Deckenloch Breite (m)")} onChange={(e) => patchStair(st._idx, { loch_breite_m: e.target.value === "" ? undefined : +e.target.value })} />),
                  field(tz("Ergebnis"), <span data-testid="treppe-ergebnis">{treppenText(erg)} · {tz("Schrittmaß")} {(erg.schrittmass_m * 100).toFixed(1).replace(".", ",")} cm · {tz("Lauflänge")} {erg.laufLaenge_m.toFixed(2).replace(".", ",")} m</span>),
                  field(tz("Deckenloch"), <span data-testid="treppe-loch">{loch ? `${loch.laenge_m.toFixed(2).replace(".", ",")} × ${loch.breite_m.toFixed(2).replace(".", ",")} m` : tz("keine Decke darüber")}</span>),
                  ...(warnungen.length ? [field(tz("Hinweise"), <ul className="list-disc pl-4 text-warnung" data-testid="treppe-warnungen">{warnungen.map((w) => <li key={w.code}>{tz(w.text)} ({(w.wert * 100).toFixed(1).replace(".", ",")} cm)</li>)}</ul>)] : []),
                ];
              } else if (panelSel.type === "gaube") {
                // 108-13: Schleppgaube on the global roof — edge, position, slope, setback, front height, window; derived depth/ridge and the checks
                const g = gauben.find((x) => x._idx === panelSel.index); if (!g) return null;
                const erg = gaubeBerechnen(g, model, globalDach, gs);
                const fw = g.fenster === null ? null : { ...GAUBE_STANDARD.fenster, ...(g.fenster || {}) };
                const kanten = (model.footprint || []).map((_, i) => i);
                title = tz("Gaube");
                body = [
                  field(tz("Traufseite"), <select className={selCls} value={Number(g.edge) || 0} data-testid="gaube-kante" aria-label={tz("Traufseite")} onChange={(e) => patchGaube(g._idx, { edge: +e.target.value })}>{kanten.map((i) => <option key={i} value={i}>{tz("Kante")} {i}</option>)}</select>),
                  field(tz("Lage von / bis (m)"), <span className="flex gap-1"><input type="number" className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" min="0" value={g.u_von_m} data-testid="gaube-von" aria-label={tz("Lage von (m)")} onChange={(e) => patchGaube(g._idx, { u_von_m: +e.target.value })} />
                    <input type="number" className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" min="0" value={g.u_bis_m} data-testid="gaube-bis" aria-label={tz("Lage bis (m)")} onChange={(e) => patchGaube(g._idx, { u_bis_m: +e.target.value })} /></span>),
                  field(tz("Neigung (°)"), <input type="number" className={numCls} step="1" min="5" max="45" value={g.neigung_grad ?? GAUBE_STANDARD.neigung_grad} data-testid="gaube-neigung" aria-label={tz("Neigung (°)")} onChange={(e) => patchGaube(g._idx, { neigung_grad: +e.target.value })} />),
                  field(tz("Rücksprung (m)"), <input type="number" className={numCls} step="0.05" min="0" max="5" value={g.ruecksprung_m ?? GAUBE_STANDARD.ruecksprung_m} aria-label={tz("Rücksprung (m)")} onChange={(e) => patchGaube(g._idx, { ruecksprung_m: +e.target.value })} />),
                  field(tz("Front OK über Boden (m)"), <input type="number" className={numCls} step="0.05" min="1" max="4" value={g.front_hoehe_m ?? GAUBE_STANDARD.front_hoehe_m} data-testid="gaube-front" aria-label={tz("Front OK über Boden (m)")} onChange={(e) => patchGaube(g._idx, { front_hoehe_m: +e.target.value })} />),
                  field(tz("Fenster b × h / Brüstung (m)"), fw ? <span className="flex gap-1 items-center">
                    <input type="number" className="w-14 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" min="0.3" value={fw.b} aria-label={tz("Fensterbreite (m)")} onChange={(e) => patchGaube(g._idx, { fenster: { ...fw, b: +e.target.value } })} />
                    <input type="number" className="w-14 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" min="0.3" value={fw.h} aria-label={tz("Fensterhöhe (m)")} onChange={(e) => patchGaube(g._idx, { fenster: { ...fw, h: +e.target.value } })} />
                    <input type="number" className="w-14 rounded border border-border px-1 py-0.5 text-right bg-card" step="0.05" min="0" value={fw.bruestung_m} aria-label={tz("Brüstung (m)")} onChange={(e) => patchGaube(g._idx, { fenster: { ...fw, bruestung_m: +e.target.value } })} />
                    <button type="button" className="text-destructive hover:underline" onClick={() => patchGaube(g._idx, { fenster: null })}>{tz("ohne")}</button></span>
                    : <button type="button" className="underline" onClick={() => patchGaube(g._idx, { fenster: { ...GAUBE_STANDARD.fenster } })}>{tz("Fenster einsetzen")}</button>),
                  erg.ok
                    ? field(tz("Ergebnis"), <span data-testid="gaube-ergebnis">{erg.breite_m.toFixed(2).replace(".", ",")} × {erg.tiefe_m.toFixed(2).replace(".", ",")} m · {tz("Front")} {erg.front_m.toFixed(2).replace(".", ",")} m · {tz("Gaubenfirst")} {erg.y_first_m.toFixed(2).replace(".", ",")} m</span>)
                    : field(tz("Ergebnis"), <span className="text-warnung" data-testid="gaube-fehler">{tz(/** @type {{text: string}} */ (erg).text)}</span>),
                  ...(erg.ok ? [field(tz("Abstände"), <span data-testid="gaube-abstaende">{tz("Giebel")} {erg.masse.abstandGiebel_m.toFixed(2).replace(".", ",")} m · {tz("unter First")} {erg.masse.abstandFirstVertikal_m.toFixed(2).replace(".", ",")} m</span>)] : []),
                  ...(erg.ok && erg.warnungen.length ? [field(tz("Hinweise"), <ul className="list-disc pl-4 text-warnung" data-testid="gaube-warnungen">{erg.warnungen.map((w) => <li key={w.code}>{tz(w.text)} ({w.wert.toFixed(2).replace(".", ",")} m)</li>)}</ul>)] : []),
                ];
              } else if (panelSel.type === "roof") {
                const rf = customRoofs.find((x) => x._idx === panelSel.index); if (!rf) return null;
                title = "Dach";
                body = [
                  field("Geschoss", <select className={selCls} value={rf.level} onChange={(e) => patchRoof(rf._idx, { level: +e.target.value })}>{storeyOpts}</select>),
                  // 107-02: ridge rise (m) and slope (°) are two fields; the one typed last leads, the other follows (old field `pitch` mirrors the rise)
                  field("Firsthöhe (m)", <input type="number" className={numCls} step="0.25" min="0.5" max="6" value={+dachFirsthoehe_m(rf).toFixed(2)} onChange={(e) => patchRoof(rf._idx, { firsthoehe_m: +e.target.value, pitch: +e.target.value, neigung_grad: undefined })} />),
                  // 107-10: the rise follows the run of the form (a shed roof rises over the full span, hoehen.dachLauf_m)
                  field(tz("Neigung (°)"), <input type="number" className={numCls} step="1" min="0" max={MAX_NEIGUNG_GRAD} value={+dachNeigung_grad(rf).toFixed(1)} aria-label={tz("Neigung (°)")} data-testid="dach-neigung" onChange={(e) => { const g = +e.target.value; const h = Math.round(dachFirsthoehe_m({ ...rf, neigung_grad: g }) * 100) / 100; patchRoof(rf._idx, { neigung_grad: g, firsthoehe_m: h, pitch: h }); }} />),
                  // 107-10: roof form (optional field `form`; empty = the gable drawn since phase 14) and ridge direction (roof library)
                  field(tz("Dachform"), <select className={selCls} value={rf.form || ""} data-testid="dach-form" aria-label={tz("Dachform")} onChange={(e) => patchRoof(rf._idx, { form: e.target.value || undefined })}>
                    <option value="">{tz("Ohne Form (3D Satteldach, im IFC flache Platte)")}</option><option value="sattel">{tz("Satteldach")}</option><option value="walm">{tz("Walmdach")}</option><option value="pult">{tz("Pultdach")}</option><option value="flach">{tz("Flachdach")}</option></select>),
                  field(tz("First"), <select className={selCls} value={rf.firstrichtung === "quer" ? "quer" : "laengs"} data-testid="dach-first" aria-label={tz("First")} onChange={(e) => patchRoof(rf._idx, { firstrichtung: e.target.value === "quer" ? "quer" : undefined })}>
                    <option value="laengs">{tz("längs zur längsten Seite")}</option><option value="quer">{tz("quer zur längsten Seite")}</option></select>),
                  field(tz("Dicke (m)"), <input type="number" className={numCls} step="0.01" min="0.05" max="1" value={+deckenLage(rf, gs, "dach").dicke_m.toFixed(3)} onChange={(e) => patchRoof(rf._idx, { dicke_m: +e.target.value })} aria-label={tz("Dicke (m)")} />),
                  field(tz("Bezug"), <select className={selCls} value={rf.bezug === "oben" ? "oben" : "unten"} aria-label={tz("Bezug des Dachs")} onChange={(e) => patchRoof(rf._idx, { bezug: e.target.value })}><option value="unten">{tz("Unterkante auf Traufe")}</option><option value="oben">{tz("Oberkante auf Traufe")}</option></select>),
                  ...zustandFelder(rf, (p) => patchRoof(rf._idx, p), zfOpts),
                  ...sbFelder(rf, dachNeigung_grad(rf) <= FLACHDACH_BIS_GRAD ? "dach-flach" : "dach-geneigt", "customRoofs", (p) => patchRoof(rf._idx, p)),
                ];
              } else if (panelSel.type === "hullwall") {
                const w = model.walls.find((x) => x.level === panelSel.level && x.edge === panelSel.edge); if (!w) return null;
                const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
                const hasComp = !!compositeById(envComposite);
                title = "Hüllwand"; readOnly = true; // generiert → kein Löschen, aber Aufbau/Dicke editierbar (ganze Hülle)
                body = [
                  field("Geschoss", <span className="text-slate-500">{model.storeys.find((s) => s.level === w.level)?.name}</span>),
                  field("Länge", <span className="text-slate-500">{len.toFixed(2)} m</span>),
                  // 107-13 review: a basement wall has its own build-up (UG_AUFBAU_STANDARD, A2) - shown, not editable here (the facade
                  // build-up select below would change the storeys above ground, not this wall; own basement build-up with 107-03)
                  w.level < 0 // basement wall (unterirdisch)
                    ? field("Aufbau", <span className="text-muted-foreground" data-testid="ug-aufbau">{compositeById(w.composite)?.name || w.composite} · {Number(w.thickness).toFixed(2)} m</span>)
                    : field("Aufbau", <select className={selCls} value={envComposite || "single"} onChange={(e) => setEnvComposite(e.target.value === "single" ? null : e.target.value)}><option value="single">Einschichtig</option>{aufbautenListe().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>),
                  field(tz("Hüllen-Oberfläche"), <select className={selCls} value={huelleErscheinung || ""} data-testid="huelle-erscheinung" aria-label={tz("Hüllen-Oberfläche")}
                    onChange={(e) => setHuelleErscheinung(e.target.value || null)}>
                    <option value="">{tz("Aufbau oder Standard")}</option>
                    {wandOberflaechen().map((s) => <option key={s.schluessel} value={s.schluessel}>{s.name}</option>)}
                  </select>),
                  !(w.level < 0) && !hasComp && field("Dicke (m)", <input type="number" className={numCls} step="0.05" min="0.1" max="0.6" value={envThickness} onChange={(e) => setEnvThickness(+e.target.value)} />),
                  // 107-01 (D-BK-02): where the hull wall lies against the footprint line; footprint, slabs and zones never move
                  field(tz("Bezug der Hülle"), <select className={selCls} value={huelleBezug} onChange={(e) => setHuelleBezug(e.target.value)} title={tz("Nur die Wandkörper verschieben sich; Grundrisslinie, Decken und Räume bleiben")} aria-label={tz("Bezug der Hülle")}>{bezugWahl(tz, true).map(([v, l, h]) => <option key={v} value={v} title={h}>{l}</option>)}</select>),
                  // 107-02 review: the hull slabs (all storeys and the base plate) get a thickness and a reference side like drawn slabs
                  field(tz("Dicke der Hüllplatten (m)"), <input type="number" className={numCls} step="0.01" min="0.05" max="1" value={huelleDeckeDicke} onChange={(e) => { const v = +e.target.value; if (v > 0) setHuelleDeckeDicke(v); }} aria-label={tz("Dicke der Hüllplatten (m)")} data-testid="huelle-decke-dicke" />),
                  field(tz("Bezug der Hüllplatten"), <select className={selCls} value={huelleDeckeBezug} aria-label={tz("Bezug der Hüllplatten")} onChange={(e) => setHuelleDeckeBezug(e.target.value === "oben" ? "oben" : "unten")}><option value="unten">{tz("Unterkante auf Geschossebene")}</option><option value="oben">{tz("Oberkante auf Geschossebene")}</option></select>),
                  field("Hinweis", <span className="text-slate-400 text-[10px]">Griffe ziehen verformt den Grundriss (alle Geschosse)</span>),
                  // 97-02: the hull's decisions live in the attribute table ("hull-wall" — one entry for the
                  // whole generated envelope, as the AVA classifies it); written at once, not with the debounce.
                  ...(() => {
                    const huellPatch = (p) => {
                      const neu = attributPatch(attributLayer, "hull-wall", p);
                      setAttributLayer(neu);
                      saveBimModel(projectId, { bauteil_attribute_layer: neu }).catch((err) => setHint(`Speichern fehlgeschlagen: ${err?.message || err}`));
                    };
                    // 107-13 review: the same record as the IFC export (huellwandDaten) - a basement wall keeps its own build-up and thickness
                    const huelle = mitAttributen(huellwandDaten(w, { composite: envComposite, thickness: envThickness }), attributeVon(attributLayer, "hull-wall"));
                    // 107-09: the generated hull walls have no own record: their intersection group is the default 1 (shown, not editable)
                    return [...zustandFelder(/** @type {{status?: string, erfassung?: string}} */ (huelle), huellPatch, zfOpts), ...sbFelder(huelle, "wand-aussen", "huelle", huellPatch, { verschneidung: vInfo(`env:${w.level}:${w.edge}`), abschraegung: seoInfo(`env:${w.level}:${w.edge}`) }, { gruppeFest: true })];
                  })(),
                  ...seoFelder(`env:${w.level}:${w.edge}`, field, selCls), // 107-10
                ];
              } else if (panelSel.type === "autowin") {
                title = panelSel.kind === "door" ? "Tür (Hülle)" : "Fenster (Hülle)"; readOnly = true;
                body = [
                  field("Geschoss", <span className="text-slate-500">{model.storeys.find((s) => s.level === panelSel.level)?.name}</span>),
                  field("Typ", <span className="text-slate-400">automatisch</span>),
                  field("Hinweis", <span className="text-slate-400 text-[10px]">eigenes Fenster mit dem Fenster-Werkzeug setzen</span>),
                ];
              } else return null;

              return (
                <div className="absolute z-20 top-2 right-2 w-[230px] rounded-lg border border-slate-200 bg-white shadow-lg text-xs">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b bg-slate-50 rounded-t-lg">
                    <span className="font-semibold text-slate-700">{title} · Attribute{multiSel.length > 1 ? ` (1 von ${multiSel.length})` : ""}</span>
                    <span className="flex items-center gap-1.5">
                      {favSpec && (
                        <button onClick={() => addFavorite(favSpec)} className="text-amber-400 hover:text-amber-600"
                          title="Als Favorit speichern (Werkzeug + Aufbau/Typ)" aria-label="Als Favorit speichern">
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setAttrHidden(true)} className="text-slate-400 hover:text-slate-700" aria-label="Schließen">✕</button>
                    </span>
                  </div>
                  <div className="py-1 divide-y divide-slate-100">{body}</div>
                  {!readOnly && (
                    <div className="px-3 py-1.5 border-t">
                      <button onClick={() => { if (selected) deleteSelected(); else deleteMany([panelSel]); }} className="flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="w-3 h-3" /> Löschen (Entf)</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ---- Bibliothek (Fenster/Türen) — sichtbar bei aktivem Fenster-/Tür-Werkzeug ---- */}
          {(tool === "window" || tool === "door") && (() => {
            const isDoor = tool === "door";
            const types = isDoor ? DOOR_TYPES : WINDOW_TYPES;
            const cur = isDoor ? doorType : winType;
            const setCur = isDoor ? setDoorType : setWinType;
            return (
              <div className="w-[180px] shrink-0 border-l bg-slate-50/70 overflow-y-auto" style={{ maxHeight: planHoehe }}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                  {isDoor ? <DoorOpen className="w-3 h-3" /> : <AppWindow className="w-3 h-3" />} {isDoor ? "Tür-Bibliothek" : "Fenster-Bibliothek"}
                </div>
                <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                  {types.map((ty) => (
                    <button key={ty.id} onClick={() => setCur(ty.id)}
                      className={`rounded-md border p-1 flex flex-col items-center gap-1 ${cur === ty.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-100"}`}
                      title={ty.name}>
                      <svg viewBox="0 0 40 44" className="w-full h-12">
                        <rect x="3" y="2" width="34" height="40" fill={isDoor && !ty.glass ? "#cbb89c" : "#dbeafe"} stroke="#64748b" strokeWidth="2" />
                        {Array.from({ length: ty.cols - 1 }).map((_, i) => <line key={`v${i}`} x1={3 + (34 / ty.cols) * (i + 1)} y1="2" x2={3 + (34 / ty.cols) * (i + 1)} y2="42" stroke="#64748b" strokeWidth="2" />)}
                        {Array.from({ length: ty.rows - 1 }).map((_, i) => <line key={`h${i}`} x1="3" y1={2 + (40 / ty.rows) * (i + 1)} x2="37" y2={2 + (40 / ty.rows) * (i + 1)} stroke="#64748b" strokeWidth="2" />)}
                      </svg>
                      <span className="text-[9px] leading-tight text-center text-slate-600">{ty.name}</span>
                    </button>
                  ))}
                </div>
                <div className="px-2 py-2 border-t text-[10px] text-slate-400">In den Grundriss auf eine Wand klicken, um {isDoor ? "die Tür" : "das Fenster"} zu setzen.</div>
              </div>
            );
          })()}

          {/* ---- Mappe / Navigator (Zeichenmappe → Ausschnitte → Plan-Output) ---- */}
          {showMappe && (
            <div className="w-[200px] shrink-0 border-l bg-slate-50/70 overflow-y-auto text-xs" style={{ maxHeight: planHoehe }}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                <Boxes className="w-3 h-3" /> Mappe · ein Modell
              </div>
              {/* Zeichenmappe (Modell) */}
              <div className="px-2 pb-1">
                <div className="text-[10px] uppercase text-slate-400 px-1 py-0.5">Zeichenmappe</div>
                {ebenenListe(model).map((s) => (
                  <button key={`gr${s.level}`} onClick={() => { setView("grundriss"); setPlanLevel(s.level); }}
                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${view === "grundriss" && planLevel === s.level ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                    <Grid2x2 className="w-3.5 h-3.5" /> Grundriss {s.name}
                  </button>
                ))}
                <button onClick={() => setView("schnitt")} className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${view === "schnitt" ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}><Scissors className="w-3.5 h-3.5" /> Schnitt</button>
                <button onClick={() => setView("3d")} className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${view === "3d" ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}><Box className="w-3.5 h-3.5" /> 3D / IFC-Modell</button>
              </div>
              {/* Ausschnittmappe */}
              <div className="px-2 py-1 border-t">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[10px] uppercase text-muted-foreground">{tz("Ausschnitte")}</span>
                  <button onClick={saveView} data-testid="ausschnitt-speichern" className="text-primary hover:underline text-[11px]">{tz("+ speichern")}</button>
                </div>
                {/* 107-12: optional name of the next view (empty = "Grundriss EG · 1:100" as before) */}
                <input value={ausschnittName} onChange={(e) => setAusschnittName(e.target.value)} placeholder={tz("Name des Ausschnitts (optional)")}
                  data-testid="ausschnitt-name" aria-label={tz("Name des Ausschnitts (optional)")}
                  className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded border border-border bg-card px-1 py-0.5 text-[11px] text-foreground" />
                {views.length === 0 && <div className="px-1 text-[10px] text-muted-foreground">{tz("Aktuelle Ansicht (Maßstab, Ebenen, Brille, Darstellung) als Ausschnitt sichern — bleibt im Projekt gespeichert.")}</div>}
                {views.map((v) => (
                  <div key={v.id} className="flex items-center gap-1 px-1 py-0.5" data-testid="ausschnitt" data-ausschnitt-id={v.id} data-aktiv={aktiverAusschnitt?.id === v.id ? "1" : undefined}>
                    <button onClick={() => applyView(v)} data-testid="ausschnitt-anwenden"
                      className={`flex-1 text-left px-1 py-0.5 rounded truncate ${aktiverAusschnitt?.id === v.id ? "bg-muted font-medium text-foreground" : "text-foreground hover:bg-muted"}`}
                      title={`${v.name} · ${v.combo}${v.ki_vermerk ? ` · ${tz("enthielt ungeprüfte KI-Änderungen")}` : ""}`}>{aktiverAusschnitt?.id === v.id ? "▸ " : ""}{v.name}</button>
                    {v.type !== "3d" && <button onClick={() => { applyView(v); setAusgabeWunsch({ id: v.id, art: "pdf" }); }} disabled={ausgabeLaeuft} data-testid="ausschnitt-pdf"
                      className="text-[10px] text-muted-foreground hover:underline disabled:opacity-40" title={tz("PDF aus diesem Ausschnitt")}>{tz("PDF")}</button>}
                    <button onClick={() => deleteView(v.id)} className="text-muted-foreground hover:text-destructive" aria-label={tz("Ausschnitt löschen")}><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
              {/* 107-09: switch "Wände verschneiden" (default off; walls with a build-up only) and its state */}
              <div className="px-3 py-1 border-t text-[11px] text-muted-foreground">
                <label className="flex items-center justify-between gap-2" title={tz("Mehrschichtige Wände an Ecken und Stößen nach der Priorität ihrer Schichten verschneiden (Standard aus)")}>
                  {tz("Wände verschneiden")}
                  <input type="checkbox" checked={verschneidung} data-testid="verschneidung-schalter" aria-label={tz("Wände verschneiden")}
                    onChange={(e) => { setVerschneidung(e.target.checked); hatteVerschneidungRef.current = true; }} /></label>
                {verschneidung && (vFehler || vRechnet || vMeldungText.length > 0) && (
                  <div className="pt-0.5 text-[10px] leading-snug text-warnung" role="status" data-testid="verschneidung-status" data-rechnet={vRechnet ? "1" : undefined}>
                    {vFehler ? <div>▲ {tz("Verschneidung nicht verfügbar: {{text}}").replace("{{text}}", vFehler)}</div> : vRechnet ? <div>{tz("3D-Verschneidung wird gerechnet …")}</div> : null}
                    {vMeldungText.slice(0, 3).map((m) => <div key={m}>▲ {m}</div>)}
                  </div>
                )}
              </div>
              {/* Schnitthöhe (Schnittebene) */}
              <div className="px-3 py-1 border-t text-[11px] text-slate-600">
                <label className="flex items-center justify-between gap-2">Schnitthöhe
                  <input type="number" step="0.1" min="0.5" max="2.5" value={cutHeight} onChange={(e) => setCutHeight(+e.target.value)} className="w-16 rounded border border-border px-1 py-0.5 text-right bg-card" /></label>
              </div>
              {/* 107-12: structure display, view options and the standard rules (lazy block, part of this navigator) */}
              <React.Suspense fallback={null}>
                <AnsichtOptionen t={tz} strukturdarstellung={strukturdarstellung} onStruktur={setStrukturdarstellung}
                  optionen={optionenFuer(detailgradFuer(scale, brilleVon(brilleId)), ansichtOptionen)}
                  onOption={(k, v) => setAnsichtOptionen((alt) => optionenOhneStandard({ ...(alt || {}), [k]: v }, detailgradFuer(scale, brilleVon(brilleId))))}
                  regelnAn={!!ansichtRegeln?.length} onRegeln={(an) => setAnsichtRegeln(an ? STANDARD_REGELN.map((r) => ({ wenn: { ...r.wenn }, dann: { ...r.dann } })) : null)} />
              </React.Suspense>
              {/* Plan-Output */}
              <div className="px-2 py-2 border-t">
                <div className="text-[10px] uppercase text-slate-400 px-1 pb-1">Pläne / Output</div>
                <button onClick={exportPlanPDF} disabled={ausgabeLaeuft} data-testid="bim-plan-pdf" className="w-full rounded-md bg-emerald-600 text-white px-2 py-1.5 hover:bg-emerald-700 disabled:opacity-50">{ausgabeLaeuft ? tz("Plan wird erstellt …") : tz("Aktuellen Plan als PDF")}</button>
                <button onClick={exportPlanDXF} disabled={ausgabeLaeuft} data-testid="bim-plan-dxf" className="w-full mt-1 rounded-md border border-border text-muted-foreground px-2 py-1.5 hover:bg-muted disabled:opacity-50">{tz("Aktuellen Plan als DXF")}</button>
                {/* 110 follow-up: file the current sheet directly on a plan of the plan list (Werkplanung) */}
                {projectId && (
                  <div className="mt-2 rounded-md border border-border bg-card p-1.5" data-testid="bim-plan-ablage">
                    <label className="block text-[10px] text-muted-foreground px-0.5 pb-0.5" htmlFor="bim-plan-ablage-wahl">{tz("PDF an Plan ablegen")}</label>
                    {ablagePlaene.length === 0 ? (
                      <div className="px-0.5 text-[10px] text-muted-foreground">{tz("Noch keine Pläne in diesem Projekt.")}</div>
                    ) : (
                      <>
                        <select id="bim-plan-ablage-wahl" data-testid="bim-plan-ablage-wahl" value={ablageZiel?.id || ""}
                          onChange={(e) => setAblagePlanId(e.target.value)}
                          className="w-full rounded border border-border bg-background text-foreground px-1 py-0.5 text-[11px]">
                          {!ablageZiel && <option value="">{tz("Plan wählen …")}</option>}
                          {ablagePlaene.map((p) => <option key={p.id} value={p.id}>{planWahlText(p)}{p.datei_ref ? " ●" : ""}</option>)}
                        </select>
                        <button onClick={planPdfAblegen} disabled={ausgabeLaeuft || !ablageZiel || view === "3d"} data-testid="bim-plan-ablegen"
                          className="w-full mt-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[11px] hover:bg-primary/90 disabled:opacity-50">
                          {ablageZiel?.datei_ref ? tz("PDF am Plan ersetzen") : tz("An Plan ablegen")}</button>
                        <div className="px-0.5 pt-0.5 text-[10px] text-muted-foreground">{tz("● = Plan hat schon ein PDF. Nur Grundriss und Schnitt aus dem Modell.")}</div>
                      </>
                    )}
                  </div>
                )}
                {aktiverAusschnitt && <div className="px-1 pt-1 text-[10px] text-muted-foreground" data-testid="ausgabe-ausschnitt">{tz("Ausgabe aus dem Ausschnitt „{{name}}“").replace("{{name}}", aktiverAusschnitt.name)}</div>}
                <button onClick={downloadIFC} className="w-full mt-1 rounded-md border border-slate-300 text-slate-600 px-2 py-1.5 hover:bg-slate-50">Modell als IFC</button>
                <div className="px-1 pt-1 text-[10px] text-slate-400">Grundriss und Schnitt: Vektor-PDF im gewählten Maßstab mit Plankopf und Brille (Blatt A3–A0 nach Größe), Schnitt mit Höhenkoten.</div>
              </div>
            </div>
          )}

          {/* ---- Ebenen-Panel (Layers, ArchiCAD-Stil) ---- */}
          {tool !== "window" && showLayers && (
            <div className="w-[180px] shrink-0 border-l bg-slate-50/70 overflow-y-auto" style={{ maxHeight: planHoehe }}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Ebenen
              </div>
              <div className="px-2 text-[11px] text-slate-400 pb-1">Kombination: <b className="text-slate-600">{combo}</b></div>
              {layers.map((l) => (
                <div key={l.id} className={`flex items-center gap-1.5 px-2 py-1 text-xs ${l.visible ? "text-slate-700" : "text-slate-400"}`}>
                  <button onClick={() => toggleLayer(l.id, "visible")} title={l.visible ? "Sichtbar" : "Ausgeblendet"} aria-label={`Sichtbarkeit ${l.name}`}>
                    {l.visible ? <Eye className="w-3.5 h-3.5 text-emerald-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                  <button onClick={() => toggleLayer(l.id, "locked")} title={l.locked ? "Gesperrt" : "Entsperrt"} aria-label={`Sperre ${l.name}`}>
                    {l.locked ? <Lock className="w-3.5 h-3.5 text-rose-500" /> : <LockOpen className="w-3.5 h-3.5 text-slate-300" />}
                  </button>
                  <span className="truncate flex-1">{l.name}</span>
                </div>
              ))}
              <div className="px-2 py-2 mt-1 border-t text-[10px] text-slate-400">
                Geschosse ≠ Ebenen: Geschosse sind Stockwerke, Ebenen sortieren Bauteile.
              </div>
            </div>
          )}
        </div>

        {/* ---- Statusleiste (ArchiCAD-Stil) ---- */}
        <div className="px-4 py-1.5 text-[11px] text-slate-500 border-t bg-slate-50/60 flex items-center gap-4 flex-wrap">
          <span className="font-medium text-slate-600">Maßstab 1:{scale}</span>
          <span>Geschoss: <b className="text-slate-700">{ebeneName(model, ebeneKlemmen(model, planLevel))}</b></span>
          <span>Werkzeug: <b className="text-slate-700">{PALETTE.flatMap((c) => c.items).find((i) => i.id === tool)?.label || "Pfeil"}</b></span>
          <span>Wände: <b className="text-slate-700">{customWalls.length}</b> · Stützen: <b className="text-slate-700">{customColumns.length}</b> · Fenster: <b className="text-slate-700">{[...customWindows, ...envOpenings].filter((o) => o.kind !== "door" && o.kind !== "oeffnung").length}</b> · Türen: <b className="text-slate-700">{[...customWindows, ...envOpenings].filter((o) => o.kind === "door").length}</b>{[...customWindows, ...envOpenings].some((o) => o.kind === "oeffnung") && <> · {tz("Öffnungen")}: <b className="text-foreground">{[...customWindows, ...envOpenings].filter((o) => o.kind === "oeffnung").length}</b></>} · Räume: <b className="text-slate-700">{customZones.length}</b> · Decken: <b className="text-slate-700">{customSlabs.length}</b> · Dächer: <b className="text-slate-700">{customRoofs.length}</b>{customStairs.length > 0 && <> · {tz("Treppen")}: <b className="text-foreground">{customStairs.length}</b></>}{gauben.length > 0 && <> · {tz("Gauben")}: <b className="text-foreground">{gauben.length}</b></>}</span>
          {/* BIM-B: Auswahl-Zähler-Badge + BIM-A/C: Kontextaktionen der Auswahl */}
          {selCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold" title="Anzahl ausgewählter Elemente (Shift+Klick erweitert)">{selCount} ausgewählt</span>
          )}
          {selCount > 0 && (
            <button onClick={zoomToSelection} className="flex items-center gap-1 text-slate-600 hover:underline" title="Zoom auf Auswahl (Taste F) — 2D-Ausschnitt bzw. 3D-Kamera"><Focus className="w-3 h-3" /> Zoom (F)</button>
          )}
          {selCount > 0 && (
            <button onClick={() => duplicateSelection()} className="flex items-center gap-1 text-slate-600 hover:underline" title="Auswahl duplizieren, +1 m versetzt (Strg+D)"><Copy className="w-3 h-3" /> Duplizieren (Strg+D)</button>
          )}
          <button onClick={resetViewAll} className="flex items-center gap-1 text-slate-500 hover:underline" title="Ansicht zurücksetzen: 3D-Kamera aufs Gesamtmodell bzw. 2D-Zoom 100 %"><RotateCcw className="w-3 h-3" /> Ansicht zurücksetzen</button>
          {selected && <button onClick={deleteSelected} className="flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="w-3 h-3" /> Auswahl löschen (Entf)</button>}
          {multiSel.length > 0 && <button onClick={() => deleteMany(multiSel)} className="flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="w-3 h-3" /> {multiSel.length} ausgewählt löschen (Entf)</button>}
          <button type="button" onClick={() => historieApiRef.current.zurueck()} disabled={!(historieTick >= 0 && historieRef.current.stack.past.length > 0)} data-testid="bim-undo" data-past={historieRef.current.stack.past.length} className="flex items-center gap-1 text-muted-foreground hover:underline disabled:opacity-40" title={tz("Rückgängig") + " (Strg+Z)"}><Undo2 className="w-3 h-3" /> {tz("Rückgängig")}</button>
          <button type="button" onClick={() => historieApiRef.current.vor()} disabled={!(historieTick >= 0 && historieRef.current.stack.future.length > 0)} data-testid="bim-redo" data-future={historieRef.current.stack.future.length} className="flex items-center gap-1 text-muted-foreground hover:underline disabled:opacity-40" title={tz("Wiederholen") + " (Strg+Y)"}><Redo2 className="w-3 h-3" /> {tz("Wiederholen")}</button>
          {(customWalls.length > 0 || customColumns.length > 0) && (
            <button onClick={clearCustom} className="flex items-center gap-1 text-slate-500 hover:underline"><Trash2 className="w-3 h-3" /> Leeren</button>
          )}
          {tool === "zone" && (
            <button type="button" onClick={raeumeVorschlagen} className="flex items-center gap-1 text-foreground hover:underline" data-testid="raeume-vorschlagen">
              <Frame className="w-3 h-3" /> {tz("Räume vorschlagen")}
            </button>
          )}
          {tool === "zone" && (
            <button type="button" onClick={() => setDin277Offen((o) => !o)} className="flex items-center gap-1 text-foreground hover:underline" data-testid="din277-zeigen" aria-pressed={din277Offen}>
              <Layers className="w-3 h-3" /> {tz("DIN 277")}
            </button>
          )}
          <span className="ml-auto text-slate-400">
            {hint
              ? <span className="text-amber-600">{hint}</span>
              : tool === "wall" ? "Wand: klicken für Punkte · Doppelklick beendet · Esc bricht ab"
              : tool === "column" ? "Stütze: klicken zum Platzieren"
              : tool === "window" ? "Fenster: Typ links wählen, dann auf eine Wand klicken"
              : tool === "door" ? "Tür: Typ links wählen, dann auf eine Wand klicken"
              : tool === "oeffnung" ? tz("Öffnung: im Grundriss auf eine Wand klicken — oder in 3D zwei Ecken auf einer Wand- oder Deckenfläche")
              : tool === "zone" ? "Raum: in eine von Wänden umschlossene Fläche klicken — wird automatisch erkannt"
              : tool === "slab" ? "Decke: Eckpunkte klicken, Doppelklick schließt das Polygon"
              : tool === "roof" ? "Dach: Eckpunkte klicken, Doppelklick → Satteldach über der Fläche"
              : view === "3d" ? "Links = wählen · Rechts = Optionen · Mittlere Taste = verschieben · Shift+Mitte = drehen · Mausrad = zoom"
              : "Pfeil: anklicken wählt · Rahmen ziehen → (umschließt) bzw. ← (berührt) · Mausrad = zoom · Mittel-Taste = verschieben · Entf löscht · Dppl-Klick Griff: Ecke +/-"}
          </span>
        </div>
        {/* 107-11 (D-BK-13): room proposals of the storey — taken over one by one or all; nothing is stored before that */}
        {raumVorschlaege && (
          <div className="mt-2 rounded-md border border-border bg-card p-2 text-xs" data-testid="raum-vorschlaege">
            <div className="flex items-center gap-2">
              <b className="text-foreground">{tz("Raumvorschläge aus den Wänden")}</b>
              <span className="text-muted-foreground">{ebeneName(model, raumVorschlaege.level)}</span>
              <label className="ml-auto flex items-center gap-1 text-muted-foreground">{tz("Messregel")}
                <select className="rounded border border-border bg-background px-1 py-0.5" value={vorschlagRegel} onChange={(e) => setVorschlagRegel(e.target.value)} aria-label={tz("Messregel neuer Räume")}>
                  <option value="innenkante">{tz("Innenkante")}</option><option value="referenzlinie">{tz("Referenzlinie")}</option></select>
              </label>
              {/* "Alle übernehmen" leaves out island rooms (their polygon contains the free-standing walls and would overlap the inner
                  room, zones have no holes) — those are taken over one by one, on purpose */}
              {raumVorschlaege.raeume.some((v) => !v.insel && !vorschlagVorhanden(v, customZones)) && (
                <button type="button" className="text-primary hover:underline" data-testid="raum-vorschlaege-alle" title={tz("Ohne Räume mit freistehenden Wänden — diese einzeln übernehmen")}
                  onClick={() => raeumeUebernehmen(raumVorschlaege.raeume.filter((v) => !v.insel && !vorschlagVorhanden(v, customZones)))}>{tz("Alle übernehmen")}</button>
              )}
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setVorschlaegeOffen(false)}>{tz("Schließen")}</button>
            </div>
            {!raumVorschlaege.raeume.length && <div className="mt-1 text-muted-foreground">{tz("Keine geschlossenen Räume gefunden")}</div>}
            <ul className="mt-1 space-y-0.5">
              {raumVorschlaege.raeume.map((v, i) => {
                const da = vorschlagVorhanden(v, customZones);
                return (
                  <li key={i} className="flex items-center gap-2" data-testid="raum-vorschlag">
                    <span className="text-foreground">{tz("Vorschlag {{n}}").replace("{{n}}", String(i + 1))}</span>
                    <span className="text-muted-foreground">{tz("{{innen}} m² innen · {{achse}} m² an der Referenzlinie").replace("{{innen}}", v.flaeche_m2.toFixed(2)).replace("{{achse}}", v.flaeche_referenzlinie_m2.toFixed(2))}</span>
                    {da ? <span className="text-muted-foreground">{tz("übernommen")}</span>
                      : <button type="button" className="text-primary hover:underline" data-testid="raum-vorschlag-uebernehmen" onClick={() => raeumeUebernehmen([v])}>{tz("Übernehmen")}</button>}
                  </li>
                );
              })}
            </ul>
            {raumVorschlaege.meldungen.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-warnung" data-testid="raum-vorschlaege-meldungen">
                {raumVorschlaege.meldungen.map((m, i) => <li key={i}>△ {meldungText(m, tz)}</li>)}
              </ul>
            )}
          </div>
        )}
        {/* 107-11 review: DIN 277 per storey (basements as rows of their own) with the sums above ground, below ground and in total */}
        {din277 && (
          <div className="mt-2 overflow-x-auto rounded-md border border-border bg-card p-2 text-xs" data-testid="din277-tabelle">
            <div className="flex items-center gap-2">
              <b className="text-foreground">{tz("DIN 277 je Geschoss")}</b>
              <span className="text-muted-foreground">{tz("aus Hüllwänden, gezeichneten Wänden, Stützen und Räumen dieses Studios, m²")}</span>
              <button type="button" className="ml-auto text-muted-foreground hover:underline" onClick={() => setDin277Offen(false)}>{tz("Schließen")}</button>
            </div>
            <table className="mt-1 w-full text-right tabular-nums">
              <thead className="text-muted-foreground">
                <tr><th className="text-left font-normal">{tz("Geschoss")}</th>{["BGF", "KGF", "NGF", "NUF", "VF", "TF"].map((k) => <th key={k} className="font-normal">{k}</th>)}</tr>
              </thead>
              <tbody>
                {[...din277.geschosse].sort((a, b) => b.level - a.level).map((g) => (
                  <tr key={g.level} data-testid="din277-zeile" data-level={g.level}>
                    <td className="text-left text-foreground">{g.name || ebeneName(model, g.level)}{g.quelle === "ohne-zonen" ? <span className="text-muted-foreground"> · {tz("ohne Räume")}</span> : null}</td>
                    {[g.bgf, g.kgf, g.ngf, g.nuf, g.vf, g.tf].map((v, i) => <td key={i}>{v.toFixed(2)}</td>)}
                  </tr>
                ))}
                {[["oberirdisch", tz("oberirdisch")], ["unterirdisch", tz("unterirdisch")], ["gesamt", tz("gesamt")]].map(([k, label]) => {
                  const s = /** @type {any} */ (din277)[k];
                  if (k === "unterirdisch" && !din277.geschosse.some((g) => g.level < 0)) return null;
                  return (
                    <tr key={k} className="border-t border-border font-medium" data-testid={`din277-summe-${k}`}>
                      <td className="text-left text-foreground">{label}</td>
                      {[s.bgf, s.kgf, s.ngf, s.nuf, s.vf, s.tf].map((v, i) => <td key={i}>{Number(v).toFixed(2)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {din277.meldungen.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-warnung">{din277.meldungen.map((m, i) => <li key={i}>△ {meldungText(m, tz)}</li>)}</ul>
            )}
            <div className="mt-1 text-[10px] text-muted-foreground">{tz("Zuordnung der Raumarten zu den DIN-277-Gruppen [ASSUMED]; ohne Räume ist die ganze NGF Nutzungsfläche.")}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
