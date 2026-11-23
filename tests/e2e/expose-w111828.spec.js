// Headless proof W-1118-28 (exposé picture from the studio scene) on the neutral test house "Review EFH 108":
//  - the panel "Exposé-Bild" opens, a chimney is switched on, the current 3D view is stored as a named view (the list shows
//    it), the surroundings list is edited as JSON and counted;
//  - "Bild der aktuellen Ansicht" downloads a PNG of 3200 × 2000 with the presentation look (sky, roof body, terrain) — far
//    larger than an empty frame;
//  - no console error on the way; the studio still shows its scene afterwards (the picture leaves nothing behind).
// The picture needs a GPU: the ambient occlusion at 3200 × 2000 takes minutes on a software renderer, hence the launch
// flags. Own project, reset before the test; the PNG goes to the test's own output folder.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } });

test.describe("W-1118-28 Exposé-Bild aus der Studio-Szene", () => {
  test.setTimeout(600000);
  test.beforeEach(async ({ request }) => { await efhZuruecksetzen(request); });

  test("Bedienfeld, Blickpunkt, Umfeld, Bild", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm|THREE\./i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 90000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 90000 });
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 30000 });

    await page.getByTestId("expose-oeffnen").click();
    const panel = page.getByTestId("expose-panel");
    await expect(panel).toBeVisible({ timeout: 15000 });
    await page.getByTestId("expose-kamin").check();
    await page.getByTestId("expose-traufe").fill("0.6");

    // the layer is stored with the model and survives a reset of the test house: count from what is there
    const vorher = await page.getByTestId("expose-blick").count();
    await page.getByTestId("expose-blick-name").fill("Strasse");
    await page.getByTestId("expose-blick-neu").click();
    await expect(page.getByTestId("expose-blick")).toHaveCount(vorher + 1);

    await page.getByTestId("expose-umfeld-bearbeiten").click();
    await page.getByTestId("expose-umfeld-text").fill("{ kein json");
    await page.getByTestId("expose-umfeld-ok").click();
    await expect(page.getByTestId("expose-fehler")).toContainText("Umfeld nicht übernommen");
    await page.getByTestId("expose-umfeld-text").fill(JSON.stringify({ baeume: [{ x: -12, z: 6, hoehe_m: 8, krone_m: 3 }], hecken: [{ x0: -14, x1: -13.4, z0: -8, z1: 8, hoehe_m: 1.2 }] }));
    await page.getByTestId("expose-umfeld-ok").click();
    await expect(page.getByTestId("expose-umfeld-zahl")).toContainText("Hecken 1");
    await expect(page.getByTestId("expose-umfeld-zahl")).toContainText("Bäume 1");

    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 240000 }), page.getByTestId("expose-bild-jetzt").click()]);
    expect(d.suggestedFilename()).toMatch(/^Expose_\d{8}\.png$/);
    const datei = testInfo.outputPath("expose.png");
    await d.saveAs(datei);
    const png = fs.readFileSync(datei);
    expect(png.readUInt32BE(16), "Breite").toBe(3200);
    expect(png.readUInt32BE(20), "Höhe").toBe(2000);
    expect(png.length, "kein leeres Bild").toBeGreaterThan(300000);
    await expect(page.getByText(/Exposé-Bild \(3200 × 2000\) heruntergeladen/)).toBeVisible({ timeout: 10000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible();

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
