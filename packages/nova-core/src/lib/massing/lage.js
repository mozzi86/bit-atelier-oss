// Position of the massing body on the site (108-08, D-EFH-09; 108-10 uses the same module for the terrain).
//
// The Massing-Studio draws in SITE metres {x, y}: origin top-left of the drawing field, x east, y south (screen y down), the field is
// the parcel bbox (at least 20 m) and the parcel's vertex mean sits at the field centre (site.w/2, site.d/2). The shared programme store
// keeps the body shape `footprintM` centred on its own origin ({x, z}, metres); before 108-08 the position on the site was lost and every
// opening put the body at (35, 25) m — the centre of the 70 × 50-m stand-in field, outside a small single-family plot.
//
// In:  the site parcel of the site planning (canvas px with m_per_px), the footprint area of the site planning (designated_areas type
//      "footprint", canvas px), the blocks of the site planning (BuildingComplex.buildings[], canvas px plus metre mirror `mitte_m`),
//      the stored programme field `footprintLageM`.
// Out: the drawing field (siteAusParzelle), px ↔ site metres (pxZuSite / siteZuPx), the start position of the body = the ORIGIN of
//      footprintM in site metres (baukoerperLageSite, startLageSite) and the field to store (lageAusPoly).
//
// footprintLageM = offset of the footprintM origin from the parcel's vertex mean, site metres {x: east, z: south}. Without a parcel the
// reference is the centre of the stand-in field (35, 25) m, so those projects behave as before. The ORIGIN (not a centre) is stored on
// purpose: the studio centres footprintM on the bbox, the site planning (footprintToMeters) on the vertex mean — for an L-shape the two
// differ, the origin is unambiguous for both rules.
// Pure module, no DOM, no React.

import { metersPerPixel } from "../geo.js";

/** Stand-in drawing field without a parcel, m. [ASSUMED] tool size since 72-01 A-4 (shown as an assumption in the studio). */
export const ERSATZFELD_M = Object.freeze({ w: 70, d: 50 });
/** Smallest drawing field edge with a parcel, m (a tiny parcel still gets room to draw). */
export const MIN_FELD_M = 20;
/** Canvas centre used as px reference without a parcel (maplibreStyles CANVAS_CENTER), canvas px. */
export const ERSATZ_PX_MITTE = Object.freeze({ cx: 600, cy: 400 });
/** Position changes below this are noise (rounding of the 2-decimal store), m. */
export const LAGE_TOLERANZ_M = 0.01;

/**
 * @typedef {{w: number, d: number, hatParzelle: boolean, mpp: number, cx: number, cy: number}} Feld
 *   w/d = drawing field in m (parcel bbox, at least MIN_FELD_M; stand-in 70 × 50 without parcel), mpp = metres per canvas px,
 *   cx/cy = canvas px that maps to the field centre (vertex mean of the parcel, else ERSATZ_PX_MITTE)
 * @typedef {{x: number, y: number}} SitePunkt site metres (x east, y south)
 * @typedef {{x: number, z: number}} LageM stored offset of the footprint origin from the parcel reference, m (x east, z south)
 */

const zahl = (/** @type {any} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * Drawing field of the Massing-Studio from the site parcel (the rule of MassingStudio since 72-01 A-4, moved here unchanged).
 * @param {any} parcel site_parcel of the site planning ({points: canvas px, m_per_px}) or null
 * @returns {Feld}
 */
export function siteAusParzelle(parcel) {
  const pts = parcel?.points;
  const mpp = metersPerPixel(parcel);
  if (!Array.isArray(pts) || pts.length < 3) return { w: ERSATZFELD_M.w, d: ERSATZFELD_M.d, hatParzelle: false, mpp, cx: ERSATZ_PX_MITTE.cx, cy: ERSATZ_PX_MITTE.cy };
  const xs = pts.map((p) => zahl(p.x));
  const ys = pts.map((p) => zahl(p.y));
  return {
    w: Math.max(MIN_FELD_M, (Math.max(...xs) - Math.min(...xs)) * mpp),
    d: Math.max(MIN_FELD_M, (Math.max(...ys) - Math.min(...ys)) * mpp),
    hatParzelle: true,
    mpp,
    cx: xs.reduce((s, v) => s + v, 0) / pts.length,
    cy: ys.reduce((s, v) => s + v, 0) / pts.length,
  };
}

/**
 * Canvas px → site metres (parcel vertex mean → field centre), rounded to 1 cm like the studio.
 * @param {Array<{x: number, y: number}>|null|undefined} pts canvas px (at least 3 points)
 * @param {Feld} feld drawing field (siteAusParzelle)
 * @returns {SitePunkt[]|null} null with fewer than 3 points
 */
export function pxZuSite(pts, feld) {
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => ({ x: +(feld.w / 2 + (zahl(p.x) - feld.cx) * feld.mpp).toFixed(2), y: +(feld.d / 2 + (zahl(p.y) - feld.cy) * feld.mpp).toFixed(2) }));
}

