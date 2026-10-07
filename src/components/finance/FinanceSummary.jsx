// Key-figure tiles above the change-order table on the finance page.
//
// In:  the change orders in scope (the active project's, or all projects when
//      the finance page's "Alle Projekte" toggle is on) and the loading flag.
// Out: four tiles — total cost impact, approved cost impact, number of change
//      orders, number still awaiting a decision. Amounts in euro.
//
// "Awaiting a decision" uses the same rule as AVA › Abrechnung, the project
// overview and the report (offeneNachtraege: pending AND in_progress). Before
// the merge of 27.09. this tile counted pending only, so the settlement link
// "2 offen – in Finanzen entscheiden" landed on a tile saying 1 (KETTE-05).

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Skeleton } from '@core/components/ui/skeleton';
import { ArrowUpRight, ArrowDownRight, Sigma, FileText } from 'lucide-react';
import { useI18n } from '@core/lib/i18n';
import { nachtragsSummen, offeneNachtraege } from '@core/lib/nachtraege';

const StatCard = ({ title, value, icon: Icon, color }) => (
  <Card className="border-0 shadow-lg">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-slate-600">{title}</CardTitle>
      <Icon className={`h-4 w-4 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
    </CardContent>
  </Card>
);

/**
 * Key-figure tiles for the change orders in scope.
 * @param {{ changeOrders: Array<{status?: string, cost_impact?: number|null}>, isLoading: boolean }} props
 *   changeOrders: change orders already filtered to the page's scope; cost_impact in euro
 *   (null = not quantified yet, counts as 0 €); isLoading: show skeletons instead of numbers.
 * @returns {JSX.Element}
 */
export default function FinanceSummary({ changeOrders, isLoading }) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  const totalImpact = changeOrders.reduce((sum, order) => sum + (order.cost_impact || 0), 0);
  // Approved = approved + completed (completed is only reachable from approved),
  // the same bucket the settlement and the report sum up.
  const approvedImpact = nachtragsSummen(changeOrders).genehmigt.summe;
  const pendingOrders = offeneNachtraege(changeOrders).length;
  const totalOrders = changeOrders.length;
  const formatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t("Kostenwirkung gesamt")}
        value={formatter.format(totalImpact)}
        icon={totalImpact >= 0 ? ArrowUpRight : ArrowDownRight}
        color={totalImpact >= 0 ? "text-red-500" : "text-emerald-500"}
      />
      <StatCard
        title={t("Genehmigte Kostenwirkung")}
        value={formatter.format(approvedImpact)}
        icon={Sigma}
        color="text-blue-500"
      />
      <StatCard
        title={t("Nachträge gesamt")}
        value={totalOrders}
        icon={FileText}
        color="text-slate-500"
      />
      <StatCard
        title={t("Zur Genehmigung offen")}
        value={pendingOrders}
        icon={FileText}
        color="text-orange-500"
      />
    </div>
  );
}
