// Tab "Übersicht" of /Controlling (phase 81-05, CTRL-03): one row per project with
// an architect's contract or with bookings — fee net (without incidental costs)
// or "Tafel fehlt", cost so far, earned, contribution margin, consumption against
// progress, remaining hours, traffic light. Rows without a contract say "kein
// Architektenvertrag" and show the open fee offer or the button "Honorarangebot
// erstellen" (content button, no "Weiter mit" target). A click on a row opens the
// project tab.
//
// In:  props reihen (portfolio() rows), lang, onWaehle(projectId). Out: the table.

import React from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { AmpelMarke } from "./AmpelChip.jsx";
import { euroText, prozentText, reststundenText } from "./zahlen.js";

/**
 * @param {{reihen: ReturnType<typeof import("@/lib/controlling/controlling.js").portfolio>, onWaehle: (id: string) => void}} props
 * @returns {React.ReactElement}
 */
export default function PortfolioTabelle({ reihen, onWaehle }) {
  const { t, lang } = useI18n();
  if (!reihen.length) {
    return <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="portfolio-leer">{t("Noch kein Projekt mit Architektenvertrag oder gebuchten Stunden.")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm" data-testid="portfolio-tabelle">
        <caption className="sr-only">{t("Honorar gegen Aufwand je Projekt")}</caption>
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr className="text-left text-slate-600 dark:text-slate-300">
            <th scope="col" className="px-2 py-1.5">{t("Projekt")}</th>
            <th scope="col" className="px-2 py-1.5 text-right">{t("Honorar netto")}</th>
            <th scope="col" className="px-2 py-1.5 text-right">{t("Kosten bisher")}</th>
            <th scope="col" className="px-2 py-1.5 text-right">{t("Erarbeitet")}</th>
            <th scope="col" className="px-2 py-1.5 text-right">{t("Deckungsbeitrag")}</th>
            <th scope="col" className="px-2 py-1.5 text-right">{t("Verbrauch / Fortschritt")}</th>
            <th scope="col" className="px-2 py-1.5 text-right">{t("Reststunden")}</th>
            <th scope="col" className="px-2 py-1.5">{t("Ampel")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {reihen.map((r) => {
            const { c } = r;
            const verbrauch = c.summe.H && c.summe.H > 0 ? (c.summe.K / c.summe.H) * 100 : null;
            const rest = c.summe.R !== null && c.buerosatz ? c.summe.R / c.buerosatz : null;
            return (
              <tr key={r.project_id} data-testid="portfolio-zeile" data-projekt={r.project_id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">
                  <button type="button" onClick={() => onWaehle(r.project_id)} className="text-left text-emerald-700 hover:underline dark:text-emerald-300">
                    {r.name}
                  </button>
                  {r.archiviert && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("archiviert")}</span>}
                  {!r.vertrag && (
                    <div className="mt-1 space-y-1 text-xs font-normal text-slate-600 dark:text-slate-300">
                      <p>{t("kein Architektenvertrag")}</p>
                      {r.angebotOffen ? (
                        <Link to="/Fees?tab=offers" className="text-emerald-700 hover:underline dark:text-emerald-300" data-testid="portfolio-angebot-offen">
                          {t("Offenes Honorarangebot")} {r.angebotOffen.nummer || ""}
                        </Link>
                      ) : (
                        <Link to={`/Fees?tab=offers&neu=1&projekt=${encodeURIComponent(r.project_id)}`} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="portfolio-angebot-erstellen">
                          {t("Honorarangebot erstellen")}
                        </Link>
                      )}
                    </div>
                  )}
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.vertrag && c.tafelFehlt ? t("Tafel fehlt") : euroText(c.summe.H, lang)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{euroText(c.summe.K, lang)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{euroText(c.summe.E, lang)}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${typeof c.summe.DB === "number" && c.summe.DB < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>{euroText(c.summe.DB, lang)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{prozentText(verbrauch, lang)} / {prozentText(c.fortschrittGewichtet, lang)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{reststundenText(rest, lang)}</td>
                <td className="px-2 py-1.5"><AmpelMarke ampel={c.ampel} tafelFehlt={c.tafelFehlt} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
