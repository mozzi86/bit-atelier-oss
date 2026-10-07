// VorgangsListe.jsx — Liste laufender und abgeschlossener Personalvorgänge
// (Plan 80-09, Task 3): je Vorgang Art (Eintritt/Austritt), Person, Stichtag,
// Fortschritt (native <progress> mit aria-valuenow) und offene Pflichtpunkte.
//
// In:  {vorgaenge, mitarbeiterListe, vertraege, onOeffnen}. Out: UI, keine
//      eigenen Schreibzugriffe (reine Liste, das Bearbeiten übernimmt
//      VorgangsCheckliste.jsx).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { anzeigeName } from "@/lib/people/mitarbeiter.js";
import { fortschritt, abgeleiteteErledigungen } from "@/lib/people/onboarding.js";

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * @param {{vorgaenge: object[], mitarbeiterListe: object[], vertraege: object[],
 *   onOeffnen: (vorgang: object) => void}} props
 * @returns {React.ReactElement}
 */
export default function VorgangsListe({ vorgaenge, mitarbeiterListe, vertraege, onOeffnen }) {
  const { t } = useI18n();
  const mitarbeiterVon = (id) => (mitarbeiterListe || []).find((m) => m.id === id);

  // Laufende zuerst (nach Stichtag), Abgeschlossene ans Ende — kein Vorgang
  // verschwindet, damit ein Nutzer eine bereits geschlossene Checkliste noch
  // nachlesen kann.
  const sortiert = [...(Array.isArray(vorgaenge) ? vorgaenge : [])].sort((a, b) => {
    const aOffen = a.status !== "abgeschlossen";
    const bOffen = b.status !== "abgeschlossen";
    if (aOffen !== bOffen) return aOffen ? -1 : 1;
    return (a.stichtag || "").localeCompare(b.stichtag || "");
  });

  if (sortiert.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="vorgangsliste-leer">{t("Keine laufenden Vorgänge.")}</p>;
  }

  return (
    <ul className="space-y-2" data-testid="vorgangsliste">
      {sortiert.map((v) => {
        const m = mitarbeiterVon(v.mitarbeiter_id);
        const abgeleitet = abgeleiteteErledigungen(v, vertraege);
        const schritte = Array.isArray(v.schritte) ? v.schritte : [];
        const prozent = fortschritt(schritte, abgeleitet);
        const abgeleitetSet = new Set(abgeleitet.map((a) => a.schluessel));
        const offenePflicht = schritte.filter((s) => s?.pflicht !== false && !s?.erledigt_am && !abgeleitetSet.has(s?.schluessel)).length;
        const name = anzeigeName(m) || t("Unbekannt");
        return (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onOeffnen(v)}
              data-vorgang={v.id}
              className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {t(v.art === "eintritt" ? "Eintritt" : "Austritt")} — {name}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {fmtDatum(v.stichtag)} · {t(v.status === "abgeschlossen" ? "Abgeschlossen" : "Offen")}
                </span>
              </div>
              <progress
                value={prozent}
                max={100}
                aria-valuenow={prozent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={fuellen(t("Vorgang {name}: {prozent} % erledigt"), { name, prozent })}
                className="mt-2 h-1.5 w-full accent-emerald-600"
              >
                {prozent}%
              </progress>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {offenePflicht > 0
                  ? fuellen(t("{n} offene Pflichtpunkte"), { n: offenePflicht })
                  : t("Alle Pflichtpunkte erledigt")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
