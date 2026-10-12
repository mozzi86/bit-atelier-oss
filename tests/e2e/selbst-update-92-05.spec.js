// Headless-Nachweis 92-05 (Update mit Gesundheitsprüfung und Rücksprung): der Update-Server wird über
// page.route simuliert (Austauschskript, Datensicherung und Rücksprung deckt der Unit-Test selbstUpdate-9205
// ab). Ablauf: „Jetzt aktualisieren“ → neustart → der Server ist kurz weg → danach meldet /api/status wieder
// die ALTE Fassung und /api/update ein letztesUpdate „zurueckgenommen“ → der Hinweis sagt das sofort, statt
// acht Minuten zu warten; die Seite lädt nicht neu. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const INFO = { aktuell: "1.1.0", neueste: "1.2.0", verfuegbar: true, installierbar: true, sperre: null, aenderungen: "- Neu", datum: "2026-10-12T10:00:00Z", groesse: 10_000_000, festgehalten: false, einstellungen: { automatisch: true, festhaltenBis: null }, deaktiviert: false, letztesUpdate: null };

test.describe("92-05 Rücksprung nach misslungenem Update", () => {
  test.setTimeout(120000);

  test("alte Fassung meldet sich zurück → Hinweis „zurückgenommen“", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => {
      const text = m.text();
      // The aborted /api/status request (server "restarting") is logged by the browser as a failed load.
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(text) && !/api\/status|Failed to load resource/.test(text)) warnungen.push(text);
    });
    let statusAbrufe = 0;
    let zurueck = false;
    await page.route("**/api/update", (r) => r.fulfill({ json: zurueck ? { ...INFO, letztesUpdate: { ergebnis: "zurueckgenommen", von: "1.1.0", nach: "1.2.0", zeit: new Date().toISOString(), grund: "keine Antwort" } } : INFO }));
    await page.route("**/api/update/installieren", (r) => r.fulfill({ status: 202, json: { phase: "laedt" } }));
    await page.route("**/api/update/fortschritt", (r) => r.fulfill({ json: { phase: "neustart" } }));
    await page.route("**/api/status", (r) => {
      statusAbrufe += 1;
      if (statusAbrufe <= 2) return r.abort("connectionrefused");
      zurueck = true;
      return r.fulfill({ json: { name: "bit-atelier", version: "1.1.0", modus: "app" } });
    });

    await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
    await expect(page.getByTestId("upd-banner")).toHaveAttribute("data-neueste", "1.2.0", { timeout: 20000 });
    await page.evaluate(() => { /** @type {any} */ (window).__vorUpdate = true; });
    await page.getByTestId("upd-installieren").click();
    await expect(page.getByTestId("upd-fehler")).toContainText("zurückgenommen", { timeout: 30000 });
    await expect(page.getByTestId("upd-banner")).toHaveAttribute("data-phase", "fehler");
    expect(await page.evaluate(() => /** @type {any} */ (window).__vorUpdate)).toBe(true);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
