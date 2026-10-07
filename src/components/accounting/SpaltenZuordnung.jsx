// Besitzer: 79-07. Manual column mapping for a bank export BankReiter.jsx could
// not auto-recognise (an unfamiliar bank, or a layout that changed): pick the
// separator, amount/date format, and which column holds which field, then
// optionally keep the mapping as a bank profile (`einst.bank_profile[]`, so it
// survives a tab switch — it is settings, not component state, 79-07-RESEARCH).
//
// In:  props zuordnung (the BankProfil-shaped draft), onChange, vorschauZeilen
//      (a few already-split rows to number the columns against), gespeicherte
//      Profile (einst.bank_profile), onProfilSpeichern(name). Out: the form;
//      writes happen in the caller (BankReiter), this component only edits the
//      draft object and asks to save it.

import React from "react";
import { toast } from "sonner";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { BANK_PROFILE } from "@/lib/accounting/bankCsv.js";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-xs font-medium text-slate-600 dark:text-slate-300";
const ZAHLENFELD = `${FELD} w-20`;

/**
 * @param {{
 *   zuordnung: Record<string, any>,
 *   onChange: (naechste: Record<string, any>) => void,
 *   gespeicherteProfile?: Array<{name: string}&Record<string, any>>,
 *   onProfilSpeichern: (name: string) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function SpaltenZuordnung({ zuordnung, onChange, gespeicherteProfile = [], onProfilSpeichern }) {
  const { t } = useI18n();
  const [profilName, setProfilName] = React.useState("");
  const spalten = zuordnung.spalten || {};
  // Betrag-Modus: one signed column, one column plus a Soll/Haben indicator
  // column, or two separate unsigned Soll/Haben columns (Postbank/Deutsche Bank).
  const modus = spalten.betrag_soll_haben ? "soll_haben" : spalten.sh !== undefined ? "sh" : "betrag";

  const setzeSpalte = (feld, wert) => {
    const zahl = wert === "" ? undefined : Number(wert);
    onChange({ ...zuordnung, spalten: { ...spalten, [feld]: Number.isInteger(zahl) ? zahl : undefined } });
  };
  const setzeModus = (neuerModus) => {
    const { sh, betrag_soll_haben, betrag, ...rest } = spalten;
    if (neuerModus === "sh") onChange({ ...zuordnung, spalten: { ...rest, betrag: spalten.betrag, sh: spalten.sh ?? 0 } });
    else if (neuerModus === "soll_haben") onChange({ ...zuordnung, spalten: { ...rest, betrag_soll_haben: spalten.betrag_soll_haben || { soll: 0, haben: 1 } } });
    else onChange({ ...zuordnung, spalten: { ...rest, betrag: spalten.betrag ?? 0 } });
  };

  const profilLaden = (name) => {
    const profil = gespeicherteProfile.find((p) => p.name === name);
    if (profil) onChange({ ...profil });
  };

  const speichern = () => {
    if (!profilName.trim()) { toast.error(t("Bitte einen Namen für das Profil eingeben.")); return; }
    onProfilSpeichern(profilName.trim());
    setProfilName("");
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700" data-testid="spalten-zuordnung">
      {gespeicherteProfile.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Gespeichertes Profil verwenden")}</span>
          <select className={FELD} defaultValue="" onChange={(e) => profilLaden(e.target.value)}>
            <option value="" disabled>{t("Profil wählen …")}</option>
            {gespeicherteProfile.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Trenner")}</span>
          <select className={FELD} value={zuordnung.trenner || ";"} onChange={(e) => onChange({ ...zuordnung, trenner: e.target.value })}>
            <option value=";">;</option>
            <option value=",">,</option>
            <option value="\t">{t("Tabulator")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Zahlformat")}</span>
          <select className={FELD} value={zuordnung.zahlformat || "de"} onChange={(e) => onChange({ ...zuordnung, zahlformat: e.target.value })}>
            <option value="de">{t("Deutsch (1.234,56)")}</option>
            <option value="en">{t("Englisch (1,234.56)")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Datumsformat")}</span>
          <select className={FELD} value={zuordnung.datumsformat || "tt.mm.jjjj"} onChange={(e) => onChange({ ...zuordnung, datumsformat: e.target.value })}>
            <option value="tt.mm.jjjj">tt.mm.jjjj</option>
            <option value="tt.mm.jj">tt.mm.jj</option>
            <option value="jjjj-mm-tt">jjjj-mm-tt</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Zeichensatz")}</span>
          <select className={FELD} value={zuordnung.zeichensatz || "utf-8"} onChange={(e) => onChange({ ...zuordnung, zeichensatz: e.target.value })}>
            <option value="utf-8">UTF-8</option>
            <option value="windows-1252">windows-1252</option>
          </select>
        </label>
      </div>

      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className={`${LABEL} mb-1 w-full`}>{t("Betragsspalte")}</legend>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="betrag-modus" checked={modus === "betrag"} onChange={() => setzeModus("betrag")} />
          {t("eine Spalte (Vorzeichen)")}
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="betrag-modus" checked={modus === "sh"} onChange={() => setzeModus("sh")} />
          {t("Betrag + Soll/Haben-Spalte")}
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="betrag-modus" checked={modus === "soll_haben"} onChange={() => setzeModus("soll_haben")} />
          {t("getrennte Soll-/Haben-Spalten")}
        </label>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        {modus === "soll_haben" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Spalte Soll")}</span>
              <input type="number" min={0} className={ZAHLENFELD} value={spalten.betrag_soll_haben?.soll ?? ""}
                onChange={(e) => onChange({ ...zuordnung, spalten: { ...spalten, betrag_soll_haben: { ...spalten.betrag_soll_haben, soll: Number(e.target.value) } } })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Spalte Haben")}</span>
              <input type="number" min={0} className={ZAHLENFELD} value={spalten.betrag_soll_haben?.haben ?? ""}
                onChange={(e) => onChange({ ...zuordnung, spalten: { ...spalten, betrag_soll_haben: { ...spalten.betrag_soll_haben, haben: Number(e.target.value) } } })} />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Spalte Betrag")}</span>
              <input type="number" min={0} className={ZAHLENFELD} value={spalten.betrag ?? ""} onChange={(e) => setzeSpalte("betrag", e.target.value)} />
            </label>
            {modus === "sh" && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("Spalte Soll/Haben")}</span>
                <input type="number" min={0} className={ZAHLENFELD} value={spalten.sh ?? ""} onChange={(e) => setzeSpalte("sh", e.target.value)} />
              </label>
            )}
          </>
        )}
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Datum")}</span>
          <input type="number" min={0} className={ZAHLENFELD} value={spalten.datum ?? ""} onChange={(e) => setzeSpalte("datum", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Valuta (optional)")}</span>
          <input type="number" min={0} className={ZAHLENFELD} value={spalten.valuta ?? ""} onChange={(e) => setzeSpalte("valuta", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Verwendungszweck")}</span>
          <input type="number" min={0} className={ZAHLENFELD} value={spalten.zweck ?? ""} onChange={(e) => setzeSpalte("zweck", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Gegenpartei")}</span>
          <input type="number" min={0} className={ZAHLENFELD} value={spalten.gegenpartei ?? ""} onChange={(e) => setzeSpalte("gegenpartei", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("IBAN (optional)")}</span>
          <input type="number" min={0} className={ZAHLENFELD} value={spalten.iban ?? ""} onChange={(e) => setzeSpalte("iban", e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Profilname")}</span>
          <input type="text" className={`${FELD} w-48`} value={profilName} onChange={(e) => setProfilName(e.target.value)} />
        </label>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={speichern}>
          {t("Als Bankprofil speichern")}
        </button>
      </div>
    </div>
  );
}

/** Default draft for a fresh manual mapping — the "generisch" profile's own defaults. */
export const LEERE_ZUORDNUNG = { ...BANK_PROFILE.generisch, spalten: { betrag: 0 } };
