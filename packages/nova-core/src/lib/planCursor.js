// Plan cursors as SVG data URIs (Phase 75-01, MS-01).
//
// Why not the browser cursors `move` / `crosshair`: they have no defined
// 1-px hotspot and look different per OS, so the user cannot see WHICH point
// the handle will move. Every cursor here is 21 × 21 px with the hotspot at
// (10, 10) — exactly on the crosshair centre — and a white halo so it stays
// visible on the blue footprint as well as on the white site.
//
// In:  edge angle in degrees (for kantenCursor).
// Out: CSS `cursor` values (`url("data:…") 10 10, <fallback>`).
// Pure module, no DOM — node-testable.

/** Cursor size in CSS px (square). */
export const CURSOR_PX = 21;
/** Hotspot (CSS px) — the crosshair centre. */
export const HOTSPOT = 10;

const INK = "#0f172a";
const HALO = "#ffffff";

/** Crosshair primitives shared by every cursor (two 1-px lines + 1-px dot). */
function kreuz() {
  const c = HOTSPOT + 0.5; // +0.5 keeps the 1-px line on a pixel centre
  return (
    `<path d="M${c} 1V${CURSOR_PX - 1}M1 ${c}H${CURSOR_PX - 1}" stroke="${HALO}" stroke-width="3" fill="none"/>` +
    `<path d="M${c} 1V${CURSOR_PX - 1}M1 ${c}H${CURSOR_PX - 1}" stroke="${INK}" stroke-width="1" fill="none"/>` +
    `<rect x="${HOTSPOT}" y="${HOTSPOT}" width="1" height="1" fill="${INK}"/>`
  );
}

function svg(inner) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_PX}" height="${CURSOR_PX}" viewBox="0 0 ${CURSOR_PX} ${CURSOR_PX}">` +
    inner +
    "</svg>"
  );
}

/**
 * Builds a CSS cursor value from an SVG string.
 * @param {string} svgMarkup complete <svg> element
 * @param {number} hx hotspot x in CSS px
 * @param {number} hy hotspot y in CSS px
 * @param {string} fallback CSS cursor keyword used when the image cannot load
 * @returns {string} e.g. `url("data:image/svg+xml,…") 10 10, crosshair`
 */
export function cursorCss(svgMarkup, hx, hy, fallback) {
  return `url("data:image/svg+xml,${encodeURIComponent(svgMarkup)}") ${hx} ${hy}, ${fallback}`;
}

/** Surface: show / measure / set — plain crosshair. */
export const FADENKREUZ_CURSOR = cursorCss(svg(kreuz()), HOTSPOT, HOTSPOT, "crosshair");

/** Corner handle: crosshair + small circle bottom right. */
export const ECKE_CURSOR = cursorCss(
  svg(kreuz() + `<circle cx="16" cy="16" r="3" fill="${HALO}" stroke="${INK}" stroke-width="1"/>`),
  HOTSPOT,
  HOTSPOT,
  "crosshair"
);

/** Edge midpoint: crosshair + "+" bottom right (insert a corner). */
export const PLUS_CURSOR = cursorCss(
  svg(kreuz() + `<path d="M16 13V19M13 16H19" stroke="${HALO}" stroke-width="3"/><path d="M16 13V19M13 16H19" stroke="${INK}" stroke-width="1"/>`),
  HOTSPOT,
  HOTSPOT,
  "copy"
);

/** Cached edge cursors, one per 22.5° step (8 variants). */
const KANTEN_CACHE = new Map();

/**
 * Normalises an edge angle to [0, 180) degrees (an edge has no direction).
 * @param {number} winkelGrad angle of the edge in degrees, any range
 * @returns {number} degrees in [0, 180)
 */
export function normiereKantenWinkel(winkelGrad) {
  const w = Number.isFinite(winkelGrad) ? winkelGrad : 0;
  return ((w % 180) + 180) % 180;
}

/**
 * Double-arrow cursor PERPENDICULAR to an edge — "push this side".
 * The edge angle is snapped to 8 steps of 22.5° so at most 8 images exist.
 * @param {number} winkelGrad edge angle in degrees (0 = horizontal edge)
 * @returns {string} CSS cursor value with a resize keyword as fallback
 */
export function kantenCursor(winkelGrad) {
  const norm = normiereKantenWinkel(winkelGrad);
  const stufe = Math.round(norm / 22.5) % 8; // 0..7
  if (KANTEN_CACHE.has(stufe)) return KANTEN_CACHE.get(stufe);
  const kante = stufe * 22.5;
  // Arrow points along the edge NORMAL: rotate a vertical double arrow by the
  // edge angle (vertical arrow = normal of a horizontal edge).
  const arrow =
    `<g transform="rotate(${kante} ${HOTSPOT + 0.5} ${HOTSPOT + 0.5})">` +
    `<path d="M10.5 3V18M7 6.5L10.5 3L14 6.5M7 14.5L10.5 18L14 14.5" stroke="${HALO}" stroke-width="3.5" fill="none" stroke-linecap="round"/>` +
    `<path d="M10.5 3V18M7 6.5L10.5 3L14 6.5M7 14.5L10.5 18L14 14.5" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
    "</g>";
  // Fallback keyword by the direction of the NORMAL (edge 0° → ns-resize).
  const fallback = [
    "ns-resize", "nesw-resize", "nesw-resize", "ew-resize",
    "ew-resize", "nwse-resize", "nwse-resize", "ns-resize",
  ][stufe];
  const css = cursorCss(svg(arrow), HOTSPOT, HOTSPOT, fallback);
  KANTEN_CACHE.set(stufe, css);
  return css;
}

/** Number of cached edge variants — exposed for tests. */
export function kantenCacheGroesse() {
  return KANTEN_CACHE.size;
}
