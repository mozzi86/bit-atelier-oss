// 90-10: cost control per cost group (DIN 276 Kostengruppe) — the table behind the Excel export template
// and the "Budgeterhöhung je KG" request. Council 10.10.2026 (HANDOFF-SKILLS-INTEGRATION §3): the office
// skills "…-kostenkontrolle" (Excel overview) and "…-kog-erhoehung" (budget increase) work outside the app;
// CostControl.jsx already shows estimate / award / billed per trade, but not per KG and without export.
//
// In:  LV positions (quantity, unit_price = estimate EP, din276, trade), tenders (status, awarded_bid_id,
//      position_ids), bids (line items), measurements (position_id, quantity), approved change orders.
// Out: pure rows per KG and per trade, the table models for tabellenAlsXlsx (@core/lib/tabellenExport), the
//      suggested values of a budget-increase request. Amounts in euro, net.
//
// Prognose per KG = contract value of the awarded positions + estimate of the positions not yet awarded
// (the usual "Kostenprognose" of an office cost control) [ASSUMED]. Change orders carry no KG in the data
// model, so they appear as one total row, never spread over KGs by guessing.

import { DIN276 } from "../components/avaUtils.js";

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Contract unit price of a position in an awarded tender, null when the bid has no price for it. */
function vertragsEp(tender, bids, posId) {
  const bid = bids.find((b) => b.id === tender.awarded_bid_id);
  const li = (bid?.line_items || []).find((l) => l.position_id === posId);
  return li && Number.isFinite(Number(li.unit_price)) ? Number(li.unit_price) : null;
}

/**
 * Rows per DIN 276 cost group (3-digit KG of the position; positions without KG → "390"/"490" is NOT
 * guessed: they go to "ohne KG").
 * @param {{positions: Array<any>, tenders?: Array<any>, bids?: Array<any>, measurements?: Array<any>}} p
 * @returns {Array<{kg: string, bezeichnung: string, budget: number, vergabe: number, abgerechnet: number, offen_anschlag: number,
 *   prognose: number, abweichung: number, abweichung_anteil: number|null, vergeben_anteil: number|null}>}
 *   budget = LV estimate of the KG; vergeben_anteil = share of the budget already awarded (0…1)
 */
export function kostenJeKg({ positions, tenders = [], bids = [], measurements = [] }) {
  const vergeben = new Map(); // position id → contract EP
  for (const t of tenders) {
    if (t.status !== "awarded" || !t.awarded_bid_id) continue;
    for (const id of t.position_ids || []) {
      const ep = vertragsEp(t, bids, id);
      if (ep !== null) vergeben.set(id, ep);
    }
  }
  const menge = (id) => measurements.filter((m) => m.position_id === id).reduce((s, m) => s + num(m.quantity), 0);
  const map = new Map();
  for (const p of positions || []) {
    const kg = p.din276 ? String(p.din276) : "ohne KG";
    if (!map.has(kg)) map.set(kg, { kg, bezeichnung: DIN276[kg] || (kg === "ohne KG" ? "Positionen ohne Kostengruppe" : ""), budget: 0, vergabe: 0, abgerechnet: 0, offen_anschlag: 0, budgetVergeben: 0 });
    const z = map.get(kg);
    const anschlag = num(p.quantity) * num(p.unit_price);
    z.budget += anschlag;
    if (vergeben.has(p.id)) {
      const ep = /** @type {number} */ (vergeben.get(p.id));
      z.vergabe += ep * num(p.quantity);
      z.abgerechnet += ep * menge(p.id);
      z.budgetVergeben += anschlag;
    } else {
      z.offen_anschlag += anschlag;
    }
  }
  return [...map.values()]
    .sort((a, b) => (a.kg === "ohne KG" ? 1 : b.kg === "ohne KG" ? -1 : a.kg.localeCompare(b.kg)))
    .map(({ budgetVergeben, ...z }) => {
      const prognose = z.vergabe + z.offen_anschlag;
      return {
        ...z, budget: r2(z.budget), vergabe: r2(z.vergabe), abgerechnet: r2(z.abgerechnet), offen_anschlag: r2(z.offen_anschlag),
        prognose: r2(prognose), abweichung: r2(prognose - z.budget),
        abweichung_anteil: z.budget > 0 ? Math.round((prognose - z.budget) / z.budget * 10000) / 10000 : null,
        vergeben_anteil: z.budget > 0 ? Math.round(budgetVergeben / z.budget * 10000) / 10000 : null,
      };
    });
}

