// isoKamera.js — camera convention of the massing iso view (Phase 75-08, MS-08).
//
// Engine-independent PURE module: three.js consumes it in MassingView3D.jsx,
// and plan 75-09 (iso of the individual dwelling unit) will reuse the SAME
// convention without depending on the massing component.
//
// Convention (fixed by D-P75-02 / Loesungskatalog Blatt 08 — verbatim from
// 75-08-PLAN.md <objective>, engine-independent):
//   - Scene = plan axes: x = plan right (east at north angle 0), z = plan down
//     (south at north angle 0), y = up; origin = site centre (like toX3d/toZ3d
//     in MassingView3D.jsx).
//   - Yaw = plan azimuth of the VIEW DIRECTION on the ground, clockwise from
//     plan-up (−z), degrees. Horizontal view vector { x: sin yaw, z: −cos yaw }
//     (same convention as sonnenstand.sonnenrichtung). Start 45° = looking
//     north-east, camera stands in the south-west → south and west facades
//     visible (afternoon sun, default hour 15). E = view +90° (clockwise),
//     Q = −90°.
//   - Pitch 30° below the horizontal (φ = 60° from zenith); camera position =
//     target − view·cos30°·r + (0, sin30°·r, 0).
//   - North angle = geographic azimuth of plan-up (convention of
//     raumklima.azimutFromNormal, tesselierung.orientierungFuerBand,
//     nordwinkel.js): geographic = plan + north angle ⇒ plan azimuth =
//     geographic − north angle. The sun is geographic; the scene computes in
//     plan axes.
//   - Zoom = scale denominator of the ladder [2000, 1000, 500, 200]; frustum
//     half width in metres = (width px / 2) / pxJeM with
//     pxJeM = (96 px / 0.0254 m) / denominator [ASSUMED CSS inch]. The scale
//     holds in the image plane (exact across the view direction, foreshortened
//     by sin 30° = 0.5 along it).
//
// In:  yaw/pitch (degrees), ground target (metres), canvas size (CSS px),
//      scale denominator (unitless).
// Out: plain {x,y,z}/{x,z} vectors in metres, screen coordinates in CSS px,
//      degrees. No DOM, no three.js, no React — node-testable.

const RAD = Math.PI / 180;

/** Isometric pitch below the horizontal, degrees (Blatt 08: "Pitch 30°"). */
export const ISO_PITCH_GRAD = 30;
/** The four yaw detents, degrees (Blatt 08: Q/E step in 90° increments). */
export const ISO_YAWS = [45, 135, 225, 315];
/** Yaw on first mount, degrees — camera in the south-west (Blatt 08). */
export const ISO_START_YAW = 45;
/**
 * Zoom ladder, coarse → fine (scale denominators). 1:2000/1:1000 give the OSM
 * context (300-m radius) room, 1:500/1:200 = MASSING_MASSSTAEBE; 1:50 belongs
 * to the WohnungsFokus. [ASSUMED] ladder from Blatt 08.
 */
export const ISO_ZOOMSTUFEN = [2000, 1000, 500, 200];
/**
 * CSS reference pixels per metre at 1:1 — 96 px per CSS inch (0.0254 m).
 * [ASSUMED] real monitors deviate from the CSS inch; the scale is a
 * level-of-detail step, not a measurement promise (path to a measured value:
 * calibrate with a physical ruler on screen, out of scope here).
 */
export const CSS_PX_JE_M = 96 / 0.0254;
/** Tween duration for yaw/zoom steps, ms [ASSUMED Blatt 08 "soft" rotation]. */
export const TWEEN_MS = 250;
/**
 * Camera distance from the target, metres — with an orthographic projection
 * this is a PURE CLIPPING parameter, it does not change the image size.
 * [ASSUMED] must exceed the scene radius (~200 m incl. neighbours) so nothing
 * near/far-clips; 500 m keeps the depth buffer range modest.
 */
