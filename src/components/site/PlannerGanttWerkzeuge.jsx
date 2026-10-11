// 90-09: toolbar above the site Gantt (SiteControl › Terminplan): import a Planner Excel export into the
// existing ScheduleTask list and print the Gantt as one large-format landscape PDF (A0–A3).
// Import dialog: file → found sheet/header row/columns, top-level branches with progress, branch choice,
// exclusions, preview count → "Importieren" replaces the tasks of an EARLIER planner import, manual tasks stay.
//
// In:  tasks (ScheduleTasks of the project), projectId, project, onReload().
// Out: toolbar + dialog; data-testids pg-import, pg-datei, pg-info (data-vorgaenge, data-blatt), pg-zweig,
//      pg-ausschluss, pg-vorschau (data-anzahl), pg-uebernehmen, pg-format, pg-pdf, pg-fehler.
import React, { useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Button } from "@core/components/ui/button";
import FormModal from "@core/components/common/FormModal";
import { useI18n } from "@core/lib/i18n";
import { FileSpreadsheet, Printer } from "lucide-react";
import { plannerLesen, hauptzweige, filtern, alsScheduleTasks, ersetzenPlan } from "@/lib/planung/plannerImport";
import { ganttPdf, FORMATE } from "@/lib/planung/ganttPdf";

/**
 * @param {{tasks: Array<any>, projectId: string, project: any, onReload: () => any}} props
 */
export default function PlannerGanttWerkzeuge({ tasks, projectId, project, onReload }) {
  const { t } = useI18n();
  const [offen, setOffen] = useState(false);
  const [stand, setStand] = useState(/** @type {null | {datei: string, daten: ReturnType<typeof plannerLesen>}} */ (null));
  const [zweig, setZweig] = useState("");
  const [ausschluss, setAusschluss] = useState("");
  const [format, setFormat] = useState(/** @type {keyof typeof FORMATE} */ ("A1"));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [info, setInfo] = useState(/** @type {string|null} */ (null));

  const lesen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setFehler(null); setStand(null); setInfo(null); setZweig(""); setAusschluss("");
    if (!file) return;
    try {
      setStand({ datei: file.name, daten: plannerLesen(new Uint8Array(await file.arrayBuffer())) });
    } catch (err) { setFehler(err instanceof Error ? err.message : String(err)); }
  };
  const auswahl = stand ? filtern(stand.daten.vorgaenge, { zweig, ausschliessen: ausschluss }) : [];
  const plan = ersetzenPlan(tasks);

  const uebernehmen = async () => {
    if (!stand || !auswahl.length || busy) return;
    setBusy(true); setFehler(null);
    try {
      for (const id of plan.loeschen) await bitApi.entities.ScheduleTask.delete(id);
      for (const rec of alsScheduleTasks(auswahl, { projektId: projectId, datei: stand.datei })) await bitApi.entities.ScheduleTask.create(rec);
      await onReload();
      setInfo(`${auswahl.length} ${t("Vorgänge importiert")} · ${plan.loeschen.length} ${t("frühere Planner-Vorgänge ersetzt")} · ${plan.behalten} ${t("eigene Aufgaben unverändert")}`);
      setOffen(false); setStand(null);
    } catch (err) { setFehler(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  const pdf = async () => {
    setFehler(null);
    try {
      const { bytes, dateiname } = await ganttPdf(tasks, project, { format });
      const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = dateiname; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setFehler(err instanceof Error ? err.message : String(err)); }
  };

  const feld = "h-8 rounded-md border border-slate-300 bg-white px-2 text-xs";
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { setOffen(true); setInfo(null); }} data-testid="pg-import"><FileSpreadsheet className="mr-1.5 h-4 w-4" /> {t("Planner-Excel importieren")}</Button>
        <select className={feld} value={format} onChange={(e) => setFormat(/** @type {any} */ (e.target.value))} data-testid="pg-format" aria-label={t("Papierformat")}>
          {Object.keys(FORMATE).map((f) => <option key={f} value={f}>{f} {t("quer")}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={pdf} disabled={!tasks.length} data-testid="pg-pdf"><Printer className="mr-1.5 h-4 w-4" /> {t("Gantt als PDF")}</Button>
      </div>
      {info && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800" role="status">{info}</div>}
      {fehler && !offen && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800" role="alert" data-testid="pg-fehler">{fehler}</div>}

      {offen && (
        <FormModal title={t("Planner-Excel importieren")} onClose={() => setOffen(false)}>
          <div className="space-y-3 text-xs">
            <label className="block"><span className="text-slate-500">{t("Planner-Export (.xlsx)")}</span>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={lesen} className="mt-1 block w-full" data-testid="pg-datei" /></label>
            {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800" role="alert" data-testid="pg-fehler">{fehler}</div>}
            {stand && (
              <>
                <div className="rounded border bg-slate-50 p-2" data-testid="pg-info" data-vorgaenge={stand.daten.vorgaenge.length} data-blatt={stand.daten.blatt}>
                  {t("Blatt")} „{stand.daten.blatt}“ · {t("Kopfzeile")} {stand.daten.kopfZeile} · {stand.daten.vorgaenge.length} {t("Vorgänge")}
                  <div className="text-slate-400">{Object.entries(stand.daten.spalten).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
                  {stand.daten.warnungen.length > 0 && <div className="text-amber-800">{stand.daten.warnungen.slice(0, 3).join(" · ")}{stand.daten.warnungen.length > 3 ? " …" : ""}</div>}
                </div>
                <label className="block"><span className="text-slate-500">{t("Zweig")}</span>
                  <select className={`${feld} w-full`} value={zweig} onChange={(e) => setZweig(e.target.value)} data-testid="pg-zweig">
                    <option value="">{t("Kompletter Plan")}</option>
                    {hauptzweige(stand.daten.vorgaenge).filter((z) => z.gliederung).map((z) => (
                      <option key={z.gliederung} value={z.gliederung}>{z.gliederung} {z.name} ({z.erledigt ? t("erledigt") : `${z.fortschritt} %`}, {z.anzahl})</option>
                    ))}
                  </select></label>
                <label className="block"><span className="text-slate-500">{t("Ausschließen (Gliederungsnummern oder Namen, mit Komma)")}</span>
                  <input className={`${feld} w-full`} value={ausschluss} onChange={(e) => setAusschluss(e.target.value)} data-testid="pg-ausschluss" /></label>
                <div data-testid="pg-vorschau" data-anzahl={auswahl.length}>
                  <b>{auswahl.length}</b> {t("Vorgänge werden übernommen.")} {plan.loeschen.length > 0 && <>{plan.loeschen.length} {t("frühere Planner-Vorgänge werden ersetzt.")} </>}{t("Eigene Aufgaben bleiben unverändert.")}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOffen(false)}>{t("Abbrechen")}</Button>
              <Button type="button" onClick={uebernehmen} disabled={!stand || !auswahl.length || busy} data-testid="pg-uebernehmen" className="bg-gradient-to-r from-emerald-600 to-teal-600">{busy ? t("Speichern…") : t("Importieren")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </div>
  );
}
