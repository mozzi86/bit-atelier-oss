// 106-01: ONE ray pick for every viewer and every pointing device. A mouse, a pen and later a
// VR controller all produce a ray (origin + direction in metres); this module returns what the ray
// hits first. Pure three.js math — no DOM, no WebGL, node-testable.
//
// The pick returns the three.js object and the hit data. WHICH building element a hit belongs to
// (its GUID) is viewer-specific — the IFC viewer maps faceIndex through its range table
// (ifcAufloeser in @ifc/lib/ifcGeometry.js), the BIM studio reads mesh.userData (bauteilInfoAus in
// @designer/lib/bauteilInfo.js) — so that mapping is NOT here (boundary rule: @core imports only
// @core). identitaetAus() applies such a resolver. Ground truth is the GUID from the ray, never an
// image (phase 106 guard rail 3). A new pointer type (pen, VR controller) only builds a ray and
// reuses the resolver of the viewer it points into.
//
// Section planes: three's Raycaster ignores material.clippingPlanes and hits geometry that is
// already cut away visually. Pass the active planes in opt.schnittebenen: the first hit lying in
// front of ALL planes wins (same rule as ersterSichtbarerTreffer in IfcViewer.jsx).
//
// In:  targets (Object3D[]), ray ({ursprung, richtung} in m, or THREE.Ray), options.
// Out: strahlPick() → hit or null; strahlAusZeiger(), ndcAusEreignis(), identitaetAus(), pickDrossel().
import * as THREE from "three";

/**
 * A picked point on a target.
 * @typedef {Object} StrahlTreffer
 * @property {THREE.Object3D} objekt   The hit object (a child when rekursiv is true).
 * @property {[number, number, number]} punkt  Hit point in world coordinates, m.
 * @property {number} abstand          Distance from the ray origin to the hit point, m.
 * @property {number|null} faceIndex   Index of the hit triangle (index-buffer position / 3), null if not a face.
 * @property {number|null} instanceId  Instance index for InstancedMesh, else null.
 * @property {THREE.Intersection} roh  The raw three.js intersection (uv, normal, face …).
 */

/**
 * A ray in plain numbers.
 * @typedef {Object} Strahl
 * @property {readonly number[]} ursprung   Origin [x, y, z], m.
 * @property {readonly number[]} richtung   Direction [x, y, z], need not be normalised (not zero).
 */

/** Tolerance, m: a hit this far behind a section plane still counts as visible (rounding). */
const EBENEN_TOLERANZ_M = -1e-4;

// One raycaster and scratch vectors for all picks (hover calls this every frame; allocating per
// call would be churn). Single-threaded and never re-entered, so sharing is safe.
const RAYCASTER = new THREE.Raycaster();
const ZEIGER_NDC = new THREE.Vector2();
const URSPRUNG = new THREE.Vector3();
const RICHTUNG = new THREE.Vector3();

/**
 * First object hit by a ray.
 * @param {THREE.Object3D|readonly THREE.Object3D[]} ziele  Targets to test. Only the mesh you want
 *   picked belongs here — pass the IFC mesh alone, never the whole scene with selection overlays.
 * @param {Strahl|THREE.Ray} strahl  Origin and direction, m (world frame of the targets).
 * @param {Object} [opt]
 * @param {THREE.Plane[]} [opt.schnittebenen]  Active section planes; the hit must lie in front of all of them.
 * @param {(hit: THREE.Intersection) => boolean} [opt.filter]  Return false to skip a hit (e.g. hidden elements).
 * @param {boolean} [opt.rekursiv]  Also test children of the targets (default false).
 * @param {boolean} [opt.matrizenAktualisieren]  Call updateMatrixWorld() on the targets first
 *   (default false: the render loop already did; set it for objects that never were rendered).
 * @param {THREE.Camera} [opt.kamera]  Needed only when sprites are among the targets.
 * @param {number} [opt.reichweite]  Maximum distance, m (default unlimited).
 * @returns {StrahlTreffer|null}  The nearest accepted hit, or null (a miss is never guessed).
 */
