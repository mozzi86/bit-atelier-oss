// 106-08: the loaded model in a VR headset (WebXR, through three's own WebXRManager - no new dependency). Loaded only when the person
// presses "In VR ansehen" (dynamic import from XrKnopf.jsx), so the page chunks stay as small as before.
//
// What it does:
// - Session: requestSession("immersive-vr"), reference space "local-floor" (fallback "local" with an assumed eye height), the render loop
//   moves to renderer.setAnimationLoop and works only with an XRFrame (the viewers skip their own loop while presenting); at a scale
//   other than 1:1 frustum culling is off (three's union camera is wrong in a scaled rig). The camera goes into a rig group ("dolly");
//   moving or scaling the rig moves or scales the PERSON, never the model: the model, its highlight ranges, its section planes and the
//   GUID resolvers of the viewers stay exactly as on the desktop.
// - Scale: "1:1" (the person stands 3 m in front of the model on the floor of its lowest point) or "tisch" (table model: the largest
//   horizontal extent appears 1 m wide on a table 0.9 m high, 0.9 m in front). Moving: thumbstick forward/back = glide along the ray,
//   left/right = turn in 30° steps, thumbstick press = teleport to the floor point the ray shows (1:1 only).
// - Ray: the controller pose gives a ray (controllerStrahl) that goes into the SAME pick core as the mouse (strahlPick of 106-01) and
//   the viewer's own resolver; hover and selection light up exactly as on the desktop (the viewer's 'fokus' / its selection). The laser
//   is visible: solid to a hit, dashed into the void. Hand tracking: a hand gives the same target ray, a pinch is the trigger.
// - Speech: hold the grip = hold the speech button of 106-05 (the SprechFeld of the viewer, through its handle); what was heard and the
//   proposal of 106-03 appear on a floating panel (xrTafel.js). A change runs only after the person presses "Übernehmen" (ray on the
//   panel button + trigger, or face button A) - the command `bestaetigen` with durch "hand", the same road and the same rights check
//   (106-07 darfAendern) as the button on the screen. No new channel, no new server route: XR never gives more rights.
// - No gaze control (D-IM-06): input sources with targetRayMode "gaze" (and "screen") are ignored.
//
// Not accepted on a device (D-IM-03 / D-AW-04): everything here is proved with a stand-in session (unit test and the browser test's
// WebXR stand-in), not with a real headset.
//
// In:  renderer (three WebGLRenderer), scene, camera, navigator.xr, the viewer's XrQuelle (pick + hover + select), the speech handle,
//      the command register, darfAendern, t. Out: rig maths (rigFuerModus, rigGleiten, rigDrehen, rigTeleport, rigMatrix, userZuWelt),
//      controllerStrahl, tastenAus, flanken, teleportZiel, xrSteuerung (per-frame logic, pure), xrSitzung (the session).

import * as THREE from "three";
import { strahlPick, pickDrossel } from "@core/lib/zeigen/strahlPick.js";
import { ZEIGE_ZUSTAENDE } from "@core/lib/zeigen/zustaende.js";
import { TAFEL_FARBEN, TAFEL_M, TAFEL_PX, tafelInhalt, tafelKnopfBei, tafelLayout, tafelZeichnen } from "@core/lib/zeigen/xrTafel.js";
import { xrStartFehlerText } from "@core/lib/zeigen/xrVerfuegbar.js";
import { abgleichStand } from "@core/lib/abgleich/abgleichStand.js";

/** Largest horizontal extent of the table model, m (user metres) [ASSUMED: fits on a table, readable at arm's length]. */
export const TISCH_GROESSE_M = 1.0;
/** Height of the table top, m [ASSUMED: usual table / standing desk ~0.9 m]. */
export const TISCH_HOEHE_M = 0.9;
/** Distance from the person to the centre of the table model, m [ASSUMED]. */
export const TISCH_ABSTAND_M = 0.9;
/** At 1:1 the person starts this far in front of the model's front edge, m [ASSUMED: the whole facade in view, not inside a wall]. */
export const ABSTAND_1_1_M = 3;
/** Glide speed, m/s (user metres; at the table scale the world moves faster by the scale) [ASSUMED: brisk walk, comfortable in VR]. */
export const GLEIT_M_S = 1.5;
/** Snap turn step, rad (30°) [ASSUMED: common comfort setting]. */
export const DREH_SCHRITT_RAD = Math.PI / 6;
/** Thumbstick deflection that triggers a turn step (0..1) [ASSUMED]. */
export const STICK_SCHWELLE = 0.6;
/** Below this deflection the turn re-arms and gliding stops (dead zone) [ASSUMED]. */
export const STICK_RUHE = 0.25;
/** Longest teleport, m (user metres) [ASSUMED: farther targets are hard to aim at]. */
export const TELEPORT_MAX_M = 30;
/** Length of the dashed laser into the void, m (user metres) [ASSUMED]. */
export const LASER_LEER_M = 5;
/** Eye height when the device offers only the "local" reference space (origin at the head), m [ASSUMED: average standing eye height]. */
export const AUGENHOEHE_LOCAL_M = 1.6;
/** Where the panel floats, user space m: left of the view, a little below the eyes, at arm's length [ASSUMED]. */
export const TAFEL_ORT_M = Object.freeze({ x: -0.32, y: 1.25, z: -0.75 });
/** Where the panel floats at the table scale, user space m: as at 1:1 but higher, above the usual top of the table model (a 30 m wide,
 *  10 m high building ends at 0.9 + 0.33 m; the tilted panel's lower edge is at ~1.27 m), about 9° below the eyes. It is drawn over
 *  the model in any case (no depth test), so a tall model is covered, never the panel. Review 106-08: a place left BESIDE the 1 m table model (x < -0.5 m) was tried and dropped -
 *  it lies ~60° to the left, outside the headset's field of view [ASSUMED: to be checked on the device]. */
export const TAFEL_ORT_TISCH_M = Object.freeze({ x: -0.32, y: 1.48, z: -0.75 });
/** Turn of the panel about the vertical axis, rad: towards the person (1:1 / table) [ASSUMED]. */
const TAFEL_DREHUNG_RAD = Object.freeze({ "1:1": 0.35, tisch: 0.35 });
/** A world normal with a y part above this counts as floor for a teleport (about 45°) [ASSUMED]. */
const BODEN_NORMAL_Y = 0.7;
/** A ray counts as unmoved when its direction turned less than this, rad (~0.1°) [ASSUMED: below what a hand holds still]. */
const STRAHL_RUHE_RAD = 0.002;
/** ... and its origin moved less than this, user m (scaled with the rig) [ASSUMED: 2 mm]. */
const STRAHL_RUHE_M = 0.002;
/** An unmoved ray picks again at the latest after this many frames (a section plane or a reload may change the model) [ASSUMED: ~1/6 s at 72-90 Hz]. */
const PICK_MAX_ALTER = 12;

