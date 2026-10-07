// Settings dialog of the accounting module (phase 79/80). Phase 80-07: no second
// editor for rules (D-P80-25) — office values and rates live in Einstellungen ›
// Regelwerke; this dialog keeps the office master data of the books (D-P79-30).
//
// The rules ("Gesetzliche Werte", the 16 editable office values — legal form,
// payment term, buffer, number pattern, default fees and VAT, trade tax, chart of
// accounts) moved to RegelwerkBereich.jsx (@ "Einstellungen › Regelwerke",
// ?tab=rules): this dialog links there instead of editing them a second time. The
// legal form stays visible here as a READ-ONLY line with its effect
// (rechtsformWirkung(), the one source of the matrix, unchanged) — a Rechnungen/
// AVA page that opens this dialog for the office master data still shows which
// legal form is in effect without a trip to Settings.
//
// In:  props bh (page loader object), onClose. Out: a FormModal; saving patches
//      Setting{key:"buchhaltung"}.value.buero through bh.einstellungSpeichern
//      (einstellungSpeichern merges the patch — nothing else in `value` is touched).

import React from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { personenPruefen, rechtsformWirkung } from "@/lib/accounting/rechtsform.js";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/**
 * The effect of a legal form in one line, e.g. "EÜR · Privatentnahmen der
 * Inhaberin · ESt-Vorauszahlungen · keine GewSt". The one place left in this
 * dialog that still reads the legal form (read-only now — Regelwerke owns the
 * switch, D-P80-25).
 * @param {import("@/lib/accounting/rechtsform.js").RechtsformWirkung} w
 * @param {(k: string) => string} t
 * @returns {string}
 */
function wirkungText(w, t) {
  const teile = [
    w.gewinnermittlung === "bilanz" ? t("bilanziert — keine EÜR") : t("EÜR"),
    w.entnahmen === "gf_gehalt" ? t("Geschäftsführergehalt statt Entnahmen")
      : w.entnahmen === "gesellschafter" ? t("Entnahmen je Gesellschafter") : t("Privatentnahmen der Inhaberin"),
    w.vorauszahlung === "kst" ? t("KSt") : t("ESt-Vorauszahlungen"),
    w.gewst ? t("GewSt") : t("keine GewSt"),
  ];
  return teile.join(" · ");
}

/**
 * Text of a legal-form key for the read-only line (literal t() calls for the
 * i18n guard) — same texts as RECHTSFORM_LABEL (src/lib/settings/regelwerke.js),
 * kept local rather than imported: that registry lives in the app's settings
 * layer, this dialog only needs four fixed strings.
 * @param {string} rechtsform
 * @param {(k: string) => string} t
 * @returns {string}
 */
function rechtsformText(rechtsform, t) {
  switch (rechtsform) {
    case "gbr": return t("GbR");
    case "partg": return t("PartG");
    case "gmbh": return t("GmbH");
    case "ug": return t("UG (haftungsbeschränkt)");
    default: return t("Einzelunternehmen (Freiberufler)");
  }
}

/**
 * @param {{bh: import("../useBuchhaltung.js").Buchhaltung, onClose: () => void}} props
 *   bh: page loader object; onClose: closes the dialog (called after saving or cancelling)
 * @returns {React.ReactElement}
 */
export default function EinstellungenDialog({ bh, onClose }) {
  const { t } = useI18n();
  const e = bh.einst;
  const [form, setForm] = React.useState(() => ({
    buero_name: e.buero?.name || "",
    steuernr: e.buero?.steuernr || "",
    ust_idnr: e.buero?.ust_idnr || "",
    iban: e.buero?.iban || "",
  }));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));
  // Read-only now (D-P80-25): the switch itself lives in Einstellungen › Regelwerke.
  const wirkung = rechtsformWirkung(e);
  const jahr = Number(bh.heute.slice(0, 4));
  const warnungen = personenPruefen(bh.daten.Gesellschafter, e, jahr);

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    setSpeichert(true);
    try {
      // A PATCH (einstellungSpeichern merges into the stored value) — the rates
      // and the legal form are untouched, they are written in Regelwerke.
      await bh.einstellungSpeichern({
        buero: { name: form.buero_name.trim(), steuernr: form.steuernr.trim(), ust_idnr: form.ust_idnr.trim(), iban: form.iban.replace(/\s+/g, "").toUpperCase() },
      });
      toast.success(t("Einstellungen gespeichert"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={t("Einstellungen der Buchhaltung")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-6" data-testid="buchhaltung-einstellungen">
        <section className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40" aria-labelledby="bh-regeln-titel">
          <h3 id="bh-regeln-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Sätze und Bürowerte der Buchhaltung pflegen Sie in Einstellungen › Regelwerke")}</h3>
          <Link to="/Settings?tab=rules" className={buttonVariants({ variant: "outline" })}>{t("Zu den Regelwerken")}</Link>
        </section>

        <section className="space-y-2" aria-labelledby="bh-rechtsform-titel">
          <h3 id="bh-rechtsform-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Rechtsform")}</h3>
          <p className="text-sm text-slate-700 dark:text-slate-200">{rechtsformText(wirkung.rechtsform, t)}</p>
          <p data-testid="rechtsform-wirkung" className="text-sm text-slate-700 dark:text-slate-200">{wirkungText(wirkung, t)}</p>
          {wirkung.hinweise.includes("ug_ruecklage") && (
            <p className="text-sm text-slate-600 dark:text-slate-300">{t("UG: 25 % des Jahresüberschusses gehen in die Rücklage (§ 5a Abs. 3 GmbHG).")}</p>
          )}
          {warnungen.includes("einzel_mehrere_personen") && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-200">{t("Rechtsform prüfen: Im Einzelunternehmen ist mehr als eine Person aktiv.")}</p>
          )}
          {warnungen.includes("schluessel_fehlt") && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-200">{t("Für die Gesellschafter fehlt ein Gewinnschlüssel mit 100 %.")}</p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="bh-buero-titel">
          <h3 id="bh-buero-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Büro")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {[["bh-buero-name", t("Büroname"), "buero_name"], ["bh-steuernr", t("Steuernummer"), "steuernr"],
              ["bh-ust-idnr", t("USt-IdNr."), "ust_idnr"], ["bh-iban", t("IBAN"), "iban"]].map(([id, text, feld]) => (
              <div key={id} className="space-y-1">
                <label htmlFor={id} className={LABEL}>{text}</label>
                <input id={id} type="text" autoComplete="off" className={FELD} value={form[feld]} onChange={(ev) => setze(feld, ev.target.value)} />
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>

      </form>
    </FormModal>
  );
}
