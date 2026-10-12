// Tab "Gewährleistung" of /Deadlines (phase 82, 82-03, FRIST-03): every
// acceptance with its computed dates, sorted by the end of warranty — project,
// trade, acceptance, rule set with norm, end, inspection, security, own work —
// and the button "Abnahme erfassen". Acceptances are project data and stay open
// in the cloud (E-03 does not name /Deadlines); they are written through the
// phase-82 storage layer.
//
// In:  props abnahmen, regelWert, projekte (visible ones), darfBearbeiten,
//      onSpeichern. Out: the tab.

import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { ABNAHME_REGELN } from "@core/lib/kalender/abnahme.js";
import { termineAusAbnahmen } from "@core/lib/kalender/gewaehrleistung.js";
import AbnahmeDialog from "./AbnahmeDialog.jsx";

/**
 * @param {{abnahmen: any[], regelWert: (id: string) => any, projekte: Array<{id: string, name?: string}>, darfBearbeiten: boolean,
 *   onSpeichern: (a: Record<string, any>) => Promise<boolean>}} props
 * @returns {React.ReactElement}
 */
export default function GewaehrleistungReiter({ abnahmen, regelWert, projekte, darfBearbeiten, onSpeichern }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState(false);
  const name = (/** @type {string} */ id) => projekte.find((p) => p.id === id)?.name || id;
  const zeilen = abnahmen.filter((a) => projekte.some((p) => p.id === a.project_id)).map((a) => {
    const { termine, warnungen } = termineAusAbnahmen([a], regelWert);
    const von = (/** @type {string} */ art) => termine.find((x) => x.art === art);
    const ende = von("gewaehrleistung_ende") || von("architektenhaftung_ende");
    return { a, ende, begehung: von("begehung_vor_ablauf"), sicherheit: von("sicherheit_rueckgabe"), warnung: warnungen[0]?.grund };
  }).sort((x, y) => String(x.ende?.datum || "9999").localeCompare(String(y.ende?.datum || "9999")));

  return (
    <section className="space-y-3" data-testid="gewaehrleistung">
      {darfBearbeiten && <Button type="button" size="sm" onClick={() => setDialog(true)} data-testid="abnahme-erfassen"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t("Abnahme erfassen")}</Button>}
      {zeilen.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Noch keine Abnahme erfasst.")}</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm" data-testid="gewaehrleistung-tabelle">
            <caption className="sr-only">{t("Gewährleistung aus Abnahmen")}</caption>
            <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <tr><th scope="col" className="px-2 py-1">{t("Projekt")}</th><th scope="col" className="px-2 py-1">{t("Gewerk")}</th><th scope="col" className="px-2 py-1">{t("Abnahme")}</th><th scope="col" className="px-2 py-1">{t("Regelwerk")}</th><th scope="col" className="px-2 py-1">{t("Ende")}</th><th scope="col" className="px-2 py-1">{t("Begehung")}</th><th scope="col" className="px-2 py-1">{t("Sicherheit")}</th><th scope="col" className="px-2 py-1">{t("eigene Leistung")}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {zeilen.map(({ a, ende, begehung, sicherheit, warnung }) => (
                <tr key={a.id} data-testid="gewaehrleistung-zeile" data-abnahme={a.id}>
                  <td className="px-2 py-1">{name(a.project_id)}</td>
                  <td className="px-2 py-1">{a.gewerk}</td>
                  <td className="px-2 py-1 tabular-nums">{a.datum}</td>
                  <td className="px-2 py-1">{a.regel ? t(ABNAHME_REGELN[a.regel]?.label || a.regel) : "—"}{ende?.herkunft ? <span className="block text-xs text-slate-500">{ende.herkunft}</span> : null}</td>
                  <td className="px-2 py-1 tabular-nums" data-testid="gewaehrleistung-ende">{ende?.datum || (warnung ? t(warnung) : "—")}</td>
                  <td className="px-2 py-1 tabular-nums">{begehung?.datum || "—"}</td>
                  <td className="px-2 py-1 tabular-nums">{sicherheit ? `${sicherheit.datum}${sicherheit.erledigt ? ` · ${t("erledigt")}` : ""}` : "—"}</td>
                  <td className="px-2 py-1">{a.eigene_leistung ? t("ja") : t("nein")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && <AbnahmeDialog projekte={projekte} regelWert={regelWert} onClose={() => setDialog(false)} onSpeichern={async (abnahme) => { if (await onSpeichern(abnahme)) setDialog(false); }} />}
    </section>
  );
}
