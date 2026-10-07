// Golden-ratio house rule (Phase 75-02, MS-02).
//
// Office design rule [ASSUMED] (Loesungskatalog Blatt 00, 20.09.2026): every
// rectangle that is a building body, a storey, a unit or a habitable room has
// the proportion phi = 1 : 1.618 within +-3 %. No building-law basis; the UI
// labels it "Buerostandard". The rule is a MAGNET (snap while dragging) and a
// KPI (which edge to move by how much), never a prohibition.
//
// In:  rectangle dimensions in metres, polygons as [{x, y}] in metres.
// Out: snapped dimensions (m), proportion hints (de-DE strings).
// Pure module, no DOM, node-testable. Consumers: MassingStudio (75-02/03),
// later tesselierung (75-07) and WohnungsFokus (75-09).

/** phi = (1 + sqrt 5) / 2 = 1.618... */
export const PHI = (1 + Math.sqrt(5)) / 2;

/** Tolerance band +-3 % -> 1 : 1.55 ... 1.70 [ASSUMED] office standard (Blatt 00). */
export const PHI_TOLERANZ = 0.03;

/**
 * Room categories exempt from the rule: corridors, storage, sanitary rooms,
 * galley kitchens. Keys = `art` values of wohnungsTypen.js (ART.flur /
 * ART.abstell / ART.sanitaer / ART.kueche). Stair and lift cores of the
 * tesselierung carry raumart "flur". [ASSUMED] list from Blatt 00.
 */
export const PHI_AUSNAHMEN = ["flur", "abstell", "sanitaer", "kueche"];

const fmt = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Side ratio >= 1 of a rectangle.
 * @param {number} w width in m
 * @param {number} d depth in m
 * @returns {number|null} max/min, or null when a side is 0 or not finite
 */
export function verhaeltnis(w, d) {
  if (!Number.isFinite(w) || !Number.isFinite(d) || w <= 0 || d <= 0) return null;
  return Math.max(w, d) / Math.min(w, d);
}

/**
 * Is a ratio inside the phi band?
 * @param {number|null} v side ratio (>= 1)
 * @param {number} [tol] relative tolerance (default PHI_TOLERANZ)
 * @returns {boolean}
 */
export function imBand(v, tol = PHI_TOLERANZ) {
  return Number.isFinite(v) && Math.abs(v - PHI) / PHI <= tol;
}

/**
 * Snap target for the dragged dimension. Candidates are other*phi and
 * other/phi; the nearer one wins when the current value is within `tol`.
 * Hand check: phiSnap({w:16.0, d:10}, "w") = 16.18; ({w:15.0, d:10}, "w") = null.
 * @param {{w: number, d: number}} rect dimensions in m
 * @param {"w"|"d"} achse the dimension the user is changing
 * @param {number} [tol] relative tolerance
 * @returns {number|null} target length in m (2 decimals) or null (no snap)
 */
export function phiSnap(rect, achse, tol = PHI_TOLERANZ) {
  const ist = achse === "d" ? rect?.d : rect?.w;
  const anderes = achse === "d" ? rect?.w : rect?.d;
  if (!Number.isFinite(ist) || !Number.isFinite(anderes) || anderes <= 0 || ist <= 0) return null;
  const kandidaten = [anderes * PHI, anderes / PHI];
  const ziel = kandidaten.reduce((best, k) => (Math.abs(k - ist) < Math.abs(best - ist) ? k : best));
  if (Math.abs(ist - ziel) / ziel > tol) return null;
  return Math.round(ziel * 100) / 100;
}

/**
 * Axis-parallel rectangle test: 4 points, edges alternating horizontal/vertical.
 * @param {{x:number,y:number}[]} points polygon in m
 * @param {number} [eps] tolerance in m (default 0.01)
 * @returns {boolean}
 */
export function istAchsparallelesRechteck(points, eps = 0.01) {
  if (!Array.isArray(points) || points.length !== 4) return false;
  const richtung = (a, b) => {
    const h = Math.abs(a.y - b.y) <= eps && Math.abs(a.x - b.x) > eps;
    const v = Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) > eps;
    return h ? "h" : v ? "v" : null;
  };
  for (let i = 0; i < 4; i += 1) {
    const r1 = richtung(points[i], points[(i + 1) % 4]);
    const r2 = richtung(points[(i + 1) % 4], points[(i + 2) % 4]);
    if (!r1 || !r2 || r1 === r2) return false;
  }
  return true;
}

/**
 * KPI text for the proportion of a bounding box.
 * Preference [ASSUMED]: LENGTHEN the long side to short*phi (a building rarely
 * gets shorter by choice); shorten the short side only when lengthening would
 * cost more than twice as much. Hand check: 12 x 12 -> "Ostkante +7,42 m".
 * @param {{w:number, d:number}} bbox dimensions in m (w along x = Ost, d along y = Sued)
 * @param {{istRechteck?: boolean, kanten?: {w: string, d: string}}} [opt]
 *   istRechteck=false marks the value as a bbox approximation; kanten = edge names
 * @returns {{verhaeltnis: number|null, status: "gruen"|"gelb"|"offen", text: string, naeherung: boolean}}
 */
export function proportionHinweis(bbox, opt = {}) {
  const { istRechteck = true, kanten = { w: "Ostkante", d: "Südkante" } } = opt;
  const v = verhaeltnis(bbox?.w, bbox?.d);
  const naeherung = !istRechteck;
  if (v === null) return { verhaeltnis: null, status: "offen", text: "", naeherung };
  if (imBand(v)) return { verhaeltnis: v, status: "gruen", text: `1 : ${fmt(v)} φ`, naeherung };
  const { w, d } = bbox;
  const lang = Math.max(w, d), kurz = Math.min(w, d);
  const langAchse = w >= d ? "w" : "d";
  const kurzAchse = langAchse === "w" ? "d" : "w";
  const dLang = kurz * PHI - lang; // long side -> kurz*phi
  const dKurz = lang / PHI - kurz; // short side -> lang/phi
  // Prefer the option that LENGTHENS a side; take the shortening option only
  // when lengthening would cost more than twice as much.
  const optionen = [{ delta: dLang, achse: langAchse }, { delta: dKurz, achse: kurzAchse }];
  const laenger = optionen.filter((o) => o.delta > 0);
  let wahl;
  if (laenger.length === 1) {
    const l = laenger[0], s = optionen.find((o) => o !== l);
    wahl = Math.abs(l.delta) <= 2 * Math.abs(s.delta) ? l : s;
  } else {
    wahl = optionen.reduce((p, q) => (Math.abs(p.delta) <= Math.abs(q.delta) ? p : q));
  }
  const delta = wahl.delta;
  const kante = kanten[wahl.achse];
  const vz = delta >= 0 ? "+" : "−";
  return { verhaeltnis: v, status: "gelb", text: `${kante} ${vz}${fmt(Math.abs(delta))} m → φ`, naeherung };
}
