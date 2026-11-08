// bauherrBetrachter.js — the small read-only 3D viewer of the client portal
// (Phase 110-05): renderer, light, camera framing and orbit controls around the
// GLB the BIM studio wrote from its scene (bauherrModell3d.js szeneAlsGlb).
//
// Its own module with STATIC three imports on purpose: the portal component
// (src/components/bauherr/Modell3D.jsx) loads this file lazily. A dynamic
// `import('three')` there would hand Rollup the whole namespace object and
// switch off tree-shaking — every three class (audio, helpers, all materials)
// would land in the shared `three` chunk (+42 KB gzip, budget.json chunks.three).
// GLTFLoader sits in its own lazy chunk `three-gltf` (vite.config.js); the core
// classes it needs (animation, skinning, texture loading) still land in the
// shared chunk: chunks.three 162.4 -> 171.3 KB gzip of 176 (measured 08.11.2026).
// Accepted for full glTF support (textures of the studio materials).
//
// The scene is drawn only when the camera moves (no render loop: a phone on
// the building site keeps its battery).
//
// In:  host element (sized by the caller), the GLB as ArrayBuffer.
// Out: a handle with `beenden()`. Side effects: one WebGL context and a canvas
//      inside the host element until beenden() releases both.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Starts the viewer inside `el`.
 * @param {HTMLElement} el host element; the canvas fills its client width × height (CSS pixels)
 * @param {ArrayBuffer} puffer GLB of the studio scene (bauherrModell3d.js szeneAlsGlb)
 * @returns {Promise<{ beenden: () => void }>} beenden: removes the canvas, frees GPU and texture memory and listeners
 * @throws {Error} when the file cannot be read; WebGL errors of three pass through
 */
export async function betrachterStarten(el, puffer) {
  const modell = (await new GLTFLoader().parseAsync(puffer, "")).scene;
  /** @type {Array<() => void>} */
  const aufraeumen = [];
  const beenden = () => { for (const f of aufraeumen.splice(0).reverse()) f(); };
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);
    aufraeumen.push(() => { renderer.dispose(); renderer.domElement.remove(); });

    const szene = new THREE.Scene();
    // Neutral daylight: sky/ground fill plus one sun from the south-west (plain hex, no UI theme involved).
    szene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.2));
    const sonne = new THREE.DirectionalLight(0xffffff, 1.5);
    sonne.position.set(-30, 40, 25);
    szene.add(sonne);
    szene.add(modell);
    aufraeumen.push(() => modell.traverse((/** @type {any} */ o) => {
      o.geometry?.dispose?.();
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
        m.dispose();
      }
    }));

    const kamera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const steuerung = new OrbitControls(kamera, renderer.domElement);
    // Never below the ground plane: the client looks at the building, not into the soil.
    steuerung.maxPolarAngle = Math.PI * 0.49;
    const zeichnen = () => renderer.render(szene, kamera);
    steuerung.addEventListener("change", zeichnen);
    aufraeumen.push(() => steuerung.dispose());

    // Frame the building: camera from the south-east at about 30°, distance so the bounding sphere (m) fits the view.
    const box = new THREE.Box3().setFromObject(modell);
    const mitte = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 10 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const abstand = (radius / Math.sin((kamera.fov * Math.PI) / 360)) * 1.05;
    kamera.position.set(mitte.x + abstand * 0.65, mitte.y + abstand * 0.5, mitte.z + abstand * 0.65);
    kamera.near = abstand / 100;
    kamera.far = abstand * 10;
    steuerung.target.copy(mitte);
    steuerung.minDistance = radius * 0.5;
    steuerung.maxDistance = abstand * 3;
    steuerung.update();

    const groesse = () => {
      const b = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(b, h);
      kamera.aspect = b / h;
      kamera.updateProjectionMatrix();
      zeichnen();
    };
    const beobachter = new ResizeObserver(groesse);
    beobachter.observe(el);
    aufraeumen.push(() => beobachter.disconnect());
    groesse();
  } catch (e) {
    beenden();
    throw e;
  }
  return { beenden };
}
