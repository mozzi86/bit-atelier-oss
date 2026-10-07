import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@core/components/ui/table";
import { TrendingUp } from "lucide-react";

const normalize = (d) => (Array.isArray(d) ? d : Object.values(d || {}));
const eur = (n) => `${Math.round(n).toLocaleString("de-DE")} €`;

// Leitet die Vergleichsszenarien aus der Basisvariante der Machbarkeitsdaten ab.
export default function ScenarioComparison({ baselineData }) {
  const base = useMemo(() => {
    const units = normalize(baselineData?.unit_mix).reduce((s, u) => s + (Number(u.count) || 0), 0);
    const fin = baselineData?.financials || {};
    return {
      gfa: baselineData?.massing?.total_gfa || 0,
      far: baselineData?.massing?.calculated_far || 0,
      units,
      cost: fin.total_project_cost || 0,
      noi: fin.annual_noi || 0,
      roi: fin.roi || 0,
    };
  }, [baselineData]);

  // Faktoren auf die Basisvariante; Kosten skalieren unterlinear zur BGF.
  const [scenarios] = useState([
    { name: "Basisvariante", color: "bg-slate-100 text-slate-700", f: { gfa: 1, units: 1, cost: 1, noi: 1 } },
    { name: "Verdichtet +20%", color: "bg-blue-100 text-blue-800", f: { gfa: 1.2, units: 1.2, cost: 1.15, noi: 1.22 } },
    { name: "Premium-Mix", color: "bg-purple-100 text-purple-800", f: { gfa: 1.0, units: 0.9, cost: 1.08, noi: 1.18 } },
    { name: "Kostenoptimiert", color: "bg-emerald-100 text-emerald-800", f: { gfa: 0.95, units: 1.0, cost: 0.88, noi: 0.97 } },
  ]);

  const rows = scenarios.map((s) => {
    const gfa = base.gfa * s.f.gfa;
    const units = Math.round(base.units * s.f.units);
    const cost = base.cost * s.f.cost;
    const noi = base.noi * s.f.noi;
    const roi = cost ? noi / cost : 0;
    return { ...s, gfa, units, cost, noi, roi, far: base.far * s.f.gfa };
  });

  const bestRoi = Math.max(...rows.map((r) => r.roi));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="w-4 h-4" /> Szenarienvergleich
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Szenario</TableHead>
              <TableHead>BGF</TableHead>
              <TableHead>GFZ</TableHead>
              <TableHead>Einheiten</TableHead>
              <TableHead>Projektkosten</TableHead>
              <TableHead>NOI p.a.</TableHead>
              <TableHead>ROI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell>
                  <Badge className={r.color}>{r.name}</Badge>
                </TableCell>
                <TableCell>{Math.round(r.gfa).toLocaleString("de-DE")} m²</TableCell>
                <TableCell>{r.far.toFixed(2)}</TableCell>
                <TableCell>{r.units}</TableCell>
                <TableCell>{eur(r.cost)}</TableCell>
                <TableCell>{eur(r.noi)}</TableCell>
                <TableCell>
                  <span className={r.roi === bestRoi ? "font-bold text-emerald-600" : ""}>
                    {(r.roi * 100).toFixed(1)} %
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-slate-400 mt-3">
          Szenarien werden aus der Basisvariante abgeleitet (Faktormodell). Bester ROI hervorgehoben.
        </p>
      </CardContent>
    </Card>
  );
}
