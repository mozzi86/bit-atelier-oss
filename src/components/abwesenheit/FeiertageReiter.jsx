// Public holidays (phase 82, 82-04, ABW-02): the year from the calendar core
// with the office's one holiday setting (kalenderEinstellung of the rule
// group "Kalender & Abwesenheiten"), regional days marked, the municipality
// hint for Assumption Day, and the comparison with 81's calculation basis
// zeit_honorar.feiertage — a hint only, never changed silently (E-16: 13 days is
// a settable value). The switches live in Settings › Regelwerke (no own dialog).
//
// In:  props jahr, einst, kalkulationTage, onJahr. Out: the tab.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { feiertage } from "@core/lib/kalender/feiertage.js";
import { feiertagsAbgleich } from "@/lib/abwesenheit/kalenderRegeln.js";
import { feiertagLabel } from "@/lib/abwesenheit/feiertagNamen.js";

/** Names of regional holidays (calendar core, snake_case). */
const REGIONAL = new Set(["mariae_himmelfahrt", "augsburger_friedensfest"]);

/**
 * @param {{jahr: number, einst: {bundesland: string, mariae_himmelfahrt: boolean, augsburger_friedensfest: boolean}, kalkulationTage: number, onJahr: (j: number) => void}} props
 * @returns {React.ReactElement}
 */
export default function FeiertageReiter({ jahr, einst, kalkulationTage, onJahr }) {
  const { t, lang } = useI18n();
  const liste = feiertage(jahr, einst);
  const abgleich = feiertagsAbgleich(jahr, einst, kalkulationTage);
  const wochentag = (/** @type {string} */ d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : "de-DE", { weekday: "short", timeZone: "UTC" });
  return (
    <section className="space-y-3" data-testid="feiertage">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-700 dark:text-slate-200">{t("Jahr")}{" "}
          <select className="h-9 rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={jahr} onChange={(e) => onJahr(Number(e.target.value))}>
            {[jahr - 1, jahr, jahr + 1].map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </label>
        <Link className="text-xs underline text-emerald-800 dark:text-emerald-300" to="/Settings?tab=rules">{t("Feiertage einstellen")}</Link>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700" data-anzahl={liste.length}>
        {liste.map((f) => (
          <li key={f.datum} className="flex items-center justify-between px-3 py-1" data-feiertag={f.name}>
            <span><span className="tabular-nums">{f.datum}</span> <span className="text-slate-500">{wochentag(f.datum)}</span></span>
            <span>{t(feiertagLabel(f.name))}{REGIONAL.has(f.name) ? <span className="ml-1 rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{t("regional")}</span> : null}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600 dark:text-slate-300">{t("Mariä Himmelfahrt gilt nur in Gemeinden mit überwiegend katholischer Bevölkerung — Status der eigenen Gemeinde beim Bayerischen Landesamt für Statistik prüfen.")}</p>
      <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="feiertage-abgleich">
        {t("Kalender {jahr}: {n} Feiertage, davon {m} an Wochentagen · Kalkulationsbasis Kostensatz: {k} Tage")
          .replace("{jahr}", String(jahr)).replace("{n}", String(abgleich.kalender)).replace("{m}", String(abgleich.anWochentagen)).replace("{k}", String(abgleich.kalkulation))}
      </p>
      {abgleich.abweichend && <p role="status" className="text-xs text-amber-800 dark:text-amber-200" data-testid="feiertage-abweichung">{t("Kalkulationsbasis weicht vom Kalender ab — in Einstellungen › Regelwerke prüfen")}</p>}
    </section>
  );
}
