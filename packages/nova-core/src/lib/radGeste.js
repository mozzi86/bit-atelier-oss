// Wheel gestures of the drawing surfaces (plan 115-01, wish W-1115-04, decision D-115-07: all surfaces behave alike).
//
// A browser reports three different hand movements as the same `wheel` event: a notch of a mouse wheel, a two-finger
// swipe on a trackpad and a pinch on a trackpad. Before this module every surface zoomed one full step per event; a
// trackpad sends dozens of small events per gesture, so the drawing shot away. This module tells the three apart and
// says what the event means:
//
//   mouse wheel         → zoom, one step per event, exactly as before
//   pinch               → zoom in proportion to the finger movement (factor = e^(−deltaY · PINCH_JE_PX))
//   two-finger swipe    → pan by (deltaX, deltaY) px; with `umschaltDreht` and Shift held: orbit (3D cameras)
//
// How the source is told (WheelEvent values, checked in this order):
//   1. deltaMode 1 or 2 (lines, pages)                       → mouse wheel. Certain: trackpads report pixels.
//   2. pixel mode, deltaX ≠ 0                                → trackpad (a wheel has one axis). Exception: Shift + wheel,
//      which browsers turn into a pure x movement (deltaY = 0) — judged on the x axis like a wheel, so it zooms.
//   3. |wheelDelta| = 3 · |delta|                            → trackpad on macOS (Chrome and Safari derive the legacy
//      wheelDelta from the pixel delta there; a mouse reports ±120 per notch whatever the pixel delta is).
//   4. wheelDelta a multiple of 120                          → mouse wheel (120 = one notch in the legacy unit).
//   5. whole-numbered delta of at least RAD_GANZ_MIN_PX px   → mouse wheel (events without a usable wheelDelta:
//      scripted ones in tests, automation).
//   6. anything else (small or fractional pixel deltas)      → trackpad.
// Rules 3–5 can be wrong for a single event (a trackpad fling passes through 100 px, a mouse on macOS can report exactly
// 40 px = 3 · 40). A gesture is a run of events a few milliseconds apart, so the caller hands in the source of the event
// before (`vorher`): within GESTE_FOLGE_MS a running trackpad gesture keeps every pixel-mode event, and a running wheel
// burst keeps an event that rule 3 calls a trackpad although its wheelDelta is a multiple of 120. radGestenLeser() does
// that bookkeeping.
// With Ctrl held: a mouse wheel still zooms at wheel speed, everything else is a pinch (browsers report a pinch as a
// wheel event with ctrlKey = true).
//
// [ASSUMED] The values behind rules 3–5 are what Chrome, Edge, Firefox and Safari were seen to send; they are not part of
// any standard. Known limits: a free-spinning high-resolution wheel sends small pixel deltas like a trackpad and pans;
// Safari reports a pinch as gesture events, not as wheel events, and is not covered here.
//
// Firefox reports a mouse wheel in lines only when `deltaMode` is read BEFORE the deltas — radGeste() does.
//
// In:  the plain values of a WheelEvent (or the event itself) and options. Out: a plain object. No DOM access, no state
//      (radGestenLeser() keeps the source and time of the last event, nothing else).
import { radRasten } from "./zeigen/kameraNavigation.js";

/** Zoom factor of one mouse-wheel event in the 2D drawing surfaces (15 % per event, the value used since phase 34). */
export const RAD_FAKTOR = 1.15;
/** Pinch: exponent per pixel of deltaY, 1/px. [ASSUMED] 0.01 — a pinch of 50 px in sum zooms by e^0.5 ≈ 1.65, the range
 *  drawing programs in the browser use; to be checked by the user on a real trackpad. */
export const PINCH_JE_PX = 0.01;
/** Largest zoom factor of ONE pinch event (and 1/x the smallest): one mouse-wheel step. Keeps a burst value calm. */
export const PINCH_MAX_FAKTOR = 1.15;
/** Rule 5: a whole-numbered pixel delta of at least this many px counts as a wheel notch. [ASSUMED] 100 px is what
 *  Chrome sends per notch on Windows at 100 % scaling. */
export const RAD_GANZ_MIN_PX = 100;
/** Events of one gesture follow each other within this time, ms. [ASSUMED] 120 ms: trackpads report at 60 Hz or faster
 *  while the fingers move; two notches of a wheel that follow a swipe this fast cannot come from the same hand. */
export const GESTE_FOLGE_MS = 120;

/**
 * The values of a wheel event this module reads. A WheelEvent fits as it is.
 * @typedef {object} RadEreignis
 * @property {number} [deltaX] movement to the right, px in pixel mode (else lines or pages)
 * @property {number} [deltaY] movement down, px in pixel mode; negative = wheel away from the person / fingers apart
 * @property {number} [deltaMode] 0 pixels, 1 lines, 2 pages
 * @property {boolean} [ctrlKey] Ctrl held — or a trackpad pinch
 * @property {boolean} [shiftKey] Shift held
 * @property {number} [wheelDeltaX] legacy value, 120 per notch, sign opposite to deltaX (not in every browser)
 * @property {number} [wheelDeltaY] legacy value, 120 per notch, sign opposite to deltaY (not in every browser)
 * @property {number} [timeStamp] time of the event, ms (only radGestenLeser() reads it)
 */

