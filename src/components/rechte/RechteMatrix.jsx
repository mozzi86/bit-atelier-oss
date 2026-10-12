// Rights matrix (phase 82, 82-02, RECHT-04): role × module with aus/lesen/voll.
// The standard matrix is fixed (rechte.js); the Setting `rechte` stores only the
// deviations, always cleaned by bereinigeUeberschreibungen (floors: the owner
// keeps settings and rights; an employee never gets personnel, accounting, cost
// rates or the approval; existing modules know only aus/voll). Floor cells are
// disabled and say why. Project view per role: assigned or all projects.
//
// In:  props einstellung (Setting value), onSpeichern, darfBearbeiten. Out: the matrix.

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { BESTANDSMODULE, bereinigeUeberschreibungen, MODUL_LABELS, MODULE, ROLLEN, ROLLEN_LABELS, STANDARD_MATRIX, STUFEN, STUFEN_LABELS, matrixFuer } from "@core/lib/rechte.js";

/** Modules an employee never gets (mirror of the floor in rechte.js, for the reason text). */
const NIE_MITARBEITER = Object.freeze(["personal", "buchhaltung", "kostensatz", "zeiterfassung:freigabe"]);

/**
 * Reason a cell is locked by a floor, or null.
 * @param {string} rolle
 * @param {string} modul
 * @returns {string|null} German i18n key
 */
export function bodenGrund(rolle, modul) {
  if (rolle === "inhaber" && (modul === "einstellungen" || modul === "rechte")) return "Der Inhaber behält Einstellungen und Rechte.";
  if (rolle === "mitarbeiter" && NIE_MITARBEITER.includes(modul)) return "Mitarbeiter/innen sehen nie Personal, Buchhaltung, Kostensätze oder die Freigabe.";
  return null;
}

/**
 * @param {{einstellung: Record<string, any>|null, darfBearbeiten: boolean, onSpeichern: (wert: Record<string, any>) => Promise<boolean>}} props
 * @returns {React.ReactElement}
 */
export default function RechteMatrix({ einstellung, darfBearbeiten, onSpeichern }) {
  const { t } = useI18n();
  const [entwurf, setEntwurf] = useState(() => bereinigeUeberschreibungen(einstellung));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEntwurf(bereinigeUeberschreibungen(einstellung)); }, [einstellung]);
  const stufen = useMemo(() => Object.fromEntries(ROLLEN.map((r) => [r, matrixFuer(r, entwurf)])), [entwurf]);

  const setze = (/** @type {string} */ rolle, /** @type {string} */ modul, /** @type {string} */ stufe) => setEntwurf((e) => {
    const ueber = { ...e.ueberschreibungen, [rolle]: { ...(e.ueberschreibungen[rolle] || {}) } };
    if (STANDARD_MATRIX[/** @type {keyof typeof STANDARD_MATRIX} */ (rolle)]?.[/** @type {never} */ (modul)] === stufe) delete ueber[rolle][modul];
    else ueber[rolle][modul] = /** @type {any} */ (stufe);
    return bereinigeUeberschreibungen({ ...e, ueberschreibungen: ueber });
  });
  const sicht = (/** @type {string} */ rolle, /** @type {string} */ wert) => setEntwurf((e) => bereinigeUeberschreibungen({ ...e, projektsicht: { ...e.projektsicht, [rolle]: wert } }));
  const speichern = async () => { setBusy(true); try { await onSpeichern(bereinigeUeberschreibungen(entwurf)); } finally { setBusy(false); } };

  const auswahl = "h-8 rounded border border-slate-300 bg-white px-1 text-xs dark:border-slate-600 dark:bg-slate-900";
  return (
    <section className="space-y-2" data-testid="rechte-matrix">
      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t("Rechte je Rolle")}</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("Rechte je Rolle")}</caption>
          <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            <tr><th scope="col" className="px-2 py-1">{t("Modul")}</th>{ROLLEN.map((r) => <th key={r} scope="col" className="px-2 py-1">{t(ROLLEN_LABELS[r])}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {MODULE.map((m) => (
              <tr key={m}>
                <th scope="row" className="px-2 py-1 text-left font-normal">{t(/** @type {Record<string, string>} */ (MODUL_LABELS)[m])}</th>
                {ROLLEN.map((r) => {
                  const grund = bodenGrund(r, m);
                  const optionen = BESTANDSMODULE.includes(m) ? ["aus", "voll"] : STUFEN;
                  return (
                    <td key={r} className="px-2 py-1">
                      <select className={auswahl} value={stufen[r][m]} disabled={!darfBearbeiten || Boolean(grund)} title={grund ? t(grund) : undefined}
                        aria-label={`${t(/** @type {Record<string, string>} */ (MODUL_LABELS)[m])} – ${t(ROLLEN_LABELS[r])}`} data-zelle={`${r}:${m}`}
                        onChange={(e) => setze(r, m, e.target.value)}>
                        {optionen.map((s) => <option key={s} value={s}>{t(/** @type {Record<string, string>} */ (STUFEN_LABELS)[s])}</option>)}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-2 py-1 text-left font-normal">{t("Projektsicht")}</th>
              {ROLLEN.map((r) => (
                <td key={r} className="px-2 py-1">
                  <select className={auswahl} disabled={!darfBearbeiten || r === "inhaber"} aria-label={`${t("Projektsicht")} – ${t(ROLLEN_LABELS[r])}`}
                    value={entwurf.projektsicht[r] || (r === "inhaber" || r === "buchhaltung" ? "alle" : "zuordnung")} onChange={(e) => sicht(r, e.target.value)}>
                    <option value="zuordnung">{t("nur zugeordnete")}</option>
                    <option value="alle">{t("alle Projekte")}</option>
                  </select>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {darfBearbeiten && (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={speichern} data-testid="rechte-speichern">{t("Speichern")}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEntwurf(bereinigeUeberschreibungen(null))}>{t("Auf Standard zurücksetzen")}</Button>
        </div>
      )}
    </section>
  );
}
