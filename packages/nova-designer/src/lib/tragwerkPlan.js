// Tragwerk auf dem Grundriss — Rechen- und Datenschicht des Statik-Plans (Phase 40, TRAG-02…05).
//
// In:  footprint of the storey [{x,z}] (m), drawn columns customColumns [{x,z,level,size,_idx}] (m),
//      statik_layer { traeger: [{id, level, a, b, breite_m, einzugsbreite_m, vonIdx, nachIdx}], ergebnis },
//      concept inputs of the Statik panel (gk/Δg/qk kN/m², Betongüte → fcd kN/m², Tragsystem, Spannweite m).
// Out: load take-down areas per column (discrete Voronoi on a grid), per-column N (kN) and required
//      A_c (cm²) through statics.stuetzenVordim (the checked core), beam pre-sizing (h, M_Ed, V_Ed),
//      checks (pass | warn | offen — never fail: pre-sizing, no proof), a calculation run with timestamp
//      and input hash so the UI can mark a stale result. Pure functions, no React.

import { stuetzenVordim } from "@designer/lib/statics";
import { punktImPolygon } from "@designer/lib/moebel";
import { polygonAreaM } from "@core/lib/useBuildingProgram";

// ---- Richtwerte (alle [ASSUMED], Konzeptstufe) --------------------------------------------------

/** Beam width in m. [ASSUMED] usual Stahlbeton-Unterzug b = 0.30 m. */
export const TRAEGER_BREITE_M = 0.3;
/** Load strip width feeding a beam in m. [ASSUMED] half span each side of a 10 m grid. */
export const TRAEGER_EINZUG_M = 5.0;
/** Beam depth rule h ≈ L / TRAEGER_SCHLANKHEIT. [ASSUMED] Stahlbeton-Unterzug h = L/10 … L/15. */
export const TRAEGER_SCHLANKHEIT = 12;
/** Snap radius (m) for beam ends onto columns. [ASSUMED] */
export const STUETZEN_FANG_M = 0.6;
/** Grid pitch (m) of the discrete Voronoi for the load take-down (calculation). [ASSUMED] */
export const LASTEINZUG_RASTER_M = 0.5;
/** Grid pitch (m) of the cells handed to the overlay (drawing only). */
export const LASTEINZUG_RASTER_ANZEIGE_M = 1.0;
/** Utilisation above which a column is flagged (warn, never fail). [ASSUMED] pre-sizing limit 1.0 */
export const AUSLASTUNG_WARN = 1.0;
/** Load take-down area per column above spannweite² · this factor → "grid wider than assumed". [ASSUMED] */
export const EINZUG_FAKTOR_WARN = 1.5;
/** Minimum beam length in m. */
export const TRAEGER_MIN_M = 0.5;

/** Empty layer (value of BimModel.statik_layer before anything is drawn). */
export const STATIK_LAYER_DEFAULT = { traeger: [], ergebnis: null };

const isPt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
const rnd = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const laenge = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

// ---- Härtung und Editor-Helfer --------------------------------------------------------------------

/**
 * Always returns a valid layer: beams with two finite points and L ≥ TRAEGER_MIN_M, defaults for
 * width / strip, column links as numbers or null; ergebnis passed through if it is an object.
 * @param {object|null|undefined} layer raw statik_layer
 */
export function layerHardened(layer) {
  const src = layer && typeof layer === "object" ? layer : {};
  const traeger = (Array.isArray(src.traeger) ? src.traeger : [])
    .filter((t) => t && isPt(t.a) && isPt(t.b) && laenge(t.a, t.b) >= TRAEGER_MIN_M)
    .map((t, i) => ({
      id: typeof t.id === "string" ? t.id : `tr_${i + 1}`,
      level: Number.isFinite(t.level) ? Math.round(t.level) : 0,
      a: { x: t.a.x, z: t.a.z }, b: { x: t.b.x, z: t.b.z },
      breite_m: Number.isFinite(t.breite_m) && t.breite_m > 0 ? t.breite_m : TRAEGER_BREITE_M,
      einzugsbreite_m: Number.isFinite(t.einzugsbreite_m) && t.einzugsbreite_m > 0 ? t.einzugsbreite_m : TRAEGER_EINZUG_M,
      vonIdx: Number.isFinite(t.vonIdx) ? t.vonIdx : null,
      nachIdx: Number.isFinite(t.nachIdx) ? t.nachIdx : null,
    }));
  const ergebnis = src.ergebnis && typeof src.ergebnis === "object" ? src.ergebnis : null;
  return { traeger, ergebnis };
}