export const KAMERA_ABSTAND_M = 500;
/** Edge band for pointer edge-scrolling, CSS px [ASSUMED Blatt 08]. */
export const RAND_SCROLL_PX = 24;
/**
 * Dwell time inside the edge band before scrolling starts, ms — moving THROUGH
 * the band into the canvas must not shift anything. [ASSUMED] Blatt 08.
 */
export const RAND_VERWEIL_MS = 250;
/** Pan speed for keyboard/edge scrolling, CSS px per second [ASSUMED]. */
export const PAN_PX_JE_S = 600;
/**
 * Wheel deltaY per zoom detent — one Chrome notch = 100 at deltaMode 0.
 * [ASSUMED] other browsers/OS may send finer deltas; the accumulator in
 * MassingView3D handles that (only full thresholds step).
 */
export const RAD_SCHWELLE = 100;

/** Clamp to [0, 1]. @param {number} x @returns {number} */
function klemme01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Normalize degrees to [0, 360). @param {number} w degrees @returns {number} */
function normGrad(w) {
  return ((w % 360) + 360) % 360;
}

/**
 * Screen pixels per metre at a given scale denominator: CSS_PX_JE_M / N.
 * @param {number} massstab scale denominator (unitless, e.g. 500 for 1:500)
 * @returns {number} CSS px per metre
 */
export function pxJeMeter(massstab) {
  return CSS_PX_JE_M / (Number(massstab) || 1);
}

/**
 * Orthographic frustum half-extents in metres for a canvas size.
 * Hand check: 1 px at 1:500 = 500 · 0.0254 / 96 = 0.1322917 m, so an 800-px
 * width spans 800 · 0.1322917 / 2 = 52.9167 m to each side.
 * @param {number} massstab scale denominator (unitless)
 * @param {number} breitePx canvas width, CSS px
 * @param {number} hoehePx canvas height, CSS px
 * @returns {{ links: number, rechts: number, oben: number, unten: number, pxJeM: number }} metres (pxJeM in CSS px/m)
 */
export function frustumFuer(massstab, breitePx, hoehePx) {
  const pxJeM = pxJeMeter(massstab);
  const rechts = breitePx / 2 / pxJeM;
  const oben = hoehePx / 2 / pxJeM;
  return { links: -rechts, rechts, oben, unten: -oben, pxJeM };
}

/**
 * Horizontal unit view vector for a yaw — { x: sin yaw, z: −cos yaw }, the
 * same convention as sonnenstand.sonnenrichtung (azimuth clockwise from −z).
 * @param {number} yawGrad degrees, clockwise from plan-up (−z)
 * @returns {{ x: number, z: number }} unit vector (metres per metre)
 */
export function blickHorizontal(yawGrad) {
  const a = (Number(yawGrad) || 0) * RAD;
  return { x: Math.sin(a), z: -Math.cos(a) };
}

/**
 * Orthonormal camera basis { vor, rechts, hoch } for yaw/pitch.
 * vor points FROM the camera TOWARDS the target (downward, y = −sin pitch);
 * rechts is the horizontal screen-right; hoch the screen-up. Matches three.js
 * lookAt with up = +y (rechts = normalize(up × (−vor)), hoch = (−vor) × rechts)
 * — proven against OrthographicCamera.project in tests/unit/iso-kamera.test.js.
 * @param {{ yaw: number, pitch: number }} winkel degrees
 * @returns {{ vor: {x:number,y:number,z:number}, rechts: {x:number,y:number,z:number}, hoch: {x:number,y:number,z:number} }} unit vectors
 */
export function kameraBasis({ yaw, pitch }) {
  const b = blickHorizontal(yaw);
  const cosP = Math.cos((Number(pitch) || 0) * RAD);
  const sinP = Math.sin((Number(pitch) || 0) * RAD);
  return {
    vor: { x: b.x * cosP, y: -sinP, z: b.z * cosP },
    rechts: { x: Math.cos((Number(yaw) || 0) * RAD), y: 0, z: Math.sin((Number(yaw) || 0) * RAD) },
    hoch: { x: b.x * sinP, y: cosP, z: b.z * sinP },
  };
}

