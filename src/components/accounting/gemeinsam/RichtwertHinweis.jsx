// Standing notice of the accounting module (phase 79): the numbers are guideline
// values, not tax advice, and the browser storage is no GoBD-certified archive.
// A liability statement, shown on every tab of /Accounting (79-RESEARCH risk 13).
//
// In:  nothing. Out: one quiet line.

import React from "react";
import { Info } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

/** @returns {React.ReactElement} */
export default function RichtwertHinweis() {
  const { t } = useI18n();
  return (
    <p data-testid="richtwert-hinweis" className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      <span>{t("Richtwerte, keine Steuerberatung · kein GoBD-zertifiziertes Archiv")}</span>
    </p>
  );
}