const naechsteId = (liste) => {
  let max = 0;
  for (const t of liste) { const m = /^tr_(\d+)$/.exec(String(t.id || "")); if (m) max = Math.max(max, Number(m[1])); }
  return `tr_${max + 1}`;
};

/** Columns present on a storey. */
export const stuetzenImLevel = (stuetzen, level) => (stuetzen || []).filter((c) => (c.level || 0) === level && isPt(c));

/**
 * Nearest column of the storey within STUETZEN_FANG_M, or null.
 * @param {Array<object>} stuetzen customColumns
 * @param {number} level
 * @param {{x:number,z:number}} p metres
 */
export function fangeStuetze(stuetzen, level, p, fang = STUETZEN_FANG_M) {
  if (!isPt(p)) return null;
  let best = null, bestD = fang;
  for (const c of stuetzenImLevel(stuetzen, level)) {
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d <= bestD) { best = c; bestD = d; }
  }
  return best;
}

/**
 * Add a beam a→b on a storey; endpoints snap onto columns (link kept as vonIdx/nachIdx).
 * @param {object} layer statik_layer (hardened inside)
 * @param {{ level?: number, a?: {x:number,z:number}, b?: {x:number,z:number}, stuetzen?: Array<object>, breite_m?: number, einzugsbreite_m?: number }} opts
 *   a/b in metres (plan coordinates), breite_m/einzugsbreite_m in metres
 * @returns {{layer: object, traeger: object|null}} null when shorter than TRAEGER_MIN_M
 */
export function neuerTraeger(layer, { level = 0, a, b, stuetzen = [], breite_m, einzugsbreite_m } = {}) {
  const base = layerHardened(layer);
  if (!isPt(a) || !isPt(b)) return { layer: base, traeger: null };
  const sa = fangeStuetze(stuetzen, level, a), sb = fangeStuetze(stuetzen, level, b);
  const pa = sa ? { x: sa.x, z: sa.z } : { x: a.x, z: a.z };
  const pb = sb ? { x: sb.x, z: sb.z } : { x: b.x, z: b.z };
  if (laenge(pa, pb) < TRAEGER_MIN_M) return { layer: base, traeger: null };
  const traeger = {
    id: naechsteId(base.traeger), level: Math.round(level), a: pa, b: pb,
    breite_m: breite_m > 0 ? breite_m : TRAEGER_BREITE_M, einzugsbreite_m: einzugsbreite_m > 0 ? einzugsbreite_m : TRAEGER_EINZUG_M,
    vonIdx: sa ? sa._idx ?? null : null, nachIdx: sb ? sb._idx ?? null : null,
  };
  return { layer: { ...base, traeger: [...base.traeger, traeger] }, traeger };
}

/** Move one beam end (snaps onto columns again). */
export function verschiebeTraegerPunkt(layer, id, ende, p, stuetzen = []) {
  const base = layerHardened(layer);
  if (!isPt(p) || (ende !== "a" && ende !== "b")) return base;
  return {
    ...base,
    traeger: base.traeger.map((t) => {
      if (t.id !== id) return t;
      const s = fangeStuetze(stuetzen, t.level, p);
      const q = s ? { x: s.x, z: s.z } : { x: p.x, z: p.z };
      const idx = s ? s._idx ?? null : null;
      const neu = ende === "a" ? { ...t, a: q, vonIdx: idx } : { ...t, b: q, nachIdx: idx };
      return laenge(neu.a, neu.b) >= TRAEGER_MIN_M ? neu : t;
    }),
  };
}

/** Patch beam attributes (breite_m, einzugsbreite_m). */
export function aendereTraeger(layer, id, patch) {
  const base = layerHardened(layer);
  return layerHardened({ ...base, traeger: base.traeger.map((t) => (t.id === id ? { ...t, ...patch, id } : t)) });
}

