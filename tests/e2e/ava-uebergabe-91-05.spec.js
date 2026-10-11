// Headless-Nachweis 91-05: dieselbe CSV-Übergabe an die AVA wie im Entwässerungsplaner (91-03) jetzt auch
// in Werkstatt › Keller und Werkstatt › Tiefgarage — Download → ECHTER AVA-Datei-Import (gaeb.js
// detectAndParse): Mengen wie in der Mengenliste, Summenzeile („Kellerfläche gesamt“, „Nutzfläche
// Garage“) NICHT im LV, keine Kostengruppe für Flächen, kein Preis. Das TGA-Netz ist im Testhaus leer →
// Knopf gesperrt (Rundlauf der Netz-Zeilen deckt der Unit-Test ab).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import { detectAndParse } from "../../packages/nova-ausschreibung/src/lib/gaeb.js";

const PROJEKT = "projekt=Review%20Testhaus";

async function csvZeilen(page, testid) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testid).click()]);
  return { name: download.suggestedFilename(), rows: detectAndParse(download.suggestedFilename(), new Uint8Array(fs.readFileSync(await download.path()))) };
}

test.describe("91-05 AVA-Übergabe Keller, Tiefgarage, TGA-Netz", () => {
  test.setTimeout(180000);

  test("Keller + Tiefgarage als CSV in den AVA-Import, ohne Summenzeilen; Netz leer → Knopf gesperrt", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ComplexDesigner?${PROJEKT}&tab=werkstatt`);
    await page.getByTestId("wt-tab-keller").click();
    await expect(page.getByTestId("keller-mengen")).toBeVisible({ timeout: 30000 });
    const k = await csvZeilen(page, "keller-mengen-csv");
    expect(k.name).toMatch(/^keller-mengen-.*\.csv$/);
    expect(k.rows.some((r) => /^Kellerabteile/.test(r.title))).toBe(true);
    expect(k.rows.some((r) => /Kellerfläche gesamt/.test(r.title)), "Summenzeile nicht im LV").toBe(false);
    expect(k.rows.every((r) => r.din276 === "" && r.unit_price === null)).toBe(true);

    await page.getByTestId("wt-tab-tiefgarage").click();
    await expect(page.getByTestId("tg-mengen")).toBeVisible({ timeout: 30000 });
    const g = await csvZeilen(page, "tg-mengen-csv");
    expect(g.name).toMatch(/^tiefgarage-mengen-.*\.csv$/);
    const stellplaetze = g.rows.find((r) => /^Stellplätze/.test(r.title));
    expect(stellplaetze, "Stellplätze im LV").toBeTruthy();
    expect(stellplaetze.quantity).toBeGreaterThan(0);
    expect(g.rows.some((r) => /Nutzfläche Garage/.test(r.title)), "Summenzeile nicht im LV").toBe(false);

    await page.goto(`/ComplexDesigner?${PROJEKT}&tab=haustechnik`);
    await page.getByTestId("ht-tab-netz").click();
    await expect(page.getByTestId("tn-mengen-csv")).toBeVisible({ timeout: 30000 });
    if ((await page.getByTestId("tn-mengen").innerText()).includes("Noch nichts gezeichnet")) {
      await expect(page.getByTestId("tn-mengen-csv")).toBeDisabled();
    }

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
