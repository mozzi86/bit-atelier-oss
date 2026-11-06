// Headless proof 108-02 (D-EFH-01, knee wall in the building model) on the neutral test house "Review EFH 108" (fixtures/efh108.js:
// 11.40 × 10.20 m, KG/EG/DG, gable roof 45°): the knee wall 1.00 m is typed into the storey panel at the DG row; the section B-B then shows
// the dimension "Kniestock", the eaves at +4.15 (top of the structural slab 2.90 + 0.25, plus 1.00) and the clipped collar-beam floor; the
// full-storey badge says "ja" (74.5 % ≥ 2.30 m); undo removes the field again; set again, it is saved in the record and survives a reload.
// Review fixes: storey count up and down (stale hint, setting it again on the DG takes effect), "alle gleich" keeps the knee wall, a flat
// roof names the stored knee wall. The console stays clean. Screenshots go to .planning/phases/108-efh-satteldach/tmp-e2e/108-02/. Own project, reset before the test.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

const ORDNER = path.join(".planning", "phases", "108-efh-satteldach", "tmp-e2e", "108-02");

/** Console errors and warnings except the known offline / WebGL noise. @param {import("@playwright/test").Page} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Opens the BIM studio of the test house and waits for the loaded record. @param {import("@playwright/test").Page} page */
async function studioOeffnen(page) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 90000 });
  await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 30000 });
  await expect(page.getByLabel("Dachform")).toHaveValue("sattel", { timeout: 30000 });
}

/** Opens the storey panel (details "Geschosshöhen") when it is closed. @param {import("@playwright/test").Page} page */
async function geschossPanel(page) {
  const d = page.getByTestId("geschosshoehen");
  if (!(await d.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open))) await d.locator("summary").click();
  await expect(page.getByTestId("kniestock")).toBeVisible();
}

/** The stored knee wall of one row (default the DG, level 1) of the test house record, or null.
 * @param {import("@playwright/test").APIRequestContext} request @param {string} projektId @param {number} [level] */
async function gespeicherterKniestock(request, projektId, level = 1) {
  const r = await request.get(`/api/entities/BimModel?project_id=${encodeURIComponent(projektId)}`);
  const m = (await r.json())[0];
  const dg = (Array.isArray(m?.geschosse) ? m.geschosse : []).find((/** @type {any} */ g) => g?.level === level);
  return dg?.kniestock_m ?? null;
}