/** Remove a beam. */
export function loescheTraeger(layer, id) {
  const base = layerHardened(layer);
  return { ...base, traeger: base.traeger.filter((t) => t.id !== id) };
}

// ---- Lasteinzug (diskretes Voronoi) ------------------------------------------------------------------

/**
 * Load take-down areas: every grid cell inside the footprint goes to the nearest column of the
 * storey; area per column = cells · raster². One column → the whole footprint; none → [].
 * @param {Array<{x:number,z:number}>} footprint storey polygon (m)
 * @param {Array<object>} stuetzen columns of THIS storey ({x,z,size,_idx})
 * @param {number} [raster=LASTEINZUG_RASTER_M] grid pitch (m)
 * @returns {{ flaechen: Array<{idx:number, x:number, z:number, size:number, flaeche_m2:number}>, zellen: Array<{x:number,z:number,idx:number}>, footArea: number }}
 */
export function lasteinzug(footprint, stuetzen, raster = LASTEINZUG_RASTER_M) {
  const cols = (stuetzen || []).filter(isPt);
  const footArea = polygonAreaM(footprint || []);
  if (!Array.isArray(footprint) || footprint.length < 3 || cols.length === 0 || !(raster > 0)) return { flaechen: [], zellen: [], footArea };
  const xs = footprint.map((p) => p.x), zs = footprint.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const counts = new Map(cols.map((c) => [c._idx ?? cols.indexOf(c), 0]));
  const zellen = [];
  for (let x = minX + raster / 2; x < maxX; x += raster) {
    for (let z = minZ + raster / 2; z < maxZ; z += raster) {
      if (!punktImPolygon(x, z, footprint)) continue;
      let best = null, bestD = Infinity;
      for (const c of cols) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bestD) { bestD = d; best = c; } }
      const idx = best._idx ?? cols.indexOf(best);
      counts.set(idx, counts.get(idx) + 1);
      zellen.push({ x: rnd(x), z: rnd(z), idx });
    }
  }
  const flaechen = cols.map((c) => { const idx = c._idx ?? cols.indexOf(c); return { idx, x: c.x, z: c.z, size: c.size || 0.4, flaeche_m2: rnd(counts.get(idx) * raster * raster) }; });
  return { flaechen, zellen, footArea };
}

// ---- Stützen und Träger ----------------------------------------------------------------------------

/**
 * Per-column pre-sizing on one storey. Columns carry the storeys above them ([ASSUMED] Skelettbau:
 * the whole floor load goes to columns, walls carry nothing). A_c through statics.stuetzenVordim.
 * @param {{ footprint?: Array<object>, stuetzen?: Array<object>, level?: number, storeys?: number, qFlaeche?: number, fcd?: number }} p
 *   qFlaeche = gk + Δg + qk in kN/m² per storey, fcd in kN/m²; missing footprint/stuetzen → empty result
 * @returns {Array<{idx:number, x:number, z:number, size:number, einzug_m2:number, geschosse:number, N_kN:number, Ac_erf_cm2:number|null, Ac_vorh_cm2:number, auslastung:number|null, status:"pass"|"warn"|"offen"}>}
 */
export function stuetzenBerechnung({ footprint, stuetzen, level = 0, storeys = 1, qFlaeche = 0, fcd = 0 } = {}) {
  const hier = stuetzenImLevel(stuetzen, level);
  const { flaechen, footArea } = lasteinzug(footprint, hier);
  const geschosse = Math.max(0, Math.round(storeys) - level);
  return flaechen.map((f) => {
    const N = qFlaeche * f.flaeche_m2 * geschosse;
    const Ac = stuetzenVordim({ gesamtlastProGeschoss: qFlaeche * footArea, storeys: geschosse, footArea, einzugA: f.flaeche_m2, fcd });
    const vorh = f.size * f.size * 10000;
    const auslastung = Ac == null || vorh <= 0 ? null : Ac / vorh;
    return {
      idx: f.idx, x: f.x, z: f.z, size: f.size, einzug_m2: f.flaeche_m2, geschosse,
      N_kN: rnd(N, 1), Ac_erf_cm2: Ac == null ? null : rnd(Ac, 0), Ac_vorh_cm2: rnd(vorh, 0),
      auslastung: auslastung == null ? null : rnd(auslastung, 2),
      // warn, never fail: this is a pre-sizing aid, the Standsicherheitsnachweis is the engineer's
      status: auslastung == null ? "offen" : auslastung > AUSLASTUNG_WARN ? "warn" : "pass",
    };
  });
}

