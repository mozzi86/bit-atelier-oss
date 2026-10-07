import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import {
  Move, Layers, Ruler, ArrowDownToLine, Map as MapIcon, Menu, X,
  RotateCcw, CameraOff, AlertTriangle, Crosshair,
} from "lucide-react";
import { modelDims } from "@core/lib/bimElements";

/**
 * AR-Vor-Ort-Ansicht: Live-Kamera (getUserMedia) als Hintergrund + halbtransparentes
 * three.js-BIM-Overlay. Werkzeuge: ADJUST (ausrichten), LAYERS (Ebenen), MEASURE (messen),
 * PIT VIEW (Baugrube/Schnitt). Fallback, falls keine Kamera/Erlaubnis verfügbar ist.
 *
 * Reines UI/3D — keine Backend-Logik. Modellgeometrie aus modelDims() (konsistent zum BIM-Viewer).
 */

const CATEGORIES = [
  { key: "stuetzen", label: "Stützen", color: 0x7c4dff },
  { key: "traeger", label: "Träger", color: 0x2ee06a },
  { key: "decken", label: "Decken", color: 0xff3db5 },
  { key: "waende", label: "Wände", color: 0x4dd0ff },
  { key: "fundament", label: "Fundament & Bewehrung", color: 0xffa726 },
];

