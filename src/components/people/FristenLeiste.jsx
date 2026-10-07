// FristenLeiste.jsx — Liste der fälligen Personal-Fristen (Plan 80-06, Task
// 7): reine Anzeige der von fristen.js abgeleiteten Einträge, mit Link auf
// die betroffene Zeile (opake ID, DS-07) und "Quittieren" (legt NUR eine
// Fristquittung an — die Frist selbst bleibt abgeleitet). Höchstens 5
// Einträge, dazu "alle anzeigen".
//
// In:  {faellig, onQuittiert}. Out: UI, ein create über bitApi.personal.Fristquittung.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";

/** Query-Parameter je Zieltab (personalLink.js): welches Feld die opake ID trägt. */
const PARAMETER_JE_TAB = Object.freeze({ staff: "mitarbeiter", contracts: "vertrag", recruiting: "bewerbung", onboarding: "vorgang" });

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * @param {{art: string, faellig_am: string, bezug: {tab: string, id: string}, text: string, norm: string, ueberfaellig: boolean}} eintrag
 * @returns {string} '?tab=contracts&vertrag=<id>' o. Ä. — '' wenn der Bezug keine echte ID trägt (Sammel-Erinnerungen)
 */
function link(eintrag) {
  const param = PARAMETER_JE_TAB[eintrag.bezug?.tab];
  if (!param || eintrag.bezug?.id === "buero") return bauePersonalLink({ tab: eintrag.bezug?.tab });
  return bauePersonalLink({ tab: eintrag.bezug.tab, [param]: eintrag.bezug.id });
}

/**
 * @param {{faellig: import("@/lib/people/fristen.js").PersonalFrist[], onQuittiert: () => void}} props
 * @returns {React.ReactElement}
 */
export default function FristenLeiste({ faellig, onQuittiert }) {
  const { t } = useI18n();
  const [alleZeigen, setAlleZeigen] = React.useState(false);
  const [quittierendSchluessel, setQuittierendSchluessel] = React.useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  const sichtbar = alleZeigen ? faellig : faellig.slice(0, 5);

  const quittieren = async (/** @type {{art: string, bezug: {id: string}, faellig_am: string}} */ eintrag) => {
    const schluessel = `${eintrag.art}:${eintrag.bezug.id}:${eintrag.faellig_am}`;
    setQuittierendSchluessel(schluessel);
    setFehler(null);
    try {
      await /** @type {any} */ (bitApi.personal).Fristquittung.create({ schluessel, quittiert_am: heuteLokal() });
      onQuittiert();
    } catch (err) {
      setFehler(err?.message || String(err));
    } finally {
      setQuittierendSchluessel(null);
    }
  };

  if (faellig.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="fristenleiste-leer">{t("Keine fälligen Fristen.")}</p>;
  }

  return (
    <div data-testid="fristenleiste">
      <span role="status" className="sr-only">{faellig.length} {t("fällige Fristen")}</span>
      {fehler && <p role="alert" className="mb-2 text-xs text-rose-600">{fehler}</p>}
      <ul className="space-y-1.5">
        {sichtbar.map((eintrag) => {
          const schluessel = `${eintrag.art}:${eintrag.bezug.id}:${eintrag.faellig_am}`;
          return (
            <li key={schluessel} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link to={`/People${link(eintrag)}`} className="min-w-0 flex-1 text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
                {eintrag.ueberfaellig && (
                  <span className="mr-1.5 inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-800 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-100">
                    {t("überfällig")}
                  </span>
                )}
                {fuellen(t(eintrag.schluessel), eintrag.werte)} <span className="text-xs text-slate-500 dark:text-slate-400">({eintrag.norm}, {fmtDatum(eintrag.faellig_am)})</span>
              </Link>
              <button type="button" onClick={() => quittieren(eintrag)} disabled={quittierendSchluessel === schluessel}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                {t("Quittieren")}
              </button>
            </li>
          );
        })}
      </ul>
      {faellig.length > 5 && !alleZeigen && (
        <button type="button" onClick={() => setAlleZeigen(true)} className="mt-2 text-xs text-emerald-700 hover:underline dark:text-emerald-400">
          {t("alle anzeigen")}
        </button>
      )}
    </div>
  );
}
