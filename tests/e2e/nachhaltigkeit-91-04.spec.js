// Headless-Nachweis 91-04 (Nachhaltigkeitskonzept-Blatt) am Review-Testhaus: Reiter Energie zeigt die
// Karte mit den vier Abschnitten; die Zisterne hat DASSELBE Volumen wie die Karte „Regenwassernutzung“
// im Entwässerungsplaner (eine Quelle: useRegenwasser); der PDF-Knopf lädt ein PDF mit Titel und
// Abschnitten. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const PROJEKT = "projekt=Review%20Testhaus";

test("91-04 Nachhaltigkeitskonzept: Karte mit vier Abschnitten, Zisterne wie im Entwässerungsplaner, PDF", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 1600 });
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

  await page.goto(`/ComplexDesigner?${PROJEKT}&tab=haustechnik`);
  await page.getByTestId("ht-tab-entwaesserung").click();
  const rw = page.getByTestId("rw-karte");
  await expect(rw).toBeVisible({ timeout: 30000 });
  await expect(rw).not.toHaveAttribute("data-klima", "laedt", { timeout: 30000 });
  const speicher = Number(await rw.getAttribute("data-speicher"));
  expect(speicher).toBeGreaterThan(0);

  await page.goto(`/ComplexDesigner?${PROJEKT}&tab=energy`);
  const karte = page.getByTestId("nk-karte");
  await expect(karte).toBeVisible({ timeout: 30000 });
  for (const k of ["regenwasser", "gruendach", "pv", "versiegelung"]) await expect(page.getByTestId(`nk-abschnitt-${k}`)).toBeVisible();
  await expect(karte.getByText("Klima wird geladen …")).toHaveCount(0, { timeout: 30000 });
  const zisterne = page.locator('[data-testid^="nk-wert-regenwasser-"]').filter({ hasText: "Zisterne" });
  await expect(zisterne).toHaveAttribute("data-wert", String(speicher));

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("nk-pdf").click()]);
  expect(download.suggestedFilename()).toMatch(/^Nachhaltigkeitskonzept_.*\.pdf$/);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const text = bytes.toString("latin1");
  for (const s of ["Nachhaltigkeitskonzept", "Regenwassernutzung", "Versiegelung", "ENTWURF"]) expect(text.includes(s), s).toBe(true);
  await expect(page.getByTestId("nk-pdf-status")).toContainText("PDF");
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
});