/**
 * Beam pre-sizing: simply supported, uniform load. h = L / TRAEGER_SCHLANKHEIT rounded up to 5 cm
 * [ASSUMED], M_Ed = q·L²/8, V_Ed = q·L/2.
 * @param {{ L?: number, qLin?: number }} p L in m, qLin in kN/m (missing → 0)
 * @returns {{ h_m: number, M_kNm: number, V_kN: number }}
 */
export function traegerVordim({ L = 0, qLin = 0 } = {}) {
  const l = Math.max(0, Number(L) || 0), q = Math.max(0, Number(qLin) || 0);
  const h = Math.ceil((l / TRAEGER_SCHLANKHEIT) / 0.05) * 0.05;
  return { h_m: rnd(h, 2), M_kNm: rnd((q * l * l) / 8, 2), V_kN: rnd((q * l) / 2, 2) };
}

/**
 * Pre-sizing of all beams on a storey. q_lin = qFlaeche · Einzugsbreite (one slab, [ASSUMED]).
 * @param {Array<object>} traeger hardened beams of the storey
 * @param {{ qFlaeche?: number }} p kN/m²
 */
export function traegerBerechnung(traeger, { qFlaeche = 0 } = {}) {
  return (traeger || []).map((t) => {
    const L = laenge(t.a, t.b);
    const qLin = qFlaeche * t.einzugsbreite_m;
    return { id: t.id, level: t.level, L_m: rnd(L, 2), qLin_kNm: rnd(qLin, 2), breite_m: t.breite_m, angeschlossen: t.vonIdx != null && t.nachIdx != null, ...traegerVordim({ L, qLin }) };
  });
}

// ---- Checks (nur pass / warn / offen) ----------------------------------------------------------------

/**
 * Concept checks of a calculation run. Never "fail" — pre-sizing (T-15-03 liability rule).
 * @param {{ stuetzen?: Array<object>, traeger?: Array<object>, tragsystem?: string, spannweite?: number }} p
 *   stuetzen/traeger = results of stuetzenBerechnung / traegerBerechnung
 * @returns {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>}
 */
export function tragwerkChecks({ stuetzen = [], traeger = [], tragsystem = "", spannweite = 0 } = {}) {
  /** @type {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>} */
  const items = [];
  const de = (n) => Math.round(n).toLocaleString("de-DE");
  const wandbau = /Wandbau/i.test(tragsystem);

  items.push({ key: "stuetzen", label: "Stützen im Geschoss", status: stuetzen.length ? "pass" : "offen",
    detail: stuetzen.length ? `${stuetzen.length} Stütze(n) aus dem Gebäudemodell.` : "Keine Stützen gezeichnet — im Gebäudemodell setzen (Werkzeug Stütze)." });

  const ueber = stuetzen.filter((s) => s.auslastung != null && s.auslastung > AUSLASTUNG_WARN);
  items.push({ key: "auslastung", label: "Stützenquerschnitte (Vorbemessung)", status: !stuetzen.length ? "offen" : wandbau ? "offen" : ueber.length ? "warn" : "pass",
    detail: !stuetzen.length ? "Keine Stützen." : wandbau ? "Tragsystem Wandbau: Wände tragen — Stützenrechnung nicht anwendbar (Konzept)." : ueber.length ? `${ueber.length} Stütze(n) über Auslastung ${AUSLASTUNG_WARN.toLocaleString("de-DE")} — Querschnitt vergrößern oder Raster verdichten.` : `Alle ${stuetzen.length} Stützen ≤ ${AUSLASTUNG_WARN.toLocaleString("de-DE")} (Richtwert A_c = N/(0,5·fcd)).` });

  const maxEinzug = stuetzen.reduce((m, s) => Math.max(m, s.einzug_m2 || 0), 0);
  const grenze = spannweite > 0 ? spannweite * spannweite * EINZUG_FAKTOR_WARN : 0;
  items.push({ key: "raster", label: "Stützenraster zur Spannweite", status: !stuetzen.length || !(grenze > 0) ? "offen" : maxEinzug > grenze ? "warn" : "pass",
    detail: !stuetzen.length ? "Keine Stützen." : !(grenze > 0) ? "Keine Spannweite im Konzept." : maxEinzug > grenze ? `Größte Lasteinzugsfläche ${de(maxEinzug)} m² > ${de(grenze)} m² (1,5 · Spannweite²) — Raster weiter als die Vorbemessung annimmt.` : `Größte Lasteinzugsfläche ${de(maxEinzug)} m² ≤ ${de(grenze)} m².` });

  const lose = traeger.filter((t) => !t.angeschlossen);
  items.push({ key: "traeger", label: "Träger auf Stützen", status: !traeger.length ? "offen" : lose.length ? "warn" : "pass",
    detail: !traeger.length ? "Keine Träger gezeichnet." : lose.length ? `${lose.length} Träger mit freiem Ende (keine Stütze im Fang ${STUETZEN_FANG_M} m).` : `${traeger.length} Träger beidseitig auf Stützen (h ≈ L/${TRAEGER_SCHLANKHEIT}).` });

  return items;
}

