// 75-10: composite scoring — ONE generic, transparent ranking over variants (pattern
// "Composite Scoring", 75-10 ROADMAP): every dimension is evaluated once per variant and kept as
// a number; the weights are user sliders, so a moved slider re-sorts WITHOUT recomputing any
// figure. Knock-out variants (hard code rules) are excluded from the ranking, never scored down.
// No hidden total: the result carries per variant the normalised value and the weighted
// contribution of every dimension ("why rank 1").
//
// Normalisation: min–max over the variants that are NOT knocked out, per dimension, direction
// aware ("hoch" = more is better, "niedrig" = less is better) → 0 … 1. All equal → 1 for every
// variant (the dimension does not separate them). A missing value (null) scores 0 and is listed
// in `fehlend` — never a placeholder number.
//
// In:  variants [{ id, werte: { key: number|null }, ko: string[] }], dimensions [{ key, richtung }],
//      weights { key: number ≥ 0 }. Out: ranking (pure, deterministic: ties by id).

/**
 * @typedef {object} ScoreVariante
 * @property {string} id
 * @property {Record<string, number|null>} werte raw value per dimension key (unit of the dimension)
 * @property {string[]} [ko] knock-out reasons (non-empty = excluded from the ranking)
 */

/**
 * @typedef {object} ScoreErgebnis
 * @property {string} id
 * @property {number|null} score weighted mean 0 … 1 (null when knocked out or no weight > 0)
 * @property {number|null} rang 1-based rank among the variants that are not knocked out
 * @property {Record<string, number>} normiert normalised value per dimension 0 … 1
 * @property {Record<string, number>} beitraege weighted contribution per dimension (sum = score)
 * @property {string[]} ko knock-out reasons
 * @property {string[]} fehlend dimensions without a value
 */

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Weights cleaned: finite, ≥ 0, unknown keys dropped; then normalised to sum 1 (all zero → all 0).
 * @param {Array<{key: string}>} dimensionen
 * @param {Record<string, number>|null|undefined} gewichte
 * @returns {Record<string, number>}
 */
export function gewichteNormieren(dimensionen, gewichte) {
  const roh = Object.fromEntries((dimensionen || []).map((d) => [d.key, Math.max(0, num(gewichte?.[d.key]) ?? 0)]));
  const summe = Object.values(roh).reduce((s, w) => s + w, 0);
  return Object.fromEntries(Object.entries(roh).map(([k, w]) => [k, summe > 0 ? w / summe : 0]));
}

/**
 * Rank variants by the weighted mean of their normalised dimension values (see file head).
 * @param {ScoreVariante[]} varianten
 * @param {Array<{key: string, richtung: "hoch"|"niedrig"}>} dimensionen
 * @param {Record<string, number>} gewichte raw slider values (any scale; normalised here)
 * @returns {{ergebnisse: ScoreErgebnis[], reihenfolge: string[], gewichte: Record<string, number>}}
 *   ergebnisse in input order; reihenfolge = ids ranked (knock-outs last, by id)
 */
export function compositeScore(varianten, dimensionen, gewichte) {
  const liste = Array.isArray(varianten) ? varianten : [];
  const dims = Array.isArray(dimensionen) ? dimensionen : [];
  const w = gewichteNormieren(dims, gewichte);
  const aktiv = Object.values(w).some((x) => x > 0);
  const gueltig = liste.filter((v) => !(Array.isArray(v.ko) && v.ko.length));
  const spanne = Object.fromEntries(dims.map((d) => {
    const xs = gueltig.map((v) => num(v.werte?.[d.key])).filter((x) => x !== null);
    return [d.key, xs.length ? [Math.min(...xs), Math.max(...xs)] : null];
  }));
  /** @type {ScoreErgebnis[]} */
  const ergebnisse = liste.map((v) => {
    const ko = Array.isArray(v.ko) ? v.ko.filter(Boolean).map(String) : [];
    /** @type {Record<string, number>} */
    const normiert = {};
    /** @type {Record<string, number>} */
    const beitraege = {};
    const fehlend = [];
    for (const d of dims) {
      const x = num(v.werte?.[d.key]);
      const sp = spanne[d.key];
      let n = 0;
      if (x === null) fehlend.push(d.key);
      else if (!sp || sp[1] - sp[0] < 1e-12) n = 1;
      else n = d.richtung === "niedrig" ? (sp[1] - x) / (sp[1] - sp[0]) : (x - sp[0]) / (sp[1] - sp[0]);
      n = Math.max(0, Math.min(1, n));
      normiert[d.key] = Math.round(n * 1e6) / 1e6;
      beitraege[d.key] = Math.round(n * w[d.key] * 1e6) / 1e6;
    }
    const score = ko.length || !aktiv ? null : Math.round(Object.values(beitraege).reduce((s, b) => s + b, 0) * 1e6) / 1e6;
    return { id: String(v.id), score, rang: null, normiert, beitraege, ko, fehlend };
  });
  const reihenfolge = [...ergebnisse].sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    if (a.score !== null && b.score !== null && Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  reihenfolge.forEach((e, i) => { if (e.score !== null) e.rang = i + 1; });
  return { ergebnisse, reihenfolge: reihenfolge.map((e) => e.id), gewichte: w };
}
