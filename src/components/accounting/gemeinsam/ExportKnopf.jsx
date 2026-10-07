// CSV/XLSX export buttons for one table model (phase 79). Every area passes the
// same model it shows, so the file and the screen cannot disagree.
//
// In:  the table model (or a function building it on click, so a large table
//      is only assembled when the user asks for it), area key and year for the
//      file name. Out: a download; errors as a toast in plain text.

import React from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { dateiAnbieten, dateiname, tabelleAlsCsv, tabellenAlsXlsx } from "@/lib/accounting/tabellenExport.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * @param {{
 *   modell: import("@/lib/accounting/tabellenExport.js").Tabellenmodell | (() => import("@/lib/accounting/tabellenExport.js").Tabellenmodell),
 *   bereich: string,
 *   jahr: number|string,
 * }} props bereich: area key for the file name, e.g. "ausgangsrechnungen"
 * @returns {React.ReactElement}
 */
export default function ExportKnopf({ modell, bereich, jahr }) {
  const { t } = useI18n();
  const holeModell = () => (typeof modell === "function" ? modell() : modell);

  const exportiere = (/** @type {"csv"|"xlsx"} */ art) => {
    try {
      const m = holeModell();
      if (art === "csv") dateiAnbieten(tabelleAlsCsv(m), dateiname(bereich, jahr, "csv"), "text/csv;charset=utf-8");
      else dateiAnbieten(tabellenAlsXlsx([m]), dateiname(bereich, jahr, "xlsx"), XLSX_MIME);
    } catch (fehler) {
      toast.error(`${t("Export fehlgeschlagen")}: ${/** @type {any} */ (fehler)?.message || String(fehler)}`);
    }
  };

  return (
    <span className="inline-flex flex-wrap gap-2">
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => exportiere("csv")}>
        <Download aria-hidden="true" /> {t("CSV exportieren")}
      </button>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => exportiere("xlsx")}>
        <Download aria-hidden="true" /> {t("Excel exportieren")}
      </button>
    </span>
  );
}
