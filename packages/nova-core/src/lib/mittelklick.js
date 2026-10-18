// Middle-button multi-click detector (101-01, user 18.10.2026): two or three clicks on the mouse wheel
// = "zoom extents", the CAD convention (AutoCAD: double-click the wheel). Browsers do not count
// `detail` reliably for the middle button, so the clicks are counted here.
//
// In:  the pointer/mouse down events of one element. Out: true on the 2nd (and 3rd) click within
// the time window. Pure, no DOM — the caller wires it to its own listener.

/** Max. pause between two wheel clicks, ms. [ASSUMED] Windows default double-click time is 500 ms. */
export const MITTELKLICK_MS = 450;

/**
 * Creates a counter for middle-button clicks.
 * @param {number} [fenster] max. pause between clicks, ms
 * @returns {(e: {button: number, timeStamp?: number}) => boolean} true when this press makes it a multi-click
 */
export function mittelklickZaehler(fenster = MITTELKLICK_MS) {
  let letzte = -Infinity, anzahl = 0;
  return (e) => {
    if (e.button !== 1) return false;
    const t = Number.isFinite(e.timeStamp) ? Number(e.timeStamp) : Date.now();
    anzahl = t - letzte <= fenster ? anzahl + 1 : 1;
    letzte = t;
    return anzahl >= 2;
  };
}
