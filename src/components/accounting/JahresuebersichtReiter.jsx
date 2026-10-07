// Tab "Jahresübersicht" of /Accounting (phase 79, plan 79-11, E-04/E-11/BUCH-14):
// the EÜR (cash-basis gross method), profit allocation by legal form, prior-
// year comparison, CSV/XLSX export, and the DATEV export section
// (DatevExportAbschnitt.jsx). GmbH/UG (rechtsformWirkung().gewinnermittlung
// === "bilanz"): no EÜR table, only the balance-sheet hint — the DATEV
// section stays visible either way (a corporation still books invoices).
//
// In:  props {bh}. Out: the area — jede Zeile ist zu ihren Belegen
//      aufklappbar (a <details> per row, the table stays the accessible
//      data view, dataviz-Skill).

import React from "react";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { aufteilung, euerJahr, euerTabelle, hinweisText, vergleich, vorjahr, zeileText } from "@/lib/accounting/euer.js";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";
import RichtwertHinweis from "./gemeinsam/RichtwertHinweis.jsx";
import DatevExportAbschnitt from "./DatevExportAbschnitt.jsx";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * Years worth offering in the selector: every year with a Steuerzahlung,
 * Ausgangsrechnung payment or Eingangsrechnung booking, plus the current year.
 * @param {Record<string, any[]>} daten bh.daten
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number[]} newest first
 */
function jahresListe(daten, heute) {
  const menge = new Set([Number(heute.slice(0, 4))]);
  for (const r of daten.Ausgangsrechnung || []) for (const z of r.zahlungen || []) if (z?.datum) menge.add(Number(String(z.datum).slice(0, 4)));
  for (const e of daten.Eingangsrechnung || []) if (e?.bezahlt_am) menge.add(Number(String(e.bezahlt_am).slice(0, 4)));
  return [...menge].sort((a, b) => b - a);
}

/**
 * One expandable EÜR line: the amount, and — when there are receipts — a
 * disclosure listing them (T4 "jede Zeile zu ihren Belegen aufklappbar").
 * @param {{zeile: import("@/lib/accounting/euer.js").EuerZeile, t: (k: string) => string}} props
 * @returns {React.ReactElement}
 */
