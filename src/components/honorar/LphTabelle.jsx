// Work stages of a fee offer/contract (phase 81-03): one row per stage of the
// service profile (count and percentages from 79's registry, E-13) with the
// "beauftragt" checkbox, plus presets "LPH 1–4", "LPH 1–8", "alle" for profiles
// with nine stages. The percentages are the table's — the stored `lph[i].prozent`
// is kept as it is (79 field).
//
// In:  props wert ({leistungsbild, lph}), onChange(patch), idPraefix. Out: the table.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { buttonVariants } from "@core/components/ui/button";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";

/**
 * @param {{wert: Record<string, any>, onChange: (patch: Record<string, any>) => void, idPraefix: string}} props
 * @returns {React.ReactElement}
 */
export default function LphTabelle({ wert, onChange, idPraefix }) {
  const { t } = useI18n();
  const info = leistungsbildInfo(wert.leistungsbild);
  const stufen = info?.lph?.length ? info.lph : Array.from({ length: (wert.lph || []).length || 9 }, (_, i) => ({ nr: i + 1, bezeichnung: "", prozent: wert.lph?.[i]?.prozent ?? 0 }));
  const lph = Array.isArray(wert.lph) && wert.lph.length === stufen.length ? wert.lph : lphFuerLeistungsbild(wert.leistungsbild);
  const setze = (/** @type {(i: number) => boolean} */ regel) => onChange({ lph: lph.map((l, i) => ({ ...l, beauftragt: regel(i) })) });
  const summe = lph.reduce((s, l) => s + (l.beauftragt ? Number(l.prozent) || 0 : 0), 0);

  return (
    <fieldset className="space-y-2" data-testid="lph-tabelle">
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Leistungsphasen")}</legend>
      {stufen.length === 9 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setze((i) => i < 4)}>{t("LPH 1–4")}</button>
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setze((i) => i < 8)}>{t("LPH 1–8")}</button>
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setze(() => true)}>{t("alle")}</button>
        </div>
      )}
      <ul className="grid gap-1 sm:grid-cols-2">
        {stufen.map((s, i) => (
          <li key={s.nr} className="flex items-center gap-2 text-sm">
            <input id={`${idPraefix}-lph-${s.nr}`} type="checkbox" checked={lph[i]?.beauftragt === true}
              onChange={(e) => onChange({ lph: lph.map((l, k) => (k === i ? { ...l, beauftragt: e.target.checked } : l)) })} />
            <label htmlFor={`${idPraefix}-lph-${s.nr}`} className="text-slate-700 dark:text-slate-200">
              {t("LPH")} {s.nr} {s.bezeichnung} <span className="text-slate-500">({lph[i]?.prozent ?? s.prozent} %)</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600 dark:text-slate-300">{t("Beauftragt: {p} % der Leistungen").replace("{p}", String(Math.round(summe * 100) / 100).replace(".", ","))}</p>
    </fieldset>
  );
}
