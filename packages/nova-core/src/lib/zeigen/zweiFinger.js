// 106-07: touch gestures of the 3D views, as a pure tracker (no DOM, no three.js, node-testable). It follows the pointers
// that are down on a canvas and, while exactly two of them are, reports per move how the pair changed since the last
// move: pinch (zoom factor), twist (rotation angle) and the shift of their middle. A viewer maps that to its camera
// (pinch = closer/further, twist = turn around the vertical axis, shift = pan). One pointer stays the viewer's own
// business (tap = select, drag = orbit). Pattern of the sketch canvas (second finger = gesture, never ink/select).
//
// It also remembers whether a gesture happened since the first pointer went down: the last finger to lift after a pinch
// must never count as a tap that selects whatever lies under it.
//
// Part of the prerequisite 105-16 (pen/touch on the drawing pages) that 106-07 needs.
//
// In:  pointer id + client position in px per event. Out: zweiFingerGeste(), fingerLage(), fingerSchritt().

/**
 * Where a finger pair is.
 * @typedef {{abstand: number, winkel: number, mitte: {x: number, y: number}}} FingerLage
 *   abstand in px; winkel in rad (screen frame, y down; atan2 of b - a); mitte in client px
 */

/**
 * Change of a finger pair between two moves.
 * @typedef {{faktor: number, drehungRad: number, dx: number, dy: number, mitte: {x: number, y: number}}} FingerSchritt
 *   faktor: new distance / old distance (> 1 = fingers apart = zoom in); drehungRad: change of the angle, -PI..PI,
 *   positive = clockwise on screen (y points down); dx/dy: shift of the middle, px; mitte: the new middle, px
 */

/** Below this distance, px, two contacts are treated as one spot: no zoom and no twist from them (noise). */
export const MIN_ABSTAND_PX = 8;

/**
 * @param {{x: number, y: number}} a  First contact, px.
 * @param {{x: number, y: number}} b  Second contact, px.
 * @returns {FingerLage}
 */
export function fingerLage(a, b) {
  return {
    abstand: Math.hypot(b.x - a.x, b.y - a.y),
    winkel: Math.atan2(b.y - a.y, b.x - a.x),
    mitte: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/**
 * Change from one pair position to the next.
 * @param {FingerLage} vorher
 * @param {FingerLage} nachher
 * @returns {FingerSchritt}
 */
export function fingerSchritt(vorher, nachher) {
  const nah = vorher.abstand < MIN_ABSTAND_PX || nachher.abstand < MIN_ABSTAND_PX;
  let d = nachher.winkel - vorher.winkel;
  // the shortest way round: atan2 jumps from +PI to -PI when the pair turns through the left
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return {
    faktor: nah ? 1 : nachher.abstand / vorher.abstand,
    drehungRad: nah ? 0 : d,
    dx: nachher.mitte.x - vorher.mitte.x,
    dy: nachher.mitte.y - vorher.mitte.y,
    mitte: nachher.mitte,
  };
}

/**
 * Tracker of the pointers on one canvas.
 * @returns {{
 *   runter: (id: number, x: number, y: number) => number,
 *   bewegt: (id: number, x: number, y: number) => FingerSchritt|null,
 *   hoch: (id: number) => number,
 *   anzahl: () => number,
 *   warGeste: () => boolean,
 *   zuruecksetzen: () => void,
 * }}
 *   runter/hoch: report a pointer down/up (or cancel), return how many are down now; bewegt: report a move, returns the
 *   change of the pair while exactly two are down (else null); warGeste: two or more were down since the first one went
 *   down (reset when the last one lifts and a new first one goes down).
 */
export function zweiFingerGeste() {
  /** @type {Map<number, {x: number, y: number}>} */
  const zeiger = new Map();
  /** @type {FingerLage|null} */
  let lage = null;
  let geste = false;

  const paar = () => {
    const [a, b] = [...zeiger.values()];
    return fingerLage(a, b);
  };

  return {
    runter(id, x, y) {
      if (zeiger.size === 0) geste = false;
      zeiger.set(id, { x, y });
      if (zeiger.size >= 2) geste = true;
      lage = zeiger.size === 2 ? paar() : null;
      return zeiger.size;
    },
    bewegt(id, x, y) {
      if (!zeiger.has(id)) return null;
      zeiger.set(id, { x, y });
      if (zeiger.size !== 2) return null;
      const neu = paar();
      const schritt = lage ? fingerSchritt(lage, neu) : null;
      lage = neu;
      return schritt;
    },
    hoch(id) {
      zeiger.delete(id);
      // a pair that becomes a single finger again starts a fresh measurement when a second one comes back
      lage = zeiger.size === 2 ? paar() : null;
      return zeiger.size;
    },
    anzahl: () => zeiger.size,
    warGeste: () => geste,
    zuruecksetzen() { zeiger.clear(); lage = null; geste = false; },
  };
}
