// Headless-Nachweis 91-02 (Regenwassernutzung) am Review-Testhaus: Haustechnik › Entwässerung
// zeigt die Karte „Regenwassernutzung“ standardmäßig aktiv (Projektvorgabe) mit Ertrag, Bedarf,
// Speicher und Deckungsgrad; 400 m² Bewässerungsfläche erhöhen den Bedarf um 24 m³/a, Garten aus nimmt sie weg; die Prüfliste trägt die
// rw-Prüfungen, die Mengenliste die Zisterne. Werkstatt › Keller zeigt den Pflichtraum
// „Haustechnik Regenwasser“; Werkstatt › Tiefgarage (angewendet) zeichnet die Zisterne unter der
// Bodenplatte mit DEMSELBEN Volumen wie die Karte. Konsole bleibt sauber; base.js setzt die
// Layer nach dem Test zurück.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const PROJEKT = "projekt=Review%20Testhaus";

test.describe("91-02 Regenwassernutzung", () => {
  test.setTimeout(240000);

  test("Karte aktiv, Garten-Schalter wirkt, Checks + Mengen; Keller-Pflichtraum; Zisterne unter der TG mit gleichem Volumen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    // --- Drainage planner ---------------------------------------------------------------
    await page.goto(`/ComplexDesigner?${PROJEKT}&tab=haustechnik`);
    await page.getByTestId("ht-tab-entwaesserung").click();
    const karte = page.getByTestId("rw-karte");
    await expect(karte).toBeVisible({ timeout: 30000 });
    await expect(karte).toHaveAttribute("data-aktiv", "1");
    // Figures are final once the climate request has answered (until then: 650 mm fallback).
    await expect(karte).not.toHaveAttribute("data-klima", "laedt", { timeout: 30000 });
    const speicher = Number(await karte.getAttribute("data-speicher"));
    const eingabenKarte = await karte.evaluate((el) => ({ we: el.dataset.we, quelle: el.dataset.weQuelle, n: el.dataset.niederschlag, dach: el.dataset.dach }));
    expect(speicher, "Speicher > 0 (Dach + Wohneinheiten vorhanden)").toBeGreaterThan(0);
    for (const k of ["ertrag", "bedarf", "speicher", "deckung", "einsparung"]) await expect(page.getByTestId(`rw-kpi-${k}`)).toBeVisible();
    await expect(page.locator('[data-testid="ew-checks"] [data-status]').filter({ hasText: "Trinkwasser-Nachspeisung" })).toHaveCount(1);
    await expect(page.locator('[data-testid="ew-menge"][data-key="rw_zisterne"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="ew-menge"][data-key="rw_zisterne"]')).toHaveAttribute("data-menge", String(speicher));

    // Irrigated area 400 m² → demand +24 m³/a (DIN 1989-1: 60 l/(m²·a)); garden off → back to WC only.
    const bedarf = async () => Number(await page.getByTestId("rw-kpi-bedarf").getAttribute("data-wert"));
    const ohneGarten = await bedarf();
    await page.getByTestId("rw-garten-flaeche").fill("400");
    await expect.poll(bedarf).toBeCloseTo(ohneGarten + 24, 1);
    await page.getByTestId("rw-garten").uncheck();
    await expect.poll(bedarf).toBeCloseTo(ohneGarten - Number(0), 1);
    await page.getByTestId("rw-garten").check();
    await expect.poll(bedarf).toBeCloseTo(ohneGarten + 24, 1);
    await page.getByTestId("rw-garten-flaeche").fill("");
    await expect.poll(bedarf).toBeCloseTo(ohneGarten, 1);
    // Settings persist debounced (1,2 s) — wait before leaving the tab so the Werkstatt reads them.
    await page.waitForTimeout(2000);

    // --- Werkstatt: cellar room + cistern under the garage ------------------------------
    await page.goto(`/ComplexDesigner?${PROJEKT}&tab=werkstatt`);
    await page.getByTestId("wt-tab-keller").click();
    await expect(page.locator('[data-testid="keller-regenwasser"]')).toHaveCount(1, { timeout: 30000 });

    await page.getByTestId("wt-tab-tiefgarage").click();
    await expect(page.getByTestId("tg-planer")).toBeVisible();
    const anwenden = page.getByTestId("tg-anwenden");
    if (await anwenden.isEnabled()) await anwenden.click();
    const zisterne = page.getByTestId("tg-zisterne");
    await expect(zisterne).toHaveCount(1, { timeout: 30000 });
    await expect(zisterne).not.toHaveAttribute("data-klima", "laedt", { timeout: 30000 });
    // Same figure as the drainage card: the garage only changes the location, the volume comes
    // from the same inputs (useRegenwasser) — retention is off by default.
    const eingabenTg = await zisterne.evaluate((el) => ({ we: el.dataset.we, n: el.dataset.niederschlag, dach: el.dataset.dach }));
    console.log("[91-02] Karte", JSON.stringify(eingabenKarte), "· TG", JSON.stringify(eingabenTg));
    await expect(zisterne).toHaveAttribute("data-volumen", String(speicher));

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
