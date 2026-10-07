// Form for one Gesellschafter (phase 79, plan 79-06 T3): the owner of a sole
// proprietor, or one partner of a GbR/PartG. Not offered at all for GmbH/UG
// (EntnahmenReiter.jsx never renders this form there — no managing partner
// record to add, the managing-director salary runs as an expense, 79-04).
//
// In:  props bh (page loader object), eintrag (existing Gesellschafter to
//      edit, or null for a new one), onClose. Out: a FormModal; saving writes
//      through bh.speichere("Gesellschafter", …).

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { personFormTitel, standardRolle } from "@/lib/accounting/entnahmen.js";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { centZuEuro, euroZuCent } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   eintrag: Record<string, any>|null,
 *   onClose: () => void,
 * }} props eintrag: existing Gesellschafter, or null for a new one
 * @returns {React.ReactElement}
 */
export default function GesellschafterFormular({ bh, eintrag, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const rechtsform = rechtsformWirkung(bh.einst).rechtsform;
  const [form, setForm] = React.useState(() => ({
    name: eintrag?.name || "",
    aktiv: eintrag?.aktiv !== false,
    iban: eintrag?.iban || "",
  }));
  const [planMonat, setPlanMonat] = React.useState(() => (eintrag ? euroZuCent(eintrag.entnahme_plan_monat) : null));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  const pruefen = () => {
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.name.trim()) f.name = t("Bitte einen Namen eingeben.");
    setFehler(f);
    return Object.keys(f).length === 0;
  };

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    if (!pruefen()) return;
    setSpeichert(true);
    try {
      await bh.speichere("Gesellschafter", {
        ...(eintrag?.id ? { id: eintrag.id } : { rolle: standardRolle(rechtsform) }),
        name: form.name.trim(),
        aktiv: form.aktiv,
        entnahme_plan_monat: centZuEuro(planMonat ?? 0),
        iban: form.iban.trim() || undefined,
      });
      toast.success(bearbeiten ? t("Person gespeichert") : t("Person angelegt"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={personFormTitel(rechtsform, bearbeiten, t)} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="gesellschafter-formular">
        <div className="space-y-1">
          <label htmlFor="gs-name" className={LABEL}>{t("Name")}</label>
          <input id="gs-name" type="text" className={FELD} value={form.name}
            aria-invalid={fehler.name ? true : undefined} onChange={(e) => setze("name", e.target.value)} />
          {fehler.name && <p className={FEHLER}>{fehler.name}</p>}
        </div>

        <div className="space-y-1">
          <label htmlFor="gs-plan" className={LABEL}>{t("Geplante Entnahme je Monat")}</label>
          <BetragFeld id="gs-plan" wert={planMonat} onChange={setPlanMonat} />
        </div>

        <div className="space-y-1">
          <label htmlFor="gs-iban" className={LABEL}>{t("IBAN (optional)")}</label>
          <input id="gs-iban" type="text" className={FELD} value={form.iban} onChange={(e) => setze("iban", e.target.value.toUpperCase())} />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.aktiv} onChange={(e) => setze("aktiv", e.target.checked)} />
          {t("Aktiv")}
        </label>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