function EuerZeileRow({ zeile, t }) {
  const [offen, setOffen] = React.useState(false);
  const hatBelege = zeile.belege.length > 0;
  return (
    <>
      <tr data-testid={`euer-zeile-${zeile.schluessel}`}>
        <td className="px-3 py-2">
          {hatBelege ? (
            <button type="button" className="flex items-center gap-1 text-left hover:underline" aria-expanded={offen} onClick={() => setOffen((o) => !o)}>
              <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform ${offen ? "rotate-90" : ""}`} />
              {zeileText(zeile.schluessel, t)}
            </button>
          ) : zeileText(zeile.schluessel, t)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{formatEuro(zeile.betragCent)}</td>
      </tr>
      {offen && hatBelege && (
        <tr>
          <td colSpan={2} className="bg-slate-50 px-3 py-2 dark:bg-slate-900">
            <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
              {zeile.belege.map((b, i) => (
                <li key={`${b.id}-${i}`} className="flex justify-between gap-3">
                  <span>{b.id}{b.datum ? ` · ${b.datum}` : ""}</span>
                  <span className="tabular-nums">{formatEuro(b.cent)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props
 * @returns {React.ReactElement}
 */
export default function JahresuebersichtReiter({ bh }) {
  const { t } = useI18n();
  const wirkung = rechtsformWirkung(bh.einst);
  const [jahr, setJahr] = React.useState(() => Number(bh.heute.slice(0, 4)));
  const [vorjahrEntwurf, setVorjahrEntwurf] = React.useState(/** @type {number|null} */ (null));
  const [speichertVorjahr, setSpeichertVorjahr] = React.useState(false);

  const jahre = jahresListe(bh.daten, bh.heute);
  const eingabe = { daten: bh.daten, einst: bh.einst, saetze: bh.saetze, jahr };
  const ergebnis = /** @type {any} */ (euerJahr(eingabe));
  const bilanzierungspflichtig = "hinweis" in ergebnis;

  const vorjahrCent = bilanzierungspflichtig ? null : vorjahr(bh.daten, bh.einst, bh.saetze, jahr);
  const delta = bilanzierungspflichtig ? null : vergleich(ergebnis.gewinn, vorjahrCent);
  const zuordnung = bilanzierungspflichtig ? null : aufteilung(ergebnis.gewinn, bh.daten, bh.einst, jahr);
  const namen = Object.fromEntries((bh.daten.Gesellschafter || []).map((g) => [g.id, g.name]));

  const vorjahrSpeichern = async () => {
    if (vorjahrEntwurf === null) return;
    setSpeichertVorjahr(true);
    try {
      await bh.einstellungSpeichern({ vorjahr_euer: { ...(bh.einst.vorjahr_euer || {}), [jahr - 1]: { gewinn: vorjahrEntwurf / 100 } } });
      toast.success(t("Einstellungen gespeichert"));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichertVorjahr(false);
    }
  };

  return (
    <div className="space-y-6" data-besitzer="79-11">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Jahresübersicht")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="jue-jahr">{t("Jahr")}</label>
          <select id="jue-jahr" className={FELD} value={String(jahr)} onChange={(e) => setJahr(Number(e.target.value))}>
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          {!bilanzierungspflichtig && <ExportKnopf modell={() => euerTabelle(eingabe, t)} bereich="jahresuebersicht" jahr={jahr} />}
        </div>
      </div>
      <RichtwertHinweis />
      <p className="text-sm text-slate-600 dark:text-slate-300">{t("Brutto-Methode wie Anlage EÜR (§ 4 Abs. 3 EStG, Zufluss/Abfluss § 11 EStG)")}</p>

      {bilanzierungspflichtig ? (
        <p data-testid="euer-bilanz-hinweis" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t("bilanziert, keine EÜR (§§ 238, 242 HGB i. V. m. § 13 Abs. 3 GmbHG) — die Bilanz erstellt der Steuerberater")}
          {ergebnis.ug && <> {t("Zusätzlich: 25 % des Jahresüberschusses in die gesetzliche Rücklage (§ 5a Abs. 3 GmbHG).")}</>}
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>{[t("Zeile"), t("Betrag")].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ergebnis.zeilen.map((z) => <EuerZeileRow key={z.schluessel} zeile={z} t={t} />)}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold dark:border-slate-700" data-testid="euer-gewinn">
                    <td className="px-3 py-2">{t("Gewinn")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(ergebnis.gewinn)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {ergebnis.hinweise.map((/** @type {string} */ h) => (
              <p key={h} className="text-sm text-amber-800 dark:text-amber-200">{hinweisText(h, t)}</p>
            ))}
          </section>

          <section className="space-y-1" data-testid="euer-vorjahr">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Vorjahr")}</h3>
            {vorjahrCent === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Vorjahreswerte erfasst")}:</span>
                <BetragFeld aria-label={t("Vorjahresgewinn")} wert={vorjahrEntwurf} onChange={setVorjahrEntwurf} />
                <button type="button" onClick={vorjahrSpeichern} disabled={vorjahrEntwurf === null || speichertVorjahr}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  {t("Speichern")}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {formatEuro(vorjahrCent)}
                {delta && (
                  <span className={delta.deltaCent < 0 ? "ml-2 text-red-700 dark:text-red-300" : "ml-2 text-emerald-700 dark:text-emerald-400"}>
                    Δ {delta.deltaCent >= 0 ? "+" : ""}{formatEuro(delta.deltaCent)}
                    {delta.prozent !== null && ` (${delta.prozent >= 0 ? "+" : ""}${delta.prozent.toLocaleString("de-DE")} %)`}
                  </span>
                )}
              </p>
            )}
          </section>

          <section className="space-y-2" data-testid="euer-zuordnung">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Gewinnzuordnung")}</h3>
            {!wirkung.schluesselNoetig ? (
              <p data-testid="euer-zuordnung-einzel">{t("Gewinn der Inhaberin: 100 %")}: {formatEuro(ergebnis.gewinn)}</p>
            ) : zuordnung && "fehlt" in zuordnung ? (
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {t("Gewinnschlüssel fehlt")} — <a href="?tab=drawings" className="underline underline-offset-2">{t("Zu den Entnahmen")}</a>
              </p>
            ) : (
              <>
                <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                  {Object.entries(/** @type {Record<string, number>} */ (zuordnung)).map(([id, cent]) => (
                    <li key={id}>{namen[id] || id}: {formatEuro(cent)}</li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500 dark:text-slate-400">{hinweisText("feststellung", t)}</p>
              </>
            )}
          </section>
        </>
      )}

      <DatevExportAbschnitt bh={bh} von={`${jahr}-01-01`} bis={`${jahr}-12-31`} />
    </div>
  );
}
