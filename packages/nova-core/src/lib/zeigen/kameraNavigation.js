// Camera navigation of the 3D viewers — the calculation only (quick task 261110-mzj).
//
// The mouse works where the pointer is, not at the project centre: orbit about the element under the pointer, pan so the
// grabbed point stays under the pointer, zoom towards the point under the pointer, and a walk mode (W A S D) to get into
// the building. This module holds every formula and every tuning value of that; kameraSteuerung.js wires it to a
// camera and a canvas.
//
// Conventions: right-handed world, +Y up, lengths in metres, angles in radians unless a name says "Grad", screen
// distances in CSS pixels (x to the right, y DOWN). Vectors are plain arrays [x, y, z].
//
// In:  plain numbers and arrays. Out: plain numbers and arrays. No three, no DOM, no state — testable as is.

/** @typedef {[number, number, number]} Vek3 */

/** Orbit speed: 1 = dragging the full viewport height turns 360°. 0.5 = half the height is a quarter turn. */
export const DREH_TEMPO = 0.5;
/** Wheel step per notch as a share of the distance to the point under the pointer (2.3 %; small on purpose, trackpads
 *  send many small events). */
export const ZOOM_SCHRITT = 0.023;
/** The wheel stops this far in front of the element, m — it never goes through a wall (the walk mode does). */
export const ZOOM_STOPP_M = 0.5;
/** A pointer ray counts as hitting the horizontal plane only up to this distance, m. [ASSUMED] beyond it (near the
 *  horizon) the pivot would be so far away that orbit and pan feel like a jump. */
export const EBENE_MAX_M = 1000;
/** Walk speed levels, m/s. 1.4 m/s is walking pace. */
export const LAUF_STUFEN = Object.freeze([0.5, 1.4, 3, 6, 12]);
/** Index of the level a session starts with (1.4 m/s). */
export const LAUF_STUFE_VORGABE = 1;
/** Factor while Shift is held. */
export const LAUF_SCHNELL_FAKTOR = 3;
/** Look-around in walk mode, rad per pixel of mouse travel. [ASSUMED] 0.0025 ≈ 0.14°/px, a common first-person value. */
export const UMSEHEN_RAD_JE_PX = 0.0025;
/** The view never tilts closer than this to straight up / straight down, rad (keeps "up" defined). */
export const POL_ABSTAND_RAD = 0.01;
/** One wheel notch in the three delta modes of a WheelEvent: pixels, lines, pages. [ASSUMED] 100 px and 3 lines are the
 *  values Chrome and Firefox send for one notch of a common mouse. */
export const RASTE = Object.freeze({ px: 100, zeilen: 3, seiten: 1 });

/** Key codes (KeyboardEvent.code, layout independent) of the walk mode and what they do. */
export const LAUF_TASTEN = Object.freeze({
  KeyW: "vor", ArrowUp: "vor", KeyS: "zurueck", ArrowDown: "zurueck",
  KeyA: "links", ArrowLeft: "links", KeyD: "rechts", ArrowRight: "rechts",
  Space: "hoch", KeyE: "hoch", KeyC: "runter", KeyQ: "runter",
  ShiftLeft: "schnell", ShiftRight: "schnell",
});

