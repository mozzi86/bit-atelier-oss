// 104-09 against the Express dev stack (Review Testhaus): the PDF studio writes its annotations into
// the file as an incremental update and recovers unsaved work after a "crash" (page reload).
//  1. a PDF with a cross-reference stream (pdf-lib default) is created through the API;
//  2. pin + freehand annotation in the studio → "Im PDF speichern" → the stored file begins with exactly
//     the original bytes, pdf-lib reads it back with both studio annotations (/NM bit-atelier:…);
//  3. pin comment typed but not confirmed → reload → "Wiederherstellen" brings the draft back;
//  4. server refuses the new annotation (route aborted) → kept in the browser → reload with the server
//     reachable again → "Wiederherstellen" creates the record on the server;
//  5. a fixed document (Document.sha256 = proof of what was sent) can be annotated on screen, but
//     "Im PDF speichern" stays locked and its stored bytes and checksum stay exactly as they were.
// Console must stay clean apart from the intentionally aborted request. Everything is deleted in `finally`.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFString, StandardFonts } from "pdf-lib";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";

const API = "/api/entities";
const MARKE = "E2E-Anhang-10409";
const JOURNAL = "bit-pdfstudio-journal:";

/** A small 2-page PDF (pdf-lib default save: object streams + cross-reference stream). */
async function testPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawText(`${MARKE} Seite ${i + 1}`, { x: 60, y: 760, size: 22, font });
  return Buffer.from(await doc.save());
}

/** Journal texts in localStorage of the page (empty string when none). */
const journalText = (page) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).map((k) => localStorage.getItem(k)).join("\n"), JOURNAL);