// ---- Berechnungslauf ---------------------------------------------------------------------------------

/**
 * Stable hash of the inputs that influence a run — the UI marks a result as stale when it changes.
 * @param {{ footprint?: Array<object>, stuetzen?: Array<object>, traeger?: Array<object>, level?: number, storeys?: number, qFlaeche?: number, fcd?: number, tragsystem?: string, spannweite?: number }} p
 */
export function eingabenHash(p = {}) {
  const st = (p.stuetzen || []).map((c) => `${c._idx ?? "?"}:${c.level || 0}:${rnd(c.x)}:${rnd(c.z)}:${c.size || 0.4}`).join("|");
  const tr = (p.traeger || []).map((t) => `${t.id}:${t.level}:${rnd(t.a.x)}:${rnd(t.a.z)}:${rnd(t.b.x)}:${rnd(t.b.z)}:${t.einzugsbreite_m}`).join("|");
  const fp = (p.footprint || []).map((q) => `${rnd(q.x)}:${rnd(q.z)}`).join("|");
  return [p.level ?? 0, p.storeys ?? 0, rnd(p.qFlaeche ?? 0, 3), rnd(p.fcd ?? 0, 1), p.tragsystem || "", p.spannweite ?? 0, fp, st, tr].join("#");
}

/**
 * One calculation run for a storey → the `ergebnis` stored in statik_layer.
 * @param {{ layer?: object, footprint?: Array<object>, stuetzen?: Array<object>, level?: number, storeys?: number, qFlaeche?: number, fcd?: number, tragsystem?: string, spannweite?: number, stand?: string }} p
 * @returns {{ stand: string, level: number, qFlaeche_kNm2: number, fcd_kNm2: number, hash: string, stuetzen: Array<object>, traeger: Array<object>, checks: Array<object>, summeN_kN: number }}
 */
export function berechnung({ layer, footprint, stuetzen, level = 0, storeys = 1, qFlaeche = 0, fcd = 0, tragsystem = "", spannweite = 0, stand } = {}) {
  const base = layerHardened(layer);
  const traegerHier = base.traeger.filter((t) => t.level === level);
  const st = stuetzenBerechnung({ footprint, stuetzen, level, storeys, qFlaeche, fcd });
  const tr = traegerBerechnung(traegerHier, { qFlaeche });
  const checks = tragwerkChecks({ stuetzen: st, traeger: tr, tragsystem, spannweite });
  return {
    stand: stand || new Date().toISOString(), level, qFlaeche_kNm2: rnd(qFlaeche, 3), fcd_kNm2: rnd(fcd, 1),
    hash: eingabenHash({ footprint, stuetzen, traeger: base.traeger, level, storeys, qFlaeche, fcd, tragsystem, spannweite }),
    stuetzen: st, traeger: tr, checks, summeN_kN: rnd(st.reduce((s, c) => s + c.N_kN, 0), 1),
  };
}
