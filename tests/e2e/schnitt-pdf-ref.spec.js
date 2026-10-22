// The section export rasterises the plan SVG it finds through a ref (was: scraping all divs for a
// 520-px height and a class name, which broke silently on a layout change). One own project.
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
    expect(d.suggestedFilename()).toMatch(/\.pdf$/i);
    await expect(page.getByText("Keine 2D-Zeichnung gefunden.")).toHaveCount(0);
  } finally {
    if (id) await request.delete(`/api/entities/Project/${id}`).catch(() => {});
  }
});
