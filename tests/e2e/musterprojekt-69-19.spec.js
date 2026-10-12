// Headless proof 69-19 (D-HR-03): the sample project at credible size runs in the
// browser exactly as the generator documents it.
//
// Flow: /ModelCheck?beispiel=1 loads model + IDS and starts the run by itself. Checks:
// 523 element geometries, "Kollisions-Befunde (18)" (12 hard + 6 duplicates), six IDS
// violations of the fire-rating rule, no pair skipped over the limit, and the finding
// map draws all three storeys. Numbers come from BEISPIEL_ERWARTET — the same source as
// the unit test (tests/unit/beispielmodell.test.js) and the README.
//
// Run: PORT=5195 API_PORT=3025 API_ORIGINS=http://localhost:5195 npx playwright test tests/e2e/musterprojekt-69-19.spec.js --reporter=line

import { test, expect } from "@playwright/test";
import { BEISPIEL_ERWARTET } from "../../tools/beispielmodell-erzeugen.mjs";

test.describe("69-19 Musterprojekt in glaubwürdiger Größe", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });
  test.describe.configure({ timeout: 180000 });

  test("Beispiel-Lauf: 523 Bauteile, 18 Kollisions-Befunde, 6 IDS-Verstöße, 3 Geschosse", async ({ page }) => {
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
    });
    const fehler = [];
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) fehler.push(String(e)); });

    await page.goto("/ModelCheck?beispiel=1");
    const kollisionen = BEISPIEL_ERWARTET.hart + BEISPIEL_ERWARTET.duplikate;
    await expect(page.getByText(`Kollisions-Befunde (${kollisionen})`).first()).toBeVisible({ timeout: 120000 });
    await expect(page.getByText(`${BEISPIEL_ERWARTET.bauteile} Bauteil-Geometrien`).first()).toBeAttached();
    await expect(page.getByText(/über Limit übersprungen/)).toHaveCount(0);

    // IDS: one specification, six violating walls.
    const ids = page.getByTestId("ids-ergebnis").first();
    await expect(ids).toContainText(`${BEISPIEL_ERWARTET.idsFehler} Verletzungen`);
    await expect(ids.locator("tbody tr")).toHaveCount(BEISPIEL_ERWARTET.idsFehler);

    // Every documented finding kind per storey: order by section without a plan →
    // one group with all 18 findings, severity first (12 collisions before 6 duplicates).
    await page.getByTestId("befund-ordnung").selectOption("abschnitt");
    const gruppe = page.getByTestId("befund-abschnitt-gruppe").first();
    await gruppe.locator("button").first().click();
    const arten = await gruppe.locator("tbody tr td:nth-child(2)").allInnerTexts();
    expect(arten.length).toBe(kollisionen);
    expect(arten.slice(0, BEISPIEL_ERWARTET.hart).every((a) => /Kollision/.test(a))).toBe(true);
    expect(arten.slice(BEISPIEL_ERWARTET.hart).every((a) => /Duplikat/.test(a))).toBe(true);

    // The report cover counts the severities over all findings.
    await expect(page.getByTestId("bericht-abschnitte"))
      .toContainText(`${BEISPIEL_ERWARTET.hart} hoch, ${BEISPIEL_ERWARTET.duplikate} mittel`);

    // Finding map: one plan per storey that holds findings.
    for (const geschoss of Object.keys(BEISPIEL_ERWARTET.jeGeschoss)) {
      await expect(page.getByText(geschoss, { exact: false }).first()).toBeAttached();
    }
    expect(fehler).toEqual([]);
  });
});
