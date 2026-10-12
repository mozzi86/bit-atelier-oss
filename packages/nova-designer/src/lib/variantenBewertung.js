// 75-10: evaluation of the building variants (the proposals of 86-05 — the one variant
// generator; no second one) after the user decisions D-P75-10-A…D (12.10.2026):
//   A  knock-outs = the existing HARD code rules only (planning errors of raumQualitaet = "fails",
//      escape route > 35 m MBO §35 Abs. 2); dimensions: compactness A/V, sealing, daylight,
//      living area / circulation share;
//   B  office standard = equal weights, overridable per project (werkstatt_layer.bewertungsGewichte);
//   C  grey energy as an [ASSUMED] order of magnitude (ÖKOBAUDAT-like values, source and licence
//      open) — shown, default weight 0 until a data source is settled;
//   D  NO soft criteria (no LLM judgement) — weight 0 / not offered (D-P76-03 rollback).
// Every dimension is a number with unit and source (register DIMENSIONEN); the ranking itself is
// the generic composite score (@core/lib/compositeScore) — sliders re-sort without recomputing.
//
// In:  proposal card data (kartenDaten of bebauungsvorschlaege: kennzahlen, riegelUmrisse,
//      rechteckUmriss), the context { footprintM, storeys, storeyHeight_m }, weights.
// Out: values per dimension, knock-outs, ranking. Pure, node-testable.

import { compositeScore } from "@core/lib/compositeScore";

/**
 * Grey energy guide values [ASSUMED, order of magnitude of ÖKOBAUDAT modules A1–A3 for solid
 * construction; replace with a licensed data set — D-P75-10-C]: kg CO₂e per m² of the component.
 */
export const GRAUE_ENERGIE = { bgf_kg_m2: 300, aussenwand_kg_m2: 120, dach_kg_m2: 150 };

/** Escape-route limit, m (MBO §35 Abs. 2 [CITED] — the 75-13 rule). */
export const RETTUNGSWEG_GRENZE_M = 35;

/**
 * The dimension register — key, label, unit, direction, source, office-standard weight.
 * @type {ReadonlyArray<{key: string, label: string, einheit: string, richtung: "hoch"|"niedrig", quelle: string, standard: number, annahme?: boolean}>}
 */
export const DIMENSIONEN = Object.freeze([
  { key: "av", label: "Kompaktheit A/V", einheit: "1/m", richtung: "niedrig", standard: 1,
    quelle: "Hüllfläche / Volumen: Σ Riegelumfang × Höhe + Dach + Bodenplatte, Volumen = belegte Fläche × Höhe (Höhe = Geschosse × Geschosshöhe); anstoßende Giebel zählen mit [ASSUMED]" },
  { key: "versiegelung", label: "Versiegelung je Wohnfläche", einheit: "m²/m²", richtung: "niedrig", standard: 1,
    quelle: "belegte Grundfläche (BGF / Geschosse) / Wohnfläche — überbaute Fläche, ohne Wege und Stellplätze [ASSUMED]" },
  { key: "belichtung", label: "Belichtung (Fassade je WE)", einheit: "m", richtung: "hoch", standard: 1,
    quelle: "Fassadenlänge je Wohnung als Maß der Fensterfläche (Kennzahl fassade_je_we_m) [ASSUMED Näherung, kein 1/8-Nachweis]" },
  { key: "effizienz", label: "Wohnfläche / BGF", einheit: "–", richtung: "hoch", standard: 1,
    quelle: "Wohnfläche / BGF (Kennzahl effizienz) — je kleiner der Erschließungsanteil, desto höher" },
  { key: "graueEnergie", label: "Graue Energie", einheit: "kg CO₂e/m² WF", richtung: "niedrig", standard: 0, annahme: true,
    quelle: "(BGF × 300 + Außenwand × 120 + Dach × 150) kg CO₂e / Wohnfläche — [ASSUMED] Größenordnung, Datenquelle und Lizenz offen (D-P75-10-C); Gewicht 0 im Bürostandard" },
]);

/** Office standard weights (D-P75-10-B): equal for the four decided dimensions, grey energy 0. */
export const BUERO_STANDARD = Object.freeze(Object.fromEntries(DIMENSIONEN.map((d) => [d.key, d.standard])));

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const kz = (karte, key) => num(karte?.kennzahlen?.[key]?.wert ?? karte?.kennzahlen?.[key]);
/** Perimeter of a polygon, m. */
const umfang = (p) => (Array.isArray(p) ? p.reduce((s, q, i) => s + Math.hypot(p[(i + 1) % p.length].x - q.x, p[(i + 1) % p.length].z - q.z), 0) : 0);