/**
 * Camera position for a target on the ground (y = 0):
 * (ziel.x − vor.x·r, sinP·r, ziel.z − vor.z·r).
 * Check: yaw 45°, pitch 30°, r = 1 → (−0.6124, 0.5, 0.6124); the elevation
 * angle atan2(y, hypot(x, z)) is exactly the pitch for every yaw.
 * @param {{ yaw: number, pitch: number, abstand: number }} kamera degrees / metres
 * @param {{ x: number, z: number }} ziel ground target, metres
 * @returns {{ x: number, y: number, z: number }} metres
 */
export function kameraPosition({ yaw, pitch, abstand }, ziel) {
  const basis = kameraBasis({ yaw, pitch });
  const r = Number(abstand) || 0;
  const sinP = Math.sin((Number(pitch) || 0) * RAD);
  const z = ziel || { x: 0, z: 0 };
  return { x: (Number(z.x) || 0) - basis.vor.x * r, y: sinP * r, z: (Number(z.z) || 0) - basis.vor.z * r };
}

/**
 * Project a world point to screen coordinates (CSS px, origin top-left).
 * sx = B/2 + (p − ziel)·rechts·pxJeM; sy = H/2 − (p − ziel)·hoch·pxJeM.
 * Inverse of bodenpunktUnterCursor for ground points (round-trip in tests).
 * @param {{ x: number, y?: number, z: number }} p world point, metres (y = 0 when omitted)
 * @param {{ yaw: number, pitch: number, ziel: {x:number,z:number}, pxJeM: number, breitePx: number, hoehePx: number }} kamera
 * @returns {{ sx: number, sy: number }} CSS px
 */
export function bildschirmVonWelt(p, kamera) {
  const basis = kameraBasis({ yaw: kamera.yaw, pitch: kamera.pitch });
  const dx = (Number(p?.x) || 0) - kamera.ziel.x;
  const dy = Number(p?.y) || 0; // target always sits on the ground (y = 0)
  const dz = (Number(p?.z) || 0) - kamera.ziel.z;
  const sx = kamera.breitePx / 2 + (dx * basis.rechts.x + dy * basis.rechts.y + dz * basis.rechts.z) * kamera.pxJeM;
  const sy = kamera.hoehePx / 2 - (dx * basis.hoch.x + dy * basis.hoch.y + dz * basis.hoch.z) * kamera.pxJeM;
  return { sx, sy };
}

/**
 * Ground point (y = 0) under a screen pixel. Construction: Q = the point in
 * the image plane THROUGH the target, then along `vor` until y = 0
 * (s = Q.y / sin pitch — every orthographic view ray is parallel to `vor`).
 * pitch = 0 would divide by zero; the convention pins pitch = 30°.
 * @param {number} sx CSS px from canvas left
 * @param {number} sy CSS px from canvas top
 * @param {{ yaw: number, pitch: number, ziel: {x:number,z:number}, pxJeM: number, breitePx: number, hoehePx: number }} kamera
 * @returns {{ x: number, z: number }} ground point, metres
 */
export function bodenpunktUnterCursor(sx, sy, kamera) {
  const basis = kameraBasis({ yaw: kamera.yaw, pitch: kamera.pitch });
  const ox = (sx - kamera.breitePx / 2) / kamera.pxJeM; // metres along rechts
  const oy = (kamera.hoehePx / 2 - sy) / kamera.pxJeM; // metres along hoch
  const qx = kamera.ziel.x + basis.rechts.x * ox + basis.hoch.x * oy;
  const qy = basis.hoch.y * oy; // ziel.y = 0 and rechts.y = 0
  const qz = kamera.ziel.z + basis.rechts.z * ox + basis.hoch.z * oy;
  const s = qy / Math.sin((Number(kamera.pitch) || 0) * RAD);
  return { x: qx + basis.vor.x * s, z: qz + basis.vor.z * s };
}

