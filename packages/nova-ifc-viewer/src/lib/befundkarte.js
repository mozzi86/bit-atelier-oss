// befundkarte.js — floor plan with numbered finding markers, per storey (66-08).
//
// In:  findings from clash.js (`center {x,y,z}` in world metres, aId/bId, aGuid/bGuid,
//      aQuelle/bQuelle on rule findings) and the geometry elements the check ran on
//      (`{expressId, globalId, ifcType, storey, tris: Float32Array (9 floats per
//      triangle), aabb?, quelle?}` — `quelle` "A"/"B" in a two-model run).
// Out: befundeJeGeschoss() groups markers by storey with the report number
//      (index in the findings list + 1); umrissFuerGeschoss() derives the outline of
//      that storey; kartenModell() fits both into one drawing; befundkarteSvg()
//      renders it (the PDF renderer draws the same model with jspdf primitives).
//
// Coordinates: web-ifc delivers Y-up world coordinates (IFC Z → world Y, IFC Y →
// world −Z). The plan uses (x, z) directly, so with SVG's y-down the model's north
// (+IFC-Y) points up on the sheet. No centring — the outline must stay in the same
// system as the finding centres (grundrissAusModell centres and is unusable here).
//
// Pure, no DOM, no network. Register no. 80/85.

import {
  rasterAusDreiecken, groessteFlaeche, umriss, vereinfachen, polygonFlaeche,
  DECKEN_KLASSEN, UMRISS_KLASSEN,
} from "./grundriss.js";
import { aabbOf } from "./clash.js";

/**
 * Marker style per finding kind. `schwere` 1 = most severe (drawn last, on top).
 * Colours [ASSUMED] office palette: red collision, violet duplicate, amber for the
 * AABB approximations, blue for clearance.
 */
export const BEFUND_STIL = {
  hard: { form: "kreis", farbe: "#dc2626", schwere: 1, label: "Kollision" },
  duplicate: { form: "quadrat", farbe: "#7c3aed", schwere: 2, label: "Duplikat" },
  enthalten: { form: "dreieck", farbe: "#d97706", schwere: 2, label: "nicht größer als (Näherung)" },
  gefuellt: { form: "dreieck", farbe: "#d97706", schwere: 2, label: "gefüllt (Näherung)" },
  deckung: { form: "dreieck", farbe: "#d97706", schwere: 2, label: "deckungsgleich (Näherung)" },
  ohne_partner: { form: "dreieck", farbe: "#b45309", schwere: 2, label: "ohne Gegenstück" },
  clearance: { form: "raute", farbe: "#2563eb", schwere: 3, label: "Abstand" },
};
const STIL_UNBEKANNT = { form: "kreis", farbe: "#475569", schwere: 3, label: "Befund" };

/** Label for storey-less findings — its own map, nothing is dropped silently. */
export const OHNE_GESCHOSS = "ohne Geschoss";

/** Margin around the drawing, metres [ASSUMED] — room for marker numbers at the edge. */
export const RAND_M = 2;

/**
 * Style of a finding kind (falls back to a neutral grey circle).
 * @param {string} kind
 */
export function stilVon(kind) {
  return BEFUND_STIL[kind] || STIL_UNBEKANNT;
}

/**
 * Centre of a finding as {x, y, z} metres, or null. Accepts {x,y,z} (clash.js) and [x,y,z].
 * @param {{center?: any}} befund
 * @returns {{x: number, y: number, z: number}|null}
 */
