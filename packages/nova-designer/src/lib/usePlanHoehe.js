// usePlanHoehe — plan canvas height derived from the browser window height
// (75-16, Sichtprüfung 07.10.2026: "alle zeichnungs fenster sind so eingeengt").
//
// BimPlan2D takes a fixed pixel `height`; at 420 px the plan stayed small even
// after the page width limit was lifted, because the SVG is height-bound. This
// hook returns a height that grows with the window but never drops below the
// previous fixed value, so small windows (and the 1280 × 720 Playwright
// default) render exactly as before.
//
// In:  min / reserve / max in screen pixels.
// Out: one integer height in screen pixels; re-renders on window resize.

import { useEffect, useState } from "react";

/**
 * Height for a plan canvas: window height minus the chrome above/below it,
 * clamped to [min, max].
 *
 * @param {{ min?: number, reserve?: number, max?: number }} [opts]
 *   min     – lower bound in px (the old fixed height; default 420)
 *   reserve – px kept free for page header, tabs and card chrome (default 300)
 *   max     – upper bound in px (default 1100)
 * @returns {number} canvas height in px
 */
export function usePlanHoehe({ min = 420, reserve = 300, max = 1100 } = {}) {
  const berechne = () => {
    const h = typeof window === "undefined" ? 0 : window.innerHeight || 0;
    return Math.round(Math.max(min, Math.min(max, h - reserve)));
  };
  const [hoehe, setHoehe] = useState(berechne);
  useEffect(() => {
    const onResize = () => setHoehe(berechne());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // berechne closes over min/reserve/max only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, reserve, max]);
  return hoehe;
}
