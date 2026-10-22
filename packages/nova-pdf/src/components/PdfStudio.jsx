// PDF-Studio: PDFs anzeigen, kommentieren, annotieren, Ebenen (OCG) schalten,
// annotiert exportieren. Rendering via pdfjs-dist v6, Export via jsPDF.
// 104-09: "Im PDF speichern" appends the studio annotations to the file as an incremental update
// (original bytes untouched, lib/pdfSpeichern.js, loaded on demand with pdf-lib); unsaved editing
// state (open drafts, annotations the server did not take) is journalled per document hash and
// offered for restore when the same file is opened again (lib/wiederherstellung.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sichtbareDokumente } from "@core/lib/rechte.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
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
  FileDown, Loader2, Upload, Eye, EyeOff, Save, Download, History,
} from "lucide-react";
import { fileToDataUrl, fmtBytes } from "@core/lib/pdf";
import { inhaltAblegen, inhaltLaden, blobIdNeu } from "@core/lib/speicherOrt";
import { fmtDate } from "@core/lib/projectModel";
import { useI18n } from "@core/lib/i18n";
import { enthaeltStudioMarke, istFestgeschrieben, pdfStandVergleich } from "../lib/studioStand.js";
import {
  AUTOSAVE_MS, browserSpeicher, dokumentHash, journalAufraeumen, journalBauen, journalLaden,
  journalSpeichern, wiederherstellungsPlan,
} from "../lib/wiederherstellung.js";

/**
 * Releases a pdf.js document. Since pdfjs-dist 6 PDFDocumentProxy has no destroy(); the loading
 * task owns the worker resources (same rule as schliessePdfjs in pdfTools.js, not imported here so
 * pdf-lib stays out of this chunk). The old pdfDoc.destroy() threw on a quick document switch and
 * showed "PDF konnte nicht geladen werden". Errors while releasing are harmless and swallowed.
 * @param {any} doc PDFDocumentProxy
 */
