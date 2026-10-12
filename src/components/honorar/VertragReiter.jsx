// Tab "Architektenverträge" of /Fees (phase 81-04, HON-03…06): the contracts of
// the active project (or all), with number (or "ohne Nummer" for contracts 79
// created), service profile, status, sum incl. fee amendments and rest. The
// chosen contract shows its fee basis — editable through 79's own form while the
// contract is a draft or has no phase-81 status (one editor per value, D-P81-34),
// otherwise read-only as the breakdown with the hint to record changes as a fee
// amendment — the contract data dialog (stages, dates, liability, order
// confirmation) and the contract account with the instalment invoice.
//
// In:  props zh, wert, alleProjekte. Out: the tab; loads 79's books once (for
//      the embedded forms and the insurance prefill).

import React from "react";
import { Pencil, Settings2 } from "lucide-react";
import EmptyState from "@core/components/common/EmptyState";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { aufstellung } from "@/lib/honorar/aufstellung.js";
import { vertragskonto } from "@/lib/honorar/vertrag.js";
import { VERTRAG_STATUS } from "@/lib/honorar/vertragsdaten.js";
import { useBuchhaltung } from "@/components/accounting/useBuchhaltung.js";
import HonorarvertragFormular from "@/components/accounting/HonorarvertragFormular.jsx";
import AufstellungTabelle from "./AufstellungTabelle.jsx";
import VertragZusatz from "./VertragZusatz.jsx";
import Vertragskonto from "./Vertragskonto.jsx";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, wert: (id: string) => any, alleProjekte: boolean}} props
 * @returns {React.ReactElement}
 */
export default function VertragReiter({ zh, wert, alleProjekte }) {
  const { t, lang } = useI18n();
  const bh = useBuchhaltung({ heute: zh.heute });
  const { briefkopf } = useBriefkopf();
  const [gewaehlt, setGewaehlt] = React.useState(/** @type {string|null} */ (null));
  const [dialog, setDialog] = React.useState(/** @type {'zusatz'|'grundlagen'|null} */ (null));
  const projektNamen = React.useMemo(() => new Map(zh.projekte.map((p) => [p.id, p.name])), [zh.projekte]);
  const vertraege = (zh.daten.Honorarvertrag || []).filter((v) => alleProjekte || !zh.projectId || v.project_id === zh.projectId);
  const vertrag = vertraege.find((v) => v.id === gewaehlt) || vertraege[0] || null;
  const euro = (/** @type {number|null} */ x) => (x === null ? t("Tafel fehlt") : formatEuro(Math.round(x * 100), lang));
  const kontoDaten = (/** @type {any} */ v) => ({
    rechnungen: zh.daten.Ausgangsrechnung || [], nachtraege: zh.daten.Honorarnachtrag || [],
    hoaiPlan: (zh.daten.HoaiPlan || []).find((h) => h.project_id === v.project_id) || null,
    projekt: zh.projekte.find((p) => p.id === v.project_id) || null,
  });

  if (!vertraege.length) {
    return <EmptyState title={t("Noch kein Architektenvertrag")} description={t("Ein Architektenvertrag entsteht, wenn ein versendetes Honorarangebot angenommen wird.")} />;
  }
  const grundlagenBearbeitbar = vertrag && (!vertrag.status || vertrag.status === "entwurf");

  return (
    <div className="space-y-4" data-testid="vertrag-reiter">
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-left text-slate-600 dark:text-slate-300">
              <th scope="col" className="px-3 py-2">{t("Nummer")}</th>
              {alleProjekte && <th scope="col" className="px-3 py-2">{t("Projekt")}</th>}
              <th scope="col" className="px-3 py-2">{t("Leistungsbild")}</th>
              <th scope="col" className="px-3 py-2">{t("Status")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("Summe inkl. Honorarnachträge")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("Rest bis zur Schlussrechnung")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {vertraege.map((v) => {
              const k = vertragskonto(v, kontoDaten(v));
              const info = leistungsbildInfo(v.leistungsbild);
              return (
                <tr key={v.id} className={v.id === vertrag?.id ? "bg-emerald-50/60 dark:bg-emerald-950/40" : ""} data-testid="vertrag-zeile" data-nummer={v.nummer || ""}>
                  <td className="px-3 py-2">
                    <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setGewaehlt(v.id)} aria-pressed={v.id === vertrag?.id}>
                      {v.nummer || t("ohne Nummer")}
                    </button>
                  </td>
                  {alleProjekte && <td className="px-3 py-2">{projektNamen.get(v.project_id) || v.project_id}</td>}
                  <td className="px-3 py-2">{t(info?.label || v.leistungsbild)} · § {info?.tafelParagraf ?? ""}</td>
                  <td className="px-3 py-2">{t(/** @type {any} */ (VERTRAG_STATUS)[v.status]?.label || "ohne Status")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{euro(k.summe)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{euro(k.rest)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {vertrag && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="vertrag-detail">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{t("Architektenvertrag")} {vertrag.nummer || t("ohne Nummer")}</h2>
            <div className="ml-auto flex flex-wrap gap-2">
              {grundlagenBearbeitbar && (
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setDialog("grundlagen")} disabled={!bh.verfuegbar || bh.laedt}>
                  <Pencil aria-hidden="true" /> {t("Honorar-Grundlagen bearbeiten")}
                </button>
              )}
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setDialog("zusatz")}>
                <Settings2 aria-hidden="true" /> {t("Vertragsdaten")}
              </button>
            </div>
          </div>
          {!grundlagenBearbeitbar && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Änderungen an einem beauftragten Vertrag als Honorarnachtrag erfassen.")}</p>}
          <AufstellungTabelle a={aufstellung(vertrag)} kompakt />
          <Vertragskonto zh={zh} bh={bh} vertrag={vertrag} />
        </div>
      )}

      {dialog === "zusatz" && vertrag && (
        <VertragZusatz zh={zh} wert={wert} vertrag={vertrag} versicherungen={bh.daten?.Versicherung || []} briefkopf={briefkopf} onClose={() => setDialog(null)} />
      )}
      {dialog === "grundlagen" && vertrag && (
        <HonorarvertragFormular bh={bh} modus="bearbeiten" vertrag={vertrag} onClose={async () => { setDialog(null); await zh.neuLaden(); }} />
      )}
    </div>
  );
}
