// IFC-Viewer-Spike (Phase 30, Vorab-Test) — eigene Testseite, AVA unangetastet.
//
// Beweist: (1) Geometrie aus web-ifc (geteilte WASM-Instanz), (2) Rendering des
// realen Referenzmodells als EIN gemergtes Mesh mit Vertex-Colors, (3) Highlight per
// NOVA-Bauteilfilter bzw. verknüpfter LV-Position, (4) Raycast-Klick → Element-Info
// mit Ähnlichkeitssuche, (5) Schnittebene mit Gizmo. Messwerte im Overlay.
//
// First start without a dead end (72-13, N-11): the page is reachable from the main
// navigation in demo and cloud, where no Express server exists. There the sample model
// (public/beispiel/musterprojekt.ifc) replaces "Modell vom Server", ?beispiel=1 loads it
// on arrival, and a linked element (?sel) says honestly that it waits for a model.
// A single selected element leads to a prefilled ticket (ticketLink.js, N-10).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parseZustand, viewerLink } from "@ifc/lib/viewerLink";
import { neuesTicketUrl } from "@ifc/lib/ticketLink";
import AttributEditor from "@ifc/components/AttributEditor";
import { DATENQUELLE } from "@core/lib/umgebung";
import { seitenWurzel } from "@core/lib/utils";
import { useI18n } from "@core/lib/i18n";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  parseIfcModel, expressIdAtFaceIndex, ifcAufloeser, recolorElements, expandWithDescendants,
  extractSubGeometry, STATUS_COLORS, HIGHLIGHT_COLOR, SELECT_COLOR, DIM_COLOR, sichtbarkeitAnwenden,
} from "@ifc/lib/ifcGeometry";
import { statusZaehler, STATUS_OHNE_LABEL } from "@core/lib/bimClassification";
import { getPositionLink, clearPositionLink, onPositionLink, getTakeoffTarget, setTakeoffTarget, onTakeoffTarget } from "@ifc/lib/ifcLinkStore";
import { bitApi } from "@core/api/bitApi";
import { useProject } from "@core/lib/ProjectContext";
import { saveBimModel, storeGehoertZu } from "@core/lib/useBimModelSync";
import { buildingProgram } from "@core/lib/useBuildingProgram";
import { footprintQuelleGemessen } from "@core/lib/footprintQuelle";
import { grundrissAusModell, geschosseAusModell } from "@ifc/lib/grundriss";
import { toast } from "sonner";
import { parseFilterXml, applyNovaFilter } from "@ifc/lib/novaFilters";
import { byTrade } from "@core/lib/tradeSort";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung";
import { statusFarbe } from "@core/lib/plan/statusDarstellung.js";
// 106-01: one ray pick and one highlighter for every viewer (hover, click, later VR controllers).
import { identitaetAus, pickDrossel, zeigerPick, zeigerArt, TIPP_TOLERANZ_PX } from "@core/lib/zeigen/strahlPick.js";
import { zweiFingerGeste } from "@core/lib/zeigen/zweiFinger.js";
import { useZeigerArt, TABLETT_PLATZ } from "@core/lib/zeigen/useZeigerArt.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { hervorhebung, umrissLinie } from "@core/lib/zeigen/hervorheben.js";
import { ZEIGE_ZUSTAENDE, ZEIGE_CSS_RAND } from "@core/lib/zeigen/zustaende.js";
import { ansichtAufBox } from "@core/lib/zeigen/ansichtAufBox.js";
import { auswahlBefehleRegistrieren } from "@core/lib/zeigen/auswahlBefehle.js";
import { ansichtAlsPng } from "@core/lib/zeigen/ansichtBild.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import { elementBox, ifcAuswahlKontext, ifcModellUebersicht } from "@ifc/lib/auswahlIfc";
// 106-03: change commands (property of an imported element -> journal entry; the file stays unchanged).
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { AenderungsFeld } from "@core/components/zeigen/AenderungsVorschau.jsx";
// 106-05: speech and typed sentences at the model.
import SprechFeld from "@core/components/zeigen/SprechFeld.jsx";
import { eingabeBefehlRegistrieren } from "@core/lib/zeigen/eingabe.js";
import { ansichtAusKamera } from "@core/lib/zeigen/ansichtRichtung.js";
import { letzterEintrag } from "@ifc/lib/attributJournal";
/** Pointer travel (px) below which hover does not pick again [ASSUMED]: sub-pixel jitter picks the same element. */
const HOVER_MIN_PX = 2;
/** Pause (ms) after the last wheel tick before hover looks again [ASSUMED]: the damped camera has mostly settled. */
const WHEEL_PAUSE_MS = 180;
/** Largest selection (vertices) that still gets an outline [ASSUMED]: EdgesGeometry of ~200k vertices takes a few ms. */
const SEL_UMRISS_MAX_ECKEN = 200000;
// Modul-Cache: geparstes Modell überlebt Routen-/Tab-Wechsel (kein Re-Import).
let MODEL_CACHE = null;
// Label of the model held in MODEL_CACHE — lets ?beispiel=1 see that the cached model
// already is the sample and skip a second parse.
let MODEL_CACHE_LABEL = "";
// Sample model shipped in public/beispiel/ (the model check loads the same file).
const BEISPIEL_DATEI = "musterprojekt.ifc";
// Nachweis-Zähler (Weisung JB 21.08.2026): zählt, wie oft die three.js-Szene
// aufgebaut und wie oft ein Mesh erzeugt wurde. Im zweigeteilten Arbeitsbereich
// muss beides bei 1 stehen bleiben, während links im LV gearbeitet wird.
const AUFBAU = { szene: 0, mesh: 0 };
// Zuletzt geladenes Servermodell — wird beim Start automatisch wiederhergestellt
// (Weisung JB 26.08.2026). Gilt nur für Serverdateien; lokale Uploads über den
// Datei-Knopf sind nach einem Reload nicht wiederherstellbar und bleiben außen vor.
const AUTOLOAD_KEY = "bit-atelier.ifc.autoload.v1";
if (typeof window !== "undefined") /** @type {any} */ (window).__ifcAufbau = AUFBAU;

const fmt = (n, d = 0) => Number(n ?? 0).toLocaleString("de-DE", { maximumFractionDigits: d });
const fmtDate = (ms) => new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

// BUGFIX (Schnittebene + Klick): three's Raycaster ignores clippingPlanes and hits geometry
// behind the section face. strahlPick() (106-01) takes the material's clippingPlanes as
// `schnittebenen` and returns the first hit in front of all of them (tolerance -1e-4 m, as before).

// SPIKE-BEFUND (2026-07-30): Der Demo-Weg über exportIFC() ist deaktiviert —
// web-ifc 0.0.77 HÄNGT beim Parsen des generierten Mini-STEP (Endlosschleife,
// kein Fehler; Tab friert ein). Reale IFC-Dateien (Archicad-Export Referenzprojekt, 222 MB)
// parsen dagegen einwandfrei. → ifcExport.js ist nicht web-ifc-rundlauffähig;
// für Phase 30 klären (elm), Tests mit echten IFCs fahren.

