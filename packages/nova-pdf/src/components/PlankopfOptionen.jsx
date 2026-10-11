// 90-01: options of the PDF-studio tool "Plankopf setzen" — mode (normal / neutral tender
// attachment), the title-block fields prefilled from the current project and the office
// profile (useBriefkopf, the ONE letterhead editor), page selection and the cover size of the
// old title block. Pure form: the parent (PdfToolsGrid ToolDialog) runs plankopfAufPdf with
// what this component reports through onChange. All strings through t() (i18n part file
// i18nTeile/pdf-plankopf.js).
//
// In:  project (or null), wert (current options), onChange(neuerWert).
// Out: rendered form; data-testids pk-modus / pk-feld-<key> / pk-seiten / pk-abdeckung-h / pk-rastern.
// The rows drawn on the PDF come from plankopfZeilenFuer() — the dialog calls it with the
// same inputs at run time, so form and PDF cannot drift apart.
import React, { useMemo } from "react";
import { useI18n } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf";
import { PLANKOPF_FELDER, PLANKOPF_MASSE, plankopfZeilen } from "@pdf/lib/plankopf";

/**
 * @typedef {object} PlankopfWert
 * @property {boolean} neutral neutral tender attachment (cover old block, no office fields)
 * @property {Record<string, string>} eingaben user values per field key (missing = prefill)
 * @property {string} seiten page ranges ("" = all pages), same syntax as the other tools
 * @property {number} abdeckH_mm height of the cover over the old title block, mm (neutral only)
 * @property {boolean} rastern neutral only: re-raster every page after covering — the white cover is
 *   only visual, the old block's text stays extractable in the PDF until the page is rasterised
 */

/** Initial options of the tool. @returns {PlankopfWert} */
export function plankopfStart() {
  return { neutral: false, eingaben: {}, seiten: "", abdeckH_mm: PLANKOPF_MASSE.abdeckH_mm, rastern: true };
}

/**
 * Rows to draw for the given options — neutral mode never receives the office profile.
 * @param {any} project
 * @param {{office: string, tagline: string, address: string, contact: string}} briefkopf office profile
 * @param {PlankopfWert} wert
 * @returns {Array<{key: string, label: string, wert: string}>}
 */
export function plankopfZeilenFuer(project, briefkopf, wert) {
  return plankopfZeilen({ projekt: project, buero: wert.neutral ? null : briefkopf, eingaben: wert.eingaben, neutral: wert.neutral });
}

const EINGABE = "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";

/**
 * @param {{project: any, wert: PlankopfWert, onChange: (w: PlankopfWert) => void}} props
 */
export default function PlankopfOptionen({ project, wert, onChange }) {
  const { t } = useI18n();
  const { briefkopf } = useBriefkopf();
  const zeilen = useMemo(() => plankopfZeilenFuer(project, briefkopf, wert), [project, briefkopf, wert]);

  const setze = (patch) => onChange({ ...wert, ...patch });
  const feld = (key, v) => setze({ eingaben: { ...wert.eingaben, [key]: v } });
  const pflicht = new Set(PLANKOPF_FELDER.filter((f) => f.pflicht).map((f) => f.key));

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t("Art des Plankopfs")} data-testid="pk-modus" data-neutral={wert.neutral ? "1" : "0"}>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="pk-modus" checked={!wert.neutral} onChange={() => setze({ neutral: false })} />
          {t("Plankopf (mit Planverfasser)")}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="pk-modus" checked={wert.neutral} onChange={() => setze({ neutral: true })} />
          {t("Anlagen-Plankopf neutral (für LV/Ausschreibung)")}
        </label>
      </div>
      {wert.neutral && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
          {t("Der alte Plankopf unten rechts wird weiß abgedeckt; Büroname, Adresse, Kontakt und Unterschrift entfallen.")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {zeilen.map((z) => (
          <label key={z.key} className="space-y-0.5">
            <span className="text-slate-500">{t(z.label)}{pflicht.has(z.key) ? " *" : ""}</span>
            <input className={EINGABE} value={z.wert} onChange={(e) => feld(z.key, e.target.value)} data-testid={`pk-feld-${z.key}`} />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-slate-500">{t("Seiten (leer = alle, z. B. 1-3,5)")}</span>
          <input className={EINGABE} value={wert.seiten} onChange={(e) => setze({ seiten: e.target.value })} data-testid="pk-seiten" />
        </label>
        {wert.neutral && (
          <label className="space-y-0.5">
            <span className="text-slate-500">{t("Abdeckung alter Plankopf, Höhe in mm")}</span>
            <input type="number" min="0" max="400" className={EINGABE} value={wert.abdeckH_mm}
              onChange={(e) => setze({ abdeckH_mm: Math.max(0, Math.min(400, Number(e.target.value) || 0)) })} data-testid="pk-abdeckung-h" />
          </label>
        )}
      </div>
      {wert.neutral && (
        <label className="flex items-start gap-1.5 text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={wert.rastern !== false} onChange={(e) => setze({ rastern: e.target.checked })} data-testid="pk-rastern" />
          <span>{t("Alten Plankopf endgültig entfernen (Seiten neu rastern — der abgedeckte Text ist sonst im PDF noch auslesbar; Text danach nicht mehr durchsuchbar)")}</span>
        </label>
      )}
      {!wert.neutral && !briefkopf.office && (
        <p className="text-slate-500">{t("Planverfasser leer: Büroname im Büroprofil (Einstellungen › Büro) eintragen.")}</p>
      )}
    </div>
  );
}
