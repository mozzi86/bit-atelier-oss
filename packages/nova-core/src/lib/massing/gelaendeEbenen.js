// Two terrain layers of a project (108-10, user brief 08.11. and 15.11.2026: "Gelände Bestand und Gelände neu, 2 Ebenen"):
//   bestand — the existing ground (survey/import kept in the Massing sandbox, else the public elevation model),
//   neu     — the planned ground (the terrain modelled in the Massing sandbox).
// Both live side by side, nothing overwrites the other; the difference gives the earthworks (cut and fill, KG 310 of DIN 276),
// the section shows both lines (existing dashed, new solid), the IFC export writes both with their status.
//
// Frames. The sandbox raster (gelaende.js) is in SITE metres {x east, y south}; the building model is in MODEL metres
// {x east, z south} with model = site − massing_layer.bezug. The elevation model (useElevationGrid) is a square grid centred on
// the project location = the model origin, rows SOUTH → north, columns west → east, heights in m above sea level.
// Everything this module hands out is a raster in MODEL metres (its y is the model z) with heights relative to ±0,00 (ground floor).
//
// ±0,00 of the elevation model: the highest terrain point under the footprint (rule of the user for a hillside house: "±0 = the wall
// on the hillside") [ASSUMED] until the project stores the level of the ground floor above sea level.
//
// In: massing_layer (gelaende, gelaendeBestand, bezug), elevation grid, footprint. Out: rasters, volumes in m³, section profiles in m.
// Pure module, no DOM, no three.js.
import { hoeheAn, leeresGelaende } from "./gelaende.js";
import { ERSATZ_PX_MITTE } from "./lage.js";

/** @typedef {import("./gelaende.js").Gelaende} Gelaende */
/** @typedef {{x: number, z: number}} PktXZ  model point in m */
/** @typedef {"aufnahme"|"hoehenmodell"} BestandQuelle  aufnahme = kept in the sandbox (survey, import, by hand); hoehenmodell = public elevation model */
/** @typedef {{bestand: Gelaende|null, neu: Gelaende|null, quelleBestand: BestandQuelle|null, bezugNHN_m: number|null, bezugQuelle?: "bauaufnahme"|"regel"}} GelaendeEbenen  bezugQuelle: where ±0,00 of the elevation model comes from */

/**
 * Tints of the earthworks marks in a section: cut in the yellow-orange of "Abbruch", fill in the red of "Neubau" — the status colours
 * of the elements (statusDarstellung.js), lightened; black-and-white output uses the two hatch directions alone.
 */
export const ERDBAU_FARBE = Object.freeze({ abtrag: "#F5E3B3", auftrag: "#F3C9C5" });

const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * Is the raster usable (at least 2 × 2 nodes, one finite height per node)?
 * @param {any} g
 * @returns {boolean}
 */
export function rasterGueltig(g) {
  return !!g && g.nx >= 2 && g.ny >= 2 && g.zelle > 0 && Number.isFinite(g.x0) && Number.isFinite(g.y0)
    && Array.isArray(g.h) && g.h.length === g.nx * g.ny && g.h.every((/** @type {any} */ v) => Number.isFinite(v));
}

/**
 * The elevation grid as a raster in model metres (heights stay in m above sea level).
 * @param {number[][]} grid square grid, rows south → north, columns west → east, m above sea level
 * @param {number} patch_m edge length the grid covers, m (centred on the model origin)
 * @returns {Gelaende|null} null for an unusable grid
 */
export function demAlsRaster(grid, patch_m) {
  const n = Array.isArray(grid) ? grid.length : 0;
  if (n < 2 || !(patch_m > 0) || grid.some((z) => !Array.isArray(z) || z.length < n)) return null;
  /** @type {number[]} */
  const h = [];
  // raster row j runs north → south (model z grows southwards): the grid's last row (north) comes first
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) h.push(Number(grid[n - 1 - j][i]));
  if (!h.every(Number.isFinite)) return null;
  return { nx: n, ny: n, zelle: patch_m / (n - 1), x0: -patch_m / 2, y0: -patch_m / 2, h };
}

