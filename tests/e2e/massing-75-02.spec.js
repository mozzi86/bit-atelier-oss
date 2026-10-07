// Headless-Nachweis 75-02 (MS-02): phi-Magnet und Kennzahl "Proportion" im Massing-Studio.
// Ablauf: Skaliergriff (SE) auf 16,0 x 10,0 m ziehen -> Breite rastet bei 16,18 m,
// KPI zeigt "1 : 1,62"; mit Alt ziehen -> keine Hilfslinie; 12 x 12 -> Hinweis "+7,42".
// Netz: alles ausser localhost geblockt (Muster produktreife-72-01).

import { test, expect } from "@playwright/test";
import { resetRechteck } from "./fixtures/massing.js";

const PHI = (1 + Math.sqrt(5)) / 2;

const ERLAUBT_OFFLINE = /(ERR_|net::|Failed to fetch|timeout|aborted|404|503|tiles\.|openfreemap|elevation-tiles|Image could not be loaded|AbortError|GL Driver Message|WebGL)/i;

/** Footprint bbox in metres + screen px per metre, read from the live SVG. */
async function messen(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("svg[viewBox]");
    const poly = document.querySelector('polygon[data-griff="flaeche"]');
    const grid = [...document.querySelectorAll('svg line[stroke="#e2e8f0"]')].map((l) => Number(l.getAttribute("x1")));
    const xs = [...new Set(grid)].sort((a, b) => a - b);
    const unitsPerM = (xs[1] - xs[0]) / 10; // grid every 10 m
    const vb = svg.getAttribute("viewBox").split(" ").map(Number);
    const pxPerUnit = svg.getBoundingClientRect().width / vb[2];
    const pts = poly.getAttribute("points").split(" ").map((p) => p.split(",").map(Number));
    const px = pts.map((p) => p[0]), py = pts.map((p) => p[1]);
    return {
      w: (Math.max(...px) - Math.min(...px)) / unitsPerM,
      d: (Math.max(...py) - Math.min(...py)) / unitsPerM,
      pxPerM: unitsPerM * pxPerUnit,
      n: pts.length,
    };
  });
}

async function zieheSE(page, dxPx, dyPx, { alt = false } = {}) {
  const griff = page.locator('rect[data-griff="skala"]').nth(1);
  const box = await griff.boundingBox();
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(sx + (dxPx * i) / steps, sy + (dyPx * i) / steps);
  await page.waitForTimeout(80); // rAF flush of the drag hook
  const mitteDrag = await page.locator("[data-phi-linie]").count();
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  await page.waitForTimeout(80);
  return mitteDrag;
}

test.describe("75-02 — phi-Magnet + Kennzahl Proportion", () => {
  test.describe.configure({ timeout: 120000 });
  // Der Massing-Plan liegt unter der Kopfzeile; bei 720 px Hoehe waere der SE-Griff ausserhalb
  // des Viewports und die Maus traefe nichts (elementFromPoint = null). Hoher Viewport statt Scrollen.
  test.use({ viewport: { width: 1280, height: 1800 } });
  test("16,0 x 10,0 rastet auf 16,18; Alt rastet nicht; 12 x 12 zeigt +7,42 m", async ({ page }) => {
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return route.continue();
      return route.abort();
    });
    const warnungen = [];
    page.on("pageerror", (e) => {
      const stack = e.stack || String(e);
      // three.js in headless Chromium: WebGL program info goes null (getUniforms -> trim) — GPU context, not app code.
      if (/WebGLProgram|getUniforms|WebGLRenderer/.test(stack)) return;
      warnungen.push("[pageerror] " + stack.split(String.fromCharCode(10)).slice(0, 4).join(" | "));
    });
    page.on("console", (msg) => {
      if ((msg.type() === "error" || msg.type() === "warning") && !ERLAUBT_OFFLINE.test(msg.text())) warnungen.push(msg.text());
    });

    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 15000 });
    await page.locator("svg[viewBox]").first().scrollIntoViewIfNeeded();
    const kpi = page.locator("div.rounded-lg.bg-slate-50", { hasText: "Proportion" }).first();
    await expect(kpi).toBeVisible();

    // Startzustand deterministisch: exaktes Rechteck 30 x 20 m (Footprint persistiert in db.json).
    let m = await resetRechteck(page);
    expect(m.n, "Footprint muss ein Rechteck sein").toBe(4);

    // 1) auf 16,0 x 10,0 ziehen -> Magnet: Breite 16,18 (phi bei Tiefe 10).
    let linie = await zieheSE(page, (16.0 - m.w) * m.pxPerM, (10.0 - m.d) * m.pxPerM);
    m = await messen(page);
    expect(Math.abs(m.d - 10), `Tiefe ${m.d}`).toBeLessThan(0.15);
    // Der Magnet rastet auf Tiefe*phi (die Tiefe rundet clampPt auf 0,1 m, z. B. 10,1 -> 16,34).
    expect(Math.abs(m.w - m.d * PHI), `Breite ${m.w} bei Tiefe ${m.d} (Magnet)`).toBeLessThan(0.05);
    expect(linie, "phi-Hilfslinie waehrend des Drags").toBeGreaterThan(0);
    await expect(kpi).toContainText("1 : 1,62");
    expect(await page.locator("[data-phi-linie]").count(), "Hilfslinie nach Loslassen weg").toBe(0);

    // 2) mit Alt auf 15,0 m Breite (Verhaeltnis ~1,49, ausserhalb des Bands) -> kein Magnet, kein Haken.
    linie = await zieheSE(page, (15.0 - m.w) * m.pxPerM, 0, { alt: true });
    m = await messen(page);
    expect(linie, "keine Hilfslinie mit Alt").toBe(0);
    expect(Math.abs(m.w - 15.0), `Breite ${m.w} (Alt)`).toBeLessThan(0.11);
    await expect(kpi).not.toContainText("✓");

    // 3) 12 x 12 -> gelb mit Hinweis "Ostkante +7,42 m".
    await zieheSE(page, (12.0 - m.w) * m.pxPerM, (12.0 - m.d) * m.pxPerM, { alt: true });
    m = await messen(page);
    expect(Math.abs(m.w - 12) + Math.abs(m.d - 12), `${m.w} x ${m.d}`).toBeLessThan(0.25);
    await expect(kpi).toContainText("1 : 1,00");
    await expect(kpi).toContainText("+7,42");

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
