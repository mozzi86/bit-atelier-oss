// ChangeOrderTable — change order history of the Finance page with the actions
// the status lifecycle allows (approve, reject, edit; 72-14, N-13).
//
// In:  the already scoped change orders, whether the project column is shown
//      (only in the "all projects" view) and the callbacks of the page.
// Out: UI only; status changes and edits are written by the page.
// Deliberately without delete: change orders are contract records, "Ablehnen"
// replaces deleting.
// 72-14 (N-14): a change order created from a ticket (issue_id) links back to it.
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Badge } from '@core/components/ui/badge';
import { Skeleton } from '@core/components/ui/skeleton';
import { buttonVariants } from '@core/components/ui/button';
import { useI18n } from '@core/lib/i18n';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { nachtragStatusLabel, uebergangErlaubt, bearbeitbar } from '@core/lib/nachtraege';
import { ticketUrl } from '@ifc/lib/ticketLink';

const statusColors = {
  pending: "bg-orange-100 text-orange-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-slate-100 text-slate-800"
};

// Class strings of the shadcn table parts (ui/table.jsx). Native elements, because
// each forwardRef table part costs a tsc error under the current React typing.
const TH = "h-10 px-2 text-left align-middle font-medium text-muted-foreground";
const TD = "p-2 align-middle";
const TR = "border-b transition-colors hover:bg-muted/50";

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** dd.MM.yyyy or "—" for a missing or unreadable date (format() throws on Invalid Date). */
function datum(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, 'dd.MM.yyyy') : "—";
}

/**
 * @param {object} props
 * @param {Array<Record<string, any>>} props.changeOrders change orders to list (already scoped by the page)
 * @param {boolean} props.isLoading
 * @param {boolean} [props.zeigeProjekt] show the project column ("all projects" view)
 * @param {string|null} [props.beschaeftigtId] id of the change order being saved; its buttons are disabled
 * @param {(order: Record<string, any>, neu: string) => void} [props.onStatus] approve/reject
 * @param {(order: Record<string, any>) => void} [props.onBearbeiten] open the edit form
 * @param {() => void} [props.onNeu] open the empty form (empty state)
 */
export default function ChangeOrderTable({ changeOrders, isLoading, zeigeProjekt = false, beschaeftigtId = null, onStatus, onBearbeiten, onNeu }) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>{t("Nachtragshistorie")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  const mitAktionen = !!(onStatus || onBearbeiten);
  const knopf = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader><CardTitle>{t("Nachtragshistorie")}</CardTitle></CardHeader>
      <CardContent>
        {changeOrders.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-4">
            <p className="text-slate-600">
              {zeigeProjekt ? t("Noch keine Nachträge") : t("Noch keine Nachträge für dieses Projekt")}
            </p>
            {onNeu && (
              <button type="button" className={buttonVariants({ variant: "default" })} onClick={onNeu}>
                <Plus aria-hidden="true" />
                {t("Ersten Nachtrag erfassen")}
              </button>
            )}
          </div>
        ) : (
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm" aria-label={t("Nachtragshistorie")}>
              <thead className="[&_tr]:border-b">
                <tr className={TR}>
                  <th scope="col" className={TH}>{t("Titel")}</th>
                  {zeigeProjekt && <th scope="col" className={TH}>{t("Projekt")}</th>}
                  <th scope="col" className={TH}>{t("Datum")}</th>
                  <th scope="col" className={TH}>{t("Kostenwirkung")}</th>
                  <th scope="col" className={TH}>{t("Status")}</th>
                  {mitAktionen && <th scope="col" className={TH}>{t("Aktionen")}</th>}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {changeOrders.map((order) => {
                  const titel = order.title || t("(ohne Titel)");
                  const aria = (schluessel) => t(schluessel).replace("{titel}", titel);
                  const gesperrt = beschaeftigtId === order.id;
                  return (
                    <tr key={order.id} className={TR} data-nachtrag={order.id}>
                      <td className={TD}>
                        <div className="font-medium">{titel}</div>
                        {order.issue_id && (
                          <Link to={ticketUrl(order.issue_id)}
                            className="text-xs text-blue-700 underline-offset-4 hover:underline"
                            aria-label={aria("Ticket zu Nachtrag „{titel}“ öffnen")}>
                            {t("Ticket")}
                          </Link>
                        )}
                      </td>
                      {zeigeProjekt && <td className={TD}>{order.project_name || "—"}</td>}
                      <td className={TD}>{datum(order.submission_date)}</td>
                      <td className={`${TD} ${order.cost_impact == null ? "text-slate-500" : order.cost_impact > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {/* null/undefined = amount deliberately not quantified — "—" instead of "NaN €" */}
                        {order.cost_impact == null ? "—" : eur.format(order.cost_impact)}
                      </td>
                      <td className={TD}>
                        <Badge className={statusColors[order.status]}>
                          {t(nachtragStatusLabel(order.status))}
                        </Badge>
                      </td>
                      {mitAktionen && (
                        <td className={TD}>
                          <div className="flex flex-wrap gap-1">
                            {onStatus && uebergangErlaubt(order.status, "approved") && (
                              <button type="button" className={knopf} disabled={gesperrt}
                                aria-label={aria("Nachtrag „{titel}“ genehmigen")}
                                onClick={() => onStatus(order, "approved")}>
                                {t("Genehmigen")}
                              </button>
                            )}
                            {onStatus && uebergangErlaubt(order.status, "rejected") && (
                              <button type="button" className={knopf} disabled={gesperrt}
                                aria-label={aria("Nachtrag „{titel}“ ablehnen")}
                                onClick={() => onStatus(order, "rejected")}>
                                {t("Ablehnen")}
                              </button>
                            )}
                            {onBearbeiten && bearbeitbar(order) && (
                              <button type="button" className={knopf} disabled={gesperrt}
                                aria-label={aria("Nachtrag „{titel}“ bearbeiten")}
                                onClick={() => onBearbeiten(order)}>
                                {t("Bearbeiten")}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
