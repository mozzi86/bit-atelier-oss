// Tab "Postbuch" of /Correspondence (phase 82, 82-05): incoming and outgoing
// mail with filters (direction, project, open/settled, year) and the actions
// "Antwort schreiben", "Erledigt", "Scan öffnen", edit, delete. An outgoing
// entry of a fixed letter cannot be deleted; other deletions ask first.
//
// In:  props (see JSDoc; entries already filtered by rights). Out: the tab.

import React, { useState } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { POST_KANAL, POST_RICHTUNG } from "@core/lib/brief/status.js";

/**
 * @param {{
 *   eintraege: any[], projektNamen: Map<string, string>, nutzerNamen: Map<string, string>, aktivesProjekt: string|null,
 *   darfBearbeiten: boolean, loeschbar: (e: any) => boolean,
 *   onNeu: () => void, onBearbeiten: (e: any) => void, onAntwort: (e: any) => void, onErledigt: (e: any) => void,
 *   onScan: (e: any) => void, onLoeschen: (e: any) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function PostbuchReiter({ eintraege, projektNamen, nutzerNamen, aktivesProjekt, darfBearbeiten, loeschbar, onNeu, onBearbeiten, onAntwort, onErledigt, onScan, onLoeschen }) {
  const { t } = useI18n();
  const [richtung, setRichtung] = useState("alle");
  const [projekt, setProjekt] = useState("alle");
  const [offen, setOffen] = useState("alle");
  const jahre = [...new Set(eintraege.map((e) => String(e.datum || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const [jahr, setJahr] = useState("alle");
  const liste = eintraege
    .filter((e) => richtung === "alle" || e.richtung === richtung)
    .filter((e) => projekt === "alle" || (projekt === "aktiv" ? e.project_id === aktivesProjekt : !e.project_id))
    .filter((e) => offen === "alle" || (offen === "offen" ? e.richtung === "eingang" && !e.erledigt_am : Boolean(e.erledigt_am)))
    .filter((e) => jahr === "alle" || String(e.datum || "").startsWith(jahr))
    .sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")) || String(b.nummer || "").localeCompare(String(a.nummer || "")));
  const auswahl = "h-9 rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
  return (
    <section className="space-y-3" data-testid="postbuch">
      <div className="flex flex-wrap items-center gap-2">
        {darfBearbeiten && <Button type="button" size="sm" onClick={onNeu} data-testid="posteingang-neu"><Inbox className="h-4 w-4" aria-hidden="true" /> {t("Posteingang erfassen")}</Button>}
        <select aria-label={t("Richtung")} className={auswahl} value={richtung} onChange={(e) => setRichtung(e.target.value)} data-testid="postbuch-richtung">
          <option value="alle">{t("Ein- und Ausgang")}</option>
          {Object.entries(POST_RICHTUNG).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
        </select>
        <select aria-label={t("Projektfilter")} className={auswahl} value={projekt} onChange={(e) => setProjekt(e.target.value)}>
          <option value="alle">{t("alle")}</option>
          {aktivesProjekt && <option value="aktiv">{t("aktives Projekt")}</option>}
          <option value="buero">{t("Büro (ohne Projekt)")}</option>
        </select>
        <select aria-label={t("Stand")} className={auswahl} value={offen} onChange={(e) => setOffen(e.target.value)}>
          <option value="alle">{t("offen und erledigt")}</option>
          <option value="offen">{t("offen")}</option>
          <option value="erledigt">{t("erledigt")}</option>
        </select>
        <select aria-label={t("Jahr")} className={auswahl} value={jahr} onChange={(e) => setJahr(e.target.value)}>
          <option value="alle">{t("alle Jahre")}</option>
          {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>
      {liste.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Einträge.")}</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Postbuch")}</caption>
            <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <tr>
                <th scope="col" className="px-2 py-1">{t("Nummer")}</th><th scope="col" className="px-2 py-1">{t("Datum")}</th><th scope="col" className="px-2 py-1">{t("Partner")}</th>
                <th scope="col" className="px-2 py-1">{t("Betreff")}</th><th scope="col" className="px-2 py-1">{t("Kanal")}</th><th scope="col" className="px-2 py-1">{t("Frist")}</th>
                <th scope="col" className="px-2 py-1">{t("zuständig")}</th><th scope="col" className="px-2 py-1">{t("erledigt")}</th><th scope="col" className="px-2 py-1">{t("Aktionen")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {liste.map((e) => (
                <tr key={e.id} data-testid="postbuch-zeile" data-nummer={e.nummer} data-erledigt={e.erledigt_am ? "1" : "0"}>
                  <td className="px-2 py-1 tabular-nums">{e.nummer}</td>
                  <td className="px-2 py-1 tabular-nums">{e.datum}</td>
                  <td className="px-2 py-1">{e.partner_name || "—"}</td>
                  <td className="px-2 py-1">{e.betreff}{e.project_id ? <span className="block text-xs text-slate-500">{projektNamen.get(e.project_id) || e.project_id}</span> : null}</td>
                  <td className="px-2 py-1">{t(/** @type {any} */ (POST_KANAL)[e.kanal]?.label || e.kanal || "—")}</td>
                  <td className="px-2 py-1 tabular-nums" data-testid="postbuch-frist">{e.frist || "—"}</td>
                  <td className="px-2 py-1">{e.zustaendig ? nutzerNamen.get(e.zustaendig) || e.zustaendig : "—"}</td>
                  <td className="px-2 py-1 tabular-nums">{e.erledigt_am || "—"}</td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      {darfBearbeiten && e.richtung === "eingang" && !e.erledigt_am && <Button type="button" size="sm" variant="outline" onClick={() => onAntwort(e)} aria-label={`${t("Antwort schreiben")}: ${e.nummer}`} data-testid="postbuch-antwort">{t("Antwort schreiben")}</Button>}
                      {darfBearbeiten && e.richtung === "eingang" && !e.erledigt_am && <Button type="button" size="sm" variant="outline" onClick={() => onErledigt(e)} aria-label={`${t("Erledigt")}: ${e.nummer}`}>{t("Erledigt")}</Button>}
                      {e.document_id && <Button type="button" size="sm" variant="outline" onClick={() => onScan(e)}>{e.richtung === "eingang" ? t("Scan öffnen") : t("PDF öffnen")}</Button>}
                      {darfBearbeiten && e.richtung === "eingang" && <Button type="button" size="sm" variant="ghost" onClick={() => onBearbeiten(e)} aria-label={`${t("Bearbeiten")}: ${e.nummer}`}>{t("Bearbeiten")}</Button>}
                      {darfBearbeiten && loeschbar(e) && <Button type="button" size="sm" variant="ghost" onClick={() => onLoeschen(e)} aria-label={`${t("Löschen")}: ${e.nummer}`}>{t("Löschen")}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
