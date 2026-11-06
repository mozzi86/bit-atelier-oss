// 106-08: a WebXR STAND-IN for the browser test (no device, no polyfill package, no new dependency).
// Injected with page.addInitScript before the app loads. It gives the page what three's WebXRManager needs for an immersive session:
// navigator.xr (isSessionSupported / requestSession), a session with requestAnimationFrame, reference spaces, input sources and
// select / squeeze events, frames with a viewer pose (two eyes side by side) and target-ray poses, and an XRWebGLLayer that renders
// into the page's own canvas (framebuffer null). XRWebGLBinding is hidden so three takes the plain layer road, and
// makeXRCompatible resolves (there is no device to become compatible with).
// The test drives it through window.__xrAttrappe: verbinden(i), zeigen(i, von, nach) in REFERENCE SPACE metres (local-floor: the floor
// under the starting point is the origin, the head stands at 1.6 m), druecken(i, knopf, an), achsen(i, x, y), select(i, an).
// What this proves and what not: the app's real code path through three's real WebXRManager in a real browser - not a headset, not its
// tracking, not its browser (D-IM-03 / D-AW-04: "nicht am Gerät abgenommen").

/* global EventTarget, DOMException -- the stand-in runs in the page (browser globals), this file is linted as node code */

/**
 * The stand-in itself (runs in the page; must not close over anything of this file).
 * @param {{geraet?: boolean}} [opt]  geraet: false = navigator.xr exists but offers no immersive session.
 */
