// Headless-Nachweis 86-01 (formtreue Tesselierung, Stufe 1): im Massing-Studio eine Ecke des
// Baukörpers verschieben (Rechteck → Trapez) — die Werkstatt-Zonen folgen OHNE Tab-Wechsel und
// liegen vollständig im Baukörper; Ecke zurück → Rechteck und Zonen wie vorher. Vorher (Befund
// 08.10.): die Zonen blieben stehen und lagen nach dem nächsten Werkstatt-Besuch zu 34–41 %
// außerhalb (Bounding-Box). Der Baukörper des Review-Testhauses wird am Ende exakt
// zurückgesetzt (Pfeiltasten, 0,1-m-Schritte; Notfall: resetRechteck auf die Ausgangsecken).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost, punkte, presse, resetRechteck } from "./fixtures/massing.js";

const PROJEKT = "projekt=Review%20Testhaus";
const SEITE_WERKSTATT = `/ComplexDesigner?${PROJEKT}&tab=werkstatt`;
const SEITE_STUDIO = `/ComplexDesigner?${PROJEKT}&tab=studio`;

async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Unit polygons of the studio (1:200) and the footprint polygon, in SVG units; inside check. */
async function zonenImKoerper(page) {
  return page.evaluate(() => {
    const fp = document.querySelector('polygon[data-griff="flaeche"]');
    const svg = fp.closest("svg");
    const lies = (el) => el.getAttribute("points").trim().split(/\s+/).map((p) => p.split(",").map(Number));
    const koerper = lies(fp);
    const drin = (x, y) => {
      let d = false;
      for (let i = 0, j = koerper.length - 1; i < koerper.length; j = i++) {
        const [xi, yi] = koerper[i], [xj, yj] = koerper[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
      }
      return d;
    };
    const zonen = [...svg.querySelectorAll('polygon[fill="#0ea5e9"]')].map(lies);
    let aussen = 0;
    for (const z of zonen) {
      const cx = z.reduce((s, p) => s + p[0], 0) / z.length, cy = z.reduce((s, p) => s + p[1], 0) / z.length;
      // vertices pulled 1 % towards the zone centre — points ON the outline count as inside
      for (const [x, y] of z) if (!drin(x + (cx - x) * 0.01, y + (cy - y) * 0.01)) aussen += 1;
    }
    return { zonen: zonen.length, aussen, signatur: zonen.slice(0, 6).map((z) => z.map((p) => p.map((v) => Math.round(v)).join(",")).join(" ")).join("|") };
  });
}

test.describe("86-01 Formtreue Tesselierung: Studio folgt dem Baukörper", () => {
  test.setTimeout(240000);

  test("Ecke verschieben → Zonen folgen ohne Tab-Wechsel und bleiben im Baukörper; zurück → wie vorher", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    // Make sure the tessellation is applied (the follower only acts on shown workshop zones).
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    if (await anwenden.count() && !(await anwenden.isDisabled())) { await anwenden.click(); await page.waitForTimeout(1500); }
    await page.waitForTimeout(1500);

    await page.goto(SEITE_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.locator("select[data-massstab]").first().selectOption("200");
    await page.waitForTimeout(1500);
    const start = await punkte(page);
    expect(start.pts.length, "Review-Testhaus ist ein Rechteck").toBe(4);
    const vorher = await zonenImKoerper(page);
    expect(vorher.zonen, "Zonen im Studio (1:200)").toBeGreaterThan(0);
    expect(vorher.aussen, "Ausgangslage: alles im Baukörper").toBe(0);

    let zurueck = false;
    try {
      // Rectangle → trapezoid: corner 0 moves 5 m along the long side (arrow = 0,1 m).
      await page.locator('[data-griff="ecke"]').nth(0).focus();
      await presse(page, "ArrowRight", 50);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2000);
      const trapez = await punkte(page);
      expect(Math.abs(trapez.pts[0].x - start.pts[0].x - 5)).toBeLessThan(0.05);
      const nachher = await zonenImKoerper(page);
      expect(nachher.signatur, "die Zonen wurden neu erzeugt (Studio folgt)").not.toBe(vorher.signatur);
      expect(nachher.zonen).toBeGreaterThan(0);
      expect(nachher.aussen, "keine Zonen-Ecke außerhalb des Trapezes").toBe(0);
      await page.screenshot({ path: test.info().outputPath("86-01-studio-trapez.png") });

      // Back: the same corner 5 m back → the rectangle and the same zones as before.
      await page.locator('[data-griff="ecke"]').nth(0).focus();
      await presse(page, "ArrowLeft", 50);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2000);
      const ende = await punkte(page);
      ende.pts.forEach((p, i) => expect(Math.abs(p.x - start.pts[i].x) + Math.abs(p.y - start.pts[i].y), `Ecke ${i} zurück`).toBeLessThan(0.011));
      zurueck = true;
      const wieder = await zonenImKoerper(page);
      expect(wieder.signatur, "Rechteck → dieselben Zonen wie vorher").toBe(vorher.signatur);
      expect(wieder.aussen).toBe(0);
    } finally {
      if (!zurueck) await resetRechteck(page, start.pts); // 87-01: hard; base.js restores via API anyway
      await page.waitForTimeout(1500); // footprint save (debounced) before the page closes
    }
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
