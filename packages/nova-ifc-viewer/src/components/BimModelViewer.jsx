import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { dachDreiecke } from "@core/lib/bauteil/dachGeometrie.js"; // 108-11: triangles of the roof faces handed in (no own roof computation)

// Lightweight IFC-style 3D model viewer built directly on three.js (no addons,
// so no import-path fragility). Renders a multi-storey building and places
// clickable issue markers at stored 3D positions ("affected locations").
//
// Props:
//   building        — { floors?, area_net?, dach? } sizes the model; without dach: the schematic stack of before (floors boxes of 3 m
//                     over a stand-in rectangle from area_net). dach (108-11, optional) = the main body of the Massing-Studio WITH the
//                     roof of the building model, drawn TO SCALE in m instead of the stack: { form, traufhoehe_m, firsthoehe_m,
//                     geschossEbenen_m[], umriss[{x, z}], flaechen[{art, punkte3d}], wandFlaechen?[{art, punkte3d}] } — the values of
//                     massing/hauptdach.hauptkoerperDach (createBuildingModel + globalesDach, the BIM studio's call). Outline and faces
//                     in any plan frame (the studio hands site m); the viewer centres them on the outline's bounding box. One storey
//                     slab per storey plane from ±0.00 up to the eaves, gable triangles and wall infill in the storey colour, the roof
//                     faces in the roof colour. The viewer computes no slope, eaves or ridge itself.
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

