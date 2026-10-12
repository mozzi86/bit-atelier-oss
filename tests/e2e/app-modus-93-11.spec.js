// Headless-Nachweis 93-11 (App-Modus), Karte „Programm“ in Einstellungen › System & Info.
// Die Serverroute POST /api/programm/beenden wird hier per page.route beantwortet — ein echter Aufruf
// beendete den Entwicklungsserver der ganzen Testreihe. Die Route selbst (Origin, Loopback, LAN-Gerät,
// einmalig) deckt tests/unit/appModus-9311.test.js ab; der echte Stopp wurde von Hand auf einem Testport
// geprüft (93-11-SUMMARY.md).
//  1. Abbrechen im Bestätigungsdialog schickt nichts.
//  2. Bestätigen schickt genau einen POST (mit der App-Origin), meldet „beendet“ und versucht, das Fenster zu
//     schließen; Konsole sauber.
import { test, expect } from "@playwright/test";
import { nurLocalhost, ERLAUBT_OFFLINE } from "./fixtures/massing.js";

test.describe("93-11 Programm beenden", () => {
  test.setTimeout(120000);

  test("Karte in System & Info: Rückfrage, ein POST, Meldung", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    /** @type {Array<string|undefined>} */
    const origins = [];
    await page.route("**/api/programm/beenden", (r) => { origins.push(r.request().headers().origin); return r.fulfill({ json: { ok: true } }); });

    // The card tries window.close() after quitting; a Playwright page would really close — record it instead.
    await page.addInitScript(() => { window.close = () => { /** @type {any} */ (window).__geschlossen = true; }; });
    await page.goto("/Settings?tab=system");
    const karte = page.getByTestId("programm-karte");
    await expect(karte).toBeVisible({ timeout: 30000 });
    await expect(karte).toContainText("daten/server.log");

    await page.getByTestId("programm-beenden").click();
    await expect(page.getByTestId("bestaetigung-dialog")).toBeVisible();
    await page.getByTestId("bestaetigung-abbrechen").click();
    await expect(page.getByTestId("bestaetigung-dialog")).toBeHidden();
    expect(origins).toEqual([]);

    await page.getByTestId("programm-beenden").click();
    await page.getByTestId("bestaetigung-ok").click();
    await expect(page.getByTestId("programm-status")).toHaveText(/beendet|quit/, { timeout: 10000 });
    await expect(page.getByTestId("programm-beenden")).toBeDisabled();
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatch(/^http:\/\/localhost:\d+$/);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__geschlossen === true)).toBe(true);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
