// Camera navigation of the 3D viewers — the wiring (quick task 261110-mzj).
//
// Takes a camera, its OrbitControls and the canvas, and replaces the MOUSE and PEN part of the controls by
// the pointer-anchored navigation of kameraNavigation.js: orbit about the element under the pointer, pan with the
// grabbed point under the pointer, wheel zoom towards the pointer, and the walk mode (W A S D). Touch (one finger
// orbit, two fingers pinch/pan) stays with OrbitControls, which also keeps running for damping and for every caller
// that sets `controls.target`.
//
// How it shares the canvas:
// - the mouse buttons of OrbitControls are switched off (mouseButtons = −1), its touch handling is untouched;
// - wheel events are taken in the capture phase at the PARENT of the canvas and stopped there, so OrbitControls
//   never zooms on its own. A viewer that wants to hear the wheel listens at the parent in the capture phase too;
// - the viewer's own pointer listeners on the canvas keep working (click = select); in walk mode pointer, click,
//   double-click and context-menu events are stopped at the parent, so nothing is selected and no menu opens.
//
// A viewer WITHOUT OrbitControls (own orbit angles, e.g. the BIM studio) passes a stand-in for `controls` — an object
// with `target` (x, y, z, set), `enabled`, `mouseButtons` and `update()` — and `nachBewegung`, which is called after
// every camera move so the viewer can take position and target back into its own camera state. An editor whose left
// button belongs to its tools passes its own `griff` (which button does what).
//
// Parallel projection (axonometry, step F of the one-viewer paper): when `parallel()` is true the camera is treated as an
// orthographic one whose picture height is parallelHoehe(distance camera → target, fov) — pointer rays run along the view
// direction, the pan is the same for every depth, the wheel changes the distance (= the picture size) and keeps the point
// under the pointer. The VIEWER sets the frustum of its orthographic camera from that height (e.g. in nachBewegung or in
// its render loop). The walk mode needs a perspective view and does not start in a parallel one.
//
// In:  camera, canvas, OrbitControls (or the stand-in), a pick function (client px → world point or null), optional
//      lock test, grip table, move listener and a listener for the walk state.
// Out: a handle (laufStarten / laufBeenden / laufAktiv / zustand / verwerfen).
// Side effects: moves the camera and controls.target, switches controls.mouseButtons and (in walk mode)
//      controls.enabled, asks for a pointer lock on the canvas, listens on window/document while walking.
import {
  mausGriff, kameraAchsen, zeigerStrahl, zeigerStrahlParallel, ankerPunkt, drehWinkel, umPunktDrehen, schiebeVersatz, radRasten,
  zoomSchritt, zoomParallel,
  blickWinkel, blickRichtung, umsehen, laufEingabe, laufSchritt, laufStufeSchalten, eingabeFokus,
  LAUF_STUFEN, LAUF_STUFE_VORGABE, LAUF_TASTEN,
} from "./kameraNavigation.js";
import { mittelklickZaehler } from "../mittelklick.js";

/** @typedef {import("./kameraNavigation.js").Vek3} Vek3 */

/**
 * State of the walk mode as the hint shows it.
 * @typedef {{aktiv: boolean, stufe: number, tempo: number, gefangen: boolean}} LaufZustand
 *   stufe: index into LAUF_STUFEN; tempo: m/s; gefangen: the browser has locked the mouse (the view follows it without a button)
 */

/** The wheel anchor is kept while the pointer rests and the wheel keeps turning, ms. [ASSUMED] 400 ms: longer than the
 *  gap between two notches of a slow hand, shorter than a new decision. One pick per wheel burst instead of one per event. */
const RAD_ANKER_MS = 400;
/** Longest frame the walk mode integrates, s (a tab that was in the background must not jump through the building). */
const DT_MAX_S = 0.1;
/** A parallel pointer ray starts this far BEHIND the camera plane, m: a parallel view also shows what lies behind the
 *  camera position (the position only fixes direction and picture size), so the ground under the pointer may be there. */
const PARALLEL_RUECK_M = 500;
/** Field of view used for the picture height of a parallel view when the camera object carries none, degrees. */
const PARALLEL_FOV_GRAD = 50;

/** The speed level chosen last; stays until the page is reloaded and is shared by every viewer. */
let gemerkteStufe = LAUF_STUFE_VORGABE;