test("PDF-Studio 104-09: anhängend speichern (Original unverändert) + Wiederherstellung nach Absturz", async ({ page, request }) => {
  test.setTimeout(180000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const r = await (await request.get(`${API}/Document?project_id=${projekt.id}`)).json();
    for (const d of (Array.isArray(r) ? r : []).filter((x) => String(x.name || "").startsWith(MARKE))) {
      const anns = await (await request.get(`${API}/PdfAnnotation?document_id=${d.id}`)).json();
      for (const a of Array.isArray(anns) ? anns : []) await request.delete(`${API}/PdfAnnotation/${a.id}`);
      await request.delete(`${API}/Document/${d.id}`);
    }
  };
  await aufraeumen();
  const warnungen = [];
  try {
    const original = await testPdf();
    const name = `${MARKE}.pdf`;
    const r = await request.post(`${API}/Document`, { data: { project_id: projekt.id, name, mime: "application/pdf", size: original.length, data: `data:application/pdf;base64,${original.toString("base64")}`, uploaded_date: new Date().toISOString() } });
    expect(r.ok(), "Document anlegen").toBeTruthy();
    const dokId = (await r.json()).id;

    await nurLocalhost(page);
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    const canvas = page.getByRole("img", { name: "Gerenderte PDF-Seite" });
    const oeffnen = async (dokName = new RegExp(MARKE)) => {
      await page.goto(`/BitAegis?projekt=${encodeURIComponent("Review Testhaus")}`);
      await page.getByRole("tab", { name: "PDF-Studio" }).click({ timeout: 30000 });
      await page.getByRole("button", { name: dokName }).click({ timeout: 30000 });
      await expect(canvas).toBeVisible({ timeout: 30000 });
      await expect.poll(async () => canvas.evaluate((c) => /** @type {HTMLCanvasElement} */ (c).width), { timeout: 30000 }).toBeGreaterThan(100);
      // 50 % zoom: the whole page fits into the viewer's scroll box (75vh), every click point is visible.
      await page.getByRole("button", { name: "Verkleinern" }).click();
      await page.getByRole("button", { name: "Verkleinern" }).click();
      await expect(page.getByText("50 %", { exact: true })).toBeVisible();
    };
    /** Click on the page at a share of its displayed size (the overlay sits on top of the canvas). */
    const aufSeite = async (u, v) => {
      await canvas.evaluate((c) => c.scrollIntoView({ block: "center" }));
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width * u, box.y + box.height * v);
    };
    const speichernKnopf = page.getByTestId("pdf-im-pdf-speichern");

    // --- 2. annotate and save into the PDF ---
    await oeffnen();
    await page.getByRole("button", { name: "Kommentar-Pin" }).click();
    await aufSeite(0.3, 0.2);
    await page.getByPlaceholder("Kommentar eingeben...").fill("Maß prüfen");
    await page.getByPlaceholder("Kommentar eingeben...").press("Enter");
    // Text tool by mouse click (B-104-09-01: the field used to vanish at once — the overlay's mousedown
    // took the focus and the empty blur closed it).
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await aufSeite(0.6, 0.3);
    await expect(page.getByPlaceholder("Text...")).toBeFocused();
    await page.getByPlaceholder("Text...").fill("Notiz per Klick");
    await page.getByPlaceholder("Text...").press("Enter");
    // Freehand stroke.
    await page.getByRole("button", { name: "Freihand" }).click();
    await canvas.evaluate((c) => c.scrollIntoView({ block: "center" }));
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.65, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.75, { steps: 6 });
    await page.mouse.up();
    await expect(speichernKnopf).toHaveAttribute("data-offen", "3", { timeout: 15000 });
    await speichernKnopf.click();
    await expect(page.getByText(/Im PDF gespeichert/)).toBeVisible({ timeout: 30000 });
    await expect(speichernKnopf).toHaveAttribute("data-offen", "0", { timeout: 30000 });

    const gespeichert = (await (await request.get(`${API}/Document/${dokId}`)).json());
    expect(Object.keys(gespeichert.pdf_anmerkungen || {}).length).toBe(3);
    expect(gespeichert.original_bytes).toBe(original.length);
    const datei = Buffer.from(String(gespeichert.data).split(",")[1], "base64");
    expect(datei.length).toBeGreaterThan(original.length);
    expect(datei.subarray(0, original.length).equals(original), "erste N Bytes = Original").toBe(true);
    const wieder = await PDFDocument.load(datei);
    const namen = wieder.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.asArray().map((ref) => {
      const d = wieder.context.lookup(ref);
      const nm = d instanceof PDFDict ? d.get(PDFName.of("NM")) : null;
      return nm instanceof PDFHexString || nm instanceof PDFString ? nm.decodeText() : "";
    }) || [];
    expect(namen.length, "Pin + Text + Freihand auf Seite 1").toBe(3);
    expect(namen.every((n) => n.startsWith("bit-atelier:"))).toBe(true);
    expect(wieder.getPageCount()).toBe(2);

    // --- 3. draft typed, then "crash" (reload) ---
    await page.getByRole("button", { name: "Kommentar-Pin" }).click();
    await aufSeite(0.6, 0.4);
    await page.getByPlaceholder("Kommentar eingeben...").fill("Entwurf nach Absturz");
    await expect.poll(() => journalText(page), { timeout: 15000 }).toContain("Entwurf nach Absturz");
    await page.reload();
    await oeffnen();
    const angebot = page.getByTestId("pdf-wiederherstellen");
    await expect(angebot).toBeVisible({ timeout: 30000 });
    await angebot.getByRole("button", { name: "Wiederherstellen" }).click();
    await expect(page.getByPlaceholder("Kommentar eingeben...")).toHaveValue("Entwurf nach Absturz");
    await page.getByPlaceholder("Kommentar eingeben...").press("Escape");
    await expect.poll(() => journalText(page), { timeout: 15000 }).toBe("");

    // --- 4. server refuses the annotation → kept locally → restored once the server is back ---
    const sperre = (route) => (route.request().method() === "POST" ? route.abort() : route.fallback());
    await page.route("**/api/entities/PdfAnnotation**", sperre);
    await aufSeite(0.5, 0.8);
    await page.getByPlaceholder("Kommentar eingeben...").fill("Offline-Pin");
    await page.getByPlaceholder("Kommentar eingeben...").press("Enter");
    await expect(page.getByTestId("pdf-lokal-gesichert")).toBeVisible({ timeout: 15000 });
    await expect.poll(() => journalText(page), { timeout: 15000 }).toContain("Offline-Pin");
    await page.unroute("**/api/entities/PdfAnnotation**", sperre);
    await page.reload();
    await oeffnen();
    await expect(angebot).toBeVisible({ timeout: 30000 });
    await angebot.getByRole("button", { name: "Wiederherstellen" }).click();
    await expect.poll(async () => {
      const anns = await (await request.get(`${API}/PdfAnnotation?document_id=${dokId}`)).json();
      return (Array.isArray(anns) ? anns : []).map((a) => a.text).sort();
    }, { timeout: 15000 }).toEqual(["", "Maß prüfen", "Notiz per Klick", "Offline-Pin"]);
    await expect(page.getByTestId("pdf-lokal-gesichert")).toHaveCount(0);
    await expect(speichernKnopf).toHaveAttribute("data-offen", "1");
    await expect.poll(() => journalText(page), { timeout: 15000 }).toBe("");

    // --- 5. fixed document: annotate on screen, the file itself is never written ---
    const festDaten = `data:application/pdf;base64,${original.toString("base64")}`;
    const festSha = crypto.createHash("sha256").update(original).digest("hex");
    const rf = await request.post(`${API}/Document`, { data: { project_id: projekt.id, name: `${MARKE}-fest.pdf`, mime: "application/pdf", size: original.length, data: festDaten, sha256: festSha, uploaded_date: new Date().toISOString() } });
    expect(rf.ok(), "festgeschriebenes Document anlegen").toBeTruthy();
    const festId = (await rf.json()).id;
    await oeffnen(new RegExp(`${MARKE}-fest`));
    await expect(page.getByTestId("pdf-festgeschrieben")).toBeVisible({ timeout: 15000 });
    await expect(speichernKnopf).toHaveAttribute("data-festgeschrieben", "ja");
    await page.getByRole("button", { name: "Kommentar-Pin" }).click();
    await aufSeite(0.4, 0.3);
    await page.getByPlaceholder("Kommentar eingeben...").fill("Pin auf versendetem Schreiben");
    await page.getByPlaceholder("Kommentar eingeben...").press("Enter");
    await expect(speichernKnopf).toHaveAttribute("data-offen", "1", { timeout: 15000 });
    await expect(speichernKnopf).toBeDisabled();
    await expect.poll(async () => {
      const anns = await (await request.get(`${API}/PdfAnnotation?document_id=${festId}`)).json();
      return (Array.isArray(anns) ? anns : []).map((a) => a.text);
    }, { timeout: 15000 }).toEqual(["Pin auf versendetem Schreiben"]);
    const fest = await (await request.get(`${API}/Document/${festId}`)).json();
    expect(fest.data, "Bytes unverändert").toBe(festDaten);
    expect(fest.sha256, "Prüfsumme unverändert").toBe(festSha);
    expect(fest.pdf_anmerkungen ?? null, "nichts ins PDF geschrieben").toBeNull();

    await expect(page.getByText("PDF konnte nicht geladen werden")).toHaveCount(0);
    // The aborted POST and the studio's own warning toast are intended; nothing else may show up.
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
