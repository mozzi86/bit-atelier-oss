// Section "Honorarverträge" of the outgoing-invoice tab (79-02, T5): one card
// per fee contract with its computed HOAI honorar (registry-generic, E-13),
// what has been billed so far and the rest until the Schlussrechnung.
// "Abschlag vorschlagen" hands off to RechnungenAbschnitt through the SAME
// tab's URL (?neu=1&vertrag=<id>) — both sections live on one page (reiter.js
// key "invoices"), so no prop lifting is needed, and the button takes exactly
// the path of phase 81's deep link: RechnungenAbschnitt computes the proposal
// (abschlagsEntwurf) and opens RechnungFormular with it. Fills the 79-01 stub.
//
// In:  props bh, projektId. Out: the area; writes go through bh.speichere.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { honorarVertrag } from "@core/lib/hoai/honorar.js";
import { restBisSchluss, zahlungsplan } from "@core/lib/hoai/abrechnung.js";
import { toast } from "sonner";
import { formatEuro } from "@/lib/accounting/geld.js";
import RichtwertHinweis from "./gemeinsam/RichtwertHinweis.jsx";
import HonorarvertragFormular from "./HonorarvertragFormular.jsx";

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, projektId: string|null}} props
 * @returns {React.ReactElement}
 */
export default function HonorarAbschnitt({ bh, projektId }) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formular, setFormular] = React.useState(/** @type {{modus: "neu"|"bearbeiten", vertrag?: any, projektIdVorwahl?: string}|null} */ (null));

  const alle = bh.daten.Honorarvertrag || [];
  const liste = projektId ? alle.filter((v) => v.project_id === projektId) : alle;
  const rechnungen = bh.daten.Ausgangsrechnung || [];

  // Only the contract id travels in the URL (no amount in a query string);
  // the proposal and its "0 €" notice come from RechnungenAbschnitt.
  const vorschlagOeffnen = (vertrag) => {
    const naechste = new URLSearchParams(searchParams);
    naechste.set("neu", "1");
    naechste.set("vertrag", vertrag.id);
    setSearchParams(naechste, { replace: false });
  };

  const zahlungsplanAnlegen = async (vertrag) => {
    const plan = zahlungsplan(vertrag, { start: bh.heute, intervallMonate: 1 });
    if (!plan.length) { toast.error(t("Kein beauftragtes LP für einen Zahlungsplan.")); return; }
    try {
      await bh.speichereViele(plan.map((obj) => ({ entitaet: "Ausgangsrechnung", obj })));
      toast.success(t("{n} geplante Rechnungen angelegt").replace("{n}", String(plan.length)));
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  return (
    // Native elements instead of the shadcn Card wrappers (same tsc-cost
    // reason as RechnungenAbschnitt.jsx).
    <div className="rounded-xl border bg-card text-card-foreground shadow">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-1.5 p-6">
        <h3 className="font-semibold leading-none tracking-tight">{t("Honorarverträge")}</h3>
        {bh.projekte.length > 0 && (
          <button type="button" className={buttonVariants({ size: "sm" })}
            onClick={() => setFormular({ modus: "neu", projektIdVorwahl: projektId || bh.projekte[0]?.id })}>
            {t("Neuer Honorarvertrag")}
          </button>
        )}
      </div>
      <div className="space-y-3 p-6 pt-0">
        <RichtwertHinweis />
        {liste.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{t("Noch keine Honorarverträge")}</p>}
        {liste.map((vertrag) => {
          const info = leistungsbildInfo(vertrag.leistungsbild);
          const berechnet = honorarVertrag(vertrag);
          const rest = restBisSchluss(vertrag, rechnungen);
          const projekt = bh.projekte.find((p) => p.id === vertrag.project_id);
          return (
            <div key={vertrag.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {t(info?.label || vertrag.leistungsbild)}
                    {info?.status === "fehlt" && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t("Tafel fehlt")}</span>
                    )}
                  </p>
                  {!projektId && <p className="text-xs text-slate-500">{projekt?.name || "—"}</p>}
                  <p className="text-xs text-slate-500">{vertrag.bauherr_name || projekt?.client || "—"} · {t("Zone")} {vertrag.honorarzone || "—"}</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                    onClick={() => setFormular({ modus: "bearbeiten", vertrag })}>{t("Bearbeiten")}</button>
                  <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!berechnet.lph.length}
                    onClick={() => vorschlagOeffnen(vertrag)}>{t("Abschlag vorschlagen")}</button>
                  <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!berechnet.lph.length}
                    onClick={() => zahlungsplanAnlegen(vertrag)}>{t("Zahlungsplan anlegen")}</button>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <dt className="text-slate-500">{t("Honorar netto")}</dt>
                <dd className="tabular-nums">
                  {berechnet.netto == null
                    ? <span className="text-slate-500">{berechnet.quelle === "tafel_fehlt" ? t("Tafel fehlt — HOAI § {nr} noch nicht amtlich übertragen").replace("{nr}", String(info?.tafelParagraf ?? "")) : t("frei vereinbar")}</span>
                    : formatEuro(Math.round(berechnet.netto * 100))}
                </dd>
                <dt className="text-slate-500">{t("Bisher abgerechnet")}</dt>
                <dd className="tabular-nums">{berechnet.netto == null || rest == null ? "—" : formatEuro(Math.round((berechnet.netto - rest) * 100))}</dd>
                <dt className="text-slate-500">{t("Rest bis Schlussrechnung")}</dt>
                <dd className="tabular-nums">{rest == null ? "—" : formatEuro(Math.round(rest * 100))}</dd>
              </dl>
            </div>
          );
        })}
      </div>

      {formular && (
        <HonorarvertragFormular
          bh={bh}
          modus={formular.modus}
          vertrag={formular.vertrag}
          projektIdVorwahl={formular.projektIdVorwahl}
          onClose={() => setFormular(null)}
        />
      )}
    </div>
  );
}
