// PDF-Studio: PDFs anzeigen, kommentieren, annotieren, Ebenen (OCG) schalten,
// annotiert exportieren. Rendering via pdfjs-dist v6, Export via jsPDF.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { jsPDF } from "jspdf";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { Textarea } from "@core/components/ui/textarea";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  FileText, FileUp, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize,
  MousePointer2, MapPin, PenLine, Type, Trash2, Layers, MessageSquare,
  FileDown, Loader2, Upload, Eye, EyeOff,
} from "lucide-react";
import { fileToDataUrl, fmtBytes } from "@core/lib/pdf";
import { fmtDate } from "@core/lib/projectModel";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#0f172a"];

const TOOLS = [
  { key: "select", label: "Auswahl", Icon: MousePointer2 },
  { key: "pin", label: "Kommentar-Pin", Icon: MapPin },
  { key: "ink", label: "Freihand", Icon: PenLine },
  { key: "text", label: "Text", Icon: Type },
];

const isPdf = (d) => d.mime === "application/pdf" || (d.name || "").toLowerCase().endsWith(".pdf");

// data-URL -> frische Bytes (pdfjs v6 transferiert den Buffer, daher je Aufruf neu erzeugen)
function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// OCG-Order kann verschachtelt sein (Strings + { name, order })
function flattenOcgOrder(order, out = []) {
  for (const item of order || []) {
    if (typeof item === "string") out.push(item);
    else if (item && Array.isArray(item.order)) flattenOcgOrder(item.order, out);
  }
  return out;
}

const pathFromPoints = (points, w, h) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x * w).toFixed(1)} ${(p.y * h).toFixed(1)}`).join(" ");

// Anmerkungen einer Seite in einen 2D-Context zeichnen (für den Export)
function drawAnnotationsToCanvas(ctx, w, h, pageAnns) {
  const pins = pageAnns.filter((a) => a.type === "pin")
    .sort((a, b) => (a.created_date || "").localeCompare(b.created_date || ""));
  for (const a of pageAnns) {
    const color = a.color || COLORS[0];
    if (a.type === "ink" && Array.isArray(a.points) && a.points.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, w * 0.002);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      a.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x * w, p.y * h);
        else ctx.lineTo(p.x * w, p.y * h);
      });
      ctx.stroke();
    } else if (a.type === "text" && a.text) {
      ctx.fillStyle = color;
      ctx.font = `${Math.round(w * 0.016)}px Helvetica, Arial, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(a.text, a.x * w, a.y * h);
    } else if (a.type === "pin") {
      const num = pins.indexOf(a) + 1;
      const r = Math.max(9, w * 0.011);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(a.x * w, a.y * h, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1.5, r * 0.15);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(r * 1.1)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), a.x * w, a.y * h);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
  }
}

