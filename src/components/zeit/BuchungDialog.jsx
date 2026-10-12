// Dialog for one time booking (phase 81-02): new or edit a DRAFT of the person
// chosen under "Stunden für" — target (project/stage/kind or office time), day,
// duration on the grid, note. Submitted, approved and rejected bookings are
// changed through the status workflow, never here.
//
// In:  props zh, zz, buchung (existing draft or null), datum (preset day), onClose.
// Out: a FormModal (with the discard guard of dialogSchutz); saving writes through
//      the storage layer and closes.

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { parseDauer } from "@/lib/zeit/zeitbuchung.js";
import { FEHLER, FELD, LABEL, LEERES_ZIEL, stundenText, ZielFelder } from "./zeitGemeinsam.jsx";

/**
 * @param {{
 *   zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar,
 *   zz: import("./useZeiterfassung.js").Zeiterfassung,
 *   buchung: Record<string, any>|null, datum: string, onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function BuchungDialog({ zh, zz, buchung, datum, onClose }) {
  const { t, lang } = useI18n();
  const [ziel, setZiel] = React.useState(() => (buchung
    ? { project_id: buchung.project_id ?? null, lph: buchung.lph ?? null, leistung: buchung.leistung ?? null, kategorie_intern: buchung.kategorie_intern ?? null, honorarnachtrag_id: buchung.honorarnachtrag_id ?? null }
    : { ...LEERES_ZIEL }));
  const [tag, setTag] = React.useState(buchung?.datum || datum);
  const [dauer, setDauer] = React.useState(buchung ? stundenText(buchung.minuten, lang) : "");
  const [notiz, setNotiz] = React.useState(buchung?.notiz || "");
  const [fehler, setFehler] = React.useState("");
  const [speichert, setSpeichert] = React.useState(false);

  const speichern = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    const r = /** @type {any} */ (parseDauer(dauer, zz.regeln.raster));
    if (!r.ok || !r.minuten) {
      setFehler(r.ok || r.fehler === "leer" ? t("Bitte eine Dauer eingeben.") : r.fehler === "raster"
        ? t("Nur Vielfache von {n} min").replace("{n}", String(zz.regeln.raster))
        : t("Bitte als Stunden eingeben, z. B. 1,5 oder 1:30"));
      return;
    }
    setSpeichert(true);
    try {
      await zz.speichereBuchung({
        ...(buchung || { mitarbeiter_id: zz.personId, status: "entwurf", quelle: "manuell" }),
        ...ziel, datum: tag, minuten: r.minuten, notiz,
      });
      toast.success(t("Buchung gespeichert"));
      onClose();
    } catch (err) {
      setFehler(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={buchung ? t("Buchung bearbeiten") : t("Neue Buchung")} onClose={onClose}>
      <form className="space-y-4" onSubmit={speichern} data-testid="zeit-buchung-dialog">
        <ZielFelder wert={ziel} onChange={setZiel} idPraefix="buchung" projekte={zh.projekte} vertraege={zh.daten.Honorarvertrag}
          nachtraege={zh.daten.Honorarnachtrag} mitarbeiter={zz.personen} buchungen={zh.daten.Zeitbuchung}
          mitarbeiterId={zz.personId} heute={zh.heute} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="buchung-datum" className={LABEL}>{t("Datum")}</label>
            <input id="buchung-datum" type="date" className={FELD} value={tag} onChange={(e) => setTag(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label htmlFor="buchung-dauer" className={LABEL}>{t("Dauer (Stunden)")}</label>
            <input id="buchung-dauer" className={FELD} inputMode="decimal" placeholder="1,5" value={dauer}
              aria-invalid={fehler ? true : undefined} onChange={(e) => { setDauer(e.target.value); setFehler(""); }} />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="buchung-notiz" className={LABEL}>{t("Notiz")}</label>
          <input id="buchung-notiz" className={FELD} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
        </div>
        {fehler && <p className={FEHLER} role="alert">{fehler}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
