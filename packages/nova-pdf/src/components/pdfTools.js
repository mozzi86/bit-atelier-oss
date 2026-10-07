// pdfTools.js — Reine PDF-Logik für das Werkzeug-Raster (keine UI).
// Baut auf pdf-lib (strukturierte Bearbeitung) und pdfjs-dist (Rendern in Canvas) auf.
//
// Konventionen:
// - Eingaben sind Uint8Array (oder bei Bildern File/data-URL), Ausgaben Uint8Array
//   bzw. Arrays von Ergebnissen.
// - pdfjs TRANSFERIERT den übergebenen Buffer in den Worker. Deshalb wird intern
//   immer mit einer Kopie (bytes.slice()) gearbeitet — Aufrufer behalten ihre Bytes.
// - Verschlüsselte PDFs werden mit einer deutschen Fehlermeldung abgewiesen.

import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const ENCRYPTED_MSG = "PDF ist geschützt und kann nicht bearbeitet werden";

// ---------------------------------------------------------------------------
// Basis-Helfer
// ---------------------------------------------------------------------------

/** data-URL → frische Uint8Array (je Aufruf neue Bytes, sicher gegen Transfer). */
export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Ungültige Datei (keine data-URL).");
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Uint8Array → data-URL. Chunk-weises btoa, um Callstack-Limits zu vermeiden. */
export function bytesToDataUrl(bytes, mime = "application/pdf") {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** File → data-URL (FileReader). */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Datei "${file.name}" konnte nicht gelesen werden.`));
    r.readAsDataURL(file);
  });
}

/**
 * Parst Range-Segmente wie "1-3,5,7-9" gegen pageCount.
 * Rückgabe: [{ label: "S1-3", indices: [0,1,2] }, ...] (0-basiert, validiert).
 * Wirft Error mit deutscher Meldung bei ungültiger Eingabe.
 */
export function parseRangeSegments(str, pageCount) {
  if (!str || !str.trim()) {
    throw new Error("Bitte einen Seitenbereich angeben (z. B. 1-3,5,7-9).");
  }
  const segments = [];
  for (const raw of str.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    let from;
    let to;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      from = parseInt(m[1], 10);
      to = parseInt(m[2], 10);
    } else if (/^\d+$/.test(part)) {
      from = to = parseInt(part, 10);
    } else {
      throw new Error(`Ungültige Angabe "${part}". Erlaubt sind z. B. 1-3,5,7-9.`);
    }
    if (from < 1 || to > pageCount || from > to) {
      throw new Error(`Bereich "${part}" liegt außerhalb von 1-${pageCount}.`);
    }
    const indices = [];
    for (let p = from; p <= to; p++) indices.push(p - 1);
    segments.push({ label: from === to ? `S${from}` : `S${from}-${to}`, indices });
  }
  if (!segments.length) {
    throw new Error("Bitte einen Seitenbereich angeben (z. B. 1-3,5,7-9).");
  }
  return segments;
}

/** "1-3,5,7-9" → flache Liste 0-basierter Seitenindizes (dedupliziert, validiert). */
export function parsePageRanges(str, pageCount) {
  const seen = new Set();
  const out = [];
  for (const seg of parseRangeSegments(str, pageCount)) {
    for (const i of seg.indices) {
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  }
  return out;
}

// pdf-lib-Load mit deutscher Fehlermeldung für verschlüsselte PDFs.
async function loadPdf(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) throw new Error(ENCRYPTED_MSG);
    throw new Error("PDF konnte nicht gelesen werden (Datei beschädigt oder kein PDF).");
  }
  if (doc.isEncrypted) throw new Error(ENCRYPTED_MSG);
  return doc;
}

// pdfjs-Load mit Kopie der Bytes (Transfer-sicher) und deutscher Fehlermeldung.
async function openWithPdfjs(bytes) {
  try {
    return await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  } catch (err) {
    if (err && (err.name === "PasswordException" || /password/i.test(String(err.message)))) {
      throw new Error(ENCRYPTED_MSG);
    }
    throw new Error("PDF konnte nicht gerendert werden (Datei beschädigt oder kein PDF).");
  }
}

/** Seitenanzahl eines PDFs (für Range-Validierung in der UI). */
export async function getPageCount(bytes) {
  const doc = await loadPdf(bytes);
  return doc.getPageCount();
}

// ---------------------------------------------------------------------------
// Operationen (pdf-lib)
// ---------------------------------------------------------------------------

/** Mehrere PDFs in Reihenfolge zu einem Dokument zusammenfügen. */
export async function mergePdfs(arrayOfBytes) {
  if (!arrayOfBytes || arrayOfBytes.length < 2) {
    throw new Error("Bitte mindestens zwei PDFs auswählen.");
  }
  const out = await PDFDocument.create();
  for (const bytes of arrayOfBytes) {
    const src = await loadPdf(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/**
 * PDF anhand eines Range-Strings ("1-3,5,7-9") in Teil-PDFs zerlegen.
 * Rückgabe: [{ suffix: "S1-3", bytes }, ...] — je Range ein eigenes PDF.
 */
export async function splitPdf(bytes, ranges) {
  const src = await loadPdf(bytes);
  const segments = parseRangeSegments(ranges, src.getPageCount());
  const results = [];
  for (const seg of segments) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, seg.indices);
    pages.forEach((p) => doc.addPage(p));
    results.push({ suffix: seg.label, bytes: await doc.save() });
  }
  return results;
}

/** Nur die angegebenen Seiten (0-basierte Indizes) in ein neues PDF übernehmen. */
export async function extractPages(bytes, pageIndices) {
  if (!pageIndices || !pageIndices.length) throw new Error("Keine Seiten ausgewählt.");
  const src = await loadPdf(bytes);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, pageIndices);
  pages.forEach((p) => doc.addPage(p));
  return doc.save();
}

/** Die angegebenen Seiten (0-basierte Indizes) entfernen, Rest behalten. */
export async function removePages(bytes, pageIndices) {
  if (!pageIndices || !pageIndices.length) throw new Error("Keine Seiten ausgewählt.");
  const src = await loadPdf(bytes);
  const removeSet = new Set(pageIndices);
  const keep = src.getPageIndices().filter((i) => !removeSet.has(i));
  if (!keep.length) throw new Error("Es muss mindestens eine Seite übrig bleiben.");
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, keep);
  pages.forEach((p) => doc.addPage(p));
  return doc.save();
}

/**
 * Seiten drehen. pageIndices = null/undefined → alle Seiten.
 * angle in Grad (90/180/270), wird zur bestehenden Drehung addiert.
 */
export async function rotatePages(bytes, pageIndices, angle) {
  const doc = await loadPdf(bytes);
  const all = doc.getPages();
  const idx = pageIndices == null ? all.map((_, i) => i) : pageIndices;
  for (const i of idx) {
    const page = all[i];
    if (!page) continue;
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((((current + angle) % 360) + 360) % 360));
  }
  return doc.save();
}

/**
 * Seitenzahlen unten auf jede Seite setzen (Helvetica, grau).
 * format: "{n}" = laufende Nummer (ab start), "{total}" = Gesamtanzahl.
 */
export async function addPageNumbers(
  bytes,
  { position = "bottom-center", start = 1, format = "Seite {n} von {total}" } = {}
) {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const size = 9;
  pages.forEach((page, i) => {
    const text = format
      .replaceAll("{n}", String(start + i))
      .replaceAll("{total}", String(total));
    const w = font.widthOfTextAtSize(text, size);
    const { width } = page.getSize();
    const x = position === "bottom-right" ? width - w - 40 : (width - w) / 2;
    page.drawText(text, { x, y: 24, size, font, color: rgb(0.45, 0.45, 0.45) });
  });
  return doc.save();
}

/** Text-Wasserzeichen auf jede Seite — standardmäßig diagonal (45 Grad) und mittig. */
export async function addWatermark(
  bytes,
  { text, opacity = 0.15, fontSize = 60, color = rgb(0.6, 0.6, 0.6), diagonal = true } = {}
) {
  if (!text || !text.trim()) throw new Error("Bitte einen Wasserzeichen-Text angeben.");
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const w = font.widthOfTextAtSize(text, fontSize);
    const ch = fontSize * 0.35; // Abstand Baseline → optische Textmitte
    if (diagonal) {
      const rad = Math.PI / 4;
      // Baseline-Startpunkt so wählen, dass die rotierte Textmitte auf der
      // Seitenmitte liegt (Rotation erfolgt um den Startpunkt).
      const x = width / 2 - (w / 2) * Math.cos(rad) + ch * Math.sin(rad);
      const y = height / 2 - (w / 2) * Math.sin(rad) - ch * Math.cos(rad);
      page.drawText(text, { x, y, size: fontSize, font, color, opacity, rotate: degrees(45) });
    } else {
      page.drawText(text, {
        x: (width - w) / 2,
        y: height / 2 - ch,
        size: fontSize,
        font,
        color,
        opacity,
      });
    }
  }
  return doc.save();
}

/** Dokument-Metadaten setzen. keywords: String ("a, b") oder Array. */
export async function setPdfMetadata(bytes, { title, author, subject, keywords } = {}) {
  const doc = await loadPdf(bytes);
  if (title != null) doc.setTitle(title);
  if (author != null) doc.setAuthor(author);
  if (subject != null) doc.setSubject(subject);
  if (keywords != null) {
    const list = Array.isArray(keywords)
      ? keywords
      : String(keywords).split(",").map((s) => s.trim()).filter(Boolean);
    doc.setKeywords(list);
  }
  return doc.save();
}

/** Bestehende Metadaten lesen (zum Vorbefüllen des Dialogs). */
export async function getPdfMetadata(bytes) {
  const doc = await loadPdf(bytes);
  return {
    title: doc.getTitle() || "",
    author: doc.getAuthor() || "",
    subject: doc.getSubject() || "",
    keywords: doc.getKeywords() || "",
    pageCount: doc.getPageCount(),
  };
}

// A4 in PDF-Punkten
const A4_W = 595.28;
const A4_H = 841.89;

/**
 * Bilder (File[] oder data-URL[]; JPG/PNG) → PDF, je Bild eine Seite in
 * Bildgröße (auf maximal A4 herunterskaliert).
 */
export async function imagesToPdf(files) {
  if (!files || !files.length) throw new Error("Bitte mindestens ein Bild auswählen.");
  const doc = await PDFDocument.create();
  for (const f of files) {
    const dataUrl = typeof f === "string" ? f : await fileToDataUrl(f);
    const isPng = dataUrl.startsWith("data:image/png");
    const isJpg = dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg");
    if (!isPng && !isJpg) {
      const name = typeof f === "string" ? "Bild" : f.name;
      throw new Error(`"${name}": Nur JPG- und PNG-Bilder werden unterstützt.`);
    }
    const imgBytes = dataUrlToBytes(dataUrl);
    const img = isPng ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
    const factor = Math.min(1, A4_W / img.width, A4_H / img.height);
    const w = img.width * factor;
    const h = img.height * factor;
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

// ---------------------------------------------------------------------------
// Operationen (pdfjs — Rendern)
// ---------------------------------------------------------------------------

/**
 * PDF → PNG-data-URLs (eine je Seite). scale 2 = ca. 144 dpi.
 * onProgress(seite, gesamt) wird vor jeder Seite aufgerufen.
 */
export async function pdfToImages(bytes, { scale = 2, onProgress } = {}) {
  const pdf = await openWithPdfjs(bytes);
  try {
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      out.push(canvas.toDataURL("image/png"));
    }
    return out;
  } finally {
    pdf.destroy();
  }
}

/**
 * PDF "komprimieren": Seiten werden via pdfjs gerendert, als JPEG re-kodiert
 * und in ein neues PDF in den Originalseitenmaßen eingebettet.
 *
 * EHRLICHER HINWEIS: Das rastert das Dokument neu — Text ist danach nicht mehr
 * selektier- oder durchsuchbar. Bei text-lastigen PDFs kann die Datei sogar
 * größer werden; der Gewinn entsteht vor allem bei scan-/bildlastigen PDFs.
 */
export async function compressPdf(bytes, { quality = 0.6, scale = 1.3, onProgress } = {}) {
  const pdf = await openWithPdfjs(bytes);
  try {
    const out = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 }); // Originalmaße in PDF-Punkten
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // JPEG kennt keine Transparenz
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const jpeg = await out.embedJpg(dataUrlToBytes(canvas.toDataURL("image/jpeg", quality)));
      const p = out.addPage([base.width, base.height]);
      p.drawImage(jpeg, { x: 0, y: 0, width: base.width, height: base.height });
    }
    return out.save();
  } finally {
    pdf.destroy();
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Bytes als Datei herunterladen (Blob + unsichtbarer a[download]-Klick). */
export function downloadBytes(bytes, filename, mime = "application/pdf") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** data-URL (z. B. PNG aus pdfToImages) als Datei herunterladen. */
export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