/**
 * Terrain height at a model point (bilinear, outside the raster the edge value).
 * @param {Gelaende} g raster in model metres
 * @param {PktXZ} p
 * @returns {number} m (datum of the raster)
 */
export function hoeheBei(g, p) {
  return hoeheAn(g, { x: p.x, y: p.z });
}

/**
 * Highest terrain point under a footprint: corners, edge midpoints and the vertex mean (enough for a bilinear raster coarser than
 * the house; a fine raster is sampled at its own nodes inside the bbox as well).
 * @param {Gelaende} g raster in model metres
 * @param {PktXZ[]|null|undefined} umriss footprint in model metres; without one the model origin counts
 * @returns {number} m
 */
export function hoechsterPunktUnter(g, umriss) {
  const fp = Array.isArray(umriss) && umriss.length >= 3 ? umriss : null;
  if (!fp) return hoeheBei(g, { x: 0, z: 0 });
  /** @type {PktXZ[]} */
  const punkte = [];
  let sx = 0, sz = 0;
  fp.forEach((p, i) => {
    const q = fp[(i + 1) % fp.length];
    punkte.push(p, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
    sx += p.x; sz += p.z;
  });
  punkte.push({ x: sx / fp.length, z: sz / fp.length });
  const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
  const xa = Math.min(...xs), xb = Math.max(...xs), za = Math.min(...zs), zb = Math.max(...zs);
  for (let k = 0; k < g.h.length; k += 1) {
    const x = g.x0 + (k % g.nx) * g.zelle, z = g.y0 + Math.floor(k / g.nx) * g.zelle;
    if (x >= xa && x <= xb && z >= za && z <= zb && imPolygon(fp, { x, z })) punkte.push({ x, z });
  }
  return Math.max(...punkte.map((p) => hoeheBei(g, p)));
}

/** Point in polygon (even-odd), model metres. */
function imPolygon(/** @type {PktXZ[]} */ poly, /** @type {PktXZ} */ p) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) innen = !innen;
  }
  return innen;
}

/**
 * The two terrain layers of a project in model metres, heights relative to ±0,00.
 * Existing ground: `massing.gelaendeBestand` when kept in the sandbox, else the elevation model shifted so that its highest point
 * under the footprint lies on ±0,00. New ground: `massing.gelaende` (the modelled terrain); without one there is no new layer —
 * the ground stays as it is.
 * @param {{massing?: any, demGrid?: number[][]|null, patch_m?: number, umriss?: PktXZ[]|null, lageSite?: {x: number, y: number}|null, okffNHN_m?: number|null}} q
 *   okffNHN_m = surveyed level of the ground floor (±0,00) in m above sea level; with it the elevation model is placed exactly,
 *   patch_m default 200 m; lageSite = site point of the model origin when the layer stores no `bezug` (a layer without bodies never
 *   wrote one): the position of the body on the site (massing/lage.js startLageSite). Without both the rasters stay at the site origin.
 * @returns {GelaendeEbenen} bezugNHN_m = level of ±0,00 above sea level when the existing ground comes from the elevation model
 */
export function gelaendeEbenen({ massing = null, demGrid = null, patch_m = 200, umriss = null, lageSite = null, okffNHN_m = null } = {}) {
  const punkt = (/** @type {any} */ q) => (q && Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y)) ? { x: Number(q.x), y: Number(q.y) } : null);
  const bz = punkt(massing?.bezug) || punkt(lageSite) || { x: 0, y: 0 };
  const imModell = (/** @type {any} */ g) => (rasterGueltig(g) ? { nx: g.nx, ny: g.ny, zelle: g.zelle, x0: g.x0 - bz.x, y0: g.y0 - bz.y, h: g.h.map(Number) } : null);
  const neu = imModell(massing?.gelaende);
  const aufnahme = imModell(massing?.gelaendeBestand);
  if (aufnahme) return { bestand: aufnahme, neu, quelleBestand: "aufnahme", bezugNHN_m: null };
  const dem = demGrid ? demAlsRaster(demGrid, patch_m) : null;
  if (!dem) return { bestand: null, neu, quelleBestand: null, bezugNHN_m: null };
  // the surveyed level of the ground floor above sea level (building survey) replaces the rule "highest point under the footprint"
  const gemessen = okffNHN_m != null && Number.isFinite(Number(okffNHN_m));
  const bezug = gemessen ? Number(okffNHN_m) : hoechsterPunktUnter(dem, umriss);
  return { bestand: { ...dem, h: dem.h.map((v) => v - bezug) }, neu, quelleBestand: "hoehenmodell", bezugNHN_m: r2(bezug), bezugQuelle: gemessen ? "bauaufnahme" : "regel" };
}