function pdfFreigeben(doc) {
  try { doc?.loadingTask?.destroy?.(); } catch { /* noop */ }
}

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
  const { t } = useI18n();
  // Dokumente
  // 82-02: only documents the role may see (Document.bereich: personnel, accounting, correspondence, fee PDFs).
  const zugriff = useZugriff();
  const [rohDocs, setDocs] = useState([]);
  const docs = useMemo(() => sichtbareDokumente(rohDocs, zugriff), [rohDocs, zugriff]);
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

  // 104-09: saving into the PDF + crash recovery
  const speicher = useMemo(() => browserSpeicher(), []);
  const [loeschungen, setLoeschungen] = useState([]); // record ids whose deletion did not reach the server
  const [geladen, setGeladen] = useState(null); // { docId, hash } once file + records + journal check are done
  const [angebot, setAngebot] = useState(null); // restore offer (wiederherstellungsPlan) or null
  const [pdfSpeichern, setPdfSpeichern] = useState(false);
  const seiteNachLadenRef = useRef(null);
  const journalOffenRef = useRef(null); // { hash, journal } not yet written
  const journalTimerRef = useRef(null);

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
        journalSchreibenJetzt(); // pending autosave of the previous document goes under ITS hash
        setGeladen(null);
        setAngebot(null);
        setLoeschungen([]);
        setPdf(null); // altes Dokument sofort abkoppeln (wird im Cleanup zerstoert)
        setAnns([]);
        setPageNum(1);
        setSelectedAnnId(null);
        setDraftPin(null);
        setDraftText(null);
        const roh = dataUrlToBytes(await inhaltLaden(selectedDoc.data, selectedDoc.data_blob));
        if (cancelled) return;
        // Hash before pdf.js takes the buffer (it transfers it to its worker).
        const hash = await dokumentHash(roh);
        /** @type {Uint8Array} */
        let bytes = roh;
        if (enthaeltStudioMarke(roh)) {
          // The overlay draws the studio's annotations; pdf.js gets a copy without them (no doubles).
          try {
            const { anzeigeBytes } = await import("../lib/pdfSpeichern.js");
            bytes = await anzeigeBytes(roh);
          } catch (err) {
            toast.warning(`${t("Gespeicherte Anmerkungen werden doppelt angezeigt")}: ${err?.message || err}`);
          }
        }
        if (cancelled) return;
        pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) { pdfFreigeben(pdfDoc); return; }

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
        if (cancelled) { pdfFreigeben(pdfDoc); return; }

        setLayers(layerList);
        setPdf(pdfDoc);
        if (seiteNachLadenRef.current) {
          setPageNum(Math.min(pdfDoc.numPages, seiteNachLadenRef.current));
          seiteNachLadenRef.current = null;
        }

        const rows = (await bitApi.entities.PdfAnnotation.filter({ document_id: selectedDoc.id })) || [];
        if (cancelled) return;
        setAnns(rows);
        // Unsaved state from a crash? Offer it; until the user decides, autosave stays off so the
        // journal is not overwritten by the (still empty) new session.
        let plan = null;
        try {
          const journal = await journalLaden(speicher, hash);
          plan = wiederherstellungsPlan(journal, rows);
          if (journal && !plan) await journalSpeichern(speicher, hash, null);
        } catch (err) {
          toast.warning(`${t("Bearbeitungsstand konnte nicht gelesen werden")}: ${err?.message || err}`);
        }
        if (cancelled) return;
        setAngebot(plan);
        setGeladen({ docId: selectedDoc.id, hash });
      } catch (err) {
        console.error("PDF laden fehlgeschlagen", err);
        toast.error("PDF konnte nicht geladen werden");
      }
    })();
    return () => {
      cancelled = true;
      try { renderTaskRef.current?.cancel(); } catch { /* noop */ }
      if (pdfDoc) pdfFreigeben(pdfDoc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the document changes
  }, [selectedDoc]);

  // ---------- 104-09: autosave of the editing state (journal per document hash) ----------
  function journalSchreibenJetzt() {
    clearTimeout(journalTimerRef.current);
    journalTimerRef.current = null;
    const offen = journalOffenRef.current;
    journalOffenRef.current = null;
    if (!offen) return;
    journalSpeichern(speicher, offen.hash, offen.journal)
      .catch((err) => toast.error(`${t("Bearbeitungsstand konnte nicht gesichert werden")}: ${err?.message || err}`));
  }

  useEffect(() => {
    if (!selectedDoc || !geladen || geladen.docId !== selectedDoc.id || angebot) return;
    journalOffenRef.current = {
      hash: geladen.hash,
      journal: journalBauen({ hash: geladen.hash, dokument: selectedDoc, seite: pageNum, anmerkungen: anns, loeschungen, draftPin, pinText, draftText }),
    };
    clearTimeout(journalTimerRef.current);
    journalTimerRef.current = setTimeout(journalSchreibenJetzt, AUTOSAVE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- journalSchreibenJetzt only reads refs
  }, [selectedDoc, geladen, angebot, pageNum, anns, loeschungen, draftPin, pinText, draftText]);

  // Write at once when the tab is hidden or closed: a crash right after typing loses at most AUTOSAVE_MS.
  useEffect(() => {
    const sofort = () => journalSchreibenJetzt();
    const sichtbar = () => { if (document.visibilityState === "hidden") sofort(); };
    window.addEventListener("pagehide", sofort);
    document.addEventListener("visibilitychange", sichtbar);
    // Old journals (crashes nobody came back to) are dropped once per studio start; a failure here
    // only means they stay a little longer.
    journalAufraeumen(speicher).catch(() => {});
    return () => {
      window.removeEventListener("pagehide", sofort);
      document.removeEventListener("visibilitychange", sichtbar);
      sofort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

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
      // Storage rule (speicherOrt.js): < 256 KB in the record, > 1 MB in the object store.
      const ablage = await inhaltAblegen(dataUrl, { blobId: blobIdNeu("dok"), art: "dokument" });
      const created = await bitApi.entities.Document.create({
        project_id: project.id, name: file.name, size: file.size,
        mime: file.type, data: ablage.inline, data_blob: ablage.blob, uploaded_date: new Date().toISOString(),
      });
      toast.success(`"${file.name}" hochgeladen`);
      if (ablage.hinweis) toast.info(ablage.hinweis);
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
    const datensatz = {
      document_id: selectedDoc.id,
      page: pageNum,
      color,
      author: author.trim() || "Anonym",
      created_date: new Date().toISOString(),
      ...payload,
    };
    try {
      const created = await bitApi.entities.PdfAnnotation.create(datensatz);
      setAnns((list) => [...list, created]);
      return created;
    } catch {
      // 104-09: the server did not take it — keep it in this browser (journal) instead of losing it.
      const lokal = { ...datensatz, id: `lokal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, _lokal: true };
      setAnns((list) => [...list, lokal]);
      toast.warning(t("Anmerkung nicht beim Server angekommen — im Browser gesichert, wird beim Speichern oder nächsten Öffnen nachgetragen."));
      return lokal;
    }
  };

  const deleteAnn = async (id) => {
    const lokal = anns.find((a) => a.id === id)?._lokal;
    if (!lokal) {
      try {
        await bitApi.entities.PdfAnnotation.delete(id);
      } catch {
        setLoeschungen((l) => (l.includes(id) ? l : [...l, id]));
        toast.warning(t("Löschen nicht beim Server angekommen — vorgemerkt und im Browser gesichert."));
      }
    }
    setAnns((list) => list.filter((a) => a.id !== id));
    if (selectedAnnId === id) setSelectedAnnId(null);
  };

  /**
   * Sends local annotations / deletions to the server. Returns the record list as it is afterwards
   * (local ones replaced by their server records, pending deletions left out) and the failures.
   * @param {any[]} liste current records incl. local ones
   * @param {string[]} offeneLoeschungen record ids still to delete
   * @returns {Promise<{liste: any[], fehler: number}>}
   */
  const nachtragen = async (liste, offeneLoeschungen) => {
    let fehler = 0;
    const neu = [];
    for (const a of liste) {
      if (!a._lokal) { neu.push(a); continue; }
      const { id: _id, _lokal, ...rest } = a;
      try { neu.push(await bitApi.entities.PdfAnnotation.create(rest)); } catch { neu.push(a); fehler += 1; }
    }
    const bleiben = [];
    for (const id of offeneLoeschungen) {
      try { await bitApi.entities.PdfAnnotation.delete(id); } catch { bleiben.push(id); fehler += 1; }
    }
    const ergebnis = neu.filter((a) => !offeneLoeschungen.includes(a.id));
    setAnns(ergebnis);
    setLoeschungen(bleiben);
    return { liste: ergebnis, fehler };
  };

  // ---------- 104-09: restore after a crash ----------
  const wiederherstellen = async () => {
    const plan = angebot;
    if (!plan) return;
    const { pin, text } = plan.entwurf;
    const zielSeite = pin?.page || text?.page;
    if (zielSeite && pdf) setPageNum(Math.min(pdf.numPages, zielSeite));
    const liste = [...anns, ...plan.anlegen.map((a) => ({ ...a, _lokal: true }))];
    const { fehler } = await nachtragen(liste, plan.loeschen);
    if (pin) { setTool("pin"); setDraftText(null); setDraftPin({ x: pin.x, y: pin.y }); setPinText(pin.text); }
    else if (text) { setTool("text"); setDraftPin(null); setDraftText({ x: text.x, y: text.y, value: text.value }); }
    setAngebot(null);
    if (fehler) toast.warning(t("Wiederhergestellt — einiges ist noch nicht beim Server angekommen und bleibt im Browser gesichert."));
    else toast.success(t("Bearbeitungsstand wiederhergestellt"));
  };

  const verwerfen = async () => {
    const hash = geladen?.hash;
    setAngebot(null);
    if (hash) await journalSpeichern(speicher, hash, null).catch((err) => toast.error(String(err?.message || err)));
  };

  // ---------- 104-09: save into the PDF (incremental update) ----------
  const imPdfSpeichern = async () => {
    if (!selectedDoc || pdfSpeichern || istFestgeschrieben(selectedDoc)) return;
    setPdfSpeichern(true);
    try {
      let liste = anns;
      if (anns.some((a) => a._lokal) || loeschungen.length) {
        const r = await nachtragen(anns, loeschungen);
        if (r.fehler) throw new Error(t("Server nicht erreichbar — ausstehende Anmerkungen konnten nicht nachgetragen werden."));
        liste = r.liste;
      }
      const { imPdfSpeichern: speichern } = await import("../lib/pdfSpeichern.js");
      const erg = await speichern({ dokument: selectedDoc, anmerkungen: liste, api: bitApi });
      // The file (and its hash) changed; the old journal holds nothing pending any more.
      clearTimeout(journalTimerRef.current);
      journalOffenRef.current = null;
      if (geladen?.hash) await journalSpeichern(speicher, geladen.hash, null);
      if (erg.hinweis) toast.info(erg.hinweis);
      toast.success(erg.geschrieben
        ? t("Im PDF gespeichert — Originaldatei unverändert, Änderungen angehängt ({n} Bytes).").replace("{n}", erg.bericht.angehaengt.toLocaleString("de-DE"))
        : t("PDF ist bereits aktuell"));
      seiteNachLadenRef.current = pageNum;
      setDocs((list) => list.map((d) => (d.id === erg.dokument.id ? erg.dokument : d)));
      setSelectedDoc(erg.dokument);
    } catch (err) {
      toast.error(`${t("Speichern im PDF fehlgeschlagen")}: ${err?.message || err}`);
    }
    setPdfSpeichern(false);
  };

  const herunterladen = async () => {
    if (!selectedDoc) return;
    try {
      const url = await inhaltLaden(selectedDoc.data, selectedDoc.data_blob);
      if (!url) throw new Error(t("Dateiinhalt nicht gefunden"));
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedDoc.name || "dokument.pdf";
      a.click();
    } catch (err) {
      toast.error(`${t("Herunterladen fehlgeschlagen")}: ${err?.message || err}`);
    }
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

  const pdfStand = useMemo(() => pdfStandVergleich(anns, selectedDoc?.pdf_anmerkungen), [anns, selectedDoc]);
  const offenImPdf = pdfStand.offen + loeschungen.length;
  const lokalAnzahl = anns.filter((a) => a._lokal).length + loeschungen.length;
  // Sent/confirmed documents carry a checksum of their bytes; saving into them would break that proof.
  const festgeschrieben = istFestgeschrieben(selectedDoc);

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
        {angebot && (
          <div role="alert" data-testid="pdf-wiederherstellen"
            className="rounded-xl border border-hinweis-rand bg-hinweis-flaeche p-3 flex flex-wrap items-center gap-3 text-sm">
            <History className="w-4 h-4 text-hinweis shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">{t("Nicht gespeicherter Bearbeitungsstand gefunden")}</div>
              <div className="text-xs text-muted-foreground">
                {t("{n} Punkte vom {zeit} — vermutlich nach einem Absturz oder geschlossenem Fenster.")
                  .replace("{n}", String(angebot.anzahl))
                  .replace("{zeit}", new Date(angebot.zeit).toLocaleString("de-DE"))}
              </div>
            </div>
            <Button size="sm" onClick={wiederherstellen}>{t("Wiederherstellen")}</Button>
            <Button size="sm" variant="outline" onClick={verwerfen}>{t("Verwerfen")}</Button>
          </div>
        )}
        {lokalAnzahl > 0 && (
          <div role="status" data-testid="pdf-lokal-gesichert"
            className="rounded-xl border border-warnung-rand bg-warnung-flaeche px-3 py-2 text-xs text-warnung">
            {t("{n} Änderungen nur im Browser gesichert — der Server hat sie noch nicht.").replace("{n}", String(lokalAnzahl))}
          </div>
        )}
        {festgeschrieben && (
          <div role="status" data-testid="pdf-festgeschrieben"
            className="rounded-xl border border-hinweis-rand bg-hinweis-flaeche px-3 py-2 text-xs text-hinweis">
            {t("Festgeschriebenes Dokument (versendet bzw. bestätigt, mit Prüfsumme): Anmerkungen bleiben im Studio und lassen sich annotiert exportieren — in die Datei selbst wird nichts geschrieben.")}
          </div>
        )}
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
            <Button variant="outline" size="icon" aria-label={t("PDF herunterladen")} title={t("PDF herunterladen")}
              disabled={!selectedDoc} onClick={herunterladen}>
              <Download className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={imPdfSpeichern} data-testid="pdf-im-pdf-speichern" data-offen={offenImPdf}
              data-festgeschrieben={festgeschrieben ? "ja" : "nein"}
              disabled={!pdf || pdfSpeichern || !geladen || !!angebot || !!draftPin || !!draftText || offenImPdf === 0 || festgeschrieben}
              title={festgeschrieben
                ? t("Festgeschriebenes Dokument (versendet bzw. bestätigt) — die Datei bleibt unverändert")
                : offenImPdf === 0
                ? t("Alle Anmerkungen sind im PDF gespeichert")
                : t("Anmerkungen ins PDF schreiben — die Originalbytes bleiben unverändert, die Änderung wird angehängt")}>
              {pdfSpeichern ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {t("Im PDF speichern")}
              {offenImPdf > 0 && <Badge variant="outline" className="ml-2 text-[10px]">{offenImPdf}</Badge>}
            </Button>
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
                    // B-104-09-01: the mousedown after the pointerdown would move focus to this overlay
                    // and blur the freshly auto-focused text field (empty → closed at once).
                    onMouseDown={(e) => { if ((tool === "text" || tool === "pin") && !/** @type {HTMLElement} */ (e.target).closest("input,textarea,button")) e.preventDefault(); }}
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
                        className="absolute z-10 bg-white/95 border border-slate-300 rounded px-1.5 py-0.5 text-sm shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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
              <Input aria-label={t("Autor")} value={author} placeholder="Ihr Name" className="h-8 text-sm"
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
