// Source filter of the deadline calendar (phase 82, 82-03): one switch per
// source — disabled with its reason when the source cannot deliver here
// (cloud lock E-03 without E-20, a missing module) instead of silently missing;
// the project filter (all / active project) and "nur Fristen"; the link to the
// rule book for lead times and warranty periods (E-16, only with the right to
// read the settings). The choice of sources is kept per device under
// `bit-atelier-fristen-quellen` (browser key registry of 80-05).
//
// In:  props status (quellenStatus), aktiv, onAktiv, projektfilter, onProjektfilter,
//      nurFristen, onNurFristen, hatProjekt, zeigeRegelLink. Out: the filter row;
//      ladeQuellenWahl/speichereQuellenWahl.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";

/** Browser key of the source choice (80-05 registry). */
export const QUELLEN_SCHLUESSEL = "bit-atelier-fristen-quellen";

/**
 * Stored source choice of this device, or null (then the defaults apply).
 * @returns {string[]|null}
 */
export function ladeQuellenWahl() {
  try {
    const roh = window.localStorage.getItem(QUELLEN_SCHLUESSEL);
    const liste = roh ? JSON.parse(roh) : null;
    return Array.isArray(liste) ? liste.filter((x) => typeof x === "string") : null;
  } catch {
    return null; // storage blocked or broken: defaults
  }
}

/**
 * Keeps the source choice on this device (silently skipped when storage is blocked).
 * @param {string[]} liste
 */
export function speichereQuellenWahl(liste) {
  try { window.localStorage.setItem(QUELLEN_SCHLUESSEL, JSON.stringify(liste)); } catch { /* storage blocked */ }
}

/**
 * @param {{
 *   status: Array<{key: string, label: string, ok: boolean, grund?: string}>, aktiv: Set<string>, onAktiv: (key: string, an: boolean) => void,
 *   projektfilter: 'alle'|'aktiv', onProjektfilter: (w: 'alle'|'aktiv') => void, nurFristen: boolean, onNurFristen: (an: boolean) => void,
 *   hatProjekt: boolean, zeigeRegelLink: boolean,
 * }} props
 * @returns {React.ReactElement}
 */
export default function QuellenFilter({ status, aktiv, onAktiv, projektfilter, onProjektfilter, nurFristen, onNurFristen, hatProjekt, zeigeRegelLink }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="quellen-filter">
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">{t("Quellen")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {status.map((q) => (
            <label key={q.key} className={`inline-flex items-center gap-1.5 ${q.ok ? "" : "text-slate-400"}`} title={q.ok ? undefined : t(q.grund || "")} data-quelle={q.key}>
              <input type="checkbox" checked={q.ok && aktiv.has(q.key)} disabled={!q.ok} onChange={(e) => onAktiv(q.key, e.target.checked)} />
              {t(q.label)}
              {!q.ok && <span className="text-xs">({t(q.grund || "")})</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="inline-flex items-center gap-1.5">
          <span>{t("Projekte")}</span>
          <select value={projektfilter} onChange={(e) => onProjektfilter(/** @type {any} */ (e.target.value))} className="h-8 rounded border border-slate-300 bg-white px-1 dark:border-slate-600 dark:bg-slate-900" data-testid="projektfilter">
            <option value="alle">{t("Alle Projekte")}</option>
            <option value="aktiv" disabled={!hatProjekt}>{t("Aktives Projekt")}</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={nurFristen} onChange={(e) => onNurFristen(e.target.checked)} data-testid="nur-fristen" /> {t("nur Fristen")}
        </label>
        {zeigeRegelLink && <Link to="/Settings?tab=rules" className="text-emerald-700 underline dark:text-emerald-300">{t("Vorlaufzeiten und Gewährleistungsfristen einstellen")}</Link>}
      </div>
    </div>
  );
}
