// Headless-Nachweis 90-02 (PDF unveränderbar im PDF-Studio): ein Formular-PDF mit ausgefülltem
// Textfeld, Häkchen und Kommentar hochladen → die Analyse zeigt 2 Formularfelder und 1 Anmerkung;
// „Formular abflachen“ → Download hat keine Felder, keine Anmerkung, kein AcroForm, Seitenzahl gleich;
// „Als Bild-PDF“ → Download enthält keine Schrift mehr (jede Seite ein Bild). Konsole bleibt sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { Buffer } from "node:buffer";
import fs from "node:fs";

async function formularPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const form = doc.getForm();
  const feld = form.createTextField("bieter.name");
  feld.setText("Musterbau GmbH");
  feld.addToPage(page, { x: 50, y: 700, width: 300, height: 24, font });
  const haken = form.createCheckBox("angebot.geprueft");
  haken.check();
  haken.addToPage(page, { x: 50, y: 650, width: 16, height: 16 });
  const ref = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [400, 700, 420, 720] }));
  page.node.set(PDFName.of("Annots"), doc.context.obj([...(page.node.Annots()?.asArray() || []), ref]));
  return Buffer.from(await doc.save());
}

test.describe("90-02 PDF unveränderbar", () => {
  test.setTimeout(180000);

  test("Analyse, Formular abflachen, Bild-PDF", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto("/BitAegis");
    await page.getByText("PDF unveränderbar", { exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"][accept="application/pdf"]').setInputFiles({ name: "Formular.pdf", mimeType: "application/pdf", buffer: await formularPdf() });
    const analyse = dialog.getByTestId("pu-analyse");
    await expect(analyse).toHaveAttribute("data-felder", "2", { timeout: 20000 });
    await expect(analyse).toHaveAttribute("data-annotationen", "1");

    const laden = async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: /Herunterladen/ }).first().click()]);
      return fs.readFileSync(await download.path());
    };

    // Flatten.
    await dialog.getByRole("button", { name: "Unveränderbar machen" }).click();
    await expect(dialog.getByText("Formular_unveraenderbar.pdf")).toBeVisible({ timeout: 30000 });
    const flach = await PDFDocument.load(await laden());
    expect(flach.getPageCount()).toBe(2);
    expect(flach.catalog.get(PDFName.of("AcroForm")), "kein AcroForm").toBeUndefined();
    expect(flach.getPages().every((p) => !p.node.get(PDFName.of("Annots"))), "keine Anmerkungen").toBe(true);

    // Image PDF.
    await dialog.getByTestId("pu-modus").locator("input").nth(1).check();
    await dialog.getByRole("button", { name: "Unveränderbar machen" }).click();
    await expect(dialog.getByText("Formular_unveraenderbar.pdf")).toBeVisible({ timeout: 60000 });
    const bild = await laden();
    expect((bild.toString("latin1").match(/\/Font\b/g) || []).length, "keine Schrift im Bild-PDF").toBe(0);
    expect((await PDFDocument.load(bild)).getPageCount()).toBe(2);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