/**
 * Earthworks between the existing and the new ground (m³): each node of the NEW raster stands for one cell area (zelle², the
 * node-area method of gelaende.js erdmassen, so the sandbox and this number agree on the same raster); only nodes inside the
 * extent of the existing raster count. [ASSUMED] accuracy of a massing study, not of a survey-based earthworks calculation.
 * @param {Gelaende|null} bestand raster in model metres @param {Gelaende|null} neu raster in model metres
 * @returns {{abtrag_m3: number, auftrag_m3: number, flaeche_m2: number}|null} cut (ground lowered), fill (raised), compared area;
 *   null without both layers
 */
export function erdmassenZwischen(bestand, neu) {
  if (!rasterGueltig(bestand) || !rasterGueltig(neu)) return null;
  const b = /** @type {Gelaende} */ (bestand), n = /** @type {Gelaende} */ (neu);
  const bx1 = b.x0 + (b.nx - 1) * b.zelle, by1 = b.y0 + (b.ny - 1) * b.zelle, a = n.zelle * n.zelle, eps = 1e-9;
  let abtrag = 0, auftrag = 0, knoten = 0;
  for (let k = 0; k < n.h.length; k += 1) {
    const x = n.x0 + (k % n.nx) * n.zelle, z = n.y0 + Math.floor(k / n.nx) * n.zelle;
    if (x < b.x0 - eps || x > bx1 + eps || z < b.y0 - eps || z > by1 + eps) continue;
    const d = n.h[k] - hoeheBei(b, { x, z });
    if (d > 0) auftrag += d * a; else abtrag -= d * a;
    knoten += 1;
  }
  return { abtrag_m3: r2(abtrag), auftrag_m3: r2(auftrag), flaeche_m2: r2(knoten * a) };
}

/**
 * Terrain profile along a section line: A-A ("x") is the line z = 0 along x, B-B ("z") the line x = 0 along z — the two cuts of
 * the studio (referenz.js modellImSchnitt). Sampled at the raster's own cell crossings (exact for a bilinear raster along an
 * axis-parallel line) and at both ends.
 * @param {Gelaende|null} g raster in model metres
 * @param {"x"|"z"|null|undefined} achse section axis
 * @param {number} von_m start along the section line, m @param {number} bis_m end, m
 * @returns {Array<{s_m: number, h_m: number}>} position along the line and height relative to ±0,00; empty without a raster
 */
export function gelaendeProfil(g, achse, von_m, bis_m) {
  if (!rasterGueltig(g) || !(bis_m > von_m)) return [];
  const r = /** @type {Gelaende} */ (g);
  const entlangZ = achse === "z";
  const ursprung = entlangZ ? r.y0 : r.x0, anzahl = entlangZ ? r.ny : r.nx;
  /** @type {number[]} */
  const s = [von_m];
  for (let i = 0; i < anzahl; i += 1) { const v = ursprung + i * r.zelle; if (v > von_m + 1e-9 && v < bis_m - 1e-9) s.push(v); }
  s.push(bis_m);
  return s.map((v) => ({ s_m: r2(v), h_m: r2(hoeheBei(r, entlangZ ? { x: 0, z: v } : { x: v, z: 0 })) }));
}

