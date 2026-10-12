// useFenster.js — React hook around fensterBereich (72-21, register no. 134).
//
// Draws only the visible rows of a long table. Built in-house on purpose: the project
// rule is "no new dependency when it works without", and a fixed-container window with
// a measured mean row height is a few dozen lines (react-window & co. would add a
// package for that).
//
// Use:
//   const f = useFenster({ anzahl: liste.length });
//   <div {...f.scrollProps}>            // the scroll container (max. 32 rem high when active)
//     <table><tbody ref={f.koerperRef}>
//       {f.vorher > 0 && <tr data-fenster-abstand style={{ height: f.vorher }} />}
//       {liste.slice(f.start, f.ende).map(...)}
//       {f.nachher > 0 && <tr data-fenster-abstand style={{ height: f.nachher }} />}
//
// Row height: measured after every render as the mean height of the drawn rows (rows
// with `data-fenster-abstand` are spacers and not counted). Rows of different height
// (a second text line, a badge) therefore cost a slightly wrong scrollbar, never a
// wrong row — the visible rows are always the drawn ones.
//
// Printing: while the page prints (beforeprint/afterprint and the `print` media query)
// the window is off and every row is drawn; the container class drops its height
// limit in print. The windowed screen list thus prints the full list.
//
// In:  anzahl (rows), ab (threshold, rows), ueberhang (rows).
// Out: {aktiv, start, ende, vorher, nachher, scrollProps, koerperRef}.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fensterBereich, FENSTER_AB, FENSTER_UEBERHANG, FENSTER_ZEILENHOEHE } from "../lib/fenster.js";

/** Visible height of an active scroll container (px) — equals the class `max-h-[32rem]`. */
export const FENSTER_HOEHE_PX = 512;

/** Class of an active scroll container: fixed height limit on screen, none in print. */
const SCROLL_KLASSE = "max-h-[32rem] overflow-auto print:max-h-none print:overflow-visible";

/**
 * True while the page is being printed. Listens to beforeprint/afterprint (window.print,
 * Ctrl+P) and to the `print` media query (print preview, Playwright `emulateMedia`).
 * @returns {boolean}
 */
function useDruck() {
  const [druck, setDruck] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("print").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const an = () => setDruck(true);
    const aus = () => setDruck(false);
    const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const wechsel = () => setDruck(!!mql?.matches);
    window.addEventListener("beforeprint", an);
    window.addEventListener("afterprint", aus);
    mql?.addEventListener?.("change", wechsel);
    return () => {
      window.removeEventListener("beforeprint", an);
      window.removeEventListener("afterprint", aus);
      mql?.removeEventListener?.("change", wechsel);
    };
  }, []);
  return druck;
}

/**
 * Window over a long list of table rows.
 *
 * @param {{anzahl: number, ab?: number, ueberhang?: number}} p
 *   anzahl    — rows of the (already filtered) list;
 *   ab        — the window switches on above this many rows (default 60);
 *   ueberhang — rows drawn above and below the visible part (default 8).
 * @returns {{
 *   aktiv: boolean,
 *   start: number, ende: number,
 *   vorher: number, nachher: number,
 *   scrollProps: {ref: (el: HTMLElement|null) => void, onScroll?: () => void, className: string, "data-fenster": string},
 *   koerperRef: React.MutableRefObject<any>,
 * }} start/ende — row indices to draw (ende exclusive); vorher/nachher — spacer heights (px).
 */
export function useFenster({ anzahl, ab = FENSTER_AB, ueberhang = FENSTER_UEBERHANG }) {
  const druck = useDruck();
  const aktiv = !druck && anzahl > ab;
  const [scrollTop, setScrollTop] = useState(0);
  const [zeilenHoehe, setZeilenHoehe] = useState(FENSTER_ZEILENHOEHE);
  const containerRef = useRef(/** @type {HTMLElement|null} */ (null));
  // `any`: the ref goes onto a <tbody>, whose ref type is HTMLTableSectionElement.
  const koerperRef = useRef(/** @type {any} */ (null));
  const rafRef = useRef(0);

  const onScroll = useCallback(() => {
    // One state update per frame — scroll events fire faster than the screen paints.
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(containerRef.current?.scrollTop || 0);
    });
  }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const bereich = aktiv
    ? fensterBereich({ scrollTop, hoehe: containerRef.current?.clientHeight || FENSTER_HOEHE_PX, anzahl, zeilenHoehe, ueberhang })
    : { start: 0, ende: anzahl, vorher: 0, nachher: 0 };

  // Measure the mean height of the drawn rows; a change of more than half a pixel
  // triggers one more render (converges after one or two passes).
  useLayoutEffect(() => {
    if (!aktiv || !koerperRef.current) return;
    let summe = 0;
    let n = 0;
    for (const zeile of /** @type {HTMLElement[]} */ (Array.from(koerperRef.current.children))) {
      if (zeile.hasAttribute("data-fenster-abstand")) continue;
      summe += zeile.getBoundingClientRect().height;
      n += 1;
    }
    if (n === 0 || summe <= 0) return;
    const mittel = summe / n;
    if (Math.abs(mittel - zeilenHoehe) > 0.5) setZeilenHoehe(mittel);
  });

  const ref = useCallback((/** @type {HTMLElement|null} */ el) => { containerRef.current = el; }, []);

  return {
    aktiv,
    ...bereich,
    scrollProps: aktiv
      ? { ref, onScroll, className: SCROLL_KLASSE, "data-fenster": "an" }
      : { ref, className: "", "data-fenster": "aus" },
    koerperRef,
  };
}