/**
 * Table models for the Excel export template: sheet 1 per KG with a total row, sheet 2 change orders.
 * Labels German (the export is the office document).
 * @param {ReturnType<typeof kostenJeKg>} zeilen
 * @param {Array<{title?: string, cost_impact?: number, status?: string, submission_date?: string}>} [nachtraege] approved change orders
 * @returns {Array<{titel: string, spalten: Array<{key: string, label: string, typ?: string, breite?: number}>, zeilen: Array<Record<string, any>>}>}
 */
export function exportModelle(zeilen, nachtraege = []) {
  const sum = (k) => r2(zeilen.reduce((s, z) => s + num(z[k]), 0));
  const budget = sum("budget"), prognose = sum("prognose");
  return [
    {
      titel: "Kosten je KG",
      spalten: [
        { key: "kg", label: "KG", typ: "text", breite: 9 }, { key: "bezeichnung", label: "Bezeichnung", typ: "text", breite: 36 },
        { key: "budget", label: "Budget (LV-Anschlag)", typ: "betrag" }, { key: "vergabe", label: "Vergabe", typ: "betrag" },
        { key: "offen_anschlag", label: "noch nicht vergeben (Anschlag)", typ: "betrag" }, { key: "prognose", label: "Prognose", typ: "betrag" },
        { key: "abweichung", label: "Abweichung", typ: "betrag" }, { key: "abweichung_prozent", label: "Abweichung %", typ: "prozent" },
        { key: "abgerechnet", label: "Abgerechnet", typ: "betrag" },
      ],
      // tabellenExport writes "prozent" as the plain number (format 0.00) → percent, not share.
      zeilen: [...zeilen.map((z) => ({ ...z, abweichung_prozent: z.abweichung_anteil === null ? null : r2(z.abweichung_anteil * 100) })), {
        kg: "", bezeichnung: "Summe", budget, vergabe: sum("vergabe"), offen_anschlag: sum("offen_anschlag"), prognose,
        abweichung: r2(prognose - budget), abweichung_prozent: budget > 0 ? r2((prognose - budget) / budget * 100) : null, abgerechnet: sum("abgerechnet"),
      }],
    },
    {
      titel: "Nachträge",
      spalten: [{ key: "title", label: "Nachtrag", typ: "text", breite: 44 }, { key: "submission_date", label: "Eingang", typ: "datum" }, { key: "cost_impact", label: "Betrag", typ: "betrag" }],
      zeilen: [...nachtraege.map((n) => ({ title: n.title || "", submission_date: n.submission_date ? String(n.submission_date).slice(0, 10) : "", cost_impact: num(n.cost_impact) })),
        { title: "Summe genehmigter Nachträge (ohne KG-Zuordnung)", submission_date: "", cost_impact: r2(nachtraege.reduce((s, n) => s + num(n.cost_impact), 0)) }],
    },
  ];
}

/**
 * Suggested values of a budget-increase request for one KG: new budget = prognosis rounded UP to the next
 * 1 000 € [ASSUMED rounding of office requests], justification naming the overrun and the awarded share.
 * @param {ReturnType<typeof kostenJeKg>[number]} z
 * @returns {{budget_alt: number, budget_neu: number, erhoehung: number, begruendung: string}}
 */
export function antragVorschlag(z) {
  const neu = Math.max(z.budget, Math.ceil(z.prognose / 1000) * 1000);
  const fmt = (v) => Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const pct = z.abweichung_anteil === null ? "" : ` (${(z.abweichung_anteil * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %)`;
  const verg = z.vergeben_anteil === null ? "" : ` ${Math.round(z.vergeben_anteil * 100)} % des Budgets der KG sind vergeben (Vergabesumme ${fmt(z.vergabe)}).`;
  return {
    budget_alt: z.budget, budget_neu: neu, erhoehung: r2(neu - z.budget),
    begruendung: z.abweichung > 0
      ? `Die Kostenprognose der KG ${z.kg} liegt mit ${fmt(z.prognose)} um ${fmt(z.abweichung)}${pct} über dem Budget von ${fmt(z.budget)}.${verg} Ursache: ______.`
      : `Die Kostenprognose der KG ${z.kg} (${fmt(z.prognose)}) liegt im Budget von ${fmt(z.budget)}. Begründung der Erhöhung: ______.`,
  };
}