export function xrAttrappe(opt = {}) {
  const Z = { geraet: opt.geraet !== false, erlaubt: true, sitzung: /** @type {any} */ (null), frames: 0, sitzungen: 0, eingaben: /** @type {any[]} */ ([]) };
  const KOPF = [0, 1.6, 0];

  /** Column-major 4x4 from a position and a unit quaternion [x, y, z, w]. */
  const matrix = (p, q) => {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, p[0], p[1], p[2], 1]);
  };
  /** Quaternion that turns -Z onto the direction d (unit). */
  const blick = (d) => {
    const v = [0, 0, -1];
    const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    if (dot < -0.999999) return [0, 1, 0, 0];
    const c = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]];
    const q = [c[0], c[1], c[2], 1 + dot];
    const l = Math.hypot(...q);
    return q.map((x) => x / l);
  };
  const projektion = (aspekt) => {
    const f = 1 / Math.tan(Math.PI / 4), n = 0.05, fa = 1000;
    return new Float32Array([f / aspekt, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0]);
  };

  class Ebene {
    constructor(session, gl) {
      this.framebuffer = null; // the page's canvas
      this.framebufferWidth = gl.drawingBufferWidth;
      this.framebufferHeight = gl.drawingBufferHeight;
      this.ignoreDepthValues = false;
      this.fixedFoveation = 0;
    }
    getViewport(view) {
      const w = Math.floor(this.framebufferWidth / 2);
      return { x: view.eye === "right" ? w : 0, y: 0, width: w, height: this.framebufferHeight };
    }
  }

  class Bild {
    constructor(s) { this.session = s; }
    getViewerPose() {
      const l = this.session.renderState.baseLayer;
      const aspekt = l ? (l.framebufferWidth / 2) / Math.max(1, l.framebufferHeight) : 1;
      const auge = (dx, eye) => ({ eye, projectionMatrix: projektion(aspekt), transform: { matrix: matrix([KOPF[0] + dx, KOPF[1], KOPF[2]], [0, 0, 0, 1]) } });
      return { transform: { matrix: matrix(KOPF, [0, 0, 0, 1]) }, views: [auge(-0.032, "left"), auge(0.032, "right")], emulatedPosition: false };
    }
    getPose(raum) { return raum?.pose ? { transform: { matrix: raum.pose }, emulatedPosition: false } : null; }
  }

  class Sitzung extends EventTarget {
    constructor() {
      super();
      this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000 };
      this.inputSources = [];
      this.visibilityState = "visible";
      this.enabledFeatures = ["local-floor"];
      this.environmentBlendMode = "opaque";
      this.beendet = false;
      this.raf = new Map();
      this.n = 0;
    }
    updateRenderState(s) { Object.assign(this.renderState, s); }
    async requestReferenceSpace(typ) {
      if (!["local-floor", "local", "viewer"].includes(typ)) throw new DOMException(`no ${typ}`, "NotSupportedError");
      return { typ, getOffsetReferenceSpace() { return this; } };
    }
    requestAnimationFrame(cb) {
      const id = ++this.n;
      this.raf.set(id, window.requestAnimationFrame((t) => { this.raf.delete(id); if (!this.beendet) { Z.frames += 1; cb(t, new Bild(this)); } }));
      return id;
    }
    cancelAnimationFrame(id) { const h = this.raf.get(id); if (h) window.cancelAnimationFrame(h); this.raf.delete(id); }
    async end() {
      if (this.beendet) return;
      this.beendet = true;
      for (const h of this.raf.values()) window.cancelAnimationFrame(h);
      this.raf.clear();
      if (Z.sitzung === this) Z.sitzung = null;
      this.dispatchEvent(new Event("end"));
    }
  }

  const xr = new EventTarget();
  Object.assign(xr, {
    isSessionSupported: async (modus) => modus === "immersive-vr" && Z.geraet,
    requestSession: async (modus) => {
      if (modus !== "immersive-vr" || !Z.geraet) throw new DOMException("not supported", "NotSupportedError");
      if (!Z.erlaubt) throw new DOMException("denied by the stand-in", "NotAllowedError");
      if (Z.sitzung) throw new DOMException("already running", "InvalidStateError");
      Z.sitzung = new Sitzung();
      Z.sitzungen += 1;
      return Z.sitzung;
    },
  });
  try { Object.defineProperty(navigator, "xr", { value: xr, configurable: true }); } catch { /* stays as the browser has it */ }
  try { /** @type {any} */ (window).XRWebGLBinding = undefined; } catch { /* not writable: three would take the layers road */ }
  /** @type {any} */ (window).XRWebGLLayer = Ebene;
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (C) C.prototype.makeXRCompatible = function () { return Promise.resolve(); };
  }

  const ereignis = (typ, quelle) => {
    const s = Z.sitzung;
    if (!s) return;
    const e = new Event(typ);
    /** @type {any} */ (e).inputSource = quelle;
    /** @type {any} */ (e).frame = new Bild(s);
    s.dispatchEvent(e);
  };
  const knopf = () => ({ pressed: false, touched: false, value: 0 });
  /** @type {any} */ (window).__xrAttrappe = {
    zustand: Z,
    /** Connects input i (0 right, 1 left) as a tracked controller with an xr-standard pad (art "hand": a hand without pad, "gaze": a gaze ray). */
    verbinden(i, art = "controller") {
      const s = Z.sitzung;
      if (!s) throw new Error("keine Sitzung");
      const q = {
        handedness: i === 0 ? "right" : "left", targetRayMode: art === "gaze" ? "gaze" : "tracked-pointer", profiles: [],
        targetRaySpace: { pose: matrix([0, 1.4, -0.2], [0, 0, 0, 1]) },
        gamepad: art === "controller" ? { mapping: "xr-standard", buttons: [0, 1, 2, 3, 4, 5].map(knopf), axes: [0, 0, 0, 0] } : null,
        hand: null,
      };
      Z.eingaben[i] = q;
      s.inputSources = Z.eingaben.filter(Boolean);
      const e = new Event("inputsourceschange");
      /** @type {any} */ (e).added = [q];
      /** @type {any} */ (e).removed = [];
      s.dispatchEvent(e);
      return true;
    },
    /** Points input i from `von` towards `nach` (reference space, m). */
    zeigen(i, von, nach) {
      const d = [nach[0] - von[0], nach[1] - von[1], nach[2] - von[2]];
      const l = Math.hypot(...d);
      Z.eingaben[i].targetRaySpace.pose = matrix(von, blick(d.map((x) => x / l)));
      return true;
    },
    /** Presses / releases a pad button (0 trigger, 1 grip, 3 stick, 4 A, 5 B). */
    druecken(i, k, an) { const b = Z.eingaben[i].gamepad.buttons[k]; b.pressed = !!an; b.touched = !!an; b.value = an ? 1 : 0; return true; },
    achsen(i, x, y) { Z.eingaben[i].gamepad.axes = [0, 0, x, y]; return true; },
    /** A select (trigger / pinch) as session events, as a hand gives it. */
    select(i, an) { ereignis(an ? "selectstart" : "selectend", Z.eingaben[i]); if (!an) ereignis("select", Z.eingaben[i]); return true; },
    kopf: KOPF,
  };
}
