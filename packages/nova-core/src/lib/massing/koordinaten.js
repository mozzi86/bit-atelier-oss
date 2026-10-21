// Coordinate input of the CAD command line (phase 104-02, user 19.10.2026). Idea: the AutoCAD-style input
// grammar as seen in the Craft apps (cadcraft); own implementation, German number format.
//
// Forms (spaces ignored, units m / cm / mm, decimal comma or point; ";" separates the two values because the
// comma is the German decimal sign):
//   5,40          length in the direction of the pointer from the last point ("show direction, type length")
//   @3;4          relative to the last point (Δx; Δy), Δy counted towards plan north (up)
//   @10<30        polar from the last point: distance < angle in degrees, 0° = east, counter-clockwise
//   #12;8         absolute site coordinates (x; y), y towards plan north
//
// Plan convention: the site plan / Massing plan store y growing DOWNWARDS (screen); the typed y and the angle
// are given the drafting way (north = up) and are flipped here — so "@0;5" draws 5 m upwards on screen.
//
// In: text, last point, pointer (plan metres, y down). Out: the target point or a reason why not.

const ZAHL = /^(-?\d+(?:[.,]\d+)?)(mm|cm|m)?$/;

/**
 * Number with optional unit → metres.
 * @param {string} s
 * @returns {number|null}
 */
export function meterLesen(s) {
  const k = ZAHL.exec(String(s || "").trim().toLowerCase());
  if (!k) return null;
  const v = Number(k[1].replace(",", "."));
  return k[2] === "mm" ? v / 1000 : k[2] === "cm" ? v / 100 : v;
}

/**
 * Parse a coordinate input.
 * @param {string} text
 * @returns {{art: 'laenge', wert: number} | {art: 'relativ', dx: number, dy: number} | {art: 'polar', abstand: number, winkel: number} | {art: 'absolut', x: number, y: number} | null}
 *   dy / y / winkel in the drafting convention (north = up, counter-clockwise); metres, degrees
 */
export function koordinateLesen(text) {
  const t = String(text || "").replace(/\s+/g, "").toLowerCase();
  if (!t) return null;
  const paar = (s) => {
    const teile = s.split(";");
    if (teile.length !== 2) return null;
    const a = meterLesen(teile[0]), b = meterLesen(teile[1]);
    return a != null && b != null ? [a, b] : null;
  };
  if (t.startsWith("#")) {
    const p = paar(t.slice(1));
    return p ? { art: "absolut", x: p[0], y: p[1] } : null;
  }
  if (t.startsWith("@")) {
    const rest = t.slice(1);
    if (rest.includes("<")) {
      const [a, w] = rest.split("<");
      const abstand = meterLesen(a);
      const winkel = /^-?\d+(?:[.,]\d+)?$/.test(w || "") ? Number(w.replace(",", ".")) : null;
      return abstand != null && winkel != null ? { art: "polar", abstand, winkel } : null;
    }
    const p = paar(rest);
    return p ? { art: "relativ", dx: p[0], dy: p[1] } : null;
  }
  const v = meterLesen(t);
  return v != null ? { art: "laenge", wert: v } : null;
}

/**
 * Target point of a parsed input in plan metres (y down).
 * @param {ReturnType<typeof koordinateLesen>} e parsed input
 * @param {{letzter?: {x:number,y:number}|null, cursor?: {x:number,y:number}|null}} lage last point and pointer
 * @returns {{punkt: {x:number,y:number}} | {fehler: string}}
 */
export function zielPunkt(e, { letzter = null, cursor = null } = {}) {
  if (!e) return { fehler: "Eingabe nicht verstanden" };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  if (e.art === "absolut") return { punkt: { x: r3(e.x), y: r3(-e.y) } };
  if (!letzter) return { fehler: "Erst einen Startpunkt klicken" };
  if (e.art === "relativ") return { punkt: { x: r3(letzter.x + e.dx), y: r3(letzter.y - e.dy) } };
  if (e.art === "polar") {
    const w = (e.winkel * Math.PI) / 180;
    return { punkt: { x: r3(letzter.x + Math.cos(w) * e.abstand), y: r3(letzter.y - Math.sin(w) * e.abstand) } };
  }
  if (e.art === "laenge") {
    if (!cursor) return { fehler: "Richtung mit dem Zeiger zeigen, dann die Länge tippen" };
    const dx = cursor.x - letzter.x, dy = cursor.y - letzter.y, d = Math.hypot(dx, dy);
    if (d < 1e-9) return { fehler: "Richtung mit dem Zeiger zeigen, dann die Länge tippen" };
    return { punkt: { x: r3(letzter.x + (dx / d) * e.wert), y: r3(letzter.y + (dy / d) * e.wert) } };
  }
  return { fehler: "Eingabe passt nicht" };
}
