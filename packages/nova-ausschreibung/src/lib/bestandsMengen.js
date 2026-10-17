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

/**
 * Cost group of demolition (97-07, concept §6): DIN 276:2018 knows KG 212 (Abbruchmaßnahmen when
 * preparing the site) and KG 394 (Abbruchmaßnahmen of the building's construction); in a
 * conversion DIN 276 also allows booking demolition "bei den betreffenden Kostengruppen" (3xx).
 * Chosen per project (Project.abbruch_kg), default 394. Trade: STLB-Bau LB 084, VOB/C DIN 18459.
 * Before 97-07: "KG 200 / LB 040" (LB 040 is heating plant).
 */
export const ABBRUCH_KG = Object.freeze([
  Object.freeze({ wert: "394", label: "KG 394 Abbruchmaßnahmen (Baukonstruktion)" }),
  Object.freeze({ wert: "212", label: "KG 212 Abbruchmaßnahmen (Herrichten)" }),
  Object.freeze({ wert: "3xx", label: "bei den betreffenden Kostengruppen (Umbau)" }),
]);
/** Default cost group of demolition. */
export const ABBRUCH_KG_STANDARD = "394";

/**
 * Note line of the demolition pot for the chosen cost group.
 * @param {string|null|undefined} kg "394" | "212" | "3xx"
 * @returns {string}
 */
export function rueckbauHinweis(kg) {
  const k = ABBRUCH_KG.some((x) => x.wert === kg) ? kg : ABBRUCH_KG_STANDARD;
  return `${k === "3xx" ? "KG 3xx" : `KG ${k}`} · LB 084 · DIN 18459`;
}

/** The four pots in display order; status → pot. kg: DIN 276 cost group (demolition per project, see ABBRUCH_KG). */
export const TOEPFE = Object.freeze([
  { key: "rueckbau", label: "Rückbau", status: "abbruch", kg: ABBRUCH_KG_STANDARD, hinweis: rueckbauHinweis(ABBRUCH_KG_STANDARD) },
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
 * @param {{abbruchKg?: string|null}} [opt] 97-07: cost group of demolition (default 394)
 * @returns {Array<{key: string, label: string, hinweis: string, kg: string|null, menge: number, anzahl: number, einheit: string, verteilung: Record<string, number>, text: string}>}
 */
export function bestandsToepfe(elemente = [], basis = "area", { abbruchKg = null } = {}) {
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
      key: t.key, label: t.label, anzahl: a.anzahl, einheit,
      hinweis: t.key === "rueckbau" ? rueckbauHinweis(abbruchKg) : t.hinweis,
      kg: t.key === "rueckbau" ? (ABBRUCH_KG.some((x) => x.wert === abbruchKg) ? /** @type {string} */ (abbruchKg) : ABBRUCH_KG_STANDARD) : t.kg,
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

/**
 * 97-06 rule 2 (concept §5): a tender position must not mix demolition with existing or new
 * work — they are different services (VOB/C DIN 18459 vs. the trade's own standard) and land in
 * different cost groups. Unknown status mixed with a known one is flagged too: it hides which
 * share is what. Hint, not a block: a lump-sum position can be intended.
 * @param {object} filter the position's filter (avaFilters shape)
 * @param {Array<{status?: string|null, mengen?: Record<string, number>}>} elemente
 * @param {"area"|"volume"|"length"|"count"} [basis]
 * @returns {{gemischt: boolean, anteile: Record<string, number>}} anteile: quantity per status ("ohne" = no status)
 */
export function statusMischung(filter, elemente = [], basis = "area") {
  /** @type {Record<string, number>} */
  const anteile = {};
  for (const e of elemente || []) {
    if (!matchElement(filter, e)) continue;
    const m = Number(e?.mengen?.[basis]) || 0;
    if (!(m > 0)) continue;
    const k = e?.status === "abbruch" || e?.status === "bestand" || e?.status === "neubau" ? e.status : "ohne";
    anteile[k] = r2((anteile[k] || 0) + m);
  }
  const arten = Object.keys(anteile);
  const gemischt = (arten.includes("abbruch") && arten.some((k) => k !== "abbruch")) || (arten.includes("ohne") && arten.length > 1);
  return { gemischt, anteile };
}
