// Dialog for a manual term (phase 82, 82-03): title, date, time, duration,
// project, kind (appointment/deadline), type (regular meeting, inspection,
// building permit, other), repetition (weekly, fortnightly, monthly up to a
// date). For a building permit it offers the validity end "approval + 4 years"
// as a suggestion (BayBO Art. 69, guide value — to be checked). Deleting asks
// first (useBestaetigung). Unsaved input is protected.
//
// In:  props termin (stored record or null), projekte, onSpeichern, onLoeschen, onClose. Out: the dialog.

import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { plusJahre } from "@core/lib/kalender/datum.js";

/** Types of a manual term (German labels = i18n keys). */
const TERMINARTEN = [["sonstiges", "Sonstiges"], ["jour_fixe", "Jour fixe"], ["begehung", "Begehung"], ["baugenehmigung", "Baugenehmigung"]];
/** Repetitions. */
const RHYTHMEN = [["", "keine"], ["woechentlich", "wöchentlich"], ["zweiwoechentlich", "zweiwöchentlich"], ["monatlich", "monatlich"]];

/**
 * @param {{termin: Record<string, any>|null, projekte: Array<{id: string, name?: string}>, heute: string,
 *   onSpeichern: (t: Record<string, any>) => Promise<void>, onLoeschen: (id: string) => Promise<void>, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
export default function TerminDialog({ termin, projekte, heute, onSpeichern, onLoeschen, onClose }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [f, setF] = useState(/** @type {Record<string, any>} */ ({
    titel: termin?.titel || "", datum: termin?.datum || heute, zeit: termin?.zeit || "", dauer_min: termin?.dauer_min ?? "",
    project_id: termin?.project_id || "", art: termin?.art || "termin", terminart: termin?.terminart || "sonstiges",
    rhythmus: termin?.wiederholung?.rhythmus || "", wiederholung_bis: termin?.wiederholung?.bis || "", genehmigt_am: "", notiz: termin?.notiz || "",
  }));
  const [busy, setBusy] = useState(false);
  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setF((x) => ({ ...x, [k]: v }));
  const fertig = f.titel.trim() && /^\d{4}-\d{2}-\d{2}$/.test(f.datum) && (!f.rhythmus || /^\d{4}-\d{2}-\d{2}$/.test(f.wiederholung_bis));
  const speichern = async () => {
    setBusy(true);
    try {
      await onSpeichern({
        ...(termin?.id ? { id: termin.id } : {}),
        titel: f.titel.trim(), datum: f.datum, zeit: f.zeit || null, dauer_min: f.dauer_min === "" ? null : Number(f.dauer_min),
        project_id: f.project_id || null, art: f.art, terminart: f.terminart, notiz: f.notiz,
        wiederholung: f.rhythmus ? { rhythmus: f.rhythmus, bis: f.wiederholung_bis } : null,
      });
    } finally {
      setBusy(false);
    }
  };
  const loeschen = async () => {
    if (!termin?.id) return;
    if (await bestaetige({ titel: t("Termin löschen?"), text: f.titel, bestaetigen: t("Löschen"), gefahr: true })) await onLoeschen(termin.id);
  };
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  const auswahl = "mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900";
  return (
    <FormModal title={termin?.id ? t("Termin bearbeiten") : t("Termin anlegen")} onClose={onClose} schuetzen>
      <div className="space-y-3 text-sm" data-testid="termin-dialog">
        <label className={feld}>{t("Titel")}<Input value={f.titel} onChange={(e) => setze("titel", e.target.value)} data-testid="termin-titel" /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className={feld}>{t("Datum")}<Input type="date" value={f.datum} onChange={(e) => setze("datum", e.target.value)} data-testid="termin-datum" /></label>
          <label className={feld}>{t("Uhrzeit")}<Input type="time" value={f.zeit} onChange={(e) => setze("zeit", e.target.value)} /></label>
          <label className={feld}>{t("Dauer (Minuten)")}<Input inputMode="numeric" value={f.dauer_min} onChange={(e) => setze("dauer_min", e.target.value)} /></label>
        </div>
        <label className={feld}>{t("Projekt")}
          <select value={f.project_id} onChange={(e) => setze("project_id", e.target.value)} className={auswahl}>
            <option value="">{t("ohne Projekt")}</option>
            {projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
          </select>
        </label>
        <fieldset className="flex gap-4">
          <legend className="sr-only">{t("Art")}</legend>
          <label className="inline-flex items-center gap-1"><input type="radio" name="termin-art" checked={f.art === "termin"} onChange={() => setze("art", "termin")} /> {t("Termin")}</label>
          <label className="inline-flex items-center gap-1"><input type="radio" name="termin-art" checked={f.art === "frist"} onChange={() => setze("art", "frist")} data-testid="termin-art-frist" /> {t("Frist")}</label>
        </fieldset>
        <label className={feld}>{t("Terminart")}
          <select value={f.terminart} onChange={(e) => setze("terminart", e.target.value)} className={auswahl}>
            {TERMINARTEN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </label>
        {f.terminart === "baugenehmigung" && (
          <div className="flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2 dark:bg-slate-800">
            <label className={feld}>{t("Genehmigt am")}<Input type="date" value={f.genehmigt_am} onChange={(e) => setze("genehmigt_am", e.target.value)} /></label>
            <Button type="button" size="sm" variant="outline" disabled={!f.genehmigt_am} onClick={() => { setze("datum", plusJahre(f.genehmigt_am, 4) || f.datum); setze("art", "frist"); }}>
              {t("Geltungsdauer ab Genehmigungsdatum + 4 Jahre (BayBO Art. 69, Richtwert – prüfen)")}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className={feld}>{t("Wiederholung")}
            <select value={f.rhythmus} onChange={(e) => setze("rhythmus", e.target.value)} className={auswahl}>
              {RHYTHMEN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </label>
          {f.rhythmus && <label className={feld}>{t("bis")}<Input type="date" value={f.wiederholung_bis} onChange={(e) => setze("wiederholung_bis", e.target.value)} /></label>}
        </div>
        <label className={feld}>{t("Notiz")}<Input value={f.notiz} onChange={(e) => setze("notiz", e.target.value)} /></label>
        <div className="flex justify-between gap-2">
          {termin?.id ? <Button type="button" variant="outline" onClick={loeschen}>{t("Löschen")}</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("Abbrechen")}</Button>
            <Button type="button" disabled={!fertig || busy} onClick={speichern} data-testid="termin-speichern">{t("Speichern")}</Button>
          </div>
        </div>
      </div>
    </FormModal>
  );
}
