// Headless-Nachweis 75-05 (MS-05): Arbeitsmassstab und Detailgrad im Massing-Studio.
// Tesselierung ueber den Werkstatt-Reiter anwenden -> im Massing bei 1:200 je WE genau ein
// Label, kein Raumname; Chip 1:500 -> keine Labels, Baukoerper "Name · V"; Doppelklick auf ein
// WE-Label oeffnet den WohnungsFokus (Deep-Link ?tab=werkstatt&we=).

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, resetRechteck, nurLocalhost } from "./fixtures/massing.js";

const RAUMNAMEN = /Wohnen|Schlafen|Bad|Küche|Kind|Abstell/; // Flur/Kern sind Erschliessung und werden bei 1:200 benannt

test.describe("75-05 — Arbeitsmassstab + Detailgrad", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 180000 });
  test("1:200 ein Label je WE ohne Raumnamen, 1:500 nur Baukoerper, Doppelklick -> Fokus", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("pageerror", (e) => {
      const stack = e.stack || String(e);
      if (/WebGLProgram|getUniforms|WebGLRenderer/.test(stack)) return;
      warnungen.push("[pageerror] " + stack.split(String.fromCharCode(10)).slice(0, 4).join(" | "));
    });
    page.on("console", (msg) => { if ((msg.type() === "error" || msg.type() === "warning") && !ERLAUBT_OFFLINE.test(msg.text())) warnungen.push(msg.text()); });

    // Rechteck 30 x 20 als Footprint (Tesselierung braucht einen Baukoerper).
    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();
    await resetRechteck(page);

    // Werkstatt: Tesselierung anwenden (Muster tmp-verify-61-05: Layer-Ladefenster abwarten).
    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt");
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    await expect(anwenden).toBeVisible({ timeout: 15000 });
    // Nach einem Reload sind die Store-Zonen weg, der Layer sagt aber "angewendet" (Knopf aus):
    // dann erst entfernen, dann neu anwenden.
    const entfernen = page.getByRole("button", { name: /entfernen/i }).first();
    if ((await anwenden.isDisabled()) && (await entfernen.count())) { await entfernen.click(); await page.waitForTimeout(800); }
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) {
      await anwenden.click();
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(800);
    // WE-Zahl aus der Werkstatt ("8 WE"); Zonen leben nur im Store -> in der App umschalten, nicht neu laden.
    const bodyText = await page.locator("body").innerText();
    const weZahl = Number((bodyText.match(/([0-9]+) WE(?![a-z])/) || [])[1]);
    expect(weZahl, `WE-Zahl aus der Werkstatt: ${bodyText.match(/[0-9]+ WE/) || "keine"}`).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: /Baukörper/ }).first().click();
    const massingTab = page.getByRole("tab", { name: /Massing-Studio/ }).first();
    await massingTab.dispatchEvent("mousedown"); // Radix-Tabs schalten auf mousedown
    await massingTab.click();
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();
    const chip = page.locator("select[data-massstab]");
    await expect(chip).toHaveValue("200");
    const labels = page.locator("[data-we-label]");
    await expect(labels.first()).toBeVisible({ timeout: 15000 });
    const n = await labels.count();
    expect(n, "mindestens zwei WE-Labels").toBeGreaterThanOrEqual(2);
    // Kein Raumname im Plan-SVG, jedes Label beginnt mit "WE".
    const planSvg = page.locator('div.relative:has(polygon[data-griff="flaeche"]) > svg').first();
    const texte = await planSvg.locator("text").allTextContents();
    expect(texte.length, "Texte im Plan-SVG").toBeGreaterThan(0);
    for (const tx of texte) expect(tx, `Raumname im Massing: ${tx}`).not.toMatch(RAUMNAMEN);
    for (let i = 0; i < n; i += 1) expect((await labels.nth(i).locator("tspan").first().textContent()).trim()).toMatch(/^WE /);
    // Labels ueberlappen paarweise nicht.
    const boxes = [];
    for (let i = 0; i < n; i += 1) boxes.push(await labels.nth(i).boundingBox());
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
      const a = boxes[i], b = boxes[j];
      const ueberlappt = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(ueberlappt, `Labels ${i} und ${j} ueberlappen`).toBe(false);
    }
    // Massstabsbalken 20 m bei 1:200.
    await expect(planSvg).toContainText("20 m");

    // 1:500: keine Zonen-Labels, Baukoerper-Label "… · V" (roemische Geschosszahl).
    await chip.selectOption("500");
    expect(await labels.count()).toBe(0);
    await expect(page.locator("[data-baukoerper-label]")).toContainText("·");
    await expect(page.locator("[data-baukoerper-label]")).toHaveText(/[IVX]+$/);
    await expect(planSvg).toContainText("50 m");
    await chip.selectOption("200");

    // Doppelklick auf das erste WE-Label -> Werkstatt-Reiter mit Fokus dieser WE.
    const we = await labels.first().getAttribute("data-we-label");
    await labels.first().dblclick({ force: true });
    await page.waitForURL(/tab=werkstatt/, { timeout: 15000 });
    await expect(page.locator("body")).toContainText(`Fokusansicht: ${we}`, { timeout: 20000 });
    expect(page.url(), "we-Parameter wird nach dem Öffnen entfernt").not.toMatch(/[?&]we=/);

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