export default function PdfStudio({ project, openDoc, refreshKey }) {
  // Dokumente
  const [docs, setDocs] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [busy, setBusy] = useState(false);

  // PDF / Viewer
  const [pdf, setPdf] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoomPct, setZoomPct] = useState(100);
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 });
  const [pageBase, setPageBase] = useState({ w: 595, h: 842 });
  const [renderTick, setRenderTick] = useState(0);

  // Ebenen (OCG)
  const [layers, setLayers] = useState([]);
  const ocgRef = useRef(null);

  // Anmerkungen
  const [anns, setAnns] = useState([]);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(COLORS[0]);
  const [author, setAuthor] = useState("");
  const [selectedAnnId, setSelectedAnnId] = useState(null);
  const [draftPin, setDraftPin] = useState(null); // { x, y }
  const [pinText, setPinText] = useState("");
  const [draftText, setDraftText] = useState(null); // { x, y, value }
  const [inkPreview, setInkPreview] = useState(null);

  // Export
  const [exporting, setExporting] = useState(null); // { cur, total }

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const renderTaskRef = useRef(null);
  const inkPointsRef = useRef([]);
  const drawingRef = useRef(false);

  // ---------- Dokumente laden ----------
  const loadDocs = useCallback(async () => {
    if (!project?.id) { setDocs([]); return; }
    const rows = await bitApi.entities.Document.filter({ project_id: project.id }, "-uploaded_date");
    setDocs(rows.filter(isPdf));
  }, [project?.id]);

  useEffect(() => {
    setSelectedDoc(null);
    setPdf(null);
    loadDocs();
  }, [loadDocs]);

  // Von außen geöffnetes Dokument (z. B. Kachel "Kommentieren & Anmerken")
  useEffect(() => {
    if (openDoc) setSelectedDoc(openDoc);
  }, [openDoc]);

  // Liste auffrischen, wenn Werkzeuge neue Dokumente gespeichert haben
  useEffect(() => {
    if (refreshKey) loadDocs();
  }, [refreshKey, loadDocs]);

  // ---------- PDF + Anmerkungen laden ----------
  useEffect(() => {
    if (!selectedDoc) { setPdf(null); setAnns([]); setLayers([]); return; }
    let cancelled = false;
    let pdfDoc = null;
    (async () => {
      try {
        setPdf(null); // altes Dokument sofort abkoppeln (wird im Cleanup zerstoert)
        setAnns([]);
        setPageNum(1);
        setSelectedAnnId(null);
        setDraftPin(null);
        setDraftText(null);
        const bytes = dataUrlToBytes(selectedDoc.data);
        pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) { pdfDoc.destroy(); return; }

        // Ebenen-Konfiguration
        let layerList = [];
        try {
          const cfg = await pdfDoc.getOptionalContentConfig();
          ocgRef.current = cfg;
          const ids = flattenOcgOrder(cfg.getOrder());
          layerList = ids.map((id) => {
            const g = cfg.getGroup(id);
            return { id, name: g?.name || String(id), visible: g?.visible !== false };
          });
        } catch { ocgRef.current = null; }
        if (cancelled) { pdfDoc.destroy(); return; }

        setLayers(layerList);
        setPdf(pdfDoc);

        const rows = await bitApi.entities.PdfAnnotation.filter({ document_id: selectedDoc.id });
        if (!cancelled) setAnns(rows || []);
      } catch (err) {
        console.error("PDF laden fehlgeschlagen", err);
        toast.error("PDF konnte nicht geladen werden");
      }
    })();
    return () => {
      cancelled = true;
      try { renderTaskRef.current?.cancel(); } catch { /* noop */ }
      if (pdfDoc) { try { pdfDoc.destroy(); } catch { /* noop */ } }
    };
  }, [selectedDoc]);

  // ---------- Seite rendern ----------
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const vp1 = page.getViewport({ scale: 1 });
        setPageBase({ w: vp1.width, h: vp1.height });
        const scale = zoomPct / 100;
        const dpr = window.devicePixelRatio || 1;
        const vpCss = page.getViewport({ scale });
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(vpCss.width)}px`;
        canvas.style.height = `${Math.floor(vpCss.height)}px`;
        setCssSize({ w: Math.floor(vpCss.width), h: Math.floor(vpCss.height) });
        const ctx = canvas.getContext("2d");
        try { renderTaskRef.current?.cancel(); } catch { /* noop */ }
        const task = page.render({
          canvas,
          canvasContext: ctx,
          viewport: vp,
          optionalContentConfigPromise: ocgRef.current ? Promise.resolve(ocgRef.current) : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("Seiten-Rendering fehlgeschlagen", err);
        }
      }
    })();
    return () => {
      cancelled = true;
      try { renderTaskRef.current?.cancel(); } catch { /* noop */ }
    };
  }, [pdf, pageNum, zoomPct, renderTick]);

  // ---------- Upload ----------
  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !project?.id) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const created = await bitApi.entities.Document.create({
        project_id: project.id, name: file.name, size: file.size,
        mime: file.type, data: dataUrl, uploaded_date: new Date().toISOString(),
      });
      toast.success(`"${file.name}" hochgeladen`);
      await loadDocs();
      setSelectedDoc(created);
    } catch { toast.error("Upload fehlgeschlagen"); }
    setBusy(false);
    e.target.value = "";
  };

  // ---------- Koordinaten ----------
  const toNorm = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  // ---------- Anmerkungen: erstellen / löschen ----------
  const createAnn = async (payload) => {
    try {
      const created = await bitApi.entities.PdfAnnotation.create({
        document_id: selectedDoc.id,
        page: pageNum,
        color,
        author: author.trim() || "Anonym",
        created_date: new Date().toISOString(),
        ...payload,
      });
      setAnns((list) => [...list, created]);
      return created;
    } catch {
      toast.error("Anmerkung konnte nicht gespeichert werden");
      return null;
    }
  };

  const deleteAnn = async (id) => {
    try {
      await bitApi.entities.PdfAnnotation.delete(id);
      setAnns((list) => list.filter((a) => a.id !== id));
      if (selectedAnnId === id) setSelectedAnnId(null);
    } catch { toast.error("Löschen fehlgeschlagen"); }
  };

  // ---------- Pointer-Handler (Overlay) ----------
  const onPointerDown = (e) => {
    if (!selectedDoc || !cssSize.w || e.button !== 0) return;
    if (tool === "select") return;
    const pos = toNorm(e);
    if (tool === "pin") {
      setDraftText(null);
      setDraftPin(pos);
      setPinText("");
    } else if (tool === "text") {
      setDraftPin(null);
      setDraftText({ ...pos, value: "" });
    } else if (tool === "ink") {
      drawingRef.current = true;
      inkPointsRef.current = [pos];
      setInkPreview([pos]);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
  };

  const onPointerMove = (e) => {
    if (tool !== "ink" || !drawingRef.current) return;
    const pos = toNorm(e);
    inkPointsRef.current.push(pos);
    setInkPreview([...inkPointsRef.current]);
  };

  const onPointerUp = async () => {
    if (tool !== "ink" || !drawingRef.current) return;
    drawingRef.current = false;
    const points = inkPointsRef.current;
    inkPointsRef.current = [];
    setInkPreview(null);
    if (points.length > 1) {
      await createAnn({ type: "ink", x: points[0].x, y: points[0].y, points, text: "" });
    }
  };

  // ---------- Drafts bestaetigen ----------
  const savePin = async () => {
    if (!draftPin) return;
    const created = await createAnn({ type: "pin", x: draftPin.x, y: draftPin.y, text: pinText.trim() });
    if (created) setSelectedAnnId(created.id);
    setDraftPin(null);
    setPinText("");
  };

  const saveText = async () => {
    if (!draftText) return;
    const value = draftText.value.trim();
    setDraftText(null);
    if (value) await createAnn({ type: "text", x: draftText.x, y: draftText.y, text: value });
  };

  // ---------- Ebenen ----------
  const toggleLayer = (id) => {
    const cfg = ocgRef.current;
    if (!cfg) return;
    setLayers((list) => list.map((l) => {
      if (l.id !== id) return l;
      try { cfg.setVisibility(id, !l.visible); } catch { /* noop */ }
      return { ...l, visible: !l.visible };
    }));
    setRenderTick((t) => t + 1);
  };

  // ---------- Zoom ----------
  const clampZoom = (v) => Math.min(300, Math.max(50, v));
  const zoomFit = () => {
    const container = scrollRef.current;
    if (!container || !pageBase.w) return;
    const avail = container.clientWidth - 48;
    setZoomPct(clampZoom(Math.round((avail / pageBase.w) * 100)));
  };

  // ---------- Export ----------
  const exportAnnotated = async () => {
    if (!pdf || !selectedDoc || exporting) return;
    setExporting({ cur: 0, total: pdf.numPages });
    try {
      let out = null;
      for (let p = 1; p <= pdf.numPages; p++) {
        setExporting({ cur: p, total: pdf.numPages });
        const page = await pdf.getPage(p);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport: vp,
          optionalContentConfigPromise: ocgRef.current ? Promise.resolve(ocgRef.current) : undefined,
        }).promise;
        drawAnnotationsToCanvas(ctx, canvas.width, canvas.height, anns.filter((a) => a.page === p));
        const img = canvas.toDataURL("image/jpeg", 0.9);
        const orientation = vp1.width > vp1.height ? "landscape" : "portrait";
        if (!out) out = new jsPDF({ orientation, unit: "pt", format: [vp1.width, vp1.height] });
        else out.addPage([vp1.width, vp1.height], orientation);
        out.addImage(img, "JPEG", 0, 0, vp1.width, vp1.height);
      }
      out.save(`${selectedDoc.name.replace(/\.pdf$/i, "")}_annotiert.pdf`);
      toast.success("Annotiertes PDF exportiert");
    } catch (err) {
      console.error("Export fehlgeschlagen", err);
      toast.error("Export fehlgeschlagen");
    }
    setExporting(null);
  };

  // ---------- Abgeleitete Daten ----------
  const pageAnns = useMemo(() => anns.filter((a) => a.page === pageNum), [anns, pageNum]);
  const pagePins = useMemo(
    () => pageAnns.filter((a) => a.type === "pin")
      .sort((a, b) => (a.created_date || "").localeCompare(b.created_date || "")),
    [pageAnns]
  );
  const allPins = useMemo(() => {
    const pins = anns.filter((a) => a.type === "pin");
    const byPage = {};
    pins.forEach((p) => { (byPage[p.page] = byPage[p.page] || []).push(p); });
    Object.values(byPage).forEach((arr) =>
      arr.sort((a, b) => (a.created_date || "").localeCompare(b.created_date || "")));
    return Object.keys(byPage).map(Number).sort((a, b) => a - b)
      .flatMap((pg) => byPage[pg].map((pin, i) => ({ ...pin, num: i + 1 })));
  }, [anns]);

  const { w: W, h: H } = cssSize;

  if (!project) {
    return (
      <Card className="border-0 shadow-sm rounded-xl">
        <CardContent className="p-10 text-center text-slate-500">
          <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          Bitte Projekt wählen, um das PDF-Studio zu nutzen.
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_290px]">

      {/* ---------- Linke Spalte: Dokumente ---------- */}
      <div className="space-y-3">
        <Card className="border-0 shadow-sm rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" /> PDF-Dokumente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="block">
              <input type="file" accept="application/pdf" className="hidden" onChange={onUpload} disabled={busy} />
              <span className="w-full inline-flex items-center justify-center px-3 py-2 rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm cursor-pointer shadow-sm hover:shadow-md transition-shadow">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                PDF hochladen
              </span>
            </label>
            {docs.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">
                Noch keine PDFs im Projekt. Laden Sie eine Datei hoch.
              </p>
            )}
            <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
              {docs.map((d) => (
                <button key={d.id} onClick={() => setSelectedDoc(d)}
                  className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                    selectedDoc?.id === d.id
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}>
                  <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                    <FileUp className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {fmtBytes(d.size)} · {fmtDate(d.uploaded_date)}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Mitte: Viewer ---------- */}
      <div className="space-y-3 min-w-0">
        {/* Toolbar */}
        <Card className="border-0 shadow-sm rounded-xl">
          <CardContent className="p-2.5 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Vorherige Seite" disabled={!pdf || pageNum <= 1}
              onClick={() => setPageNum((n) => Math.max(1, n - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-slate-600 min-w-[90px] text-center">
              {pdf ? `Seite ${pageNum} / ${pdf.numPages}` : "Seite – / –"}
            </span>
            <Button variant="outline" size="icon" aria-label="Naechste Seite" disabled={!pdf || pageNum >= (pdf?.numPages || 1)}
              onClick={() => setPageNum((n) => Math.min(pdf.numPages, n + 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-slate-200 mx-1" />

            <Button variant="outline" size="icon" aria-label="Verkleinern" disabled={!pdf}
              onClick={() => setZoomPct((z) => clampZoom(z - 25))}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm text-slate-600 w-12 text-center">{zoomPct} %</span>
            <Button variant="outline" size="icon" aria-label="Vergrößern" disabled={!pdf}
              onClick={() => setZoomPct((z) => clampZoom(z + 25))}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Seitenbreite einpassen" disabled={!pdf} onClick={zoomFit}>
              <Maximize className="w-4 h-4" />
            </Button>

            <span className="ml-auto text-sm text-slate-500 truncate max-w-[200px]" title={selectedDoc?.name}>
              {selectedDoc?.name || "Kein Dokument gewählt"}
            </span>
            <Button onClick={exportAnnotated} disabled={!pdf || !!exporting}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md">
              {exporting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exportiere Seite {exporting.cur}/{exporting.total}</>
                : <><FileDown className="w-4 h-4 mr-2" /> Annotiert exportieren</>}
            </Button>
          </CardContent>
        </Card>

        {/* Werkzeug-Toolbar */}
        <Card className="border-0 shadow-sm rounded-xl">
          <CardContent className="p-2.5 flex flex-wrap items-center gap-2">
            {TOOLS.map(({ key, label, Icon }) => (
              <Button key={key} variant={tool === key ? "default" : "outline"} size="sm"
                disabled={!pdf} onClick={() => { setTool(key); setDraftPin(null); setDraftText(null); }}>
                <Icon className="w-3.5 h-3.5 mr-1.5" /> {label}
              </Button>
            ))}
            <div className="w-px h-6 bg-slate-200 mx-1" />
            {COLORS.map((c) => (
              <button key={c} aria-label={`Farbe ${c}`} onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  color === c ? "border-slate-800 scale-110" : "border-white shadow"
                }`}
                style={{ backgroundColor: c }} />
            ))}
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <Button variant="outline" size="sm" disabled={!selectedAnnId}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              onClick={() => deleteAnn(selectedAnnId)}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Löschen
            </Button>
          </CardContent>
        </Card>

        {/* Seiten-Canvas + Overlay */}
        <Card className="border-0 shadow-sm rounded-xl">
          <CardContent className="p-0">
            <div ref={scrollRef} className="overflow-auto bg-slate-200/70 rounded-xl p-6 min-h-[420px] max-h-[75vh]">
              {!selectedDoc && (
                <div className="text-center text-slate-500 py-24 text-sm">
                  Wählen Sie links ein PDF-Dokument oder laden Sie eines hoch.
                </div>
              )}
              {selectedDoc && (
                <div className="mx-auto shadow-xl bg-white relative"
                  style={{ width: W || undefined, height: H || undefined }}>
                  <canvas ref={canvasRef} className="block" role="img" aria-label="Gerenderte PDF-Seite" />
                  {/* Anmerkungs-Overlay */}
                  <div ref={overlayRef}
                    className="absolute inset-0 touch-none"
                    style={{ cursor: tool === "select" ? "default" : "crosshair" }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}>
                    {W > 0 && (
                      <svg width={W} height={H} className="absolute inset-0"
                        style={{ pointerEvents: "none" }}>
                        {/* Freihand */}
                        {pageAnns.filter((a) => a.type === "ink" && Array.isArray(a.points) && a.points.length > 1).map((a) => (
                          <path key={a.id} d={pathFromPoints(a.points, W, H)}
                            stroke={a.color} strokeWidth={selectedAnnId === a.id ? 4 : 2.5}
                            fill="none" strokeLinecap="round" strokeLinejoin="round"
                            opacity={selectedAnnId && selectedAnnId !== a.id ? 0.55 : 1}
                            style={{ pointerEvents: tool === "select" ? "stroke" : "none", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); setSelectedAnnId(a.id); }} />
                        ))}
                        {/* Live-Vorschau Freihand */}
                        {inkPreview && inkPreview.length > 1 && (
                          <path d={pathFromPoints(inkPreview, W, H)} stroke={color} strokeWidth={2.5}
                            fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                        {/* Texte */}
                        {pageAnns.filter((a) => a.type === "text" && a.text).map((a) => (
                          <text key={a.id} x={a.x * W} y={a.y * H} fill={a.color}
                            fontSize={Math.max(11, W * 0.016)} fontFamily="Helvetica, Arial, sans-serif"
                            fontWeight={selectedAnnId === a.id ? 700 : 400}
                            style={{ pointerEvents: tool === "select" ? "auto" : "none", cursor: "pointer", userSelect: "none" }}
                            onClick={(e) => { e.stopPropagation(); setSelectedAnnId(a.id); }}>
                            {a.text}
                          </text>
                        ))}
                        {/* Pins */}
                        {pagePins.map((a, i) => (
                          <g key={a.id}
                            style={{ pointerEvents: tool === "select" ? "auto" : "none", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); setSelectedAnnId(a.id); }}>
                            {selectedAnnId === a.id && (
                              <circle cx={a.x * W} cy={a.y * H} r={16} fill="none"
                                stroke={a.color} strokeWidth={2} opacity={0.5} />
                            )}
                            <circle cx={a.x * W} cy={a.y * H} r={11} fill={a.color}
                              stroke="#ffffff" strokeWidth={2} />
                            <text x={a.x * W} y={a.y * H} fill="#ffffff" fontSize={11} fontWeight={700}
                              textAnchor="middle" dominantBaseline="central"
                              fontFamily="Helvetica, Arial, sans-serif" style={{ userSelect: "none" }}>
                              {i + 1}
                            </text>
                          </g>
                        ))}
                      </svg>
                    )}

                    {/* Pin-Entwurf: Popover zur Texteingabe */}
                    {draftPin && (
                      <div className="absolute z-10 bg-white rounded-xl shadow-2xl border border-slate-200 p-3 w-60 space-y-2"
                        style={{
                          left: Math.min(Math.max(draftPin.x * W - 120, 4), Math.max(W - 244, 4)),
                          top: Math.min(draftPin.y * H + 14, Math.max(H - 170, 4)),
                        }}
                        onPointerDown={(e) => e.stopPropagation()}>
                        <div className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5" style={{ color }} /> Neuer Kommentar
                        </div>
                        <Textarea autoFocus rows={3} value={pinText} placeholder="Kommentar eingeben..."
                          onChange={(e) => setPinText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); savePin(); }
                            if (e.key === "Escape") { setDraftPin(null); setPinText(""); }
                          }} />
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" size="sm" onClick={() => { setDraftPin(null); setPinText(""); }}>
                            Abbrechen
                          </Button>
                          <Button size="sm" onClick={savePin}
                            className="bg-gradient-to-r from-emerald-600 to-teal-600">Speichern</Button>
                        </div>
                      </div>
                    )}

                    {/* Text-Entwurf: Inline-Input */}
                    {draftText && (
                      <input autoFocus value={draftText.value} placeholder="Text..."
                        className="absolute z-10 bg-white/95 border border-slate-300 rounded px-1.5 py-0.5 text-sm shadow-lg outline-none"
                        style={{
                          left: Math.min(draftText.x * W, Math.max(W - 160, 0)),
                          top: Math.max(draftText.y * H - 22, 0),
                          color, width: 160,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => setDraftText((d) => ({ ...d, value: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveText();
                          if (e.key === "Escape") setDraftText(null);
                        }}
                        onBlur={saveText} />
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Rechte Spalte: Ebenen + Kommentare ---------- */}
      <div className="space-y-3">
        <Card className="border-0 shadow-sm rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" /> Ebenen
              {layers.length > 0 && <Badge variant="outline" className="text-[10px]">{layers.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {!pdf && <p className="text-xs text-slate-400">Kein Dokument geladen.</p>}
            {pdf && layers.length === 0 && (
              <p className="text-xs text-slate-500">Keine Ebenen in diesem PDF.</p>
            )}
            {layers.map((l) => (
              <label key={l.id}
                className="flex items-center gap-2 text-sm text-slate-700 rounded-md px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={l.visible} onChange={() => toggleLayer(l.id)} />
                {l.visible
                  ? <Eye className="w-3.5 h-3.5 text-slate-400" />
                  : <EyeOff className="w-3.5 h-3.5 text-slate-300" />}
                <span className={`truncate ${l.visible ? "" : "text-slate-400"}`}>{l.name}</span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-600" /> Kommentare
              {allPins.length > 0 && <Badge variant="outline" className="text-[10px]">{allPins.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <label className="text-[11px] text-slate-500 mb-0.5 block">Autor</label>
              <Input value={author} placeholder="Ihr Name" className="h-8 text-sm"
                onChange={(e) => setAuthor(e.target.value)} />
            </div>
            {allPins.length === 0 && (
              <p className="text-xs text-slate-500 pt-1">
                Noch keine Kommentare. Werkzeug "Kommentar-Pin" wählen und auf die Seite klicken.
              </p>
            )}
            <div className="space-y-1.5 max-h-[340px] overflow-auto pr-1">
              {allPins.map((p) => (
                <div key={p.id}
                  onClick={() => { setPageNum(p.page); setSelectedAnnId(p.id); }}
                  className={`rounded-lg border p-2 cursor-pointer transition-colors ${
                    selectedAnnId === p.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"
                  }`}>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                      style={{ backgroundColor: p.color }}>
                      {p.num}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 break-words">
                        {p.text || <span className="text-slate-400 italic">Ohne Text</span>}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Seite {p.page} · {p.author} · {fmtDate(p.created_date)}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Kommentar löschen"
                      className="w-6 h-6 shrink-0 text-rose-400 hover:text-rose-600 hover:bg-rose-50"
                      onClick={(e) => { e.stopPropagation(); deleteAnn(p.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
