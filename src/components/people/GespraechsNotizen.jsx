// GespraechsNotizen.jsx — Gespräche (Datum, Art, Teilnehmende, Notiz,
// Ergebnis) und eine Bewertung je Kriterium 1–5 im Bewerbungsformular (Plan
// 80-08, Task 4). Der sichtbare Hinweis bindet DS-06/AGG unmittelbar an die
// Eingabe, nicht nur an einen Kommentar im Code.
//
// In:  {gespraeche, bewertung, mitarbeiterListe, onGespraecheChange, onBewertungChange}.
// Out: die beiden geänderten Listen (Elternkomponente speichert).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { anzeigeName } from "@/lib/people/mitarbeiter.js";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/** Gesprächsarten. */
const GESPRAECH_ARTEN = Object.freeze([
  { key: "telefon", label: "Telefonisch" },
  { key: "video", label: "Video" },
  { key: "vor_ort", label: "Vor Ort" },
]);

/** Feste Bewertungskriterien — fachlich, nicht personenbezogen (§ 1 AGG). */
const KRITERIEN = Object.freeze(["Fachliche Eignung", "Erfahrung im Projekttyp", "Software-Kenntnisse", "Verfügbarkeit"]);

/**
 * @param {{gespraeche: object[], bewertung: object[], mitarbeiterListe: object[],
 *   onGespraecheChange: (neu: object[]) => void, onBewertungChange: (neu: object[]) => void}} props
 * @returns {React.ReactElement}
 */
export default function GespraechsNotizen({ gespraeche, bewertung, mitarbeiterListe, onGespraecheChange, onBewertungChange }) {
  const { t } = useI18n();
  const liste = Array.isArray(gespraeche) ? gespraeche : [];
  const bewertungListe = Array.isArray(bewertung) ? bewertung : [];

  const gespraechHinzufuegen = () => onGespraecheChange([...liste, { datum: "", art: "telefon", teilnehmende: [], notiz: "", ergebnis: "" }]);
  const gespraechAendern = (i, feld, wert) => onGespraecheChange(liste.map((g, idx) => (idx === i ? { ...g, [feld]: wert } : g)));
  const gespraechEntfernen = (i) => onGespraecheChange(liste.filter((_, idx) => idx !== i));

  const teilnehmerUmschalten = (i, mitarbeiterId) => {
    const g = liste[i];
    const teilnehmende = Array.isArray(g.teilnehmende) ? g.teilnehmende : [];
    const neu = teilnehmende.includes(mitarbeiterId) ? teilnehmende.filter((id) => id !== mitarbeiterId) : [...teilnehmende, mitarbeiterId];
    gespraechAendern(i, "teilnehmende", neu);
  };

  const kriteriumWert = (kriterium) => bewertungListe.find((b) => b.kriterium === kriterium)?.wert ?? 0;
  const kriteriumSetzen = (kriterium, wert) => {
    const ohne = bewertungListe.filter((b) => b.kriterium !== kriterium);
    onBewertungChange(wert > 0 ? [...ohne, { kriterium, wert }] : ohne);
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Gespräche")}</legend>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="agg-gespraechshinweis">
          {t("Nur tätigkeitsbezogene Angaben — keine Merkmale nach § 1 AGG (Herkunft, Geschlecht, Religion, Behinderung, Alter, sexuelle Identität).")}
        </p>
        {liste.map((g, i) => (
          <div key={i} className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor={`gn-datum-${i}`} className={BESCHRIFTUNG}>{t("Datum")}</label>
                <input id={`gn-datum-${i}`} type="date" className={EINGABE} value={g.datum || ""} onChange={(e) => gespraechAendern(i, "datum", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`gn-art-${i}`} className={BESCHRIFTUNG}>{t("Art")}</label>
                <select id={`gn-art-${i}`} className={EINGABE} value={g.art || "telefon"} onChange={(e) => gespraechAendern(i, "art", e.target.value)}>
                  {GESPRAECH_ARTEN.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
                </select>
              </div>
            </div>
            {mitarbeiterListe.length > 0 && (
              <div>
                <span className={BESCHRIFTUNG}>{t("Teilnehmende")}</span>
                <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t("Teilnehmende")}>
                  {mitarbeiterListe.map((m) => (
                    <button key={m.id} type="button" aria-pressed={(g.teilnehmende || []).includes(m.id)} onClick={() => teilnehmerUmschalten(i, m.id)}
                      className={`rounded-full px-2.5 py-1 text-xs ${(g.teilnehmende || []).includes(m.id) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"}`}>
                      {anzeigeName(m)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label htmlFor={`gn-notiz-${i}`} className={BESCHRIFTUNG}>{t("Notiz")}</label>
              <textarea id={`gn-notiz-${i}`} rows={2} className={EINGABE} value={g.notiz || ""} onChange={(e) => gespraechAendern(i, "notiz", e.target.value)} />
            </div>
            <div>
              <label htmlFor={`gn-ergebnis-${i}`} className={BESCHRIFTUNG}>{t("Ergebnis")}</label>
              <input id={`gn-ergebnis-${i}`} className={EINGABE} value={g.ergebnis || ""} onChange={(e) => gespraechAendern(i, "ergebnis", e.target.value)} />
            </div>
            <button type="button" onClick={() => gespraechEntfernen(i)} className="text-xs text-rose-600 hover:underline dark:text-rose-400">{t("Gespräch entfernen")}</button>
          </div>
        ))}
        <button type="button" onClick={gespraechHinzufuegen} className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
          {t("Gespräch hinzufügen")}
        </button>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Bewertung")}</legend>
        <div className="mt-1 space-y-2">
          {KRITERIEN.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-48 shrink-0 text-sm text-slate-700 dark:text-slate-200">{t(k)}</span>
              <div role="radiogroup" aria-label={t(k)} className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={kriteriumWert(k) === n} onClick={() => kriteriumSetzen(k, n)}
                    className={`h-7 w-7 rounded-md border text-xs ${kriteriumWert(k) === n ? "border-emerald-500 bg-emerald-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
