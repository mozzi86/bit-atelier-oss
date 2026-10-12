// Leave balance (phase 82, 82-04, ABW-03): per person and year entitlement
// (with 80's computation text), carry-over, taken, planned, requested, rest
// and lapse — or "kein Urlaubskonto (ohne Arbeitsrecht)" for owners and
// partners. Warnings say "manuell prüfen". The notice on open leave is NOT
// recorded here: one truth per deadline — the link goes to 80's contracts tab,
// where the Fristquittung lives.
//
// In:  props konten [{person, konto}], jahr, onJahr. Out: the tab.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";

/** @param {number|null|undefined} n @returns {string} */
const zahl = (n) => (typeof n === "number" ? String(Math.round(n * 10) / 10).replace(".", ",") : "—");

/**
 * @param {{konten: Array<{person: {id: string, kuerzel: string, name: string}, konto: ReturnType<typeof import("@/lib/abwesenheit/urlaubskonto.js").urlaubskonto>}>,
 *   jahr: number, onJahr: (j: number) => void}} props
 * @returns {React.ReactElement}
 */
export default function UrlaubsKonto({ konten, jahr, onJahr }) {
  const { t } = useI18n();
  return (
    <section className="space-y-3" data-testid="urlaubskonto">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-700 dark:text-slate-200">{t("Jahr")}{" "}
          <select className="h-9 rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={jahr} onChange={(e) => onJahr(Number(e.target.value))}>
            {[jahr - 1, jahr, jahr + 1].map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </label>
        <Link className="text-xs underline text-emerald-800 dark:text-emerald-300" to="/People?tab=contracts">{t("Resturlaub-Hinweis quittieren")}</Link>
      </div>
      {konten.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Einträge.")}</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Urlaubskonto")} {jahr}</caption>
            <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <tr>
                <th scope="col" className="px-2 py-1">{t("Person")}</th><th scope="col" className="px-2 py-1">{t("Anspruch")}</th><th scope="col" className="px-2 py-1">{t("Übertrag")}</th>
                <th scope="col" className="px-2 py-1">{t("genommen")}</th><th scope="col" className="px-2 py-1">{t("geplant")}</th><th scope="col" className="px-2 py-1">{t("nach Genehmigung")}</th>
                <th scope="col" className="px-2 py-1">{t("Rest")}</th><th scope="col" className="px-2 py-1">{t("Verfall")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {konten.map(({ person, konto }) => (
                <tr key={person.id} data-testid="konto-zeile" data-person={person.id}>
                  <th scope="row" className="px-2 py-1 text-left font-medium">{person.kuerzel} <span className="font-normal text-slate-500">{person.name}</span></th>
                  {konto.ohneArbeitsrecht ? (
                    <td colSpan={7} className="px-2 py-1 text-slate-600 dark:text-slate-300" data-testid="konto-ohne">{t("kein Urlaubskonto (ohne Arbeitsrecht)")}</td>
                  ) : konto.anspruch === null ? (
                    <td colSpan={7} className="px-2 py-1 text-slate-600 dark:text-slate-300">{t("kein aktiver Arbeitsvertrag")}</td>
                  ) : (
                    <>
                      <td className="px-2 py-1 tabular-nums" title={konto.berechnung || undefined}>{zahl(konto.anspruch)}</td>
                      <td className="px-2 py-1 tabular-nums">{zahl(konto.uebertrag)}</td>
                      <td className="px-2 py-1 tabular-nums">{zahl(konto.genommen)}</td>
                      <td className="px-2 py-1 tabular-nums" data-testid="konto-geplant">{zahl(konto.geplant)}</td>
                      <td className="px-2 py-1 tabular-nums">{zahl(konto.beantragt)}</td>
                      <td className="px-2 py-1 tabular-nums font-medium">{zahl(konto.rest)}</td>
                      <td className="px-2 py-1 text-xs">
                        {konto.verfall.status === "verfaellt" ? t("verfällt am {datum}").replace("{datum}", String(konto.verfall.verfallAm))
                          : konto.verfall.status === "uebertragen_hinweis_fehlt" ? <span className="text-amber-800 dark:text-amber-200">{t("übertragen – Hinweis fehlt")}</span> : "—"}
                        {konto.warnungen.length > 0 && <span className="block text-amber-800 dark:text-amber-200">{t("manuell prüfen")}</span>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
