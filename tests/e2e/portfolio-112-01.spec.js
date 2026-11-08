// Headless proof 112-01 (foreign review 08.11.2026, points 1 and 4).
// 1. Empty database (Project and EnergyScenario answered with [] by a page.route stub): the app shell shows its own empty state
//    ("Noch kein Projekt vorhanden") — no amount (€ / Mio.), none of the former invented names or figures.
// 1b. One project without area, screening or dates (stub): the page shows "1", "—" for area and screening, the activity empty
//    state, no amount and no "Systemzustand" card.
// 2. Real records (fresh BIT_DATA_DIR, only the test house of the global setup): the count equals the API answer, every
//    activity line names a project of the API answer, the area tile says "—" or a sum of entered areas — never "Tsd.".
// 3. Portfolio chip #projekt-umfang: visible at 1440 px (min-[1440px]:inline-flex is generated again), hidden at 1280 px.
// 3b. Status badge of the current project: hidden below 1024 px (the 640-767 band of 72-10 overflowed the header next to the
//    extended user switcher after the max-* variants came back), visible at 1280 px; no header overflow at 700 px.
// 4. Work surface (ws variant): Komplex-Designer tab "site" at 1440 × 900 → the tab panel scrolls on its own (overflow-y auto,
//    ws:overflow-y-auto); at 1440 × 700 (below 760 px height) normal page flow (overflow-y visible).
// Screenshots go to .planning/phases/112-fremdpruefung-2026-11-08/tmp-e2e/112-01/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ORDNER = path.join(".planning", "phases", "112-fremdpruefung-2026-11-08", "tmp-e2e", "112-01");
const ALT_ERFUNDEN = /Eco Village|Bürohochhaus|IFC-Modell importiert|125 Tsd\.|82,4 %|23,1 %|45,6 Mio|Systemzustand|BIM-Verarbeitung|Projektfortschritt/;