/**
 * The parts of a terrain profile outside the building: left of `von_m` and right of `bis_m`, each ending exactly on the building
 * face (interpolated). In a section the ground the building stands in stops at the outer walls; only the existing ground of a
 * project with a new ground runs through as a dashed line.
 * @param {Array<{s_m: number, h_m: number}>|null|undefined} profil
 * @param {number} von_m left building face along the section line, m @param {number} bis_m right building face, m
 * @returns {Array<Array<{s_m: number, h_m: number}>>} zero, one or two parts with at least two points each
 */
export function profilAussen(profil, von_m, bis_m) {
  if (!Array.isArray(profil) || profil.length < 2) return [];
  const bei = (/** @type {number} */ s) => {
    for (let i = 1; i < profil.length; i += 1) {
      const a = profil[i - 1], b = profil[i];
      if (s <= b.s_m + 1e-9) return b.s_m === a.s_m ? b.h_m : a.h_m + ((b.h_m - a.h_m) * (s - a.s_m)) / (b.s_m - a.s_m);
    }
    return profil[profil.length - 1].h_m;
  };
  const erster = profil[0].s_m, letzter = profil[profil.length - 1].s_m;
  /** @type {Array<Array<{s_m: number, h_m: number}>>} */
  const teile = [];
  if (erster < von_m - 1e-9) teile.push([...profil.filter((q) => q.s_m < von_m - 1e-9), { s_m: r2(Math.min(von_m, letzter)), h_m: r2(bei(Math.min(von_m, letzter))) }]);
  if (letzter > bis_m + 1e-9) teile.push([{ s_m: r2(Math.max(bis_m, erster)), h_m: r2(bei(Math.max(bis_m, erster))) }, ...profil.filter((q) => q.s_m > bis_m + 1e-9)]);
  return teile.filter((t) => t.length >= 2);
}

/**
 * Cut and fill areas between two profiles of the same section (for the hatch marks): closed polygons between the lines, split
 * where the lines cross.
 * @param {Array<{s_m: number, h_m: number}>} bestand @param {Array<{s_m: number, h_m: number}>} neu
 * @returns {Array<{art: "abtrag"|"auftrag", pts: Array<{s_m: number, h_m: number}>}>} abtrag = new below existing
 */
export function profilFlaechen(bestand, neu) {
  if (bestand.length < 2 || neu.length < 2) return [];
  const bei = (/** @type {Array<{s_m: number, h_m: number}>} */ linie, /** @type {number} */ s) => {
    for (let i = 1; i < linie.length; i += 1) {
      const a = linie[i - 1], b = linie[i];
      if (s <= b.s_m + 1e-9) return b.s_m === a.s_m ? b.h_m : a.h_m + ((b.h_m - a.h_m) * (s - a.s_m)) / (b.s_m - a.s_m);
    }
    return linie[linie.length - 1].h_m;
  };
  const von = Math.max(bestand[0].s_m, neu[0].s_m), bis = Math.min(bestand[bestand.length - 1].s_m, neu[neu.length - 1].s_m);
  const stellen = [...new Set([...bestand, ...neu].map((p) => p.s_m).filter((s) => s >= von - 1e-9 && s <= bis + 1e-9))].sort((a, b) => a - b);
  // the lines are straight between two neighbouring stations: a sign change of the difference is one crossing in between
  /** @type {Array<{s: number, b: number, n: number}>} */
  const reihe = [];
  stellen.forEach((s, i) => {
    const b = bei(bestand, s), n = bei(neu, s);
    if (i > 0) {
      const v = reihe[reihe.length - 1], dv = v.n - v.b, d = n - b;
      if (dv * d < -1e-12) { const t = dv / (dv - d), sx = v.s + (s - v.s) * t, hx = v.b + (b - v.b) * t; reihe.push({ s: sx, b: hx, n: hx }); }
    }
    reihe.push({ s, b, n });
  });
  /** @type {Array<{art: "abtrag"|"auftrag", pts: Array<{s_m: number, h_m: number}>}>} */
  const out = [];
  let start = 0;
  const schliessen = (/** @type {number} */ ende) => {
    const teil = reihe.slice(start, ende + 1);
    const mitte = teil.reduce((sum, p) => sum + (p.n - p.b), 0);
    if (teil.length >= 2 && Math.abs(mitte) > 1e-6) {
      out.push({ art: mitte < 0 ? "abtrag" : "auftrag", pts: [...teil.map((p) => ({ s_m: r2(p.s), h_m: r2(p.b) })), ...teil.reverse().map((p) => ({ s_m: r2(p.s), h_m: r2(p.n) }))] });
    }
    start = ende;
  };
  for (let i = 1; i < reihe.length; i += 1) if (Math.abs(reihe[i].n - reihe[i].b) < 1e-9) schliessen(i);
  schliessen(reihe.length - 1);
  return out;
}

