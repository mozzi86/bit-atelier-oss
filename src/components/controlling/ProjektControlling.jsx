// Tab "Projekt" of /Controlling (phase 81-05, CTRL-01/02): fee against effort per
// work stage of one project — H, K, F, V, E, DB, EAC, R, remaining hours and the
// light per LPH (number of stages by the service profile), a bar chart H/K/E, the
// fee amendments, hours per person (HOURS ONLY — cost per person would reveal the
// salary, T-81-24), the "n,nn h ohne Kostensatz" note and the weighted progress
// with its explanation. With "Tafel fehlt" a sentence points to the lump sum in
// the architect's contract instead of the fee columns.
//
// In:  props reihe (a portfolio() row or null), projekte (for the picker),
//      projektId, onProjekt, nachtraege, personen (80 records, empty without
//      access), ratesSichtbar, onRates. Out: the project view.

import React from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { personAnzeigeName } from "@/lib/zeit/personalQuelle.js";
import { AmpelMarke } from "./AmpelChip.jsx";
import { euroText, prozentText, reststundenText, stundenText } from "./zahlen.js";

/** Fills {key} placeholders after translation. */
const fuellen = (/** @type {string} */ text, /** @type {Record<string, any>} */ werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

/**
 * @param {{
 *   reihe: any|null, projekte: Array<{id: string, name?: string}>, projektId: string|null, onProjekt: (id: string) => void,
 *   nachtraege: any[], personen: any[], ratesSichtbar: boolean, onRates: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function ProjektControlling({ reihe, projekte, projektId, onProjekt, nachtraege, personen, ratesSichtbar, onRates }) {
  const { t, lang } = useI18n();
  const c = reihe?.c ?? null;
  const vertrag = reihe?.vertrag ?? null;
  const info = vertrag ? leistungsbildInfo(vertrag.leistungsbild) : null;
  const name = (/** @type {number} */ nr) => info?.lph?.find((s) => s.nr === nr)?.bezeichnung || "";
  const eigeneNachtraege = vertrag ? nachtraege.filter((n) => n?.honorarvertrag_id === vertrag.id) : [];
  const diagramm = c ? c.lph.filter((z) => z.H !== null || z.K > 0).map((z) => ({ lph: `${t("LPH")} ${z.lph}`, H: z.H ?? 0, K: z.K, E: z.E ?? 0 })) : [];

  return (
    <section className="space-y-4" data-testid="projekt-controlling">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="controlling-projekt" className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Projekt")}</label>
        <select id="controlling-projekt" value={projektId || ""} onChange={(e) => onProjekt(e.target.value)}
          className="h-9 max-w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900">
          {!projektId && <option value="">{t("Projekt wählen")}</option>}
          {projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
        </select>
        {c && <AmpelMarke ampel={c.ampel} tafelFehlt={c.tafelFehlt} />}
      </div>

      {!reihe && projektId && (
        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <p>{t("Für dieses Projekt gibt es weder einen Architektenvertrag noch gebuchte Stunden.")}</p>
          <Link to={`/Fees?tab=offers&neu=1&projekt=${encodeURIComponent(projektId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Honorarangebot erstellen")}</Link>
        </div>
      )}

      {c && (
        <>
          {!vertrag && <p className="text-sm text-slate-700 dark:text-slate-200">{t("kein Architektenvertrag")} — {t("Stunden werden bewertet, ein Honorar fehlt.")}</p>}
          {reihe.weitereVertraege > 0 && <p className="text-xs text-slate-600 dark:text-slate-300">{fuellen(t("Weitere Architektenverträge des Projekts: {n} — gerechnet wird mit {nummer}."), { n: reihe.weitereVertraege, nummer: vertrag?.nummer || t("ohne Nummer") })}</p>}
          {c.tafelFehlt && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100" data-testid="controlling-tafel-fehlt">
              {t("Tafel fehlt")} — {t("Für dieses Leistungsbild ist die Honorartafel noch nicht amtlich übertragen. Ein Honorar und damit eine Ampel gibt es erst mit einer Pauschale im Architektenvertrag.")}
            </p>
          )}
          {c.pauschalAnteilig && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Pauschale anteilig nach LPH-Prozent")}</p>}
          {c.ohneLeistungsstand === "nur_objektplanung" && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Leistungsstand nur für die Objektplanung")} — {t("die Ampel bleibt grau.")}</p>}
          {c.ohneLeistungsstand === "kein_plan" && <p className="text-xs text-slate-600 dark:text-slate-300">{t("Noch kein Leistungsstand erfasst — im Designer-Reiter „Planer“ eintragen.")}</p>}
          {c.ohneKostensatzMinuten > 0 && (
            <p className="text-sm text-amber-800 dark:text-amber-200" data-testid="controlling-ohne-satz">
              {fuellen(t("{stunden} ohne Kostensatz"), { stunden: stundenText(c.ohneKostensatzMinuten, lang) })}
              {ratesSichtbar && <> — <button type="button" onClick={onRates} className="underline">{t("Kostensätze pflegen")}</button></>}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm" data-testid="lph-tabelle">
              <caption className="sr-only">{t("Honorar gegen Aufwand je Leistungsphase")}</caption>
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr className="text-left text-slate-600 dark:text-slate-300">
                  <th scope="col" className="px-2 py-1.5">{t("LPH")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Honorar")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Kosten")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Fortschritt")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Verbrauch")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Erarbeitet")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Deckungsbeitrag")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Prognose Kosten")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Restbudget")}</th>
                  <th scope="col" className="px-2 py-1.5 text-right">{t("Reststunden")}</th>
                  <th scope="col" className="px-2 py-1.5">{t("Ampel")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {c.lph.map((z) => (
                  <tr key={z.lph} data-testid="lph-zeile" data-lph={z.lph} data-ampel={z.ampel}>
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">
                      {t("LPH")} {z.lph} <span className="font-normal text-slate-500">{name(z.lph) ? t(name(z.lph)) : ""}</span>
                      {!z.beauftragt && <span className="ml-1 text-xs font-normal text-slate-500">({t("nicht beauftragt")})</span>}
                    </th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.tafelFehlt ? "—" : euroText(z.H, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums" data-testid="lph-kosten">{euroText(z.K, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{prozentText(z.F, lang, 0)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{prozentText(z.V, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(z.E, lang)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${typeof z.DB === "number" && z.DB < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>{euroText(z.DB, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(z.EAC, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(z.R, lang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{reststundenText(z.reststunden, lang)}</td>
                    <td className="px-2 py-1.5"><AmpelMarke ampel={z.ampel} tafelFehlt={c.tafelFehlt} /></td>
                  </tr>
                ))}
                {c.ohneLph.minuten > 0 && (
                  <tr>
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">{t("ohne LPH (Akquise, Bürozeit)")}</th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.ohneLph.H ? euroText(c.ohneLph.H, lang) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{euroText(c.ohneLph.K, lang)}</td>
                    <td colSpan={8} />
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-slate-50 font-medium dark:bg-slate-800/60">
                <tr>
                  <th scope="row" className="px-2 py-1.5 text-left">{t("Summe")}</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.tafelFehlt ? t("Tafel fehlt") : euroText(c.summe.H, lang)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums" data-testid="summe-kosten">{euroText(c.summe.K, lang)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums" data-testid="fortschritt-gewichtet">{prozentText(c.fortschrittGewichtet, lang)}</td>
                  <td />
                  <td className="px-2 py-1.5 text-right tabular-nums">{euroText(c.summe.E, lang)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{euroText(c.summe.DB, lang)}</td>
                  <td />
                  <td className="px-2 py-1.5 text-right tabular-nums">{euroText(c.summe.R, lang)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t("Fortschritt gewichtet = Summe aus Honorar × Leistungsstand je LPH geteilt durch das Honorar — eine LPH mit großem Honorar zählt mehr. Verbrauch = Kosten / Honorar; Ampel rot, wenn der Verbrauch den Fortschritt um mehr als die Schwelle übersteigt oder die Kosten das Honorar.")}
          </p>

          {diagramm.length > 0 && (
            <figure className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <figcaption className="px-1 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Honorar, Kosten und erarbeitete Leistung je LPH")}</figcaption>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={diagramm} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                    <XAxis dataKey="lph" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => euroText(Number(v), lang)} />
                    <Tooltip formatter={(v) => euroText(Number(v), lang)} />
                    <Legend />
                    <Bar dataKey="H" name={t("Honorar")} fill="#0f766e" />
                    <Bar dataKey="K" name={t("Kosten")} fill="#e11d48" />
                    <Bar dataKey="E" name={t("Erarbeitet")} fill="#64748b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{t("Honorarnachträge")}</h3>
              {eigeneNachtraege.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Honorarnachträge zu diesem Vertrag.")}</p> : (
                <ul className="space-y-1 text-sm">
                  {eigeneNachtraege.map((n) => (
                    <li key={n.id} className="flex flex-wrap justify-between gap-2">
                      <span>{n.nr ? `${n.nr} – ` : ""}{n.titel}{typeof n.lph === "number" ? ` (${t("LPH")} ${n.lph})` : ""}</span>
                      <span className="tabular-nums">{euroText(n.betrag_euro, lang)} · {n.status === "beauftragt" ? t("zählt zum Honorar") : t("zählt nicht (nicht beauftragt)")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{t("Stunden je Person")}</h3>
              <ul className="space-y-1 text-sm" data-testid="stunden-je-person">
                {Object.entries(c.stundenJeMitarbeiter).map(([id, minuten]) => (
                  <li key={id} className="flex justify-between gap-2">
                    <span>{personAnzeigeName(personen.find((p) => p?.id === id) || { id }, t)}</span>
                    <span className="tabular-nums">{stundenText(minuten, lang)}</span>
                  </li>
                ))}
                {Object.keys(c.stundenJeMitarbeiter).length === 0 && <li className="text-slate-600 dark:text-slate-300">{t("Noch keine Stunden gebucht.")}</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
