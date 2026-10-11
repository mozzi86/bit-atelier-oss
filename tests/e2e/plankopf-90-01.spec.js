// Headless-Nachweis 90-01 (Plankopf-Generator im PDF-Studio): Werkzeug „Plankopf setzen“
// öffnen, ein A3-Plan-PDF mit einem alten Büro-Plankopf hochladen, Felder sind aus dem
// Projekt/Büroprofil vorbelegt; normal → Ergebnis „…_Plankopf.pdf“; neutral → Büro-Felder
// verschwinden, „Anlage zu“ erscheint, Ergebnis „…_Anlage.pdf“. Sicherheitsnachweis: der
// heruntergeladene neutrale Anhang enthält den Text des alten Plankopfs NICHT mehr (Seiten neu
// gerastert — keine Schrift im PDF). Konsole bleibt sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import { Buffer } from "node:buffer";

const PT_JE_MM = 72 / 25.4;
const ALT = "ALTER BUEROPLANKOPF NICHT AUSLIEFERN";

async function planPdf() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([420 * PT_JE_MM, 297 * PT_JE_MM]);
  p.drawText("Planinhalt Muster", { x: 60, y: 700, size: 14, font: f });
  p.drawText(ALT, { x: p.getWidth() - 170 * PT_JE_MM, y: 30 * PT_JE_MM, size: 10, font: f });
  return Buffer.from(await d.save());
}

test.describe("90-01 Plankopf-Generator", () => {
  test.setTimeout(180000);

  test("normal + neutral über den Dialog; neutraler Anhang ohne Text des alten Plankopfs", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto("/BitAegis");
    await page.getByText("Plankopf setzen", { exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"][accept="application/pdf"]').setInputFiles({ name: "Testplan-A3.pdf", mimeType: "application/pdf", buffer: await planPdf() });

    // Normal: rows from the project + office profile, office field present.
    await expect(dialog.getByTestId("pk-feld-planverfasser")).toBeVisible();
    await dialog.getByTestId("pk-feld-planinhalt").fill("Grundriss Erdgeschoss");
    await dialog.getByRole("button", { name: "Plankopf setzen" }).click();
    await expect(dialog.getByText("Testplan-A3_Plankopf.pdf")).toBeVisible({ timeout: 30000 });

    // Neutral: office fields gone, "Anlage zu" and the raster switch (default on) appear.
    await dialog.getByTestId("pk-modus").locator("input").nth(1).check();
    await expect(dialog.getByTestId("pk-feld-planverfasser")).toHaveCount(0);
    await expect(dialog.getByTestId("pk-feld-gezeichnet")).toHaveCount(0);
    await expect(dialog.getByTestId("pk-rastern")).toBeChecked();
    await dialog.getByTestId("pk-feld-anlageZu").fill("LV 012 Rohbauarbeiten");
    await dialog.getByRole("button", { name: "Plankopf setzen" }).click();
    await expect(dialog.getByText("Testplan-A3_Anlage.pdf")).toBeVisible({ timeout: 60000 });

    // Download the neutral attachment and prove the old block's text is gone (no font left).
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: /Herunterladen/ }).first().click()]);
    const bytes = fs.readFileSync(await download.path());
    const roh = bytes.toString("latin1");
    expect(roh.includes(ALT), "Klartext des alten Plankopfs").toBe(false);
    expect((roh.match(/\/Font\b/g) || []).length, "keine Schrift mehr im neutralen Anhang").toBe(0);
    const neu = await PDFDocument.load(bytes);
    expect(neu.getPageCount()).toBe(1);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
