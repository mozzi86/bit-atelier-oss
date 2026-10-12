// Accessibility statement (Plan 93-02): reachable from the footer of every module page,
// honest content, gap marker instead of an invented contact, links to the other legal pages.
//
// Run: PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/barrierefreiheit-93-02.spec.js --reporter=line

import { test, expect } from "@playwright/test";

test("Erklärung zur Barrierefreiheit: aus der Fußzeile erreichbar, ehrlicher Stand", async ({ page }) => {
  await page.goto("/Projects");
  await page.locator("main footer").getByRole("link", { name: "Barrierefreiheit" }).click();
  await expect(page).toHaveURL(/\/barrierefreiheit$/);
  await expect(page.getByRole("heading", { level: 1, name: "Erklärung zur Barrierefreiheit" })).toBeVisible();
  await expect(page.getByText("teilweise barrierefrei")).toBeVisible();
  await expect(page.getByText("noch nicht in Betrieb")).toBeVisible();
  // No operator contact set yet → the gap marker, never an invented name.
  await expect(page.getByText(/Ansprechpartner für Barrierefreiheit: — fehlt —/)).toBeVisible();
  // The statement links the other legal pages and is linked back from them.
  const nav = page.getByRole("navigation", { name: "Weitere Rechtstexte" });
  await nav.getByRole("link", { name: "Impressum" }).click();
  await expect(page).toHaveURL(/\/impressum$/);
  await page.getByRole("navigation", { name: "Weitere Rechtstexte" }).getByRole("link", { name: "Barrierefreiheit" }).click();
  await expect(page).toHaveURL(/\/barrierefreiheit$/);
});
