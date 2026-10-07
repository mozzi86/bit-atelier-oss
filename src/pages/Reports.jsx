// Reports — Berichte & Dokumente: report preview and PDF, schematic drawings,
// imported documents of the active project.
// 72-15 (N-15): change orders of the project go into the report (scoped with
// nachtraegeDesProjekts); without a building record there is no phantom building —
// plans are disabled with a visible reason and the drawings tab shows an empty
// state with the way to a building; no built-in letterhead subtitle.
import { seitenWurzel } from "@core/lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { bitApi } from "@core/api/bitApi";
import { motion } from "framer-motion";
import { Card, CardContent } from "@core/components/ui/card";
import { Button, buttonVariants } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@core/components/ui/tabs";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf";
import { nachtraegeDesProjekts } from "@core/lib/nachtraege";
import { toast } from "sonner";
import {
  FileText, Download, FileDown, Upload, Trash2, FileUp, Ruler, Loader2, Building2, ArrowRight,
} from "lucide-react";
import ReportDocument from "@/components/reports/ReportDocument";
import EmptyState from "@core/components/common/EmptyState";
import { DRAWING_TYPES } from "@/components/reports/Drawings";
import { exportElementToPdf, fileToDataUrl, fmtBytes } from "@core/lib/pdf";
import { pfadText } from "@core/lib/ablage";
import { fmtDate } from "@core/lib/projectModel";

const REPORT_TYPES = [
  { key: "steckbrief", label: "Projektsteckbrief", desc: "Projektdaten auf einen Blick (1 Seite)" },
  { key: "detail", label: "Detaillierter Projektbericht", desc: "Alle Aspekte ausführlich" },
  { key: "status", label: "Zwischenbericht", desc: "Status, Termine, Kosten, offene Punkte" },
  { key: "final", label: "Abschlussbericht", desc: "Endabrechnung & Fazit" },
  { key: "bautagebuch", label: "Bautagebuch", desc: "Tagesbericht: Wetter, Firmen, Leistungen, Vorkommnisse" },
  { key: "protokoll", label: "Besprechungsprotokoll", desc: "Teilnehmer, Themen (TOPs), Festlegungen" },
];

// bitApi.entities is typed as {} for tsc (entities are created at runtime).
const entities = () => /** @type {any} */ (bitApi.entities);

