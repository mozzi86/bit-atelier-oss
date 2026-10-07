// LoeschfristHinweis.jsx — Chip mit der DSGVO-Löschfrist einer Bewerbung
// (Plan 80-08, Task 4, DS-13): "Löschung in N Tagen", "Löschung fällig"
// (≤ 14 Tage) oder "Löschung überfällig", mit dem Datum im `title`.
//
// In:  {bewerbung, regelWert, heute}. Out: UI, keine Schreibvorgänge.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { tageZwischen } from "@core/lib/kalender/datum.js";
import { loeschenAb } from "@/lib/people/bewerbung.js";

/** Tage-Schwelle, ab der die Frist als "fällig" statt nur "in N Tagen" gilt (Bürostandard, wie vorlauf_bewerbung_loeschen). */
const FAELLIG_SCHWELLE_TAGE = 14;

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}
/** @param {string} iso @returns {string} */
const fmtDatum = (iso) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

/**
 * @param {{bewerbung: object, regelWert: (id: string) => any, heute: string}} props
 * @returns {React.ReactElement|null} null solange die Bewerbung offen ist (keine Löschfrist)
 */
export default function LoeschfristHinweis({ bewerbung, regelWert, heute }) {
  const { t } = useI18n();
  const faelligAm = loeschenAb(bewerbung, regelWert);
  if (!faelligAm) return null;

  const tageBis = tageZwischen(heute, faelligAm) ?? 0;
  const ueberfaellig = tageBis < 0;
  const faellig = !ueberfaellig && tageBis <= FAELLIG_SCHWELLE_TAGE;

  const text = ueberfaellig ? t("Löschung überfällig") : faellig ? t("Löschung fällig") : fuellen(t("Löschung in {n} Tagen"), { n: tageBis });
  const farbe = ueberfaellig
    ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-100"
    : faellig
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
      : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

  return (
    <span data-testid="loeschfrist-hinweis" title={fmtDatum(faelligAm)}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${farbe}`}>
      {text}
    </span>
  );
}
