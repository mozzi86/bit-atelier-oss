// Headless-Nachweis 89-04 (D-BW-03): der IFC-Viewer zählt Bauteile je Status, Bauteile ohne Status
// heißen „ohne Status" (kein Neubau-Default) und lassen sich je Status aus- und wieder einblenden.
// Musterprojekt (public/beispiel), nichts wird gespeichert. Konsole sauber.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

test("89-04 Status je Bauteil: Zähler, ohne Status, Ausblenden", async ({ page }) => {
  test.setTimeout(240000);
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

  await page.goto("/IfcViewer?beispiel=1");
  const anzeige = page.getByTestId("status-sichtbarkeit");
  await expect(anzeige).toBeVisible({ timeout: 180000 });
  await expect(anzeige).toHaveAttribute("data-ausgeblendet", "0");

  const zahl = async (k) => Number((await page.getByTestId(`status-anzahl-${k}`).innerText()).replace(/\./g, ""));
  const zahlen = {};
  for (const k of ["abbruch", "neubau", "bestand", "ohne"]) zahlen[k] = await zahl(k);
  const summe = Object.values(zahlen).reduce((a, b) => a + b, 0);
  expect(summe).toBeGreaterThan(0);
  console.log(`[89-04] Status im Musterprojekt: ${JSON.stringify(zahlen)}`);

  // The largest group is hidden and shown again.
  const groesste = Object.entries(zahlen).sort((a, b) => b[1] - a[1])[0][0];
  await page.getByTestId(`status-sichtbar-${groesste}`).click();
  await expect(page.getByTestId(`status-sichtbar-${groesste}`)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => Number(await anzeige.getAttribute("data-ausgeblendet"))).toBeGreaterThan(0);
  await page.getByTestId(`status-sichtbar-${groesste}`).click();
  await expect(anzeige).toHaveAttribute("data-ausgeblendet", "0");

  // Legend and filter name the unknown state.
  await expect(page.getByTestId("status-sichtbar-ohne")).toContainText("ohne Status");
  await expect(page.locator("option[value=ohne]")).toHaveText("ohne Status");
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
});