/**
 * New target so that a ground point G stays under the cursor across a zoom
 * step. Proof in one line: orthographic screen position is linear in
 * (P − Ziel)·pxJeM, so scaling (Ziel − G) by pxJeMAlt/pxJeMNeu keeps
 * (G − ZielNeu)·pxJeMNeu = (G − Ziel)·pxJeMAlt — G does not move.
 * @param {{ x: number, z: number }} ziel old target, metres
 * @param {{ x: number, z: number }} bodenpunkt fixed ground point G, metres
 * @param {number} pxJeMAlt old CSS px per metre
 * @param {number} pxJeMNeu new CSS px per metre
 * @returns {{ x: number, z: number }} new target, metres
 */
export function zoomAufPunkt(ziel, bodenpunkt, pxJeMAlt, pxJeMNeu) {
  const k = pxJeMAlt / pxJeMNeu;
  return {
    x: bodenpunkt.x + (ziel.x - bodenpunkt.x) * k,
    z: bodenpunkt.z + (ziel.z - bodenpunkt.z) * k,
  };
}

/**
 * New target when the VIEW moves by (dx, dy) screen px: content appears to
 * move by (−dx, −dy). Mouse dragging therefore calls this with (−mdx, −mdy)
 * so the grabbed ground point sticks to the cursor.
 * Ziel + rechts·dx/pxJeM − blick·dy/(pxJeM·sin pitch) — the vertical term
 * divides by sin pitch because a screen-vertical shift travels along the
 * ground foreshortened by exactly that factor.
 * @param {{ yaw: number, pitch: number, ziel: {x:number,z:number}, pxJeM: number }} kamera
 * @param {number} dxPx view shift right, CSS px
 * @param {number} dyPx view shift down, CSS px
 * @returns {{ x: number, z: number }} new target, metres
 */
export function verschiebeZiel(kamera, dxPx, dyPx) {
  const b = blickHorizontal(kamera.yaw);
  const sinP = Math.sin((Number(kamera.pitch) || 0) * RAD);
  const rechtsX = Math.cos((Number(kamera.yaw) || 0) * RAD);
  const rechtsZ = Math.sin((Number(kamera.yaw) || 0) * RAD);
  const dxm = dxPx / kamera.pxJeM;
  const dym = dyPx / (kamera.pxJeM * sinP);
  return { x: kamera.ziel.x + rechtsX * dxm - b.x * dym, z: kamera.ziel.z + rechtsZ * dxm - b.z * dym };
}

/**
 * Snap an arbitrary denominator to the nearest ladder level in LOG space
 * (equal ratios count equal: 650 is nearer to 500 (×1.3) than 1000 (×1.54)).
 * @param {number} massstab scale denominator
 * @returns {number} one of ISO_ZOOMSTUFEN
 */
export function zoomEinrasten(massstab) {
  const logM = Math.log(Number(massstab) || ISO_ZOOMSTUFEN[ISO_ZOOMSTUFEN.length - 1]);
  let beste = ISO_ZOOMSTUFEN[0];
  let besterAbstand = Infinity;
  for (const stufe of ISO_ZOOMSTUFEN) {
    const d = Math.abs(Math.log(stufe) - logM);
    if (d < besterAbstand) { besterAbstand = d; beste = stufe; }
  }
  return beste;
}

/**
 * Step one zoom level along the ladder (clamped at both ends, snapped first).
 * @param {number} massstab current denominator
 * @param {number} richtung +1 = finer (smaller denominator), −1 = coarser
 * @returns {number} one of ISO_ZOOMSTUFEN
 */
export function naechsteZoomstufe(massstab, richtung) {
  const i = ISO_ZOOMSTUFEN.indexOf(zoomEinrasten(massstab));
  const j = Math.min(ISO_ZOOMSTUFEN.length - 1, Math.max(0, i + (richtung > 0 ? 1 : -1)));
  return ISO_ZOOMSTUFEN[j];
}

