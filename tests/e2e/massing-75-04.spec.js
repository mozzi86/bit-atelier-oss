// Headless-Nachweis 75-04 (MS-04): Lehrling-Palette im Massing-Studio.
// Baukoerper unten rechts im Zeichenfeld, Zeiger auf der Ostkante -> Palette erscheint nach
// ~150 ms links oberhalb (NW), liegt vollstaendig im Container, schneidet die Polygon-Bbox
// nicht und nennt die Kante; Zeiger weg -> nach ~300 ms verschwunden.

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, punkte, resetRechteck, nurLocalhost } from "./fixtures/massing.js";

const schneidet = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test.describe("75-04 — Lehrling-Palette", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 120000 });
  test("Palette weicht nach NW aus, bleibt im Container, meidet das Polygon, verschwindet", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("pageerror", (e) => {
      const stack = e.stack || String(e);
      // three.js in headless Chromium: WebGL program info goes null (getUniforms -> trim) — GPU context, not app code.
      if (/WebGLProgram|getUniforms|WebGLRenderer/.test(stack)) return;
      warnungen.push("[pageerror] " + stack.split(String.fromCharCode(10)).slice(0, 4).join(" | "));
    });
    page.on("console", (msg) => { if ((msg.type() === "error" || msg.type() === "warning") && !ERLAUBT_OFFLINE.test(msg.text())) warnungen.push(msg.text()); });

    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 15000 });
    await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();

    // Kleiner Baukoerper 12 x 10 in der unteren rechten Ecke des 70 x 50-Zeichenfelds: SO und NO
    // verlassen den Container, SW laege ueber dem Polygon -> NW bleibt als einziger Kandidat.
    await resetRechteck(page, [{ x: 56, y: 38 }, { x: 68, y: 38 }, { x: 68, y: 48 }, { x: 56, y: 48 }]);
    await page.mouse.move(5, 5); // Zeiger weg vom Plan
    await page.waitForTimeout(400);
    expect(await page.locator("[data-lehrling-palette]").count(), "Palette ohne Hover").toBe(0);

    // Ostkante (senkrechte Trefferlinie mit groesstem x), oberes Fuenftel (unter dem Zeiger liegt das Polygon).
    const lines = page.locator('line[data-griff="kante"]');
    let ost = null;
    for (let i = 0; i < (await lines.count()); i += 1) {
      const b = await lines.nth(i).boundingBox();
      if (b && b.height > b.width && (!ost || b.x > ost.x)) ost = b;
    }
    expect(ost, "Ostkante gefunden").toBeTruthy();
    const zx = ost.x + ost.width / 2, zy = ost.y + ost.height * 0.2;
    await page.mouse.move(zx - 30, zy);
    await page.mouse.move(zx, zy);
    const palette = page.locator("[data-lehrling-palette]");
    await expect(palette).toBeVisible({ timeout: 2000 });
    await expect(palette).toContainText("Kante");
    await expect(palette).toHaveAttribute("data-ecke", "NW");

    const pb = await palette.boundingBox();
    // Container = Elternelement des Plan-SVGs (nicht das erste svg[viewBox] der Seite - das ist ein Icon).
    const container = await page.locator('div.relative:has(polygon[data-griff="flaeche"])').first().boundingBox();
    expect(pb.x, "links im Container").toBeGreaterThanOrEqual(container.x - 1);
    expect(pb.y, "oben im Container").toBeGreaterThanOrEqual(container.y - 1);
    expect(pb.x + pb.width, "rechts im Container").toBeLessThanOrEqual(container.x + container.width + 1);
    expect(pb.y + pb.height, "unten im Container").toBeLessThanOrEqual(container.y + container.height + 1);
    const polyBox = await page.locator('polygon[data-griff="flaeche"]').boundingBox();
    expect(schneidet(pb, polyBox), "Palette liegt nicht ueber dem Polygon").toBe(false);
    // Palette liegt links oberhalb des Zeigers.
    expect(pb.x + pb.width).toBeLessThan(zx + 1); // 1 px Rundung an der Klemmgrenze
    expect(pb.y + pb.height).toBeLessThan(zy);

    // Ecke: Koordinaten und Knopf "Ecke loeschen" (kein Klick).
    const ecke = page.locator('[data-griff="ecke"]').first();
    await ecke.hover({ force: true });
    await expect(palette).toContainText("Ecke 1");
    await expect(palette.getByRole("button", { name: "Ecke löschen" })).toBeVisible();

    // Verlassen -> nach 300 ms weg.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    expect(await page.locator("[data-lehrling-palette]").count(), "Palette nach Verlassen").toBe(0);

    // Polygon-Punkte unveraendert (nur Hover, kein Drag).
    const p = await punkte(page);
    expect(p.pts.length).toBe(4);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
