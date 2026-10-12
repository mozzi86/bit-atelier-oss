// Headless proof 69-21: the check suite reads IFC models in a Web Worker, so the main thread
// is never blocked long while web-ifc opens the model and streams the meshes.
//
// Measurement: a 10 ms heartbeat installed before the page loads; the longest gap between two
// ticks after "model reading started" until "model loaded" is the longest main-thread block.
// A control (deliberate 150 ms block) proves the instrument sees blocks at all. Gate from
// the roadmap: no main-thread block of 100 ms or more during the reading.
// Test 1: the sample project (button "Beispiel laden") — worker started, model card shows the
// geometry count, gate holds.
// Test 2 (optional): a large local model given by BIT_IFC_GROSS=<path> through the file input
// (skipped when unset — large models are not committed).
//
// Run: npx playwright test tests/e2e/ifc-worker-69-21.spec.js --workers=1

import fs from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * Install a heartbeat before any page script runs: a 10 ms timer chain records every gap between
 * two ticks. A gap is the time the main thread was blocked (plus the 10 ms period). Chosen over
 * PerformanceObserver("longtask"), which recorded nothing in headless Chromium (control failed).
 */
async function langeAufgabenMessen(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__luecken = [];
    let letzte = performance.now();
    const tick = () => {
      const jetzt = performance.now();
      w.__luecken.push({ start: letzte, dauer: jetzt - letzte - 10 });
      if (w.__luecken.length > 20000) w.__luecken.splice(0, 10000);
      letzte = jetzt;
      setTimeout(tick, 10);
    };
    setTimeout(tick, 10);
  });
}

/** Longest main-thread block (ms) among gaps that ended after `ab` (performance.now()). */
async function laengsteAb(page, ab) {
  return page.evaluate((t) => /** @type {any} */ (window).__luecken
    .filter((e) => e.start + e.dauer + 10 > t).reduce((m, e) => Math.max(m, e.dauer), 0), ab);
}

test.describe("69-21 IFC-Lesen im Web Worker", () => {
  test("Musterprojekt: Worker liest, Hauptthread nie ≥ 100 ms blockiert", async ({ page }) => {
    await langeAufgabenMessen(page);
    const workerUrls = [];
    page.on("worker", (w) => workerUrls.push(w.url()));
    await page.goto("/ModelCheck");
    await expect(page.getByTestId("beispiel-laden")).toBeVisible({ timeout: 60000 });
    const ab = await page.evaluate(() => performance.now());
    await page.getByTestId("beispiel-laden").click();
    await expect(page.getByText(/\d+ Bauteil-Geometrien/).first()).toBeVisible({ timeout: 120000 });
    expect(workerUrls.some((u) => /ifcLesen\.worker/.test(u)), `Worker gestartet: ${workerUrls.join(", ")}`).toBe(true);
    const laengste = await laengsteAb(page, ab);
    console.log(`[69-21] längste Hauptthread-Aufgabe nach Klick: ${Math.round(laengste)} ms`);
    expect(laengste).toBeLessThan(100);
    // Control: the instrument must see a deliberate 150 ms block, otherwise "0 ms" proves nothing.
    const kontrolleAb = await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 150) { /* busy */ } return t; });
    await page.waitForTimeout(300);
    expect(await laengsteAb(page, kontrolleAb), "Messung erkennt eine 150-ms-Blockade").toBeGreaterThanOrEqual(100);
  });

  test("großes lokales Modell (BIT_IFC_GROSS): Lesen blockiert nicht", async ({ page }) => {
    const pfad = process.env.BIT_IFC_GROSS;
    test.skip(!pfad || !fs.existsSync(pfad), "BIT_IFC_GROSS nicht gesetzt");
    await langeAufgabenMessen(page);
    await page.goto("/ModelCheck");
    const eingabe = page.locator('input[type="file"][accept*="ifc" i]').first();
    await expect(eingabe).toBeAttached({ timeout: 60000 });
    const ab = await page.evaluate(() => performance.now());
    await eingabe.setInputFiles(/** @type {string} */ (pfad));
    await expect(page.getByText(/\d+ Bauteil-Geometrien/).first()).toBeVisible({ timeout: 300000 });
    const laengste = await laengsteAb(page, ab);
    console.log(`[69-21] großes Modell: längste Hauptthread-Aufgabe ${Math.round(laengste)} ms`);
    expect(laengste).toBeLessThan(100);
  });
});
