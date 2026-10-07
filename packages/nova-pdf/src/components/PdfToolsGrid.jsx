// PdfToolsGrid — PDF-Werkzeug-Raster im Stil von PDF24, aber im
// BIT-Atelier-Corporate-Design (shadcn-Cards, lucide-Icons in farbigen
// Icon-Chips, Akzentfarben rotierend je Kategorie).
//
// Props:
//   project    — aktuelles Projekt (oder null); ohne Projekt ist "Im Projekt
//                speichern" deaktiviert, Upload als Quelle geht trotzdem.
//   documents  — bereits geladene Document-Liste der Seite.
//   onRefresh  — wird nach dem Speichern neuer Dokumente aufgerufen.
//   onAnnotate — onAnnotate(doc) wechselt zum Viewer/Studio (Kommentieren).
//
// Bewusst in sich geschlossen: eigener Modal-Layer (es existiert kein
// shadcn-Dialog in src/components/ui), keine Abhaengigkeit auf PdfStudio.

import React, { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Progress } from "@core/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { toast } from "sonner";
import { fmtBytes } from "@core/lib/pdf";
import {
  Combine,
  Scissors,
  FileOutput,
  FileMinus,
  RotateCw,
  Hash,
  Stamp,
  FileCog,
  Images,
  FileImage,
  FileArchive,
  PenLine,
  Loader2,
  Download,
  Save,
  Upload,
  X,
  ArrowUp,
  ArrowDown,
  Trash2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Play,
} from "lucide-react";
import {
  dataUrlToBytes,
  bytesToDataUrl,
  fileToDataUrl,
  parsePageRanges,
  getPageCount,
  mergePdfs,
  splitPdf,
  extractPages,
  removePages,
  rotatePages,
  addPageNumbers,
  addWatermark,
  setPdfMetadata,
  getPdfMetadata,
  imagesToPdf,
  pdfToImages,
  compressPdf,
  downloadBytes,
  downloadDataUrl,
} from "./pdfTools";

// ---------------------------------------------------------------------------
// Werkzeug-Katalog (Farbe rotiert je Kategorie: emerald/teal/blue/violet/amber)
// ---------------------------------------------------------------------------

const COLORS = {
  emerald: { chip: "bg-emerald-50", icon: "text-emerald-600" },
  teal: { chip: "bg-teal-50", icon: "text-teal-600" },
  blue: { chip: "bg-blue-50", icon: "text-blue-600" },
  violet: { chip: "bg-violet-50", icon: "text-violet-600" },
  amber: { chip: "bg-amber-50", icon: "text-amber-600" },
};

const TOOLS = [
  // Kategorie: Organisieren (emerald)
  { key: "merge", title: "PDFs zusammenfügen", desc: "Mehrere PDFs in Reihenfolge zu einem Dokument", icon: Combine, color: "emerald", action: "Zusammenfügen" },
  { key: "split", title: "PDF teilen", desc: "Je Seitenbereich ein eigenes PDF erzeugen", icon: Scissors, color: "emerald", action: "Teilen" },
  { key: "extract", title: "Seiten extrahieren", desc: "Nur ausgewählte Seiten als neues PDF", icon: FileOutput, color: "emerald", action: "Extrahieren" },
  { key: "remove", title: "Seiten entfernen", desc: "Ausgewählte Seiten aus dem PDF löschen", icon: FileMinus, color: "emerald", action: "Entfernen" },
  // Kategorie: Bearbeiten (teal)
  { key: "rotate", title: "Seiten drehen", desc: "90/180/270 Grad — alle Seiten oder ein Bereich", icon: RotateCw, color: "teal", action: "Drehen" },
  { key: "pagenumbers", title: "Seitenzahlen", desc: "Seitenzahlen unten auf jede Seite setzen", icon: Hash, color: "teal", action: "Nummerieren" },
  { key: "watermark", title: "Wasserzeichen", desc: "Diagonaler Text auf jeder Seite", icon: Stamp, color: "teal", action: "Anwenden" },
  { key: "metadata", title: "Metadaten bearbeiten", desc: "Titel, Autor, Betreff und Stichwörter", icon: FileCog, color: "teal", action: "Speichern" },
  // Kategorie: Konvertieren (blue)
  { key: "img2pdf", title: "Bilder zu PDF", desc: "JPG/PNG-Bilder zu einem PDF bündeln", icon: Images, color: "blue", action: "Umwandeln" },
  { key: "pdf2img", title: "PDF zu Bildern", desc: "Jede Seite als PNG exportieren", icon: FileImage, color: "blue", action: "Umwandeln" },
  // Kategorie: Optimieren (violet)
  { key: "compress", title: "PDF komprimieren", desc: "Dateigröße durch Neu-Rasterung reduzieren", icon: FileArchive, color: "violet", action: "Komprimieren" },
  // Kategorie: Prüfen & Anmerken (amber)
  { key: "annotate", title: "Kommentieren & Anmerken", desc: "PDF im Studio markieren und kommentieren", icon: PenLine, color: "amber", action: "Im Studio öffnen" },
];