export default function ARSiteView({ building, onExit }) {
  const mountRef = useRef(null);
  const videoRef = useRef(null);
  const three = useRef({});           // mutable three.js handles (no re-render)
  const toolRef = useRef(null);       // current tool for pointer handler
  const scaleRef = useRef(1);         // current model scale for measure conversion

  const [camState, setCamState] = useState("loading"); // loading | on | error
  const [tool, setTool] = useState(null);              // null|adjust|layers|measure|pit
  const [opacity, setOpacity] = useState(0.62);
  const [transform, setTransform] = useState({ rotY: 25, scale: 1, posX: 0, posZ: 0 });
  const [visible, setVisible] = useState(
    CATEGORIES.reduce((m, c) => ((m[c.key] = c.key !== "fundament"), m), {}),
  );
  const [pitDepth, setPitDepth] = useState(0);   // 0 = aus (kein Schnitt), >0 = Schnitttiefe in m
  const [measurePts, setMeasurePts] = useState([]);
  const [measureM, setMeasureM] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { scaleRef.current = transform.scale; }, [transform.scale]);

  // ---- Init three.js scene + camera stream (mount once) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth || 360;
    const H = mount.clientHeight || 640;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const dims = modelDims(building || { floors: 6, area_net: 1500 });
    const { floors, w, d, floorH } = dims;
    const topH = floors * floorH;

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 1000);
    camera.position.set(w * 1.25, topH * 0.85, d * 1.7);
    camera.lookAt(0, topH * 0.4, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 2, 1);
    scene.add(dir);

    // Clipping plane for PIT VIEW (keeps geometry BELOW cutY when active)
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    const mat = (color) =>
      new THREE.MeshLambertMaterial({
        color, transparent: true, opacity: 0.62, depthWrite: false,
        side: THREE.DoubleSide,
      });

    const model = new THREE.Group();
    const groups = {};
    CATEGORIES.forEach((c) => { groups[c.key] = new THREE.Group(); model.add(groups[c.key]); });

    const colXs = [-w / 2, 0, w / 2];
    const colZs = [-d / 2, 0, d / 2];
    const colSize = 0.4;

    // Stützen (columns)
    colXs.forEach((x) => colZs.forEach((z) => {
      const g = new THREE.BoxGeometry(colSize, topH, colSize);
      const m = new THREE.Mesh(g, mat(0x7c4dff));
      m.position.set(x, topH / 2, z);
      groups.stuetzen.add(m);
    }));

    // Decken (slabs) + Träger (perimeter beams) per Geschoss
    for (let i = 1; i <= floors; i++) {
      const y = i * floorH;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.25, d + 0.6), mat(0xff3db5));
      slab.position.set(0, y, 0);
      groups.decken.add(slab);

      const beamX1 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.3), mat(0x2ee06a));
      beamX1.position.set(0, y - 0.1, -d / 2);
      const beamX2 = beamX1.clone(); beamX2.position.z = d / 2;
      const beamZ1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, d), mat(0x2ee06a));
      beamZ1.position.set(-w / 2, y - 0.1, 0);
      const beamZ2 = beamZ1.clone(); beamZ2.position.x = w / 2;
      groups.traeger.add(beamX1, beamX2, beamZ1, beamZ2);
    }

    // Wände (two perimeter panels, leicht transparent)
    const wallFront = new THREE.Mesh(new THREE.BoxGeometry(w, topH, 0.15), mat(0x4dd0ff));
    wallFront.position.set(0, topH / 2, -d / 2);
    const wallSide = new THREE.Mesh(new THREE.BoxGeometry(0.15, topH, d), mat(0x4dd0ff));
    wallSide.position.set(-w / 2, topH / 2, 0);
    groups.waende.add(wallFront, wallSide);

    // Fundament & Bewehrung (below grade) — for PIT VIEW
    colXs.forEach((x) => colZs.forEach((z) => {
      const footing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), mat(0xffa726));
      footing.position.set(x, -0.6, z);
      groups.fundament.add(footing);
    }));
    // rebar grid in the pit
    const rebarMat = new THREE.MeshLambertMaterial({ color: 0xffd54f, transparent: true, opacity: 0.85 });
    for (let gx = -w / 2; gx <= w / 2 + 0.01; gx += 1.2) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, d + 1, 6), rebarMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(gx, -0.2, 0);
      groups.fundament.add(bar);
    }
    for (let gz = -d / 2; gz <= d / 2 + 0.01; gz += 1.2) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, w + 1, 6), rebarMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, -0.2, gz);
      groups.fundament.add(bar);
    }

    // apply clip plane to all model materials
    model.traverse((o) => { if (o.material) o.material.clippingPlanes = []; });

    scene.add(model);

    // overlay group for measure markers/lines
    const measureGroup = new THREE.Group();
    scene.add(measureGroup);

    Object.assign(three.current, {
      renderer, scene, camera, model, groups, clipPlane, measureGroup, dims, topH,
    });

    // start camera
    let stream = null;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        .then((s) => {
          stream = s;
          three.current.stream = s;
          if (videoRef.current) { videoRef.current.srcObject = s; }
          setCamState("on");
        })
        .catch(() => setCamState("error"));
    } else {
      setCamState("error");
    }

    let raf;
    const tick = () => { renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();

    const onResize = () => {
      const nw = mount.clientWidth, nh = mount.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  // ---- Transform (ADJUST) ----
  useEffect(() => {
    const m = three.current.model;
    if (!m) return;
    m.rotation.y = (transform.rotY * Math.PI) / 180;
    m.scale.setScalar(transform.scale);
    m.position.set(transform.posX, 0, transform.posZ);
  }, [transform]);

  // ---- Opacity ----
  useEffect(() => {
    const g = three.current.groups;
    if (!g) return;
    Object.values(g).forEach((grp) => grp.traverse((o) => {
      if (o.material && o.material.transparent && o.material.color && o.material.color.getHex() !== 0xffd54f) {
        o.material.opacity = opacity;
      }
    }));
  }, [opacity]);

  // ---- Layer visibility ----
  useEffect(() => {
    const g = three.current.groups;
    if (!g) return;
    CATEGORIES.forEach((c) => { if (g[c.key]) g[c.key].visible = !!visible[c.key]; });
  }, [visible]);

  // ---- PIT VIEW (clipping plane + reveal substructure) ----
  useEffect(() => {
    const t = three.current;
    if (!t.model || !t.clipPlane) return;
    const active = pitDepth > 0;
    t.clipPlane.constant = active ? pitDepth : 0;
    const planes = active ? [t.clipPlane] : [];
    t.model.traverse((o) => { if (o.material) o.material.clippingPlanes = planes; });
    if (active) {
      // reveal foundation/rebar automatically when looking into the pit
      setVisible((v) => (v.fundament ? v : { ...v, fundament: true }));
    }
  }, [pitDepth]);

  // ---- MEASURE: redraw markers/line ----
  useEffect(() => {
    const t = three.current;
    if (!t.measureGroup) return;
    const grp = t.measureGroup;
    while (grp.children.length) {
      const c = grp.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    measurePts.forEach((p) => {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x10b981 }),
      );
      s.position.set(p.x, p.y, p.z);
      grp.add(s);
    });
    if (measurePts.length === 2) {
      const [a, b] = measurePts;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z),
      ]);
      grp.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x10b981 })));
      const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
      setMeasureM(+(dist / (scaleRef.current || 1)).toFixed(2));
    } else {
      setMeasureM(null);
    }
  }, [measurePts]);

  // ---- Pointer: measure picking ----
  const onPointerDown = useCallback((e) => {
    if (toolRef.current !== "measure") return;
    const t = three.current;
    if (!t.renderer) return;
    const rect = t.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, t.camera);
    const meshes = [];
    t.model.traverse((o) => { if (o.isMesh && o.visible && o.parent.visible) meshes.push(o); });
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return;
    setMeasurePts((prev) => {
      const next = prev.length >= 2 ? [] : prev.slice();
      next.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z });
      return next;
    });
  }, []);

  const TOOLS = [
    { key: "adjust", label: "ADJUST", icon: Move },
    { key: "layers", label: "LAYERS", icon: Layers },
    { key: "measure", label: "MEASURE", icon: Ruler },
    { key: "pit", label: "PIT VIEW", icon: ArrowDownToLine },
  ];

  const toggleTool = (k) => {
    setShowMenu(false);
    setTool((cur) => (cur === k ? null : k));
    if (k === "pit") setPitDepth((p) => (p > 0 ? 0 : Math.max(1, (three.current.topH || 18) * 0.18)));
    if (k === "measure") { setMeasurePts([]); setMeasureM(null); }
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-black select-none">
      {/* Live camera background */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Fallback when no camera */}
      {camState !== "on" && (
        <div className="absolute inset-0 bg-gradient-to-b from-sky-300 via-amber-100 to-amber-300/80 flex items-end justify-center">
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-amber-700/40" />
          {camState === "error" && (
            <div className="relative mb-24 mx-6 rounded-xl bg-black/70 text-amber-50 text-xs px-3 py-2 flex items-center gap-2 backdrop-blur">
              <CameraOff className="w-4 h-4 shrink-0" />
              Kamera nicht verfügbar/erlaubt — Modell-Overlay über simuliertem Baustellen-Hintergrund.
            </div>
          )}
          {camState === "loading" && (
            <div className="relative mb-24 rounded-xl bg-black/60 text-white text-xs px-3 py-2 backdrop-blur">
              Kamera wird gestartet…
            </div>
          )}
        </div>
      )}

      {/* three.js overlay canvas mounts here */}
      <div ref={mountRef} className="absolute inset-0" onPointerDown={onPointerDown} />

      {/* Top status bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <span className="rounded-full bg-black/55 backdrop-blur text-white text-[11px] px-2.5 py-1 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${camState === "on" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
          AR-Vor-Ort · BIM-Overlay
        </span>
        <span className="rounded-full bg-black/55 backdrop-blur text-white/80 text-[11px] px-2.5 py-1 font-mono">0.0{measurePts.length || 1}</span>
      </div>

      {/* Measure readout */}
      {tool === "measure" && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 rounded-lg bg-black/65 backdrop-blur text-white text-xs px-3 py-1.5 flex items-center gap-2">
          <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
          {measureM != null ? <b className="text-emerald-300">{measureM} m</b>
            : `Punkt ${measurePts.length + 1}/2 antippen`}
          {measurePts.length > 0 && (
            <button onClick={() => { setMeasurePts([]); setMeasureM(null); }} className="ml-1 text-white/70 hover:text-white" aria-label="Messung zurücksetzen">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Minimap */}
      {showMap && (
        <div className="absolute top-12 right-3 w-36 h-28 rounded-lg overflow-hidden border border-white/30 bg-black/50 backdrop-blur">
          <svg viewBox="0 0 120 90" className="w-full h-full">
            <rect x="0" y="0" width="120" height="90" fill="#0f172a" />
            <rect x="34" y="26" width="52" height="40" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 3" />
            <circle cx="60" cy="46" r="4" fill="#10b981" />
            <text x="60" y="80" fill="#94a3b8" fontSize="8" textAnchor="middle">Baufeld · Standort</text>
          </svg>
        </div>
      )}

      {/* ADJUST panel */}
      {tool === "adjust" && (
        <ToolPanel title="Ausrichten">
          <Slider label="Drehung" value={transform.rotY} min={0} max={360} step={1}
            onChange={(v) => setTransform((t) => ({ ...t, rotY: v }))} suffix="°" />
          <Slider label="Größe" value={transform.scale} min={0.4} max={2} step={0.05}
            onChange={(v) => setTransform((t) => ({ ...t, scale: v }))} suffix="×" />
          <Slider label="Versatz X" value={transform.posX} min={-15} max={15} step={0.5}
            onChange={(v) => setTransform((t) => ({ ...t, posX: v }))} suffix="m" />
          <Slider label="Versatz Z" value={transform.posZ} min={-15} max={15} step={0.5}
            onChange={(v) => setTransform((t) => ({ ...t, posZ: v }))} suffix="m" />
        </ToolPanel>
      )}

      {/* LAYERS panel */}
      {tool === "layers" && (
        <ToolPanel title="Ebenen">
          {CATEGORIES.map((c) => (
            <label key={c.key} className="flex items-center gap-2 py-1 text-sm text-white/90 cursor-pointer">
              <input type="checkbox" checked={!!visible[c.key]}
                onChange={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))} />
              <span className="w-3 h-3 rounded-sm" style={{ background: `#${c.color.toString(16).padStart(6, "0")}` }} />
              {c.label}
            </label>
          ))}
        </ToolPanel>
      )}

      {/* PIT VIEW panel */}
      {tool === "pit" && (
        <ToolPanel title="Baugrube / Schnitt">
          <p className="text-[11px] text-white/60 mb-1">Schnittebene absenken — Blick in Baugrube, Fundamente & Bewehrung.</p>
          <Slider label="Schnitttiefe" value={pitDepth} min={0} max={(three.current.topH || 18)} step={0.5}
            onChange={(v) => setPitDepth(v)} suffix="m" />
        </ToolPanel>
      )}

      {/* Menu popover */}
      {showMenu && (
        <ToolPanel title="Einstellungen">
          <Slider label="Modell-Deckkraft" value={Math.round(opacity * 100)} min={15} max={100} step={5}
            onChange={(v) => setOpacity(v / 100)} suffix="%" />
          <button
            onClick={() => { setTransform({ rotY: 25, scale: 1, posX: 0, posZ: 0 }); setPitDepth(0); setMeasurePts([]); setTool(null); }}
            className="mt-2 w-full rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm py-1.5 flex items-center justify-center gap-2">
            <RotateCcw className="w-4 h-4" /> Zurücksetzen
          </button>
          {onExit && (
            <button onClick={onExit} className="mt-2 w-full rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white text-sm py-1.5 flex items-center justify-center gap-2">
              <X className="w-4 h-4" /> AR beenden
            </button>
          )}
        </ToolPanel>
      )}

      {/* Bottom control bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
        <button onClick={() => { setShowMenu((s) => !s); setTool(null); }} aria-label="Menü"
          className="w-11 h-11 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/70">
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1 rounded-full bg-black/55 backdrop-blur px-2 py-1.5">
          {TOOLS.map((t) => (
            <button key={t.key} onClick={() => toggleTool(t.key)}
              aria-label={t.label}
              className={`flex flex-col items-center justify-center w-16 py-1 rounded-xl transition-colors ${
                tool === t.key || (t.key === "pit" && pitDepth > 0)
                  ? "bg-emerald-500 text-white" : "text-white/80 hover:bg-white/10"
              }`}>
              <t.icon className="w-5 h-5" />
              <span className="text-[9px] mt-0.5 tracking-wide">{t.label}</span>
            </button>
          ))}
        </div>

        <button onClick={() => setShowMap((s) => !s)} aria-label="Lageplan"
          className={`w-11 h-11 rounded-full backdrop-blur flex items-center justify-center ${
            showMap ? "bg-emerald-500 text-white" : "bg-black/55 text-white hover:bg-black/70"
          }`}>
          <MapIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function ToolPanel({ title, children }) {
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-72 max-w-[90%] rounded-2xl bg-black/70 backdrop-blur-md border border-white/10 p-4 text-white shadow-2xl">
      <div className="text-xs font-semibold tracking-wide text-emerald-300 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[11px] text-white/70 mb-0.5">
        <span>{label}</span>
        <span className="font-mono text-white/90">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-500" aria-label={label} />
    </div>
  );
}
