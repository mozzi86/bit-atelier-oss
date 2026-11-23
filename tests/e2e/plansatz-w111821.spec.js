// Headless proof W-1118-21 (plan set with dimension chains) on the neutral test house "Review EFH 108" (fixtures/efh108.js:
// 11.40 × 10.20 m, KG/EG/DG, gable roof, two drawn walls and one door on the ground floor):
//  - "Plansatz mit Maßketten als PDF" in the folder panel writes ONE PDF with a sheet per storey and both sections, named
//    "…_Plansatz_1-50.pdf"; the message names the sheets and reports no chain that fails to add up;
//  - every page is a DIN sheet; the set carries the model state in its keywords like the single sheet;
//  - the single sheet ("Aktuellen Plan als PDF") still is one page and carries no dimension chains of the set (one truth: the set
//    is built from the same graphic, the single sheet stays as it was).
// The PDFs go to the test's own output folder (test-results), nothing into the repository. Own project, reset before the test.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

const MM = 72 / 25.4;
const DIN = [[420, 297], [594, 420], [841, 594], [1189, 841]];

test.describe("W-1118-21 Plansatz mit Maßketten", () => {
  test.setTimeout(300000);
  test.beforeEach(async ({ request }) => { await efhZuruecksetzen(request); });

  test("ein PDF mit Grundriss je Geschoss und beiden Schnitten, Ketten gehen auf", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 90000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 90000 });
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 30000 });
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click(); // the plan output sits in the folder panel

    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByTestId("bim-plansatz-pdf").click()]);
    expect(d.suggestedFilename()).toMatch(/_Plansatz_1-50\.pdf$/);
    const datei = testInfo.outputPath("plansatz.pdf");
    await d.saveAs(datei);
    const doc = await PDFDocument.load(fs.readFileSync(datei), { updateMetadata: false });
    expect(doc.getPageCount(), "KG, EG, DG, Schnitt A-A, Schnitt B-B").toBe(5);
    expect(String(doc.getTitle())).toMatch(/Plansatz 1:50/);
    expect(String(doc.getKeywords() || "")).not.toBe("");
    for (const p of doc.getPages()) {
      const b = p.getWidth() / MM, h = p.getHeight() / MM;
      expect(DIN.some(([db, dh]) => Math.abs(db - b) < 0.1 && Math.abs(dh - h) < 0.1), `Blatt ${Math.round(b)} × ${Math.round(h)} mm ist ein DIN-Format`).toBe(true);
    }
    const meldung = page.getByText(/Plansatz 1:50 erstellt — 5 Blätter/);
    await expect(meldung).toBeVisible({ timeout: 10000 });
    await expect(meldung).toContainText("Grundriss KG");
    await expect(meldung).toContainText("Schnitt B-B");
    await expect(meldung).not.toContainText("Achtung");

    // the set has its own scale: 1:100 on request, independent of the screen
    await page.getByTestId("bim-plansatz-massstab").selectOption("100");
    const [h] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByTestId("bim-plansatz-pdf").click()]);
    expect(h.suggestedFilename()).toMatch(/_Plansatz_1-100\.pdf$/);

    // the single sheet is still one page
    const [e] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("bim-plan-pdf").click()]);
    const einzel = testInfo.outputPath("einzel.pdf");
    await e.saveAs(einzel);
    expect((await PDFDocument.load(fs.readFileSync(einzel), { updateMetadata: false })).getPageCount()).toBe(1);

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