const SINGLE_SOURCE_TOOLS = ["split", "extract", "remove", "rotate", "pagenumbers", "watermark", "metadata", "pdf2img", "compress"];

const isPdfDoc = (d) => d && (d.mime === "application/pdf" || /\.pdf$/i.test(d.name || ""));
const stem = (name) => String(name || "Dokument").replace(/\.pdf$/i, "");

// ---------------------------------------------------------------------------
// Modal (eigener Layer — es gibt keinen shadcn-Dialog im Projekt)
// ---------------------------------------------------------------------------

function Modal({ onClose, title, icon: Icon, color, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = COLORS[color] || COLORS.emerald;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white/95 backdrop-blur px-5 py-4 rounded-t-2xl">
          <div className={`inline-flex p-2.5 rounded-xl ${c.chip}`}>
            <Icon className={`w-5 h-5 ${c.icon}`} />
          </div>
          <h3 className="flex-1 font-semibold text-slate-800">{title}</h3>
          <Button variant="ghost" size="icon" aria-label="Dialog schliessen" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Werkzeug-Dialog
// ---------------------------------------------------------------------------

function ToolDialog({ tool, project, pdfDocs, onClose, onRefresh, onAnnotate }) {
  // Quellen
  const [source, setSource] = useState(null); // { kind: "doc", doc } | { kind: "upload", name, bytes }
  const [sources, setSources] = useState([]); // Merge: geordnete Liste
  const [images, setImages] = useState([]); // img2pdf: [{ name, dataUrl }]
  const [annotateId, setAnnotateId] = useState("");

  // Parameter
  const [ranges, setRanges] = useState("");
  const [angle, setAngle] = useState("90");
  const [scope, setScope] = useState("all"); // rotate: "all" | "range"
  const [position, setPosition] = useState("bottom-center");
  const [startNo, setStartNo] = useState("1");
  const [format, setFormat] = useState("Seite {n} von {total}");
  const [wmText, setWmText] = useState("ENTWURF");
  const [wmOpacity, setWmOpacity] = useState(15); // Prozent
  const [meta, setMeta] = useState({ title: "", author: "", subject: "", keywords: "" });
  const [quality, setQuality] = useState(60); // Prozent

  // Ablauf
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null); // { page, total }
  const [error, setError] = useState("");
  const [results, setResults] = useState(null); // [{ name, mime, bytes? , dataUrl? }]

  const resetOutput = () => { setResults(null); setError(""); setProgress(null); };

  const getSourceBytes = (s) =>
    s.kind === "doc" ? dataUrlToBytes(s.doc.data) : s.bytes.slice();

  // Metadaten vorbefüllen, sobald eine Quelle gewählt ist
  useEffect(() => {
    if (tool.key !== "metadata" || !source) return;
    let cancelled = false;
    getPdfMetadata(getSourceBytes(source))
      .then((m) => { if (!cancelled) setMeta({ title: m.title, author: m.author, subject: m.subject, keywords: m.keywords }); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.key, source]);

  // ---- Quellen-Handler -----------------------------------------------------

  const pickDoc = (id) => {
    const d = pdfDocs.find((x) => x.id === id);
    if (d) { setSource({ kind: "doc", doc: d }); resetOutput(); }
  };

  const onUploadSingle = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setSource({ kind: "upload", name: file.name, bytes: dataUrlToBytes(dataUrl) });
      resetOutput();
    } catch (err) { setError(err.message); }
  };

  const addMergeDoc = (id) => {
    const d = pdfDocs.find((x) => x.id === id);
    if (d) {
      setSources((prev) => [...prev, { kind: "doc", doc: d, name: d.name }]);
      resetOutput();
    }
  };

  const onUploadMerge = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    try {
      const added = [];
      for (const f of files) {
        const dataUrl = await fileToDataUrl(f);
        added.push({ kind: "upload", name: f.name, bytes: dataUrlToBytes(dataUrl) });
      }
      if (added.length) { setSources((prev) => [...prev, ...added]); resetOutput(); }
    } catch (err) { setError(err.message); }
  };

  const moveSource = (i, dir) => {
    setSources((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const onUploadImages = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    try {
      const added = [];
      for (const f of files) added.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
      if (added.length) { setImages((prev) => [...prev, ...added]); resetOutput(); }
    } catch (err) { setError(err.message); }
  };

  // ---- Ausfuehren ------------------------------------------------------------

  const run = async () => {
    resetOutput();
    setBusy(true);
    const onProgress = (page, total) => setProgress({ page, total });
    try {
      let out = null;
      const srcStem = source ? stem(source.kind === "doc" ? source.doc.name : source.name) : "";
      switch (tool.key) {
        case "merge": {
          if (sources.length < 2) throw new Error("Bitte mindestens zwei PDFs auswählen.");
          const list = [];
          for (const s of sources) list.push(getSourceBytes(s));
          const bytes = await mergePdfs(list);
          out = [{ name: `${stem(sources[0].name)}_zusammengefügt.pdf`, mime: "application/pdf", bytes }];
          break;
        }
        case "split": {
          const parts = await splitPdf(getSourceBytes(source), ranges);
          out = parts.map((p) => ({ name: `${srcStem}_${p.suffix}.pdf`, mime: "application/pdf", bytes: p.bytes }));
          break;
        }
        case "extract": {
          const b = getSourceBytes(source);
          const idx = parsePageRanges(ranges, await getPageCount(b));
          out = [{ name: `${srcStem}_Auszug.pdf`, mime: "application/pdf", bytes: await extractPages(b, idx) }];
          break;
        }
        case "remove": {
          const b = getSourceBytes(source);
          const idx = parsePageRanges(ranges, await getPageCount(b));
          out = [{ name: `${srcStem}_reduziert.pdf`, mime: "application/pdf", bytes: await removePages(b, idx) }];
          break;
        }
        case "rotate": {
          const b = getSourceBytes(source);
          const idx = scope === "all" ? null : parsePageRanges(ranges, await getPageCount(b));
          out = [{ name: `${srcStem}_gedreht.pdf`, mime: "application/pdf", bytes: await rotatePages(b, idx, parseInt(angle, 10)) }];
          break;
        }
        case "pagenumbers": {
          const bytes = await addPageNumbers(getSourceBytes(source), {
            position,
            start: Math.max(1, parseInt(startNo, 10) || 1),
            format: format || "Seite {n} von {total}",
          });
          out = [{ name: `${srcStem}_nummeriert.pdf`, mime: "application/pdf", bytes }];
          break;
        }
        case "watermark": {
          const bytes = await addWatermark(getSourceBytes(source), { text: wmText, opacity: wmOpacity / 100 });
          out = [{ name: `${srcStem}_Wasserzeichen.pdf`, mime: "application/pdf", bytes }];
          break;
        }
        case "metadata": {
          const bytes = await setPdfMetadata(getSourceBytes(source), meta);
          out = [{ name: `${srcStem}_Metadaten.pdf`, mime: "application/pdf", bytes }];
          break;
        }
        case "img2pdf": {
          if (!images.length) throw new Error("Bitte mindestens ein Bild auswählen.");
          const bytes = await imagesToPdf(images.map((i) => i.dataUrl));
          out = [{ name: `${stem(images[0].name).replace(/\.(png|jpe?g)$/i, "")}.pdf`, mime: "application/pdf", bytes }];
          break;
        }
        case "pdf2img": {
          const urls = await pdfToImages(getSourceBytes(source), { scale: 2, onProgress });
          out = urls.map((u, i) => ({ name: `${srcStem}_Seite-${i + 1}.png`, mime: "image/png", dataUrl: u }));
          break;
        }
        case "compress": {
          const bytes = await compressPdf(getSourceBytes(source), { quality: quality / 100, onProgress });
          out = [{ name: `${srcStem}_komprimiert.pdf`, mime: "application/pdf", bytes }];
          break;
        }
        default:
          throw new Error("Unbekanntes Werkzeug.");
      }
      setResults(out);
    } catch (err) {
      setError(err && err.message ? err.message : "Vorgang fehlgeschlagen.");
    }
    setProgress(null);
    setBusy(false);
  };

  // ---- Ergebnis-Aktionen -----------------------------------------------------

  const downloadAll = () => {
    for (const r of results) {
      if (r.bytes) downloadBytes(r.bytes, r.name, r.mime);
      else downloadDataUrl(r.dataUrl, r.name);
    }
    toast.success(results.length === 1 ? "Datei heruntergeladen" : `${results.length} Dateien heruntergeladen`);
  };

  const saveAll = async () => {
    if (!project) return;
    setSaving(true);
    try {
      for (const r of results) {
        const data = r.bytes ? bytesToDataUrl(r.bytes, r.mime) : r.dataUrl;
        const size = r.bytes ? r.bytes.length : dataUrlToBytes(r.dataUrl).length;
        await bitApi.entities.Document.create({
          project_id: project.id,
          name: r.name,
          size,
          mime: r.mime,
          data,
          uploaded_date: new Date().toISOString(),
        });
      }
      toast.success(results.length === 1 ? "Im Projekt gespeichert" : `${results.length} Dateien im Projekt gespeichert`);
      if (onRefresh) onRefresh();
    } catch {
      toast.error("Speichern fehlgeschlagen");
    }
    setSaving(false);
  };

  // ---- Teil-UIs ---------------------------------------------------------------

  const resultSize = (r) => (r.bytes ? r.bytes.length : Math.round((r.dataUrl.length * 3) / 4));

  const UploadButton = ({ accept, multiple, onChange, label }) => (
    <label className="inline-flex">
      <input type="file" accept={accept} multiple={multiple} className="hidden" onChange={onChange} />
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors">
        <Upload className="w-3.5 h-3.5" /> {label}
      </span>
    </label>
  );

  const singleSourcePicker = (
    <div className="space-y-2">
      <Label className="text-xs text-slate-500">PDF-Quelle</Label>
      {pdfDocs.length > 0 && (
        <Select value={source && source.kind === "doc" ? source.doc.id : ""} onValueChange={pickDoc}>
          <SelectTrigger>
            <SelectValue placeholder="Dokument aus dem Projekt wählen" />
          </SelectTrigger>
          <SelectContent>
            {pdfDocs.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <UploadButton accept="application/pdf" onChange={onUploadSingle} label="Datei hochladen" />
        {source && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            {source.kind === "doc" ? source.doc.name : source.name}
          </span>
        )}
      </div>
      {pdfDocs.length === 0 && (
        <p className="text-xs text-slate-400">Keine PDF-Dokumente im Projekt — eine Datei hochladen.</p>
      )}
    </div>
  );

  const rangeInput = (label, placeholder = "z. B. 1-3,5,7-9") => (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      <Input value={ranges} onChange={(e) => { setRanges(e.target.value); resetOutput(); }} placeholder={placeholder} />
    </div>
  );

  const sliderRow = (label, value, setValue, min, max, unit) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-slate-500">{label}</Label>
        <span className="text-xs font-medium text-slate-700">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => { setValue(parseInt(e.target.value, 10)); resetOutput(); }}
        className="w-full accent-emerald-600"
      />
    </div>
  );

  // Parameter-Bereich je Werkzeug
  let body = null;
  let runDisabled = busy;
  switch (tool.key) {
    case "merge":
      runDisabled = busy || sources.length < 2;
      body = (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">PDFs in gewuenschter Reihenfolge</Label>
            {sources.length === 0 && (
              <p className="text-xs text-slate-400">Noch keine PDFs ausgewählt — unten hinzufügen (mindestens zwei).</p>
            )}
            <ul className="space-y-1.5">
              {sources.map((s, i) => (
                <li key={`${s.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-slate-400 w-5">{i + 1}.</span>
                  <span className="flex-1 text-sm text-slate-700 truncate">{s.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Nach oben" disabled={i === 0} onClick={() => moveSource(i, -1)}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Nach unten" disabled={i === sources.length - 1} onClick={() => moveSource(i, 1)}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50" aria-label="Entfernen" onClick={() => setSources((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {pdfDocs.length > 0 && (
              <Select value="" onValueChange={addMergeDoc}>
                <SelectTrigger className="w-auto min-w-[220px]">
                  <SelectValue placeholder="Projekt-PDF hinzufügen" />
                </SelectTrigger>
                <SelectContent>
                  {pdfDocs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <UploadButton accept="application/pdf" multiple onChange={onUploadMerge} label="Dateien hochladen" />
          </div>
        </div>
      );
      break;

    case "split":
      runDisabled = busy || !source || !ranges.trim();
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          {rangeInput("Seitenbereiche (je Bereich ein eigenes PDF)")}
        </div>
      );
      break;

    case "extract":
      runDisabled = busy || !source || !ranges.trim();
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          {rangeInput("Zu extrahierende Seiten")}
        </div>
      );
      break;

    case "remove":
      runDisabled = busy || !source || !ranges.trim();
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          {rangeInput("Zu entfernende Seiten")}
        </div>
      );
      break;

    case "rotate":
      runDisabled = busy || !source || (scope === "range" && !ranges.trim());
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Drehwinkel</Label>
              <Select value={angle} onValueChange={(v) => { setAngle(v); resetOutput(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="90">90 Grad (rechts)</SelectItem>
                  <SelectItem value="180">180 Grad</SelectItem>
                  <SelectItem value="270">270 Grad (links)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Anwenden auf</Label>
              <Select value={scope} onValueChange={(v) => { setScope(v); resetOutput(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Seiten</SelectItem>
                  <SelectItem value="range">Seitenbereich</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {scope === "range" && rangeInput("Seitenbereich")}
        </div>
      );
      break;

    case "pagenumbers":
      runDisabled = busy || !source;
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Position</Label>
              <Select value={position} onValueChange={(v) => { setPosition(v); resetOutput(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom-center">Unten mittig</SelectItem>
                  <SelectItem value="bottom-right">Unten rechts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Start bei</Label>
              <Input type="number" min="1" value={startNo} onChange={(e) => { setStartNo(e.target.value); resetOutput(); }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Format ({"{n}"} = Nummer, {"{total}"} = gesamt)</Label>
            <Input value={format} onChange={(e) => { setFormat(e.target.value); resetOutput(); }} />
          </div>
        </div>
      );
      break;

    case "watermark":
      runDisabled = busy || !source || !wmText.trim();
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Text</Label>
            <Input value={wmText} onChange={(e) => { setWmText(e.target.value); resetOutput(); }} placeholder="z. B. ENTWURF" />
          </div>
          {sliderRow("Deckkraft", wmOpacity, setWmOpacity, 5, 60, " %")}
        </div>
      );
      break;

    case "metadata":
      runDisabled = busy || !source;
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          {["title", "author", "subject", "keywords"].map((field) => (
            <div key={field} className="space-y-1.5">
              <Label className="text-xs text-slate-500">
                {{ title: "Titel", author: "Autor", subject: "Betreff", keywords: "Stichwörter (Komma-getrennt)" }[field]}
              </Label>
              <Input value={meta[field]} onChange={(e) => { setMeta((m) => ({ ...m, [field]: e.target.value })); resetOutput(); }} />
            </div>
          ))}
        </div>
      );
      break;

    case "img2pdf":
      runDisabled = busy || images.length === 0;
      body = (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Bilder (JPG/PNG) — je Bild eine Seite</Label>
            <ul className="space-y-1.5">
              {images.map((img, i) => (
                <li key={`${img.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5">
                  <Images className="w-3.5 h-3.5 text-slate-400" />
                  <span className="flex-1 text-sm text-slate-700 truncate">{img.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50" aria-label="Entfernen" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
            <UploadButton accept="image/png,image/jpeg" multiple onChange={onUploadImages} label="Bilder hochladen" />
          </div>
        </div>
      );
      break;

    case "pdf2img":
      runDisabled = busy || !source;
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          <p className="text-xs text-slate-500">Jede Seite wird als PNG (ca. 144 dpi) ausgegeben.</p>
        </div>
      );
      break;

    case "compress":
      runDisabled = busy || !source;
      body = (
        <div className="space-y-3">
          {singleSourcePicker}
          {sliderRow("JPEG-Qualitaet", quality, setQuality, 30, 90, " %")}
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              Hinweis: Die Seiten werden neu gerastert — Text ist danach nicht mehr selektier- oder durchsuchbar.
              Der größte Gewinn entsteht bei scan- und bildlastigen PDFs.
            </p>
          </div>
        </div>
      );
      break;

    case "annotate": {
      const chosen = pdfDocs.find((d) => d.id === annotateId);
      body = (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Projekt-PDF wählen</Label>
            {pdfDocs.length > 0 ? (
              <Select value={annotateId} onValueChange={setAnnotateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Dokument wählen" />
                </SelectTrigger>
                <SelectContent>
                  {pdfDocs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-slate-400">
                Keine PDF-Dokumente im Projekt — zuerst eine PDF importieren oder mit einem Werkzeug erzeugen und speichern.
              </p>
            )}
          </div>
          <Button
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md"
            disabled={!chosen || !onAnnotate}
            onClick={() => { if (chosen && onAnnotate) { onAnnotate(chosen); onClose(); } }}
          >
            <PenLine className="w-4 h-4 mr-2" /> Im Studio öffnen
          </Button>
        </div>
      );
      break;
    }

    default:
      body = null;
  }

  const showRunButton = tool.key !== "annotate";

  return (
    <Modal onClose={onClose} title={tool.title} icon={tool.icon} color={tool.color}>
      {body}

      {showRunButton && (
        <Button onClick={run} disabled={runDisabled} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          {tool.action}
        </Button>
      )}

      {busy && progress && (
        <div className="space-y-1.5">
          <Progress value={(progress.page / progress.total) * 100} />
          <p className="text-xs text-slate-500 text-center">Seite {progress.page} von {progress.total}</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
          <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      {results && (
        <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Fertig — {results.length === 1 ? "1 Datei" : `${results.length} Dateien`} erzeugt
          </div>
          <ul className="space-y-1">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{r.name}</span>
                <span className="text-slate-400 ml-auto shrink-0">{fmtBytes(resultSize(r))}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button size="sm" onClick={downloadAll} className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm">
              <Download className="w-3.5 h-3.5 mr-1.5" /> Herunterladen
            </Button>
            <Button size="sm" variant="outline" onClick={saveAll} disabled={!project || saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
              Im Projekt speichern
            </Button>
          </div>
          {!project && (
            <p className="text-xs text-slate-400">Zum Speichern zuerst ein Projekt wählen — Herunterladen geht immer.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Haupt-Komponente: Kachel-Raster
// ---------------------------------------------------------------------------

export default function PdfToolsGrid({ project, documents = [], onRefresh, onAnnotate }) {
  const [activeTool, setActiveTool] = useState(null);
  const pdfDocs = (documents || []).filter(isPdfDoc);

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        Was moechtest du tun?
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mt-3">
        {TOOLS.map((tool) => {
          const c = COLORS[tool.color];
          const Icon = tool.icon;
          return (
            <button key={tool.key} type="button" onClick={() => setActiveTool(tool)} className="text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-xl">
              <Card className="border-0 shadow-sm rounded-xl bg-white hover:shadow-md transition-shadow h-full">
                <CardContent className="p-4">
                  <div className={`inline-flex p-2.5 rounded-xl ${c.chip} mb-2.5`}>
                    <Icon className={`w-5 h-5 ${c.icon}`} />
                  </div>
                  <div className="text-sm font-semibold text-slate-800 leading-snug">{tool.title}</div>
                  <div className="text-xs text-slate-500 mt-1 leading-snug">{tool.desc}</div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      {activeTool && (
        <ToolDialog
          key={activeTool.key}
          tool={activeTool}
          project={project}
          pdfDocs={pdfDocs}
          onClose={() => setActiveTool(null)}
          onRefresh={onRefresh}
          onAnnotate={onAnnotate}
        />
      )}
    </div>
  );
}
