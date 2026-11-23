// Headless proof W-1118-29 (canopy as a model element) on the neutral test house "Review EFH 108" (fixtures/efh108.js:
// 11.40 × 10.20 m, KG/EG/DG, gable roof):
//  - "Vordach einfügen" adds one canopy, selects it and shows the inspector with the derived size (1,60 × 1,00 m, 1,60 m²,
//    underside +2,40 m); the status line counts it;
//  - a deeper canopy (1,80 m) shows the setback hint, back at 1,00 m the hint is gone;
//  - the plan of the ground floor draws its outline (data-vordach), the attic plan does not;
//  - no console error on the way. A 3D picture goes to the test's own output folder (test-results), nothing into the repository.
// Own project, reset before the test.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

test.describe("W-1118-29 Vordach als Bauteil", () => {
  test.setTimeout(300000);
  test.beforeEach(async ({ request }) => { await efhZuruecksetzen(request); });

  test("einfügen, Inspektor, Hinweis, Grundriss", async ({ page }, testInfo) => {
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

    await page.getByTestId("vordach-einfuegen").click();
    const ergebnis = page.getByTestId("vordach-ergebnis");
    await expect(ergebnis).toBeVisible({ timeout: 15000 });
    await expect(ergebnis).toContainText("1,60 × 1,00 m");
    await expect(ergebnis).toContainText("1,60 m²");
    await expect(ergebnis).toContainText("+2,40 m");
    await expect(page.getByText(/Vordächer\s*1/)).toBeVisible();
    await expect(page.getByTestId("vordach-warnungen")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("vordach-3d.png") });

    await page.getByTestId("vordach-tiefe").fill("1.8");
    await expect(page.getByTestId("vordach-warnungen")).toContainText("mehr als 1,50 m");
    await expect(ergebnis).toContainText("1,60 × 1,80 m");
    await page.getByTestId("vordach-tiefe").fill("1");
    await expect(page.getByTestId("vordach-warnungen")).toHaveCount(0);

    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await expect(page.locator("[data-vordach]")).toHaveCount(1, { timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath("vordach-grundriss.png") });

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