/**
 * Finest ladder level at which the 8 corners of the body's bounding box still
 * fit into breitePx·rand × hoehePx·rand. The box is centred on the target in
 * x/z and rises from the ground plane (y = 0) to hoeheM — the target sits on
 * the ground at the body's centre, half-burying the box would waste pixels.
 * Nothing fits → coarsest level (context beats detail).
 * @param {{ breiteM: number, tiefeM: number, hoeheM: number }} koerper bounding box, metres
 * @param {number} breitePx canvas width, CSS px
 * @param {number} hoehePx canvas height, CSS px
 * @param {{ yaw?: number, pitch?: number, rand?: number }} [opts] degrees / usable fraction of the canvas (0…1)
 * @returns {number} one of ISO_ZOOMSTUFEN
 */
export function einpassenStufe(koerper, breitePx, hoehePx, { yaw = ISO_START_YAW, pitch = ISO_PITCH_GRAD, rand = 0.9 } = {}) {
  const breiteM = Number(koerper?.breiteM) || 0;
  const tiefeM = Number(koerper?.tiefeM) || 0;
  const hoeheM = Number(koerper?.hoeheM) || 0;
  const maxSx = (breitePx * rand) / 2;
  const maxSy = (hoehePx * rand) / 2;
  // fine → coarse: the first level that contains every corner wins.
  for (let i = ISO_ZOOMSTUFEN.length - 1; i >= 0; i -= 1) {
    const stufe = ISO_ZOOMSTUFEN[i];
    const kamera = { yaw, pitch, ziel: { x: 0, z: 0 }, pxJeM: pxJeMeter(stufe), breitePx, hoehePx };
    let passt = true;
    for (const hx of [-breiteM / 2, breiteM / 2]) {
      for (const hz of [-tiefeM / 2, tiefeM / 2]) {
        for (const y of [0, hoeheM]) {
          const s = bildschirmVonWelt({ x: hx, y, z: hz }, kamera);
          if (Math.abs(s.sx - breitePx / 2) > maxSx || Math.abs(s.sy - hoehePx / 2) > maxSy) { passt = false; break; }
        }
        if (!passt) break;
      }
      if (!passt) break;
    }
    if (passt) return stufe;
  }
  return ISO_ZOOMSTUFEN[0];
}

/**
 * Snap a yaw to the nearest 90° detent (45 + 90·round((n − 45)/90)).
 * Ties (exactly between detents) go to the smaller detent because
 * Math.round(−0.5) = −0 — e.g. 0 → 45.
 * @param {number} yawGrad degrees (any real, wrapped)
 * @returns {number} one of ISO_YAWS, in [0, 360)
 */
export function yawEinrasten(yawGrad) {
  return normGrad(45 + 90 * Math.round(((Number(yawGrad) || 0) - 45) / 90));
}

/**
 * Rotate one 90° step from the snapped yaw: Q/E handlers pass −1/+1.
 * @param {number} yawGrad degrees
 * @param {number} schritt +1 clockwise (E), −1 counter-clockwise (Q)
 * @returns {number} one of ISO_YAWS, in [0, 360)
 */
export function yawDrehen(yawGrad, schritt) {
  return normGrad(yawEinrasten(yawGrad) + 90 * (schritt > 0 ? 1 : -1));
}

/**
 * Interpolate between two yaws over the SHORTER arc (315 → 45 passes 0, not
 * 180). t is clamped to [0, 1]; the caller applies the easing.
 * @param {number} aGrad start yaw, degrees
 * @param {number} bGrad end yaw, degrees
 * @param {number} t 0…1
 * @returns {number} degrees, in [0, 360)
 */
export function yawInterpol(aGrad, bGrad, t) {
  let d = normGrad(bGrad - aGrad); // 0…360
  if (d > 180) d -= 360; // shorter arc, (−180, 180]
  return normGrad(aGrad + d * klemme01(Number(t) || 0));
}

