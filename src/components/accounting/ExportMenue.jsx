// Export menu in the head of /Accounting (79-13, D-P79-26): one button
// "Export" that opens a small panel with
// - "Alle Bereiche als Excel (Jahr)": the overall workbook Buchhaltung_<Jahr>.xlsx
//   (gesamtExport.js — one sheet per area in tab order plus the annual statement),
//   with a year choice from the years that carry bookings;
// - links to every tab ("CSV je Bereich": each tab has its own CSV/Excel buttons);
// - a link to the DATEV section in the annual summary (?tab=annual).
// The project-file dialog with one checkbox per office area (E-07) is 79-12's
// header button; this menu is separate from it.
//
// Radix popover primitives directly (no shadcn wrapper: those cost one tsc error
// per element under the current React typing, see Accounting.jsx): focus trap,
// Escape, click outside and collision handling at 375 px come with it.
//
// In:  props bh (page loader object). Out: the menu; a download; errors as a toast.

import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, Download, FileSpreadsheet, Scale } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { BUCHHALTUNG_REITER } from "@/lib/accounting/reiter.js";
import { dateiAnbieten } from "@/lib/accounting/tabellenExport.js";
import { XLSX_MIME, exportJahre, gesamtArbeitsmappe, gesamtDateiname } from "@/lib/accounting/gesamtExport.js";

const LINK = "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-slate-200 dark:hover:bg-slate-800";

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props bh: page loader object
 * @returns {React.ReactElement}
 */
export default function ExportMenue({ bh }) {
  const { t } = useI18n();
  const [offen, setOffen] = React.useState(false);
  const jahre = React.useMemo(() => exportJahre(bh.daten, bh.heute), [bh.daten, bh.heute]);
  const [jahrWahl, setJahrWahl] = React.useState(() => Number(bh.heute.slice(0, 4)));
  // A chosen year that no longer carries bookings (e.g. after "Beispieldaten
  // entfernen") falls back to the newest one offered.
  const jahr = jahre.includes(jahrWahl) ? jahrWahl : jahre[0];

  const excelLaden = () => {
    try {
      const bytes = gesamtArbeitsmappe(bh.daten, bh.einst, bh.saetze, jahr, t, { heute: bh.heute, projekte: bh.projekte });
      dateiAnbieten(bytes, gesamtDateiname(jahr), XLSX_MIME);
      setOffen(false);
    } catch (fehler) {
      toast.error(`${t("Export fehlgeschlagen")}: ${/** @type {any} */ (fehler)?.message || String(fehler)}`);
    }
  };

  return (
    <Popover.Root open={offen} onOpenChange={setOffen}>
      <Popover.Trigger className={buttonVariants({ variant: "outline" })} data-testid="export-menue-knopf">
        <Download aria-hidden="true" /> {t("Export")} <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={16} aria-label={t("Export der Buchhaltung")}
          data-testid="export-menue"
          className="z-50 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-slate-800 shadow-lg outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <div className="space-y-2">
            <label htmlFor="export-jahr" className="flex items-center justify-between gap-2 text-sm font-medium">
              {t("Jahr")}
              <select id="export-jahr" value={jahr} onChange={(e) => setJahrWahl(Number(e.target.value))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800">
                {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </label>
            <button type="button" className={`${buttonVariants({ variant: "default" })} w-full`} disabled={bh.laedt}
              onClick={excelLaden} data-testid="export-gesamt-excel">
              <FileSpreadsheet aria-hidden="true" /> {t("Alle Bereiche als Excel ({jahr})").replace("{jahr}", String(jahr))}
            </button>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t("Ein Blatt je Bereich in der Reihenfolge der Reiter und die Jahresübersicht — Beträge als Zahlen, Daten als Datum, ohne Formeln.")}
            </p>
          </div>
          <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{t("CSV je Bereich")}</p>
            <p className="px-2 pb-1 text-xs text-slate-600 dark:text-slate-300">{t("Jeder Reiter hat oben eigene Knöpfe für CSV und Excel.")}</p>
            <ul className="grid grid-cols-2 gap-x-1" data-testid="export-menue-reiter">
              {BUCHHALTUNG_REITER.map((r) => (
                <li key={r.key}>
                  <Popover.Close asChild>
                    <Link to={`/Accounting?tab=${r.key}`} className={LINK} data-reiter={r.key}>{t(r.label)}</Link>
                  </Popover.Close>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
            <Popover.Close asChild>
              <Link to="/Accounting?tab=annual" className={LINK} data-testid="export-menue-datev">
                <Scale className="h-4 w-4" aria-hidden="true" /> {t("DATEV-Buchungsstapel im Reiter Jahresübersicht")}
              </Link>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