/**
 * A site point of the Massing studio in metres around the project location (the frame of the elevation model): the canvas of the site
 * planning has the project location at ERSATZ_PX_MITTE (600, 400) px, the drawing field puts the parcel's vertex mean (feld.cx/cy px) on
 * its centre (massing/lage.js).
 * @param {{w: number, d: number, mpp: number, cx: number, cy: number}} feld drawing field (siteAusParzelle), m and px
 * @param {{x: number, y: number}} p site point, m (x east, y south)
 * @returns {PktXZ} m around the project location (x east, z south)
 */
export function ortVonSite(feld, p) {
  return { x: (feld.cx - ERSATZ_PX_MITTE.cx) * feld.mpp + (p.x - feld.w / 2), z: (feld.cy - ERSATZ_PX_MITTE.cy) * feld.mpp + (p.y - feld.d / 2) };
}

/**
 * Start raster of the sandbox from the public elevation model (108-10, open point "Sandkasten startet flach"): the drawing field as a
 * raster (cell `zelle` m) with the real heights, shifted to ±0,00 by the same rule as the building studio — the surveyed level of the
 * ground floor (okffNHN_m) where known, else the highest point under the body (`umrissSite`). The elevation model has a resolution of
 * about 90 m: the start is a coarse slope, to be refined by survey or by hand — the caller says so.
 * @param {{feld: {w: number, d: number, mpp: number, cx: number, cy: number}, demGrid: number[][], patch_m?: number,
 *   umrissSite?: Array<{x: number, y: number}>|null, okffNHN_m?: number|null, zelle?: number}} q patch_m default 200 m; zelle default 1 m
 *   (2 m for fields over 15 000 m², the rule of the sandbox)
 * @returns {{gelaende: Gelaende, bezugNHN_m: number, bezugQuelle: "bauaufnahme"|"regel"}|null} raster in SITE metres, heights m relative
 *   to ±0,00, rounded to cm; null without a usable grid or field
 */
export function sandkastenAusHoehenmodell({ feld, demGrid, patch_m = 200, umrissSite = null, okffNHN_m = null, zelle }) {
  if (!feld || !(feld.w > 0 && feld.d > 0 && feld.mpp > 0)) return null;
  const dem = demAlsRaster(demGrid, patch_m);
  if (!dem) return null;
  const z = zelle > 0 ? zelle : feld.w * feld.d > 15000 ? 2 : 1;
  /** @type {Gelaende} */
  let g;
  try { g = leeresGelaende(feld.w, feld.d, { zelle: z }); } catch { return null; }
  const gemessen = okffNHN_m != null && Number.isFinite(Number(okffNHN_m));
  const umriss = Array.isArray(umrissSite) && umrissSite.length >= 3 ? umrissSite.map((p) => ortVonSite(feld, p)) : null;
  const mitte = ortVonSite(feld, { x: feld.w / 2, y: feld.d / 2 });
  const bezug = gemessen ? Number(okffNHN_m) : umriss ? hoechsterPunktUnter(dem, umriss) : hoeheBei(dem, mitte);
  const h = g.h.map((_, k) => {
    const p = ortVonSite(feld, { x: g.x0 + (k % g.nx) * g.zelle, y: g.y0 + Math.floor(k / g.nx) * g.zelle });
    return r2(hoeheBei(dem, p) - bezug);
  });
  return { gelaende: { ...g, h }, bezugNHN_m: r2(bezug), bezugQuelle: gemessen ? "bauaufnahme" : "regel" };
}