/**
 * Connects the navigation to one viewer.
 * @param {object} a
 * @param {any} a.kamera the camera or a stand-in for it: position (x, y, z, set), lookAt(x, y, z), fov in degrees (a viewer
 *   that swaps between a perspective and an orthographic camera passes a stand-in that forwards to the current one)
 * @param {() => boolean} [a.parallel] true while the view is a parallel projection (see the header)
 * @param {HTMLElement} a.element the canvas the controls listen on
 * @param {any} a.controls its OrbitControls (target, enabled, mouseButtons, update)
 * @param {(clientX: number, clientY: number) => (Vek3|null)} a.punktUnterZeiger first model hit under a client position
 *   (px), world metres, or null
 * @param {() => boolean} [a.gesperrt] true while something else holds the camera (a gizmo drag, a tool, a VR session):
 *   no drag starts, no zoom, no walk mode
 * @param {(z: LaufZustand) => void} [a.onLauf] called whenever the walk state changes
 * @param {(e: PointerEvent) => ("drehen"|"schieben"|null)} [a.griff] what a pressed button does (default mausGriff:
 *   left orbits, middle/right pan); null = this press is not navigation and is left to the viewer
 * @param {() => void} [a.mittelDoppelklick] called on a double click of the wheel button — the CAD convention for "show
 *   the whole model" (Archicad: Optimieren); the second press starts no drag
 * @param {() => void} [a.nachBewegung] called after every camera move of this module (drag, wheel, each walk frame, walk
 *   end), when kamera.position and controls.target are both up to date
 * @returns {{laufStarten: () => boolean, laufBeenden: () => void, laufAktiv: () => boolean, zustand: () => LaufZustand, verwerfen: () => void}}
 *   laufStarten returns false when the camera is held or the view is parallel and the mode did not start
 */
