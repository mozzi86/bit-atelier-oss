// Headless-Nachweis 75-12: Innenwände im Wohnungsfokus verschieben (werkstatt_layer.raumGrenzen).
//
// Ablauf: Werkstatt bereit → Fokus der ersten WE per Deep-Link → erste verschiebbare Wand
// um 12,5 cm zugunsten von Raum A → Versatz + Breite A im DOM, WoFlV der WE unverändert
// (Fläche wandert nur zwischen zwei Räumen) → Reload: der Versatz kommt aus dem Layer
// zurück (Solver-Eingang, nicht Geometrie) → Rückgängig/Zurücksetzen räumt auf.
//
// Regeln wie fokus-75-09: --workers=1, Helfer unverändert übernommen, NIE "Entwurf speichern".

import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";

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

/**
 * Open the focus view of the FIRST unit via its deep link (?we=…) — a real click
 * on wt-we would start a drag (the zones are draggable), so the deep link is the
 * reliable way in. Waits for the "Fokusansicht: <we>" heading.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>} the unit key (we)
 */
async function fokusOeffnen(page) {
  await page.waitForTimeout(1500); // storey plan + zones render after the deep-link goto below
  const we = await page.getByTestId("wt-we").first().getAttribute("data-we");
  expect(we, "data-we der ersten WE").toBeTruthy();
  await page.goto(`${SEITE_WERKSTATT}&we=${encodeURIComponent(we)}`);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(`Fokusansicht: ${we}`).first()).toBeVisible({ timeout: 20000 });
  return we;
}

test.describe("75-12 Innenwände im Fokus", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 180000 });

  test("Wand verschieben, Reload hält den Versatz, Zurücksetzen räumt auf", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);
    const we = await fokusOeffnen(page);

    const liste = page.getByTestId("fk-innenwaende").locator("visible=true").first();
    await expect(liste).toBeVisible({ timeout: 15000 });
    expect(Number(await liste.getAttribute("data-anzahl")), "verschiebbare Wände").toBeGreaterThan(0);

    // Leftovers of an aborted run: reset every moved wall first.
    for (const r of await liste.locator("[data-testid=fk-iw-reset]:not([disabled])").all()) await r.click();
    await page.waitForTimeout(600);

    const zeile = liste.locator("[data-testid=fk-iw]").filter({ has: page.locator("[data-testid=fk-iw-a]:not([disabled])") }).first();
    const key = await zeile.getAttribute("data-key");
    const zeileK = liste.locator(`[data-testid=fk-iw][data-key="${key}"]`);
    const breiteA0 = Number(await zeileK.getAttribute("data-breite-a"));
    const woflv = page.getByTestId("fk-kpi-woflv").locator("visible=true").first();
    const woflv0 = await woflv.getAttribute("data-wert");

    await zeileK.getByTestId("fk-iw-a").click();
    await expect(zeileK).toHaveAttribute("data-versatz", "0.125");
    await expect.poll(async () => Number(await zeileK.getAttribute("data-breite-a"))).toBeCloseTo(breiteA0 + 0.125, 3);
    expect(await woflv.getAttribute("data-wert"), "WoFlV der WE bleibt gleich").toBe(woflv0);

    // Persisted as a solver input: the debounce saves, the reload regenerates the moved wall.
    await page.waitForTimeout(1800);
    await page.goto(`${SEITE_WERKSTATT}&we=${encodeURIComponent(we)}`);
    await expect(page.getByText(`Fokusansicht: ${we}`).first()).toBeVisible({ timeout: 30000 });
    const nachReload = page.getByTestId("fk-innenwaende").locator("visible=true").first().locator(`[data-testid=fk-iw][data-key="${key}"]`);
    await expect(nachReload).toHaveAttribute("data-versatz", "0.125", { timeout: 15000 });
    expect(Number(await nachReload.getAttribute("data-breite-a"))).toBeCloseTo(breiteA0 + 0.125, 3);

    // Clean up through the UI (one write path) and wait out the save debounce.
    await nachReload.getByTestId("fk-iw-reset").click();
    await expect(nachReload).toHaveAttribute("data-versatz", "0");
    await page.waitForTimeout(1800);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
