// Search box above the /Settings tabs (80-03, KRITIK-05/A11Y-I18N-22): finds a
// settings area OR a single rule and jumps straight to it. A jump carries
// `location.state.sprung`, which Settings.jsx reads to move the focus onto the
// target panel's first control (behavior 16) — a plain tab click needs none of
// this, Radix already keeps the roving tab-list focus there.
//
// In:  the current settings context (area and rule-book visibility) — area
//      readiness comes from src/components/settings/index.js (BEREICH_KOMPONENTEN),
//      read here so a hidden or not-yet-built area never appears as a result.
// Out: the search box + result list; navigates via react-router.

import React from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { sucheEinstellungen, suchUmfang } from "@/lib/settings/suche.js";
import { sichtbareBereiche } from "@/lib/settings/bereiche.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { BEREICH_KOMPONENTEN } from "@/components/settings/index.js";

/**
 * @param {{kontext?: import("@/lib/settings/bereiche.js").EinstellungsKontext}} props
 * @returns {React.ReactElement}
 */
export default function EinstellungsSuche({ kontext }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [text, setText] = React.useState("");

  const treffer = React.useMemo(() => {
    // Same scope as the tab list of Settings.jsx: visible in this context AND ready.
    const umfang = suchUmfang(sichtbareBereiche(kontext), (key) => Boolean(BEREICH_KOMPONENTEN[key]?.BEREIT), REGELWERKE);
    return sucheEinstellungen(text, { ...umfang, kontext, uebersetzen: t });
  }, [text, kontext, t]);

  /** @param {{bereich: string, regelId?: string}} eintrag */
  const zielVon = (eintrag) => (eintrag.regelId
    ? `/Settings?tab=rules&einstellung=${encodeURIComponent(eintrag.regelId)}`
    : `/Settings?tab=${eintrag.bereich}`);

  /** @param {{bereich: string, regelId?: string}} eintrag */
  const waehle = (eintrag) => {
    setText("");
    navigate(zielVon(eintrag), { state: { sprung: true } });
  };

  /** @param {React.KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === "Enter" && treffer[0]) { e.preventDefault(); waehle(treffer[0]); }
  };

  return (
    <div className="max-w-md">
      <label className="block">
        <span className="text-xs text-slate-500 dark:text-slate-400">{t("Einstellung suchen")}</span>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("z. B. Briefkopf, Mindestlohn, Zahlungsziel …")}
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-2.5 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </label>
      <span role="status" className="sr-only">
        {text ? t("{n} Treffer").replace("{n}", String(treffer.length)) : ""}
      </span>
      {text && treffer.length > 0 && (
        <ul className="mt-1 space-y-0.5 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {treffer.map((eintrag, i) => (
            <li key={`${eintrag.bereich}-${eintrag.regelId || i}`}>
              <button
                type="button"
                onClick={() => waehle(eintrag)}
                className="block w-full rounded-md px-2 py-1 text-left text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t(eintrag.titel)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {text && treffer.length === 0 && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("Keine Treffer.")}</p>
      )}
    </div>
  );
}
