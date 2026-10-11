// 84-05 E2E: doors in every typology. The workshop is switched through all six
// typologies of the review house; each must show door openings and no door/access
// fail; the measured counts go to a JSON next to the phase. Then the house is set back
// to Mittelflur (applied), and the massing at 1:200 must draw the ground-floor door
// openings (ms-tuer). Console must stay clean.
import { test, expect } from "./fixtures/base.js";
import fs from "node:fs";
import path from "node:path";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const PROJEKT = "projekt=Review%20Testhaus";
const SEITE_STUDIO = `/ComplexDesigner?${PROJEKT}&tab=studio`;
const SEITE_WERKSTATT = `/ComplexDesigner?${PROJEKT}&tab=werkstatt`;
const AUSGABE = path.resolve(process.cwd(), ".planning/phases/84-tueren-immer/tmp-e2e/e2e-8405-typologien.json");
const TYPOLOGIEN = ["Mittelflur", "Mehrfamilienhaus", "Punkthaus/Spänner", "Laubengang", "Reihenhaus", "Einfamilienhaus"];

/** Console/pageerror watcher + offline guard; returns the warnings array (empty = clean). */
async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => {
    const stack = e.stack || String(e);
    if (/WebGL|THREE|getUniforms/i.test(stack)) return; // three.js headless
    warnungen.push(`pageerror ${stack.split("\n").slice(0, 3).join(" | ")}`);
  });
  return warnungen;
}

/** Radix select "Erschließung" (portal): open, pick by visible label. */
async function setzeTypologie(page, label) {
  const trigger = page.getByTestId("wt-typologie");
  if ((await trigger.textContent())?.trim() === label) return;
  await trigger.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(trigger).toHaveText(label);
}

test.describe("84-05 Türen in allen Typologien", () => {
  test.setTimeout(240000);

  test("Werkstatt: jede Typologie mit Türen, ohne Tür-/Erschließungs-fail; Massing 1:200 zeichnet Türöffnungen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const messung = {};
    try {
      for (const label of TYPOLOGIEN) {
        await setzeTypologie(page, label);
        const tueren = await page.getByTestId("wt-tuer").count();
        const q = page.getByTestId("wt-qualitaet");
        const fail = Number(await q.getAttribute("data-fail"));
        // Door/access fails are named in the quality list text (rule texts of raumQualitaet).
        const text = (await q.textContent()) || "";
        const tuerFail = /keine Wohnungstür|ohne Zugang|nur über|keine Diele/.test(text);
        messung[label] = { tueren, fail, tuerFail };
        expect(tueren, `${label}: Türöffnungen im Plan`).toBeGreaterThan(0);
        expect(tuerFail, `${label}: kein Tür-/Erschließungs-fail`).toBe(false);
      }
    } finally {
      // Leave the review house as the other specs expect it.
      await setzeTypologie(page, "Mittelflur");
      fs.writeFileSync(AUSGABE, JSON.stringify(messung, null, 2));
    }
    expect(messung.Mittelflur.fail, "Mittelflur ohne fail").toBe(0);

    // Apply (idempotent) and look at the massing at 1:200.
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    if (await anwenden.count() && !(await anwenden.isDisabled())) { await anwenden.click(); await page.waitForTimeout(1500); }
    await page.goto(SEITE_STUDIO);
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await page.locator("select[data-massstab]").first().selectOption("200");
    await page.waitForTimeout(1200);
    const msTueren = await page.getByTestId("ms-tuer").count();
    expect(msTueren, "Massing 1:200: Türöffnungen des EG").toBeGreaterThan(0);
    const oeffnungen = await page.locator('[data-testid="ms-tuer"] [data-tuer-oeffnung]').count();
    expect(oeffnungen).toBe(msTueren);
    expect(await page.locator('[data-testid="ms-tuer"] [data-tuer-blatt]').count(), "1:200 nur Öffnung, kein Blatt").toBe(0);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
