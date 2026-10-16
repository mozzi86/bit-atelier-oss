// 94-08: "Problem melden" in Einstellungen › System & Info — the full text is shown first,
// the link opens GitHub's new-issue page prefilled; nothing is sent from the app and the
// text carries no user folder or e-mail address.
import { test, expect } from "@playwright/test";

test("Problem melden: Vorschau, GitHub-Link, keine persönlichen Spuren (94-08)", async ({ page }) => {
  test.setTimeout(90000);
  const nachGithub = [];
  page.on("request", (r) => { if (/github\.com/.test(r.url())) nachGithub.push(r.url()); });
  await page.goto("/Settings?tab=system");
  const karte = page.getByTestId("problem-melden");
  await expect(karte).toBeVisible({ timeout: 60000 });
  await karte.getByTestId("problem-melden-start").click();
  await page.locator("#problem-beschreibung").fill("Testmeldung aus dem E2E-Lauf");
  await karte.locator("summary").click();
  const vorschau = karte.getByTestId("problem-vorschau");
  await expect(vorschau).toContainText("- Version:");
  await expect(vorschau).toContainText("- Seite: /Settings");
  await expect(vorschau).toContainText("Testmeldung aus dem E2E-Lauf");
  const text = await vorschau.innerText();
  expect(text).not.toMatch(/[A-Za-z]:[\\/]+Users[\\/]+(?!…)/);
  expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const href = await karte.getByTestId("problem-github").getAttribute("href");
  expect(href).toMatch(/^https:\/\/github\.com\/mozzi86\/bit-atelier-oss\/issues\/new\?title=/);
  expect(await karte.getByTestId("problem-github").getAttribute("target")).toBe("_blank");
  expect(nachGithub, "die App selbst schickt nichts an GitHub").toEqual([]);
});
