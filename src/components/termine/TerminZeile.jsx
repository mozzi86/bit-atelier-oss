// One row of the agenda (phase 82, 82-03): weekday and date, time, title
// (translated kind + data name), project, due chip from faelligkeit, the norm
// or rule the date comes from, a "Richtwert" badge for assumed dates, and the
// actions "Erledigt" and "Öffnen". Keyboard-operable buttons with accessible names.
//
// In:  props termin, heute, vorlauf (lead times per class), projektName,
//      onErledigt, onOeffnen, onBearbeiten (manual terms). Out: the row.

import React from "react";
import { Check, ExternalLink, Pencil } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { faelligkeit } from "@core/lib/kalender/fristen.js";
import { TERMIN_ARTEN } from "@core/lib/kalender/termin.js";

/** Fills {key} placeholders after translation. */
const fuellen = (/** @type {string} */ text, /** @type {Record<string, any>} */ werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

/**
 * Translated title of a term: kind label + data name.
 * @param {(k: string) => string} t
 * @param {import("@core/lib/kalender/termin.js").Termin} termin
 * @returns {string}
 */
export function terminTitel(t, termin) {
  const art = TERMIN_ARTEN[termin.art]?.label;
  return [art ? t(art) : "", termin.objekt].filter(Boolean).join(" · ");
}

/** Colour of the due chip per status. */
const CHIP = {
  ueberfaellig: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  heute: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  faellig: "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200",
  geplant: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  erledigt: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  vergangen: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/**
 * @param {{
 *   termin: import("@core/lib/kalender/termin.js").Termin, heute: string, vorlauf: Record<string, number[]>,
 *   projektName?: string|null, onErledigt: (t: any) => void, onOeffnen: (t: any) => void, onBearbeiten?: ((t: any) => void)|null,
 * }} props
 * @returns {React.ReactElement}
 */
export default function TerminZeile({ termin, heute, vorlauf, projektName, onErledigt, onOeffnen, onBearbeiten }) {
  const { t, lang } = useI18n();
  const f = faelligkeit(termin, heute, vorlauf[termin.klasse] || []);
  const datum = new Date(`${termin.datum}T12:00:00Z`);
  const ort = lang === "en" ? "en-GB" : "de-DE";
  const wochentag = datum.toLocaleDateString(ort, { weekday: "short", timeZone: "UTC" });
  const tagMonat = datum.toLocaleDateString(ort, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const titel = terminTitel(t, termin);
  let chip = "";
  if (f?.status === "ueberfaellig") chip = fuellen(t("{n} Tage überfällig"), { n: -f.tage });
  else if (f?.status === "heute") chip = t("heute");
  else if (f?.status === "faellig") chip = fuellen(t("in {n} Tagen"), { n: f.tage });
  else if (f?.status === "erledigt") chip = t("erledigt");
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2" data-testid="termin-zeile" data-termin={termin.id} data-quelle={termin.quelle}>
      <div className="w-24 shrink-0 text-sm tabular-nums text-slate-700 dark:text-slate-200">
        <span className="font-medium">{wochentag} {tagMonat}</span>
        {termin.zeit && <span className="block text-xs text-slate-500">{termin.zeit}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${termin.erledigt ? "line-through text-slate-500" : "text-slate-800 dark:text-slate-100"}`}>{titel}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {projektName && <span>{projektName}</span>}
          {termin.herkunft && <span>{projektName ? " · " : ""}{termin.herkunft}</span>}
          {termin.annahme && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{t("Richtwert")}</span>}
          {termin.info && <span className="block">{t(termin.info)}</span>}
        </p>
      </div>
      {chip && f && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[f.status] || CHIP.geplant}`} data-testid="termin-faelligkeit">{chip}</span>}
      <div className="flex gap-1">
        {onBearbeiten && termin.datensatz_id && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onBearbeiten(termin)} aria-label={fuellen(t("Bearbeiten: {titel}"), { titel })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
        )}
        {!termin.erledigt && (
          <Button type="button" size="sm" variant="outline" onClick={() => onErledigt(termin)} aria-label={fuellen(t("Erledigt: {titel}"), { titel })}>
            <Check className="h-4 w-4" aria-hidden="true" /> {t("Erledigt")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => onOeffnen(termin)} aria-label={fuellen(t("Öffnen: {titel}"), { titel })}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> {t("Öffnen")}
        </Button>
      </div>
    </li>
  );
}
