// Absence request (phase 82, 82-04, ABW-01): three required inputs — period,
// kind, stand-in — plus optional half days. A note field exists only for leave,
// training, special leave and overtime compensation; for "krank" and
// "abwesend" there is none (E-14 — a sick child is recorded as "abwesend"
// without reason, there is no kind for it). Before saving the dialog shows the
// working days and every conflict warning with its reason; saving stays
// possible (warnings only, D-P82-13). Sickness and "abwesend" are recorded
// directly (owner/bookkeeping or the person herself), leave starts as a request.
// Unsaved input is protected (FormModal).
//
// In:  props (see JSDoc). Out: the dialog.

import React, { useMemo, useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { ABWESENHEIT_ARTEN, direktErfassbar, konflikte, normalisiereAbwesenheit } from "@/lib/abwesenheit/abwesenheit.js";

/**
 * @param {{
 *   personen: Array<{id: string, kuerzel: string, name: string}>, eigeneId: string|null, nurEigene: boolean, darfBetriebsruhe: boolean,
 *   abwesenheiten: any[], heute: string, maxGleichzeitig: number,
 *   tageFuer: (a: Record<string, any>) => number, restFuer: (personId: string) => number|null,
 *   onSpeichern: (a: Record<string, any>) => Promise<boolean>, onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function AntragDialog({ personen, eigeneId, nurEigene, darfBetriebsruhe, abwesenheiten, heute, maxGleichzeitig, tageFuer, restFuer, onSpeichern, onClose }) {
  const { t } = useI18n();
  const [f, setF] = useState(/** @type {Record<string, any>} */ ({
    mitarbeiter_id: nurEigene ? eigeneId : (eigeneId || personen[0]?.id || ""), art: "urlaub", von: heute, bis: heute, vertretung_id: "", halbtag_von: false, halbtag_bis: false, notiz: "",
  }));
  const [busy, setBusy] = useState(false);
  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setF((x) => ({ ...x, [k]: v }));
  const arten = Object.entries(ABWESENHEIT_ARTEN).filter(([k]) => k !== "betriebsruhe" || darfBetriebsruhe);
  const gueltig = Boolean(f.mitarbeiter_id) && /^\d{4}-\d{2}-\d{2}$/.test(f.von) && /^\d{4}-\d{2}-\d{2}$/.test(f.bis) && f.bis >= f.von;
  const tage = gueltig ? tageFuer(f) : 0;
  const warnungen = useMemo(() => (gueltig ? konflikte({ ...f, vertretung_id: f.vertretung_id || null }, abwesenheiten, { maxGleichzeitig, rest: restFuer(f.mitarbeiter_id), tage }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, abwesenheiten, maxGleichzeitig, tage, gueltig]);
  const kuerzel = (/** @type {string} */ id) => personen.find((p) => p.id === id)?.kuerzel || id;
  const text = (/** @type {{art: string, werte: Record<string, any>}} */ w) => {
    const vorlagen = /** @type {Record<string, string>} */ ({
      vertretung_abwesend: "Vertretung {kuerzel} ist {von}–{bis} selbst abwesend",
      ueberschneidung: "Überschneidet sich mit einem eigenen Eintrag {von}–{bis}",
      zu_viele_gleichzeitig: "Am {datum} wären {anzahl} Personen abwesend (Richtwert höchstens {max})",
      rest_reicht_nicht: "Beantragt {tage} Tage, Resturlaub {rest} Tage",
      betriebsruhe: "Betriebsruhe {von}–{bis} im Zeitraum",
    });
    const werte = { ...w.werte, kuerzel: kuerzel(w.werte.vertretung) };
    return t(vorlagen[w.art] || w.art).replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
  };
  const speichern = async () => {
    setBusy(true);
    try {
      const obj = normalisiereAbwesenheit({ ...f, vertretung_id: f.vertretung_id || null, status: direktErfassbar(f.art) ? "genehmigt" : "beantragt" });
      if (await onSpeichern(obj)) onClose();
    } finally {
      setBusy(false);
    }
  };
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  const auswahl = "mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900";
  return (
    <FormModal title={t("Abwesenheit eintragen")} onClose={onClose} schuetzen>
      <div className="space-y-3 text-sm" data-testid="antrag-dialog">
        {!nurEigene && (
          <label className={feld}>{t("Person")}
            <select className={auswahl} value={f.mitarbeiter_id} onChange={(e) => setze("mitarbeiter_id", e.target.value)} data-testid="antrag-person">
              {personen.map((p) => <option key={p.id} value={p.id}>{p.kuerzel} · {p.name}</option>)}
            </select>
          </label>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={feld}>{t("Von")}<Input type="date" value={f.von} onChange={(e) => setze("von", e.target.value)} data-testid="antrag-von" /></label>
          <label className={feld}>{t("Bis")}<Input type="date" value={f.bis} onChange={(e) => setze("bis", e.target.value)} data-testid="antrag-bis" /></label>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.halbtag_von} onChange={(e) => setze("halbtag_von", e.target.checked)} /> {t("erster Tag halb")}</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={f.halbtag_bis} onChange={(e) => setze("halbtag_bis", e.target.checked)} /> {t("letzter Tag halb")}</label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={feld}>{t("Art")}
            <select className={auswahl} value={f.art} onChange={(e) => setze("art", e.target.value)} data-testid="antrag-art">
              {arten.map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
            </select>
          </label>
          <label className={feld}>{t("Vertretung")}
            <select className={auswahl} value={f.vertretung_id} onChange={(e) => setze("vertretung_id", e.target.value)} data-testid="antrag-vertretung">
              <option value="">—</option>
              {personen.filter((p) => p.id !== f.mitarbeiter_id).map((p) => <option key={p.id} value={p.id}>{p.kuerzel} · {p.name}</option>)}
            </select>
          </label>
        </div>
        {ABWESENHEIT_ARTEN[f.art]?.notiz && <label className={feld}>{t("Notiz")}<Input value={f.notiz} onChange={(e) => setze("notiz", e.target.value)} data-testid="antrag-notiz" /></label>}
        {gueltig && <p className="text-xs text-slate-700 dark:text-slate-200" data-testid="antrag-tage">{t("{n} Arbeitstage").replace("{n}", String(tage).replace(".", ","))}</p>}
        {warnungen.length > 0 && (
          <ul className="space-y-1 rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="antrag-warnungen">
            {warnungen.map((w, i) => <li key={i} data-warnung={w.art}>{text(w)}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("Abbrechen")}</Button>
          <Button type="button" disabled={!gueltig || busy} onClick={speichern} data-testid="antrag-speichern">{direktErfassbar(f.art) ? t("Eintragen") : t("Beantragen")}</Button>
        </div>
      </div>
    </FormModal>
  );
}
