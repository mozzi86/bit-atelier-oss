// KammerFeld.jsx — Kammerdaten im Mitarbeiterformular (Plan 80-04, Task 6):
// Kammer, Fachrichtung, Mitgliedsnummer, eingetragen seit, bauvorlageberechtigt,
// Fortbildung je Jahr in Unterrichtseinheiten (UE). Reiner Anzeige-/Eingabe-
// Baustein, kein eigener Speicherzugriff — der Zustand lebt im Formular.
//
// Native <input>/<label> statt der shadcn-Wrapper (Input/Label): ihre
// forwardRef-Typisierung kostet unter der aktuellen React-Typkonfiguration
// einen tsc-Fehler je Aufrufstelle (CLAUDE.md "shadcn-tsc-Altlast").
//
// In:  {wert, onChange} — wert = Mitarbeiter.kammer (FELDER.kammer-Whitelist).
// Out: onChange(neuerWert).

import React from "react";
import { useI18n } from "@core/lib/i18n";

const EINGABE = "flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BESCHRIFTUNG = "text-sm font-medium leading-none text-slate-700 dark:text-slate-200";

/**
 * @param {{wert: {kammer?: string, fachrichtung?: string, mitgliedsnr?: string,
 *   eingetragen_seit?: string, bauvorlageberechtigt?: boolean, fortbildung?: Array<{jahr: number, ue: number}>},
 *   onChange: (neu: object) => void}} props
 * @returns {React.ReactElement}
 */
export default function KammerFeld({ wert = {}, onChange }) {
  const { t } = useI18n();
  const setzen = (feld, v) => onChange({ ...wert, [feld]: v });
  const fortbildung = Array.isArray(wert.fortbildung) ? wert.fortbildung : [];
  const jahr = new Date().getFullYear();
  const ueDiesesJahr = fortbildung.find((f) => f?.jahr === jahr)?.ue ?? 0;

  const setzeUe = (v) => {
    const zahl = Number(v);
    const rest = fortbildung.filter((f) => f?.jahr !== jahr);
    setzen("fortbildung", Number.isFinite(zahl) && zahl > 0 ? [...rest, { jahr, ue: zahl }] : rest);
  };

  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="col-span-full text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Kammer")}</legend>
      <div>
        <label htmlFor="mf-kammer-name" className={BESCHRIFTUNG}>{t("Kammer")}</label>
        <input id="mf-kammer-name" className={EINGABE} value={wert.kammer || ""} onChange={(e) => setzen("kammer", e.target.value)} placeholder="ByAK" />
      </div>
      <div>
        <label htmlFor="mf-kammer-fachrichtung" className={BESCHRIFTUNG}>{t("Fachrichtung")}</label>
        <input id="mf-kammer-fachrichtung" className={EINGABE} value={wert.fachrichtung || ""} onChange={(e) => setzen("fachrichtung", e.target.value)} />
      </div>
      <div>
        <label htmlFor="mf-kammer-mitgliedsnr" className={BESCHRIFTUNG}>{t("Mitgliedsnummer")}</label>
        <input id="mf-kammer-mitgliedsnr" className={EINGABE} value={wert.mitgliedsnr || ""} onChange={(e) => setzen("mitgliedsnr", e.target.value)} />
      </div>
      <div>
        <label htmlFor="mf-kammer-seit" className={BESCHRIFTUNG}>{t("Eingetragen seit")}</label>
        <input id="mf-kammer-seit" type="date" className={EINGABE} value={wert.eingetragen_seit || ""} onChange={(e) => setzen("eingetragen_seit", e.target.value)} />
      </div>
      <div className="flex items-center gap-2 pt-6">
        <input
          id="mf-kammer-bauvorlage"
          type="checkbox"
          checked={Boolean(wert.bauvorlageberechtigt)}
          onChange={(e) => setzen("bauvorlageberechtigt", e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        <label htmlFor="mf-kammer-bauvorlage" className={BESCHRIFTUNG}>{t("Bauvorlageberechtigt")}</label>
      </div>
      <div>
        <label htmlFor="mf-kammer-ue" className={BESCHRIFTUNG}>{t("Fortbildung dieses Jahr (UE)")}</label>
        <input id="mf-kammer-ue" type="number" min={0} className={EINGABE} value={ueDiesesJahr || ""} onChange={(e) => setzeUe(e.target.value)} />
      </div>
    </fieldset>
  );
}
