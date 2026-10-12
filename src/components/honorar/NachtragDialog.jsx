// Dialog of one fee amendment (phase 81-04, HON-05): title, reason (with its
// legal source), work stage of the contract's service profile, calculation
// (flat | hours × charge-out rate of a role, zeit_honorar.verrechnungssatz_* |
// share of the stage fee for repeated services), text-form date. The amount is
// computed by betragAusBerechnung; only drafts are edited here — status changes
// happen in the list. UI word always "Honorarnachtrag".
//
// In:  props zh, wert, vertrag, nachtrag (draft or null for new), onClose.
// Out: a FormModal; saving writes one Honorarnachtrag through the storage layer.

import React from "react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { betragAusBerechnung, NACHTRAG_GRUENDE, neuerNachtrag, ROLLEN_SATZ } from "@/lib/honorar/honorarNachtrag.js";
import BetragFeld from "@/components/accounting/gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/**
 * @param {{
 *   zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, wert: (id: string) => any,
 *   vertrag: Record<string, any>, nachtrag: Record<string, any>|null, onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function NachtragDialog({ zh, wert, vertrag, nachtrag, onClose }) {
  const { t, lang } = useI18n();
  const [form, setForm] = React.useState(() => nachtrag || neuerNachtrag(vertrag, zh.daten.Honorarnachtrag, { heuteIso: zh.heute }));
  const [speichert, setSpeichert] = React.useState(false);
  const aendere = (/** @type {Record<string, any>} */ patch) => setForm((f) => ({ ...f, ...patch }));
  const setzeBerechnung = (/** @type {Record<string, any>} */ patch) => setForm((f) => ({ ...f, berechnung: { ...(f.berechnung || {}), ...patch } }));
  const info = leistungsbildInfo(vertrag.leistungsbild);
  const stufen = info?.lph?.length ? info.lph : Array.from({ length: (vertrag.lph || []).length || 9 }, (_, i) => ({ nr: i + 1, bezeichnung: "" }));
  const b = form.berechnung || { art: "pauschal" };
  const betrag = betragAusBerechnung({ ...b, lph: b.lph ?? form.lph }, vertrag, wert);

  const speichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    setSpeichert(true);
    // Hours: freeze the charge-out rate of the role at saving time — the letter
    // prints it, and a later rule change must not alter a stored amendment.
    const berechnung = b.art === "stunden" && typeof b.satz_eur_h !== "number"
      ? { ...b, satz_eur_h: Number(wert(/** @type {any} */ (ROLLEN_SATZ)[b.rolle || "mitarbeit"] || ROLLEN_SATZ.mitarbeit)) || 0 }
      : b;
    const r = await mitRueckmeldung(() => zh.speichere("Honorarnachtrag", { ...form, berechnung, betrag_euro: betrag }), { erfolg: t("Honorarnachtrag gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    setSpeichert(false);
    if (r.ok) onClose();
  };

  return (
    <FormModal title={`${t("Honorarnachtrag")} ${form.nr} · ${vertrag.nummer || ""}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={speichern} data-testid="nachtrag-dialog">
        <div className="space-y-1">
          <label htmlFor="hn-titel" className={LABEL}>{t("Titel")}</label>
          <input id="hn-titel" className={FELD} value={form.titel || ""} onChange={(e) => aendere({ titel: e.target.value })} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="hn-grund" className={LABEL}>{t("Grund")}</label>
            <select id="hn-grund" className={FELD} value={form.grund} onChange={(e) => aendere({ grund: e.target.value })}>
              {Object.entries(NACHTRAG_GRUENDE).map(([k, g]) => <option key={k} value={k}>{`${t(g.label)} (${g.quelle})`}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="hn-lph" className={LABEL}>{t("Leistungsphase")}</label>
            <select id="hn-lph" className={FELD} value={form.lph ?? ""} onChange={(e) => aendere({ lph: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("ohne Leistungsphase")}</option>
              {stufen.map((s) => <option key={s.nr} value={s.nr}>{`${t("LPH")} ${s.nr} ${s.bezeichnung ? t(s.bezeichnung) : ""}`}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className={LABEL}>{t("Berechnung")}</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {[["pauschal", "pauschal"], ["stunden", "nach Stunden"], ["wiederholung", "Wiederholung (% der LPH)"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-1"><input type="radio" name="hn-art" checked={(b.art || "pauschal") === k} onChange={() => setzeBerechnung({ art: k })} /> {t(l)}</label>
            ))}
          </div>
          {(b.art || "pauschal") === "pauschal" && (
            <BetragFeld id="hn-betrag" label={t("Betrag (€)")} wert={typeof b.betrag_euro === "number" ? Math.round(b.betrag_euro * 100) : null} onChange={(c) => setzeBerechnung({ betrag_euro: c === null ? null : c / 100 })} />
          )}
          {b.art === "stunden" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="hn-stunden" className={LABEL}>{t("Stunden")}</label>
                <input id="hn-stunden" type="number" min="0" step="0.25" className={FELD} value={b.stunden ?? ""} onChange={(e) => setzeBerechnung({ stunden: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <label htmlFor="hn-rolle" className={LABEL}>{t("Verrechnungssatz")}</label>
                <select id="hn-rolle" className={FELD} value={b.rolle || "mitarbeit"} onChange={(e) => setzeBerechnung({ rolle: e.target.value, satz_eur_h: undefined })}>
                  <option value="inhaber">{t("Verrechnungssatz Inhaber/in")}</option>
                  <option value="projektleitung">{t("Verrechnungssatz Projektleitung")}</option>
                  <option value="mitarbeit">{t("Verrechnungssatz Mitarbeit")}</option>
                </select>
              </div>
            </div>
          )}
          {b.art === "wiederholung" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="hn-wlph" className={LABEL}>{t("Wiederholte Leistungsphase")}</label>
                <select id="hn-wlph" className={FELD} value={b.lph ?? form.lph ?? ""} onChange={(e) => setzeBerechnung({ lph: Number(e.target.value) || null })}>
                  <option value="">—</option>
                  {stufen.map((s) => <option key={s.nr} value={s.nr}>{`${t("LPH")} ${s.nr}`}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="hn-wprozent" className={LABEL}>{t("Anteil (%)")}</label>
                <input id="hn-wprozent" type="number" min="0" max="100" className={FELD} value={b.wiederholung_prozent ?? ""} onChange={(e) => setzeBerechnung({ wiederholung_prozent: Number(e.target.value) || 0 })} />
              </div>
            </div>
          )}
          <p className="text-sm" data-testid="nachtrag-betrag">{t("Betrag netto")}: <strong>{formatEuro(Math.round(betrag * 100), lang)}</strong> · {t("zuzüglich Nebenkosten laut Vertrag")}</p>
        </fieldset>
        <div className="space-y-1">
          <label htmlFor="hn-textform" className={LABEL}>{t("in Textform vereinbart am")}</label>
          <input id="hn-textform" type="date" className={FELD} value={form.textform_am || ""} onChange={(e) => aendere({ textform_am: e.target.value || null })} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert || !String(form.titel || "").trim()}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