/**
 * Site metres → canvas px, rounded to whole px like the drawing tools of the site planning.
 * @param {Array<{x: number, y: number}>|null|undefined} pts site metres (at least 3 points)
 * @param {Feld} feld drawing field (siteAusParzelle)
 * @returns {Array<{x: number, y: number}>|null} null with fewer than 3 points
 */
export function siteZuPx(pts, feld) {
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => ({ x: Math.round(feld.cx + (zahl(p.x) - feld.w / 2) / feld.mpp), y: Math.round(feld.cy + (zahl(p.y) - feld.d / 2) / feld.mpp) }));
}

/**
 * Reference point of footprintLageM in site metres: the parcel's vertex mean = the field centre; without a parcel the centre of the
 * stand-in field (35, 25) m — the same point, the field is 70 × 50 then.
 * @param {Feld} feld
 * @returns {SitePunkt}
 */
export function lageBezug(feld) {
  return { x: feld.w / 2, y: feld.d / 2 };
}

/**
 * Where the site planning puts the body: origin of footprintM in site metres, without the stored field.
 * Order (108-08, deliberately different from D-EFH-09): 1. the footprint area of the site planning (it is exactly the area footprintM
 * was taken from, ComplexDesigner; origin = its vertex mean, the centring of footprintToMeters), 2. the first block of
 * BuildingComplex.buildings[] (its centre: `mitte_m` / m_per_px, else the bbox centre of the px rectangle), 3. the parcel centre.
 * Without a parcel: the stand-in field centre (35, 25) m, whatever the site planning holds (projects without parcel stay as before).
 * @param {{footprintFlaechePx?: Array<{x: number, y: number}>|null, buildings?: any[]|null, parcel?: any}} q
 * @returns {SitePunkt & {quelle: "footprint"|"block"|"parzelle"|"ersatzfeld"}}
 */
export function baukoerperLageSite({ footprintFlaechePx = null, buildings = null, parcel = null }) {
  const feld = siteAusParzelle(parcel);
  const mitte = lageBezug(feld);
  if (!feld.hatParzelle) return { ...mitte, quelle: "ersatzfeld" };
  if (Array.isArray(footprintFlaechePx) && footprintFlaechePx.length >= 3) {
    const n = footprintFlaechePx.length;
    const cx = footprintFlaechePx.reduce((s, p) => s + zahl(p.x), 0) / n;
    const cy = footprintFlaechePx.reduce((s, p) => s + zahl(p.y), 0) / n;
    return { x: r2(feld.w / 2 + (cx - feld.cx) * feld.mpp), y: r2(feld.d / 2 + (cy - feld.cy) * feld.mpp), quelle: "footprint" };
  }
  const b = (Array.isArray(buildings) ? buildings : []).find((g) => g && (g.mitte_m || (zahl(g.width) > 0 && zahl(g.height) > 0)));
  if (b) {
    // mitte_m = canvas units × m_per_px (massing/bloecke.js alsGebaeude), i.e. absolute canvas metres, not site metres
    const cx = b.mitte_m && Number.isFinite(Number(b.mitte_m.x)) ? Number(b.mitte_m.x) / feld.mpp : zahl(b.x) + zahl(b.width) / 2;
    const cy = b.mitte_m && Number.isFinite(Number(b.mitte_m.y)) ? Number(b.mitte_m.y) / feld.mpp : zahl(b.y) + zahl(b.height) / 2;
    return { x: r2(feld.w / 2 + (cx - feld.cx) * feld.mpp), y: r2(feld.d / 2 + (cy - feld.cy) * feld.mpp), quelle: "block" };
  }
  return { ...mitte, quelle: "parzelle" };
}

