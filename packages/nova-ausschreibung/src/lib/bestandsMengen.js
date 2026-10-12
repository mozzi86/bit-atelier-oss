// 73-08 (BEST-10/11): quantities of an existing building fall into four VISIBLE pots — demolition
// (Rückbau), existing fabric worked on (Bestand mitverarbeitet), new (Neu) and unknown (Unbekannt). The
// unknown pot is NOT spread over the others (that would turn "we do not know" into a number). Every pot
// states its Erfassungsgrad distribution in plain text ("von 340 m² Rückbaufläche sind 40 m² gemessen,
// 300 m² angenommen"), because a demolition quantity from an old drawing is a different promise than a
// measured one.
//
// No second quantity model: the pots read the SAME classified elements the filter quantities use
// (avaFilters.filterQuantity); the per-position share uses the same matchElement. A position whose
// quantity comes mostly from assumed elements is offered as a Bedarfsposition (kennz) — the GAEB 90 import
// already keeps that field (gaeb90.js), creating it was missing.
//
// In:  classified elements ({ status, erfassung?, mengen }), basis ("area"|"volume"|"length"|"count").
// Out: pure figures + German lines; no side effects.
import { matchElement } from "@ava/lib/avaFilters";

/** The four pots in display order; status → pot. kg/lb: DIN 276 cost group and STLB-Bau area [ASSUMED,
 * from the 73 draft: demolition KG 200 / LB 040 — check against the office's catalogue]. */
export const TOEPFE = Object.freeze([
  { key: "rueckbau", label: "Rückbau", status: "abbruch", kg: "200", hinweis: "KG 200 · Abbruch" },
  { key: "bestand", label: "Bestand mitverarbeitet", status: "bestand", kg: null, hinweis: "mitzuverarbeitende Bausubstanz (HOAI § 2 Abs. 7)" },
  { key: "neu", label: "Neu", status: "neubau", kg: "300/400", hinweis: "KG 300/400" },
  { key: "unbekannt", label: "Unbekannt", status: null, kg: null, hinweis: "ohne Status — nicht verteilt" },
]);

const ERF = ["gemessen", "abgeleitet", "altplan", "angenommen"];
const ERF_TEXT = { gemessen: "gemessen", abgeleitet: "abgeleitet", altplan: "aus Altplänen", angenommen: "angenommen", unbekannt: "ohne Erfassungsgrad" };
const EINHEIT = { area: "m²", volume: "m³", length: "m", count: "Stk" };
/** Share above which a position counts as "mostly assumed" (BEST-11) [ASSUMED: simple majority]. */
export const VERMUTET_SCHWELLE = 0.5;

const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (v) => r2(v).toLocaleString("de-DE", { maximumFractionDigits: 2 });
const topfVon = (status) => (status === "abbruch" ? "rueckbau" : status === "bestand" ? "bestand" : status === "neubau" ? "neu" : "unbekannt");
const erfVon = (e) => (ERF.includes(e) ? e : "unbekannt");

/**
 * Four pots with quantity and Erfassungsgrad distribution.
 * @param {Array<{status?: string|null, erfassung?: string|null, mengen?: Record<string, number>}>} elemente
 * @param {"area"|"volume"|"length"|"count"} [basis]
 * @returns {Array<{key: string, label: string, hinweis: string, menge: number, anzahl: number, einheit: string, verteilung: Record<string, number>, text: string}>}
 */
export function bestandsToepfe(elemente = [], basis = "area") {
  const leer = () => Object.fromEntries([...ERF, "unbekannt"].map((k) => [k, 0]));
  const acc = Object.fromEntries(TOEPFE.map((t) => [t.key, { menge: 0, anzahl: 0, verteilung: leer() }]));
  for (const e of elemente || []) {
    const m = Number(e?.mengen?.[basis]) || 0;
    const t = acc[topfVon(e?.status)];
    t.menge += m; t.anzahl += 1; t.verteilung[erfVon(e?.erfassung)] += m;
  }
  return TOEPFE.map((t) => {
    const a = acc[t.key];
    const einheit = EINHEIT[basis] || "";
    return {
      key: t.key, label: t.label, hinweis: t.hinweis, anzahl: a.anzahl, einheit,
      menge: r2(a.menge),
      verteilung: Object.fromEntries(Object.entries(a.verteilung).map(([k, v]) => [k, r2(v)])),
      text: verteilungsText(t.label, a.menge, a.verteilung, basis),
    };
  });
}

/** "Rückbau: von 340 m² sind 40 m² gemessen, 300 m² angenommen" — parts with 0 are left out. */
function verteilungsText(label, menge, verteilung, basis) {
  const einheit = EINHEIT[basis] || "";
  if (!(menge > 0)) return `Kein ${label}-Anteil.`;
  const teile = [...ERF, "unbekannt"].filter((k) => verteilung[k] > 0).map((k) => `${fmt(verteilung[k])} ${einheit} ${ERF_TEXT[k]}`);
  return `${label}: von ${fmt(menge)} ${einheit} sind ${teile.join(", ")}`;
}

/**
 * Share of a filter position's quantity that comes from assumed elements (BEST-11).
 * @param {object} filter the position's filter (avaFilters shape)
 * @param {Array<object>} elemente
 * @param {"area"|"volume"|"length"|"count"} [basis]
 * @returns {{menge: number, angenommen: number, anteil: number|null, vorschlag: "Bedarfsposition"|null}}
 *   anteil null without quantity; elements without Erfassungsgrad do NOT count as assumed (unknown ≠ assumed)
 */
export function vermutetAnteil(filter, elemente = [], basis = "area") {
  let menge = 0, angenommen = 0;
  for (const e of elemente || []) {
    if (!matchElement(filter, e)) continue;
    const m = Number(e?.mengen?.[basis]) || 0;
    menge += m;
    if (e?.erfassung === "angenommen") angenommen += m;
  }
  const anteil = menge > 0 ? r2(angenommen / menge) : null;
  return { menge: r2(menge), angenommen: r2(angenommen), anteil, vorschlag: anteil !== null && anteil > VERMUTET_SCHWELLE ? "Bedarfsposition" : null };
}
