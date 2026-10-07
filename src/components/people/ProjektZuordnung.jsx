// ProjektZuordnung.jsx — Projektzuordnungen im Mitarbeiterformular (Plan
// 80-04, Task 6): Projektauswahl aus bitApi.entities.Project, Funktion, Anteil
// in %, von/bis. Lädt die Projektliste selbst (nur lesend, projektfrei wie
// /People selbst — die Auswahl braucht alle Projekte, nicht nur das aktive).
//
// Native <select>/<input>/<label> statt der shadcn-Wrapper (CLAUDE.md
// "shadcn-tsc-Altlast").
//
// In:  {wert, onChange} — wert = Mitarbeiter.projekt_zuordnungen (FELDER.projektZuordnung).
// Out: onChange(neueListe).

import React from "react";
import { X } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-xs font-medium leading-none text-slate-700 dark:text-slate-200";

/**
 * @param {{wert: Array<{project_id: string, funktion?: string, anteil_prozent?: number, von?: string, bis?: string}>,
 *   onChange: (neu: object[]) => void}} props
 * @returns {React.ReactElement}
 */
export default function ProjektZuordnung({ wert = [], onChange }) {
  const { t } = useI18n();
  const [projekte, setProjekte] = React.useState(/** @type {Array<{id: string, name?: string}>} */ ([]));
  const liste = Array.isArray(wert) ? wert : [];

  React.useEffect(() => {
    let aktiv = true;
    /** @type {any} */ (bitApi.entities).Project.list()
      .then((rows) => { if (aktiv) setProjekte(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (aktiv) setProjekte([]); });
    return () => { aktiv = false; };
  }, []);

  const hinzufuegen = () => {
    const erstes = projekte.find((p) => !liste.some((z) => z.project_id === p.id));
    if (!erstes) return;
    onChange([...liste, { project_id: erstes.id, funktion: "", anteil_prozent: 100, von: "", bis: "" }]);
  };

  const aendern = (index, feld, v) => {
    onChange(liste.map((z, i) => (i === index ? { ...z, [feld]: v } : z)));
  };

  const entfernen = (index) => onChange(liste.filter((_, i) => i !== index));

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Projektzuordnungen")}</legend>
      <div className="mt-1 space-y-3">
        {liste.map((z, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] dark:border-slate-700">
            <div>
              <label htmlFor={`mf-projekt-${i}`} className={BESCHRIFTUNG}>{t("Projekt")}</label>
              <select id={`mf-projekt-${i}`} className={EINGABE} value={z.project_id} onChange={(e) => aendern(i, "project_id", e.target.value)}>
                {projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`mf-projekt-${i}-funktion`} className={BESCHRIFTUNG}>{t("Funktion")}</label>
              <input id={`mf-projekt-${i}-funktion`} className={EINGABE} value={z.funktion || ""} onChange={(e) => aendern(i, "funktion", e.target.value)} />
            </div>
            <div>
              <label htmlFor={`mf-projekt-${i}-anteil`} className={BESCHRIFTUNG}>{t("Anteil %")}</label>
              <input id={`mf-projekt-${i}-anteil`} type="number" min={0} max={100} className={EINGABE} value={z.anteil_prozent ?? ""} onChange={(e) => aendern(i, "anteil_prozent", Number(e.target.value))} />
            </div>
            <div>
              <label htmlFor={`mf-projekt-${i}-von`} className={BESCHRIFTUNG}>{t("Beginn")}</label>
              <input id={`mf-projekt-${i}-von`} type="date" className={EINGABE} value={z.von || ""} onChange={(e) => aendern(i, "von", e.target.value)} />
            </div>
            <div>
              <label htmlFor={`mf-projekt-${i}-bis`} className={BESCHRIFTUNG}>{t("Ende")}</label>
              <input id={`mf-projekt-${i}-bis`} type="date" className={EINGABE} value={z.bis || ""} onChange={(e) => aendern(i, "bis", e.target.value)} />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={() => entfernen(i)} aria-label={t("Projektzuordnung entfernen")}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={hinzufuegen} disabled={projekte.length === 0}
          className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          {t("Projekt zuordnen")}
        </button>
      </div>
    </fieldset>
  );
}
