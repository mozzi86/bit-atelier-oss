// Tab "Eingangsrechnungen" of /Accounting (phase 79, plan 79-04): incoming
// invoices and expenses (list, filter, category sums, CSV/XLSX export), plus
// recurring expenses and insurance/guarantees below — one project filter for
// all three (pattern of AusgangsrechnungenReiter.jsx, 79-01).
//
// In:  props bh (page loader object). Out: the tab.

import React from "react";
import { Paperclip, Plus } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { ausgabenTabelle, kategorieText, KATEGORIEN } from "@/lib/accounting/ausgaben.js";
import { euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import AusgabeFormular from "./AusgabeFormular.jsx";
import VersicherungenAbschnitt from "./VersicherungenAbschnitt.jsx";
import WiederkehrendAbschnitt from "./WiederkehrendAbschnitt.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * Years present among the invoices (by rechnungsdatum), newest first, plus the
 * current year so a fresh office with no data yet still offers one option.
 * @param {any[]} liste
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number[]}
 */
function jahre(liste, heute) {
  const menge = new Set(liste.map((e) => Number(String(e.rechnungsdatum || "").slice(0, 4))).filter(Boolean));
  menge.add(Number(heute.slice(0, 4)));
  return [...menge].sort((a, b) => b - a);
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props bh: page loader object
 * @returns {React.ReactElement}
 */
export default function AusgabenReiter({ bh }) {
  const { t } = useI18n();
  const [alleProjekte, setAlleProjekte] = React.useState(false);
  const [filter, setFilter] = React.useState(() => ({ kategorie: "", jahr: String(Number(bh.heute.slice(0, 4))), nurOffen: false }));
  const [formular, setFormular] = React.useState(/** @type {"neu"|Record<string, any>|null} */ (null));

  const projekt = bh.projekte.find((p) => p.id === bh.projektId) || null;
  const zeigeAlle = alleProjekte || !projekt;
  const projektId = zeigeAlle ? null : projekt.id;

  const alle = bh.daten.Eingangsrechnung || [];
  const vomProjekt = projektId ? alle.filter((e) => !e.project_id || e.project_id === projektId) : alle;
  const gefiltert = vomProjekt.filter((e) => {
    if (filter.kategorie && e.kategorie !== filter.kategorie) return false;
    if (filter.jahr && String(e.rechnungsdatum || "").slice(0, 4) !== filter.jahr) return false;
    if (filter.nurOffen && e.bezahlt_am) return false;
    return true;
  });
  const summenJeKategorie = Object.keys(KATEGORIEN).map((k) => ({
    kategorie: k, summeCent: gefiltert.filter((e) => e.kategorie === k).reduce((n, e) => n + euroZuCent(e.brutto), 0),
  })).filter((s) => s.summeCent !== 0);

  return (
    <div className="space-y-6">
      <div role="group" aria-label={t("Projektfilter")} className="flex flex-wrap items-center gap-2">
        {projekt && (
          <button type="button" aria-pressed={!zeigeAlle} onClick={() => setAlleProjekte(false)}
            className={buttonVariants({ variant: !zeigeAlle ? "secondary" : "outline", size: "sm" })}>
            {t("Aktives Projekt")}: {projekt.name}
          </button>
        )}
        <button type="button" aria-pressed={zeigeAlle} onClick={() => setAlleProjekte(true)}
          className={buttonVariants({ variant: zeigeAlle ? "secondary" : "outline", size: "sm" })}>
          {t("Alle Projekte")}
        </button>
      </div>

      <section className="space-y-3" aria-labelledby="ag-titel" data-besitzer="79-04">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ag-titel" className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Eingangsrechnungen")}</h2>
          <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} onClick={() => setFormular("neu")}>
            <Plus aria-hidden="true" /> {t("Neue Ausgabe")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="ag-filter-kategorie">{t("Kategorie")}</label>
          <select id="ag-filter-kategorie" className={FELD} value={filter.kategorie} onChange={(e) => setFilter((f) => ({ ...f, kategorie: e.target.value }))}>
            <option value="">{t("Alle Kategorien")}</option>
            {Object.keys(KATEGORIEN).map((k) => <option key={k} value={k}>{kategorieText(k, t)}</option>)}
          </select>
          <label className="sr-only" htmlFor="ag-filter-jahr">{t("Jahr")}</label>
          <select id="ag-filter-jahr" className={FELD} value={filter.jahr} onChange={(e) => setFilter((f) => ({ ...f, jahr: e.target.value }))}>
            <option value="">{t("Alle Jahre")}</option>
            {jahre(vomProjekt, bh.heute).map((j) => <option key={j} value={String(j)}>{j}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={filter.nurOffen} onChange={(e) => setFilter((f) => ({ ...f, nurOffen: e.target.checked }))} />
            {t("Nur offene")}
          </label>
          <ExportKnopf modell={() => ausgabenTabelle({ Eingangsrechnung: gefiltert }, t)} bereich="eingangsrechnungen" jahr={filter.jahr || t("Alle Jahre")} />
        </div>

        {summenJeKategorie.length > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="ausgaben-summen">
            {summenJeKategorie.map((s) => `${kategorieText(s.kategorie, t)}: ${formatEuro(s.summeCent)}`).join(" · ")}
          </p>
        )}

        {gefiltert.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Eingangsrechnungen für diese Auswahl.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  {[t("Lieferant"), t("Kategorie"), t("Netto"), t("Vorsteuer"), t("Brutto"), t("Rechnungsdatum"), t("Fällig am"), t("Bezahlt am"), t("Beleg"), ""].map((ueberschrift) => (
                    <th key={ueberschrift} scope="col" className="px-3 py-2 font-medium">{ueberschrift}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {gefiltert.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">{e.lieferant}</td>
                    <td className="px-3 py-2">{kategorieText(e.kategorie, t)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(euroZuCent(e.netto))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(euroZuCent(e.vorsteuer))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(euroZuCent(e.brutto))}</td>
                    <td className="px-3 py-2 tabular-nums">{e.rechnungsdatum || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{e.faellig_am || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{e.bezahlt_am || "—"}</td>
                    <td className="px-3 py-2">
                      {e.beleg_id && <Paperclip className="h-4 w-4 text-slate-500" aria-label={t("Beleg vorhanden")} />}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular(e)}>{t("Bearbeiten")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <WiederkehrendAbschnitt bh={bh} projektId={projektId} />
      <VersicherungenAbschnitt bh={bh} projektId={projektId} />

      {formular && (
        <AusgabeFormular bh={bh} eintrag={formular === "neu" ? null : formular} onClose={() => setFormular(null)} />
      )}
    </div>
  );
}
