// Headless-Nachweis 91-03 (AVA-Übergabe der Entwässerungs- und Regenwasser-Mengen): Haustechnik ›
// Entwässerung › „Als CSV für die AVA“ lädt eine Datei, die der ECHTE Datei-Import der Ausschreibung
// („LV importieren“ → gaeb.js detectAndParse) liest: die Zisterne kommt mit derselben Menge wie in der
// Regenwasser-Karte an, Kostengruppe 412, Einheitspreis leer (null), Herkunft im Kurztext.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import { detectAndParse } from "../../packages/nova-ausschreibung/src/lib/gaeb.js";

test.describe("91-03 AVA-Übergabe", () => {
  test.setTimeout(180000);

  test("Mengen als CSV → AVA-Import liest Zisterne, Filter, Pumpe, Leitung mit KG 412 und ohne Preis", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=haustechnik");
    await page.getByTestId("ht-tab-entwaesserung").click();
    const karte = page.getByTestId("rw-karte");
    await expect(karte).toBeVisible({ timeout: 30000 });
    await expect(karte).not.toHaveAttribute("data-klima", "laedt", { timeout: 30000 });
    const speicher = Number(await karte.getAttribute("data-speicher"));

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ew-mengen-csv").click()]);
    expect(download.suggestedFilename()).toMatch(/^entwaesserung-mengen-.*\.csv$/);
    const rows = detectAndParse(download.suggestedFilename(), new Uint8Array(fs.readFileSync(await download.path())));
    expect(rows.length, "Positionen im Import").toBeGreaterThan(3);
    const zisterne = rows.find((r) => /^Regenwasserzisterne/.test(r.title));
    expect(zisterne, "Zisterne im LV").toBeTruthy();
    expect(zisterne.quantity).toBe(speicher);
    expect(zisterne.unit).toBe("m³");
    expect(zisterne.din276).toBe("412");
    expect(zisterne.unit_price, "kein erfundener Preis").toBeNull();
    expect(zisterne.title).toMatch(/\(aus Entwässerungsplaner, Stand \d{2}\.\d{2}\.\d{4}\)$/);
    for (const t of ["Regenwasserfilter", "Pumpenanlage", "Betriebswasserleitung"]) expect(rows.some((r) => r.title.includes(t)), t).toBe(true);
    expect(new Set(rows.map((r) => r.oz)).size, "OZ eindeutig").toBe(rows.length);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
