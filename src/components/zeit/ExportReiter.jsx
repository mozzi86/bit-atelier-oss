// Tab "Export" of /TimeTracking (phase 81-02, ZEIT-04): hour statements as CSV
// or XLSX through 79's table export (ExportKnopf, one table model for both
// files). Filter month, person, project and status (default: everything except
// rejected). Approved hours are receipts for time-based fees — the tab names the
// retention period of 79 (buchhaltung.aufbewahrung_belege, [ASSUMED] there).
// The file name comes from 79's dateiname(): "buchhaltung-stunden-<YYYY-MM>.csv"
// (the "buchhaltung-" prefix is 79's and accepted — an own name would need a
// change in a 79 file).
//
// In:  props zh, zz. Out: the tab; a download on click.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import ExportKnopf from "@/components/accounting/gemeinsam/ExportKnopf.jsx";
import { gefilterteBuchungen, zeitTabelle } from "@/lib/zeit/zeitExport.js";
import { personAnzeigeName } from "@/lib/zeit/personalQuelle.js";
import { ZEIT_STATUS_LABELS } from "@/lib/zeit/zeitbuchung.js";
import { FELD, LABEL, stundenText } from "./zeitGemeinsam.jsx";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung}} props
 * @returns {React.ReactElement}
 */
export default function ExportReiter({ zh, zz }) {
  const { t, lang } = useI18n();
  const [monat, setMonat] = React.useState(zh.heute.slice(0, 7));
  const [person, setPerson] = React.useState("");
  const [projekt, setProjekt] = React.useState("");
  const [status, setStatus] = React.useState("");
  const filter = { monat, mitarbeiterId: person || null, projectId: projekt || null, status: status ? [status] : null };
  const auswahl = gefilterteBuchungen(zh.daten.Zeitbuchung, filter);
  const summe = auswahl.reduce((s, b) => s + (Number(b.minuten) || 0), 0);

  return (
    <div className="space-y-4" data-testid="zeit-export">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor="export-monat" className={LABEL}>{t("Monat")}</label>
          <input id="export-monat" type="month" className={FELD} value={monat} onChange={(e) => setMonat(e.target.value || zh.heute.slice(0, 7))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="export-person" className={LABEL}>{t("Mitarbeiter:in")}</label>
          <select id="export-person" className={FELD} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{t("Alle")}</option>
            {zz.personen.map((p) => <option key={p.id} value={p.id}>{personAnzeigeName(p, t)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="export-projekt" className={LABEL}>{t("Projekt")}</label>
          <select id="export-projekt" className={FELD} value={projekt} onChange={(e) => setProjekt(e.target.value)}>
            <option value="">{t("Alle")}</option>
            {zh.projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="export-status" className={LABEL}>{t("Status")}</label>
          <select id="export-status" className={FELD} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("alle außer abgelehnt")}</option>
            {Object.entries(ZEIT_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </div>
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="zeit-export-vorschau">
        {t("{n} Buchungen · {h} h").replace("{n}", String(auswahl.length)).replace("{h}", stundenText(summe, lang) || "0")}
      </p>
      <ExportKnopf
        modell={() => zeitTabelle(zh.daten.Zeitbuchung, { mitarbeiter: zz.personen, projekte: zh.projekte, filter }, t)}
        bereich="stunden"
        jahr={monat}
      />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("Stundennachweise für Zeithonorare sind Belege — aufbewahren wie Buchungsbelege ({n} Jahre).").replace("{n}", String(zz.regeln.aufbewahrungJahre ?? "—"))}
      </p>
    </div>
  );
}