export function mitteVon(befund) {
  const c = befund && befund.center;
  if (!c) return null;
  const [x, y, z] = Array.isArray(c) ? c : [c.x, c.y, c.z];
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

/**
 * Element lookup by the identities a finding carries. Express IDs restart in every
 * IFC file, so in a two-model run model A and model B reuse them for unrelated
 * elements. Order: GUID (unique across files), then source + expressId (`quelle`
 * "A"/"B"), then the bare expressId — the last only while it is unambiguous.
 * @param {Array<{expressId?: number, globalId?: string, quelle?: string|null}>} elemente
 * @returns {(guid?: string|null, quelle?: string|null, id?: number|null) => object|null}
 */
export function elementSuche(elemente) {
  const nachGuid = new Map();
  const nachQuelle = new Map();
  const nachId = new Map();
  const mehrdeutig = new Set();
  for (const e of elemente || []) {
    if (!e) continue;
    if (e.globalId) nachGuid.set(e.globalId, e);
    if (e.expressId == null) continue;
    if (e.quelle != null) nachQuelle.set(`${e.quelle}:${e.expressId}`, e);
    if (nachId.has(e.expressId)) mehrdeutig.add(e.expressId);
    else nachId.set(e.expressId, e);
  }
  return (guid, quelle, id) => {
    if (guid && nachGuid.has(guid)) return nachGuid.get(guid);
    if (id == null) return null;
    const k = `${quelle}:${id}`;
    if (quelle != null && nachQuelle.has(k)) return nachQuelle.get(k);
    return mehrdeutig.has(id) ? null : nachId.get(id) || null;
  };
}

/** Elements of both sides of a finding ([A, B], each or null). */
function seitenVon(befund, suche) {
  return [
    suche(befund?.aGuid, befund?.aQuelle, befund?.aId),
    suche(befund?.bGuid, befund?.bQuelle, befund?.bId),
  ];
}

/**
 * Storey of a finding: storey of element A, else element B, else null.
 * @param {{aId?: number|null, bId?: number|null, aGuid?: string, bGuid?: string,
 *   aQuelle?: string|null, bQuelle?: string|null}} befund
 * @param {ReturnType<typeof elementSuche>} suche
 * @returns {string|null}
 */
export function geschossVonBefund(befund, suche) {
  for (const e of seitenVon(befund, suche)) if (e && e.storey) return e.storey;
  return null;
}

const boxVon = (e) => (e && e.aabb && e.aabb.min && e.aabb.max ? e.aabb : aabbOf(e && e.tris));

/**
 * Plan position of a finding in world metres. clash.js stores for 'ohne_partner' the
 * min corner of the element's AABB and for 'clearance' the midpoint of both element
 * centres — both can lie metres away from what the finding is about (a 22 m wall, a
 * door next to a 30 m wall). The map therefore uses the centre of the one element for
 * 'ohne_partner' and, per axis, the middle of the overlap or gap interval of both
 * AABBs for 'clearance'. All other kinds keep `center` (centre of the overlap box).
 * Falls back to `center` when the elements are not in the list.
 * @param {object} befund
 * @param {ReturnType<typeof elementSuche>} suche
 * @returns {{x: number, y: number, z: number}|null}
 */
export function lageVon(befund, suche) {
  const [ea, eb] = seitenVon(befund, suche);
  if (befund?.kind === "ohne_partner") {
    const box = boxVon(ea || eb);
    if (box) return { x: (box.min[0] + box.max[0]) / 2, y: (box.min[1] + box.max[1]) / 2, z: (box.min[2] + box.max[2]) / 2 };
  } else if (befund?.kind === "clearance") {
    const a = boxVon(ea), b = boxVon(eb);
    if (a && b) {
      const mitte = (k) => (Math.max(a.min[k], b.min[k]) + Math.min(a.max[k], b.max[k])) / 2;
      return { x: mitte(0), y: mitte(1), z: mitte(2) };
    }
  }
  return mitteVon(befund);
}

/**
 * Groups findings with a position by storey. Number = position in the report list + 1.
 * @param {Array<object>} befunde clash findings in report order
 * @param {Array<{expressId: number, globalId?: string, storey?: string, quelle?: string|null}>} elemente
 *   the geometry elements the check ran on
 * @returns {{geschosse: Map<string, Array<{nr: number, kind: string, x: number, z: number, befund: object}>>,
 *   ohneLage: number}} ohneLage = findings without a usable position
 */
export function befundeJeGeschoss(befunde, elemente) {
  const suche = elementSuche(elemente);
  const geschosse = new Map();
  let ohneLage = 0;
  (befunde || []).forEach((b, i) => {
    const m = lageVon(b, suche);
    if (!m) { ohneLage++; return; }
    const g = geschossVonBefund(b, suche) || OHNE_GESCHOSS;
    if (!geschosse.has(g)) geschosse.set(g, []);
    geschosse.get(g).push({ nr: i + 1, kind: b.kind, x: m.x, z: m.z, befund: b });
  });
  return { geschosse, ohneLage };
}

/**
 * Outline of one storey in world plan coordinates (x, z), NOT centred.
 * Slabs first (the plate you stand on — see grundriss.js), envelope as fallback.
 * @param {Array<{ifcType?: string, storey?: string, tris?: ArrayLike<number>}>} elemente
 * @param {string|null} geschoss storey name; OHNE_GESCHOSS/null = all elements
 * @param {{zelle?: number, toleranz?: number}} [opt] raster cell and simplification, metres
 * @returns {{polygon: Array<{x: number, z: number}>, flaeche: number, quelle: string}|null}
 */
export function umrissFuerGeschoss(elemente, geschoss, opt = {}) {
  const { zelle = 0.5, toleranz = 0.5 } = opt;
  const imGeschoss = (e) => !geschoss || geschoss === OHNE_GESCHOSS || e.storey === geschoss;
  const auswahl = (klassen) => (elemente || []).filter((e) => e && e.tris && e.tris.length >= 9
    && imGeschoss(e) && [...klassen].some((k) => k.toUpperCase() === String(e.ifcType || "").toUpperCase()));
  let teile = auswahl(DECKEN_KLASSEN);
  let quelle = "Deckenplatten";
  if (!teile.length) { teile = auswahl(UMRISS_KLASSEN); quelle = "Hülle"; }
  if (!teile.length) return null;

  const dreiecke = [];
  for (const e of teile) {
    const t = e.tris;
    for (let i = 0; i + 8 < t.length; i += 9) {
      // Y (offset +1) is height and dropped by the projection.
      dreiecke.push([[t[i], t[i + 2]], [t[i + 3], t[i + 5]], [t[i + 6], t[i + 8]]]);
    }
  }
  const raster = rasterAusDreiecken(dreiecke, zelle);
  if (!raster) return null;
  const groesste = groessteFlaeche(raster);
  if (!groesste) return null;
  const polygon = vereinfachen(umriss({ ...raster, grid: groesste.grid }), toleranz);
  if (!polygon || polygon.length < 3) return null;
  return { polygon, flaeche: Math.round(polygonFlaeche(polygon) * 10) / 10, quelle };
}

/**
 * Drawing model: outline + markers + bounding box with margin, in metres.
 * @param {{umriss?: {polygon: Array<{x,z}>, quelle?: string}|null, marken: Array<{nr, kind, x, z}>, geschoss: string}} p
 * @returns {{geschoss: string, umriss: Array<{x,z}>|null, umrissQuelle: string|null, marken: Array<object>,
 *   box: {minX: number, minZ: number, maxX: number, maxZ: number, breite: number, tiefe: number}}}
 *   umrissQuelle = "Deckenplatten" | "Hülle" | null (no outline) — map and PDF name it.
 */
export function kartenModell({ umriss: u = null, marken, geschoss }) {
  const punkte = [...(u?.polygon || []), ...marken.map((m) => ({ x: m.x, z: m.z }))];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of punkte) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  if (!punkte.length) { minX = minZ = 0; maxX = maxZ = 1; }
  minX -= RAND_M; minZ -= RAND_M; maxX += RAND_M; maxZ += RAND_M;
  // Most severe last, so it is drawn on top.
  const sortiert = [...marken].sort((a, b) => stilVon(b.kind).schwere - stilVon(a.kind).schwere || a.nr - b.nr);
  return {
    geschoss,
    umriss: u?.polygon || null,
    umrissQuelle: u?.polygon ? u.quelle || null : null,
    marken: sortiert,
    box: { minX, minZ, maxX, maxZ, breite: maxX - minX, tiefe: maxZ - minZ },
  };
}

