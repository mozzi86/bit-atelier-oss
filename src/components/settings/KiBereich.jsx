// Settings area "KI-Verbindungen" (key `ai`, 80-03: D-P80-12, DEMO-JOURNEY-08).
// The AI centre's own "Verbindungen" tab (src/pages/AIDashboard.jsx) keeps only a
// link-only card, so a bookmark or the AI assistant button still finds its way
// here. Two places would drift (CLAUDE.md: kein zweiter Editor) — LlmConnections
// itself moved, only its DOCKING POINT changed.
//
// In:  props {kontext} (unused since 83-02 — the demo branch is gone; the prop
//      stays part of the area contract of src/components/settings/index.js).
// Out: BEREIT = true, the area.

import React from "react";
import { Plug } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import LlmConnections from "@/components/ai/LlmConnections.jsx";
import { HARNESS_URL } from "@/lib/harnessClient.js";

/** Ready since 80-03. */
export const BEREIT = true;

/**
 * @returns {React.ReactElement}
 */
export default function KiBereich() {
  const { t } = useI18n();

  return (
    <section aria-labelledby="bereich-ki" data-testid="bereich-ai" className="space-y-4">
      <h2 id="bereich-ki" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <Plug className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("KI-Verbindungen")}
      </h2>

      <LlmConnections />
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        <p className="font-medium text-slate-700 dark:text-slate-200">{t("Atelier-KI-Harness (lokal)")}</p>
        <p className="mt-1">
          {t("Dienst")}: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">{HARNESS_URL}</code>
          {" · "}
          {t("Konfiguration")}: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">harness/config.yaml</code>
        </p>
        <p className="mt-1">
          <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">python -m harness doctor</code>
          {" · "}
          <Link to="/KiTool" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">{t("Zum KI-Tool")}</Link>
        </p>
      </div>
    </section>
  );
}
