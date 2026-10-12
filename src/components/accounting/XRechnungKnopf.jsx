// "XRechnung" download button of an issued outgoing invoice (phase 93, plan 93-01,
// lever 156). Shown in the invoice list (RechnungenAbschnitt) and in the read-only
// invoice view (RechnungFormular). Builds the XML through exportiereXRechnung();
// while a rule is violated it offers no file but lists every missing piece with
// its rule ID, so the office knows exactly which setting or contract field to fill.
//
// In:  props {bh, rechnung, groesse?}. Reads the letterhead (useBriefkopf) for the
//      office address and contact. Out: a button; side effect = a browser download.

import React from "react";
import { toast } from "sonner";
import { FileCode } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf.js";
import { exportiereXRechnung } from "@/lib/accounting/xrechnung.js";
import { dateiAnbieten } from "@/lib/accounting/tabellenExport.js";

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   rechnung: Record<string, any>,
 *   groesse?: "sm"|"default",
 * }} props
 * @returns {React.ReactElement}
 */
export default function XRechnungKnopf({ bh, rechnung, groesse = "sm" }) {
  const { t } = useI18n();
  const { briefkopf } = useBriefkopf();
  const [fehler, setFehler] = React.useState(/** @type {Array<{regel: string, text: string}>} */ ([]));

  const herunterladen = () => {
    const { xml, dateiname, fehler: verstoesse } = exportiereXRechnung(rechnung, {
      einst: bh.einst, briefkopf, rechnungen: bh.daten.Ausgangsrechnung || [],
    });
    setFehler(verstoesse);
    if (!xml) {
      toast.error(t("XRechnung nicht erstellt — Pflichtangaben fehlen"));
      return;
    }
    dateiAnbieten(new TextEncoder().encode(xml), dateiname, "application/xml;charset=utf-8");
    toast.success(t("XRechnung erstellt"));
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={buttonVariants({ variant: "outline", size: groesse })} onClick={herunterladen}
        data-testid={`xrechnung-${rechnung.id}`} title={t("Elektronische Rechnung nach EN 16931 für öffentliche Auftraggeber")}>
        <FileCode className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("XRechnung")}
      </button>
      {fehler.length > 0 && (
        <ul role="alert" data-testid={`xrechnung-fehler-${rechnung.id}`}
          className="max-w-md list-disc space-y-0.5 rounded-md border border-red-200 bg-red-50 py-1.5 pl-6 pr-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {fehler.map((f) => <li key={f.regel}><span className="font-mono">{f.regel}</span>: {t(f.text)}</li>)}
        </ul>
      )}
    </span>
  );
}
