// PDF helpers built on jsPDF + html2canvas (both already in package.json).
// We render a styled HTML "paper" node and rasterise it into a multi-page A4 PDF.
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { dokumentAblegen } from "@core/lib/ablage";

/**
 * Ein DOM-Element als mehrseitiges A4-PDF exportieren.
 *
 * Ablage (26.08.2026): Wird `ablage` übergeben, wird der Export zusätzlich in der
 * Projektablage registriert — im Ordner, den `@core/lib/ordnerBaum.js` für diesen
 * Dokumenttyp bzw. Designer-Reiter vorsieht. Vorher endete jeder Export im
 * Download-Ordner und das Projekt erfuhr nichts davon.
 *
 * Die Ablage ist bewusst NACH `pdf.save()` und fängt ihre Fehler selbst ab: ein
 * Ablage-Problem darf den Export nie kippen — die Datei ist dann beim Nutzer,
 * nur der Nachweis fehlt. Das Ergebnis wird zurückgegeben, damit der Aufrufer
 * dem Nutzer sagen kann, wo es liegt.
 *
 * 71-03 (`alsBytes`): Das Lieferpaket braucht die PDF-BYTES, nicht die Datei
 * im Download-Ordner — mit `alsBytes: true` wird NICHT gespeichert und NICHT
 * abgelegt, sondern `{ bytes }` (Uint8Array, `jsPDF.output('arraybuffer')`)
 * zurückgegeben; das Paket ist dann der Nachweis. Ohne die Option bleibt das
 * Verhalten unverändert.
 *
 * @param {HTMLElement} el
 * @param {string} filename
 * @param {{orientation?: "portrait"|"landscape",
 *          ablage?: {projectId: string, typ?: string, reiter?: string, notiz?: string},
 *          alsBytes?: boolean}} [opt]
 * @returns {Promise<{abgelegt: boolean, pfad?: Array<string>, grund?: string, bytes?: Uint8Array}|undefined>}
 */
export async function exportElementToPdf(el, filename, { orientation = "portrait", ablage, alsBytes = false } = {}) {
  if (!el) return;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
  const img = canvas.toDataURL("image/jpeg", 0.92);
  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(img, "JPEG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(img, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
  }
  if (alsBytes) {
    return { abgelegt: false, bytes: new Uint8Array(pdf.output("arraybuffer")) };
  }
  pdf.save(filename);

  if (!ablage?.projectId) return { abgelegt: false };
  const r = await dokumentAblegen({ ...ablage, name: filename });
  return { abgelegt: r.ok, pfad: r.pfad, grund: r.grund };
}

// Read an uploaded File as a data URL (for storing/previewing imported PDFs).
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
