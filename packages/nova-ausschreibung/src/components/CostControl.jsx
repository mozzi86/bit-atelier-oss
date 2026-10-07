import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Stat } from "@core/components/Field";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, PieChart, Pie,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { eur0, gp, bidUnitPrice, DIN276 } from "./avaUtils";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { benchmarkFor, korridorText } from "@ava/lib/priceReference";

const DIN_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

// Quelle-Label + Datum für den Marktkontext (Attribution je Zahl, 2011/833/EU).
const SOURCE_LABELS = { ted: "TED (© EU)", doee: "DÖE (CC0)", demo: "Demo" };
const deDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
};

// Korridor bzw. graues „Kein Referenzpreis“-Badge — nie 0,00 €, nie €/Einheit.
const BenchmarkCell = ({ bm }) => {
  const text = bm.cell ? korridorText(bm.cell) : null;
  if (!text) {
    return (
      <span className="inline-block bg-slate-100 text-slate-500 rounded px-2 py-0.5 text-xs">
        Kein Referenzpreis (n=0) — Grund: {bm.reason || "zu wenige Zuschläge (n < 5)"}
      </span>
    );
  }
  return (
    <span className="italic text-blue-700 text-xs">
      {text} · Quelle {SOURCE_LABELS[bm.cell.source] || bm.cell.source}, {deDate(bm.cell.fetched_at)}
    </span>
  );
};

