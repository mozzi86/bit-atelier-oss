// Status badge of the accounting module (phase 79): text AND colour, never
// colour alone (a red dot means nothing to a screen reader or a colour-blind
// user). Knows the computed invoice states of grundlagen.rechnungsStatus; any
// other state can pass its own translated text.
//
// In:  status key, optional text. Out: a small inline badge.

import React from "react";
import { useI18n } from "@core/lib/i18n";

/** Colour classes per state (light and dark). */
const FARBEN = {
  geplant: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  entwurf: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  offen: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  teilbezahlt: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ueberfaellig: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  bezahlt: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  storniert: "bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400",
  warnung: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  fehler: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

/**
 * Text of a known invoice state (literal t() calls, so the i18n guard sees them).
 * @param {string} status
 * @param {(k: string) => string} t
 * @returns {string}
 */
function standardText(status, t) {
  switch (status) {
    case "geplant": return t("Geplant");
    case "entwurf": return t("Rechnungsentwurf");
    case "offen": return t("Offen");
    case "teilbezahlt": return t("Teilbezahlt");
    case "ueberfaellig": return t("Überfällig");
    case "bezahlt": return t("Bezahlt");
    case "storniert": return t("Storniert");
    default: return status;
  }
}

/**
 * @param {{status: string, text?: string}} props status: key (e.g. "ueberfaellig"); text: overrides the default text
 * @returns {React.ReactElement}
 */
export default function StatusMarke({ status, text }) {
  const { t } = useI18n();
  const farbe = /** @type {Record<string, string>} */ (FARBEN)[status] || FARBEN.entwurf;
  return (
    <span data-status={status} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${farbe}`}>
      {text || standardText(status, t)}
    </span>
  );
}