/** Console errors except network noise of the offline test run. @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const fehler = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR|tile|maplibre|WebGL/i.test(m.text())) fehler.push(m.text()); });
  page.on("pageerror", (e) => fehler.push(`pageerror ${e}`));
  return fehler;
}

// The first navigation of a fresh dev server compiles the shell and the page on demand (cold dependency cache) — that alone
// took longer than Playwright's default 30 s per test in the first run; same allowance as visuell-ausgangsstand.spec.js.
test.describe.configure({ timeout: 120000 });

test.beforeAll(() => fs.mkdirSync(ORDNER, { recursive: true }));

test("empty database: the shell's empty state, no amounts, no names", async ({ page }) => {
  const fehler = wache(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/api\/entities\/(Project|EnergyScenario)(\?|$)/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.continue());
  await page.goto("/AtelierDeveloper", { timeout: 90000 });
  // Without any project the app shell shows its own empty state in place of every page (Layout), the portfolio page included.
  await expect(page.getByText("Noch kein Projekt vorhanden")).toBeVisible({ timeout: 60000 });
  const text = await page.locator("main").first().innerText();
  expect(text).not.toMatch(/€|Mio\.|Tsd\./);
  expect(text).not.toMatch(ALT_ERFUNDEN);
  await page.screenshot({ path: path.join(ORDNER, "portfolio-leere-db.png"), fullPage: true });
  expect(fehler).toEqual([]);
});

test("a project without area, screening or dates: dashes and the activity empty state on the page", async ({ page }) => {
  const fehler = wache(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const OHNE_ANGABEN = [{ id: "stub-112-01", name: "Stubprojekt 112", client: "", location: {}, status: "feasibility" }];
  await page.route(/\/api\/entities\/Project(\?|$)/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: OHNE_ANGABEN }) : route.continue());
  await page.route(/\/api\/entities\/EnergyScenario(\?|$)/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.continue());
  await page.goto("/AtelierDeveloper", { timeout: 90000 });
  const haupt = page.locator("main").first();
  await expect(page.locator("h1", { hasText: "Portfolio (Projektentwicklung)" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator("[data-portfolio-anzahl]")).toHaveText("1");
  await expect(page.locator("[data-portfolio-flaeche]")).toHaveText("—");
  await expect(page.locator("[data-energie-screening-kpi]")).toHaveText("—");
  await expect(haupt.getByText("Keine Flächenangabe in den Projekten")).toBeVisible();
  await expect(page.locator("[data-portfolio-aktivitaeten-leer]")).toHaveText("Noch keine Aktivitäten");
  const text = await haupt.innerText();
  expect(text).not.toMatch(/€|Mio\.|Tsd\./);
  expect(text).not.toMatch(ALT_ERFUNDEN);
  await page.screenshot({ path: path.join(ORDNER, "portfolio-ohne-angaben.png"), fullPage: true });
  expect(fehler).toEqual([]);
});

test("real records: count and activity names come from the API answer", async ({ page, request }) => {
  const fehler = wache(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const projekte = await (await request.get("/api/entities/Project")).json();
  expect(Array.isArray(projekte)).toBe(true);
  await page.goto("/AtelierDeveloper");
  await expect(page.locator("h1", { hasText: "Portfolio (Projektentwicklung)" })).toBeVisible({ timeout: 30000 });
  // The dev user sees every project (no role filter in the default setup).
  await expect(page.locator("[data-portfolio-anzahl]")).toHaveText(projekte.length.toLocaleString("de-DE"));
  const flaeche = (await page.locator("[data-portfolio-flaeche]").innerText()).trim();
  const summe = projekte.reduce((s, p) => s + (Number(p.building_area || p.area_net) || 0), 0);
  expect(flaeche).toBe(summe > 0 ? Math.round(summe).toLocaleString("de-DE") : "—");
  const namen = new Set(projekte.map((p) => p.name));
  const zeilen = page.locator("[data-portfolio-aktivitaeten] p.font-medium");
  const n = await zeilen.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const zeile = (await zeilen.nth(i).innerText()).trim();
    const name = zeile.split(" – ")[0];
    expect(namen.has(name), `activity "${zeile}" names no project of the API`).toBe(true);
  }
  expect(await page.locator("main").first().innerText()).not.toMatch(ALT_ERFUNDEN);
  await page.screenshot({ path: path.join(ORDNER, "portfolio-echt.png"), fullPage: true });
  expect(fehler).toEqual([]);
});

test("portfolio chip: visible from 1440 px, hidden below", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/AtelierDeveloper");
  const chip = page.locator("#projekt-umfang");
  await expect(chip).toBeVisible({ timeout: 30000 });
  await expect(chip).toHaveText("Portfolio – alle Projekte");
  await page.screenshot({ path: path.join(ORDNER, "chip-1440.png"), clip: { x: 0, y: 0, width: 1440, height: 80 } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(chip).toBeHidden();
});

test("status badge: hidden below 1024 px (no room next to the user switcher), header without overflow", async ({ page }) => {
  const fehler = wache(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/Projects");
  const badge = page.locator("header [data-projekt-status]").first();
  await expect(badge).toBeVisible({ timeout: 30000 });
  expect((await badge.innerText()).trim().length).toBeGreaterThan(0);
  const kopf = page.locator("header").first();
  for (const breite of [700]) {
    await page.setViewportSize({ width: breite, height: 900 });
    await expect(badge).toBeHidden();
    const masse = await kopf.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, doc: document.documentElement.scrollWidth, fenster: window.innerWidth }));
    expect(masse.scroll, `header overflows at ${breite} px: ${JSON.stringify(masse)}`).toBeLessThanOrEqual(masse.client);
    expect(masse.doc, `page scrolls sideways at ${breite} px: ${JSON.stringify(masse)}`).toBeLessThanOrEqual(masse.fenster);
  }
  await page.setViewportSize({ width: 700, height: 900 });
  await page.screenshot({ path: path.join(ORDNER, "kopfzeile-700.png"), clip: { x: 0, y: 0, width: 700, height: 80 } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(badge).toBeVisible();
  expect(fehler).toEqual([]);
});

test("work surface: ws: applies at 1440 × 900, not below 760 px height", async ({ page }) => {
  const fehler = wache(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ComplexDesigner?tab=site");
  const wurzel = page.locator("[data-arbeitsflaeche]").first();
  await expect(wurzel).toBeAttached({ timeout: 30000 });
  const panel = page.locator('[role="tabpanel"][data-state="active"]').first();
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  expect(await wurzel.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");
  await page.screenshot({ path: path.join(ORDNER, "arbeitsflaeche-1440x900.png") });
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).overflowY)).toBe("visible");
  expect(fehler).toEqual([]);
});