export function kameraSteuerung({ kamera, element, controls, punktUnterZeiger, gesperrt = () => false, onLauf = () => {}, griff = mausGriff, nachBewegung = () => {}, mittelDoppelklick, parallel = () => false }) {
  const mittelZaehler = mittelklickZaehler();
  const huelle = element.parentElement || element;
  const dok = element.ownerDocument;
  const fenster = dok.defaultView || window;
  const altesMausbild = { ...controls.mouseButtons };
  controls.mouseButtons = { LEFT: -1, MIDDLE: -1, RIGHT: -1 };

  const pos = () => /** @type {Vek3} */ ([kamera.position.x, kamera.position.y, kamera.position.z]);
  const ziel = () => /** @type {Vek3} */ ([controls.target.x, controls.target.y, controls.target.z]);
  const setzen = (/** @type {Vek3} */ p, /** @type {Vek3} */ z) => {
    kamera.position.set(p[0], p[1], p[2]);
    controls.target.set(z[0], z[1], z[2]);
    kamera.lookAt(z[0], z[1], z[2]);
    nachBewegung();
  };
  const frei = () => controls.enabled !== false && !gesperrt();
  const fov = () => Number(kamera.fov) || PARALLEL_FOV_GRAD;

  /** Height of the horizontal plane for grabs into the void, m: that of the element grabbed last. */
  let ebenenHoehe = Number(controls.target.y) || 0;

  /** Anchor under a client position: element, plane or fallback (see ankerPunkt). */
  const ankerBei = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const r = element.getBoundingClientRect();
    const p = pos(), z = ziel();
    const ausschnitt = {
      position: p, ziel: z, fovGrad: fov(), seiten: r.height > 0 ? r.width / r.height : 1,
      ndcX: r.width > 0 ? ((cx - r.left) / r.width) * 2 - 1 : 0, ndcY: r.height > 0 ? 1 - ((cy - r.top) / r.height) * 2 : 0,
    };
    const zielAbstand = Math.hypot(z[0] - p[0], z[1] - p[1], z[2] - p[2]);
    let ursprung = p, richtung, ersatzAbstand = zielAbstand;
    if (parallel()) {
      const s = zeigerStrahlParallel(ausschnitt);
      richtung = s.richtung;
      ursprung = [s.ursprung[0] - richtung[0] * PARALLEL_RUECK_M, s.ursprung[1] - richtung[1] * PARALLEL_RUECK_M, s.ursprung[2] - richtung[2] * PARALLEL_RUECK_M];
      ersatzAbstand = zielAbstand + PARALLEL_RUECK_M; // fallback point in the plane of the target
    } else richtung = zeigerStrahl(ausschnitt);
    const anker = ankerPunkt({ treffer: punktUnterZeiger(cx, cy), ursprung, richtung, hoehe: ebenenHoehe, ersatzAbstand });
    ebenenHoehe = anker.hoehe;
    return anker.punkt;
  };

  // ---- walk state (declared first: the drag and wheel handlers below look at it) -------------------------------------------
  /** @type {{stufe: number, gier: number, nick: number, tasten: Set<string>, zielAbstand: number, warAktiviert: boolean, raf: number, zuletzt: number, gefangen: boolean, zieht: boolean}|null} */
  let lauf = null;

  // ---- drag: orbit / pan ---------------------------------------------------------------------------------------------------
  /** @type {{art: "drehen"|"schieben", id: number, x: number, y: number, punkt: Vek3, tiefe: number}|null} */
  let zug = null;
  const onDown = (/** @type {PointerEvent} */ e) => {
    if (lauf || e.pointerType === "touch" || zug || !frei()) return;
    if (mittelDoppelklick && mittelZaehler(e)) { e.preventDefault(); mittelDoppelklick(); return; }
    const art = griff(e);
    if (!art) return;
    if (e.button === 1) e.preventDefault(); // no auto-scroll cursor on the middle button
    const punkt = ankerBei(e.clientX, e.clientY);
    const p = pos();
    const { vor } = kameraAchsen(p, ziel());
    // parallel: one pixel is the same length at every depth — that of the target distance, which sets the picture height
    const z = ziel();
    const tiefe = parallel() ? Math.hypot(z[0] - p[0], z[1] - p[1], z[2] - p[2])
      : (punkt[0] - p[0]) * vor[0] + (punkt[1] - p[1]) * vor[1] + (punkt[2] - p[2]) * vor[2];
    zug = { art, id: e.pointerId, x: e.clientX, y: e.clientY, punkt, tiefe };
    try { element.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has no capture */ }
  };
  const onMove = (/** @type {PointerEvent} */ e) => {
    if (!zug || e.pointerId !== zug.id) return;
    const dx = e.clientX - zug.x, dy = e.clientY - zug.y;
    zug.x = e.clientX; zug.y = e.clientY;
    if (!dx && !dy) return;
    const hoehePx = element.clientHeight;
    if (zug.art === "drehen") {
      const w = drehWinkel(dx, dy, hoehePx);
      const neu = umPunktDrehen({ position: pos(), ziel: ziel(), punkt: zug.punkt, gier: w.gier, nick: w.nick });
      setzen(neu.position, neu.ziel);
    } else {
      const p = pos(), z = ziel();
      const { rechts, oben } = kameraAchsen(p, z);
      const v = schiebeVersatz({ dxPx: dx, dyPx: dy, tiefe: zug.tiefe, fovGrad: fov(), hoehePx, rechts, oben });
      setzen([p[0] + v[0], p[1] + v[1], p[2] + v[2]], [z[0] + v[0], z[1] + v[1], z[2] + v[2]]);
    }
  };
  const onUp = (/** @type {PointerEvent} */ e) => {
    if (!zug || e.pointerId !== zug.id) return;
    zug = null;
    try { element.releasePointerCapture(e.pointerId); } catch { /* see onDown */ }
  };

  // ---- walk mode -----------------------------------------------------------------------------------------------------------
  const zustand = () => /** @type {LaufZustand} */ ({
    aktiv: !!lauf, stufe: lauf ? lauf.stufe : gemerkteStufe, tempo: LAUF_STUFEN[lauf ? lauf.stufe : gemerkteStufe], gefangen: !!lauf?.gefangen,
  });
  const melden = () => { try { onLauf(zustand()); } catch (err) { console.warn(`[navigation] walk listener failed: ${/** @type {any} */ (err)?.message || err}`); } };
  const stufeSetzen = (/** @type {number} */ s) => {
    if (!lauf || s === lauf.stufe) return;
    lauf.stufe = s; gemerkteStufe = s;
    melden();
  };
  const bild = () => {
    if (!lauf) return;
    lauf.raf = fenster.requestAnimationFrame(bild);
    const jetzt = performance.now();
    const dt = Math.min(DT_MAX_S, Math.max(0, (jetzt - lauf.zuletzt) / 1000));
    lauf.zuletzt = jetzt;
    const blick = blickRichtung(lauf.gier, lauf.nick);
    const ein = eingabeFokus(dok.activeElement) ? { vor: 0, seit: 0, hoch: 0, schnell: false } : laufEingabe(lauf.tasten);
    const v = laufSchritt({ ...ein, blick, tempo: LAUF_STUFEN[lauf.stufe], dt });
    const p = pos();
    // the orbit target walks along in front of the camera (as far away as at the start), so a viewer with its own camera
    // state can follow through nachBewegung and the view simply stays when the mode ends
    setzen([p[0] + v[0], p[1] + v[1], p[2] + v[2]],
      [p[0] + v[0] + blick[0] * lauf.zielAbstand, p[1] + v[1] + blick[1] * lauf.zielAbstand, p[2] + v[2] + blick[2] * lauf.zielAbstand]);
  };
  const onTasteRunter = (/** @type {KeyboardEvent} */ e) => {
    if (!lauf || eingabeFokus(dok.activeElement)) return;
    // Capture phase on window + stopImmediatePropagation: a key of the walk mode is no shortcut of the viewer or the app
    // (W, A, S, D, Q, E, C and Esc are tool keys in an editor). preventDefault: Space and arrows must not scroll the page.
    const meins = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === "Escape") { meins(); laufBeenden(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser and system shortcuts stay what they are
    if (e.key === "+" || e.code === "NumpadAdd") { meins(); stufeSetzen(laufStufeSchalten(lauf.stufe, 1)); return; }
    if (e.key === "-" || e.key === "−" || e.code === "NumpadSubtract") { meins(); stufeSetzen(laufStufeSchalten(lauf.stufe, -1)); return; }
    if (e.code in LAUF_TASTEN) { meins(); lauf.tasten.add(e.code); }
  };
  const onTasteHoch = (/** @type {KeyboardEvent} */ e) => { lauf?.tasten.delete(e.code); };
  const onUnscharf = () => { lauf?.tasten.clear(); };
  const onFang = () => {
    if (!lauf) return;
    const jetzt = dok.pointerLockElement === element;
    if (lauf.gefangen && !jetzt) { laufBeenden(); return; } // Esc inside a pointer lock reaches the browser only: it ends the mode too
    lauf.gefangen = jetzt;
    melden();
  };
  const onMausWeg = (/** @type {MouseEvent} */ e) => {
    if (!lauf || !(lauf.gefangen || lauf.zieht)) return;
    const w = umsehen(lauf.gier, lauf.nick, e.movementX || 0, e.movementY || 0);
    lauf.gier = w.gier; lauf.nick = w.nick;
  };
  const onMausLos = () => { if (lauf) lauf.zieht = false; };
  // Capture phase at the parent: in walk mode the viewer's own listeners on the canvas hear nothing (no selection, no
  // double-click, no context menu); a press on the canvas asks for the pointer lock and, without one, looks around while held.
  const onHuelleRunter = (/** @type {PointerEvent} */ e) => {
    if (!lauf || e.target !== element) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    lauf.zieht = true;
    if (!lauf.gefangen && typeof element.requestPointerLock === "function") {
      try {
        const antwort = /** @type {any} */ (element.requestPointerLock());
        if (antwort && typeof antwort.catch === "function") antwort.catch(() => { /* refused: looking around with the button held still works */ });
      } catch { /* same */ }
    }
  };
  const onHuelleStill = (/** @type {Event} */ e) => {
    if (!lauf || e.target !== element) return;
    e.stopPropagation();
    if (e.type === "contextmenu") e.preventDefault();
  };
  const STILL = ["pointerup", "pointermove", "pointercancel", "click", "dblclick", "contextmenu"];

  function laufStarten() {
    if (lauf) return true;
    if (!frei() || zug || parallel()) return false;
    const p = pos(), z = ziel();
    const w = blickWinkel([z[0] - p[0], z[1] - p[1], z[2] - p[2]]);
    lauf = {
      stufe: gemerkteStufe, gier: w.gier, nick: w.nick, tasten: new Set(),
      zielAbstand: Math.max(1, Math.hypot(z[0] - p[0], z[1] - p[1], z[2] - p[2])),
      warAktiviert: controls.enabled, raf: 0, zuletzt: performance.now(), gefangen: false, zieht: false,
    };
    controls.enabled = false; // OrbitControls would pull the camera back to its target every frame
    fenster.addEventListener("keydown", onTasteRunter, true);
    fenster.addEventListener("keyup", onTasteHoch, true);
    fenster.addEventListener("blur", onUnscharf);
    fenster.addEventListener("mouseup", onMausLos);
    dok.addEventListener("pointerlockchange", onFang);
    dok.addEventListener("mousemove", onMausWeg);
    lauf.raf = fenster.requestAnimationFrame(bild);
    melden();
    return true;
  }

  function laufBeenden() {
    if (!lauf) return;
    const l = lauf;
    lauf = null;
    fenster.cancelAnimationFrame(l.raf);
    fenster.removeEventListener("keydown", onTasteRunter, true);
    fenster.removeEventListener("keyup", onTasteHoch, true);
    fenster.removeEventListener("blur", onUnscharf);
    fenster.removeEventListener("mouseup", onMausLos);
    dok.removeEventListener("pointerlockchange", onFang);
    dok.removeEventListener("mousemove", onMausWeg);
    if (dok.pointerLockElement === element && typeof dok.exitPointerLock === "function") dok.exitPointerLock();
    // the view stays as it is: the orbit target is in front of the camera, as far away as it was at the start
    const p = pos(), blick = blickRichtung(l.gier, l.nick);
    controls.target.set(p[0] + blick[0] * l.zielAbstand, p[1] + blick[1] * l.zielAbstand, p[2] + blick[2] * l.zielAbstand);
    controls.enabled = l.warAktiviert;
    if (typeof controls.update === "function") controls.update();
    nachBewegung();
    melden();
  }

  // ---- wheel: zoom towards the pointer, or the speed level in walk mode ----------------------------------------------------
  /** @type {{x: number, y: number, t: number, punkt: Vek3}|null} */
  let radAnker = null;
  const onRad = (/** @type {WheelEvent} */ e) => {
    if (e.target !== element) return;
    if (lauf) {
      e.preventDefault(); e.stopPropagation();
      if (e.deltaY) stufeSetzen(laufStufeSchalten(lauf.stufe, -e.deltaY));
      return;
    }
    e.stopPropagation(); // OrbitControls must not zoom towards its target on top of this
    if (!frei()) return;
    e.preventDefault();
    const jetzt = performance.now();
    if (!radAnker || radAnker.x !== e.clientX || radAnker.y !== e.clientY || jetzt - radAnker.t > RAD_ANKER_MS) {
      radAnker = { x: e.clientX, y: e.clientY, t: jetzt, punkt: ankerBei(e.clientX, e.clientY) };
    }
    radAnker.t = jetzt;
    const p = pos(), z = ziel();
    if (parallel()) {
      const neu = zoomParallel({ position: p, ziel: z, punkt: radAnker.punkt, rasten: radRasten(e.deltaY, e.deltaMode) });
      setzen(neu.position, neu.ziel);
      return;
    }
    const v = zoomSchritt({ position: p, punkt: radAnker.punkt, rasten: radRasten(e.deltaY, e.deltaMode) });
    setzen([p[0] + v[0], p[1] + v[1], p[2] + v[2]], [z[0] + v[0], z[1] + v[1], z[2] + v[2]]);
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onUp);
  huelle.addEventListener("wheel", onRad, { capture: true, passive: false });
  huelle.addEventListener("pointerdown", onHuelleRunter, true);
  for (const name of STILL) huelle.addEventListener(name, onHuelleStill, true);

  return {
    laufStarten,
    laufBeenden,
    laufAktiv: () => !!lauf,
    zustand,
    verwerfen: () => {
      laufBeenden();
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      huelle.removeEventListener("wheel", onRad, { capture: true });
      huelle.removeEventListener("pointerdown", onHuelleRunter, true);
      for (const name of STILL) huelle.removeEventListener(name, onHuelleStill, true);
      controls.mouseButtons = altesMausbild;
    },
  };
}
