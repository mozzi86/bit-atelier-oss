// Tab "Fuhrpark" of /Accounting (phase 79, plan 79-08, BUCH-12/BUCH-18):
// vehicle list with the 1 % rule (factor, monthly/yearly value, method),
// an overview of withdrawal (Nutzungsentnahme) vs. benefit in kind
// (geldwerter Vorteil) by legal form (E-04), the logbook comparison and
// mileage-allowance sections, and CSV/XLSX export. Replaces the stub built
// by 79-01.
//
// In:  props bh (page loader object). Out: the tab.

import React from "react";
import { Plus } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import {
  antriebText, fahrzeugJahreswert, faktor, faktorGrund, fuhrparkTabelle, geldwerterVorteil, kilometergeld, kaufLeasingText,
  methodeText, nutzerLabel, nutzungsentnahme,
} from "@/lib/accounting/fuhrpark.js";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import FahrzeugFormular from "./FahrzeugFormular.jsx";
import FahrtenbuchAbschnitt from "./FahrtenbuchAbschnitt.jsx";
import KilometergeldAbschnitt from "./KilometergeldAbschnitt.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * Years present among the vehicles (by acquisition date) plus the current
 * one, newest first — pattern of AusgabenReiter.jsx jahre().
 * @param {any[]} fahrzeuge
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number[]}
 */
function jahresListe(fahrzeuge, heute) {
  const menge = new Set(fahrzeuge.map((f) => Number(String(f?.anschaffung_datum || "").slice(0, 4))).filter(Boolean));
  menge.add(Number(heute.slice(0, 4)));
  return [...menge].sort((a, b) => b - a);
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props bh: page loader object
 * @returns {React.ReactElement}
 */
export default function FuhrparkReiter({ bh }) {
  const { t, lang } = useI18n();
  const [jahr, setJahr] = React.useState(() => Number(bh.heute.slice(0, 4)));
  const [formular, setFormular] = React.useState(/** @type {"neu"|Record<string, any>|null} */ (null));

  const fahrzeuge = bh.daten.Fahrzeug || [];
  const wirkung = rechtsformWirkung(bh.einst);
  const label = nutzerLabel(wirkung.rechtsform, t);

  const entnahme = nutzungsentnahme(bh.daten, jahr, bh.saetze, bh.einst);
  const vorteil = geldwerterVorteil(bh.daten, jahr, bh.saetze, bh.einst);
  const kmGeld = kilometergeld((bh.daten.Fahrt || []).filter((f) => String(f.datum || "").slice(0, 4) === String(jahr)), bh.saetze);

  return (
    <div className="space-y-6" data-besitzer="79-08">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Fuhrpark")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="fp-jahr">{t("Jahr")}</label>
          <select id="fp-jahr" className={FELD} value={String(jahr)} onChange={(e) => setJahr(Number(e.target.value))}>
            {jahresListe(fahrzeuge, bh.heute).map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <ExportKnopf modell={() => fuhrparkTabelle(bh.daten, jahr, t, bh.saetze)} bereich="fuhrpark" jahr={jahr} />
          <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} onClick={() => setFormular("neu")}>
            <Plus aria-hidden="true" /> {t("Neues Fahrzeug")}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Grenzen hängen am Anschaffungsdatum; Werte aus der Einstellungsdatei.")}
      </p>

      <section className="space-y-2" data-testid="fahrzeugliste">
        {fahrzeuge.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Fahrzeuge angelegt.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  {[t("Kennzeichen"), t("Nutzer"), t("Antrieb"), t("Bruttolistenpreis"), t("Faktor"), t("Methode"),
                    t("Monatswert"), t("Jahreswert"), ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {fahrzeuge.map((f) => {
                  const f1 = faktor(f, bh.saetze);
                  const wert = fahrzeugJahreswert(bh.daten, f, jahr, bh.saetze);
                  return (
                    <tr key={f.id} data-testid={`fp-zeile-${f.id}`}>
                      <td className="px-3 py-2">{f.kennzeichen}</td>
                      <td className="px-3 py-2">{f.nutzer || "—"} <span className="text-xs text-slate-500 dark:text-slate-400">({f.kauf_leasing ? kaufLeasingText(f.kauf_leasing, t) : "—"})</span></td>
                      <td className="px-3 py-2">{antriebText(f.antrieb, t)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuro(Math.round((f.blp || 0) * 100))}</td>
                      <td className="px-3 py-2" title={faktorGrund(f, bh.saetze, t, lang)}>{f1.faktor === 1 ? "1" : f1.faktor === 0.5 ? "½" : "¼"}</td>
                      <td className="px-3 py-2">{methodeText(f.methode, t)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" data-testid="fp-monatswert">{wert.monatCent === null ? "—" : formatEuro(wert.monatCent)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" data-testid="fp-jahreswert">{formatEuro(wert.jahrCent)}</td>
                      <td className="px-3 py-2">
                        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular(f)}>{t("Bearbeiten")}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="fuhrpark-uebersicht">
        <h3 className="font-medium text-slate-800 dark:text-slate-100">{t("Gesamtübersicht")} {jahr}</h3>
        <dl className="grid gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500 dark:text-slate-400">{t("Nutzungsentnahme")} ({label})</dt>
            <dd className="text-lg font-medium tabular-nums text-slate-800 dark:text-slate-100" data-testid="fp-nutzungsentnahme">{formatEuro(entnahme.summeCent)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500 dark:text-slate-400">{t("Geldwerter Vorteil")}</dt>
            <dd className="text-lg font-medium tabular-nums text-slate-800 dark:text-slate-100" data-testid="fp-geldwerter-vorteil">{formatEuro(vorteil.summeCent)}</dd>
            {vorteil.summeCent > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">{t("Nur informativ — Lohnabrechnung.")}</p>}
          </div>
          <div>
            <dt className="text-sm text-slate-500 dark:text-slate-400">{t("Kilometergeld")}</dt>
            <dd className="text-lg font-medium tabular-nums text-slate-800 dark:text-slate-100" data-testid="fp-kilometergeld">{formatEuro(kmGeld.summeCent)}</dd>
          </div>
        </dl>
      </section>

      <FahrtenbuchAbschnitt bh={bh} jahr={jahr} />
      <KilometergeldAbschnitt bh={bh} jahr={jahr} />

      {formular && (
        <FahrzeugFormular bh={bh} eintrag={formular === "neu" ? null : formular} onClose={() => setFormular(null)} />
      )}
    </div>
  );
}
