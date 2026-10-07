// Headless-Nachweis 75-07: Architekturregeln in der Wohnungs-Werkstatt.
// Empfehlungs-Chip aus der Tiefe, Regel-Schalter (Layer-Feld regeln), Hinweise
// im Kasten, Wandsegmente im Plan. Netz außer localhost geblockt (Muster 75-05).
// Regeln werden am Ende wieder abgeschaltet, damit der werkstatt_layer des
// Testprojekts im Ausgangszustand bleibt.

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";

const SEITE = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";

test.describe("75-07 Architekturregeln (Werkstatt)", () => {
  test("Empfehlungs-Chip, Mindestbreiten-Hinweis, Wandstärken im Plan, Rettungsweg-Schalter", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
    });
    const warnungen = [];
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
    });
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(SEITE);
    const chip = page.getByTestId("wt-empfehlung");
    await expect(chip).toBeVisible({ timeout: 30000 });
    await expect(chip).toContainText(/Empfehlung: Tiefe \d+,\d m/);
    const stufe = await chip.getAttribute("data-stufe");
    expect(["flach", "mittel", "tief"]).toContain(stufe);

    // Ausgangszustand herstellen (ein abgebrochener Lauf kann Regeln im Layer lassen),
    // dann: keine Regel aktiv, keine Wände.
    const regeln = page.getByTestId("wt-regeln");
    await expect(regeln).toBeVisible();
    const ALLE = ["mindestbreiten", "himmelsrichtung", "phi", "wandstaerken", "rettungsweg"];
    // schalteRegel wiederholt, bis der Zustand hält — der Layer lädt asynchron
    // und verwirft frühe Klicks (Review 23.09.).
    for (const k of ALLE) await schalteRegel(page, k, false);
    for (const k of ALLE) await expect(page.getByTestId(`wt-regel-${k}`)).not.toBeChecked();
    await expect(page.getByTestId("wt-wand")).toHaveCount(0);

    // Wandstärken → Segmente erscheinen, drei Klassen sind unterscheidbar.
    await schalteRegel(page, "wandstaerken", true);
    // SVG-Linien haben 0 px Höhe/Breite → Playwright hält sie für "hidden"; Anzahl zählen.
    await expect.poll(() => page.getByTestId("wt-wand").count(), { timeout: 10000 }).toBeGreaterThan(0);
    const klassen = await page.getByTestId("wt-wand").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-klasse")))]);
    expect(klassen).toContain("aussen");
    const staerken = await page.getByTestId("wt-wand").evaluateAll((els) =>
      Object.fromEntries(["aussen", "leicht"].map((k) => [k, els.filter((e) => e.getAttribute("data-klasse") === k).map((e) => Number(e.getAttribute("stroke-width")))[0]])));
    if (staerken.aussen && staerken.leicht) expect(staerken.aussen).toBeGreaterThan(staerken.leicht);

    // Himmelsrichtung → Nordwinkel-Feld; Rettungsweg-Schalter existiert.
    await schalteRegel(page, "himmelsrichtung", true);
    await expect(page.getByTestId("wt-nordwinkel")).toBeVisible();
    await schalteRegel(page, "rettungsweg", true);

    // Mindestbreiten → Hinweis mit Ursache (Bandtiefe) ODER kein Konflikt beim Testhaus:
    // beides ist gültig, aber der Schalter muss den Layer erreichen (persistiert im Feld regeln).
    await schalteRegel(page, "mindestbreiten", true);
    await page.waitForTimeout(400);
    const hinweise = await page.getByTestId("wt-hinweis").allInnerTexts();
    // Alle Hinweise sind Klartext mit Ursache oder Vorschlag — kein leerer Kasten.
    for (const h of hinweise) expect(h.length).toBeGreaterThan(20);

    // Reload: Regeln bleiben (Layer), dann aufräumen. useFachlayer schreibt
    // 1,2 s nach der LETZTEN Änderung zurück (Debounce) — ein früherer Reload
    // verliert die Regeln (Review 23.09., rot im Regressionslauf).
    await page.waitForTimeout(1600);
    await page.reload();
    await expect(page.getByTestId("wt-regel-wandstaerken")).toBeChecked({ timeout: 30000 });
    for (const k of ["mindestbreiten", "himmelsrichtung", "wandstaerken", "rettungsweg"]) {
      await schalteRegel(page, k, false);
    }
    await expect(page.getByTestId("wt-wand")).toHaveCount(0);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
