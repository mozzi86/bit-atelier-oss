// Contract account of an architect's contract (phase 81-04, HON-06): sum incl.
// commissioned fee amendments, progress per stage (79's lpStand; profiles without
// nine stages say so), earned, billed, paid, open, rest; the outgoing invoices of
// the contract; and "Abschlagsrechnung stellen" — 79's own invoice form
// (RechnungFormular) prefilled with 81's template (stage instalment + fee
// amendment positions). The invoice is created and issued by 79's form and chain
// (numbers, GoBD, payment term); 81 only prepares the template.
//
// In:  props zh, bh (79 page loader useBuchhaltung, for the embedded form),
//      vertrag. Out: the account view; writes only through 79's form.

import React from "react";
import { Link } from "react-router-dom";
import { Receipt } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { datumText } from "@core/lib/kalender/datum.js";
import { honorarVertrag, lpStand } from "@core/lib/hoai/honorar.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { rechnungsStatus } from "@/lib/accounting/grundlagen.js";
import { abschlagMitNachtraegen, vertragskonto } from "@/lib/honorar/vertrag.js";
import RechnungFormular from "@/components/accounting/RechnungFormular.jsx";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, bh: any, vertrag: Record<string, any>}} props
 * @returns {React.ReactElement}
 */
export default function Vertragskonto({ zh, bh, vertrag }) {
  const { t, lang } = useI18n();
  const [formular, setFormular] = React.useState(/** @type {any} */ (null));
  const projekt = zh.projekte.find((p) => p.id === vertrag.project_id) || null;
  const hoaiPlan = (zh.daten.HoaiPlan || []).find((h) => h.project_id === vertrag.project_id) || null;
  const daten = { rechnungen: zh.daten.Ausgangsrechnung || [], nachtraege: zh.daten.Honorarnachtrag || [], hoaiPlan, projekt, heuteIso: zh.heute };
  const k = vertragskonto(vertrag, daten);
  const abschlag = abschlagMitNachtraegen(vertrag, daten);
  const h = honorarVertrag(vertrag);
  const stand = lpStand(hoaiPlan, projekt, vertrag.leistungsbild);
  const euro = (/** @type {number|null} */ x) => (x === null ? "—" : formatEuro(Math.round(x * 100), lang));
  const alle = (zh.daten.Ausgangsrechnung || []).filter((r) => r.honorarvertrag_id === vertrag.id)
    .sort((a, b) => String(a.rechnungsdatum || "").localeCompare(String(b.rechnungsdatum || "")));
  let abschlagNr = 0;

  const schliessen = async () => {
    setFormular(null);
    await Promise.all([bh?.neuLaden?.(), zh.neuLaden()]);
  };

  return (
    <section className="space-y-3" data-testid="vertragskonto">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("Vertragskonto")}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[["Summe inkl. Honorarnachträge", k.summe], ["Erbracht", k.erbracht], ["Abgerechnet", k.abgerechnet], ["Bezahlt", k.bezahlt], ["Offen", k.offen], ["Rest bis zur Schlussrechnung", k.rest]].map(([l, w]) => (
          <div key={/** @type {string} */ (l)} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <dt className="text-xs text-slate-500">{t(/** @type {string} */ (l))}</dt>
            <dd className="tabular-nums font-medium">{euro(/** @type {number|null} */ (w))}</dd>
          </div>
        ))}
      </dl>
      {k.hinweise.includes("tafel_geaendert") && <p className="text-sm text-amber-800 dark:text-amber-200">{t("Tafel seit Vertragsschluss geändert — maßgeblich ist der Vergütungs-Beleg.")}</p>}
      {k.hinweise.includes("tafel_fehlt") && <p className="text-sm text-amber-800 dark:text-amber-200">{t("Tafel fehlt")} — {t("Einen Betrag liefert nur eine Pauschale.")}</p>}

      <div className="text-sm">
        <p className="font-medium">{t("Leistungsstand")}</p>
        {stand ? (
          <ul className="flex flex-wrap gap-2 text-xs">
            {(h.lph || []).filter((l) => l.beauftragt).map((l) => <li key={l.nr} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{t("LPH")} {l.nr}: {stand.stand[l.nr] ?? 0} %</li>)}
          </ul>
        ) : <p className="text-xs text-slate-600 dark:text-slate-300">{t("Leistungsstand im Formular eintragen (Leistungsbild ohne neun LPH).")}</p>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-left text-slate-600 dark:text-slate-300">
              <th scope="col" className="px-2 py-1">{t("Rechnung")}</th><th scope="col" className="px-2 py-1">{t("Datum")}</th>
              <th scope="col" className="px-2 py-1 text-right">{t("Netto")}</th><th scope="col" className="px-2 py-1">{t("Status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {alle.length === 0 && <tr><td colSpan={4} className="px-2 py-2 text-slate-500">{t("Noch keine Rechnung zu diesem Vertrag.")}</td></tr>}
            {alle.map((r) => {
              const nr = r.art === "abschlag" && r.status === "gestellt" ? ++abschlagNr : null;
              const st = rechnungsStatus(r, zh.heute);
              return (
                <tr key={r.id} data-testid="vertrag-rechnung">
                  <td className="px-2 py-1">{nr ? t("Abschlagsrechnung Nr. {n}").replace("{n}", String(nr)) : t(r.art === "schluss" ? "Schlussrechnung" : r.art === "storno" ? "Storno" : "Rechnung")} {r.nummer || ""}</td>
                  <td className="px-2 py-1 tabular-nums">{datumText(r.rechnungsdatum, lang)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{euro(typeof r.netto === "number" ? r.netto : null)}</td>
                  <td className="px-2 py-1">{t(st === "bezahlt" ? "Bezahlt" : st === "ueberfaellig" ? "Überfällig" : st === "offen" || st === "teilbezahlt" ? "Offen" : st === "entwurf" ? "im Entwurf" : st === "storniert" ? "Storniert" : "Geplant")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonVariants({ variant: "default" })} disabled={!abschlag || !bh || bh.laedt || !bh.verfuegbar}
          title={!abschlag ? t("Ohne Betrag kein Abschlag (Tafel fehlt).") : undefined}
          onClick={() => setFormular(abschlag)} data-testid="abschlag-stellen">
          <Receipt aria-hidden="true" /> {t("Abschlagsrechnung stellen")}
        </button>
        {abschlag && <span className="text-xs text-slate-600 dark:text-slate-300" data-testid="abschlag-titel">{abschlag.titel} · {euro(abschlag.vorlage.netto)}</span>}
        <Link to={`/Accounting?tab=invoices&neu=1&vertrag=${encodeURIComponent(vertrag.id)}`} className="text-xs underline text-slate-600 dark:text-slate-300">
          {t("in der Buchhaltung öffnen (ohne Honorarnachträge)")}
        </Link>
      </div>
      {formular && bh && (
        <RechnungFormular bh={bh} modus="neu" vertrag={vertrag} projektIdVorwahl={vertrag.project_id} vorlage={formular.vorlage} onClose={schliessen} />
      )}
    </section>
  );
}
