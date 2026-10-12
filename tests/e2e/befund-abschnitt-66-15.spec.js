// Headless proof 66-15 (register no. 135): findings ordered by the section they block.
//
// Flow: open the check suite on the test project with the sample model (?beispiel=1 runs
// the check by itself). Without a delivery plan the order "Abschnittstermin" gives ONE
// group by severity and the report cover says "Kein Abschnittstermin". Then two
// deliveries are planned in the delivery card: "BA 1" in 10 days covering the first
// storey of the model, "gesamt" in 40 days (whole building). Order "Abschnittstermin" →
// the first group is "BA 1" with the badge "blockiert als Nächstes", its first row is
// the most severe finding; the report cover lists both sections with dates.
// Cleanup: leave the page first (the card flushes its pending save on unmount), then
// drop lieferung_layer from the test house (the house fixture does not know the field).
//
// Run: PORT=5195 API_PORT=3025 API_ORIGINS=http://localhost:5195 npx playwright test tests/e2e/befund-abschnitt-66-15.spec.js --reporter=line

import { test, expect } from "./fixtures/base.js";
import { testhausLaden } from "./fixtures/testhaus.js";

const API = `http://localhost:${Number(process.env.API_PORT) || 3001}/api/`;

/** ISO day `tage` days from today (UTC). @param {number} tage */
function tagIn(tage) {
  return new Date(Date.now() + tage * 86400000).toISOString().slice(0, 10);
}

/** @param {import("@playwright/test").APIRequestContext} request */
async function lieferplanLeeren(request) {
  const { modell } = await testhausLaden(request);
  const r = await request.put(`${API}entities/BimModel/${modell.id}`, { data: { lieferung_layer: null } });
  expect(r.ok(), "lieferung_layer zurücksetzen").toBeTruthy();
}

test.describe("66-15 Befund ↔ Bauabschnitt", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });
  test.describe.configure({ timeout: 180000 });

  test("ohne Plan nach Schwere, mit Plan: was blockiert den nächsten Abschnitt", async ({ page, request }) => {
    await lieferplanLeeren(request);
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
    });
    const fehler = [];
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) fehler.push(String(e)); });
    try {
      await page.goto("/ModelCheck?projekt=Review%20Testhaus&beispiel=1");
      const ordnung = page.getByTestId("befund-ordnung");
      await expect(ordnung).toBeVisible({ timeout: 120000 });

      // --- without a plan: one group, by severity --------------------------------
      await ordnung.selectOption("abschnitt");
      const gruppen = page.getByTestId("befund-abschnitt-gruppe");
      await expect(gruppen).toHaveCount(1);
      await expect(gruppen.first()).toHaveAttribute("data-abschnitt", "ohne Abschnittstermin");
      await expect(page.getByTestId("befund-blockiert-naechsten")).toHaveCount(0);
      await expect(page.getByTestId("bericht-abschnitte")).toContainText("Kein Abschnittstermin im Modelllieferplan");

      // --- plan two deliveries ------------------------------------------------------
      await page.getByTestId("lieferung-anlegen").click();
      await page.getByTestId("lieferung-anlegen").click();
      const z1 = page.getByTestId("lieferung-1");
      const z2 = page.getByTestId("lieferung-2");
      await z1.locator('input[type="date"]').fill(tagIn(10));
      await z1.locator('input[placeholder="BA"]').fill("BA 1");
      await z2.locator('input[type="date"]').fill(tagIn(40));
      await z2.locator('input[placeholder="BA"]').fill("gesamt");
      const auswahl = page.getByTestId("geschosse-1");
      await auswahl.locator("summary").click();
      const ersteBox = auswahl.locator("label").first();
      const geschoss = (await ersteBox.innerText()).trim();
      await ersteBox.locator('input[type="checkbox"]').check();
      await expect(auswahl.locator("summary")).toHaveText(geschoss);

      // --- order by section date -----------------------------------------------------
      await expect(gruppen.first()).toHaveAttribute("data-abschnitt", "BA 1");
      await expect(gruppen.first().getByTestId("befund-blockiert-naechsten")).toBeVisible();
      await expect(gruppen.first()).toContainText("in 10 Tagen");
      await expect(gruppen.first()).toContainText(geschoss);
      // Severity first inside the group: open it, the first row is a collision when the
      // group holds one.
      await gruppen.first().locator("button").first().click();
      const ersteZeile = gruppen.first().locator("tbody tr").first();
      await expect(ersteZeile).toBeVisible();
      const arten = await gruppen.first().locator("tbody tr td:nth-child(2)").allInnerTexts();
      if (arten.some((a) => /Kollision/.test(a))) expect(arten[0]).toMatch(/Kollision/);

      // --- report cover page --------------------------------------------------------
      const bericht = page.getByTestId("bericht-abschnitte");
      await expect(bericht.locator("tbody tr")).toHaveCount(2);
      await expect(bericht.locator("tbody tr").first()).toContainText("BA 1");
      await expect(bericht.locator("tbody tr").nth(1)).toContainText("gesamt");
      await expect(bericht.locator("tbody tr").first().locator("td").nth(2)).toHaveText("10");
      expect(fehler).toEqual([]);
    } finally {
      await page.goto("about:blank");
      await page.waitForTimeout(500);
      await lieferplanLeeren(request);
    }
  });
});
