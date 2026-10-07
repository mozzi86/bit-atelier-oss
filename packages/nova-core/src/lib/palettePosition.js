// Placement of a cursor-following context palette (Phase 75-04, MS-04).
//
// The palette must never cover the polygon being edited and never leave the
// viewport. Candidates around the pointer in fixed order [ASSUMED]
// (Loesungskatalog Blatt 04): SO (bottom right), SW, NO, NW, each `abstand`
// px away from the pointer; the first candidate that intersects neither the
// avoid box nor the viewport border wins, otherwise SO clamped to the viewport.
//
// In:  all values in CSS px of the same container.
// Out: {x, y, ecke} top-left position of the palette.
// Pure module, no DOM, node-testable.

/** Default gap between pointer and palette, px [ASSUMED] Blatt 04. */
export const PALETTE_ABSTAND_PX = 28;

/**
 * Axis-aligned rectangle intersection (touching edges do not count).
 * @param {{x0:number,y0:number,x1:number,y1:number}} a
 * @param {{x0:number,y0:number,x1:number,y1:number}} b
 * @returns {boolean}
 */
export function schneidet(a, b) {
  if (!a || !b) return false;
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/**
 * Linear interpolation (used for the inertia of the palette).
 * @param {number} a
 * @param {number} b
 * @param {number} t 0..1
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Chooses the palette position.
 * @param {{x:number,y:number}} anker pointer position, px
 * @param {{w:number,h:number}} groesse palette size, px
 * @param {{x0:number,y0:number,x1:number,y1:number}|null} meide box to avoid (polygon bbox), px
 * @param {{w:number,h:number}} viewport container size, px
 * @param {number} [abstand] gap in px (default PALETTE_ABSTAND_PX)
 * @returns {{x:number, y:number, ecke:"SO"|"SW"|"NO"|"NW"|"SO-geklemmt"}}
 */
export function palettePosition(anker, groesse, meide, viewport, abstand = PALETTE_ABSTAND_PX) {
  const { w, h } = groesse;
  /** @type {Array<{ecke: "SO"|"SW"|"NO"|"NW", x: number, y: number}>} */
  const kandidaten = [
    { ecke: "SO", x: anker.x + abstand, y: anker.y + abstand },
    { ecke: "SW", x: anker.x - abstand - w, y: anker.y + abstand },
    { ecke: "NO", x: anker.x + abstand, y: anker.y - abstand - h },
    { ecke: "NW", x: anker.x - abstand - w, y: anker.y - abstand - h },
  ];
  for (const k of kandidaten) {
    const box = { x0: k.x, y0: k.y, x1: k.x + w, y1: k.y + h };
    const imViewport = box.x0 >= 0 && box.y0 >= 0 && box.x1 <= viewport.w && box.y1 <= viewport.h;
    if (imViewport && !schneidet(box, meide)) return { x: k.x, y: k.y, ecke: k.ecke };
  }
  const x = Math.max(0, Math.min(viewport.w - w, anker.x + abstand));
  const y = Math.max(0, Math.min(viewport.h - h, anker.y + abstand));
  return { x, y, ecke: "SO-geklemmt" };
}