/**
 * How a marker position is derived — German text, also the i18n key in the UI. Shared
 * by map and PDF so the two cannot drift apart (see lageVon).
 */
export const LAGE_HINWEIS = "Lage = Mitte der Überschneidung; bei „ohne Gegenstück“ Mitte des Bauteils, bei „Abstand“ Mitte der Lücke.";

/**
 * Caption for the basis of the outline — German text, also the i18n key in the UI.
 * The sheet must not claim slabs when the outline came from the envelope or is missing.
 * @param {string|null} quelle umrissQuelle from kartenModell
 * @returns {string}
 */
export function umrissHinweis(quelle) {
  if (quelle === "Deckenplatten") return "Umriss aus Deckenplatten, auf 0,5 m gerastert.";
  if (quelle === "Hülle") return "Umriss aus der Gebäudehülle (keine Deckenplatten), auf 0,5 m gerastert.";
  return "Für dieses Geschoss ließ sich kein Umriss ableiten.";
}

/**
 * Round scale bar length (1, 2 or 5 × 10^n metres) close to a fifth of the width.
 * @param {number} breiteM drawing width, metres
 * @returns {number} metres
 */
export function massstabsbalkenM(breiteM) {
  const ziel = Math.max(breiteM / 5, 0.1);
  const p = 10 ** Math.floor(Math.log10(ziel));
  for (const f of [5, 2, 1]) if (f * p <= ziel) return f * p;
  return p;
}