/**
 * Values of every dimension and the knock-outs of ONE proposal card.
 * @param {any} karte kartenDaten of a proposal
 * @param {{footprintM?: Array<{x:number,z:number}>|null, storeys?: number, storeyHeight_m?: number}} ctx
 * @returns {{werte: Record<string, number|null>, ko: string[]}}
 */
export function bewertungsWerte(karte, ctx = {}) {
  const n = Math.max(1, Math.round(num(ctx.storeys) ?? 1));
  const H = n * (num(ctx.storeyHeight_m) > 0 ? num(ctx.storeyHeight_m) : 3);
  const bgf = kz(karte, "bgf_m2");
  const wf = kz(karte, "wohnflaeche_m2");
  const belegt = bgf !== null ? bgf / n : null;
  const umrisse = Array.isArray(karte?.riegelUmrisse) && karte.riegelUmrisse.length ? karte.riegelUmrisse
    : Array.isArray(karte?.rechteckUmriss) && karte.rechteckUmriss.length >= 3 ? [karte.rechteckUmriss]
      : Array.isArray(ctx.footprintM) && ctx.footprintM.length >= 3 ? [ctx.footprintM] : [];
  const P = umrisse.reduce((s, u) => s + umfang(u), 0);
  const wand = P > 0 ? P * H : null;
  const av = belegt !== null && belegt > 0 && wand !== null ? (wand + 2 * belegt) / (belegt * H) : null;
  const versiegelung = belegt !== null && wf !== null && wf > 0 ? belegt / wf : null;
  const graue = bgf !== null && wf !== null && wf > 0 && wand !== null && belegt !== null
    ? (bgf * GRAUE_ENERGIE.bgf_kg_m2 + wand * GRAUE_ENERGIE.aussenwand_kg_m2 + belegt * GRAUE_ENERGIE.dach_kg_m2) / wf : null;
  const r4 = (v) => (v === null ? null : Math.round(v * 1e4) / 1e4);
  const werte = {
    av: r4(av), versiegelung: r4(versiegelung), belichtung: r4(kz(karte, "fassade_je_we_m")),
    effizienz: r4(kz(karte, "effizienz")), graueEnergie: graue === null ? null : Math.round(graue * 10) / 10,
  };
  // Knock-outs: hard code rules only (warn, not fail, is no knock-out — a design trade-off).
  const ko = [];
  const fails = kz(karte, "fails");
  if ((fails !== null && fails > 0) || karte?.hatFails === true) ko.push(`Planungsfehler (${fails ?? "≥ 1"} fail)`);
  const rw = kz(karte, "rettungsweg_max_m");
  if (rw !== null && rw > RETTUNGSWEG_GRENZE_M + 1e-9) ko.push(`Rettungsweg ${rw.toFixed(1).replace(".", ",")} m > ${RETTUNGSWEG_GRENZE_M} m (MBO §35)`);
  return { werte, ko };
}

/**
 * Weights in effect: the project override (werkstatt_layer.bewertungsGewichte) over the office
 * standard; unknown keys and negative/invalid values ignored.
 * @param {Record<string, number>|null|undefined} gewichte
 * @returns {Record<string, number>}
 */
export function wirksameGewichte(gewichte) {
  return { ...BUERO_STANDARD, ...Object.fromEntries(Object.entries(gewichte || {}).filter(([k, v]) => k in BUERO_STANDARD && num(v) !== null && num(v) >= 0).map(([k, v]) => [k, num(v)])) };
}

/** The dimension list in the shape compositeScore expects. */
export const SCORE_DIMENSIONEN = DIMENSIONEN.map((d) => ({ key: d.key, richtung: d.richtung }));

/**
 * Rank the proposal cards (see file head). Weights: project override over the office standard;
 * unknown keys ignored.
 * @param {Array<any>} karten kartenDaten list
 * @param {{footprintM?: Array<{x:number,z:number}>|null, storeys?: number, storeyHeight_m?: number}} ctx
 * @param {Record<string, number>|null|undefined} gewichte werkstatt_layer.bewertungsGewichte
 * @returns {{ergebnisse: Array<import("@core/lib/compositeScore").ScoreErgebnis & {werte: Record<string, number|null>}>, reihenfolge: string[], gewichte: Record<string, number>, roh: Record<string, number>}}
 */
export function bewerteVarianten(karten, ctx = {}, gewichte = null) {
  const roh = wirksameGewichte(gewichte);
  const varianten = (Array.isArray(karten) ? karten : []).map((k) => ({ id: String(k?.id ?? ""), ...bewertungsWerte(k, ctx) }));
  const r = compositeScore(varianten, SCORE_DIMENSIONEN, roh);
  return { ...r, ergebnisse: r.ergebnisse.map((e, i) => ({ ...e, werte: varianten[i].werte })), roh };
}
