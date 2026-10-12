// Request list (phase 82, 82-04, ABW-01/04): filter by state, person and year.
// The kind appears only through sichtbarerGrund (personnel rights: all; else
// only the own entries). Approve/reject (owner, bookkeeping; project lead for
// the persons of her projects) ask first and record entschieden_von/am at the
// record in the personnel storage class — 80-02: personnel writes no project
// audit; the project protocol is an ordinary entity and would go into the
// .bitproj and the cloud. Cancel for the own request.
//
// In:  props (see JSDoc). Out: the list.

import React, { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { ABWESENHEIT_ARTEN, ABWESENHEIT_STATUS, konflikte, sichtbarerGrund } from "@/lib/abwesenheit/abwesenheit.js";

/**
 * @param {{
 *   antraege: any[], alle: any[], zugriff: any, kuerzel: (id: string) => string, maxGleichzeitig: number,
 *   darfEntscheiden: (a: any) => boolean, darfStornieren: (a: any) => boolean, darfNeu: boolean,
 *   onNeu: () => void, onStatus: (a: any, ziel: 'genehmigt'|'abgelehnt'|'storniert') => Promise<void>,
 * }} props
 * @returns {React.ReactElement}
 */
export default function AntragsListe({ antraege, alle, zugriff, kuerzel, maxGleichzeitig, darfEntscheiden, darfStornieren, darfNeu, onNeu, onStatus }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [status, setStatus] = useState("alle");
  const [person, setPerson] = useState("alle");
  const jahre = [...new Set(antraege.map((a) => String(a.von || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const [jahr, setJahr] = useState("alle");
  const liste = antraege
    .filter((a) => status === "alle" || a.status === status)
    .filter((a) => person === "alle" || a.mitarbeiter_id === person)
    .filter((a) => jahr === "alle" || String(a.von).startsWith(jahr))
    .sort((a, b) => String(b.von).localeCompare(String(a.von)));
  const personen = [...new Set(antraege.map((a) => a.mitarbeiter_id))];
  const wechsel = async (/** @type {any} */ a, /** @type {'genehmigt'|'abgelehnt'|'storniert'} */ ziel) => {
    const titel = ziel === "genehmigt" ? t("Genehmigen?") : ziel === "abgelehnt" ? t("Ablehnen?") : t("Stornieren?");
    if (await bestaetige({ titel, text: `${kuerzel(a.mitarbeiter_id)} · ${a.von} – ${a.bis}`, bestaetigen: t("Bestätigen"), gefahr: ziel !== "genehmigt" })) await onStatus(a, ziel);
  };
  const auswahl = "h-9 rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
  return (
    <section className="space-y-3" data-testid="antrags-liste">
      <div className="flex flex-wrap items-center gap-2">
        {darfNeu && <Button type="button" size="sm" onClick={onNeu} data-testid="antrag-neu"><CalendarPlus className="h-4 w-4" aria-hidden="true" /> {t("Abwesenheit eintragen")}</Button>}
        <select aria-label={t("Status")} className={auswahl} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="alle">{t("alle")}</option>
          {Object.entries(ABWESENHEIT_STATUS).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
        </select>
        <select aria-label={t("Person")} className={auswahl} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="alle">{t("alle")}</option>
          {personen.map((p) => <option key={p} value={p}>{kuerzel(p)}</option>)}
        </select>
        <select aria-label={t("Jahr")} className={auswahl} value={jahr} onChange={(e) => setJahr(e.target.value)}>
          <option value="alle">{t("alle Jahre")}</option>
          {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>
      {liste.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Einträge.")}</p> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {liste.map((a) => {
            const grund = sichtbarerGrund(zugriff, a);
            const warn = a.status === "beantragt" ? konflikte(a, alle, { maxGleichzeitig }) : [];
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="antrag-zeile" data-antrag={a.id} data-status={a.status}>
                <span>
                  <span className="font-medium">{kuerzel(a.mitarbeiter_id)}</span> · {a.von}{a.bis && a.bis !== a.von ? ` – ${a.bis}` : ""} · <span data-testid="antrag-grund">{grund === "abwesend" ? t("abwesend") : t(/** @type {any} */ (ABWESENHEIT_ARTEN)[grund]?.label || grund)}</span>
                  {" · "}<span className="text-slate-500">{t(/** @type {any} */ (ABWESENHEIT_STATUS)[a.status]?.label || a.status)}</span>
                  {a.vertretung_id ? <span className="text-slate-500"> · {t("Vertretung")} {kuerzel(a.vertretung_id)}</span> : null}
                  {warn.length > 0 && <span className="ml-1 text-xs text-amber-800 dark:text-amber-200" data-testid="antrag-zeile-warnung">⚠ {warn.map((w) => w.art === "vertretung_abwesend" ? t("Vertretung {kuerzel} ist {von}–{bis} selbst abwesend").replace("{kuerzel}", kuerzel(w.werte.vertretung)).replace("{von}", w.werte.von).replace("{bis}", w.werte.bis) : t("Konflikt")).join(" · ")}</span>}
                </span>
                <span className="flex gap-1">
                  {a.status === "beantragt" && darfEntscheiden(a) && <Button type="button" size="sm" onClick={() => wechsel(a, "genehmigt")} data-testid="antrag-genehmigen">{t("Genehmigen")}</Button>}
                  {a.status === "beantragt" && darfEntscheiden(a) && <Button type="button" size="sm" variant="outline" onClick={() => wechsel(a, "abgelehnt")}>{t("Ablehnen")}</Button>}
                  {(a.status === "beantragt" || a.status === "genehmigt") && darfStornieren(a) && <Button type="button" size="sm" variant="ghost" onClick={() => wechsel(a, "storniert")}>{t("Stornieren")}</Button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