/**
 * 106-09 review: what the panel says about the sync between devices (plain data from abgleichStand; the decision itself is
 * made at the screen). @returns {{konflikte: number, titel: string|null, hinweis: string|null, getrennt: boolean}|null}
 */
export function abgleichFuerTafel() {
  const s = abgleichStand.stand();
  const h = s.hinweise[0];
  const a = { konflikte: s.konflikte.length, titel: s.konflikte[0]?.titel ?? null, hinweis: h?.zeilen?.[0]?.text ?? null, getrennt: s.verbindung.status === "getrennt" };
  return a.konflikte || a.hinweis || a.getrennt ? a : null;
}

/**
 * Did a ray stay where it was (direction and origin within the rest tolerances)?
 * @param {{ursprung: readonly number[], richtung: readonly number[]}} a @param {{ursprung: readonly number[], richtung: readonly number[]}} b  World, m.
 * @param {number} massstab  World m per user m (the origin tolerance grows with the table scale).
 * @returns {boolean}
 */
function strahlGleich(a, b, massstab) {
  const d = Math.hypot(a.ursprung[0] - b.ursprung[0], a.ursprung[1] - b.ursprung[1], a.ursprung[2] - b.ursprung[2]);
  const dot = a.richtung[0] * b.richtung[0] + a.richtung[1] * b.richtung[1] + a.richtung[2] * b.richtung[2];
  return d <= STRAHL_RUHE_M * massstab && dot >= Math.cos(STRAHL_RUHE_RAD);
}

/**
 * Where the person stands relative to the world. Position = world point of the user-space origin (the floor under the starting
 * point for "local-floor"), m; drehungRad = turn about the vertical axis, rad; massstab = world metres per user metre (1 = 1:1,
 * 40 = a 40 m building appears 1 m wide).
 * @typedef {{x: number, y: number, z: number, drehungRad: number, massstab: number}} XrRig
 */

/** @typedef {{min: number[], max: number[]}} XrBox  Axis-aligned box of the model in world coordinates, m. */

/** Fallback box when a viewer has no model (10 x 3 x 10 m around the origin) [ASSUMED]. */
const LEER_BOX = { min: [-5, 0, -5], max: [5, 3, 5] };

/**
 * Starting rig for a scale mode. The person looks along -Z (the WebXR default).
 * @param {"1:1"|"tisch"} modus
 * @param {XrBox|null} box  Model box, m (world). null = fallback box.
 * @returns {XrRig}
 */
export function rigFuerModus(modus, box) {
  const b = box && box.min?.length === 3 && box.max?.length === 3 && [...box.min, ...box.max].every(Number.isFinite) ? box : LEER_BOX;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  if (modus === "tisch") {
    const groesse = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 1e-3);
    const k = groesse / TISCH_GROESSE_M;
    // user point (0, TISCH_HOEHE_M, -TISCH_ABSTAND_M) shows the world point (cx, minY, cz): the model stands on the table
    return { x: cx, y: b.min[1] - TISCH_HOEHE_M * k, z: cz + TISCH_ABSTAND_M * k, drehungRad: 0, massstab: k };
  }
  return { x: cx, y: b.min[1], z: b.max[2] + ABSTAND_1_1_M, drehungRad: 0, massstab: 1 };
}

/**
 * Rotates a horizontal vector about the vertical axis (three's convention: positive = counter-clockwise seen from above).
 * @param {number} x @param {number} z @param {number} w  Angle, rad. @returns {[number, number]}
 */
