// Tab "Monat" of /Controlling (phase 81-05, CTRL-04): per month the cost of the
// bookings, the earned value from HoaiPlan.verlauf (ΔE, previous month → month)
// and the invoiced amount (issued outgoing invoices of the contract, net), as a
// chart and — for screen readers and exact values — as a table. Without a
// progress history the tab says so instead of showing ΔE = 0.
//
// In:  props reihe (monatsreihe() rows), projektName, hatVerlauf. Out: the month view.

import React from "react";
import { Link } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@core/lib/i18n";
import { euroText, stundenText } from "./zahlen.js";

/**
 * @param {{reihe: Array<{monat: string, minuten: number, K: number, dE: number|null, abgerechnet: number, DB: number|null}>, projektName: string, hatVerlauf: boolean}} props
 * @returns {React.ReactElement}
 */
export default function MonatsAnsicht({ reihe, projektName, hatVerlauf }) {
  const { t, lang } = useI18n();
  const diagramm = reihe.map((m) => ({ monat: m.monat, K: m.K, dE: m.dE ?? 0, abgerechnet: m.abgerechnet }));
  return (
    <section className="space-y-3" data-testid="monats-ansicht">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{projektName}</h3>
      {!hatVerlauf && (
        <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="monat-ohne-verlauf">
          {t("Noch kein Leistungsstand-Verlauf: Er entsteht einmal je Monat beim Speichern des Leistungsstands im Designer-Reiter „Planer“. Bis dahin fehlt die erarbeitete Leistung je Monat.")}{" "}
          <Link to="/ComplexDesigner?tab=planner" className="text-emerald-700 underline dark:text-emerald-300">{t("Leistungsstand pflegen")}</Link>
        </p>
      )}
      {reihe.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Noch keine Monatswerte für dieses Projekt.")}</p> : (
        <>
          <figure className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <figcaption className="px-1 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Kosten, erarbeitete Leistung und Abrechnung je Monat")}</figcaption>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={diagramm} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                  <XAxis dataKey="monat" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => euroText(Number(v), lang)} />
                  <Tooltip formatter={(v) => euroText(Number(v), lang)} />
                  <Legend />
                  <Bar dataKey="K" name={t("Kosten")} fill="#e11d48" />
                  <Bar dataKey="dE" name={t("Erarbeitet im Monat")} fill="#0f766e" />
                  <Line dataKey="abgerechnet" name={t("Abgerechnet")} stroke="#2563eb" strokeWidth={2} dot />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </figure>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm" data-testid="monats-tabelle">
              <caption className="sr-only">{t("Monatswerte")}</caption>
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr className="text-left text-slate-600 dark:text-slate-300">
                  <th scope="col" className="px-2 py-1.5">{t("Monat")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Stunden")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Kosten")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Erarbeitet im Monat")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Abgerechnet")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Deckungsbeitrag")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {reihe.map((m) => (
                  <tr key={m.monat} data-testid="monats-zeile" data-monat={m.monat}>
                    <th scope="row" className="px-2 py-1.5 text-left font-medium tabular-nums">{m.monat}</th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{stundenText(m.minuten, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(m.K, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(m.dE, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(m.abgerechnet, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(m.DB, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
