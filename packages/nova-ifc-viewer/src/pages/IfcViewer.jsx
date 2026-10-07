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
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parseZustand, viewerLink } from "@ifc/lib/viewerLink";
import { neuesTicketUrl } from "@ifc/lib/ticketLink";
import { DATENQUELLE } from "@core/lib/umgebung";
import { seitenWurzel } from "@core/lib/utils";
import { useI18n } from "@core/lib/i18n";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  parseIfcModel, expressIdAtFaceIndex, recolorElements, expandWithDescendants,
  extractSubGeometry, STATUS_COLORS, HIGHLIGHT_COLOR, SELECT_COLOR, DIM_COLOR,
} from "@ifc/lib/ifcGeometry";
import { getPositionLink, clearPositionLink, onPositionLink, getTakeoffTarget, setTakeoffTarget, onTakeoffTarget } from "@ifc/lib/ifcLinkStore";
import { bitApi } from "@core/api/bitApi";
import { useProject } from "@core/lib/ProjectContext";
import { saveBimModel } from "@core/lib/useBimModelSync";
import { grundrissAusModell, geschosseAusModell } from "@ifc/lib/grundriss";
import { toast } from "sonner";
import { parseFilterXml, applyNovaFilter } from "@ifc/lib/novaFilters";
import { byTrade } from "@core/lib/tradeSort";
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
if (typeof window !== "undefined") window.__ifcAufbau = AUFBAU;

const fmt = (n, d = 0) => Number(n ?? 0).toLocaleString("de-DE", { maximumFractionDigits: d });
const fmtDate = (ms) => new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

// BUGFIX (Schnittebene + Klick): Der three.js-Raycaster berücksichtigt clippingPlanes
// NICHT — er trifft weiterhin die Geometrie hinter der Schnittfläche, auch wenn die
// visuell bereits weggeschnitten ist. Deshalb hier alle sortierten Schnittpunkte
// durchgehen und den ersten nehmen, der vor keiner aktiven Schnittebene liegt
// (kleine Toleranz wegen Rundung). Ohne aktive Schnittebene identisch zu [0].
function ersterSichtbarerTreffer(raycaster, mesh) {
  const treffer = raycaster.intersectObject(mesh, false);
  const planes = mesh.material?.clippingPlanes;
  if (!planes || !planes.length) return treffer[0];
  const TOLERANZ = -1e-4;
  return treffer.find((hit) => planes.every((plane) => plane.distanceToPoint(hit.point) >= TOLERANZ));
}

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
  const [modelInfo, setModelInfo] = useState(MODEL_CACHE ? { ...MODEL_CACHE.stats, label: MODEL_CACHE_LABEL } : null);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [kgFilter, setKgFilter] = useState("");
  const [matchInfo, setMatchInfo] = useState(null);
  const [picked, setPicked] = useState(null);
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
  const { projectId } = useProject();
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
          const heap = performance.memory ? ` · Heap ${fmt(performance.memory.usedJSHeapSize / 1048576)} MB` : "";
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

  // Modell → Mesh (bei Cache-Treffer auch nach Remount)
  const buildMesh = (model) => {
    const t = threeRef.current;
    if (!t || !model) return;
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
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide,
      clippingPlanes: [clipPlaneRef.current] });
    const mesh = new THREE.Mesh(geo, mat);
    t.scene.add(mesh);
    meshRef.current = mesh;
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
        setPicked({
          eid: treffer.expressId,
          ms: 0,
          guid: treffer.globalId || "",
          typ: treffer.ifcType || "",
          typ2: treffer.typ || "",
          layer: treffer.layer || "",
          name: treffer.name || "",
          status: treffer.status || "unbekannt",
          kg: treffer.classification?.code || "—",
          storey: treffer.storey || "—",
          area: treffer.mengen?.area || 0,
          volume: treffer.mengen?.volume || 0,
        });
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
      const patch = { footprintM: r.polygon };
      if (g.anzahl > 0) patch.storeys = g.anzahl;
      await saveBimModel(projectId, patch);

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

  const uebernehmen = async () => {
    const model = modelRef.current;
    const ziel = positionen.find((p) => p.id === zielId);
    const eids = aktiveTreffer();
    if (!model || !ziel || !eids.length) return;
    const byEid = new Map(model.elements.map((el) => [el.expressId, el]));
    const els = eids.map((e) => byEid.get(e)).filter(Boolean);
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
      });
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

  const highlightFilter = () => {
    const model = modelRef.current;
    if (!model) return;
    const byEid = new Map(model.elements.map((el) => [el.expressId, el]));
    const matched = new Set();
    for (const [eid, el] of byEid) {
      const stOk = !statusFilter || el.status === statusFilter;
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
      count: lm.matched.size,
      semantik: els.length,
      area: els.reduce((s, el) => s + (el.mengen?.area || 0), 0),
      volume: els.reduce((s, el) => s + (el.mengen?.volume || 0), 0),
      typen: [...new Set(els.map((el) => el.ifcType))].slice(0, 4).join(", "),
    });
  };

  // Klick → Raycast → Element-Info (mit Drag-Unterdrückung)
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    const el = t.renderer.domElement;
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const model = modelRef.current;
      const mesh = meshRef.current;
      if (!model || !mesh) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, t.camera);
      const t0 = performance.now();
      const hit = ersterSichtbarerTreffer(ray, mesh);
      const ms = Math.round(performance.now() - t0);
      if (!hit) { setPicked(null); return; }
      const eid = expressIdAtFaceIndex(model.merged.ranges, hit.faceIndex);
      const sem = model.elements.find((x) => x.expressId === eid);
      setSelectionMesh(eid);
      setPicked({
        eid, ms,
        // GlobalId statt expressID als Anker für teilbare Links (65-05):
        // die expressID ändert sich bei jedem Export, die GlobalId nicht.
        guid: sem?.globalId || "",
        typ: sem?.ifcType || "(ohne Semantik — z. B. Morph/Proxy)",
        typ2: sem?.typ || "",       // Archicad-Bauteiltyp (für die Ähnlichkeitssuche)
        layer: sem?.layer || "",    // Ebene (für die Ähnlichkeitssuche)
        name: sem?.name || "", status: sem?.status || "unbekannt",
        kg: sem?.classification?.code || "—", storey: sem?.storey || "—",
        area: sem?.mengen?.area || 0, volume: sem?.mengen?.volume || 0,
      });
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); };
  }, [modelInfo]);

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
        </select>
        <input value={kgFilter} onChange={(e) => setKgFilter(e.target.value)} placeholder="KG"
          title="Kostengruppe, z. B. 33" className="w-16 rounded border border-slate-300 px-1.5 py-1" />
        <button onClick={highlightFilter} disabled={!statusFilter && !kgFilter}
          className="rounded bg-amber-500 px-2.5 py-1 text-white disabled:opacity-40">markieren</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={resetColors} className="rounded bg-slate-200 px-2.5 py-1 text-slate-700">zurücksetzen</button>
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
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-white/85 px-2 py-1 text-xs text-slate-700 shadow">
          {!modelInfo && !busy && <div>{t("Noch kein Modell — eigenes IFC wählen oder Musterprojekt laden")}</div>}
          {!modelInfo && selImLink && (
            <div>{t("Bauteil {sel} wird markiert, sobald ein Modell geladen ist").replace("{sel}", selImLink)}</div>
          )}
          <div ref={fpsRef} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {[["#ef4444", "Abbruch"], ["#22c55e", "Neubau"], ["#94a3b8", "Bestand"],
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
                <div className="text-slate-400">expressID {picked.eid} · Raycast {picked.ms} ms</div>
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