export function strahlPick(ziele, strahl, opt = {}) {
  const liste = Array.isArray(ziele) ? ziele : [ziele];
  if (!liste.length || !strahl) return null;
  const { schnittebenen, filter, rekursiv = false, matrizenAktualisieren = false, kamera, reichweite } = opt;

  // Both ray forms take the same road: finite numbers, a direction that is not zero, then a
  // unit direction (three's Raycaster assumes unit length: a short direction would shorten the
  // reach and miss an element that lies in the way). A bad ray is a miss, never a guess.
  const quelleStrahl = strahl instanceof THREE.Ray
    ? { ursprung: [strahl.origin.x, strahl.origin.y, strahl.origin.z], richtung: [strahl.direction.x, strahl.direction.y, strahl.direction.z] }
    : strahl;
  const [ox, oy, oz] = quelleStrahl.ursprung ?? [];
  const [dx, dy, dz] = quelleStrahl.richtung ?? [];
  if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return null;
  RICHTUNG.set(dx, dy, dz);
  if (!(RICHTUNG.lengthSq() > 0)) return null;
  RAYCASTER.ray.set(URSPRUNG.set(ox, oy, oz), RICHTUNG.normalize());
  RAYCASTER.near = 0;
  RAYCASTER.far = Number.isFinite(reichweite) ? /** @type {number} */ (reichweite) : Infinity;
  // The camera is only read by Sprite.raycast; always reset it so a stale camera never leaks between calls.
  /** @type {any} */ (RAYCASTER).camera = kamera ?? null;

  if (matrizenAktualisieren) for (const z of liste) z.updateMatrixWorld(true);
  const treffer = RAYCASTER.intersectObjects(liste, rekursiv); // sorted by distance

  const ebenen = schnittebenen && schnittebenen.length ? schnittebenen : null;
  const hit = treffer.find((h) =>
    (!ebenen || ebenen.every((e) => e.distanceToPoint(h.point) >= EBENEN_TOLERANZ_M)) && (!filter || filter(h)));
  if (!hit) return null;
  return {
    objekt: hit.object,
    punkt: [hit.point.x, hit.point.y, hit.point.z],
    abstand: hit.distance,
    faceIndex: hit.faceIndex ?? null,
    instanceId: hit.instanceId ?? null,
    roh: hit,
  };
}

/**
 * The ray through a screen point (mouse or pen), for strahlPick().
 * @param {THREE.Camera} kamera  Perspective or orthographic camera.
 * @param {number} ndcX  Horizontal position, -1 (left) .. 1 (right).
 * @param {number} ndcY  Vertical position, -1 (bottom) .. 1 (top).
 * @returns {{ursprung: [number, number, number], richtung: [number, number, number]}}  Origin (m) and unit direction.
 */
export function strahlAusZeiger(kamera, ndcX, ndcY) {
  kamera.updateMatrixWorld();
  // setFromCamera also stores the camera on the shared raycaster; strahlPick() resets it per call.
  RAYCASTER.setFromCamera(ZEIGER_NDC.set(ndcX, ndcY), kamera);
  const { origin: o, direction: d } = RAYCASTER.ray;
  return { ursprung: [o.x, o.y, o.z], richtung: [d.x, d.y, d.z] };
}

/**
 * Pointer event position to normalised device coordinates of a canvas.
 * @param {{getBoundingClientRect: () => {left: number, top: number, width: number, height: number}}} domElement  The canvas (renderer.domElement).
 * @param {number} clientX  Event clientX, px.
 * @param {number} clientY  Event clientY, px.
 * @returns {{x: number, y: number}|null}  NDC (-1..1, y up), or null when the element has no size (nothing to pick).
 */
export function ndcAusEreignis(domElement, clientX, clientY) {
  const r = domElement.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 };
}

/**
 * Identity of a hit: asks the viewer's own resolver which building element it is.
 * @param {StrahlTreffer|null} treffer  Result of strahlPick().
 * @param {(treffer: StrahlTreffer) => ({guid?: string|null, expressId?: number|null, userData?: object|null} & Record<string, any>) | null | undefined} aufloeser
 *   Viewer-specific: IFC = ranges table + expressIdAtFaceIndex + guidByExpressId; BIM = treffer.objekt.userData.
 *   Return null when the hit is no building element (context, helper geometry).
 * @param {{guidPflicht?: boolean}} [opt]  guidPflicht: refuse a hit whose element has no GUID
 *   (a "dieses" command needs an address; without a GUID there is none). Default false.
 * @returns {({guid: string|null, expressId: number|null, userData: object|null, objekt: THREE.Object3D, punkt: [number, number, number], abstand: number} & Record<string, any>)|null}
 *   null when there is no hit or the resolver does not know the hit — an unknown hit is refused, not guessed.
 */
export function identitaetAus(treffer, aufloeser, opt = {}) {
  if (!treffer || typeof aufloeser !== "function") return null;
  const id = aufloeser(treffer);
  if (!id) return null;
  if (opt.guidPflicht && !(typeof id.guid === "string" && id.guid.length > 0)) return null;
  return {
    guid: null, expressId: null, userData: null,
    ...id,
    objekt: treffer.objekt, punkt: treffer.punkt, abstand: treffer.abstand,
  };
}

/**
 * Budget for per-frame picks: a pick that took longer than the budget delays the next one, so a
 * huge model cannot make hovering stutter (one pick per frame is the ceiling, this is the floor).
 * @param {Object} [opt]
 * @param {number} [opt.budgetMs]  Pick duration, ms, up to which every frame may pick (default 8 [ASSUMED]: half a 60 Hz frame).
 * @param {number} [opt.faktor]    After a slow pick wait faktor x its duration before the next one (default 3 [ASSUMED]).
 * @returns {{darf: (jetztMs: number) => boolean, messen: (dauerMs: number, jetztMs: number) => void}}
 *   darf(): may a pick run now; messen(): report the duration of the pick that just ran (both in ms).
 */
