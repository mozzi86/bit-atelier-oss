// Headless-Nachweis 75-03 (MS-03): Kante ziehen im Massing-Studio.
// Nordkante eines 30 x 20-Rechtecks um 2 m nach aussen -> Tiefe 22, Ost/West 22 m,
// Masstext "+2,00 m" waehrend des Drags; Esc stellt zurueck; Tab + Zahl setzt exakt.
// Netz: alles ausser localhost geblockt (Muster produktreife-72-01).

import { test, expect } from "@playwright/test";

import { ERLAUBT_OFFLINE, messen, punkte, nordkante, resetRechteck, nurLocalhost } from "./fixtures/massing.js";

test.describe("75-03 — Kante ziehen, Snap-Kette, Masstext, Tab, Esc", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 120000 });
  test("Nordkante +2 m, Text +2,00 m, Esc stellt zurueck, Tab setzt 3 m", async ({ page }) => {
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
    await page.locator("svg[viewBox]").first().scrollIntoViewIfNeeded();

    // Startzustand deterministisch: Rechteck 30 x 20 m an (10,10) — nur ueber die UI (75-01-Tastatur).
    let m = await resetRechteck(page);
    expect(m.n).toBe(4);
    expect(Math.abs(m.w - 30) + Math.abs(m.d - 20), `Reset ${m.w} x ${m.d}`).toBeLessThan(0.3);

    // 1) Nordkante 2 m nach aussen (nach oben) ziehen; Snap-Kette landet im 0,5-m-Raster.
    const w0 = m.w, d0 = m.d;
    let k = await nordkante(page);
    expect(k, "Nordkante gefunden").toBeTruthy();
    await page.mouse.move(k.x, k.y); await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(k.x, k.y - (2 * m.pxPerM * i) / 12);
    await page.waitForTimeout(100);
    const masstext = page.locator("[data-masstext] text");
    await expect(masstext).toBeVisible();
    await expect(masstext).toContainText("+2,00 m");
    await expect(masstext).toContainText(/Tiefe 2[12],[0-9][0-9] m/); // 20 + 2 (Start kann 19,99 sein)
    await page.mouse.up(); await page.waitForTimeout(100);
    expect(await page.locator("[data-masstext]").count(), "Masstext nach Loslassen weg").toBe(0);
    m = await messen(page);
    expect(Math.abs(m.d - (d0 + 2)), `Tiefe ${m.d} (vorher ${d0})`).toBeLessThan(0.05);
    expect(Math.abs(m.w - w0), `Breite bleibt ${m.w} (vorher ${w0})`).toBeLessThan(0.05);
    // Ost-/Westkante: senkrechte Kanten aus den Polygonpunkten messen (Trefferlinien sind 12 px breit).
    const pk = await punkte(page);
    const senkrecht = [];
    for (let i = 0; i < pk.pts.length; i += 1) {
      const p1 = pk.pts[i], p2 = pk.pts[(i + 1) % pk.pts.length];
      if (Math.abs(p1.x - p2.x) < 0.05) senkrecht.push(Math.abs(p1.y - p2.y));
    }
    expect(senkrecht.length).toBe(2);
    for (const l of senkrecht) expect(Math.abs(l - m.d), `Kantenlaenge ${l}`).toBeLessThan(0.05);

    // 2) Esc mitten im Drag: Polygon wie vorher.
    k = await nordkante(page);
    await page.mouse.move(k.x, k.y); await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(k.x, k.y - (3 * m.pxPerM * i) / 6);
    await page.waitForTimeout(100);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    await page.mouse.up(); await page.waitForTimeout(100);
    const dVorEsc = m.d;
    m = await messen(page);
    expect(Math.abs(m.d - dVorEsc), `Tiefe nach Esc ${m.d}`).toBeLessThan(0.05);

    // 3) Tab waehrend des Drags: Zahlenfeld, 3 eingeben, Enter -> Tiefe 25.
    k = await nordkante(page);
    await page.mouse.move(k.x, k.y); await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(k.x, k.y - (1 * m.pxPerM * i) / 6);
    await page.waitForTimeout(100);
    await page.keyboard.press("Tab");
    const eingabe = page.locator("input[data-kante-eingabe]");
    await expect(eingabe).toBeVisible();
    await page.mouse.up();
    await eingabe.fill("3");
    await eingabe.press("Enter");
    await page.waitForTimeout(100);
    const dVorTab = m.d;
    m = await messen(page);
    expect(Math.abs(m.d - (dVorTab + 3)), `Tiefe nach Tab+3 ${m.d}`).toBeLessThan(0.05);
    expect(await page.locator("input[data-kante-eingabe]").count()).toBe(0);

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
