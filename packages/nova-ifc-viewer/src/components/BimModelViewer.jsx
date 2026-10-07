import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";

// Lightweight IFC-style 3D model viewer built directly on three.js (no addons,
// so no import-path fragility). Renders a multi-storey building and places
// clickable issue markers at stored 3D positions ("affected locations").
//
// Props:
//   building        — { floors?, area_net? } sizes the model
//   issues          — [{ id, location:{x,y,z}, priority }]
//   selectedIssueId — highlights the matching marker
//   addMode         — when true, clicking the building reports a 3D point
//   onSelectIssue(id)
//   onPlaceIssue({x,y,z})

const PRIORITY_COLORS = {
  low: 0x10b981,
  medium: 0xf59e0b,
  high: 0xef4444,
  critical: 0xb91c1c,
};

export default function BimModelViewer({
  building,
  issues = [],
  selectedIssueId,
  addMode = false,
  onSelectIssue,
  onPlaceIssue,
  // AVA quantity-takeoff ("Mengenermittlung") extras:
  elementMode = false, // clicking a storey toggles its selection
  selectedElementIds = [], // storeys selected for takeoff
  highlightElementIds = [], // storeys to highlight (e.g. linked to a position)
  onToggleElement,
  // BIM-2.0 collaboration comments:
  comments = [],
  commentMode = false,
  selectedCommentId,
  onSelectComment,
  onPlaceComment,
}) {
  const mountRef = useRef(null);
  // Räume/Zonen aus der gemeinsamen Quelle (Gebäudemodell ↔ Massenmodell).
  const { zones } = useBuildingProgram();
  const zoneList = Array.isArray(zones) ? zones : [];
  // Keep mutable scene refs across renders without re-creating the scene.
  const state = useRef({});
  // Latest callbacks/flags for use inside the persistent event handlers.
  const handlers = useRef({});
  handlers.current = { addMode, onSelectIssue, onPlaceIssue, elementMode, onToggleElement, commentMode, onSelectComment, onPlaceComment };

  const floors = Math.max(1, Math.round(building?.floors || 5));
  const footprint = Math.sqrt(Math.max(building?.area_net || 600, 200)) / 3;

  // --- Build scene once -----------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f7);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(20, 40, 25);
    dir.castShadow = true;
    scene.add(dir);

    // Ground grid
    const grid = new THREE.GridHelper(80, 40, 0xcbd5e1, 0xe2e8f0);
    scene.add(grid);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.5 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Building group (floors)
    const w = footprint;
    const d = footprint * 0.8;
    const floorH = 3;
    const buildingGroup = new THREE.Group();
    const pickTargets = [];
    const slabByEl = {}; // elementId -> slab mesh (for highlight sync)
    for (let i = 0; i < floors; i++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, floorH * 0.9, d),
        new THREE.MeshStandardMaterial({
          color: 0x93c5fd,
          transparent: true,
          opacity: 0.55,
          roughness: 0.6,
        })
      );
      slab.position.y = i * floorH + floorH / 2;
      slab.castShadow = true;
      slab.userData.elementId = `floor-${i}`;
      buildingGroup.add(slab);
      pickTargets.push(slab);
      slabByEl[`floor-${i}`] = slab;
      // edges for definition
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(slab.geometry),
        new THREE.LineBasicMaterial({ color: 0x1e3a8a, transparent: true, opacity: 0.4 })
      );
      edges.position.copy(slab.position);
      buildingGroup.add(edges);
    }
    scene.add(buildingGroup);

    const buildingHeight = floors * floorH;

    // Camera orbit state (spherical)
    const orbit = {
      radius: Math.max(w, buildingHeight) * 2.4,
      theta: Math.PI / 4,
      phi: Math.PI / 3,
      target: new THREE.Vector3(0, buildingHeight / 2, 0),
    };
    const applyCamera = () => {
      const { radius, theta, phi, target } = orbit;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    };
    applyCamera();

    // Zoom Extents — frame the whole model (keeps current view angle).
    const zoomExtent = () => {
      orbit.target.set(0, buildingHeight / 2, 0);
      orbit.radius = Math.max(w, d, buildingHeight) * 2.4;
      applyCamera();
    };

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const commentGroup = new THREE.Group();
    scene.add(commentGroup);
    // Gruppe für gezeichnete Räume/Zonen aus dem Gebäudemodell.
    const zoneGroup = new THREE.Group();
    scene.add(zoneGroup);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let moved = false;
    let panning = false; // pan instead of orbit (middle button or Shift+left)
    let lastX = 0;
    let lastY = 0;
    let midClicks = 0; // count rapid middle-button clicks → 3× = zoom extents
    let midClickTimer = null;
    const panRight = new THREE.Vector3();
    const panUp = new THREE.Vector3();

    const setPointer = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (e) => {
      dragging = true;
      moved = false;
      // Middle mouse button (1) or Shift+left → pan; otherwise orbit.
      panning = e.button === 1 || (e.button === 0 && e.shiftKey);
      if (panning) e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      lastX = e.clientX;
      lastY = e.clientY;
      if (panning) {
        // Move the orbit target in the camera's screen plane.
        const factor = orbit.radius * 0.0018;
        panRight.setFromMatrixColumn(camera.matrix, 0); // camera X axis (right)
        panUp.setFromMatrixColumn(camera.matrix, 1);    // camera Y axis (up)
        orbit.target.addScaledVector(panRight, -dx * factor);
        orbit.target.addScaledVector(panUp, dy * factor);
      } else {
        orbit.theta -= dx * 0.01;
        orbit.phi = Math.min(Math.PI - 0.2, Math.max(0.2, orbit.phi - dy * 0.01));
      }
      applyCamera();
    };
    const onPointerUp = (e) => {
      dragging = false;
      const wasPanning = panning;
      panning = false;
      // Middle-button "clicks" (no drag): 3 in quick succession → zoom extents.
      if (e.button === 1 && !moved) {
        midClicks += 1;
        if (midClickTimer) clearTimeout(midClickTimer);
        if (midClicks >= 3) {
          midClicks = 0;
          zoomExtent();
        } else {
          midClickTimer = setTimeout(() => { midClicks = 0; }, 500);
        }
        return;
      }
      if (moved || wasPanning) return; // it was a drag/pan, not a click
      setPointer(e);
      raycaster.setFromCamera(pointer, camera);

      // 1) marker hit?
      const markerHits = raycaster.intersectObjects(markerGroup.children, false);
      if (markerHits.length > 0) {
        const id = markerHits[0].object.userData.issueId;
        handlers.current.onSelectIssue?.(id);
        return;
      }
      // 1a) comment marker hit?
      const commentHits = raycaster.intersectObjects(commentGroup.children, false);
      if (commentHits.length > 0) {
        handlers.current.onSelectComment?.(commentHits[0].object.userData.commentId);
        return;
      }
      // 1a2) comment placement mode: click the building to drop a comment.
      if (handlers.current.commentMode) {
        const hits = raycaster.intersectObjects(pickTargets, false);
        if (hits.length > 0) {
          const p = hits[0].point;
          handlers.current.onPlaceComment?.({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
        }
        return;
      }
      // 1b) element-takeoff mode: toggle the clicked storey's selection.
      if (handlers.current.elementMode) {
        const elHits = raycaster.intersectObjects(pickTargets, false);
        if (elHits.length > 0) {
          handlers.current.onToggleElement?.(elHits[0].object.userData.elementId);
        }
        return;
      }
      // 2) in add mode, building hit -> place
      if (handlers.current.addMode) {
        const hits = raycaster.intersectObjects(pickTargets, false);
        if (hits.length > 0) {
          const p = hits[0].point;
          handlers.current.onPlaceIssue?.({
            x: +p.x.toFixed(2),
            y: +p.y.toFixed(2),
            z: +p.z.toFixed(2),
          });
        }
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      orbit.radius = Math.min(200, Math.max(5, orbit.radius + e.deltaY * 0.05));
      applyCamera();
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      // pulse selected marker
      const t = performance.now() * 0.005;
      markerGroup.children.forEach((m) => {
        const s = m.userData.selected ? 1 + Math.sin(t) * 0.15 : 1;
        m.scale.setScalar(s);
      });
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const wd = mount.clientWidth;
      const ht = mount.clientHeight;
      if (!wd || !ht) return;
      camera.aspect = wd / ht;
      camera.updateProjectionMatrix();
      renderer.setSize(wd, ht);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    state.current = { scene, renderer, markerGroup, commentGroup, zoneGroup, buildingGroup, orbit, applyCamera, el, mount, slabByEl };

    return () => {
      cancelAnimationFrame(raf);
      if (midClickTimer) clearTimeout(midClickTimer);
      ro.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
    };
    // Rebuild only when the model geometry inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, footprint]);

  // --- Sync storey highlight for AVA takeoff --------------------------------
  useEffect(() => {
    const s = state.current;
    if (!s?.slabByEl) return;
    const selected = new Set(selectedElementIds);
    const linked = new Set(highlightElementIds);
    Object.entries(s.slabByEl).forEach(([id, slab]) => {
      const m = slab.material;
      if (selected.has(id)) {
        m.color.setHex(0x22c55e); // green = selected for takeoff
        m.opacity = 0.85;
        m.emissive?.setHex(0x166534);
      } else if (linked.has(id)) {
        m.color.setHex(0xf59e0b); // amber = linked to active position
        m.opacity = 0.8;
        m.emissive?.setHex(0x000000);
      } else {
        m.color.setHex(0x93c5fd); // default blue
        m.opacity = 0.55;
        m.emissive?.setHex(0x000000);
      }
    });
  }, [selectedElementIds, highlightElementIds, floors, footprint]);

  // --- Sync markers when issues / selection change --------------------------
  useEffect(() => {
    const s = state.current;
    if (!s?.markerGroup) return;
    const { markerGroup } = s;
    // clear
    while (markerGroup.children.length) {
      const m = markerGroup.children.pop();
      m.geometry?.dispose();
      m.material?.dispose();
    }
    issues.forEach((issue) => {
      const loc = issue.location || {};
      const color = PRIORITY_COLORS[issue.priority] || 0x6366f1;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 16, 16),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: issue.id === selectedIssueId ? 0.6 : 0.2,
        })
      );
      marker.position.set(loc.x || 0, loc.y || 1.5, loc.z || 0);
      marker.userData.issueId = issue.id;
      marker.userData.selected = issue.id === selectedIssueId;
      markerGroup.add(marker);
    });
  }, [issues, selectedIssueId]);

  // --- Sync comment markers (BIM-2.0 collaboration) -------------------------
  useEffect(() => {
    const s = state.current;
    if (!s?.commentGroup) return;
    const { commentGroup } = s;
    while (commentGroup.children.length) {
      const m = commentGroup.children.pop();
      m.geometry?.dispose();
      m.material?.dispose();
    }
    comments.forEach((c) => {
      const loc = c.location || {};
      const color = c.resolved ? 0x10b981 : 0xf59e0b;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(c.id === selectedCommentId ? 0.85 : 0.6, 14, 14),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: c.id === selectedCommentId ? 0.7 : 0.3 })
      );
      marker.position.set(loc.x || 0, loc.y || 1.5, loc.z || 0);
      marker.userData.commentId = c.id;
      commentGroup.add(marker);
    });
  }, [comments, selectedCommentId]);

  // --- Sync Räume/Zonen aus dem Gebäudemodell (gemeinsame Quelle) ------------
  useEffect(() => {
    const s = state.current;
    if (!s?.zoneGroup) return;
    const { zoneGroup } = s;
    const floorH = 3;
    // leeren (Geometrie/Material freigeben)
    while (zoneGroup.children.length) {
      const m = zoneGroup.children.pop();
      m.geometry?.dispose();
      m.material?.dispose();
    }
    zoneList.forEach((z) => {
      const pts = Array.isArray(z?.points) ? z.points : [];
      if (pts.length < 3) return;
      const level = z.level || 0;
      // Nur Geschosse zeichnen, die das Gebäude auch hat (sonst schweben sie).
      if (level >= floors) return;
      const baseY = level * floorH + 0.08;

      // Flache Extrusion des Raumpolygons (XZ-Ebene, Meter um den Ursprung).
      const shape = new THREE.Shape();
      pts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.45, roughness: 0.9 })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = baseY;
      zoneGroup.add(mesh);

      // Umriss-Linie, damit der Raum klar ablesbar ist.
      const lineGeo = new THREE.BufferGeometry().setFromPoints(
        pts.map((p) => new THREE.Vector3(p.x, baseY + 0.08, p.z))
      );
      const line = new THREE.LineLoop(
        lineGeo,
        new THREE.LineBasicMaterial({ color: 0x0284c7 })
      );
      zoneGroup.add(line);
    });
    // footprint in den Deps: nach einem Scene-Rebuild ist zoneGroup neu und leer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, floors, footprint]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mountRef}
        className="w-full h-full"
        style={{ cursor: addMode || commentMode || elementMode ? "crosshair" : "grab" }}
      />
      <div className="absolute bottom-2 left-2 rounded-md bg-slate-900/70 px-2 py-1 text-[10px] leading-tight text-slate-100 pointer-events-none">
        <div>Drehen: Linksklick ziehen</div>
        <div>Verschieben: Shift+Linksklick oder mittlere Maustaste</div>
        <div>Zoom: Mausrad</div>
        <div>Alles einpassen: 3× mittlere Maustaste</div>
      </div>
    </div>
  );
}