// `embedded` = rechte Hälfte des zweigeteilten Arbeitsbereichs: der Viewer füllt
// die verfügbare Höhe statt der festen 560 px. Der Ladeweg bleibt unverändert.
export default function IfcViewer({ embedded = false }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const mountRef = useRef(null);
  const dateiInputRef = useRef(null);
  const threeRef = useRef(null); // { scene, camera, renderer, controls, raf }
  const meshRef = useRef(null);
  const highlightRef = useRef(null); // separates Treffer-Mesh (Ghost-Modus)
  const selMeshRef = useRef(null); // blaues Auswahl-Mesh (Klick)
  const modelRef = useRef(MODEL_CACHE);
  const fpsRef = useRef(null);
  // 106-01 hover: kept in refs — no React render per frame, only the overlay DOM is written.
  const zeigenRef = useRef(null); // hervorhebung() instance of this viewer: hover ('fokus') and marks (zustandSetzen)
  const hoverZieleRef = useRef([]); // targets that currently carry the hover state 'fokus' (so marks survive a hover change)
  const hoverRef = useRef(null); // identity under the pointer: { quelle, guid, expressId, typ, name, zustand } | null
  // 106-07: kind of the last pointer on the canvas and the two-finger steps seen (for the test hook)
  const zeigerArtRef = useRef(/** @type {"mouse"|"pen"|"touch"|null} */ (null));
  const gestenSummeRef = useRef({ schritte: 0, drehungRad: 0, faktor: 1 });
  // 106-07: tablet layout (finger or pen in use) and the right to change the model (rechte.js, module "modell")
  const { grob } = useZeigerArt();
  const darfAendern = useZugriff().darf("modell", "voll");
  const hoverBoxRef = useRef(null); // overlay box near the pointer
  const hoverTextRef = useRef(null); // its text line
  const hoverZustandRef = useRef(null); // its state line (words)
  const hoverSymbolRef = useRef(null); // its swatch (colour AND outline form of the state)
  const pickedRef = useRef(null); // mirror of `picked` for the pointer handlers
  const [modelInfo, setModelInfo] = useState(MODEL_CACHE ? { ...MODEL_CACHE.stats, label: MODEL_CACHE_LABEL } : null);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  // 89-04 (D-BW-03): show/hide by status. "ohne" = the model does not say — its own switch,
  // never folded into "neubau".
  const [statusSichtbar, setStatusSichtbar] = useState({ abbruch: true, neubau: true, bestand: true, ohne: true });
  const statusSichtbarRef = useRef(statusSichtbar);
  const [ausgeblendet, setAusgeblendet] = useState(0);
  const [kgFilter, setKgFilter] = useState("");
  const [matchInfo, setMatchInfo] = useState(null);
  const [picked, setPickedState] = useState(null);
  // 106-02: every write also lands in `pickedRef` at once (React state lands one render later), so two commands
  // in the same tick see the same selection; the commands read the ref, the panel reads the state.
  const setPicked = useCallback((/** @type {any} */ v) => { pickedRef.current = v; setPickedState(v); }, []);
  const [suchParams] = useSearchParams();
  const beispielImLink = suchParams.get("beispiel") === "1";
  const selImLink = suchParams.get("sel") || "";
  // True while a sample load is pending. The ?sel link waits for it instead of resolving
  // against a model cached from an earlier visit (which would mark nothing and end the link).
  const [beispielAusstehend, setBeispielAusstehend] = useState(
    () => beispielImLink && MODEL_CACHE_LABEL !== BEISPIEL_DATEI,
  );
  const [linkKopiert, setLinkKopiert] = useState(false);
  const [error, setError] = useState("");
  const [ifcFiles, setIfcFiles] = useState([]); // [{ name, size, mtime }], neueste zuerst (SPIKE-Route)
  const [loadedIfcName, setLoadedIfcName] = useState(""); // zuletzt vom Server geladene Datei (für „neuere Datei"-Hinweis)
  const [novaFilters, setNovaFilters] = useState([]); // [{ key, gruppe, titel, filter }]
  const [novaFilterKey, setNovaFilterKey] = useState("");
  const [novaSuche, setNovaSuche] = useState("");
  // Mengenübernahme Modell → LV-Position (Richtung 2)
  // Testlauf 26.08.: Positionsliste aufs AKTIVE Projekt begrenzt (vorher alle 784).
  const { projectId, project } = useProject();
  const [positionen, setPositionen] = useState([]);
  const [zielId, setZielId] = useState(getTakeoffTarget()?.id || "");
  const [lvFilter, setLvFilter] = useState(getTakeoffTarget()?.trade || ""); // Vorauswahl LV/Gewerk
  const [posSuche, posSucheSetzen] = useState("");
  const [basis, setBasis] = useState("area");
  const [faktor, setFaktor] = useState(1);
  // Schnittebene: Modus, Position (0–100 % der Modellausdehnung), Richtung, Winkel
  const [schnitt, setSchnitt] = useState("aus"); // aus | h | x | z | schraeg
  const [schnittPos, setSchnittPos] = useState(50);
  const [schnittFlip, setSchnittFlip] = useState(false);
  const [azimut, setAzimut] = useState(45);   // ° um die Hochachse (nur „schräg")
  const [neigung, setNeigung] = useState(30); // ° Kippung (nur „schräg")
  const [gizmoMode, setGizmoMode] = useState("translate"); // translate | rotate
  const [gizmoOn, setGizmoOn] = useState(true); // Gizmo im 3D ein-/ausblenden
  const clipPlaneRef = useRef(null);
  const cutRef = useRef(null); // { dummy, helper, tcHelper, tc } — 3D-Steuerung der Ebene
  const cutManualRef = useRef(false); // true, sobald per Gizmo verschoben/gedreht wurde

  // --- three.js-Szene (einmalig; StrictMode-sicher; vollständiges Cleanup) ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || threeRef.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f7);
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 5000);
    camera.position.set(40, 35, 40);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.localClippingEnabled = true; // Schnittebene je Material (siehe clipPlaneRef)
    // Eine dauerhaft existierende Schnitt-Ebene: „aus" = Konstante so groß, dass sie
    // nichts abschneidet. So bleibt die Array-Länge stabil und die Shader müssen bei
    // jedem Umschalten nicht neu kompiliert werden.
    if (!clipPlaneRef.current) clipPlaneRef.current = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e7);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(50, 80, 30);
    scene.add(dir);
    const grid = new THREE.GridHelper(100, 50, 0xc3ccd8, 0xdde3ec);
    scene.add(grid);

    let frames = 0;
    let lastFps = performance.now();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      frames += 1;
      const now = performance.now();
      if (now - lastFps >= 1000) {
        if (fpsRef.current) {
          // performance.memory is Chrome-only and not in lib.dom → cast
          const heap = /** @type {any} */ (performance).memory ? ` · Heap ${fmt(/** @type {any} */ (performance).memory.usedJSHeapSize / 1048576)} MB` : "";
          fpsRef.current.textContent = `${frames} FPS${heap}`;
        }
        frames = 0;
        lastFps = now;
      }
    };
    animate();
    const ro = new ResizeObserver(() => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    ro.observe(mount);

    // --- Schnitt-Steuerung IM 3D-Fenster: Gizmo (Pfeil = verschieben, Ring = drehen)
    // + sichtbare Ebene. Ein unsichtbarer „dummy" trägt Lage/Drehung; die Schnittebene
    // wird daraus abgeleitet (Normale = lokale −Y-Achse des dummy).
    const dummy = new THREE.Object3D();
    scene.add(dummy);
    const helper = new THREE.PlaneHelper(clipPlaneRef.current, 40, 0x2563eb);
    helper.visible = false;
    scene.add(helper);
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSize(0.9);
    tc.attach(dummy);
    // three ≥ r169: der sichtbare Teil kommt über getHelper()
    const tcHelper = typeof tc.getHelper === "function" ? tc.getHelper() : tc;
    tcHelper.visible = false;
    scene.add(tcHelper);
    tc.addEventListener("dragging-changed", (e) => { controls.enabled = !e.value; });
    tc.addEventListener("objectChange", () => {
      const plane = clipPlaneRef.current;
      const n = new THREE.Vector3(0, -1, 0).applyQuaternion(dummy.quaternion).normalize();
      plane.setFromNormalAndCoplanarPoint(n, dummy.position);
      cutManualRef.current = true; // Slider/Modus überschreiben die Handjustierung nicht mehr
    });
    cutRef.current = { dummy, helper, tc, tcHelper };

    threeRef.current = { scene, camera, renderer, controls, grid };
    AUFBAU.szene += 1;
    console.log(`[IFC] three.js-Szene aufgebaut (#${AUFBAU.szene}) — bei mehr als 1 wurde der Viewer neu montiert`);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (meshRef.current) {
        scene.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        meshRef.current.material.dispose();
        meshRef.current = null;
      }
      grid.geometry.dispose();
      grid.material.dispose();
      tc.detach();
      tc.dispose();
      scene.remove(tcHelper);
      scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      scene.remove(dummy);
      cutRef.current = null;
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      threeRef.current = null;
    };
  }, []);

  // 106-01: remove the hover highlight (vertex colours back to the originals) and hide the overlay.
  // Must run before anything else rewrites the colour buffer or the mesh (applyColors, buildMesh):
  // otherwise the remembered colours would be written back over the new ones.
  const hoverLoeschen = () => {
    const zeigen = zeigenRef.current;
    if (zeigen) for (const z of hoverZieleRef.current) zeigen.loeschen(z, "fokus");
    hoverZieleRef.current = [];
    hoverRef.current = null;
    if (hoverBoxRef.current) hoverBoxRef.current.style.display = "none";
  };
  // Same, but for every state of this highlighter (hover AND marks): needed before the colour buffer
  // or the mesh is rewritten. `verwerfen` also frees the cached outline geometries (mesh replaced).
  const zeigenZuruecksetzen = (verwerfen = false) => {
    const zeigen = zeigenRef.current;
    if (zeigen) { if (verwerfen) zeigen.verwerfen(); else zeigen.alleLoeschen(); }
    hoverLoeschen();
  };

  // 89-04: status key of an element for the visibility switches ("ohne" for null/unknown).
  const statusSchluessel = (s) => (s === "abbruch" || s === "neubau" || s === "bestand" ? s : "ohne");
  // Apply the current switches to the rendered index (degenerate triangles, see ifcGeometry.js).
  const sichtbarkeitNachStatus = () => {
    zeigenZuruecksetzen();
    const model = modelRef.current;
    const attr = meshRef.current?.geometry?.index;
    if (!model?.merged || !attr) return;
    const byEid = new Map(model.elements.map((el) => [el.expressId, el]));
    const sicht = statusSichtbarRef.current;
    const n = sichtbarkeitAnwenden(model.merged, attr.array, (eid) => sicht[statusSchluessel(byEid.get(eid)?.status)] !== false);
    attr.needsUpdate = true;
    setAusgeblendet(n);
  };

  // Modell → Mesh (bei Cache-Treffer auch nach Remount)
  const buildMesh = (model) => {
    const t = threeRef.current;
    if (!t || !model) return;
    zeigenZuruecksetzen(true);
    if (highlightRef.current) {
      t.scene.remove(highlightRef.current);
      highlightRef.current.geometry.dispose();
      highlightRef.current.material.dispose();
      highlightRef.current = null;
    }
    if (meshRef.current) {
      t.scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      meshRef.current.material.dispose();
    }
    const { positions, normals, colors, index, bbox } = model.merged;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // 89-04: own copy — status hiding rewrites the rendered index, merged.index stays the source.
    geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide,
      clippingPlanes: [clipPlaneRef.current] });
    const mesh = new THREE.Mesh(geo, mat);
    t.scene.add(mesh);
    meshRef.current = mesh;
    sichtbarkeitNachStatus();
    // Kamera einpassen
    const cx = (bbox.min[0] + bbox.max[0]) / 2;
    const cy = (bbox.min[1] + bbox.max[1]) / 2;
    const cz = (bbox.min[2] + bbox.max[2]) / 2;
    const size = Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2], 1);
    t.controls.target.set(cx, cy, cz);
    t.camera.position.set(cx + size * 0.8, cy + size * 0.6, cz + size * 0.8);
    t.camera.near = size / 1000;
    t.camera.far = size * 10;
    t.camera.updateProjectionMatrix();
    AUFBAU.mesh += 1;
    console.log(`[IFC] Geometrie in die Szene gelegt (#${AUFBAU.mesh}) — ${fmt(model.stats?.triangles)} Dreiecke`);
  };
  useEffect(() => { if (modelRef.current) buildMesh(modelRef.current); }, [modelInfo]);

  // GlobalId → expressId, EINMAL je geladenem Modell gebaut (nicht bei jedem Klick) —
  // Kehrwert von model.guidByExpressId, Basis für „im Modell markieren" unten.
  const eidByGuidRef = useRef(null);
  useEffect(() => {
    const model = modelRef.current;
    eidByGuidRef.current = model ? new Map([...model.guidByExpressId].map(([eid, g]) => [g, eid])) : null;
  }, [modelInfo]);

  const loadBuffer = async (buf, label) => {
    setBusy(true);
    setError("");
    setMatchInfo(null);
    setPicked(null);
    try {
      const model = await parseIfcModel(buf, { onProgress: setProgress });
      MODEL_CACHE = model;
      MODEL_CACHE_LABEL = label;
      modelRef.current = model;
      setModelInfo({ ...model.stats, label });
      setProgress("");
    } catch (e) {
      setError(String(e?.message || e));
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    loadBuffer(await f.arrayBuffer(), f.name);
  };

  // Sample model instead of a server that demo and cloud do not have. Rebuilt after
  // ModelCheck.beispielLaden, not imported — ModelCheck.jsx belongs to another lane.
  // Errors stay plain German text; the path in the message tells the operator where
  // the file is expected.
  const musterprojektLaden = async () => {
    setBeispielAusstehend(true);
    setBusy(true);
    setError("");
    setProgress(t("Lade Musterprojekt…"));
    try {
      const basis = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${basis}beispiel/${BEISPIEL_DATEI}`);
      if (!res.ok) {
        throw new Error(`${t("Das Musterprojekt konnte nicht geladen werden")} (HTTP ${res.status}). `
          + t("Erwartet unter public/beispiel/musterprojekt.ifc."));
      }
      await loadBuffer(await res.arrayBuffer(), BEISPIEL_DATEI);
    } catch (e) {
      // A network failure arrives as the browser's English "Failed to fetch" — keep it
      // as the cause, but always lead with the German sentence.
      const meldung = t("Das Musterprojekt konnte nicht geladen werden");
      const grund = String(e?.message || e);
      setError(grund.startsWith(meldung) ? grund : `${meldung}: ${grund}`);
      setProgress("");
      setBusy(false);
    } finally {
      setBeispielAusstehend(false);
    }
  };

  // Ohne name: lädt (falls Ordnerliste vorhanden) die neueste Datei; sonst wie bisher
  // die feste IFC_TEST_FILE. Mit name: lädt gezielt diese Datei aus demselben Ordner
  // (z. B. eine ältere Version aus der Auswahlliste).
  const loadServerFile = async (name) => {
    setBusy(true);
    setProgress("Lade IFC vom lokalen Server…");
    const file = name ? ifcFiles.find((f) => f.name === name) : ifcFiles[0];
    try {
      const url = file ? `/api/ifc-test-file?name=${encodeURIComponent(file.name)}` : "/api/ifc-test-file";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server: ${res.status} — IFC_TEST_FILE gesetzt?`);
      const buf = await res.arrayBuffer();
      await loadBuffer(buf, file ? file.name : "Modell vom Server");
      if (file) setLoadedIfcName(file.name);
      // Autoload-Gedächtnis: leerer String = Server-Default (neueste Datei).
      try { localStorage.setItem(AUTOLOAD_KEY, file ? file.name : ""); } catch { /* Storage gesperrt */ }
    } catch (e) {
      setError(String(e?.message || e));
      setBusy(false);
      setProgress("");
    }
  };

  // Blaues Auswahl-Mesh für ausgewählte Bauteile (Klick = 1, „Treffer auswählen" = viele).
  const setSelectionMesh = (eids) => {
    const t = threeRef.current;
    const model = modelRef.current;
    if (!t) return;
    if (selMeshRef.current) {
      t.scene.remove(selMeshRef.current);
      selMeshRef.current.geometry.dispose();
      selMeshRef.current.material.dispose();
      // the outline child (state 'auswahl': solid line = form, not only colour)
      selMeshRef.current.children.forEach((c) => { c.geometry?.dispose(); c.material?.dispose(); });
      selMeshRef.current = null;
    }
    const idSet = eids instanceof Set ? eids : (eids != null ? new Set([eids]) : null);
    if (!idSet || !idSet.size || !model) return;
    const sub = extractSubGeometry(model.merged, idSet);
    if (!sub.vertices) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(sub.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(sub.normals, 3));
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(SELECT_COLOR[0], SELECT_COLOR[1], SELECT_COLOR[2]),
      emissive: new THREE.Color(0.05, 0.12, 0.3),
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      clippingPlanes: [clipPlaneRef.current],
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Solid outline in the 'auswahl' look of the state table (106-01). Skipped for huge selections
    // (EdgesGeometry cost): the blue fill stays. X-ray (no depth test): the selection polygonOffset
    // pulls its faces towards the camera, so a depth-tested line on the edges would mostly vanish.
    if (sub.vertices <= SEL_UMRISS_MAX_ECKEN) {
      const linie = umrissLinie(new THREE.EdgesGeometry(geo, 30), "auswahl", { schnittebenen: [clipPlaneRef.current] });
      linie.material.depthTest = false;
      mesh.add(linie);
    }
    t.scene.add(mesh);
    selMeshRef.current = mesh;
  };
  useEffect(() => { if (!picked) setSelectionMesh(null); }, [picked]);

  // --- Teilbare Links (Phase 65-05) -----------------------------------------
  // „Schau dir genau diese Kollision an" war bisher eine Beschreibung. Jetzt ist
  // es ein Link: Kamera, gewähltes Bauteil (GlobalId) und Filter stehen im Hash.
  const linkKopieren = async () => {
    const t = threeRef.current;
    const zustand = {
      cam: t?.camera
        ? {
            pos: [t.camera.position.x, t.camera.position.y, t.camera.position.z],
            target: t.controls?.target
              ? [t.controls.target.x, t.controls.target.y, t.controls.target.z]
              : undefined,
          }
        : undefined,
      sel: picked && !picked.multi ? picked.guid : undefined,
      filter: { status: !!statusFilter, kg: !!kgFilter, bauteil: !!novaFilterKey },
    };
    const basisUrl = `${window.location.origin}${window.location.pathname}`;
    const url = viewerLink(basisUrl, "IfcViewer", zustand);
    try {
      await navigator.clipboard.writeText(url);
      setLinkKopiert(true);
      setTimeout(() => setLinkKopiert(false), 2500);
    } catch {
      // Zwischenablage gesperrt (kein sicherer Kontext / Berechtigung fehlt) —
      // dann den Link wenigstens zeigen, statt still nichts zu tun.
      window.prompt("Link kopieren:", url);
    }
  };

  // Component-level helper: inside the effect below `t` is the three.js context.
  const bauteilFehltText = (guid) =>
    t("Bauteil {sel} ist im geladenen Modell nicht enthalten.").replace("{sel}", guid);

  // Ankommender Link: Kamera setzen, sobald die Szene steht; das Bauteil
  // markieren, sobald das Modell geladen ist. Nur EINMAL je Seitenaufruf.
  const linkAngewendet = useRef(false);
  useEffect(() => {
    if (linkAngewendet.current) return;
    const zustand = parseZustand(suchParams.toString());
    if (!zustand) return;
    const t = threeRef.current;
    const model = modelRef.current;
    if (!t?.camera) return;

    if (zustand.cam) {
      t.camera.position.set(...zustand.cam.pos);
      if (zustand.cam.target && t.controls) {
        t.controls.target.set(...zustand.cam.target);
        t.controls.update();
      }
    }

    if (zustand.sel) {
      // Ohne geladenes Modell lässt sich die GlobalId nicht auflösen — dann
      // greift der Effekt beim nächsten Lauf (modelInfo ändert sich).
      // Same while the sample requested by ?beispiel=1 is still loading.
      if (!model || beispielAusstehend) return;
      const treffer = model.elements.find((e) => e.globalId === zustand.sel);
      if (treffer) {
        setSelectionMesh(treffer.expressId);
        setPicked(pickedAus(treffer.expressId, treffer, null)); // same record as a click or a command (panel texts agree)
      } else {
        // Honest instead of silent: the link names an element this model does not have.
        toast.info(bauteilFehltText(zustand.sel));
      }
    }
    linkAngewendet.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suchParams, modelInfo, beispielAusstehend]);

  // Ghost-Modus: Rest transparent, Treffer als eigenes solides orangenes Mesh obendrauf.
  const setGhost = (paintSet) => {
    const t = threeRef.current;
    const model = modelRef.current;
    if (!t || !model || !meshRef.current) return;
    if (highlightRef.current) {
      t.scene.remove(highlightRef.current);
      highlightRef.current.geometry.dispose();
      highlightRef.current.material.dispose();
      highlightRef.current = null;
    }
    const mat = meshRef.current.material;
    if (paintSet && paintSet.size) {
      mat.transparent = true;
      mat.opacity = 0.13;
      mat.depthWrite = false;
      const sub = extractSubGeometry(model.merged, paintSet);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(sub.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(sub.normals, 3));
      const hmat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(HIGHLIGHT_COLOR[0], HIGHLIGHT_COLOR[1], HIGHLIGHT_COLOR[2]),
        emissive: new THREE.Color(0.25, 0.14, 0.0),
        side: THREE.DoubleSide,
        clippingPlanes: [clipPlaneRef.current],
      });
      const hmesh = new THREE.Mesh(geo, hmat);
      t.scene.add(hmesh);
      highlightRef.current = hmesh;
    } else {
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
    }
    mat.needsUpdate = true;
  };

  const lastMatchRef = useRef(null); // { matched: Set(Eltern), paint: Set(inkl. Kinder) }

  const applyColors = (colorForEid, matched, label, paintSet) => {
    const model = modelRef.current;
    if (!model || !meshRef.current) return;
    zeigenZuruecksetzen();
    recolorElements(model.merged, colorForEid);
    meshRef.current.geometry.attributes.color.needsUpdate = true;
    setGhost(paintSet && paintSet.size ? paintSet : null);
    lastMatchRef.current = matched && matched.size ? { matched, paint: paintSet || matched } : null;
    if (matched) {
      const els = model.elements.filter((el) => matched.has(el.expressId));
      const area = els.reduce((s, el) => s + (el.mengen?.area || 0), 0);
      setMatchInfo({ label, found: matched.size, area, semantik: els.length });
    } else {
      setMatchInfo(null);
    }
  };

  // Position → 3D (aus der AVA-Seite): verknüpfte Bauteile markieren UND auswählen.
  const applyPositionLink = (link) => {
    const model = modelRef.current;
    if (!model || !link) return;
    const byGuid = new Map([...model.guidByExpressId].map(([eid, g]) => [g, eid]));
    const matched = new Set();
    for (const g of link.guids || []) if (byGuid.has(g)) matched.add(byGuid.get(g));
    for (const eid of link.expressIds || []) matched.add(eid);
    const soll = (link.guids?.length || 0) + (link.expressIds?.length || 0);
    const paint = expandWithDescendants(matched, model.childrenByExpressId || new Map());
    applyColors((eid) => (paint.has(eid) ? HIGHLIGHT_COLOR : DIM_COLOR), matched,
      `Position ${link.label}: ${matched.size}/${soll} Bauteile`, paint);
    selectMatches();
    clearPositionLink();
  };
  // Modell geladen → wartenden Positions-Link anwenden
  useEffect(() => {
    const link = getPositionLink();
    if (link && modelRef.current) applyPositionLink(link);
  }, [modelInfo]); // eslint-disable-line react-hooks/exhaustive-deps
  // Seite mit wartendem Link, aber ohne Modell geöffnet → Referenzmodell automatisch laden.
  // Only where a server exists (demo/cloud ended in "Server: 404" here) and never
  // against an explicit ?beispiel=1 — the link stays pending until a model is loaded.
  useEffect(() => {
    if (getPositionLink() && !modelRef.current && DATENQUELLE === "express" && !beispielImLink) loadServerFile();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ?beispiel=1 loads the sample on arrival (also when the parameter appears on the
  // mounted page). The ref keeps StrictMode's double effect from parsing twice.
  const beispielGestartet = useRef(false);
  useEffect(() => {
    if (!beispielImLink) { beispielGestartet.current = false; return; }
    if (beispielGestartet.current || MODEL_CACHE_LABEL === BEISPIEL_DATEI) return;
    beispielGestartet.current = true;
    musterprojektLaden();
  }, [beispielImLink]); // eslint-disable-line react-hooks/exhaustive-deps
  // ?url=… (Phase 67-06): das KI Tool öffnet ein Modell aus dem lokalen Harness-Dienst
  // hier — derselbe Viewer, kein zweiter. Nur http(s)-URLs; Fehler bleiben Klartext.
  useEffect(() => {
    const url = suchParams.get("url");
    if (!url || !/^https?:\/\//i.test(url)) return;
    let aktiv = true;
    (async () => {
      setBusy(true);
      setProgress("Lade IFC vom KI-Dienst…");
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Dienst: ${res.status} — Datei nicht in der Sandbox?`);
        const buf = await res.arrayBuffer();
        if (!aktiv) return;
        const name = decodeURIComponent(url.split("path=")[1] || url).split(/[\\/]/).pop();
        await loadBuffer(buf, name);
        setLoadedIfcName(name);
      } catch (e) {
        if (aktiv) { setError(String(e?.message || e)); setProgress(""); setBusy(false); }
      }
    })();
    return () => { aktiv = false; };
  }, [suchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  // Link kommt an, während das Modell bereits geladen ist (z. B. Dev-Hook
  // window.__ifcLink oder AVA-Seite im selben Fenster) → sofort anwenden.
  useEffect(() => onPositionLink((link) => {
    if (link && modelRef.current) applyPositionLink(link);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Zielposition für die Mengenübernahme kommt aus AVA, während der Viewer bereits
  // montiert ist (zweigeteilter Arbeitsbereich — früher übernahm das der Remount).
  useEffect(() => onTakeoffTarget((ziel) => {
    if (!ziel) return;
    setLvFilter(ziel.trade || "");
    setZielId(ziel.id || "");
  }), []);

  // --- Schnittebene ------------------------------------------------------------
  // Modi: horizontal (Hochachse Y), vertikal längs X bzw. Z, frei geneigt („schräg"
  // über Azimut + Neigung). Der Schieber fährt die Ebene durch die Modell-Bounding-
  // Box; „Richtung wechseln" dreht die Normale, zeigt also die andere Hälfte.
  useEffect(() => {
    const plane = clipPlaneRef.current;
    const model = modelRef.current;
    const cut = cutRef.current;
    if (!plane) return;
    if (schnitt === "aus" || !model) {
      plane.normal.set(0, -1, 0);
      plane.constant = 1e7; // schneidet nichts weg
      if (cut) { cut.helper.visible = false; cut.tcHelper.visible = false; }
      cutManualRef.current = false;
      return;
    }
    const { bbox } = model.merged;
    const mitte = [0, 1, 2].map((i) => (bbox.min[i] + bbox.max[i]) / 2);
    let n;
    if (schnitt === "h") n = new THREE.Vector3(0, -1, 0);
    else if (schnitt === "x") n = new THREE.Vector3(-1, 0, 0);
    else if (schnitt === "z") n = new THREE.Vector3(0, 0, -1);
    else {
      const az = (azimut * Math.PI) / 180;
      const ne = (neigung * Math.PI) / 180;
      n = new THREE.Vector3(-Math.cos(ne) * Math.sin(az), -Math.sin(ne), -Math.cos(ne) * Math.cos(az)).normalize();
    }
    if (schnittFlip) n.negate();
    // Stützpunkt: entlang der Normalen-Hauptachse durch die Bounding-Box fahren
    const achse = schnitt === "h" ? 1 : schnitt === "x" ? 0 : schnitt === "z" ? 2
      : [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].indexOf(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)));
    const t01 = schnittPos / 100;
    const punkt = new THREE.Vector3(mitte[0], mitte[1], mitte[2]);
    punkt.setComponent(achse, bbox.min[achse] + t01 * (bbox.max[achse] - bbox.min[achse]));
    plane.setFromNormalAndCoplanarPoint(n, punkt);
    // Gizmo + Ebenen-Anzeige an die neue Lage setzen (Größe nach Modellausdehnung)
    if (cut) {
      const spanne = Math.max(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2], 10);
      cut.dummy.position.copy(punkt);
      cut.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), n);
      cut.helper.size = spanne * 0.6;
      cut.helper.visible = gizmoOn;
      cut.tcHelper.visible = gizmoOn;
      cut.tc.enabled = gizmoOn;
      cut.tc.setMode(gizmoMode);
    }
  }, [schnitt, schnittPos, schnittFlip, azimut, neigung, modelInfo, gizmoMode, gizmoOn]);

  // --- Richtung 2: Modell → LV-Position (Mengenübernahme) ---------------------
  // Mengenbasen nach den Büro-Regeln (siehe Skill NovaAvaLV): vertikale Flächen
  // einseitig über NetSideArea (beidseitig = Faktor 2), horizontale über die
  // Grund-/Netto-Fläche, Volumen/Längen/Stück analog.
  const BASEN = [
    { key: "area", label: "Fläche m² (NetSideArea / NetArea)", kurz: "m² Fläche" },
    { key: "volume", label: "Volumen m³ (NetVolume)", kurz: "m³ Volumen" },
    { key: "length", label: "Länge m (Length)", kurz: "m Länge" },
    { key: "count", label: "Stück (Count)", kurz: "Stück" },
  ];

  useEffect(() => {
    (projectId ? bitApi.entities.LVPosition.filter({ project_id: projectId }) : bitApi.entities.LVPosition.list("oz"))
      .then((list) => setPositionen(Array.isArray(list) ? list : []))
      .catch(() => { /* offline: Übernahme bleibt aus */ });
  }, [projectId]);

  // LV-Vorauswahl + Suche über OZ/Titel/Kurztext — bei >2.000 Positionen sonst unbedienbar
  const lvListe = [...new Set(positionen.map((p) => p.trade).filter(Boolean))].sort(byTrade);
  const gefiltertePositionen = positionen.filter((p) => {
    if (lvFilter && p.trade !== lvFilter) return false;
    const q = posSuche.trim().toLowerCase();
    if (!q) return true;
    return [p.oz, p.title, p.short_text, p.lb, p.din276_2018]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });

  // Aktuell im Modell ausgewählte/markierte Elemente (Eltern, nicht die Kinder)
  const aktiveTreffer = () => {
    const lm = lastMatchRef.current;
    if (lm?.matched?.size) return [...lm.matched];
    if (picked && !picked.multi && picked.eid != null) return [picked.eid];
    return [];
  };

  // Grundriss aus der Geometrie ins Gebäudemodell übernehmen.
  //
  // `BimModel.footprintM` speist über useBuildingProgram sämtliche Kennzahlen der
  // Fachreiter (BGF, GRZ/GFZ, Höhe, Brandschutz-Richtwerte). Beim Referenzprojekt stand dort ein
  // prozedurales 40×26-Rechteck, während das echte Gebäude hier im Viewer lag —
  // die einzige Stelle im System, an der die Kubatur überhaupt bekannt ist.
  // Geschrieben wird über saveBimModel (der einzige Schreibpfad, KD-17).
  const [grundrissLaeuft, setGrundrissLaeuft] = useState(false);
  const grundrissUebernehmen = async () => {
    const model = modelRef.current;
    if (!model) { toast.error("Erst ein IFC-Modell laden."); return; }
    if (!projectId) { toast.error("Kein Projekt gewählt."); return; }
    setGrundrissLaeuft(true);
    try {
      // Das ERDGESCHOSS bestimmt die Grundfläche (GRZ = überbaute Fläche am Boden).
      // Ohne erkennbares EG über alle Geschosse rechnen — dann ist es die Vereinigung
      // aller Grundrisse und eher zu groß, was in der Meldung steht.
      const g = geschosseAusModell(model);
      const eg = g.belegt.find((x) => /^(EG|E0|00|Erdgeschoss)/i.test(x)) || null;
      let r = eg ? grundrissAusModell(model, { geschoss: eg }) : null;
      if (!r) r = grundrissAusModell(model);
      if (!r || r.polygon.length < 3) {
        toast.error("Aus diesem Modell ließ sich kein Grundriss ableiten.");
        return;
      }

      // Grundriss UND Geschosszahl in einem Zug — beide speisen dieselben Kennzahlen,
      // und ein Grundriss mit falscher Geschosszahl ergibt wieder eine falsche BGF.
      // 73-05: the outline carries its provenance (measured, source, storey, raster deviation, date) —
      // before, quelle/hinweis only reached a toast and nobody could tell a sketch from a survey later.
      const patch = { footprintM: r.polygon, footprintQuelle: footprintQuelleGemessen(r) };
      if (g.anzahl > 0) patch.storeys = g.anzahl;
      await saveBimModel(projectId, patch);
      // ...and the shared program store when it holds this project: otherwise the designer's write-back
      // (useBimModelSync) would overwrite the measured outline with the next program value.
      if (storeGehoertZu(projectId)) buildingProgram.set(patch);

      const wo = r.geschoss ? `Geschoss ${r.geschoss}` : "alle Geschosse vereinigt";
      toast.success(
        `Grundriss übernommen: ${r.flaeche.toLocaleString("de-DE")} m² `
        + `(${wo}, Quelle ${r.quelle}, ${r.polygon.length} Eckpunkte)`
        + (g.anzahl > 0 ? ` · Geschosse: ${g.anzahl} (${g.belegt.join(", ")})` : ""),
        { duration: 10000 },
      );
      if (!r.geschoss) {
        toast.warning(
          "Kein Erdgeschoss erkannt — der Umriss ist die Vereinigung aller Geschosse "
          + "und damit eher zu groß. Geschossnamen im Modell prüfen.",
          { duration: 12000 },
        );
      }
      if (g.leer.length) {
        toast.info(`Ohne Bauteile und daher nicht gezählt: ${g.leer.join(", ")}`, { duration: 8000 });
      }
      if (r.hinweis) toast.warning(r.hinweis, { duration: 12000 });
    } catch (e) {
      toast.error(`Übernahme fehlgeschlagen: ${e?.message || e}`);
    } finally {
      setGrundrissLaeuft(false);
    }
  };

  // 72-04: attribute check of the marked elements against the target position (DIN 276,
  // fire rating, load-bearing). Shown before the takeover, stored with it; never a block
  // (reason in mengenAttributPruefung.js).
  const attributPruefung = (() => {
    const model = modelRef.current;
    const ziel = positionen.find((p) => p.id === zielId);
    const eids = aktiveTreffer();
    if (!model || !ziel || !eids.length) return null;
    const set = new Set(eids);
    return pruefeAttributeVorUebernahme(model.elements.filter((el) => set.has(el.expressId)), ziel);
  })();
  /** @param {{ key: string, anzahl: number, werte?: string[] }} b */
  const befundText = (b) => {
    const TEXTE = {
      kg_abgeleitet: "{n} Bauteil(e) ohne DIN-276-Klassifikation im Modell — Kostengruppe nur aus dem Bauteiltyp abgeleitet",
      kg_abweichend: "{n} Bauteil(e) mit anderer Kostengruppe als die Position: {werte}",
      feuer_fehlt: "{n} Bauteil(e) ohne Feuerwiderstand (FireRating)",
      feuer_gemischt: "Feuerwiderstand gemischt: {werte} — eine Position, verschiedene Qualitäten?",
      tragend_fehlt: "{n} Bauteil(e) ohne Angabe tragend/nichttragend (LoadBearing)",
      tragend_gemischt: "Tragende und nichttragende Bauteile gemischt — DIN 276 trennt 341/342",
    };
    return t(TEXTE[b.key] || b.key).replace("{n}", fmt(b.anzahl)).replace("{werte}", (b.werte || []).join(", "));
  };

  const uebernehmen = async () => {
    const model = modelRef.current;
    const ziel = positionen.find((p) => p.id === zielId);
    const eids = aktiveTreffer();
    if (!model || !ziel || !eids.length) return;
    const byEid = new Map(model.elements.map((el) => [el.expressId, el]));
    const els = eids.map((e) => byEid.get(e)).filter(Boolean);
    const pruefung = pruefeAttributeVorUebernahme(els, ziel);
    const menge = basis === "count"
      ? els.length * faktor
      : els.reduce((s, el) => s + (el.mengen?.[basis] || 0), 0) * faktor;
    const guids = eids.map((e) => model.guidByExpressId.get(e)).filter(Boolean);
    const herkunft = matchInfo?.label || "Auswahl im Modell";
    try {
      await bitApi.entities.LVPosition.update(ziel.id, {
        quantity: Math.round(menge * 1000) / 1000,
        ifc_guids: guids,
        ifc_filter: herkunft,
        ifc_menge: Math.round(menge * 1000) / 1000,
        ifc_basis: basis,
        ifc_faktor: faktor,
        ifc_stand: new Date().toISOString().slice(0, 10),
        mengen_modus: "manuell",
        // 72-04 (additive field): what the attribute check found at takeover time.
        ifc_pruefung: { stand: new Date().toISOString().slice(0, 10), geprueft: pruefung.geprueft, befunde: pruefung.befunde },
      });
      if (pruefung.befunde.length) {
        toast.warning(t("Übernommen mit offenen Attributen — Befunde an der Position vermerkt."), { duration: 8000 });
      }
      toast.success(`Menge ${menge.toLocaleString("de-DE", { maximumFractionDigits: 2 })} `
        + `an Position ${ziel.oz} übernommen (${els.length} Bauteile)`);
      setPositionen((list) => list.map((p) => (p.id === ziel.id
        ? { ...p, quantity: Math.round(menge * 1000) / 1000, ifc_guids: guids } : p)));
      setTakeoffTarget(null);
    } catch {
      toast.error("Übernahme fehlgeschlagen — läuft der lokale Server?");
    }
  };

  // „im Modell markieren" (Menge-→-Zeile): verknüpfte Bauteile der gewählten Position
  // direkt hier markieren, ohne zur AVA-Seite zu wechseln (kostet dort das geladene
  // Modell). Gleicher Mechanismus wie applyPositionLink/highlightFilter (orange
  // markiert, Rest transparent) — nur über eidByGuidRef statt Neuaufbau je Klick.
  const positionImModellMarkieren = () => {
    const model = modelRef.current;
    const ziel = positionen.find((p) => p.id === zielId);
    if (!model || !ziel) return;
    const byGuid = eidByGuidRef.current || new Map();
    const guids = ziel.ifc_guids || [];
    const expressIds = (ziel.bim_element_ids || [])
      .filter((x) => String(x).startsWith("ifc-"))
      .map((x) => Number(String(x).slice(4)))
      .filter(Number.isFinite);
    if (!guids.length && !expressIds.length) {
      toast.error(`Position ${ziel.oz || ziel.id} hat keine verknüpften Bauteile`);
      return;
    }
    const matched = new Set();
    for (const g of guids) if (byGuid.has(g)) matched.add(byGuid.get(g));
    for (const eid of expressIds) matched.add(eid);
    if (!matched.size) {
      toast.error(`Position ${ziel.oz || ziel.id}: GlobalIds nicht im geladenen Modell gefunden`);
      return;
    }
    const paint = expandWithDescendants(matched, model.childrenByExpressId || new Map());
    const label = `Position ${ziel.oz || ""} ${ziel.title || ziel.short_text || ""}`.trim();
    applyColors((eid) => (paint.has(eid) ? HIGHLIGHT_COLOR : DIM_COLOR), matched, label, paint);
  };

  // NOVA-AVA-Bauteilfilter laden (Büro-Vorlagenordner über die Dev-Route) und
  // direkt auf das IFC anwenden — dieselbe Mengenlogik wie in NOVA, ohne NOVA.
  useEffect(() => {
    let abgebrochen = false;
    fetch("/api/bauteilfilter")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (abgebrochen || !d?.filter) return;
        const list = [];
        for (const f of d.filter) {
          for (const parsed of parseFilterXml(f.xml)) {
            if (parsed.criteria.length) {
              list.push({ key: `${f.gruppe}/${f.datei}#${parsed.id}`, gruppe: f.gruppe,
                titel: parsed.titel || parsed.title || f.datei.replace(/\.xml$/i, ""), filter: parsed });
            }
          }
        }
        list.sort((a, b) => (a.gruppe + a.titel).localeCompare(b.gruppe + b.titel, "de"));
        setNovaFilters(list);
      })
      .catch(() => { /* Filterordner nicht verfügbar — Feature bleibt aus */ });
    return () => { abgebrochen = true; };
  }, []);

  // IFC-Ordner auflisten (SPIKE-Route) — Grundlage für „Referenzmodell laden" (neueste
  // Datei) und die Auswahl älterer Stände, ohne Pfad-Eingabe oder Server-Neustart.
  useEffect(() => {
    let abgebrochen = false;
    fetch("/api/ifc-files")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!abgebrochen && d?.files) setIfcFiles(d.files); })
      .catch(() => { /* Ordner nicht verfügbar — bisheriges Verhalten bleibt */ });
    return () => { abgebrochen = true; };
  }, []);

  // Autoload: sobald die Ordnerliste da ist, das gemerkte (sonst das neueste)
  // Servermodell laden — genau einmal, und nie über eine laufende oder bereits
  // erfolgte Nutzerladung hinweg. An explicit ?beispiel=1 wins over the autoload.
  const autoloadDone = useRef(false);
  useEffect(() => {
    if (autoloadDone.current || !ifcFiles.length) return;
    autoloadDone.current = true;
    if (busy || modelRef.current || beispielImLink) return;
    let gemerkt = null;
    try { gemerkt = localStorage.getItem(AUTOLOAD_KEY); } catch { /* Storage gesperrt */ }
    const name = gemerkt && ifcFiles.some((f) => f.name === gemerkt) ? gemerkt : undefined;
    loadServerFile(name);
  }, [ifcFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bauteilfilter-Suche über Filtername UND Gruppenname — bei ~207 Filtern sonst unbedienbar
  const novaSucheQ = novaSuche.trim().toLowerCase();
  const gefilterteNovaFilters = novaSucheQ
    ? novaFilters.filter((f) => `${f.gruppe} ${f.titel}`.toLowerCase().includes(novaSucheQ))
    : novaFilters;

  const applyNovaFilterToModel = () => {
    const model = modelRef.current;
    const entry = novaFilters.find((f) => f.key === novaFilterKey);
    if (!model || !entry) return;
    const hits = applyNovaFilter(model.elements, entry.filter);
    const matched = new Set(hits.map((el) => el.expressId));
    const paint = expandWithDescendants(matched, model.childrenByExpressId || new Map());
    applyColors((eid) => (paint.has(eid) ? HIGHLIGHT_COLOR : DIM_COLOR), matched,
      `Bauteilfilter „${entry.titel}"`, paint);
  };

  // Ähnliche Bauteile zum angeklickten finden — Kriterium wählbar. Praktisch für die
  // Mengenübernahme: ein Bauteil anklicken, „gleicher Typ" → alle gleichartigen markiert.
  const aehnlicheFinden = (kriterium) => {
    const model = modelRef.current;
    if (!model || !picked || picked.multi || picked.eid == null) return;
    const ref = model.elements.find((el) => el.expressId === picked.eid);
    if (!ref) return;
    const gleich = (el) => {
      switch (kriterium) {
        case "typ": return !!ref.typ && el.typ === ref.typ;
        case "typStatus": return !!ref.typ && el.typ === ref.typ && el.status === ref.status;
        case "layerStatus": return !!ref.layer && el.layer === ref.layer && el.status === ref.status;
        case "klasseStatus": return el.ifcType === ref.ifcType && el.status === ref.status;
        default: return false;
      }
    };
    const matched = new Set(model.elements.filter(gleich).map((el) => el.expressId));
    if (!matched.size) {
      toast.error("Kein Merkmal für die Ähnlichkeitssuche vorhanden (Bauteiltyp/Ebene fehlt)");
      return;
    }
    const bez = { typ: `Typ „${ref.typ}"`, typStatus: `Typ „${ref.typ}" + ${ref.status}`,
      layerStatus: `Ebene „${ref.layer}" + ${ref.status}`,
      klasseStatus: `${ref.ifcType} + ${ref.status}` }[kriterium];
    const paint = expandWithDescendants(matched, model.childrenByExpressId || new Map());
    applyColors((eid) => (paint.has(eid) ? HIGHLIGHT_COLOR : DIM_COLOR), matched,
      `Ähnliche Bauteile: ${bez}`, paint);
    setSelectionMesh(paint);
    setPicked(null);
  };

  useEffect(() => {
    statusSichtbarRef.current = statusSichtbar;
    sichtbarkeitNachStatus();
  }, [statusSichtbar, modelInfo]); // eslint-disable-line react-hooks/exhaustive-deps
  const zaehlerStatus = modelInfo && modelRef.current ? statusZaehler(modelRef.current.elements) : null;

  const highlightFilter = () => {
    const model = modelRef.current;
    if (!model) return;
    const byEid = new Map(model.elements.map((el) => [el.expressId, el]));
    const matched = new Set();
    for (const [eid, el] of byEid) {
      // 89-04: "ohne" marks the elements the model gives no status (null), shown as "ohne Status".
      const stOk = !statusFilter || (statusFilter === "ohne" ? statusSchluessel(el.status) === "ohne" : el.status === statusFilter);
      const code = String(el.classification?.code || "");
      const kgOk = !kgFilter || code.startsWith(kgFilter);
      if (stOk && kgOk && (statusFilter || kgFilter)) matched.add(eid);
    }
    const paint = expandWithDescendants(matched, model.childrenByExpressId || new Map());
    applyColors((eid) => (paint.has(eid) ? HIGHLIGHT_COLOR : DIM_COLOR), matched,
      `Filter ${kgFilter || "*"} ∩ ${statusFilter || "*"}`, paint);
  };

  const resetColors = () => {
    const model = modelRef.current;
    if (!model) return;
    const byEid = new Map(model.elements.map((el) => [el.expressId, el]));
    applyColors((eid) => STATUS_COLORS[byEid.get(eid)?.status] || STATUS_COLORS.unbekannt, null, "");
    setPicked(null);
  };

  // Alle aktuell markierten Treffer zusätzlich AUSWÄHLEN (wie angeklickt): blaues
  // Auswahl-Mesh über alle + Sammel-Info-Panel mit Σ-Mengen aus den BaseQuantities.
  const selectMatches = () => {
    const model = modelRef.current;
    const lm = lastMatchRef.current;
    if (!model || !lm) return;
    setSelectionMesh(lm.paint);
    const els = model.elements.filter((el) => lm.matched.has(el.expressId));
    setPicked({
      multi: true,
      // snapshot of the selected elements: a later search or filter replaces lastMatchRef, the selection stays
      eids: [...lm.matched],
      count: lm.matched.size,
      semantik: els.length,
      area: els.reduce((s, el) => s + (el.mengen?.area || 0), 0),
      volume: els.reduce((s, el) => s + (el.mengen?.volume || 0), 0),
      typen: [...new Set(els.map((el) => el.ifcType))].slice(0, 4).join(", "),
    });
  };

  // expressId → semantic element, built once per model (hover asks every frame, click once).
  const semKarteRef = useRef({ model: null, karte: new Map() });
  const elementZu = (model, eid) => {
    if (semKarteRef.current.model !== model) {
      semKarteRef.current = { model, karte: new Map(model.elements.map((x) => [x.expressId, x])) };
    }
    return semKarteRef.current.karte.get(eid);
  };

  // The selection record of one element (panel + links). Used by the click, by the command
  // "auswahl-guid" (106-02) and by the ?sel link, so all reach the same state. GlobalId, not expressID,
  // anchors shareable links (65-05): the expressID changes with every export, the GlobalId does not.
  // ms: ray time in ms; null when no ray ran (command, link) - the panel then says how it was selected.
  const pickedAus = (eid, sem, ms) => ({
    eid, ms,
    guid: sem?.globalId || "",
    typ: sem?.ifcType || "(ohne Semantik — z. B. Morph/Proxy)",
    typ2: sem?.typ || "",       // Archicad-Bauteiltyp (für die Ähnlichkeitssuche)
    layer: sem?.layer || "",    // Ebene (für die Ähnlichkeitssuche)
    name: sem?.name || "", status: sem?.status || "unbekannt",
    kg: sem?.classification?.code || "—", storey: sem?.storey || "—",
    area: sem?.mengen?.area || 0, volume: sem?.mengen?.volume || 0,
  });

  // Klick + Hover → Strahl → Treffer (106-01: ein Pick-Kern, Klick und Hover gleich) → Element-Info
  const tText = t; // the effect below shadows `t` with the three.js handle bag
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    const el = t.renderer.domElement;
    const zeigen = hervorhebung();
    zeigenRef.current = zeigen;
    const drossel = pickDrossel();

    // Which element a hit belongs to: face index → range table → expressId → GUID (@ifc resolver,
    // the same for click, hover and every later pointer).
    const aufloeser = (treffer) => ifcAufloeser(modelRef.current, meshRef.current)(treffer);
    // Ray through a client position, tested against the merged mesh ONLY (never the selection or
    // ghost overlays) and against its section plane; null on a miss or a zero-size canvas.
    // 106-07: with the capture radius of the pointer kind (mouse exact as before, pen 8 px, finger 18 px): when the exact
    // ray finds no element, the rings around it are tried and the nearest element wins.
    // Review fix 106-07: with guidPflicht (hover) the rings accept only elements WITH a GUID - the same test the hover applies to the
    // result, so an element without GUID near the pointer no longer ends the ring search before an element with GUID further out.
    /** @type {(clientX: number, clientY: number, art?: import("@core/lib/zeigen/strahlPick.js").ZeigerArt, guidPflicht?: boolean) => any} */
    const treffenBei = (clientX, clientY, art = /** @type {import("@core/lib/zeigen/strahlPick.js").ZeigerArt} */ ("mouse"), guidPflicht = false) => {
      const mesh = meshRef.current;
      if (!mesh) return null;
      return zeigerPick(mesh, t.camera, el, clientX, clientY, {
        art, schnittebenen: mesh.material?.clippingPlanes,
        annehmen: (tr) => !!identitaetAus(tr, aufloeser, { guidPflicht }),
      });
    };

    // 106-07: pointers on the canvas. One finger or the pen tip: tap = select, drag = orbit (OrbitControls); two fingers:
    // pinch and pan (OrbitControls) plus twist = turn around the vertical axis (here). The last finger lifting after a
    // two-finger gesture never selects.
    const geste = zweiFingerGeste();
    const ACHSE_Y = new THREE.Vector3(0, 1, 0);
    const versatz = new THREE.Vector3();
    let down = null;
    const onDown = (e) => {
      const art = zeigerArt(e);
      zeigerArtRef.current = art;
      const anzahl = geste.runter(e.pointerId, e.clientX, e.clientY);
      if (anzahl === 1) down = { x: e.clientX, y: e.clientY, art, id: e.pointerId };
      if (anzahl >= 2) hoverLoeschen();
    };
    const onGeste = (e) => {
      const schritt = geste.bewegt(e.pointerId, e.clientX, e.clientY);
      if (!schritt) return;
      // twist: the camera turns around the orbit target about the vertical axis, so the model turns WITH the fingers
      // (fingers clockwise on screen = model clockwise seen from above) [ASSUMED direction, as on map apps]
      const ziel = t.controls.target;
      versatz.subVectors(t.camera.position, ziel).applyAxisAngle(ACHSE_Y, schritt.drehungRad);
      t.camera.position.copy(ziel).add(versatz);
      t.camera.lookAt(ziel);
      gestenSummeRef.current = {
        schritte: gestenSummeRef.current.schritte + 1,
        drehungRad: gestenSummeRef.current.drehungRad + schritt.drehungRad,
        faktor: gestenSummeRef.current.faktor * schritt.faktor,
      };
    };
    const onEnde = (e) => { geste.hoch(e.pointerId); };
    const onUp = (e) => {
      const warGeste = geste.warGeste();
      onEnde(e);
      if (!down || down.id !== e.pointerId || warGeste) { if (geste.anzahl() === 0) down = null; return; }
      const art = down.art;
      const weit = Math.hypot(e.clientX - down.x, e.clientY - down.y) > TIPP_TOLERANZ_PX[art];
      down = null;
      if (weit) return;
      const model = modelRef.current;
      const mesh = meshRef.current;
      if (!model || !mesh) return;
      const t0 = performance.now();
      const id = identitaetAus(treffenBei(e.clientX, e.clientY, art), aufloeser); // click keeps elements without GUID selectable
      const ms = Math.round(performance.now() - t0);
      if (!id) { setPicked(null); return; } // miss or unknown hit: nothing is selected, nothing is guessed
      hoverLoeschen(); // the clicked element becomes "ausgewählt" (blue); the hover colour must not stay under it
      const eid = /** @type {number} */ (id.expressId);
      const sem = elementZu(model, eid);
      setSelectionMesh(eid);
      setPicked(pickedAus(eid, sem, ms));
    };

    // Hover: remember the last pointer, ONE pick per animation frame, and never faster than the
    // pick budget allows (a slow pick on a big model delays the next one; a pointer that moved
    // less than HOVER_MIN_PX since the last pick does not pick again).
    let zeiger = null;
    let letzterPick = null;
    let rafId = 0;
    let radTimer = 0;
    const tick = () => {
      rafId = 0;
      const model = modelRef.current;
      const mesh = meshRef.current;
      if (!zeiger || !model || !mesh) return;
      if (cutRef.current?.tc?.dragging) { hoverLoeschen(); return; } // the section gizmo owns the pointer
      const jetzt = performance.now();
      if (!drossel.darf(jetzt)) { rafId = requestAnimationFrame(tick); return; }
      const bewegt = !letzterPick || Math.hypot(zeiger.x - letzterPick.x, zeiger.y - letzterPick.y) >= HOVER_MIN_PX;
      if (bewegt || !hoverRef.current) {
        letzterPick = { x: zeiger.x, y: zeiger.y };
        const treffer = treffenBei(zeiger.x, zeiger.y, zeiger.art, true); // 106-07: a hovering pen gets its capture radius (GUID elements only)
        drossel.messen(performance.now() - jetzt, performance.now());
        // guidPflicht: only what a later "dieses" command could address is shown
        const id = identitaetAus(treffer, aufloeser, { guidPflicht: true });
        if (!id) { hoverLoeschen(); return; } // no hit or unknown hit: nothing is shown, nothing is guessed
        const eid = /** @type {number} */ (id.expressId);
        const gewaehlt = !!(pickedRef.current && !pickedRef.current.multi && pickedRef.current.eid === eid);
        const name = gewaehlt ? "auswahl" : "fokus";
        if (hoverRef.current?.expressId !== eid || hoverRef.current?.zustand !== name) {
          hoverLoeschen();
          if (!gewaehlt) { // the selected element keeps its blue and its outline, hover never paints over it
            try {
              for (const r of model.merged.ranges) {
                if (r.eid !== eid) continue;
                const ziel = { mesh, bereich: { start: r.start, count: r.count } };
                zeigen.setzen(ziel, "fokus");
                hoverZieleRef.current.push(ziel);
              }
            } catch (err) { console.warn(`[IFC] hover highlight failed: ${err?.message || err}`); }
          }
          const sem = elementZu(model, eid);
          hoverRef.current = { quelle: "ifc", guid: id.guid, expressId: eid, typ: sem?.ifcType || "IFC", name: sem?.name || "", zustand: name };
          if (hoverTextRef.current) hoverTextRef.current.textContent = `${hoverRef.current.typ}${sem?.name ? ` · ${sem.name}` : ""}`;
          // the overlay says the state the picture shows: words, colour and outline form
          const look = ZEIGE_ZUSTAENDE[name];
          if (hoverZustandRef.current) hoverZustandRef.current.textContent = tText(look.label);
          if (hoverSymbolRef.current) {
            hoverSymbolRef.current.style.borderColor = look.hex;
            hoverSymbolRef.current.style.borderStyle = ZEIGE_CSS_RAND[look.umriss];
          }
        }
      }
      const box = hoverBoxRef.current;
      const mount = mountRef.current;
      if (box && mount) {
        box.style.display = ""; // visible first, otherwise offsetWidth is 0 and the clamp below is skipped
        const r = mount.getBoundingClientRect();
        const x = Math.max(0, Math.min(zeiger.x - r.left + 14, r.width - box.offsetWidth - 4));
        const y = Math.max(0, Math.min(zeiger.y - r.top + 14, r.height - box.offsetHeight - 4));
        box.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const onMove = (e) => {
      onGeste(e);
      if (e.buttons) { hoverLoeschen(); zeiger = null; return; } // orbit / pan / gizmo drag / finger on the glass: no hover
      // 106-07: a pen above the glass (buttons 0) is hovering: it shows the focus like the mouse; a finger has no hover
      const art = zeigerArt(e);
      if (art === "touch") return;
      if (art === "pen") zeigerArtRef.current = "pen";
      zeiger = { x: e.clientX, y: e.clientY, art };
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    const onLeave = () => { zeiger = null; hoverLoeschen(); };
    // Zooming moves the scene under a resting pointer: drop the hover and look again once the
    // wheel has settled (the pointer itself did not move, so no pointermove will come).
    const onWheel = () => {
      hoverLoeschen();
      letzterPick = null;
      clearTimeout(radTimer);
      radTimer = window.setTimeout(() => { if (zeiger && !rafId) rafId = requestAnimationFrame(tick); }, WHEEL_PAUSE_MS);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onEnde);
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onEnde);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(radTimer);
      zeigen.verwerfen(); // hover, marks and the cached outline geometries
      hoverZieleRef.current = [];
      hoverRef.current = null;
      if (hoverBoxRef.current) hoverBoxRef.current.style.display = "none";
      zeigenRef.current = null;
    };
  }, [modelInfo]);

  // Show a state on an element by its GUID (marks: warnung / fehler / auswahl / fokus). The ground
  // truth is the GUID, never a picture. Used by the test hook now; later plans call it to show
  // findings and changed parts. Returns false when the GUID is not in the model.
  const zustandSetzen = (guid, zustand) => {
    const zeigen = zeigenRef.current;
    const mesh = meshRef.current;
    const eid = eidByGuidRef.current?.get(guid);
    if (!zeigen || !mesh || !modelRef.current || eid == null) return false;
    let n = 0;
    for (const r of modelRef.current.merged.ranges) {
      if (r.eid === eid) { zeigen.setzen({ mesh, bereich: { start: r.start, count: r.count } }, zustand); n += 1; }
    }
    return n > 0;
  };
  /** Remove a mark again (one state, or all states of the element when `zustand` is omitted). */
  const zustandLoeschen = (guid, zustand) => {
    const zeigen = zeigenRef.current;
    const eid = eidByGuidRef.current?.get(guid);
    if (!zeigen || !meshRef.current || !modelRef.current || eid == null) return;
    for (const r of modelRef.current.merged.ranges) {
      if (r.eid === eid) zeigen.loeschen({ mesh: meshRef.current, bereich: { start: r.start, count: r.count } }, zustand);
    }
  };

  // 106-01: test and agent hook while the viewer is mounted, under window.__bitZeigen.ifc (the BIM
  // studio uses .bim, so two mounted viewers never overwrite each other). Plain data only (no
  // three.js objects), so it serialises.
  useEffect(() => {
    const w = /** @type {any} */ (window);
    const api = {
      hover: () => (hoverRef.current ? { ...hoverRef.current } : null),
      zustaende: () => ZEIGE_ZUSTAENDE,
      /** Active highlight layers; `zustand` counts only that state. */
      markiert: (zustand) => (zeigenRef.current?.aktive() ?? []).filter((x) => !zustand || x.zustand === zustand).length,
      /** Form of every active highlight: state, outline material, symbol. */
      formen: () => (zeigenRef.current?.aktive() ?? []).map((x) => ({ zustand: x.zustand, umriss: x.umriss, symbol: x.symbol })),
      /** Helper objects really present in the scene graph below the merged mesh (outlines, symbols). */
      hilfsobjekte: () => (meshRef.current?.children ?? []).filter((c) => c.userData.zeigeHilfe).map((c) => ({
        typ: c.type, material: c.material?.type ?? null, zustand: c.userData.zeigeZustand ?? null, geschnitten: !!c.material?.clippingPlanes?.length,
      })),
      /** The selection as drawn: the blue mesh present, and its outline children. */
      auswahl: () => (selMeshRef.current ? {
        sichtbar: selMeshRef.current.visible,
        umriss: selMeshRef.current.children.filter((c) => c.userData.zeigeHilfe).map((c) => ({ zustand: c.userData.zeigeZustand, material: c.material.type })),
      } : null),
      zustandSetzen, zustandLoeschen,
      /** 106-07: camera relative to the orbit target - distance (m) and azimuth around the vertical axis (rad). */
      kamera: () => {
        const th = threeRef.current;
        if (!th) return null;
        const d = th.camera.position.clone().sub(th.controls.target);
        return { abstand: d.length(), azimutRad: Math.atan2(d.x, d.z) };
      },
      /** 106-07: kind of the last pointer on the canvas and the sum of two-finger steps seen (count, twist rad, pinch factor). */
      zeiger: () => ({ art: zeigerArtRef.current, geste: { ...gestenSummeRef.current } }),
    };
    w.__bitZeigen = { ...(w.__bitZeigen || {}), ifc: api };
    return () => { if (w.__bitZeigen?.ifc === api) delete w.__bitZeigen.ifc; };
  }, []);

  // 106-02: ONE command register for this viewer (same pattern as the Massing modeller, 104-03): the
  // selection as context for speech and agents. The register is built once; the commands read the
  // latest state through `aktuell` (re-assigned every render).
  const aktuell = useRef(/** @type {Record<string, any>} */ ({}));
  /** expressIds of the current selection (from the synchronous ref): one element, or the snapshot taken by "Treffer auswählen". */
  const auswahlEids = () => {
    const p = pickedRef.current;
    if (!p) return [];
    if (p.multi) return [...(p.eids || [])];
    return p.eid != null ? [p.eid] : [];
  };
  // a big multi selection is cut for the record, never silently: the total and `gekuerzt` say so
  const kontextAus = (eids) => {
    const model = modelRef.current;
    const dom = threeRef.current?.renderer?.domElement;
    if (!model) return ifcAuswahlKontext([], { merged: null });
    return ifcAuswahlKontext(eids, model, { elementZu: (eid) => elementZu(model, eid),
      kamera: threeRef.current?.camera, breite: dom?.clientWidth, hoehe: dom?.clientHeight });
  };
  aktuell.current = {
    kontext: () => kontextAus(auswahlEids()),
    waehleGuid: (/** @type {string} */ guid) => {
      const model = modelRef.current;
      if (!model) throw new Error("Kein Modell geladen");
      const eid = eidByGuidRef.current?.get(guid);
      if (eid == null) return null;
      // what a click cannot select, a command does not select either: refused with the reason, not drawn blue
      const sem = elementZu(model, eid);
      if (!model.merged.ranges.some((r) => r.eid === eid)) throw new Error(`Bauteil hat keine Geometrie im Modell — Auswahl nicht möglich: ${guid}`);
      if (statusSichtbarRef.current[statusSchluessel(sem?.status)] === false) throw new Error(`Bauteil ist über den Status-Filter ausgeblendet — Auswahl nicht möglich: ${guid}`);
      hoverLoeschen();
      setSelectionMesh(eid);
      setPicked(pickedAus(eid, sem, null)); // no ray ran
      return kontextAus([eid]);
    },
    aufheben: () => { setPicked(null); }, // the effect on `picked` removes the blue mesh
    ansichtAufAuswahl: () => {
      const model = modelRef.current;
      const t3 = threeRef.current;
      if (!model || !t3) throw new Error("Kein Modell geladen");
      const eids = expandWithDescendants(new Set(auswahlEids()), model.childrenByExpressId || new Map());
      const box = elementBox(model.merged, eids);
      if (!box) throw new Error("Die Auswahl hat keine Geometrie im Modell");
      const cam = t3.camera;
      const ziel = ansichtAufBox(box, {
        richtung: [cam.position.x - t3.controls.target.x, cam.position.y - t3.controls.target.y, cam.position.z - t3.controls.target.z],
        fovGrad: cam.fov, aspekt: cam.aspect,
      });
      cam.position.set(...ziel.position);
      t3.controls.target.set(...ziel.ziel);
      t3.controls.update();
    },
    modell: (/** @type {{klasse?: string}} */ opt) => {
      if (!modelRef.current) throw new Error("Kein Modell geladen");
      return ifcModellUebersicht(modelRef.current, opt);
    },
    // 106-04: one PNG of the view (what the person sees, selection and previews included) for a model without eyes
    ansichtBild: (/** @type {{breite?: any}} */ opt) => {
      if (!modelRef.current) throw new Error("Kein Modell geladen");
      return ansichtAlsPng(threeRef.current, opt);
    },
    // 106-06: the open project for the image rules (an NDA project never sends an image; the id lets the MCP server check the consent)
    projekt: () => ({ id: project?.id ?? null, nda: project?.nda === true }),
  };
  // ---- 106-03: change commands. Only properties of imported elements, only as journal entries (IfcAenderung). ----
  const vorschlaege = useMemo(() => vorschlagSpeicher(), []);
  /** Journal entries of the loaded model as the viewer knows them (loaded, or written by a command: `id` follows when the save is done). */
  const journalRef = useRef(/** @type {any[]} */ ([]));
  const [journalStand, setJournalStand] = useState(0); // counter: tells the attribute editor to reload after a command wrote
  const modellName = () => modelInfo?.label || loadedIfcName || "";
  useEffect(() => {
    journalRef.current = [];
    if (!projectId || !modellName()) return undefined;
    let aktiv = true;
    bitApi.entities.IfcAenderung.filter({ project_id: projectId, modell: modellName() })
      .then((r) => { if (aktiv) journalRef.current = r || []; })
      .catch((e) => { if (aktiv) toast.error(`${t("Journal nicht geladen")}: ${e?.message || e}`); });
    return () => { aktiv = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modellName() reads exactly modelInfo and loadedIfcName
  }, [projectId, modelInfo, loadedIfcName]);
  /** Preview of an open proposal: the 'warnung' (or 'fehler') mark on the element, by GUID. */
  const vorschauRef = useRef(/** @type {Map<string, {guid: string, zustand: "warnung"|"fehler"}>} */ (new Map()));
  const vorschauEntfernen = (/** @type {string} */ id) => {
    const m = vorschauRef.current.get(id);
    if (m) zustandLoeschen(m.guid, m.zustand);
    vorschauRef.current.delete(id);
  };
  const vorschauZeigen = (/** @type {any} */ v) => {
    vorschauEntfernen(v.id);
    const zustand = v.pruefung?.stufe === "fehler" ? "fehler" : "warnung";
    if (zustandSetzen(v.ziel.guid, zustand)) vorschauRef.current.set(v.id, { guid: v.ziel.guid, zustand });
  };
  const aenderung = useRef(/** @type {Record<string, any>} */ ({}));
  aenderung.current = {
    kontext: () => kontextAus(auswahlEids()),
    modell: () => ({}), // no drawn elements here: the checks of the rules have nothing to compare
    ansicht: () => ansichtAusKamera(threeRef.current?.camera), // 106-05: "nach links" is screen left (only properties change here, but the words are the same)
    zeigepunkt: () => null,
    arten: ["eigenschaft"],
    nichtMoeglichText: t("Nur für gezeichnete Bauteile (BIM-Studio) — IFC-Dateien bleiben unverändert"),
    optionen: () => ({ projektId: projectId || null, attributPruefung: pruefeAttributeVorUebernahme, eintraege: journalRef.current }),
    ifcBauteil: (/** @type {string} */ guid) => {
      const model = modelRef.current;
      const eid = eidByGuidRef.current?.get(guid);
      if (!model || eid == null) return null;
      const sem = elementZu(model, eid);
      if (!sem) return null;
      return { quelle: "ifc", modell: modellName(), guid, psets: sem.psets || {}, project_id: projectId || null, klasse: sem.ifcType || null, name: sem.name || "" };
    },
    speicher: vorschlaege,
    uebernehmen: (/** @type {any} */ v, /** @type {any} */ r) => {
      const eintrag = r.journal;
      if (!eintrag) throw new Error("Kein Journal-Eintrag — nichts zu speichern");
      const stand = { ...eintrag, id: undefined, speichern: undefined };
      journalRef.current = [...journalRef.current, stand];
      // the register answers at once; the entity write follows, a failure is said in words and the entry leaves the cache again
      stand.speichern = bitApi.entities.IfcAenderung.create(eintrag)
        .then((neu) => { stand.id = neu?.id; setJournalStand((n) => n + 1); })
        .catch((e) => {
          journalRef.current = journalRef.current.filter((x) => x !== stand);
          // the step did not happen after all: the history must not list it as active
          vorschlaege.verlaufMarkieren(v.id, { zurueckgenommen: new Date().toISOString() });
          toast.error(`${t("Journal nicht gespeichert")}: ${e?.message || e}`);
        });
    },
    zuruecknehmen: (/** @type {any} */ _e, /** @type {any} */ r) => {
      const l = r.journal?.loeschen;
      if (!l) return;
      // the entry of THIS step by its time (the reversal already refused when a newer entry of the property exists);
      // only a record without the time falls back to the newest entry of the property
      const letzter = l.zeit != null
        ? journalRef.current.find((x) => x.modell === l.modell && x.guid === l.guid && x.pset === l.pset && x.eigenschaft === l.eigenschaft && x.zeit === l.zeit)
        : letzterEintrag(journalRef.current, l.modell, l.guid, l.pset, l.eigenschaft);
      if (!letzter) throw new Error(t("Der Journal-Eintrag dieses Schrittes ist nicht mehr da"));
      journalRef.current = journalRef.current.filter((x) => x !== letzter);
      Promise.resolve(/** @type {any} */ (letzter).speichern).then(() => (/** @type {any} */ (letzter).id ? bitApi.entities.IfcAenderung.delete(/** @type {any} */ (letzter).id) : null))
        .then(() => setJournalStand((n) => n + 1))
        .catch((e) => toast.error(`${t("Journal-Eintrag nicht gelöscht")}: ${e?.message || e}`));
    },
    t,
    vorschauZeigen, vorschauEntfernen,
    darfAendern: () => darfAendern, // 106-07: bestaetigen / rueckgaengig only for a role that may change the model
  };
  const befehle = useMemo(() => {
    const reg = befehlsRegister();
    auswahlBefehleRegistrieren(reg, () => /** @type {any} */ (aktuell.current));
    aenderungsBefehleRegistrieren(reg, () => /** @type {any} */ (aenderung.current));
    eingabeBefehlRegistrieren(reg, () => /** @type {any} */ (aenderung.current)); // 106-05: a sentence as a command, the caller's ctx goes on
    return reg;
  }, []);
  // the buttons of the preview take the same road as the commands; a refusal is shown in words
  const aenderungBefehl = (/** @type {string} */ id, /** @type {any} */ p) => {
    const r = befehle.ausfuehren(id, p);
    if (!r.ok) toast.error(/** @type {{ok: false, error: string}} */ (r).error);
  };
  // reachable for local agents / tests while the viewer is open (window.__bitBefehle.zeileBearbeiten(...))
  // and through the local control channel (server/steuerungRouter.js); the global is deleted only if it is still ours.
  useEffect(() => {
    /** @type {any} */ (window).__bitBefehle = befehle;
    const stopp = starteSteuerungsBruecke(befehle);
    return () => {
      stopp();
      if (/** @type {any} */ (window).__bitBefehle === befehle) delete /** @type {any} */ (window).__bitBefehle;
    };
  }, [befehle]);

  const neuesteIfc = ifcFiles[0] || null;
  const neuereIfcVorhanden = !!(neuesteIfc && loadedIfcName && loadedIfcName !== neuesteIfc.name);
  // Server models exist only on the local Express stack or when the folder route listed
  // files. In demo and cloud "/api/ifc-test-file" is a 404 or the SPA's index.html.
  const serverModelle = DATENQUELLE === "express" || ifcFiles.length > 0;

  return (
    <div className={embedded ? "flex h-full min-h-0 flex-col gap-2 p-2" : `${seitenWurzel} space-y-3`}>
      {/* Page name from the N-02 name table; the embedded pane keeps its compact title. */}
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
            {t("IFC-Viewer (LV-gekoppelt)")}
          </h1>
          <p className="mt-1 text-slate-600">
            {t("IFC-Modell ansehen, Bauteile markieren und Mengen an LV-Positionen übergeben")}
          </p>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-sm">
        {embedded && <h1 className="mr-2 text-base font-bold text-slate-800">{t("IFC-Modell")}</h1>}
        {/* Button + hidden input instead of a label: a label is not reachable by Tab. */}
        <input ref={dateiInputRef} type="file" accept=".ifc" className="hidden" onChange={onFile} disabled={busy} />
        <button type="button" onClick={() => dateiInputRef.current?.click()} disabled={busy}
          className="rounded bg-slate-700 px-2.5 py-1 text-white disabled:opacity-50">
          {embedded ? t("Datei…") : modelInfo ? t("Anderes IFC wählen") : t("Eigenes IFC wählen")}
        </button>
        {!embedded && (
          <button type="button" onClick={musterprojektLaden} disabled={busy} data-testid="musterprojekt-laden"
            className={modelInfo
              ? "rounded border border-emerald-600 px-2.5 py-1 text-emerald-700 disabled:opacity-50"
              : "rounded bg-emerald-600 px-2.5 py-1 text-white disabled:opacity-50"}>
            {t("Musterprojekt laden")}
          </button>
        )}
        {serverModelle && (
          <button onClick={() => loadServerFile()} disabled={busy}
            className="rounded bg-slate-700 px-2.5 py-1 text-white disabled:opacity-50">
            {neuesteIfc ? `Server-Modell laden · ${neuesteIfc.name} (${fmtDate(neuesteIfc.mtime)})` : "Modell vom Server"}
          </button>
        )}
        {modelInfo && (
          <button onClick={grundrissUebernehmen} disabled={busy || grundrissLaeuft}
            title="Umriss aus der Geometrie ableiten und als footprintM ins Gebäudemodell schreiben — die Fachreiter rechnen danach auf dem echten Gebäude statt auf dem Vorgabe-Rechteck."
            className="rounded bg-emerald-600 px-2.5 py-1 text-white disabled:opacity-50">
            {grundrissLaeuft ? "leite ab…" : "Grundriss → Gebäudemodell"}
          </button>
        )}
        {neuereIfcVorhanden && (
          <span className="text-xs text-amber-600" title="Im Ordner liegt eine neuere Datei als die geladene">neuere Datei vorhanden</span>
        )}
        {ifcFiles.length > 1 && (
          <select onChange={(e) => { if (e.target.value) loadServerFile(e.target.value); e.target.value = ""; }}
            disabled={busy} defaultValue=""
            className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:opacity-50"
            title="Ältere Datei aus demselben Ordner laden">
            <option value="">ältere Version…</option>
            {ifcFiles.slice(1).map((f) => (
              <option key={f.name} value={f.name}>{f.name} ({fmtDate(f.mtime)})</option>
            ))}
          </select>
        )}
        {/* One live region for progress, result and error — screen readers hear the
            load finish or fail without moving focus. */}
        <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-1.5">
          {modelInfo && !busy && (
            <span className="text-xs text-slate-500" title={`Parse ${fmt(modelInfo.parseMs)} ms`}>
              {modelInfo.label ? `${modelInfo.label} · ` : ""}
              {fmt(modelInfo.elementsWithGeometry)} {t("Bauteile")} · {fmt(modelInfo.triangles)} {t("Dreiecke")}
            </span>
          )}
          {busy && <span className="text-sm text-amber-700">{progress || t("Arbeite…")}</span>}
          {!busy && progress && <span className="text-sm text-slate-500">{progress}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>

      {/* Eine gemeinsame Markier-Zeile: NOVA-Filter · eigener Status/KG-Filter · Zurücksetzen */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
        {novaFilters.length > 0 && (
          <>
            <select value={novaFilterKey} onChange={(e) => setNovaFilterKey(e.target.value)}
              className="min-w-[220px] flex-1 rounded border border-slate-300 px-1.5 py-1">
              <option value="">Bauteilfilter ({novaFilters.length}) …</option>
              {gefilterteNovaFilters.map((f) => (
                <option key={f.key} value={f.key}>{f.gruppe} · {f.titel}</option>
              ))}
            </select>
            <input value={novaSuche} onChange={(e) => setNovaSuche(e.target.value)}
              placeholder="suchen: Filter, Gruppe" title="Bauteilfilter durchsuchen"
              className="w-36 rounded border border-slate-300 px-1.5 py-1" />
            {novaSucheQ && (
              <span className="text-xs text-slate-500">{gefilterteNovaFilters.length}/{novaFilters.length}</span>
            )}
            <button onClick={applyNovaFilterToModel} disabled={!novaFilterKey}
              className="rounded bg-amber-500 px-2.5 py-1 text-white disabled:opacity-40">anwenden</button>
            <span className="mx-1 h-5 w-px bg-slate-200" />
          </>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-slate-300 px-1.5 py-1">
          <option value="">Status: alle</option>
          <option value="abbruch">Abbruch</option>
          <option value="neubau">Neubau</option>
          <option value="bestand">Bestand</option>
          <option value="ohne">{t(STATUS_OHNE_LABEL)}</option>
        </select>
        <input value={kgFilter} onChange={(e) => setKgFilter(e.target.value)} placeholder="KG"
          title="Kostengruppe, z. B. 33" className="w-16 rounded border border-slate-300 px-1.5 py-1" />
        <button onClick={highlightFilter} disabled={!statusFilter && !kgFilter}
          className="rounded bg-amber-500 px-2.5 py-1 text-white disabled:opacity-40">markieren</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={resetColors} className="rounded bg-slate-200 px-2.5 py-1 text-slate-700">zurücksetzen</button>
        {zaehlerStatus && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <span className="text-xs text-slate-500" data-testid="status-sichtbarkeit" data-ausgeblendet={ausgeblendet}>{t("Sichtbar")}:</span>
            {[["abbruch", "Abbruch", statusFarbe("abbruch")], ["neubau", "Neubau", statusFarbe("neubau")], ["bestand", "Bestand", statusFarbe("bestand")], ["ohne", STATUS_OHNE_LABEL, statusFarbe(null)]].map(([k, l, c]) => (
              <button key={k} type="button" aria-pressed={statusSichtbar[k]} data-testid={`status-sichtbar-${k}`}
                onClick={() => setStatusSichtbar((alt) => ({ ...alt, [k]: !alt[k] }))}
                title={statusSichtbar[k] ? t("Ausblenden") : t("Einblenden")}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${statusSichtbar[k] ? "border-slate-300 bg-white text-slate-700" : "border-dashed border-slate-300 bg-slate-100 text-slate-400 line-through"}`}>
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                {t(l)} <span className="tabular-nums" data-testid={`status-anzahl-${k}`}>{fmt(zaehlerStatus[k])}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Richtung 2: Mengenübernahme aus dem Modell in eine LV-Position */}
      {positionen.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-1.5 text-sm">
          <span className="font-medium text-slate-600">Menge →</span>
          <div>
            <select value={lvFilter} onChange={(e) => { setLvFilter(e.target.value); setZielId(""); }}
              title="Leistungsverzeichnis vorauswählen"
              className="min-w-[190px] rounded border border-slate-300 px-1.5 py-1">
              <option value="">alle LVs ({positionen.length})</option>
              {lvListe.map((t) => (
                <option key={t} value={t}>{t} ({positionen.filter((p) => p.trade === t).length})</option>
              ))}
            </select>
          </div>
          <input value={posSuche} onChange={(e) => posSucheSetzen(e.target.value)}
            placeholder="suchen: OZ, Titel, LB, KG" title="Positionen durchsuchen"
            className="w-44 rounded border border-slate-300 px-1.5 py-1" />
          <div>
            <select value={zielId} onChange={(e) => setZielId(e.target.value)} size={1}
              title="Zielposition für die Mengenübernahme"
              className="min-w-[300px] rounded border border-slate-300 px-1.5 py-1">
              <option value="">
                Position wählen ({gefiltertePositionen.length}{gefiltertePositionen.length > 400 ? ", erste 400" : ""}) …
              </option>
              {gefiltertePositionen.slice(0, 400).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.oz} · {String(p.title || "").slice(0, 55)} [{p.unit}]
                  {lvFilter ? "" : ` — ${p.trade}`}
                </option>
              ))}
            </select>
          </div>
          <button onClick={positionImModellMarkieren} disabled={!modelInfo || !zielId}
            title="Verknüpfte Bauteile der gewählten Position im Modell markieren (ohne Reiterwechsel)"
            className="rounded bg-amber-500 px-2.5 py-1 text-white disabled:opacity-40">
            im Modell markieren
          </button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <select value={basis} onChange={(e) => setBasis(e.target.value)} title="Mengenbasis"
            className="rounded border border-slate-300 px-1.5 py-1">
            {BASEN.map((b) => <option key={b.key} value={b.key}>{b.kurz}</option>)}
          </select>
          <input type="number" step="0.5" min="0.5" value={faktor}
            onChange={(e) => setFaktor(Number(e.target.value) || 1)}
            title="Faktor, z. B. 2 = beidseitig (Maler)"
            className="w-14 rounded border border-slate-300 px-1.5 py-1" />
          <button onClick={uebernehmen} disabled={!zielId || !aktiveTreffer().length}
            className="rounded bg-blue-600 px-2.5 py-1 font-medium text-white disabled:opacity-40">
            übernehmen
          </button>
          <span className="text-xs text-slate-500">
            {aktiveTreffer().length ? `${fmt(aktiveTreffer().length)} Bauteile` : "—"}
          </span>
          {attributPruefung && (
            <div className="basis-full text-xs" data-testid="attribut-pruefung">
              {attributPruefung.befunde.length === 0 ? (
                <span className="text-emerald-700">{t("Attribute vollständig: DIN 276, Feuerwiderstand, tragend")}</span>
              ) : (
                <ul className="space-y-0.5">
                  {attributPruefung.befunde.map((b) => (
                    <li key={b.key} data-testid={`attribut-befund-${b.key}`} data-status={b.status}
                      className={b.status === "warn" ? "text-amber-800" : "text-slate-600"}>
                      <span className={`mr-1 inline-block rounded px-1 ${b.status === "warn" ? "bg-amber-100" : "border border-dashed border-slate-300 bg-white"}`}>
                        {b.status === "warn" ? t("Hinweis") : t("offen")}
                      </span>
                      {befundText(b)}
                    </li>
                  ))}
                  <li className="text-slate-500">{t("Übernahme bleibt möglich — die Befunde werden an der Position vermerkt.")}</li>
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {matchInfo && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            <b>{matchInfo.label}</b> · markiert: {fmt(matchInfo.found)} Bauteile
            {matchInfo.semantik > 0 && <> · Σ Fläche (BaseQuantities): <b>{fmt(matchInfo.area, 1)} m²</b></>}
            {matchInfo.found > matchInfo.semantik && <> · {fmt(matchInfo.found - matchInfo.semantik)} ohne Semantik</>}
          </span>
          <button onClick={selectMatches}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white">
            Treffer auswählen
          </button>
        </div>
      )}

      <div className={embedded ? "relative min-h-0 flex-1" : "relative"}>
        <div ref={mountRef} className={`w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${embedded ? "h-full" : "h-[560px]"}`} />
        {/* 106-01: what is under the pointer — element text near the cursor. Colour AND form
            (dotted outline, as in the 3D view) mark the state. Written straight into the DOM per frame. */}
        <div ref={hoverBoxRef} data-testid="zeigen-hover" style={{ display: "none" }}
          className="pointer-events-none absolute left-0 top-0 z-20 max-w-[16rem] rounded bg-card px-2 py-1 text-xs text-foreground shadow">
          <div ref={hoverTextRef} data-testid="zeigen-hover-text" className="truncate font-medium" />
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span ref={hoverSymbolRef} className="inline-block h-2.5 w-2.5 border-2" style={{ borderColor: ZEIGE_ZUSTAENDE.fokus.hex, borderStyle: ZEIGE_CSS_RAND[ZEIGE_ZUSTAENDE.fokus.umriss] }} />
            <span ref={hoverZustandRef}>{t(ZEIGE_ZUSTAENDE.fokus.label)}</span>
          </div>
        </div>
        {/* 106-03: proposed property changes in words with check and origin, Übernehmen / Verwerfen, and the history. */}
        {/* 106-05: speech and typed sentences; what is understood becomes a proposal card, a change runs only after "ja" by the person. */}
        {/* review 106-07: tablet layout = fixed at the bottom of the screen (speech right, cards left), reachable without scrolling. */}
        <SprechFeld register={befehle} kontext={() => kontextAus(auswahlEids())} ansicht={() => aenderung.current.ansicht()} nda={project?.nda === true} t={t}
          projektId={project?.id ?? null} bild={(o) => /** @type {any} */ (aktuell.current).ansichtBild(o)} grob={grob}
          className={grob ? TABLETT_PLATZ.sprechen : "absolute bottom-2 right-2 z-30 w-[22rem] max-w-[40%]"} />
        <AenderungsFeld speicher={vorschlaege} t={t} darfUebernehmen={darfAendern} grob={grob} className={grob ? TABLETT_PLATZ.karten : "absolute bottom-2 left-2 z-30 w-[22rem] max-w-[60%] max-h-[480px] overflow-y-auto"}
          onUebernehmen={(v) => aenderungBefehl("bestaetigen", { vorschlag_id: v.id, durch: "hand" })}
          onVerwerfen={(v) => aenderungBefehl("verwerfen", { vorschlag_id: v.id })}
          onZuruecknehmen={(sch) => aenderungBefehl("rueckgaengig", { vorschlag_id: sch.vorschlag_id })} />
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-white/85 px-2 py-1 text-xs text-slate-700 shadow">
          {!modelInfo && !busy && <div>{t("Noch kein Modell — eigenes IFC wählen oder Musterprojekt laden")}</div>}
          {!modelInfo && selImLink && (
            <div>{t("Bauteil {sel} wird markiert, sobald ein Modell geladen ist").replace("{sel}", selImLink)}</div>
          )}
          <div ref={fpsRef} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {[[statusFarbe("abbruch"), "Abbruch"], [statusFarbe("neubau"), "Neubau"], [statusFarbe("bestand"), "Bestand"], [statusFarbe(null), t(STATUS_OHNE_LABEL)],
              ["#ff9e0a", "markiert"], ["#3b82f6", "ausgewählt"]].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {l}
              </span>
            ))}
          </div>
        </div>
        {/* Schnitt-Steuerung IM 3D-Fenster (Overlay unten links) — Gizmo im Modell:
            Pfeile verschieben die Ebene, Ringe drehen sie (wie im NOVA-Viewer). */}
        <div className="absolute bottom-2 left-2 w-64 rounded-lg border border-slate-200 bg-white/92 p-2 text-xs shadow">
          <div className="mb-1 flex items-center justify-between">
            <b className="text-slate-700">Schnitt</b>
            <select value={schnitt} onChange={(e) => setSchnitt(e.target.value)}
              className="rounded border border-slate-300 px-1 py-0.5 text-xs">
              <option value="aus">aus</option>
              <option value="h">horizontal</option>
              <option value="x">vertikal X</option>
              <option value="z">vertikal Z</option>
              <option value="schraeg">schräg</option>
            </select>
          </div>
          {schnitt !== "aus" && (
            <div className="space-y-1.5">
              <button onClick={() => setGizmoOn((v) => !v)}
                className={`w-full rounded px-2 py-1 ${gizmoOn ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-500"}`}
                title="Steuerkreuz im Modell ein-/ausblenden">
                Gizmo {gizmoOn ? "ein" : "aus"}
              </button>
              <div className={`flex gap-1 ${gizmoOn ? "" : "pointer-events-none opacity-40"}`}>
                <button onClick={() => setGizmoMode("translate")}
                  className={`flex-1 rounded px-2 py-1 ${gizmoMode === "translate" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
                  title="Ebene mit den Pfeilen im Modell verschieben">↕ verschieben</button>
                <button onClick={() => setGizmoMode("rotate")}
                  className={`flex-1 rounded px-2 py-1 ${gizmoMode === "rotate" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
                  title="Ebene mit den Ringen im Modell drehen">↻ drehen</button>
              </div>
              <div>
                <div className="mb-0.5 text-slate-500">Lage {schnittPos} %</div>
                <input type="range" min="0" max="100" value={schnittPos}
                  onChange={(e) => setSchnittPos(Number(e.target.value))} className="w-full" />
              </div>
              {schnitt === "schraeg" && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="mb-0.5 text-slate-500">Drehung {azimut}°</div>
                    <input type="range" min="0" max="360" step="5" value={azimut}
                      onChange={(e) => setAzimut(Number(e.target.value))} className="w-full" />
                  </div>
                  <div className="flex-1">
                    <div className="mb-0.5 text-slate-500">Neigung {neigung}°</div>
                    <input type="range" min="-80" max="80" step="5" value={neigung}
                      onChange={(e) => setNeigung(Number(e.target.value))} className="w-full" />
                  </div>
                </div>
              )}
              <button onClick={() => setSchnittFlip((v) => !v)}
                className="w-full rounded bg-slate-100 px-2 py-1 text-slate-600">Richtung wechseln</button>
              <div className="text-[10px] text-slate-400">
                Gizmo im Modell: Pfeile = verschieben, Ringe = drehen
              </div>
            </div>
          )}
        </div>

        {/* Link kopieren: sitzt immer sichtbar links unten in der Szene, damit
            man auch eine reine Kameraeinstellung teilen kann (65-05). */}
        <button
          type="button"
          onClick={linkKopieren}
          data-testid="link-kopieren"
          title="Link auf diese Ansicht kopieren (Kamera, Auswahl, Filter)"
          className="absolute bottom-2 left-2 rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs text-slate-600 shadow hover:bg-white"
        >
          {linkKopiert ? "Link kopiert" : "Link kopieren"}
        </button>

        {picked && (
          <div className="absolute right-2 top-2 w-72 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow">
            <div className="mb-1 flex items-center justify-between">
              <b className="text-slate-800">{picked.multi ? `Auswahl: ${fmt(picked.count)} Bauteile` : picked.typ}</b>
              <button type="button" onClick={() => setPicked(null)} aria-label={t("Auswahl aufheben")} className="text-slate-400">✕</button>
            </div>
            {/* Model → ticket (N-11): the GlobalId is the stable anchor, the expressID
                changes with every export. Link contract from ticketLink.js (N-10). */}
            {!picked.multi && picked.guid && (
              <button type="button"
                onClick={() => navigate(neuesTicketUrl({
                  element: picked.guid,
                  titel: `${picked.typ} ${picked.name || ""}`.trim(),
                  quelle: "ifc",
                }))}
                className="mb-2 w-full rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700">
                {t("Ticket zu diesem Bauteil")}
              </button>
            )}
            {picked.multi ? (
              <div className="space-y-0.5 text-slate-600">
                <div>Σ Fläche: <b>{fmt(picked.area, 1)} m²</b> · Σ Volumen: {fmt(picked.volume, 2)} m³</div>
                <div>Typen: {picked.typen || "—"}</div>
                {picked.count > picked.semantik && <div>{fmt(picked.count - picked.semantik)} ohne Semantik</div>}
                <div className="text-slate-400">aus Markierung übernommen — ✕ hebt Auswahl auf</div>
              </div>
            ) : (
              <div className="space-y-0.5 text-slate-600">
                <div>{picked.name}</div>
                <div>Status: <b>{picked.status}</b> · KG: {picked.kg} · Geschoss: {picked.storey}</div>
                <div>Fläche: {fmt(picked.area, 2)} m² · Volumen: {fmt(picked.volume, 2)} m³</div>
                <div className="text-slate-400">expressID {picked.eid} · {picked.ms == null ? t("per GUID gewählt") : `Raycast ${picked.ms} ms`}</div>
                {picked.guid && <div data-testid="ifc-auswahl-guid" className="break-all text-muted-foreground">GUID {picked.guid}</div>}
                {/* Ähnlichkeitssuche: vom Einzelbauteil zur Menge gleichartiger Bauteile */}
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <div className="mb-1 text-slate-500">Ähnliche Bauteile markieren:</div>
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => aehnlicheFinden("typ")} disabled={!picked.typ2}
                      title={picked.typ2 ? `Bauteiltyp „${picked.typ2}"` : "kein Bauteiltyp am Element"}
                      className="rounded bg-amber-500 px-2 py-1 text-white disabled:bg-slate-200 disabled:text-slate-400">
                      gleicher Typ
                    </button>
                    <button onClick={() => aehnlicheFinden("typStatus")} disabled={!picked.typ2}
                      className="rounded bg-amber-500 px-2 py-1 text-white disabled:bg-slate-200 disabled:text-slate-400">
                      Typ + Status
                    </button>
                    <button onClick={() => aehnlicheFinden("layerStatus")} disabled={!picked.layer}
                      title={picked.layer ? `Ebene „${picked.layer}"` : "keine Ebene am Element"}
                      className="rounded bg-amber-500 px-2 py-1 text-white disabled:bg-slate-200 disabled:text-slate-400">
                      Ebene + Status
                    </button>
                    <button onClick={() => aehnlicheFinden("klasseStatus")}
                      className="rounded bg-amber-500 px-2 py-1 text-white">
                      Klasse + Status
                    </button>
                  </div>
                  {picked.typ2 && <div className="mt-1 text-[10px] text-slate-400">Typ: {picked.typ2}</div>}
                </div>
                {/* 71-06: attribute editor + change journal (IFC itself stays untouched). */}
                <AttributEditor
                  element={modelRef.current?.elements?.find((x) => x.expressId === picked.eid) || null}
                  modell={modelInfo?.label || loadedIfcName || ""}
                  projectId={projectId}
                  aktualisierung={journalStand}
                  onEintraege={(e) => {
                    // the loaded list replaces the cache - but an entry still being saved is not in it yet and must stay
                    const imFlug = journalRef.current.filter((/** @type {any} */ x) => x.speichern && !x.id);
                    journalRef.current = [...e, ...imFlug];
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
