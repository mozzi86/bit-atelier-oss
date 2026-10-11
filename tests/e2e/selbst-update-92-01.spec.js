// Headless-Nachweis 92-01 (Update per Klick, Banner der lokalen App): der Update-Server wird über
// page.route simuliert (kein GitHub, kein echter Dateitausch — die Server-Seite ist per Unit-Test
// selbstUpdate-9201 abgedeckt). Banner erscheint mit der neuen Version; „Jetzt aktualisieren“ → POST,
// Fortschritt laedt → prueft → neustart, danach meldet /api/status die neue Version → die Seite lädt von
// selbst neu (kein Download-Link). Zweiter Fall: „Später“ blendet das Banner für diese Version aus, auch
// nach dem Neuladen. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const INFO = { aktuell: "1.1.0", neueste: "1.2.0", verfuegbar: true, installierbar: true, sperre: null, notizen: "", datum: "2026-10-12T10:00:00Z", groesse: 10_000_000 };

test.describe("92-01 Update per Klick", () => {
  test.setTimeout(120000);

  test("Banner, Installieren mit Fortschritt, Neustart → Seite lädt neu", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    let posts = 0, abfrage = 0, neu = false;
    const folge = [{ phase: "laedt", geladen: 4e6, gesamt: 1e7 }, { phase: "prueft" }, { phase: "neustart" }];
    await page.route("**/api/update", (r) => r.fulfill({ json: neu ? { ...INFO, aktuell: "1.2.0", verfuegbar: false, installierbar: false } : INFO }));
    await page.route("**/api/update/installieren", (r) => { posts += 1; return r.fulfill({ status: 202, json: { phase: "laedt" } }); });
    await page.route("**/api/update/fortschritt", (r) => r.fulfill({ json: folge[Math.min(abfrage++, folge.length - 1)] }));
    await page.route("**/api/status", (r) => r.fulfill({ json: { name: "bit-atelier", version: abfrage >= 3 ? (neu = true, "1.2.0") : "1.1.0", modus: "app" } }));

    await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
    const banner = page.getByTestId("upd-banner");
    await expect(banner).toHaveAttribute("data-neueste", "1.2.0", { timeout: 20000 });
    await page.evaluate(() => { /** @type {any} */ (window).__vorUpdate = true; });
    await page.getByTestId("upd-installieren").click();
    await expect(banner).toHaveAttribute("data-phase", /laedt|prueft|neustart/);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__vorUpdate === true), { timeout: 30000 }).toBe(false);
    expect(posts).toBe(1);
    await expect(page.getByTestId("upd-banner")).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("„Später“ blendet das Banner für diese Version aus", async ({ page }) => {
    await nurLocalhost(page);
    await page.route("**/api/update", (r) => r.fulfill({ json: INFO }));
    await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
    await expect(page.getByTestId("upd-banner")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("upd-spaeter").click();
    await expect(page.getByTestId("upd-banner")).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("upd-banner")).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem("bit.update.spaeter"));
  });
});
