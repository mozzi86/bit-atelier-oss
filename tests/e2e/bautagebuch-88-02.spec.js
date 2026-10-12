// 88-02 construction diary against the Express dev stack (Review Testhaus):
//  1. tab "Bautagebuch" → new day 15.01.2031, low +2 °C, concrete works, a recorded
//     hindrance → row with the hint "beton_kalt" and marked as bad-weather day;
//  2. "Wetter übernehmen" on a project without location → plain-text hint, no values taken;
//  3. second entry for the same day → refused with a message;
//  4. "Behinderungsanzeige schreiben" → correspondence editor prefilled: subject with
//     the project, text with the period and the diary text, no [[fehlt mark;
//  5. English, 375 px without horizontal scroll, console clean.
// Everything the spec creates is deleted in `finally` (the letter is never saved).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const TAG = "2031-01-15";

test("88-02 Bautagebuch: Schlechtwetter-Hinweis, ein Eintrag je Tag, Behinderungsanzeige im Schriftverkehr", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const r = await (await request.get(`${API}/BautagebuchEintrag?project_id=${projekt.id}`)).json();
    for (const e of (Array.isArray(r) ? r : []).filter((x) => String(x.vorkommnisse || "").includes("E2E"))) await request.delete(`${API}/BautagebuchEintrag/${e.id}`);
  };
  await aufraeumen();
  const warnungen = [];
  try {
    await nurLocalhost(page);
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));

    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=bautagebuch`);
    await page.getByTestId("btb-neu").click({ timeout: 30000 });
    await page.getByTestId("btb-form-datum").fill(TAG);
    await page.getByTestId("btb-wetter").click();
    await expect(page.getByTestId("btb-wetter-hinweis")).toContainText("Kein Standort");
    await expect(page.getByTestId("btb-form-temp_min")).toHaveValue("");
    await page.getByTestId("btb-form-temp_min").fill("2");
    await page.getByTestId("btb-form-temp_max").fill("6");
    await page.getByTestId("btb-firma-name-0").fill("Rohbau Beispiel");
    await page.getByTestId("btb-firma-mann-0").fill("6");
    await page.getByTestId("btb-firma-arbeiten-0").fill("Decke über EG betonieren");
    await page.getByTestId("btb-form-vorkommnisse").fill("E2E Frost am Morgen");
    await page.getByTestId("btb-form-behinderung").check();
    await page.getByTestId("btb-form-behinderung_text").fill("E2E Kran ausgefallen");
    await page.getByTestId("btb-speichern").click();

    const zeile = page.locator(`[data-testid=btb-zeile][data-datum="${TAG}"]`);
    await expect(zeile).toHaveAttribute("data-schlechtwetter", "ja", { timeout: 15000 });
    await expect(zeile.locator("[data-testid=btb-hinweis][data-art=beton_kalt]")).toContainText("Schutzmaßnahmen");
    await expect(zeile).toContainText("6 Personen");

    // one entry per day
    await page.getByTestId("btb-neu").click();
    await page.getByTestId("btb-form-datum").fill(TAG);
    await page.getByTestId("btb-form-vorkommnisse").fill("E2E doppelt");
    await page.getByTestId("btb-speichern").click();
    await expect(page.getByTestId("btb-fehler")).toContainText("schon einen Eintrag");
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.locator(`[data-testid=btb-zeile][data-datum="${TAG}"]`)).toHaveCount(1);

    // hindrance notice in the correspondence (82-05), prefilled from the diary
    await zeile.getByTestId("btb-behinderung").click();
    await expect(page).toHaveURL(/\/Correspondence/);
    const betreff = page.getByTestId("schreiben-betreff");
    await expect(betreff).toHaveValue(/Behinderungsanzeige/, { timeout: 30000 });
    await expect(betreff).toHaveValue(/Review Testhaus/);
    const text = page.getByTestId("schreiben-text");
    await expect(text).toHaveValue(/15\.01\.2031/);
    await expect(text).toHaveValue(/E2E Kran ausgefallen/);
    await expect(text).toHaveValue(/§ 6 Abs\. 1 VOB\/B/);
    expect(await text.inputValue()).not.toContain("[[fehlt");
    await expect(page.getByTestId("schreiben-projekt")).toHaveValue(projekt.id);

    // English, phone width
    await page.goto(`/Werkplanung?projekt=${encodeURIComponent("Review Testhaus")}&tab=bautagebuch`);
    await page.getByRole("button", { name: "English" }).click();
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByRole("tab", { name: "Site diary" })).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid=btb-zeile][data-datum="${TAG}"]`)).toContainText("6 persons");
    await expect(page.locator(`[data-testid=btb-zeile][data-datum="${TAG}"]`)).toContainText("document protective measures");
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(breit).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Deutsch" }).click();
    expect(warnungen).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
