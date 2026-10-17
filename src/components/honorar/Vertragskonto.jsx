// Contract account of an architect's contract (phase 81-04, HON-06): sum incl.
// commissioned fee amendments, progress per stage (79's lpStand; profiles without
// nine stages say so), earned, billed, paid, open, rest; the outgoing invoices of
// the contract; and "Abschlagsrechnung stellen" — 79's own invoice form
// (RechnungFormular) prefilled with 81's template (stage instalment + fee
// amendment positions). The invoice is created and issued by 79's form and chain
// (numbers, GoBD, payment term); 81 only prepares the template.
//
// In:  props zh, bh (79 page loader useBuchhaltung, for the embedded form),
//      vertrag. Out: the account view; writes only through 79's form — and, since
//      94-04 (B-ABN-08), the project's Leistungsstand into its HoaiPlan (the same
//      record the designer tab "Planer" writes; leistungsstandSpeichern.js).

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
import { toast } from "sonner";
import { bitApi } from "@core/api/bitApi";
import { speichereLeistungsstand } from "@/lib/honorar/leistungsstandSpeichern.js";

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
  // 94-04 (B-ABN-08): edit the Leistungsstand here (percent per commissioned stage, as text while typing).
  const [pflege, setPflege] = React.useState(/** @type {Record<number, string>|null} */ (null));
  const [speichertStand, setSpeichertStand] = React.useState(false);
  const beauftragt = (h.lph || []).filter((l) => l.beauftragt);
  const pflegeOeffnen = () => setPflege(Object.fromEntries(beauftragt.map((l) => [l.nr, String(stand?.stand?.[l.nr] ?? 0)])));
  const standSpeichern = async () => {
    if (!pflege) return;
    setSpeichertStand(true);
    try {
      const aenderungen = Object.fromEntries(Object.entries(pflege).map(([nr, v]) => [Number(nr), v === "" ? null : Number(v)]));
      await speichereLeistungsstand(/** @type {any} */ (bitApi), vertrag.project_id, aenderungen, zh.heute);
      await zh.neuLaden();
      setPflege(null);
      toast.success(t("Leistungsstand gespeichert"));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichertStand(false);
    }
  };

  const schliessen = async () => {
    setFormular(null);
    await Promise.all([bh?.neuLaden?.(), zh.neuLaden()]);
  };

  return (
    <section className="space-y-3" data-testid="vertragskonto">
      <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">{t("Vertragskonto")}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[["Summe inkl. Honorarnachträge", k.summe], ["Erbracht", k.erbracht], ["Abgerechnet", k.abgerechnet], ["Bezahlt", k.bezahlt], ["Offen", k.offen], ["Rest bis zur Schlussrechnung", k.rest]].map(([l, w]) => (
          <div key={/** @type {string} */ (l)} className="rounded-lg border border-border p-2 dark:border-slate-700">
            <dt className="text-xs text-muted-foreground">{t(/** @type {string} */ (l))}</dt>
            <dd className="tabular-nums font-medium">{euro(/** @type {number|null} */ (w))}</dd>
          </div>
        ))}
      </dl>
      {k.hinweise.includes("tafel_geaendert") && <p className="text-sm text-warnung dark:text-amber-200">{t("Tafel seit Vertragsschluss geändert — maßgeblich ist der Vergütungs-Beleg.")}</p>}
      {k.hinweise.includes("tafel_fehlt") && <p className="text-sm text-warnung dark:text-amber-200">{t("Tafel fehlt")} — {t("Einen Betrag liefert nur eine Pauschale.")}</p>}

      <div className="text-sm">
        <p className="font-medium">
          {t("Leistungsstand")}
          {stand?.quelle === "projektphase" && <span className="ml-2 text-xs font-normal text-warnung dark:text-amber-200" data-testid="stand-geschaetzt">{t("geschätzt aus der Projektphase")}</span>}
        </p>
        {stand ? (
          pflege ? (
            <div className="space-y-2" data-testid="stand-pflege">
              <div className="flex flex-wrap gap-2">
                {beauftragt.map((l) => (
                  <label key={l.nr} className="flex flex-col gap-1 text-xs">
                    {t("LPH")} {l.nr} (%)
                    <input type="number" min={0} max={100} className="h-8 w-20 rounded-md border border-border bg-card px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                      value={pflege[l.nr] ?? ""} onChange={(e) => setPflege((p) => ({ ...(p || {}), [l.nr]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} disabled={speichertStand} onClick={standSpeichern}>{t("Speichern")}</button>
                <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setPflege(null)}>{t("Abbrechen")}</button>
              </div>
              <p className="text-xs text-muted-foreground dark:text-slate-300">{t("Derselbe Leistungsstand wie im Designer-Reiter „Planer“ — eine Quelle für Controlling und Abschläge.")}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ul className="flex flex-wrap gap-2 text-xs">
                {beauftragt.map((l) => <li key={l.nr} className="rounded bg-muted px-1.5 py-0.5 dark:bg-slate-800">{t("LPH")} {l.nr}: {stand.stand[l.nr] ?? 0} %</li>)}
              </ul>
              {vertrag.project_id && (
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={pflegeOeffnen} data-testid="stand-pflegen">{t("Leistungsstand pflegen")}</button>
              )}
            </div>
          )
        ) : <p className="text-xs text-muted-foreground dark:text-slate-300">{t("Leistungsstand im Formular eintragen (Leistungsbild ohne neun LPH).")}</p>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-muted dark:bg-slate-800/60">
            <tr className="text-left text-muted-foreground dark:text-slate-300">
              <th scope="col" className="px-2 py-1">{t("Rechnung")}</th><th scope="col" className="px-2 py-1">{t("Datum")}</th>
              <th scope="col" className="px-2 py-1 text-right">{t("Netto")}</th><th scope="col" className="px-2 py-1">{t("Status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-slate-800">
            {alle.length === 0 && <tr><td colSpan={4} className="px-2 py-2 text-muted-foreground">{t("Noch keine Rechnung zu diesem Vertrag.")}</td></tr>}
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
        {abschlag && <span className="text-xs text-muted-foreground dark:text-slate-300" data-testid="abschlag-titel">{abschlag.titel} · {euro(abschlag.vorlage.netto)}</span>}
        <Link to={`/Accounting?tab=invoices&neu=1&vertrag=${encodeURIComponent(vertrag.id)}`} className="text-xs underline text-muted-foreground dark:text-slate-300">
          {t("in der Buchhaltung öffnen (ohne Honorarnachträge)")}
        </Link>
      </div>
      {formular && bh && (
        <RechnungFormular bh={bh} modus="neu" vertrag={vertrag} projektIdVorwahl={vertrag.project_id} vorlage={formular.vorlage} onClose={schliessen} />
      )}
    </section>
  );
}
