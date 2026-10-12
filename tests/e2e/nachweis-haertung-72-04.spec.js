// Headless-Nachweis 72-04 (Nachweis-Härtung): im Brandschutz-Reiter ist eine fehlende Eingabe
// „offen" — nie ein stilles „OK". Fluchtweglänge leeren → Zeile offen, Urteil nennt fehlende
// Angaben, Kopf-Badge nicht grün; Wert eintragen → OK. Panel-Zustand ist lokal (usePanelState),
// es wird nichts gespeichert. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

test("72-04 Brandschutz: fehlende Fluchtweglänge ist offen, nicht OK", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

  await page.goto(`/ComplexDesigner?projekt=Review%20Testhaus&tab=brandschutz`);
  const zeile = page.getByTestId("brand-check-fluchtweg");
  await expect(zeile).toBeVisible({ timeout: 30000 });

  const feld = page.getByLabel("Längste geschätzte Fluchtweglänge");
  await feld.fill("");
  await expect(zeile).toHaveAttribute("data-status", "offen");
  await expect(zeile).toContainText("Fluchtweglänge fehlt");
  await expect(page.getByTestId("brand-urteil")).toContainText("Angaben fehlen");
  await expect(page.getByTestId("brand-urteil")).not.toHaveClass(/emerald/);

  await feld.fill("20");
  await expect(zeile).toHaveAttribute("data-status", "pass");
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
});