export function pickDrossel(opt = {}) {
  const budgetMs = opt.budgetMs ?? 8;
  const faktor = opt.faktor ?? 3;
  let fruehestens = 0;
  return {
    darf: (jetztMs) => jetztMs >= fruehestens,
    messen: (dauerMs, jetztMs) => { fruehestens = dauerMs > budgetMs ? jetztMs + dauerMs * faktor : 0; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 106-07: pointer kinds. A mouse, a pen and a finger point with different precision; the pick core knows the kind and
// gives a pen and a finger a capture radius (pattern of the sketch canvas: hit radius 8 px, 18 px for touch). The
// mouse keeps the exact single ray it always had (radius 0), so nothing changes for it. Part of the prerequisite 105-16
// (pen/touch on the drawing pages) that 106-07 needs, as reusable code for every viewer.

/** @typedef {"mouse"|"pen"|"touch"} ZeigerArt */

/** Capture radius per pointer kind, px (CSS pixels of the canvas) [ASSUMED: pen 8 and touch 18 as in the sketch canvas; mouse exact]. */
export const FANG_RADIUS_PX = Object.freeze({ mouse: 0, pen: 8, touch: 18 });

/** How far a pointer may move between down and up and still count as a tap/click, px [ASSUMED: mouse 4 as before, touch 10 as in the sketch canvas; pen 6 = between the two, no source value: the pen tip is as exact as a mouse but slips a little when it lands on glass - to be checked on the real tablet]. */
export const TIPP_TOLERANZ_PX = Object.freeze({ mouse: 4, pen: 6, touch: 10 });

/** Directions sampled on each ring of the capture radius (8 = every 45 degrees). */
const RING_RICHTUNGEN = 8;

/**
 * Pointer kind of an event. Unknown kinds (an empty string in older browsers, a future kind) count as mouse: the exact
 * pick is the safe direction, it never selects something the pointer is not on.
 * @param {{pointerType?: string}|null|undefined} e  Pointer event (or anything with pointerType).
 * @returns {ZeigerArt}
 */
export function zeigerArt(e) {
  const t = e?.pointerType;
  return t === "pen" || t === "touch" ? t : "mouse";
}

/**
 * Screen offsets to try around a pointer, nearest first: the point itself, then a ring at half the radius, then a ring at
 * the full radius (8 directions each). A radius of 0 gives only the point itself.
 * @param {number} radiusPx  Capture radius, px.
 * @returns {Array<[number, number]>}  Offsets [dx, dy] in px, the first one is [0, 0].
 */
export function fangVersaetze(radiusPx) {
  /** @type {Array<[number, number]>} */
  const raus = [[0, 0]];
  if (!(radiusPx > 0)) return raus;
  for (const r of [radiusPx / 2, radiusPx]) {
    for (let i = 0; i < RING_RICHTUNGEN; i++) {
      const w = (i / RING_RICHTUNGEN) * Math.PI * 2;
      raus.push([Math.round(Math.cos(w) * r * 1000) / 1000, Math.round(Math.sin(w) * r * 1000) / 1000]);
    }
  }
  return raus;
}

/**
 * Pick under a pointer with the capture radius of its kind. The exact ray goes first; only when it hits nothing the
 * caller accepts (a miss, sky, a context building) the rings around it are tried, nearest ring first. A mouse (radius
 * 0) gets exactly the old single-ray behaviour, including an unaccepted hit.
 * @param {THREE.Object3D|readonly THREE.Object3D[]} ziele  Targets, as for strahlPick().
 * @param {THREE.Camera} kamera  Camera of the view.
 * @param {{getBoundingClientRect: () => {left: number, top: number, width: number, height: number}}} domElement  The canvas.
 * @param {number} clientX  Pointer position, px.
 * @param {number} clientY  Pointer position, px.
 * @param {Parameters<typeof strahlPick>[2] & {art?: ZeigerArt, radiusPx?: number, annehmen?: (t: StrahlTreffer) => boolean}} [opt]
 *   art: pointer kind (default mouse); radiusPx overrides the radius of the kind; annehmen: does the caller know this hit
 *   (e.g. it resolves to a building element)? Without it every hit is accepted.
 * @returns {(StrahlTreffer & {versatzPx: [number, number]})|null}  The hit and the screen offset it was found at (px);
 *   when no offset gives an accepted hit, the exact ray's hit (possibly unaccepted) or null.
 */
export function zeigerPick(ziele, kamera, domElement, clientX, clientY, opt = {}) {
  const { art = "mouse", radiusPx, annehmen, ...pickOpt } = opt;
  const radius = Number.isFinite(radiusPx) ? /** @type {number} */ (radiusPx) : FANG_RADIUS_PX[art] ?? 0;
  /** @type {(StrahlTreffer & {versatzPx: [number, number]})|null} */
  let mitte = null;
  for (const [dx, dy] of fangVersaetze(radius)) {
    const ndc = ndcAusEreignis(domElement, clientX + dx, clientY + dy);
    if (!ndc) return null;
    const t = strahlPick(ziele, strahlAusZeiger(kamera, ndc.x, ndc.y), pickOpt);
    if (dx === 0 && dy === 0) mitte = t ? { ...t, versatzPx: [0, 0] } : null;
    if (t && (!annehmen || annehmen(t))) return { ...t, versatzPx: [dx, dy] };
  }
  return mitte;
}
