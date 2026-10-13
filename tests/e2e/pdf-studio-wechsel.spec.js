// PDF studio against the Express dev stack (Review Testhaus): renders with the current pdfjs-dist
// (stage 2 of .planning/UPDATE-PLAN-2026-10-13.md) and survives a document switch:
//  1. two PDF documents of the project (created through the API, inline data URL);
//  2. tab "PDF-Studio" → click the first and immediately the second document;
//  3. the second document renders into the canvas, no error toast, console clean.
// Not a deterministic guard for the cancelled-load path (pdfFreigeben): these small PDFs usually
// finish loading before the second click, so the old pdfDoc.destroy() passed here as well.
// Everything the spec creates is deleted in `finally`.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Buffer } from "node:buffer";

const API = "/api/entities";
const MARKE = "E2E-Studio";

/** A small PDF with `seiten` pages and a heading, as data URL. */
async function pdfDataUrl(titel, seiten) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < seiten; i++) doc.addPage([595, 842]).drawText(`${titel} Seite ${i + 1}`, { x: 60, y: 760, size: 28, font });
  return `data:application/pdf;base64,${Buffer.from(await doc.save()).toString("base64")}`;
}

test("PDF-Studio: schneller Dokumentwechsel rendert das zweite Dokument ohne Fehler", async ({ page, request }) => {
  test.setTimeout(120000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const r = await (await request.get(`${API}/Document?project_id=${projekt.id}`)).json();
    for (const d of (Array.isArray(r) ? r : []).filter((x) => String(x.name || "").startsWith(MARKE))) await request.delete(`${API}/Document/${d.id}`);
  };
  await aufraeumen();
  const warnungen = [];
  try {
    for (const [name, seiten] of [[`${MARKE}-A.pdf`, 3], [`${MARKE}-B.pdf`, 2]]) {
      const r = await request.post(`${API}/Document`, { data: { project_id: projekt.id, name, mime: "application/pdf", data: await pdfDataUrl(name, seiten), uploaded_date: new Date().toISOString() } });
      expect(r.ok(), `Document ${name}`).toBeTruthy();
    }
    await nurLocalhost(page);
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    await page.goto(`/BitAegis?projekt=${encodeURIComponent("Review Testhaus")}`);
    await page.getByRole("tab", { name: "PDF-Studio" }).click({ timeout: 30000 });
    const a = page.getByRole("button", { name: new RegExp(`${MARKE}-A`) });
    const b = page.getByRole("button", { name: new RegExp(`${MARKE}-B`) });
    await expect(b).toBeVisible({ timeout: 30000 });
    await a.click();
    await b.click();
    const canvas = page.getByRole("img", { name: "Gerenderte PDF-Seite" });
    await expect(canvas).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => canvas.evaluate((c) => /** @type {HTMLCanvasElement} */ (c).width), { timeout: 30000 }).toBeGreaterThan(100);
    await expect(page.getByText("PDF konnte nicht geladen werden")).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