/**
 * Tween progress with smoothstep easing x²(3 − 2x) [ASSUMED easing — no
 * design spec; smoothstep has zero derivative at both ends, so starts and
 * stops read as "soft" (Blatt 08)].
 * @param {number} vergangenMs elapsed time, ms
 * @param {number} dauerMs total duration, ms; ≤ 0 → 1 (instant, reduced motion)
 * @returns {number} 0…1
 */
export function tweenFortschritt(vergangenMs, dauerMs) {
  if (!(dauerMs > 0)) return 1;
  const x = klemme01(vergangenMs / dauerMs);
  return x * x * (3 - 2 * x);
}

/**
 * Tween duration honouring prefers-reduced-motion: reduced → 0 (jump).
 * @param {boolean} reduziert true when the OS asks for reduced motion
 * @returns {number} ms
 */
export function tweenDauer(reduziert) {
  return reduziert ? 0 : TWEEN_MS;
}

/**
 * Screen angle (degrees, clockwise from screen-up, in (−180, 180]) at which
 * GEOGRAPHIC north points, for the small 3D north arrow. Ground direction of
 * geographic north in PLAN axes = blickHorizontal(−nordwinkel) (plan azimuth
 * = geographic − north angle); the angle is atan2(right component, up
 * component) of that direction in the camera basis. Check values:
 * (0, 30, 0) = 0 · (90, 30, 0) = −90 · (45, 30, 0) = −63.43 (pitch
 * foreshortening!) · (0, 30, 90) = −90.
 * @param {number} yawGrad camera yaw, degrees
 * @param {number} pitchGrad camera pitch, degrees
 * @param {number} [nordwinkel] geographic azimuth of plan-up, degrees
 * @returns {number} degrees, clockwise from screen-up
 */
export function nordpfeilWinkel(yawGrad, pitchGrad, nordwinkel = 0) {
  const n = blickHorizontal(-(Number(nordwinkel) || 0));
  const basis = kameraBasis({ yaw: yawGrad, pitch: pitchGrad });
  const r = n.x * basis.rechts.x + n.z * basis.rechts.z;
  const h = n.x * basis.hoch.x + n.z * basis.hoch.z;
  let w = Math.atan2(r, h) / RAD;
  w = normGrad(w + 180) - 180; // [−180, 180)
  if (w === -180) w = 180; // spec range is (−180, 180]
  return w;
}

/**
 * Edge-scroll direction for a pointer position: −1/0/+1 per axis when the
 * pointer sits inside the band of that canvas edge (both axes may fire in a
 * corner).
 * @param {number} x pointer CSS px from canvas left
 * @param {number} y pointer CSS px from canvas top
 * @param {number} breitePx canvas width, CSS px
 * @param {number} hoehePx canvas height, CSS px
 * @param {number} [band] band width, CSS px (RAND_SCROLL_PX)
 * @returns {{ dx: number, dy: number }} each in {−1, 0, 1}
 */
export function randScrollRichtung(x, y, breitePx, hoehePx, band = RAND_SCROLL_PX) {
  const dx = x < band ? -1 : x > breitePx - band ? 1 : 0;
  const dy = y < band ? -1 : y > hoehePx - band ? 1 : 0;
  return { dx, dy };
}

/**
 * Viewport zoom at which 1 m measures exactly pxJeMeter(massstab) screen px
 * (75-09 — BimPlan2D fixed-scale mode; ONE scale convention with the iso
 * camera: 1:50 = pxJeMeter(50) ≈ 75.59 CSS px/m, NOT 40 px/m of the Blatt-07
 * sketch — orchestrator decision 23.09.).
 * Derivation: 1 m = scaleUJeM viewBox units; 1 viewBox unit = s0 · zoom CSS px
 * ⇒ 1 m = scaleUJeM · s0 · zoom px. Setting that equal to pxJeMeter(massstab)
 * gives zoom = pxJeMeter(massstab) / (scaleUJeM · s0).
 * Hand check: planZoomFuerMassstab(50, 12.86, 1.3889) = 75.5906/17.8613 = 4.232.
 * Invalid input (non-finite / ≤ 0) → zoom 1 (no scale mode).
 * @param {number} massstab scale denominator (unitless, e.g. 50 for 1:50)
 * @param {number} scaleUJeM viewBox units per metre (= BimPlan2D SCALE)
 * @param {number} s0 CSS px per viewBox unit at zoom 1 (bildPxJeEinheit(1, …))
 * @returns {number} viewport zoom
 */
