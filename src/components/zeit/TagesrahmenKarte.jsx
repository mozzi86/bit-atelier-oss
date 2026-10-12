// Working-day frame of one person and day (phase 81-02, ZEIT-06, E-15): begin,
// end and break → entity Arbeitszeit (one per person and day), with the hints of
// the Working Hours Act shown in amber. Only when the rule zeit_honorar.tagesrahmen
// is on. The hints WARN only and never block saving — the app is no working-time
// record with legal review (src/lib/zeit/arbeitszeit.js says why).
//
// In:  props zh, zz, datum. Out: the card; saving writes one Arbeitszeit record.

import React from "react";
import { toast } from "sonner";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { plusTage } from "@core/lib/kalender/datum.js";
import { pruefeTagesrahmen } from "@/lib/zeit/arbeitszeit.js";
import { FELD, KARTE, LABEL, stundenText } from "./zeitGemeinsam.jsx";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung, datum: string}} props
 * @returns {React.ReactElement}
 */
export default function TagesrahmenKarte({ zh, zz, datum }) {
  const { t, lang } = useI18n();
  const zeilen = zh.daten.Arbeitszeit || [];
  const vorhanden = zeilen.find((a) => a.mitarbeiter_id === zz.personId && a.datum === datum) || null;
  const vortag = zeilen.find((a) => a.mitarbeiter_id === zz.personId && a.datum === plusTage(datum, -1)) || null;
  const [form, setForm] = React.useState({ beginn: "", ende: "", pause: "" });
  const [speichert, setSpeichert] = React.useState(false);

  // Follow the stored record when the person or the day changes.
  React.useEffect(() => {
    setForm({ beginn: vorhanden?.beginn || "", ende: vorhanden?.ende || "", pause: vorhanden ? String(vorhanden.pause_minuten ?? 0) : "" });
  }, [vorhanden?.id, vorhanden?.beginn, vorhanden?.ende, vorhanden?.pause_minuten, zz.personId, datum]);

  const projektMinuten = (zh.daten.Zeitbuchung || [])
    .filter((b) => b.mitarbeiter_id === zz.personId && b.datum === datum && b.status !== "abgelehnt")
    .reduce((s, b) => s + (Number(b.minuten) || 0), 0);
  const ausgefuellt = form.beginn && form.ende;
  const pruefung = ausgefuellt
    ? pruefeTagesrahmen({ beginn: form.beginn, ende: form.ende, pause_minuten: Number(form.pause) || 0 }, { vortagEnde: vortag?.ende ?? null, projektMinuten })
    : null;

  const speichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    if (!pruefung || pruefung.netto_minuten === null) return;
    setSpeichert(true);
    try {
      await zh.speichere("Arbeitszeit", {
        ...(vorhanden || {}), mitarbeiter_id: zz.personId, datum,
        beginn: form.beginn, ende: form.ende, pause_minuten: Number(form.pause) || 0, notiz: vorhanden?.notiz || "",
      });
      toast.success(t("Tagesrahmen gespeichert"));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <form className={KARTE} onSubmit={speichern} data-testid="zeit-tagesrahmen">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("Tagesrahmen")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="rahmen-beginn" className={LABEL}>{t("Beginn")}</label>
          <input id="rahmen-beginn" type="time" className={FELD} value={form.beginn} onChange={(e) => setForm((f) => ({ ...f, beginn: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="rahmen-ende" className={LABEL}>{t("Ende")}</label>
          <input id="rahmen-ende" type="time" className={FELD} value={form.ende} onChange={(e) => setForm((f) => ({ ...f, ende: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="rahmen-pause" className={LABEL}>{t("Pause (Minuten)")}</label>
          <input id="rahmen-pause" type="number" min="0" step="5" className={FELD} value={form.pause} onChange={(e) => setForm((f) => ({ ...f, pause: e.target.value }))} />
        </div>
      </div>
      {pruefung && pruefung.netto_minuten !== null && (
        <p className="text-sm text-slate-700 dark:text-slate-200">{t("Arbeitszeit netto")}: {stundenText(pruefung.netto_minuten, lang)} h · {t("Projektzeit")}: {stundenText(projektMinuten, lang) || "0"} h</p>
      )}
      {pruefung && pruefung.hinweise.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" data-testid="zeit-arbzg-hinweise">
          {pruefung.hinweise.map((h) => (
            <li key={h.regel}>{Object.entries(h.werte).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), t(h.text))}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("Hinweise, keine Rechtsprüfung.")}</p>
      <button type="submit" className={buttonVariants({ variant: "outline" })} disabled={speichert || !pruefung || pruefung.netto_minuten === null}>{t("Tagesrahmen speichern")}</button>
    </form>
  );
}
