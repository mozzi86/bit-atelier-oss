// The section export (100-01): a VECTOR sheet at true scale from the model data with level marks —
// before it rasterised the screen SVG and stamped "nicht maßstäblich". One own project.
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Schnitt PDF Ref";

test("Schnitt als PDF: Download statt „Keine 2D-Zeichnung gefunden“", async ({ page, request }) => {
  test.setTimeout(120000);
  let id = null;
  try {
    await nurLocalhost(page);
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click({ timeout: 60000 });
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
    await page.getByRole("button", { name: "Schnitt", exact: true }).first().click();
    await expect(page.locator("[data-bim-plan2d] svg").first()).toBeVisible({ timeout: 15000 });
    const download = page.waitForEvent("download", { timeout: 30000 });
    await page.getByRole("button", { name: "Aktuellen Plan als PDF" }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/_Schnitt_1-\d+\.pdf$/);
    await expect(page.getByText("Keine 2D-Zeichnung gefunden.")).toHaveCount(0);
    const pdf = await PDFDocument.load(fs.readFileSync(await d.path()));
    expect(pdf.getTitle()).toMatch(/Schnitt 1:\d+/);
    // DIN sheet in landscape (A3…A0): width in mm is one of the ISO 216 long sides
    expect([420, 594, 841, 1189]).toContain(Math.round(pdf.getPage(0).getSize().width / (72 / 25.4)));
    await expect(page.getByText(/maßstäblich, Vektor|ist für 1:\d+ gedacht/)).toBeVisible();
  } finally {
    if (id) await request.delete(`/api/entities/Project/${id}`).catch(() => {});
  }
});
