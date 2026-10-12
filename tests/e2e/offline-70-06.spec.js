// Headless-Nachweis 70-06 (Register Nr. 50): online zeigt die Seitenleiste keine Offline-Zeichen; geht das
// Gerät offline, tragen genau die Module mit Netzbedarf (Komplex-Designer, Machbarkeit, AVA, KI-Zentrale,
// Leitstand) ein Zeichen mit Klartext; wieder online verschwinden sie.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

test("70-06 Offline-Zeichen je Modul in der Seitenleiste", async ({ page, context }) => {
  test.setTimeout(90000);
  await nurLocalhost(page);
  await page.goto(`/Dashboard?projekt=Review%20Testhaus`);
  await expect(page.getByRole("link", { name: /Projekte/ }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("nav-offline")).toHaveCount(0);
  await context.setOffline(true);
  await expect.poll(async () => page.getByTestId("nav-offline").count(), { timeout: 10000 }).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("nav-offline").first()).toHaveAttribute("title", /offline nutzbar|Internetverbindung/);
  await context.setOffline(false);
  await expect(page.getByTestId("nav-offline")).toHaveCount(0, { timeout: 10000 });
});
