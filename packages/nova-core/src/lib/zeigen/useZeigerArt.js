// 106-07: which pointer the person is using right now, for the tablet layout of the viewers (big, thumb-reachable speech
// button and bigger confirm buttons). Two sources: the media query "(pointer: coarse)" (a device whose main pointer is a
// finger) and the kind of the last pointer that pressed or hovered on the page. The second one makes a convertible or a
// desktop with a pen tablet switch as soon as it is used with finger or pen, and back when the mouse is used again.
//
// Review 106-07: TABLETT_PLATZ = where the speech field and the proposal cards stand in the tablet layout - fixed at the bottom of the
// screen, not at the bottom of the view (a view of fixed height can reach below the visible part of the page; then the thumb button and
// "Übernehmen" would need scrolling first).
//
// In:  window events (pointerdown, pointermove of a pen), matchMedia. Out: grobeBedienung() (pure), useZeigerArt() (React hook), TABLETT_PLATZ.
import { useEffect, useState } from "react";
import { zeigerArt } from "./strahlPick.js";

/**
 * Tailwind classes of the two overlays in the tablet layout (review fix 106-07), both `fixed` to the screen: the speech field in the
 * bottom right corner (right thumb on a tablet held at its sides), the proposal cards in the bottom left corner, at most 60 % of the
 * screen height and scrolling inside. Widths leave room for each other down to a 768 px wide screen (portrait tablet): 22rem each,
 * the cards at most the screen width minus the speech field's 22rem and the gaps (3rem). 16 px (bottom-4/left-4/right-4) from the edges.
 */
export const TABLETT_PLATZ = Object.freeze({
  sprechen: "fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)]",
  karten: "fixed bottom-4 left-4 z-40 w-[22rem] max-w-[calc(100vw-25rem)] max-h-[60dvh] overflow-y-auto",
});

/** Media query of a device whose primary pointer is coarse (finger). */
export const GROB_MEDIA = "(pointer: coarse)";

/**
 * Whether the views should use the coarse (tablet) layout.
 * @param {import("./strahlPick.js").ZeigerArt|null} letzteArt  Kind of the last pointer used on the page (null = none yet).
 * @param {boolean} mediaGrob  The device reports a coarse primary pointer.
 * @returns {boolean}  true for finger or pen, and for a coarse device until a mouse is used.
 */
export function grobeBedienung(letzteArt, mediaGrob) {
  if (letzteArt === "touch" || letzteArt === "pen") return true;
  if (letzteArt === "mouse") return false;
  return !!mediaGrob;
}

/** @returns {boolean} the media query matches (false without a window, e.g. in node) */
function mediaJetzt() {
  try { return typeof window !== "undefined" && !!window.matchMedia?.(GROB_MEDIA).matches; } catch { return false; }
}

/**
 * React hook: the kind of the last pointer and whether the coarse layout applies.
 * Side effect: listeners on window (capture phase, passive) while mounted.
 * @returns {{art: import("./strahlPick.js").ZeigerArt|null, grob: boolean}}
 */
export function useZeigerArt() {
  const [art, setArt] = useState(/** @type {import("./strahlPick.js").ZeigerArt|null} */ (null));
  const [media, setMedia] = useState(mediaJetzt);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const merken = (/** @type {PointerEvent} */ e) => { const a = zeigerArt(e); setArt((alt) => (alt === a ? alt : a)); };
    // a pen hovering over the screen already says "pen" before it touches; a mouse move says nothing (it moves all the time)
    const schweben = (/** @type {PointerEvent} */ e) => { if (e.pointerType === "pen") merken(e); };
    window.addEventListener("pointerdown", merken, { capture: true, passive: true });
    window.addEventListener("pointermove", schweben, { capture: true, passive: true });
    let mq = null;
    const mqNeu = () => setMedia(mediaJetzt());
    try { mq = window.matchMedia?.(GROB_MEDIA) ?? null; mq?.addEventListener?.("change", mqNeu); } catch { mq = null; }
    return () => {
      window.removeEventListener("pointerdown", merken, { capture: true });
      window.removeEventListener("pointermove", schweben, { capture: true });
      mq?.removeEventListener?.("change", mqNeu);
    };
  }, []);
  return { art, grob: grobeBedienung(art, media) };
}
