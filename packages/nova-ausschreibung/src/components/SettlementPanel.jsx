// SettlementPanel — AVA › Abrechnung: measure awarded positions, compare them to
// the contract, and show the change orders that move the contract sum.
// 72-14 (N-14): the change order card leads to the decision — "{n} offen – in
// Finanzen entscheiden" links to the Finance page, and without open or approved
// change orders it offers "Nachtrag anlegen" (/Finance?neu=1). /Finance does not
// exist in the retired AVA standalone shell (D-P78-09); there the link hits the
// 404 — accepted.
//
// 72-15 (N-16): without an awarded contract the empty state speaks in the Sie form
// and leads to the price comparison ("Zum Preisspiegel" → onTab('prices')).
//
// In (props): tenders, positions, bids, measurements, changeOrders (already scoped
//   to the project by the page), onAddMeasurement(record), onTab(key) (optional:
//   switches the AVA tab, key = TabsTrigger value).
// Out: UI; new measurements go through onAddMeasurement.
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button, buttonVariants } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Progress } from "@core/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import FormModal from "@core/components/common/FormModal";
import { Plus, FileCheck2 } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { offeneNachtraege, neuerNachtragUrl, NACHTRAG_SEITE } from "@core/lib/nachtraege";
import { eur, eur0, num, bidUnitPrice } from "./avaUtils";

/**
 * Change order card of the settlement: approved change orders with their sum, the
 * new contract sum, and the way to the decision (open ones) or to a first change
 * order (none open or approved).
 * @param {object} props
 * @param {Array<Record<string, any>>} props.approvedCOs approved change orders
 * @param {number} props.offen number of undecided change orders (pending, in_progress)
 * @param {number} props.coSum sum of the approved change orders in euros
 * @param {number|null} [props.neueSumme] contract sum plus coSum in euros; null = no award yet
 */
