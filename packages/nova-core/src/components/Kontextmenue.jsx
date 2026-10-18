// Kontextmenue — own right-click menu for drawing surfaces (phase 101-07, user 18.10.2026: "der Rechtsklick
// gibt noch browserhafte Popupfenster"). Opens at the pointer, closes on Esc, on a click outside, on scroll
// and after choosing an entry. Entries show their keyboard shortcut like in CAD programs.
//
// In:  useKontextmenue() in the drawing component; oeffnen(event, eintraege) on "contextmenu".
// Out: <KontextmenueAnzeige menue={…} schliessen={…} /> renders the open menu (fixed position, portal-free).
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * @typedef {{label: string, taste?: string, onClick: () => void, disabled?: boolean, gefahr?: boolean, trenner?: boolean}} Eintrag
 * @typedef {{x: number, y: number, eintraege: Eintrag[]}|null} MenueZustand
 */

/**
 * Menu state for one drawing surface.
 * @returns {{menue: MenueZustand, oeffnen: (e: {clientX: number, clientY: number, preventDefault?: () => void}, eintraege: Eintrag[]) => void, schliessen: () => void}}
 */
export function useKontextmenue() {
  const [menue, setMenue] = useState(/** @type {MenueZustand} */ (null));
  const oeffnen = useCallback((e, eintraege) => {
    e.preventDefault?.();
    setMenue({ x: e.clientX, y: e.clientY, eintraege: eintraege.filter(Boolean) });
  }, []);
  const schliessen = useCallback(() => setMenue(null), []);
  return { menue, oeffnen, schliessen };
}

/**
 * The open menu, kept inside the window.
 * @param {{menue: MenueZustand, schliessen: () => void, testid?: string}} props
 */
export function KontextmenueAnzeige({ menue, schliessen, testid = "kontextmenue" }) {
  const ref = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!menue) return undefined;
    const el = ref.current;
    const w = el?.offsetWidth || 220, h = el?.offsetHeight || 200;
    setPos({ x: Math.min(menue.x, window.innerWidth - w - 8), y: Math.min(menue.y, window.innerHeight - h - 8) });
    /** @type {HTMLButtonElement|null} */ (el?.querySelector("button:not([disabled])") ?? null)?.focus();
    const zu = (/** @type {Event} */ ev) => { if (!el?.contains(/** @type {Node} */ (ev.target))) schliessen(); };
    const taste = (/** @type {KeyboardEvent} */ ev) => { if (ev.key === "Escape") { ev.stopPropagation(); schliessen(); } };
    window.addEventListener("pointerdown", zu, true);
    window.addEventListener("keydown", taste, true);
    window.addEventListener("wheel", schliessen, { passive: true });
    window.addEventListener("blur", schliessen);
    return () => {
      window.removeEventListener("pointerdown", zu, true);
      window.removeEventListener("keydown", taste, true);
      window.removeEventListener("wheel", schliessen);
      window.removeEventListener("blur", schliessen);
    };
  }, [menue, schliessen]);
  if (!menue) return null;
  return (
    <div
      ref={ref}
      role="menu"
      data-testid={testid}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[13rem] rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      {menue.eintraege.map((e, i) => (
        <React.Fragment key={`${e.label}-${i}`}>
          {e.trenner && i > 0 && <div className="my-1 h-px bg-border" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={e.disabled}
            onClick={() => { schliessen(); e.onClick(); }}
            className={`flex w-full items-center justify-between gap-6 rounded px-2 py-1.5 text-left hover:bg-muted focus:bg-muted focus:outline-none disabled:pointer-events-none disabled:opacity-40 ${e.gefahr ? "text-fehler" : ""}`}
          >
            <span>{e.label}</span>
            {e.taste && <span className="text-xs text-muted-foreground">{e.taste}</span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
