// Tax and bank data of the office in Einstellungen › Büro & Briefkopf (94-02,
// B-ABN-01). Before, tax number, VAT ID and IBAN were only reachable through the
// accounting page's settings dialog and the settings search did not find them.
//
// One storage, two editors on the same record: this form and the accounting
// dialog both write Setting{key:"buchhaltung"}.value.buero.{steuernr, ust_idnr,
// iban} (read-modify-write, nothing else in `value` is touched). The office NAME
// is not here — it is the letterhead's (bueroName.js).
//
// In:  nothing (reads/writes the Setting through useEinstellung/leseEinstellung).
// Out: the form section.

import React from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { leseEinstellung, useEinstellung } from "@core/lib/useEinstellung.js";
import { SETTING_KEY } from "@/lib/accounting/datenmodell.js";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/**
 * @returns {React.ReactElement}
 */
export default function SteuerBankFormular() {
  const { t } = useI18n();
  const [wert, setzen, { laden }] = useEinstellung(SETTING_KEY, {});
  const [form, setForm] = React.useState({ steuernr: "", ust_idnr: "", iban: "" });
  const [speichert, setSpeichert] = React.useState(false);

  // Fill once the stored record has loaded (and again after a write elsewhere).
  React.useEffect(() => {
    const b = wert?.buero || {};
    setForm({ steuernr: b.steuernr || "", ust_idnr: b.ust_idnr || "", iban: b.iban || "" });
  }, [wert]);

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    setSpeichert(true);
    try {
      // Read fresh, merge only the three fields — the accounting rates and the
      // legacy office name stay as they are.
      const { wert: frisch } = await leseEinstellung(SETTING_KEY);
      const alt = frisch && typeof frisch === "object" ? frisch : {};
      await setzen({
        ...alt,
        buero: { ...(alt.buero || {}), steuernr: form.steuernr.trim(), ust_idnr: form.ust_idnr.replace(/\s+/g, "").toUpperCase(), iban: form.iban.replace(/\s+/g, "").toUpperCase() },
      });
      toast.success(t("Steuer- und Bankdaten gespeichert"));
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <form onSubmit={speichern} className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700" data-testid="steuer-bank" aria-labelledby="steuer-bank-titel">
      <h3 id="steuer-bank-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Steuer- und Bankdaten")}</h3>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("Für Rechnungen, XRechnung und Mahnungen — dieselben Angaben wie in Buchhaltung › Einstellungen.")}{" "}
        <Link to="/Accounting" className="underline">{t("Zur Buchhaltung")}</Link>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[["office-steuernr", t("Steuernummer"), "steuernr"], ["office-ust-idnr", t("USt-IdNr."), "ust_idnr"], ["office-iban", t("IBAN"), "iban"]].map(([id, text, feld]) => (
          <div key={id} className="space-y-1">
            <label htmlFor={id} className={LABEL}>{text}</label>
            <input id={id} type="text" autoComplete="off" className={FELD} disabled={laden} value={form[feld]}
              onChange={(ev) => setForm((f) => ({ ...f, [feld]: ev.target.value }))} />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert || laden}>{t("Speichern")}</button>
      </div>
    </form>
  );
}