export function planZoomFuerMassstab(massstab, scaleUJeM, s0) {
  const n = Number(massstab), u = Number(scaleUJeM), p = Number(s0);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (!Number.isFinite(u) || u <= 0) return 1;
  if (!Number.isFinite(p) || p <= 0) return 1;
  return pxJeMeter(n) / (u * p);
}

/**
 * Pure mapping from the shared building model to MassingView3D's site frame
 * (75-09 Task 3 — the iso of ONE dwelling unit inside the whole building).
 * Shifts model metres {x, z} so the footprint bbox sits with `rand` metres of
 * margin in the site coordinate system of MassingView3D ({x, y}, y = depth);
 * zone points get the SAME shift, so round-trip holds:
 *   toX3d(polyPoint, siteW) = footprint-x − bboxCentre-x
 *   toZ3d(polyPoint, siteD) = footprint-z − bboxCentre-z
 * (the scene is centred on the building — MassingView3D.jsx:48-49).
 * Hand check (plan <behavior>): footprint 30 × 20 m at (−15…15, −10…10),
 * zone 5 × 4 m at (−15…−10, −10…−6), storeys 4 × 3 m, rand 4 ⇒
 * siteW 38, siteD 28, height 12, poly[0] = zone point (−15,−10) → {x:4, y:4}.
 * [ASSUMED] rand = 4 m margin (readability, no design spec).
 * @param {Array<{x:number,z:number}>} footprint model footprint in metres
 * @param {Array<{points:Array<{x:number,z:number}>, level?:number, raumart?:string}>} zonen zones of the focused unit (metres, model frame); raumart "balkon" is drawn as a flat slab (75-13)
 * @param {{storeys?:number, storeyHeight?:number, rand?:number}} [opt] storeys (count), storeyHeight (m), rand (m margin)
 * @returns {{poly:Array<{x:number,y:number}>, siteW:number, siteD:number, height:number,
 *   fokusZonen:Array<{points:Array<{x:number,y:number}>, level:number, raumart?:string}>}|null} null on invalid input
 */
export function isoSzeneAusModell(footprint, zonen, { storeys = 1, storeyHeight = 3, rand = 4 } = {}) {
  const fp = Array.isArray(footprint) ? footprint.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z)) : [];
  if (fp.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of fp) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  if (!(maxX > minX) || !(maxZ > minZ)) return null; // degenerate footprint
  const r = Number.isFinite(rand) && rand >= 0 ? rand : 0;
  const nGeschosse = Math.max(1, Math.round(Number(storeys) || 1));
  const hGeschoss = Number.isFinite(storeyHeight) && storeyHeight > 0 ? storeyHeight : 3;
  // Same shift for footprint and zones: bbox minimum → (rand, rand).
  const dx = r - minX, dy = r - minZ;
  const poly = fp.map((p) => ({ x: p.x + dx, y: p.z + dy }));
  const fokusZonen = (Array.isArray(zonen) ? zonen : [])
    .map((z) => {
      const pts = Array.isArray(z?.points) ? z.points : [];
      return {
        points: pts
          .filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z))
          .map((p) => ({ x: p.x + dx, y: p.z + dy })),
        level: Number.isFinite(z?.level) ? z.level : 0,
        // 75-13: passed through so the iso can draw a balcony as a flat slab.
        ...(z?.raumart ? { raumart: z.raumart } : {}),
      };
    })
    .filter((z) => z.points.length >= 3);
  return {
    poly,
    siteW: (maxX - minX) + 2 * r,
    siteD: (maxZ - minZ) + 2 * r,
    height: nGeschosse * hGeschoss,
    fokusZonen,
  };
}
