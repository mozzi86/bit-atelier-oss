// Form for one Entnahme (drawing, phase 79, plan 79-06 T3): person, date,
// amount, kind. Not offered for GmbH/UG (EntnahmenReiter.jsx never renders
// this there — a corporation has no drawings, rechtsformWirkung().entnahmen
// === "gf_gehalt").
//
// In:  props bh (page loader object), eintrag (existing Entnahme to edit, or
//      null for a new one), onClose. Out: a FormModal; saving writes through
//      bh.speichere("Entnahme", …).

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { artText } from "@/lib/accounting/entnahmen.js";
import { centZuEuro, euroZuCent } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";
const ARTEN = /** @type {const} */ (["ueberweisung", "bar", "sache", "steuer"]);

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   gesellschafter: Array<{id: string, name: string}>,
 *   eintrag: Record<string, any>|null,
 *   onClose: () => void,
 * }} props gesellschafter: selectable persons (active ones, plus the current
 *   record's person even if since deactivated); eintrag: existing Entnahme,
 *   or null for a new one
 * @returns {React.ReactElement}
 */
export default function EntnahmeFormular({ bh, gesellschafter, eintrag, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const [form, setForm] = React.useState(() => ({
    gesellschafter_id: eintrag?.gesellschafter_id || gesellschafter[0]?.id || "",
    datum: eintrag?.datum || bh.heute,
    art: eintrag?.art || "ueberweisung",
  }));
  const [betrag, setBetrag] = React.useState(() => (eintrag ? euroZuCent(eintrag.betrag) : null));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  const pruefen = () => {
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.gesellschafter_id) f.gesellschafter_id = t("Bitte eine Person wählen.");
    if (betrag === null) f.betrag = t("Bitte einen Betrag eingeben.");
    if (!form.datum) f.datum = t("Bitte ein Datum eingeben.");
    setFehler(f);
    return Object.keys(f).length === 0;
  };

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    if (!pruefen()) return;
    setSpeichert(true);
    try {
      await bh.speichere("Entnahme", {
        ...(eintrag?.id ? { id: eintrag.id } : {}),
        gesellschafter_id: form.gesellschafter_id,
        datum: form.datum,
        betrag: centZuEuro(betrag ?? 0),
        art: form.art,
      });
      toast.success(bearbeiten ? t("Entnahme gespeichert") : t("Entnahme erfasst"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Entnahme bearbeiten") : t("Neue Entnahme erfassen")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="entnahme-formular">
        <div className="space-y-1">
          <label htmlFor="en-person" className={LABEL}>{t("Person")}</label>
          <select id="en-person" className={FELD} value={form.gesellschafter_id}
            aria-invalid={fehler.gesellschafter_id ? true : undefined} onChange={(e) => setze("gesellschafter_id", e.target.value)}>
            {gesellschafter.length === 0 && <option value="">{t("— keine Person angelegt —")}</option>}
            {gesellschafter.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {fehler.gesellschafter_id && <p className={FEHLER}>{fehler.gesellschafter_id}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="en-datum" className={LABEL}>{t("Datum")}</label>
            <input id="en-datum" type="date" className={FELD} value={form.datum}
              aria-invalid={fehler.datum ? true : undefined} onChange={(e) => setze("datum", e.target.value)} />
            {fehler.datum && <p className={FEHLER}>{fehler.datum}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="en-betrag" className={LABEL}>{t("Betrag")}</label>
            <BetragFeld id="en-betrag" wert={betrag} onChange={setBetrag} />
            {fehler.betrag && <p className={FEHLER}>{fehler.betrag}</p>}
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="en-art" className={LABEL}>{t("Art")}</label>
          <select id="en-art" className={FELD} value={form.art} onChange={(e) => setze("art", e.target.value)}>
            {ARTEN.map((a) => <option key={a} value={a}>{artText(a, t)}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
