// Tab "Honorarnachträge" of /Fees (phase 81-04, HON-05): fee amendments per
// architect's contract (number, title, reason, stage, amount, status, done %),
// the sum line "Vertragssumme inkl. beauftragter Honorarnachträge", and the
// status actions offer (with optional letter PDF), commission, reject — each with
// a confirmation; "erbracht %" only for commissioned ones (it feeds the next
// instalment). UI word always "Honorarnachtrag".
//
// In:  props zh, wert, alleProjekte. Out: the tab and its dialog.

import React from "react";
import { toast } from "sonner";
import { Check, FileDown, Pencil, Plus, Send, X } from "lucide-react";
import EmptyState from "@core/components/common/EmptyState";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { useBriefkopf } from "@core/lib/useBriefkopf.js";
import { dateiAnbieten } from "@core/lib/tabellenExport.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { NACHTRAG_GRUENDE, nachtragStatusWechsel, vertragssummeMitNachtraegen } from "@/lib/honorar/honorarNachtrag.js";
import { honorarnachtragPdf } from "@/lib/honorar/vertragPdf.js";
import { NACHTRAG_STATUS } from "@/lib/honorar/vertragsdaten.js";
import NachtragDialog from "./NachtragDialog.jsx";

const FELD = "h-8 w-20 rounded-md border border-slate-300 bg-white px-2 text-right text-sm dark:border-slate-600 dark:bg-slate-900";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, wert: (id: string) => any, alleProjekte: boolean}} props
 * @returns {React.ReactElement}
 */
