// Headless-Nachweis 87-02 (Footprint-Sync): schlägt das Laden des BimModel fehl (hier:
// GET /api/entities/BimModel abgebrochen), hält der Store Defaults — der Writeback darf
// dann NICHT nach 1,5 s die Server-Geometrie mit Defaults überschreiben. Vorher
// (useBimModelSync.js:142 „offline: Store behält Defaults") passierte genau das, sobald
// irgendein Feld „geändert" aussah. Danach: Laden wieder möglich → Reload zeigt das Haus.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { TESTHAUS, testhausLaden, footprintAbweichung } from "./fixtures/testhaus.js";

const SEITE_STUDIO = "/ComplexDesigner?projekt=Review%20Testhaus&tab=studio";

test.describe("87-02 Footprint-Sync überschreibt nie ein ungeladenes Modell", () => {
  test.setTimeout(120000);

  test("BimModel-Laden blockiert → kein Writeback; freigegeben → Haus unverändert", async ({ page, request }) => {
    await nurLocalhost(page);
    const warnungen = [];
    const hinweise = [];
    page.on("console", (m) => {
      const text = m.text();
      if (/\[bimModel\]/.test(text)) hinweise.push(text);
      else if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(text)) warnungen.push(text);
    });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    // 1) Every BimModel read fails (the write path stays open on purpose — the guard
    //    must hold without the network doing it for us).
    await page.route(/\/api\/entities\/BimModel(\?|$)/, (route) => {
      if (route.request().method() === "GET") return route.abort("failed");
      return route.continue();
    });
    await page.goto(SEITE_STUDIO);
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(4000); // > 1,5 s debounce — the old code would have written by now
    const { modell: nachBlock } = await testhausLaden(request);
    expect(footprintAbweichung(nachBlock.footprintM, TESTHAUS.footprintM), "Server-Footprint nach blockiertem Laden").toBeLessThan(0.011);
    expect(nachBlock.storeys, "Geschosse nach blockiertem Laden").toBe(TESTHAUS.storeys);
    expect(hinweise.some((h) => /Laden fehlgeschlagen/.test(h)), `Hinweis im Log: ${hinweise.join(" | ")}`).toBe(true);
    await expect(page.getByTestId("bm-sync-fehler"), "gelbe Zeile im Komplex-Designer").toBeVisible();
    await expect(page.getByTestId("bm-sync-fehler")).toContainText("nicht geladen");

    // 2) Network back → reload → the house is there and nothing was written meanwhile.
    await page.unroute(/\/api\/entities\/BimModel(\?|$)/);
    await page.reload();
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);
    const { modell: danach } = await testhausLaden(request);
    expect(footprintAbweichung(danach.footprintM, TESTHAUS.footprintM)).toBeLessThan(0.011);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
