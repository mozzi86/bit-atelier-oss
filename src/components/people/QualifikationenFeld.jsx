// QualifikationenFeld.jsx — Liste der Qualifikationen im Mitarbeiterformular
// (Plan 80-04, Task 6): Enter fügt eine Bezeichnung hinzu, jeder Eintrag hat
// einen Knopf "<Bezeichnung> entfernen"; optional "gültig bis".
//
// In:  {wert, onChange} — wert = Mitarbeiter.qualifikationen (FELDER.qualifikation).
// Out: onChange(neueListe).

import React from "react";
import { X } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

// Native <input>/<label> statt shadcn-Wrapper (CLAUDE.md "shadcn-tsc-Altlast").
const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/** @param {string} text @param {Record<string, string>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * @param {{wert: Array<{art?: string, bezeichnung: string, erworben?: string, gueltig_bis?: string}>,
 *   onChange: (neu: object[]) => void}} props
 * @returns {React.ReactElement}
 */
export default function QualifikationenFeld({ wert = [], onChange }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = React.useState("");
  const liste = Array.isArray(wert) ? wert : [];

  const hinzufuegen = () => {
    const bezeichnung = entwurf.trim();
    if (!bezeichnung) return;
    onChange([...liste, { bezeichnung, art: "sonstige" }]);
    setEntwurf("");
  };

  const entfernen = (index) => {
    onChange(liste.filter((_, i) => i !== index));
  };

  const gueltigBisSetzen = (index, v) => {
    onChange(liste.map((q, i) => (i === index ? { ...q, gueltig_bis: v || undefined } : q)));
  };

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Qualifikationen")}</legend>
      <div className="mt-1">
        <label htmlFor="mf-qualifikation-neu" className={BESCHRIFTUNG}>{t("Qualifikation hinzufügen (Enter)")}</label>
        <input
          id="mf-qualifikation-neu"
          className={EINGABE}
          value={entwurf}
          onChange={(e) => setEntwurf(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); hinzufuegen(); }
          }}
          placeholder={t("z. B. Brandschutzbeauftragte:r")}
        />
      </div>
      {liste.length > 0 && (
        <ul className="mt-2 space-y-2">
          {liste.map((q, i) => (
            <li key={`${q.bezeichnung}-${i}`} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 dark:border-slate-700">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{q.bezeichnung}</span>
              <label htmlFor={`mf-qualifikation-${i}-bis`} className="text-xs text-slate-500">{t("gültig bis")}</label>
              <input
                id={`mf-qualifikation-${i}-bis`}
                type="date"
                value={q.gueltig_bis || ""}
                onChange={(e) => gueltigBisSetzen(i, e.target.value)}
                className={`${EINGABE} h-8 w-40`}
              />
              <button
                type="button"
                onClick={() => entfernen(i)}
                aria-label={fuellen(t("{bezeichnung} entfernen"), { bezeichnung: q.bezeichnung })}
                className="ml-auto rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