export default function Reports() {
  const { projectId, project } = useProject();
  const { t } = useI18n();
  // building: record, null = loaded and none (no phantom), undefined = not loaded yet.
  // nachtraege: ALL change orders; scoped at render time because the project
  // record may arrive after projectId (deep link ?projekt=… before the list loads).
  const [data, setData] = useState(/** @type {Record<string, any>} */ ({}));
  const [type, setType] = useState("detail");
  const [includeDrawings, setIncludeDrawings] = useState(true);
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("report");
  const [drawing, setDrawing] = useState("plan");
  const [docs, setDocs] = useState([]);
  // The ONE letterhead editor lives in Einstellungen › Büro & Briefkopf (80-03,
  // KRITIK-05) — this page only reads it, live, through the shared hook.
  const { briefkopf } = useBriefkopf();
  const [weather, setWeather] = useState(null);
  const [participants, setParticipants] = useState("");
  const [occasion, setOccasion] = useState("");

  const reportRef = useRef(null);
  const drawingRef = useRef(null);

  const reload = async (pid) => {
    const [energy, issues, lv, tenders, bids, tasks, blds, documents, nachtraege] = await Promise.all([
      entities().EnergyScenario.filter({ project_id: pid }),
      entities().Issue.filter({ project_id: pid }),
      entities().LVPosition.filter({ project_id: pid }),
      entities().Tender.filter({ project_id: pid }),
      entities().Bid.filter({ project_id: pid }),
      entities().ScheduleTask.filter({ project_id: pid }),
      entities().Building.filter({ project_id: pid }),
      entities().Document.filter({ project_id: pid }, "-uploaded_date"),
      // Legacy change orders carry only project_name — no project_id filter here.
      entities().ChangeOrder.list(),
    ]);
    setData({ energy: energy[0], issues, lv, tenders, bids, tasks, building: blds[0] || null, nachtraege });
    setDocs(documents);
  };
  useEffect(() => { if (projectId) reload(projectId); }, [projectId]);

  const berichtDaten = useMemo(
    () => ({ ...data, orders: nachtraegeDesProjekts(data.nachtraege, project) }),
    [data, project],
  );
  const gebaeudeFehlt = data.building === null;

  // Echtes Wetter für das Bautagebuch laden (Projekt-Standort)
  useEffect(() => {
    if (type !== "bautagebuch" || !project?.location?.lat) { setWeather(null); return; }
    let cancelled = false;
    bitApi.apiFetch(`/api/weather?lat=${project.location.lat}&lng=${project.location.lng}`)
      .then((r) => r.json())
      .then((w) => { if (!cancelled) setWeather(w); })
      .catch(() => { if (!cancelled) setWeather(null); });
    return () => { cancelled = true; };
  }, [type, project?.location?.lat, project?.location?.lng]);

  const exportReport = async () => {
    setBusy(true);
    try {
      // Ablage: Protokolle gehen nach 07_Berichtswesen/Protokolle, alle übrigen
      // Berichtsarten ebenfalls ins Berichtswesen — entschieden wird das in
      // @core/lib/ordnerBaum.js, hier wird nur der Typ genannt.
      const r = await exportElementToPdf(reportRef.current, `${project?.name || "Bericht"}_${type}.pdf`, {
        ablage: {
          projectId,
          typ: type === "protokoll" ? "Protokoll" : "Bericht",
          notiz: `Berichtsart „${type}", erzeugt aus der Berichte-Seite`,
        },
      });
      toast.success(r?.abgelegt ? `PDF exportiert und abgelegt: ${pfadText(r.pfad)}` : "PDF exportiert");
    } catch { toast.error("Export fehlgeschlagen"); }
    setBusy(false);
  };

  const exportDrawing = async () => {
    setBusy(true);
    try {
      const r = await exportElementToPdf(drawingRef.current, `${project?.name || "Zeichnung"}_${drawing}.pdf`, {
        orientation: "landscape",
        ablage: { projectId, typ: "Plan-PDF", notiz: `Zeichnung „${drawing}", erzeugt aus der Berichte-Seite` },
      });
      toast.success(r?.abgelegt ? `Zeichnung exportiert und abgelegt: ${pfadText(r.pfad)}` : "Zeichnung exportiert");
    } catch { toast.error("Export fehlgeschlagen"); }
    setBusy(false);
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      await bitApi.entities.Document.create({
        project_id: projectId, name: file.name, size: file.size,
        mime: file.type, data: dataUrl, uploaded_date: new Date().toISOString(),
      });
      toast.success(`„${file.name}" importiert`);
      reload(projectId);
    } catch { toast.error("Import fehlgeschlagen"); }
    setBusy(false);
    e.target.value = "";
  };

  const openDoc = (doc) => {
    const w = window.open();
    if (w) w.document.write(`<iframe src="${doc.data}" style="border:0;width:100%;height:100%"></iframe>`);
  };
  const deleteDoc = async (id) => { await bitApi.entities.Document.delete(id); reload(projectId); };

  const DrawingComp = DRAWING_TYPES.find((d) => d.key === drawing)?.Comp;

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-between items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
              <FileText className="w-7 h-7 text-emerald-600" /> Berichte & Dokumente
            </h1>
            <p className="text-slate-600 mt-1">
              Berichte erzeugen, Pläne exportieren und PDFs importieren — alles als PDF
              {project && <> · <span className="font-medium text-slate-700">{project.name}</span></>}
            </p>
          </div>
        </motion.div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100">
            <TabsTrigger value="report"><FileText className="w-4 h-4 mr-2" /> Bericht</TabsTrigger>
            <TabsTrigger value="drawings"><Ruler className="w-4 h-4 mr-2" /> Zeichnungen</TabsTrigger>
            <TabsTrigger value="docs"><FileUp className="w-4 h-4 mr-2" /> Dokumente</TabsTrigger>
          </TabsList>

          {/* Report */}
          <TabsContent value="report" className="pt-4">
            <div className="grid lg:grid-cols-[300px_1fr] gap-6">
              <div className="space-y-3">
                <Card className="border-0 shadow-sm rounded-xl"><CardContent className="p-4 space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Berichtstyp</label>
                    <div className="space-y-2">
                      {REPORT_TYPES.map((r) => (
                        <button key={r.key} onClick={() => setType(r.key)}
                          className={`w-full text-left rounded-lg border p-2.5 transition-colors ${type === r.key ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}>
                          <div className="text-sm font-medium text-slate-800">{r.label}</div>
                          <div className="text-[11px] text-slate-500">{r.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {type === "status" && (
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Berichtszeitraum</label>
                      <input className="w-full border rounded-md px-2 py-1.5 text-sm" placeholder="z.B. KW 23/2026" value={period} onChange={(e) => setPeriod(e.target.value)} />
                    </div>
                  )}
                  {type === "protokoll" && (
                    <>
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Teilnehmer (Komma-getrennt)</label>
                        <input className="w-full border rounded-md px-2 py-1.5 text-sm" placeholder="z.B. A. Meier, B. Huber" value={participants} onChange={(e) => setParticipants(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Ort/Anlass</label>
                        <input className="w-full border rounded-md px-2 py-1.5 text-sm" placeholder="z.B. Baubesprechung, Baustelle" value={occasion} onChange={(e) => setOccasion(e.target.value)} />
                      </div>
                    </>
                  )}
                  <label className={`flex items-center gap-2 text-sm ${data.building ? "text-slate-700" : "text-slate-400"}`}>
                    <input type="checkbox" checked={includeDrawings && !!data.building} disabled={!data.building}
                      aria-describedby={gebaeudeFehlt ? "bericht-plaene-grund" : undefined}
                      onChange={(e) => setIncludeDrawings(e.target.checked)} />
                    Pläne (Grundriss/Ansicht/Schnitt) anhängen
                  </label>
                  {gebaeudeFehlt && (
                    <p id="bericht-plaene-grund" className="text-[11px] text-slate-500 -mt-2">
                      {t("Pläne lassen sich erst mit einem Gebäude anhängen – für dieses Projekt ist noch keins angelegt.")}
                    </p>
                  )}
                  <Button onClick={exportReport} disabled={busy || !project} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />} Als PDF exportieren
                  </Button>
                </CardContent></Card>

                <Card className="border-0 shadow-sm rounded-xl"><CardContent className="p-4 space-y-1.5">
                  <div className="text-xs text-slate-500">{t("Briefkopf")}</div>
                  <div className="text-sm font-medium text-slate-800">{briefkopf.office}</div>
                  {briefkopf.tagline && <div className="text-[11px] text-slate-400">{briefkopf.tagline}</div>}
                  {(briefkopf.address || briefkopf.contact) && (
                    <div className="text-[11px] text-slate-500">{[briefkopf.address, briefkopf.contact].filter(Boolean).join(" · ")}</div>
                  )}
                  <Link to="/Settings?tab=office" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                    {t("In den Einstellungen ändern")} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                  </Link>
                </CardContent></Card>
              </div>

              {/* Live preview */}
              <div className="overflow-auto rounded-xl bg-slate-200/60 p-4">
                <ReportDocument docRef={reportRef} project={project} data={berichtDaten} type={type}
                  options={{ includeDrawings, period, date: new Date().toISOString(), briefkopf, weather, participants, occasion }} />
              </div>
            </div>
          </TabsContent>

          {/* Drawings */}
          <TabsContent value="drawings" className="pt-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {DRAWING_TYPES.map((d) => (
                <Button key={d.key} variant={drawing === d.key ? "default" : "outline"} size="sm" disabled={!data.building} onClick={() => setDrawing(d.key)}>{d.label}</Button>
              ))}
              <Button onClick={exportDrawing} disabled={busy || !project || !data.building}
                aria-describedby={gebaeudeFehlt ? "bericht-plan-pdf-grund" : undefined}
                className="ml-auto bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} Plan als PDF
              </Button>
              {gebaeudeFehlt && (
                <p id="bericht-plan-pdf-grund" className="w-full text-right text-xs text-slate-500">
                  {t("Plan als PDF ist erst mit einem Gebäude möglich – für dieses Projekt ist noch keins angelegt.")}
                </p>
              )}
            </div>
            {gebaeudeFehlt ? (
              <EmptyState
                icon={Building2}
                title={t("Noch kein Gebäude für dieses Projekt")}
                description={t("Setzen Sie einen Baukörper im Komplex-Designer oder laden Sie ein IFC-Modell – dann entstehen hier Grundriss, Ansicht und Schnitt.")}
                action={(
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link to="/ComplexDesigner?tab=studio" className={buttonVariants({ size: "sm" })}>
                      {t("Baukörper im Komplex-Designer setzen")}
                    </Link>
                    <Link to="/IfcViewer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {t("IFC laden")}
                    </Link>
                  </div>
                )}
              />
            ) : (
              <Card className="border-0 shadow-sm rounded-xl"><CardContent className="p-4">
                <div ref={drawingRef} className="bg-white p-4">
                  {DrawingComp && project && data.building && <DrawingComp building={data.building} project={project} />}
                </div>
              </CardContent></Card>
            )}
          </TabsContent>

          {/* Documents */}
          <TabsContent value="docs" className="pt-4">
            <Card className="mb-4 border-2 border-dashed border-slate-200 shadow-none rounded-xl">
              <CardContent className="p-6 text-center">
                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-500 mb-3">PDF oder Dokument zum Projekt importieren</p>
                <label>
                  <input type="file" accept="application/pdf,image/*" className="hidden" onChange={onUpload} />
                  <span className="inline-flex items-center px-4 py-2 rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm cursor-pointer shadow-sm hover:shadow-md transition-shadow">
                    <FileUp className="w-4 h-4 mr-2" /> Datei wählen
                  </span>
                </label>
              </CardContent>
            </Card>
            <div className="space-y-2">
              {docs.length === 0 && (
                <EmptyState
                  icon={FileUp}
                  title="Noch keine Dokumente"
                  description="Importieren Sie eine PDF oder ein Dokument zum Projekt, um es hier abzulegen."
                />
              )}
              {docs.map((d) => (
                <Card key={d.id} className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow"><CardContent className="p-3 flex flex-wrap items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-100 text-rose-600 shrink-0"><FileText className="w-5 h-5" /></div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-medium text-slate-800 truncate">{d.name}</div>
                    <div className="text-xs text-slate-400">{fmtBytes(d.size)} · {fmtDate(d.uploaded_date)}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openDoc(d)}><Download className="w-3.5 h-3.5 mr-1" /> Öffnen</Button>
                  <Button variant="ghost" size="icon" aria-label="Dokument löschen" className="text-rose-500 hover:text-rose-600 hover:bg-rose-50" onClick={() => deleteDoc(d.id)}><Trash2 className="w-4 h-4" /></Button>
                </CardContent></Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