test.describe("108-02 Kniestock im Gebäudemodell", () => {
  test.setTimeout(300000);
  test.beforeAll(() => { fs.mkdirSync(ORDNER, { recursive: true }); });

  test("Kniestock setzen: Schnitt mit Kote, Vollgeschoss ja, Rückgängig, gespeichert nach Neuladen", async ({ page, request }) => {
    const { projekt } = await efhZuruecksetzen(request);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    await studioOeffnen(page);

    // without a knee wall: roof on top of the DG (eaves 5.50), no badge, no knee wall dimension
    await expect(page.getByTestId("vollgeschoss")).toHaveCount(0);
    await geschossPanel(page);
    await expect(page.getByTestId("kniestock")).toHaveValue("");

    // ---- set 1.00 m at the DG row ----
    await page.getByTestId("kniestock").fill("1");
    await expect(page.getByTestId("vollgeschoss")).toHaveAttribute("data-voll", "ja");
    await expect(page.getByTestId("vollgeschoss")).toContainText("Vollgeschoss: ja (74,5 % ≥ 2,30 m)");
    await page.getByTestId("geschosshoehen").locator("summary").click(); // close the panel again
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await expect(page.locator('[data-dachschnitt="z"]')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('[data-kote="kniestock"]')).toHaveCount(1);
    await expect(page.locator('[data-kote="kniestock"]')).toContainText("Kniestock");
    await expect(page.locator('[data-kote="traufe"]')).toHaveText("Traufe +4.15");
    await expect(page.locator('[data-kote="first"]')).toHaveText("First +9.25");
    await expect(page.locator('[data-kehlbalkenlage="1"]')).toHaveCount(1);
    await page.screenshot({ path: path.join(ORDNER, "schnitt-bb-kniestock.png") });

    // ---- undo removes the field (one step of the drawing history) ----
    await page.getByTestId("bim-undo").click();
    await expect(page.locator('[data-kote="kniestock"]')).toHaveCount(0);
    await expect(page.locator('[data-kote="traufe"]')).toHaveText("Traufe +5.50");
    await expect(page.getByTestId("vollgeschoss")).toHaveCount(0);
    await geschossPanel(page);
    await expect(page.getByTestId("kniestock")).toHaveValue("");

    // ---- set again: saved in the record, kept after a reload ----
    await page.getByTestId("kniestock").fill("1");
    await expect.poll(() => gespeicherterKniestock(request, projekt.id), { timeout: 30000, message: "kniestock_m im Datensatz" }).toBe(1);
    await page.reload();
    await studioOeffnen(page);
    await geschossPanel(page);
    await expect(page.getByTestId("kniestock")).toHaveValue("1");
    await expect(page.getByTestId("vollgeschoss")).toHaveAttribute("data-voll", "ja");
    await page.getByTestId("geschosshoehen").locator("summary").click(); // close the panel again
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await expect(page.locator('[data-kote="kniestock"]')).toHaveCount(1, { timeout: 15000 });
    await page.screenshot({ path: path.join(ORDNER, "schnitt-bb-nach-neuladen.png") });
    await page.getByRole("button", { name: "Ansicht 3D" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ORDNER, "3d-kniestock.png") });

    // ---- review fix: storey count up and down again — the stale hint shows, setting it again on the DG takes effect ----
    await page.getByLabel("Geschosse", { exact: true }).selectOption("3");
    await geschossPanel(page);
    await expect(page.getByTestId("kniestock-verwaist")).toBeVisible();
    await expect(page.getByTestId("kniestock")).toHaveValue("");
    await page.getByTestId("kniestock").fill("1"); // on the new top storey (level 2): the DG value is cleared
    await expect(page.getByTestId("kniestock-verwaist")).toHaveCount(0);
    await expect.poll(() => gespeicherterKniestock(request, projekt.id, 2), { timeout: 30000, message: "kniestock_m auf Level 2" }).toBe(1);
    await page.getByLabel("Geschosse", { exact: true }).selectOption("2"); // the row of level 2 stays in the table
    await expect(page.getByTestId("kniestock-verwaist")).toBeVisible();
    await expect(page.getByTestId("kniestock")).toHaveValue("");
    await page.getByTestId("kniestock").fill("1");
    await expect(page.getByTestId("kniestock")).toHaveValue("1");
    await expect(page.getByTestId("kniestock-verwaist")).toHaveCount(0);
    await expect(page.getByTestId("vollgeschoss")).toHaveAttribute("data-voll", "ja");
    await expect.poll(() => gespeicherterKniestock(request, projekt.id, 1), { timeout: 30000, message: "kniestock_m wieder am DG" }).toBe(1);

    // ---- "alle gleich (zurücksetzen)" asks and keeps the knee wall ----
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "alle gleich (zurücksetzen)" }).click();
    await expect(page.getByTestId("kniestock")).toHaveValue("1");
    await expect.poll(() => gespeicherterKniestock(request, projekt.id, 2), { timeout: 30000, message: "Zeile Level 2 weg" }).toBe(null);
    await expect.poll(() => gespeicherterKniestock(request, projekt.id, 1), { timeout: 30000 }).toBe(1);

    // ---- flat roof: the stored knee wall is named, not hidden; pitched again, it applies again ----
    await page.getByLabel("Dachform").selectOption("flach");
    await expect(page.getByTestId("kniestock-flachdach")).toBeVisible();
    await expect(page.getByTestId("kniestock")).toHaveCount(0);
    await page.getByLabel("Dachform").selectOption("sattel");
    await expect(page.getByTestId("kniestock-flachdach")).toHaveCount(0);
    await expect(page.getByTestId("kniestock")).toHaveValue("1");

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
