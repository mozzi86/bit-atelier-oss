import { test, expect } from "@playwright/test";

/**
 * Smoke-Tests für NovaConstruct.
 * Prüfen, dass die App lädt, kein JS-Crash auftritt und die Kern-Navigation erreichbar ist.
 */

test("App lädt ohne harte Konsolenfehler", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  // Bekanntes, unkritisches Rauschen (z. B. fehlende Favicons) herausfiltern.
  const harte = errors.filter(
    (e) => !/favicon|net::ERR_|404|Download the React DevTools/i.test(e),
  );
  expect(harte, `Konsolenfehler:\n${harte.join("\n")}`).toEqual([]);
});

test("Komplex-Designer ist erreichbar", async ({ page }) => {
  await page.goto("/ComplexDesigner");
  await expect(
    page.getByRole("heading", { name: /Komplex-Designer/i }),
  ).toBeVisible({ timeout: 15_000 });
});