function NachtraegeKarte({ approvedCOs, offen, coSum, neueSumme = null }) {
  const { t } = useI18n();
  const link = "font-medium text-blue-700 underline-offset-4 hover:underline";
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t("Nachträge")}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {approvedCOs.map((c) => (
          <div key={c.id} className="flex items-center justify-between">
            <span className="text-slate-700">{c.title}</span>
            <span className="tabular-nums">{eur0(c.cost_impact || 0)}</span>
          </div>
        ))}
        {approvedCOs.length > 0 && (
          <div className="flex items-center justify-between border-t pt-2 font-semibold">
            <span>{t("Nachträge (genehmigt)")}</span>
            <span className="tabular-nums text-amber-600">{eur0(coSum)}</span>
          </div>
        )}
        {approvedCOs.length > 0 && neueSumme != null && (
          <div className="flex items-center justify-between font-semibold">
            <span>{t("Neue Auftragssumme")}</span>
            <span className="tabular-nums">{eur0(neueSumme)}</span>
          </div>
        )}
        {offen > 0 && (
          <Link to={NACHTRAG_SEITE} className={`block text-xs ${link}`}>
            {t("{n} offen – in Finanzen entscheiden").replace("{n}", String(offen))}
          </Link>
        )}
        {approvedCOs.length === 0 && offen === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-500">{t("Keine offenen oder genehmigten Nachträge.")}</span>
            <Link to={neuerNachtragUrl()} className={link}>{t("Nachtrag anlegen")}</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettlementPanel({ tenders, positions, bids, measurements, onAddMeasurement, changeOrders, onTab = null }) {
  const { t } = useI18n();
  const awardedTenders = tenders.filter((t) => t.status === "awarded" && t.awarded_bid_id);
  const approvedCOs = (changeOrders || []).filter((c) => c.status === "approved");
  const coSum = approvedCOs.reduce((s, c) => s + (c.cost_impact || 0), 0);
  // Undecided = pending and in_progress — both still wait for a decision in Finance.
  const offen = offeneNachtraege(changeOrders).length;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ position_id: "", tender_id: "", quantity: 0, note: "" });

  // contract unit price for a position = awarded bid's line price.
  const contractEP = (tender, positionId) => {
    const bid = bids.find((b) => b.id === tender.awarded_bid_id);
    return bid ? bidUnitPrice(bid, positionId) : null;
  };
  const measuredQty = (positionId) =>
    measurements.filter((m) => m.position_id === positionId).reduce((s, m) => s + (m.quantity || 0), 0);

  const rows = useMemo(() => {
    const out = [];
    for (const t of awardedTenders) {
      for (const p of positions.filter((x) => t.position_ids?.includes(x.id))) {
        const ep = contractEP(t, p.id) || 0;
        const contractQty = p.quantity || 0;
        const measured = measuredQty(p.id);
        out.push({
          tender: t, pos: p, ep,
          contractSum: ep * contractQty,
          measured,
          settled: ep * measured,
          progress: contractQty ? Math.min(100, Math.round((measured / contractQty) * 100)) : 0,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awardedTenders, positions, bids, measurements]);

  const totalContract = rows.reduce((s, r) => s + r.contractSum, 0);
  const totalSettled = rows.reduce((s, r) => s + r.settled, 0);

  const allAwardedPositions = awardedTenders.flatMap((t) =>
    positions.filter((p) => t.position_ids?.includes(p.id)).map((p) => ({ ...p, tender_id: t.id })));

  const openForm = () => {
    const first = allAwardedPositions[0];
    setForm({ position_id: first?.id || "", tender_id: first?.tender_id || "", quantity: 0, note: "" });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const p = allAwardedPositions.find((x) => x.id === form.position_id);
    await onAddMeasurement({
      project_id: p?.project_id,
      position_id: form.position_id,
      tender_id: p?.tender_id || form.tender_id,
      quantity: Number(form.quantity) || 0,
      date: new Date().toISOString(),
      note: form.note,
    });
    setShowForm(false);
  };

  if (awardedTenders.length === 0) {
    return (
      <div className="space-y-4">
        <Card><CardContent className="p-8 text-center space-y-4">
          <p className="text-slate-500">
            {t("Noch keine vergebenen Aufträge. Erteilen Sie zuerst im Preisspiegel einen Zuschlag.")}
          </p>
          {onTab && (
            // Native button with the shadcn classes: <Button> costs a tsc error per use.
            <button type="button" onClick={() => onTab("prices")} className={buttonVariants({ variant: "outline" })}>
              {t("Zum Preisspiegel")}
            </button>
          )}
        </CardContent></Card>
        <NachtraegeKarte approvedCOs={approvedCOs} offen={offen} coSum={coSum} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Aufmaß & Abrechnung</h3>
          <p className="text-sm text-slate-500">Vergabesumme {eur0(totalContract)} · abgerechnet {eur0(totalSettled)}</p>
        </div>
        <Button onClick={openForm} className="bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="w-4 h-4 mr-2" /> Aufmaß erfassen
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-2 px-3">OZ</th>
                <th className="py-2 px-3">Position</th>
                <th className="py-2 px-3 text-right">Vergabe-EP</th>
                <th className="py-2 px-3 text-right">Auftragsmenge</th>
                <th className="py-2 px-3 text-right">Aufmaß</th>
                <th className="py-2 px-3 w-32">Fortschritt</th>
                <th className="py-2 px-3 text-right">Auftragssumme</th>
                <th className="py-2 px-3 text-right">Abgerechnet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pos.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="py-2 px-3 font-mono text-xs text-slate-500">{r.pos.oz}</td>
                  <td className="py-2 px-3">
                    <div className="font-medium text-slate-800">{r.pos.title}</div>
                    <div className="text-xs text-slate-400">{r.tender.name}</div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{eur(r.ep)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{num(r.pos.quantity)} {r.pos.unit}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{num(r.measured)} {r.pos.unit}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <Progress value={r.progress} className="h-2" />
                      <span className="text-xs text-slate-500 w-9 text-right">{r.progress}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{eur0(r.contractSum)}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-emerald-700">{eur0(r.settled)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="py-2 px-3" colSpan={6}>Summe</td>
                <td className="py-2 px-3 text-right tabular-nums">{eur0(totalContract)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{eur0(totalSettled)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <NachtraegeKarte approvedCOs={approvedCOs} offen={offen} coSum={coSum} neueSumme={totalContract + coSum} />

      {showForm && (
        <FormModal title="Aufmaß erfassen" onClose={() => setShowForm(false)}>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-xs">Position</Label>
              <Select value={form.position_id} onValueChange={(v) => setForm((f) => ({ ...f, position_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Position…" /></SelectTrigger>
                <SelectContent>
                  {allAwardedPositions.map((p) => <SelectItem key={p.id} value={p.id}>{p.oz} · {p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Aufgemessene Menge</Label>
              <Input type="number" step="any" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Bemerkung</Label>
              <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="z.B. Teilaufmaß, geprüft" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Abbrechen</Button>
              <Button type="submit" disabled={!form.position_id} className="bg-gradient-to-r from-emerald-600 to-teal-600">
                <FileCheck2 className="w-4 h-4 mr-2" /> Speichern
              </Button>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}