/**
 * What a wheel event means. Fields that do not belong to `art` are neutral (faktor 1, the others 0).
 * @typedef {object} RadGeste
 * @property {"zoom"|"schieben"|"drehen"|"nichts"} art zoom · pan · orbit · no movement in the event
 * @property {"rad"|"pinch"|"trackpad"} quelle mouse wheel · trackpad pinch · trackpad swipe
 * @property {number} faktor zoom: factor of the picture scale for this event, > 1 = closer / larger
 * @property {number} rasten zoom from a mouse wheel: signed notches as radRasten() counts them (−1…1, positive =
 *   closer) for surfaces that step by notches; 0 for a pinch — those surfaces use `faktor` then
 * @property {number} dx pan / orbit: how far the VIEW travels to the right, CSS px. The drawing moves the other way,
 *   as a page does when it is scrolled (the direction setting of the operating system is already in the sign)
 * @property {number} dy pan / orbit: how far the view travels down, CSS px
 */

const zahl = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Source of one event without looking at the events before.
 * @param {number} dx deltaX @param {number} dy deltaY @param {number} modus deltaMode
 * @param {boolean} umschalt shiftKey @param {number} wdx wheelDeltaX (0 = unknown) @param {number} wdy wheelDeltaY (0 = unknown)
 * @returns {{quelle: "rad"|"trackpad", fest: boolean, delta: number}} fest: no earlier event may overrule it;
 *   delta: the delta of the axis a wheel is judged on (y, or x for Shift + wheel)
 */
function einzelUrteil(dx, dy, modus, umschalt, wdx, wdy) {
  if (modus !== 0) return { quelle: "rad", fest: true, delta: dy || dx }; // rule 1
  const nurX = dy === 0 && dx !== 0;
  if (dx !== 0 && !(nurX && umschalt)) return { quelle: "trackpad", fest: true, delta: dy }; // rule 2
  const delta = nurX ? dx : dy;
  const wd = nurX ? wdx : wdy;
  const betrag = Math.abs(delta);
  const rast120 = wd !== 0 && Math.abs(wd) % 120 === 0;
  if (wd !== 0 && Math.abs(wd) === 3 * betrag) return { quelle: "trackpad", fest: !rast120, delta }; // rule 3
  if (rast120) return { quelle: "rad", fest: false, delta }; // rule 4
  if (Number.isInteger(delta) && betrag >= RAD_GANZ_MIN_PX) return { quelle: "rad", fest: false, delta }; // rule 5
  return { quelle: "trackpad", fest: true, delta }; // rule 6
}

/**
 * Says what one wheel event means: zoom (mouse wheel or pinch), pan or orbit (two-finger swipe). See the file header
 * for the rules. Pure: the same values give the same answer.
 * @param {RadEreignis} e the wheel event or its values
 * @param {object} [opt]
 * @param {number} [opt.radFaktor] zoom factor of one mouse-wheel event (default RAD_FAKTOR)
 * @param {boolean} [opt.umschaltDreht] true: Shift + two-finger swipe is "drehen" instead of "schieben" (3D cameras)
 * @param {"rad"|"trackpad"|null} [opt.vorher] source of the event before when it came less than GESTE_FOLGE_MS ago
 *   (a pinch counts as "trackpad"), else null
 * @returns {RadGeste}
 */
export function radGeste(e, { radFaktor = RAD_FAKTOR, umschaltDreht = false, vorher = null } = {}) {
  const modus = zahl(e.deltaMode); // read first, see the note on Firefox in the header
  const dx = zahl(e.deltaX), dy = zahl(e.deltaY);
  const u = einzelUrteil(dx, dy, modus, !!e.shiftKey, zahl(e.wheelDeltaX), zahl(e.wheelDeltaY));
  // the running gesture keeps an event that is uncertain on its own; a certain one (rules 1, 2, 6) starts a new gesture
  const quelle = vorher && !u.fest ? vorher : u.quelle;

  /** @type {RadGeste} */
  const g = { art: "nichts", quelle, faktor: 1, rasten: 0, dx: 0, dy: 0 };
  if (quelle === "rad") {
    if (!u.delta) return g;
    g.art = "zoom";
    g.faktor = u.delta < 0 ? radFaktor : 1 / radFaktor;
    g.rasten = radRasten(u.delta, modus);
    return g;
  }
  if (e.ctrlKey) {
    g.quelle = "pinch";
    if (!dy) return g;
    const grenze = Math.log(PINCH_MAX_FAKTOR);
    g.art = "zoom";
    g.faktor = Math.exp(Math.max(-grenze, Math.min(grenze, -dy * PINCH_JE_PX)));
    return g;
  }
  if (!dx && !dy) return g;
  // [ASSUMED] Shift + swipe orbits in the 3D cameras (115-CONTEXT "Noch offen": proposed, not confirmed by the user).
  g.art = umschaltDreht && e.shiftKey ? "drehen" : "schieben";
  g.dx = dx;
  g.dy = dy;
  return g;
}

/**
 * radGeste() with a memory for the running gesture: one reader per drawing surface, called for every wheel event.
 * Keeps the source and time of the last event, so a single odd value inside a swipe does not zoom and one inside a
 * wheel burst does not pan.
 * @returns {(e: RadEreignis, opt?: {radFaktor?: number, umschaltDreht?: boolean}) => RadGeste}
 *   the time comes from e.timeStamp (ms); an event without one starts a new gesture
 */
export function radGestenLeser() {
  /** @type {{quelle: "rad"|"trackpad", t: number}|null} */
  let zuletzt = null;
  return (e, opt = {}) => {
    const t = typeof e.timeStamp === "number" && Number.isFinite(e.timeStamp) ? e.timeStamp : NaN;
    const laeuft = zuletzt && t - zuletzt.t >= 0 && t - zuletzt.t < GESTE_FOLGE_MS; // NaN compares false
    const g = radGeste(e, { ...opt, vorher: laeuft && zuletzt ? zuletzt.quelle : null });
    zuletzt = Number.isNaN(t) ? null : { quelle: g.quelle === "rad" ? "rad" : "trackpad", t };
    return g;
  };
}