export default function NachtragReiter({ zh, wert, alleProjekte }) {
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();
  const { briefkopf } = useBriefkopf();
  const [dialog, setDialog] = React.useState(/** @type {{vertrag: any, nachtrag: any}|null} */ (null));
  const vertraege = (zh.daten.Honorarvertrag || []).filter((v) => alleProjekte || !zh.projectId || v.project_id === zh.projectId);
  const euro = (/** @type {number|null} */ x) => (x === null ? t("Tafel fehlt") : formatEuro(Math.round(x * 100), lang));

  const wechsel = async (/** @type {any} */ n, /** @type {string} */ ziel) => {
    const texte = { angeboten: "Honorarnachtrag anbieten?", beauftragt: "Honorarnachtrag beauftragen?", abgelehnt: "Honorarnachtrag als abgelehnt markieren?" };
    const ok = await bestaetige({ titel: t(/** @type {any} */ (texte)[ziel]), text: `${n.nr} · ${n.titel}`, bestaetigen: t(/** @type {any} */ (NACHTRAG_STATUS)[ziel]?.label || ziel), gefahr: ziel === "abgelehnt" });
    if (!ok) return;
    const r = /** @type {any} */ (nachtragStatusWechsel(n, ziel, { heuteIso: zh.heute }));
    if (!r.ok) { toast.error(t("Dieser Statuswechsel ist nicht erlaubt.")); return; }
    try {
      await zh.speichere("Honorarnachtrag", r.nachtrag);
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const erbracht = async (/** @type {any} */ n, /** @type {number} */ prozent) => {
    try {
      await zh.speichere("Honorarnachtrag", { ...n, erbracht_prozent: Math.max(0, Math.min(100, prozent)) });
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const pdf = async (/** @type {any} */ n, /** @type {any} */ v) => {
    try {
      const r = await honorarnachtragPdf(n, v, { projekt: zh.projekte.find((p) => p.id === v.project_id) || null, briefkopf, heuteIso: zh.heute, gegenlesen: n.status === "entwurf" });
      dateiAnbieten(r.bytes, `Honorarnachtrag-${v.nummer || v.id}-${n.nr}.pdf`, "application/pdf");
    } catch (err) {
      toast.error(`${t("PDF fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  if (!vertraege.length) return <EmptyState title={t("Noch kein Architektenvertrag")} description={t("Honorarnachträge gehören zu einem Architektenvertrag.")} />;

  return (
    <div className="space-y-6" data-testid="nachtrag-reiter">
      {vertraege.map((v) => {
        const liste = (zh.daten.Honorarnachtrag || []).filter((n) => n.honorarvertrag_id === v.id).sort((a, b) => (Number(a.nr) || 0) - (Number(b.nr) || 0));
        return (
          <section key={v.id} className="space-y-2" data-testid="nachtrag-vertrag">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{t("Architektenvertrag")} {v.nummer || t("ohne Nummer")}</h3>
              <span className="text-sm text-slate-600 dark:text-slate-300" data-testid="nachtrag-vertragssumme">{t("Vertragssumme inkl. beauftragter Honorarnachträge")}: {euro(vertragssummeMitNachtraegen(v, liste))}</span>
              <button type="button" className={`${buttonVariants({ variant: "outline", size: "sm" })} ml-auto`} onClick={() => setDialog({ vertrag: v, nachtrag: null })}>
                <Plus aria-hidden="true" /> {t("Neuer Honorarnachtrag")}
              </button>
            </div>
            {liste.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine Honorarnachträge.")}</p> : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr className="text-left text-slate-600 dark:text-slate-300">
                      <th scope="col" className="px-2 py-1">{t("Nr.")}</th><th scope="col" className="px-2 py-1">{t("Titel")}</th><th scope="col" className="px-2 py-1">{t("Grund")}</th>
                      <th scope="col" className="px-2 py-1">{t("LPH")}</th><th scope="col" className="px-2 py-1 text-right">{t("Betrag netto")}</th>
                      <th scope="col" className="px-2 py-1">{t("Status")}</th><th scope="col" className="px-2 py-1">{t("erbracht (%)")}</th><th scope="col" className="px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {liste.map((n) => (
                      <tr key={n.id} data-testid="nachtrag-zeile">
                        <td className="px-2 py-1">{n.nr}</td>
                        <td className="px-2 py-1">{n.titel}</td>
                        <td className="px-2 py-1">{t(/** @type {any} */ (NACHTRAG_GRUENDE)[n.grund]?.label || n.grund)}</td>
                        <td className="px-2 py-1">{n.lph ?? "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{euro(Number(n.betrag_euro) || 0)}</td>
                        <td className="px-2 py-1">{t(/** @type {any} */ (NACHTRAG_STATUS)[n.status]?.label || n.status)}</td>
                        <td className="px-2 py-1">
                          {n.status === "beauftragt" ? (
                            <input type="number" min="0" max="100" step="5" className={FELD} defaultValue={n.erbracht_prozent ?? 0} aria-label={t("erbracht (%)")}
                              onBlur={(e) => { const p = Number(e.target.value) || 0; if (p !== (n.erbracht_prozent ?? 0)) erbracht(n, p); }} />
                          ) : "—"}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-wrap justify-end gap-1">
                            {n.status === "entwurf" && <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setDialog({ vertrag: v, nachtrag: n })} aria-label={t("Bearbeiten")}><Pencil aria-hidden="true" /></button>}
                            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => pdf(n, v)} aria-label={t("PDF")}><FileDown aria-hidden="true" /></button>
                            {n.status === "entwurf" && <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => wechsel(n, "angeboten")}><Send aria-hidden="true" /> {t("Anbieten")}</button>}
                            {n.status === "angeboten" && <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => wechsel(n, "beauftragt")}><Check aria-hidden="true" /> {t("Beauftragen")}</button>}
                            {(n.status === "entwurf" || n.status === "angeboten") && <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => wechsel(n, "abgelehnt")}><X aria-hidden="true" /> {t("Ablehnen")}</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {dialog && <NachtragDialog zh={zh} wert={wert} vertrag={dialog.vertrag} nachtrag={dialog.nachtrag} onClose={() => setDialog(null)} />}
    </div>
  );
}