function drehY(x, z, w) {
  const c = Math.cos(w), s = Math.sin(w);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * World point of a user-space point.
 * @param {XrRig} rig @param {readonly number[]} p  [x, y, z] user space, m.
 * @returns {[number, number, number]}  World, m.
 */
export function userZuWelt(rig, p) {
  const [x, z] = drehY(p[0] * rig.massstab, p[2] * rig.massstab, rig.drehungRad);
  return [rig.x + x, rig.y + p[1] * rig.massstab, rig.z + z];
}

/**
 * User-space point of a world point (inverse of userZuWelt).
 * @param {XrRig} rig @param {readonly number[]} w  [x, y, z] world, m.
 * @returns {[number, number, number]}  User space, m.
 */
export function weltZuUser(rig, w) {
  const [x, z] = drehY(w[0] - rig.x, w[2] - rig.z, -rig.drehungRad);
  return [x / rig.massstab, (w[1] - rig.y) / rig.massstab, z / rig.massstab];
}

/**
 * The rig as a matrix (for the rig group of the scene).
 * @param {XrRig} rig @param {number} [ursprungHoeheM]  Height of the user-space origin above the floor, m (0 for "local-floor",
 *   AUGENHOEHE_LOCAL_M for "local"). @param {THREE.Matrix4} [ziel]
 * @returns {THREE.Matrix4}
 */
export function rigMatrix(rig, ursprungHoeheM = 0, ziel = new THREE.Matrix4()) {
  return ziel.compose(
    new THREE.Vector3(rig.x, rig.y + ursprungHoeheM * rig.massstab, rig.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rig.drehungRad),
    new THREE.Vector3(rig.massstab, rig.massstab, rig.massstab),
  );
}

/**
 * Glide: moves the person along a horizontal world direction.
 * @param {XrRig} rig
 * @param {readonly number[]} richtungXZ  [x, z] world direction (the ray projected on the floor); need not be normalised.
 * @param {number} vorwaerts  Stick value -1..1, positive = forward (along richtungXZ).
 * @param {number} dtS  Frame time, s.
 * @returns {XrRig}  New rig (unchanged when the direction is vertical or the stick rests).
 */
export function rigGleiten(rig, richtungXZ, vorwaerts, dtS) {
  const l = Math.hypot(richtungXZ[0], richtungXZ[1]);
  if (!(l > 1e-6) || !(Math.abs(vorwaerts) > STICK_RUHE) || !(dtS > 0)) return rig;
  const weg = GLEIT_M_S * rig.massstab * vorwaerts * Math.min(dtS, 0.1); // a stalled frame never jumps far
  return { ...rig, x: rig.x + (richtungXZ[0] / l) * weg, z: rig.z + (richtungXZ[1] / l) * weg };
}

/**
 * Turn: the person turns about a vertical axis through a world point (the head), so the head stays where it is.
 * @param {XrRig} rig @param {readonly number[]} umXZ  [x, z] world point of the axis, m. @param {number} winkelRad  Positive = to the left.
 * @returns {XrRig}
 */
export function rigDrehen(rig, umXZ, winkelRad) {
  const [dx, dz] = drehY(rig.x - umXZ[0], rig.z - umXZ[1], winkelRad);
  return { ...rig, x: umXZ[0] + dx, z: umXZ[1] + dz, drehungRad: rig.drehungRad + winkelRad };
}

/**
 * Teleport: the floor point under the head lands on the target.
 * @param {XrRig} rig @param {readonly number[]} zielWelt  [x, y, z] world target on a floor, m.
 * @param {readonly number[]} kopfUserXZ  [x, z] head position in user space, m.
 * @returns {XrRig}
 */
export function rigTeleport(rig, zielWelt, kopfUserXZ) {
  const [dx, dz] = drehY(kopfUserXZ[0] * rig.massstab, kopfUserXZ[1] * rig.massstab, rig.drehungRad);
  return { ...rig, x: zielWelt[0] - dx, y: zielWelt[1], z: zielWelt[2] - dz };
}

/**
 * Ray of a controller (or hand) target-ray object: origin at its position, direction along its -Z axis (WebXR target ray).
 * @param {THREE.Object3D} objekt  The target-ray group (renderer.xr.getController(i)), its matrixWorld current.
 * @returns {{ursprung: [number, number, number], richtung: [number, number, number]}}  World, m; unit direction.
 */
export function controllerStrahl(objekt) {
  const o = new THREE.Vector3().setFromMatrixPosition(objekt.matrixWorld);
  const d = new THREE.Vector3(0, 0, -1).transformDirection(objekt.matrixWorld);
  return { ursprung: [o.x, o.y, o.z], richtung: [d.x, d.y, d.z] };
}

/** @typedef {{trigger: boolean, griff: boolean, stick: boolean, a: boolean, b: boolean}} XrTasten */

/**
 * Buttons and stick of an input source (WebXR "xr-standard" gamepad mapping: 0 trigger, 1 squeeze, 3 thumbstick press, 4 / 5 the
 * two face buttons; axes 2 / 3 thumbstick, older pads 0 / 1). A hand has no gamepad: its pinch arrives as select event.
 * @param {{buttons?: ArrayLike<{pressed?: boolean}>, axes?: ArrayLike<number>}|null|undefined} gamepad
 * @param {boolean} [selectGedrueckt]  A select (pinch / trigger) is under way according to the session events.
 * @returns {{tasten: XrTasten, achsen: [number, number]}}  achsen: [x, y] of the stick, -1..1 (y negative = pushed forward).
 */
export function tastenAus(gamepad, selectGedrueckt = false) {
  const b = gamepad?.buttons ?? [];
  const gedrueckt = (/** @type {number} */ i) => !!b[i]?.pressed;
  const a = gamepad?.axes ?? [];
  const achsen = /** @type {[number, number]} */ (a.length >= 4 ? [a[2] ?? 0, a[3] ?? 0] : [a[0] ?? 0, a[1] ?? 0]).map((v) => (Number.isFinite(v) ? v : 0));
  return {
    tasten: { trigger: gedrueckt(0) || !!selectGedrueckt, griff: gedrueckt(1), stick: gedrueckt(3), a: gedrueckt(4), b: gedrueckt(5) },
    achsen: /** @type {[number, number]} */ (achsen),
  };
}

/**
 * Which buttons went down and up between two frames.
 * @param {XrTasten|null} vorher @param {XrTasten} jetzt
 * @returns {{runter: Array<keyof XrTasten>, hoch: Array<keyof XrTasten>}}
 */
export function flanken(vorher, jetzt) {
  const namen = /** @type {Array<keyof XrTasten>} */ (["trigger", "griff", "stick", "a", "b"]);
  return {
    runter: namen.filter((n) => jetzt[n] && !vorher?.[n]),
    hoch: namen.filter((n) => !jetzt[n] && !!vorher?.[n]),
  };
}

/**
 * Teleport target of a ray: an element surface that faces up (a slab, a stair), else the current floor plane.
 * @param {{ursprung: readonly number[], richtung: readonly number[]}} strahl  World, m.
 * @param {{punkt: readonly number[], normal?: readonly number[]|null}|null} treffer  Model hit with its world normal, or null.
 * @param {number} bodenY  World height of the floor the person stands on, m.
 * @param {number} maxM  Longest teleport in world metres.
 * @returns {[number, number, number]|null}  World target, m; null = no floor in reach (nothing is guessed).
 */
export function teleportZiel(strahl, treffer, bodenY, maxM) {
  const [ox, oy, oz] = strahl.ursprung;
  const [dx, dy, dz] = strahl.richtung;
  const weit = (/** @type {readonly number[]} */ p) => Math.hypot(p[0] - ox, p[2] - oz) > maxM;
  if (treffer && treffer.normal && treffer.normal[1] > BODEN_NORMAL_Y) {
    const p = /** @type {[number, number, number]} */ ([treffer.punkt[0], treffer.punkt[1], treffer.punkt[2]]);
    return weit(p) ? null : p;
  }
  if (treffer) return null; // a wall in the way: no teleport through it
  if (!(dy < -1e-6)) return null;
  const s = (bodenY - oy) / dy;
  if (!(s > 0)) return null;
  const p = /** @type {[number, number, number]} */ ([ox + dx * s, bodenY, oz + dz * s]);
  return weit(p) ? null : p;
}

/**
 * A model hit as the viewer reports it: the element (ground truth = GUID from the ray) and where the ray met it.
 * @typedef {Object} XrTreffer
 * @property {string|null} guid      GUID of the element (null: known element without GUID - selectable, not hoverable).
 * @property {string} text           The element in words ("IfcWall · Wand 12").
 * @property {[number, number, number]} punkt  Hit point, world m.
 * @property {number} abstand        Distance from the ray origin, world m.
 * @property {[number, number, number]|null} [normal]  World normal of the hit face (unit), for teleports.
 * @property {any} [id]              The viewer's own identity record (passed back to hover / waehlen).
 */

/**
 * What a viewer gives the VR session. All functions take and return plain data or the viewer's own records.
 * @typedef {Object} XrQuelle
 * @property {(strahl: {ursprung: number[], richtung: number[]}) => XrTreffer|null} treffen  Pick with the viewer's pick core + resolver.
 *   null = miss or an unknown hit (never guessed).
 * @property {(t: XrTreffer|null) => void} hover     Show / clear the 'fokus' highlight as the mouse hover does.
 * @property {(t: XrTreffer|null) => void} waehlen   Select (null = clear) exactly as a click does.
 * @property {() => string|null} auswahlText          The selection in words.
 * @property {() => XrBox|null} box                  Box of the loaded model, world m.
 * @property {(strahl: {ursprung: number[], richtung: number[]}) => {punkt: number[], abstand: number, normal?: number[]|null}|null} [rohTreffen]
 *   The first raw hit of ANY geometry (also parts without an element), world m - only for the teleport, which must not go through
 *   walls it cannot name. Without it the resolved hit is used.
 */

/**
 * The speech field's handle (SprechFeld prop `fernRef`).
 * @typedef {{starten: () => void, stoppen: () => void, verwerfen?: () => void, stand: () => any, aktion: (id: string) => void,
 *   bildSperren?: (an: boolean) => void}} XrSprechen
 */

/**
 * One input of a frame (a controller or a hand), already in world numbers.
 * @typedef {{index: number, strahl: {ursprung: number[], richtung: number[]}, tasten: XrTasten, achsen: [number, number], art?: string}} XrEingabe
 */

/**
 * The per-frame logic of a VR session, free of WebXR and of drawing: rays to panel and model, hover, select, speech, buttons, moving.
 * The session (xrSitzung) feeds it the inputs of each frame; tests feed it plain numbers.
 * @param {Object} opt
 * @param {XrQuelle} opt.quelle
 * @param {() => XrSprechen|null} opt.sprechen  The speech field's handle (null = speech not available in this view).
 * @param {{ausfuehren: (id: string, p?: any, ctx?: any) => {ok: boolean, result?: any, error?: string}}} opt.befehle  The viewer's register.
 * @param {() => boolean} opt.darfAendern  106-07 rights: may the person's role change the model?
 * @param {(s: string) => string} [opt.t]
 * @param {XrRig} opt.rig  Starting rig.
 * @param {"1:1"|"tisch"} opt.modus
 * @param {(rig: XrRig) => void} [opt.rigAnwenden]  Called when the rig changed (the session moves the rig group).
 * @param {(strahl: {ursprung: number[], richtung: number[]}) => {knopf: string|null, abstand: number}|null} [opt.tafelTreffen]
 *   Ray against the floating panel (world). knopf = id of the button under the ray.
 * @param {(stand: import("@core/lib/zeigen/xrTafel.js").TafelStand, markiert: string|null, layout: import("@core/lib/zeigen/xrTafel.js").TafelLayout) => void} [opt.tafelZeigen]
 *   Redraw the panel with this layout (computed here, so the buttons act on exactly what is drawn).
 * @param {() => number} [opt.jetztMs]  Clock, ms (default performance.now; tests pass their own).
 * @param {(index: number, art: "bauteil"|"tafel"|"leer", laengeWeltM: number) => void} [opt.laser]  Visual laser of one input.
 * @param {(punkt: number[]|null) => void} [opt.marke]  Reticle at the hit point (null = hidden).
 * @param {() => [number, number]} [opt.kopfUserXZ]  Head position in user space, m (default [0, 0]).
 * @param {(modus: "1:1"|"tisch") => void} [opt.modusGeaendert]  The scale mode was switched on the panel.
 * @param {() => void} [opt.beenden]  "VR beenden" on the panel.
 */
export function xrSteuerung(opt) {
  const t = opt.t ?? ((s) => s);
  let rig = { ...opt.rig };
  let modus = opt.modus;
  const jetzt = opt.jetztMs ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  /** @type {Map<number, {tasten: XrTasten|null, drehBereit: boolean, pick: {strahl: XrEingabe["strahl"], treffer: XrTreffer|null, alter: number}|null}>} */
  const je = new Map();
  // the same time budget as the desktop hover (106-01): a slow pick spaces out the next ones instead of dropping frames in the headset
  const drossel = pickDrossel();
  /** @type {string|null} */ let hoverGuid = null;
  let aktiverIndex = 0;
  /** @type {{text: string, ok: boolean}|null} */ let meldung = null;
  let sprichtVon = -1;
  /** @type {string} */ let tafelSchluessel = "";
  /** @type {any} */ let letzte = null;
  /**
   * What the panel showed when it was last drawn: the proposal id and whether its sentence (and check) were on it. Review 106-08:
   * Übernehmen / Verwerfen act on exactly this id - never on a proposal that came in after the panel was drawn.
   * @type {{id: string|null, lesbar: boolean, weg: string[]}}
   */
  let gezeigt = { id: null, lesbar: false, weg: [] };

  const rigSetzen = (/** @type {XrRig} */ r) => { if (r !== rig) { rig = r; opt.rigAnwenden?.(rig); } };

  /** Open proposals and the newest one (the one the panel will show). Only the open list, not the history: asked every frame. */
  const vorschlaege = () => {
    const r = opt.befehle.ausfuehren("vorschlaege", { nur_offen: true });
    const offen = r.ok ? (r.result?.offen ?? []) : [];
    return { offen, neuester: offen.length ? offen[offen.length - 1] : null };
  };

  /**
   * A panel button or a face button. The change itself runs through the viewer's command `bestaetigen` (durch "hand": the person
   * pressed it), which checks the proposal again and refuses without the right to change the model.
   * @param {string} id @returns {{ok: boolean, text: string}}
   */
  const aktion = (id) => {
    const s = opt.sprechen();
    let r = { ok: true, text: "" };
    if (id === "uebernehmen" || id === "verwerfen") {
      const { offen, neuester } = vorschlaege();
      const v = gezeigt.id ? offen.find((/** @type {any} */ x) => x.id === gezeigt.id) ?? null : null;
      // guard rail 1 / D-IM-04: only the proposal the person has read on the panel - a newer one is shown first, never confirmed blind
      if (!neuester) r = { ok: false, text: t("Kein offener Vorschlag") };
      else if (!v || v.id !== neuester.id) r = { ok: false, text: t("Vorschlag hat sich geändert — bitte neu ansehen") };
      else if (!gezeigt.lesbar || gezeigt.weg.includes(id)) r = { ok: false, text: t("Vorschlag passt nicht auf die Tafel — am Bildschirm ansehen") };
      else {
        const a = id === "uebernehmen"
          ? opt.befehle.ausfuehren("bestaetigen", { vorschlag_id: v.id, durch: "hand" })
          : opt.befehle.ausfuehren("verwerfen", { vorschlag_id: v.id });
        r = a.ok ? { ok: true, text: `${id === "uebernehmen" ? t("Übernommen") : t("Verworfen")}: ${v.satz}` } : { ok: false, text: t(String(a.error ?? "")) };
      }
    } else if (["abbrechen", "rueckfrage-ja", "rueckfrage-nein", "cloud-ja", "cloud-nein"].includes(id)) {
      if (s) s.aktion(id); else r = { ok: false, text: t("Sprechen nicht verfügbar") };
      r.text = "";
    } else if (id === "massstab") {
      modus = modus === "tisch" ? "1:1" : "tisch";
      rigSetzen(rigFuerModus(modus, opt.quelle.box()));
      opt.modusGeaendert?.(modus);
      r.text = modus === "tisch" ? t("Tischmodell") : t("Maßstab 1:1");
    } else if (id === "beenden") {
      opt.beenden?.();
    } else r = { ok: false, text: `${t("Unbekannte Taste")}: ${id}` };
    meldung = r.text ? r : null;
    return r;
  };

  /**
   * One frame.
   * @param {XrEingabe[]} eingaben  Inputs of this frame (gaze inputs are left out by the session).
   * @param {number} dtS  Frame time, s.
   */
  const schritt = (eingaben, dtS) => {
    /** @type {Array<{index: number, ziel: "bauteil"|"tafel"|"leer", guid: string|null, knopf: string|null, treffer: XrTreffer|null}>} */
    const ergebnisse = [];
    let markiert = /** @type {string|null} */ (null);
    for (const e of eingaben) {
      const z = je.get(e.index) ?? { tasten: null, drehBereit: true, pick: null };
      je.set(e.index, z);
      const { runter, hoch } = flanken(z.tasten, e.tasten);
      z.tasten = { ...e.tasten };
      // the panel is drawn over everything (depthTest off) and floats in front: it is tested first, a ray on it never selects behind it
      const tafel = opt.tafelTreffen?.(e.strahl) ?? null;
      /** @type {XrTreffer|null} */
      let treffer = null;
      if (!tafel) {
        // the model pick is the costly part (the whole merged mesh, no BVH): a ray that has not moved reuses its last hit for a few
        // frames, and the time budget spaces picks out on a slow model. A button press always picks afresh.
        const p = z.pick;
        const frisch = runter.length > 0 || !p || ((p.alter >= PICK_MAX_ALTER || !strahlGleich(p.strahl, e.strahl, rig.massstab)) && drossel.darf(jetzt()));
        if (frisch) {
          const t0 = jetzt();
          treffer = opt.quelle.treffen(e.strahl);
          drossel.messen(jetzt() - t0, jetzt());
          z.pick = { strahl: e.strahl, treffer, alter: 0 };
        } else { treffer = p.treffer; p.alter += 1; }
      } else z.pick = null;
      const ziel = tafel ? "tafel" : treffer ? "bauteil" : "leer";
      opt.laser?.(e.index, ziel, tafel?.abstand ?? treffer?.abstand ?? LASER_LEER_M * rig.massstab);
      if (tafel?.knopf) markiert = tafel.knopf;
      ergebnisse.push({ index: e.index, ziel, guid: treffer?.guid ?? null, knopf: tafel?.knopf ?? null, treffer });

      if (runter.length) aktiverIndex = e.index;
      if (runter.includes("trigger")) {
        if (tafel) { if (tafel.knopf) aktion(tafel.knopf); }
        else opt.quelle.waehlen(treffer); // like a click: a miss clears the selection, an unknown hit selects nothing
      }
      if (runter.includes("griff")) {
        const s = opt.sprechen();
        if (s) { s.starten(); sprichtVon = e.index; } else meldung = { ok: false, text: t("Sprechen nicht verfügbar") };
      }
      if (hoch.includes("griff") && sprichtVon === e.index) { opt.sprechen()?.stoppen(); sprichtVon = -1; }
      if (runter.includes("a")) aktion("uebernehmen");
      if (runter.includes("b")) aktion("verwerfen");
      if (runter.includes("stick")) {
        if (modus !== "1:1") meldung = { ok: false, text: t("Teleport nur im Maßstab 1:1 — im Tischmodell mit dem Stick gleiten") };
        else {
          const kopf = opt.kopfUserXZ?.() ?? [0, 0];
          // the RAW first hit blocks a teleport too: geometry without an element (context buildings, unresolved IFC parts) is no void
          const roh = opt.quelle.rohTreffen ? opt.quelle.rohTreffen(e.strahl) : treffer;
          const ziel = teleportZiel(e.strahl, tafel ? null : roh, rig.y, TELEPORT_MAX_M * rig.massstab);
          if (ziel) rigSetzen(rigTeleport(rig, ziel, kopf));
          else meldung = { ok: false, text: t("Kein Boden in Reichweite für den Teleport") };
        }
      }
      // stick: x = turn in steps (re-armed at rest), y = glide along the ray
      const [sx, sy] = e.achsen;
      if (Math.abs(sx) < STICK_RUHE) z.drehBereit = true;
      else if (Math.abs(sx) > STICK_SCHWELLE && z.drehBereit) {
        z.drehBereit = false;
        const kopf = opt.kopfUserXZ?.() ?? [0, 0];
        const kopfWelt = userZuWelt(rig, [kopf[0], 0, kopf[1]]);
        rigSetzen(rigDrehen(rig, [kopfWelt[0], kopfWelt[2]], -Math.sign(sx) * DREH_SCHRITT_RAD)); // stick right = turn right
      }
      if (Math.abs(sy) > STICK_RUHE) rigSetzen(rigGleiten(rig, [e.strahl.richtung[0], e.strahl.richtung[2]], -sy, dtS));
    }
    // a grip that vanished (controller lost) ends the recording like a release - never an open microphone
    if (sprichtVon >= 0 && !eingaben.some((e) => e.index === sprichtVon)) { opt.sprechen()?.stoppen(); sprichtVon = -1; }

    // hover: the input used last wins, else the first one that hits an element with a GUID (guard rail 3: no GUID, no hover)
    const reihe = [...ergebnisse].sort((a, b) => (a.index === aktiverIndex ? -1 : b.index === aktiverIndex ? 1 : 0));
    const hover = reihe.find((r) => r.treffer?.guid)?.treffer ?? null;
    if ((hover?.guid ?? null) !== hoverGuid) { hoverGuid = hover?.guid ?? null; opt.quelle.hover(hover); }
    opt.marke?.(hover ? hover.punkt : null);

    // the panel: redrawn only when what it says changed
    const { offen, neuester } = vorschlaege();
    /** @type {import("@core/lib/zeigen/xrTafel.js").TafelStand} */
    const stand = {
      zeigt: hover?.text ?? null,
      auswahl: opt.quelle.auswahlText(),
      sprechen: opt.sprechen()?.stand() ?? null,
      vorschlag: neuester, offenAnzahl: offen.length,
      darfAendern: opt.darfAendern(),
      meldung, modus,
      abgleich: abgleichFuerTafel(),
    };
    const schluessel = JSON.stringify([stand, markiert]);
    if (schluessel !== tafelSchluessel) {
      tafelSchluessel = schluessel;
      const layout = tafelLayout(tafelInhalt(stand, t));
      // from now on the buttons act on what this layout shows (and only if its sentence fit on the panel)
      gezeigt = { id: neuester?.id ?? null, lesbar: layout.zeilen.some((z) => z.art === "titel"), weg: layout.weg };
      opt.tafelZeigen?.(stand, markiert, layout);
    }
    letzte = { ergebnisse: ergebnisse.map(({ treffer: _t, ...r }) => r), hoverGuid, stand };
    return letzte;
  };

  return {
    schritt, aktion,
    /** Current rig, mode and the last frame's summary (plain data). */
    zustand: () => ({ rig: { ...rig }, modus, letzte }),
    /** Ends a running recording (session end). */
    beenden: () => { if (sprichtVon >= 0) { opt.sprechen()?.verwerfen?.(); sprichtVon = -1; } if (hoverGuid) { hoverGuid = null; opt.quelle.hover(null); } },
  };
}

/**
 * @typedef {Object} XrSitzungOpt
 * @property {any} renderer  three WebGLRenderer (renderer.xr is its WebXRManager).
 * @property {THREE.Scene} szene
 * @property {THREE.PerspectiveCamera} kamera
 * @property {any} [xr]  navigator.xr (default from the window).
 * @property {"1:1"|"tisch"} [modus]  Default "1:1".
 * @property {XrQuelle} quelle
 * @property {() => XrSprechen|null} sprechen
 * @property {{ausfuehren: (id: string, p?: any, ctx?: any) => {ok: boolean, result?: any, error?: string}}} befehle
 * @property {() => boolean} darfAendern
 * @property {(s: string) => string} [t]
 * @property {() => any} [leinwand]  Canvas factory for the panel (default document.createElement("canvas")).
 * @property {(info: {grund: string|null}) => void} [onEnde]  The session ended (by the person, the device or an error).
 * @property {() => number} [jetztMs]  Clock for the pick time budget, ms (default performance.now; tests pass their own).
 */

/**
 * Starts an immersive VR session for a viewer. Throws an Error with a German sentence when the start fails (the button shows it).
 * @param {XrSitzungOpt} opt
 * @returns {Promise<{beenden: () => Promise<void>, steuerung: ReturnType<typeof xrSteuerung>, modus: () => "1:1"|"tisch",
 *   referenzraum: string, tafel: () => any, tafelDarstellung: () => {depthTest: boolean, transparent: boolean, renderOrder: number, ort: number[]},
 *   weltZuReferenz: (p: number[]) => number[], knopfMitteReferenz: (id: string) => number[]|null}>}
 *   weltZuReferenz / knopfMitteReferenz: coordinates in the session's reference space (what the device reports poses in), m.
 */
export async function xrSitzung(opt) {
  const t = opt.t ?? ((s) => s);
  const xr = opt.xr ?? /** @type {any} */ (globalThis).navigator?.xr;
  const fehler = (/** @type {unknown} */ e) => {
    const f = xrStartFehlerText(e);
    return new Error(f.detail ? `${t(f.grund)} (${f.detail})` : t(f.grund));
  };
  if (!xr?.requestSession) throw new Error(t("VR nicht verfügbar: dieser Browser kennt kein WebXR"));
  /** @type {any} */ let session;
  try {
    session = await xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] });
  } catch (e) { throw fehler(e); }

  const { renderer, szene, kamera } = opt;
  // the camera's desktop state comes back after the session: its pose AND its projection. three writes the headset's field of view
  // into fov / zoom and the projection matrix of the user camera every XR frame (WebXRManager.updateUserCamera, r186) - without this
  // the desktop view would keep the headset's ~90° instead of the viewer's own 50° after the session (review 106-08).
  const alt = {
    parent: kamera.parent, position: kamera.position.clone(), quaternion: kamera.quaternion.clone(), scale: kamera.scale.clone(),
    fov: kamera.fov, zoom: kamera.zoom, near: kamera.near, far: kamera.far, aspect: kamera.aspect,
  };
  /** @type {Array<() => void>} */
  const entsorgen = [];
  const frei = (/** @type {any} */ o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); };
  let beendet = false;
  /** @type {THREE.Group|null} */ let rigGruppe = null;
  /** @type {ReturnType<typeof xrSteuerung>|null} */ let steuerung = null;

  // safe to call at any point of the setup: everything built so far is taken down, the camera gets its desktop state back
  const aufraeumen = () => {
    if (beendet) return;
    beendet = true;
    try { renderer.setAnimationLoop(null); } catch { /* the renderer may be gone with the page */ }
    try { renderer.xr.enabled = false; } catch { /* idem */ }
    try { steuerung?.beenden(); } catch (e) { console.warn(`[XR] cleanup failed: ${/** @type {any} */ (e)?.message || e}`); }
    opt.sprechen()?.bildSperren?.(false);
    if (rigGruppe && kamera.parent === rigGruppe) rigGruppe.remove(kamera);
    if (alt.parent && kamera.parent !== alt.parent) alt.parent.add(kamera);
    kamera.position.copy(alt.position);
    kamera.quaternion.copy(alt.quaternion);
    kamera.scale.copy(alt.scale);
    if (Number.isFinite(alt.fov)) kamera.fov = alt.fov;
    if (Number.isFinite(alt.zoom)) kamera.zoom = alt.zoom;
    if (Number.isFinite(alt.near)) kamera.near = alt.near;
    if (Number.isFinite(alt.far)) kamera.far = alt.far;
    if (Number.isFinite(alt.aspect)) kamera.aspect = alt.aspect;
    kamera.updateMatrixWorld(true);
    kamera.updateProjectionMatrix();
    for (const fn of entsorgen.splice(0)) { try { fn(); } catch (e) { console.warn(`[XR] cleanup failed: ${/** @type {any} */ (e)?.message || e}`); } }
    if (rigGruppe) szene.remove(rigGruppe);
  };

  // review 106-08: the whole setup runs inside one try - a failure anywhere (a box of the model, the controllers, setSession) ends the
  // session that was already granted, instead of leaving an immersive session without an owner
  try {
    // reference space: "local-floor" (origin on the floor), else "local" (origin at the head, eye height assumed)
    let referenzraum = "local-floor";
    let ursprungHoeheM = 0;
    try { await session.requestReferenceSpace("local-floor"); } catch { referenzraum = "local"; ursprungHoeheM = AUGENHOEHE_LOCAL_M; }

    // the camera goes into the rig
    const rg = new THREE.Group();
    rigGruppe = rg;
    rg.name = "xr-rig";
    rg.matrixAutoUpdate = false;
    szene.add(rg);
    rg.add(kamera);

    // Draw order (review 106-08): the panel is drawn over the model AND over the highlight overlays (selection outlines and state
    // signs use renderOrder 998/999 with depthTest off, some of them transparent), so it is transparent (sorted in the last pass), has
    // no depth test and the highest order; the lasers and the controller body follow it, so a ray onto a panel button stays visible.
    // A laser ends at the first hit, so nothing of the model lies in front of it - it needs no depth test either.
    const ORDNUNG = { marke: 1500, tafel: 2000, laser: 2001 };

    // floating panel (user space, inside the rig: it keeps its size at the table scale)
    const leinwand = opt.leinwand ? opt.leinwand() : (typeof document !== "undefined" ? document.createElement("canvas") : null);
    /** @type {any} */ let tafelLayoutStand = null;
    const tafelMesh = new THREE.Mesh(new THREE.PlaneGeometry(TAFEL_M.breite, TAFEL_M.hoehe),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false }));
    tafelMesh.name = "xr-tafel";
    tafelMesh.renderOrder = ORDNUNG.tafel;
    /** Places the panel for a scale mode: left in front at arm's length; at the table scale higher, above the usual table model. */
    const tafelPlatzieren = (/** @type {"1:1"|"tisch"} */ m) => {
      const ort = m === "tisch" ? TAFEL_ORT_TISCH_M : TAFEL_ORT_M;
      tafelMesh.position.set(ort.x, ort.y - ursprungHoeheM, ort.z);
      tafelMesh.rotation.set(-0.2, TAFEL_DREHUNG_RAD[m], 0); // tilted up and towards the person [ASSUMED]
      tafelMesh.updateMatrixWorld(true);
    };
    /** @type {any} */ let textur = null;
    if (leinwand) {
      leinwand.width = TAFEL_PX.breite;
      leinwand.height = TAFEL_PX.hoehe;
      textur = new THREE.CanvasTexture(leinwand);
      textur.colorSpace = THREE.SRGBColorSpace;
      /** @type {any} */ (tafelMesh.material).map = textur;
    }
    rg.add(tafelMesh);
    entsorgen.push(() => { frei(tafelMesh); textur?.dispose(); });

    // reticle at the hit point (world, scaled with the rig); under the panel, over the highlight overlays
    const marke = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.022, 24),
      new THREE.MeshBasicMaterial({ color: ZEIGE_ZUSTAENDE.fokus.hex, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 1 }));
    marke.name = "xr-marke";
    marke.visible = false;
    marke.renderOrder = ORDNUNG.marke;
    szene.add(marke);
    entsorgen.push(() => { szene.remove(marke); frei(marke); });

    // controllers / hands: target-ray groups in the rig, with a laser (solid to a hit, dashed into the void) and a small grip body.
    // Colour-vision check (farbsehen.mjs, 25.10.): fokus #0d968b and leise #737373 are confusable for deutan vision (OKLab dE 0.051) -
    // the two lasers are therefore told apart by FORM: solid line + reticle ring on a hit, dashed line without a ring into the void.
    const ROT_VOLL = { bauteil: ZEIGE_ZUSTAENDE.fokus.hex, tafel: TAFEL_FARBEN.text };
    const obenauf = { transparent: true, opacity: 1, depthTest: false };
    /** @type {Array<{gruppe: any, quelle: any, select: boolean, voll: THREE.Line, leer: THREE.LineSegments}>} */
    const regler = [];
    for (let i = 0; i < 2; i++) {
      const gruppe = renderer.xr.getController(i);
      const voll = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: ROT_VOLL.bauteil, ...obenauf }));
      voll.name = "xr-laser-voll";
      voll.visible = false;
      voll.renderOrder = ORDNUNG.laser;
      const punkte = [];
      for (let s = 0; s < LASER_LEER_M; s += 0.18) punkte.push(new THREE.Vector3(0, 0, -s), new THREE.Vector3(0, 0, -Math.min(s + 0.1, LASER_LEER_M)));
      const leer = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(punkte), new THREE.LineBasicMaterial({ color: TAFEL_FARBEN.leise, ...obenauf }));
      leer.name = "xr-laser-leer";
      leer.renderOrder = ORDNUNG.laser;
      // the body keeps its depth test (it can be behind a wall the person reaches into) but is drawn after the panel
      const koerper = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), new THREE.MeshBasicMaterial({ color: TAFEL_FARBEN.text, transparent: true, opacity: 1 }));
      koerper.position.z = 0.06;
      koerper.renderOrder = ORDNUNG.laser;
      gruppe.add(voll, leer, koerper);
      rg.add(gruppe);
      const r = { gruppe, quelle: /** @type {any} */ (null), select: false, voll, leer };
      const an = (/** @type {any} */ e) => { r.quelle = e.data ?? null; };
      const ab = () => { r.quelle = null; r.select = false; };
      const sStart = () => { r.select = true; };
      const sEnde = () => { r.select = false; };
      gruppe.addEventListener("connected", an);
      gruppe.addEventListener("disconnected", ab);
      gruppe.addEventListener("selectstart", sStart);
      gruppe.addEventListener("selectend", sEnde);
      entsorgen.push(() => {
        gruppe.removeEventListener("connected", an); gruppe.removeEventListener("disconnected", ab);
        gruppe.removeEventListener("selectstart", sStart); gruppe.removeEventListener("selectend", sEnde);
        gruppe.remove(voll, leer, koerper); rg.remove(gruppe);
        frei(voll); frei(leer); frei(koerper);
      });
      regler.push(r);
    }

    let massstab = 1;
    const rigAnwenden = (/** @type {XrRig} */ rig) => {
      massstab = rig.massstab;
      rigMatrix(rig, ursprungHoeheM, rg.matrix);
      rg.matrixWorldNeedsUpdate = true;
      rg.updateMatrixWorld(true);
      marke.scale.setScalar(rig.massstab);
    };

    // Frustum culling at a scale other than 1:1 (found in review 106-08 with the browser test's stand-in): three's union camera for
    // culling (WebXRManager.setProjectionFromUnion, r186) takes the eye distance from the SCALED rig in world metres but uses it as an
    // eye-space offset, so at the table scale k its near plane moves ~k x 3 cm forward and culls everything nearer than ~1.4 m - the
    // panel and most of the table model were not drawn at all. The eye cameras themselves are right (their view matrix carries 1/k).
    // So: at a scale other than 1 nothing is culled (the whole table model is in view anyway); at 1:1 culling works and stays on.
    /** @type {Set<THREE.Object3D>} */
    const ohneKulling = new Set();
    const kullingAnpassen = () => {
      if (massstab === 1) {
        if (ohneKulling.size) { for (const o of ohneKulling) o.frustumCulled = true; ohneKulling.clear(); }
        return;
      }
      // every frame: highlight outlines and previews the viewer adds during the session are covered too (a cheap walk, no allocation)
      szene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; ohneKulling.add(o); } });
    };
    entsorgen.push(() => { for (const o of ohneKulling) o.frustumCulled = true; ohneKulling.clear(); });

    /** @type {"1:1"|"tisch"} */ let modus = opt.modus === "tisch" ? "tisch" : "1:1";
    tafelPlatzieren(modus);
    /** @type {any} */ let sitzungHandle = null;
    const st = xrSteuerung({
      quelle: opt.quelle, sprechen: opt.sprechen, befehle: opt.befehle, darfAendern: opt.darfAendern, t, jetztMs: opt.jetztMs,
      rig: rigFuerModus(modus, opt.quelle.box()), modus, rigAnwenden,
      tafelTreffen: (strahl) => {
        if (!tafelLayoutStand) return null;
        const h = strahlPick(tafelMesh, strahl);
        if (!h || !h.roh.uv) return null;
        const k = tafelKnopfBei(tafelLayoutStand, h.roh.uv.x, 1 - h.roh.uv.y);
        return { knopf: k && k.aktiv ? k.id : null, abstand: h.abstand };
      },
      // the layout comes from xrSteuerung: the buttons it lets act are exactly the ones drawn here
      tafelZeigen: (_stand, markiert, layout) => {
        tafelLayoutStand = layout;
        const ctx = leinwand?.getContext?.("2d");
        if (ctx) { tafelZeichnen(ctx, tafelLayoutStand, markiert); if (textur) textur.needsUpdate = true; }
      },
      laser: (i, art, laengeWelt) => {
        const r = regler[i];
        if (!r) return;
        const k = massstab;
        r.leer.visible = art === "leer";
        r.voll.visible = art !== "leer";
        if (art !== "leer") {
          r.voll.scale.set(1, 1, Math.max(laengeWelt / k, 1e-3));
          /** @type {any} */ (r.voll.material).color.set(ROT_VOLL[art]);
        }
      },
      marke: (p) => {
        marke.visible = !!p;
        if (p) {
          marke.position.set(p[0], p[1], p[2]);
          marke.lookAt(new THREE.Vector3().setFromMatrixPosition(kamera.matrixWorld));
        }
      },
      kopfUserXZ: () => [kamera.position.x, kamera.position.z],
      modusGeaendert: (m) => { modus = m; tafelPlatzieren(m); },
      beenden: () => { void sitzungHandle?.beenden(); },
    });
    steuerung = st;
    rigAnwenden(st.zustand().rig);

    // The frame callback works ONLY with an XRFrame (review 106-08): three's own window loop also calls it (without a frame) when
    // setAnimationLoop runs while no session presents - that would pick and render a second time per frame, outside the XR frame.
    // Set before setSession, so three's 'sessionstart' stops its window loop.
    let zuletzt = -1;
    renderer.setAnimationLoop((/** @type {number} */ zeit, /** @type {any} */ frame) => {
      if (!frame || beendet) return;
      const dtS = zuletzt < 0 ? 0 : Math.max(0, (zeit - zuletzt) / 1000);
      zuletzt = zeit;
      /** @type {XrEingabe[]} */
      const eingaben = [];
      regler.forEach((r, index) => {
        const q = r.quelle;
        // D-IM-06: no gaze control; "screen" belongs to handheld AR
        if (!q || q.targetRayMode === "gaze" || q.targetRayMode === "screen" || !r.gruppe.visible) return;
        r.gruppe.updateWorldMatrix(true, false);
        const { tasten, achsen } = tastenAus(q.gamepad, r.select);
        eingaben.push({ index, strahl: controllerStrahl(r.gruppe), tasten, achsen, art: q.hand ? "hand" : "controller" });
      });
      // inputs that are not tracked show no laser
      regler.forEach((r, i) => { if (!eingaben.some((e) => e.index === i)) { r.voll.visible = false; r.leer.visible = false; } });
      try { st.schritt(eingaben, dtS); } catch (e) { console.warn(`[XR] frame failed: ${/** @type {any} */ (e)?.message || e}`); }
      kullingAnpassen();
      renderer.render(szene, kamera);
    });

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType(referenzraum);
    await renderer.xr.setSession(session);
    // registered after three's own 'end' listener: three restores its framebuffer and size first, then the viewer gets its camera back
    session.addEventListener("end", () => { aufraeumen(); opt.onEnde?.({ grund: null }); });
    // D-IM-02 safe side: in the headset no image of the (desktop) view goes with a sentence - text and GUIDs only. The viewers also
    // refuse every image while renderer.xr.isPresenting (ansichtAlsPng, SprechFeld bildSperre) - this flag is only the second lock.
    opt.sprechen()?.bildSperren?.(true);

    sitzungHandle = {
      beenden: async () => { if (!beendet) { try { await session.end(); } catch { aufraeumen(); opt.onEnde?.({ grund: null }); } } },
      steuerung: st,
      modus: () => modus,
      referenzraum,
      tafel: () => tafelLayoutStand,
      /** How the panel is drawn and where it floats (user space minus the origin height, m) - plain data for the browser test. */
      tafelDarstellung: () => {
        const m = /** @type {any} */ (tafelMesh.material);
        return { depthTest: m.depthTest, transparent: m.transparent, renderOrder: tafelMesh.renderOrder, ort: tafelMesh.position.toArray() };
      },
      /** A world point in the reference space (user space minus the origin height), m. */
      weltZuReferenz: (/** @type {number[]} */ p) => {
        const u = weltZuUser(st.zustand().rig, p);
        return [u[0], u[1] - ursprungHoeheM, u[2]];
      },
      /** Centre of a panel button in the reference space (for the browser test's stand-in controller), m; null = no such button. */
      knopfMitteReferenz: (/** @type {string} */ id) => {
        const k = tafelLayoutStand?.knoepfe.find((/** @type {any} */ x) => x.id === id);
        if (!k) return null;
        const u = (k.x + k.w / 2) / TAFEL_PX.breite - 0.5;
        const v = 0.5 - (k.y + k.h / 2) / TAFEL_PX.hoehe;
        tafelMesh.updateMatrix();
        const p = new THREE.Vector3(u * TAFEL_M.breite, v * TAFEL_M.hoehe, 0).applyMatrix4(tafelMesh.matrix);
        return [p.x, p.y, p.z];
      },
    };
    return sitzungHandle;
  } catch (e) {
    aufraeumen();
    try { await session.end(); } catch { /* already ended */ }
    throw fehler(e);
  }
}
