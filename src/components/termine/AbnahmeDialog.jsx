// Dialog "Abnahme erfassen" (phase 82, 82-03, FRIST-03): project, trade, date,
// the rule set as a MANDATORY choice without default (VOB/B · BGB · individual
// with years — a silently assumed VOB/B would remind a year too early, T-82-21),
// kind of work, maintenance contract, partial acceptance, own work (§ 650s),
// security and its return; a preview of the computed dates before saving.
// Unsaved input is protected (FormModal schuetzen).
//
// In:  props projekte, regelWert, onSpeichern(abnahme), onClose. Out: the dialog.

import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { ABNAHME_KATEGORIEN, ABNAHME_REGELN, SICHERHEIT_ARTEN } from "@core/lib/kalender/abnahme.js";
import { termineAusAbnahmen } from "@core/lib/kalender/gewaehrleistung.js";
import { TERMIN_ARTEN } from "@core/lib/kalender/termin.js";

/**
 * @param {{projekte: Array<{id: string, name?: string}>, regelWert: (id: string) => any, onSpeichern: (a: Record<string, any>) => Promise<void>, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
export default function AbnahmeDialog({ projekte, regelWert, onSpeichern, onClose }) {
  const { t } = useI18n();
  const [f, setF] = useState(/** @type {Record<string, any>} */ ({ project_id: projekte[0]?.id || "", gewerk: "", datum: "", regel: null, kategorie: "bauwerk", jahre: "", wartungsvertrag: false, teilabnahme: false, eigene_leistung: false, sicherheit_art: "keine", sicherheit_rueckgabe_am: "" }));
  const [busy, setBusy] = useState(false);
  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setF((x) => ({ ...x, [k]: v }));
  const vorschau = termineAusAbnahmen([{ ...f, id: "vorschau", jahre: f.jahre === "" ? null : Number(f.jahre) }], regelWert);
  const fertig = Boolean(f.regel && f.datum && f.project_id && f.gewerk.trim() && (f.regel !== "individuell" || Number(f.jahre) > 0));
  const speichern = async () => {
    setBusy(true);
    try {
      await onSpeichern({ ...f, gewerk: f.gewerk.trim(), jahre: f.jahre === "" ? null : Number(f.jahre), sicherheit_rueckgabe_am: f.sicherheit_rueckgabe_am || null });
    } finally {
      setBusy(false);
    }
  };
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  return (
    <FormModal title={t("Abnahme erfassen")} onClose={onClose} schuetzen>
      <div className="space-y-3 text-sm" data-testid="abnahme-dialog">
        <label className={feld}>{t("Projekt")}
          <select value={f.project_id} onChange={(e) => setze("project_id", e.target.value)} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900" data-testid="abnahme-projekt">
            {projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
          </select>
        </label>
        <label className={feld}>{t("Gewerk")}<Input value={f.gewerk} onChange={(e) => setze("gewerk", e.target.value)} data-testid="abnahme-gewerk" /></label>
        <label className={feld}>{t("Abnahmedatum")}<Input type="date" value={f.datum} onChange={(e) => setze("datum", e.target.value)} data-testid="abnahme-datum" /></label>
        <fieldset>
          <legend className="text-xs text-slate-600 dark:text-slate-300">{t("Regelwerk (Pflicht, keine Voreinstellung)")}</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {Object.entries(ABNAHME_REGELN).map(([k, v]) => (
              <label key={k} className="inline-flex items-center gap-1"><input type="radio" name="abnahme-regel" checked={f.regel === k} onChange={() => setze("regel", k)} data-regel={k} /> {t(v.label)}</label>
            ))}
          </div>
        </fieldset>
        {f.regel === "individuell" && <label className={feld}>{t("Jahre")}<Input inputMode="numeric" value={f.jahre} onChange={(e) => setze("jahre", e.target.value)} /></label>}
        <label className={feld}>{t("Kategorie")}
          <select value={f.kategorie} onChange={(e) => setze("kategorie", e.target.value)} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900" data-testid="abnahme-kategorie">
            {Object.entries(ABNAHME_KATEGORIEN).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.wartungsvertrag} onChange={(e) => setze("wartungsvertrag", e.target.checked)} /> {t("Wartungsvertrag")}</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.teilabnahme} onChange={(e) => setze("teilabnahme", e.target.checked)} /> {t("Teilabnahme")}</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.eigene_leistung} onChange={(e) => setze("eigene_leistung", e.target.checked)} /> {t("eigene Architektenleistung (§ 650s BGB)")}</label>
        </div>
        <label className={feld}>{t("Sicherheit")}
          <select value={f.sicherheit_art} onChange={(e) => setze("sicherheit_art", e.target.value)} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900">
            {Object.entries(SICHERHEIT_ARTEN).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
          </select>
        </label>
        {f.sicherheit_art !== "keine" && <label className={feld}>{t("Sicherheit zurückgegeben am")}<Input type="date" value={f.sicherheit_rueckgabe_am} onChange={(e) => setze("sicherheit_rueckgabe_am", e.target.value)} /></label>}
        <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800" data-testid="abnahme-vorschau">
          <p className="font-medium">{t("Vorschau")}</p>
          {vorschau.termine.length === 0 ? <p className="text-amber-800 dark:text-amber-200">{t(vorschau.warnungen[0]?.grund || "Regel fehlt")}</p> : (
            <ul>{vorschau.termine.map((x) => <li key={x.id}>{t(TERMIN_ARTEN[x.art]?.label || x.art)}: {x.datum}{x.herkunft ? ` · ${x.herkunft}` : ""}</li>)}</ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("Abbrechen")}</Button>
          <Button type="button" disabled={!fertig || busy} onClick={speichern} data-testid="abnahme-speichern">{t("Speichern")}</Button>
        </div>
      </div>
    </FormModal>
  );
}