/**
 * Start position of the body when the studio opens: the stored position first, then baukoerperLageSite.
 * @param {{footprintLageM?: LageM|null, footprintFlaechePx?: Array<{x: number, y: number}>|null, buildings?: any[]|null, parcel?: any}} q
 *   footprintLageM = stored programme field (m, relative to lageBezug)
 * @returns {SitePunkt & {quelle: "gespeichert"|"footprint"|"block"|"parzelle"|"ersatzfeld"}} origin of footprintM in site metres
 */
export function startLageSite({ footprintLageM = null, footprintFlaechePx = null, buildings = null, parcel = null }) {
  if (footprintLageM && Number.isFinite(Number(footprintLageM.x)) && Number.isFinite(Number(footprintLageM.z))) {
    const m = lageBezug(siteAusParzelle(parcel));
    return { x: r2(m.x + Number(footprintLageM.x)), y: r2(m.y + Number(footprintLageM.z)), quelle: "gespeichert" };
  }
  return baukoerperLageSite({ footprintFlaechePx, buildings, parcel });
}

/**
 * The field to store for a body drawn at `poly`: origin = bbox centre of the polygon (the centring of the studio's toStore), minus the
 * parcel reference. Inverse of startLageSite for every shape the studio stores (also an L-shape: both use the bbox centre).
 * @param {SitePunkt[]} poly body in site metres (at least 3 points)
 * @param {any} parcel site parcel (null = stand-in field)
 * @returns {LageM|null} m; null without a polygon
 */
export function lageAusPoly(poly, parcel) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  const xs = poly.map((p) => zahl(p.x)), ys = poly.map((p) => zahl(p.y));
  const m = lageBezug(siteAusParzelle(parcel));
  return { x: r2((Math.min(...xs) + Math.max(...xs)) / 2 - m.x), z: r2((Math.min(...ys) + Math.max(...ys)) / 2 - m.y) };
}

/**
 * Whether two stored positions differ by more than LAGE_TOLERANZ_M on either axis (null = no position).
 * @param {LageM|null|undefined} a @param {LageM|null|undefined} b
 * @returns {boolean}
 */
export function lageGeaendert(a, b) {
  if (!a || !b) return Boolean(a) !== Boolean(b);
  return Math.abs(zahl(a.x) - zahl(b.x)) > LAGE_TOLERANZ_M || Math.abs(zahl(a.z) - zahl(b.z)) > LAGE_TOLERANZ_M;
}

/** Programme fields the massing studio may write (108-08, finding 12) - never untergeschosse, geschosse, storeyHeight here. */
export const MASSING_SCHREIBFELDER = Object.freeze(["footprintM", "footprintLageM", "storeys"]);

/**
 * 108-08 (finding 12): the patch the massing studio writes into the shared programme store. Only what the person changed in this
 * step and what differs from the store: opening the studio, switching tabs, loading or taking over another device's change write
 * nothing (before, every mount wrote `{footprintM, storeys: floors}` with the studio's local values - the fallback 6 / a stale
 * storey count among them). The storey table, the basements and the storey height are written by their own inputs, never here.
 * footprintLageM: when the position differs from the store by more than 1 cm. 108-08 review: a body that is back at the place of the
 * last automatic placement (`auto.lage`: Esc of a drag, a drag back, undo to the opened state) gets the record value of that moment
 * (`auto.gespeichert`, null for an old project) - an old record stays without the field until the body really moved, and undo
 * restores it exactly.
 * @param {{footprintM?: Array<{x: number, z: number}>, footprintLageM?: LageM|null, storeys?: number}} lokal values of the studio
 *   (footprintM centred on its bbox, m; footprintLageM m; storeys = storeys above ground)
 * @param {{footprintM?: any, footprintLageM?: any, storeys?: any}} stand the programme store now
 * @param {{form?: boolean, geschosse?: boolean}} nutzer what the person changed: form = the body (shape or position), geschosse = the
 *   storey slider
 * @param {{lage: LageM|null, gespeichert: LageM|null}|null} [auto] the last automatic placement of the studio: its position (m,
 *   lageAusPoly) and the stored footprintLageM at that moment (m or null); omitted = no such rule (behaviour before the review)
 * @returns {Record<string, any>} patch for buildingProgram.set (may be empty)
 */