// Kostenkontrolle: estimate (Kostenanschlag) vs award (Vergabe) vs billed (Abrechnung).
export default function CostControl({ positions, tenders, bids, measurements, changeOrders, priceRefs = [] }) {
  const { costEstimate } = useBuildingProgram();
  const awardedTenders = tenders.filter((t) => t.status === "awarded" && t.awarded_bid_id);
  const approvedCOs = (changeOrders || []).filter((c) => c.status === "approved");
  const coSum = approvedCOs.reduce((s, c) => s + (c.cost_impact || 0), 0);

  const contractEP = (tender, posId) => {
    const bid = bids.find((b) => b.id === tender.awarded_bid_id);
    return bid ? (bidUnitPrice(bid, posId) ?? 0) : 0;
  };
  const measuredQty = (posId) =>
    measurements.filter((m) => m.position_id === posId).reduce((s, m) => s + (m.quantity || 0), 0);

  // per-trade aggregation
  const byTrade = useMemo(() => {
    const map = new Map();
    const ensure = (t) => { if (!map.has(t)) map.set(t, { trade: t, estimate: 0, award: 0, billed: 0 }); return map.get(t); };
    for (const p of positions) ensure(p.trade || "Sonstige").estimate += gp(p);
    for (const t of awardedTenders) {
      for (const p of positions.filter((x) => t.position_ids?.includes(x.id))) {
        const ep = contractEP(t, p.id);
        const row = ensure(p.trade || "Sonstige");
        row.award += ep * (p.quantity || 0);
        row.billed += ep * measuredQty(p.id);
      }
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, tenders, bids, measurements]);

  // DIN 276 breakdown (by estimate)
  const byDin = useMemo(() => {
    const map = new Map();
    for (const p of positions) {
      const kg = p.din276 || "390";
      map.set(kg, (map.get(kg) || 0) + gp(p));
    }
    return [...map.entries()].map(([kg, value]) => ({ name: `${kg} ${DIN276[kg]?.split(" ")[0] || ""}`, kg, value }));
  }, [positions]);

  const totEstimate = byTrade.reduce((s, r) => s + r.estimate, 0);
  const totAward = byTrade.reduce((s, r) => s + r.award, 0);
  const totBilled = byTrade.reduce((s, r) => s + r.billed, 0);
  const awardedEstimate = byTrade.reduce((s, r) => s + (r.award > 0 ? r.estimate : 0), 0);
  const savings = awardedEstimate - totAward; // positive = under budget
  const savingsPct = awardedEstimate ? (savings / awardedEstimate) * 100 : 0;

  return (
    <div className="space-y-4">
      {costEstimate?.total > 0 && (
        <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-800">
          Budget aus Kostenberechnung (Gebäudemodell): {eur0(costEstimate.total)} · {(costEstimate.bgf || 0).toLocaleString("de-DE")} m² BGF · {(costEstimate.perM2 || 0).toLocaleString("de-DE")} €/m²
          {" · "}LV-Anschlag {eur0(totEstimate)} →{" "}
          <span className={totEstimate > costEstimate.total ? "text-rose-600 font-medium" : "text-emerald-600 font-medium"}>
            {totEstimate > costEstimate.total ? "+" : ""}{(((totEstimate - costEstimate.total) / costEstimate.total) * 100).toFixed(1).replace(".", ",")} %
          </span>
        </div>
      )}
      <div className={`grid grid-cols-2 gap-3 ${approvedCOs.length > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <Stat label="Kostenanschlag (LV)" value={eur0(totEstimate)} accent="text-slate-700" />
        <Stat label="Vergabesumme" value={eur0(totAward)} accent="text-blue-600" />
        {approvedCOs.length > 0 && <Stat label="Nachträge" value={eur0(coSum)} accent="text-amber-600" />}
        <Stat label="Abgerechnet" value={eur0(totBilled)} accent="text-emerald-600" />
        <Stat
          label={savings >= 0 ? "Einsparung ggü. Anschlag" : "Mehrkosten ggü. Anschlag"}
          value={`${eur0(Math.abs(savings))} (${savingsPct.toFixed(1)}%)`}
          accent={savings >= 0 ? "text-emerald-600" : "text-rose-600"}
        />
      </div>
      {approvedCOs.length > 0 && (
        <p className="text-xs text-slate-500">
          Vergabesumme inkl. genehmigter Nachträge: {eur0(totAward + coSum)}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {savings >= 0 ? <TrendingDown className="w-4 h-4 text-emerald-600" /> : <TrendingUp className="w-4 h-4 text-rose-600" />}
            Soll-Ist je Gewerk
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byTrade} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="trade" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => eur0(v)} />
                <Legend />
                <Bar dataKey="estimate" name="Kostenanschlag" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="award" name="Vergabe" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="billed" name="Abgerechnet" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Phase 28: Marktkontext je Gewerk (Losebene) — Plausibilitätskorridor, nie EP */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Marktkontext je Gewerk (Losebene)</CardTitle>
          <p className="text-xs text-slate-400">
            Losvolumen-Vergleich aus öffentlichen Zuschlägen — keine Einheitspreise, keine
            Kalkulationsgrundlage.
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {byTrade.filter((r) => r.estimate > 0).map((r) => {
            const bm = benchmarkFor(priceRefs, { trade: r.trade, year: new Date().getFullYear() });
            return (
              <div key={r.trade} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm border-b last:border-0 pb-1.5">
                <span className="font-medium min-w-28">{r.trade}</span>
                <span className="tabular-nums text-slate-500">Anschlag {eur0(r.estimate)}</span>
                <BenchmarkCell bm={bm} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Kosten nach DIN 276</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byDin} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => e.kg}>
                    {byDin.map((_, i) => <Cell key={i} fill={DIN_COLORS[i % DIN_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => eur0(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Gewerke-Übersicht</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b">
                  <th className="py-2 px-3">Gewerk</th>
                  <th className="py-2 px-3 text-right">Anschlag</th>
                  <th className="py-2 px-3 text-right">Vergabe</th>
                  <th className="py-2 px-3 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {byTrade.map((r) => {
                  const delta = r.award > 0 ? r.estimate - r.award : 0;
                  return (
                    <tr key={r.trade} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{r.trade}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-500">{eur0(r.estimate)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.award > 0 ? eur0(r.award) : "—"}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-400"}`}>
                        {r.award > 0 ? eur0(delta) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
