// Headless-Nachweis 89-02/89-03 (Bauteil-Wahrheit): die Werkstatt des Review-Testhauses zeigt ihr
// Ergebnis als Bauteile (Außenwand-Abschnitte = Hülle, tragende/leichte Innenwände, Türen, Räume)
// und den Rohbau-Zuschlag nach D-BW-02 (Zonen licht, Wände außen — Rohbau > lichte Fläche).
// Der Schallschutz-Reiter liest dieselben Bauteile (Trennwände mit DIN-4109-Anforderung).
// Die Werkstatt muss angewendet sein (Store-Zonen) — Muster fokus-75-09.

import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";
const SEITE_SCHALL = "/ComplexDesigner?projekt=Review%20Testhaus&tab=acoustics";

/**
 * Register the offline route guard + console/pageerror watchers.
 * Everything non-localhost is aborted (no network); WebGL/THREE noise is allowed.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>} the collected warnings array (empty = clean)
 */
async function wacheAuf(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
  });
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/**
 * Open the workshop tab and make sure the storey plan is ready:
 * wt-regeln visible, "fenster je Raum" OFF (so the 1/8 daylight check stays an
 * approximation — the focus KPI shows the badge), unit zones present (apply the
 * tesselation when a previous run left them missing), then wait out the
 * useFachlayer save debounce.
 * @param {import("@playwright/test").Page} page
 */
async function werkstattBereit(page) {
  await page.goto(SEITE_WERKSTATT);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await schalteRegel(page, "fensterJeRaum", false);

  if (!(await page.getByTestId("wt-we").count())) {
    // Store zones are gone after a reload although the layer says "applied":
    // remove first, then re-apply (pattern massing-75-05).
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    await expect(anwenden).toBeVisible({ timeout: 15000 });
    const entfernen = page.getByRole("button", { name: /entfernen/i }).first();
    if ((await anwenden.isDisabled()) && (await entfernen.count())) {
      await entfernen.click();
      await page.waitForTimeout(800);
    }
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) {
      await anwenden.click();
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(800);
  }
  // useFachlayer saves debounced ~1.2 s — wait before anything reloads.
  await page.waitForTimeout(1600);
  expect(await page.getByTestId("wt-we").count(), "WE-Zonen vorhanden").toBeGreaterThan(0);
}

test.describe("89-02/89-03 Werkstatt-Bauteile", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 180000 });

  test("Werkstatt: Bauteilzeile mit Rohbau-Zuschlag; Schallschutz liest die Trennwände", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);
    const zeile = page.getByTestId("wt-bauteile");
    await expect(zeile).toBeVisible({ timeout: 15000 });
    expect(Number(await zeile.getAttribute("data-waende")), "Wände").toBeGreaterThan(10);
    expect(Number(await zeile.getAttribute("data-tueren")), "Türen").toBeGreaterThan(5);
    expect(Number(await zeile.getAttribute("data-raeume")), "Räume").toBeGreaterThan(5);
    await expect(zeile).toContainText("D-BW-02");
    expect(Number(await zeile.getAttribute("data-rohbau")), "Rohbau > 70 × 16 lichte Fläche").toBeGreaterThan(1120);

    await page.goto(SEITE_SCHALL);
    const ss = page.getByTestId("ss-bauteile");
    await expect(ss).toBeVisible({ timeout: 30000 });
    expect(Number(await ss.getAttribute("data-anzahl")), "tragende Trennwände").toBeGreaterThan(0);
    await expect(ss).toContainText("DIN 4109-1");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