export function massingSchreibPatch(lokal, stand, nutzer, auto = null) {
  /** @type {Record<string, any>} */
  const patch = {};
  if (nutzer?.geschosse) {
    const n = Number(lokal?.storeys);
    if (Number.isInteger(n) && n >= 1 && n !== stand?.storeys) patch.storeys = n;
  }
  if (nutzer?.form) {
    const fp = lokal?.footprintM;
    if (Array.isArray(fp) && fp.length >= 3) {
      const gerundet = (/** @type {any} */ q) => (Array.isArray(q) ? q.map((p) => ({ x: +zahl(p?.x).toFixed(2), z: +zahl(p?.z).toFixed(2) })) : null);
      if (JSON.stringify(gerundet(fp)) !== JSON.stringify(gerundet(stand?.footprintM))) patch.footprintM = fp;
    }
    const lage = lokal?.footprintLageM;
    if (lage) {
      const amAutoPlatz = Boolean(auto?.lage) && !lageGeaendert(lage, auto?.lage ?? null);
      /** @type {LageM|null} */
      const ziel = amAutoPlatz ? (auto?.gespeichert ?? null) : lage;
      if (lageGeaendert(ziel, stand?.footprintLageM ?? null)) patch.footprintLageM = ziel ? { x: r2(ziel.x), z: r2(ziel.z) } : null;
    }
  }
  return patch;
}

/**
 * Number of own writes the studio keeps to recognise their echo in the store, entries. [ASSUMED] far more than the steps that can be
 * in flight between two renders (fast arrow keys: 1-2); the buffer is consumed by the echoes and cleared by a foreign state anyway.
 */
export const ECHO_PUFFER_MAX = 20;

/**
 * Key of a store state for the echo recognition (body shape + stored position).
 * @param {any} footprintM shape in the store (m) or null @param {any} footprintLageM stored position (m) or null
 * @returns {string}
 */
export function echoSchluessel(footprintM, footprintLageM) {
  return JSON.stringify([footprintM ?? null, footprintLageM ?? null]);
}

/**
 * 108-08 review: remembers an own write of the studio. The base of the fields the patch leaves out is the last remembered write (it
 * may still be in flight, the store render can lag behind), else the store.
 * @param {string[]} puffer remembered own writes (echoSchluessel), oldest first
 * @param {Record<string, any>} patch what the studio writes (footprintM / footprintLageM may be missing)
 * @param {{footprintM?: any, footprintLageM?: any}} stand the programme store now
 * @returns {string[]} new buffer (unchanged when the patch touches neither field)
 */
export function echoMerken(puffer, patch, stand) {
  if (!("footprintM" in patch) && !("footprintLageM" in patch)) return puffer;
  const basis = puffer.length ? JSON.parse(puffer[puffer.length - 1]) : [stand?.footprintM ?? null, stand?.footprintLageM ?? null];
  const fp = "footprintM" in patch ? patch.footprintM : basis[0];
  const lage = "footprintLageM" in patch ? patch.footprintLageM : basis[1];
  return [...puffer, echoSchluessel(fp, lage)].slice(-ECHO_PUFFER_MAX);
}

/**
 * 108-08 review: is the store state the echo of an own write? An echo consumes its entry and every older one (echoes arrive in the
 * order of the writes); a state that is no own write (another device, a conflict decision, a load) clears the buffer - so a foreign
 * state equal to an EARLIER own value is taken over (before: the last 20 values counted as own forever). When the store state did not
 * change (another dependency of the effect fired), it counts as own while writes are still in flight.
 * @param {string[]} puffer remembered own writes, oldest first
 * @param {string} schluessel echoSchluessel of the store now
 * @param {string|null} vorher echoSchluessel the last check saw (null = first check)
 * @returns {{eigen: boolean, puffer: string[]}} eigen = skip the take-over; puffer = the new buffer
 */
export function echoPruefen(puffer, schluessel, vorher) {
  if (schluessel === vorher) return { eigen: puffer.length > 0, puffer };
  const i = puffer.indexOf(schluessel);
  if (i >= 0) return { eigen: true, puffer: puffer.slice(i + 1) };
  return { eigen: false, puffer: [] };
}
