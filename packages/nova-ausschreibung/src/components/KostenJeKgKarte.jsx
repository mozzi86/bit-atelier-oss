// 90-10: cost control per DIN 276 cost group inside CostControl — table (budget = LV estimate, award,
// not yet awarded, prognosis, deviation, billed), the Excel export template (two sheets: per KG, change
// orders) and, per KG, a request for a budget increase as PDF draft with suggested values.
//
// In:  positions, tenders, bids, measurements, changeOrders (approved ones are exported). Project from useProject().
// Out: the card; data-testids kk-tabelle (data-zeilen), kk-zeile (data-kg, data-abweichung), kk-xlsx,
//      kk-antrag (per row), ka-budget, ka-begruendung, ka-deckung, ka-pdf, kk-fehler.
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import FormModal from "@core/components/common/FormModal";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { tabellenAlsXlsx, dateiAnbieten } from "@core/lib/tabellenExport";
import { kostenJeKg, exportModelle, antragVorschlag } from "@ava/lib/kostenJeKg";
import { budgetAntragPdf } from "@ava/lib/budgetAntragPdf";
import { FileSpreadsheet, FileUp } from "lucide-react";

const eur = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) : "—");

/**
 * @param {{positions: Array<any>, tenders: Array<any>, bids: Array<any>, measurements: Array<any>, changeOrders?: Array<any>}} props
 */
export default function KostenJeKgKarte({ positions, tenders, bids, measurements, changeOrders = [] }) {
  const { t } = useI18n();
  const { project } = useProject();
  const [antrag, setAntrag] = useState(/** @type {null | {zeile: any, budget: string, begruendung: string, deckung: string}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const zeilen = kostenJeKg({ positions, tenders, bids, measurements });

  const xlsx = () => {
    try {
      const bytes = tabellenAlsXlsx(exportModelle(zeilen, changeOrders.filter((c) => c.status === "approved")));
      dateiAnbieten(bytes, `Kostenkontrolle_${String(project?.name || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
  };
  const antragOeffnen = (z) => {
    const v = antragVorschlag(z);
    setAntrag({ zeile: z, budget: String(v.budget_neu), begruendung: v.begruendung, deckung: "" });
  };
  const antragPdf = async () => {
    if (!antrag) return;
    try {
      const { bytes, dateiname } = await budgetAntragPdf({ projekt: project, zeile: antrag.zeile, budget_neu: Number(antrag.budget), begruendung: antrag.begruendung, deckung: antrag.deckung });
      dateiAnbieten(bytes, dateiname, "application/pdf");
    } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{t("Kostenkontrolle je Kostengruppe (DIN 276)")}</CardTitle>
        <Button size="sm" variant="outline" onClick={xlsx} disabled={!zeilen.length} data-testid="kk-xlsx"><FileSpreadsheet className="mr-1.5 h-4 w-4" /> {t("Excel-Export")}</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {fehler && <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert" data-testid="kk-fehler">{fehler}</div>}
        <table className="w-full text-xs" data-testid="kk-tabelle" data-zeilen={zeilen.length}>
          <thead className="text-left text-slate-400"><tr className="border-b">
            <th className="px-2 py-1">KG</th><th className="px-2 py-1">{t("Bezeichnung")}</th><th className="px-2 py-1 text-right">{t("Budget (LV-Anschlag)")}</th>
            <th className="px-2 py-1 text-right">{t("Vergabe")}</th><th className="px-2 py-1 text-right">{t("Prognose")}</th><th className="px-2 py-1 text-right">{t("Abweichung")}</th>
            <th className="px-2 py-1 text-right">{t("Abgerechnet")}</th><th></th></tr></thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.kg} className="border-b last:border-0" data-testid="kk-zeile" data-kg={z.kg} data-abweichung={z.abweichung}>
                <td className="px-2 py-1 font-mono">{z.kg}</td>
                <td className="px-2 py-1">{z.bezeichnung}</td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(z.budget)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(z.vergabe)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(z.prognose)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${z.abweichung > 0.005 ? "text-rose-600 font-medium" : z.abweichung < -0.005 ? "text-emerald-600" : ""}`}>{z.abweichung > 0 ? "+" : ""}{eur(z.abweichung)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(z.abgerechnet)}</td>
                <td className="px-2 py-1 text-right">
                  <button type="button" className={`inline-flex items-center gap-1 text-[11px] hover:underline ${z.abweichung > 0.005 ? "text-rose-700" : "text-slate-400"}`} onClick={() => antragOeffnen(z)} data-testid="kk-antrag">
                    <FileUp className="h-3 w-3" /> {t("Budgeterhöhung")}
                  </button>
                </td>
              </tr>
            ))}
            {!zeilen.length && <tr><td colSpan={8} className="px-2 py-3 text-center text-slate-400">{t("Keine LV-Positionen.")}</td></tr>}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-400">{t("Prognose = Vergabesumme der vergebenen Positionen + Anschlag der noch nicht vergebenen. Nachträge haben keine Kostengruppe und stehen im Export als eigene Summe.")}</p>
      </CardContent>

      {antrag && (
        <FormModal title={`${t("Antrag auf Budgeterhöhung")} — KG ${antrag.zeile.kg}`} onClose={() => setAntrag(null)}>
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border p-2"><div className="text-slate-500">{t("Budget bisher")}</div><b>{eur(antrag.zeile.budget)}</b></div>
              <div className="rounded border p-2"><div className="text-slate-500">{t("Prognose")}</div><b>{eur(antrag.zeile.prognose)}</b></div>
              <label className="block rounded border p-2"><span className="text-slate-500">{t("Beantragtes Budget (€)")}</span>
                <input className="mt-0.5 h-7 w-full rounded border border-slate-300 px-1.5" type="number" step="any" value={antrag.budget} onChange={(e) => setAntrag({ ...antrag, budget: e.target.value })} data-testid="ka-budget" /></label>
            </div>
            <label className="block"><span className="text-slate-500">{t("Begründung (Lücken ______ ergänzen)")}</span>
              <textarea className="mt-0.5 w-full rounded border border-slate-300 p-1.5" rows={4} value={antrag.begruendung} onChange={(e) => setAntrag({ ...antrag, begruendung: e.target.value })} data-testid="ka-begruendung" /></label>
            <label className="block"><span className="text-slate-500">{t("Deckungsvorschlag")}</span>
              <textarea className="mt-0.5 w-full rounded border border-slate-300 p-1.5" rows={2} value={antrag.deckung} onChange={(e) => setAntrag({ ...antrag, deckung: e.target.value })} placeholder={t("z. B. Einsparung in KG …, Reserve")} data-testid="ka-deckung" /></label>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAntrag(null)}>{t("Schließen")}</Button>
              <Button type="button" onClick={antragPdf} disabled={!Number.isFinite(Number(antrag.budget)) || antrag.budget.trim() === ""} data-testid="ka-pdf" className="bg-gradient-to-r from-emerald-600 to-teal-600">{t("Antrag als PDF (Entwurf)")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}