const plus = (/** @type {Vek3} */ a, /** @type {Vek3} */ b) => /** @type {Vek3} */ ([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
const minus = (/** @type {Vek3} */ a, /** @type {Vek3} */ b) => /** @type {Vek3} */ ([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
const mal = (/** @type {Vek3} */ a, /** @type {number} */ f) => /** @type {Vek3} */ ([a[0] * f, a[1] * f, a[2] * f]);
const punktProdukt = (/** @type {Vek3} */ a, /** @type {Vek3} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kreuz = (/** @type {Vek3} */ a, /** @type {Vek3} */ b) => /** @type {Vek3} */ ([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
const laenge = (/** @type {Vek3} */ a) => Math.hypot(a[0], a[1], a[2]);
const einheit = (/** @type {Vek3} */ a) => { const l = laenge(a); return l > 1e-12 ? mal(a, 1 / l) : /** @type {Vek3} */ ([0, 0, 0]); };
const grenze = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

/** Rotates `p` about the axis through `mitte` with unit direction `achse` by `winkel` rad (Rodrigues, right-hand rule). */
function umAchse(/** @type {Vek3} */ p, /** @type {Vek3} */ mitte, /** @type {Vek3} */ achse, /** @type {number} */ winkel) {
  const v = minus(p, mitte), c = Math.cos(winkel), s = Math.sin(winkel);
  const gedreht = plus(plus(mal(v, c), mal(kreuz(achse, v), s)), mal(achse, punktProdukt(achse, v) * (1 - c)));
  return plus(mitte, gedreht);
}

/**
 * What a mouse button does when a drag starts.
 * Left = orbit, with Shift/Cmd/Ctrl = pan; middle = pan, with Shift = orbit (as in Archicad); right = pan.
 * @param {{button: number, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean}} e pointer-down event
 * @returns {"drehen"|"schieben"|null} null for any other button
 */
export function mausGriff(e) {
  if (e.button === 0) return e.shiftKey || e.ctrlKey || e.metaKey ? "schieben" : "drehen";
  if (e.button === 1) return e.shiftKey ? "drehen" : "schieben";
  if (e.button === 2) return "schieben";
  return null;
}

/**
 * The three axes of a camera that stands at `position` and looks at `ziel` with +Y as up.
 * @param {Vek3} position camera position, m
 * @param {Vek3} ziel point the camera looks at, m
 * @returns {{vor: Vek3, rechts: Vek3, oben: Vek3}} unit vectors; looking straight up or down, `rechts` falls back to +X
 */
export function kameraAchsen(position, ziel) {
  const vor = einheit(minus(ziel, position));
  let rechts = einheit(kreuz(vor, [0, 1, 0]));
  if (laenge(rechts) === 0) rechts = [1, 0, 0];
  return { vor, rechts, oben: einheit(kreuz(rechts, vor)) };
}

/**
 * Direction of the ray through a point of the picture of a perspective camera.
 * @param {{position: Vek3, ziel: Vek3, fovGrad: number, seiten: number, ndcX: number, ndcY: number}} a
 *   fovGrad: vertical field of view, degrees; seiten: width / height; ndcX, ndcY: −1…1, x right, y UP (0, 0 = centre)
 * @returns {Vek3} unit direction, world
 */
export function zeigerStrahl({ position, ziel, fovGrad, seiten, ndcX, ndcY }) {
  const { vor, rechts, oben } = kameraAchsen(position, ziel);
  const halb = Math.tan((fovGrad * Math.PI) / 360); // half picture height at distance 1 m, m
  return einheit(plus(vor, plus(mal(rechts, ndcX * halb * seiten), mal(oben, ndcY * halb))));
}

/**
 * Where a ray meets the horizontal plane y = hoehe.
 * @param {Vek3} ursprung ray origin, m
 * @param {Vek3} richtung unit direction
 * @param {number} hoehe height of the plane, m
 * @param {number} [maxAbstand] furthest hit that counts, m
 * @returns {Vek3|null} null when the ray is parallel, points away from the plane or meets it beyond maxAbstand
 */
export function strahlAufEbene(ursprung, richtung, hoehe, maxAbstand = EBENE_MAX_M) {
  if (Math.abs(richtung[1]) < 1e-9) return null;
  const s = (hoehe - ursprung[1]) / richtung[1];
  if (!(s > 0) || s > maxAbstand) return null;
  return plus(ursprung, mal(richtung, s));
}

/**
 * The point a drag or a wheel step is anchored to.
 * 1. the element under the pointer; 2. else the point under the pointer on a horizontal plane at the height of the
 * element grabbed last; 3. else (ray misses that plane, e.g. into the sky) a point on the ray at `ersatzAbstand`.
 * @param {{treffer: Vek3|null, ursprung: Vek3, richtung: Vek3, hoehe: number, ersatzAbstand: number}} a
 *   treffer: hit on the model, m, or null; ursprung/richtung: pointer ray; hoehe: remembered plane height, m;
 *   ersatzAbstand: distance for case 3, m (the caller passes the distance to the orbit target)
 * @returns {{punkt: Vek3, hoehe: number, art: "bauteil"|"ebene"|"ersatz"}} hoehe = the height to remember for the next
 *   grab (changes only on an element hit)
 */
export function ankerPunkt({ treffer, ursprung, richtung, hoehe, ersatzAbstand }) {
  if (treffer) return { punkt: [treffer[0], treffer[1], treffer[2]], hoehe: treffer[1], art: "bauteil" };
  const aufEbene = strahlAufEbene(ursprung, richtung, hoehe);
  if (aufEbene) return { punkt: aufEbene, hoehe, art: "ebene" };
  return { punkt: plus(ursprung, mal(richtung, Math.max(ersatzAbstand, ZOOM_STOPP_M))), hoehe, art: "ersatz" };
}

/**
 * Orbit angles of a mouse movement. The full viewport height is 2π · tempo.
 * @param {number} dxPx movement to the right, px
 * @param {number} dyPx movement DOWN, px
 * @param {number} hoehePx viewport height, px
 * @param {number} [tempo] orbit speed (DREH_TEMPO)
 * @returns {{gier: number, nick: number}} rad; gier = about the vertical axis, nick = tilt
 */
export function drehWinkel(dxPx, dyPx, hoehePx, tempo = DREH_TEMPO) {
  const k = hoehePx > 0 ? (2 * Math.PI * tempo) / hoehePx : 0;
  return { gier: dxPx * k, nick: dyPx * k };
}

/**
 * Turns the camera about a pivot: position and look-at target both rotate about `punkt`, so the pivot keeps its place
 * in the picture. Dragging right turns the model with the hand, dragging down lifts the camera (same directions as
 * three's OrbitControls). The tilt stops POL_ABSTAND_RAD short of straight up / straight down.
 * @param {{position: Vek3, ziel: Vek3, punkt: Vek3, gier: number, nick: number}} a angles from drehWinkel(), rad
 * @returns {{position: Vek3, ziel: Vek3}} new camera position and look-at target, m
 */
export function umPunktDrehen({ position, ziel, punkt, gier, nick }) {
  const hoch = /** @type {Vek3} */ ([0, 1, 0]);
  let p = umAchse(position, punkt, hoch, -gier);
  let z = umAchse(ziel, punkt, hoch, -gier);
  // polar angle of the camera seen from its target: 0 = camera straight above, π = straight below
  const ab = minus(p, z);
  const r = laenge(ab);
  const flach = /** @type {Vek3} */ ([ab[0], 0, ab[2]]);
  if (r > 1e-9 && laenge(flach) > 1e-9) {
    const polar = Math.acos(grenze(ab[1] / r, -1, 1));
    const neu = grenze(polar - nick, POL_ABSTAND_RAD, Math.PI - POL_ABSTAND_RAD);
    const achse = einheit(kreuz(hoch, flach)); // turning about it by +w increases the polar angle by w
    p = umAchse(p, punkt, achse, neu - polar);
    z = umAchse(z, punkt, achse, neu - polar);
  }
  return { position: p, ziel: z };
}

/**
 * Camera shift of a pan that keeps the grabbed point under the pointer. Exact for a perspective camera: a point at
 * depth `tiefe` moves by one pixel when the camera moves 2 · tiefe · tan(fov / 2) / hoehePx metres in the picture plane.
 * @param {{dxPx: number, dyPx: number, tiefe: number, fovGrad: number, hoehePx: number, rechts: Vek3, oben: Vek3}} a
 *   dxPx/dyPx: pointer movement, px (y down); tiefe: distance of the grabbed point along the view direction, m;
 *   fovGrad: vertical field of view, degrees; hoehePx: viewport height, px; rechts/oben: camera axes (kameraAchsen)
 * @returns {Vek3} shift for camera position AND look-at target, m
 */
export function schiebeVersatz({ dxPx, dyPx, tiefe, fovGrad, hoehePx, rechts, oben }) {
  if (!(hoehePx > 0) || !(tiefe > 0)) return [0, 0, 0];
  const mJePx = (2 * tiefe * Math.tan((fovGrad * Math.PI) / 360)) / hoehePx;
  return plus(mal(rechts, -dxPx * mJePx), mal(oben, dyPx * mJePx));
}

/**
 * Wheel notches of a wheel event, signed: positive = towards the model.
 * @param {number} deltaY WheelEvent.deltaY (positive = wheel towards the person = away from the model)
 * @param {number} [deltaMode] WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages
 * @returns {number} −1…1; one event never counts more than one notch (fast wheels and inertia stay calm)
 */
export function radRasten(deltaY, deltaMode = 0) {
  const jeRaste = deltaMode === 1 ? RASTE.zeilen : deltaMode === 2 ? RASTE.seiten : RASTE.px;
  return grenze(-deltaY / jeRaste, -1, 1);
}

/**
 * Camera shift of a wheel step towards (or away from) the point under the pointer.
 * Each notch changes the distance by `schritt` (2.3 %): far away the steps are large, close to the element small.
 * Towards the element the camera stops `stopp` metres in front of it.
 * @param {{position: Vek3, punkt: Vek3, rasten: number, schritt?: number, stopp?: number}} a
 *   rasten: from radRasten(), positive = closer
 * @returns {Vek3} shift for camera position AND look-at target, m ([0, 0, 0] at the stop)
 */
export function zoomSchritt({ position, punkt, rasten, schritt = ZOOM_SCHRITT, stopp = ZOOM_STOPP_M }) {
  const weg = minus(punkt, position);
  const abstand = laenge(weg);
  if (abstand < 1e-9 || !rasten) return [0, 0, 0];
  const faktor = Math.pow(1 - schritt, rasten); // < 1 closer, > 1 away
  let neu = abstand * faktor;
  if (rasten > 0) {
    if (abstand <= stopp) return [0, 0, 0]; // at or inside the stop: the wheel does not go closer
    neu = Math.max(stopp, neu);
  }
  return mal(weg, (abstand - neu) / abstand);
}

// ---- parallel projection (axonometry) -------------------------------------------------------------------------------------
// A parallel view has no vanishing point: the picture shows a box of fixed height, however far the camera stands. To keep
// ONE camera state for both kinds (position + look-at target), the picture height is tied to the distance camera → target:
// it is what a perspective camera with `fovGrad` shows at the target. Switching between perspective and parallel therefore
// keeps the element at the target the same size, and "zoom" in a parallel view is a change of that distance.

/**
 * Picture height of a parallel view, m.
 * @param {number} abstand distance camera → look-at target, m
 * @param {number} fovGrad vertical field of view of the matching perspective camera, degrees
 * @returns {number} height of the shown box, m (0 for a distance that is not positive)
 */
export function parallelHoehe(abstand, fovGrad) {
  return abstand > 0 ? 2 * abstand * Math.tan((fovGrad * Math.PI) / 360) : 0;
}

/**
 * Ray through a point of the picture of a parallel view: every ray runs along the view direction, the ORIGIN moves.
 * @param {{position: Vek3, ziel: Vek3, fovGrad: number, seiten: number, ndcX: number, ndcY: number}} a
 *   as zeigerStrahl; the picture height follows parallelHoehe(|ziel − position|, fovGrad)
 * @returns {{ursprung: Vek3, richtung: Vek3}} origin in the plane through the camera position (m) and unit direction
 */
export function zeigerStrahlParallel({ position, ziel, fovGrad, seiten, ndcX, ndcY }) {
  const { vor, rechts, oben } = kameraAchsen(position, ziel);
  const halb = parallelHoehe(laenge(minus(ziel, position)), fovGrad) / 2; // half picture height, m
  return { ursprung: plus(position, plus(mal(rechts, ndcX * halb * seiten), mal(oben, ndcY * halb))), richtung: vor };
}

/**
 * Wheel step of a parallel view: the picture gets smaller or larger by `schritt` per notch and the point under the
 * pointer stays under the pointer. The view direction does not change.
 * Hand check: target 10 m in front, point 2 m right of the target, one notch closer (factor 0.977): the distance becomes
 * 9.77 m and the target moves 2 · 0.023 = 0.046 m to the right — the point is then 1.954 m right of the centre of a
 * picture that is 0.977 times as large, the same share as before.
 * @param {{position: Vek3, ziel: Vek3, punkt: Vek3, rasten: number, schritt?: number, stopp?: number}} a
 *   punkt: the point under the pointer, m; rasten: from radRasten(), positive = closer;
 *   stopp: smallest distance camera → target, m (picture height parallelHoehe(stopp, fov))
 * @returns {{position: Vek3, ziel: Vek3}} new camera position and look-at target, m (unchanged at the stop)
 */
export function zoomParallel({ position, ziel, punkt, rasten, schritt = ZOOM_SCHRITT, stopp = ZOOM_STOPP_M }) {
  const abstand = laenge(minus(ziel, position));
  if (abstand < 1e-9 || !rasten) return { position, ziel };
  let neu = abstand * Math.pow(1 - schritt, rasten);
  if (rasten > 0) {
    if (abstand <= stopp) return { position, ziel };
    neu = Math.max(stopp, neu);
  }
  const f = neu / abstand; // < 1 closer, > 1 away
  const { vor } = kameraAchsen(position, ziel);
  const q = minus(punkt, ziel);
  const quer = minus(q, mal(vor, punktProdukt(q, vor))); // offset of the point from the picture centre, in the picture plane, m
  const neuesZiel = plus(ziel, mal(quer, 1 - f));
  return { position: minus(neuesZiel, mal(vor, neu)), ziel: neuesZiel };
}

/**
 * Yaw and pitch of a view direction (walk mode keeps the view as two angles).
 * @param {Vek3} vor view direction (any length > 0)
 * @returns {{gier: number, nick: number}} rad; gier 0 = looking along −Z, positive = turned left; nick positive = up
 */
export function blickWinkel(vor) {
  const v = einheit(vor);
  return { gier: Math.atan2(-v[0], -v[2]), nick: Math.asin(grenze(v[1], -1, 1)) };
}

/**
 * View direction of yaw and pitch (inverse of blickWinkel).
 * @param {number} gier rad
 * @param {number} nick rad
 * @returns {Vek3} unit vector
 */
export function blickRichtung(gier, nick) {
  const c = Math.cos(nick);
  return [-Math.sin(gier) * c, Math.sin(nick), -Math.cos(gier) * c];
}

/**
 * Look-around of the walk mode: the view follows the mouse.
 * @param {number} gier rad
 * @param {number} nick rad
 * @param {number} dxPx mouse travel to the right, px
 * @param {number} dyPx mouse travel DOWN, px
 * @returns {{gier: number, nick: number}} rad; the pitch stops POL_ABSTAND_RAD short of straight up / down
 */
export function umsehen(gier, nick, dxPx, dyPx) {
  const max = Math.PI / 2 - POL_ABSTAND_RAD;
  return { gier: gier - dxPx * UMSEHEN_RAD_JE_PX, nick: grenze(nick - dyPx * UMSEHEN_RAD_JE_PX, -max, max) };
}

/**
 * What the keys held right now ask for.
 * @param {Iterable<string>} codes KeyboardEvent.code of every key that is down
 * @returns {{vor: number, seit: number, hoch: number, schnell: boolean}} −1, 0 or 1 per axis (opposite keys cancel)
 */
export function laufEingabe(codes) {
  const an = new Set();
  for (const c of codes) { const w = /** @type {Record<string, string>} */ (LAUF_TASTEN)[c]; if (w) an.add(w); }
  const achse = (/** @type {string} */ p, /** @type {string} */ m) => (an.has(p) ? 1 : 0) - (an.has(m) ? 1 : 0);
  return { vor: achse("vor", "zurueck"), seit: achse("rechts", "links"), hoch: achse("hoch", "runter"), schnell: an.has("schnell") };
}

/**
 * Camera shift of one frame of the walk mode. Forward/back goes along the view direction (looking down goes down),
 * left/right is always horizontal, up/down is vertical. Several keys together do not add up to more than the speed.
 * No collision: walls do not stop the camera.
 * @param {{vor: number, seit: number, hoch: number, blick: Vek3, tempo: number, schnell?: boolean, dt: number}} a
 *   vor/seit/hoch: −1…1 from laufEingabe(); blick: unit view direction; tempo: m/s; dt: frame time, s
 * @returns {Vek3} shift, m
 */
export function laufSchritt({ vor, seit, hoch, blick, tempo, schnell = false, dt }) {
  let rechts = einheit([-blick[2], 0, blick[0]]); // blick × up, flattened
  if (laenge(rechts) === 0) rechts = [1, 0, 0];
  const summe = plus(plus(mal(blick, vor), mal(rechts, seit)), [0, hoch, 0]);
  return mal(einheit(summe), tempo * (schnell ? LAUF_SCHNELL_FAKTOR : 1) * dt);
}

/**
 * Next speed level.
 * @param {number} stufe current index into LAUF_STUFEN
 * @param {number} richtung positive = faster, negative = slower
 * @returns {number} index, kept inside the list
 */
export function laufStufeSchalten(stufe, richtung) {
  return grenze(Math.round(stufe) + Math.sign(richtung), 0, LAUF_STUFEN.length - 1);
}

/**
 * Whether the focus is in a field a person types into — then the walk keys do nothing in the model.
 * @param {{tagName?: string, isContentEditable?: boolean}|null|undefined} el document.activeElement
 * @returns {boolean}
 */
export function eingabeFokus(el) {
  if (!el) return false;
  const tag = String(el.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}