/** @param {{building?: any, issues?: any[], selectedIssueId?: string|null, addMode?: boolean, onSelectIssue?: (...a: any[]) => any, onPlaceIssue?: (...a: any[]) => any, elementMode?: boolean, selectedElementIds?: any[], highlightElementIds?: any[], onToggleElement?: (...a: any[]) => any, comments?: any[], commentMode?: boolean, selectedCommentId?: string|null, onSelectComment?: (...a: any[]) => any, onPlaceComment?: (...a: any[]) => any}} props */
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
  const state = useRef(/** @type {Record<string, any>} */ ({})); // three.js handles + groups (87-09)
  // Latest callbacks/flags for use inside the persistent event handlers.
  const handlers = useRef(/** @type {Record<string, any>} */ ({})); // latest callbacks for the pointer handler
  handlers.current = { addMode, onSelectIssue, onPlaceIssue, elementMode, onToggleElement, commentMode, onSelectComment, onPlaceComment };

  const floors = Math.max(1, Math.round(building?.floors || 5));
  const footprint = Math.sqrt(Math.max(building?.area_net || 600, 200)) / 3;
  // 108-11: the main body with the roof of the building model as one string key, so the scene effect re-runs only on a real change
  const dachEin = building?.dach;
  const dachKey = dachEin && ["sattel", "walm", "pult"].includes(dachEin.form) && Number(dachEin.traufhoehe_m) > 0
    && Array.isArray(dachEin.umriss) && dachEin.umriss.length >= 3 && Array.isArray(dachEin.flaechen) && dachEin.flaechen.length
    ? JSON.stringify({
      form: dachEin.form, traufhoehe_m: Number(dachEin.traufhoehe_m), firsthoehe_m: Number(dachEin.firsthoehe_m) || Number(dachEin.traufhoehe_m),
      geschossEbenen_m: Array.isArray(dachEin.geschossEbenen_m) ? dachEin.geschossEbenen_m : [],
      umriss: dachEin.umriss, flaechen: dachEin.flaechen.map((/** @type {any} */ q) => ({ art: q.art, punkte3d: q.punkte3d })),
      wandFlaechen: Array.isArray(dachEin.wandFlaechen) ? dachEin.wandFlaechen.map((/** @type {any} */ q) => ({ art: q.art, punkte3d: q.punkte3d })) : [],
    })
    : "";

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
    /** @type {any} */
    const dach = dachKey ? JSON.parse(dachKey) : null;
    const floorH = 3;
    const buildingGroup = new THREE.Group();
    const pickTargets = [];
    /** @type {Record<string, any>} */
    const slabByEl = {}; // elementId -> slab mesh (for highlight sync)
    /** @type {number[]} */
    let ebenen = []; // storey elevations above ground, m (zones are placed on them)
    let w, d, buildingHeight;
    if (!dach) {
      // schematic stack (no roof): exactly as before 108-11
      w = footprint;
      d = footprint * 0.8;
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
      buildingHeight = floors * floorH;
    } else {
      // 108-11 (review): the main body to scale — outline extruded storey by storey up to the eaves, then the faces handed in
      const xs = dach.umriss.map((/** @type {any} */ p) => Number(p.x)), zs = dach.umriss.map((/** @type {any} */ p) => Number(p.z));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      w = Math.max(...xs) - Math.min(...xs);
      d = Math.max(...zs) - Math.min(...zs);
      const shape = new THREE.Shape();
      dach.umriss.forEach((/** @type {any} */ p, /** @type {number} */ i) => (i ? shape.lineTo(p.x - cx, -(p.z - cz)) : shape.moveTo(p.x - cx, -(p.z - cz))));
      shape.closePath();
      const traufe = Number(dach.traufhoehe_m);
      ebenen = [0, ...dach.geschossEbenen_m.map(Number).filter((/** @type {number} */ z) => z > 1e-6 && z < traufe - 1e-6)].sort((p, q) => p - q);
      ebenen.forEach((unten, i) => {
        const oben = i + 1 < ebenen.length ? ebenen[i + 1] : traufe;
        const geo = new THREE.ExtrudeGeometry(shape, { depth: oben - unten, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // extrusion (z) → height (y), plan z stays z (same as the massing iso)
        const slab = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.55, roughness: 0.6 }));
        slab.position.y = unten;
        slab.castShadow = true;
        slab.userData.elementId = `floor-${i}`;
        buildingGroup.add(slab);
        pickTargets.push(slab);
        slabByEl[`floor-${i}`] = slab;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1e3a8a, transparent: true, opacity: 0.4 }));
        edges.position.copy(slab.position);
        buildingGroup.add(edges);
      });
      /** @param {any[]} flaechen @returns {number[]} triangles in the viewer frame, m */
      const dreiecke = (flaechen) => dachDreiecke(flaechen).map((v, i) => (i % 3 === 0 ? v - cx : i % 3 === 2 ? v - cz : v));
      // gable triangles and wall infill belong to the walls (D-EFH-02) — storey colour; the roof faces in the roof colour of the BIM studio
      const wand = dreiecke([...dach.flaechen.filter((/** @type {any} */ q) => q.art === "giebel"), ...dach.wandFlaechen]);
      if (wand.length) {
        const ggeo = new THREE.BufferGeometry();
        ggeo.setAttribute("position", new THREE.Float32BufferAttribute(wand, 3));
        ggeo.computeVertexNormals();
        buildingGroup.add(new THREE.Mesh(ggeo, new THREE.MeshStandardMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.55, roughness: 0.6, side: THREE.DoubleSide })));
      }
      const dachPos = dreiecke(dach.flaechen.filter((/** @type {any} */ q) => q.art !== "giebel"));
      if (dachPos.length) {
        const dgeo = new THREE.BufferGeometry();
        dgeo.setAttribute("position", new THREE.Float32BufferAttribute(dachPos, 3));
        dgeo.computeVertexNormals();
        const roof = new THREE.Mesh(dgeo, new THREE.MeshStandardMaterial({ color: 0xb05a3c, roughness: 0.85, side: THREE.DoubleSide }));
        roof.castShadow = true;
        roof.userData.dach = true;
        buildingGroup.add(roof);
      }
      buildingHeight = Math.max(traufe, Number(dach.firsthoehe_m) || traufe);
    }
    scene.add(buildingGroup);
    // 108-11: headless check (e2e) — the form, plus eaves and ridge MEASURED on the drawn object (top of the storey slabs, top of the group)
    mount.dataset.dach = dach ? String(dach.form) : "";
    if (dach) {
      const slabTop = pickTargets.reduce((m, o) => Math.max(m, new THREE.Box3().setFromObject(o).max.y), 0);
      mount.dataset.traufeM = slabTop.toFixed(2);
      mount.dataset.firstM = new THREE.Box3().setFromObject(buildingGroup).max.y.toFixed(2);
    } else {
      delete mount.dataset.traufeM;
      delete mount.dataset.firstM;
    }


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
      // 101-09 (CAD mouse, same as the massing iso): middle = pan, Shift + middle = orbit;
      // left drag still orbits here (this viewer has no drawing tools on the left button).
      panning = e.button === 1 && !e.shiftKey;
      if (e.button === 1) e.preventDefault();
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
      // Middle-button "clicks" (no drag): 2–3 in quick succession → zoom extents (101-08).
      if (e.button === 1 && !moved) {
        midClicks += 1;
        if (midClickTimer) clearTimeout(midClickTimer);
        if (midClicks >= 2) {
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
    // 101-07: no browser context menu on the 3D surface.
    const ohneMenue = (/** @type {Event} */ ev) => ev.preventDefault();
    el.addEventListener("contextmenu", ohneMenue);
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

    state.current = { scene, renderer, markerGroup, commentGroup, zoneGroup, buildingGroup, orbit, applyCamera, el, mount, slabByEl, ebenen: dach ? ebenen : null };

    return () => {
      cancelAnimationFrame(raf);
      if (midClickTimer) clearTimeout(midClickTimer);
      ro.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("contextmenu", ohneMenue);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      // 108-11 review: free the GPU buffers of this build (the scene is rebuilt when the model or its roof changes)
      for (const wurzel of [buildingGroup, ground, grid]) {
        wurzel.traverse((/** @type {any} */ o) => {
          o.geometry?.dispose?.();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((/** @type {any} */ m) => m?.dispose?.());
        });
      }
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
    };
    // Rebuild only when the model geometry inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, footprint, dachKey]);

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
  }, [selectedElementIds, highlightElementIds, floors, footprint, dachKey]);

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
      // 108-11: with the body to scale on the storey planes of the model (s.ebenen), else on the 3 m grid of the stack
      const ebenen = Array.isArray(s.ebenen) && s.ebenen.length ? s.ebenen : null;
      if (ebenen ? level >= ebenen.length : level >= floors) return;
      const baseY = (ebenen ? ebenen[level] : level * floorH) + 0.08;

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
  }, [zones, floors, footprint, dachKey]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mountRef}
        className="w-full h-full"
        style={{ cursor: addMode || commentMode || elementMode ? "crosshair" : "grab" }}
      />
      <div className="absolute bottom-2 left-2 rounded-md bg-slate-900/70 px-2 py-1 text-[10px] leading-tight text-slate-100 pointer-events-none">
        <div>Verschieben: Mausrad gedrückt</div>
        <div>Drehen: Umschalt + Mausrad gedrückt (oder links ziehen)</div>
        <div>Zoom: Mausrad · Alles einpassen: 2× aufs Rad klicken</div>
      </div>
    </div>
  );
}