/** SVG path of a marker shape centred at (cx, cy) with radius r (screen units). */
export function formPfad(form, cx, cy, r) {
  const f = (n) => Math.round(n * 100) / 100;
  if (form === "quadrat") return `M${f(cx - r)},${f(cy - r)}h${f(2 * r)}v${f(2 * r)}h${f(-2 * r)}Z`;
  if (form === "dreieck") return `M${f(cx)},${f(cy - r * 1.15)}L${f(cx + r)},${f(cy + r * 0.75)}L${f(cx - r)},${f(cy + r * 0.75)}Z`;
  if (form === "raute") return `M${f(cx)},${f(cy - r * 1.2)}L${f(cx + r * 1.2)},${f(cy)}L${f(cx)},${f(cy + r * 1.2)}L${f(cx - r * 1.2)},${f(cy)}Z`;
  return `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * SVG string of a map model. The drawing is scaled to `breitePx`; markers and texts
 * have a fixed size in px, so they stay readable on large and small buildings alike.
 * @param {ReturnType<typeof kartenModell>} m
 * @param {{breitePx?: number}} [opt] target width in px (height follows the aspect)
 * @returns {string}
 */
export function befundkarteSvg(m, opt = {}) {
  const breitePx = opt.breitePx || 800;
  const s = breitePx / m.box.breite; // px per metre
  const hoehePx = Math.max(1, Math.round(m.box.tiefe * s));
  const X = (x) => Math.round((x - m.box.minX) * s * 100) / 100;
  const Y = (z) => Math.round((z - m.box.minZ) * s * 100) / 100;
  const r = 9; // marker radius, px
  const teile = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${breitePx} ${hoehePx}" width="${breitePx}" height="${hoehePx}" data-befundkarte="${esc(m.geschoss)}">`,
    `<rect width="${breitePx}" height="${hoehePx}" fill="#ffffff"/>`];
  if (m.umriss) {
    const d = m.umriss.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p.z)}`).join("") + "Z";
    teile.push(`<path d="${d}" fill="#f1f5f9" stroke="#334155" stroke-width="1.5" data-umriss="1"/>`);
  }
  for (const mk of m.marken) {
    const st = stilVon(mk.kind);
    const cx = X(mk.x), cy = Y(mk.z);
    teile.push(`<g data-marke="${mk.nr}" data-art="${esc(mk.kind)}">`
      + `<path d="${formPfad(st.form, cx, cy, r)}" fill="${st.farbe}" stroke="#ffffff" stroke-width="1.5"/>`
      + `<text x="${cx}" y="${Math.round((cy + 3.5) * 100) / 100}" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" font-weight="700" fill="#ffffff">${mk.nr}</text></g>`);
  }
  const balken = massstabsbalkenM(m.box.breite);
  const bl = balken * s;
  teile.push(`<g data-massstab="${balken}"><line x1="12" y1="${hoehePx - 14}" x2="${12 + bl}" y2="${hoehePx - 14}" stroke="#0f172a" stroke-width="2"/>`
    + `<text x="12" y="${hoehePx - 20}" font-size="10" font-family="system-ui,sans-serif" fill="#0f172a">${balken} m</text></g>`);
  teile.push(`<text x="${breitePx - 14}" y="20" text-anchor="end" font-size="11" font-family="system-ui,sans-serif" font-weight="700" fill="#0f172a" data-nord="1">N ↑</text>`);
  teile.push("</svg>");
  return teile.join("");
}
