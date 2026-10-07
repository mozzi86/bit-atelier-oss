// Dialog "Mahnung Stufe n" of the dunning section (79-03, T4): an HTML preview
// of the letter, an editable deadline, "PDF herunterladen und Mahnung
// speichern" (download + record the dunning entry) and an optional filing
// under the project's correspondence folder.
//
// In:  props bh, zeile (one MahnwesenAbschnitt.baueZeile() row), stufe,
//      projektId. Out: writes rechnung.mahnungen[] through
//      bh.speichere("Ausgangsrechnung", …) — the GoBD write protection
//      already allows that field on an issued invoice; onClose when done.

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { dokumentAblegen } from "@core/lib/ablage";
import { mahnTextFelder } from "@/lib/accounting/mahnwesen.js";
import { erzeugeMahnPdf, mahnDateiname } from "@/lib/accounting/mahnPdf.js";
import { dateiAnbieten } from "@/lib/accounting/tabellenExport.js";
import { centZuEuro } from "@/lib/accounting/geld.js";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
// Native <label> instead of the shadcn Label wrapper — same tsc-cost reason as RechnungFormular.jsx.
const LABEL = "text-sm font-medium leading-none";

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   zeile: {rechnung: Record<string, any>, vertrag: Record<string, any>|null, faelligeStufe: {frist: string}|null},
 *   stufe: number,
 *   projektId: string|null,
 *   onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function MahnDialog({ bh, zeile, stufe, projektId, onClose }) {
  const { t } = useI18n();
  const [briefkopf, setBriefkopf] = React.useState(/** @type {Record<string, any>} */ ({}));
  const [frist, setFrist] = React.useState(() => zeile.faelligeStufe?.frist || bh.heute);
  const [ablegen, setAblegen] = React.useState(false);
  const [speichert, setSpeichert] = React.useState(false);

  // Same source as src/Layout.jsx / src/pages/Reports.jsx: Setting{key:"briefkopf"}.
  React.useEffect(() => {
    let aktiv = true;
    /** @type {any} */ (bitApi).entities.Setting.filter({ key: "briefkopf" })
      .then((zeilen) => { if (aktiv && zeilen[0]) setBriefkopf(zeilen[0].value || {}); })
      .catch(() => { /* offline or none saved yet — mahnwesen.js falls back to office defaults */ });
    return () => { aktiv = false; };
  }, []);

  const felder = mahnTextFelder(zeile.rechnung, stufe, { heute: bh.heute, einst: bh.einst, briefkopf, vertrag: zeile.vertrag, frist }, t);

  const speichern = async () => {
    setSpeichert(true);
    try {
      const pdf = await erzeugeMahnPdf(felder);
      const dateiname = mahnDateiname(zeile.rechnung.nummer, stufe);
      dateiAnbieten(pdf, dateiname, "application/pdf");

      const mahnungen = [
        ...(zeile.rechnung.mahnungen || []),
        { stufe, datum: bh.heute, frist, zinsen: centZuEuro(felder.zinsenCent), pauschale: centZuEuro(felder.pauschaleCent) },
      ];
      await bh.speichere("Ausgangsrechnung", { id: zeile.rechnung.id, mahnungen });
      toast.success(t("Mahnung gespeichert"));

      if (ablegen && projektId) {
        const r = await dokumentAblegen({ projectId: projektId, name: dateiname, typ: "Schriftverkehr", notiz: felder.betreff });
        if (!r.ok) toast.error(r.grund || "Ablage fehlgeschlagen");
      }
      onClose();
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={t("Mahnung Stufe {n}").replace("{n}", String(stufe))} onClose={onClose}>
      <div className="space-y-4">
        <div aria-label={t("Vorschau")} className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
          <p className="font-semibold">{felder.betreff}</p>
          <p>{felder.anrede}</p>
          {felder.absaetze.map((absatz, i) => <p key={i}>{absatz}</p>)}
          <table className="mt-2 w-full">
            <tbody>
              {felder.tabelle.zeilen.map(([label, wert], i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 text-slate-500">{label}</td>
                  <td className="py-1 text-right tabular-nums">{wert}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <label className={LABEL} htmlFor="md-frist">{t("Frist")}</label>
          <input id="md-frist" type="date" className={FELD} value={frist} onChange={(e) => setFrist(e.target.value)} />
        </div>

        {projektId && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ablegen} onChange={(e) => setAblegen(e.target.checked)} />
            {t("Im Projekt unter Schriftverkehr ablegen")}
          </label>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="button" disabled={speichert} className={buttonVariants({})} onClick={speichern}>
            {t("PDF herunterladen und Mahnung speichern")}
          </button>
        </div>
      </div>
    </FormModal>
  );
}
